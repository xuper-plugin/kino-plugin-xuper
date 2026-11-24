// src/sources/xuper.js — the LIVE connector of the Magis portal "masnew" for Xuper's live aggregator, and its VOD for
// the masnew titles Xuper 2.x left in the library (src/legacy.js). A self-contained port (no Node) of Xuper 2.x's
// portal code: a 3DES-encrypted body per request (xuper-crypto.js), the live CDN's per-request signature
// (xuper-sign.js) and host failover. Runs in Kino through liveFetch (kino.fetch under the call's bounds,
// src/liveGate.js).
//
//   categories()            → getNextColumns(masnew_live)         → [{ id, title }]
//   channels(categoryId)    → v6/getLiveData paginado (250/pág)   → [{ id=channelCode, title, logo? }]
//   resolve(channelCode)    → v4/startPlayLive + v14/getSlbInfo   → { url, mime, headers (firmados) }
//
// 1.0.46 (seed design, owner decisions D1 = A′ … D8): the session is the device's OWN anonymous guest session, as in
// the old plugin (persisted in `o2:xsess`, reactivated on the stored device, a new device only when the portal says so);
// a backup session from the backend's GET /seed (src/seeds.js) replaces it only when it cannot be created or kept for a
// reason a seed gets around; the shared account is only the once-per-call retry of a live channel that needs an account.
//
// 1.0.45 (spec §5.1, Step 2):
//   - the portal secret is stored as JSON text (`o2:xcfg`, fresh 24 h, last-good up to 7 d, 10 min retry backoff
//     while the backend is down) and read once per call (`once("xuper:cfg")`); no module memo;
//   - the portal device `sn` is persisted (`o2:xsn`): no new portal device per runtime;
//   - columns whose title reads 18+ are flagged `adult` (src/sources/adult.js); columns whose stored list is empty
//     (`ctx.listMeta`, the framework's list meta) go last, so the category budget cuts them first;
//   - a list cut by a network failure after page 1 never replaces a stored full list.
import { liveFetch, timeoutFor } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { encryptBody, decryptBlob, hexToAscii, md5Hex, randomHex } from "./xuper-crypto.js";
import { buildSignContext, signRequest, tokenOf } from "./xuper-sign.js";
import { authed, currentBearer, isNotMember, notMemberActive, notMemberText } from "../api.js"; // el SECRET (magisKey + cuenta) se trae del backend CON BEARER (/xuper/config)
import { getJson, setJson, remove } from "../store.js";
import { once, saneAt, callSeq } from "../flight.js";
import { lang } from "../config.js";
import { isAdultTitle } from "./adult.js";
import * as seeds from "../seeds.js";

// ───────────────────────── constantes del protocolo (config.js del plugin) ─────────────────────────
// magisKey (clave 3DES) + cuenta compartida YA NO van hardcodeados acá: se traen del backend con Bearer
// (getConfig → /xuper/config) y se cachean. Así el secret no queda expuesto en el plugin.js público.
const HOSTS = ["osuhk.m3x8o50te.com", "oogoy.f30c96w8.com"];
const APP_ID = "com.android.msandroid";
const APK_VERSION = "49902";
const PORTAL_CODE = "masnew";
const SPKG_VER = "2025-08-07 05:40:11_36_16_";
const APK_VER_HEADER = "43404";
const USER_AGENT = "okhttp/3.12.12";
const CONTENT_TYPE = "application/json;charset=utf-8";
const SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
const PASSWORD_SALT = "cloudstream";
const FIXED_MAC = "02:00:00:00:00:00";
const LIVE_ROOT = "masnew_live";
const REQUEST_TIMEOUT_MS = 20000;
const RATE_LIMIT_MS = 400;
const LIST_PAGE_SIZE = 250;
const LIST_MAX_PAGES = 20;
const CATEGORIES_PAGE_SIZE = 200;

const DEVICE_FIXED = {
  loginType: "2", appLanguage: "en", hardwareInfo: "ranchu",
  model: "sdk_gphone64_arm64", product: "sdk_gphone64_arm64", cpu: "arm64-v8a",
  B29: "", reserve1: "", deviceToken: "", drmId: "", sdkVer: 36,
};
const FINGERPRINT_FIXED = {
  board: "goldfish_arm64", brand: "google", cpuAbi: "arm64-v8a", device: "emu64a",
  diskInfo: "8GB", display: "sdk_gphone64_arm64",
  fingerprint: "google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys",
  hardware: "ranchu", host: "abfarm", manufacturer: "Google",
  ramSize: "4GB", romSize: "8GB", tags: "release-keys", verId: "",
};

// ───────────────────────── helpers ─────────────────────────
const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const blank = (v) => str(v).trim() === "";
const notBlank = (v) => str(v).trim() !== "";
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const sleep = (ms) => (ms > 0 && typeof kino !== "undefined" && kino.sleep ? kino.sleep(ms) : Promise.resolve()); // Kino no tiene setTimeout

/** `n` random bytes as hex: Kino's CSPRNG (as the old plugin's device.js), else Math.random (a host without it). */
function rhex(n) {
  try {
    if (typeof kino !== "undefined" && kino.crypto && typeof kino.crypto.randomBytes === "function") return String(kino.crypto.randomBytes(n, "hex"));
  } catch (_) { /* below */ }
  return randomHex(n);
}
function randomMac() { return rhex(6).match(/../g).join(":"); }
function fingerprint() {
  return {
    ...FINGERPRINT_FIXED,
    androidId: rhex(8), cpuId: rhex(8), serialNumber: rhex(8),
    etheMac: randomMac(), gatewayMac: randomMac(), wifiMac: randomMac(),
  };
}
function activateBean(snToken) {
  return { snToken, authVersion: "", authCode: "", preCode: "", macAddr: FIXED_MAC, reserve1: "", openNum: 4, channel: "default", matadata: "", signdata: "" };
}
/** A device's sn from a `v3/snToken` answer: the portal's own, else md5(snToken + salt). */
const snFrom = (j, snToken) => (blank(j.sn) ? md5Hex(snToken + SNTOKEN_SALT) : str(j.sn)).toLowerCase();

const WORD = /^[A-Za-z0-9_-]{1,24}$/;
/** A short code for an error, fit for a log line: the portal's returnCode, a kino error's code, else its name. */
function codeOf(e) {
  const c = e instanceof PortalError ? e.code : (e && typeof e.code === "string" ? e.code : (e && e.name) || "error");
  return WORD.test(str(c)) ? str(c) : "?";
}
function log(line) { try { kino.log(line); } catch (_) { /* a log line never fails a call */ } }

// ───────────────────────── transporte del portal (port de portal.js call()) ─────────────────────────
// This runtime's portal state: the device sn (loaded from `o2:xsn`), the device's own anonymous session (`own`, also
// stored in `o2:xsess`), the host that answered last and the pacing clock. `epoch` moves when the own token dies, so the
// next activation gets a fresh single-flight key. `sharedSeq` / `ownGeoSeq`: the call that already tried the shared
// account / saw the own session geo-blocked / saw the own session fail for a reason a seed gets around.
const state = { sn: "", own: null, epoch: 0, preferredHost: null, nextSlotAt: 0, sharedSeq: -1, ownGeoSeq: -1, ownFailSeq: -1 };

