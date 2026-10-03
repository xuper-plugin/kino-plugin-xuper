// src/crypto.js
var toHex = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
var HEX_VALUE = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < 10; i++) t[48 + i] = i;
  for (let i = 0; i < 6; i++) t[97 + i] = 10 + i;
  return t;
})();
var CHUNK = 4096;
function fromHex(h) {
  if (typeof h !== "string" || h.length === 0 || h.length % 2 !== 0) throw new Error("not hex");
  const parts = [];
  const buf = new Uint8Array(CHUNK);
  let n = 0;
  for (let i = 0; i < h.length; i += 2) {
    const a = h.charCodeAt(i), b = h.charCodeAt(i + 1);
    const hi = a < 128 ? HEX_VALUE[a] : -1, lo = b < 128 ? HEX_VALUE[b] : -1;
    if (hi < 0 || lo < 0) throw new Error("not hex");
    const byte = hi << 4 | lo;
    if (byte > 127) throw new Error("not ascii");
    buf[n++] = byte;
    if (n === CHUNK) {
      parts.push(String.fromCharCode.apply(null, buf));
      n = 0;
    }
  }
  if (n > 0) parts.push(String.fromCharCode.apply(null, buf.subarray(0, n)));
  return parts.join("");
}
function makeCrypto(kino2) {
  const fail = (what) => kino2.error("unavailable", "el portal no se pudo " + what);
  return {
    encryptBody(plain2) {
      try {
        const b64 = kino2.crypto.encrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: plain2,
          padding: "pkcs7"
        });
        if (typeof b64 !== "string" || b64 === "") throw new Error("empty");
        return toHex(b64);
      } catch (_) {
        throw fail("cifrar");
      }
    },
    decryptBlob(wire) {
      try {
        const text2 = kino2.crypto.decrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: fromHex(wire),
          padding: "pkcs7"
        });
        if (typeof text2 !== "string" || text2 === "") throw new Error("empty");
        return text2;
      } catch (_) {
        throw fail("descifrar");
      }
    }
  };
}

// src/config.js
var hosts = ["osuhk.m3x8o50te.com", "oogoy.f30c96w8.com"];
var APP_ID = "com.android.msandroid";
var APK_VERSION = "49902";
var PORTAL_CODE = "masnew";
var SPKG_VER = "2025-08-07 05:40:11_36_16_";
var APK_VER_HEADER = "43404";
var USER_AGENT = "okhttp/3.12.12";
var UA_CDN = "Ranger/4.9.4-17294ac0";
var LIVE_USER_AGENT = "Ranger/4.9.4-17294ac0";
var LIVE_APP = "com.android.msandroid";
var LIVE_APP_VERSION = "49902";
var LIVE_X_BUFFER = "0";
var CONTENT_TYPE = "application/json;charset=utf-8";
var RATE_LIMIT_MS = 400;
var REQUEST_TIMEOUT_MS = 25e3;
var DEVICE_FIXED = Object.freeze({
  loginType: "2",
  appLanguage: "en",
  hardwareInfo: "ranchu",
  model: "sdk_gphone64_arm64",
  product: "sdk_gphone64_arm64",
  cpu: "arm64-v8a",
  B29: "",
  reserve1: "",
  deviceToken: "",
  drmId: "",
  sdkVer: 36
});
var SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
var PASSWORD_SALT = "cloudstream";
var FIXED_MAC = "02:00:00:00:00:00";
var FINGERPRINT_FIXED = Object.freeze({
  board: "goldfish_arm64",
  brand: "google",
  cpuAbi: "arm64-v8a",
  device: "emu64a",
  diskInfo: "8GB",
  display: "sdk_gphone64_arm64",
  fingerprint: "google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys",
  hardware: "ranchu",
  host: "abfarm",
  manufacturer: "Google",
  ramSize: "4GB",
  romSize: "8GB",
  tags: "release-keys",
  verId: ""
});
var SHARED_EMAIL = "kinoplayer@outlook.es";
var SHARED_PASSWORD = "Cris2337677";

// src/util.js
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var asText = (v) => v === null || v === void 0 ? "" : typeof v === "string" ? v : String(v);
var optStringStrict = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
var isBlank = (s) => typeof s !== "string" || s.trim() === "";
var notBlank = (s) => s.trim() !== "";
var objects = (v) => Array.isArray(v) ? v.filter(isObject) : [];
var isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
var INT = /^[+-]?\d+$/;
function intOrNull(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  if (!INT.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}

// src/trace.js
var MAX_LINE_CHARS = 160;
var NAME = /^[a-z][a-z0-9_-]{0,19}$/;
var KEY = /^[a-z][a-zA-Z0-9]{0,11}$/;
var SENSITIVE_KEY = /pass|token|secret|cred|auth|bearer|cookie|session|key|mail|host|url|^sn$|user|license|sign/i;
var VALUE = /^[A-Za-z0-9_\/-]{1,20}$/;
var ID_SHAPED = /[0-9a-fA-F]{12}|[0-9]{10}/;
var APP_BLOB_CHARS = 24;
var APP_LONG_TOKEN = /(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/;
function word(v) {
  let s;
  if (typeof v === "number") s = Number.isFinite(v) ? String(Math.round(v)) : "?";
  else if (typeof v === "boolean") return v ? "1" : "0";
  else s = typeof v === "string" ? v : "";
  return VALUE.test(s) && !ID_SHAPED.test(s) ? s : "?";
}
function field(k, v) {
  const w = word(v);
  return k.length + 1 + w.length >= APP_BLOB_CHARS || APP_LONG_TOKEN.test(w) ? `${k}=?` : `${k}=${w}`;
}
function lineOf(area, event, fields) {
  const parts = [`xuper:${NAME.test(area) ? area : "?"}`, NAME.test(event) ? event : "?"];
  if (fields !== null && typeof fields === "object") {
    for (const [k, v] of Object.entries(fields)) {
      if (v === void 0 || v === null || !KEY.test(k) || SENSITIVE_KEY.test(k)) continue;
      parts.push(field(k, v));
    }
  }
  return parts.join(" ").slice(0, MAX_LINE_CHARS);
}
function trace(kino2, area, event, fields = {}) {
  try {
    kino2.log(lineOf(area, event, fields));
  } catch (_) {
  }
}
function report(kino2, area, event, fields = {}) {
  try {
    const line = lineOf(area, event, fields);
    if (kino2.log && typeof kino2.log.report === "function") kino2.log.report(line);
    else kino2.log(line);
  } catch (_) {
  }
}
function errCode(e) {
  if (e === null || typeof e !== "object") return "error";
  const name = typeof e.name === "string" ? e.name : "";
  let c = "";
  if (name === "PortalError" && typeof e.code === "string") c = e.code;
  else if (name.startsWith("KinoError_")) c = name.slice("KinoError_".length);
  else c = name;
  return VALUE.test(c) ? c : "error";
}
async function traced(kino2, clock2, fn, body) {
  const t0 = clock2.now();
  try {
    return await body();
  } catch (e) {
    trace(kino2, "call", "fail", { fn, code: errCode(e), ms: clock2.now() - t0 });
    throw e;
  }
}
function seedTag(kino2, sn) {
  try {
    if (typeof sn !== "string" || sn === "") return "?";
    return String(kino2.crypto.hash("sha256", "xuper-seed\n" + sn)).slice(0, 8);
  } catch (_) {
    return "?";
  }
}

// src/portal.js
var MAX_SLEEP_MS = 5e3;
var MAX_REQUEST_MS = 3e4;
var CONTACT_FAILED = "No se pudo contactar a Xuper; intenta de nuevo en un momento";
var PortalError = class extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PortalError";
    this.code = code;
    this.message = message || code;
  }
};
var SETTINGS_PLACE = "Ajustes \u25B8 Xuper";
var ACCOUNT_SESSION_LOST = `Tu sesi\xF3n de Xuper se cerr\xF3 y no pudimos volver a entrar con tu cuenta. Vuelve a vincularla en ${SETTINGS_PLACE}.`;
var ACCOUNT_IN_USE_ELSEWHERE_TEXT = `Tu cuenta de Xuper se abri\xF3 en otro dispositivo, y solo puede usarse en uno a la vez. Vuelve a intentarlo, o vinc\xFAlala de nuevo en ${SETTINGS_PLACE}.`;
var ACCOUNT_IN_USE_ELSEWHERE = "aaa100083";
var SESSION_DEAD_CODES = /* @__PURE__ */ new Set(["aaa100027", "aaa100028"]);
function accountProblemMessage(code) {
  if (SESSION_DEAD_CODES.has(code)) return ACCOUNT_SESSION_LOST;
  if (code === ACCOUNT_IN_USE_ELSEWHERE) return ACCOUNT_IN_USE_ELSEWHERE_TEXT;
  return null;
}
var EPISODE_GONE = "Este cap\xEDtulo ya no est\xE1 disponible.";
var SERIES_GONE = "Esta serie ya no est\xE1 disponible.";
var told = (kino2, code, message, sentence) => kino2.error(code, message, { userMessage: sentence });
var GENERIC = "Xuper no est\xE1 disponible ahora";
function mapPortalError(code, message, kino2, { accountLinked = false, sharedAccount = false, goneMessage = EPISODE_GONE } = {}) {
  const msg = typeof message === "string" ? message : "";
  const accountText = accountLinked ? accountProblemMessage(code) : null;
  if (accountText) return told(kino2, "auth_required", `cuenta propia: ${code}`, accountText);
  if (code === "portal100006") return told(kino2, "not_found", `portal100006: ${goneMessage === SERIES_GONE ? "serie" : "cap\xEDtulo"} borrado`, goneMessage);
  if (code === "portal100004" || msg.includes("\u4E0D\u5B58\u5728")) {
    return kino2.error("not_found", "No se encontr\xF3 en Xuper");
  }
  if (code === "portal100024") {
    return kino2.error("geo_blocked", "Este contenido no est\xE1 disponible en tu regi\xF3n");
  }
  if (sharedAccount && (SESSION_DEAD_CODES.has(code) || code === ACCOUNT_IN_USE_ELSEWHERE)) {
    return kino2.error("unavailable", `${GENERIC} (shared session: ${code})`);
  }
  if (SESSION_DEAD_CODES.has(code)) {
    return kino2.error("auth_required", "Configura Xuper en Ajustes \u25B8 Plugins");
  }
  return kino2.error("unavailable", GENERIC);
}
var CALL_BUDGET_MS = {
  home: 2e4,
  browse: 2e4,
  episodes: 2e4,
  resolve: 2e4,
  search: 15e3,
  liveCategories: 2e4,
  liveChannels: 2e4,
  section: 2e4,
  categories: 2e4
};
var BUDGET_MARGIN_MS = 2e3;
var callDeadline = (clock2, budgetMs) => clock2.now() + budgetMs - BUDGET_MARGIN_MS;
var viewOpts = ({ userId, userToken, sn, deadline }) => ({
  baseFields: true,
  userId,
  userToken,
  ...typeof sn === "string" && sn !== "" ? { sn } : {},
  ...typeof deadline === "number" ? { deadline } : {}
});
function shapeOf(s) {
  if (typeof s !== "string") return "none";
  if (s === "") return "empty";
  const first = s.charCodeAt(0);
  if (first === 31) return "gzip";
  const t = s.trimStart();
  if (t === "") return "blank";
  if (t[0] === "<") return "html";
  if (t[0] === "{" || t[0] === "[") return "json";
  let hex = true, upperHex = false, b64 = true, wrapped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const digit = c >= 48 && c <= 57, lower = c >= 97 && c <= 122, upper = c >= 65 && c <= 90;
    const newline = c === 10 || c === 13;
    if (newline) wrapped = true;
    if (!(digit || c >= 97 && c <= 102)) {
      if (c >= 65 && c <= 70) upperHex = true;
      else hex = false;
    }
    if (!(digit || lower || upper || c === 43 || c === 47 || c === 61 || c === 45 || c === 95 || newline)) b64 = false;
    if (!hex && !b64) return "text";
  }
  if (hex) return (upperHex ? "hex-upper" : "hex") + (s.length % 2 === 0 ? "" : "-odd");
  return wrapped ? "b64-ws" : "b64";
}
function contentClass(res) {
  const h = res !== null && typeof res === "object" && res.headers !== null && typeof res.headers === "object" ? res.headers : null;
  const ct = h && typeof h["content-type"] === "string" ? h["content-type"].toLowerCase() : "";
  if (ct === "") return "none";
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.startsWith("text/")) return "text";
  return "other";
}
function gzipped(res, text2) {
  const h = res !== null && typeof res === "object" && res.headers !== null && typeof res.headers === "object" ? res.headers : null;
  const enc = h && typeof h["content-encoding"] === "string" ? h["content-encoding"].toLowerCase() : "";
  return enc.includes("gzip") || typeof text2 === "string" && text2.charCodeAt(0) === 31;
}
var PATH_ALIASES = { "v2/sendEmailVerifyCode": "v2/sendCode", "v2/validateVerifyCode": "v2/checkCode" };
var tracePath = (path) => Object.hasOwn(PATH_ALIASES, path) ? PATH_ALIASES[path] : path;
function makePortal({ kino: kino2, crypto, config, clock: clock2, snProvider, modeOf = () => "?" }) {
  let preferredHost = null;
  let lastCallMs = null;
  const decryptFails = /* @__PURE__ */ new Map();
  const hostOrder = () => {
    const hosts2 = config.hosts || [];
    if (preferredHost === null) return hosts2;
    return [preferredHost, ...hosts2.filter((h) => h !== preferredHost)];
  };
  let slotTail = Promise.resolve();
  function waitTurn() {
    const run = slotTail.then(async () => {
      const now = clock2.now();
      if (lastCallMs !== null) {
        const wait = Math.min(MAX_SLEEP_MS, Math.ceil(RATE_LIMIT_MS - (now - lastCallMs)));
        if (wait > 0) await kino2.sleep(wait);
      }
      lastCallMs = clock2.now();
    });
    slotTail = run.then(() => {
    }, () => {
    });
    return run;
  }
  function deviceDict(sn) {
    return {
      ...DEVICE_FIXED,
      apkVersion: config.apkVersion,
      sysVersion: SPKG_VER,
      appId: config.appId,
      sn: sn ?? snProvider()
    };
  }
  async function call(path, bean = {}, opts = {}) {
    const { baseFields = true, userId = "", userToken = "", sn = null, timeoutMs, deadline } = opts;
    const requested = Math.trunc(Number(timeoutMs));
    const perRequest = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_REQUEST_MS) : REQUEST_TIMEOUT_MS;
    const tp = tracePath(path);
    const body = {
      ...baseFields ? { portalCode: PORTAL_CODE, userId, userToken } : {},
      ...bean,
      ...deviceDict(sn)
    };
    const wire = crypto.encryptBody(JSON.stringify(body));
    const headers = {
      apk: config.appId,
      apkVer: APK_VER_HEADER,
      spkgVer: SPKG_VER,
      "User-Agent": USER_AGENT,
      "Content-Type": CONTENT_TYPE
    };
    const outOfTime = () => typeof deadline === "number" && Math.floor(deadline - clock2.now()) < 1;
    if (outOfTime()) {
      trace(kino2, "portal", "deadline", { path: tp });
      throw kino2.error("unavailable", CONTACT_FAILED);
    }
    await waitTurn();
    let lastError = null;
    const order = hostOrder();
    for (let i = 0; i < order.length; i++) {
      const host = order[i];
      let requestMs = perRequest;
      if (typeof deadline === "number") {
        const left = Math.floor(deadline - clock2.now());
        if (left < 1) {
          trace(kino2, "portal", "deadline", { path: tp, i });
          break;
        }
        const remaining = order.length - i;
        requestMs = Math.min(perRequest, remaining > 1 ? Math.ceil(left / remaining) : left);
      }
      let answer;
      let stage = "fetch";
      let res = null, bodyText = null;
      try {
        res = await kino2.fetch(`https://${host}/api/portalCore/${path}`, {
          method: "POST",
          headers,
          body: wire,
          cookies: false,
          timeoutMs: requestMs
        });
        stage = "body";
        bodyText = res.text();
        answer = JSON.parse(bodyText);
        if (!isObject(answer)) throw new Error("respuesta del portal no es un objeto");
        if (i > 0) trace(kino2, "portal", "failover", { path: tp, to: i });
        preferredHost = host;
        const rc = answer.returnCode;
        const code = rc === void 0 || rc === null ? "" : String(rc);
        if (code !== "" && code !== "0") {
          const em = answer.errorMessage;
          answer = { portalFailure: new PortalError(code, typeof em === "string" && em.trim() ? em : "") };
        } else if (typeof answer.data === "string" && answer.data !== "") {
          stage = "data";
          const plain2 = crypto.decryptBlob(answer.data);
          stage = "inner";
          const inner = JSON.parse(plain2);
          if (!isObject(inner)) throw new Error("datos del portal no son un objeto");
          answer = { ok: inner };
        } else if (isObject(answer.data)) {
          answer = { ok: answer.data };
        } else if (answer.data === void 0 || answer.data === null || answer.data === "") {
          answer = { ok: answer };
        } else {
          stage = "data";
          throw new Error("datos del portal de un tipo inesperado");
        }
      } catch (e) {
        lastError = e;
        if (stage === "fetch") trace(kino2, "portal", "host_fail", { path: tp, i, why: errCode(e) });
        else decryptFail(path, i, stage, res, bodyText, answer, e);
        continue;
      }
      decryptFails.delete(path);
      if (answer.portalFailure) {
        trace(kino2, "portal", "rc", { path: tp, code: answer.portalFailure.code });
        throw answer.portalFailure;
      }
      return answer.ok;
    }
    if (order.length > 0) trace(kino2, "portal", "all_fail", { path: tp, n: order.length });
    throw kino2.error("unavailable", order.length === 0 ? "sin hosts configurados" : CONTACT_FAILED);
  }
  function decryptFail(path, i, at, res, bodyText, answer, e) {
    try {
      const attempt = (decryptFails.get(path) || 0) + 1;
      decryptFails.set(path, attempt);
      const data = at === "body" || !isObject(answer) ? void 0 : answer.data;
      let mode = "?";
      try {
        mode = String(modeOf());
      } catch (_) {
      }
      trace(kino2, "portal", "decrypt-fail", {
        path: tracePath(path),
        i,
        at,
        status: res !== null && typeof res === "object" && typeof res.status === "number" ? res.status : -1,
        ctype: contentClass(res),
        len: typeof bodyText === "string" ? bodyText.length : -1,
        shape: shapeOf(at === "body" ? bodyText : data),
        dlen: typeof data === "string" ? data.length : -1,
        gzip: gzipped(res, bodyText),
        sess: mode,
        attempt,
        why: errCode(e)
      });
    } catch (_) {
    }
  }
  return { call };
}

// src/device.js
var str = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var blank = (v) => str(v).trim() === "";
var activateBean = (snToken) => ({
  snToken,
  authVersion: "",
  authCode: "",
  preCode: "",
  macAddr: FIXED_MAC,
  reserve1: "",
  openNum: 4,
  channel: "default",
  matadata: "",
  signdata: ""
});
function makeFingerprint(kino2) {
  const randomHex = (bytes) => kino2.crypto.randomBytes(bytes, "hex");
  const randomMac = () => randomHex(6).match(/../g).join(":");
  return () => ({
    ...FINGERPRINT_FIXED,
    androidId: randomHex(8),
    cpuId: randomHex(8),
    serialNumber: randomHex(8),
    etheMac: randomMac(),
    gatewayMac: randomMac(),
    wifiMac: randomMac()
  });
}
var snFrom = (kino2, j, snToken) => (blank(j.sn) ? kino2.crypto.hash("md5", snToken + SNTOKEN_SALT) : str(j.sn)).toLowerCase();

