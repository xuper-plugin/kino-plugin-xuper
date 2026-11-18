// liveStore.js — what the live sources keep on the device (L1 = `storageLarge` text, L0 = this runtime's memory).
//
//   o2:lc               the category registry, written only when a source's categories change:
//                       {"v":1,"src":{"<src>":{"at":<ms>,"cats":[{id,title,adult?,genre?}]}}}
//                       `id` is the source's RAW category id (src/live.js derives the exposed `<src>.<hex>` id).
//   o2:lm               the timing meta, batched (one write per call that changed it, `flushMeta()`):
//                       {"v":1,"c":{"<src>":{"at","failAt","failN"}},"l":{"<listKey>":{"at","h","n","w","failAt","failN"}}}
//                       `c` = when each source's categories were last fetched (or failed), `l` = each stored list
//                       (`at` = last checked, `w` = when its text was last written).
//   o2:ll:<listKey>     one channel list as JSON text `[{id,title,ref,logo?,adult?,x?}]` (Kino-ready ids and refs),
//                       written when its sha1 changes, with storage `ttlMs` = 3 × the list's max-stale, so a list nobody
//                       refreshes vanishes on its own; a list confirmed unchanged is written again once its text is a
//                       max-stale old (renewal). So a list checked at `at` stays at least until `at` + 2 × max-stale: past
//                       max-stale it is overdue (src/live.js refreshes it before any other, and serves it stale until
//                       then) instead of vanishing and loading in full with its connector's whole timeout.
//                       `<listKey>` = `<src>.<hex(raw id)>`.
//   o2:lh               what live resolves learned on this device, kept across runtimes (see "live health" below).
// L0 keeps parsed lists in an LRU capped at 2,000,000 characters of source text; the registry and the meta are
// re-read once per call (another runtime may have written them since).
// Write-behind: a live resolve writes none of this before its answer (see `deferWrites`).
// Stale-write guard: a runtime that timed out keeps running and may write after a fresher one, so every write first
// compares the stored meta and never puts data fetched earlier over data written later.
// Every stored stamp is read through `saneAt` (src/flight.js): one left in the future by a clock that ran ahead and
// was set back counts as "never" (stale, not newer elsewhere, not inside a backoff) instead of freezing the store.
import { getText, getJson, setText, setJson, remove } from "./store.js";
import { callSeq, callStartedAt, saneAt } from "./flight.js";
import { PLUGIN_VERSION } from "./config.js";

export const LC_KEY = "o2:lc";
export const LM_KEY = "o2:lm";
export const LIST_PREFIX = "o2:ll:";
export const L0_MAX_CHARS = 2_000_000;
export const FAIL_BACKOFF_MS = 10 * 60 * 1000;
// A source whose categories fail again and again (xuper's portal refusing every request since 2026-11-16) waits longer
// after each failure in a row: 10 min, 30 min, 1 h, then 3 h. Without it every fresh runtime past 10 min paid ~0.8 s,
// one request and one write for it (Kino's En vivo 273–453 ms → 1,039 ms). A success clears the count; a new plugin
// version starts again at 10 min (it may carry the fix).
const CATS_BACKOFF_MS = [10, 30, 60, 180].map((m) => m * 60 * 1000);
const MAX_TTL_MS = 30 * 24 * 3600 * 1000;      // Kino's ttlMs ceiling; meta older than this is pruned
const TOMBSTONE_MS = 24 * 3600 * 1000;         // a list entry with no text is pruned after a day

function log(m) { try { kino.log("liveStore: " + m); } catch (_) { /* no log */ } }
/** First 16 hex of the text's sha1 (native); past Kino's 5 MB crypto request, or without crypto, a JS hash. */
function sha1(t) {
  if (t.length <= 4_000_000) {
    try { return String(kino.crypto.hash("sha1", t)).slice(0, 16); } catch (_) { /* fall through */ }
  }
  let a = 5381, b = 52711;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = ((a * 33) ^ c) >>> 0; b = ((b * 31) ^ c) >>> 0; }
  return "j" + a.toString(16).padStart(8, "0") + b.toString(16).padStart(7, "0");
}

// ── per-call reads ──

let regCache = null;     // { seq, value }
let metaCache = null;    // { seq, value, touched: Set<"c:<src>"|"l:<key>">, dirty }

function emptyMeta() { return { v: 1, c: {}, l: {} }; }
function readMeta() {
  const m = getJson(LM_KEY);
  return m && typeof m === "object" && m.c && m.l ? m : emptyMeta();
}

