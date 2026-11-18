// data.js — the published catalog and matches on the device: read without network, revalidate in calls that
// happen anyway (screen `open`, `home()`, a person's reload, the Fútbol clock).
//
// Layers: L0 = this module's memory (the parsed v2 object, per runtime); L1 = `storageLarge` text values:
//   o2:cat / o2:catm   catalog v2 text + meta {h, gen, etag, lm, src: "raw"|"rel", checkedAt, failAt, failN}
//   o2:mat / o2:matm   matches v2 text + meta (same shape)
//   o2:ix  / o2:ixm    phase-2 index text + meta {etag, lm, checkedAt, missingUntil, failAt, failN}
// Reads (`catalog()`, `matches()`) never touch the network: L0, else one synchronous L1 read + parse per runtime.
//
// `revalidate({catalog, matches, force})`, per part, only when due (TTL elapsed and not in the failure backoff;
// always when nothing is stored; `force` = a person's reload):
//   1. phase 2 (skipped while `missingUntil` is ahead): GET DATA_BASE/index.json (If-None-Match). 304 → fresh.
//      200 → parse (schema 2, minPlugin ≤ ours, each `h` checked against ^[0-9a-f]{12}$); a part whose `h` differs
//      from the stored hash is fetched from v2/<c|m>/<h>.json (immutable), validated, hash-checked and stored.
//      404 or an unusable index → missingUntil = now + 6 h, then step 2. Other errors (timeout, DNS, 429, 5xx) →
//      backoff; with a copy stored, last-good is served only while the data branch is known to work (an index was
//      stored before, not a person's reload, fewer than 3 failed probes in a row); otherwise step 2, which its own
//      TTL and backoff gate, so a raw that keeps failing never freezes the catalog and the matches.
//   2. Release (phase 1, and the fallback): GET RELEASE_BASE/<home|matches>.json with If-None-Match (when the
//      stored copy came from the Release). 304 → fresh. 200 → native decode, convert to v2, validate, hash;
//      the text is rewritten only when the hash changed.
// Writes: data text first, then meta (the meta's hash and validators move only once the text is stored). A file named
// by a freshly probed index is authoritative (a publisher revert reuses an old file with its old `gen`); a Release
// copy never replaces a newer `gen`; and nothing replaces what another runtime committed after this call began (a
// timed-out runtime keeps running and could otherwise write after a fresher one: `writtenAt` in the meta).
// Budget: 16 s per call by default (Kino cuts screenEvent / home at 20 s); a tick asks for less (`budgetMs`).
import { DATA_BASE, RELEASE_BASE, PLUGIN_VERSION } from "./config.js";
import { once, callStartedAt, callSeq, saneAt, CLOCK_SKEW_MS } from "./flight.js";
import { getText, getJson, setText, setJson, remove } from "./store.js";
import { condGet } from "./net.js";
import { authed } from "./api.js";
import {
  SCHEMA, fromLegacyHome, fromLegacyMatches, validateCatalog, validateMatches, canonicalHash, seal, sectionView,
} from "./v2.js";

const MIN = 60 * 1000;
export const KEYS = { cat: "o2:cat", catm: "o2:catm", mat: "o2:mat", matm: "o2:matm", ix: "o2:ix", ixm: "o2:ixm" };
const INDEX_MISSING_MS = 6 * 60 * MIN;
const INDEX_FAILS_BEFORE_RELEASE = 3;     // phase 2: consecutive failed probes before the Release is consulted
const PART_RETRY_MS = 60 * 1000;          // a hashed file that 404s (raw replicating across POPs): retry soon
const BACKOFF_MS = [1, 5, 15, 60].map((m) => m * MIN);
const CALL_BUDGET_MS = 16000;             // screenEvent / home are cut at 20 s: leave room to decode and store
const FALLBACK_MAX_MS = 8000;             // the screen's backend /section fallback: at most this per request,
const FALLBACK_MIN_MS = 1500;             // skipped when less than this is left of the call's budget,
const FALLBACK_RETRY_MS = 60 * 1000;      // and not asked again for a minute after it failed (per runtime)
const H12 = /^[0-9a-f]{12}$/;

const PARTS = {
  catalog: {
    key: KEYS.cat, meta: KEYS.catm, dir: "c", asset: "home.json", relTtl: 60 * MIN,
    // The revision of this device-side conversion, kept in the meta as `b`. A Release copy built by an older one is
    // downloaded in full and converted again once (releasePart). 2 = the rails carry their «Ver más» ref (3.0.1).
    build: 2,
    fromLegacy: (j) => fromLegacyHome(j, { poster: "recommended" }),
    validate: validateCatalog,
    shape: (v) => !!v && v.schema === SCHEMA && Array.isArray(v.items) && !!v.sections && typeof v.sections === "object",
  },
  matches: {
    key: KEYS.mat, meta: KEYS.matm, dir: "m", asset: "matches.json", relTtl: 30 * MIN,
    fromLegacy: fromLegacyMatches,
    validate: validateMatches,
    shape: (v) => !!v && v.schema === SCHEMA && Array.isArray(v.matches),
  },
};

