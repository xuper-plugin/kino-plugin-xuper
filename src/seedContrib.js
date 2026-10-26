// Anonymous seed contribution (2.2.19; always-on from 2.2.20). A device that can create a WORKING anonymous Magis guest
// session occasionally shares ONE fresh such session, so geo-blocked users have live sessions to
// seed from. It is the owner's own seed pool, minted by the fleet instead of only by the owner's Mac.
//
// The session carries NOTHING about the person: no account, no personal data, no device identity --
// only a brand-new anonymous guest session the portal just handed out (the very call the minter
// makes). It is a throwaway identity created for the pool and nothing else.
//
// Strictly gated, and bounded by the Home that pays for it (afterHome, 2.2.25: never past Kino's 20 s):
//   consent  -- the person's plugin-telemetry consent (kino.seed only emits with it on, host-side)
//               AND the plugin's own `contributeSeeds` setting (default on). Either off -> nothing.
//   rate     -- at most one contribution per device per CONTRIB_INTERVAL_MS, kept in kino.storage.
//               No dice: the first eligible Home after the window opens contributes, and then the
//               device waits out the whole interval before it can contribute again.
//   region   -- a device that cannot create a working guest session (a geo-block, a refusal, an
//               empty or error answer at any step) contributes NOTHING: no event at all. The
//               validate-before-send is the hard gate.
//   channel  -- sent only through kino.seed() (Kino 0.9.55+), a locked-down pipe that accepts only
//               the anonymous-seed shape. On older Kino kino.seed is undefined and this no-ops.
//
// It mints a BRAND-NEW anonymous device (its own fingerprint, like registration.js), never the
// person's stored session, so their browsing is untouched. Never throws.
import { activateBean, makeFingerprint, snFrom, blank } from "./device.js";
import { PortalError } from "./portal.js";
import { trace, errCode } from "./trace.js";
import { isKinoError } from "./util.js";

// At most one contribution per device every 3 hours (owner, 2026-10-26; it was 10 h from 2026-10-08). A fresh
// anonymous Magis guest session lives ~12 h and the published pool drops those with under 3 h left, so a device
// contributing every 3 h keeps a fleet-sized pool full of seeds that are still worth handing out.
export const CONTRIB_INTERVAL_MS = 3 * 3600_000;
// The column the fresh session must be able to fetch to count as working (matches the minter's
// SEED_VALIDATE_COLUMN): a geo-blocked or dead session cannot read it, so it is never contributed.
export const VALIDATE_COLUMN = "masnew_movies";
// Bounds for the whole contribution: it is best-effort and must never hang a warm sandbox.
const REQUEST_MS = 10_000;
const TOTAL_MS = 25_000;
// After Home (2.2.25). Kino hands a call's answer over only once every fetch its sandbox started has settled
// (catalog.js), so the mint "detached" after Home was paid by Home itself: up to 25 s on top of it, and on the
// board Homes done in 5-13 s timed out on the mint (ERRORES-A07, 2.2.24: `call ok fn=home ms=5163` then
// `host_fail path=v3/snToken why=timeout`). Now the mint ends by HOME_CONTRIB_END_MS from Home's start and takes at
// most CONTRIB_WINDOW_MS after it; with less than MIN_WINDOW_MS left it is not tried (and the window is not
// stamped, so a quicker Home later contributes). A healthy portal mints in 2-4 s.
export const HOME_CONTRIB_END_MS = 15_000;
export const CONTRIB_WINDOW_MS = 8_000;
const MIN_WINDOW_MS = 4_000;
// kino.storage key for the last contribution's timestamp (the rate-limit window).
export const AT_KEY = "seedContribAt";
// The plugin's own opt-out (manifest toggle `contributeSeeds`, default on): unset counts as on.
const CONTRIBUTE_SETTING = "contributeSeeds";

// The anonymous-seed shape kino.seed accepts and the pool keeps. Required three plus jwtToken (the
// collector reads its `exp`) and mintedAt; the portal's own extras ride along when present.
const OPTIONAL_EXTRAS = ["customer", "activeTime", "availableTime"];

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/** A getNextColumns answer that actually carries catalog data (real data, not an empty envelope). */
function hasRealData(col) {
  if (col === null || typeof col !== "object") return false;
  if (Array.isArray(col)) return col.length > 0;
  return Object.keys(col).length > 0;
}

