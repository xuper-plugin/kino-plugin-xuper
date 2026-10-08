// Anonymous seed contribution (2.2.19). A device that can create a WORKING anonymous Magis guest
// session occasionally shares ONE fresh such session, so geo-blocked users have live sessions to
// seed from. It is the owner's own seed pool, minted by the fleet instead of only by the owner's Mac.
//
// The session carries NOTHING about the person: no account, no personal data, no device identity --
// only a brand-new anonymous guest session the portal just handed out (the very call the minter
// makes). It is a throwaway identity created for the pool and nothing else.
//
// Strictly gated, and it NEVER blocks or slows the person's browsing:
//   consent  -- the person's plugin-telemetry consent (kino.seed only emits with it on, host-side)
//               AND the plugin's own `contributeSeeds` setting (default on). Either off -> nothing.
//   rate     -- at most one contribution per device per CONTRIB_INTERVAL_MS, kept in kino.storage.
//   fraction -- only ~CONTRIB_FRACTION of eligible opportunities, so neither the portal nor the
//               error board is flooded and not every device contributes on the same day.
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

// At most one contribution per device every 10 hours (owner, 2026-10-08). A fresh anonymous Magis
// guest session lives ~12 h, so a fresh contribution every 10 h keeps the pool live without churn.
export const CONTRIB_INTERVAL_MS = 10 * 3600_000;
// Only ~15% of eligible opportunities actually contribute: spreads the fleet over the day so the
// portal and GlitchTip are not flooded and devices do not all mint at once.
export const CONTRIB_FRACTION = 0.15;
// The column the fresh session must be able to fetch to count as working (matches the minter's
// SEED_VALIDATE_COLUMN): a geo-blocked or dead session cannot read it, so it is never contributed.
export const VALIDATE_COLUMN = "masnew_movies";
// Bounds for the whole contribution: it is best-effort and must never hang a warm sandbox.
const REQUEST_MS = 10_000;
const TOTAL_MS = 25_000;
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

export function makeSeedContrib({ kino, portal, clock, random }) {
  // No Math.random: the injected source (tests), else the host's CSPRNG.
  const rand = random || (() => parseInt(kino.crypto.randomBytes(4, "hex"), 16) / 0x100000000);
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
  async function mintAnonymous() {
    const bounds = { timeoutMs: REQUEST_MS, deadline: clock.now() + TOTAL_MS };
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
   * One opportunity (Home has loaded): maybe mint and contribute one fresh anonymous session.
   * Detached, best-effort, never blocks Home. Returns the seed it sent (tests), or null.
   */
  async function maybeContribute() {
    if (running) return null;
    running = true;
    try {
      // The locked-down pipe (Kino 0.9.55+); older Kino has no way to carry a seed, so do nothing.
      if (typeof kino.seed !== "function") return null;
      if (!enabled()) { trace(kino, "seed_contrib", "skip", { why: "off" }); return null; }
      const now = clock.now();
      const last = readAt();
      if (last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS) { trace(kino, "seed_contrib", "skip", { why: "rate" }); return null; }
      // The fraction gate does NOT stamp: a losing roll stays eligible, so the next Home rolls again.
      if (rand() >= CONTRIB_FRACTION) { trace(kino, "seed_contrib", "skip", { why: "frac" }); return null; }
      // A winning roll starts the window whether or not the mint works, so a blocked device still
      // contributes at most once per interval.
      stampAt(now);
      const seed = await mintAnonymous();
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

  return { maybeContribute };
}