const L0 = { catalog: null, matches: null };   // { h, v }
const _fallback = new Map();                    // section name → one-section v2 from the backend (never stored)
const _fallbackFailAt = new Map();              // section name → when its fallback last failed (this runtime)
const _committedIn = {};                        // part → the call (callSeq) in which this runtime last committed it

function log(m) { try { kino.log("data: " + m); } catch (_) { /* no log */ } }
const sha256 = (t) => kino.crypto.hash("sha256", t);
const backoffMs = (n) => BACKOFF_MS[Math.min(Math.max(n | 0, 1), BACKOFF_MS.length) - 1];
const inBackoff = (m, now) => { const f = saneAt(m && m.failAt, now); return !!f && now - f < backoffMs(m.failN); };
/** `now - stamp >= ttl`, where a missing or future stamp (a clock set back) counts as due. */
const dueSince = (stamp, ttl, now) => { const t = saneAt(stamp, now); return !t || now - t >= ttl; };
/** The index is known to be missing (a 404 or unusable index, 6 h); a stamp further ahead is a clock set back. */
const indexMissing = (ixm, now) => {
  const u = Number(ixm && ixm.missingUntil) || 0;
  return u > now && u - now <= INDEX_MISSING_MS + CLOCK_SKEW_MS;
};

// This call's budget: 16 s unless the caller asked for less (`revalidate({ budgetMs })`, a screen tick). Scoped to the
// call like src/liveGate.js: a new call starts from the full budget again.
let _budget = { seq: -1, ms: CALL_BUDGET_MS };
const callBudgetMs = () => (_budget.seq === callSeq() ? _budget.ms : CALL_BUDGET_MS);
function tightenBudget(ms) { _budget = { seq: callSeq(), ms: Math.min(callBudgetMs(), ms) }; }
const remaining = () => callStartedAt() + callBudgetMs() - Date.now();
const budget = (max) => Math.max(1000, Math.min(max, remaining()));

// ── reads (no network) ──

function read(name) {
  const p = PARTS[name];
  const m = getJson(p.meta);
  const l0 = L0[name];
  if (l0 && (!m || !m.h || m.h === l0.h)) return l0.v;
  const t = getText(p.key);
  if (t === null) return l0 ? l0.v : null;
  let v;
  try { v = JSON.parse(t); } catch (_) { v = null; }
  if (!p.shape(v)) {
    remove(p.key);
    return l0 ? l0.v : null;
  }
  L0[name] = { h: String(v.hash || (m && m.h) || ""), v };
  return v;
}

/** The v2 catalog (L0, else L1), or null when nothing was ever stored. Never touches the network. */
export function catalog() { return read("catalog"); }

/** The v2 matches payload (L0, else L1), or null. Never touches the network. */
export function matches() { return read("matches"); }

/** A short token that changes whenever the stored catalog or matches change (the screen's `rev`). */
export function rev() {
  const c = getJson(KEYS.catm), m = getJson(KEYS.matm);
  return String((c && c.h) || "-").slice(0, 8) + "." + String((m && m.h) || "-").slice(0, 8);
}

/** For the Config tab: when each part was last checked and generated (epoch ms), or null when none is stored. */
export function dataAges() {
  const out = {};
  for (const name of Object.keys(PARTS)) {
    const m = getJson(PARTS[name].meta);
    out[name] = m && m.h ? { checkedAt: Number(m.checkedAt) || 0, gen: Number(m.gen) || 0, src: m.src || "" } : null;
  }
  return out;
}

// ── revalidation ──

/**
 * Revalidates the parts asked for, each only when due (always with `force`, or when nothing is stored).
 * `budgetMs`: this call's time for it (default 16 s; the Fútbol clock tick passes 4 s so it never holds the screen).
 * Never throws. → { changed, rev }: `changed` when a stored part's hash changed in this call.
 */
