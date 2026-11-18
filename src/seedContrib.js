// seedContrib.js — the anonymous seed contribution, ported 1:1 from the old kino-plugin-xuper (src/seedContrib.js,
// seed design §6). A device that can create a WORKING anonymous masnew guest session now and then shares ONE fresh such
// session through `kino.seed` (Kino 0.9.55+), which Kino sends to its error board as `seed:contrib` only while the
// plugin's telemetry consent is on; the owner's collector loads it into the pool GET /seed hands out.
//
// The session carries NOTHING about the person: a brand-new anonymous device (its own fingerprint, sn ""), never the
// person's own session or device, checked before it is sent (it must read a catalog column).
//
// Strictly gated, and bounded by the Home that pays for it (Kino hands Home's rows over only once every fetch started in
// the call has settled, so the mint ends by HOME_CONTRIB_END_MS from Home's start and takes at most CONTRIB_WINDOW_MS):
//   consent  — the plugin-telemetry consent (host side) AND the `contributeSeeds` setting (default on);
//   rate     — at most one try per profile every CONTRIB_INTERVAL_MS (`o2:contribAt`, stamped before the mint);
//   time     — not tried with less than MIN_WINDOW_MS left (and the window is not stamped);
//   gate     — the Bearer and a STORED portal secret (src/sources/xuper.js portalReady); without them nothing is
//              stamped either, and nothing is fetched: Home never waits on the backend for a contribution.
// Never throws, never fails Home, never asks the backend for a seed or the portal secret.
import { mintAnonymous, portalReady } from "./sources/xuper.js";
import { within } from "./liveGate.js";
import { getText, setText } from "./store.js";

/** At most one try per profile in this window (`o2:contribAt` lives in kino.storage, which Kino keeps per profile). */
export const CONTRIB_INTERVAL_MS = 3 * 3600_000;
export const VALIDATE_COLUMN = "masnew_movies";
const REQUEST_MS = 10_000;
const TOTAL_MS = 25_000;
export const HOME_CONTRIB_END_MS = 15_000;
export const CONTRIB_WINDOW_MS = 8_000;
const MIN_WINDOW_MS = 4_000;
export const AT_KEY = "o2:contribAt";
const CONTRIBUTE_SETTING = "contributeSeeds";

// The anonymous-seed shape kino.seed accepts and the pool keeps. Required three plus jwtToken (the collector reads its
// `exp`) and mintedAt; the portal's own extras ride along when present.
const OPTIONAL_EXTRAS = ["customer", "activeTime", "availableTime"];

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const WORD = /^[A-Za-z0-9_-]{1,24}$/;

function trace(event, fields) {
  const parts = ["seed_contrib", event];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === undefined || v === null) continue;
    const s = typeof v === "boolean" ? (v ? "1" : "0") : str(v);
    parts.push(k + "=" + (WORD.test(s) ? s : "?"));
  }
  try { kino.log(parts.join(" ")); } catch (_) { /* a breadcrumb never fails a call */ }
}

/** A getNextColumns answer that actually carries catalog data (real data, not an empty envelope). */
function hasRealData(col) {
  if (col === null || typeof col !== "object") return false;
  if (Array.isArray(col)) return col.length > 0;
  return Object.keys(col).length > 0;
}

const enabled = () => {
  try { return kino.config.get(CONTRIBUTE_SETTING) !== false; } catch (_) { return true; }
};
const readAt = () => { const v = Number(getText(AT_KEY)); return Number.isFinite(v) && v > 0 ? v : null; };

/** For the Ajustes card: `on` (the person's setting) and `at` (the last contribution's window stamp, or null). */
export function contribInfo() { return { on: enabled(), at: readAt() }; }

function buildSeed(sn, act) {
  const seed = {
    sn,
    userId: str(act.userId),
    userToken: str(act.userToken),
    jwtToken: str(act.jwtToken || ""),
    mintedAt: Math.floor(Date.now() / 1000),
  };
  // The portal's own session extras, when it returns them: strings or finite numbers only.
  for (const k of OPTIONAL_EXTRAS) {
    const v = act[k];
    if (typeof v === "string" && v !== "") seed[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) seed[k] = v;
  }
  return seed;
}

let running = false;   // a second Home while one contribution is in flight must not start another

/**
 * One opportunity: maybe mint and contribute one fresh anonymous session, every portal request ending by `deadline`
 * (epoch ms; none: TOTAL_MS from now). Best-effort, never throws. → the seed it sent, or null.
 */
export async function maybeContribute({ deadline = Infinity } = {}) {
  if (running) return null;
  running = true;
  try {
    if (typeof kino.seed !== "function") return null;
    if (!enabled()) { trace("skip", { why: "off" }); return null; }
    const now = Date.now();
    const last = readAt();
    if (last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS) { trace("skip", { why: "rate" }); return null; }
    const end = Math.min(now + TOTAL_MS, Number.isFinite(deadline) ? deadline : Infinity);
    if (end - now < MIN_WINDOW_MS) { trace("skip", { why: "time" }); return null; }
    return await within(end - now, async () => {
      if (!(await portalReady())) { trace("skip", { why: "nokey" }); return null; }
      // Eligible: the window starts whether or not the mint works, so a blocked device tries at most once per interval.
      setText(AT_KEY, String(now));
      const m = await mintAnonymous({ requestMs: REQUEST_MS, validateColumn: VALIDATE_COLUMN });
      if (!m.ok) { trace("mint", { ok: false, why: m.why, code: m.code }); return null; }
      // The hard gate: the fresh session must read the column; a geo-blocked or dead one never is contributed.
      if (!hasRealData(m.col)) { trace("validate", { ok: false, why: "empty" }); return null; }
      const seed = buildSeed(m.sn, m.act);
      try { kino.seed(seed); } catch (_) { /* the pipe never fails a call */ }
      trace("done", { ok: 1, jwt: seed.jwtToken ? 1 : 0 });
      return seed;
    });
  } catch (_) {
    return null;   // a contribution never throws into Home
  } finally {
    running = false;
  }
}

/** The opportunity after a Home that started at `homeStartedAt`: bounded by Home's own budget. */
export const afterHome = (homeStartedAt) => maybeContribute({
  deadline: Math.min(Date.now() + CONTRIB_WINDOW_MS, homeStartedAt + HOME_CONTRIB_END_MS),
});