// ── write-behind ──
//
// Kino reads a call's answer only once its export settles, and every storage write is synchronous on the runtime's only
// thread: `storageLarge` writes the value, then its index, each with an fsync (app LargePluginStore). `resolveLive` ran
// `flushMeta()` in its finally, so a resolve that touched the meta paid two fsyncs before the person got the stream. A
// resolve now marks its call (`deferWrites()`): what it changes (a list it fetched and the meta, the live health, the
// connectors' documents) stays in this runtime's memory, carried from call to call, and the next call that is not a
// resolve writes it (Kino's liveCategories / liveChannels, the own screen's ticks: `flushMeta()`, or the first read of
// the meta in such a call). A runtime discarded before such a call loses what it learned since: the live health lived
// only in memory before, and a list a resolve fetched (caracol's, a stremio source's re-list) is fetched again.
let deferSeq = -1;

/** Marks the current call as a live resolve: nothing is written until a later call that is not one. */
export function deferWrites() { deferSeq = callSeq(); }

const deferring = () => deferSeq === callSeq();

function meta() {
  const seq = callSeq();
  if (!metaCache || metaCache.seq !== seq) {
    const left = metaCache && metaCache.dirty ? metaCache : null;   // a call that ended without its flush
    if (!deferring()) flushMeta();
    metaCache = { seq, value: readMeta(), touched: new Set(), dirty: false };
    if (left && deferring()) carry(left);
  }
  return metaCache;
}

/**
 * A resolve takes over the entries an earlier call of this runtime changed and did not write: they are this runtime's
 * own (the stale-write guard passes them) and are written with the next flush. An entry another runtime stored since
 * with a newer `at` wins, as in `flushMeta`; for a list, its stored text wins too: the text this runtime left unwritten
 * is dropped, and so is its L0 copy (else the next read would label it with the other runtime's hash).
 */
function carry(left) {
  const m = metaCache;
  for (const t of left.touched) {
    const kind = t.slice(0, 1), id = t.slice(2);
    const mine = left.value[kind][id], theirs = m.value[kind][id];
    if (!mine) continue;
    if (theirs && saneAt(theirs.at) > saneAt(mine.at)) {
      if (kind === "l") { pendingTexts.delete(id); l0Drop(id); }
      continue;
    }
    m.value[kind][id] = mine;
    m.touched.add(t);
  }
  m.dirty = m.touched.size > 0;
}

function touch(kind, id, entry) {
  const m = meta();
  m.value[kind][id] = entry;
  m.touched.add(kind + ":" + id);
  m.dirty = true;
}

/**
 * Whether another runtime stored this entry after this call started (the stale-write guard). The stored meta is
 * re-read once per call, at its first write; an entry this call already wrote is its own.
 */
function newerElsewhere(kind, id) {
  const m = meta();
  if (m.touched.has(kind + ":" + id)) return false;
  if (!m.snapshot) m.snapshot = readMeta();
  const e = m.snapshot[kind][id];
  return !!e && saneAt(e.at) > callStartedAt();
}

/**
 * Writes everything a call left pending: the lists' texts resolves wrote, then the batched meta that labels them, the
 * live health and the connectors' documents. Never from a resolve (`deferWrites`); every other live export calls it in
 * its finally.
 */
export function flushMeta() {
  if (deferring()) return;
  writeTexts();
  writeMeta();
  writeHealth();
  writeDocs();
}

/** Writes the batched meta: re-reads the stored copy and keeps, per entry, the newer `at` (a later runtime wins). */
function writeMeta() {
  const m = metaCache;
  if (!m || !m.dirty) return;
  const stored = readMeta();
  const now = Date.now();
  for (const t of m.touched) {
    const kind = t.slice(0, 1), id = t.slice(2);
    const mine = m.value[kind][id], theirs = stored[kind][id];
    if (!mine) continue;
    if (theirs && saneAt(theirs.at, now) > saneAt(mine.at, now)) continue;
    stored[kind][id] = mine;
  }
  for (const kind of ["c", "l"]) {
    for (const id of Object.keys(stored[kind])) {
      const e = stored[kind][id];
      const age = now - Math.max(saneAt(e.at, now), saneAt(e.failAt, now));
      // A list with no text (a tombstone left by `dropLists`, a failure with nothing stored) matters for a day at most:
      // every runtime has seen it by then, and its backoff is 10 min. An account switch writes up to 30 of them.
      if (age > MAX_TTL_MS || (kind === "l" && !e.h && age > TOMBSTONE_MS)) delete stored[kind][id];
    }
  }
  setJson(LM_KEY, stored);
  m.value = stored;
  m.touched = new Set();
  m.dirty = false;
}

