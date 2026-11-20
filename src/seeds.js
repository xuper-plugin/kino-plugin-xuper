// seeds.js — the Xuper connector's backup sessions ("seeds"), from the backend's GET /seed (seed design §2, §4; owner
// decisions D2–D6).
//
// A seed is a ready anonymous masnew guest session another device minted and shared. GET /seed hands each one out once,
// so the profile keeps the one it got (`o2:xseed`, until 2 min before its end) and reuses it on every call. The device's
// own anonymous guest session (src/sources/xuper.js) is always the primary: xuper.js asks here only when that session
// cannot be created or kept for a reason a seed gets around. A held seed ends at its renewal point (less than 30 min
// left, received at least 30 min ago, at most once per 30 min: `atEnd`): there the own session is tried once more, and
// only when it still fails for such a reason is the seed's replacement asked for (design §2; owner decision D3). So a
// device goes back to its own session once the block lifts, instead of renewing seeds for as long as it keeps watching.
// A GET goes out only when, besides:
//   - the call is Kino's `resolve`, `liveCategories` or `liveChannels` (a portal call about to go out for the person):
//     never Home, search, browse, episodes, the own screen and its timers, the contribution or install;
//   - no seed is held (or the held one is at its end), and no backoff is in force (429: until the next UTC hour;
//     503: 2→4→8→16→30 min; a failure or a bad answer: 1 min);
//   - this call asked fewer than 2 times (the first + one replacement for a seed dead on arrival), and fewer than 3
//     GETs went out in this UTC hour (taps included);
//   - at least GET_MIN_MS of the call is left: a GET cut by the call's own deadline would still cost a one-use seed;
//   - no other runtime of the plugin is asking right now (`o2:xseedLease`, 15 s), and no other caller of this runtime
//     (`inflight`: a renewal and a replacement in one call share one GET).
// The GET is bare (the backend's sticky assignment: cheap, and it keeps harvesters out) except when a seed is to be
// told apart from the one this account holds: after the portal geo-blocked a seed (`fresh` in the state, until a seed
// lands) and on "Cambiar semilla". Those go out as GET /seed?fresh=1 (the backend gives a different seed and releases
// the old one; it counts against the account's 20 an hour like any GET).
// A person's "Cambiar semilla" tap has its own budget: one GET per 10 min, two per UTC hour, and never the hour's last
// of the three (kept for the automatic path, so taps never lock it out).
// Every limit here lives in kino.storage, and kino.storage is per profile (Kino keeps one plugin store per profile): a
// device with two profiles holds one seed per profile and has each profile's hour budget. Logs carry codes, counts and
// minutes only: never a seed's field.
import { fetchSeed } from "./api.js";
import { getJson, setJson, remove } from "./store.js";
import { once, saneAt, callSeq, callName } from "./flight.js";
import { timeoutFor, remaining } from "./liveGate.js";
import { lang } from "./config.js";

export const SEED_KEY = "o2:xseed";        // secret: { v, sn, userId, userToken, gotAt, lifeMs, expiresAt, mintedAt }
export const STATE_KEY = "o2:xseedSt";     // { need, needAt, back, hour, man, n503, lastOkAt, okGot, doa, renewAt, manualAt, fresh }
export const LEASE_KEY = "o2:xseedLease";  // { id, at }: another runtime is asking

const MIN = 60_000;
const H = 60 * MIN;
/** A held seed is used until this much of its life is left. */
export const MIN_USE_MS = 2 * MIN;
/** A seed's end (its renewal point): less than this left, received at least RENEW_EVERY_MS ago, once per RENEW_EVERY_MS. */
export const RENEW_LEFT_MS = 30 * MIN;
export const RENEW_EVERY_MS = 30 * MIN;
/**
 * GETs per profile per UTC hour, automatic and manual together (kino.storage, where the count lives, is per profile).
 * Up to 6 devices share one identity's 20 an hour: 6 × 3 = 18 holds only while each device runs one profile.
 */
