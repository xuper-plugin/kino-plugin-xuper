// live.js — live TV: Kino's native En vivo (`liveCategories` / `liveChannels`), the own screen's Vivo and
// Fútbol ▸ Canales tabs, and the live branch of `resolve`. Every source (src/sources/*.js) is a connector; this
// module stores what they answer (src/liveStore.js) and serves it back without the network.
//
// Categories
//   - Code sources (`codeCategories: true`: their `categories()` never makes a request) answer from code: 0 requests,
//     even on the first install.
//   - Network sources answer from the stored registry (o2:lc) while it is within its max-stale: 0 requests. They are
//     refreshed as a SIDE EFFECT whenever one of their lists is fetched (and the connector may set them itself from
//     the same response, `ctx.setCats`).
//   - A network source with nothing stored (first install, or unused past max-stale) is fetched inline, once per call,
//     only by `liveCategories` and the screen's one-shot `lcFill` tick: at most 5 requests in flight, each with
//     timeoutMs = clamp(deadline − now, 1000, 4000), nothing started after a 12 s deadline, and each source's
//     categories stored as soon as that source completes (src/liveGate.js). An empty answer is asked again after the
//     10 min backoff instead of counting as authoritative until max-stale.
//   - Every raw category goes through ONE mapping (src/liveMap.js `mapCategories`): a small set of virtual categories
//     (by country, theme, brand; live events merged; supertv's "┃CC┃" prefixes by country), unknown titles passing
//     through as their own category (their 1.0.45 id) while the budget allows, else a per-source "Más canales" bucket,
//     ≤ 90 in all, Adults last. Nothing is dropped. `entryOf(id)` is its inverse; an old `<src>.<hex>` id still answers.
// Lists
//   - `liveChannels({categoryId, cursor})` reads every member's list (code, L0, L1), loads the missing and stale ones
//     under a per-call plan (≤ 24 fetch units, ≤ 6 for xuper; a source whose one response stores all its lists is one
//     unit), composes them (src/liveMerge.js: the same channel in several sources shown once, its ref listing every
//     member) and pages them by 500 with the cursor `<h8>:<offset>`. Cursor pages never fetch (a page boundary must not
//     move). Kino keeps a listing 1 h, so a second first-page call of a category inside one runtime is its "Recargar".
//   - Kino's first page of a merged category loads its missing lists with their connectors' timeouts (and, the same
//     way, what would be lost before Kino's next listing: a list whose stored text would vanish, or one list of a
//     source whose categories would pass their max-stale), then refreshes the stale ones, stalest first, one list per
//     place from its first request to its last, only until `KINO_REFRESH_SOFT_MS` after the call started; the rest are
//     served stale (a list cut short by that budget is not a failure; a list past its max-stale is overdue, still
//     served, src/liveStore.js). "Eventos en vivo" has ~21 lists. Its "Recargar" has no such budget: every list
//     checked over 10 min ago refreshes, under the call's deadline.
//   - Live events: the same event in several sources (or several copies of one with the same start) is one channel
//     (src/liveMerge.js); an event that is over by its stored times (all its copies') is not listed.
//   - The screen's ticks refresh under their own short bounds (`TICK_BOUNDS`, `TICK_LOAD_BOUNDS`, `PICK_BOUNDS`): Kino
//     never preempts a running tick, so a long one would hold every tap behind it.
// Resolve
//   - `resolveLive(ref, siblings)`: a merged channel plays its first member that opens (a member needing DRM, which the
//     manifest does not declare, is skipped; a member that answers with no request is probed when others remain), and
//     lists the others as lazy `alternatives`. Kino 0.9.87 ignores a live stream's alternatives and re-resolves a cut
//     channel with the same ref and no options, telling a reopen from a fresh open in no way. So a channel resolved
//     again within 90 s re-checks the member it served (its playlist probed: a dead one is demoted for 10 min and the
//     next member plays), and a second re-resolve in a row (Kino's chain of reopens) demotes it outright. A refusal
//     refuses that member only; two on one account pass the account over; supertv's other panels are failover, after
//     the primary's copies (`playCandidates`).
//   - What resolves learn is kept on the device (src/liveStore.js o2:lh: each source's time to answer and failures in a
//     row, each member's demotion and last probe that answered) and orders the members on evidence only; a copy that
//     needs no request shortens a scraper's turn to SCRAPER_SHARE_MS; a playlist that answered a probe within 5 min is
//     not probed again. A resolve writes nothing before its answer: the next live call that is not one does.
//   - supertv's other panels (secondary sources) get their accounts in the screen's lcFill tick and, lean, after Kino's
//     first page of a category they feed when that page already went to the network (`searchSecondaries`).
// Identity: raw category ids `<src>.<hex(raw id)>`, channel ids `<src>_<hashId(raw id or key)>`, refs `L:<src>:<raw id>`
// exactly as 1.0.43 built them; a merged channel is its primary member's channel with an `M:` ref.
// No Bearer: `liveCategories` and `liveChannels` answer [] (what 1.0.43 answers), also when the backend refused the
// Bearer during the call (a 401 drops it). With a Bearer, `liveChannels` throws only when every list failed and nothing
// is stored (Kino then keeps the rows it has).
import { currentBearer } from "./api.js";
import { liveRef, decodeRef } from "./refs.js";
import { SOURCES as ALL_SOURCES } from "./sources/index.js";
import { isFootball } from "./sources/sports.js";
import { once, callStartedAt, callSeq } from "./flight.js";
import { liveFetch, tighten, timeoutFor, deadline, remaining, within, inStrictBudget, startedInCall, MIN_TIMEOUT_MS, MAX_IN_FLIGHT, MAX_PER_HOST } from "./liveGate.js";
import * as ls from "./liveStore.js";
import { getText } from "./store.js";
import { bodyText } from "./net.js";
import { KEYS as DATA_KEYS, parseIndex } from "./data.js";
import { lang, DRM_DECLARED } from "./config.js";
/** Whether Kino takes a `drm` stream from this plugin (kino-plugin.json declares `drm`): DRM_DECLARED; tests flip it. */
let drmDeclared = DRM_DECLARED;
/** Test hook, like `_setSources`: `_setDrmDeclared(false)` runs the "not declared" fallbacks; no argument restores the manifest's. */
export function _setDrmDeclared(v) { drmDeclared = v === undefined ? DRM_DECLARED : !!v; }
import { mapCategories, hexEnc, isVirtualId } from "./liveMap.js";
import { composeMerged, memberLabel } from "./liveMerge.js";

const M = 60 * 1000, H = 60 * M, D = 24 * H;
export const PAGE_SIZE = 500;
export const FIRST_FILL = { deadlineMs: 12000, maxTimeoutMs: 4000 };   // liveCategories (Kino gives it 20 s)
export const SCREEN_FILL = { deadlineMs: 4000, maxTimeoutMs: 4000 };   // the screen's lcFill tick: one source per tick
export const TICK_BOUNDS = { deadlineMs: 3000, maxTimeoutMs: 3000 };   // the lvRefresh tick refreshing a stale list
export const TICK_LOAD_BOUNDS = { deadlineMs: 6000, maxTimeoutMs: 4000 };   // the lvRefresh tick loading missing lists
export const PICK_BOUNDS = { deadlineMs: 8000, maxTimeoutMs: 4000 };   // a pick or "Recargar" with nothing stored
const KINO_RELIST_MS = 55 * M;   // Kino keeps a non-empty listing 1 h: a first-page call again inside it is "Recargar"
const NEXT_LISTING_MS = H;       // … so it lists a category again about an hour later at the earliest
// Kino's first page of a merged category whose lists are stored: the stale ones refresh, stalest first, only until
// this long after the call started (nothing started then ends past it); the rest are served stale. "Eventos en vivo"
// has ~21 member lists: refreshing them all took 7.9 s on the Redmi.
export const KINO_REFRESH_SOFT_MS = 2500;
// A live event is not listed once over (src/liveMerge.js): a composed events page is recomposed at least this often.
const EVENT_BUCKET_MS = 10 * M;
const HLS = "application/vnd.apple.mpegurl";
/** Whether a connector's answer is a stream: it carries a `url`. */
const isStream = (out) => !!out && !!out.url;

// The fetch plan of one call (a merged category has tens of members: Kino allows 60 requests per call and xuper's
// portal paces its calls 400 ms apart).
const PLAN_MAX_UNITS = 24;
const PLAN_MAX_XUPER = 6;
const FORCE_MIN_AGE_MS = 10 * M;   // a forced refresh of a merged category skips members checked this recently
// A failure that is this call's own limit, not the source failing: never a list backoff. So is a timeout that this
// call's bounds made shorter than the request asked for (src/liveGate.js marks it `limited`).
const NOT_A_FAILURE = new Set(["deadline", "budget", "invalid_request"]);
const ownLimit = (e) => !!e && (NOT_A_FAILURE.has(e.code) || e.limited === true);
// v.events: the Spanish agendas first, supertv's numbered placeholders last.
const EVENTS_ORDER = ["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv", "xuper"];

// Resolve of a merged channel (Kino cuts a resolve at 20 s; the gate's deadline stays at start + 16 s).
// Kino reopens a cut channel 2, 4 and 8 s after the cut, then quietly every 30 s; a player can take ~20 s to report a
// cut (a frozen playlist), and the zapping preheat resolves the neighbours between the open and the first reopen.
const REOPEN_WINDOW_MS = 90_000;
const REOPEN_MIN_GAP_MS = 1_500;     // a back-to-back preheat of a 2-channel list is not a cut
const DEMOTE_MS = 10 * M;
const MEMBER_FIRST_MS = 10_000;      // the first member that needs the network
const MEMBER_NEXT_MS = 5_000;
// A member that needs the network while a primary copy that needs none waits after it (supertv, premiumtv: 0 requests,
// it plays at once) gets at most this. Measured 2026-11-17: tvenvivo answers in 0.6–3 s (its player page is ~660 KB), a
// merged Deportes channel took 4.8 s with it first. It replaces the 12 s such a first member got before, when every
// later member answered with no request: exactly when waiting for it costs the most.
const SCRAPER_SHARE_MS = 4_500;
const CUT_SLACK_MS = 250;            // a member that failed this close to a share cut short by SCRAPER_SHARE_MS was cut by it
const MEMBER_MIN_MS = 1_500;          // a member that needs the network never starts with less left
const PROBE_TIMEOUT_MS = 2_500;
const PROBE_MAX = 3;
// A playlist that answered a probe this recently plays unprobed (never the suspect of a re-resolve): one request less
// before the stream, and a copy that died since costs one cut that Kino's reopen corrects (the suspect is probed).
const PROBE_FRESH_MS = 5 * M;
// What the device learned (src/liveStore.js o2:lh) orders a merged channel's members, never one without evidence:
const SOURCE_FAIL_STREAK = 2;        // a source whose last resolves here failed this many times in a row,
const SOURCE_FAIL_MS = 30 * M;       // … the last one this recently, goes after the healthy members (the failing tier)
const SLOW_SOURCE_MS = 1_500;        // a source whose members take this long to answer here (smoothed) is slow,
const SLOW_EVIDENCE_MS = 24 * H;     // … by answers this recent
const READY_MS = 2 * H;              // a blind member whose own playlist answered a probe this recently is ready,
const SOURCE_ALIVE_MS = 30 * M;      // … or whose source's playlists did, none found dead since
// A secondary panel's copy that would pass a member of the others plays only on its own probe's `ok` (an early check,
// outside PROBE_MAX): one per other account, at most this many per resolve (supertv holds 2 other panels). One check
// for all of them would leave a dead primary's next copy to play unprobed while a healthy third panel waits.
const AUDITIONS_MAX = 2;
// Members of one account refused in one resolve that pass the account over: one refused stream says nothing about the
// next (a supertv account refuses one stream with 407 while it plays another), two in a row say the account is the
// problem (over its connections, its line expired).
const ACCOUNT_STRIKES = 2;
const ALTERNATIVES_MAX = 8;
const ALT_REF_MAX = 512;

// Sources whose every channel of a category is a football channel (Fútbol ▸ Canales lists them whole).
export const FOOTBALL_SRC = new Set(["futbollibre", "deportv"]);