// ── categories ──

/** The registry's `src` map (`{ "<src>": { at, cats } }`), read once per call. */
export function registry() {
  const seq = callSeq();
  if (!regCache || regCache.seq !== seq) {
    const r = getJson(LC_KEY);
    regCache = { seq, value: r && typeof r === "object" && r.src && typeof r.src === "object" ? r.src : {} };
  }
  return regCache.value;
}

/** One source's stored categories with their age: `{ cats, at, failAt, failN }` or null (never stored). */
export function catsOf(src) {
  const e = registry()[src];
  if (!e || !Array.isArray(e.cats)) return null;
  const c = meta().value.c[src] || {};
  return { cats: e.cats, at: Math.max(saneAt(e.at), saneAt(c.at)), failAt: saneAt(c.failAt), failN: Number(c.failN) || 0 };
}

/** When one source's categories last failed (0 = never), for the backoff of sources with nothing stored. */
export function catsFailAt(src) {
  const c = meta().value.c[src];
  return c ? saneAt(c.failAt) : 0;
}

/** How many times in a row one source's categories failed under this plugin version (0 = none). */
function catsFailN(src) {
  const c = meta().value.c[src];
  return c && c.v === PLUGIN_VERSION ? Math.max(0, Number(c.failN) || 0) : (c && saneAt(c.failAt) ? 1 : 0);
}

/** The wait after `failN` failures in a row (the ladder's last step past its end). */
function catsBackoffMs(failN) {
  return CATS_BACKOFF_MS[Math.min(Math.max(Number(failN) || 1, 1), CATS_BACKOFF_MS.length) - 1];
}

/** Whether one source's categories are inside their failure backoff (the escalating ladder above). */
export function catsInBackoff(src, now) {
  const t = now || Date.now();
  const f = saneAt(catsFailAt(src), t);
  return !!f && t - f < catsBackoffMs(catsFailN(src));
}

/**
 * Stores one source's categories (already normalized `[{id, title, adult?, genre?}]`). The registry text is
 * rewritten only when they changed; the meta `at` always moves. Returns whether the registry changed.
 */
export function setCats(src, cats) {
  const now = Date.now();
  if (newerElsewhere("c", src)) {                          // a later runtime already stored newer categories
    log(src + ": categories skipped (a newer write exists)");
    return false;
  }
  const stored = getJson(LC_KEY);
  const all = stored && typeof stored === "object" && stored.src && typeof stored.src === "object" ? stored.src : {};
  const before = all[src];
  const same = before && JSON.stringify(before.cats) === JSON.stringify(cats);
  if (!same) {
    all[src] = { at: now, cats };
    setJson(LC_KEY, { v: 1, src: all });
    regCache = { seq: callSeq(), value: all };
  }
  touch("c", src, { at: now, failAt: 0, failN: 0 });
  return !same;
}

/** Records a failed category fetch (the escalating backoff). → the wait before the next try, in ms. */
export function failCats(src) {
  const c = meta().value.c[src] || {};
  const n = (c.v === PLUGIN_VERSION ? Math.max(0, Number(c.failN) || 0) : 0) + 1;
  touch("c", src, { at: saneAt(c.at), failAt: Date.now(), failN: n, v: PLUGIN_VERSION });
  return catsBackoffMs(n);
}

// ── lists ──

const L0 = new Map();     // listKey → { items, chars, h }
let l0Chars = 0;

function l0Get(key) {
  const e = L0.get(key);
  if (!e) return null;
  L0.delete(key);
  L0.set(key, e);          // most recently used last
  return e;
}

function l0Put(key, items, chars, h) {
  const old = L0.get(key);
  if (old) { l0Chars -= old.chars; L0.delete(key); }
  if (chars > L0_MAX_CHARS) return;
  L0.set(key, { items, chars, h });
  l0Chars += chars;
  while (l0Chars > L0_MAX_CHARS && L0.size) {
    const [k, e] = L0.entries().next().value;
    L0.delete(k);
    l0Chars -= e.chars;
  }
}

function l0Drop(key) {
  const old = L0.get(key);
  if (old) { l0Chars -= old.chars; L0.delete(key); }
}

/**
 * The meta of one stored list (`{ at, h, n, w, failAt, failN, p }`; `w` = when its text was last written, `p` = the
 * channels so far of a listing cut short) or null.
 */
export function listMeta(key) {
  const e = meta().value.l[key];
  return e ? { at: saneAt(e.at), h: String(e.h || ""), n: Number(e.n) || 0, w: saneAt(e.w), failAt: saneAt(e.failAt), failN: Number(e.failN) || 0, p: e.p === 1 } : null;
}