/** Test helper: forget this runtime's session (a cold runtime). Storage (`o2:xsn`, `o2:xsess`, `o2:xcfg`) stays. */
export function _resetSession() {
  state.sn = ""; state.own = null; state.epoch++; state.preferredHost = null; state.nextSlotAt = 0;
  state.sharedSeq = -1; state.ownGeoSeq = -1; state.ownFailSeq = -1;
}

class PortalError extends Error {
  constructor(code, message, path) { super(message || code); this.name = "PortalError"; this.code = code; this.path = path || ""; }
}

/** The device dict every portal body ends with; `sn` is always the caller's (the mint sends ""). */
function deviceDict(sn) {
  return { ...DEVICE_FIXED, apkVersion: APK_VERSION, sysVersion: SPKG_VER, appId: APP_ID, sn: str(sn) };
}

function hostOrder() {
  if (!state.preferredHost) return HOSTS.slice();
  return [state.preferredHost, ...HOSTS.filter((h) => h !== state.preferredHost)];
}

// ── secret del portal (magisKey + cuenta): del backend CON BEARER (/xuper/config), cacheado ──
export const CFG_KEY = "o2:xcfg";   // JSON text (1.0.43 stored "[object Object]" under "xuperCfg", so last-good never worked)
export const SN_KEY = "o2:xsn";     // {"sn"}: this device's portal sn, persistent
export const SESS_KEY = "o2:xsess"; // secret {"sn","userId","userToken","at"}: the device's own anonymous session, bound to o2:xsn
const H_MS = 60 * 60 * 1000;
// 1 h (was 24 h): the backend gates /xuper/config by Bearer → current_user → group membership (cached 1 h on oleada), so
// re-fetching every 1 h closes the masnew (v1) window for someone who left the group to ≤1 h, aligned with the egress (v2)
// per-request enforcement. The last-good copy (below) still covers a backend OUTAGE; a 403 not_member never serves it.
const CFG_FRESH_MS = 1 * H_MS;
const CFG_MAX_STALE_MS = 7 * 24 * H_MS;
const CFG_RETRY_MS = 10 * 60 * 1000;        // backend down: serve the last-good secret, try again after 10 min

async function fetchBackendCfg(wantedMs) {
  const d = await authed("GET", "/xuper/config", undefined, timeoutFor(wantedMs)); // el backend lo gatea por Bearer
  const magisKey = str(d && d.magisKey).trim();
  if (blank(magisKey)) return null;
  return { magisKey, email: str(d && (d.email || d.username)).trim(), password: str(d && d.password), at: Date.now() };
}

// { magisKey, email, password }: once per call; across calls from storage (fresh 24 h). Past fresh it asks the
// backend (3 s when a last-good copy exists, else 8 s); a failure serves the last-good copy (up to 7 d old) and
// waits 10 min before asking again. No Bearer and nothing stored → throws (everything is gated by activation).
function getConfig() {
  return once("xuper:cfg", loadConfig);
}

/** The stored secret and its age (ms) while it is last-good (at most 7 d old), else null. Never asks the backend. */
function storedCfg(now) {
  const stored = getJson(CFG_KEY);
  if (!isObj(stored) || !notBlank(stored.magisKey)) return null;
  const at = Number(stored.at) || 0;
  // A stamp far in the future (a clock that ran ahead, then set back) reads as due for a refresh, still last-good.
  const age = saneAt(at, now) ? Math.max(0, now - at) : (at > now ? CFG_FRESH_MS : Infinity);
  return age < CFG_MAX_STALE_MS ? { cfg: stored, age } : null;
}

async function loadConfig() {
  // The access freeze is on (a 403 not_member from any endpoint): masnew refuses too — never serve even a fresh cached
  // secret, so a leaver cannot start new masnew content while frozen (the screen already shows the group gate). Without
  // this, a cached secret would keep masnew playable until its 6 h fresh window expires.
  if (notMemberActive()) throw kino.error("unavailable", "Xuper: not a Kino group member", { userMessage: notMemberText() });
  const now = Date.now();
  const last = storedCfg(now);
  if (last && last.age < CFG_FRESH_MS) return last.cfg;
  const failAt = last ? saneAt(last.cfg.failAt, now) : 0;
  if (last && failAt > 0 && now - failAt < CFG_RETRY_MS) return last.cfg;
  try {
    const fresh = await fetchBackendCfg(last ? 3000 : 8000);
    if (fresh) {
      setJson(CFG_KEY, fresh, { ttlMs: CFG_MAX_STALE_MS });
      return fresh;
    }
  } catch (e) {
    // Left the group (403 not_member): NEVER serve the last-good secret, or masnew would keep playing up to 7 d. Let it
    // fail (and the api.js freeze is already set) so v1 is cut within the 6 h fresh window like v2.
    if (isNotMember(e)) throw e;
    /* backend down or no Bearer: last-good below */
  }
  if (last) {
    setJson(CFG_KEY, { ...last.cfg, failAt: now }, { ttlMs: Math.max(60000, CFG_MAX_STALE_MS - last.age) });
    return last.cfg;
  }
  throw new Error(lang() === "en" ? "xuper: no secret from the backend (activate Xuper)" : "xuper: sin secret del backend (activa Xuper)");
}

/**
 * A portal answer's `data` (hex of the base64 text of its 3DES cipher) as text. Kino's native `kino.crypto` first: the pure
 * JS path took ~8.5 s per 250-channel page of v6/getLiveData on a Redmi (QuickJS), so the all-channels column never
 * listed inside a call's budget; natively it is a few ms. The pure path stays for a Kino without `decrypt` (or one that
 * refuses the input). `convert` (hex → text) is Kino 0.9.74+; before it the hex is turned in JS.
 */
export function openBlob(wireHex, keyHex) {
  const c = typeof kino !== "undefined" && kino ? kino.crypto : null;
  if (c && typeof c.decrypt === "function") {
    try {
      const b64 = typeof c.convert === "function" ? String(c.convert(wireHex, "hex", "utf8")) : hexToAscii(wireHex);
      const plain = c.decrypt("des-ede3-ecb", { key: keyHex, keyEncoding: "hex", data: b64, inputEncoding: "base64", outputEncoding: "utf8" });
      if (typeof plain === "string") return plain;
    } catch (_) { /* the pure path below says what is wrong, if anything */ }
  }
  return decryptBlob(wireHex, keyHex);
}