export function makeSeedContrib({ kino, portal, clock }) {
  const fingerprint = makeFingerprint(kino);
  let running = false; // a second Home while one contribution is in flight must not start another

  const enabled = () => {
    try { return kino.config.get(CONTRIBUTE_SETTING) !== false; } catch (_) { return true; }
  };
  const readAt = () => {
    try { const v = Number(kino.storage.get(AT_KEY)); return Number.isFinite(v) && v > 0 ? v : null; }
    catch (_) { return null; }
  };
  const stampAt = (now) => { try { kino.storage.set(AT_KEY, String(now)); } catch (_) { /* a full store must not fail the no-op */ } };

  /**
   * Mints a brand-new anonymous device and proves it works by fetching a column; returns the seed
   * (pool schema) or null. A geo-block, a refusal, an empty answer or any error at any step -> null,
   * so nothing dead or useless is ever contributed. Never throws.
   */
  async function mintAnonymous(deadline) {
    const bounds = { timeoutMs: REQUEST_MS, deadline: Math.min(clock.now() + TOTAL_MS, deadline) };
    try {
      const mint = await portal.call("v3/snToken", fingerprint(), { baseFields: false, ...bounds });
      if (blank(mint && mint.snToken)) { trace(kino, "seed_contrib", "mint", { ok: false, why: "no_sntoken" }); return null; }
      const snToken = str(mint.snToken);
      const sn = snFrom(kino, mint, snToken);
      const act = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
      if (blank(act && act.userToken) || blank(act && act.userId)) { trace(kino, "seed_contrib", "mint", { ok: false, why: "no_token" }); return null; }
      // The hard gate: fetch a column with THIS fresh session. A geo-blocked or dead session throws
      // (or answers nothing real); either way the contribution is dropped with no event.
      const col = await portal.call(
        "getNextColumns",
        { columnCode: VALIDATE_COLUMN, pageNum: 1, pageSize: 1, version: "" },
        { baseFields: true, userId: str(act.userId), userToken: str(act.userToken), sn, ...bounds },
      );
      if (!hasRealData(col)) { trace(kino, "seed_contrib", "validate", { ok: false, why: "empty" }); return null; }
      return buildSeed(sn, act);
    } catch (e) {
      // A geo-block (portal100024), any other portal refusal, or a network/deadline error: silent no-op.
      if (e instanceof PortalError || isKinoError(e)) { trace(kino, "seed_contrib", "mint", { ok: false, code: errCode(e) }); return null; }
      trace(kino, "seed_contrib", "mint", { ok: false, why: "bug", code: errCode(e) });
      return null;
    }
  }

  function buildSeed(sn, act) {
    const seed = {
      sn,
      userId: str(act.userId),
      userToken: str(act.userToken),
      jwtToken: str(act.jwtToken || ""),
      mintedAt: Math.floor(clock.now() / 1000),
    };
    // The portal's own session extras, when it returns them: strings or finite numbers only, so the
    // pipe never carries anything unexpected (kino.seed re-checks the allowlist on its side).
    for (const k of OPTIONAL_EXTRAS) {
      const v = act[k];
      if (typeof v === "string" && v !== "") seed[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) seed[k] = v;
    }
    return seed;
  }

  /**
   * One opportunity: maybe mint and contribute one fresh anonymous session, every portal request ending by
   * `deadline` (injected clock; none: TOTAL_MS from now). Best-effort, never throws. Returns the seed it sent
   * (tests), or null.
   */
  async function maybeContribute({ deadline = Infinity } = {}) {
    if (running) return null;
    running = true;
    try {
      // The locked-down pipe (Kino 0.9.55+); older Kino has no way to carry a seed, so do nothing.
      if (typeof kino.seed !== "function") return null;
      if (!enabled()) { trace(kino, "seed_contrib", "skip", { why: "off" }); return null; }
      const now = clock.now();
      const last = readAt();
      if (last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS) { trace(kino, "seed_contrib", "skip", { why: "rate" }); return null; }
      // Too little time left in the call that pays for it: not now, and the window stays open.
      const end = Math.min(now + TOTAL_MS, Number.isFinite(deadline) ? deadline : Infinity);
      if (end - now < MIN_WINDOW_MS) { trace(kino, "seed_contrib", "skip", { why: "time" }); return null; }
      // Eligible: start the window whether or not the mint works, so a blocked device still tries
      // at most once per interval.
      stampAt(now);
      const seed = await mintAnonymous(end);
      if (!seed) return null;
      try { kino.seed(seed); } catch (_) { /* the pipe never fails a call */ }
      trace(kino, "seed_contrib", "done", { ok: 1, jwt: seed.jwtToken ? 1 : 0 });
      return seed;
    } catch (_) {
      return null; // a contribution never throws into Home
    } finally {
      running = false;
    }
  }

  /** The opportunity after a Home that started at `homeStartedAt`: bounded by Home's own budget (see HOME_CONTRIB_END_MS). */
  const afterHome = (homeStartedAt) => maybeContribute({
    deadline: Math.min(clock.now() + CONTRIB_WINDOW_MS, homeStartedAt + HOME_CONTRIB_END_MS),
  });

  return { maybeContribute, afterHome };
}