// A list's text is kept this many max-stales after it was last written (renewed every third of it, below).
const LIST_TTL_FACTOR = 3;

/** The storage `ttlMs` of a list whose max-stale is `maxStaleMs` (Kino accepts 1 min to 30 d). */
function ttlOf(maxStaleMs) {
  const m = Number(maxStaleMs) > 0 ? Number(maxStaleMs) : MAX_TTL_MS;
  return Math.max(60_000, Math.min(MAX_TTL_MS, Math.floor(m * LIST_TTL_FACTOR)));
}

/**
 * Whether an unchanged list's text must be written again to renew its storage TTL: the text is only rewritten when
 * its sha1 changes, so a list that stays the same upstream would otherwise vanish `ttlMs` after its last change even
 * while every refresh (or 304) confirms it. Renewed once past a third of the TTL (one max-stale): one rewrite per
 * max-stale at most, and a list checked now stays at least two thirds of the TTL.
 */
function renewDue(m, ttlMs, now) { return now - (m.w || 0) >= ttlMs / LIST_TTL_FACTOR; }

/** When one list's stored text vanishes (its storage TTL ends), or 0 when its text is not in storage (memory only). */
export function listTextEndsAt(key, maxStaleMs) {
  const m = listMeta(key);
  return m && m.h && m.w ? m.w + ttlOf(maxStaleMs) : 0;
}

// A list's text written (or removed: null) during a resolve, kept here until the flush writes it, just before the meta
// that labels it: the two go to storage together or not at all (a runtime discarded before the flush loses both, and a
// later one fetches that list again), so no stored meta ever labels a text that is not stored. Reads look here first.
// `h` is the hash its meta entry labels it with: the flush writes it only while that entry is still this runtime's.
const pendingTexts = new Map();   // listKey → { text, ttlMs, h } | null

/** A list's text: the one a resolve is about to write, else the stored one, else null. */
function readText(key) {
  if (pendingTexts.has(key)) { const p = pendingTexts.get(key); return p ? p.text : null; }
  return getText(LIST_PREFIX + key);
}

/** Stores a list's text (`h`: its hash), now or (in a resolve) with the next flush. → false when storage refused it now. */
function writeText(key, text, ttlMs, h) {
  if (deferring()) { pendingTexts.set(key, { text, ttlMs, h }); return true; }
  pendingTexts.delete(key);
  return setText(LIST_PREFIX + key, text, { ttlMs });
}

/** Removes a list's text, now or (in a resolve) with the next flush. */
function removeText(key) {
  if (deferring()) { pendingTexts.set(key, null); return; }
  pendingTexts.delete(key);
  remove(LIST_PREFIX + key);
}

/**
 * Writes the texts resolves left pending, each only with the meta entry that labels it (the stale-write guard, as
 * `writeMeta` applies it): when another runtime stored that list since (a runtime whose call Kino cut keeps running and
 * flushes late), its stored entry is newer and `writeMeta` keeps it, so its text stays too. A text storage refuses (too
 * large, storage full) is handled as `putList` does at once: its older stored text is removed and its meta says the text
 * is not in storage, so the meta's hash never labels that older text in a later runtime.
 */
function writeTexts() {
  if (!pendingTexts.size) return;
  const m = metaCache;
  const stored = readMeta();
  const now = Date.now();
  for (const [key, p] of pendingTexts) {
    const mine = m && m.value.l[key], theirs = stored.l[key];
    if (!mine || (theirs && saneAt(theirs.at, now) > saneAt(mine.at, now))) continue;
    if (p === null) {
      if (!mine.h || !mine.w) remove(LIST_PREFIX + key);   // its meta says no text is stored
      continue;
    }
    if (mine.h !== p.h) continue;
    if (setText(LIST_PREFIX + key, p.text, { ttlMs: p.ttlMs })) continue;
    log(key + ": list not stored (" + p.text.length + " chars), kept in memory only");
    remove(LIST_PREFIX + key);
    if (mine.w) { m.value.l[key] = { ...mine, w: 0 }; m.touched.add("l:" + key); m.dirty = true; }
  }
  pendingTexts.clear();
}