export const AUTO_PER_HOUR = 3;
/** "Cambiar semilla": GETs per UTC hour, at least this long apart, and never the hour's last automatic one. */
export const MANUAL_PER_HOUR = 2;
export const MANUAL_GAP_MS = 10 * MIN;
/** GETs per plugin call: the first one + one replacement for a seed dead on arrival. */
export const PER_CALL = 2;
export const GET_MS = 5000;
/** A GET is not started with less of the call left (it would be cut, and still cost the seed the server popped). */
export const GET_MIN_MS = 3000;
export const LEASE_MS = 15_000;
const LEASE_WAIT_MS = 3000;
const LEASE_STEP_MS = 250;
const BACKOFF_503_MIN = [2, 4, 8, 16, 30];
const BACKOFF_SHORT_MS = MIN;
const MANUAL_503_GAP_MS = 15_000;
const JITTER_429_MS = 120_000;
const MAX_429_MS = 62 * MIN;
const MAX_BACK_MS = 63 * MIN;               // a stored backoff further ahead is a clock that was set back: none
/** The calls that may ask the backend for a seed. */
const ASKING_CALLS = new Set(["resolve", "liveCategories", "liveChannels"]);

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sleep = (ms) => (typeof kino !== "undefined" && kino && typeof kino.sleep === "function" ? kino.sleep(ms) : Promise.resolve());
const E = () => lang() === "en";

const WORD = /^[A-Za-z0-9_-]{1,24}$/;
/** A value fit for a log line: a short code or a whole number, else "?". */
export function word(v) {
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(Math.round(v)) : "?") : str(v);
  return WORD.test(s) ? s : "?";
}

/** `seed:<event> k=v…` (codes, counts and minutes only). `report`: also to Kino's error board (telemetry). */
function log(line, report) {
  try {
    if (report && kino.log && typeof kino.log.report === "function") kino.log.report(line);
    else kino.log(line);
  } catch (_) { /* a log line never fails a call */ }
}

// ── state ──

function readState() { const s = getJson(STATE_KEY); return isObj(s) ? s : {}; }
function writeState(patch) { const s = { ...readState(), ...patch }; setJson(STATE_KEY, s); return s; }

const hourWin = (now) => now - (now % H);
const hourCount = (st, now) => (isObj(st.hour) && st.hour.win === hourWin(now) ? Number(st.hour.n) || 0 : 0);
const manCount = (st, now) => (isObj(st.man) && st.man.win === hourWin(now) ? Number(st.man.n) || 0 : 0);
/** A GET that cost a seed or quota: counted in the hour (and, for a tap, in the taps' own budget). */
const counted = (st, now, manual) => ({
  hour: { win: hourWin(now), n: hourCount(st, now) + 1 },
  ...(manual ? { man: { win: hourWin(now), n: manCount(st, now) + 1, at: now } } : {}),
});
const toNextHour = (now) => hourWin(now) + H - now;

/**
 * Why a tap may not ask now, or null: the taps' own budget (contract-ux-F1). { why, ms }: "cap" (two taps this hour),
 * "reserve" (the hour's last GET is the automatic path's), "soon" (a tap less than 10 min ago).
 */
function manualBudget(st, now) {
  if (manCount(st, now) >= MANUAL_PER_HOUR) return { why: "cap", ms: toNextHour(now) };
  if (hourCount(st, now) >= AUTO_PER_HOUR - 1) return { why: "reserve", ms: toNextHour(now) };
  const at = isObj(st.man) ? saneAt(st.man.at, now) : 0;
  return at > 0 && now - at < MANUAL_GAP_MS ? { why: "soon", ms: MANUAL_GAP_MS - (now - at) } : null;
}

/** The backoff in force at `now` ({ until, why, n }), or null. */
function backoff(st, now) {
  const b = st.back;
  if (!isObj(b)) return null;
  const until = Number(b.until) || 0;
  return until > now && until - now <= MAX_BACK_MS ? { until, why: str(b.why), n: Number(b.n) || 1 } : null;
}

// ── the held seed ──