export async function revalidate(opts) {
  const o = opts || {};
  if (o.budgetMs > 0) tightenBudget(o.budgetMs);
  const want = Object.keys(PARTS).filter((n) => o[n]);
  if (!want.length) return { changed: false, rev: rev() };
  const metaH = (n) => { const m = getJson(PARTS[n].meta); return (m && m.h) || ""; };
  const before = want.map(metaH);
  const force = !!o.force;
  await Promise.all(want.map((n) => once("rv:" + n, () => revalPart(n, force), { force }).catch((e) => {
    log("revalidate " + n + " failed: " + ((e && (e.code || e.message)) || e));
  })));
  const changed = want.some((n, i) => metaH(n) !== before[i]);
  return { changed, rev: rev() };
}

async function revalPart(name, force) {
  const now = Date.now();
  const stored = !!read(name);
  const ixm = getJson(KEYS.ixm) || {};
  if (!indexMissing(ixm, now)) {
    // One probe per call (a forced one has its own key, shared by both parts of a reload).
    const ix = await once(force ? "ix!" : "ix", () => probeIndex(force));
    if (ix.ok) {
      const entry = ix.index[name];
      if (entry) {
        const m = getJson(PARTS[name].meta) || {};
        if (stored && m.h && m.h.slice(0, 12) === entry.h) {
          if (ix.probed) patchMeta(name, (cur) => (cur.h === m.h ? { ...cur, src: "raw", checkedAt: now, failAt: 0, failN: 0 } : null));
          return;
        }
        // Only an index fetched in this call is authoritative (a revert names an old file with an old `gen`); one
        // served from storage inside the probe backoff may be older than what the Release stored since.
        const r = await fetchPart(name, entry.h, force || !stored, !!ix.probed);
        if (r === "ok" || stored) return;
      }
      // The index lists no such part (or its file failed with nothing stored): the Release has it.
    } else if (!ix.missing && stored && lastGoodOnIndexError(force)) {
      return;
    }
  }
  await releasePart(name, force);
}

/**
 * After a failed index probe (not a 404) with a copy stored: serve last-good only while the data branch is known to
 * work — an index was stored before (phase 2), this is not a person's reload, and raw failed fewer than 3 probes in a
 * row. Otherwise the Release decides (its own TTL and backoff), so a raw.githubusercontent.com that keeps failing
 * (a DNS block, a carrier's persistent 429) never freezes the catalog and the matches, and a raw blip in phase 2
 * adds no request. Phase 1 never stores an index, so there a raw error means "use the Release".
 */
function lastGoodOnIndexError(force) {
  if (force || !parseIndex(getText(KEYS.ix))) return false;
  const ixm = getJson(KEYS.ixm) || {};
  return (ixm.failN | 0) < INDEX_FAILS_BEFORE_RELEASE;
}

/** Semver-ish "a.b.c" ≤ "x.y.z". */
function versionLe(a, b) {
  const pa = String(a || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0); }
  return true;
}

/** index.json text → { probeS, catalog?: {h}, matches?: {h}, live? } or null when unusable for this plugin. */
export function parseIndex(text) {
  if (typeof text !== "string" || !text) return null;
  let j;
  try { j = JSON.parse(text); } catch (_) { return null; }
  if (!j || typeof j !== "object" || j.schema !== SCHEMA) return null;
  if (j.minPlugin && !versionLe(j.minPlugin, PLUGIN_VERSION)) return null;
  const out = { probeS: Number(j.probeS) || 300 };
  for (const k of Object.keys(PARTS)) {
    const e = j[k];
    if (e && typeof e === "object" && H12.test(String(e.h || ""))) out[k] = { h: String(e.h) };
  }
  if (j.live && typeof j.live === "object") out.live = j.live;
  return out;
}

const probeMsOf = (ix) => Math.min(3600, Math.max(60, Number(ix && ix.probeS) || 300)) * 1000;