/** One stored list: `{ items, at, h }` (L0, else one L1 read and parse), or null. Never touches the network. */
export function getList(key) {
  const m = listMeta(key);
  const hit = l0Get(key);
  if (hit && (!m || !m.h || m.h === hit.h)) return { items: hit.items, at: m ? m.at : 0, h: hit.h };
  const text = readText(key);
  if (text === null) { l0Drop(key); return null; }
  let items;
  try { items = JSON.parse(text); } catch (_) { items = null; }
  if (!Array.isArray(items)) return null;
  const h = (m && m.h) || sha1(text);
  l0Put(key, items, text.length, h);
  return { items, at: m ? m.at : 0, h };
}

/**
 * Stores one list (Kino-ready items). The text is written when its sha1 changed (or the stored text is gone), or to
 * renew its TTL (`renewDue`), with `ttlMs` = 3 × `maxStaleMs`; the meta `at` always moves. A list storage
 * refuses (too large, storage full) stays in L0 only, and an older stored text of it is removed: the meta's new hash
 * must never label the old text in a later runtime (which would then serve it as current and never refetch).
 * `partial` (with the list's `freshMs`): the channels so far of a listing cut short, stored as checked one fresh period
 * ago (stale, so the next listing goes on with it) and marked `p`. → `{ items, h, at, changed }`.
 */
export function putList(key, items, opts) {
  const o = opts || {};
  const now = Date.now();
  const at = o.partial ? Math.max(1, now - Math.max(0, Number(o.freshMs) || 0) - 1) : now;
  const text = JSON.stringify(items);
  const h = sha1(text);
  const m = listMeta(key);
  if (newerElsewhere("l", key)) {                          // a later runtime stored this list after this call began
    const cur = getList(key);
    if (cur) {
      log(key + ": list skipped (a newer write exists)");
      return { ...cur, changed: false };
    }
  }
  const ttlMs = ttlOf(o.maxStaleMs);
  const l0 = L0.get(key);
  const have = m && m.h === h && ((l0 && l0.h === h) || readText(key) !== null);
  let w = m ? m.w : 0;
  if (!have || renewDue(m, ttlMs, now)) {
    if (writeText(key, text, ttlMs, h)) w = now;
    else {
      log(key + ": list not stored (" + text.length + " chars), kept in memory only");
      if (!have) { removeText(key); w = 0; }
    }
  }
  l0Put(key, items, text.length, h);
  touch("l", key, { at, h, n: items.length, w, failAt: 0, failN: 0, ...(o.partial ? { p: 1 } : {}) });
  return { items, h, at, changed: !have };
}

/**
 * Marks a stored list as checked now (the upstream answered "not modified"). With `maxStaleMs`, the stored text is
 * written again when its TTL renewal is due (`renewDue`). → whether a list was stored.
 */
export function touchList(key, opts) {
  const m = listMeta(key);
  if (!m) return false;
  const now = Date.now();
  let w = m.w;
  if (opts && opts.maxStaleMs > 0) {
    const ttlMs = ttlOf(opts.maxStaleMs);
    if (renewDue(m, ttlMs, now)) {
      const text = readText(key);
      if (text !== null && writeText(key, text, ttlMs, m.h)) w = now;
    }
  }
  touch("l", key, { at: now, h: m.h, n: m.n, w, failAt: 0, failN: 0 });
  return true;
}

/** Records a failed list fetch (the 10 min backoff); the stored list, if any, keeps being served. */
export function failList(key) {
  const m = listMeta(key) || { at: 0, h: "", n: 0, w: 0, failN: 0 };
  touch("l", key, { at: m.at, h: m.h, n: m.n, w: m.w, failAt: Date.now(), failN: (m.failN || 0) + 1, ...(m.p ? { p: 1 } : {}) });
}

/** Whether `failAt` is inside the 10 min backoff (a stamp in the future, from a clock set back, is not). */
export function inBackoff(failAt, now) {
  const t = now || Date.now();
  const f = saneAt(failAt, t);
  return !!f && t - f < FAIL_BACKOFF_MS;
}

/**
 * Forgets every stored list of one source (text, L0 and meta), e.g. when the account its channels encode changed: a
 * tombstone (`h` "") in the meta makes them misses here and in every later runtime, and its `at` wins the batched
 * meta merge. The list being fetched in this call is then stored as new. → how many lists were dropped.
 */
export function dropLists(src) {
  const now = Date.now();
  let n = 0;
  dropped.set(src, callSeq());
  for (const key of listKeysOf(src)) {
    removeText(key);
    l0Drop(key);
    touch("l", key, { at: now, h: "", n: 0, w: 0, failAt: 0, failN: 0 });
    n++;
  }
  if (n) log(src + ": dropped " + n + " stored lists");
  return n;
}