// Freshness per source, [fresh, maxStale] in ms (spec §5.1). A connector may override with `catTtl` /
// `listTtl(rawCat)`; `lists` holds per-category overrides.
const POLICY = {
  caracol: { cats: [D, 7 * D], list: [D, 7 * D] },
  cablevisionhd: { cats: [D, 7 * D], list: [D, 7 * D] },
  premiumtv: { cats: [6 * H, 3 * D], list: [6 * H, 3 * D] },
  supertv: { cats: [6 * H, D], list: [6 * H, D] },
  supertv2: { cats: [6 * H, D], list: [6 * H, D] },   // supertv's other panels (src/sources/supertv.js)
  supertv3: { cats: [6 * H, D], list: [6 * H, D] },
  futbollibre: { cats: [D, 7 * D], list: [D, 7 * D], lists: { hoy: [10 * M, 2 * H] } },
  "nuvio-sports": { cats: [D, 7 * D], list: [10 * M, 2 * H] },
  deportv: { cats: [30 * M, 6 * H], list: [30 * M, 6 * H] },
  cncverse: { cats: [6 * H, 3 * D], list: [30 * M, 2 * H] },
  xuper: { cats: [D, 7 * D], list: [D, 7 * D] },
};
const DEFAULT_POLICY = { cats: [D, 7 * D], list: [6 * H, D] };

/** A connector's `channels()` may return this: "not modified upstream", keep the stored list and mark it checked. */
export const UNCHANGED = Object.freeze({ unchanged: true });

let SOURCES = ALL_SOURCES;
/** Test helper: run against other connectors (null = the real ones). */
export function _setSources(list) { SOURCES = list || ALL_SOURCES; expo = null; forgetCompositions(); }
export function sourceById(id) {
  for (const s of SOURCES) if (s.id === id) return s;
  return null;
}
const rankOf = (srcId) => { const i = SOURCES.findIndex((s) => s.id === srcId); return i < 0 ? SOURCES.length : i; };

function log(m) { try { kino.log("live: " + m); } catch (_) { /* no log */ } }
const en = () => lang() === "en";

// ── ids (1.0.43's: favourites and remembered categories depend on them) ──

export function hexDec(h) {
  let a = "";
  const s = String(h || "");
  for (let i = 0; i + 1 < s.length; i += 2) a += String.fromCharCode(parseInt(s.slice(i, i + 2), 16));
  try { return decodeURIComponent(a); } catch (_) { return a; }
}

// id de item VÁLIDO para Kino (itemIdPattern ^[A-Za-z0-9._~-]{1,128}$): el id crudo de un canal (URL/slug con
// ":" o "/") NO sirve como id de grilla → Kino descarta el item. Hasheamos a un token corto y válido; el REF
// (liveRef) sigue llevando el dato real para reproducir.
export function hashId(s) {
  let h = 5381;
  const str = String(s == null ? "" : s);
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** The storage key of one (source, raw category) list, and that raw category's 1.0.45 id: `<src>.<hex(raw id)>`. */
export function listKey(srcId, rawCat) { return `${srcId}.${hexEnc(String(rawCat))}`; }

// ── policies ──

function codeCategories(src) { return !!src && src.codeCategories === true; }
function codeList(src, rawCat) {
  if (!src) return false;
  if (typeof src.codeList === "function") return !!src.codeList(rawCat);
  return src.codeList === true;
}
function pair(p, fallback) {
  return Array.isArray(p) && p[0] > 0 && p[1] >= p[0] ? { fresh: p[0], maxStale: p[1] } : fallback;
}
export function catPolicy(src) {
  const t = src && src.catTtl;
  if (t && t.fresh > 0) return { fresh: t.fresh, maxStale: Math.max(t.fresh, t.maxStale || t.fresh) };
  const p = POLICY[src && src.id] || DEFAULT_POLICY;
  return pair(p.cats, { fresh: D, maxStale: 7 * D });
}
export function listPolicy(src, rawCat) {
  if (codeList(src, rawCat)) return { fresh: Infinity, maxStale: Infinity, code: true };
  if (src && typeof src.listTtl === "function") {
    const s = codeCategories(src) ? null : ls.catsOf(src.id);
    const cat = (s && s.cats.find((c) => c && c.id === String(rawCat))) || null;
    const t = src.listTtl(String(rawCat), cat);   // the stored category (title, adult…) or null
    if (t && t.fresh > 0) return { fresh: t.fresh, maxStale: Math.max(t.fresh, t.maxStale || t.fresh), code: false };
  }
  const p = POLICY[src && src.id] || DEFAULT_POLICY;
  const per = p.lists && p.lists[String(rawCat)];
  return { ...pair(per || p.list, { fresh: 6 * H, maxStale: D }), code: false };
}

// ── the kill switch: the published index's `live.off` (phase 2) ──

/** The sources switched off by the index, and with a primary source its secondary ones (supertv → supertv2, supertv3). */
function offSources() {
  let off;
  try {
    const ix = parseIndex(getText(DATA_KEYS.ix));
    off = new Set((ix && ix.live && Array.isArray(ix.live.off) ? ix.live.off : []).map(String));
  } catch (_) { off = new Set(); }
  for (const s of SOURCES) if (s.secondaryOf && off.has(s.secondaryOf)) off.add(s.id);
  return off;
}
/** Whether a source is in use: a secondary source holding no account (`active()` false) is not (0 requests). */
function inUse(src) {
  if (typeof src.active !== "function") return true;
  try { return src.active() !== false; } catch (_) { return false; }
}
const activeSources = () => { const off = offSources(); return SOURCES.filter((s) => !off.has(s.id) && inUse(s)); };
const lazyMember = (s) => !!(s && s.src && s.src.secondaryOf);

// ── normalizing what connectors answer ──

/**
 * A category title as stored: a plain string, or `{ es, en }` kept whole so a stored title follows a language
 * switch (the mapping picks the language when the category is exposed).
 */
function titleOf(t, id) {
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const es = String(t.es || t.en || "").trim(), enT = String(t.en || t.es || "").trim();
    return es ? { es, en: enT } : id;
  }
  return String(t || id);
}

function normCats(list) {
  const out = [];
  const seen = new Set();
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || c.id == null || String(c.id) === "") continue;
    const id = String(c.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const e = { id, title: titleOf(c.title, id) };
    if (c.adult === true) e.adult = true;
    if (typeof c.genre === "string" && c.genre) e.genre = c.genre;
    out.push(e);
  }
  return out;
}

const stamp = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/**
 * A connector's channels → stored items `{id, title, ref, logo?, adult?, start?, end?, origin?, x?}` (Kino-ready
 * ids/refs, deduped). `start` / `end` (epoch ms) are a live event's times when its source knows them, `origin` the
 * upstream provider inside the source that lists it (nuvio's dlv / ak47…, cncverse's SKTech / PlayFy…): they tell two
 * sessions with the same title apart and one provider's repeats from the same event in two providers
 * (src/liveMerge.js), and hide an event that is over. Kino never sees them.
 */
