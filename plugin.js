// src/crypto.js
var toHex = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
var HEX_CHUNK = 65536;
var NOT_LOWER_HEX = /[^0-9a-f]/;
var NOT_ASCII = /[^\x00-\x7f]/;
var PAIR = /../g;
function fromHex(h) {
  if (typeof h !== "string" || h.length === 0 || h.length % 2 !== 0) throw new Error("not hex");
  const parts = [];
  for (let i = 0; i < h.length; i += HEX_CHUNK) {
    const piece = h.slice(i, i + HEX_CHUNK);
    if (NOT_LOWER_HEX.test(piece)) throw new Error("not hex");
    const text2 = decodeURIComponent(piece.replace(PAIR, "%$&"));
    if (NOT_ASCII.test(text2)) throw new Error("not ascii");
    parts.push(text2);
  }
  return parts.join("");
}
var PASS_KEY = "kino-xuper-hex16";
var HOST_CHUNK = 4e6;
function hostFromHex(kino2, h) {
  if (typeof h !== "string" || h.length === 0 || h.length % 2 !== 0) throw new Error("not hex");
  const parts = [];
  for (let i = 0; i < h.length; i += HOST_CHUNK) {
    const piece = h.slice(i, i + HOST_CHUNK);
    const sealed = kino2.crypto.encrypt("aes-128-ecb", { key: PASS_KEY, data: piece, inputEncoding: "hex" });
    const text2 = kino2.crypto.decrypt("aes-128-ecb", { key: PASS_KEY, data: sealed });
    if (typeof text2 !== "string" || text2.length * 2 !== piece.length) throw new Error("not ascii");
    parts.push(text2);
  }
  return parts.join("");
}
function wireText(kino2, h) {
  let text2 = null;
  try {
    text2 = hostFromHex(kino2, h);
  } catch (_) {
  }
  return text2 === null ? { text: fromHex(h), how: "engine" } : { text: text2, how: "host" };
}
function makeCrypto(kino2, { onDecode = null } = {}) {
  const fail = (what) => kino2.error("unavailable", "el portal no se pudo " + what);
  return {
    encryptBody(plain3) {
      try {
        const b64 = kino2.crypto.encrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: plain3,
          padding: "pkcs7"
        });
        if (typeof b64 !== "string" || b64 === "") throw new Error("empty");
        return toHex(b64);
      } catch (_) {
        throw fail("cifrar");
      }
    },
    // `onDecode({ how, bytes, ms })`, optional: which way a wire was decoded and how long it took.
    decryptBlob(wire) {
      try {
        const startedAt = Date.now();
        const { text: b64, how } = wireText(kino2, wire);
        if (onDecode) onDecode({ how, bytes: wire.length, ms: Date.now() - startedAt });
        const text2 = kino2.crypto.decrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: b64,
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
var PERF_AREAS = Object.freeze({ slow: "perf_slow", timeout: "perf_timeout", cold: "perf_cold", store: "perf_store", decode: "perf_decode" });
var SLOW_CALL_MS = 8e3;
var TIMEOUT_CALL_MS = 2e4;
function msBucket(ms) {
  const s = Number.isFinite(ms) ? ms / 1e3 : 0;
  const edges = [[1, "lt1s"], [2, "1-2s"], [4, "2-4s"], [8, "4-8s"], [12, "8-12s"], [16, "12-16s"], [20, "16-20s"], [30, "20-30s"], [60, "30-60s"]];
  for (const [limit, word2] of edges) if (s < limit) return word2;
  return "ge60s";
}
function kbBucket(bytes) {
  const kb = Number.isFinite(bytes) ? bytes / 1024 : 0;
  const edges = [[256, "lt256k"], [512, "256-512k"], [1024, "512k-1m"], [2048, "1-2m"], [4096, "2-4m"]];
  for (const [limit, word2] of edges) if (kb < limit) return word2;
  return "ge4m";
}
function reportCallTime(kino2, fn, ms, ok, more = {}) {
  if (!(ms >= SLOW_CALL_MS)) return;
  report(kino2, PERF_AREAS.slow, "call", { fn, b: msBucket(ms), ok, ...more });
  if (ms >= TIMEOUT_CALL_MS) report(kino2, PERF_AREAS.timeout, "call", { fn, b: msBucket(ms), ok, ...more });
}
function makeDecodeReporter(kino2) {
  let done = false;
  return ({ how, bytes, ms }) => {
    if (done || !(bytes >= 1e6)) return;
    done = true;
    report(kino2, PERF_AREAS.decode, "wire", { how, kb: kbBucket(bytes), b: msBucket(ms) });
  };
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
async function traced(kino2, clock2, fn, body, extra = {}, late = null) {
  const t0 = clock2.now();
  trace(kino2, "call", "start", { fn, ...extra });
  const lateFields = () => {
    if (typeof late !== "function") return {};
    try {
      const f = late();
      return f !== null && typeof f === "object" ? f : {};
    } catch (_) {
      return {};
    }
  };
  let out;
  try {
    out = await body();
  } catch (e) {
    const ms2 = clock2.now() - t0;
    const more2 = lateFields();
    trace(kino2, "call", "fail", { fn, ...extra, code: errCode(e), ms: ms2, ...more2 });
    reportCallTime(kino2, fn, ms2, false, more2);
    throw e;
  }
  const ms = clock2.now() - t0;
  const more = lateFields();
  trace(kino2, "call", "ok", { fn, ...extra, ms, n: Array.isArray(out) ? out.length : void 0, ...more });
  reportCallTime(kino2, fn, ms, true, more);
  return out;
}
function seedTag(kino2, sn) {
  try {
    if (typeof sn !== "string" || sn === "") return "?";
    return String(kino2.crypto.hash("sha256", "xuper-seed\n" + sn)).slice(0, 8);
  } catch (_) {
    return "?";
  }
}

// src/i18n.js
function isEnglish(kino2) {
  try {
    const lang = kino2 && typeof kino2.lang === "string" ? kino2.lang.trim().toLowerCase() : "";
    return lang === "en" || lang.startsWith("en-") || lang.startsWith("en_");
  } catch (_) {
    return false;
  }
}
function isSpanish(kino2) {
  try {
    const lang = kino2 && typeof kino2.lang === "string" ? kino2.lang.trim().toLowerCase() : "";
    return lang.startsWith("es");
  } catch (_) {
    return false;
  }
}
var GENRES_ES = Object.freeze({
  "Action": "Acci\xF3n",
  "Adventure": "Aventura",
  "Animation": "Animaci\xF3n",
  "Biography": "Biograf\xEDa",
  "Comedy": "Comedia",
  "Crime": "Crimen",
  "Documentary": "Documental",
  "Drama": "Drama",
  "Family": "Familia",
  "Fantasy": "Fantas\xEDa",
  "History": "Historia",
  "Horror": "Terror",
  "Music": "M\xFAsica",
  "Musical": "Musical",
  "Mystery": "Misterio",
  "Romance": "Romance",
  "Sci-Fi": "Ciencia ficci\xF3n",
  "Sport": "Deportes",
  "Thriller": "Suspenso",
  "War": "Guerra",
  "Western": "Western",
  "Reality-TV": "Reality",
  "Talk-Show": "Programa de entrevistas",
  "Game-Show": "Concurso",
  "News": "Noticias",
  "Film-Noir": "Cine negro",
  "Short": "Cortometraje",
  "Adult": "Adultos"
});
function genreName(name, spanish) {
  if (!spanish || typeof name !== "string") return name;
  const key = name.trim();
  return Object.hasOwn(GENRES_ES, key) ? GENRES_ES[key] : name;
}
var TEXTS = Object.freeze({
  // Where the plugin's own settings live in Kino.
  settingsPlace: ["Ajustes \u25B8 Xuper", "Settings \u25B8 Xuper"],
  // Errors the person reads (`userMessage`).
  accountSessionLost: [
    "Tu sesi\xF3n de Xuper se cerr\xF3 y no pudimos volver a entrar con tu cuenta. Vuelve a vincularla en {place}.",
    "Your Xuper session ended and we could not sign back in with your account. Link it again in {place}."
  ],
  accountInUseElsewhere: [
    "Tu cuenta de Xuper se abri\xF3 en otro dispositivo, y solo puede usarse en uno a la vez. Vuelve a intentarlo, o vinc\xFAlala de nuevo en {place}.",
    "Your Xuper account was opened on another device, and it can only be used on one at a time. Try again, or link it again in {place}."
  ],
  episodeGone: ["Este cap\xEDtulo ya no est\xE1 disponible.", "This episode is no longer available."],
  seriesGone: ["Esta serie ya no est\xE1 disponible.", "This series is no longer available."],
  portalSlow: [
    "Xuper no responde en este momento; intenta de nuevo en unos minutos.",
    "Xuper is not responding right now; try again in a few minutes."
  ],
  liveNeedsAccount: [
    "Este canal necesita una cuenta de Xuper (para pel\xEDculas y series no hace falta). Vinc\xFAlala en {place}.",
    "This channel needs a Xuper account (movies and series do not). Link it in {place}."
  ],
  sendCodeFailed: [
    "Xuper no pudo enviar el c\xF3digo a ese correo. Revisa que est\xE9 bien escrito en {place}.",
    "Xuper could not send the code to that email. Check that it is spelled right in {place}."
  ],
  requestNotSaved: [
    "No pudimos guardar tu pedido. Vuelve a tocar Crear cuenta.",
    "We could not save your request. Tap Create account again."
  ],
  codeRefused: [
    "Xuper no acept\xF3 el c\xF3digo, o ese correo ya tiene cuenta. Pide otro c\xF3digo o toca Iniciar sesi\xF3n.",
    "Xuper did not accept the code, or that email already has an account. Ask for another code or tap Sign in."
  ],
  fillAccount: ["Faltan los datos de tu cuenta: compl\xE9talos en {place}.", "Your account details are missing: fill them in {place}."],
  accountRefused: ["Xuper no acept\xF3 esa cuenta. Revisa los datos en {place}.", "Xuper did not accept that account. Check the details in {place}."],
  fillEmail: ["Escribe tu correo en {place}.", "Enter your email in {place}."],
  badEmail: ["Escribe un correo v\xE1lido en {place}.", "Enter a valid email in {place}."],
  fillCode: ["Escribe el c\xF3digo que te enviamos en {place}.", "Enter the code we sent you in {place}."],
  askCodeAgain: ["Pide el c\xF3digo otra vez.", "Ask for the code again."],
  // The settings form: status line, action results, field errors.
  statusConnecting: ["Conectando con {who}\u2026 Mientras tanto, sesi\xF3n an\xF3nima", "Connecting to {who}\u2026 Anonymous session meanwhile"],
  whoShared: ["la cuenta compartida", "the shared account"],
  whoOwn: ["tu cuenta", "your account"],
  statusSharedBroken: ["La cuenta compartida ya no funciona: sesi\xF3n an\xF3nima", "The shared account no longer works: anonymous session"],
  statusOwnRefused: [
    "No se pudo iniciar sesi\xF3n con tu cuenta: sesi\xF3n an\xF3nima. Revisa tu correo y contrase\xF1a",
    "Could not sign in with your account: anonymous session. Check your email and password"
  ],
  statusAnonymous: ["Sin cuenta: sesi\xF3n an\xF3nima", "No account: anonymous session"],
  statusShared: ["Cuenta compartida", "Shared account"],
  statusConnectedAs: ["Conectado como {email}", "Signed in as {email}"],
  statusBlockedSeeds: ["Zona bloqueada: {n} semillas cargadas", "Blocked region: {n} seeds loaded"],
  statusBlockedNoSeeds: ["Zona bloqueada: sin semillas cargadas", "Blocked region: no seeds loaded"],
  seedsBanner: [
    "Por ahora no hay sesiones disponibles para tu zona; vuelve a intentar en un rato o toca Actualizar semillas",
    "There are no sessions for your region right now; try again in a while or tap Update seeds"
  ],
  statusAutoRefreshOff: ["Actualizaci\xF3n autom\xE1tica desactivada", "Automatic update turned off"],
  statusUnknown: ["No se pudo consultar el estado", "Could not check the status"],
  signedIn: ["Sesi\xF3n iniciada", "Signed in"],
  signedOut: ["Sesi\xF3n cerrada", "Signed out"],
  seedSwitched: ["Semilla cambiada (intento {n})", "Seed changed (attempt {n})"],
  offlineRetry: ["Sin conexi\xF3n, reintenta", "No connection, try again"],
  accountNoSeeds: ["Tu cuenta no usa semillas", "Your account does not use seeds"],
  noOtherSeed: ["No hay otra semilla para probar", "There is no other seed to try"],
  seedsAllFailed: ["Prob\xE9 {n} semillas y ninguna funcion\xF3", "I tried {n} seeds and none worked"],
  seedsLoaded: ["{n} semillas cargadas", "{n} seeds loaded"],
  codeAlreadySent: ["Ya te enviamos un c\xF3digo; espera un minuto antes de pedir otro", "We already sent you a code; wait a minute before asking for another"],
  codeSent: ["Te enviamos un c\xF3digo a {email}", "We sent a code to {email}"],
  accountCreatedSignIn: ["Cuenta creada. Toca Iniciar sesi\xF3n para entrar.", "Account created. Tap Sign in to enter."],
  accountCreatedSignedIn: ["Cuenta creada y sesi\xF3n iniciada", "Account created and signed in"],
  sharedActivationFailed: ["No se pudo activar la cuenta compartida", "Could not turn on the shared account"],
  removeAccountOrShared: ["Quita tu cuenta o apaga la cuenta compartida", "Remove your account or turn off the shared account"],
  enterEmail: ["Escribe tu correo", "Enter your email"],
  enterValidEmail: ["Escribe un correo v\xE1lido", "Enter a valid email"],
  credentialsRefused: ["Credenciales de Xuper inv\xE1lidas", "Xuper did not accept these sign-in details"],
  // Labels and titles the plugin makes (rows, tabs, chapters, copies).
  newBadge: ["NUEVO", "NEW"],
  liveChannelsRow: ["Canales en vivo", "Live channels"],
  allChannels: ["Todos", "All"],
  // Categorías tiles of live channels, one per genre (liveTiles.js).
  liveTileSports: ["Deportes en vivo", "Live sports"],
  liveTileNews: ["Noticias en vivo", "Live news"],
  liveTileKids: ["Infantil en vivo", "Live kids"],
  liveTileMovies: ["Cine en vivo", "Live movies"],
  liveTileSeries: ["Series en vivo", "Live series"],
  liveTileMoviesSeries: ["Cine y series en vivo", "Live movies & series"],
  liveTileEntertainment: ["Entretenimiento en vivo", "Live entertainment"],
  liveTileMusic: ["M\xFAsica en vivo", "Live music"],
  liveTileDocumentaries: ["Documentales en vivo", "Live documentaries"],
  liveTileAnime: ["Anime en vivo", "Live anime"],
  chapterN: ["Cap\xEDtulo {n}", "Episode {n}"],
  seasonN: ["Temporada {n}", "Season {n}"],
  server: ["Servidor {n}", "Server {n}"],
  backup: ["respaldo", "backup"],
  retry: ["reintento {n}", "retry {n}"],
  versionN: ["Versi\xF3n {n}", "Version {n}"]
});
function say(kino2, key, vars = {}) {
  const pair = TEXTS[key];
  if (!pair) return key;
  const en = isEnglish(kino2);
  const all = { place: TEXTS.settingsPlace[en ? 1 : 0], ...vars };
  return pair[en ? 1 : 0].replace(/\{(\w+)\}/g, (m, name) => Object.hasOwn(all, name) ? String(all[name]) : m);
}
function sayAll(key) {
  const pair = TEXTS[key];
  if (!pair) return [];
  return pair.map((text2, i) => text2.replace(/\{place\}/g, TEXTS.settingsPlace[i]));
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
var SETTINGS_PLACE = sayAll("settingsPlace")[0];
var ACCOUNT_SESSION_LOST = sayAll("accountSessionLost")[0];
var ACCOUNT_IN_USE_ELSEWHERE_TEXT = sayAll("accountInUseElsewhere")[0];
var ACCOUNT_SENTENCES = /* @__PURE__ */ new Set([...sayAll("accountSessionLost"), ...sayAll("accountInUseElsewhere")]);
var ACCOUNT_IN_USE_ELSEWHERE = "aaa100083";
var SESSION_DEAD_CODES = /* @__PURE__ */ new Set(["aaa100027", "aaa100028"]);
function accountProblemMessage(code, kino2 = null) {
  if (SESSION_DEAD_CODES.has(code)) return say(kino2, "accountSessionLost");
  if (code === ACCOUNT_IN_USE_ELSEWHERE) return say(kino2, "accountInUseElsewhere");
  return null;
}
var EPISODE_GONE = sayAll("episodeGone")[0];
var SERIES_GONE = sayAll("seriesGone")[0];
var isEpisodeGone = (text2) => sayAll("episodeGone").includes(text2);
var told = (kino2, code, message, sentence) => kino2.error(code, message, { userMessage: sentence });
var GENERIC = "Xuper no est\xE1 disponible ahora";
var PORTAL_SLOW = sayAll("portalSlow")[0];
function slowPortal(kino2, e) {
  if (!e || e.name !== "KinoError_unavailable" || typeof e.userMessage === "string") return e;
  return kino2.error("unavailable", typeof e.message === "string" && e.message !== "" ? e.message : GENERIC, { userMessage: say(kino2, "portalSlow") });
}
function mapPortalError(code, message, kino2, { accountLinked = false, sharedAccount = false, goneMessage = EPISODE_GONE } = {}) {
  const msg = typeof message === "string" ? message : "";
  const accountText = accountLinked ? accountProblemMessage(code, kino2) : null;
  if (accountText) return told(kino2, "auth_required", `cuenta propia: ${code}`, accountText);
  if (code === "portal100006") {
    const series = sayAll("seriesGone").includes(goneMessage);
    return told(kino2, "not_found", `portal100006: ${series ? "serie" : "cap\xEDtulo"} borrado`, say(kino2, series ? "seriesGone" : "episodeGone"));
  }
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
  liveSearch: 15e3,
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
    const { baseFields = true, userId = "", userToken = "", sn = null, timeoutMs, deadline, onFetchMs } = opts;
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
        const sentAt = clock2.now();
        res = await kino2.fetch(`https://${host}/api/portalCore/${path}`, {
          method: "POST",
          headers,
          body: wire,
          cookies: false,
          timeoutMs: requestMs
        });
        if (typeof onFetchMs === "function") {
          try {
            onFetchMs(clock2.now() - sentAt);
          } catch (_) {
          }
        }
        stage = "body";
        bodyText = res.text();
        answer = JSON.parse(bodyText);
        if (!isObject(answer)) throw new Error("respuesta del portal no es un objeto");
        if (i > 0) report(kino2, "portal", "failover", { path: tp, to: i });
        preferredHost = host;
        const rc = answer.returnCode;
        const code = rc === void 0 || rc === null ? "" : String(rc);
        if (code !== "" && code !== "0") {
          const em = answer.errorMessage;
          answer = { portalFailure: new PortalError(code, typeof em === "string" && em.trim() ? em : "") };
        } else if (typeof answer.data === "string" && answer.data !== "") {
          stage = "data";
          const plain3 = crypto.decryptBlob(answer.data);
          stage = "inner";
          const inner = JSON.parse(plain3);
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
    let res;
    try {
      res = await kino2.fetch(seedsUrl, { timeoutMs });
    } catch (e) {
      trace(kino2, "seeds", "refresh", { ok: false, why: "fetch", code: errCode(e) });
      return false;
    }
    if (res && res.ok === false) {
      report(kino2, "seeds", "refresh", { ok: false, why: "http", status: res.status });
      return false;
    }
    let list;
    try {
      list = JSON.parse(res.text());
    } catch (_) {
      list = null;
    }
    if (!Array.isArray(list)) {
      report(kino2, "seeds", "refresh", { ok: false, why: "parse" });
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
  { root: "peliculas", label: "Pel\xEDculas", en: "Movies" },
  { root: "series", label: "Series", en: "Series" },
  { root: "anime", label: "Anime", en: "Anime" },
  { root: "infantil", label: "Infantil", en: "Kids" }
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
var GENRES_EN = Object.freeze({
  action: "Action",
  adventure: "Adventure",
  comedy: "Comedy",
  drama: "Drama",
  thriller: "Thriller",
  crime: "Crime",
  scifi: "Sci-Fi",
  fantasy: "Fantasy",
  romance: "Romance",
  mystery: "Mystery",
  horror: "Horror",
  family: "Family",
  biography: "Biography",
  history: "History",
  documentary: "Documentary",
  western: "Western",
  war: "War",
  reality: "Reality",
  sport: "Sports",
  music: "Music"
});
var YEAR_SECTION = /^(\d{4})(.*)$/;
var FEATURED_PREFIXES = ["magis_recent_", "magis_new_", "magis_top_"];
var isFeatured = (rowId) => FEATURED_PREFIXES.some((p) => rowId.startsWith(p));
function rootOfRow(rowId) {
  if (typeof rowId !== "string") return null;
  const prefix = [...FEATURED_PREFIXES, "magis_g_"].find((p) => rowId.startsWith(p));
  if (prefix === void 0) return null;
  const rest = rowId.slice(prefix.length);
  const root = prefix === "magis_g_" ? rest.slice(0, Math.max(0, rest.indexOf("_"))) : rest;
  return Object.hasOwn(byRoot, root) ? root : null;
}
function localizedRowTitle(row2, english) {
  if (!english) return row2.title;
  const fixed = {
    magis_recent_peliculas: "Recently added \xB7 Movies",
    magis_new_series: "Series with new episodes",
    magis_top_peliculas: "Top rated movies",
    magis_top_series: "Top rated series",
    magis_new_peliculas: "In theaters"
  };
  if (Object.hasOwn(fixed, row2.id)) return fixed[row2.id];
  const root = rootOfRow(row2.id);
  if (root !== null && row2.id.startsWith(`magis_g_${root}_`)) {
    const key = row2.id.slice(`magis_g_${root}_`.length);
    if (Object.hasOwn(GENRES_EN, key)) return `${GENRES_EN[key]} \xB7 ${byRoot[root].en}`;
  }
  return row2.title;
}
function genreOfRow(rowId) {
  const root = rootOfRow(rowId);
  if (root === null) return null;
  return rowId === `magis_g_${root}_documentary` ? "documentales" : root;
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
var FEATURED_ORDER = ["magis_recent_peliculas", "magis_new_series", "magis_top_peliculas", "magis_top_series", "magis_new_peliculas"];
function orderRows(rows) {
  const featured = FEATURED_ORDER.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  const genre = KINDS.map(({ root }) => rows.filter((r) => !isFeatured(r.id) && rootOfRow(r.id) === root));
  const out = [...featured];
  const longest = Math.max(0, ...genre.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const g of genre) if (g[i]) out.push(g[i]);
  return out;
}
function mergeRoot(rows, root, rootRows) {
  return orderRows([...rows.filter((r) => rootOfRow(r.id) !== root), ...rootRows]);
}

// src/channelId.js
var ID = /^[A-Za-z0-9._~-]{1,128}$/;
var REF_PREFIX = "xlive1:";
var MAX_CODE_CHARS = 2e3;
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
var plainCode = (code) => ID.test(code) && !code.startsWith("~") && !code.startsWith("x.");
function b64url(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63];
    if (i + 1 < bytes.length) out += B64[n >> 6 & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
function hash128(s) {
  const lanes = [2166136261, 16777619 ^ 2654435769, 3735928559, 1103547991];
  const mul = [16777619, 2246822519, 3266489917, 668265263];
  for (const b of new TextEncoder().encode(s)) {
    for (let i = 0; i < 4; i++) {
      lanes[i] = Math.imul(lanes[i] ^ b + i, mul[i]);
      lanes[i] ^= lanes[(i + 1) % 4] >>> 13;
    }
  }
  return lanes.map((n) => (n >>> 0).toString(16).padStart(8, "0")).join("");
}
function channelOf(code) {
  if (typeof code !== "string" || code.trim() === "" || code.length > MAX_CODE_CHARS) return null;
  if (plainCode(code)) return { id: code, ref: code };
  const body = b64url(new TextEncoder().encode(code));
  const id = ("x.b" + body).length <= 128 ? "x.b" + body : "x.h" + hash128(code);
  return { id, ref: REF_PREFIX + code };
}
var idOfCode = (code) => channelOf(code)?.id ?? null;
var isWrappedRef = (ref) => typeof ref === "string" && ref.startsWith(REF_PREFIX) && ref.length > REF_PREFIX.length && ref.length <= 4096;
var codeOfRef = (ref) => isWrappedRef(ref) ? ref.slice(REF_PREFIX.length) : ref;

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
  if (isWrappedRef(ref)) return true;
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
  let n = s.length + countOf(s, /["\\/\t\b\n\r\f]/g) + 5 * countOf(s, /[\x00-\x07\x0b\x0e-\x1f]/g);
  if (NON_ASCII.test(s)) {
    const pairs = countOf(s, /[\ud800-\udbff][\udc00-\udfff]/g) / 2;
    n += countOf(s, /[\u0080-\u07ff]/g) + 2 * countOf(s, /[\u0800-\ud7ff\ue000-\uffff]/g) + 2 * pairs + 2 * (countOf(s, /[\ud800-\udfff]/g) - 2 * pairs);
  }
  return n;
}
var NON_ASCII = /[^\x00-\x7f]/;
var countOf = (s, re) => s.length - s.replace(re, "").length;

// src/rowsStore.js
var ROWS_FORMAT = 1;
var META_KEY = "rows:meta";
var PART_PREFIX = "rows:";
var SNAPSHOT_BUDGET_BYTES = 8e4;
var PART_BUDGET_BYTES = 2e4;
var META_RESERVE_BYTES = 400;
var PART_TAG_BYTES = 16;
var TEXT_BUDGET_BYTES = SNAPSHOT_BUDGET_BYTES - META_RESERVE_BYTES - 4 * PART_TAG_BYTES;
function commonPrefix(urls) {
  if (urls.length === 0) return "";
  let p = urls[0];
  for (const u of urls) {
    while (!u.startsWith(p)) p = p.slice(0, -1);
    if (p === "") break;
  }
  return p.length >= 12 ? p : "";
}
function collect(rows, keepFull) {
  const index = /* @__PURE__ */ new Map();
  const items = [];
  const refs = rows.map((r, n) => {
    const shown = n < keepFull ? r.shown : r.shown.slice(0, 1);
    return shown.map((i) => {
      let k = index.get(i);
      if (k === void 0) {
        k = items.length;
        index.set(i, k);
        items.push(i);
      }
      return k;
    });
  });
  return { items, refs };
}
var descCost = (d) => storedLength(JSON.stringify(d)) - 4;
function encodeRows(rows, { descItems = Infinity, genres = true, keepFull = Infinity } = {}) {
  const { items, refs } = collect(rows, keepFull);
  const urls = [];
  for (const i2 of items) {
    if (i2.poster) urls.push(i2.poster);
    if (i2.backdrop) urls.push(i2.backdrop);
  }
  const p = commonPrefix(urls);
  const strip = (u) => u ? u.slice(p.length) : null;
  const genreIx = /* @__PURE__ */ new Map();
  const typeIx = /* @__PURE__ */ new Map();
  const ix = (map, v) => {
    let k = map.get(v);
    if (k === void 0) {
      k = map.size;
      map.set(v, k);
    }
    return k;
  };
  const i = items.map((it, n) => [
    it.id,
    it.title,
    strip(it.poster),
    strip(it.backdrop),
    it.durationS,
    ix(typeIx, it.type),
    genres ? it.genres.map((g) => ix(genreIx, g)) : [],
    it.score,
    n < descItems ? it.description : "",
    it.shelvedAtMs > 0 ? Math.round(it.shelvedAtMs / 1e3) : 0
  ]);
  const r = rows.map((row2, n) => [row2.id, row2.title, refs[n]]);
  const c = keepFull >= rows.length || rows.slice(keepFull).every((row2) => row2.shown.length <= 1) ? 1 : 0;
  return JSON.stringify({ v: ROWS_FORMAT, c, p, g: [...genreIx.keys()], t: [...typeIx.keys()], i, r });
}
function fitRows(rows, { budget = TEXT_BUDGET_BYTES, keepFull = Infinity } = {}) {
  const partial = keepFull < rows.length ? keepFull : Infinity;
  const homeItems = collect(rows.slice(0, keepFull), Infinity).items.length;
  const steps = [
    { keepFull: Infinity, genres: true, least: homeItems },
    { keepFull: partial, genres: true, least: 0 },
    { keepFull: partial, genres: false, least: 0 }
  ];
  for (let s = 0; s < steps.length; s++) {
    const { keepFull: kf, genres, least } = steps[s];
    const items = collect(rows, kf).items;
    let floor = 0;
    for (let n = 0; n < items.length && floor <= budget; n++) {
      floor += items[n].id.length + items[n].title.length + 9 + (n < least ? items[n].description.length : 0);
    }
    if (floor > budget) continue;
    const whole2 = encodeRows(rows, { keepFull: kf, genres });
    let size = storedLength(whole2);
    if (size <= budget) return { text: whole2, step: s };
    let k = items.length;
    while (k > 0 && size > budget) {
      k--;
      size -= descCost(items[k].description);
    }
    if (size > budget || k < least) continue;
    const fitted = encodeRows(rows, { keepFull: kf, genres, descItems: k });
    if (storedLength(fitted) <= budget) return { text: fitted, step: s };
  }
  return null;
}
var isIndexList = (a, n) => Array.isArray(a) && a.every((k) => Number.isInteger(k) && k >= 0 && k < n);
function decodeRows(text2) {
  const o = JSON.parse(text2);
  if (o === null || typeof o !== "object" || o.v !== ROWS_FORMAT || typeof o.p !== "string" || !Array.isArray(o.g) || !Array.isArray(o.t) || !Array.isArray(o.i) || !Array.isArray(o.r) || o.c !== 0 && o.c !== 1) {
    throw new Error("stored rows are malformed");
  }
  const full = (u) => typeof u === "string" ? o.p + u : null;
  const items = o.i.map((r) => {
    if (!Array.isArray(r) || r.length !== 10 || typeof r[0] !== "string" || typeof o.t[r[5]] !== "string" || !isIndexList(r[6], o.g.length)) {
      throw new Error("stored item is malformed");
    }
    return {
      id: r[0],
      title: asText(r[1]),
      poster: full(r[2]),
      backdrop: full(r[3]),
      durationS: Number(r[4]) || 0,
      type: o.t[r[5]],
      genres: r[6].map((g) => asText(o.g[g])),
      score: typeof r[7] === "number" ? r[7] : null,
      description: asText(r[8]),
      shelvedAtMs: (Number(r[9]) || 0) * 1e3
    };
  });
  const rows = o.r.map((r) => {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[1] !== "string" || !isIndexList(r[2], items.length)) {
      throw new Error("stored row is malformed");
    }
    return { id: r[0], title: r[1], shown: r[2].map((k) => items[k]), all: null };
  });
  return { rows, complete: o.c === 1 };
}
function splitParts(text2, budget = PART_BUDGET_BYTES) {
  const parts = [];
  let start = 0;
  while (start < text2.length) {
    let len = Math.min(budget, text2.length - start);
    for (; ; ) {
      let end = start + len;
      const c = text2.charCodeAt(end - 1);
      if (end < text2.length && c >= 55296 && c < 56320) end--;
      const size = storedLength(text2.slice(start, end));
      if (size <= budget || end - start <= 1) {
        len = end - start;
        break;
      }
      len = Math.max(1, Math.min(end - start - 1, Math.floor((end - start) * budget / size) - 2));
    }
    parts.push(text2.slice(start, start + len));
    start += len;
  }
  return parts.length === 0 ? [""] : parts;
}
function checksum(text2) {
  let h = 2166136261;
  for (let k = 0; k < text2.length; k++) {
    h ^= text2.charCodeAt(k);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(36);
}
function makeRowsStore({ kino: kino2, ttlMs }) {
  const partKey = (n) => `${PART_PREFIX}${n}`;
  const isPartKey = (k) => k.startsWith(PART_PREFIX) && /^\d+$/.test(k.slice(PART_PREFIX.length));
  const digest = (text2) => {
    try {
      const h = kino2.crypto.hash("md5", text2);
      if (typeof h === "string" && h !== "") return { m: h };
    } catch (_) {
    }
    return { h: checksum(text2) };
  };
  const ROOT_NAMES = ["peliculas", "series", "anime", "infantil"];
  function read() {
    try {
      const rawMeta = kino2.storage.get(META_KEY);
      if (rawMeta === null || rawMeta === void 0) return null;
      const m = JSON.parse(rawMeta);
      if (m === null || typeof m !== "object" || m.v !== ROWS_FORMAT || typeof m.g !== "string" || !Number.isInteger(m.n) || m.n < 1 || m.n > 64 || !Number.isInteger(m.len) || typeof m.h !== "string" && typeof m.m !== "string" || !Number.isFinite(m.at)) return null;
      const tag = m.g + ":";
      let text2 = "";
      for (let n = 0; n < m.n; n++) {
        const part = kino2.storage.get(partKey(n));
        if (typeof part !== "string" || !part.startsWith(tag)) return null;
        text2 += part.slice(tag.length);
      }
      if (text2.length !== m.len) return null;
      if (typeof m.m === "string" ? digest(text2).m !== m.m : checksum(text2) !== m.h) return null;
      const { rows, complete } = decodeRows(text2);
      let roots;
      if (m.r === void 0) roots = Object.fromEntries(ROOT_NAMES.map((r) => [r, m.at]));
      else if (m.r !== null && typeof m.r === "object" && Object.entries(m.r).every(([k, t]) => ROOT_NAMES.includes(k) && Number.isFinite(t))) roots = m.r;
      else return null;
      let whole2;
      if (m.w === void 0) whole2 = complete ? Object.keys(roots) : [];
      else if (Array.isArray(m.w) && m.w.every((r) => ROOT_NAMES.includes(r))) whole2 = m.w;
      else return null;
      return { rows, complete, at: m.at, roots, whole: whole2 };
    } catch (_) {
      return null;
    }
  }
  function write(text2, at, roots, whole2) {
    const sum = digest(text2);
    const gen = (Math.floor(at) % 2176782336).toString(36) + String(sum.m ?? sum.h).slice(0, 4);
    const parts = splitParts(text2, PART_BUDGET_BYTES - PART_TAG_BYTES);
    let keys = [];
    try {
      keys = kino2.storage.keys();
    } catch (_) {
    }
    for (const k of keys) {
      if (k === META_KEY || k.startsWith("tree:") || isPartKey(k) && Number(k.slice(PART_PREFIX.length)) >= parts.length) {
        try {
          kino2.storage.remove(k);
        } catch (_) {
        }
      }
    }
    try {
      parts.forEach((p, n) => kino2.storage.set(partKey(n), `${gen}:${p}`, { ttlMs }));
      kino2.storage.set(META_KEY, JSON.stringify({ v: ROWS_FORMAT, g: gen, n: parts.length, len: text2.length, ...sum, at, r: roots, w: whole2 }), { ttlMs });
      return true;
    } catch (e) {
      for (let n = 0; n < parts.length; n++) {
        try {
          kino2.storage.remove(partKey(n));
        } catch (_) {
        }
      }
      throw e;
    }
  }
  return { read, write };
}

// src/byteCache.js
function makeByteCache({ kino: kino2, key, budgetBytes, clock: clock2, ttlMs, valid: valid2 = () => true, keepMs = ttlMs }) {
  const what = String(key).split(":")[0];
  const decode2 = (raw) => {
    try {
      const o = JSON.parse(raw);
      if (!isObject(o) || o.v !== 1 || !Array.isArray(o.e)) return [];
      return o.e.filter((x) => isObject(x) && typeof x.k === "string" && Number.isFinite(x.s) && x.i !== void 0 && valid2(x.i));
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
  const kept = (entry, nowMs) => nowMs - entry.s < Math.max(ttlMs, keepMs);
  function getStale(k, entries = read(), nowMs = clock2.now()) {
    const hit = entries.find((e) => e.k === k && kept(e, nowMs));
    return hit === void 0 ? void 0 : hit.i;
  }
  function write(added, touched = []) {
    try {
      const now = clock2.now();
      let entries = read().filter((e) => kept(e, now));
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
  return { read, get, getStale, fresh, write };
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
var ADULT_TAG = "adult";
var taggedAdult = (tags) => str3(tags).split(",").some((t) => t.trim().toLowerCase() === ADULT_TAG);
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
  if (taggedAdult(raw.tags)) out.x = 1;
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
function makeSearch({ kino: kino2, portal, session, clock: clock2, tmdb = null, isAdultId = () => false, idsLookup = () => () => null }) {
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
    let idsOf;
    try {
      idsOf = idsLookup();
    } catch (_) {
      idsOf = () => null;
    }
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
      let adult = it.x === 1;
      if (!adult) {
        try {
          adult = isAdultId(it.c) === true;
        } catch (_) {
          adult = false;
        }
      }
      if (adult) item.adult = true;
      const ids = idsOf(it.c);
      if (ids) item.ids = ids;
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
var CACHE_KEEP_MS = 7 * 24 * 36e5;
var CHAPTERS_REFRESH_MS = 8e3;
var CHAPTERS_COLD_MS = 12e3;
var EPISODES_DEADLINE_MS = 15e3;
var IMDB = /^tt\d{7,}$/;
var MAX_EPISODES = 5e3;
var MAX_SEASONS = 50;
var INT4 = /^[+-]?\d+$/;
var GENERIC_TITLE = /^(?:(?:capitulo|episodio|chapter|episode|cap|ep|e)\.?\s*#?\s*)?\d*$/;
var TRAILING_NUMBER = /[\s._-]*\d+$/;
var plainTitle = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();
function isGenericTitle(s) {
  if (typeof s !== "string") return true;
  const t = plainTitle(s);
  if (GENERIC_TITLE.test(t)) return true;
  const cut = t.lastIndexOf("_");
  if (cut < 0) return false;
  const series = t.slice(0, cut).trim();
  const rest = t.slice(cut + 1).trim();
  return GENERIC_TITLE.test(rest) || TRAILING_NUMBER.test(rest) && rest.replace(TRAILING_NUMBER, "").trim() === series;
}
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
function makePortalChapters({ kino: kino2, portal, session, clock: clock2, onServed = () => {
}, ids = null }) {
  const cache = makeByteCache({
    kino: kino2,
    key: CACHE_KEY2,
    budgetBytes: CACHE_BUDGET_BYTES2,
    clock: clock2,
    ttlMs: CACHE_FRESH_MS2,
    keepMs: CACHE_KEEP_MS,
    valid: validPayload
  });
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
    const entries = cache.read();
    const cached = cache.get(seriesId, entries);
    if (cached !== void 0) {
      onServed("cache");
      return unpack(cached);
    }
    const kept = cache.getStale(seriesId, entries);
    const portalEnd = Math.min(deadline, clock2.now() + (kept !== void 0 ? CHAPTERS_REFRESH_MS : CHAPTERS_COLD_MS));
    let data;
    try {
      data = await fetchDetail(seriesId, portalEnd);
    } catch (e) {
      if (kept !== void 0 && isKinoError(e) && e.name === "KinoError_unavailable") {
        trace(kino2, "episodes", "kept", { code: errCode(e) });
        onServed("cache");
        return unpack(kept);
      }
      throw slowPortal(kino2, e);
    }
    const items = (Array.isArray(data.simpleProgramList) ? data.simpleProgramList : []).filter(isObject).map((it) => {
      const seriesNumber = typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null;
      const item = { seriesNumber, contentId: optStringStrict(it.contentId), name: optStringStrict(it.name), duration: void 0 };
      if (typeof it.duration === "string" || typeof it.duration === "number" && Number.isFinite(it.duration)) item.duration = it.duration;
      return item;
    });
    const seasonList = parseSeasonList(data.sameSeasonSeriesList, seriesId);
    const raw = { items, imdb: optStringStrict(data.keyWords), season: seasonList.own, declared: toIntOrNull2(data.volumnCount), seasons: seasonList.all };
    if (items.length > 0) cache.write([{ k: seriesId, i: pack(raw) }]);
    if (ids) ids.remember(seriesId, raw.imdb);
    onServed("fresh");
    return raw;
  };
}
function makeEpisodes({ kino: kino2, tmdb = null, portalChapters, clock: clock2 = null, ids = null }) {
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
        const row2 = {
          still: c.still.trim() !== "" ? c.still : null,
          // TMDB's blank name reads "Episodio N" (parseSeasonEpisodes): no better than the portal's.
          title: !isGenericTitle(c.name) ? c.name : null,
          overview: c.overview.trim() !== "" ? c.overview : null,
          airDate: c.airDate || null,
          runtimeMinutes: c.runtimeMinutes > 0 ? c.runtimeMinutes : null
        };
        if (Object.values(row2).some((v) => v !== null)) rows.set(c.episode, row2);
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
    const deadline = clock2 ? Math.min(clock2.now() + EPISODES_DEADLINE_MS, callDeadline(clock2, CALL_BUDGET_MS.episodes)) : void 0;
    let raw;
    try {
      raw = await portalChapters(magis.contentId, deadline);
    } catch (e) {
      if (isKinoError(e) && isEpisodeGone(e.userMessage)) throw mapPortalError("portal100006", "", kino2, { goneMessage: SERIES_GONE });
      throw e;
    }
    const { extra, series } = await enrich(raw, { deadline });
    if (ids && IMDB.test(raw.imdb)) ids.remember(magis.contentId, raw.imdb, series?.tmdbId ?? 0);
    const list = raw.items.slice(0, MAX_EPISODES).map((it) => {
      const number = toIntOrNull2(it.seriesNumber) ?? 0;
      const ep = {
        number,
        title: it.name.trim() !== "" ? it.name : say(kino2, "chapterN", { n: number }),
        // The series plus the number: whoever plays it looks the chapter back up in the list.
        ref: encodeChapter(number, magis.contentId)
      };
      const t = extra.get(number);
      if (t?.title && isGenericTitle(it.name)) ep.title = t.title;
      if (t?.still) ep.still = t.still;
      if (t?.overview) ep.overview = t.overview;
      if (t?.airDate) ep.airDate = t.airDate;
      if (t?.runtimeMinutes) ep.runtimeMinutes = t.runtimeMinutes;
      if (raw.season !== null) ep.season = raw.season;
      return ep;
    });
    const out = { episodes: list };
    if (IMDB.test(raw.imdb)) {
      const tmdbId = series?.tmdbId ?? 0;
      out.series = {
        ids: tmdbId > 0 ? { imdb: raw.imdb, tmdb: tmdbId } : { imdb: raw.imdb },
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
        title: say(kino2, "seasonN", { n: s.number }),
        number: s.number,
        current: s.id === magis.contentId
      }));
    }
    return out;
  };
}

// src/idsStore.js
var KEY2 = "ids:v1";
var BUDGET_BYTES = 1e4;
var KEEP_MS = 60 * 24 * 36e5;
var IMDB2 = /^tt\d{7,10}$/;
var MAX_TMDB = 2147483647;
var validTmdb = (n) => Number.isInteger(n) && n > 0 && n <= MAX_TMDB;
var valid = (p) => Array.isArray(p) && typeof p[0] === "string" && IMDB2.test(p[0]) && Number.isInteger(p[1]) && p[1] >= 0;
var idsOfPayload = (p) => valid(p) ? validTmdb(p[1]) ? { imdb: p[0], tmdb: p[1] } : { imdb: p[0] } : null;
function makeIdsStore({ kino: kino2, clock: clock2 }) {
  const cache = makeByteCache({ kino: kino2, key: KEY2, budgetBytes: BUDGET_BYTES, clock: clock2, ttlMs: KEEP_MS, valid });
  function remember(contentId, imdb, tmdb = 0) {
    try {
      if (typeof contentId !== "string" || contentId.trim() === "" || typeof imdb !== "string" || !IMDB2.test(imdb)) return;
      const entries = cache.read();
      const old = cache.get(contentId, entries);
      const keptTmdb = validTmdb(tmdb) ? tmdb : old && old[0] === imdb ? old[1] : 0;
      if (old && old[0] === imdb && old[1] === keptTmdb) return;
      cache.write([{ k: contentId, i: [imdb, keptTmdb] }]);
    } catch (_) {
    }
  }
  function lookup() {
    let byId;
    try {
      byId = new Map(cache.read().map((e) => [e.k, e.i]));
    } catch (_) {
      byId = /* @__PURE__ */ new Map();
    }
    return (contentId) => byId.has(contentId) ? idsOfPayload(byId.get(contentId)) : null;
  }
  return { remember, lookup };
}

// src/liveTiles.js
var LIVE_TILE_PREFIX = "xlive:";
var MAX_LIVE_TILES = 6;
var GENRE_ORDER = ["deportes", "noticias", "infantil", "cineyseries", "peliculas", "series", "entretenimiento", "musica", "documentales", "anime"];
var TITLE_KEY = {
  deportes: "liveTileSports",
  noticias: "liveTileNews",
  infantil: "liveTileKids",
  peliculas: "liveTileMovies",
  cineyseries: "liveTileMoviesSeries",
  series: "liveTileSeries",
  entretenimiento: "liveTileEntertainment",
  musica: "liveTileMusic",
  documentales: "liveTileDocumentaries",
  anime: "liveTileAnime"
};
var LIVE_TILES_COLD_MS = 8e3;
var PAGE_SIZE2 = 100;
var MAX_PAGES = 20;
var isLiveTileRef = (ref) => typeof ref === "string" && ref.startsWith(LIVE_TILE_PREFIX);
function genresOf2(categories2) {
  const by = /* @__PURE__ */ new Map();
  for (const { id, genre } of categories2) {
    if (!Object.hasOwn(TITLE_KEY, genre)) continue;
    if (!by.has(genre)) by.set(genre, []);
    if (!by.get(genre).includes(id)) by.get(genre).push(id);
  }
  return GENRE_ORDER.filter((g) => by.has(g)).map((genre) => ({ genre, ids: by.get(genre) }));
}
function makeLiveTiles({ kino: kino2, live: live2, clock: clock2 }) {
  async function tiles() {
    try {
      const deadline = Math.min(clock2.now() + LIVE_TILES_COLD_MS, callDeadline(clock2, CALL_BUDGET_MS.categories));
      const genres = genresOf2(await live2.genreCategories(deadline)).slice(0, MAX_LIVE_TILES);
      const logos = live2.genreLogos();
      return genres.map(({ genre }) => {
        const tile = { id: `xlive-${genre}`, title: say(kino2, TITLE_KEY[genre]).slice(0, 40), ref: LIVE_TILE_PREFIX + genre };
        if (Object.hasOwn(logos, genre)) tile.art = logos[genre];
        return tile;
      });
    } catch (e) {
      trace(kino2, "categories", "live_tiles_fail", { code: errCode(e) });
      return [];
    }
  }
  const notFound = () => kino2.error("not_found", "No se encontr\xF3 esa categor\xEDa");
  function cursorOf(cursor) {
    const m = typeof cursor === "string" ? /^(\d{1,2})\.(\d{1,3})$/.exec(cursor) : null;
    return m ? { at: Number(m[1]), page: Math.max(1, Number(m[2])) } : { at: 0, page: 1 };
  }
  async function browse2(ref, cursor) {
    const genre = ref.slice(LIVE_TILE_PREFIX.length);
    const deadline = callDeadline(clock2, CALL_BUDGET_MS.browse);
    let ids;
    try {
      ids = genresOf2(await live2.genreCategories(deadline)).find((g) => g.genre === genre)?.ids;
    } catch (e) {
      throw live2.surface(e);
    }
    if (!ids) throw notFound();
    let { at, page } = cursorOf(cursor);
    const first = cursor === null || cursor === void 0;
    while (at < ids.length && page <= MAX_PAGES) {
      let got;
      try {
        got = await live2.channelsPage(ids[at], page, PAGE_SIZE2, deadline);
      } catch (e) {
        if (first && at === 0 && page === 1) throw live2.surface(e);
        trace(kino2, "live", "tile_page_fail", { genre, page, code: errCode(e) });
        return { items: [] };
      }
      const next = got.full && page < MAX_PAGES ? `${at}.${page + 1}` : at + 1 < ids.length ? `${at + 1}.1` : null;
      const items = got.items.map((c) => {
        const item = { kind: "live", id: c.id, title: c.title, ref: c.ref };
        if (c.logo) item.poster = c.logo;
        return item;
      });
      if (items.length > 0 || next === null) return next ? { items, next } : { items };
      ({ at, page } = cursorOf(next));
    }
    return { items: [] };
  }
  return { tiles, browse: browse2 };
}

// src/catalog.js
var ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
var ADULT_ROOT_CODE = "masnew_adult";
var ADULT_REF = "magis_adultos";
var ROWS_FRESH_MS = 2 * 36e5;
var SNAPSHOT_TTL_MS = 14 * 24 * 36e5;
var TREE_PAGE_SIZE = 60;
var REFRESH_GAP_MS = 5 * 6e4;
var SLICE_START_MS = 1500;
var SLICE_MARGIN_MS = 2e3;
var WARM_REFRESH_MS = 8e3;
var COLD_DEADLINE_MS = 12e3;
var LIVE_ROW_MS = WARM_REFRESH_MS;
var COLD_PARALLEL = 2;
var SLOW_FETCH_MS = 4e3;
var SLOW_KEY = "portalSlow";
var SLOW_MEMORY_MS = 30 * 6e4;
var BROWSE_PAGE = 50;
var MAX_HOME_ROWS = 20;
var MAX_ROW_ITEMS = 60;
var MAX_GENRES = 5;
var NEW_WINDOW_MS = 48 * 36e5;
var ITEM_ID2 = /^[A-Za-z0-9._~-]{1,128}$/;
var noIds = () => null;
function projectItem(item, nowMs, idsOf = noIds, english = false, spanish = false) {
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
  if (item.genres.length > 0) out.genres = item.genres.slice(0, MAX_GENRES).map((g) => genreName(g, spanish));
  if (item.score !== null && Number.isFinite(item.score) && item.score >= 0 && item.score <= 10) out.rating = item.score;
  const minutes = Math.trunc(item.durationS / 60);
  if (minutes >= 1 && minutes <= 1e3) out.runtimeMinutes = minutes;
  if (item.shelvedAtMs > 0 && nowMs - item.shelvedAtMs <= NEW_WINDOW_MS) out.badges = [english ? "NEW" : "NUEVO"];
  const ids = idsOf(item.id);
  if (ids) out.ids = ids;
  return out;
}
var plainWords = (text2) => String(text2).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function rankWithin(kino2, pool, q) {
  const words = plainWords(q).split(" ").filter((w) => w !== "");
  const forms = [q];
  const titlesOf = (item) => [item.title];
  const relevant = new Set(kino2.rank.filterRelevant(pool, forms, titlesOf));
  const hits = pool.filter((item) => {
    if (relevant.has(item)) return true;
    const title2 = plainWords(item.title);
    return words.length > 0 && words.every((w) => title2.includes(w));
  });
  return kino2.rank.sortBySimilarity(hits, forms, titlesOf);
}
function projectRows(rows, nowMs, idsOf = noIds, english = false, spanish = false) {
  const out = [];
  for (const r of rows) {
    const items = r.shown.map((i) => projectItem(i, nowMs, idsOf, english, spanish)).filter((i) => i !== null).slice(0, MAX_ROW_ITEMS);
    if (items.length === 0) continue;
    const title2 = localizedRowTitle(r, english);
    const genre = genreOfRow(r.id);
    out.push(genre !== null ? { id: r.id, title: title2, ref: r.id, items, genre } : { id: r.id, title: title2, ref: r.id, items });
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
  const store = makeRowsStore({ kino: kino2, ttlMs: SNAPSHOT_TTL_MS });
  const ids = makeIdsStore({ kino: kino2, clock: clock2 });
  const stale = (at) => {
    const age = clock2.now() - at;
    return age < 0 || age >= ROWS_FRESH_MS;
  };
  const trees = /* @__PURE__ */ new Map();
  let current;
  let dirty = false;
  const failedAt = /* @__PURE__ */ new Map();
  function getCurrent() {
    if (current === void 0) {
      const snap = store.read();
      current = snap ? { rows: snap.rows, roots: snap.roots, whole: new Set(snap.whole), withAll: /* @__PURE__ */ new Set() } : null;
    }
    return current;
  }
  function homeRowsCount(rows2) {
    let shown = 0;
    for (let n = 0; n < rows2.length; n++) {
      if (rows2[n].shown.some((i) => ITEM_ID2.test(i.id)) && ++shown >= MAX_HOME_ROWS) return n + 2;
    }
    return rows2.length;
  }
  function save() {
    dirty = false;
    const { rows: rows2, roots } = current;
    if (rows2.length === 0) return;
    const startedAt = clock2.now();
    const keepFull = homeRowsCount(rows2);
    const fit = fitRows(rows2, { keepFull });
    if (fit === null) {
      trace(kino2, "store", "skip", { what: "rows" });
      return;
    }
    if (fit.step > 0) trace(kino2, "store", "trim", { what: "rows", step: fit.step });
    const cut = fit.step === 0 ? /* @__PURE__ */ new Set() : new Set(rows2.slice(keepFull).filter((r) => r.shown.length > 1).map((r) => rootOfRow(r.id)));
    const whole2 = Object.keys(roots).filter((r) => current.whole.has(r) && !cut.has(r));
    try {
      store.write(fit.text, Math.min(...Object.values(roots)), roots, whole2);
      report(kino2, PERF_AREAS.store, "write", { b: msBucket(clock2.now() - startedAt), kb: kbBucket(fit.text.length), step: fit.step });
    } catch (e) {
      trace(kino2, "store", "full", { what: "rows", code: errCode(e) });
    }
  }
  let slowAt = null;
  const portalSlow = () => {
    if (slowAt === null) {
      try {
        const v = Number(kino2.storage.get(SLOW_KEY));
        slowAt = Number.isFinite(v) && v > 0 ? v : 0;
      } catch (_) {
        slowAt = 0;
      }
    }
    const age = clock2.now() - slowAt;
    return slowAt > 0 && age >= 0 && age < SLOW_MEMORY_MS;
  };
  const noteFetchMs = (ms) => {
    const slow = ms >= SLOW_FETCH_MS;
    if (slow === portalSlow()) {
      if (slow) slowAt = clock2.now();
      return;
    }
    slowAt = slow ? clock2.now() : 0;
    try {
      if (slow) kino2.storage.set(SLOW_KEY, String(slowAt), { ttlMs: SLOW_MEMORY_MS });
      else kino2.storage.remove(SLOW_KEY);
    } catch (_) {
    }
  };
  async function fetchRoot(root, deadline) {
    try {
      const response = await session.withValidSession((v) => portal.call(
        "getNextColumns",
        { columnCode: ROOT_CODES[root], pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
        { ...viewOpts(v), onFetchMs: noteFetchMs }
      ), { seedFallback: true, deadline });
      const sections = parseTree(response);
      return { sections: hasItems(sections) ? sections : [], error: null };
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
  function nextRoot(need, root, asked) {
    const cur = getCurrent();
    const roots = cur ? cur.roots : {};
    const all = KINDS.map((k) => k.root);
    const required = root !== null && all.includes(root) && (need === "section" ? !(cur && cur.whole.has(root)) : need === "full" ? !(cur && cur.withAll.has(root)) : false) ? [root] : [];
    const missing = all.filter((r) => !(r in roots));
    const stalest = all.filter((r) => r in roots && stale(roots[r])).sort((x, y) => roots[x] - roots[y]);
    const order = [.../* @__PURE__ */ new Set([...required, ...missing, ...stalest])].filter((r) => !asked.has(r));
    const failedRecently = (r) => failedAt.has(r) && clock2.now() - failedAt.get(r) < REFRESH_GAP_MS;
    if (cur) return order.find((r) => !failedRecently(r)) ?? null;
    return [...order].sort((x, y) => (failedAt.get(x) ?? -Infinity) - (failedAt.get(y) ?? -Infinity))[0] ?? null;
  }
  async function rootSlice(root, deadline) {
    const r = await sharedFetchRoot(root, deadline);
    if (r.error !== null) {
      failedAt.set(root, clock2.now());
      return r;
    }
    failedAt.delete(root);
    const at = clock2.now();
    trees.set(root, { sections: r.sections, at });
    const news = !current || !(root in current.roots) || stale(current.roots[root]);
    const roots = { ...current ? current.roots : {}, ...news ? { [root]: at } : {} };
    if (KINDS.every(({ root: k }) => trees.has(k) && !stale(trees.get(k).at))) {
      const rows2 = classify(Object.fromEntries(KINDS.map(({ root: k }) => [k, trees.get(k).sections])));
      const everyRoot = KINDS.map(({ root: k }) => k);
      current = { rows: rows2, roots: Object.fromEntries(everyRoot.map((k) => [k, trees.get(k).at])), whole: new Set(everyRoot), withAll: new Set(everyRoot) };
    } else {
      const rows2 = mergeRoot(current ? current.rows : [], root, classify({ [root]: r.sections }));
      current = { rows: rows2, roots, whole: /* @__PURE__ */ new Set([...current ? current.whole : [], root]), withAll: /* @__PURE__ */ new Set([...current ? current.withAll : [], root]) };
    }
    if (news) dirty = true;
    return r;
  }
  let served = null;
  const servedNow = () => {
    const cur = getCurrent();
    if (!cur) return "none";
    if (KINDS.some(({ root }) => !(root in cur.roots))) return "partial";
    return KINDS.some(({ root }) => stale(cur.roots[root])) ? "cache" : "fresh";
  };
  async function buildRows(need = "full", budgetMs = CALL_BUDGET_MS.home, root = null) {
    const startedAt = clock2.now();
    getCurrent();
    const warm = current !== null;
    const phaseEnd = Math.min(startedAt + (warm ? WARM_REFRESH_MS : COLD_DEADLINE_MS), startedAt + budgetMs - SLICE_MARGIN_MS);
    const storedBefore = warm ? Object.keys(current.roots).length : 0;
    const failed = [];
    let got = 0;
    let ensuring = null;
    let ensureError = null;
    const asked = /* @__PURE__ */ new Set();
    async function lane() {
      let next;
      while (ensureError === null && clock2.now() - startedAt < SLICE_START_MS && (next = nextRoot(need, root, asked)) !== null) {
        asked.add(next);
        try {
          await (ensuring ?? (ensuring = session.ensure({ deadline: phaseEnd })));
        } catch (e) {
          ensureError = e;
          break;
        }
        if (current === null && failed.length === 0 && got === 0) trace(kino2, "home", "refresh", { why: "cold" });
        const r = await rootSlice(next, phaseEnd);
        if (r.error !== null) failed.push(r);
        else got++;
      }
    }
    await Promise.all(Array.from({ length: !warm && portalSlow() ? COLD_PARALLEL : 1 }, lane));
    if (ensureError !== null && !current) throw slowPortal(kino2, ensureError);
    if (dirty) save();
    const storedAfter = current ? Object.keys(current.roots).length : 0;
    if (storedAfter > storedBefore && storedBefore < KINDS.length) {
      report(
        kino2,
        PERF_AREAS.cold,
        storedAfter === KINDS.length ? "done" : "progress",
        { stored: storedAfter, of: KINDS.length, b: msBucket(clock2.now() - startedAt) }
      );
    }
    served = { served: servedNow(), got, fail: failed.length };
    if (current) return current.rows;
    if (failed.length > 0) {
      summarizeFailure(failed, 1);
      throw slowPortal(kino2, worstOf(failed));
    }
    return [];
  }
  function rowMissing() {
    const cur = getCurrent();
    if (!cur || KINDS.some(({ root }) => !(root in cur.roots))) {
      throw kino2.error("unavailable", "Xuper todav\xEDa est\xE1 cargando su cat\xE1logo, intenta de nuevo en un momento");
    }
    throw kino2.error("not_found", "No se encontr\xF3 esa lista");
  }
  async function home2() {
    const live2 = countryRow ? countryRow(Math.min(clock2.now() + LIVE_ROW_MS, callDeadline(clock2, CALL_BUDGET_MS.home))).catch(() => null) : Promise.resolve(null);
    const rows2 = projectRows(await buildRows("home", CALL_BUDGET_MS.home), clock2.now(), ids.lookup(), isEnglish(kino2), isSpanish(kino2));
    const row2 = await live2;
    return row2 ? [...rows2.slice(0, MAX_HOME_ROWS - 1), row2] : rows2;
  }
  let adultInflight = null;
  let adultIds = /* @__PURE__ */ new Set();
  async function fetchAdult(deadline) {
    await session.ensure({ deadline });
    const response = await session.withValidSession((v) => portal.call(
      "getNextColumns",
      { columnCode: ADULT_ROOT_CODE, pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
      viewOpts(v)
    ), { seedFallback: true, deadline });
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    const listed = /* @__PURE__ */ new Set();
    for (const s of parseTree(response)) {
      for (const item of s.items) {
        listed.add(item.id);
        if (isSeries(item.type) || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    if (listed.size > 0) adultIds = listed;
    return out;
  }
  function adultMovies(deadline) {
    if (!adultInflight) adultInflight = fetchAdult(deadline).finally(() => {
      adultInflight = null;
    });
    return adultInflight;
  }
  const adultWithin = async (budgetMs) => {
    try {
      return await adultMovies(Math.min(clock2.now() + COLD_DEADLINE_MS, callDeadline(clock2, budgetMs)));
    } catch (e) {
      throw slowPortal(kino2, e);
    }
  };
  async function browseAdult(cursor) {
    const all = await adultWithin(CALL_BUDGET_MS.browse);
    const offset = offsetOf(cursor);
    const nowMs = clock2.now();
    const idsOf = ids.lookup();
    const items = all.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs, idsOf, isEnglish(kino2), isSpanish(kino2))).filter((i) => i !== null).map((i) => ({ ...i, adult: true }));
    const next = offset + BROWSE_PAGE;
    return next < all.length ? { items, next: String(next) } : { items };
  }
  async function browse2(ref, cursor) {
    if (ref === ADULT_REF) return browseAdult(cursor);
    const row2 = typeof ref === "string" ? (await buildRows("full", CALL_BUDGET_MS.browse, rootOfRow(ref))).find((r) => r.id === ref) : void 0;
    if (!row2) rowMissing();
    const offset = offsetOf(cursor);
    const nowMs = clock2.now();
    const list = row2.all ?? (offset === 0 ? row2.shown : []);
    const idsOf = ids.lookup();
    const items = list.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs, idsOf, isEnglish(kino2), isSpanish(kino2))).filter((i) => i !== null);
    const next = offset + BROWSE_PAGE;
    return row2.all && next < list.length ? { items, next: String(next) } : { items };
  }
  const { search: globalSearch } = makeSearch({ kino: kino2, portal, session, clock: clock2, tmdb, isAdultId: (id) => adultIds.has(id), idsLookup: ids.lookup });
  async function searchWithin(query) {
    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q === "") return { items: [] };
    const within = query.within;
    if (isLiveTileRef(within)) return null;
    const adult = within === ADULT_REF;
    let pool;
    if (adult) {
      pool = await adultWithin(CALL_BUDGET_MS.search);
    } else {
      const row2 = typeof within === "string" ? (await buildRows("full", CALL_BUDGET_MS.search, rootOfRow(within))).find((r) => r.id === within) : void 0;
      if (!row2) return null;
      pool = row2.all ?? row2.shown;
    }
    const ranked = rankWithin(kino2, pool, q);
    const offset = offsetOf(query.cursor);
    const nowMs = clock2.now();
    const idsOf = ids.lookup();
    const items = ranked.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs, idsOf, isEnglish(kino2), isSpanish(kino2))).filter((i) => i !== null).map((i) => adult ? { ...i, adult: true } : i);
    const next = offset + BROWSE_PAGE;
    return next < ranked.length ? { items, next: String(next) } : { items };
  }
  async function search2(query) {
    if (query !== null && typeof query === "object" && query.within !== void 0 && query.within !== null) return searchWithin(query);
    return globalSearch(query);
  }
  const portalChapters = makePortalChapters({ kino: kino2, portal, session, clock: clock2, onServed: (how) => {
    served = { served: how };
  }, ids });
  const episodes2 = makeEpisodes({ kino: kino2, tmdb, portalChapters, clock: clock2, ids });
  const rows = (need = "full", root = null) => buildRows(need, CALL_BUDGET_MS[need] ?? CALL_BUDGET_MS.home, root);
  const servedBy2 = () => {
    const out = served ?? {};
    served = null;
    return out;
  };
  const idsLookup = () => ids.lookup();
  return { home: home2, browse: browse2, rows, search: search2, episodes: episodes2, portalChapters, servedBy: servedBy2, idsLookup };
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
var AIR_DATE = /^\d{4}-\d{2}-\d{2}$/;
var MIN_RUNTIME = 1;
var MAX_RUNTIME = 1e3;
function bodyOf(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (_) {
      return null;
    }
  }
  return body !== null && typeof body === "object" ? body : null;
}
function parseTitleForms(type, body) {
  const o = bodyOf(body);
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
  const o = bodyOf(body);
  const tv = isObject(o) && Array.isArray(o.tv_results) && isObject(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt2(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}
function parseSeasonEpisodes(body) {
  const o = bodyOf(body);
  if (!isObject(o)) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObject).map((e) => {
    const episode = optInt2(e.episode_number);
    const name = text(e.name);
    const airDate = text(e.air_date).trim();
    const runtime = optInt2(e.runtime);
    return {
      episode,
      name: blank3(name) ? `Episodio ${episode}` : name,
      overview: text(e.overview),
      still: imageUrl(e.still_path, "w300"),
      airDate: AIR_DATE.test(airDate) ? airDate : "",
      runtimeMinutes: runtime >= MIN_RUNTIME && runtime <= MAX_RUNTIME ? runtime : 0
    };
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
      const kind = type === "movie" ? "movie" : "tv";
      const body = await read(`/${kind}/${id}`, { language: TMDB_LANGUAGE, append_to_response: "translations" }, bounds);
      return body === null ? null : parseTitleForms(kind, body);
    } catch (_) {
      return null;
    }
  }
  async function read(path, params, bounds) {
    try {
      if (timeoutFor(bounds) === null) return null;
      if (typeof kino2.tmdb === "function") {
        try {
          const body = await kino2.tmdb(path, { ...params });
          if (body !== null && typeof body === "object") return body;
        } catch (_) {
        }
      }
      const timeoutMs = timeoutFor(bounds);
      if (timeoutMs === null) return null;
      const key = keyMarker();
      if (!key) return null;
      const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
      const res = await kino2.fetch(`${TMDB_BASE}${path}?api_key=${key}&${query}`, { cookies: false, timeoutMs });
      if (!res || !res.ok) return null;
      return res.text();
    } catch (_) {
      return null;
    }
  }
  async function seriesByImdb(imdbId, bounds) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read(`/find/${imdbId}`, { external_source: "imdb_id", language: TMDB_LANGUAGE }, bounds);
    return body === null ? null : parseSeriesByImdb(body);
  }
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE, bounds) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read(`/tv/${tvId}/season/${season}`, { language }, bounds);
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
var MAX_ALTERNATIVES = 8;
var RETRY_COPIES = 3;
var RETRY_COPIES_SELF_RETRYING = 1;
var SELF_RETRYING_KINO = [0, 9, 54];
var APP_VERSION = /^(\d+)\.(\d+)\.(\d+)/;
var MAX_LABEL_CHARS = 48;
var EXPIRES_MIN_S = 30;
var EXPIRES_MAX_S = 86400;
var INT7 = /^[+-]?\d+$/;
function retryCopiesFor(kino2) {
  let version = "";
  try {
    version = kino2 && typeof kino2.appVersion === "string" ? kino2.appVersion.trim() : "";
  } catch (_) {
    return RETRY_COPIES;
  }
  const m = APP_VERSION.exec(version);
  if (!m) return RETRY_COPIES;
  const parts = m.slice(1, 4).map(Number);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] !== SELF_RETRYING_KINO[i]) return parts[i] > SELF_RETRYING_KINO[i] ? RETRY_COPIES_SELF_RETRYING : RETRY_COPIES;
  }
  return RETRY_COPIES_SELF_RETRYING;
}
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
var mediaScore = (m) => (optStringStrict(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (optStringStrict(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);
function rankedMedia(play) {
  const episode = isObject(play) ? objects(play.episodeList)[0] : void 0;
  if (!episode) return [];
  const candidates = objects(episode.totalMovieList).flatMap((tm) => objects(tm.movieList)).filter((m) => notBlank(optStringStrict(m.contentId)));
  return candidates.map((m, i) => ({ m, i, s: mediaScore(m) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.m);
}
var CODEC_NAMES = { h264: "H.264", avc: "H.264", h265: "H.265", hevc: "H.265", av1: "AV1", vp9: "VP9" };
var codecName = (m) => {
  const raw = optStringStrict(m.encodeFormat).trim();
  return CODEC_NAMES[raw.toLowerCase()] ?? raw.toUpperCase();
};
var labelOf = (text2) => text2.length <= MAX_LABEL_CHARS ? text2 : text2.slice(0, MAX_LABEL_CHARS).trimEnd();
function expiresInSeconds(auth, nowMs) {
  const m = EXPIRED.exec(typeof auth === "string" ? auth : "");
  if (!m) return null;
  const left = Number(m[1]) - Math.floor(nowMs / 1e3) - AUTH_MARGIN_S;
  if (!Number.isFinite(left)) return null;
  return Math.min(EXPIRES_MAX_S, Math.max(EXPIRES_MIN_S, left));
}
var licenseOf = (m) => optStringStrict(objects(m.licenseList)[0]?.license);
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
function vodCdns(slb) {
  const out = [];
  for (const cdn of objects(slb.cdn_list)) {
    if (optStringStrict(cdn.tag) !== "vod") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optStringStrict(u.url);
      if ((isCfl(url) || optStringStrict(u.sign_type) === "cfl") && optStringStrict(u.tag) === "free") {
        const bases = [withScheme(optStringStrict(cdn.main_addr))];
        const spare = optStringStrict(cdn.spared_addr);
        if (notBlank(spare) && !bases.includes(withScheme(spare.trim()))) bases.push(withScheme(spare.trim()));
        out.push({ bases, auth: url });
        break;
      }
    }
  }
  return out;
}
function vodCdn(slb) {
  const first = vodCdns(slb)[0];
  return first ? { base: first.bases[0], auth: first.auth } : null;
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
    const tracks = rankedMedia(play);
    const best = tracks[0];
    if (!best) throw unavailable("Xuper devolvi\xF3 sin media reproducible");
    const license = licenseOf(best);
    if (!notBlank(license)) throw unavailable("Xuper devolvi\xF3 sin licenseList");
    const cdns = vodCdns(await sessionSlb(played && played.sn ? played : null, deadline));
    if (cdns.length === 0) throw unavailable("Xuper no expuso CDN de vod con token libre");
    const copies = [];
    const seen = /* @__PURE__ */ new Set();
    const seenTracks = /* @__PURE__ */ new Set();
    const prefixes = /* @__PURE__ */ new Set();
    for (const track of tracks) {
      const id = optStringStrict(track.contentId);
      const trackLicense = track === best ? license : licenseOf(track);
      if (track !== best && (!notBlank(id) || !notBlank(trackLicense) || seenTracks.has(id))) continue;
      seenTracks.add(id);
      let prefix = "";
      if (track !== best) {
        const codec = codecName(track);
        prefix = codec !== "" ? codec : say(kino2, "versionN", { n: seenTracks.size });
        if (prefixes.has(prefix)) prefix = `${prefix} (${seenTracks.size})`;
        prefixes.add(prefix);
      }
      const ext = optStringStrict(track.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
      for (const [ci, cdn] of cdns.entries()) {
        for (const [bi, base] of cdn.bases.entries()) {
          const url = `${base}/vod/${id}_media.${ext}`;
          if (seen.has(url)) continue;
          seen.add(url);
          const server = `${say(kino2, "server", { n: ci + 1 })}${bi > 0 ? ` \xB7 ${say(kino2, "backup")}` : ""}`;
          copies.push({
            url,
            label: labelOf(prefix !== "" ? `${prefix} \xB7 ${server}` : server),
            mime: ext === "mp4" ? "video/mp4" : "video/mp2t",
            headers: {
              "Content-Auth": cdn.auth,
              // the querystring verbatim: VOD is not re-signed
              "Content-License": trackLicense,
              "User-Agent": UA_CDN,
              App: config.appId,
              "App-Version": config.apkVersion
            }
          });
        }
      }
    }
    const bestCopy = copies[0];
    const retryCopies = retryCopiesFor(kino2);
    for (let n = 1; bestCopy && n <= retryCopies && copies.length <= MAX_ALTERNATIVES; n++) {
      copies.push({
        ...bestCopy,
        url: `${bestCopy.url}${bestCopy.url.includes("?") ? "&" : "?"}retry=${n}`,
        label: labelOf(`${bestCopy.label} \xB7 ${say(kino2, "retry", { n })}`)
      });
    }
    const [first, ...others] = copies;
    const alternatives = others.slice(0, MAX_ALTERNATIVES);
    if (alternatives.length > 0) trace(kino2, "resolve", "alts", { n: alternatives.length, tracks: seenTracks.size, cdns: cdns.length });
    const expires = expiresInSeconds(first.headers["Content-Auth"], clock2.now());
    return {
      ...first,
      subtitles: readSubtitles(play),
      // A chapter's own declared duration wins (the portal sends it empty for most series).
      durationMs: chapter2 ? portalDurationMs(chapter2.duration) : portalDurationMs(best.duration),
      ...expires !== null ? { expiresInSeconds: expires } : {},
      ...alternatives.length > 0 ? { alternatives } : {}
    };
  }
  async function resolve2(ref, options) {
    if (live2 && isChannelRef(ref)) return live2.resolveLive(codeOfRef(ref), options);
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
      return items.length > 0 ? { id: COUNTRY_ROW_ID, title: say(kino2, "liveChannelsRow"), items } : null;
    } catch (e) {
      trace(kino2, "home", "live_row_fail", { code: errCode(e) });
      return null;
    }
  };
}

// src/liveCatalog.js
var LIVE_ROOT = "masnew_live";
var CATEGORIES_PAGE_SIZE = 200;
var LIST_PAGE_SIZE = 250;
var LIST_MAX_PAGES = 20;
var SWEEP_PAGE_SIZE = 500;
var MAX_PAGES2 = 10;
var MAX_CATEGORIES = 200;
var ID2 = /^[A-Za-z0-9._~-]{1,128}$/;
var POSITIVE = /^\d{1,9}$/;
var SEARCH_INDEX_TTL_MS = 60 * 6e4;
var PARTIAL_INDEX_TTL_MS = 3 * 6e4;
var MAX_SEARCH_HITS = 100;
var MIN_SEARCH_CHARS = 2;
var CATEGORIES_KEY = "liveCats:v2";
var OLD_CATEGORIES_KEYS = ["liveCats:v1"];
var CATEGORIES_TTL_MS = 12 * 36e5;
var LOGOS_KEY = "liveLogos:v1";
var LOGOS_TTL_MS = 7 * 24 * 36e5;
var MAX_LOGO_CHARS = 512;
var plain2 = (text2) => String(text2).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();
var ALL_CHANNELS = "ChannelList";
var NAMES = { [ALL_CHANNELS]: "Todos" };
var ADULT_NAMES = /* @__PURE__ */ new Set(["18+", "adultos", "adulto", "xxx", "+18"]);
var GENRE_BY_NAME = new Map(Object.entries({
  deportes: "deportes",
  deporte: "deportes",
  sports: "deportes",
  futbol: "deportes",
  noticias: "noticias",
  news: "noticias",
  infantil: "infantil",
  infantiles: "infantil",
  kids: "infantil",
  ninos: "infantil",
  musica: "musica",
  music: "musica",
  documentales: "documentales",
  documental: "documentales",
  peliculas: "peliculas",
  series: "series",
  anime: "anime",
  entretenimiento: "entretenimiento"
}));
var genreOfCategory = (name) => GENRE_BY_NAME.get(plain2(name)) ?? null;
var TILE_GENRE_BY_NAME = new Map(Object.entries({ "cine y series": "cineyseries" }));
var tileGenreOfCategory = (name) => genreOfCategory(name) ?? TILE_GENRE_BY_NAME.get(plain2(name)) ?? null;
var COUNTRY_BY_NAME = (() => {
  const codes = /* @__PURE__ */ new Map();
  for (const [cc, name] of Object.entries(CATEGORIES_BY_COUNTRY)) codes.set(plain2(name), codes.has(plain2(name)) ? null : cc);
  return codes;
})();
var countryOfCategory = (name) => COUNTRY_BY_NAME.get(plain2(name)) ?? null;
function makeLiveCatalog({ kino: kino2, portal, session, clock: clock2 }) {
  let adultIds = null;
  let genreById = null;
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
      out.push({ id: String(id), name, adult: ADULT_NAMES.has(name.trim().toLowerCase()), ...raw === ALL_CHANNELS ? { all: true } : {} });
    }
    if (out.length > 0) {
      adultIds = new Set(out.filter((c) => c.adult).map((c) => c.id));
      genreById = new Map(genreCategoriesOf(out).map((c) => [c.id, c.genre]));
      store(out);
    }
    return out;
  }
  const genreCategoriesOf = (list) => list.filter((c) => !c.adult && !c.all && POSITIVE.test(c.id) && Number(c.id) > 0).map((c) => ({ id: c.id, genre: tileGenreOfCategory(c.name) })).filter((c) => c.genre !== null);
  function store(list) {
    try {
      const rows = genreCategoriesOf(list).slice(0, MAX_CATEGORIES).map((c) => [c.id, c.genre]);
      kino2.storage.set(CATEGORIES_KEY, JSON.stringify(rows), { ttlMs: CATEGORIES_TTL_MS });
      for (const k of OLD_CATEGORIES_KEYS) kino2.storage.remove(k);
    } catch (_) {
    }
  }
  let logos;
  function genreLogos() {
    if (logos !== void 0) return logos;
    logos = {};
    try {
      const text2 = kino2.storage.get(LOGOS_KEY);
      const map = typeof text2 === "string" ? JSON.parse(text2) : null;
      if (isObject(map)) {
        for (const [g, url] of Object.entries(map)) if (usableLogo(url)) logos[g] = url;
      }
    } catch (_) {
    }
    return logos;
  }
  const usableLogo = (url) => typeof url === "string" && url.length <= MAX_LOGO_CHARS && url.startsWith("https://");
  function genreOfId(categoryId) {
    if (genreById !== null) return genreById.get(categoryId) ?? null;
    return storedGenreCategories()?.find((c) => c.id === categoryId)?.genre ?? null;
  }
  function noteLogo(categoryId, items) {
    try {
      const genre = genreOfId(categoryId);
      if (genre === null) return;
      const known = genreLogos();
      if (Object.hasOwn(known, genre)) return;
      const logo = items.find((c) => usableLogo(c.logo))?.logo;
      if (!logo) return;
      logos = { ...known, [genre]: logo };
      kino2.storage.set(LOGOS_KEY, JSON.stringify(logos), { ttlMs: LOGOS_TTL_MS });
    } catch (_) {
    }
  }
  function storedGenreCategories() {
    try {
      const text2 = kino2.storage.get(CATEGORIES_KEY);
      if (typeof text2 !== "string") return null;
      const rows = JSON.parse(text2);
      if (!Array.isArray(rows)) return null;
      return rows.filter((r) => Array.isArray(r) && typeof r[0] === "string" && POSITIVE.test(r[0]) && typeof r[1] === "string").map((r) => ({ id: r[0], genre: r[1] }));
    } catch (_) {
      return null;
    }
  }
  async function liveCategories2() {
    const all = await readCategories(callDeadline(clock2, CALL_BUDGET_MS.liveCategories));
    return all.filter((c) => ID2.test(c.id)).slice(0, MAX_CATEGORIES).map((c) => {
      if (c.adult) return { id: c.id, title: c.name, adult: true };
      const out = { id: c.id, title: c.all ? say(kino2, "allChannels") : c.name };
      const country = countryOfCategory(c.name);
      if (country !== null) out.country = country;
      const genre = genreOfCategory(c.name);
      if (genre !== null) out.genre = genre;
      return out;
    });
  }
  async function isAdultCategory(id, deadline) {
    if (adultIds === null) {
      await readCategories(deadline);
      if (adultIds === null) throw kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
    }
    return adultIds.has(id);
  }
  async function fetchPage(columnId, page, deadline, pageSize = LIST_PAGE_SIZE) {
    await session.ensure({ deadline });
    const response = await session.withValidSession(({ userId, userToken }) => portal.call(
      "v6/getLiveData",
      { columnId: Number(columnId), pageNum: page, pageSize, dataVersion: "", expireTimeStr: "" },
      { baseFields: true, userId, userToken, deadline }
    ), { deadline });
    return isObject(response) && Array.isArray(response.channelList) ? response.channelList : [];
  }
  function project(list, categoryId, adult, drops = {}) {
    const seen = /* @__PURE__ */ new Set();
    const items = [];
    const drop = (why) => {
      drops[why] = (drops[why] ?? 0) + 1;
    };
    for (const c of list) {
      if (!isObject(c)) {
        drop("shape");
        continue;
      }
      const code = asText(c.channelCode);
      const title2 = asText(c.name);
      if (isBlank(code) || isBlank(title2)) {
        drop("blank");
        continue;
      }
      const channel = channelOf(code);
      if (!channel) {
        drop("badid");
        continue;
      }
      if (seen.has(channel.id)) {
        drop("dup");
        continue;
      }
      seen.add(channel.id);
      const n = intOrNull(c.channelNumber);
      const item = { id: channel.id, title: title2, ref: channel.ref, categoryId, number: n !== null && n >= 1 && n <= 9999 ? n : 0 };
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
    if (page > LIST_MAX_PAGES) return { items: [] };
    try {
      const adult = await isAdultCategory(id, deadline);
      const list = await fetchPage(id, page, deadline);
      const drops = {};
      const items = project(list, id, adult, drops);
      if (!adult) noteLogo(id, items);
      trace(kino2, "live", "page", { cat: id, page, raw: list.length, kept: items.length, ...drops });
      return list.length >= LIST_PAGE_SIZE && page < LIST_MAX_PAGES ? { items, next: String(page + 1) } : { items };
    } catch (e) {
      if (page > 1) {
        trace(kino2, "live", "page_fail", { cat: id, page, code: errCode(e) });
        return { items: [] };
      }
      throw surface(e);
    }
  }
  const categoriesWithin = (deadline) => readCategories(deadline);
  async function channelsWithin(id, deadline) {
    const adult = await isAdultCategory(id, deadline);
    return project(await fetchPage(id, 1, deadline), id, adult);
  }
  let index = null;
  let partial = null;
  let sweeping = null;
  async function sweepCategory(category, into, deadline, read = { pages: 0 }) {
    for (let page = 1; page <= MAX_PAGES2; page++) {
      const list = await fetchPage(category.id, page, deadline, SWEEP_PAGE_SIZE);
      read.pages++;
      for (const item of project(list, category.id, category.adult)) {
        if (!into.has(item.id)) into.set(item.id, { ...item, adult: category.adult });
      }
      if (list.length < SWEEP_PAGE_SIZE) return;
    }
  }
  async function sweep(deadline) {
    const channels = /* @__PURE__ */ new Map();
    let complete = true;
    try {
      const all = (await readCategories(deadline)).filter((c) => ID2.test(c.id) && POSITIVE.test(c.id));
      if (all.length === 0) throw kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
      for (const c of all.filter((c2) => c2.adult)) await sweepCategory(c, channels, deadline);
      const everything = all.find((c) => c.all && !c.adult);
      const plainOnes = everything ? [everything] : all.filter((c) => !c.adult);
      const read = { pages: 0 };
      for (const c of plainOnes) {
        try {
          await sweepCategory(c, channels, deadline, read);
        } catch (e) {
          if (read.pages === 0) throw e;
          complete = false;
          trace(kino2, "live", "search_partial", { code: errCode(e), pages: read.pages });
          break;
        }
      }
    } catch (e) {
      throw surface(e);
    }
    return { complete, channels };
  }
  async function channelIndex(deadline) {
    if (index && clock2.now() - index.atMs < SEARCH_INDEX_TTL_MS) return index.channels;
    if (partial && clock2.now() - partial.atMs < PARTIAL_INDEX_TTL_MS) return partial.channels;
    sweeping ?? (sweeping = sweep(deadline).finally(() => {
      sweeping = null;
    }));
    const { complete, channels } = await sweeping;
    if (complete) {
      index = { atMs: clock2.now(), channels };
      partial = null;
    } else partial = { atMs: clock2.now(), channels };
    return channels;
  }
  async function liveSearch2(arg) {
    const raw = isObject(arg) && typeof arg.query === "string" ? arg.query : "";
    const q = plain2(raw);
    if (q.length < MIN_SEARCH_CHARS) return { items: [] };
    const deadline = callDeadline(clock2, CALL_BUDGET_MS.liveSearch);
    const channels = await channelIndex(deadline);
    const n = POSITIVE.test(q) ? Number(q) : null;
    const hits = [];
    for (const c of channels.values()) {
      const title2 = plain2(c.title);
      const rank = n !== null && c.number === n ? 0 : title2.startsWith(q) ? 1 : title2.includes(" " + q) ? 2 : title2.includes(q) ? 3 : -1;
      if (rank >= 0) hits.push({ c, rank, i: hits.length });
    }
    hits.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return { items: hits.slice(0, MAX_SEARCH_HITS).map((h) => ({ ...h.c })) };
  }
  const genreCategories = async (deadline) => storedGenreCategories() ?? genreCategoriesOf(await readCategories(deadline));
  async function channelsPage(id, page, size, deadline) {
    const list = await fetchPage(id, page, deadline, size);
    const items = project(list, id, false);
    noteLogo(id, items);
    return { items, full: list.length >= size };
  }
  return { liveCategories: liveCategories2, liveChannels: liveChannels2, categoriesWithin, channelsWithin, liveSearch: liveSearch2, genreCategories, genreLogos, channelsPage, surface };
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
function buildSignContext(license, cdns, builtAtMs) {
  const built = Number.isFinite(builtAtMs) ? { b: Math.trunc(builtAtMs / 1e3) } : {};
  const encode2 = (list, withToken) => JSON.stringify({
    l: license,
    c: list.map((d) => withToken ? { h: d.cflHost, a: d.authBase, t: tokenOf(d.authBase) } : { h: d.cflHost, a: d.authBase }),
    ...built
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
var NOT_LOGGED_IN = "aaa100028";
var INT8 = /^[+-]?\d+$/;
var ALTERNATE_HOST = /^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/;
var SERVED_MEMORY = 64;
var SLB_RESERVE_MS = 3e3;
var TEXT = {
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
        throw kino2.error("auth_required", "el canal necesita una cuenta (aaa100028)", { userMessage: say(kino2, "liveNeedsAccount") });
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
    const built = buildSignContext(signal.license, cdns, clock2.now());
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
    const primaryIndex = all.indexOf(built.kept[0]);
    trace(kino2, "live", "open", { cdns: all.length, kept: built.kept.length, primary: primaryIndex, alts: alternates.length, seed: !!seed, exp: expiresOf(slb) });
    if (primaryIndex > 0) report(kino2, "live_cdn", "skip", { primary: primaryIndex, of: all.length });
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
    report(kino2, "live_rotation", "conflict", { outcome: OUTCOME_WORDS[outcome] ?? outcome, tried: rotation.triedCount(code), of: MAX_ROTATIONS + 1 });
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
var TAB_LABELS_EN = Object.freeze({ peliculas: "Movies", series: "Series", infantil: "Kids", anime: "Anime" });
var MAX_HERO_TEXT = 300;
var rowsOfTab = (rows, tab, nowMs, idsOf = void 0, english = false, spanish = false) => projectRows(rows.filter((r) => rootOfRow(r.id) === tab), nowMs, idsOf, english, spanish);
function heroOf(rows) {
  for (const row2 of rows) {
    for (const item of row2.items) {
      if (item.adult === true || !item.backdrop || typeof item.overview !== "string" || item.overview.trim() === "") continue;
      const text2 = item.overview.trim();
      return {
        title: item.title,
        text: text2.length <= MAX_HERO_TEXT ? text2 : `${text2.slice(0, MAX_HERO_TEXT - 1).trimEnd()}\u2026`,
        image: item.backdrop
      };
    }
  }
  return null;
}
function makeSection({ kino: kino2, catalog, clock: clock2 }) {
  async function section2(arg) {
    const asked = arg !== null && typeof arg === "object" ? arg.tab : null;
    const tab = asked === null || asked === void 0 || asked === "" ? TABS[0].id : asked;
    if (!TABS.some((t) => t.id === tab)) throw kino2.error("not_found", "No se encontr\xF3 esa pesta\xF1a");
    const rows = await catalog.rows("section", tab);
    const idsOf = typeof catalog.idsLookup === "function" ? catalog.idsLookup() : void 0;
    const english = isEnglish(kino2);
    const tabRows = rowsOfTab(rows, tab, clock2.now(), idsOf, english, isSpanish(kino2));
    const hero = heroOf(tabRows);
    const tabs = TABS.map((t) => ({ id: t.id, label: english ? TAB_LABELS_EN[t.id] : t.label }));
    return { tabs, tab, ...hero ? { hero } : {}, rows: tabRows };
  }
  return { section: section2 };
}

// src/categories.js
var MAX_CATEGORIES2 = 24;
var MAX_TITLE = 40;
function tilesOf(rows, english = false) {
  const out = [];
  for (const r of rows) {
    if (out.length >= MAX_CATEGORIES2) break;
    if (r.shown.length === 0) continue;
    const first = r.shown[0];
    const art = first.backdrop && first.backdrop.trim() || first.poster && first.poster.trim() || null;
    const tile = { id: r.id, title: localizedRowTitle(r, english).slice(0, MAX_TITLE), ref: r.id };
    if (art) tile.art = art;
    out.push(tile);
  }
  return out;
}
var ADULT_TILE = Object.freeze({ id: ADULT_REF, title: "18+", ref: ADULT_REF, adult: true });
function makeCategories({ catalog, kino: kino2 = null, liveTiles = null }) {
  return {
    // An empty catalog stays empty: an 18+ tile alone would be the only thing Xuper offers. Live tiles alone
    // are shown (the VOD catalog failing must not hide them, nor they it: tiles() never throws).
    categories: async () => {
      const [rows, live2] = await Promise.all([
        catalog.rows("categories").then((r) => ({ r }), (e) => ({ e })),
        liveTiles ? liveTiles.tiles() : Promise.resolve([])
      ]);
      if (rows.e && live2.length === 0) throw rows.e;
      const tiles = rows.e ? [] : tilesOf(rows.r, isEnglish(kino2));
      if (tiles.length === 0) return live2;
      return [...tiles.slice(0, MAX_CATEGORIES2 - 1 - live2.length), ...live2, { ...ADULT_TILE }];
    }
  };
}

// src/seedContrib.js
var CONTRIB_INTERVAL_MS = 10 * 36e5;
var VALIDATE_COLUMN = "masnew_movies";
var REQUEST_MS = 1e4;
var TOTAL_MS = 25e3;
var AT_KEY = "seedContribAt";
var CONTRIBUTE_SETTING = "contributeSeeds";
var OPTIONAL_EXTRAS = ["customer", "activeTime", "availableTime"];
var str4 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
function hasRealData(col) {
  if (col === null || typeof col !== "object") return false;
  if (Array.isArray(col)) return col.length > 0;
  return Object.keys(col).length > 0;
}
function makeSeedContrib({ kino: kino2, portal, clock: clock2 }) {
  const fingerprint = makeFingerprint(kino2);
  let running = false;
  const enabled = () => {
    try {
      return kino2.config.get(CONTRIBUTE_SETTING) !== false;
    } catch (_) {
      return true;
    }
  };
  const readAt = () => {
    try {
      const v = Number(kino2.storage.get(AT_KEY));
      return Number.isFinite(v) && v > 0 ? v : null;
    } catch (_) {
      return null;
    }
  };
  const stampAt = (now) => {
    try {
      kino2.storage.set(AT_KEY, String(now));
    } catch (_) {
    }
  };
  async function mintAnonymous() {
    const bounds = { timeoutMs: REQUEST_MS, deadline: clock2.now() + TOTAL_MS };
    try {
      const mint = await portal.call("v3/snToken", fingerprint(), { baseFields: false, ...bounds });
      if (blank(mint && mint.snToken)) {
        trace(kino2, "seed_contrib", "mint", { ok: false, why: "no_sntoken" });
        return null;
      }
      const snToken = str4(mint.snToken);
      const sn = snFrom(kino2, mint, snToken);
      const act = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
      if (blank(act && act.userToken) || blank(act && act.userId)) {
        trace(kino2, "seed_contrib", "mint", { ok: false, why: "no_token" });
        return null;
      }
      const col = await portal.call(
        "getNextColumns",
        { columnCode: VALIDATE_COLUMN, pageNum: 1, pageSize: 1, version: "" },
        { baseFields: true, userId: str4(act.userId), userToken: str4(act.userToken), sn, ...bounds }
      );
      if (!hasRealData(col)) {
        trace(kino2, "seed_contrib", "validate", { ok: false, why: "empty" });
        return null;
      }
      return buildSeed(sn, act);
    } catch (e) {
      if (e instanceof PortalError || isKinoError(e)) {
        trace(kino2, "seed_contrib", "mint", { ok: false, code: errCode(e) });
        return null;
      }
      trace(kino2, "seed_contrib", "mint", { ok: false, why: "bug", code: errCode(e) });
      return null;
    }
  }
  function buildSeed(sn, act) {
    const seed = {
      sn,
      userId: str4(act.userId),
      userToken: str4(act.userToken),
      jwtToken: str4(act.jwtToken || ""),
      mintedAt: Math.floor(clock2.now() / 1e3)
    };
    for (const k of OPTIONAL_EXTRAS) {
      const v = act[k];
      if (typeof v === "string" && v !== "") seed[k] = v;
      else if (typeof v === "number" && Number.isFinite(v)) seed[k] = v;
    }
    return seed;
  }
  async function maybeContribute() {
    if (running) return null;
    running = true;
    try {
      if (typeof kino2.seed !== "function") return null;
      if (!enabled()) {
        trace(kino2, "seed_contrib", "skip", { why: "off" });
        return null;
      }
      const now = clock2.now();
      const last = readAt();
      if (last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS) {
        trace(kino2, "seed_contrib", "skip", { why: "rate" });
        return null;
      }
      stampAt(now);
      const seed = await mintAnonymous();
      if (!seed) return null;
      try {
        kino2.seed(seed);
      } catch (_) {
      }
      trace(kino2, "seed_contrib", "done", { ok: 1, jwt: seed.jwtToken ? 1 : 0 });
      return seed;
    } catch (_) {
      return null;
    } finally {
      running = false;
    }
  }
  return { maybeContribute };
}

// src/wiring.js
var deps = null;
var clock = { now: () => Date.now() };
function getDeps() {
  if (deps) return deps;
  const crypto = makeCrypto(kino, { onDecode: makeDecodeReporter(kino) });
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
  const liveTiles = makeLiveTiles({ kino, live: live2, clock });
  const categories2 = makeCategories({ catalog, kino, liveTiles });
  const seedContrib = makeSeedContrib({ kino, portal, clock });
  deps = { clock, crypto, portal, session, tmdb, catalog, resolve: resolve2, live: live2, liveStream, section: section2, categories: categories2, liveTiles, seedContrib };
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
  const id = typeof input.code === "string" ? idOfCode(input.code) : null;
  return id === null ? null : { kind: "live", code: id };
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
var str5 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var clip = (text2, max) => text2.length <= max ? text2 : text2.slice(0, max - 1) + "\u2026";
var refusedCredentials = (e) => e !== null && typeof e === "object" && (e.name === "KinoError_auth_required" || e.name === "PortalError");
function makeSettings({ kino: kino2, session, clock: clock2, registration }) {
  const surface = (e) => {
    if (isKinoError(e)) return e;
    trace(kino2, "settings", "fail", { code: errCode(e) });
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  const savedAccount = () => ({ email: str5(kino2.config.get("email")).trim(), password: str5(kino2.config.get("password")).trim() });
  async function settingsStatus2() {
    await null;
    try {
      const account = session.kind() === "account";
      const state = session.accountState();
      const shared = session.sharedConfigured();
      const anonymous = state === "pending" ? say(kino2, "statusConnecting", { who: say(kino2, shared ? "whoShared" : "whoOwn") }) : state === "refused" ? say(kino2, shared ? "statusSharedBroken" : "statusOwnRefused") : say(kino2, "statusAnonymous");
      const who = session.usingShared() ? say(kino2, "statusShared") : say(kino2, "statusConnectedAs", { email: savedAccount().email });
      const parts = [account ? who : anonymous];
      if (!account && session.regionBlocked()) {
        const n = session.seedPool().length;
        parts.push(n > 0 ? say(kino2, "statusBlockedSeeds", { n }) : say(kino2, "statusBlockedNoSeeds"));
        if (session.seedsExhausted()) parts.push(say(kino2, "seedsBanner"));
        else if (kino2.config.get("autoRefreshSeeds") === false) parts.push(say(kino2, "statusAutoRefreshOff"));
      }
      const text2 = parts.length === 1 ? parts[0] : parts.join(". ") + ".";
      return { status: clip(text2, STATUS_MAX) };
    } catch (_) {
      return { status: say(kino2, "statusUnknown") };
    }
  }
  async function login() {
    const { email, password } = savedAccount();
    if (email === "" || password === "") throw told(kino2, "auth_required", "Escribe tu correo y contrase\xF1a en Ajustes", say(kino2, "fillAccount"));
    const bounds = { timeoutMs: LOGIN_REQUEST_MS, deadline: clock2.now() + LOGIN_TOTAL_MS };
    try {
      await session.login(email, password, bounds);
    } catch (e) {
      throw refusedCredentials(e) ? told(kino2, "auth_required", "Credenciales de Xuper inv\xE1lidas", say(kino2, "accountRefused")) : surface(e);
    }
    return { message: say(kino2, "signedIn"), refresh: true };
  }
  async function logout() {
    try {
      await session.logout({ timeoutMs: LOGOUT_REQUEST_MS, deadline: clock2.now() + LOGOUT_TOTAL_MS });
    } catch (e) {
      throw surface(e);
    }
    return { message: say(kino2, "signedOut"), refresh: true, clearSettings: ["email", "password", "useSharedAccount"] };
  }
  async function switchSeed() {
    let r;
    try {
      r = await session.switchSeed({ timeoutMs: SEED_PROBE_MS, deadline: clock2.now() + SEED_SWITCH_TOTAL_MS });
    } catch (e) {
      throw surface(e);
    }
    const message = r.result === "ok" ? say(kino2, "seedSwitched", { n: r.tries }) : r.result === "offline" ? say(kino2, "offlineRetry") : r.result === "account_linked" ? say(kino2, "accountNoSeeds") : r.result === "no_other_seed" ? say(kino2, "noOtherSeed") : say(kino2, "seedsAllFailed", { n: r.tries });
    return { message, refresh: true };
  }
  async function refreshSeeds() {
    let ok;
    try {
      ok = await session.refreshSeeds({ timeoutMs: SEED_DOWNLOAD_MS, manual: true });
    } catch (e) {
      throw surface(e);
    }
    return { message: ok ? say(kino2, "seedsLoaded", { n: session.seedPool().length }) : say(kino2, "offlineRetry"), refresh: true };
  }
  function typedEmail() {
    const { email } = savedAccount();
    if (email === "") throw told(kino2, "auth_required", "Escribe tu correo en Ajustes", say(kino2, "fillEmail"));
    if (!email.includes("@")) throw told(kino2, "auth_required", "Escribe un correo v\xE1lido", say(kino2, "badEmail"));
    return email;
  }
  async function sendCode() {
    const email = typedEmail();
    const prev = registration.pendingFor(email);
    if (prev && prev.at !== null && clock2.now() >= prev.at && clock2.now() - prev.at < RESEND_WAIT_MS) {
      return { message: say(kino2, "codeAlreadySent") };
    }
    const bounds = { timeoutMs: SEND_CODE_REQUEST_MS, deadline: clock2.now() + SEND_CODE_TOTAL_MS };
    try {
      await registration.sendRegistrationCode(email, bounds);
    } catch (e) {
      throw surface(e);
    }
    return { message: say(kino2, "codeSent", { email }) };
  }
  async function register() {
    const email = typedEmail();
    const code = str5(kino2.config.get("verifyCode")).trim();
    if (code === "") throw told(kino2, "auth_required", "Escribe el c\xF3digo de verificaci\xF3n", say(kino2, "fillCode"));
    const { password } = savedAccount();
    if (password === "") throw told(kino2, "auth_required", "Escribe tu contrase\xF1a en Ajustes", say(kino2, "fillAccount"));
    const pending = registration.pendingFor(email);
    if (!pending) throw told(kino2, "unavailable", "Pide el c\xF3digo otra vez", say(kino2, "askCodeAgain"));
    const bounds = { timeoutMs: REGISTER_REQUEST_MS, deadline: clock2.now() + REGISTER_TOTAL_MS };
    let done;
    try {
      done = await registration.confirmRegistration(pending, code, password, bounds);
    } catch (e) {
      throw surface(e);
    }
    const message = done && done.loggedIn === false ? say(kino2, "accountCreatedSignIn") : say(kino2, "accountCreatedSignedIn");
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
    const email = str5(v.email).trim(), password = str5(v.password).trim();
    const sharedOn = v.useSharedAccount === true || v.useSharedAccount === "true";
    if (sharedOn && email === "" && password === "") {
      const bounds2 = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock2.now() + VALIDATE_TOTAL_MS };
      try {
        await session.useShared(bounds2);
        return null;
      } catch (e) {
        if (refusedCredentials(e)) return { useSharedAccount: say(kino2, "sharedActivationFailed") };
        throw surface(e);
      }
    }
    if (email === "" && password === "") return null;
    const errors = {};
    if (sharedOn) errors.useSharedAccount = say(kino2, "removeAccountOrShared");
    if (email === "") errors.email = say(kino2, "enterEmail");
    else if (!email.includes("@")) errors.email = say(kino2, "enterValidEmail");
    if (Object.keys(errors).length > 0) return errors;
    if (password === "") return null;
    const bounds = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock2.now() + VALIDATE_TOTAL_MS };
    try {
      await session.login(email, password, bounds);
      return null;
    } catch (e) {
      if (refusedCredentials(e)) {
        const creating = str5(v.verifyCode).trim() !== "" || registration !== void 0 && registration !== null && registration.pendingFor(email) !== null;
        return creating ? null : { password: say(kino2, "credentialsRefused") };
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
var NOT_SAVED = "No se pudo guardar el pedido; int\xE9ntalo de nuevo";
var CONFIRM_FAILED = "C\xF3digo inv\xE1lido o cuenta ya registrada";
var str6 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
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
      if (!o || typeof o !== "object" || blank(o.userToken) || blank(o.sn) || str6(o.email) !== email) return null;
      return { userId: str6(o.userId), userToken: str6(o.userToken), sn: str6(o.sn), email: str6(o.email), at: typeof o.at === "number" ? o.at : null };
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
      const snToken = str6(mint.snToken);
      const sn = snFrom(kino2, mint, snToken);
      const act = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
      if (blank(act && act.userToken)) throw new PortalError("active_sin_token", "activaci\xF3n sin userToken");
      const pending = { userId: str6(act.userId), userToken: str6(act.userToken), sn, email, at: clock2.now() };
      await portal.call(
        "v2/sendEmailVerifyCode",
        { email, type: "1", userId: pending.userId, userToken: pending.userToken },
        { baseFields: false, sn, ...bounds }
      );
      if (!savePending(pending)) throw told(kino2, "unavailable", NOT_SAVED, say(kino2, "requestNotSaved"));
      return pending;
    } catch (e) {
      throw failure(e, SEND_FAILED, say(kino2, "sendCodeFailed"));
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
      throw failure(e, CONFIRM_FAILED, say(kino2, "codeRefused"));
    }
    dropPending();
    return { loggedIn: true };
  }
  return { sendRegistrationCode, confirmRegistration, pendingFor };
}

// src/plugin.js
var servedBy = () => getDeps().catalog.servedBy();
async function search(query) {
  await null;
  let scoped = false;
  try {
    scoped = query !== null && typeof query === "object" && query.within !== void 0 && query.within !== null;
  } catch (_) {
    scoped = false;
  }
  return traced(kino, clock, "search", () => guarded(({ catalog }) => catalog.search(query)), scoped ? { scope: "within" } : {}, servedBy);
}
async function home() {
  await null;
  const out = await traced(kino, clock, "home", () => guarded(({ catalog }) => catalog.home()), {}, servedBy);
  try {
    Promise.resolve(getDeps().seedContrib.maybeContribute()).catch(() => {
    });
  } catch (_) {
  }
  return out;
}
async function browse(ref, cursor) {
  await null;
  const live2 = isLiveTileRef(ref);
  return traced(
    kino,
    clock,
    "browse",
    () => guarded(({ catalog, liveTiles }) => live2 ? liveTiles.browse(ref, cursor) : catalog.browse(ref, cursor)),
    live2 ? { kind: "live" } : {},
    servedBy
  );
}
async function section(arg) {
  await null;
  return traced(kino, clock, "section", () => guarded(({ section: s }) => s.section(arg)), {}, servedBy);
}
async function categories() {
  await null;
  return traced(kino, clock, "categories", () => guarded(({ categories: c }) => c.categories()), {}, servedBy);
}
async function episodes(ref) {
  await null;
  return traced(kino, clock, "episodes", () => guarded(({ catalog }) => catalog.episodes(ref)), {}, servedBy);
}
async function resolve(ref, options) {
  await null;
  return traced(kino, clock, "resolve", () => guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options)), { kind: isChannelRef(ref) ? "live" : "vod" }, servedBy);
}
async function sign(request) {
  await null;
  try {
    return signRequest(request, clock.now());
  } catch (e) {
    if (isKinoError(e)) throw e;
    report(kino, "sign", "fail", { why: typeof e?.why === "string" ? e.why : errCode(e) });
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
async function liveSearch(args) {
  await null;
  return traced(kino, clock, "liveSearch", () => guarded(({ live: live2 }) => live2.liveSearch(args)));
}
var migrator = makeMigrate();
async function migrate(input) {
  await null;
  try {
    return await traced(kino, clock, "migrate", () => migrator.migrate(input), { kind: input && typeof input.kind === "string" ? input.kind : "?" });
  } catch (e) {
    if (isKinoError(e)) throw e;
    report(kino, "migrate", "fail", { code: errCode(e) });
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
    return await traced(kino, clock, "settingsStatus", () => settings().settingsStatus());
  } catch (e) {
    trace(kino, "settings", "status_fail", { code: errCode(e) });
    return { status: "No se pudo consultar el estado" };
  }
}
async function action(key) {
  await null;
  try {
    return await traced(kino, clock, "action", () => settings().action(key), { key: typeof key === "string" ? key : "?" });
  } catch (e) {
    if (isKinoError(e)) throw e;
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}
async function validateSettings(values) {
  await null;
  try {
    return await traced(kino, clock, "validateSettings", () => settings().validateSettings(values));
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
  liveSearch,
  migrate,
  resolve,
  search,
  section,
  settingsStatus,
  sign,
  validateSettings
};