/** Every stored list key of one source (from the meta), for a connector looking up its own channels. */
export function listKeysOf(src) {
  const prefix = src + ".";
  return Object.keys(meta().value.l).filter((k) => k.startsWith(prefix) && meta().value.l[k].h);
}

const dropped = new Map();   // source → the call sequence that last dropped its lists

/** Whether one source's lists were dropped during this call (an account switch mid-compose). */
export function droppedThisCall(src) { return dropped.get(src) === callSeq(); }

// ── live resolves (runtime memory only) ──
//
// Kino re-resolves a cut live channel with the same ref and no options (2, 4 and 8 s after the cut, then every 30 s),
// and its zapping preheat resolves the neighbours one at a time, also between a channel's open and its first reopen.
// So each channel keeps its own last resolve (a neighbour's resolve in between does not hide a reopen), and whether
// it was also the runtime's last one (`consecutive`: nothing resolved in between, as in Kino's chain of reopens).

let lastKey = null;          // the channel of this runtime's last live resolve
const resolves = new Map();  // channel key → { endedAt, member, streak }
const RESOLVES_MAX = 64;

/**
 * The last live resolve of one channel (`key`: its ref hash) in this runtime: `{ endedAt, member, streak, consecutive }`
 * (`member` = the ref it played, or null; `streak` = how many re-resolves in a row it ended; `consecutive` = it is also
 * the runtime's last resolve), or null.
 */
export function lastResolveOf(key) {
  const r = resolves.get(key);
  return r ? { ...r, consecutive: lastKey === key } : null;
}

/** Notes the end of a live resolve of `key` that played `member` (or null: none opened), `streak` re-resolves in a row. */
export function markResolved(key, member, streak) {
  resolves.delete(key);
  resolves.set(key, { endedAt: Date.now(), member: member || null, streak: Math.max(0, Number(streak) || 0) });
  while (resolves.size > RESOLVES_MAX) resolves.delete(resolves.keys().next().value);
  lastKey = key;
}

// ── live health (o2:lh): what live resolves learned on this device, kept across runtimes ──
//
//   o2:lh   {"v":1,"s":{"<src>":{…}},"m":{"<h>":{…}},"r":{"<h>":<at>}}
//     s   per source, what its members cost here (src/live.js orders a merged channel's members with it): `ms` the
//         smoothed time a member took to answer (a network member's resolve, a blind member's probe) over `n` answers
//         (at most 8), the last one at `at`; `ok` its last success; `f` its last failure and `fn` its failures in a row
//         (a connector that threw or answered no stream; a blind source's playlist found dead); `t` its last change.
//     m   per member (a hash of its `L:` ref): `ok` when its playlist last answered a probe, `d` / `u` its demotion
//         (when, until), `t` its last change.
//     r   streams (a hash of host + path) whose playlist answered a probe with a redirect, and when.
// Kept in the runtime's memory alone, all of it went with every cold runtime (Kino closes an idle one after 5 min and
// discards one whose call it cancelled): the next one probed again a playlist that had just answered, tried first a
// member that had just failed and probed a stream that can only redirect. Written behind (`flushMeta`), merged entry by
// entry with the stored copy (the later change wins), each entry dropped once it says nothing any more, the key kept 7
// days after its last write.

export const LH_KEY = "o2:lh";
const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const LH_TTL_MS = 7 * DAY;
const SOURCE_KEEP_MS = 7 * DAY;             // a source's numbers, after their last change
export const PROBE_OK_KEEP_MS = 2 * HOUR;   // a member's last probe that answered is read up to this old (src/live.js)
const MAX_DEMOTE_MS = HOUR;                 // no demotion lasts longer (a stamp from a clock set back cannot freeze one)
const REDIRECT_KEEP_MS = 6 * HOUR;          // a stream that answered a redirect is not probed again for this long
const SOURCES_MAX = 40, MEMBERS_MAX = 400, REDIRECTS_MAX = 64;
const SAMPLES_MAX = 8;

/** A short key for a member ref or a stream: two 32-bit string hashes (no collision among a few hundred entries). */
function hk(s) {
  const t = String(s);
  let a = 5381, b = 52711;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = ((a * 33) ^ c) >>> 0; b = ((b * 31) ^ c) >>> 0; }
  return a.toString(36) + "." + b.toString(36);
}

const isMap = (x) => !!x && typeof x === "object" && !Array.isArray(x);
let lh = null;   // { value, dirty }: this runtime's copy, read from storage once