async function probeIndex(force) {
  const now = Date.now();
  const ixm = getJson(KEYS.ixm) || {};
  if (indexMissing(ixm, now)) return { ok: false, missing: true };
  const storedText = getText(KEYS.ix);
  const stored = parseIndex(storedText);
  const due = force || ((!stored || dueSince(ixm.checkedAt, probeMsOf(stored), now)) && !inBackoff(ixm, now));
  if (!due) return stored ? { ok: true, index: stored, probed: false } : { ok: false, missing: false };
  if (remaining() < 1000) return stored ? { ok: true, index: stored, probed: false } : { ok: false, missing: false };
  const r = await condGet(DATA_BASE + "index.json", {
    etag: stored ? ixm.etag : "", lm: stored ? ixm.lm : "", timeoutMs: budget(stored ? 3000 : 6000),
  });
  if (r.status === 304 && stored) {
    setJson(KEYS.ixm, { ...ixm, checkedAt: now, failAt: 0, failN: 0, missingUntil: 0 });
    return { ok: true, index: stored, probed: true };
  }
  if (r.status === 200) {
    const ix = parseIndex(r.text);
    if (!ix) {
      log("index unusable (schema/minPlugin): Release for 6 h");
      setJson(KEYS.ixm, { ...ixm, checkedAt: now, missingUntil: now + INDEX_MISSING_MS });
      return { ok: false, missing: true };
    }
    if (r.text !== storedText) setText(KEYS.ix, r.text);
    setJson(KEYS.ixm, { etag: r.etag || "", lm: r.lm || "", checkedAt: now, missingUntil: 0, failAt: 0, failN: 0 });
    return { ok: true, index: ix, probed: true };
  }
  if (r.code === 404) {
    log("index 404: Release for 6 h");
    setJson(KEYS.ixm, { ...ixm, checkedAt: now, missingUntil: now + INDEX_MISSING_MS });
    return { ok: false, missing: true };
  }
  log("index failed: " + r.code);
  setJson(KEYS.ixm, { ...ixm, failAt: now, failN: (ixm.failN | 0) + 1 });
  return { ok: false, missing: false };
}

async function fetchPart(name, h, force, authoritative) {
  const p = PARTS[name];
  const now = Date.now();
  const m = getJson(p.meta) || {};
  if (!force && m.failH === h && inBackoff(m, now)) return "skip";
  if (remaining() < 1000) return "skip";
  const r = await condGet(DATA_BASE + "v2/" + p.dir + "/" + h + ".json", { timeoutMs: budget(8000) });
  let v = null, why = "";
  if (r.status === 200) {
    try { v = JSON.parse(r.text); } catch (_) { why = "parse"; }
    if (v) {
      const errs = p.validate(v);
      if (errs.length) why = "invalid: " + errs.slice(0, 3).join("; ");
      else if (canonicalHash(v, sha256) !== v.hash || String(v.hash).slice(0, 12) !== h) why = "hash mismatch";
    }
  } else {
    why = "http " + r.code;
    if (r.code === 404) {
      // Not replicated yet: probe the index again in about a minute instead of a full probe interval.
      const ixm = getJson(KEYS.ixm) || {};
      const ix = parseIndex(getText(KEYS.ix));
      setJson(KEYS.ixm, { ...ixm, checkedAt: now - probeMsOf(ix) + PART_RETRY_MS });
    }
  }
  if (!why && !v) why = "not an object";
  if (!why) why = commit(name, r.text, v, { src: "raw", etag: "", lm: "", checkedAt: now }, authoritative);
  if (why) {
    // A refused file (invalid, or not stored) is not fetched again on every call: it waits out the backoff.
    log(name + " v2/" + p.dir + "/" + h + " failed: " + why);
    patchMeta(name, (cur) => ({ ...cur, failH: h, failAt: now, failN: (cur.failN | 0) + 1 }));
    return "fail";
  }
  return "ok";
}

async function releasePart(name, force) {
  const p = PARTS[name];
  const now = Date.now();
  const m = getJson(p.meta) || {};
  const have = read(name);
  // A copy an older conversion built (3.0.0's rails had no «Ver más») is fetched again in full, without its ETag, and
  // converted once, instead of waiting up to 12 h for the publisher's next file. It still waits out a failure's backoff.
  const rebuild = !!have && m.src === "rel" && (Number(m.b) || 0) < (p.build || 0);
  const due = force || !have || ((rebuild || dueSince(m.checkedAt, p.relTtl, now)) && !inBackoff(m, now));
  if (!due || remaining() < 1000) return;
  const fromRel = !!have && m.src === "rel" && !rebuild;
  const r = await condGet(RELEASE_BASE + "/" + p.asset, {
    etag: fromRel ? m.etag : "", lm: fromRel ? m.lm : "",
    // Kino applies the timeout per hop (github.com 302, then the asset): keep two hops inside the call budget.
    timeoutMs: budget(Math.min(have ? 5000 : 8000, Math.floor(remaining() / 2))),
  });
  if (r.status === 304 && fromRel) {
    patchMeta(name, (cur) => (cur.h === m.h ? { ...cur, checkedAt: now, failAt: 0, failN: 0 } : null));
    return;
  }
  let v = null, why = "";
  if (r.status === 200) {
    let legacy = null;
    try { legacy = JSON.parse(r.text); } catch (_) { why = "parse"; }
    if (legacy) {
      try {
        v = seal(p.fromLegacy(legacy), Number(legacy.generatedAt) || 0, sha256);
        const errs = p.validate(v);
        if (errs.length) why = "invalid: " + errs.slice(0, 3).join("; ");
      } catch (e) { why = "convert: " + ((e && e.message) || e); }
    }
  } else {
    why = "http " + r.code;
  }
  if (!why && !v) why = "not an object";
  if (!why) why = commit(name, JSON.stringify(v), v, { src: "rel", etag: r.etag || "", lm: r.lm || "", checkedAt: now, b: p.build || 0 }, false);
  if (why) {
    log(name + " release failed: " + why);
    patchMeta(name, (cur) => ({ ...cur, failAt: now, failN: (cur.failN | 0) + 1 }));
  }
}

