// Session lifecycle against the Magis portal: mint/reactivate a device, login, reauth, seed pool
// rescue. Port of the native MagisSession (native-magis.md §2.2-§2.8).
import { PortalError, mapPortalError } from "./portal.js";
import { PASSWORD_SALT, FIXED_MAC } from "./config.js";
import { activateBean, makeFingerprint, snFrom } from "./device.js";
import { isKinoError } from "./util.js";

export const DEFAULT_SEEDS_URL =
  "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/seeds/seeds.json";

// "This sn cannot activate anonymously": the only reasons to mint another device.
const INVALID_SN = new Set(["aaa100080", "aaa100082"]);
const SESSION_DEAD = new Set(["aaa100027", "aaa100028"]);
const GEO_BLOCKED = "portal100024";
const SEED_RESCUE_ROUNDS = 3;
const SEED_SWITCH_TRIES = 5;
const POOL_REFRESH_COOLDOWN_MS = 10_000;
// After a download that loaded nothing, the automatic paths wait this long before asking again, so
// every blocked call does not re-download (the "Actualizar semillas" button is never held back).
const FAILED_REFRESH_COOLDOWN_MS = 30_000;
// What an automatic download inside a content call may cost: a geo-block or a failed activation
// with an empty pool (the pool is the only way out in a blocked region).
const BLOCKED_REFRESH_MS = 5_000;
const MIN_REQUEST_MS = 1_000; // less time left than this before a call's deadline: nothing new starts
const PERIODIC_REFRESH_MS = 3 * 3600_000;
const PERIODIC_TIMEOUT_MS = 5_000;
const MAX_SEEDS = 200; // keeps the stored pool far below the 256 KB storage limit
// Per-call seed fallback on the shared account (Ruling R33).
const SEED_FALLBACK_TRIES = 3;
const SEED_FALLBACK_MIN_MS = 1_000; // less time left than this: no new attempt
const SEED_FALLBACK_REFRESH_MS = 15_000;
const SEED_FALLBACK_DEFAULT_MS = 10_000; // a caller that gave no deadline

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const blank = (v) => str(v).trim() === "";

// A promise-chain mutex: tasks run one at a time, in order, and a failure never wedges the chain.
function makeLock() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.then(() => {}, () => {});
    return run;
  };
}