function readHealth() {
  const v = getJson(LH_KEY);
  return isMap(v) && isMap(v.s) && isMap(v.m) && isMap(v.r) ? v : { v: 1, s: {}, m: {}, r: {} };
}
function health() {
  if (!lh) lh = { value: readHealth(), dirty: false };
  return lh.value;
}
function changed() { if (lh) lh.dirty = true; }

/** Keeps the last `max` keys of `obj` (insertion order: the oldest change goes first). */
function capMap(obj, max) {
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length - max; i++) delete obj[keys[i]];
}

/** One source's numbers here: `{ at, ms, n, ok, f, fn }` (stamps through `saneAt`; zeros when it has none). */
export function sourceStats(src) {
  const e = health().s[src] || {};
  return {
    at: saneAt(e.at), ms: Math.max(0, Number(e.ms) || 0), n: Math.max(0, Number(e.n) || 0),
    ok: saneAt(e.ok), f: saneAt(e.f), fn: Math.max(0, Number(e.fn) || 0),
  };
}

function putSource(src, e) {
  const s = health().s;
  delete s[src];
  s[src] = { ...e, t: Date.now() };
  capMap(s, SOURCES_MAX);
  changed();
}

/** `e`'s time with one more sample `ms` (the new one weighs 0.4: a source that got slow shows it within two answers). */
function sampled(e, ms) {
  const n = Math.max(0, Number(e.n) || 0);
  const v = Math.max(0, Math.round(Number(ms) || 0));
  return { ms: n ? Math.round(0.6 * (Number(e.ms) || 0) + 0.4 * v) : v, n: Math.min(SAMPLES_MAX, n + 1), at: Date.now() };
}

/** A member of `src` answered (a network member's resolve, a blind member's probe) in `ms`: a success. */
export function noteAnswer(src, ms) {
  const e = health().s[src] || {};
  putSource(src, { ...e, ...sampled(e, ms), ok: Date.now(), fn: 0 });
}

/** A member of `src` was cut by its share after `ms`: a sample of its time (a lower bound), not a failure. */
export function noteSlow(src, ms) {
  const e = health().s[src] || {};
  putSource(src, { ...e, ...sampled(e, ms) });
}

/** A member of `src` failed: its connector threw or answered no stream, or (a blind source) its playlist is dead. */
export function noteFailure(src) {
  const e = health().s[src] || {};
  putSource(src, { ...e, f: Date.now(), fn: Math.max(0, Number(e.fn) || 0) + 1 });
}

function memberEntry(member) { return health().m[hk(member)] || null; }

function putMember(member, e) {
  const m = health().m;
  const k = hk(member);
  delete m[k];
  m[k] = { ...e, t: Date.now() };
  capMap(m, MEMBERS_MAX);
  changed();
}

/**
 * Demotes one member (its `L:` ref) for `ms` (at most 1 h): it is tried after every other member until then, also by
 * a later runtime once written. Its last probe that answered is forgotten.
 */
export function demote(member, ms) {
  const now = Date.now();
  putMember(member, { ...(memberEntry(member) || {}), ok: 0, d: now, u: now + Math.max(0, Math.min(MAX_DEMOTE_MS, Number(ms) || 0)) });
}

/** When one member was demoted (epoch ms), or 0 when it is not (or its demotion is over). */
export function demotedAt(member) {
  const e = memberEntry(member);
  const d = e ? saneAt(e.d) : 0;
  if (!d) return 0;
  return Date.now() < Math.min(Number(e.u) || 0, d + MAX_DEMOTE_MS) ? d : 0;
}

/** Notes that one member's playlist answered a probe now. */
export function noteProbeOk(member) {
  putMember(member, { ...(memberEntry(member) || {}), ok: Date.now() });
}

/** When one member's playlist last answered a probe (epoch ms, at most PROBE_OK_KEEP_MS ago), else 0. */
export function probeOkAt(member) {
  const e = memberEntry(member);
  const ok = e ? saneAt(e.ok) : 0;
  return ok && Date.now() - ok < PROBE_OK_KEEP_MS ? ok : 0;
}

// Streams (host + path) whose playlist answered a probe with a redirect (Xtream panels: supertv's line.* answer 302 to
// http://<ip>). A probe is never followed past a redirect, so there it can only say "can't tell": not asked again for
// REDIRECT_KEEP_MS (a panel's redirect is how it serves, not a moment's state).

/** Notes that a probe in `scope` answered with a redirect. */
export function noteRedirectingScope(scope) {
  if (!scope) return;
  const r = health().r;
  const k = hk(scope);
  delete r[k];
  r[k] = Date.now();
  capMap(r, REDIRECTS_MAX);
  changed();
}