// src/session.js
var DEFAULT_SEEDS_URL = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/seeds/seeds.json";
var INVALID_SN = /* @__PURE__ */ new Set(["aaa100080", "aaa100082"]);
var SESSION_DEAD = /* @__PURE__ */ new Set(["aaa100027", "aaa100028"]);
var GEO_BLOCKED = "portal100024";
var SEED_RESCUE_ROUNDS = 3;
var SEED_SWITCH_TRIES = 5;
var POOL_REFRESH_COOLDOWN_MS = 1e4;
var FAILED_REFRESH_COOLDOWN_MS = 3e4;
var BLOCKED_REFRESH_MS = 5e3;
var MIN_REQUEST_MS = 1e3;
var PERIODIC_REFRESH_MS = 3 * 36e5;
var PERIODIC_TIMEOUT_MS = 5e3;
var MAX_SEEDS = 200;
var SEED_FALLBACK_TRIES = 3;
var SEED_FALLBACK_MIN_MS = 1e3;
var SEED_FALLBACK_REFRESH_MS = 15e3;
var SEED_FALLBACK_DEFAULT_MS = 1e4;
var str2 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var blank2 = (v) => str2(v).trim() === "";
function makeLock() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.then(() => {
    }, () => {
    });
    return run;
  };
}
function makeSession({ kino: kino2, portal, clock: clock2, seedsUrl = DEFAULT_SEEDS_URL, random, shared }) {
  const rand = random || (() => parseInt(kino2.crypto.randomBytes(4, "hex"), 16) / 4294967296);
  const lock = makeLock();
  let lastPoolRefreshMs = null;
  let lastFailedRefreshMs = null;
  let inflight = null;
  let exhausted = false;
  const timeLeft = (bounds) => bounds && typeof bounds.deadline === "number" ? bounds.deadline - clock2.now() : Infinity;
  const readJson = (key) => {
    try {
      const raw = kino2.storage.get(key);
      return raw === null || raw === void 0 ? null : JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };
  const writeJson = (key, value) => kino2.storage.set(key, JSON.stringify(value));
  const readSession = () => {
    const s = readJson("session");
    const o = s && typeof s === "object" ? s : {};
    return { userId: str2(o.userId), userToken: str2(o.userToken), jwtToken: str2(o.jwtToken), sn: str2(o.sn), acct: str2(o.acct) };
  };
  const writeSession = (s) => writeJson("session", {
    userId: str2(s.userId),
    userToken: str2(s.userToken),
    jwtToken: str2(s.jwtToken),
    sn: str2(s.sn),
    acct: str2(s.acct)
  });
  const view = () => {
    const s = readSession();
    return { userId: s.userId, userToken: s.userToken, sn: null };
  };
  const hasToken = () => !blank2(readSession().userToken);
  const accountKey = (email, password) => kino2.crypto.hash("sha256", str2(email) + "\n" + kino2.crypto.hash("md5", str2(password) + PASSWORD_SALT));
  const sharedPair = shared && !blank2(shared.email) && !blank2(shared.password) ? { email: str2(shared.email), password: str2(shared.password) } : null;
  const keyOf = (acc) => sharedPair && acc.email === sharedPair.email && acc.password === sharedPair.password ? "shared" : accountKey(acc.email, acc.password);
  const legacyShared = () => readJson("sharedAccount") === true;
  const dropLegacy = () => {
    try {
      if (kino2.storage.get("sharedAccount") !== null && kino2.storage.get("sharedAccount") !== void 0) kino2.storage.remove("sharedAccount");
    } catch (_) {
    }
  };
  const ownAccount = () => {
    const email = kino2.config.get("email"), password = kino2.config.get("password");
    return blank2(email) || blank2(password) ? null : { email: str2(email).trim(), password: str2(password).trim() };
  };
  const configuredAccount = () => {
    const own = ownAccount();
    if (own) {
      dropLegacy();
      return own;
    }
    const toggle = kino2.config.get("useSharedAccount");
    if (toggle !== void 0) dropLegacy();
    const chosen = toggle === true || toggle === void 0 && legacyShared();
    return sharedPair && chosen ? sharedPair : null;
  };
  const REFUSAL_TTL_MS = 10 * 6e4;
  const LOGIN_COOLDOWN_MS = 6e4;
  const NOT_A_REFUSAL = /* @__PURE__ */ new Set([GEO_BLOCKED, "snToken_failed", "active_sin_token", "login_sin_token"]);
  const OWN_NOT_A_REFUSAL = /* @__PURE__ */ new Set([...NOT_A_REFUSAL, ...SESSION_DEAD, ACCOUNT_IN_USE_ELSEWHERE]);
  const refusal = (e, key) => e instanceof PortalError && !(key === "shared" ? NOT_A_REFUSAL : OWN_NOT_A_REFUSAL).has(e.code);
  const refusedKey = () => {
    const r = readJson("refusedAcct");
    if (!r || typeof r !== "object" || typeof r.key !== "string" || typeof r.at !== "number") return "";
    const age = clock2.now() - r.at;
    return age >= 0 && age < REFUSAL_TTL_MS ? r.key : "";
  };
  const setRefused = (key) => {
    try {
      writeJson("refusedAcct", { key, at: clock2.now() });
    } catch (_) {
    }
  };
  const clearRefused = (key) => {
    if (key === "") return;
    const r = readJson("refusedAcct");
    if (r && typeof r === "object" && r.key === key) {
      try {
        kino2.storage.remove("refusedAcct");
      } catch (_) {
      }
    }
  };
  let cooldown = { key: "", until: 0 };
  const cooling = (key) => cooldown.key === key && clock2.now() < cooldown.until;
  const startCooldown = (key) => {
    cooldown = { key, until: clock2.now() + LOGIN_COOLDOWN_MS };
  };
  const endCooldown = () => {
    cooldown = { key: "", until: 0 };
  };
  const account = () => {
    const acc = configuredAccount();
    return acc && keyOf(acc) !== refusedKey() ? acc : null;
  };
  const currentKey = () => {
    const acc = account();
    return acc ? keyOf(acc) : "";
  };
  const tokenHeld = () => hasToken() && readSession().acct === currentKey();
  const acctKind = (acc) => acc === sharedPair ? "shared" : "own";
  function mode() {
    try {
      const acc = account();
      if (acc) return acctKind(acc);
      const s = readSession();
      if (blank2(s.sn)) return "none";
      return seedPool().some((e) => e.sn === s.sn) ? "seed" : "anon";
    } catch (_) {
      return "?";
    }
  }
  const autoRefresh = () => kino2.config.get("autoRefreshSeeds") !== false;
  const regionBlocked = () => {
    const r = readJson("region");
    return !!(r && r.blocked === true);
  };
  const setRegion = (blocked) => {
    try {
      if (regionBlocked() !== blocked) writeJson("region", { blocked });
    } catch (_) {
    }
  };
  const seedPool = () => {
    const raw = readJson("seeds");
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && typeof e === "object" && !blank2(e.sn) && !blank2(e.userToken)).map((e) => ({ sn: str2(e.sn), userId: str2(e.userId), userToken: str2(e.userToken) }));
  };
  const pick = (pool) => pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  const seedSession = (e) => ({ userId: e.userId, userToken: e.userToken, jwtToken: "", sn: e.sn, acct: "" });
  const surface = (e) => e instanceof PortalError ? mapPortalError(e.code, e.message, kino2) : e;
  const fingerprint = makeFingerprint(kino2);
  function saveFromResponse(j, acct = "") {
    writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: readSession().sn, acct });
  }
  async function activate(snToken, sn, bounds = {}) {
    const j = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
    if (blank2(j && j.userToken)) throw new PortalError("active_sin_token", "activaci\xF3n sin userToken");
    saveFromResponse(j);
  }
  async function mintDevice(bounds = {}) {
    const j = await portal.call("v3/snToken", fingerprint(), { baseFields: false, ...bounds });
    if (blank2(j && j.snToken)) throw new PortalError("snToken_failed", "el portal no devolvi\xF3 snToken");
    const snToken = str2(j.snToken);
    const sn = snFrom(kino2, j, snToken);
    writeSession({ userId: "", userToken: "", jwtToken: "", sn, acct: "" });
    await activate(snToken, sn, bounds);
  }
  async function directAnonymous(bounds = {}) {
    const storedSn = readSession().sn;
    if (!blank2(storedSn)) {
      try {
        await activate("", storedSn, bounds);
        trace(kino2, "session", "activate", { ok: true });
        return;
      } catch (e) {
        trace(kino2, "session", "activate", { ok: false, code: errCode(e) });
        if (!(e instanceof PortalError && INVALID_SN.has(e.code))) throw e;
      }
    }
    try {
      await mintDevice(bounds);
      trace(kino2, "session", "mint", { ok: true });
    } catch (e) {
      trace(kino2, "session", "mint", { ok: false, code: errCode(e) });
      throw e;
    }
  }
  async function ensureAnonymousUnlocked(bounds = {}) {
    if (hasToken() && readSession().acct === "") return;
    if (hasToken()) forgetToken();
    let direct;
    try {
      await directAnonymous(bounds);
      return;
    } catch (e) {
      direct = e;
    }
    if (direct instanceof PortalError && direct.code === GEO_BLOCKED) {
      trace(kino2, "session", "geo", { at: "activate" });
      setRegion(true);
    }
    let pool = seedPool();
    if (pool.length === 0) {
      try {
        await refreshSeeds({ timeoutMs: BLOCKED_REFRESH_MS, deadline: bounds.deadline });
      } catch (_) {
      }
      pool = seedPool();
    }
    if (pool.length > 0) {
      const chosen = pick(pool);
      writeSession(seedSession(chosen));
      report(kino2, "seed", "pick", { pool: pool.length, seed: seedTag(kino2, chosen.sn) });
      return;
    }
    trace(kino2, "session", "no_seed", { code: errCode(direct) });
    throw direct;
  }
  async function loginUnlocked(email, password, bounds = {}) {
    const bean = {
      accountType: "2",
      userName: email,
      password: kino2.crypto.hash("md5", password + PASSWORD_SALT),
      type: "1",
      macAddr: FIXED_MAC,
      areaCode: "",
      verificationCode: "",
      verificationToken: "",
      matadata: "",
      signdata: "",
      channel: "default"
    };
    const j = await portal.call("v8/login", bean, { baseFields: false, sn: readSession().sn || null, ...bounds });
    if (blank2(j && j.userToken)) throw new PortalError("login_sin_token", "login sin userToken");
    saveFromResponse(j, keyOf({ email, password }));
  }
  async function ensureUnlocked(bounds = {}) {
    if (tokenHeld()) return;
    const acc = account();
    const key = acc ? keyOf(acc) : "";
    const wait = acc !== null && cooling(key);
    if (wait && hasToken() && readSession().acct === "") return;
    if (hasToken() && readSession().acct !== "") forgetToken();
    if (acc && !wait) {
      try {
        await loginUnlocked(acc.email, acc.password, bounds);
        trace(kino2, "session", "login", { acct: acctKind(acc), ok: true });
        clearRefused(key);
        endCooldown();
        return;
      } catch (e) {
        const refused = refusal(e, key);
        report(kino2, "anon_fallback", "login", { acct: acctKind(acc), ok: false, code: errCode(e), refused });
        if (refused) setRefused(key);
        else startCooldown(key);
      }
    }
    await ensureAnonymousUnlocked(bounds);
  }
  function forgetToken() {
    const prev = readSession();
    if (prev.sn === "" && prev.userToken === "") return;
    writeSession({ ...prev, userId: "", userToken: "", jwtToken: "", acct: "" });
  }
  const renew = (stale, bounds = {}) => lock(async () => {
    const current = readSession().userToken;
    if (!blank2(current) && current !== stale) return { ok: true, loginError: null };
    if (timeLeft(bounds) < MIN_REQUEST_MS) {
      trace(kino2, "session", "reauth", { ok: false, why: "deadline" });
      return { ok: false, loginError: null };
    }
    forgetToken();
    let loginError = null;
    try {
      const acc = configuredAccount();
      if (acc) {
        try {
          await loginUnlocked(acc.email, acc.password, bounds);
          clearRefused(keyOf(acc));
          endCooldown();
        } catch (e) {
          if (!refusal(e, keyOf(acc))) {
            loginError = e;
            throw e;
          }
          setRefused(keyOf(acc));
          await ensureAnonymousUnlocked(bounds);
        }
      } else await ensureAnonymousUnlocked(bounds);
      trace(kino2, "session", "reauth", { ok: true, sess: mode() });
      return { ok: true, loginError: null };
    } catch (e) {
      trace(kino2, "session", "reauth", { ok: false, code: errCode(loginError || e), sess: mode() });
      return { ok: false, loginError };
    }
  });
  const transientLogin = (e) => e !== null && (e instanceof PortalError ? SESSION_DEAD.has(e.code) : isKinoError(e));
  const switchToBackup = (stale) => lock(async () => {
    const pool = seedPool();
    if (pool.length === 0) return false;
    if (readSession().userToken !== stale) return true;
    const chosen = pick(pool);
    writeSession(seedSession(chosen));
    trace(kino2, "session", "seed_switch", { pool: pool.length, seed: seedTag(kino2, chosen.sn) });
    return true;
  });
  async function fetchSeeds(timeoutMs) {
    let text2;
    try {
      text2 = (await kino2.fetch(seedsUrl, { timeoutMs })).text();
    } catch (e) {
      trace(kino2, "seeds", "refresh", { ok: false, why: "fetch", code: errCode(e) });
      return false;
    }
    let list;
    try {
      list = JSON.parse(text2);
    } catch (_) {
      list = null;
    }
    if (!Array.isArray(list)) {
      trace(kino2, "seeds", "refresh", { ok: false, why: "parse" });
      return false;
    }
    const clean = list.filter((e) => e && typeof e === "object" && !blank2(e.sn) && !blank2(e.userToken)).slice(0, MAX_SEEDS).map((e) => ({ sn: str2(e.sn), userId: str2(e.userId), userToken: str2(e.userToken) }));
    if (clean.length === 0) {
      trace(kino2, "seeds", "refresh", { ok: false, why: "empty" });
      return false;
    }
    try {
      writeJson("seeds", clean);
    } catch (_) {
      trace(kino2, "seeds", "refresh", { ok: false, why: "store", n: clean.length });
      return false;
    }
    try {
      writeJson("seedsAt", clock2.now());
    } catch (_) {
    }
    trace(kino2, "seeds", "refresh", { ok: true, n: clean.length });
    return true;
  }
  async function refreshSeeds({ periodic = false, timeoutMs = 15e3, deadline, manual = false } = {}) {
    const has = () => seedPool().length > 0;
    if (periodic) {
      if (!autoRefresh() || !regionBlocked() || account()) return has();
      const at = readJson("seedsAt");
      if (typeof at === "number" && clock2.now() - at < PERIODIC_REFRESH_MS) return has();
      try {
        writeJson("seedsAt", clock2.now());
      } catch (_) {
      }
    }
    const now = clock2.now();
    const recent = (at, ms) => at !== null && now - at >= 0 && now - at < ms;
    if (inflight === null) {
      if (recent(lastPoolRefreshMs, POOL_REFRESH_COOLDOWN_MS)) return has();
      if (!manual && recent(lastFailedRefreshMs, FAILED_REFRESH_COOLDOWN_MS)) return has();
      const ms = Math.min(timeoutMs, Math.floor(timeLeft({ deadline })));
      if (ms < MIN_REQUEST_MS) return has();
      const promise = fetchSeeds(ms).then((stored) => {
        inflight = null;
        if (stored) lastPoolRefreshMs = now;
        else lastFailedRefreshMs = now;
      });
      inflight = { promise, endsBy: now + ms };
    } else if (typeof deadline === "number" && inflight.endsBy > deadline) {
      return has();
    }
    await inflight.promise;
    return has();
  }
  async function ensure(bounds = {}) {
    await null;
    if (!tokenHeld()) {
      try {
        await refreshSeeds({ periodic: true, timeoutMs: PERIODIC_TIMEOUT_MS, deadline: bounds.deadline });
      } catch (_) {
      }
    }
    try {
      await lock(() => ensureUnlocked(bounds));
    } catch (e) {
      throw surface(e);
    }
  }
  async function login(email, password, bounds = {}) {
    await null;
    const key = keyOf({ email, password });
    try {
      await lock(async () => {
        await loginUnlocked(email, password, bounds);
        clearRefused(key);
        endCooldown();
        dropLegacy();
      });
      trace(kino2, "session", "login_action", { acct: "own", ok: true });
    } catch (e) {
      trace(kino2, "session", "login_action", { acct: "own", ok: false, code: errCode(e) });
      if (e instanceof PortalError) {
        if (refusal(e, key)) setRefused(key);
        throw kino2.error("auth_required", "Credenciales de Xuper inv\xE1lidas");
      }
      throw e;
    }
  }
  async function useShared(bounds = {}) {
    await null;
    if (!sharedPair) throw kino2.error("unavailable", "La cuenta compartida no est\xE1 disponible");
    try {
      await lock(async () => {
        await loginUnlocked(sharedPair.email, sharedPair.password, bounds);
        clearRefused("shared");
        endCooldown();
      });
      trace(kino2, "session", "login_action", { acct: "shared", ok: true });
    } catch (e) {
      trace(kino2, "session", "login_action", { acct: "shared", ok: false, code: errCode(e) });
      if (e instanceof PortalError) {
        if (refusal(e, "shared")) setRefused("shared");
        throw kino2.error("auth_required", "No se pudo activar la cuenta compartida");
      }
      throw e;
    }
  }
  async function logout(bounds = {}) {
    await null;
    try {
      await lock(async () => {
        dropLegacy();
        const prev = readSession();
        if (!blank2(prev.userToken)) {
          try {
            await portal.call(
              "v5/loginOut",
              { userId: prev.userId, userToken: prev.userToken },
              { baseFields: false, sn: prev.sn || null, ...bounds }
            );
          } catch (_) {
          }
        }
        forgetToken();
        await ensureAnonymousUnlocked(bounds);
      });
    } catch (e) {
      throw surface(e);
    }
  }
  const blockedOrDead = (e) => e.code === GEO_BLOCKED || SESSION_DEAD.has(e.code);
  async function seedFallback(block, deadline) {
    const left = () => deadline - clock2.now();
    let pool = seedPool();
    let refreshed = false;
    if (pool.length === 0 && left() >= SEED_FALLBACK_MIN_MS) {
      refreshed = true;
      try {
        await refreshSeeds({ timeoutMs: SEED_FALLBACK_REFRESH_MS, deadline });
      } catch (_) {
      }
      pool = seedPool();
    }
    const seen = /* @__PURE__ */ new Set();
    const candidates = pool.filter((e) => !seen.has(e.sn) && seen.add(e.sn));
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(rand() * (i + 1)));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const note = (tries2, outcome) => outcome === "answered" ? report(kino2, "shared_seed", "answered", { tries: tries2, pool: candidates.length, refreshed }) : trace(kino2, "session", "seed_fallback", { outcome, tries: tries2, pool: candidates.length, refreshed });
    let tries = 0;
    for (const c of candidates.slice(0, SEED_FALLBACK_TRIES)) {
      if (left() < SEED_FALLBACK_MIN_MS) break;
      tries++;
      try {
        const value = await block({ userId: c.userId, userToken: c.userToken, sn: c.sn, deadline });
        note(tries, "answered");
        return { value };
      } catch (e) {
        if (e instanceof PortalError && !blockedOrDead(e)) {
          note(tries, "answered");
          return { err: e };
        }
        if (!(e instanceof PortalError) && !isKinoError(e)) throw e;
      }
    }
    note(tries, left() < SEED_FALLBACK_MIN_MS ? "out_of_time" : "none");
    return null;
  }
  async function withValidSession(block, { seedFallback: allowSeeds = false, deadline } = {}) {
    await null;
    const startedAt = clock2.now();
    const bounds = typeof deadline === "number" ? { deadline } : {};
    const onSeed = () => {
      const sn = readSession().sn;
      return seedPool().some((e) => e.sn === sn);
    };
    const ownLinked = () => account() !== null && !usingShared();
    const settle = (r) => {
      if (r.err) throw mapPortalError(r.err.code, r.err.message, kino2, { accountLinked: ownLinked(), sharedAccount: sharedConfigured() });
      exhausted = false;
      if (regionBlocked() && !onSeed()) setRegion(false);
      return r.value;
    };
    const attempt = async () => {
      try {
        return { value: await block({ ...view(), ...bounds }) };
      } catch (e) {
        if (e instanceof PortalError) return { err: e };
        throw e;
      }
    };
    const tokenUsed = view().userToken;
    let result = await attempt();
    if (!result.err) return settle(result);
    trace(kino2, "session", "err", { code: result.err.code, sess: mode() });
    if (result.err.code === GEO_BLOCKED) {
      trace(kino2, "session", "geo", { at: "content", sess: mode() });
      setRegion(true);
      if (!account()) {
        if (seedPool().length === 0) {
          try {
            await refreshSeeds({ timeoutMs: BLOCKED_REFRESH_MS, deadline });
          } catch (_) {
          }
        }
        if (await switchToBackup(tokenUsed)) result = await attempt();
        if (!result.err) return settle(result);
      }
    }
    let renewal = await renew(tokenUsed, bounds);
    if (SESSION_DEAD.has(result.err.code) && ownLinked() && transientLogin(renewal.loginError)) {
      renewal = await renew(view().userToken, bounds);
    }
    const loginError = renewal.loginError;
    if (loginError instanceof PortalError && loginError.code === ACCOUNT_IN_USE_ELSEWHERE && ownLinked()) result = { err: loginError };
    if (renewal.ok) {
      const retryToken = view().userToken;
      result = await attempt();
      if (!result.err) return settle(result);
      if (ownLinked() && SESSION_DEAD.has(result.err.code) && (await renew(retryToken, bounds)).ok) {
        result = await attempt();
        if (!result.err) return settle(result);
      }
    }
    if (SESSION_DEAD.has(result.err.code) && !account()) {
      setRegion(true);
      let rounds = 0;
      for (let round = 0; round < SEED_RESCUE_ROUNDS; round++) {
        if (timeLeft(bounds) < MIN_REQUEST_MS) break;
        rounds++;
        if (await refreshSeeds({ deadline }) && await switchToBackup(view().userToken)) {
          const retry = await attempt();
          if (!retry.err || !SESSION_DEAD.has(retry.err.code)) {
            exhausted = false;
            trace(kino2, "session", "rescued", { round: rounds });
            return settle(retry);
          }
        }
      }
      exhausted = true;
      trace(kino2, "session", "exhausted", { rounds });
    }
    if (allowSeeds && blockedOrDead(result.err) && usingShared()) {
      const rescued = await seedFallback(block, typeof deadline === "number" ? deadline : startedAt + SEED_FALLBACK_DEFAULT_MS);
      if (rescued) {
        if (rescued.err) throw mapPortalError(rescued.err.code, rescued.err.message, kino2, { sharedAccount: true });
        return rescued.value;
      }
    }
    return settle(result);
  }
  async function switchSeed({ timeoutMs, deadline } = {}) {
    await null;
    const out = await lock(async () => {
      if (account()) return { result: "account_linked", tries: 0 };
      const current = readSession().sn;
      const candidates = seedPool().filter((e) => e.sn !== current);
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(rand() * (i + 1)));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      if (candidates.length === 0) return { result: "no_other_seed", tries: 0 };
      let tries = 0;
      let reached = false;
      for (const c of candidates.slice(0, SEED_SWITCH_TRIES)) {
        if (typeof deadline === "number" && clock2.now() >= deadline) break;
        tries++;
        try {
          const j = await portal.call("v8/active", activateBean(""), { baseFields: false, sn: c.sn, timeoutMs, deadline });
          reached = true;
          if (blank2(j && j.userToken)) continue;
          writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: c.sn, acct: "" });
          return { result: "ok", tries };
        } catch (e) {
          if (e instanceof PortalError) reached = true;
        }
      }
      if (typeof deadline === "number" && !reached) return { result: "offline", tries };
      return { result: "all_failed", tries };
    });
    trace(kino2, "seeds", "switch", { result: out.result, tries: out.tries });
    return out;
  }
  const adoptSession = (s) => lock(async () => {
    writeSession(s);
    clearRefused(str2(s.acct));
    dropLegacy();
    setRegion(false);
    exhausted = false;
  });
  const usingShared = () => {
    const a = account();
    return a !== null && a === sharedPair;
  };
  const sharedConfigured = () => {
    const a = configuredAccount();
    return a !== null && a === sharedPair;
  };
  function accountState() {
    const conf = configuredAccount();
    if (!conf) return "none";
    if (keyOf(conf) === refusedKey()) return "refused";
    return tokenHeld() ? "held" : "pending";
  }
  function kind() {
    if (accountState() === "held") return "account";
    const s = readSession();
    if (blank2(s.sn)) return "none";
    return seedPool().some((e) => e.sn === s.sn) ? "seed" : "own";
  }
  return {
    ensure,
    withValidSession,
    current: readSession,
    kind,
    mode,
    accountState,
    accountKey,
    usingShared,
    sharedConfigured,
    login,
    useShared,
    logout,
    regionBlocked,
    seedsExhausted: () => exhausted,
    switchSeed,
    refreshSeeds,
    seedPool,
    adoptSession
  };
}