function readSeed() {
  const s = getJson(SEED_KEY);
  if (!isObj(s) || s.v !== 1) return null;
  const sn = str(s.sn), userId = str(s.userId), userToken = str(s.userToken);
  const gotAt = Number(s.gotAt), lifeMs = Number(s.lifeMs);
  if (!sn || !userId || !userToken || !(gotAt > 0) || !(lifeMs > 0)) return null;
  return { sn, userId, userToken, gotAt, lifeMs };
}

/** Life left at `now` (ms); Infinity when the receipt stamp is unknown (a clock that ran ahead, then was set back). */
function leftOf(s, now) {
  const got = saneAt(s.gotAt, now);
  return got === 0 ? Infinity : s.lifeMs - Math.max(0, now - got);
}

/** The seed this profile holds, while at least MIN_USE_MS of its life is left; else null. */
export function held(now = Date.now()) {
  const s = readSeed();
  return s && leftOf(s, now) >= MIN_USE_MS ? s : null;
}

/** Whether `a` and `b` are the same held seed (received at the same moment, the same token). */
const same = (a, b) => !!a && !!b && a.gotAt === b.gotAt && a.userToken === b.userToken;

/** Why the device is on the seed path ("geo" | "mint" | "dead"), or null. */
export function needOf() { const n = readState().need; return n === "geo" || n === "mint" || n === "dead" ? n : null; }

// ── per call ──

let perCall = { seq: -1, n: 0 };
const callCount = () => (perCall.seq === callSeq() ? perCall.n : 0);
const bumpCall = () => { perCall = { seq: callSeq(), n: callCount() + 1 }; };
let gen = 0;   // moves when a seed is dropped: the next need of the same call may ask again (its own flight)
let ending = { seq: -1, gotAt: 0 };   // the held seed that reached its end (renewal point) in this call
let inflight = null;                   // this runtime's GET /seed on the wire: every other asker waits for it

// ── the cross-runtime lease ──