/** Whether a probe in `scope` answered with a redirect less than REDIRECT_KEEP_MS ago. */
export function isRedirectingScope(scope) {
  if (!scope) return false;
  const at = saneAt(health().r[hk(scope)]);
  return !!at && Date.now() - at < REDIRECT_KEEP_MS;
}

/** Drops what says nothing any more: old source numbers, members with neither a recent probe nor a demotion, old redirects. */
function pruneHealth(h, now) {
  for (const id of Object.keys(h.s)) if (now - saneAt(h.s[id] && h.s[id].t, now) > SOURCE_KEEP_MS) delete h.s[id];
  for (const id of Object.keys(h.m)) {
    const e = h.m[id] || {};
    const ok = saneAt(e.ok, now), d = saneAt(e.d, now);
    const until = d ? Math.min(Number(e.u) || 0, d + MAX_DEMOTE_MS) : 0;
    if (!(ok && now - ok < PROBE_OK_KEEP_MS) && !(until > now)) delete h.m[id];
  }
  for (const id of Object.keys(h.r)) {
    const at = saneAt(h.r[id], now);
    if (!at || now - at >= REDIRECT_KEEP_MS) delete h.r[id];
  }
  capMap(h.s, SOURCES_MAX);
  capMap(h.m, MEMBERS_MAX);
  capMap(h.r, REDIRECTS_MAX);
}

/** Writes the live health when it changed: merged with the stored copy (per entry the later change wins), pruned. */
function writeHealth() {
  if (!lh || !lh.dirty) return;
  const now = Date.now();
  const stored = readHealth();
  const mine = lh.value;
  for (const kind of ["s", "m"]) {
    for (const id of Object.keys(mine[kind])) {
      const a = mine[kind][id], b = stored[kind][id];
      if (!isMap(b) || saneAt(b.t, now) <= saneAt(a && a.t, now)) stored[kind][id] = a;
    }
  }
  for (const id of Object.keys(mine.r)) stored.r[id] = Math.max(saneAt(stored.r[id], now), saneAt(mine.r[id], now));
  pruneHealth(stored, now);
  setJson(LH_KEY, stored, { ttlMs: LH_TTL_MS });
  lh.value = stored;
  lh.dirty = false;
}

// ── connectors' small documents, written behind ──

const docs = new Map();   // key → { value, dirty, ttlMs }

/**
 * A connector's small JSON document (an object, e.g. src/sources/tvenvivo.js's player pages): read from storage once
 * per runtime and kept in its memory. A change goes through `saveDoc` and is written behind like the rest (`flushMeta`),
 * never inside a resolve's answer.
 */
export function doc(key) {
  let d = docs.get(key);
  if (!d) {
    const v = getJson(key);
    d = { value: isMap(v) ? v : {}, dirty: false, ttlMs: 0 };
    docs.set(key, d);
  }
  return d.value;
}

/** Marks `doc(key)` changed: it is written (with storage `ttlMs`) by the next flush; an empty one is removed. */
export function saveDoc(key, ttlMs) {
  const d = docs.get(key);
  if (!d) return;
  d.dirty = true;
  d.ttlMs = Number(ttlMs) > 0 ? Number(ttlMs) : 0;
}

function writeDocs() {
  for (const [key, d] of docs) {
    if (!d.dirty) continue;
    if (Object.keys(d.value).length) setJson(key, d.value, d.ttlMs ? { ttlMs: d.ttlMs } : undefined);
    else remove(key);
    d.dirty = false;
  }
}

// ── Kino's listings (runtime memory only) ──

const firstPages = new Map();   // exposed category id → when this runtime last answered its non-empty first page

/** When this runtime last answered a non-empty first page of `categoryId` to Kino (0 = not in this runtime). */
export function firstPageAt(categoryId) { return firstPages.get(categoryId) || 0; }

/** Notes that Kino got a non-empty first page of `categoryId` now (it keeps that listing 1 h). */
export function markFirstPage(categoryId) { firstPages.set(categoryId, Date.now()); }

/**
 * Test helper: forget L0, the per-call caches and whatever was not written yet (a cold runtime: one Kino discarded
 * before a call that writes).
 */
export function _resetMemory() {
  L0.clear();
  l0Chars = 0;
  regCache = null;
  metaCache = null;
  firstPages.clear();
  dropped.clear();
  resolves.clear();
  lastKey = null;
  lh = null;
  docs.clear();
  pendingTexts.clear();
  deferSeq = -1;
}

/** Test helper: L0 size in characters and entries. */
export function _l0Stats() { return { chars: l0Chars, entries: L0.size }; }