// src/homeClassifier.js
var KINDS = [
  { root: "peliculas", label: "Pel\xEDculas" },
  { root: "series", label: "Series" },
  { root: "anime", label: "Anime" },
  { root: "infantil", label: "Infantil" }
];
var byRoot = Object.fromEntries(KINDS.map((k) => [k.root, k]));
var MIN_GENRE_SIZE = 6;
var MAX_ROW_SIZE = 20;
var TRAILER = "trailer";
var PRECEDENCE = ["anime", "infantil", "series", "peliculas"];
var FEATURED = ["peliculas", "series"];
var GENRES = new Map(Object.entries({
  "Action": ["action", "Acci\xF3n"],
  "Adventure": ["adventure", "Aventura"],
  "Comedy": ["comedy", "Comedia"],
  "Drama": ["drama", "Drama"],
  "Thriller": ["thriller", "Suspenso"],
  "Crime": ["crime", "Crimen"],
  "Sci-Fi": ["scifi", "Ciencia ficci\xF3n"],
  "Fantasy": ["fantasy", "Fantas\xEDa"],
  "Romance": ["romance", "Romance"],
  "Mystery": ["mystery", "Misterio"],
  "Horror": ["horror", "Terror"],
  "Family": ["family", "Familia"],
  "Biography": ["biography", "Biograf\xEDa"],
  "History": ["history", "Historia"],
  "Documentary": ["documentary", "Documental"],
  "Western": ["western", "Western"],
  "War": ["war", "Guerra"],
  "Reality-TV": ["reality", "Reality"],
  "Sport": ["sport", "Deportes"],
  "Music": ["music", "M\xFAsica"],
  "Musical": ["music", "M\xFAsica"]
}));
var YEAR_SECTION = /^(\d{4})(.*)$/;
var FEATURED_PREFIXES = ["magis_recent_", "magis_new_", "magis_top_"];
function rootOfRow(rowId) {
  if (typeof rowId !== "string") return null;
  const prefix = [...FEATURED_PREFIXES, "magis_g_"].find((p) => rowId.startsWith(p));
  if (prefix === void 0) return null;
  const rest = rowId.slice(prefix.length);
  const root = prefix === "magis_g_" ? rest.slice(0, Math.max(0, rest.indexOf("_"))) : rest;
  return Object.hasOwn(byRoot, root) ? root : null;
}
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var byScore = (a, b) => cmp(b.score ?? -1, a.score ?? -1) || cmp(a.title, b.title) || cmp(a.id, b.id);
var plain = (text2) => text2.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").trim();
function distinctBy(list, key) {
  const seen = /* @__PURE__ */ new Set();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
var row = (id, title2, items) => ({ id, title: title2, shown: items.slice(0, MAX_ROW_SIZE), all: items });
var genresOf = (item) => distinctBy(item.genres.map((g) => GENRES.get(g.trim())).filter((g) => g !== void 0), (g) => g[0]);
var newestFirst = (items) => items.some((i) => i.shelvedAtMs > 0) ? [...items].sort((a, b) => b.shelvedAtMs - a.shelvedAtMs) : items;
var playable = (section2) => distinctBy(section2.items.filter((i) => i.type !== TRAILER), (i) => i.id);
function yearSections(sections) {
  const out = [];
  for (const s of sections) {
    const m = YEAR_SECTION.exec(s.name.trim());
    if (m) out.push({ year: Number(m[1]), suffix: plain(m[2]), section: s });
  }
  return out.sort((a, b) => b.year - a.year);
}
function plainYearSection(sections) {
  for (const y of yearSections(sections)) {
    if (y.suffix !== "") continue;
    const items = playable(y.section);
    if (items.length > 0) return items;
  }
  return null;
}
function recentMoviesRow(sectionsOf) {
  const items = plainYearSection(sectionsOf.peliculas);
  return items && row("magis_recent_peliculas", "Reci\xE9n agregadas \xB7 Pel\xEDculas", newestFirst(items));
}
function updatedSeriesRow(sectionsOf) {
  const items = plainYearSection(sectionsOf.series);
  return items && row("magis_new_series", "Series con cap\xEDtulos nuevos", newestFirst(items));
}
function cinemaRow(sectionsOf) {
  for (const y of yearSections(sectionsOf.peliculas)) {
    if (!y.suffix.includes("teatral")) continue;
    const items = playable(y.section);
    if (items.length > 0) return row("magis_new_peliculas", "Estrenos de cine", items);
  }
  return null;
}
function topRatedRows(byKind) {
  const out = [];
  for (const root of FEATURED) {
    const ranked = [...byKind[root]].sort(byScore);
    if (ranked.length === 0) continue;
    out.push({
      id: `magis_top_${root}`,
      title: `${byRoot[root].label} mejor valoradas`,
      shown: ranked.slice(0, MAX_ROW_SIZE),
      all: ranked
    });
  }
  return out;
}
function genreRows(byKind) {
  const perKind = KINDS.map(({ root }) => {
    const members = /* @__PURE__ */ new Map();
    const labels = /* @__PURE__ */ new Map();
    for (const item of byKind[root]) {
      for (const [key, label] of genresOf(item)) {
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(item);
        labels.set(key, label);
      }
    }
    const groups = [];
    for (const [key, items] of members) {
      if (items.length >= MIN_GENRE_SIZE) groups.push({ root, key, label: labels.get(key), items });
    }
    return groups.sort((a, b) => b.items.length - a.items.length || cmp(a.label, b.label));
  });
  const ordered = [];
  const longest = Math.max(0, ...perKind.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const groups of perKind) if (groups[i]) ordered.push(groups[i]);
  const seen = /* @__PURE__ */ new Set();
  return ordered.map((g) => {
    const shown = [...g.items].sort((a, b) => (seen.has(a.id) ? 1 : 0) - (seen.has(b.id) ? 1 : 0) || byScore(a, b)).slice(0, MAX_ROW_SIZE);
    for (const i of shown) seen.add(i.id);
    return {
      id: `magis_g_${g.root}_${g.key}`,
      title: `${g.label} \xB7 ${byRoot[g.root].label}`,
      shown,
      all: [...g.items].sort(byScore)
    };
  });
}
function classify(roots) {
  const sectionsOf = Object.fromEntries(KINDS.map((k) => [k.root, roots[k.root] || []]));
  const kindOf = /* @__PURE__ */ new Map();
  for (const root of PRECEDENCE) {
    for (const section2 of sectionsOf[root]) {
      for (const item of section2.items) {
        if (item.type !== TRAILER && !kindOf.has(item.id)) kindOf.set(item.id, [root, item]);
      }
    }
  }
  const byKind = Object.fromEntries(KINDS.map((k) => [k.root, []]));
  for (const [root, item] of kindOf.values()) byKind[root].push(item);
  return [recentMoviesRow(sectionsOf), updatedSeriesRow(sectionsOf)].filter(Boolean).concat(topRatedRows(byKind), [cinemaRow(sectionsOf)].filter(Boolean), genreRows(byKind));
}

// src/refs.js
var PREFIX = "magis1";
var SERIES = /* @__PURE__ */ new Set(["teleplay", "series", "variety"]);
var isSeries = (programType) => SERIES.has(programType);
var INT2 = /^[+-]?\d+$/;
function toIntOrNull(text2) {
  if (!INT2.test(text2)) return null;
  const n = Number(text2);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
var make = (contentId, programType, episode) => ({ contentId, programType, episode, isSeries: isSeries(programType) });
function encode({ contentId, programType = "movie", episode = 0 }) {
  return `${PREFIX}:${programType || "movie"}:${episode}:${contentId}`;
}
function encodeChapter(seriesNumber, seasonContentId) {
  return encode({ contentId: seasonContentId, programType: "teleplay", episode: seriesNumber });
}
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlToText(data) {
  const body = data.replace(/={1,2}$/, "");
  if (body.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(body)) return null;
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of body) {
    acc = acc << 6 | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(acc >> bits & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return utf8(bytes);
}
function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 128) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    const need = b >= 194 && b < 224 ? 1 : b >= 224 && b < 240 ? 2 : b >= 240 && b < 245 ? 3 : 0;
    if (need === 0 || i + need > bytes.length - 1) {
      out += "\uFFFD";
      i++;
      continue;
    }
    let cp = b & 255 >> need + 2;
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 192) !== 128) {
        ok = false;
        break;
      }
      cp = cp << 6 | c & 63;
    }
    if (!ok || cp > 1114111) {
      out += "\uFFFD";
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
function optInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.trim());
    return v.trim() !== "" && Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}
function fromGatewayRef(ref) {
  const dot = ref.indexOf(".");
  if (dot < 0) return null;
  const data = ref.slice(0, dot);
  if (isBlank(data)) return null;
  let json;
  try {
    const text2 = base64UrlToText(data);
    json = text2 === null ? null : JSON.parse(text2);
  } catch (_) {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  if (asText(json.s) !== "magis") return null;
  const p = json.p;
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null;
  const contentId = asText(p.content_id);
  if (isBlank(contentId)) return null;
  return make(contentId, asText(p.program_type).trim() === "" ? "movie" : asText(p.program_type), optInt(p.episode));
}
function decode(ref) {
  if (typeof ref !== "string" || isBlank(ref)) return null;
  if (ref.startsWith(PREFIX + ":")) {
    const parts = ref.split(":");
    if (parts.length < 4) return null;
    const contentId = parts.slice(3).join(":");
    if (isBlank(contentId)) return null;
    const type = parts[1];
    return make(contentId, type.trim() === "" ? "movie" : type, toIntOrNull(parts[2]) ?? 0);
  }
  return fromGatewayRef(ref);
}
var CHANNEL_CODE = /^[A-Za-z0-9._~-]{1,128}$/;
function isChannelRef(ref) {
  return typeof ref === "string" && CHANNEL_CODE.test(ref) && !ref.startsWith("~") && decode(ref) === null;
}

// src/homeTree.js
var PORTAL_OFFSET_MS = 8 * 36e5;
var nonBlank = (v) => {
  const s = asText(v);
  return s.trim() === "" ? null : s;
};
var DEC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function numberOrNull(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  return DEC.test(s) ? Number(s) : null;
}
function parseShelveTime(text2) {
  const raw = typeof text2 === "string" ? text2.trim() : "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return 0;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return 0;
  return t - PORTAL_OFFSET_MS;
}
function imageOf(asset, fileType) {
  if (!Array.isArray(asset.posterList)) return null;
  for (const p of asset.posterList) {
    if (p && p.fileType === fileType && !isBlank(p.fileUrl)) return p.fileUrl;
  }
  return null;
}
var logoOf = (a) => imageOf(a, "icon") ?? nonBlank(a.posterUrl);
function itemFrom(a) {
  if (a === null || typeof a !== "object") return null;
  const id = nonBlank(a.contentId);
  if (id === null) return null;
  const type = nonBlank(a.programType) ?? "movie";
  const tags = asText(a.tags).split(",").map((t) => t.trim()).filter((t) => t !== "");
  return {
    id,
    title: asText(a.name),
    poster: imageOf(a, "icon") ?? nonBlank(a.posterUrl),
    backdrop: imageOf(a, "poster"),
    durationS: intOrNull(a.duration) ?? 0,
    type,
    genres: tags,
    score: numberOrNull(a.score),
    description: asText(a.description),
    shelvedAtMs: parseShelveTime(asText(a.shelveTime))
  };
}
function parseTree(response) {
  const columns = response && Array.isArray(response.recommendList) ? response.recommendList : [];
  const sections = [];
  for (const c of columns) {
    if (c === null || typeof c !== "object") continue;
    const name = nonBlank(c.name);
    if (name === null) continue;
    const items = [];
    if (Array.isArray(c.assetList)) for (const a of c.assetList) {
      const it = itemFrom(a);
      if (it) items.push(it);
    }
    sections.push({ name, items });
  }
  return sections;
}
var refOf = (item) => encode({ contentId: item.id, programType: item.type, episode: 0 });
function storedLength(s) {
  let n = utf8Length(s);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 34 || c === 92 || c === 47 || c === 9 || c === 8 || c === 10 || c === 13 || c === 12) n += 1;
    else if (c < 32) n += 5;
  }
  return n;
}
function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) n += 1;
    else if (c < 2048) n += 2;
    else if (c >= 55296 && c < 56320 && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
function commonPrefix(urls) {
  if (urls.length === 0) return "";
  let p = urls[0];
  for (const u of urls) {
    while (!u.startsWith(p)) p = p.slice(0, -1);
    if (p === "") break;
  }
  return p.length >= 12 ? p : "";
}
function cut(text2, max) {
  if (text2.length <= max) return text2;
  const end = text2.charCodeAt(max - 1) >= 55296 && text2.charCodeAt(max - 1) < 56320 ? max - 1 : max;
  return text2.slice(0, end);
}
var TREE_FORMAT = 1;
function encodeTree(sections, { descMax = Infinity, genres = true, backdrop = true, perSection = Infinity } = {}) {
  sections = sections.map((s2) => s2.items.length > perSection ? { ...s2, items: s2.items.slice(0, perSection) } : s2);
  const urls = [];
  for (const s2 of sections) for (const i of s2.items) {
    if (i.poster) urls.push(i.poster);
    if (backdrop && i.backdrop) urls.push(i.backdrop);
  }
  const p = commonPrefix(urls);
  const strip = (u) => u === null ? null : u.slice(p.length);
  const table = /* @__PURE__ */ new Map();
  const items = [];
  const s = sections.map((sec) => [sec.name, sec.items.map((i) => {
    const rec = [
      i.id,
      i.title,
      strip(i.poster),
      backdrop ? strip(i.backdrop) : null,
      i.durationS,
      i.type,
      genres ? i.genres : [],
      i.score,
      cut(i.description, descMax),
      i.shelvedAtMs
    ];
    const key = JSON.stringify(rec);
    if (!table.has(key)) {
      table.set(key, items.length);
      items.push(rec);
    }
    return table.get(key);
  })]);
  return JSON.stringify({ v: TREE_FORMAT, p, i: items, s });
}
function decodeTree(text2) {
  const o = JSON.parse(text2);
  if (o === null || typeof o !== "object" || o.v !== TREE_FORMAT || typeof o.p !== "string" || !Array.isArray(o.i) || !Array.isArray(o.s)) {
    throw new Error("stored tree is malformed");
  }
  const full = (u) => typeof u === "string" ? o.p + u : null;
  const items = o.i.map((r) => {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[5] !== "string" || !Array.isArray(r[6])) {
      throw new Error("stored item is malformed");
    }
    return {
      id: r[0],
      title: asText(r[1]),
      poster: full(r[2]),
      backdrop: full(r[3]),
      durationS: Number(r[4]) || 0,
      type: r[5],
      genres: r[6].map(asText),
      score: typeof r[7] === "number" ? r[7] : null,
      description: asText(r[8]),
      shelvedAtMs: Number(r[9]) || 0
    };
  });
  return o.s.map((sec) => {
    if (!Array.isArray(sec) || typeof sec[0] !== "string" || !Array.isArray(sec[1])) throw new Error("stored section is malformed");
    return { name: sec[0], items: sec[1].map((n) => {
      if (!items[n]) throw new Error("stored index is malformed");
      return items[n];
    }) };
  });
}

