// Session lifecycle against the Magis portal: mint/reactivate a device, login, reauth, seed pool
// rescue. Port of the native MagisSession (native-magis.md §2.2-§2.8).
import { PortalError, mapPortalError } from "./portal.js";
import { SNTOKEN_SALT, PASSWORD_SALT, FIXED_MAC, FINGERPRINT_FIXED } from "./config.js";

export const DEFAULT_SEEDS_URL =
  "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/main/seeds.json";

// "This sn cannot activate anonymously": the only reasons to mint another device.
const INVALID_SN = new Set(["aaa100080", "aaa100082"]);
const SESSION_DEAD = new Set(["aaa100027", "aaa100028"]);
const GEO_BLOCKED = "portal100024";
const SEED_RESCUE_ROUNDS = 3;
const SEED_SWITCH_TRIES = 5;
const POOL_REFRESH_COOLDOWN_MS = 10_000;
const PERIODIC_REFRESH_MS = 3 * 3600_000;
const MAX_SEEDS = 200; // keeps the stored pool far below the 256 KB storage limit

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

export function makeSession({ kino, portal, clock, seedsUrl = DEFAULT_SEEDS_URL, random }) {
  // No Math.random: the injected source, else the host's CSPRNG.
  const rand = random || (() => parseInt(kino.crypto.randomBytes(4, "hex"), 16) / 0x100000000);
  const lock = makeLock(); // mint / login / switch: read-modify-write over the stored session
  const poolLock = makeLock(); // pool re-download, never held while taking `lock`
  let lastPoolRefreshMs = null;
  let exhausted = false;

  // ---- storage (no ttl: the token is a cache the portal kills at will) ----
  const readJson = (key) => {
    try { const raw = kino.storage.get(key); return raw === null || raw === undefined ? null : JSON.parse(raw); }
    catch (_) { return null; }
  };
  const writeJson = (key, value) => kino.storage.set(key, JSON.stringify(value));

  const readSession = () => {
    const s = readJson("session");
    const o = s && typeof s === "object" ? s : {};
    return { userId: str(o.userId), userToken: str(o.userToken), jwtToken: str(o.jwtToken), sn: str(o.sn) };
  };
  const writeSession = (s) => writeJson("session", {
    userId: str(s.userId), userToken: str(s.userToken), jwtToken: str(s.jwtToken), sn: str(s.sn),
  });
  const view = () => { const s = readSession(); return { userId: s.userId, userToken: s.userToken }; };
  const hasToken = () => !blank(readSession().userToken);

  // The person's own account is plugin settings, read each time, never copied.
  const account = () => {
    const email = kino.config.get("email"), password = kino.config.get("password");
    return blank(email) || blank(password) ? null : { email: str(email), password: str(password) };
  };

  const regionBlocked = () => { const r = readJson("region"); return !!(r && r.blocked === true); };
  const setRegion = (blocked) => { if (regionBlocked() !== blocked) writeJson("region", { blocked }); };

  const seedPool = () => {
    const raw = readJson("seeds");
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && typeof e === "object" && !blank(e.sn) && !blank(e.userToken))
      .map((e) => ({ sn: str(e.sn), userId: str(e.userId), userToken: str(e.userToken) }));
  };
  const pick = (pool) => pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  const seedSession = (e) => ({ userId: e.userId, userToken: e.userToken, jwtToken: "", sn: e.sn });

  // Portal errors a person reads become Spanish kino errors; anything else passes through.
  const surface = (e) => (e instanceof PortalError ? mapPortalError(e.code, e.message, kino) : e);

  // ---- portal exchanges (callers hold `lock`) ----
  const activateBean = (snToken) => ({
    snToken, authVersion: "", authCode: "", preCode: "", macAddr: FIXED_MAC, reserve1: "",
    openNum: 4, channel: "default", matadata: "", signdata: "",
  });

  const randomHex = (bytes) => kino.crypto.randomBytes(bytes, "hex");
  const randomMac = () => randomHex(6).match(/../g).join(":");
  const fingerprint = () => ({
    ...FINGERPRINT_FIXED,
    androidId: randomHex(8), cpuId: randomHex(8), serialNumber: randomHex(8),
    etheMac: randomMac(), gatewayMac: randomMac(), wifiMac: randomMac(),
  });

  // The device belongs to the DEVICE: login and reactivation keep the stored sn.
  function saveFromResponse(j) {
    writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: readSession().sn });
  }

  async function activate(snToken, sn) {
    const j = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn });
    if (blank(j && j.userToken)) throw new PortalError("active_sin_token", "activación sin userToken");
    saveFromResponse(j);
  }

  async function mintDevice() {
    const j = await portal.call("v3/snToken", fingerprint(), { baseFields: false });
    if (blank(j && j.snToken)) throw new PortalError("snToken_failed", "el portal no devolvió snToken");
    const snToken = str(j.snToken);
    const sn = (blank(j.sn) ? kino.crypto.hash("md5", snToken + SNTOKEN_SALT) : str(j.sn)).toLowerCase();
    // Saved BEFORE activating: that same call's device dict must carry it.
    writeSession({ userId: "", userToken: "", jwtToken: "", sn });
    await activate(snToken, sn);
  }

  async function directAnonymous() {
    const storedSn = readSession().sn;
    if (!blank(storedSn)) {
      try { return await activate("", storedSn); }
      catch (e) {
        // Anything but these two codes (network, portal down) does not justify another device.
        if (!(e instanceof PortalError && INVALID_SN.has(e.code))) throw e;
      }
    }
    return mintDevice();
  }

  async function ensureAnonymousUnlocked() {
    if (hasToken()) return;
    let direct;
    try { await directAnonymous(); setRegion(false); return; } catch (e) { direct = e; }
    // Direct path failed: what an unflagged geo-block looks like. Any pool session beats none.
    const pool = seedPool();
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
    saveFromResponse(j);
  }

  async function ensureUnlocked() {
    if (hasToken()) return;
    const acc = account();
    if (acc) {
      // A rejected credential or a portal down: anonymous is served before serving nothing.
      try { await loginUnlocked(acc.email, acc.password); return; } catch (_) { /* fall through */ }
    }
    await ensureAnonymousUnlocked();
  }

  function forgetToken() {
    const prev = readSession();
    if (prev.sn === "" && prev.userToken === "") return;
    writeSession({ ...prev, userId: "", userToken: "", jwtToken: "" });
  }

  // ---- single-flight helpers ----
  // Each login kills the previous token: when a burst failed on the same stale token, the stored
  // token no longer being it means someone already renewed.
  const reauthenticate = (stale) => lock(async () => {
    const current = readSession().userToken;
    if (!blank(current) && current !== stale) return true;
    forgetToken();
    try {
      const acc = account();
      if (acc) await loginUnlocked(acc.email, acc.password); else await ensureAnonymousUnlocked();
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

  async function fetchSeeds(timeoutMs) {
    let list;
    try {
      const res = await kino.fetch(seedsUrl, { timeoutMs });
      list = JSON.parse(res.text());
    } catch (_) { return; }
    if (!Array.isArray(list)) return;
    const clean = list.filter((e) => e && typeof e === "object" && !blank(e.sn) && !blank(e.userToken))
      .slice(0, MAX_SEEDS)
      .map((e) => ({ sn: str(e.sn), userId: str(e.userId), userToken: str(e.userToken) }));
    // Only a non-empty answer replaces the pool (native SeedRefresher.reseed()).
    if (clean.length === 0) return;
    writeJson("seeds", clean);
    writeJson("seedsAt", clock.now());
  }

  /** Re-downloads the pool; true when a non-empty pool is available afterwards. */
  function refreshSeeds({ periodic = false, timeoutMs = 15000 } = {}) {
    return poolLock(async () => {
      if (periodic) {
        if (!regionBlocked() || account()) return seedPool().length > 0;
        const at = readJson("seedsAt");
        if (typeof at === "number" && clock.now() - at < PERIODIC_REFRESH_MS) return seedPool().length > 0;
      }
      const now = clock.now();
      if (lastPoolRefreshMs !== null && now - lastPoolRefreshMs < POOL_REFRESH_COOLDOWN_MS) {
        return seedPool().length > 0;
      }
      await fetchSeeds(timeoutMs);
      const ok = seedPool().length > 0;
      if (ok) lastPoolRefreshMs = now;
      return ok;
    });
  }

  // ---- the public surface ----
  async function ensure() {
    await null;
    try { await lock(ensureUnlocked); } catch (e) { throw surface(e); }
  }

  async function login(email, password, bounds = {}) {
    await null;
    try { await lock(() => loginUnlocked(email, password, bounds)); }
    catch (e) {
      if (e instanceof PortalError) throw kino.error("auth_required", "Credenciales de Xuper inválidas");
      throw e;
    }
  }

  async function logout() {
    await null;
    try {
      await lock(async () => {
        const prev = readSession();
        if (!blank(prev.userToken)) {
          // Result ignored: the stored token is dropped either way. The account itself lives in
          // the plugin settings, which only the person can clear.
          try {
            await portal.call("v5/loginOut", { userId: prev.userId, userToken: prev.userToken },
              { baseFields: false, sn: prev.sn || null });
          } catch (_) { /* ignored */ }
        }
        forgetToken();
        await ensureAnonymousUnlocked();
      });
    } catch (e) { throw surface(e); }
  }

  /**
   * Runs `block({userId, userToken})` (token read from storage on EVERY attempt, so a retry sees
   * the renewed one). It does NOT call `ensure()` first: callers (catalog, resolve, live...) do,
   * because only they know whether a missing session is an error or just "not minted yet". Geo-block, dead token and dead seed rescue as native withValidSession;
   * never loops: at most 1 + geo 1 + reauth 1 + 3 rescue runs.
   */
  async function withValidSession(block) {
    await null;
    const settle = (r) => {
      if (r.err) throw mapPortalError(r.err.code, r.err.message, kino);
      exhausted = false;
      return r.value;
    };
    const attempt = async () => {
      try { return { value: await block(view()) }; }
      catch (e) { if (e instanceof PortalError) return { err: e }; throw e; }
    };
    const tokenUsed = view().userToken;
    let result = await attempt();
    if (!result.err) return settle(result);

    if (result.err.code === GEO_BLOCKED) {
      setRegion(true);
      if (!account()) {
        if (await switchToBackup(tokenUsed)) result = await attempt();
        if (!result.err) return settle(result);
      }
    }

    // Tried BEFORE the pool re-download: a token that merely expired just re-mints.
    if (await reauthenticate(tokenUsed)) {
      result = await attempt();
      if (!result.err) return settle(result);
    }

    if (SESSION_DEAD.has(result.err.code) && !account()) {
      setRegion(true);
      for (let round = 0; round < SEED_RESCUE_ROUNDS; round++) {
        if ((await refreshSeeds()) && (await switchToBackup(view().userToken))) {
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
          writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: c.sn });
          return { result: "ok", tries };
        } catch (e) { if (e instanceof PortalError) reached = true; /* this seed does not work right now: next */ }
      }
      // Bounded run where no probe even reached the portal: the person is offline, not out of seeds.
      if (typeof deadline === "number" && !reached) return { result: "offline", tries };
      return { result: "all_failed", tries };
    });
  }

  function kind() {
    if (account()) return "account";
    const s = readSession();
    if (blank(s.sn)) return "none";
    return seedPool().some((e) => e.sn === s.sn) ? "seed" : "own";
  }

  return {
    ensure, withValidSession, current: readSession, kind, login, logout, regionBlocked,
    seedsExhausted: () => exhausted, switchSeed, refreshSeeds, seedPool,
  };
}