export function makeSession({ kino, portal, clock, seedsUrl = DEFAULT_SEEDS_URL, random, shared }) {
  // No Math.random: the injected source, else the host's CSPRNG.
  const rand = random || (() => parseInt(kino.crypto.randomBytes(4, "hex"), 16) / 0x100000000);
  const lock = makeLock(); // mint / login / switch: read-modify-write over the stored session
  let lastPoolRefreshMs = null;
  let lastFailedRefreshMs = null;
  // The ONE pool download in flight ({ promise, endsBy } on the injected clock): parallel callers
  // share it instead of queueing; one whose deadline comes before `endsBy` does not wait for it.
  let inflight = null;
  let exhausted = false;
  // `bounds` = { deadline?, timeoutMs? } of the calling export: every portal exchange it causes
  // (activation, mint, login) runs inside it.
  const timeLeft = (bounds) => (bounds && typeof bounds.deadline === "number" ? bounds.deadline - clock.now() : Infinity);

  // ---- storage (no ttl: the token is a cache the portal kills at will) ----
  const readJson = (key) => {
    try { const raw = kino.storage.get(key); return raw === null || raw === undefined ? null : JSON.parse(raw); }
    catch (_) { return null; }
  };
  const writeJson = (key, value) => kino.storage.set(key, JSON.stringify(value));

  const readSession = () => {
    const s = readJson("session");
    const o = s && typeof s === "object" ? s : {};
    // `acct` is the account the token belongs to: "" anonymous/seed (also every session stored before
    // this field existed), "shared", or a hash of the own account (never the password itself).
    return { userId: str(o.userId), userToken: str(o.userToken), jwtToken: str(o.jwtToken), sn: str(o.sn), acct: str(o.acct) };
  };
  const writeSession = (s) => writeJson("session", {
    userId: str(s.userId), userToken: str(s.userToken), jwtToken: str(s.jwtToken), sn: str(s.sn), acct: str(s.acct),
  });
  // `sn: null` = the device's own (stored) sn; a per-call seed view carries the seed's.
  const view = () => { const s = readSession(); return { userId: s.userId, userToken: s.userToken, sn: null }; };
  const hasToken = () => !blank(readSession().userToken);
  // A fast device-local fingerprint of values the portal already receives (email + the portal's own
  // password hash), only to tell accounts apart. NOT a password KDF: do not rely on it against offline guessing.
  const accountKey = (email, password) =>
    kino.crypto.hash("sha256", str(email) + "\n" + kino.crypto.hash("md5", str(password) + PASSWORD_SALT));

  // The shared "cuenta compartida" (native fallback account): injected like the other deployment
  // values; a blank pair means the feature is unavailable (native: blank pair = no-op).
  const sharedPair = shared && !blank(shared.email) && !blank(shared.password)
    ? { email: str(shared.email), password: str(shared.password) } : null;
  const keyOf = (acc) =>
    sharedPair && acc.email === sharedPair.email && acc.password === sharedPair.password ? "shared" : accountKey(acc.email, acc.password);

  // The choice "Usar cuenta compartida" is the synced setting `useSharedAccount`. Before it existed the
  // choice lived in storage (`sharedAccount`): honoured only while the setting was never saved.
  const legacyShared = () => readJson("sharedAccount") === true;
  const dropLegacy = () => {
    try { if (kino.storage.get("sharedAccount") !== null && kino.storage.get("sharedAccount") !== undefined) kino.storage.remove("sharedAccount"); }
    catch (_) { /* ignored */ }
  };
  const ownAccount = () => {
    const email = kino.config.get("email"), password = kino.config.get("password");
    // Trimmed like the settings screen does, so ensure, the login action and adoption key on the same values.
    return blank(email) || blank(password) ? null : { email: str(email).trim(), password: str(password).trim() };
  };
  // The account the settings ask for (own wins, else the shared pair when chosen; email alone or
  // password alone is no account), whether or not the portal ever accepted it.
  const configuredAccount = () => {
    const own = ownAccount();
    if (own) { dropLegacy(); return own; }
    const toggle = kino.config.get("useSharedAccount");
    if (toggle !== undefined) dropLegacy(); // explicitly set: the setting is the truth from now on
    const chosen = toggle === true || (toggle === undefined && legacyShared());
    return sharedPair && chosen ? sharedPair : null;
  };

  // The last account key the portal REFUSED: not retried on every call, only when the key changes
  // or on an explicit login / reauthentication.
  // Memory of a refusal expires: a transient portal answer heals by itself.
  const REFUSAL_TTL_MS = 10 * 60_000;
  const LOGIN_COOLDOWN_MS = 60_000;
  // Answers that are NOT a verdict on the credentials: a geo-block, or a portal that answered without a session.
  const NOT_A_REFUSAL = new Set([GEO_BLOCKED, "snToken_failed", "active_sin_token", "login_sin_token"]);
  const refusal = (e) => e instanceof PortalError && !NOT_A_REFUSAL.has(e.code);
  const refusedKey = () => {
    const r = readJson("refusedAcct");
    if (!r || typeof r !== "object" || typeof r.key !== "string" || typeof r.at !== "number") return "";
    const age = clock.now() - r.at;
    return age >= 0 && age < REFUSAL_TTL_MS ? r.key : "";
  };
  const setRefused = (key) => { try { writeJson("refusedAcct", { key, at: clock.now() }); } catch (_) { /* ignored */ } };
  const clearRefused = (key) => {
    if (key === "") return;
    const r = readJson("refusedAcct");
    if (r && typeof r === "object" && r.key === key) { try { kino.storage.remove("refusedAcct"); } catch (_) { /* ignored */ } }
  };
  // After a login that failed without a verdict (network, portal down) the anonymous token is used as
  // is for a while instead of retrying login + activation on every call. In memory only.
  let cooldown = { key: "", until: 0 };
  const cooling = (key) => cooldown.key === key && clock.now() < cooldown.until;
  const startCooldown = (key) => { cooldown = { key, until: clock.now() + LOGIN_COOLDOWN_MS }; };
  const endCooldown = () => { cooldown = { key: "", until: 0 }; };

  // The account in use: configured and not known to be refused. Null means anonymous.
  const account = () => {
    const acc = configuredAccount();
    return acc && keyOf(acc) !== refusedKey() ? acc : null;
  };
  const currentKey = () => { const acc = account(); return acc ? keyOf(acc) : ""; };
  // A stored token only counts when it belongs to the account in use (an anonymous one when none).
  const tokenHeld = () => hasToken() && readSession().acct === currentKey();

  // The "Actualizar semillas automáticamente" toggle; unset (never saved) counts as on, like native.
  const autoRefresh = () => kino.config.get("autoRefreshSeeds") !== false;

  const regionBlocked = () => { const r = readJson("region"); return !!(r && r.blocked === true); };
  // A full store must not turn a portal answer into a raw throw: the flag is a hint, not a result.
  const setRegion = (blocked) => { try { if (regionBlocked() !== blocked) writeJson("region", { blocked }); } catch (_) { /* ignored */ } };

  const seedPool = () => {
    const raw = readJson("seeds");
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && typeof e === "object" && !blank(e.sn) && !blank(e.userToken))
      .map((e) => ({ sn: str(e.sn), userId: str(e.userId), userToken: str(e.userToken) }));
  };
  const pick = (pool) => pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  const seedSession = (e) => ({ userId: e.userId, userToken: e.userToken, jwtToken: "", sn: e.sn, acct: "" });

  // Portal errors a person reads become Spanish kino errors; anything else passes through.
  const surface = (e) => (e instanceof PortalError ? mapPortalError(e.code, e.message, kino) : e);

  // ---- portal exchanges (callers hold `lock`) ----
  const fingerprint = makeFingerprint(kino);

  // The device belongs to the DEVICE: login and reactivation keep the stored sn.
  function saveFromResponse(j, acct = "") {
    writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: readSession().sn, acct });
  }

  async function activate(snToken, sn, bounds = {}) {
    const j = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
    if (blank(j && j.userToken)) throw new PortalError("active_sin_token", "activación sin userToken");
    saveFromResponse(j);
  }

  async function mintDevice(bounds = {}) {
    const j = await portal.call("v3/snToken", fingerprint(), { baseFields: false, ...bounds });
    if (blank(j && j.snToken)) throw new PortalError("snToken_failed", "el portal no devolvió snToken");
    const snToken = str(j.snToken);
    const sn = snFrom(kino, j, snToken);
    // Saved BEFORE activating: that same call's device dict must carry it.
    writeSession({ userId: "", userToken: "", jwtToken: "", sn, acct: "" });
    await activate(snToken, sn, bounds);
  }

  async function directAnonymous(bounds = {}) {
    const storedSn = readSession().sn;
    if (!blank(storedSn)) {
      try { return await activate("", storedSn, bounds); }
      catch (e) {
        // Anything but these two codes (network, portal down) does not justify another device.
        if (!(e instanceof PortalError && INVALID_SN.has(e.code))) throw e;
      }
    }
    return mintDevice(bounds);
  }

  // An anonymous token on this device (`acct` ""); a token of another account is dropped first.
  // An activation that works says nothing about the content (a blocked region activates fine), so
  // it never clears the region flag: only a content call that answers does (withValidSession).
  async function ensureAnonymousUnlocked(bounds = {}) {
    if (hasToken() && readSession().acct === "") return;
    if (hasToken()) forgetToken();
    let direct;
    try { await directAnonymous(bounds); return; } catch (e) { direct = e; }
    if (direct instanceof PortalError && direct.code === GEO_BLOCKED) setRegion(true);
    // Direct path failed: what an unflagged geo-block looks like. Any pool session beats none, and a
    // fresh install has no pool yet: it is downloaded once, bounded (native loaded it at activation).
    let pool = seedPool();
    if (pool.length === 0) {
      try { await refreshSeeds({ timeoutMs: BLOCKED_REFRESH_MS, deadline: bounds.deadline }); } catch (_) { /* ignored */ }
      pool = seedPool();
    }
    if (pool.length > 0) { writeSession(seedSession(pick(pool))); return; }
    throw direct;
  }

  // `bounds` ({ timeoutMs, deadline }) go straight to portal.call: for callers with their own cap.
  async function loginUnlocked(email, password, bounds = {}) {
    const bean = {
      accountType: "2", userName: email, password: kino.crypto.hash("md5", password + PASSWORD_SALT),
      type: "1", macAddr: FIXED_MAC, areaCode: "", verificationCode: "", verificationToken: "",
      matadata: "", signdata: "", channel: "default",
    };
    // Logging in does NOT activate the device: that would burn an activation per sn.
    const j = await portal.call("v8/login", bean, { baseFields: false, sn: readSession().sn || null, ...bounds });
    if (blank(j && j.userToken)) throw new PortalError("login_sin_token", "login sin userToken");
    saveFromResponse(j, keyOf({ email, password }));
  }

  async function ensureUnlocked(bounds = {}) {
    if (tokenHeld()) return;
    // A token of another account (credentials arrived by sync, account changed or cleared) is no
    // token; the device (sn) stays, so nothing is minted.
    const acc = account();
    const key = acc ? keyOf(acc) : "";
    const wait = acc !== null && cooling(key);
    // Cooling down after a failed login: the anonymous token is used as is.
    if (wait && hasToken() && readSession().acct === "") return;
    if (hasToken()) forgetToken();
    if (acc && !wait) {
      // A rejected credential or a portal down: anonymous is served before serving nothing.
      try { await loginUnlocked(acc.email, acc.password, bounds); clearRefused(key); endCooldown(); return; }
      catch (e) { if (refusal(e)) setRefused(key); else startCooldown(key); }
    }
    await ensureAnonymousUnlocked(bounds);
  }

  function forgetToken() {
    const prev = readSession();
    if (prev.sn === "" && prev.userToken === "") return;
    writeSession({ ...prev, userId: "", userToken: "", jwtToken: "", acct: "" });
  }

  // ---- single-flight helpers ----
  // Each login kills the previous token: when a burst failed on the same stale token, the stored
  // token no longer being it means someone already renewed.
  const reauthenticate = (stale, bounds = {}) => lock(async () => {
    const current = readSession().userToken;
    if (!blank(current) && current !== stale) return true;
    // No time left in the calling export: the stored token is left as it is for the next call.
    if (timeLeft(bounds) < MIN_REQUEST_MS) return false;
    forgetToken();
    try {
      // Reauthentication retries even an account refused before (the retry is rare and bounded).
      const acc = configuredAccount();
      if (acc) {
        try { await loginUnlocked(acc.email, acc.password, bounds); clearRefused(keyOf(acc)); endCooldown(); }
        catch (e) {
          if (!refusal(e)) throw e;
          setRefused(keyOf(acc)); // refused: the session falls to the anonymous path, as `ensure` does
          await ensureAnonymousUnlocked(bounds);
        }
      } else await ensureAnonymousUnlocked(bounds);
      return true;
    } catch (_) { return false; }
  });

  const switchToBackup = (stale) => lock(async () => {
    const pool = seedPool();
    if (pool.length === 0) return false;
    if (readSession().userToken !== stale) return true; // someone else already switched
    writeSession(seedSession(pick(pool)));
    return true;
  });

  /** Downloads the pool; true when it stored a non-empty one. Never throws. */
  async function fetchSeeds(timeoutMs) {
    let list;
    try {
      const res = await kino.fetch(seedsUrl, { timeoutMs });
      list = JSON.parse(res.text());
    } catch (_) { return false; }
    if (!Array.isArray(list)) return false;
    const clean = list.filter((e) => e && typeof e === "object" && !blank(e.sn) && !blank(e.userToken))
      .slice(0, MAX_SEEDS)
      .map((e) => ({ sn: str(e.sn), userId: str(e.userId), userToken: str(e.userToken) }));
    // Only a non-empty answer replaces the pool (native SeedRefresher.reseed()).
    if (clean.length === 0) return false;
    // A full store keeps the old pool: a download that cannot be kept is a failed one.
    try { writeJson("seeds", clean); } catch (_) { return false; }
    try { writeJson("seedsAt", clock.now()); } catch (_) { /* ignored */ }
    return true;
  }

  /**
   * Re-downloads the pool; true when a non-empty pool is available afterwards. Parallel callers
   * share the download in flight. `deadline` (injected clock) bounds the caller: the download gets
   * at most the time left, and a caller never waits for one that would end after its deadline.
   * `manual` (the settings button) skips the cooldown after a failed download.
   */
  async function refreshSeeds({ periodic = false, timeoutMs = 15000, deadline, manual = false } = {}) {
    // Everything up to the first await is synchronous: two callers can never both start a download.
    const has = () => seedPool().length > 0;
    if (periodic) {
      if (!autoRefresh() || !regionBlocked() || account()) return has();
      const at = readJson("seedsAt");
      if (typeof at === "number" && clock.now() - at < PERIODIC_REFRESH_MS) return has();
      // Stamped BEFORE the attempt: a dead network must not retry on every call.
      try { writeJson("seedsAt", clock.now()); } catch (_) { /* ignored */ }
    }
    const now = clock.now();
    const recent = (at, ms) => at !== null && now - at >= 0 && now - at < ms;
    if (inflight === null) {
      if (recent(lastPoolRefreshMs, POOL_REFRESH_COOLDOWN_MS)) return has();
      if (!manual && recent(lastFailedRefreshMs, FAILED_REFRESH_COOLDOWN_MS)) return has();
      const ms = Math.min(timeoutMs, Math.floor(timeLeft({ deadline })));
      if (ms < MIN_REQUEST_MS) return has();
      const promise = fetchSeeds(ms).then((stored) => {
        inflight = null;
        if (stored) lastPoolRefreshMs = now; else lastFailedRefreshMs = now;
      });
      inflight = { promise, endsBy: now + ms };
    } else if (typeof deadline === "number" && inflight.endsBy > deadline) {
      return has(); // the download in flight would end after this caller has to answer
    }
    await inflight.promise;
    return has();
  }

  // ---- the public surface ----
  /** `bounds` ({ deadline }) of the calling export: the mint, activation or login run inside it. */
  async function ensure(bounds = {}) {
    await null;
    // A call that already has a token never waits. Without one, the periodic pool refresh (blocked
    // region, no account, switch on, > 3 h old) runs first, bounded and failure-proof.
    if (!tokenHeld()) { try { await refreshSeeds({ periodic: true, timeoutMs: PERIODIC_TIMEOUT_MS, deadline: bounds.deadline }); } catch (_) { /* ignored */ } }
    try { await lock(() => ensureUnlocked(bounds)); } catch (e) { throw surface(e); }
  }

  async function login(email, password, bounds = {}) {
    await null;
    const key = keyOf({ email, password });
    try {
      await lock(async () => { await loginUnlocked(email, password, bounds); clearRefused(key); endCooldown(); dropLegacy(); });
    } catch (e) {
      if (e instanceof PortalError) {
        if (refusal(e)) setRefused(key);
        throw kino.error("auth_required", "Credenciales de Xuper inválidas");
      }
      throw e;
    }
  }

  /** The shared pair: one login on this device's sn. The choice itself is the synced setting. */
  async function useShared(bounds = {}) {
    await null;
    if (!sharedPair) throw kino.error("unavailable", "La cuenta compartida no está disponible");
    try { await lock(async () => { await loginUnlocked(sharedPair.email, sharedPair.password, bounds); clearRefused("shared"); endCooldown(); }); }
    catch (e) {
      if (e instanceof PortalError) {
        if (refusal(e)) setRefused("shared");
        throw kino.error("auth_required", "No se pudo activar la cuenta compartida");
      }
      throw e;
    }
  }

  async function logout(bounds = {}) {
    await null;
    try {
      await lock(async () => {
        dropLegacy(); // clearing the setting would make an old flag count again
        const prev = readSession();
        if (!blank(prev.userToken)) {
          // Result ignored: the stored token is dropped either way. The account itself lives in
          // the plugin settings, which the app clears after this action succeeds.
          try {
            await portal.call("v5/loginOut", { userId: prev.userId, userToken: prev.userToken },
              { baseFields: false, sn: prev.sn || null, ...bounds });
          } catch (_) { /* ignored */ }
        }
        forgetToken();
        await ensureAnonymousUnlocked(bounds);
      });
    } catch (e) { throw surface(e); }
  }

  const blockedOrDead = (e) => e.code === GEO_BLOCKED || SESSION_DEAD.has(e.code);

  /**
   * Ruling R33: the shared account is accepted but THIS call is still geo-blocked or dead. Up to 3
   * distinct pool seeds run the block as a per-call override ({userId, userToken, sn, deadline});
   * nothing is written: the stored session, `acct`, the region flag and `exhausted` stay as they are.
   * Returns { value } / { err } (the first seed that is not geo/dead wins, even with another portal
   * error), or null when no seed answered (the caller keeps its original error).
   */
  async function seedFallback(block, deadline) {
    const left = () => deadline - clock.now();
    let pool = seedPool();
    let refreshed = false;
    if (pool.length === 0 && left() >= SEED_FALLBACK_MIN_MS) {
      refreshed = true;
      try { await refreshSeeds({ timeoutMs: SEED_FALLBACK_REFRESH_MS, deadline }); } catch (_) { /* ignored */ }
      pool = seedPool();
    }
    const seen = new Set();
    const candidates = pool.filter((e) => !seen.has(e.sn) && seen.add(e.sn));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rand() * (i + 1)));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    // Counts only: never a token or an sn.
    const note = (tries, outcome) => {
      try { kino.log(`xuper seed fallback: ${outcome} after ${tries} of ${candidates.length} seeds${refreshed ? " (pool refreshed)" : ""}`); }
      catch (_) { /* never fails a call */ }
    };
    let tries = 0;
    for (const c of candidates.slice(0, SEED_FALLBACK_TRIES)) {
      if (left() < SEED_FALLBACK_MIN_MS) break;
      tries++;
      try {
        const value = await block({ userId: c.userId, userToken: c.userToken, sn: c.sn, deadline });
        note(tries, "answered");
        return { value };
      } catch (e) {
        if (e instanceof PortalError && !blockedOrDead(e)) { note(tries, "answered"); return { err: e }; }
        // Geo, dead, or no answer at all (network, deadline: a kino error): the next seed. Anything
        // else is a bug and must not be hidden behind "no seed answered".
        if (!(e instanceof PortalError) && !isKinoError(e)) throw e;
      }
    }
    note(tries, left() < SEED_FALLBACK_MIN_MS ? "out of time" : "no seed answered");
    return null;
  }

  /**
   * Runs `block({userId, userToken, sn})` (token read from storage on EVERY attempt, so a retry sees
   * the renewed one; `sn` is null for the stored session). It does NOT call `ensure()` first: callers (catalog, resolve, live...) do,
   * because only they know whether a missing session is an error or just "not minted yet". Geo-block, dead token and dead seed rescue as native withValidSession;
   * never loops: at most 1 + geo 1 + reauth 1 + 3 rescue runs (+ 3 per-call seeds, below).
   * `seedFallback` (non-live callers only): on the SHARED account, a call still geo-blocked or dead
   * after reauth is retried with pool seeds as a per-call override, bounded by `deadline` (injected clock).
   */
  async function withValidSession(block, { seedFallback: allowSeeds = false, deadline } = {}) {
    await null;
    const startedAt = clock.now();
    // The calling export's deadline rides on EVERY step: each attempt's view (portal.call reads it),
    // the geo-block's pool download, the reauthentication and the rescue.
    const bounds = typeof deadline === "number" ? { deadline } : {};
    const onSeed = () => { const sn = readSession().sn; return seedPool().some((e) => e.sn === sn); };
    const settle = (r) => {
      if (r.err) throw mapPortalError(r.err.code, r.err.message, kino);
      exhausted = false;
      // A content answer on the device's OWN session is the proof the region does not block it.
      if (regionBlocked() && !onSeed()) setRegion(false);
      return r.value;
    };
    const attempt = async () => {
      try { return { value: await block({ ...view(), ...bounds }) }; }
      catch (e) { if (e instanceof PortalError) return { err: e }; throw e; }
    };
    const tokenUsed = view().userToken;
    let result = await attempt();
    if (!result.err) return settle(result);

    if (result.err.code === GEO_BLOCKED) {
      setRegion(true);
      if (!account()) {
        // A fresh install has no pool yet: it is the only way out of a blocked region.
        if (seedPool().length === 0) {
          try { await refreshSeeds({ timeoutMs: BLOCKED_REFRESH_MS, deadline }); } catch (_) { /* ignored */ }
        }
        if (await switchToBackup(tokenUsed)) result = await attempt();
        if (!result.err) return settle(result);
      }
    }

    // Tried BEFORE the pool re-download: a token that merely expired just re-mints.
    if (await reauthenticate(tokenUsed, bounds)) {
      result = await attempt();
      if (!result.err) return settle(result);
    }

    if (SESSION_DEAD.has(result.err.code) && !account()) {
      setRegion(true);
      for (let round = 0; round < SEED_RESCUE_ROUNDS; round++) {
        if (timeLeft(bounds) < MIN_REQUEST_MS) break;
        if ((await refreshSeeds({ deadline })) && (await switchToBackup(view().userToken))) {
          const retry = await attempt();
          if (!retry.err || !SESSION_DEAD.has(retry.err.code)) {
            // The rescue got a session that answers (even with an error that is not "dead"): the pool is not exhausted.
            exhausted = false;
            return settle(retry);
          }
        }
      }
      exhausted = true;
    }
    if (allowSeeds && blockedOrDead(result.err) && usingShared()) {
      const rescued = await seedFallback(block, typeof deadline === "number" ? deadline : startedAt + SEED_FALLBACK_DEFAULT_MS);
      // Not `settle`: a per-call seed says nothing about the stored session, so `exhausted` stays.
      if (rescued) {
        if (rescued.err) throw mapPortalError(rescued.err.code, rescued.err.message, kino);
        return rescued.value;
      }
    }
    return settle(result);
  }

  /** Manual "Cambiar semilla": probes other pool seeds for real; the first token wins. */
  async function switchSeed({ timeoutMs, deadline } = {}) {
    await null;
    return lock(async () => {
      if (account()) return { result: "account_linked", tries: 0 };
      const current = readSession().sn;
      const candidates = seedPool().filter((e) => e.sn !== current);
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(rand() * (i + 1)));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      if (candidates.length === 0) return { result: "no_other_seed", tries: 0 };
      let tries = 0;
      let reached = false; // some probe got an answer from the portal (even a refusal)
      for (const c of candidates.slice(0, SEED_SWITCH_TRIES)) {
        // A caller with its own cap sets a deadline on the injected clock: no new probe after it.
        if (typeof deadline === "number" && clock.now() >= deadline) break;
        tries++;
        try {
          const j = await portal.call("v8/active", activateBean(""), { baseFields: false, sn: c.sn, timeoutMs, deadline });
          reached = true;
          if (blank(j && j.userToken)) continue;
          writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: c.sn, acct: "" });
          return { result: "ok", tries };
        } catch (e) { if (e instanceof PortalError) reached = true; /* this seed does not work right now: next */ }
      }
      // Bounded run where no probe even reached the portal: the person is offline, not out of seeds.
      if (typeof deadline === "number" && !reached) return { result: "offline", tries };
      return { result: "all_failed", tries };
    });
  }

  /** Makes `s` the stored session (registration: the temporary device that just logged in). */
  // A login on the direct path proves the region is not blocking this device (native markClear).
  // `s.acct` is the key of the account that logged in (`accountKey`).
  const adoptSession = (s) => lock(async () => { writeSession(s); clearRefused(str(s.acct)); dropLegacy(); setRegion(false); exhausted = false; });

  /** True when the shared account (not the person's own) is the one in use. */
  const usingShared = () => { const a = account(); return a !== null && a === sharedPair; };
  /** True when the settings ask for the shared account, even if the portal refused it. */
  const sharedConfigured = () => { const a = configuredAccount(); return a !== null && a === sharedPair; };

  // "none" no account configured, "refused" the portal rejected it, "held" its token is the one stored,
  // "pending" configured but not logged in yet (credentials just arrived by sync).
  function accountState() {
    const conf = configuredAccount();
    if (!conf) return "none";
    if (keyOf(conf) === refusedKey()) return "refused";
    return tokenHeld() ? "held" : "pending";
  }

  // "account" only while the stored token really belongs to the account in use.
  function kind() {
    if (accountState() === "held") return "account";
    const s = readSession();
    if (blank(s.sn)) return "none";
    return seedPool().some((e) => e.sn === s.sn) ? "seed" : "own";
  }

  return {
    ensure, withValidSession, current: readSession, kind, accountState, accountKey, usingShared, sharedConfigured, login, useShared, logout, regionBlocked,
    seedsExhausted: () => exhausted, switchSeed, refreshSeeds, seedPool, adoptSession,
  };
}