// src/byteCache.js
function makeByteCache({ kino: kino2, key, budgetBytes, clock: clock2, ttlMs, valid = () => true }) {
  const what = String(key).split(":")[0];
  const decode2 = (raw) => {
    try {
      const o = JSON.parse(raw);
      if (!isObject(o) || o.v !== 1 || !Array.isArray(o.e)) return [];
      return o.e.filter((x) => isObject(x) && typeof x.k === "string" && Number.isFinite(x.s) && x.i !== void 0 && valid(x.i));
    } catch (_) {
      return [];
    }
  };
  const encode2 = (entries) => JSON.stringify({ v: 1, e: entries });
  function read() {
    try {
      const raw = kino2.storage.get(key);
      return raw === null || raw === void 0 ? [] : decode2(raw);
    } catch (_) {
      return [];
    }
  }
  const fresh = (entry, nowMs) => nowMs - entry.s < ttlMs;
  function get(k, entries = read(), nowMs = clock2.now()) {
    const hit = entries.find((e) => e.k === k && fresh(e, nowMs));
    return hit === void 0 ? void 0 : hit.i;
  }
  function write(added, touched = []) {
    try {
      const now = clock2.now();
      let entries = read().filter((e) => fresh(e, now));
      for (const k of touched) {
        const at = entries.findIndex((e) => e.k === k);
        if (at >= 0) entries.push(...entries.splice(at, 1));
      }
      for (const a of added) {
        const entry = { k: a.k, s: now, i: a.i };
        if (storedLength(encode2([entry])) > budgetBytes) {
          trace(kino2, "store", "skip", { what });
          continue;
        }
        entries = entries.filter((e) => e.k !== a.k);
        entries.push(entry);
      }
      let text2 = encode2(entries);
      let evicted = 0;
      while (storedLength(text2) > budgetBytes && entries.length > 0) {
        entries.shift();
        evicted++;
        text2 = encode2(entries);
      }
      if (evicted > 0) trace(kino2, "store", "evict", { what, n: evicted });
      if (entries.length === 0) return;
      kino2.storage.set(key, text2);
    } catch (e) {
      trace(kino2, "store", "full", { what, code: errCode(e) });
    }
  }
  return { read, get, fresh, write };
}