let runtimeId = "";
const myId = () => runtimeId || (runtimeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
/** Test helper: this module now acts as another runtime of the plugin (a new lease id; storage is shared). */
export function _newRuntime() { runtimeId = ""; perCall = { seq: -1, n: 0 }; ending = { seq: -1, gotAt: 0 }; inflight = null; }

function foreignLease(now) {
  const l = getJson(LEASE_KEY);
  if (!isObj(l) || str(l.id) === myId()) return false;
  const at = saneAt(l.at, now);
  return at > 0 && now - at < LEASE_MS;
}

/**
 * Takes the lease (written, then read back). Another runtime holding it: waits up to 3 s (steps of 250 ms) for its seed.
 * → { ok: true } (ours) | { seed } (the other runtime's landed) | {} (go on without a seed this call).
 */
async function takeLease(now, replacing) {
  if (!foreignLease(now)) {
    setJson(LEASE_KEY, { id: myId(), at: now }, { ttlMs: LEASE_MS });
    const back = getJson(LEASE_KEY);
    if (isObj(back) && str(back.id) === myId()) return { ok: true };
  }
  for (let waited = 0; waited < LEASE_WAIT_MS; waited += LEASE_STEP_MS) {
    await sleep(LEASE_STEP_MS);
    const h = held();
    if (h && !same(h, replacing)) return { seed: h };
    if (!foreignLease(Date.now())) break;
  }
  const h = held();
  return h && !same(h, replacing) ? { seed: h } : {};
}

function dropLease() {
  const l = getJson(LEASE_KEY);
  if (isObj(l) && str(l.id) === myId()) remove(LEASE_KEY);
}

// ── GET /seed ──

const skip = (why, ms) => {
  log("seed:skip why=" + word(why) + (ms > 0 ? " min=" + Math.ceil(ms / MIN) : ""));
  return { seed: null, why, min: ms > 0 ? Math.ceil(ms / MIN) : 0 };
};

/**
 * The answer of this runtime's GET already on the wire, for another asker (seed-economy-F3): its seed when it brought
 * one that is not `replacing`; its failure otherwise (a seed it brought that is already gone counts as a bad one).
 */
async function joined(replacing) {
  const r = await inflight;
  const h = held();
  if (h && !same(h, replacing)) return { seed: h };
  return r && r.seed ? { seed: null, why: "bad", min: 0 } : r;
}

/**
 * One GET /seed under every limit. `mode`: "auto" (the session chain) | "manual" (the person's tap). `replacing`: the
 * held seed being replaced (a manual change, a seed at its end): another runtime's seed counts only when it is a new one.
 * → { seed } | { seed: null, why, min };
 *   why: call | call_cap | cap | reserve | soon | 429 | 503 | net | bad | lease | time | nobearer.
 */
async function ask(mode, replacing = null) {
  if (inflight) return joined(replacing);
  const now = Date.now();
  const manual = mode === "manual";
  if (!manual && !ASKING_CALLS.has(callName())) return skip("call");
  const st = readState();
  const back = backoff(st, now);
  if (back) {
    const bypass = manual && back.why === "503" && !(now - (saneAt(st.manualAt, now) || 0) < MANUAL_503_GAP_MS);
    if (!bypass) return skip(back.why, back.until - now);
  }
  if (manual) {
    const m = manualBudget(st, now);
    if (m) return skip(m.why, m.ms);
  } else {
    if (callCount() >= PER_CALL) return skip("call_cap");
    if (hourCount(st, now) >= AUTO_PER_HOUR) return skip("cap", toNextHour(now));
  }
  if (remaining() < GET_MIN_MS) return skip("time");   // free; a GET cut by the deadline would still cost the seed
  const lease = await takeLease(now, replacing);
  if (lease.seed) return { seed: lease.seed };
  if (!lease.ok) return skip("lease");
  if (inflight) return joined(replacing);   // another caller of this runtime started one meanwhile (the lease is shared)
  let timeoutMs;
  try { timeoutMs = timeoutFor(GET_MS); } catch (_) { dropLease(); return skip("time"); }
  bumpCall();
  if (manual) writeState({ manualAt: now });
  const fresh = manual || readState().fresh === true;
  const flight = (async () => {
    let r;
    try { r = await fetchSeed(timeoutMs, fresh); } catch (_) { r = { ok: false, status: "network" }; }
    dropLease();
    return landed(r, manual, fresh);
  })();
  inflight = flight;
  try { return await flight; } finally { if (inflight === flight) inflight = null; }
}

/** Stores what GET /seed answered and sets the backoff. */
function landed(r, manual, fresh) {
  const now = Date.now();
  const st = readState();
  if (r && r.ok) {
    setJson(SEED_KEY, {
      v: 1, sn: r.seed.sn, userId: r.seed.userId, userToken: r.seed.userToken,
      gotAt: now, lifeMs: r.lifeMs, expiresAt: r.expiresAt || 0, ...(r.seed.mintedAt ? { mintedAt: r.seed.mintedAt } : {}),
    }, { ttlMs: r.lifeMs });
    writeState({ back: null, n503: 0, lastOkAt: now, fresh: false, ...counted(st, now, manual) });
    log("seed:get ok life_min=" + Math.round(r.lifeMs / MIN) + (manual ? " manual=1" : "") + (fresh ? " fresh=1" : ""), true);
    const s = readSeed();
    return s ? { seed: s } : { seed: null, why: "bad", min: 0 };   // storage refused it: nothing to use
  }
  const status = r ? r.status : "network";
  let back = null;
  let patch = {};
  let why;
  if (status === 401 || status === "nobearer") {
    why = "nobearer";   // api.js dropped the Bearer (401) and set o2:relogin: nothing asks until the screen signs in
  } else if (status === 429) {
    why = "429";
    const until = Math.min(hourWin(now) + H + Math.floor(Math.random() * JITTER_429_MS), now + MAX_429_MS);
    back = { until, why, n: 1 };
    patch = counted(st, now, manual);
  } else if (status === 503) {
    why = "503";
    const n = (Number(st.n503) || 0) + 1;
    back = { until: now + BACKOFF_503_MIN[Math.min(n, BACKOFF_503_MIN.length) - 1] * MIN, why, n };
    patch = { n503: n };   // refunded by the backend: not counted
  } else {
    why = status === "network" ? "net" : "bad";
    back = { until: now + BACKOFF_SHORT_MS, why, n: 1 };
    patch = counted(st, now, manual);   // a timeout may come after the server popped the seed
  }
  writeState({ ...patch, ...(back ? { back } : {}) });
  const min = back ? Math.ceil((back.until - now) / MIN) : 0;
  log("seed:get fail status=" + word(status) + (min ? " back_min=" + min : "") + (manual ? " manual=1" : "") + (fresh ? " fresh=1" : ""), true);
  return { seed: null, why, min };
}

// ── what src/sources/xuper.js uses ──

/** Whether seed `h` is the one that reached its end in this call. */
const endingNow = (h) => !!h && ending.seq === callSeq() && ending.gotAt === h.gotAt;

/**
 * Whether held seed `h` is at its end in this call (design §2, §4; D3): less than 30 min left, received at least 30 min
 * ago, no end in the last 30 min, and a call that may ask. Its end is where the own session is tried once more before
 * the replacement is asked for (seed-economy-F1); `h` stays the fallback until its 2 min floor. Every caller of the call
 * reads the same answer.
 */
export function atEnd(h) {
  if (endingNow(h)) return true;
  const now = Date.now();
  const got = saneAt(h.gotAt, now);
  if (got === 0 || !(leftOf(h, now) < RENEW_LEFT_MS) || now - got < RENEW_EVERY_MS) return false;
  if (!ASKING_CALLS.has(callName())) return false;
  const last = saneAt(readState().renewAt, now);
  if (last > 0 && now - last < RENEW_EVERY_MS) return false;
  writeState({ renewAt: now });
  ending = { seq: callSeq(), gotAt: h.gotAt };
  log("seed:renew left_min=" + Math.max(0, Math.floor(leftOf(h, now) / MIN)));
  return true;
}

/**
 * A seed for this call because the own session failed for `reason` ("geo" | "mint" | "dead"): the held one, else (none,
 * or the held one is at its end) one GET shared by every caller of this call. A replacement that brings nothing keeps
 * the seed at its end until its floor. → { seed } | { seed: null, why, min }.
 */
export function need(reason) {
  const st = readState();
  if (st.need !== reason) writeState({ need: reason, needAt: Date.now() });
  const h = held();
  if (h && !endingNow(h)) return Promise.resolve({ seed: h });
  return once("seeds:get:" + gen, async () => {
    const cur = held();
    if (cur && !endingNow(cur)) return { seed: cur };
    const r = await ask("auto", cur);
    if (r.seed) return r;
    const kept = held();
    return kept && same(kept, cur) ? { seed: kept } : r;
  });
}

/**
 * Drops seed `s` (the portal refused it: dead, or blocked where it was minted). Only while it is still the held one (a
 * concurrent caller may have replaced it). A seed that never answered content counts as dead on arrival (`doa`).
 */
export function drop(s, why) {
  const cur = readSeed();
  if (!same(cur, s)) return false;
  remove(SEED_KEY);
  gen++;
  const st = readState();
  const doa = st.okGot !== s.gotAt;
  if (doa) writeState({ doa: (Number(st.doa) || 0) + 1 });
  if (why === "geo") writeState({ fresh: true });
  log("seed:drop why=" + word(why) + " doa=" + (doa ? 1 : 0), doa);
  return true;
}

/** Content answered on seed `s`: it is not dead on arrival. */
export function seedOk(s) {
  const st = readState();
  if (st.okGot !== s.gotAt) writeState({ okGot: s.gotAt });
}

/**
 * Content answered on the device's own session: off the seed path. A seed at its end in this call is no longer needed
 * (the own session answered where it was tried once more): it is retired, never sent again.
 */
export function ownOk() {
  if (readState().need) { writeState({ need: null, needAt: null }); log("seed:need clear"); }
  const h = readSeed();
  if (endingNow(h)) { remove(SEED_KEY); gen++; log("seed:end why=own"); }
}

/**
 * For the Ajustes card: `kind` "seed" | "own" | "none", `leftMin` (null when unknown), `geo` (Xuper blocks the region),
 * `wait` { why: "503" | "429" | "cap", min } | null.
 */
export function status(ownHeld, now = Date.now()) {
  const h = held(now);
  const st = readState();
  const back = backoff(st, now);
  const minTo = (until) => Math.max(1, Math.ceil((until - now) / MIN));
  let wait = null;
  if (back && (back.why === "503" || back.why === "429")) wait = { why: back.why, min: minTo(back.until) };
  else if (hourCount(st, now) >= AUTO_PER_HOUR) wait = { why: "cap", min: minTo(hourWin(now) + H) };
  const left = h ? leftOf(h, now) : 0;
  return {
    kind: h ? "seed" : ownHeld ? "own" : "none",
    leftMin: h ? (Number.isFinite(left) ? Math.max(0, Math.floor(left / MIN)) : null) : 0,
    geo: st.need === "geo",
    wait,
  };
}

/**
 * The person's "Cambiar semilla" (only while on a seed, D6): at most one GET per tap, within the taps' own budget; the
 * held seed stays when it fails.
 * → { result: "ok" | "noseed" | "busy" | "hour" | "used" | "soon" | "offline" | "nobearer", min? }.
 */
export async function manualChange() {
  const h = held();
  if (!h) return { result: "noseed" };
  const r = await ask("manual", h);
  if (r.seed && !same(r.seed, h)) return { result: "ok" };
  switch (r.why) {
    case "429": case "cap": return { result: "hour", min: r.min || 1 };
    case "reserve": return { result: "used", min: r.min || 1 };
    case "soon": return { result: "soon", min: r.min || 1 };
    case "nobearer": return { result: "nobearer" };
    case "net": case "time": return { result: "offline" };
    default: return { result: "busy" };   // 503, a bad answer, another runtime asking
  }
}

// ── what the person reads when no seed comes (design §5, ES + EN) ──

/** The sentence for a call that needed a seed for `reason` and got answer `r` (null: Kino's own line stays). */
export function noSeedText(reason, r) {
  const en = E();
  const why = r && r.why;
  if (why === "call") return null;
  if (why === "call_cap" || why === "bad") {
    return en ? "The backup sessions did not work either right now. Try again in a while."
      : "Las sesiones de respaldo tampoco funcionaron ahora. Vuelve a intentar en un rato.";
  }
  const p = reason === "geo"
    ? (en ? "Xuper blocks your region" : "Xuper bloquea tu zona")
    : (en ? "Xuper does not open a session on this device" : "Xuper no abre una sesión en este aparato");
  switch (why) {
    case "503": return en ? `${p} and there are no free backup sessions right now. Try again in a few minutes.`
      : `${p} y ahora no hay sesiones de respaldo libres. Vuelve a intentar en unos minutos.`;
    case "429": case "cap": {
      const n = Math.max(1, Number(r.min) || 1);
      return en ? `${p} and this hour's backup sessions are used up. Try again in ${n} min.`
        : `${p} y ya se usaron las sesiones de respaldo de esta hora. Vuelve a intentar en ${n} min.`;
    }
    case "nobearer": return en ? `${p}. Open the Xuper screen to reconnect and use a backup session.`
      : `${p}. Abre la pantalla de Xuper para reconectarte y usar una sesión de respaldo.`;
    case "net": return en ? `${p} and a backup session could not be requested. Check your connection and try again.`
      : `${p} y no se pudo pedir una sesión de respaldo. Revisa tu conexión e inténtalo de nuevo.`;
    default: return en ? `${p}. Try again in a few seconds.` : `${p}. Vuelve a intentar en unos segundos.`;   // lease, time
  }
}