// opts: { baseFields=true, userId, userToken, sn, timeoutMs, cfg }: every id is the caller's (a session's, or "" for the
// mint); `cfg`: the secret to use as is (the contribution's stored one), else this call's (getConfig).
async function portalCall(path, bean = {}, opts = {}) {
  const cfg = opts.cfg || await getConfig();
  const { baseFields = true, userId = "", userToken = "", sn = "", timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  const body = {
    ...(baseFields ? { portalCode: PORTAL_CODE, userId, userToken } : {}),
    ...bean,
    ...deviceDict(sn),
  };
  const wire = encryptBody(JSON.stringify(body), cfg.magisKey);
  const headers = { apk: APP_ID, apkVer: APK_VER_HEADER, spkgVer: SPKG_VER, "User-Agent": USER_AGENT, "Content-Type": CONTENT_TYPE };

  // The portal limits the cadence: every call takes the next slot of a queue, RATE_LIMIT_MS apart. A shared "last call"
  // stamp let parallel callers (several columns of one merged category) sleep together and fire together.
  const slot = Math.max(Date.now(), state.nextSlotAt);
  state.nextSlotAt = slot + RATE_LIMIT_MS;
  if (slot > Date.now()) await sleep(slot - Date.now());

  let lastError = null;
  const order = hostOrder();
  for (let i = 0; i < order.length; i++) {
    const host = order[i];
    try {
      const res = await liveFetch(`https://${host}/api/portalCore/${path}`, {
        method: "POST", headers, body: wire, cookies: false, timeoutMs,
      });
      if (!res || !res.ok) { lastError = new Error("http " + (res && res.status)); continue; }
      const answer = JSON.parse(res.text());
      if (!isObj(answer)) { lastError = new Error("respuesta no es objeto"); continue; }
      state.preferredHost = host;
      const rc = answer.returnCode;
      const code = rc === undefined || rc === null ? "" : String(rc);
      if (code !== "" && code !== "0") {
        const em = typeof answer.errorMessage === "string" ? answer.errorMessage : "";
        throw new PortalError(code, em || code, path);
      }
      if (typeof answer.data === "string" && answer.data !== "") {
        const inner = JSON.parse(openBlob(answer.data, cfg.magisKey));
        if (!isObj(inner)) throw new Error("datos no son objeto");
        return inner;
      }
      if (isObj(answer.data)) return answer.data;
      return answer; // sin data (active/login a veces devuelven campos al tope)
    } catch (e) {
      if (e instanceof PortalError) throw e; // error del portal: final, no se reintenta en otro host
      lastError = e;
    }
  }
  throw lastError || new Error("portal no contactable");
}

// ───────────────────────── sesión (seed design §2–§3, owner decisions D1 = A′, D2) ─────────────────────────
// The primary is the device's OWN anonymous guest session, as in the old plugin: its token in memory, else `o2:xsess`,
// else `v8/active` on the stored device (`o2:xsn`), else — only when the portal says that device cannot activate
// (aaa100080/aaa100082) or there is none — a new device (`v3/snToken` with sn "" + `v8/active`).
// A seed (src/seeds.js) replaces it only for a reason a seed gets around:
//   - the portal refusing this device a guest session: portal100024 (geo), snToken_failed, active_sin_token, or
//     aaa100080/aaa100082 on a brand-new device;
//   - portal100024 on content (the region is blocked);
//   - the session dying again (aaa100027/28/83) right after a fresh own renewal, on a listing or VOD call.
// Never on a transport error (a seed goes to the same hosts), portal200001 or an unknown code (D2). aaa100028 on
// v4/startPlayLive right after a fresh renewal means the CHANNEL needs an account: it is retried once per call with the
// shared account of /xuper/config on this device's sn (never stored, never with a seed: A′), else the person reads so.
// aaa100028 anywhere else, right after a fresh renewal or on a seed, is probed first (seed-economy-F2): when the session
// still reads a column, the CONTENT needs an account, which no anonymous seed opens: no seed is asked or dropped for it.
// A held seed is used until its end (its renewal point, src/seeds.js atEnd): there the own session is tried once more,
// so the device goes back to it once the block lifts (design §2); the seed stays the fallback until its floor.
// Every content step (one or two calls) runs on ONE session object { kind: "own"|"seed"|"shared", sn, userId, userToken }.
const SN_RE = /^[0-9a-z]{8,64}$/;
const GEO = "portal100024";
const INVALID_SN = new Set(["aaa100080", "aaa100082"]);
const SESSION_DEAD = new Set(["aaa100027", "aaa100028", "aaa100083"]);
const NEEDS_ACCOUNT = "aaa100028";
const VERSION_REFUSED = "portal200001";

/** This device's portal sn: this runtime's, else the persisted one (`o2:xsn`), else "". */
function knownSn() {
  if (blank(state.sn)) {
    const s = getJson(SN_KEY);
    const sn = isObj(s) ? str(s.sn).toLowerCase() : "";
    if (SN_RE.test(sn)) state.sn = sn;
  }
  return state.sn;
}

/** The own session kept in `o2:xsess` for device `sn`, or null. */
function storedOwn(sn) {
  const s = getJson(SESS_KEY);
  return isObj(s) && str(s.sn) === sn && notBlank(s.userToken) ? { sn, userId: str(s.userId), userToken: str(s.userToken), seq: -1 } : null;
}

/** Whether this device holds its own anonymous session (memory or `o2:xsess`). */
function hasOwnSession() {
  const sn = knownSn();
  return !!sn && ((state.own && state.own.sn === sn) || !!storedOwn(sn));
}

function keepOwn(sn, a) {
  state.own = { sn, userId: str(a.userId), userToken: str(a.userToken), seq: callSeq() };
  setJson(SESS_KEY, { sn, userId: state.own.userId, userToken: state.own.userToken, at: Date.now() });
  return state.own;
}

/** The own token `token` died: forgotten (memory and storage) unless a concurrent caller already renewed it. */
function forgetOwn(token) {
  if (!state.own || state.own.userToken !== token) return;
  state.own = null;
  remove(SESS_KEY);
  state.epoch++;
}

const tagged = (e, step) => { if (e && typeof e === "object" && !e.step) { try { e.step = step; } catch (_) { /* frozen */ } } return e; };

async function activateOwn(sn) {
  const a = await portalCall("v8/active", activateBean(""), { baseFields: false, sn });
  if (blank(a && a.userToken)) throw new PortalError("active_sin_token", "activación sin userToken", "v8/active");
  log("xsess: activate ok");
  return keepOwn(sn, a);
}

async function mintOwn() {
  const j = await portalCall("v3/snToken", fingerprint(), { baseFields: false, sn: "" });
  if (blank(j && j.snToken)) throw new PortalError("snToken_failed", "el portal no devolvió snToken", "v3/snToken");
  const snToken = str(j.snToken);
  const sn = snFrom(j, snToken);
  state.sn = sn;
  if (SN_RE.test(sn)) setJson(SN_KEY, { sn, at: Date.now() });   // the next runtimes reactivate this device
  const a = await portalCall("v8/active", activateBean(snToken), { baseFields: false, sn });
  if (blank(a && a.userToken)) throw new PortalError("active_sin_token", "activación sin userToken", "v8/active");
  log("xsess: mint ok");
  return keepOwn(sn, a);
}

/** The own session: memory, else storage, else a reactivation of the stored device, else a new device. */
async function openOwn() {
  const sn = knownSn();
  if (sn && state.own && state.own.sn === sn) return state.own;
  const stored = sn ? storedOwn(sn) : null;
  if (stored) { state.own = stored; return stored; }
  if (sn) {
    try { return await activateOwn(sn); }
    catch (e) {
      log("xsess: activate fail code=" + codeOf(e));
      if (!(e instanceof PortalError && INVALID_SN.has(e.code))) throw tagged(e, "activate");
    }
  }
  try { return await mintOwn(); }
  catch (e) { log("xsess: mint fail code=" + codeOf(e)); throw tagged(e, "mint"); }
}

/** Why a failure to open the own session is one a seed gets around ("geo" | "mint"), else null (D2). */
function fixable(e) {
  if (!(e instanceof PortalError)) return null;
  if (e.code === GEO) return "geo";
  if (e.code === "snToken_failed" || e.code === "active_sin_token") return "mint";
  if (INVALID_SN.has(e.code) && e.step === "mint") return "mint";
  return null;
}

/** `e` with the sentence the person reads for it, when there is one. */
function explain(e) {
  if (e instanceof PortalError && e.code === VERSION_REFUSED && !e.userMessage) {
    e.userMessage = lang() === "en"
      ? "Xuper is not accepting connections right now. It usually comes back by itself; try again in a few minutes."
      : "Xuper no está aceptando conexiones por ahora. Suele volver solo; vuelve a intentar en unos minutos.";
  }
  return e;
}

/** `e` with the needs-an-account sentence: for a live channel (`channel`), or for any other content (a title, a list). */
function needsAccount(e, channel = true) {
  const en = lang() === "en";
  e.userMessage = channel
    ? (en ? "This channel needs a Xuper account; it cannot play with the anonymous session. Try another channel."
      : "Este canal necesita una cuenta de Xuper; con la sesión anónima no se puede ver. Prueba otro canal.")
    : (en ? "This content needs a Xuper account; it is not available with the anonymous session."
      : "Este contenido necesita una cuenta de Xuper; con la sesión anónima no está disponible.");
  return e;
}

const seedSession = (s) => ({ kind: "seed", sn: s.sn, userId: s.userId, userToken: s.userToken, gotAt: s.gotAt });
const sessionOpts = (s) => ({ baseFields: true, userId: s.userId, userToken: s.userToken, sn: s.sn });

/** A seed because the own session failed for `reason`: the held one or one GET /seed; none → `cause` with its sentence. */
async function viaSeed(reason, cause) {
  const r = await seeds.need(reason);
  if (r.seed) { log("seed:use why=" + reason); return seedSession(r.seed); }
  const err = cause || new PortalError(reason === "geo" ? GEO : "no_session", "xuper: no session and no backup session");
  const text = seeds.noSeedText(reason, r);
  if (text) err.userMessage = text;
  throw explain(err);
}

/**
 * The session the next step runs on: the held seed, else the own one, else a seed. A held seed at its end (src/seeds.js
 * atEnd) is where the own session is tried once more (design §2): it rides along as `ending`, the fallback when the own
 * one fails for a reason no seed fixes (src/seeds.js need() asks its replacement for the others).
 */
async function acquire() {
  const h = seeds.held();
  if (h && (!seeds.atEnd(h) || state.ownFailSeq === callSeq())) return seedSession(h);
  if (state.ownGeoSeq === callSeq()) return viaSeed("geo", null);   // this call saw the own session geo-blocked
  let own;
  try { own = await once("xuper:own:" + state.epoch, openOwn); }
  catch (e) {
    const why = fixable(e);
    if (!why) { if (h) return seedSession(h); throw explain(e); }
    state.ownFailSeq = callSeq();
    return viaSeed(why, e);
  }
  return { kind: "own", sn: own.sn, userId: own.userId, userToken: own.userToken, seq: own.seq, ending: h };
}

/**
 * Seed `s` was refused (`e`): dropped, then replaced — directly when the own session already failed in this call, else
 * the own session first (design §2): a stored need ("geo") may be hours old, and the block may have lifted since.
 */
async function replaceSeed(s, e) {
  const why = e.code === GEO ? "geo" : "dead";
  seeds.drop(s, why);
  if (state.ownFailSeq === callSeq()) return viaSeed(seeds.needOf() || why, e);
  return acquire();
}

/** aaa100028 on a fresh session: does the session itself still answer? "alive" | "dead" | "error" (no answer). */
async function probe(s) {
  try {
    await portalCall("getNextColumns", { columnCode: LIVE_ROOT, pageNum: 1, pageSize: 1, version: "" }, sessionOpts(s));
    return "alive";
  } catch (e) {
    if (!(e instanceof PortalError)) return "error";
    return e.code === GEO || SESSION_DEAD.has(e.code) ? "dead" : "alive";
  }
}

function loginBean(cfg) {
  return {
    accountType: "2", userName: cfg.email, password: md5Hex(cfg.password + PASSWORD_SALT),
    type: "1", macAddr: FIXED_MAC, areaCode: "", verificationCode: "", verificationToken: "",
    matadata: "", signdata: "", channel: "default",
  };
}

/**
 * A live channel that needs an account (aaa100028 on v4/startPlayLive): ONE retry per call with the shared account on
 * this device's sn (A′). Never stored, never on a seed; when it fails too the person reads that the channel needs one.
 */
async function sharedRetry(step, cause) {
  if (state.sharedSeq === callSeq()) throw needsAccount(cause);
  state.sharedSeq = callSeq();
  const sn = knownSn();
  let cfg = null;
  try { cfg = await getConfig(); } catch (_) { cfg = null; }
  if (!sn || !cfg || blank(cfg.email) || blank(cfg.password)) { log("xsess: shared skip"); throw needsAccount(cause); }
  let j;
  try { j = await portalCall("v8/login", loginBean(cfg), { baseFields: false, sn }); }
  catch (e) { log("xsess: shared login fail code=" + codeOf(e)); throw needsAccount(cause); }
  if (blank(j && j.userToken)) throw needsAccount(cause);
  try {
    const out = await step({ kind: "shared", sn, userId: str(j.userId), userToken: str(j.userToken) });
    log("xsess: shared ok");
    return out;
  } catch (e) {
    log("xsess: shared fail code=" + codeOf(e));
    throw e instanceof PortalError ? needsAccount(e) : e;
  }
}

/**
 * Runs one content step (`step(session)`: one or two portal calls on the same session) under the session rules above.
 * `opts.liveOpen`: the step opens a live channel (its v4/startPlayLive gets the needs-an-account reading).
 */
async function withSession(step, opts = {}) {
  let s = await acquire();
  let renewed = false;
  for (let round = 0; ; round++) {
    try {
      const out = await step(s);
      if (s.kind === "own") seeds.ownOk();
      else if (s.kind === "seed") seeds.seedOk(s);
      return out;
    } catch (e) {
      if (!(e instanceof PortalError) || round >= 4) throw explain(e);
      const account = e.code === NEEDS_ACCOUNT;
      const liveAccount = account && !!opts.liveOpen && e.path === "v4/startPlayLive";
      if (s.kind === "own") {
        if (e.code === GEO) { state.ownGeoSeq = state.ownFailSeq = callSeq(); s = await viaSeed("geo", e); continue; }
        if (!SESSION_DEAD.has(e.code)) {
          const h = s.ending ? seeds.held() : null;
          if (h) { s = seedSession(h); continue; }   // the seed at its end still serves until its floor
          throw explain(e);
        }
        if (!renewed && s.seq !== callSeq()) {   // an older token: renew it once (concurrent callers share the renewal)
          renewed = true;
          log("xsess: renew code=" + codeOf(e));
          forgetOwn(s.userToken);
          s = await acquire();
          continue;
        }
        // A fresh token refused again.
        if (liveAccount) return sharedRetry(step, e);
        if (account) {
          const v = await probe(s);
          if (v === "alive") throw needsAccount(e, false);   // the session reads a column: the content needs an account
          if (v === "error") throw explain(e);
        }
        state.ownFailSeq = callSeq();
        s = await viaSeed("dead", e);
        continue;
      }
      if (s.kind === "seed") {
        if (account) {
          const v = await probe(s);
          if (v === "alive") {   // the seed answers: the channel or content needs an account; the seed is kept
            seeds.seedOk(s);
            if (liveAccount) return sharedRetry(step, e);
            throw needsAccount(e, false);
          }
          if (v === "error") throw explain(e);
        } else if (!(e.code === GEO || SESSION_DEAD.has(e.code))) throw explain(e);
        s = await replaceSeed(s, e);
        continue;
      }
      throw explain(e);
    }
  }
}

/** One authenticated portal call as a step of its own. */
const call = (path, bean, opts) => withSession((s) => portalCall(path, bean, sessionOpts(s)), opts);

/** For the Ajustes card (src/seeds.js status): the session kind, time left on a seed, the region, a backoff. */
export function sessionStatus(now) { return seeds.status(hasOwnSession(), now); }

/**
 * Whether a portal call could go out now from what is stored: the Bearer and a last-good portal secret (the
 * contribution's gate). Never asks the backend: the contribution runs after Home, which must not wait on it
 * (contract-ux-F2). Never throws.
 */
export async function portalReady() {
  try {
    return !!(await currentBearer()) && !!storedCfg(Date.now());
  } catch (_) { return false; }
}

/**
 * The seed contribution's mint (src/seedContrib.js, the old plugin's mintAnonymous): a BRAND-NEW anonymous device (a
 * fresh fingerprint, sn ""), its activation, then `validateColumn` read with its new ids. Explicit ids everywhere: the
 * person's own session is never touched. The stored secret only (never fetched from Home). Each request at most
 * `requestMs` (and the caller's `within`). → { ok: true, sn, act, col } | { ok: false, why, code? }. Never throws.
 */
export async function mintAnonymous({ requestMs, validateColumn }) {
  try {
    const last = storedCfg(Date.now());
    if (!last) return { ok: false, why: "nokey" };
    const cfg = last.cfg;
    const mint = await portalCall("v3/snToken", fingerprint(), { baseFields: false, sn: "", timeoutMs: requestMs, cfg });
    if (blank(mint && mint.snToken)) return { ok: false, why: "no_sntoken" };
    const snToken = str(mint.snToken);
    const sn = snFrom(mint, snToken);
    const act = await portalCall("v8/active", activateBean(snToken), { baseFields: false, sn, timeoutMs: requestMs, cfg });
    if (blank(act && act.userToken) || blank(act && act.userId)) return { ok: false, why: "no_token" };
    const col = await portalCall("getNextColumns", { columnCode: validateColumn, pageNum: 1, pageSize: 1, version: "" },
      { baseFields: true, userId: str(act.userId), userToken: str(act.userToken), sn, timeoutMs: requestMs, cfg });
    return { ok: true, sn, act, col };
  } catch (e) {
    return { ok: false, why: e instanceof PortalError ? "portal" : "error", code: codeOf(e) };
  }
}

// ───────────────────────── mapeo de datos ─────────────────────────
const ALL_CHANNELS = "ChannelList";
const INT = /^[+-]?\d+$/;
const intOrNull = (v) => { const t = str(v); return INT.test(t) ? Number(t) : null; };

function logoOf(c) {
  for (const k of ["logo", "icon", "pic", "poster", "image", "cover", "verImg", "horImg"]) {
    const v = c && c[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return "";
}

function bareHost(mainAddr) {
  let s = str(mainAddr);
  if (s.startsWith("https://")) s = s.slice(8);
  if (s.startsWith("http://")) s = s.slice(7);
  const slash = s.indexOf("/");
  return slash >= 0 ? s.slice(0, slash) : s;
}

function isCfl(url) {
  return str(url).slice(str(url).lastIndexOf("?") + 1).split("&").some((p) => p.trim() === "sign_type=cfl");
}

// playCode + license de la MISMA entrada de liveAddressList (nunca cruzados).
function signalFrom(play) {
  let firstLicense = null;
  const list = isObj(play) && Array.isArray(play.liveAddressList) ? play.liveAddressList : [];
  for (const a of list) {
    if (!isObj(a)) continue;
    const license = str(a.license);
    const playCode = str(a.playCode);
    if (firstLicense === null) firstLicense = license;
    if (notBlank(playCode) && notBlank(license)) return { playCode, license };
  }
  return firstLicense === null ? null : { playCode: "", license: firstLicense };
}

// Cada CDN de vivo × cada url_list cfl, en orden del portal.
function liveCdns(slb) {
  const out = [];
  const cdnList = isObj(slb) && Array.isArray(slb.cdn_list) ? slb.cdn_list : [];
  for (const cdn of cdnList) {
    if (!isObj(cdn) || str(cdn.tag) !== "live") continue;
    const urls = Array.isArray(cdn.url_list) ? cdn.url_list : [];
    for (const u of urls) {
      if (!isObj(u)) continue;
      const url = str(u.url);
      if (!isCfl(url) && str(u.sign_type) !== "cfl") continue;
      const host = bareHost(str(cdn.main_addr));
      if (notBlank(host)) out.push({ cflHost: host, authBase: url });
    }
  }
  return out;
}

const slbBean = (liveCodes) => ({
  hasPay: "0", userIdentity: "1", type: "merge", appVer: APK_VERSION, lang: "es", encMediaSupported: 1,
  liveCodeList: [...liveCodes], appParams: "", reserve1: FIXED_MAC, pipFlag: "0",
});

// ───────────────────────── el conector ─────────────────────────

// 18+ columns by title: the rule every live connector shares (src/sources/adult.js). Kino gates `adult` categories;
// the own screen leaves them out of its dropdowns.

/** Whether a column's stored list is known to be empty (the framework's list meta: 0 channels at its last listing). */
function knownEmpty(ctx, columnId) {
  const m = ctx && typeof ctx.listMeta === "function" ? ctx.listMeta(columnId) : null;
  return !!m && m.n === 0;
}

async function categories(ctx) {
  const resp = await call("getNextColumns", { columnCode: LIVE_ROOT, pageNum: 1, pageSize: CATEGORIES_PAGE_SIZE, version: "" });
  const columns = isObj(resp) && Array.isArray(resp.recommendList) ? resp.recommendList : [];
  const full = [];
  const empties = [];
  for (const c of columns) {
    if (!isObj(c)) continue;
    const id = intOrNull(c.columnId);
    if (id === null || id <= 0) continue;
    const raw = str(c.name);
    if (blank(raw)) continue;
    // Stored whole: the framework shows it in the visible language, also after a language switch.
    const title = raw === ALL_CHANNELS ? { es: "Todos", en: "All channels" } : raw;
    const cat = { id: String(id), title };
    if (isAdultTitle(raw)) cat.adult = true;
    (knownEmpty(ctx, cat.id) ? empties : full).push(cat);   // portal order; known-empty columns last
  }
  return full.concat(empties);
}

// A column of thousands of channels (the all-channels one, 250 a page) may not list inside one call's budget (a screen
// tick has 3–8 s). A listing cut by the call's own limits after some pages is kept: the channels so far are stored as a
// stale list (src/live.js shows them at once and refreshes the list in the next tick or call), and where to go on is
// kept here, per column: `{ "<column id>": { page, n, at } }` = the next page and how many channels the stored list
// holds. The next listing goes on from that page when the stored list still holds those `n` channels (else page 1).
export const PART_KEY = "o2:xpart";
const PART_MAX_AGE_MS = 6 * H_MS;
const PART_MAX_COLUMNS = 4;
const OWN_LIMITS = new Set(["deadline", "budget", "invalid_request"]);

function parts() { const p = getJson(PART_KEY); return isObj(p) ? p : {}; }

/** Where column `id`'s cut listing goes on: `{ page, out }` (its raw channels so far), or null (from page 1). */
function resumePoint(id, ctx) {
  const p = parts()[id];
  if (!isObj(p)) return null;
  const at = saneAt(p.at);
  const page = Number(p.page), n = Number(p.n);
  if (!at || Date.now() - at > PART_MAX_AGE_MS || !(page >= 2 && page <= LIST_MAX_PAGES) || !(n > 0)) return null;
  const stored = ctx && typeof ctx.storedList === "function" && typeof ctx.rawIdOf === "function" ? ctx.storedList(id) : null;
  if (!Array.isArray(stored) || stored.length !== n) return null;
  const out = [];
  for (const it of stored) {
    const code = str(ctx.rawIdOf(it));
    if (blank(code)) return null;
    const ch = { id: code, title: str(it && it.title) };
    if (it.logo) ch.logo = str(it.logo);
    out.push(ch);
  }
  return { page, out };
}

function setPart(id, entry) {
  const p = parts();
  if (entry) p[id] = entry; else if (id in p) delete p[id]; else return;
  const ids = Object.keys(p).sort((a, b) => (Number(p[b] && p[b].at) || 0) - (Number(p[a] && p[a].at) || 0));
  for (const k of ids.slice(PART_MAX_COLUMNS)) delete p[k];
  if (Object.keys(p).length) setJson(PART_KEY, p, { ttlMs: PART_MAX_AGE_MS }); else remove(PART_KEY);
}

/**
 * Keeps a cut listing (`out` so far, `page` the one that was not fetched): stored as a stale list with its resume point,
 * `e` marked `partial` (src/live.js then serves what was stored). Never over a stored list that holds more channels (a
 * whole list being refreshed stays as it is, served stale).
 */
function keepPart(id, page, out, ctx, e) {
  if (!out.length || !ctx || typeof ctx.putList !== "function") return e;
  const stored = typeof ctx.storedList === "function" ? ctx.storedList(id) : null;
  if (Array.isArray(stored) && stored.length > out.length) return e;
  try {
    const r = ctx.putList(id, out, { partial: true });
    const n = r && Array.isArray(r.items) ? r.items.length : 0;
    if (n > 0) {
      setPart(id, { page, n, at: Date.now() });
      if (e && typeof e === "object") { try { e.partial = true; } catch (_) { /* frozen */ } }
      log("xuper: column " + id + " cut at page " + page + ", " + n + " channels kept");
    }
  } catch (_) { /* nothing kept: the next listing starts again */ }
  return e;
}

async function channels(categoryId, ctx) {
  const id = String(Number(categoryId));
  if (!/^\d+$/.test(id) || Number(id) <= 0) return [];
  const resume = resumePoint(id, ctx);
  const out = resume ? resume.out : [];
  const seen = new Set(out.map((c) => c.id));
  const first = resume ? resume.page : 1;
  for (let page = first; page <= LIST_MAX_PAGES; page++) {
    let list;
    try {
      const resp = await call("v6/getLiveData", { columnId: Number(id), pageNum: page, pageSize: LIST_PAGE_SIZE, dataVersion: "", expireTimeStr: "" });
      list = isObj(resp) && Array.isArray(resp.channelList) ? resp.channelList : [];
    } catch (e) {
      if (page === 1) throw e;
      // This call's own limits (its deadline, its request budget, Kino's 60 requests, a timeout its bounds cut short)
      // cut the list: it is never stored as if it were whole; the pages so far are kept as a stale list that the next
      // tick or call goes on with.
      if (e && (OWN_LIMITS.has(e.code) || e.limited === true)) throw keepPart(id, page, out, ctx, e);
      // A later page: the portal refusing it ends the listing (as the native app does). A network failure would cut
      // the list, so a stored full list is kept instead (throw: src/live.js serves it), and a cut one goes on later.
      if (!(e instanceof PortalError)) {
        if (resume) throw keepPart(id, page, out, ctx, e);
        const stored = ctx && typeof ctx.storedList === "function" ? ctx.storedList(categoryId) : null;
        if (stored && stored.length > out.length) throw e;
      }
      break;
    }
    for (const c of list) {
      if (!isObj(c)) continue;
      const code = str(c.channelCode);
      const title = str(c.name);
      if (blank(code) || blank(title) || seen.has(code)) continue;
      seen.add(code);
      const ch = { id: code, title };
      const logo = logoOf(c);
      if (logo) ch.logo = logo;
      out.push(ch);
    }
    if (list.length < LIST_PAGE_SIZE) break;
  }
  if (resume || isObj(parts()[id])) setPart(id, null);
  return out;
}

async function resolve(channelId) {
  const code = str(channelId);
  if (blank(code)) throw new Error("xuper: canal vacío");
  // startPlayLive y getSlbInfo con la MISMA sesión.
  const { signal, slb } = await withSession(async (s) => {
    const play = await portalCall("v4/startPlayLive", { channelCode: code, columnId: 0, type: "1" }, sessionOpts(s));
    const signal = signalFrom(play);
    if (!signal) throw new Error("xuper: el canal no dio dirección de señal");
    if (blank(signal.license)) throw new Error("xuper: el canal no dio licencia");
    return { signal, slb: await portalCall("v14/getSlbInfo", slbBean([code]), sessionOpts(s)) };
  }, { liveOpen: true });
  const all = liveCdns(slb);
  if (all.length === 0) throw new Error("xuper: sin servidor de vivo (CDN)");
  const withToken = all.filter((d) => tokenOf(d.authBase) !== "");
  if (withToken.length === 0) throw new Error("xuper: el servidor de vivo no trae token");
  const ALT = /^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/;
  const cdns = withToken.filter((d) => ALT.test(d.cflHost));
  if (cdns.length === 0) throw new Error("xuper: dirección de CDN inválida");

  const built = buildSignContext(signal.license, cdns, Date.now());
  if (!built) throw new Error("xuper: datos de señal demasiado largos");
  const primary = built.kept[0].cflHost;
  const playCode = notBlank(signal.playCode) ? signal.playCode : code;
  const url = `http://${primary}/live/${playCode}.m3u8`;
  const { headers } = signRequest({ url, context: built.context }, Date.now());
  return { url, mime: "application/vnd.apple.mpegurl", headers };
}

// ═══════════════════════ VOD (title fallback, and the masnew titles of 2.x) ═══════════════════════════════════
// Reuses the live connector's session, portal client (withSession), crypto and getSlbInfo above.
// A port of Xuper 2.x's VOD (resolve.js: v10/startPlayVOD + v14/getSlbInfo + rankedMedia/tracks/subtitles/alternatives;
// search.js: v3/searchByName; episodes.js: v4/getItemData).
// The catalog of this version is another portal's ("magispro", other ids), so the bridge to masnew for a catalog title
// is BY TITLE: a movie's title is searched on masnew and its best match plays. A title 2.x saved carries masnew's own
// id and plays by it (src/catalog.js legacy path).
const UA_CDN = "Ranger/4.9.4-17294ac0"; // UA que la CDN de VOD espera (NO la okhttp del portal)
const SEARCH_PAGE_SIZE = 20;
const MAX_ALTERNATIVES = 8;
const MAX_SUBTITLES = 30;
const AUTH_MARGIN_S = 300;
const EXPIRES_MIN_S = 30;
const EXPIRES_MAX_S = 86400;
const EXPIRED_RE = /expired=(\d+)/;
const VOD_MATCH_THRESHOLD = 0.6; // score mínimo para aceptar un match (evita falsos positivos)

// — normalización de títulos (acentos fuera, sólo letras/números) —
function normTitle(s) {
  return str(s).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function titleTokens(s) { const n = normTitle(s); return n === "" ? [] : n.split(" "); }

// main_addr como base url (barras finales fuera; http(s) agregado a un host pelado).
function withScheme(mainAddr) {
  const clean = str(mainAddr).replace(/\/+$/, "");
  return clean.startsWith("http://") || clean.startsWith("https://") ? clean : `https://${clean}`;
}

// h264 primero, luego mp4 (MagisResolve.bestMedia): corre en más aparatos.
const mediaScore = (m) =>
  (str(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (str(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);

// Todas las pistas del título, la más reproducible primero; estable. Una pista sin contentId no tiene
// ruta de media (`/vod/_media.mp4`): no es una pista.
function rankedMedia(play) {
  const episode = isObj(play) && Array.isArray(play.episodeList) ? play.episodeList.find(isObj) : null;
  if (!episode) return [];
  const out = [];
  for (const tm of (Array.isArray(episode.totalMovieList) ? episode.totalMovieList : [])) {
    if (!isObj(tm)) continue;
    for (const m of (Array.isArray(tm.movieList) ? tm.movieList : [])) {
      if (isObj(m) && notBlank(m.contentId)) out.push(m);
    }
  }
  return out.map((m, i) => ({ m, i, s: mediaScore(m) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.m);
}

// Licencia propia de la pista (MagisResolve: licenseList[0].license).
function licenseOf(m) {
  const first = isObj(m) && Array.isArray(m.licenseList) ? m.licenseList.find(isObj) : null;
  return first ? str(first.license) : "";
}

// Cada CDN de VOD con Content-Auth cfl gratis, en orden del portal: { bases:[main_addr, spared_addr], auth }.
function vodCdns(slb) {
  const out = [];
  const list = isObj(slb) && Array.isArray(slb.cdn_list) ? slb.cdn_list : [];
  for (const cdn of list) {
    if (!isObj(cdn) || str(cdn.tag) !== "vod") continue;
    for (const u of (Array.isArray(cdn.url_list) ? cdn.url_list : [])) {
      if (!isObj(u)) continue;
      const url = str(u.url);
      if ((isCfl(url) || str(u.sign_type) === "cfl") && str(u.tag) === "free") {
        const bases = [withScheme(str(cdn.main_addr))];
        const spare = str(cdn.spared_addr).trim();
        if (notBlank(spare) && !bases.includes(withScheme(spare))) bases.push(withScheme(spare));
        out.push({ bases, auth: url });
        break;
      }
    }
  }
  return out;
}

// subtitleList[].file[0].url → formato de Kino { url, lang, format? }. Topa en 30.
function readSubtitles(play) {
  const episode = isObj(play) && Array.isArray(play.episodeList) ? play.episodeList.find(isObj) : null;
  const out = [];
  for (const sub of (isObj(episode) && Array.isArray(episode.subtitleList) ? episode.subtitleList : [])) {
    if (!isObj(sub)) continue;
    const file = Array.isArray(sub.file) ? sub.file.find(isObj) : null;
    if (!file) continue;
    const url = str(file.url);
    if (blank(url)) continue;
    const s = { url, lang: str(sub.language) };
    const ft = str(file.fileType).toLowerCase();
    if (ft === "vtt" || ft === "srt") s.format = ft; // Kino infiere los demás
    out.push(s);
    if (out.length >= MAX_SUBTITLES) break;
  }
  return out;
}

// Segundos que la url firmada sigue sirviendo: su Content-Auth expired=<unix> menos ahora y margen; null si no hay.
function expiresInSeconds(auth, nowMs) {
  const m = EXPIRED_RE.exec(str(auth));
  if (!m) return null;
  const left = Number(m[1]) - Math.floor(nowMs / 1000) - AUTH_MARGIN_S;
  if (!Number.isFinite(left)) return null;
  return Math.min(EXPIRES_MAX_S, Math.max(EXPIRES_MIN_S, left));
}

// — búsqueda por título (v3/searchByName) —
const eachObj = (list, f) => { if (Array.isArray(list)) for (const x of list) if (isObj(x)) f(x); };

// El portal responde en tres formas según el endpoint (port de search.js flatten()).
function searchFlatten(resp) {
  const out = [];
  if (isObj(resp)) {
    eachObj(resp.searchItemList, (group) => eachObj(group.itemList, (x) => out.push(x)));
    if (out.length === 0) eachObj(Array.isArray(resp.assetList) ? resp.assetList : resp.list, (x) => out.push(x));
  }
  return out;
}

function slimHit(raw) {
  if (!isObj(raw)) return null;
  const c = str(raw.contentId).trim();
  if (c === "") return null;
  const name = [raw.name, raw.viewPoint, raw.alias].map(str).find((s) => s.trim() !== "") ?? "";
  if (name === "") return null;
  const programType = str(raw.programType).trim();
  const legacyType = str(raw.type).trim(); // "1" película / "0" serie (algunos endpoints usan `type`)
  const type = programType !== "" ? programType : legacyType !== "" ? legacyType : "movie";
  return { contentId: c, name, type };
}

const SERIES_TYPES = new Set(["series", "tv", "variety", "anime", "0"]);
const isSeriesType = (t) => SERIES_TYPES.has(str(t).toLowerCase());

// Score de match título↔candidato: 1.0 exacto (normalizado); ≥0.8 si la query es subconjunto de los
// tokens del título; si no, Jaccard de tokens. Así se prefiere el match exacto/normalizado y se evitan
// falsos positivos (un candidato muy distinto queda por debajo del umbral).
function titleMatchScore(query, title) {
  const nq = normTitle(query), nt = normTitle(title);
  if (nq === "" || nt === "") return 0;
  if (nq === nt) return 1;
  const qs = new Set(titleTokens(query)), ts = new Set(titleTokens(title));
  if (qs.size === 0 || ts.size === 0) return 0;
  let inter = 0;
  for (const t of qs) if (ts.has(t)) inter++;
  const union = new Set([...qs, ...ts]).size;
  const jac = inter / union;
  const subset = [...qs].every((t) => ts.has(t));
  return subset ? 0.8 + 0.2 * jac : jac;
}

/**
 * Busca `title` en masnew (v3/searchByName) y devuelve el MEJOR match como { contentId, type, name },
 * o null si no hay match razonable. Reusa la sesión del conector (withSession). Prefiere match
 * exacto/normalizado; a igualdad de score prefiere película sobre serie y el que vino antes.
 */
export async function searchVod(title) {
  const q = str(title).trim();
  if (q === "") return null;
  const resp = await call("v3/searchByName", {
    value: q, type: "0", columnId: "", filter: "", pageNum: 1, pageSize: SEARCH_PAGE_SIZE,
  });
  const hits = [];
  const seen = new Set();
  for (const raw of searchFlatten(resp)) {
    const hit = slimHit(raw);
    if (!hit || seen.has(hit.contentId)) continue;
    seen.add(hit.contentId);
    hits.push(hit);
  }
  if (hits.length === 0) return null;

  let best = null, bestScore = -1;
  for (const h of hits) {
    const score = titleMatchScore(q, h.name);
    const better =
      score > bestScore + 1e-9 ||
      (Math.abs(score - bestScore) <= 1e-9 && best && isSeriesType(best.type) && !isSeriesType(h.type));
    if (better) { best = h; bestScore = score; }
  }

  if (typeof globalThis !== "undefined" && globalThis.__XUPER_DEBUG__ && typeof kino !== "undefined" && kino.log) {
    kino.log("searchVod hits: " + JSON.stringify(hits.slice(0, 10)));
    kino.log("searchVod best score=" + bestScore.toFixed(3) + " -> " + JSON.stringify(best));
  }

  if (!best || bestScore < VOD_MATCH_THRESHOLD) return null;
  return { contentId: best.contentId, type: best.type, name: best.name };
}

/**
 * A series season's chapter list on masnew (v4/getItemData, as Xuper 2.x asked it): its `assetData` as the portal sends
 * it (src/legacy.js chaptersOf reads it). For the masnew series 2.x left in the library. Throws like every portal call.
 */
export async function chapterList(seriesId) {
  const id = str(seriesId).trim();
  if (id === "") throw new Error("xuper VOD: empty series id");
  const resp = await call("v4/getItemData", { contentId: id, type: "0", sortType: "0", language: "en", macAddr: FIXED_MAC });
  const data = isObj(resp) ? resp.assetData : null;
  if (!isObj(data)) throw new Error("xuper VOD: chapter list without data");
  return data;
}

/** The portal's return code of an error a portal call threw (`portal100006`, `aaa100028`, …), or "". */
export function portalCodeOf(e) {
  return e instanceof PortalError ? str(e.code) : "";
}

/**
 * The VOD stream of a masnew contentId: v10/startPlayVOD (track + license) + v14/getSlbInfo (CDN + free cfl
 * Content-Auth). → { url, mime, headers, subtitles?, alternatives?, expiresInSeconds? }, the shape Kino expects (the
 * Content-Auth / Content-License / UA headers, as 2.x sent them). Throws when there is no stream. `type` is informative
 * (the match's programType). A series' chapter plays with `seriesContentId`, its season's contentId (2.x's chapter
 * path); without it only a movie plays.
 */
export async function resolveVod(contentId, type, seriesContentId = "") {
  const id = str(contentId).trim();
  if (id === "") throw new Error("xuper VOD: empty contentId");
  const series = str(seriesContentId).trim();
  // v10/startPlayVOD and v14/getSlbInfo on the SAME session (as 2.x).
  const { play, tracks, best, license, slb } = await withSession(async (s) => {
    const play = await portalCall("v10/startPlayVOD", {
      contentId: id, seriesContentId: series, startTime: 0, type: "1", columnId: 0, authType: "",
    }, sessionOpts(s));
    const tracks = rankedMedia(play);
    const best = tracks[0];
    if (!best) {
      throw new Error("xuper VOD: no playable media" + (isSeriesType(type) && !series ? " (a series needs its chapter)" : ""));
    }
    const license = licenseOf(best);
    if (blank(license)) throw new Error("xuper VOD: sin licenseList");
    return { play, tracks, best, license, slb: await portalCall("v14/getSlbInfo", slbBean([LIVE_ROOT]), sessionOpts(s)) };
  });
  const cdns = vodCdns(slb);
  if (cdns.length === 0) throw new Error("xuper VOD: sin CDN de vod con token libre");

  // Cada copia: la mejor pista en cada servidor (main_addr, spared_addr, siguiente CDN), luego la
  // próxima pista igual. La primera es `url`, el resto `alternatives` (mejor primero). Cada servidor
  // trae su propio Content-Auth; cada pista su propia licencia. VOD NO se re-firma (auth tal cual).
  const copies = [];
  const seenUrl = new Set();
  const seenTrack = new Set();
  for (const track of tracks) {
    const tid = str(track.contentId).trim();
    const tlicense = track === best ? license : licenseOf(track);
    if (track !== best && (blank(tid) || blank(tlicense) || seenTrack.has(tid))) continue;
    seenTrack.add(tid);
    const ext = str(track.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
    const mime = ext === "ts" ? "video/mp2t" : "video/mp4";
    for (const cdn of cdns) {
      for (const base of cdn.bases) {
        const url = `${base}/vod/${tid}_media.${ext}`;
        if (seenUrl.has(url)) continue;
        seenUrl.add(url);
        copies.push({
          url,
          mime,
          headers: {
            "Content-Auth": cdn.auth, // querystring tal cual: VOD no se re-firma
            "Content-License": tlicense,
            "User-Agent": UA_CDN,
            App: APP_ID,
            "App-Version": APK_VERSION,
          },
        });
      }
    }
  }
  if (copies.length === 0) throw new Error("xuper VOD: no se pudo armar ninguna URL de stream");

  const [first, ...rest] = copies;
  const alternatives = rest.slice(0, MAX_ALTERNATIVES);
  const subtitles = readSubtitles(play);
  const expires = expiresInSeconds(first.headers["Content-Auth"], Date.now());
  return {
    url: first.url,
    mime: first.mime,
    headers: first.headers,
    ...(subtitles.length > 0 ? { subtitles } : {}),
    ...(alternatives.length > 0 ? { alternatives } : {}),
    ...(expires !== null ? { expiresInSeconds: expires } : {}),
  };
}

const xuper = {
  id: "xuper",
  name: "Xuper",
  genre: "otros",
  categories,
  channels,
  resolve,
};

export default xuper;