// src/search.js
var ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
var MAX_OUTPUT_ITEMS = 100;
var MAX_ALT_TITLES = 5;
var MAX_SPANISH_FORMS = 3;
var MAX_FULL_TITLE_RETRIES = 4;
var PAGE_SIZE = 20;
var PORTAL_SHARE_MS = 6e3;
var CACHE_KEY = "search:v1";
var CACHE_BUDGET_BYTES = 24e3;
var CACHE_FRESH_MS = 6 * 36e5;
var B = "(?<![\\p{L}\\p{N}_])";
var E = "(?![\\p{L}\\p{N}_])";
var SEASON_SOURCE = `(?:${B}T\\s?([0-9]{1,2})${E}|${B}Temp\\.?\\s?([0-9]{1,2})${E}|${B}Temporada\\s?([0-9]{1,2})${E}|${B}S([0-9]{1,2})${E})`;
function seasonFromName(name) {
  const m = new RegExp(SEASON_SOURCE, "iu").exec(typeof name === "string" ? name : "");
  if (!m) return 1;
  const digits = m.slice(1).find((g) => g !== void 0 && g.trim() !== "");
  return digits === void 0 ? 1 : Number(digits);
}
var withoutSeason = (name) => (typeof name === "string" ? name : "").replace(new RegExp(SEASON_SOURCE, "giu"), "").trim().toLowerCase();
function sortSeasons(items) {
  const slots = [];
  items.forEach((it, i) => {
    if (isSeries(it.p)) slots.push(i);
  });
  if (slots.length < 2) return items;
  const order = /* @__PURE__ */ new Map();
  for (const i of slots) {
    const key = withoutSeason(items[i].t);
    if (!order.has(key)) order.set(key, order.size);
  }
  const sorted = slots.map((i) => items[i]).sort((a, b) => order.get(withoutSeason(a.t)) - order.get(withoutSeason(b.t)) || seasonFromName(a.t) - seasonFromName(b.t));
  const out = items.slice();
  slots.forEach((i, pos) => {
    out[i] = sorted[pos];
  });
  return out;
}
var str3 = (v) => typeof v === "string" ? v : "";
var INT3 = /^[+-]?\d+$/;
function wholeNumberOrNull(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && INT3.test(v)) {
    const n = Number(v);
    return n >= -2147483648 && n <= 2147483647 ? n : null;
  }
  return null;
}
function slim(raw) {
  if (!isObject(raw)) return null;
  const c = str3(raw.contentId);
  if (c.trim() === "") return null;
  const alias = str3(raw.alias);
  const t = [raw.name, raw.viewPoint, raw.alias].map(str3).find((s) => s.trim() !== "") ?? "";
  const out = { c, t };
  if (alias !== t && alias.trim() !== "") out.a = alias;
  const programType = str3(raw.programType).trim() === "" ? "movie" : str3(raw.programType);
  if (programType !== "movie") out.p = programType;
  const year = str3(raw.releaseTime).slice(0, 4);
  if (/^[0-9]{4}$/.test(year)) out.y = year;
  const n = wholeNumberOrNull(raw.volumnCount) ?? wholeNumberOrNull(raw.updateCount) ?? 0;
  if (n !== 0) out.n = n;
  if (Array.isArray(raw.posterList)) {
    for (const p of raw.posterList) {
      if (!isObject(p)) continue;
      const key = p.fileType === "icon" ? "m" : p.fileType === "poster" ? "b" : null;
      const url = str3(p.fileUrl);
      if (key !== null && url.trim() !== "" && out[key] === void 0) out[key] = url;
    }
  }
  return out;
}
var eachObject = (list, f) => {
  if (Array.isArray(list)) {
    for (const x of list) if (isObject(x)) f(x);
  }
};
function flatten(response) {
  const out = [];
  if (isObject(response)) {
    eachObject(response.searchItemList, (group) => eachObject(group.itemList, (x) => out.push(x)));
    if (out.length === 0) eachObject(Array.isArray(response.assetList) ? response.assetList : response.list, (x) => out.push(x));
  }
  return out;
}
var validEntryItems = (items) => Array.isArray(items) && items.every((it) => isObject(it) && typeof it.c === "string" && typeof it.t === "string");
var intOr0 = (v) => typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
var distinctBy2 = (list, keyOf) => {
  const seen = /* @__PURE__ */ new Set();
  return list.filter((x) => {
    const k = keyOf(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
function makeSearch({ kino: kino2, portal, session, clock: clock2, tmdb = null }) {
  const surface = (e) => {
    if (e instanceof PortalError) return mapPortalError(e.code, e.message, kino2);
    if (isKinoError(e)) return e;
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  const cache = makeByteCache({ kino: kino2, key: CACHE_KEY, budgetBytes: CACHE_BUDGET_BYTES, clock: clock2, ttlMs: CACHE_FRESH_MS, valid: validEntryItems });
  function contextOf(query) {
    const q = isObject(query) ? query : {};
    const rawType = typeof q.type === "string" ? q.type.trim() : "";
    return {
      q: typeof q.q === "string" ? q.q.trim() : "",
      type: rawType === "" ? "movie" : rawType === "series" ? "tv" : rawType,
      season: intOr0(q.season),
      episode: intOr0(q.episode),
      tmdbId: intOr0(q.tmdbId),
      originalTitle: typeof q.originalTitle === "string" ? q.originalTitle : "",
      altTitles: Array.isArray(q.altTitles) ? q.altTitles.filter((s) => typeof s === "string").slice(0, MAX_ALT_TITLES) : []
    };
  }
  async function titleForms(ctx, deadline) {
    const forms = [ctx.q];
    if (ctx.tmdbId > 0 && tmdb) {
      let detail = null;
      try {
        detail = await tmdb.titleForms(ctx.type === "movie" ? "movie" : "tv", ctx.tmdbId, { deadline: deadline - PORTAL_SHARE_MS });
      } catch (_) {
        detail = null;
      }
      if (detail) {
        for (const t of [detail.title, detail.originalTitle, detail.englishTitle]) if (typeof t === "string" && t.trim() !== "") forms.push(t);
        for (const t of (Array.isArray(detail.spanishTitles) ? detail.spanishTitles : []).slice(0, MAX_SPANISH_FORMS)) forms.push(t);
      }
    }
    for (const t of [ctx.originalTitle, ...ctx.altTitles]) if (t.trim() !== "") forms.push(t);
    return distinctBy2(forms, (f) => f.trim().toLowerCase());
  }
  async function search2(query) {
    const deadline = callDeadline(clock2, CALL_BUDGET_MS.search);
    const ctx = contextOf(query);
    if (ctx.q === "") return [];
    const forms = await titleForms(ctx, deadline);
    const queries = distinctBy2(forms.map((f) => kino2.rank.shortQuery(f)), (f) => f.toLowerCase());
    const entries = cache.read();
    const nowMs = clock2.now();
    const touched = [];
    const added = [];
    const seen = /* @__PURE__ */ new Set();
    const pool = [];
    let lastError = null;
    let ensuring = null;
    async function portalItems(q) {
      ensuring ?? (ensuring = session.ensure({ deadline }));
      await ensuring;
      const response = await session.withValidSession((v) => portal.call(
        "v3/searchByName",
        { value: q, type: "0", columnId: "", filter: "", pageNum: 1, pageSize: PAGE_SIZE },
        viewOpts(v)
      ), { seedFallback: true, deadline });
      return flatten(response).map(slim).filter((x) => x !== null);
    }
    async function fetchInto(qs) {
      for (const q of qs) {
        const key = q.toLowerCase();
        let part = null;
        const hit = cache.get(key, entries, nowMs);
        if (hit !== void 0) {
          part = hit;
          touched.push(key);
        } else {
          try {
            part = await portalItems(q);
            if (part.length > 0) added.push({ k: key, i: part });
          } catch (e) {
            lastError = e;
            part = null;
          }
        }
        if (part) {
          for (const item of part) if (!seen.has(item.c)) {
            seen.add(item.c);
            pool.push(item);
          }
        }
      }
    }
    const titlesOf = (item) => [item.t, item.a ?? ""];
    const ranked = () => kino2.rank.filterRelevant(kino2.rank.sortBySimilarity(pool, forms, titlesOf), forms, titlesOf);
    let items;
    try {
      await fetchInto(queries);
      if (pool.length === 0 && lastError !== null) throw surface(lastError);
      items = ranked();
      if (items.length === 0) {
        const asked = new Set(queries.map((s) => s.trim().toLowerCase()));
        const full = distinctBy2(
          forms.map((f) => f.trim()).filter((f) => f !== "" && !asked.has(f.toLowerCase())),
          (f) => f.toLowerCase()
        ).slice(0, MAX_FULL_TITLE_RETRIES);
        if (full.length > 0) {
          await fetchInto(full);
          items = ranked();
        }
      }
    } finally {
      if (added.length > 0 || touched.length > 0) cache.write(added, touched);
    }
    if ((ctx.type === "tv" || ctx.type === "anime") && ctx.season > 0) {
      const matching = items.filter((it) => !isSeries(it.p ?? "movie") || seasonFromName(it.t) === ctx.season);
      if (matching.length > 0) items = matching;
    }
    if (items.length === 0 && ctx.tmdbId > 0) trace(kino2, "search", "empty", { type: ctx.type, pool: pool.length });
    const out = [];
    for (const it of sortSeasons(items)) {
      if (!ITEM_ID.test(it.c)) continue;
      const programType = it.p ?? "movie";
      const series = isSeries(programType);
      const item = {
        id: it.c,
        ref: encode({ contentId: it.c, programType, episode: ctx.episode }),
        title: it.t.trim() === "" ? it.c : it.t,
        kind: series ? "series" : "movie",
        year: it.y ?? "",
        season: series ? seasonFromName(it.t) : ctx.season,
        episodeCount: it.n ?? 0
      };
      if (it.m) item.poster = it.m;
      if (it.b) item.backdrop = it.b;
      out.push(item);
      if (out.length >= MAX_OUTPUT_ITEMS) break;
    }
    return out;
  }
  return { search: search2 };
}

// src/episodes.js
var CACHE_KEY2 = "chapters:v1";
var CACHE_BUDGET_BYTES2 = 32e3;
var CACHE_FRESH_MS2 = 6 * 36e5;
var IMDB = /^tt\d{7,}$/;
var MAX_EPISODES = 5e3;
var MAX_SEASONS = 50;
var INT4 = /^[+-]?\d+$/;
function toIntOrNull2(v) {
  const text2 = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (text2 === null || !INT4.test(text2)) return null;
  const n = Number(text2);
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}
function parseSeasonList(list, ownId) {
  let own = null;
  const all = [];
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const id = optStringStrict(entry.contentId);
    const number = toIntOrNull2(entry.seasonNumber);
    if (id === ownId) own = number;
    if (id.trim() !== "" && number !== null) all.push({ id, number });
  }
  if (own === null && entries.length === 0) own = 1;
  all.sort((a, b) => a.number - b.number);
  return { own, all };
}
function findChapter(items, episode) {
  if (episode <= 0) return items[0];
  return items.find((it) => typeof it.seriesNumber === "string" && it.seriesNumber.trim() === String(episode));
}
var validPayload = (p) => isObject(p) && typeof p.i === "string" && Array.isArray(p.a) && Array.isArray(p.e) && p.e.every((x) => Array.isArray(x) && typeof x[1] === "string" && typeof x[2] === "string") && p.a.every((x) => Array.isArray(x) && typeof x[0] === "string" && Number.isInteger(x[1])) && (p.s === null || Number.isInteger(p.s)) && (p.d === null || Number.isInteger(p.d));
function pack(raw) {
  return {
    i: raw.imdb,
    s: raw.season,
    d: raw.declared,
    a: raw.seasons.map((x) => [x.id, x.number]),
    e: raw.items.map((it) => it.duration === void 0 ? [it.seriesNumber, it.contentId, it.name] : [it.seriesNumber, it.contentId, it.name, it.duration])
  };
}
var unpack = (p) => ({
  items: p.e.map((x) => ({ seriesNumber: x[0], contentId: x[1], name: x[2], duration: x[3] })),
  imdb: p.i,
  season: p.s,
  declared: p.d,
  seasons: p.a.map((x) => ({ id: x[0], number: x[1] }))
});
function makePortalChapters({ kino: kino2, portal, session, clock: clock2 }) {
  const cache = makeByteCache({ kino: kino2, key: CACHE_KEY2, budgetBytes: CACHE_BUDGET_BYTES2, clock: clock2, ttlMs: CACHE_FRESH_MS2, valid: validPayload });
  async function fetchDetail(seriesId, deadline) {
    let response;
    try {
      await session.ensure({ deadline });
      response = await session.withValidSession((v) => portal.call(
        "v4/getItemData",
        { contentId: seriesId, type: "0", sortType: "0", language: "en", macAddr: FIXED_MAC },
        viewOpts(v)
      ), { seedFallback: true, deadline });
    } catch (e) {
      if (e instanceof PortalError) throw mapPortalError(e.code, e.message, kino2);
      if (isKinoError(e)) throw e;
      throw kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
    }
    const data = isObject(response) ? response.assetData : void 0;
    if (!isObject(data)) throw kino2.error("unavailable", "Xuper devolvi\xF3 una cap\xEDtulos sin datos");
    return data;
  }
  return async function portalChapters(seriesId, deadline = callDeadline(clock2, CALL_BUDGET_MS.episodes)) {
    const cached = cache.get(seriesId);
    if (cached !== void 0) return unpack(cached);
    const data = await fetchDetail(seriesId, deadline);
    const items = (Array.isArray(data.simpleProgramList) ? data.simpleProgramList : []).filter(isObject).map((it) => {
      const seriesNumber = typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null;
      const item = { seriesNumber, contentId: optStringStrict(it.contentId), name: optStringStrict(it.name), duration: void 0 };
      if (typeof it.duration === "string" || typeof it.duration === "number" && Number.isFinite(it.duration)) item.duration = it.duration;
      return item;
    });
    const seasonList = parseSeasonList(data.sameSeasonSeriesList, seriesId);
    const raw = { items, imdb: optStringStrict(data.keyWords), season: seasonList.own, declared: toIntOrNull2(data.volumnCount), seasons: seasonList.all };
    if (items.length > 0) cache.write([{ k: seriesId, i: pack(raw) }]);
    return raw;
  };
}
function makeEpisodes({ kino: kino2, tmdb = null, portalChapters, clock: clock2 = null }) {
  async function enrich(raw, bounds) {
    const none = { extra: /* @__PURE__ */ new Map(), series: null };
    if (!tmdb || !IMDB.test(raw.imdb) || raw.season === null) return none;
    try {
      const series = await tmdb.seriesByImdb(raw.imdb, bounds);
      if (!series) return none;
      const fromTmdb = await tmdb.seasonEpisodes(series.tmdbId, raw.season, void 0, bounds);
      if (!fromTmdb) return { extra: /* @__PURE__ */ new Map(), series };
      const expected = raw.declared !== null && raw.declared > 0 ? raw.declared : raw.items.length;
      if (expected !== fromTmdb.length) return { extra: /* @__PURE__ */ new Map(), series };
      const rows = /* @__PURE__ */ new Map();
      for (const c of fromTmdb) {
        const row2 = { still: c.still.trim() !== "" ? c.still : null, title: c.name.trim() !== "" ? c.name : null, overview: c.overview.trim() !== "" ? c.overview : null };
        if (row2.still !== null || row2.title !== null || row2.overview !== null) rows.set(c.episode, row2);
        else rows.delete(c.episode);
      }
      const missing = new Set([...rows].filter(([, r]) => r.overview === null).map(([n]) => n));
      if (missing.size === 0) return { extra: rows, series };
      let inEnglish = [];
      try {
        inEnglish = await tmdb.seasonEpisodes(series.tmdbId, raw.season, "en-US", bounds) ?? [];
      } catch (_) {
        inEnglish = [];
      }
      for (const c of inEnglish) {
        if (missing.has(c.episode) && c.overview.trim() !== "") rows.set(c.episode, { ...rows.get(c.episode), overview: c.overview });
      }
      return { extra: rows, series };
    } catch (_) {
      return none;
    }
  }
  return async function episodes2(ref) {
    const magis = decode(ref);
    if (!magis) throw kino2.error("unavailable", "ese ref no es de Xuper: no se pueden listar cap\xEDtulos");
    const deadline = clock2 ? callDeadline(clock2, CALL_BUDGET_MS.episodes) : void 0;
    let raw;
    try {
      raw = await portalChapters(magis.contentId, deadline);
    } catch (e) {
      if (isKinoError(e) && e.userMessage === EPISODE_GONE) throw mapPortalError("portal100006", "", kino2, { goneMessage: SERIES_GONE });
      throw e;
    }
    const { extra, series } = await enrich(raw, { deadline });
    const list = raw.items.slice(0, MAX_EPISODES).map((it) => {
      const number = toIntOrNull2(it.seriesNumber) ?? 0;
      const ep = {
        number,
        title: it.name.trim() !== "" ? it.name : `Cap\xEDtulo ${number}`,
        // The series plus the number: whoever plays it looks the chapter back up in the list.
        ref: encodeChapter(number, magis.contentId)
      };
      const t = extra.get(number);
      if (t?.still) ep.still = t.still;
      if (t?.title) ep.tmdbTitle = t.title;
      if (t?.overview) ep.overview = t.overview;
      if (raw.season !== null) ep.season = raw.season;
      return ep;
    });
    const out = { episodes: list };
    if (IMDB.test(raw.imdb)) {
      out.series = {
        ids: { imdb: raw.imdb, tmdb: series?.tmdbId ?? 0 },
        seasonNumber: raw.season ?? 0,
        title: series?.title ?? "",
        poster: series?.poster ?? "",
        backdrop: series?.backdrop ?? ""
      };
    }
    if (raw.seasons.length > 0) {
      out.seasons = raw.seasons.slice(0, MAX_SEASONS).map((s) => ({
        id: s.id,
        // A season IS a portal title of the same kind: its ref is what a search would give it.
        ref: encode({ contentId: s.id, programType: magis.programType, episode: 0 }),
        title: `Temporada ${s.number}`,
        number: s.number,
        current: s.id === magis.contentId
      }));
    }
    return out;
  };
}

// src/catalog.js
var ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
var ADULT_ROOT_CODE = "masnew_adult";
var ADULT_REF = "magis_adultos";
var TREE_TTL_MS = 2 * 36e5;
var TREE_PAGE_SIZE = 60;
var TREE_BUDGET_BYTES = 2e4;
var SHED_STEPS = [
  {},
  { descMax: 120 },
  { descMax: 0 },
  { descMax: 0, genres: false },
  { descMax: 0, genres: false, backdrop: false },
  { descMax: 0, genres: false, backdrop: false, perSection: 100 },
  { descMax: 0, genres: false, backdrop: false, perSection: 50 }
];
var BROWSE_PAGE = 50;
var HOME_RETRY_PAUSE_MS = 1500;
var HOME_RETRY_MIN_MS = 3e3;
var MAX_HOME_ROWS = 20;
var MAX_ROW_ITEMS = 60;
var MAX_GENRES = 5;
var NEW_WINDOW_MS = 48 * 36e5;
var ITEM_ID2 = /^[A-Za-z0-9._~-]{1,128}$/;
function projectItem(item, nowMs) {
  if (!ITEM_ID2.test(item.id)) return null;
  const out = {
    id: item.id,
    ref: refOf(item),
    title: item.title.trim() === "" ? item.id : item.title,
    kind: isSeries(item.type) ? "series" : "movie"
  };
  if (item.poster) out.poster = item.poster;
  if (item.backdrop) out.backdrop = item.backdrop;
  if (item.description.trim() !== "") out.overview = item.description;
  if (item.genres.length > 0) out.genres = item.genres.slice(0, MAX_GENRES);
  if (item.score !== null && Number.isFinite(item.score) && item.score >= 0 && item.score <= 10) out.rating = item.score;
  const minutes = Math.trunc(item.durationS / 60);
  if (minutes >= 1 && minutes <= 1e3) out.runtimeMinutes = minutes;
  if (item.shelvedAtMs > 0 && nowMs - item.shelvedAtMs <= NEW_WINDOW_MS) out.badges = ["NUEVO"];
  return out;
}
function projectRows(rows, nowMs) {
  const out = [];
  for (const r of rows) {
    const items = r.shown.map((i) => projectItem(i, nowMs)).filter((i) => i !== null).slice(0, MAX_ROW_ITEMS);
    if (items.length > 0) out.push({ id: r.id, title: r.title, ref: r.id, items });
  }
  return out.slice(0, MAX_HOME_ROWS);
}
var hasItems = (sections) => sections.some((s) => s.items.length > 0);
var INT5 = /^[+-]?\d+$/;
function offsetOf(cursor) {
  if (typeof cursor !== "string" || !INT5.test(cursor)) return 0;
  const n = Number(cursor);
  return n > 0 && n <= 2147483647 ? n : 0;
}
function makeCatalog({ kino: kino2, portal, session, clock: clock2, tmdb = null, countryRow = null }) {
  const key = (root) => `tree:${root}`;
  function readTree(root) {
    try {
      const raw = kino2.storage.get(key(root));
      if (raw === null || raw === void 0) return null;
      const sections = decodeTree(raw);
      return hasItems(sections) ? sections : null;
    } catch (_) {
      return null;
    }
  }
  function writeTree(root, sections) {
    for (let step = 0; step < SHED_STEPS.length; step++) {
      const text2 = encodeTree(sections, SHED_STEPS[step]);
      if (storedLength(text2) > TREE_BUDGET_BYTES) continue;
      if (step > 0) trace(kino2, "store", "trim", { what: "tree", root, step });
      try {
        kino2.storage.set(key(root), text2, { ttlMs: TREE_TTL_MS });
      } catch (e) {
        trace(kino2, "store", "full", { what: "tree", root, code: errCode(e) });
      }
      return;
    }
    trace(kino2, "store", "skip", { what: "tree", root });
  }
  async function fetchRoot(root, deadline) {
    try {
      const response = await session.withValidSession((v) => portal.call(
        "getNextColumns",
        { columnCode: ROOT_CODES[root], pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
        viewOpts(v)
      ), { seedFallback: true, deadline });
      const sections = parseTree(response);
      if (!hasItems(sections)) return { sections: [], error: null };
      writeTree(root, sections);
      return { sections, error: null };
    } catch (e) {
      trace(kino2, "home", "root_fail", { root, code: errCode(e) });
      return { sections: [], error: isKinoError(e) ? e : kino2.error("unavailable", "Xuper no est\xE1 disponible ahora") };
    }
  }
  const inflight = /* @__PURE__ */ new Map();
  function sharedFetchRoot(root, deadline) {
    let pending = inflight.get(root);
    if (!pending) {
      pending = fetchRoot(root, deadline).finally(() => inflight.delete(root));
      inflight.set(root, pending);
    }
    return pending;
  }
  const allFailed = (fetched) => fetched.length === KINDS.length && fetched.every((f) => f.error !== null);
  const worstOf = (fetched) => (fetched.find((f) => f.error.name !== "KinoError_unavailable") || fetched[0]).error;
  function summarizeFailure(fetched, passes) {
    const codes = [];
    for (const f of [...fetched].sort((a, b) => (a.error.name === "KinoError_unavailable") - (b.error.name === "KinoError_unavailable"))) {
      const c = errCode(f.error);
      if (!codes.includes(c)) codes.push(c);
    }
    const fields = { roots: fetched.length, rounds: passes };
    codes.slice(0, 3).forEach((c, i) => {
      fields["c" + (i + 1)] = c;
    });
    trace(kino2, "home", "all_fail", fields);
  }
  async function buildRows(budgetMs = CALL_BUDGET_MS.home) {
    const deadline = callDeadline(clock2, budgetMs);
    const roots = {};
    const missing = [];
    for (const { root } of KINDS) {
      const cached = readTree(root);
      if (cached) roots[root] = cached;
      else missing.push(root);
    }
    if (missing.length > 0) {
      await session.ensure({ deadline });
      const pass = () => Promise.all(missing.map((root) => sharedFetchRoot(root, deadline)));
      let fetched = await pass();
      let passes = 1;
      if (allFailed(fetched)) {
        if (deadline - clock2.now() >= HOME_RETRY_PAUSE_MS + HOME_RETRY_MIN_MS) {
          try {
            await kino2.sleep(HOME_RETRY_PAUSE_MS);
          } catch (_) {
          }
          fetched = await pass();
          passes = 2;
        }
        if (allFailed(fetched)) {
          summarizeFailure(fetched, passes);
          throw worstOf(fetched);
        }
      }
      missing.forEach((root, i) => {
        roots[root] = fetched[i].sections;
      });
    }
    return classify(roots);
  }
  async function home2() {
    const live2 = countryRow ? countryRow(callDeadline(clock2, CALL_BUDGET_MS.home)).catch(() => null) : Promise.resolve(null);
    const rows2 = projectRows(await buildRows(), clock2.now());
    const row2 = await live2;
    return row2 ? [...rows2.slice(0, MAX_HOME_ROWS - 1), row2] : rows2;
  }
  let adultInflight = null;
  async function fetchAdult(deadline) {
    await session.ensure({ deadline });
    const response = await session.withValidSession((v) => portal.call(
      "getNextColumns",
      { columnCode: ADULT_ROOT_CODE, pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
      viewOpts(v)
    ), { seedFallback: true, deadline });
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const s of parseTree(response)) {
      for (const item of s.items) {
        if (isSeries(item.type) || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  }
  function adultMovies(deadline) {
    if (!adultInflight) adultInflight = fetchAdult(deadline).finally(() => {
      adultInflight = null;
    });
    return adultInflight;
  }
  async function browseAdult(cursor) {
    const all = await adultMovies(callDeadline(clock2, CALL_BUDGET_MS.browse));
    const offset = offsetOf(cursor);
    const nowMs = clock2.now();
    const items = all.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null).map((i) => ({ ...i, adult: true }));
    const next = offset + BROWSE_PAGE;
    return next < all.length ? { items, next: String(next) } : { items };
  }
  async function browse2(ref, cursor) {
    if (ref === ADULT_REF) return browseAdult(cursor);
    const row2 = typeof ref === "string" ? (await buildRows()).find((r) => r.id === ref) : void 0;
    if (!row2) throw kino2.error("not_found", "No se encontr\xF3 esa lista");
    const offset = offsetOf(cursor);
    const nowMs = clock2.now();
    const items = row2.all.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null);
    const next = offset + BROWSE_PAGE;
    return next < row2.all.length ? { items, next: String(next) } : { items };
  }
  const { search: search2 } = makeSearch({ kino: kino2, portal, session, clock: clock2, tmdb });
  const portalChapters = makePortalChapters({ kino: kino2, portal, session, clock: clock2 });
  const episodes2 = makeEpisodes({ kino: kino2, tmdb, portalChapters, clock: clock2 });
  const rows = (budgetMs) => buildRows(budgetMs);
  return { home: home2, browse: browse2, rows, search: search2, episodes: episodes2, portalChapters };
}

// src/tmdb.js
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_LANGUAGE = "es-MX";
var TIMEOUT_MS = 8e3;
var MIN_TIMEOUT_MS = 500;
var IMG = "https://image.tmdb.org/t/p";
var IMDB_ID = /^tt\d{7,}$/;
var text = (v) => typeof v === "string" ? v : "";
var blank3 = (s) => s.trim() === "";
function parseTitleForms(type, body) {
  let o;
  try {
    o = JSON.parse(body);
  } catch (_) {
    return null;
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const isTv = type === "tv";
  const localized = text(isTv ? o.name : o.title);
  const original = text(isTv ? o.original_name : o.original_title);
  const list = o.translations && Array.isArray(o.translations.translations) ? o.translations.translations : [];
  const entries = list.filter((t) => t !== null && typeof t === "object");
  const titleOf = (t) => t.data !== null && typeof t.data === "object" ? text(isTv ? t.data.name : t.data.title) : "";
  const englishEntry = entries.find((t) => t.iso_639_1 === "en");
  const spanish = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of entries) {
    if (t.iso_639_1 !== "es") continue;
    const title2 = titleOf(t);
    const key = title2.trim().toLowerCase();
    if (blank3(title2) || key === localized.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    spanish.push(title2);
  }
  return {
    title: localized,
    originalTitle: original,
    englishTitle: englishEntry ? titleOf(englishEntry) : "",
    spanishTitles: spanish
  };
}
var INT6 = /^[+-]?\d+$/;
function optInt2(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && INT6.test(v.trim())) return Number(v.trim());
  return 0;
}
var imageUrl = (path, size) => typeof path !== "string" || blank3(path) || path === "null" ? "" : `${IMG}/${size}${path}`;
function parseSeriesByImdb(body) {
  let o;
  try {
    o = JSON.parse(body);
  } catch (_) {
    return null;
  }
  const tv = isObject(o) && Array.isArray(o.tv_results) && isObject(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt2(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}
function parseSeasonEpisodes(body) {
  let o;
  try {
    o = JSON.parse(body);
  } catch (_) {
    return null;
  }
  if (!isObject(o)) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObject).map((e) => {
    const episode = optInt2(e.episode_number);
    const name = text(e.name);
    return { episode, name: blank3(name) ? `Episodio ${episode}` : name, overview: text(e.overview), still: imageUrl(e.still_path, "w300") };
  });
}
function makeTmdb({ kino: kino2, clock: clock2 = null }) {
  function timeoutFor(bounds) {
    const deadline = bounds && typeof bounds.deadline === "number" && clock2 ? bounds.deadline : null;
    if (deadline === null) return TIMEOUT_MS;
    const ms = Math.min(TIMEOUT_MS, Math.floor(deadline - clock2.now()));
    return ms >= MIN_TIMEOUT_MS ? ms : null;
  }
  function keyMarker() {
    try {
      return kino2.secret("tmdbKey");
    } catch (_) {
      return null;
    }
  }
  async function titleForms(type, id, bounds) {
    try {
      if (!Number.isInteger(id) || id <= 0) return null;
      const timeoutMs = timeoutFor(bounds);
      if (timeoutMs === null) return null;
      const key = keyMarker();
      if (!key) return null;
      const kind = type === "movie" ? "movie" : "tv";
      const url = `${TMDB_BASE}/${kind}/${id}?api_key=${key}&language=${TMDB_LANGUAGE}&append_to_response=translations`;
      const res = await kino2.fetch(url, { cookies: false, timeoutMs });
      if (!res || !res.ok) return null;
      return parseTitleForms(kind, res.text());
    } catch (_) {
      return null;
    }
  }
  async function read(path, language, bounds) {
    try {
      const timeoutMs = timeoutFor(bounds);
      if (timeoutMs === null) return null;
      const key = keyMarker();
      if (!key) return null;
      const sep = path.includes("?") ? "&" : "?";
      const res = await kino2.fetch(`${TMDB_BASE}${path}${sep}api_key=${key}&language=${language}`, { cookies: false, timeoutMs });
      if (!res || !res.ok) return null;
      return res.text();
    } catch (_) {
      return null;
    }
  }
  async function seriesByImdb(imdbId, bounds) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read(`/find/${imdbId}?external_source=imdb_id`, TMDB_LANGUAGE, bounds);
    return body === null ? null : parseSeriesByImdb(body);
  }
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE, bounds) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read(`/tv/${tvId}/season/${season}`, language, bounds);
    return body === null ? null : parseSeasonEpisodes(body);
  }
  return { titleForms, seriesByImdb, seasonEpisodes };
}

// src/resolve.js
var SLB_DEFAULT_TTL_S = 300;
var FOLLOW_UP_RESERVE_MS = 3e3;
var AUTH_MARGIN_S = 300;
var EXPIRED = /expired=(\d+)/;
var MAX_SUBTITLES = 30;
var INT7 = /^[+-]?\d+$/;
var DIGITS = /^[0-9]+$/;
function isCfl(url) {
  return url.slice(url.lastIndexOf("?") + 1).split("&").some((p) => p.trim() === "sign_type=cfl");
}
function withScheme(mainAddr) {
  const clean = mainAddr.replace(/\/+$/, "");
  return clean.startsWith("http://") || clean.startsWith("https://") ? clean : `https://${clean}`;
}
function portalDurationMs(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw * 1e3) : 0;
  if (typeof raw !== "string") return 0;
  const text2 = raw.trim();
  if (text2 === "") return 0;
  const parts = text2.split(":");
  if (parts.length > 3 || parts.some((p) => !DIGITS.test(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 1e3;
}
function bestMedia(play) {
  const episode = isObject(play) ? objects(play.episodeList)[0] : void 0;
  if (!episode) return null;
  const candidates = objects(episode.totalMovieList).flatMap((tm) => objects(tm.movieList));
  let best = null;
  let bestScore = Infinity;
  for (const m of candidates) {
    const score = (optStringStrict(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (optStringStrict(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}
function readSubtitles(play) {
  const episode = objects(play.episodeList)[0];
  const out = [];
  for (const sub of objects(episode?.subtitleList)) {
    const file = objects(sub.file)[0];
    if (!file) continue;
    const url = optStringStrict(file.url);
    if (!notBlank(url)) continue;
    out.push({ lang: optStringStrict(sub.language), url, format: notBlank(optStringStrict(file.fileType)) ? optStringStrict(file.fileType) : "srt" });
  }
  return out.slice(0, MAX_SUBTITLES);
}
function vodCdn(slb) {
  for (const cdn of objects(slb.cdn_list)) {
    if (optStringStrict(cdn.tag) !== "vod") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optStringStrict(u.url);
      if ((isCfl(url) || optStringStrict(u.sign_type) === "cfl") && optStringStrict(u.tag) === "free") {
        return { base: withScheme(optStringStrict(cdn.main_addr)), auth: url };
      }
    }
  }
  return null;
}
function slbLifetime(slb, nowMs) {
  const text2 = optStringStrict(slb.invalidTime);
  const declaredN = INT7.test(text2) ? Number(text2) : NaN;
  const declared = declaredN > 0 ? declaredN : SLB_DEFAULT_TTL_S;
  const cdn = vodCdn(slb);
  if (!cdn) return 0;
  const m = EXPIRED.exec(cdn.auth);
  if (!m) return declared;
  return Math.min(declared, Number(m[1]) - Math.floor(nowMs / 1e3) - AUTH_MARGIN_S);
}
var slbBean = (apkVersion, liveCodes = ["masnew_live"]) => ({
  hasPay: "0",
  userIdentity: "1",
  type: "merge",
  appVer: apkVersion,
  lang: "es",
  encMediaSupported: 1,
  liveCodeList: [...liveCodes],
  appParams: "",
  reserve1: FIXED_MAC,
  pipFlag: "0"
});
function makeResolve({ kino: kino2, portal, session, clock: clock2, config, portalChapters, live: live2 = null }) {
  const unavailable = (text2) => kino2.error("unavailable", text2);
  let slbCache = null;
  const slbFor = async (v) => {
    if (slbCache && slbCache.token === v.userToken && clock2.now() < slbCache.expiresMs) return slbCache.slb;
    const answer = await portal.call("v14/getSlbInfo", slbBean(config.apkVersion), viewOpts(v));
    const fresh = isObject(answer) ? answer : {};
    const ttl = slbLifetime(fresh, clock2.now());
    slbCache = ttl > 0 ? { slb: fresh, token: v.userToken, expiresMs: clock2.now() + ttl * 1e3 } : null;
    return fresh;
  };
  const sessionSlb = (seed, deadline) => seed ? slbFor({ ...seed, deadline }) : session.withValidSession(slbFor, { deadline });
  async function chapterFrom(magis, deadline) {
    const { items } = await portalChapters(magis.contentId, deadline);
    if (items.length === 0) throw unavailable(`la serie ${magis.contentId} vino sin cap\xEDtulos`);
    const chapter2 = findChapter(items, magis.episode);
    if (!chapter2) throw unavailable(`la serie no tiene el cap\xEDtulo ${magis.episode}`);
    return chapter2;
  }
  async function resolveVod(magis, chapter2, deadline) {
    await session.ensure({ deadline: deadline - FOLLOW_UP_RESERVE_MS });
    const contentId = chapter2 && notBlank(chapter2.contentId) ? chapter2.contentId : magis.contentId;
    let played = null;
    const play = await session.withValidSession((v) => {
      played = v;
      return portal.call(
        "v10/startPlayVOD",
        { contentId, seriesContentId: chapter2 ? magis.contentId : "", startTime: 0, type: "1", columnId: 0, authType: "" },
        viewOpts(v)
      );
    }, { seedFallback: true, deadline: deadline - FOLLOW_UP_RESERVE_MS });
    const best = bestMedia(play);
    if (!best) throw unavailable("Xuper devolvi\xF3 sin media reproducible");
    const license = optStringStrict(objects(best.licenseList)[0]?.license);
    if (!notBlank(license)) throw unavailable("Xuper devolvi\xF3 sin licenseList");
    const cdn = vodCdn(await sessionSlb(played && played.sn ? played : null, deadline));
    if (!cdn) throw unavailable("Xuper no expuso CDN de vod con token libre");
    const ext = optStringStrict(best.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
    return {
      url: `${cdn.base}/vod/${optStringStrict(best.contentId)}_media.${ext}`,
      mime: ext === "mp4" ? "video/mp4" : "video/mp2t",
      headers: {
        "Content-Auth": cdn.auth,
        // the querystring verbatim: VOD is not re-signed
        "Content-License": license,
        "User-Agent": UA_CDN,
        App: config.appId,
        "App-Version": config.apkVersion
      },
      subtitles: readSubtitles(play),
      // A chapter's own declared duration wins (the portal sends it empty for most series).
      durationMs: chapter2 ? portalDurationMs(chapter2.duration) : portalDurationMs(best.duration)
    };
  }
  async function resolve2(ref, options) {
    if (live2 && isChannelRef(ref)) return live2.resolveLive(ref, options);
    const deadline = callDeadline(clock2, CALL_BUDGET_MS.resolve);
    try {
      const magis = decode(ref);
      if (!magis) throw unavailable("ese ref no es de Xuper: no se puede reproducir");
      const chapter2 = magis.isSeries ? await chapterFrom(magis, deadline - 2 * FOLLOW_UP_RESERVE_MS) : null;
      return await resolveVod(magis, chapter2, deadline);
    } catch (e) {
      if (e instanceof PortalError) throw mapPortalError(e.code, e.message, kino2);
      if (isKinoError(e)) throw e;
      throw unavailable("Xuper no est\xE1 disponible ahora");
    }
  }
  return { resolve: resolve2 };
}

// src/liveCatalog.js
var LIVE_ROOT = "masnew_live";
var CATEGORIES_PAGE_SIZE = 200;
var CHANNELS_PAGE_SIZE = 500;
var MAX_PAGES = 10;
var MAX_CATEGORIES = 200;
var ID = /^[A-Za-z0-9._~-]{1,128}$/;
var POSITIVE = /^\d{1,9}$/;
var NAMES = { ChannelList: "Todos" };
var ADULT_NAMES = /* @__PURE__ */ new Set(["18+", "adultos", "adulto", "xxx", "+18"]);
function makeLiveCatalog({ kino: kino2, portal, session, clock: clock2 }) {
  let adultIds = null;
  const surface = (e) => {
    if (e instanceof PortalError) return mapPortalError(e.code, e.message, kino2);
    if (isKinoError(e)) return e;
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  async function readCategories(deadline) {
    let response;
    try {
      await session.ensure({ deadline });
      response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "getNextColumns",
        { columnCode: LIVE_ROOT, pageNum: 1, pageSize: CATEGORIES_PAGE_SIZE, version: "" },
        { baseFields: true, userId, userToken, deadline }
      ), { deadline });
    } catch (e) {
      throw surface(e);
    }
    const columns = isObject(response) && Array.isArray(response.recommendList) ? response.recommendList : [];
    const out = [];
    for (const c of columns) {
      if (!isObject(c)) continue;
      const id = intOrNull(c.columnId);
      if (id === null || id <= 0) continue;
      const raw = asText(c.name);
      const name = Object.hasOwn(NAMES, raw) ? NAMES[raw] : raw;
      if (isBlank(name)) continue;
      out.push({ id: String(id), name, adult: ADULT_NAMES.has(name.trim().toLowerCase()) });
    }
    if (out.length > 0) adultIds = new Set(out.filter((c) => c.adult).map((c) => c.id));
    return out;
  }
  async function liveCategories2() {
    const all = await readCategories(callDeadline(clock2, CALL_BUDGET_MS.liveCategories));
    return all.filter((c) => ID.test(c.id)).slice(0, MAX_CATEGORIES).map((c) => c.adult ? { id: c.id, title: c.name, adult: true } : { id: c.id, title: c.name });
  }
  async function isAdultCategory(id, deadline) {
    if (adultIds === null) {
      await readCategories(deadline);
      if (adultIds === null) throw kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
    }
    return adultIds.has(id);
  }
  async function fetchPage(columnId, page, deadline) {
    await session.ensure({ deadline });
    const response = await session.withValidSession(({ userId, userToken }) => portal.call(
      "v6/getLiveData",
      { columnId: Number(columnId), pageNum: page, pageSize: CHANNELS_PAGE_SIZE, dataVersion: "", expireTimeStr: "" },
      { baseFields: true, userId, userToken, deadline }
    ), { deadline });
    return isObject(response) && Array.isArray(response.channelList) ? response.channelList : [];
  }
  function project(list, categoryId, adult) {
    const seen = /* @__PURE__ */ new Set();
    const items = [];
    for (const c of list) {
      if (!isObject(c)) continue;
      const code = asText(c.channelCode);
      const title2 = asText(c.name);
      if (isBlank(code) || isBlank(title2) || !ID.test(code) || code.startsWith("~") || seen.has(code)) continue;
      seen.add(code);
      const n = intOrNull(c.channelNumber);
      const item = { id: code, title: title2, ref: code, categoryId, number: n !== null && n >= 1 && n <= 9999 ? n : 0 };
      if (adult) item.adult = true;
      const logo = logoOf(c);
      if (logo) item.logo = logo;
      items.push(item);
    }
    return items;
  }
  async function liveChannels2({ categoryId, cursor } = {}) {
    const deadline = callDeadline(clock2, CALL_BUDGET_MS.liveChannels);
    if (typeof categoryId !== "string" || !POSITIVE.test(categoryId) || Number(categoryId) <= 0) {
      throw kino2.error("not_found", "No se encontr\xF3 esa categor\xEDa");
    }
    const id = String(Number(categoryId));
    const page = typeof cursor === "string" && POSITIVE.test(cursor) && Number(cursor) >= 1 ? Number(cursor) : 1;
    if (page > MAX_PAGES) return { items: [] };
    try {
      const adult = await isAdultCategory(id, deadline);
      const list = await fetchPage(id, page, deadline);
      const items = project(list, id, adult);
      return list.length >= CHANNELS_PAGE_SIZE && page < MAX_PAGES ? { items, next: String(page + 1) } : { items };
    } catch (e) {
      if (page > 1) return { items: [] };
      throw surface(e);
    }
  }
  const categoriesWithin = (deadline) => readCategories(deadline);
  async function channelsWithin(id, deadline) {
    const adult = await isAdultCategory(id, deadline);
    return project(await fetchPage(id, 1, deadline), id, adult);
  }
  return { liveCategories: liveCategories2, liveChannels: liveChannels2, categoriesWithin, channelsWithin };
}

// src/tweakedMd5.js
var K = Object.freeze([
  3614090360,
  3905402710,
  606105819,
  3250441966,
  4118548399,
  1200080426,
  2821735955,
  4249261313,
  1770035416,
  2336552879,
  4294925233,
  2304563134,
  1804603682,
  4254626195,
  2792965006,
  1236535329,
  4129170786,
  3225465664,
  643717713,
  3921069994,
  3593408605,
  38016083,
  3634488961,
  3889429448,
  568446438,
  3275163606,
  4107603335,
  1163531501,
  2850285829,
  4243563512,
  1735328473,
  2368359562,
  4294588738,
  2272392833,
  1839030562,
  4259657740,
  2763975236,
  1272893353,
  4139469664,
  3200236656,
  681279174,
  3936430074,
  3564056709,
  76029189,
  // [42] tweaked: standard d4ef3085
  3654602809,
  3871185381,
  530742520,
  3299628645,
  // [45] tweaked: standard e6db99e5
  4096336452,
  1126891415,
  2878612391,
  4237533241,
  1700485571,
  2399980690,
  4293706877,
  2240044497,
  // [54] tweaked: standard ffeff47d
  1873313359,
  4264355552,
  2734768916,
  1309151649,
  4149444226,
  3174756917,
  765973179,
  3951481745
  // [62] tweaked: standard 2ad7d2bb
]);
var TWEAKED_STEPS = Object.freeze([42, 45, 54, 62]);
var S = [
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  7,
  12,
  17,
  22,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  5,
  9,
  14,
  20,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  4,
  11,
  16,
  23,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21,
  6,
  10,
  15,
  21
];
var ROUND1 = [10, 11, 12, 13, 14, 15, 6, 7, 8, 9, 0, 1, 2, 3, 4, 5];
var G = Array.from({ length: 64 }, (_, i) => i < 16 ? ROUND1[i] : i < 32 ? (5 * i + 1) % 16 : i < 48 ? (3 * i + 5) % 16 : 7 * i % 16);
var SALT = new Uint8Array([
  115,
  97,
  108,
  116,
  51,
  51,
  51,
  51,
  61,
  52,
  152,
  13,
  10,
  21,
  50,
  201,
  195,
  130,
  23,
  8,
  192
]);
var rotl = (x, n) => (x << n | x >>> 32 - n) >>> 0;
function compress(state, block, off) {
  const m = new Array(16);
  for (let j = 0; j < 16; j++) {
    const p = off + j * 4;
    m[j] = (block[p] | block[p + 1] << 8 | block[p + 2] << 16 | block[p + 3] << 24) >>> 0;
  }
  let [a, b, c, d] = state;
  for (let i = 0; i < 64; i++) {
    let f;
    if (i < 16) f = b & c | ~b & d;
    else if (i < 32) f = d & b | ~d & c;
    else if (i < 48) f = b ^ c ^ d;
    else f = c ^ (b | ~d);
    const sum = f + a + K[i] + m[G[i]] >>> 0;
    a = d;
    d = c;
    c = b;
    b = b + rotl(sum, S[i]) >>> 0;
  }
  state[0] = state[0] + a >>> 0;
  state[1] = state[1] + b >>> 0;
  state[2] = state[2] + c >>> 0;
  state[3] = state[3] + d >>> 0;
}
function digestHex(bytes) {
  const state = [1732584193, 4023233417, 2562383102, 271733878];
  const len = bytes.length;
  const padLen = (56 - (len + 1) % 64 + 64) % 64;
  const total = new Uint8Array(len + 1 + padLen + 8);
  total.set(bytes, 0);
  total[len] = 128;
  const low = len % 536870912 * 8;
  const high = Math.floor(len / 536870912);
  for (let i = 0; i < 4; i++) {
    total[len + 1 + padLen + i] = low >>> 8 * i & 255;
    total[len + 5 + padLen + i] = high >>> 8 * i & 255;
  }
  for (let off = 0; off < total.length; off += 64) compress(state, total, off);
  let out = "";
  for (const w of state) for (let i = 0; i < 4; i++) out += (w >>> 8 * i & 255).toString(16).padStart(2, "0");
  return out;
}
function signO3(token, startMomentMs) {
  const head = new TextEncoder().encode(
    `token=${token}&sign2_method=sign_o3&instance=0&start_moment=${startMomentMs}`
  );
  const msg = new Uint8Array(head.length + SALT.length);
  msg.set(head, 0);
  msg.set(SALT, head.length);
  return digestHex(msg);
}

// src/liveSign.js
var MAX_CONTEXT_CHARS = 4096;
var TOKEN = /token=([0-9A-Fa-f]{32})/;
var HEX32 = /^[0-9A-Fa-f]{32}$/;
var URL_AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;
function tokenOf(authBase) {
  const m = TOKEN.exec(typeof authBase === "string" ? authBase : "");
  return m ? m[1] : "";
}
var normalize = (authority) => String(authority).toLowerCase().replace(/:80$/, "");
function authorityOf(url) {
  const m = URL_AUTHORITY.exec(typeof url === "string" ? url : "");
  if (!m) return "";
  const at = m[1].lastIndexOf("@");
  return normalize(at >= 0 ? m[1].slice(at + 1) : m[1]);
}
function buildSignContext(license, cdns) {
  const encode2 = (list, withToken) => JSON.stringify({
    l: license,
    c: list.map((d) => withToken ? { h: d.cflHost, a: d.authBase, t: tokenOf(d.authBase) } : { h: d.cflHost, a: d.authBase })
  });
  const full = encode2(cdns, true);
  if (full.length <= MAX_CONTEXT_CHARS) return { context: full, kept: cdns };
  for (let n = cdns.length; n >= 1; n--) {
    const kept = cdns.slice(0, n);
    const context = encode2(kept, false);
    if (context.length <= MAX_CONTEXT_CHARS) return { context, kept };
  }
  return null;
}
var signError = (why, message) => Object.assign(new Error(message), { why });
function readContext(context) {
  let ctx;
  try {
    ctx = JSON.parse(context);
  } catch (_) {
    ctx = null;
  }
  const ok = ctx && typeof ctx === "object" && typeof ctx.l === "string" && Array.isArray(ctx.c) && ctx.c.length > 0 && ctx.c.every((d) => d && typeof d.h === "string" && typeof d.a === "string");
  if (!ok) throw signError("context", "live signContext is not readable");
  return ctx;
}
function signRequest({ url, context }, nowMs) {
  const ctx = readContext(context);
  const want = authorityOf(url);
  const cdn = ctx.c.find((d) => normalize(d.h) === want) || ctx.c[0];
  const token = typeof cdn.t === "string" && HEX32.test(cdn.t) ? cdn.t : tokenOf(cdn.a);
  if (token === "") throw signError("no_token", "live CDN entry without a token");
  const moment = Math.trunc(nowMs);
  return {
    headers: {
      "Content-Auth": `${cdn.a}&sign2_method=sign_o3&instance=0&start_moment=${moment}&sign2=${signO3(token, moment)}`,
      "Content-License": ctx.l,
      "User-Agent": LIVE_USER_AGENT,
      App: LIVE_APP,
      "App-Version": LIVE_APP_VERSION,
      "X-Buffer": LIVE_X_BUFFER
    }
  };
}

// src/liveRotation.js
var MAX_ROTATIONS = 3;
var ROTATION_TTL_MS = 30 * 6e4;
var MAX_CARRIED_REFUSALS = 16;
var MAX_CHANNELS = 12;
var PREFIX2 = "liveRot:";
var CARRIED_KEY = "liveRotCarried";
var empty = (now) => ({ tried: [], excluded: [], active: null, last: null, at: now, started: now, exhausted: false });
var strings = (a) => Array.isArray(a) ? a.filter((s) => typeof s === "string") : [];
function makeLiveRotation({ kino: kino2, clock: clock2, random, maxRotations = MAX_ROTATIONS, ttlMs = ROTATION_TTL_MS }) {
  const memory = /* @__PURE__ */ new Map();
  let carriedMemory;
  const keyOf = (channel) => PREFIX2 + channel;
  const inWindow = (since) => {
    const age = clock2.now() - since;
    return age >= 0 && age < ttlMs;
  };
  const fresh = (state) => Boolean(state) && inWindow(state.started);
  const ttlLeft = (since) => Math.max(1, ttlMs - Math.max(0, clock2.now() - since));
  const digest = (key) => {
    try {
      const d = kino2.crypto.hash("md5", String(key));
      return typeof d === "string" && d !== "" ? d.slice(0, 16) : null;
    } catch (_) {
      return null;
    }
  };
  function parse(raw) {
    try {
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || !Array.isArray(o.t)) return null;
      const at = typeof o.at === "number" ? o.at : 0;
      return {
        tried: strings(o.t),
        excluded: strings(o.x),
        active: typeof o.a === "string" ? o.a : null,
        last: typeof o.k === "string" ? o.k : null,
        at,
        started: typeof o.s === "number" ? o.s : at,
        // an older entry has no start: its last write
        exhausted: o.e === true
      };
    } catch (_) {
      return null;
    }
  }
  function read(channel) {
    const mem = memory.get(channel);
    if (mem) {
      if (fresh(mem)) return mem;
      memory.delete(channel);
    }
    let raw = null;
    try {
      raw = kino2.storage.get(keyOf(channel));
    } catch (_) {
    }
    const stored = typeof raw === "string" ? parse(raw) : null;
    if (!fresh(stored)) return null;
    remember(channel, stored);
    return stored;
  }
  function remember(channel, state) {
    memory.delete(channel);
    memory.set(channel, state);
    while (memory.size > MAX_CHANNELS) memory.delete(memory.keys().next().value);
  }
  function evictFor(channel) {
    try {
      const own = keyOf(channel);
      const keys = kino2.storage.keys().filter((k) => k.startsWith(PREFIX2) && k !== own);
      if (keys.length < MAX_CHANNELS) return;
      const aged = keys.map((k) => {
        let at = 0;
        try {
          at = parse(kino2.storage.get(k))?.at ?? 0;
        } catch (_) {
        }
        return { k, at };
      }).sort((x, y) => x.at - y.at);
      for (const { k } of aged.slice(0, keys.length - MAX_CHANNELS + 1)) kino2.storage.remove(k);
    } catch (_) {
    }
  }
  function write(channel, state) {
    state.at = clock2.now();
    remember(channel, state);
    try {
      let exists = false;
      try {
        exists = kino2.storage.get(keyOf(channel)) !== null;
      } catch (_) {
      }
      if (!exists) evictFor(channel);
      const o = { t: state.tried, a: state.active, k: state.last, at: state.at, s: state.started };
      if (state.excluded.length > 0) o.x = state.excluded;
      if (state.exhausted) o.e = true;
      kino2.storage.set(keyOf(channel), JSON.stringify(o), { ttlMs: ttlLeft(state.started) });
    } catch (_) {
    }
  }
  function carried() {
    if (carriedMemory === void 0) {
      carriedMemory = null;
      try {
        const raw = kino2.storage.get(CARRIED_KEY);
        const o = typeof raw === "string" ? JSON.parse(raw) : null;
        if (o && typeof o.a === "string" && typeof o.at === "number") carriedMemory = { sn: o.a, at: o.at, refused: strings(o.r) };
      } catch (_) {
      }
    }
    return carriedMemory && inWindow(carriedMemory.at) ? carriedMemory : null;
  }
  function setCarried(value) {
    carriedMemory = value;
    try {
      if (value === null) kino2.storage.remove(CARRIED_KEY);
      else kino2.storage.set(CARRIED_KEY, JSON.stringify({ a: value.sn, at: value.at, r: value.refused }), { ttlMs: ttlLeft(value.at) });
    } catch (_) {
    }
  }
  function activeSn(channel) {
    const state = read(channel);
    if (state) return state.active;
    return carried()?.sn ?? null;
  }
  const triedCount = (channel) => read(channel)?.tried.length ?? 0;
  function refuse(channel, currentSn, pool, refusedKey) {
    let state = read(channel);
    if (!state) {
      state = empty(clock2.now());
      const c2 = carried();
      if (c2) {
        state.active = c2.sn;
        state.excluded = c2.refused.slice();
      }
    }
    if (state.exhausted) return "already_exhausted";
    const key = digest(refusedKey);
    if (key !== null && state.last === key) return "repeated";
    state.last = key;
    const refused = state.active ?? currentSn;
    if (!state.tried.includes(refused)) state.tried.push(refused);
    const rotationsSoFar = state.tried.length - 1;
    let next = null;
    if (rotationsSoFar < maxRotations) {
      const candidates = (Array.isArray(pool) ? pool : []).filter((e) => e && !isBlank(e.sn) && !state.tried.includes(e.sn) && !state.excluded.includes(e.sn));
      if (candidates.length > 0) next = candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))].sn;
    }
    state.active = next;
    const c = carried();
    let outcome;
    if (next !== null) {
      const refusedSns = c ? c.refused.slice() : [];
      if (!refusedSns.includes(refused)) refusedSns.push(refused);
      setCarried({ sn: next, at: clock2.now(), refused: refusedSns.slice(-MAX_CARRIED_REFUSALS) });
      outcome = "rotated";
    } else {
      state.exhausted = true;
      if (c && state.tried.includes(c.sn)) setCarried(null);
      outcome = "exhausted";
    }
    write(channel, state);
    return outcome;
  }
  function onRefused(channel, currentSn, pool, refusedKey) {
    const outcome = refuse(channel, currentSn, pool, refusedKey);
    if (outcome === "rotated") return true;
    if (outcome === "repeated") return activeSn(channel) !== null;
    return false;
  }
  return { activeSn, triedCount, refuse, onRefused };
}

// src/live.js
var OUTCOME_WORDS = { already_exhausted: "spent" };
var DEFAULT_TTL_S = 300;
var MIN_EXPIRES_S = 30;
var MAX_EXPIRES_S = 86400;
var MAX_ALTERNATE_HOSTS = 6;
var ACCOUNT_SENTENCES = /* @__PURE__ */ new Set([ACCOUNT_SESSION_LOST, ACCOUNT_IN_USE_ELSEWHERE_TEXT]);
var NOT_LOGGED_IN = "aaa100028";
var INT8 = /^[+-]?\d+$/;
var ALTERNATE_HOST = /^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/;
var SERVED_MEMORY = 64;
var SLB_RESERVE_MS = 3e3;
var TEXT = {
  noAccount: "Este canal necesita una cuenta de Xuper (para pel\xEDculas y series no hace falta). Vinc\xFAlala en Ajustes \u25B8 Xuper.",
  noAddresses: "No se pudo abrir el canal: Xuper no dio la direcci\xF3n de la se\xF1al",
  // live_no_addresses
  noCdn: "No se pudo abrir el canal: Xuper no dio un servidor de vivo",
  // live_no_cfl_cdn
  noLicense: "No se pudo abrir el canal: Xuper no dio la licencia de la se\xF1al",
  // live_no_license
  noToken: "No se pudo abrir el canal: el servidor de vivo no trae su token",
  // live_no_cfl_token
  badHost: "No se pudo abrir el canal: Xuper dio una direcci\xF3n de servidor de vivo que no es v\xE1lida",
  tooLong: "No se pudo abrir el canal: los datos de la se\xF1al son demasiado largos",
  unknownChannel: "No se encontr\xF3 ese canal en Xuper",
  generic: "Xuper no est\xE1 disponible ahora"
};
function bareHost(mainAddr) {
  let s = typeof mainAddr === "string" ? mainAddr : "";
  if (s.startsWith("https://")) s = s.slice(8);
  if (s.startsWith("http://")) s = s.slice(7);
  const slash = s.indexOf("/");
  return slash >= 0 ? s.slice(0, slash) : s;
}
function signalFrom(play) {
  let firstLicense = null;
  for (const a of objects(isObject(play) ? play.liveAddressList : null)) {
    const license = optStringStrict(a.license);
    const playCode = optStringStrict(a.playCode);
    if (firstLicense === null) firstLicense = license;
    if (notBlank(playCode) && notBlank(license)) return { playCode, license };
  }
  return firstLicense === null ? null : { playCode: "", license: firstLicense };
}
function liveCdns(slb) {
  const out = [];
  for (const cdn of objects(isObject(slb) ? slb.cdn_list : null)) {
    if (optStringStrict(cdn.tag) !== "live") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optStringStrict(u.url);
      if (!isCfl(url) && optStringStrict(u.sign_type) !== "cfl") continue;
      const host = bareHost(optStringStrict(cdn.main_addr));
      if (notBlank(host)) out.push({ cflHost: host, authBase: url });
    }
  }
  return out;
}
function expiresOf(slb) {
  const text2 = optStringStrict(isObject(slb) ? slb.invalidTime : "");
  const n = INT8.test(text2) ? Number(text2) : NaN;
  const ttl = n > 0 ? n : DEFAULT_TTL_S;
  return Math.min(MAX_EXPIRES_S, Math.max(MIN_EXPIRES_S, ttl));
}
function makeLive({ kino: kino2, portal, session, clock: clock2, config, random }) {
  const rand = random || (() => parseInt(kino2.crypto.randomBytes(4, "hex"), 16) / 4294967296);
  const rotation = makeLiveRotation({ kino: kino2, clock: clock2, random: rand });
  const served = /* @__PURE__ */ new Map();
  const unavailable = (text2) => kino2.error("unavailable", text2);
  const bad = (why, text2) => {
    trace(kino2, "live", "bad", { why });
    return unavailable(text2);
  };
  const channelNotFound = (e) => e.code === "not_found" ? kino2.error("not_found", TEXT.unknownChannel) : e;
  const surface = (e) => {
    if (e instanceof PortalError) return channelNotFound(mapPortalError(e.code, e.message, kino2));
    if (isKinoError(e)) return channelNotFound(e);
    return unavailable(TEXT.generic);
  };
  function noteServed(code, license) {
    served.delete(code);
    served.set(code, license);
    while (served.size > SERVED_MEMORY) served.delete(served.keys().next().value);
  }
  async function open(code, seed, deadline) {
    let lastCode = null;
    let call;
    if (seed) {
      call = (path, bean, by) => portal.call(path, bean, { baseFields: true, userId: seed.userId, userToken: seed.userToken, sn: seed.sn, deadline: by });
    } else {
      await session.ensure({ deadline: deadline - SLB_RESERVE_MS });
      call = (path, bean, by) => session.withValidSession(async ({ userId, userToken }) => {
        try {
          return await portal.call(path, bean, { baseFields: true, userId, userToken, deadline: by });
        } catch (e) {
          lastCode = e instanceof PortalError ? e.code : null;
          throw e;
        }
      }, { deadline: by });
    }
    let play;
    try {
      play = await call("v4/startPlayLive", { channelCode: code, columnId: 0, type: "1" }, deadline - SLB_RESERVE_MS);
    } catch (e) {
      trace(kino2, "live", "open_fail", { step: "play", code: lastCode ?? errCode(e), seed: !!seed });
      const notLoggedIn = e instanceof PortalError && e.code === NOT_LOGGED_IN || isKinoError(e) && e.code === "auth_required" && lastCode === NOT_LOGGED_IN;
      if (notLoggedIn && !(isKinoError(e) && ACCOUNT_SENTENCES.has(e.userMessage))) {
        throw kino2.error("auth_required", "el canal necesita una cuenta (aaa100028)", { userMessage: TEXT.noAccount });
      }
      throw e;
    }
    const signal = signalFrom(play);
    if (!signal) throw bad("no_address", TEXT.noAddresses);
    lastCode = null;
    let slb;
    try {
      slb = await call("v14/getSlbInfo", slbBean(config.apkVersion, [code]), deadline);
    } catch (e) {
      trace(kino2, "live", "open_fail", { step: "slb", code: lastCode ?? errCode(e), seed: !!seed });
      throw e;
    }
    const all = liveCdns(slb);
    if (all.length === 0) throw bad("no_cdn", TEXT.noCdn);
    if (!notBlank(signal.license)) throw bad("no_license", TEXT.noLicense);
    const withToken = all.filter((d) => tokenOf(d.authBase) !== "");
    if (withToken.length === 0) throw bad("no_token", TEXT.noToken);
    const cdns = withToken.filter((d) => ALTERNATE_HOST.test(d.cflHost));
    if (cdns.length === 0) throw bad("bad_cdn", TEXT.badHost);
    const built = buildSignContext(signal.license, cdns);
    if (!built) throw bad("too_long", TEXT.tooLong);
    if (built.kept.length < cdns.length) trace(kino2, "live", "cdn_cut", { kept: built.kept.length, of: cdns.length });
    const primary = built.kept[0].cflHost;
    const alternates = [];
    for (const d of built.kept.slice(1)) {
      if (d.cflHost.toLowerCase() === primary.toLowerCase() || alternates.some((h) => h.toLowerCase() === d.cflHost.toLowerCase())) continue;
      if (alternates.length < MAX_ALTERNATE_HOSTS) alternates.push(d.cflHost);
    }
    const playCode = notBlank(signal.playCode) ? signal.playCode : code;
    noteServed(code, signal.license);
    return {
      url: `http://${primary}/live/${playCode}.m3u8`,
      mime: "application/x-mpegurl",
      signing: "request",
      signContext: built.context,
      alternateHosts: alternates,
      expiresInSeconds: expiresOf(slb)
    };
  }
  const sessOf = () => {
    try {
      return typeof session.mode === "function" ? session.mode() : "?";
    } catch (_) {
      return "?";
    }
  };
  const seedBySn = (sn) => sn === null ? null : session.seedPool().find((e) => e.sn === sn) || null;
  function onConflict(code, attempt) {
    const kind = session.kind();
    if (kind !== "seed") {
      trace(kino2, "live", "conflict", { sess: sessOf(), outcome: "no_rotation" });
      return;
    }
    const current = rotation.activeSn(code) ?? session.current().sn;
    const refusedKey = served.has(code) ? served.get(code) : `retry:${attempt}`;
    const outcome = rotation.refuse(code, current, session.seedPool(), refusedKey);
    trace(kino2, "live", "conflict", { sess: sessOf(), outcome: OUTCOME_WORDS[outcome] ?? outcome, tried: rotation.triedCount(code), of: MAX_ROTATIONS + 1 });
  }
  async function openWithRotation(code, deadline) {
    let seed = session.kind() === "seed" ? seedBySn(rotation.activeSn(code)) : null;
    if (!seed) return open(code, null, deadline);
    for (let i = 0; i < MAX_ROTATIONS + 1; i++) {
      try {
        return await open(code, seed, deadline);
      } catch (e) {
        trace(kino2, "live", "seed_fail", { seed: seedTag(kino2, seed.sn), code: errCode(e) });
        const moved = rotation.refuse(code, seed.sn, session.seedPool(), `resolve:${seed.sn}`) === "rotated";
        const next = seedBySn(rotation.activeSn(code));
        if (!next || !moved) return open(code, null, deadline);
        seed = next;
      }
    }
    return open(code, null, deadline);
  }
  async function resolveLive(code, options) {
    await null;
    const deadline = callDeadline(clock2, CALL_BUDGET_MS.resolve);
    try {
      const retry = isObject(options) && isObject(options.retry) ? options.retry : null;
      if (retry) trace(kino2, "live", "retry", { reason: typeof retry.reason === "string" ? retry.reason : "?", attempt: retry.attempt, status: Number.isInteger(retry.status) ? retry.status : void 0 });
      if (retry && retry.reason === "conflict") onConflict(code, retry.attempt);
      return await openWithRotation(code, deadline);
    } catch (e) {
      throw surface(e);
    }
  }
  return { resolveLive };
}

// src/section.js
var TABS = [
  { id: "peliculas", label: "Pel\xEDculas" },
  { id: "series", label: "Series" },
  { id: "infantil", label: "Infantil" },
  { id: "anime", label: "Anime" }
];
var rowsOfTab = (rows, tab, nowMs) => projectRows(rows.filter((r) => rootOfRow(r.id) === tab), nowMs);
function makeSection({ kino: kino2, catalog, clock: clock2 }) {
  async function section2(arg) {
    const asked = arg !== null && typeof arg === "object" ? arg.tab : null;
    const tab = asked === null || asked === void 0 || asked === "" ? TABS[0].id : asked;
    if (!TABS.some((t) => t.id === tab)) throw kino2.error("not_found", "No se encontr\xF3 esa pesta\xF1a");
    const rows = await catalog.rows(CALL_BUDGET_MS.section);
    return { tabs: TABS.map((t) => ({ ...t })), tab, rows: rowsOfTab(rows, tab, clock2.now()) };
  }
  return { section: section2 };
}

// src/categories.js
var MAX_CATEGORIES2 = 24;
var MAX_TITLE = 40;
function tilesOf(rows) {
  const out = [];
  for (const r of rows) {
    if (out.length >= MAX_CATEGORIES2) break;
    if (r.shown.length === 0) continue;
    const first = r.shown[0];
    const art = first.backdrop && first.backdrop.trim() || first.poster && first.poster.trim() || null;
    const tile = { id: r.id, title: r.title.slice(0, MAX_TITLE), ref: r.id };
    if (art) tile.art = art;
    out.push(tile);
  }
  return out;
}
var ADULT_TILE = Object.freeze({ id: ADULT_REF, title: "18+", ref: ADULT_REF, adult: true });
function makeCategories({ catalog }) {
  return {
    // An empty catalog stays empty: an 18+ tile alone would be the only thing Xuper offers.
    categories: async () => {
      const tiles = tilesOf(await catalog.rows(CALL_BUDGET_MS.categories));
      return tiles.length === 0 ? [] : [...tiles.slice(0, MAX_CATEGORIES2 - 1), { ...ADULT_TILE }];
    }
  };
}

// src/countryRow.js
var CATEGORIES_BY_COUNTRY = Object.freeze({
  CO: "Colombia",
  VE: "Venezuela",
  EC: "Ecuador",
  CL: "Chile",
  MX: "M\xE9xico",
  PE: "Per\xFA",
  BO: "Bolivia",
  UY: "Uruguay",
  PY: "Paraguay",
  PA: "Panam\xE1",
  PR: "Puerto Rico",
  ES: "Espa\xF1a",
  CR: "Costa Rica",
  US: "Estados Unidos",
  HN: "Honduras",
  SV: "El Salvador",
  DO: "Rep\xFAblica Dominicana",
  GT: "Centroam\xE9rica",
  NI: "Centroam\xE9rica",
  BZ: "Centroam\xE9rica"
});
var COUNTRY_OPTIONS = Object.freeze([
  { value: "none", label: "Ninguno" },
  { value: "BO", label: "Bolivia" },
  { value: "CL", label: "Chile" },
  { value: "CO", label: "Colombia" },
  { value: "CR", label: "Costa Rica" },
  { value: "EC", label: "Ecuador" },
  { value: "SV", label: "El Salvador" },
  { value: "ES", label: "Espa\xF1a" },
  { value: "US", label: "Estados Unidos" },
  { value: "GT-NI-BZ", label: "Guatemala, Nicaragua o Belice" },
  { value: "HN", label: "Honduras" },
  { value: "MX", label: "M\xE9xico" },
  { value: "PA", label: "Panam\xE1" },
  { value: "PY", label: "Paraguay" },
  { value: "PE", label: "Per\xFA" },
  { value: "PR", label: "Puerto Rico" },
  { value: "DO", label: "Rep\xFAblica Dominicana" },
  { value: "UY", label: "Uruguay" },
  { value: "VE", label: "Venezuela" }
]);
var OPTION_GROUPS = Object.freeze({ "GT-NI-BZ": Object.freeze(["GT", "NI", "BZ"]) });
function countriesOf(value) {
  if (typeof value !== "string") return [];
  if (Object.hasOwn(OPTION_GROUPS, value)) return [...OPTION_GROUPS[value]];
  return Object.hasOwn(CATEGORIES_BY_COUNTRY, value) ? [value] : [];
}
var HOME_COUNTRY_SETTING = "homeCountry";
var COUNTRY_ROW_ID = "live-country";
var COUNTRY_ROW_TITLE = "Canales en vivo";
var COUNTRY_ROW_LIMIT = 20;
function makeCountryRow({ kino: kino2, live: live2 }) {
  return async function countryRow(deadline) {
    try {
      const names = [...new Set(countriesOf(kino2.config.get(HOME_COUNTRY_SETTING)).map((cc) => CATEGORIES_BY_COUNTRY[cc]))];
      if (names.length === 0) return null;
      const all = await live2.categoriesWithin(deadline);
      const categories2 = names.map((n) => all.find((c) => c.name === n)).filter(Boolean);
      const channels = [];
      const seen = /* @__PURE__ */ new Set();
      for (const category of categories2) {
        if (channels.length >= COUNTRY_ROW_LIMIT) break;
        for (const c of await live2.channelsWithin(category.id, deadline)) if (!seen.has(c.id) && seen.add(c.id)) channels.push(c);
      }
      const items = channels.slice(0, COUNTRY_ROW_LIMIT).map((c) => {
        const item = { kind: "live", id: c.id, title: c.title, ref: c.ref };
        if (c.logo) item.poster = c.logo;
        if (c.adult === true) item.adult = true;
        return item;
      });
      return items.length > 0 ? { id: COUNTRY_ROW_ID, title: COUNTRY_ROW_TITLE, items } : null;
    } catch (e) {
      trace(kino2, "home", "live_row_fail", { code: errCode(e) });
      return null;
    }
  };
}

// src/wiring.js
var deps = null;
var clock = { now: () => Date.now() };
function getDeps() {
  if (deps) return deps;
  const crypto = makeCrypto(kino);
  const config = { hosts, appId: APP_ID, apkVersion: APK_VERSION };
  let session = null;
  const portal = makePortal({ kino, crypto, config, clock, snProvider: () => session.current().sn, modeOf: () => session.mode() });
  session = makeSession({ kino, portal, clock, shared: { email: SHARED_EMAIL, password: SHARED_PASSWORD } });
  const tmdb = makeTmdb({ kino, clock });
  const live2 = makeLiveCatalog({ kino, portal, session, clock });
  const catalog = makeCatalog({ kino, portal, session, clock, tmdb, countryRow: makeCountryRow({ kino, live: live2 }) });
  const liveStream = makeLive({ kino, portal, session, clock, config });
  const resolve2 = makeResolve({ kino, portal, session, clock, config, portalChapters: catalog.portalChapters, live: liveStream });
  const section2 = makeSection({ kino, catalog, clock });
  const categories2 = makeCategories({ catalog });
  deps = { clock, crypto, portal, session, tmdb, catalog, resolve: resolve2, live: live2, liveStream, section: section2, categories: categories2 };
  return deps;
}
async function guarded(body) {
  try {
    return await body(getDeps());
  } catch (e) {
    if (isKinoError(e)) throw e;
    trace(kino, "call", "bug", { code: errCode(e) });
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}

// src/migrate.js
var LIVE_PROVIDERS = /* @__PURE__ */ new Set(["xuper", "legacy"]);
var ITEM_ID3 = /^[A-Za-z0-9._~-]{1,128}$/;
var MAX_NUMBER = 99999;
var MAX_SEASON = 999;
var whole = (v, max) => Number.isInteger(v) && v >= 1 && v <= max ? v : null;
function ownRef(ref) {
  if (typeof ref !== "string" || ref.startsWith("plg1:")) return null;
  return decode(ref);
}
function title(input) {
  const magis = ownRef(input.ref);
  if (!magis || !ITEM_ID3.test(magis.contentId)) return null;
  return {
    kind: magis.isSeries ? "series" : "movie",
    id: magis.contentId,
    ref: encode({ contentId: magis.contentId, programType: magis.programType, episode: 0 })
  };
}
function chapter(input) {
  const magis = ownRef(input.ref);
  if (!magis || !ITEM_ID3.test(magis.contentId)) return null;
  const number = whole(magis.episode, MAX_NUMBER) ?? whole(input.episode, MAX_NUMBER) ?? 1;
  const out = { kind: "episode", ref: encodeChapter(number, magis.contentId), number };
  const season = whole(input.season, MAX_SEASON);
  if (season !== null) out.season = season;
  return out;
}
function live(input) {
  if (!LIVE_PROVIDERS.has(input.provider)) return null;
  return typeof input.code === "string" && ITEM_ID3.test(input.code) ? { kind: "live", code: input.code } : null;
}
function makeMigrate() {
  async function migrate2(input) {
    await null;
    try {
      if (!isObject(input)) return null;
      if (input.kind === "title") return title(input);
      if (input.kind === "chapter") return chapter(input);
      if (input.kind === "live") return live(input);
      return null;
    } catch (_) {
      return null;
    }
  }
  return { migrate: migrate2 };
}

// src/settings.js
var STATUS_MAX = 200;
var MESSAGE_MAX = 300;
var VALIDATE_REQUEST_MS = 12e3;
var VALIDATE_TOTAL_MS = 17e3;
var LOGIN_REQUEST_MS = 12e3;
var LOGIN_TOTAL_MS = 25e3;
var SEED_PROBE_MS = 5e3;
var SEED_SWITCH_TOTAL_MS = 22e3;
var SEED_DOWNLOAD_MS = 1e4;
var SEND_CODE_REQUEST_MS = 1e4;
var SEND_CODE_TOTAL_MS = 25e3;
var RESEND_WAIT_MS = 6e4;
var REGISTER_REQUEST_MS = 1e4;
var REGISTER_TOTAL_MS = 25e3;
var LOGOUT_REQUEST_MS = 1e4;
var LOGOUT_TOTAL_MS = 25e3;
var SEEDS_BANNER = "Por ahora no hay sesiones disponibles para tu zona; vuelve a intentar en un rato o toca Actualizar semillas";
var str4 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var clip = (text2, max) => text2.length <= max ? text2 : text2.slice(0, max - 1) + "\u2026";
var refusedCredentials = (e) => e !== null && typeof e === "object" && (e.name === "KinoError_auth_required" || e.name === "PortalError");
var FILL_ACCOUNT = `Faltan los datos de tu cuenta: compl\xE9talos en ${SETTINGS_PLACE}.`;
var ACCOUNT_REFUSED = `Xuper no acept\xF3 esa cuenta. Revisa los datos en ${SETTINGS_PLACE}.`;
var FILL_EMAIL = `Escribe tu correo en ${SETTINGS_PLACE}.`;
var BAD_EMAIL = `Escribe un correo v\xE1lido en ${SETTINGS_PLACE}.`;
var FILL_CODE = `Escribe el c\xF3digo que te enviamos en ${SETTINGS_PLACE}.`;
var ASK_CODE_AGAIN = "Pide el c\xF3digo otra vez.";
var ACCOUNT_CREATED_LOG_IN = "Cuenta creada. Toca Iniciar sesi\xF3n para entrar.";
function makeSettings({ kino: kino2, session, clock: clock2, registration }) {
  const surface = (e) => {
    if (isKinoError(e)) return e;
    trace(kino2, "settings", "fail", { code: errCode(e) });
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  const savedAccount = () => ({ email: str4(kino2.config.get("email")).trim(), password: str4(kino2.config.get("password")).trim() });
  async function settingsStatus2() {
    await null;
    try {
      const account = session.kind() === "account";
      const state = session.accountState();
      const shared = session.sharedConfigured();
      const anonymous = state === "pending" ? `Conectando con ${shared ? "la cuenta compartida" : "tu cuenta"}\u2026 Mientras tanto, sesi\xF3n an\xF3nima` : state === "refused" ? shared ? "La cuenta compartida ya no funciona: sesi\xF3n an\xF3nima" : "No se pudo iniciar sesi\xF3n con tu cuenta: sesi\xF3n an\xF3nima. Revisa tu correo y contrase\xF1a" : "Sin cuenta: sesi\xF3n an\xF3nima";
      const who = session.usingShared() ? "Cuenta compartida" : `Conectado como ${savedAccount().email}`;
      const parts = [account ? who : anonymous];
      if (!account && session.regionBlocked()) {
        const n = session.seedPool().length;
        parts.push(n > 0 ? `Zona bloqueada: ${n} semillas cargadas` : "Zona bloqueada: sin semillas cargadas");
        if (session.seedsExhausted()) parts.push(SEEDS_BANNER);
        else if (kino2.config.get("autoRefreshSeeds") === false) parts.push("Actualizaci\xF3n autom\xE1tica desactivada");
      }
      const text2 = parts.length === 1 ? parts[0] : parts.join(". ") + ".";
      return { status: clip(text2, STATUS_MAX) };
    } catch (_) {
      return { status: "No se pudo consultar el estado" };
    }
  }
  async function login() {
    const { email, password } = savedAccount();
    if (email === "" || password === "") throw told(kino2, "auth_required", "Escribe tu correo y contrase\xF1a en Ajustes", FILL_ACCOUNT);
    const bounds = { timeoutMs: LOGIN_REQUEST_MS, deadline: clock2.now() + LOGIN_TOTAL_MS };
    try {
      await session.login(email, password, bounds);
    } catch (e) {
      throw refusedCredentials(e) ? told(kino2, "auth_required", "Credenciales de Xuper inv\xE1lidas", ACCOUNT_REFUSED) : surface(e);
    }
    return { message: "Sesi\xF3n iniciada", refresh: true };
  }
  async function logout() {
    try {
      await session.logout({ timeoutMs: LOGOUT_REQUEST_MS, deadline: clock2.now() + LOGOUT_TOTAL_MS });
    } catch (e) {
      throw surface(e);
    }
    return { message: "Sesi\xF3n cerrada", refresh: true, clearSettings: ["email", "password", "useSharedAccount"] };
  }
  async function switchSeed() {
    let r;
    try {
      r = await session.switchSeed({ timeoutMs: SEED_PROBE_MS, deadline: clock2.now() + SEED_SWITCH_TOTAL_MS });
    } catch (e) {
      throw surface(e);
    }
    const message = r.result === "ok" ? `Semilla cambiada (intento ${r.tries})` : r.result === "offline" ? "Sin conexi\xF3n, reintenta" : r.result === "account_linked" ? "Tu cuenta no usa semillas" : r.result === "no_other_seed" ? "No hay otra semilla para probar" : `Prob\xE9 ${r.tries} semillas y ninguna funcion\xF3`;
    return { message, refresh: true };
  }
  async function refreshSeeds() {
    let ok;
    try {
      ok = await session.refreshSeeds({ timeoutMs: SEED_DOWNLOAD_MS, manual: true });
    } catch (e) {
      throw surface(e);
    }
    return { message: ok ? `${session.seedPool().length} semillas cargadas` : "Sin conexi\xF3n, reintenta", refresh: true };
  }
  function typedEmail() {
    const { email } = savedAccount();
    if (email === "") throw told(kino2, "auth_required", "Escribe tu correo en Ajustes", FILL_EMAIL);
    if (!email.includes("@")) throw told(kino2, "auth_required", "Escribe un correo v\xE1lido", BAD_EMAIL);
    return email;
  }
  async function sendCode() {
    const email = typedEmail();
    const prev = registration.pendingFor(email);
    if (prev && prev.at !== null && clock2.now() >= prev.at && clock2.now() - prev.at < RESEND_WAIT_MS) {
      return { message: "Ya te enviamos un c\xF3digo; espera un minuto antes de pedir otro" };
    }
    const bounds = { timeoutMs: SEND_CODE_REQUEST_MS, deadline: clock2.now() + SEND_CODE_TOTAL_MS };
    try {
      await registration.sendRegistrationCode(email, bounds);
    } catch (e) {
      throw surface(e);
    }
    return { message: `Te enviamos un c\xF3digo a ${email}` };
  }
  async function register() {
    const email = typedEmail();
    const code = str4(kino2.config.get("verifyCode")).trim();
    if (code === "") throw told(kino2, "auth_required", "Escribe el c\xF3digo de verificaci\xF3n", FILL_CODE);
    const { password } = savedAccount();
    if (password === "") throw told(kino2, "auth_required", "Escribe tu contrase\xF1a en Ajustes", FILL_ACCOUNT);
    const pending = registration.pendingFor(email);
    if (!pending) throw told(kino2, "unavailable", "Pide el c\xF3digo otra vez", ASK_CODE_AGAIN);
    const bounds = { timeoutMs: REGISTER_REQUEST_MS, deadline: clock2.now() + REGISTER_TOTAL_MS };
    let done;
    try {
      done = await registration.confirmRegistration(pending, code, password, bounds);
    } catch (e) {
      throw surface(e);
    }
    const message = done && done.loggedIn === false ? ACCOUNT_CREATED_LOG_IN : "Cuenta creada y sesi\xF3n iniciada";
    return { message, refresh: true, clearSettings: ["verifyCode"] };
  }
  const ACTIONS = { login, logout, switchSeed, refreshSeeds, ...registration ? { sendCode, register } : {} };
  async function action2(key) {
    await null;
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, key) ? ACTIONS[key] : null;
    if (!run) return null;
    const out = await run();
    return { ...out, message: clip(out.message, MESSAGE_MAX) };
  }
  async function validateSettings2(values) {
    await null;
    const v = values && typeof values === "object" ? values : {};
    const email = str4(v.email).trim(), password = str4(v.password).trim();
    const sharedOn = v.useSharedAccount === true || v.useSharedAccount === "true";
    if (sharedOn && email === "" && password === "") {
      const bounds2 = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock2.now() + VALIDATE_TOTAL_MS };
      try {
        await session.useShared(bounds2);
        return null;
      } catch (e) {
        if (refusedCredentials(e)) return { useSharedAccount: "No se pudo activar la cuenta compartida" };
        throw surface(e);
      }
    }
    if (email === "" && password === "") return null;
    const errors = {};
    if (sharedOn) errors.useSharedAccount = "Quita tu cuenta o apaga la cuenta compartida";
    if (email === "") errors.email = "Escribe tu correo";
    else if (!email.includes("@")) errors.email = "Escribe un correo v\xE1lido";
    if (Object.keys(errors).length > 0) return errors;
    if (password === "") return null;
    const bounds = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock2.now() + VALIDATE_TOTAL_MS };
    try {
      await session.login(email, password, bounds);
      return null;
    } catch (e) {
      if (refusedCredentials(e)) {
        const creating = str4(v.verifyCode).trim() !== "" || registration !== void 0 && registration !== null && registration.pendingFor(email) !== null;
        return creating ? null : { password: "Credenciales de Xuper inv\xE1lidas" };
      }
      throw surface(e);
    }
  }
  return { settingsStatus: settingsStatus2, action: action2, validateSettings: validateSettings2 };
}

// src/registration.js
var PENDING_KEY = "pendingRegistration";
var PENDING_TTL_MS = 30 * 6e4;
var SEND_FAILED = "No se pudo enviar el c\xF3digo: revisa el email";
var SEND_FAILED_TEXT = `Xuper no pudo enviar el c\xF3digo a ese correo. Revisa que est\xE9 bien escrito en ${SETTINGS_PLACE}.`;
var NOT_SAVED = "No se pudo guardar el pedido; int\xE9ntalo de nuevo";
var NOT_SAVED_TEXT = "No pudimos guardar tu pedido. Vuelve a tocar Crear cuenta.";
var CONFIRM_FAILED = "C\xF3digo inv\xE1lido o cuenta ya registrada";
var CONFIRM_FAILED_TEXT = "Xuper no acept\xF3 el c\xF3digo, o ese correo ya tiene cuenta. Pide otro c\xF3digo o toca Iniciar sesi\xF3n.";
var str5 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
function makeRegistration({ kino: kino2, portal, session, clock: clock2 }) {
  const fingerprint = makeFingerprint(kino2);
  const failure = (e, text2, sentence) => {
    trace(kino2, "register", "fail", { code: errCode(e) });
    if (e instanceof PortalError) return told(kino2, "unavailable", text2, sentence);
    if (e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_")) return e;
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  function pendingFor(email) {
    try {
      const raw = kino2.storage.get(PENDING_KEY);
      const o = raw === null || raw === void 0 ? null : JSON.parse(raw);
      if (!o || typeof o !== "object" || blank(o.userToken) || blank(o.sn) || str5(o.email) !== email) return null;
      return { userId: str5(o.userId), userToken: str5(o.userToken), sn: str5(o.sn), email: str5(o.email), at: typeof o.at === "number" ? o.at : null };
    } catch (_) {
      return null;
    }
  }
  const savePending = (p) => {
    try {
      kino2.storage.set(PENDING_KEY, JSON.stringify(p), { ttlMs: PENDING_TTL_MS });
      return true;
    } catch (_) {
      return false;
    }
  };
  const dropPending = () => {
    try {
      kino2.storage.remove(PENDING_KEY);
    } catch (_) {
    }
  };
  async function sendRegistrationCode(email, bounds = {}) {
    await null;
    try {
      const mint = await portal.call("v3/snToken", fingerprint(), { baseFields: false, ...bounds });
      if (blank(mint && mint.snToken)) throw new PortalError("snToken_failed", "el portal no devolvi\xF3 snToken");
      const snToken = str5(mint.snToken);
      const sn = snFrom(kino2, mint, snToken);
      const act = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
      if (blank(act && act.userToken)) throw new PortalError("active_sin_token", "activaci\xF3n sin userToken");
      const pending = { userId: str5(act.userId), userToken: str5(act.userToken), sn, email, at: clock2.now() };
      await portal.call(
        "v2/sendEmailVerifyCode",
        { email, type: "1", userId: pending.userId, userToken: pending.userToken },
        { baseFields: false, sn, ...bounds }
      );
      if (!savePending(pending)) throw told(kino2, "unavailable", NOT_SAVED, NOT_SAVED_TEXT);
      return pending;
    } catch (e) {
      throw failure(e, SEND_FAILED, SEND_FAILED_TEXT);
    }
  }
  async function confirmRegistration(pending, code, password, bounds = {}) {
    await null;
    const { email, userId, userToken, sn } = pending;
    const pwd = kino2.crypto.hash("md5", password + PASSWORD_SALT);
    const opts = { baseFields: false, sn, ...bounds };
    let bound = false;
    try {
      await portal.call("v2/validateVerifyCode", { type: "1", email, verifyCode: code, userToken, userId }, opts);
      await portal.call("v2/bindEmail", { email, pwd, type: "1", userId, userToken }, opts);
      bound = true;
      const j = await portal.call("v8/login", {
        accountType: "2",
        userName: email,
        password: pwd,
        type: "1",
        macAddr: FIXED_MAC,
        areaCode: "",
        verificationCode: "",
        verificationToken: "",
        matadata: "",
        signdata: "",
        channel: "default"
      }, opts);
      if (blank(j && j.userToken)) throw new PortalError("login_sin_token", "login sin userToken");
      await session.adoptSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn, acct: session.accountKey(email, password) });
    } catch (e) {
      if (bound) {
        trace(kino2, "register", "bound_not_in", { code: errCode(e) });
        dropPending();
        return { loggedIn: false };
      }
      throw failure(e, CONFIRM_FAILED, CONFIRM_FAILED_TEXT);
    }
    dropPending();
    return { loggedIn: true };
  }
  return { sendRegistrationCode, confirmRegistration, pendingFor };
}

// src/plugin.js
async function search(query) {
  await null;
  return traced(kino, clock, "search", () => guarded(({ catalog }) => catalog.search(query)));
}
async function home() {
  await null;
  return traced(kino, clock, "home", () => guarded(({ catalog }) => catalog.home()));
}
async function browse(ref, cursor) {
  await null;
  return traced(kino, clock, "browse", () => guarded(({ catalog }) => catalog.browse(ref, cursor)));
}
async function section(arg) {
  await null;
  return traced(kino, clock, "section", () => guarded(({ section: s }) => s.section(arg)));
}
async function categories() {
  await null;
  return traced(kino, clock, "categories", () => guarded(({ categories: c }) => c.categories()));
}
async function episodes(ref) {
  await null;
  return traced(kino, clock, "episodes", () => guarded(({ catalog }) => catalog.episodes(ref)));
}
async function resolve(ref, options) {
  await null;
  return traced(kino, clock, "resolve", () => guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options)));
}
async function sign(request) {
  await null;
  try {
    return signRequest(request, clock.now());
  } catch (e) {
    if (isKinoError(e)) throw e;
    trace(kino, "sign", "fail", { why: typeof e?.why === "string" ? e.why : errCode(e) });
    throw kino.error("unavailable", "No se pudo firmar la petici\xF3n del canal");
  }
}
async function liveCategories() {
  await null;
  return traced(kino, clock, "liveCategories", () => guarded(({ live: live2 }) => live2.liveCategories()));
}
async function liveChannels(args) {
  await null;
  return traced(kino, clock, "liveChannels", () => guarded(({ live: live2 }) => live2.liveChannels(args)));
}
var migrator = makeMigrate();
async function migrate(input) {
  await null;
  try {
    return await migrator.migrate(input);
  } catch (e) {
    if (isKinoError(e)) throw e;
    trace(kino, "migrate", "fail", { code: errCode(e) });
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}
var settingsInstance = null;
var settings = () => settingsInstance ?? (settingsInstance = (() => {
  const { session, portal } = getDeps();
  return makeSettings({ kino, session, clock, registration: makeRegistration({ kino, portal, session, clock }) });
})());
async function settingsStatus() {
  await null;
  try {
    return await settings().settingsStatus();
  } catch (e) {
    trace(kino, "settings", "status_fail", { code: errCode(e) });
    return { status: "No se pudo consultar el estado" };
  }
}
async function action(key) {
  await null;
  try {
    return await traced(kino, clock, "action", () => settings().action(key));
  } catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}
async function validateSettings(values) {
  await null;
  try {
    return await traced(kino, clock, "validate", () => settings().validateSettings(values));
  } catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}
export {
  action,
  browse,
  categories,
  episodes,
  home,
  liveCategories,
  liveChannels,
  migrate,
  resolve,
  search,
  section,
  settingsStatus,
  sign,
  validateSettings
};