export function normalizeChannels(srcId, list) {
  const out = [];
  const seen = new Set();
  for (const ch of Array.isArray(list) ? list : []) {
    if (!ch || ch.id == null) continue;
    const id = `${srcId}_${hashId(ch.key != null ? ch.key : ch.id)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = { id, title: String(ch.title || ch.id), ref: liveRef(srcId, ch.id) };
    if (ch.logo) c.logo = String(ch.logo);
    if (ch.adult === true) c.adult = true;
    const start = stamp(ch.start), end = stamp(ch.end);
    if (start) c.start = start;
    if (end && end > start) c.end = end;
    if (typeof ch.origin === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(ch.origin)) c.origin = ch.origin;
    if (ch.x !== undefined) c.x = ch.x;
    out.push(c);
  }
  return out;
}

// ── the connector context ──

/** The context every connector call gets (see S/impl/live-api.md). `opts.verify`: see `verify` below. */
function ctxFor(src, opts) {
  return {
    src: src.id,
    // Whether a connector checks the stream it found before answering (a scraper's off-air GET of its playlist): only
    // for a single member re-resolved right after a cut or demoted for failing (`playAlone`). A first open does not pay
    // that request: the player's own request of the same playlist tells the same, and its 404 starts Kino's reopen.
    // A merged channel never asks: its suspect member's playlist is probed here (`playCandidates`).
    verify: !!(opts && opts.verify),
    fetch: liveFetch,
    timeoutFor,
    deadline,
    remaining,
    once: (key, fn, opts) => once(src.id + ":" + key, fn, opts),
    // How many new candidate accounts a secondary source may probe to find one (src/sources/supertv.js): in the screen's
    // fill of secondary sources alone (see `fillCategories`) and after Kino's first page (`searchSecondaries`), else 0.
    searchProbes: () => (searchAllowance.seq === callSeq() ? searchAllowance.n : 0),
    // Whether that search is lean: candidate probes only (no probe of the primary to learn its panel, no bootstrap).
    searchLean: () => searchAllowance.seq === callSeq() && !!searchAllowance.lean,
    UNCHANGED,
    setCats: (cats) => storeCats(src, cats),
    // `{ partial: true }`: the channels so far of a listing cut by the call's limits, stored stale so the next tick or
    // call refreshes (goes on with) it while the screen shows them.
    putList: (rawCat, channels, opts) => storeList(src, rawCat, channels, opts),
    storedList: (rawCat) => { const l = ls.getList(listKey(src.id, rawCat)); return l ? l.items : null; },
    listMeta: (rawCat) => { const m = ls.listMeta(listKey(src.id, rawCat)); return m && m.h ? { at: m.at, n: m.n } : null; },
    touchAll: () => { for (const k of ls.listKeysOf(src.id)) touchStored(src, k, hexDec(k.slice(src.id.length + 1))); },
    findChannel: (rawId) => findChannel(src, rawId),
    // A small JSON object of the connector's own under storage key `key` (src/sources/tvenvivo.js's player pages): read
    // once per runtime and kept in memory; after changing it, `saveMemo` writes it behind (src/liveStore.js `doc`), so a
    // resolve never pays for that write before its answer.
    memo: (key) => ls.doc(key),
    saveMemo: (key, ttlMs) => ls.saveDoc(key, ttlMs),
    dropLists: () => ls.dropLists(src.id),
    relist: (rawCat, opts) => relist(src, String(rawCat), !!(opts && opts.force)),
    rawIdOf: (item) => { const r = decodeRef(item && item.ref); return r.kind === "live" && !r.members ? r.channel : null; },
    log: (m) => log(src.id + ": " + m),
  };
}

/** Marks one stored list checked (304 / "not modified"), renewing its storage TTL when due. */
function touchStored(src, key, rawCat) {
  const pol = listPolicy(src, rawCat);
  return pol.code ? false : ls.touchList(key, { maxStaleMs: pol.maxStale });
}

function storeCats(src, cats) {
  return ls.setCats(src.id, normCats(cats));
}

function storeList(src, rawCat, channels, opts) {
  const pol = listPolicy(src, rawCat);
  const items = normalizeChannels(src.id, channels);
  if (pol.code) return { items, h: codeHash(items), at: Date.now(), changed: false };
  const partial = !!(opts && opts.partial);
  return ls.putList(listKey(src.id, rawCat), items, { maxStaleMs: pol.maxStale, ...(partial ? { partial, freshMs: pol.fresh } : {}) });
}

const codeHash = (items) => "c" + hashId(items.map((c) => c.id).join(","));

/** A stored channel of `src` by its raw id: `{ ...item, cat }` (with its private `x`), or null. */
function findChannel(src, rawId) {
  const ref = liveRef(src.id, rawId);
  for (const key of ls.listKeysOf(src.id)) {
    const l = ls.getList(key);
    const hit = l && l.items.find((c) => c && c.ref === ref);
    if (hit) return { ...hit, cat: hexDec(key.slice(src.id.length + 1)) };
  }
  return null;
}

/** `ctx.relist`: one list fetched now (forced: in this call) and stored → its items. */
async function relist(src, rawCat, force) {
  const s = memberState({ src: src.id, rawCat }, Date.now());
  if (s.code) return (await codeItems(s)).items;
  const l = await loadMember(s, force);
  if (l.error) throw l.error;
  return l.items;
}

// ── categories ──

/** An error for the log: its code and, when it says more, its message (a portal's own text: `portal200001 (版本已停止使用)`). */
function why(e) {
  const code = e && e.code != null ? String(e.code) : "";
  const msg = e && e.message != null ? String(e.message).slice(0, 160) : "";
  if (code && msg && msg !== code) return code + " (" + msg + ")";
  return code || msg || String(e);
}

/**
 * A source's categories (fetched now) — single-flighted per call, stored as soon as they arrive. `rideAlong`: fetched
 * beside one of its lists, not because nothing is stored: then a request this call's own bounds cut short (its
 * deadline, its refresh budget, a timeout they made shorter) is not the source failing, as for a list. A first-ever
 * fetch keeps its backoff for those too: its bounds are the 4 s a source gets there, and the next tick moves on.
 */
function fetchCats(src, rideAlong) {
  return once("src:" + src.id + ":cats", async () => {
    try {
      const cats = await src.categories(ctxFor(src));
      if (!Array.isArray(cats)) throw new Error("categories() did not answer a list");
      storeCats(src, cats);
      return cats;
    } catch (e) {
      if (rideAlong && (ownLimit(e) || remaining() < MIN_TIMEOUT_MS)) {
        log(src.id + ": categories cut short by this call's bounds (" + why(e) + "); the stored ones stay");
        throw e;
      }
      const wait = ls.failCats(src.id);
      log(src.id + ": categories failed: " + why(e) + "; next try in " + Math.round(wait / 60000) + " min");
      throw e;
    }
  });
}

/**
 * One source's raw categories without the network: code, else the stored registry within its max-stale, else null.
 * → `{ cats, stale }` | null.
 */
async function knownCats(src, now) {
  if (codeCategories(src)) {
    try { return { cats: normCats(await src.categories(ctxFor(src))), stale: false }; }
    catch (e) { log(src.id + ": code categories failed: " + ((e && e.message) || e)); return null; }
  }
  const s = ls.catsOf(src.id);
  if (!s) return null;
  const pol = catPolicy(src);
  const age = now - s.at;
  if (age >= pol.maxStale) return null;
  // An empty answer (a portal hiccup, a server with nothing usable) is not authoritative until max-stale: it is
  // asked again once the failure backoff has passed (every 10 min at most), like a source never listed.
  if (!s.cats.length && age >= ls.FAIL_BACKOFF_MS) return null;
  return { cats: s.cats, stale: age >= pol.fresh };
}

/**
 * Network sources with nothing usable stored and not inside their failure backoff; a secondary source holding no
 * account counts as missing (its `categories()` looks for one).
 */
async function missingSources(now) {
  const out = [];
  const off = offSources();
  for (const src of SOURCES) {
    if (off.has(src.id) || codeCategories(src)) continue;
    if (inUse(src) && (await knownCats(src, now))) continue;
    if (ls.catsInBackoff(src.id, now)) continue;
    out.push(src);
  }
  return out;
}

// New candidate probes a secondary source may make in this call (`ctx.searchProbes()`): set by `fillCategories`. At most
// the gate's places, so the whole batch is in flight at once and no probe's timeout is cut short by waiting for one.
const SEARCH_PROBES = MAX_IN_FLIGHT;
let searchAllowance = { seq: -1, n: 0, lean: false };

/**
 * Fetches the categories of network sources with nothing stored, under `bounds` (≤ 5 requests in flight, timeoutMs
 * clamp(deadline − now, 1000, maxTimeoutMs), no request after the deadline). Each source is stored as it completes.
 * `max`: at most this many FAMILIES (a primary source with its secondary ones: they fill in one call, so the secondary
 * ones look among the accounts the primary's pick probed, for free; SOURCES order; sources in their failure backoff are
 * never picked). `opts.search`: a secondary source missing on its own may look for an account with new probes (the
 * screen's lcFill tick). Without it (Kino's liveCategories) a secondary source fills only beside its primary: nothing it
 * adds is a category of its own (src/liveMap.js), so En vivo never waits for its search.
 * → `{ n: sources that got categories, left: sources still missing after this step }`.
 */
export async function fillCategories(bounds, max, opts) {
  const b = bounds || FIRST_FILL;
  const all = await missingSources(Date.now());
  const search = !!(opts && opts.search);
  const family = (s) => s.secondaryOf || s.id;
  const missing = search ? all : all.filter((s) => !s.secondaryOf || all.some((p) => p.id === s.secondaryOf));
  const families = [...new Set(missing.map(family))];
  const take = max > 0 ? new Set(families.slice(0, max)) : null;
  const todo = take ? missing.filter((s) => take.has(family(s))) : missing;
  if (!todo.length) return { n: 0, left: all.length };
  // New probes only when no other source's first categories wait on the same places and deadline (a first install uses
  // what the primary's own pick already probed).
  const secondaryOnly = todo.every((s) => s.secondaryOf);
  tighten({ deadline: callStartedAt() + b.deadlineMs, maxTimeoutMs: b.maxTimeoutMs });
  searchAllowance = { seq: callSeq(), n: search && secondaryOnly ? SEARCH_PROBES : 0, lean: false };
  const done = await Promise.all(todo.map((src) => fetchCats(src).then(() => 1, () => 0)));
  const n = done.reduce((a, x) => a + x, 0);
  log("first-ever categories: " + n + " of " + todo.length + " sources" + (todo.length < all.length ? " (" + (all.length - todo.length) + " left)" : ""));
  return { n, left: all.length - todo.length };
}

// Kino's own path to the secondary panels: someone who never opens the own screen (whose lcFill tick searches them)
// gets them after a first page that already went to the network.
const KINO_SEARCH_AFTER_MS = 4000;   // … only when that page took at most this long (its own work near its 2.5 s budget)
const KINO_SEARCH_MS = 3500;         // one batch of candidate probes with their whole 3 s timeout; nothing starts after

/**
 * After Kino's first page of a category fed by a primary source with secondary ones (supertv's other panels): those
 * secondary sources with no account (or no categories) and outside their failure backoff fill now, lean
 * (`ctx.searchLean()`: what is stored or already probed in this call — the primary's 6 h account re-check usually ran in
 * this very page —, plus one batch of ≤ 5 candidate probes; never a probe of the primary, never the bootstrap), under
 * `KINO_SEARCH_MS` (strict). Only when the page already made requests (stale or missing lists): a stored-and-fresh page
 * still makes 0, and the secondary sources' own search backoff (1 h, 3 h, 6 h) keeps the rest at 0 requests. `idle`: the
 * secondary sources that held no account when the call began.
 */
async function searchSecondaries(members, idle) {
  if (startedInCall() === 0 || Date.now() - callStartedAt() > KINO_SEARCH_AFTER_MS) return;
  const fams = new Set((members || []).map((m) => m.src).filter((id) => SOURCES.some((s) => s.secondaryOf === id)));
  if (!fams.size) return;
  // one released during this page (its account refused) waits for the next page or the screen's tick: this call
  // already paid for that refusal
  const todo = (await missingSources(Date.now())).filter((s) => fams.has(s.secondaryOf) && (inUse(s) || idle.has(s.id)));
  if (!todo.length) return;
  searchAllowance = { seq: callSeq(), n: SEARCH_PROBES, lean: true };
  try {
    const done = await within(KINO_SEARCH_MS, () => Promise.all(todo.map((src) => fetchCats(src).then(() => 1, () => 0))), { strict: true });
    log("secondary sources after Kino's first page: " + done.reduce((a, x) => a + x, 0) + " of " + todo.length + " got categories");
  } finally {
    searchAllowance = { seq: -1, n: 0, lean: false };
  }
}

// ── the exposed categories (src/liveMap.js), once per call ──

let expo = null;          // { seq, reg, lang, value }
let lastMapLog = "";

/**
 * Whether one raw category's stored list is known to be empty (meta only) while that answer is fresh. Past it, the
 * category is exposed again: nothing else would ever refresh a hidden one (Kino lists only exposed categories, the
 * screen's dropdown too), and its first page checks it again.
 */
function knownEmpty(srcId, rawCat) {
  const src = sourceById(srcId);
  if (!src) return false;
  const pol = listPolicy(src, rawCat);
  if (pol.code) return false;
  const m = ls.listMeta(listKey(srcId, rawCat));
  return !!m && !!m.h && m.n === 0 && Date.now() - m.at < pol.fresh;
}

/** The exposed categories of this call: `{ list, all, byRaw, stats }` (src/liveMap.js), from code and the registry. */
async function exposure() {
  const seq = callSeq(), reg = ls.registry(), L = lang();
  if (expo && expo.seq === seq && expo.reg === reg && expo.lang === L) return expo.value;
  const now = Date.now();
  const raw = [];
  for (const src of activeSources()) {
    const k = await knownCats(src, now);
    if (!k) continue;
    for (const cat of k.cats) raw.push({ src: src.id, cat });
  }
  const value = mapCategories(raw, {
    srcName: (id) => { const s = sourceById(id); return (s && s.name) || id; },
    secondaryOf: (id) => { const s = sourceById(id); return (s && s.secondaryOf) || null; },
    knownEmpty,
    codeBacked: (srcId, rawCat) => { const s = sourceById(srcId); return !!s && listPolicy(s, rawCat).code; },
  });
  const st = value.stats;
  const line = "categories: " + st.exposed + " exposed (" + st.virtual + " virtual, " + st.passed + " passed" +
    (st.buckets.length ? ", buckets " + st.buckets.join(", ") : "") + ") from " + raw.length + " raw";
  if (line !== lastMapLog) log(line);   // once per change, not on every screen draw
  lastMapLog = line;
  expo = { seq, reg, lang: L, value };
  return value;
}

/**
 * An exposed category id → its entry `{ id, title, kind, merge, cc, src, members, adult?, … }`, or null. An old
 * `<src>.<hex>` id that is no longer exposed (its raw category went into a virtual one) still answers with that one
 * member, unmerged, as 1.0.45 listed it.
 */
async function entryOf(categoryId) {
  const id = String(categoryId || "");
  const ex = await exposure();
  const e = ex.all.get(id);
  if (e) return e;
  if (isVirtualId(id)) return null;
  const i = id.indexOf(".");
  if (i <= 0) return null;
  const src = id.slice(0, i);
  return { id, title: "", kind: "old", merge: false, cc: null, src, members: [{ src, rawCat: hexDec(id.slice(i + 1)) }] };
}

/**
 * The exposed category a remembered id lands on: itself while it is exposed, else (an old `<src>.<hex>` id) the
 * category its raw category went into, else "".
 */
export async function exposedIdOf(categoryId) {
  const id = String(categoryId || "");
  const ex = await exposure();
  const e = ex.all.get(id);
  if (e) return e.hidden ? "" : id;
  const i = id.indexOf(".");
  if (i <= 0 || isVirtualId(id)) return "";
  const to = ex.byRaw.get(id.slice(0, i) + "\u0001" + hexDec(id.slice(i + 1)));
  const t = to && ex.all.get(to);
  return t && !t.hidden ? to : "";
}

/**
 * Every exposed category (no network unless `fill`): `[{ id, title, kind, adult?, genre?, country?, src, members }]`,
 * at most 90. With `fill`, network sources with nothing stored are fetched first under `fill`'s bounds.
 */
export async function categoryList(opts) {
  const o = opts || {};
  if (o.fill) await fillCategories(o.fill === true ? FIRST_FILL : o.fill);
  return (await exposure()).list;
}

/** Kino's `liveCategories`: `[{ id, title, adult?, genre?, country? }]`; [] without a Bearer (as 1.0.43). */
export async function liveCategories() {
  if (!(await currentBearer())) return [];
  try {
    const list = await categoryList({ fill: FIRST_FILL });
    return list.map((c) => {
      const k = { id: c.id, title: c.title };
      if (c.adult) k.adult = true;
      if (c.genre) k.genre = c.genre;
      if (c.country) k.country = c.country;
      return k;
    });
  } finally {
    ls.flushMeta();
  }
}

/**
 * Fútbol ▸ Canales: the sports and live-event categories (not "Otros deportes": basketball, F1, tennis…), plus a
 * category passed through from a football source or with a football title.
 */
export function footballOf(list) {
  return list.filter((c) => c.kind === "sports" || c.kind === "events" ||
    ((c.kind === "pass" || c.kind === "old") && (FOOTBALL_SRC.has(c.src) || isFootball(c.title))));
}

// ── lists ──

/** One member's state without the network. */
function memberState(m, now) {
  const src = sourceById(m.src);
  const pol = listPolicy(src, m.rawCat);
  if (pol.code) return { m, src, pol, code: true };
  const key = listKey(src.id, m.rawCat);
  const stored = ls.getList(key);
  const meta = ls.listMeta(key);
  return { m, src, pol, key, code: false, stored, meta, age: stored ? now - stored.at : Infinity, backoff: ls.inBackoff(meta && meta.failAt, now) };
}

async function codeItems(s) {
  const items = normalizeChannels(s.src.id, await s.src.channels(s.m.rawCat, ctxFor(s.src)));
  return { items, h: codeHash(items), at: Date.now(), stale: false };
}

/** Fetches one member now: `{ items, h, at, stale }`, the stored list on failure, or `{ error }`. */
async function loadMember(s, force) {
  try {
    return { ...(await fetchList(s.src, s.m.rawCat, force)), stale: false, fetched: true };
  } catch (e) {
    const why = (e && (e.code || e.message)) || e;
    // A list this call's own budget cut short is served as stored and is not the source failing (no backoff).
    const cut = ownLimit(e) || remaining() < MIN_TIMEOUT_MS;
    // A connector that kept the channels so far of a cut listing (`e.partial`) stored them as a stale list: served now.
    const part = e && e.partial ? ls.getList(s.key) : null;
    const kept = part ? ", " + part.items.length + " channels so far kept" : s.stored ? ", served as stored" : ", nothing stored yet";
    log(s.key + (cut ? ": cut by this call's budget (" + why + ")" + kept : ": list failed: " + why + (part ? kept : "")));
    if (part) return { ...part, stale: true };
    if (s.stored) return { ...s.stored, stale: true };
    return { error: e };
  }
}

/** Fetches one list now (single-flighted per call), stores it, then refreshes the source's categories if due. */
function fetchList(src, rawCat, force) {
  const key = listKey(src.id, rawCat);
  return once("src:" + src.id + ":list:" + key, async () => {
    let res;
    try {
      const out = await src.channels(rawCat, ctxFor(src));
      if (out === UNCHANGED) {
        const cur = ls.getList(key);
        if (!cur) throw new Error("not modified, but nothing is stored");
        touchStored(src, key, rawCat);
        res = { items: cur.items, h: cur.h, at: Date.now() };
      } else {
        res = storeList(src, rawCat, out);
      }
    } catch (e) {
      // The call's own limits (its deadline, its request budget, Kino's 60 requests, a timeout it cut short) are not
      // the source failing; nor is a connector giving up because the call (or its refresh budget) has no time left for
      // its next request (futbollibre's agenda chain throws its own error then).
      if (!ownLimit(e) && remaining() >= MIN_TIMEOUT_MS) ls.failList(key);
      throw e;
    }
    // Categories ride along: a network source whose categories are past fresh refreshes them in this same call
    // (a connector that set them from this very response made them fresh already). Not with under a second left of
    // the call's deadline: the fetch could not start. Inside Kino's first-page refresh budget only once they are
    // half-way from fresh to max-stale: there they would take a place and the budget from the stale lists (and every
    // merged first page of Kino's runs under that budget, so they must still refresh before max-stale drops them).
    if (!codeCategories(src) && remaining() > 1000) {
      const s = ls.catsOf(src.id);
      const now = Date.now();
      const pol = catPolicy(src);
      const age = s ? now - s.at : Infinity;
      const due = age >= (inStrictBudget() ? pol.fresh + (pol.maxStale - pol.fresh) / 2 : pol.fresh);
      if (due && !ls.catsInBackoff(src.id, now)) {
        try { await fetchCats(src, true); } catch (_) { /* logged; the stored ones stay */ }
      }
    }
    return res;
  }, force ? { force: true } : undefined);
}

/**
 * Which members load in this call (indices into `st`, in the order they should start). One member (an old id, a
 * pass-through category): exactly 1.0.45's rule. Several: missing lists first, with the stored ones in `must` (see
 * `mustRefresh`; a source whose one response stores all its lists counts once and fetches once), then stale ones on a
 * first page and — on a forced refresh — those checked more than 10 min ago, stalest first (the most of their max-stale
 * used: a list past it is overdue, and one left unchecked for two more is dropped and would then load in full,
 * src/liveStore.js; live events, kept 2–6 h, come before channel lists, kept days); at most PLAN_MAX_UNITS units,
 * PLAN_MAX_XUPER for xuper (the gate's 50 requests per call and ≤ 5 in flight bound the rest). Members in their failure
 * backoff wait, unless forced. A secondary source's lists (supertv's other panels: failover, not content of their own)
 * come after every other one: tiers 0 missing, 1 stale, 2 missing secondary, 3 stale secondary.
 */
function planFetch(st, o, must) {
  const out = new Set();
  const multi = st.length > 1;
  if (o.offline) return out;
  if (o.noFetch && st.some((s) => s.code || s.stored)) return out;   // a cursor page: compose what there is
  if (!multi) {
    const s = st[0];
    if (s && !s.code && (o.force || !s.stored || (o.refresh && (s.age >= s.pol.fresh || !!o.kinoForce) && !s.backoff))) out.add(0);
    return out;
  }
  const wants = [];
  // A source whose one response stores all its lists, failing recently: none of its lists is asked until its backoff ends.
  const sharedDown = new Set(st.filter((s) => !s.code && s.src.sharedFetch && s.backoff).map((s) => s.m.src));
  st.forEach((s, i) => {
    if (s.code) return;
    if (sharedDown.has(s.m.src) && !o.force) return;
    const forced = (o.force || o.kinoForce) && s.age >= FORCE_MIN_AGE_MS && !(o.kinoForce && s.backoff);
    const lazy = lazyMember(s) ? 2 : 0;
    if (!s.stored) { if (!s.backoff || o.force) wants.push({ i, tier: lazy }); }
    else if (o.refresh && must && must.has(i)) wants.push({ i, tier: 0 });
    else if (o.refresh && ((s.age >= s.pol.fresh && !s.backoff) || forced)) wants.push({ i, tier: 1 + lazy });
  });
  const sharedFirst = (w) => (st[w.i].src.sharedFetch ? 1 : 0);
  const behind = (w) => st[w.i].age / st[w.i].pol.maxStale;
  wants.sort((a, b) => a.tier - b.tier || (a.tier % 2 === 0 ? sharedFirst(b) - sharedFirst(a) : behind(b) - behind(a)) || a.i - b.i);
  let units = 0, xuper = 0;
  const shared = new Set();
  for (const w of wants) {
    const src = st[w.i].src;
    if (src.sharedFetch && shared.has(src.id)) continue;   // its source's one response stores this list too
    if (units >= PLAN_MAX_UNITS) break;
    if (src.id === "xuper" && xuper >= PLAN_MAX_XUPER) continue;
    units++;
    if (src.id === "xuper") xuper++;
    if (src.sharedFetch) shared.add(src.id);
    out.add(w.i);
  }
  return out;
}

/**
 * The stored lists of a first page (indices into `st`) that must refresh in this call even outside Kino's refresh
 * budget, with their connector's own timeout as a missing list: what would otherwise be lost before Kino lists the
 * category again (`NEXT_LISTING_MS`). A list whose stored text would vanish by then, and — one per source, its stalest
 * — a list of a network source whose categories would pass their max-stale by then (they ride along with it, or its
 * connector sets them from the same response; past max-stale the source would leave every category until they load
 * again). A source too slow for the budget never refreshes inside it: this is when it does, about once a max-stale.
 * Never a secondary source's list: losing one costs only failover, and it loads again in a later listing.
 */
function mustRefresh(st, now) {
  const out = new Set();
  const bySrc = new Map();
  st.forEach((s, i) => {
    if (s.code || !s.stored || s.backoff || lazyMember(s)) return;
    const ends = ls.listTextEndsAt(s.key, s.pol.maxStale);
    if (ends && ends <= now + NEXT_LISTING_MS) out.add(i);
    if (!bySrc.has(s.m.src)) bySrc.set(s.m.src, []);
    bySrc.get(s.m.src).push(i);
  });
  for (const [srcId, idx] of bySrc) {
    const src = sourceById(srcId);
    if (codeCategories(src) || ls.catsInBackoff(srcId, now) || idx.some((i) => out.has(i))) continue;
    const c = ls.catsOf(srcId);
    if (!c || c.at + catPolicy(src).maxStale > now + NEXT_LISTING_MS) continue;
    out.add(idx.reduce((a, b) => (st[b].age > st[a].age ? b : a)));
  }
  return out;
}

const eventsRank = (srcId) => { const i = EVENTS_ORDER.indexOf(srcId); return i < 0 ? EVENTS_ORDER.length : i; };

/** Members in the order they compose: SOURCES order (the mapping's), live events by EVENTS_ORDER. */
function orderedMembers(e) {
  if (e.kind !== "events") return e.members;
  return e.members.map((m, i) => ({ m, i })).sort((a, b) => eventsRank(a.m.src) - eventsRank(b.m.src) || a.i - b.i).map((x) => x.m);
}

/** The adult flag of an exposed category: its own, or one of its members' raw categories'. */
function categoryAdult(e) {
  if (e.adult) return true;
  for (const m of e.members) {
    const s = ls.catsOf(m.src);
    const hit = s && s.cats.find((c) => c.id === m.rawCat);
    if (hit && hit.adult) return true;
  }
  return false;
}

/**
 * The refs of every channel stored in an adult raw category of these sources: xuper's "Todos" column lists the
 * channels of its adult columns without saying so, so such a channel is flagged adult wherever it shows.
 */
function adultRefsOf(srcIds) {
  const out = new Set();
  for (const id of srcIds) {
    const s = ls.catsOf(id);
    if (!s) continue;
    for (const c of s.cats) {
      if (!c.adult) continue;
      const l = ls.getList(listKey(id, c.id));
      if (l) for (const it of l.items) if (it && it.ref) out.add(it.ref);
    }
  }
  return out;
}

/** xuper's adult columns not stored yet: v.all.xuper loads them too, so their channels can be flagged. */
function adultAux(e, now) {
  if (e.kind !== "all") return [];
  const out = [];
  for (const id of new Set(e.members.map((m) => m.src))) {
    const s = ls.catsOf(id);
    if (!s) continue;
    for (const c of s.cats) if (c.adult) out.push(memberState({ src: id, rawCat: c.id }, now));
  }
  return out.filter((s) => s.src && !s.code && !s.stored && !s.backoff);
}

// Composed pages, by category and the hashes of their member lists: a page call recomposes only when a list changed
// (QuickJS runs regexes 20–50× slower than V8; a 1 GB TV box feels it).
const PAGES_MAX = 8, PAGE_ITEMS_MAX = 6000;
const pages = new Map();

// The titles of the members of the merged channels composed in this runtime (ref → title): a resolve labels its
// servers from them and never reads a stored list for it. A ref composed in no listing of this runtime is labelled by
// its source's name alone. Filled when a page is composed, so it is dropped together with the composed pages (a page
// served from that cache must find its titles).
const MEMBER_TITLES_MAX = 8000;
const memberTitles = new Map();
function forgetCompositions() { pages.clear(); memberTitles.clear(); }
function composedPage(key, build) {
  const hit = pages.get(key);
  if (hit) { pages.delete(key); pages.set(key, hit); return hit; }
  const items = build();
  pages.set(key, items);
  let total = 0;
  for (const v of pages.values()) total += v.length;
  while (pages.size > PAGES_MAX || (total > PAGE_ITEMS_MAX && pages.size > 1)) {
    const [k, v] = pages.entries().next().value;
    pages.delete(k);
    total -= v.length;
  }
  return items;
}

/**
 * Runs `fn` over `list` in order with at most `n` running at once and at most `perKey` of one `keyOf` (a source: its
 * lists share a host, and Kino runs 4 per host), each next one started as one ends — the first left whose key has room;
 * none is started once less than MIN_TIMEOUT_MS is left of the running deadline (its request could not start).
 */
async function inTurn(list, n, fn, keyOf, perKey) {
  const left = list.slice();
  const running = new Map();
  const worker = async () => {
    while (remaining() >= MIN_TIMEOUT_MS) {
      const at = left.findIndex((x) => (running.get(keyOf(x)) || 0) < perKey);
      if (at < 0) return;   // what is left waits for a key whose own workers take it
      const x = left.splice(at, 1)[0];
      const k = keyOf(x);
      running.set(k, (running.get(k) || 0) + 1);
      try { await fn(x); } finally { running.set(k, running.get(k) - 1); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
}

function parseCursor(c) {
  const m = /^([0-9a-z]{1,16}):(\d{1,7})$/.exec(String(c == null ? "" : c));
  return m ? { h: m[1], offset: Number(m[2]) } : null;
}

/** A stored item → what Kino and the screen get (the private `x` stays in storage). */
function kinoChannel(c, categoryId, adult) {
  const k = { id: c.id, title: c.title, ref: c.ref, categoryId };
  if (c.logo) k.logo = c.logo;
  if (adult || c.adult) k.adult = true;
  return k;
}

/**
 * The composed channels of an exposed category: `{ items, h, stale, partial, failed, refreshable, code, have, members }`
 * or null (no such category). `opts`: `refresh` (a first page), `force`, `kinoForce`, `noFetch` (a cursor page: compose
 * what is stored), `offline` (never the network: the screen's draw, a resolve looking for siblings). Per member list:
 * `partial` = one is missing and not in its failure backoff; `failed` = one is missing or stale BECAUSE its source
 * failed recently (in its backoff); `refreshable` = how many are stale and not in a backoff. Members that fail with
 * nothing stored are left out; when every one fails, it throws. Each request keeps its connector's own timeout under
 * the call's deadline (1.0.45's): a merged category holds the big single-response lists (cablevisionhd's page,
 * premiumtv's m3u), which a shorter cap would never let load on a slow network. `softMs` (Kino's first page of a merged
 * category): the missing lists load first as above, then the stale ones refresh, stalest first, only until `softMs`
 * after the call started (`within … strict`: nothing started ends past it); the others are served stale, and a list
 * the budget cut short is not a failure (no backoff). Not on Kino's "Recargar" (`kinoForce`): the person asked to wait.
 * A secondary source's lists (supertv's other panels) are failover for the channels the others list: on that first
 * page they load after the stale ones, inside the same budget, missing or stale — and not at all when no other member
 * has a channel to show (they could add no row). Their staleness and failures never set the screen's notes.
 */
async function categoryChannels(categoryId, opts) {
  const o = opts || {};
  const e = await entryOf(categoryId);
  if (!e) return null;
  const use = new Set(activeSources().map((s) => s.id));
  const members = orderedMembers(e).filter((m) => use.has(m.src));
  if (!members.length) return null;
  const now = Date.now();
  const st = members.map((m) => memberState(m, now));
  const aux = o.offline || o.noFetch ? [] : adultAux(e, now);
  const must = o.refresh && st.length > 1 && !o.offline && !o.noFetch ? mustRefresh(st, now) : null;
  const plan = planFetch(st, o, must);
  // Kino's "Recargar" (kinoForce) is when the person asked to wait: every list checked over 10 min ago refreshes, as in
  // 1.0.45, under the call's deadline only.
  const budgeted = o.softMs > 0 && st.length > 1 && !o.force && !o.kinoForce;
  // stale lists and secondary sources' missing ones: within the budget (those that must refresh now load with the
  // missing ones)
  let later = budgeted ? [...plan].filter((i) => (st[i].stored && !(must && must.has(i))) || lazyMember(st[i])) : [];
  const errors = [];
  const results = new Array(st.length).fill(null);
  const loaded = new Set();
  const load = async (i) => {
    const l = await loadMember(st[i], !!o.force);
    loaded.add(i);
    if (l.error) errors.push(l.error); else results[i] = l;
  };
  await Promise.all(st.map(async (s, i) => {
    if (s.code) {
      try { results[i] = await codeItems(s); } catch (err) { errors.push(err); }
      return;
    }
    if (plan.has(i) && !later.includes(i)) await load(i);
  }).concat(aux.slice(0, 2).map((s) => loadMember(s, false))));
  const shows = (s, i) => { const l = results[i] || s.stored; return !!l && Array.isArray(l.items) && l.items.length > 0; };
  // nothing else to show: a secondary source's list could add no row (src/liveMerge.js), so it is not fetched
  if (later.length && !st.some((s, i) => !lazyMember(s) && shows(s, i))) later = later.filter((i) => !lazyMember(st[i]));
  if (later.length) {
    // Stalest first, each list taken by one worker from its first request to its last, as many workers as the gate has
    // places and at most 4 per source (the gate's per-host share: a 5th would only wait): a list that needs a chain of
    // requests (futbollibre's agenda) keeps its place instead of queueing its next request behind every other list's
    // first one until the budget is gone. A list a shared response refreshed meanwhile (this step or the first) is
    // skipped.
    const fresh = (i) => { const m = ls.listMeta(st[i].key); return !!m && !!m.h && Date.now() - m.at < st[i].pol.fresh; };
    const left = callStartedAt() + o.softMs - Date.now();
    if (left >= MIN_TIMEOUT_MS) await within(left, () => inTurn(later, MAX_IN_FLIGHT, (i) => (fresh(i) ? null : load(i)), (i) => st[i].m.src, MAX_PER_HOST), { strict: true });
  }
  // A list not loaded here may have been stored meanwhile (a sibling of a shared response), or dropped (an account
  // switch mid-call): read those again.
  const lists = [];
  let stale = false, partial = false, failed = false, refreshable = 0, have = 0;
  const after = Date.now();
  // A source whose one response stores all its lists, failing recently: none of its lists refreshes (planFetch).
  const sharedDown = new Set(st.filter((s) => !s.code && s.src.sharedFetch && ls.inBackoff((ls.listMeta(s.key) || {}).failAt, after)).map((s) => s.m.src));
  st.forEach((s, i) => {
    let l = results[i];
    if (!s.code && (!loaded.has(i) || ls.droppedThisCall(s.m.src))) {
      const cur = ls.getList(s.key);
      l = cur ? { ...cur, stale: now - cur.at >= s.pol.fresh } : null;
    }
    const lazy = lazyMember(s);
    if (!s.code) {
      const meta = ls.listMeta(s.key);
      const down = (!!meta && ls.inBackoff(meta.failAt, after)) || sharedDown.has(s.m.src);
      if (!l && !down) partial = true;
      if (!lazy && down && (!l || l.stale)) failed = true;
      if (!lazy && l && l.stale && !down) refreshable++;
    }
    if (!l) return;
    have++;
    if (l.stale && !lazy) stale = true;
    // Live events: the Spanish agendas' copy leads a merged event (its title, its id).
    lists.push({ member: s.m, rank: e.kind === "events" ? eventsRank(s.m.src) : rankOf(s.m.src), items: l.items, h: l.h, secondary: lazy });
  });
  if (!lists.length) {
    if (errors.length) throw errors[0];
    return { items: null, h: "0", stale: false, partial, failed, refreshable, code: false, have: 0, members };
  }
  const adult = categoryAdult(e);
  const adultRefs = adult ? new Set() : adultRefsOf(new Set(members.map((m) => m.src)));
  const h = lists.length === 1 && members.length === 1 ? String(lists[0].h || "0").slice(0, 8) : hashId(lists.map((l) => l.member.src + ":" + l.h).join(","));
  const events = e.kind === "events";
  // The language too: a shown title may name a country (src/liveTitles.js).
  const pageKey = e.id + "|" + h + "|" + adultRefs.size + "|" + (adult ? 1 : 0) + "|" + lang() + (events ? "|" + Math.floor(after / EVENT_BUCKET_MS) : "");
  const items = composedPage(pageKey, () => {
    if (memberTitles.size > MEMBER_TITLES_MAX) forgetCompositions();
    const marked = adultRefs.size ? lists.map((l) => ({ ...l, items: l.items.map((c) => (c && !c.adult && adultRefs.has(c.ref) ? { ...c, adult: true } : c)) })) : lists;
    return composeMerged(marked, { merge: e.merge, events, cc: e.cc, titles: memberTitles, now: after, en: en() }).map((c) => kinoChannel(c, e.id, adult));
  });
  return { items, h, stale, partial, failed, refreshable, code: st.every((s) => s.code), have, members };
}

/**
 * Kino's `liveChannels({ categoryId, cursor })`: pages of 500, `next` = `<h8>:<offset>`. Lists load only on the first
 * page (cursor null); a later page composes what is stored, so the page boundaries never move. A changed hash keeps
 * the offset (Kino matches channels by id). A first page asked again within 55 min in this runtime is Kino's
 * "Recargar": it refetches (still honouring the failure backoff). [] without a Bearer — also when the backend refused it
 * during this call — or for an unknown category (as 1.0.43).
 */
export async function liveChannels(arg) {
  if (!(await currentBearer())) return [];
  const categoryId = String((arg && arg.categoryId) || "");
  if (!categoryId) return [];
  const cursor = parseCursor(arg && arg.cursor);
  try {
    // Kino keeps a non-empty listing 1 h (never an empty or failed one), so a second first-page call inside that
    // window is its "Recargar" (or a rebuilt provider): the only way Kino's forced re-list reaches the plugin. The
    // stamps live in this runtime's memory only: a cold runtime makes no extra fetch.
    const prev = cursor ? 0 : ls.firstPageAt(categoryId);
    const kinoForce = !!prev && Date.now() - prev < KINO_RELIST_MS;
    const idle = new Set(cursor ? [] : SOURCES.filter((s) => s.secondaryOf && !inUse(s)).map((s) => s.id));
    let r;
    try {
      r = await categoryChannels(categoryId, { refresh: !cursor, kinoForce, noFetch: !!cursor, softMs: KINO_REFRESH_SOFT_MS });
    } catch (e) {
      if (!(await currentBearer())) return [];   // a 401 dropped the Bearer mid-call: as 1.0.43 without one
      throw kino.error("unavailable", "Xuper: live list failed and nothing is stored (" + ((e && (e.code || e.message)) || e) + ")");
    }
    if (!cursor && r) {
      try { await searchSecondaries(r.members, idle); } catch (e) { log("secondary sources: " + why(e)); }
    }
    if (!r || !r.items) return [];
    if (!cursor && r.items.length) ls.markFirstPage(categoryId);
    const offset = cursor ? cursor.offset : 0;
    const items = r.items.slice(offset, offset + PAGE_SIZE);
    const next = offset + PAGE_SIZE < r.items.length ? `${r.h}:${offset + PAGE_SIZE}` : null;
    return { items, next };
  } finally {
    ls.flushMeta();
  }
}

// ── the own screen (no network in reads; loads only in events and ticks) ──

/**
 * The screen's categories without the network: `{ cats: [{id, title, src}], missing }`: the exposed list without
 * the adult categories (Fútbol ▸ Canales: its football ones); `missing` = network sources still without categories
 * (the lcFill tick fetches them).
 */
export async function screenCategories(kind) {
  const list = (await categoryList()).filter((c) => !c.adult);
  const cats = kind === "football" ? footballOf(list) : list;
  const missing = (await missingSources(Date.now())).length > 0;
  return { cats: cats.map((c) => ({ id: c.id, title: c.title, src: c.src })), missing };
}

/**
 * What the screen shows for one category, without the network:
 * `{ items | null, stale, code, failed, partial, refreshable, have }`. `items` null = no list stored at all (the picker
 * loads it); `partial` = some member list is missing and not in its failure backoff (the lvRefresh tick loads the next
 * ones); `refreshable` = how many member lists are stale and not in a backoff (the tick refreshes them); `failed` = some
 * member list is missing or stale because its source failed recently; `have` = how many member lists there are;
 * `resume` = how many are a listing cut short (the channels so far, stored stale: the tick goes on with them).
 */
export async function screenList(categoryId) {
  const r = await categoryChannels(categoryId, { offline: true });
  if (!r) return { items: [], stale: false, code: true, failed: false, partial: false, refreshable: 0, have: 0, resume: 0 };
  return { items: r.items, stale: r.stale, code: r.code, failed: r.failed, partial: r.partial, refreshable: r.refreshable, have: r.have,
    resume: cutLists(r.members) };
}

/** How many member lists are a listing cut short (`p` in their meta: the channels so far are stored, more pages due). */
function cutLists(members) {
  let n = 0;
  for (const m of members || []) {
    const src = sourceById(m.src);
    if (!src || listPolicy(src, m.rawCat).code) continue;
    const meta = ls.listMeta(listKey(src.id, m.rawCat));
    if (meta && meta.p && meta.h) n++;
  }
  return n;
}

/**
 * Loads one category's lists now (the picker, the lvRefresh tick, Recargar). Throws when nothing could be loaded.
 * `bounds` (`{ deadlineMs, maxTimeoutMs }`, a tick's): this call's requests stop at that deadline; a refresh that
 * misses it serves the stored list. `force`: refetch (a merged category: the members checked over 10 min ago).
 */
export async function loadList(categoryId, opts) {
  const o = opts || {};
  try {
    if (o.bounds) tighten({ deadline: callStartedAt() + o.bounds.deadlineMs, maxTimeoutMs: o.bounds.maxTimeoutMs });
    const r = await categoryChannels(categoryId, { refresh: true, force: !!o.force });
    return !!(r && r.items);
  } finally {
    ls.flushMeta();
  }
}

/**
 * The screen's lcFill tick: the categories of the FIRST network source never listed (SOURCES order, none in its
 * backoff; with the secondary sources of its family), under `SCREEN_FILL` (4 s). One small step per tick: Kino never
 * preempts a running tick, so a person's tap waits at most that long. A source that fails gets its 10 min backoff and
 * the next tick moves on. Here a secondary source missing on its own may search new accounts (`fillCategories`).
 * → `{ n, left }` (see `fillCategories`).
 */
export async function fillScreenCategories() {
  try { return await fillCategories(SCREEN_FILL, 1, { search: true }); } finally { ls.flushMeta(); }
}

// ── resolve ──

const unknownSource = () => kino.error("unavailable", en() ? "Xuper: unknown channel source" : "Xuper: fuente de canal desconocida");
const notLive = () => kino.error("unavailable", en() ? "Xuper: not a live channel" : "Xuper: no es un canal en vivo");
const shortWhy = (e) => String((e && e.code) || "error").slice(0, 40);

/**
 * A blind member's stream (its connector answers with no request): `ok` | `dead` | `unknown` (could not tell), the
 * same three states as the stremio bridges' copy probe. `dead` only when the server itself refused it: an HTTP answer
 * ≥ 400 other than 408 / 425 / 429, or a 2xx body that is not an HLS playlist. Anything that did not reach such an
 * answer is `unknown` and the member plays: a network or TLS error, a timeout, Kino refusing the host, this call's own
 * limits, and a redirect. A redirect is never followed (one request per probe): Kino re-issues an http redirect over
 * https and fails it at TLS (supertv's line.* panels answer 302 to http://<ip>), while the player follows it fine.
 * So a stream that redirected once is not probed again in this runtime (`probeable`): it could only say `unknown`.
 * A "network" error that names a refusal status (OkHttp's 407 "HTTP_PROXY_AUTH") is `dead`, and so is a redirect to an
 * ISP's block page (Colombian networks answer a blocked panel with 302 to coljuegos.gov.co): the player would fail it.
 * `opts.bound`: a shorter timeout (at least MIN_TIMEOUT_MS). `opts.alone === false`: a probe running beside another
 * member's work, which never takes the call's soft deadline (`within` is one at a time per call: it would cut that
 * member's requests short); its timeout bounds it instead.
 */
async function probeStream(out, opts) {
  const o = opts || {};
  const t = o.bound > 0 ? Math.max(MIN_TIMEOUT_MS, Math.min(PROBE_TIMEOUT_MS, o.bound)) : PROBE_TIMEOUT_MS;
  const get = () => liveFetch(out.url, { method: "GET", headers: { ...(out.headers || {}) }, cookies: false, redirect: "manual", timeoutMs: t, maxBytes: 4096 });
  let r;
  try {
    r = await (o.alone === false ? get() : within(t + 200, get));
  } catch (e) {
    // An answer the HTTP client refused to read comes back as a "network" error that still names its status, e.g.
    // "network error: Received HTTP_PROXY_AUTH (407) code while not using proxy" (a supertv account over its limit).
    return e && e.code === "network" && refusal(statusIn(e)) ? "dead" : "unknown";
  }
  if (!r) return "unknown";
  if (!r.ok) {
    const st = Number(r.status) || 0;
    if (st >= 300 && st < 400) {
      if (blockPage(r)) return "dead";
      ls.noteRedirectingScope(probeScope(out.url));
    }
    return refusal(st) ? "dead" : "unknown";
  }
  let text = "";
  try { text = String(bodyText(r) || ""); } catch (_) { return "unknown"; }
  return /^\s*#EXTM3U/.test(text) ? "ok" : "dead";
}

// The block pages ISPs answer a blocked panel with (measured: Colombia, Coljuegos).
const BLOCK_PAGE = /(?:^|\.)coljuegos\.gov\.co$/i;
/** Whether a redirect answer points to an ISP's block page. */
function blockPage(r) {
  const h = (r && r.headers) || {};
  try { return BLOCK_PAGE.test(new URL(String(h.location || h.Location || "")).hostname); } catch (_) { return false; }
}

/** An HTTP status that means the server refused the stream (not busy: 408, 425 and 429 are left open). */
const refusal = (st) => st >= 400 && st < 600 && st !== 408 && st !== 425 && st !== 429;

/** The HTTP status named in an error's message ("… (407) …"), else 0. */
function statusIn(e) {
  const m = /\((\d{3})\)/.exec(String((e && e.message) || ""));
  return m ? Number(m[1]) : 0;
}

/**
 * Where a probe's redirect is remembered: the stream itself (host and path, no query). One supertv account serves
 * every channel, and on it one stream redirects while another is refused (407 over the account's limit), so neither
 * the host nor the account directory says anything about the next stream.
 */
function probeScope(url) {
  try { const u = new URL(url); return u.host + u.pathname; } catch (_) { return ""; }
}

/** Whether a probe of this stream could tell anything: a playlist (an MPEG-TS address never ends its body) that has
 * not answered a probe with a redirect in this runtime. */
function probeable(out) {
  let path = "";
  try { path = new URL(out.url).pathname; } catch (_) { return false; }
  if (!/\.m3u8?$/i.test(path) || /mp2t/i.test(String(out.mime || ""))) return false;
  return !ls.isRedirectingScope(probeScope(out.url));
}

/**
 * The same-name siblings of an old single `L:` ref, from stored and code lists only (0 requests): the members of its
 * merged group in every exposed category (merging on) whose lists hold it. A live event's copies count only while the
 * ref names that one event: futbollibre's agenda plays each match on one of its channels (the event's ref IS that
 * channel's), and two matches on one channel share it. So when a channel list holds the ref too, or more than one event
 * row does, the events' copies (other sources' copies of whatever match is on that channel) are never taken.
 */
async function siblingsOf(ref) {
  const d = decodeRef(ref);
  if (d.kind !== "live" || d.members) return [];
  const src = sourceById(d.source);
  if (!src) return [];
  const raws = new Map();   // raw category → how many of its rows hold the ref
  let ownId = "";
  for (const key of ls.listKeysOf(src.id)) {
    const l = ls.getList(key);
    const hits = l ? l.items.filter((c) => c && c.ref === ref) : [];
    if (hits.length) { raws.set(hexDec(key.slice(src.id.length + 1)), hits.length); ownId = ownId || hits[0].id; }
  }
  if (codeCategories(src)) {
    try {
      for (const cat of normCats(await src.categories(ctxFor(src)))) {
        if (!listPolicy(src, cat.id).code) continue;
        const n = normalizeChannels(src.id, await src.channels(cat.id, ctxFor(src))).filter((c) => c.ref === ref).length;
        if (n) raws.set(cat.id, n);
      }
    } catch (_) { /* nothing from code */ }
  }
  const ex = await exposure();
  const held = [...raws].map(([raw, n]) => { const id = ex.byRaw.get(src.id + "\u0001" + raw); return { e: (id && ex.all.get(id)) || null, n }; });
  const oneEvent = held.every((x) => x.e && x.e.kind === "events") && held.reduce((a, x) => a + x.n, 0) === 1;
  const out = [];
  const done = new Set();
  for (const { e } of held) {
    if (!e || done.has(e.id) || !(e.kind === "events" ? oneEvent : e.merge)) continue;
    done.add(e.id);
    let r = null;
    try { r = await categoryChannels(e.id, { offline: true }); } catch (_) { r = null; }
    for (const c of (r && r.items) || []) {
      const dm = decodeRef(c.ref);
      if (!dm.members || !dm.members.some((x) => x.ref === ref || (!!ownId && x.id === ownId))) continue;
      for (const x of memberRefs(dm.members)) if (x.ref !== ref && !out.includes(x.ref)) out.push(x.ref);
    }
  }
  return out;
}

/** The account a member plays from (`src.accountOf`: an Xtream panel account), or null. */
function accountOfRef(src, channel) {
  try { return src && typeof src.accountOf === "function" ? src.accountOf(channel) || null : null; } catch (_) { return null; }
}
const accountOfLive = (ref) => { const d = decodeRef(ref); return d.kind === "live" && !d.members ? accountOfRef(sourceById(d.source), d.channel) : null; };

/** A stored channel of one source by its Kino id (a merged event's member written by id), or null. */
function storedById(srcId, id) {
  if (!sourceById(srcId)) return null;
  for (const key of ls.listKeysOf(srcId)) {
    const l = ls.getList(key);
    const hit = l && l.items.find((c) => c && c.id === id);
    if (hit) return hit;
  }
  return null;
}

/**
 * The members of an `M:` ref as `{ ref, id }`: an `L:` member as it is, one written by its Kino id looked up in its
 * source's stored lists (0 requests; gone once its list dropped the event).
 */
function memberRefs(members) {
  const out = [];
  for (const m of members) {
    if (m.ref) { out.push({ ref: m.ref, id: "" }); continue; }
    const hit = storedById(m.source, m.id);
    if (hit && typeof hit.ref === "string") out.push({ ref: hit.ref, id: m.id });
  }
  return out;
}

// ── what this device learned about the sources (src/liveStore.js o2:lh) ──

/** Whether a source's last SOURCE_FAIL_STREAK resolves here failed, the last one within SOURCE_FAIL_MS. */
function sourceFailing(id, now) {
  const s = ls.sourceStats(id);
  return s.fn >= SOURCE_FAIL_STREAK && now - s.f < SOURCE_FAIL_MS;
}

/** Whether a source's members take SLOW_SOURCE_MS or more to answer here (smoothed, answers within SLOW_EVIDENCE_MS). */
function slowSource(id, now) {
  const s = ls.sourceStats(id);
  return s.n > 0 && s.ms >= SLOW_SOURCE_MS && now - s.at < SLOW_EVIDENCE_MS;
}

/**
 * Whether a blind member is known to play: its own playlist answered a probe within READY_MS, or its source's playlists
 * did within SOURCE_ALIVE_MS with none found dead since.
 */
function readyBlind(c, now) {
  const ok = ls.probeOkAt(c.ref);
  if (ok && now - ok < READY_MS) return true;
  const s = ls.sourceStats(c.src.id);
  return !!s.ok && now - s.ok < SOURCE_ALIVE_MS && s.fn === 0;
}

/**
 * The cost lane, on a sorted candidate list (in place): a ready blind member of the healthy tier goes before the members
 * right above it that are slow here (both on evidence); nothing else moves, and ready members keep their own order.
 * → a log line naming what moved, or "".
 */
function costLane(list, tier) {
  const moved = new Set();
  for (let i = 1; i < list.length; i++) {
    const b = list[i];
    if (!b.ready || tier(b) !== 0) continue;
    let j = i;
    while (j > 0 && list[j - 1].slow && tier(list[j - 1]) === 0) { list[j] = list[j - 1]; j--; }
    if (j === i) continue;
    list[j] = b;
    moved.add(b.src.id + " before " + [...new Set(list.slice(j + 1, i + 1).map((x) => x.src.id))].join(", "));
  }
  return moved.size ? "a ready copy with no request first (" + [...moved].join("; ") + ": slow here)" : "";
}

/**
 * One candidate: exactly 1.0.45 (its error, its DRM stream), noted in the live health. A first open skips the
 * scrapers' off-air check (`ctx.verify`): the player's own request of that playlist tells the same, and its 404 starts
 * Kino's reopen, which then verifies (`again`), as does a member demoted for failing: the person reads "no signal".
 */
async function playAlone(c, again) {
  const t0 = Date.now();
  let out;
  try { out = await c.src.resolve(c.raw, ctxFor(c.src, { verify: !!again || ls.demotedAt(c.ref) > 0 })); }
  catch (e) {
    // a blind source's answer needs no request (it says nothing about its streams), this call's own limits and a
    // channel off the air nothing about the source
    if (!c.src.blind && !ownLimit(e) && !(e && e.code === "offline")) ls.noteFailure(c.src.id);
    const reason = (e && (e.message || e.code)) || "";
    // A connector's own sentence for the person (`userMessage`: e.g. no copy of an event opens here) goes on.
    const user = e && typeof e.userMessage === "string" && e.userMessage ? { userMessage: e.userMessage } : undefined;
    throw kino.error("unavailable", en() ? "Xuper: could not open the channel (" + reason + ")" : "Xuper: no se pudo abrir el canal (" + reason + ")", user);
  }
  if (!isStream(out)) {
    if (!c.src.blind) ls.noteFailure(c.src.id);
    throw kino.error("unavailable", en() ? "Xuper: channel without a stream" : "Xuper: canal sin stream");
  }
  if (!c.src.blind) ls.noteAnswer(c.src.id, Date.now() - t0);
  if (!out.mime) out.mime = HLS;
  return { stream: out, member: c.ref };
}

/**
 * Plays the first candidate (`L:` refs, best first) that opens → `{ stream, member }`; throws when none does. One
 * candidate: exactly 1.0.45 (its error, its DRM stream). Several: DRM members skipped while the manifest does not
 * declare `drm`; healthy members first, then members whose source's categories are failing (a panel-wide error), then
 * demoted ones (oldest demotion first); within each, a secondary panel's copy (`src.secondaryOf`: supertv's other panels)
 * after every other member: it is failover. Each with its share of the call (`within`); while others remain (or `more`
 * may still add some), a blind member and the `suspect` (the member this channel served right before a re-resolve) are
 * probed, and a dead one is demoted.
 * A refusal (a dead probe — 407, 4xx, a body that is no playlist —, a failed resolve, the suspect found dead) refuses
 * that member only: on one supertv account one stream answers 407 while the next plays (measured on the phone). An
 * ACCOUNT is passed over only on account-level evidence: `ACCOUNT_STRIKES` of its members refused in this resolve
 * (`refusedAcct`, the member Kino's chain of reopens just demoted, is one). Then the next one tried is, within the same
 * tier, the first on another account; a secondary panel's copy that would pass a member of the others only plays when
 * its own probe says `ok` (a redirect or no answer cannot tell: it goes back to its turn, after them; one such check per
 * other account, `AUDITIONS_MAX` per resolve, outside `PROBE_MAX`; that account's other copies then wait for their
 * turn). A copy that plays and is cut later is demoted by Kino's chain of reopens like any member. `more` (optional,
 * async → `L:` refs): the same channel on other accounts, failover, asked at most once, only when every member left plays
 * from an account passed over; they take their tier's place in the order (a healthy one before a demoted member of the
 * account passed over: a channel whose members all play from one account finds its other panels only when it needs
 * them). `again`: this channel was resolved right before (a single member then verifies its stream, `playAlone`).
 *
 * What this device learned (src/liveStore.js o2:lh) moves a member only on evidence about it, read once per resolve:
 *   - its demotion (a failure, a dead probe) outlives the runtime once written;
 *   - its source (a connector that needs the network) failed its last SOURCE_FAIL_STREAK resolves here, the last within
 *     SOURCE_FAIL_MS: the failing tier;
 *   - the cost lane (`costLane`): a ready blind member (its own playlist answered a probe within READY_MS, or its
 *     source's did within SOURCE_ALIVE_MS with none dead since) goes before the members right above it whose source is
 *     measured slow here (≥ SLOW_SOURCE_MS): it plays with one probe at most where they take seconds. Nothing else moves.
 * A member that needs the network gets SCRAPER_SHARE_MS while a primary copy that needs none waits; cut by that share it
 * is not demoted (no evidence against it), its time is noted. A blind member whose playlist answered a probe within
 * PROBE_FRESH_MS plays unprobed, the suspect never. Kino reads the answer only once every request of the call has
 * settled, so a probe beside other work is started only where its answer is likely needed: during a slow member's turn,
 * the first ready-to-probe blind copy after it (its probe ends long before that member: the answer waits no longer, and
 * the copy is then known for the next opens, or plays at once if that member fails); and once a member failed in this
 * resolve, the next copies' probes at once, one per account (an Xtream account's connection limit).
 */
async function playCandidates(refs, tag, suspect, byId, refusedAcct, more, again) {
  const off = offSources();
  const cands = [];
  let unknown = null;
  const seen = new Set();
  const take = (one) => {
    if (seen.has(one)) return null;
    seen.add(one);
    const d = decodeRef(one);
    if (d.kind !== "live" || d.members) return null;
    const src = sourceById(d.source);
    if (!src || off.has(d.source)) { unknown = unknown || unknownSource(); return null; }
    const c = { ref: one, src, raw: d.channel, i: cands.length, acct: accountOfRef(src, d.channel), fo: !!src.secondaryOf };
    cands.push(c);
    return c;
  };
  for (const one of refs) take(one);
  if (!cands.length) throw unknown || notLive();
  if (cands.length === 1) return playAlone(cands[0], again);
  const now = Date.now();
  let list = drmDeclared ? cands : cands.filter((c) => !c.src.drm);
  if (list.length < cands.length) log("resolve " + tag + ": " + cands.filter((c) => c.src.drm).map((c) => c.src.id).join(", ") + " needs DRM (not declared), skipped");
  const tier = (c) => (c.dAt ? 2 : c.sick || ls.catsInBackoff(c.src.id, now) ? 1 : 0);
  // healthy, then a failing source's, then demoted (oldest demotion first); a secondary panel's copy last in its tier
  const order = (a, b) => tier(a) - tier(b) || (a.fo ? 1 : 0) - (b.fo ? 1 : 0) || (a.dAt && b.dAt ? a.dAt - b.dAt : 0) || a.i - b.i;
  // The evidence, read once: what this resolve notes never moves the members under the loop. The failing tier takes
  // connectors that failed to answer a stream; a blind source's dead playlists stay per member (an Xtream account
  // answers 407 to one stream while it plays another: the strikes below judge the account inside one resolve).
  const mark = (c) => ({ ...c, dAt: ls.demotedAt(c.ref), sick: !c.src.blind && sourceFailing(c.src.id, now),
    slow: !c.src.blind && slowSource(c.src.id, now), ready: !!c.src.blind && !c.fo && readyBlind(c, now) });
  list = list.map(mark).sort(order);
  const lane = costLane(list, tier);
  if (lane) log("resolve " + tag + ": " + lane);
  const steps = [];
  let userMessage = "";
  let probes = 0;
  // A member failed, gave no stream or was found dead in this resolve: the next copies' probes then go at once
  // (`afterFailure`). A member cut by the shorter share is no such evidence: the copies after it are probed in their
  // turn, so a copy whose host hangs is never probed beside one that answers (it would hold the answer up to 2.5 s).
  let trouble = false;
  // members probed ahead of their turn (beside a slow member, or after a failure): their verdicts are kept before the
  // answer goes (Kino waits for their requests anyway)
  const ahead = [];
  const timedProbe = (out, opts) => (async () => { const t0 = Date.now(); const v = await probeStream(out, opts); return { v, ms: Date.now() - t0 }; })();
  const noteVerdict = (x, r) => {
    if (r.v === "ok") { ls.noteProbeOk(x.ref); if (x.src.blind) ls.noteAnswer(x.src.id, r.ms); }
    else if (r.v === "dead" && x.src.blind) ls.noteFailure(x.src.id);
  };
  const verdictOf = async (x) => { const r = await x.pre; x.pre = null; noteVerdict(x, r); return r.v; };
  const freshOk = (x) => { const ok = ls.probeOkAt(x.ref); return !!ok && Date.now() - ok < PROBE_FRESH_MS; };
  const aheadable = (x) => !!x.src.blind && !x.fo && !x.dAt && !x.pre && !x.heard && !x.out && !freshOk(x);
  // a blind member's stream resolved ahead of its turn (no request), when it is one a probe can judge
  const streamAhead = async (x) => {
    let o = null;
    try { o = await x.src.resolve(x.raw, ctxFor(x.src)); } catch (_) { return null; }
    return isStream(o) && !(o.drm && !drmDeclared) && probeable(o) ? o : null;
  };
  const startAhead = (x, o, bound) => { x.out = o; probes++; x.pre = timedProbe(o, { alone: false, bound }); ahead.push(x); };
  const settle = async () => {
    for (const x of ahead) {
      if (!x.pre) continue;
      if ((await verdictOf(x)) === "dead") ls.demote(x.ref, DEMOTE_MS);
    }
  };
  // account → its members refused in this resolve; ACCOUNT_STRIKES of them pass the account over
  const strikes = new Map(refusedAcct ? [[refusedAcct, 1]] : []);
  const refused = (c) => { if (c.acct) strikes.set(c.acct, (strikes.get(c.acct) || 0) + 1); };
  const passed = (x) => !!x.acct && (strikes.get(x.acct) || 0) >= ACCOUNT_STRIKES;
  const left = list.slice();
  let ask = typeof more === "function" ? more : null;
  // the other accounts (or copies without one) checked early in this resolve
  const auditioned = new Set();
  const auditionKey = (x) => x.acct || x.ref;
  // During a slow member's turn, the first blind copy of the healthy tier after it that a probe can judge: probed beside
  // it, bounded by that member's own time here, so Kino's answer (which waits for every request) waits no longer.
  const besideSlow = async (c, rest) => {
    if (probes >= PROBE_MAX) return;
    const b = rest.find((x) => tier(x) === 0 && aheadable(x));
    const o = b ? await streamAhead(b) : null;
    if (o) startAhead(b, o, ls.sourceStats(c.src.id).ms);
  };
  // After a failure in this resolve: the next copies that would be probed in their turn, at once, one per account (one
  // probe at a time on an Xtream account: its connection limit), within PROBE_MAX.
  const keyOf = (x) => x.acct || "src:" + x.src.id;
  const afterFailure = async (c, rest) => {
    const busy = new Set([keyOf(c), ...ahead.filter((x) => x.pre).map(keyOf)]);
    for (let j = 0; j < rest.length && probes < PROBE_MAX; j++) {
      const x = rest[j];
      // the last one left plays unprobed in its turn (nothing to fall to)
      if (!aheadable(x) || passed(x) || busy.has(keyOf(x)) || (j === rest.length - 1 && !ask)) continue;
      const o = await streamAhead(x);
      if (!o) continue;
      busy.add(keyOf(x));
      startAhead(x, o, PROBE_TIMEOUT_MS);
    }
  };
  for (let k = 0; left.length; k++) {
    if (ask && left.every(passed)) {
      const fn = ask;
      ask = null;
      let extra = [];
      try { extra = await fn(); } catch (_) { extra = []; }
      for (const one of Array.isArray(extra) ? extra : []) {
        const c = take(one);
        if (c && (drmDeclared || !c.src.drm)) { const x = mark({ ...c, fo: true }); list.push(x); left.push(x); }
      }
      // their tier's place, not the end: a healthy stored copy comes before a demoted member of the account passed over
      // (the jump below only looks inside the first one's tier)
      left.sort(order);
      costLane(left, tier);
    }
    // the first left; when its account was passed over, the first of its tier on another account (a copy whose probe
    // already could not tell waits for its turn, and so does another copy on an account already checked early)
    let at = 0;
    if (passed(left[0])) {
      const t0 = tier(left[0]);
      const hop = left.findIndex((x) => tier(x) === t0 && !passed(x) && !x.heard && !(x.fo && auditioned.has(auditionKey(x))));
      if (hop > 0) at = hop;
    }
    // a failover copy taken before a member of the others plays on its own probe's `ok` only; one such check per other
    // account, `AUDITIONS_MAX` per resolve (each is a probe of up to 2.7 s taken from the members it would pass)
    let audition = at > 0 && left[at].fo && left.slice(0, at).some((x) => !x.fo);
    if (audition && auditioned.size >= AUDITIONS_MAX) { at = 0; audition = false; }
    if (audition) auditioned.add(auditionKey(left[at]));
    const c = left.splice(at, 1)[0];
    const rest = left;
    // While a primary copy that needs no request waits (not demoted), a member that needs the network gets at most
    // SCRAPER_SHARE_MS: that copy plays at once.
    const full = k === 0 ? MEMBER_FIRST_MS : MEMBER_NEXT_MS;
    const share = !c.src.blind && rest.some((x) => x.src.blind && !x.fo && !x.dAt) ? Math.min(full, SCRAPER_SHARE_MS) : full;
    if (!c.src.blind && remaining() < MEMBER_MIN_MS) { steps.push(c.src.id + " skipped (no time left)"); continue; }
    if (c.slow && !c.out) await besideSlow(c, rest);
    const t0 = Date.now();
    let out = c.out || null;
    try {
      if (!out) out = await within(share, () => c.src.resolve(c.raw, ctxFor(c.src)));
    } catch (e) {
      const ms = Date.now() - t0;
      if (share < full && ms >= share - CUT_SLACK_MS) {
        // cut by the shorter share: no evidence against it (only that it is slower than the copy waiting), so no
        // demotion, no strike and no `trouble`; its time is noted (the cost lane reads it)
        ls.noteSlow(c.src.id, ms);
        steps.push(c.src.id + " cut after " + ms + " ms (a copy with no request waits)");
        continue;
      }
      trouble = true;
      if (!userMessage && e && typeof e.userMessage === "string" && e.userMessage) userMessage = e.userMessage;
      ls.demote(c.ref, DEMOTE_MS);
      refused(c);
      // this call's own limits and a channel off the air say nothing about the source, nor a blind source's answer
      if (!c.src.blind && !ownLimit(e) && !(e && e.code === "offline")) ls.noteFailure(c.src.id);
      steps.push(c.src.id + " failed in " + ms + " ms (" + shortWhy(e) + ")");
      continue;
    }
    if (!isStream(out)) {
      trouble = true;
      ls.demote(c.ref, DEMOTE_MS);
      refused(c);
      if (!c.src.blind) ls.noteFailure(c.src.id);
      steps.push(c.src.id + " gave no stream");
      continue;
    }
    if (out.drm && !drmDeclared) { steps.push(c.src.id + " needs DRM (not declared), skipped"); continue; }
    if (!c.src.blind && !c.out) ls.noteAnswer(c.src.id, Date.now() - t0);
    if (audition) {
      // its own check, outside PROBE_MAX: the members it would pass keep their probes
      let v = "";
      if (probeable(out)) { const r = await timedProbe(out); noteVerdict(c, r); v = r.v; }
      if (v === "dead") { ls.demote(c.ref, DEMOTE_MS); refused(c); trouble = true; steps.push(c.src.id + " does not answer (probe)"); continue; }
      if (v !== "ok") {
        // a redirect, no answer or no probe cannot tell: back to its own turn after the others, never probed again
        left.splice(at, 0, { ...c, out, heard: v || "unprobed" });
        steps.push(c.src.id + " not confirmed (" + (v || "not probed") + "), after the others");
        continue;
      }
    } else if ((c.src.blind || c.ref === suspect) && (rest.length || ask || c.pre) && !c.heard && probeable(out)) {
      let v = "";
      if (c.pre) v = await verdictOf(c);   // probed ahead of its turn
      else if (c.ref !== suspect && freshOk(c)) {
        steps.push(c.src.id + " unprobed (its playlist answered " + Math.round((Date.now() - ls.probeOkAt(c.ref)) / 1000) + " s ago)");
      } else if (probes < PROBE_MAX) {
        probes++;
        c.pre = timedProbe(out);
        if (trouble) await afterFailure(c, rest);
        v = await verdictOf(c);
      }
      if (v === "dead") { ls.demote(c.ref, DEMOTE_MS); refused(c); trouble = true; steps.push(c.src.id + " does not answer (probe)"); continue; }
    }
    if (!out.mime) out.mime = HLS;
    steps.push(c.src.id + " ok in " + (Date.now() - t0) + " ms (" + (c.i + 1) + " of " + cands.length + ")");
    log("resolve " + tag + " (" + cands.length + " members): " + steps.join("; "));
    const others = list.filter((x) => x.ref !== c.ref).slice(0, ALTERNATIVES_MAX);
    const E = en();
    // Two copies with the same label (the same source and quality) are told apart by a number: "Fútbol Libre · 2".
    const seenLabels = new Map();
    const label = (x) => {
      const base = memberLabel(x.src.name, memberTitles.get(x.ref) || "", E);
      const n = (seenLabels.get(base) || 0) + 1;
      seenLabels.set(base, n);
      return n === 1 ? base : base.slice(0, 44) + " · " + n;
    };
    out.label = label(c);
    // A lazy alternative's ref is ≤ 512 characters (Kino): a long event ref goes as a one-member `M:` ref by its id.
    const altRef = (x) => (x.ref.length <= ALT_REF_MAX ? x.ref : byId && byId.get(x.ref) ? "M:" + byId.get(x.ref) : "");
    out.alternatives = others.filter((x) => altRef(x)).map((x) => ({ label: label(x), ref: altRef(x) }));
    await settle();
    return { stream: out, member: c.ref };
  }
  await settle();
  const n = cands.length;
  log("resolve " + tag + " (" + n + " members): " + (steps.join("; ") || "nothing tried"));
  const E = en();
  throw kino.error("unavailable",
    E ? "Xuper: none of the channel's " + n + " servers worked" : "Xuper: ninguno de los " + n + " servidores del canal funcionó",
    { userMessage: userMessage || (E ? "None of this channel's servers works right now. Try another channel or come back in a few minutes."
      : "Ningún servidor de este canal funciona ahora mismo. Prueba otro canal o vuelve en unos minutos.") });
}

/**
 * THE live resolve seam. An `M:` ref (a merged channel) plays its members in order (see `playCandidates`); an `L:` ref
 * plays itself (exactly 1.0.45), then `siblings` and — when it fails, comes back right after a cut, or needs DRM the
 * manifest does not declare (caracol) — the same channel in other sources found in the stored lists (0 requests).
 *
 * Kino re-resolves a cut channel with the same ref and nothing that tells it from a person's own reopen (a Back and a
 * tap), and resolves the zapping neighbours in between. So each channel keeps its last resolve: the same channel again
 * within 90 s re-checks the member it served (`suspect`: its playlist is probed; a dead one is demoted for 10 min and
 * the next member plays; one that answers, or that cannot be probed, plays again: Kino's zapping preheat re-resolves
 * the channel just left within seconds, with no cut), and a re-resolve right after that one with nothing resolved in
 * between (Kino's chain of reopens, its quiet retries) demotes it outright (one strike against its account, see
 * `playCandidates`: the account's other copies still come before another panel's).
 * An `M:` ref whose members all play from one account (supertv's FHD / HD copies on the primary's panel, composed before
 * its other panels were listed, or a favourite) gets the same channel on other panels from the stored lists (0
 * requests), after its own members, once that account was passed over (finding them composes its category offline: a
 * few ms in V8, 20–50× that in QuickJS, so a first open or a preheat that plays never pays for it).
 * It writes nothing before its answer (src/liveStore.js `deferWrites`): what it learned is written by the next live
 * call that is not a resolve.
 */
export async function resolveLive(ref, siblings) {
  ls.deferWrites();
  const r = decodeRef(ref);
  const extra = Array.isArray(siblings) ? siblings.filter((x) => typeof x === "string" && x) : [];
  const key = hashId(String(ref));
  const tag = (r.members ? "M#" : "L#") + key;
  const prev = ls.lastResolveOf(key);
  const now = Date.now();
  const gap = prev ? now - prev.endedAt : Infinity;
  const again = !!prev && gap >= REOPEN_MIN_GAP_MS && gap < REOPEN_WINDOW_MS;
  const streak = again ? (prev.consecutive ? prev.streak + 1 : 1) : 0;
  let suspect = null;
  let refusedAcct = null;
  if (again && prev.member) {
    const after = "resolve " + tag + ": again after " + Math.round(gap / 1000) + " s";
    if (streak >= 2) {
      ls.demote(prev.member, DEMOTE_MS);
      refusedAcct = accountOfLive(prev.member);
      log(after + " (" + streak + " in a row) → the member it played is demoted for " + Math.round(DEMOTE_MS / M) + " min");
    } else {
      suspect = prev.member;
      log(after + " → the member it played is checked before it plays again");
    }
  }
  let served = null;
  try {
    if (r.kind !== "live") throw notLive();
    if (r.members) {
      const found = memberRefs(r.members);
      if (!found.length) throw kino.error("unavailable", en() ? "Xuper: this event is no longer listed" : "Xuper: este evento ya no está en la lista");
      const byId = new Map(found.filter((x) => x.id).map((x) => [x.ref, x.id]));
      const refs = found.map((x) => x.ref);
      const accts = new Set(refs.map(accountOfLive));
      let sib = null;
      const stored = async () => (sib = sib || (await siblingsOf(refs[0])));
      const tried = new Set();
      // Every member on one account: the same channel on other panels from the stored lists, composed only once that
      // account was passed over (a first open and the zapping preheat of a channel that answers never pay for it).
      const oneAcct = accts.size === 1 && !accts.has(null) ? [...accts][0] : null;
      const others = oneAcct ? async () => {
        const more = (await stored()).filter((x) => !refs.includes(x) && !!accountOfLive(x) && accountOfLive(x) !== oneAcct);
        if (more.length) log("resolve " + tag + ": every member on one account; + " + more.length + " on other panels (stored)");
        for (const x of more) tried.add(x);
        return more;
      } : null;
      try {
        const out = await playCandidates(refs, tag, suspect, byId, refusedAcct, others, again);
        served = out.member;
        return out.stream;
      } catch (e) {
        // every member failed: the same channel's other copies on other accounts in the stored lists, if any
        if (![...accts].some(Boolean)) throw e;
        const more = (await stored()).filter((x) => !refs.includes(x) && !tried.has(x) && !!accountOfLive(x));
        if (!more.length) throw e;
        log("resolve " + tag + ": every member failed, trying " + more.length + " stored copies on other accounts");
        const out = await playCandidates(more, tag);
        served = out.member;
        return out.stream;
      }
    }
    let refs = [String(ref), ...extra];
    const own = sourceById(r.source);
    const drmOnly = !!own && !!own.drm && !drmDeclared;   // its own stream would be refused: a sibling plays instead
    if ((again || drmOnly) && !extra.length) refs = refs.concat(await siblingsOf(String(ref)));
    try {
      const out = await playCandidates(refs, tag, suspect, null, refusedAcct, null, again);
      served = out.member;
      return out.stream;
    } catch (e) {
      if (refs.length > 1) throw e;
      const sib = await siblingsOf(String(ref));
      if (!sib.length) throw e;
      log("resolve " + tag + ": failed, trying " + sib.length + " stored sibling(s)");
      ls.demote(String(ref), DEMOTE_MS);
      const out = await playCandidates(sib, tag);
      served = out.member;
      return out.stream;
    }
  } finally {
    ls.markResolved(key, served, streak);
  }
}