/** Re-reads the meta and writes `fn(current)` (null = skip): a meta-only write never races a newer one blindly. */
function patchMeta(name, fn) {
  const p = PARTS[name];
  const cur = getJson(p.meta) || {};
  const next = fn(cur);
  if (next) setJson(p.meta, next);
}

/**
 * Stores a validated v2 part: text first (only when the hash changed), then meta. → "" when stored, else why not.
 * - Another runtime committed a different copy after this call began (`writtenAt`): skipped (the timed-out-runtime
 *   race; this runtime's own earlier commit in the same call does not count).
 * - Not `authoritative` (a Release copy, or an index served from storage) and older by `gen` than the stored copy:
 *   skipped. A file named by an index fetched in this call is authoritative: a publisher revert names an old file
 *   that keeps its old `gen`.
 * - The text write refused (storage full, too large): the stored copy and its meta (hash, ETag) stay as they were,
 *   so the next due revalidation downloads again instead of trusting a hash whose text was never stored. With
 *   nothing stored, this runtime keeps the new copy in memory.
 */
function commit(name, text, v, fields, authoritative) {
  const p = PARTS[name];
  const now = Date.now();
  const cur = getJson(p.meta) || {};
  const gen = Number(v.gen) || 0;
  if (cur.h && cur.h !== v.hash) {
    if (_committedIn[name] !== callSeq() && saneAt(cur.writtenAt, now) > callStartedAt()) {
      return "another runtime stored a newer copy after this call began";
    }
    if (!authoritative && (Number(cur.gen) || 0) > gen) return "older than the stored copy (gen " + gen + " < " + cur.gen + ")";
  }
  const have = read(name);
  const same = !!have && have.hash === v.hash;
  if (!same && !setText(p.key, text)) {
    if (!have) L0[name] = { h: v.hash, v };
    return "text not stored (storage refused it; " + (have ? "the stored copy stays" : "kept in memory only") + ")";
  }
  setJson(p.meta, {
    h: v.hash, gen: Math.max(gen, cur.h === v.hash ? Number(cur.gen) || 0 : 0),
    etag: fields.etag || "", lm: fields.lm || "", src: fields.src, checkedAt: fields.checkedAt, writtenAt: now,
    failAt: 0, failN: 0, ...(fields.b ? { b: fields.b } : {}),
  });
  _committedIn[name] = callSeq();
  L0[name] = { h: v.hash, v };
  return "";
}

// ── last resort for the screen: the backend's own /section (Bearer), never stored ──

/**
 * Loads one section from the backend into memory (only when nothing is stored and GitHub failed). Bounded by what is
 * left of this call's budget (at most 8 s; skipped under 1.5 s, e.g. after `open` spent it on GitHub), so the event
 * that asks always answers before Kino's 20 s screenEvent limit; a failure is not asked again for a minute in this
 * runtime, so tab taps do not each wait on it. → whether the section is now in memory.
 */
export async function loadFallbackSection(name) {
  if (_fallback.has(name)) return true;
  const failedAt = _fallbackFailAt.get(name) || 0;
  if (failedAt && Date.now() - failedAt < FALLBACK_RETRY_MS) return false;
  const left = remaining();
  if (left < FALLBACK_MIN_MS) return false;
  let data;
  try {
    data = await authed("GET", `/section/${encodeURIComponent(name)}?page=1&size=30`, undefined, Math.min(FALLBACK_MAX_MS, left));
  } catch (e) {
    _fallbackFailAt.set(name, Date.now());
    throw e;
  }
  const body = fromLegacyHome({ sections: { [name]: data } }, { poster: "recommended" });
  if (!body.sections[name]) return false;
  _fallback.set(name, body);
  return true;
}

/** The fallback view of a section, or null. */
export function fallbackSectionView(name) {
  const b = _fallback.get(name);
  return b ? sectionView(b, name) : null;
}

/** Test helper: forget L0 (a cold runtime). */
export function _resetMemory() {
  L0.catalog = null;
  L0.matches = null;
  _fallback.clear();
  _fallbackFailAt.clear();
  for (const k of Object.keys(_committedIn)) delete _committedIn[k];
}
