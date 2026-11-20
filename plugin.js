// src/config.js
var DEFAULT_SERVER = "https://x.xkplugins.site";
var PLUGIN_VERSION = "3.0.8";
var SUPPORT_URL = "https://ko-fi.com/xuperplugins";
var PLUGIN_ID = "xuper";
var DRM_DECLARED = true;
var DATA_BASE = typeof XUPER_DATA_BASE === "string" ? XUPER_DATA_BASE : "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/data/";
var RELEASE_BASE = typeof XUPER_RELEASE_BASE === "string" ? XUPER_RELEASE_BASE : "https://github.com/xuper-plugin/kino-plugin-xuper/releases/download/catalog";
function serverUrl() {
  return DEFAULT_SERVER;
}
function lang() {
  try {
    return (typeof kino !== "undefined" && kino.lang) === "en" ? "en" : "es";
  } catch (_) {
    return "es";
  }
}
function httpImages() {
  try {
    return typeof kino !== "undefined" && !!kino && !!kino.screen && kino.screen.httpImages === true;
  } catch (_) {
    return false;
  }
}
function localTitle(t2) {
  if (t2 && typeof t2 === "object") return String((lang() === "en" ? t2.en : t2.es) || t2.es || t2.en || "");
  return String(t2 == null ? "" : t2);
}
var SECTIONS = [
  { name: "populares", title: "Populares", titleEn: "Popular", genre: "otros" },
  { name: "pelicula", title: "Pel\xEDculas", titleEn: "Movies", genre: "peliculas" },
  { name: "series", title: "Series", titleEn: "Series", genre: "series" },
  { name: "anime", title: "Anime", titleEn: "Anime", genre: "anime" },
  { name: "ninos", title: "Ni\xF1os", titleEn: "Kids", genre: "infantil" },
  { name: "adultos", title: "Adultos", titleEn: "Adults", genre: "otros", adult: true }
];

// src/store.js
var KEY_PREFIX = "o2:";
function storage() {
  return typeof kino !== "undefined" && kino && kino.storage ? kino.storage : null;
}
function log(m) {
  try {
    kino.log("store: " + m);
  } catch (_) {
  }
}
function getText(key) {
  const s = storage();
  if (!s) return null;
  try {
    const v = s.get(key);
    return typeof v === "string" ? v : null;
  } catch (_) {
    return null;
  }
}
function getJson(key) {
  const t2 = getText(key);
  if (t2 === null) return null;
  try {
    return JSON.parse(t2);
  } catch (_) {
    remove(key);
    return null;
  }
}
function setText(key, text2, opts) {
  if (typeof text2 !== "string") throw new TypeError("store.setText(" + key + "): the value must be a string");
  const s = storage();
  if (!s) return false;
  try {
    if (opts && opts.ttlMs) s.set(key, text2, { ttlMs: opts.ttlMs });
    else s.set(key, text2);
    return true;
  } catch (e) {
    log("set " + key + " failed: " + (e && (e.code || e.message) || e));
    return false;
  }
}
function setJson(key, obj, opts) {
  return setText(key, JSON.stringify(obj), opts);
}
function remove(key) {
  const s = storage();
  if (!s) return;
  try {
    s.remove(key);
  } catch (_) {
  }
}
function keys() {
  const s = storage();
  if (!s || typeof s.keys !== "function") return [];
  try {
    const k = s.keys();
    return Array.isArray(k) ? k : [];
  } catch (_) {
    return [];
  }
}
function sweepOld() {
  let n = 0;
  for (const k of keys()) {
    if (typeof k !== "string" || k.startsWith(KEY_PREFIX)) continue;
    remove(k);
    n++;
  }
  if (n) log("removed " + n + " keys an older version left");
  return n;
}

// src/flight.js
var flights = /* @__PURE__ */ new Map();
var seq = 0;
var startedAt = 0;
function beginCall() {
  flights.clear();
  seq++;
  startedAt = Date.now();
}
function once(key, fn, opts) {
  const force = !!(opts && opts.force);
  let p = force ? void 0 : flights.get(key);
  if (!p) {
    p = Promise.resolve().then(fn);
    flights.set(key, p);
  }
  return p;
}
function inFlight(key) {
  return flights.has(key);
}
function callStartedAt() {
  return startedAt || Date.now();
}
var CLOCK_SKEW_MS = 60 * 1e3;
function saneAt(at2, now) {
  const n = Number(at2) || 0;
  return n > (now === void 0 ? Date.now() : now) + CLOCK_SKEW_MS ? 0 : n;
}
function callSeq() {
  return seq;
}
var purpose = { seq: -1, name: "" };
function callFor(name) {
  purpose = { seq, name: String(name || "") };
}
function callName() {
  return purpose.seq === seq ? purpose.name : "";
}

// src/api.js
var _bearer = null;
var BEARER_KEY = "o2:bearer";
var RELOGIN_KEY = "o2:relogin";
function log2(m) {
  try {
    kino.log("" + m);
  } catch (_) {
  }
}
var t = (es, en6) => lang() === "en" ? en6 : es;
function jsonBody(body) {
  return body === void 0 ? void 0 : { json: body };
}
async function rawBackend(method, path, body, bearer, timeoutMs = 2e4) {
  const headers = { "Content-Type": "application/json", "X-Plugin-Version": PLUGIN_VERSION };
  if (bearer) headers["Authorization"] = "Bearer " + bearer;
  return kino.fetch(serverUrl() + path, {
    method,
    headers,
    body: jsonBody(body),
    cookies: false,
    timeoutMs
  });
}
async function storedBearer() {
  if (_bearer) return _bearer;
  _bearer = getText(BEARER_KEY);
  return _bearer || null;
}
function dropBearer() {
  _bearer = null;
  remove(BEARER_KEY);
}
function notActivatedText(lng) {
  const es = "Abre Xuper desde el men\xFA para activarlo y vuelve a intentarlo.";
  const enText = "Open Xuper from the menu to activate it, then try again.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}
function notActivated() {
  return kino.error("auth_required", "Xuper: not activated", { userMessage: notActivatedText() });
}
function tokenMissing() {
  const e = kino.error("auth_required", "Xuper: identity answered without the token");
  try {
    e.noToken = true;
  } catch (_) {
  }
  return e;
}
function isTokenMissing(e) {
  return !!e && (e.noToken === true || /answered without the token/.test(String(e.message || "")));
}
async function mintSession() {
  const ch = await rawBackend("POST", "/session/challenge", void 0, null);
  log2("mint: challenge -> " + ch.status);
  if (!ch.ok) {
    const reason = reasonOf(ch);
    log2("mint: challenge FAIL status=" + ch.status + reason);
    throw withCause(kino.error("unavailable", t("Xuper: el servidor no respondi\xF3 (" + ch.status + ")", "Xuper: the server did not answer (" + ch.status + ")")), "challenge_" + ch.status + reason);
  }
  const challenge = ch.json().challenge;
  let idn;
  try {
    idn = await kino.identity.telegram({ challenge });
  } catch (e) {
    log2("mint: identity FAIL code=" + (e && e.code) + " msg=" + (e && (e.message || e)));
    throw e;
  }
  log2("mint: identity OK author=" + (idn && idn.author) + " token=" + !!(idn && idn.token) + " sig=" + !!(idn && idn.signature) + " dk=" + !!(idn && idn.deviceKey) + " ch=" + !!(idn && idn.codeHash));
  if (!idn || typeof idn.token !== "string" || !idn.token) throw tokenMissing();
  const res = await rawBackend("POST", "/session", {
    token: idn.token,
    challenge,
    deviceKey: idn.deviceKey,
    signature: idn.signature,
    author: idn.author,
    codeHash: idn.codeHash,
    pluginId: PLUGIN_ID
  }, null);
  log2("mint: /session -> " + res.status);
  if (!res.ok) {
    const reason = reasonOf(res);
    log2("mint: /session FAIL status=" + res.status + reason);
    const msg = res.status === 403 ? t("Xuper: esta instalaci\xF3n no est\xE1 autorizada", "Xuper: this install is not authorized") : t("Xuper: no se pudo iniciar sesi\xF3n (" + res.status + ")", "Xuper: could not sign in (" + res.status + ")");
    throw withCause(kino.error("unavailable", msg), "session_" + res.status + reason);
  }
  const session = res.json().session;
  if (!session) throw withCause(kino.error("unavailable", t("Xuper: el servidor no devolvi\xF3 la sesi\xF3n", "Xuper: the server returned no session")), "no_session");
  return session;
}
function withCause(e, cause) {
  try {
    e.actCause = cause;
  } catch (_) {
  }
  return e;
}
function reasonOf(res) {
  try {
    const j = res.json();
    const d = j && typeof j.detail === "string" ? j.detail.slice(0, 40) : "";
    return d ? ":" + d.replace(/[^A-Za-z0-9]+/g, "_") : "";
  } catch (_) {
    return "";
  }
}
function activateCause(e) {
  if (isTokenMissing(e)) return "update_needed";
  const code = e && e.code;
  if (code === "permission_denied") return "consent_denied";
  if (code === "not_available") return "identity_off";
  if (code === "bad_request") return "identity_bad_request";
  if (e && typeof e.actCause === "string") return e.actCause;
  if (code) return "err_" + String(code).replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 24);
  return "unknown";
}
function reportActivate(e) {
  try {
    kino.log.report("activate_fail cause=" + activateCause(e));
  } catch (_) {
  }
}
async function currentBearer() {
  return storedBearer();
}
async function clearBearer() {
  dropBearer();
  remove(RELOGIN_KEY);
  remove(TRIAL_KEY);
}
function reloginPending() {
  return getText(RELOGIN_KEY) === "1";
}
function forgetRelogin() {
  remove(RELOGIN_KEY);
}
async function markRelogin() {
  if (await storedBearer()) return false;
  setText(RELOGIN_KEY, "1");
  return true;
}
var _minting = null;
async function ensureBearer() {
  const b = await storedBearer();
  if (b) return b;
  if (_minting) return _minting;
  _minting = (async () => {
    try {
      const bearer = await mintSession();
      _bearer = bearer;
      setText(BEARER_KEY, String(bearer));
      remove(RELOGIN_KEY);
      remove(TRIAL_KEY);
      return bearer;
    } finally {
      _minting = null;
    }
  })();
  return _minting;
}
function sessionExpiredText(lng) {
  const es = "La sesi\xF3n venci\xF3. Abre la pantalla de Xuper para reconectarte.";
  const enText = "The session expired. Open the Xuper screen to reconnect.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}
function bearerRefused(b) {
  if (getText(BEARER_KEY) === b) {
    log2("session refused by the backend (401): forgotten; the screen signs in again on its next opening");
    dropBearer();
    setText(RELOGIN_KEY, "1");
  } else if (_bearer === b) _bearer = null;
}
var RL_KEY = "o2:rl";
var RL_MIN_MS = 6e4;
var RL_MAX_MS = 10 * 6e4;
var _rl = null;
function familyOf(path) {
  const m = /^\/*([^/?#]+)/.exec(String(path == null ? "" : path));
  return m ? m[1].toLowerCase() : "";
}
function rlMap() {
  if (!_rl) {
    _rl = {};
    const s = getJson(RL_KEY);
    if (s && typeof s === "object" && !Array.isArray(s)) for (const k of Object.keys(s)) {
      const v = Number(s[k]);
      if (v > 0) _rl[k] = v;
    }
  }
  return _rl;
}
function limitedUntil(fam, now = Date.now()) {
  const u = Number(rlMap()[fam]) || 0;
  return u > now && u - now <= RL_MAX_MS ? u : 0;
}
function retryAfterMs(res) {
  const h = res && res.headers || {};
  const v = Number(h["retry-after"] != null ? h["retry-after"] : h["Retry-After"]);
  return Number.isFinite(v) && v > 0 ? v * 1e3 : 0;
}
function noteLimited(fam, res) {
  const now = Date.now();
  const m = rlMap();
  m[fam] = Math.max(Number(m[fam]) || 0, now + Math.min(RL_MAX_MS, Math.max(RL_MIN_MS, retryAfterMs(res))));
  for (const k of Object.keys(m)) if (!(m[k] > now)) delete m[k];
  setJson(RL_KEY, m, { ttlMs: RL_MAX_MS });
  log2("backend 429 on /" + fam + ": that family waits " + Math.round((m[fam] - now) / 1e3) + " s");
}
function rateLimitedText(lng) {
  const es = "Demasiadas solicitudes. Prueba en un minuto.";
  const enText = "Too many requests. Try again in a minute.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}
function rateLimited(fam) {
  const e = kino.error("unavailable", "Xuper: backend rate limited (429) on " + fam, { userMessage: rateLimitedText() });
  try {
    e.rateLimited = true;
  } catch (_) {
  }
  return e;
}
function regionBlockedText(lng) {
  const es = "Xuper no est\xE1 disponible en tu regi\xF3n en este momento. Prueba m\xE1s tarde.";
  const enText = "Xuper is not available in your region right now. Try again later.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}
function regionBlocked(fam) {
  const e = kino.error("unavailable", "Xuper: backend 451 region_blocked " + fam, { userMessage: regionBlockedText() });
  try {
    e.status = 451;
    e.detail = "region_blocked";
  } catch (_) {
  }
  return e;
}
function isRateLimited(e) {
  return !!e && (e.rateLimited === true || /rate limited \(429\)/.test(String(e.message || "")));
}
async function authed(method, path, body, timeoutMs, fam, deadline2) {
  const family = fam || familyOf(path);
  try {
    return await authedOnce(method, path, body, timeoutBefore(deadline2, timeoutMs, family), fam);
  } catch (e) {
    if (!trialNeeded(e)) throw e;
  }
  await trialForRetry(family, deadline2);
  try {
    return await authedOnce(method, path, body, timeoutBefore(deadline2, timeoutMs, family), fam);
  } catch (e) {
    throw trialNeeded(e) ? trialError(family) : e;
  }
}
function authedStep(method, path, body, timeoutMs, fam, deadline2) {
  return authedOnce(method, path, body, timeoutBefore(deadline2, timeoutMs, fam || familyOf(path)), fam);
}
async function authedOnce(method, path, body, timeoutMs, fam) {
  const b = await storedBearer();
  if (!b) throw notActivated();
  const family = fam || familyOf(path);
  if (limitedUntil(family)) throw rateLimited(family);
  const res = await rawBackend(method, path, body, b, timeoutMs);
  if (res.status === 401) {
    bearerRefused(b);
    const e = kino.error("unavailable", "Xuper: session refused (401) on " + path, { userMessage: sessionExpiredText() });
    try {
      e.status = 401;
    } catch (_) {
    }
    throw e;
  }
  if (res.status === 429) {
    noteLimited(family, res);
    throw rateLimited(family);
  }
  if (res.status === 451) throw regionBlocked(family);
  if (!res.ok) {
    let detail = "";
    try {
      const j = res.json();
      detail = j && typeof j.detail === "string" ? j.detail : "";
    } catch (_) {
    }
    const e = kino.error("unavailable", "Xuper: backend " + res.status + (detail ? " " + detail : "") + " " + family);
    try {
      e.status = Number(res.status) || 0;
      e.detail = detail;
    } catch (_) {
    }
    throw e;
  }
  return res.json();
}
function backendStatus(e) {
  if (e && Number(e.status) > 0) return Number(e.status);
  const m = /backend (\d{3})\b/.exec(String(e && e.message || ""));
  return m ? Number(m[1]) : 0;
}
var SEED_MIN_REMAINING_S = 120;
var seedField = (v) => typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
async function fetchSeed(timeoutMs) {
  const b = await storedBearer();
  if (!b) return { ok: false, status: "nobearer" };
  let res;
  try {
    res = await rawBackend("GET", "/seed", void 0, b, timeoutMs);
  } catch (_) {
    return { ok: false, status: "network" };
  }
  if (!res) return { ok: false, status: "network" };
  if (res.status === 401) {
    bearerRefused(b);
    return { ok: false, status: 401 };
  }
  if (res.status !== 200) return { ok: false, status: Number(res.status) || "network" };
  let body;
  try {
    body = res.json();
  } catch (_) {
    return { ok: false, status: "bad" };
  }
  let seed = body && body.seed;
  if (typeof seed === "string") {
    try {
      seed = JSON.parse(seed);
    } catch (_) {
      seed = null;
    }
  }
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) return { ok: false, status: "bad" };
  const out = { sn: seedField(seed.sn), userId: seedField(seed.userId), userToken: seedField(seed.userToken) };
  if (!out.sn || !out.userId || !out.userToken) return { ok: false, status: "bad" };
  const remaining3 = Number(body.remaining_s);
  if (!Number.isFinite(remaining3) || remaining3 <= SEED_MIN_REMAINING_S) return { ok: false, status: "bad" };
  const minted = Number(seed.mintedAt);
  if (Number.isFinite(minted) && minted > 0) out.mintedAt = Math.floor(minted);
  const expiresAt = Number(body.expires_at);
  return { ok: true, seed: out, lifeMs: Math.floor(remaining3 * 1e3), expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}
async function postSeed(seed, timeoutMs) {
  const b = await storedBearer();
  if (!b) return { ok: false, status: "nobearer" };
  let res;
  try {
    res = await rawBackend("POST", "/seed", { seed }, b, timeoutMs);
  } catch (_) {
    return { ok: false, status: "network" };
  }
  if (!res) return { ok: false, status: "network" };
  if (res.status === 401) {
    bearerRefused(b);
    return { ok: false, status: 401 };
  }
  const status2 = Number(res.status) || 0;
  if (status2 >= 200 && status2 < 300) return { ok: true };
  return { ok: false, status: status2 || "network" };
}
async function fetchDevices(timeoutMs) {
  const b = await storedBearer();
  if (!b) return { ok: false, status: "nobearer" };
  if (limitedUntil("devices")) return { ok: false, status: 429 };
  let res;
  try {
    res = await rawBackend("GET", "/devices", void 0, b, timeoutMs);
  } catch (_) {
    return { ok: false, status: "network" };
  }
  if (!res) return { ok: false, status: "network" };
  if (res.status === 401) {
    bearerRefused(b);
    return { ok: false, status: 401 };
  }
  if (res.status === 429) {
    noteLimited("devices", res);
    return { ok: false, status: 429 };
  }
  if (res.status !== 200) return { ok: false, status: Number(res.status) || "network" };
  let body;
  try {
    body = res.json();
  } catch (_) {
    return { ok: false, status: "bad" };
  }
  const used = Number(body && body.used), max = Number(body && body.max);
  if (!body || !Array.isArray(body.devices) || !Number.isFinite(used) || !Number.isFinite(max) || used < 0 || max <= 0) return { ok: false, status: "bad" };
  return { ok: true, used: Math.floor(used), max: Math.floor(max), devices: body.devices };
}
var EGRESS_STEP = "/egress/step";
var SEARCH_STEP = "/search/step";
var RESOLVE_STEP = "/resolve/step";
var ROUTE_MISSING = "Not Found";
var MAX_EGRESS_STEPS = 6;
var MAX_BATCH_STEPS = 10;
var MIN_LEFT_MS = 800;
var BACKEND_HOP_TIMEOUT_MS = 8e3;
var RESOLVE_PORTAL_TIMEOUT_MS = 1e4;
var SEARCH_PORTAL_TIMEOUT_MS = 8e3;
var CATALOG_PORTAL_TIMEOUT_MS = 8e3;
var RESULT_KEYS = ["programResult", "seriesResult", "personResult", "resourceResult"];
var _noRoute = {};
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var detailOf = (e) => e && typeof e.detail === "string" ? e.detail : "";
var routeMissing = (e) => backendStatus(e) === 404 && detailOf(e) === ROUTE_MISSING || backendStatus(e) === 405;
var staleStep = (e) => backendStatus(e) === 400 && (detailOf(e) === "bad_step" || detailOf(e) === "step_mismatch");
var resultsOf = (r) => r && isObj(r.results) ? r.results : null;
var wasRefused = (e) => !!e && (typeof e.refused === "string" || / never sends /.test(String(e.message || "")));
function timeoutBefore(deadline2, max, family) {
  if (!deadline2) return max;
  const left = deadline2 - Date.now();
  if (left < MIN_LEFT_MS) throw kino.error("unavailable", "Xuper: " + family + " flow out of time");
  return max ? Math.min(max, left) : left;
}
function timeoutIn(o, max) {
  return timeoutBefore(o.deadline, max, o.family);
}
async function postStep(body, o) {
  const path = o.stepPath === EGRESS_STEP && _noRoute.egressStep ? SEARCH_STEP : o.stepPath;
  const post = o.post === authed ? authedStep : o.post;
  try {
    return await post("POST", path, body, timeoutIn(o, o.backendTimeoutMs), o.family, o.deadline);
  } catch (e) {
    if (path !== EGRESS_STEP || !routeMissing(e)) throw e;
    _noRoute.egressStep = true;
    log2("egress: the backend has no /egress/step: steps go to /search/step");
    return post("POST", SEARCH_STEP, body, timeoutIn(o, o.backendTimeoutMs), o.family, o.deadline);
  }
}
async function runEgress(first, o) {
  let r = first;
  let n = 0;
  while (r && (r.egress || Array.isArray(r.tickets))) {
    if (n++ >= (o.maxSteps || MAX_EGRESS_STEPS)) throw kino.error("unavailable", "Xuper: too many egress steps (" + o.family + ")");
    const refused2 = o.refuses ? o.refuses(r) : "";
    if (refused2) throw refusedStep(o.family, refused2);
    r = r.egress ? await postStep({ step: r.step, response: await askPortal(r.egress, o) }, o) : await postStep({ step: r.step, answers: await answerTickets(r.tickets, r.parallel === true, o) }, o);
  }
  return r;
}
function refusedStep(family, what) {
  const e = kino.error("unavailable", "Xuper: " + family + " never sends " + what);
  try {
    e.refused = what;
  } catch (_) {
  }
  return e;
}
async function askPortal(tk, o) {
  const resp = await kino.fetch(tk.url, {
    method: tk.method || "POST",
    headers: tk.headers || {},
    body: tk.body,
    // opaque ciphertext (string)
    cookies: false,
    timeoutMs: timeoutIn(o, o.portalTimeoutMs)
  });
  return resp.text();
}
async function answerTickets(tickets, parallel, o) {
  if (!tickets.length || tickets.some((tk) => !isObj(tk) || !tk.id || !tk.url)) {
    throw kino.error("unavailable", "Xuper: malformed batch step (" + o.family + ")");
  }
  const texts = [];
  if (parallel) texts.push(...await Promise.all(tickets.map((tk) => askPortal(tk, o))));
  else for (const tk of tickets) texts.push(await askPortal(tk, o));
  const answers = {};
  tickets.forEach((tk, i) => {
    answers[tk.id] = { response: texts[i] };
  });
  return answers;
}
async function egressFlow(o) {
  if (o.getPath && _noRoute[o.family]) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try {
      r = await o.post("POST", o.start, void 0, timeoutIn(o, o.backendTimeoutMs), o.family, o.deadline);
    } catch (e) {
      if (o.getPath && routeMissing(e)) {
        _noRoute[o.family] = true;
        log2(o.family + ": the backend has no " + o.family + " egress: GET path");
        return null;
      }
      if (o.getPath && backendStatus(e) === 404 && !detailOf(e)) {
        log2(o.family + ": 404 with no detail on the egress start: GET path this once");
        return null;
      }
      throw e;
    }
    try {
      r = await runEgress(r, o);
    } catch (e) {
      if (attempt === 0 && staleStep(e)) {
        log2(o.family + ": step refused (" + detailOf(e) + "): starting over");
        continue;
      }
      if (o.post === authed && trialNeeded(e)) {
        if (attempt > 0) throw trialError(o.family);
        await trialForRetry(o.family, o.deadline);
        log2(o.family + ": the trial was renewed mid-flow: starting over");
        continue;
      }
      throw e;
    }
    const out = o.done(r);
    if (out != null) return out;
    throw kino.error("unavailable", "Xuper: " + o.family + " answer without results");
  }
  throw kino.error("unavailable", "Xuper: " + o.family + " step refused twice");
}
async function relayResolve(tail, deadline2, fresh = false) {
  const r = await egressFlow({
    start: "/resolve/" + tail + (tail.includes("?") ? "&" : "?") + "batch=1" + (fresh ? "&fresh=1" : ""),
    family: "resolve",
    stepPath: RESOLVE_STEP,
    backendTimeoutMs: BACKEND_HOP_TIMEOUT_MS,
    maxSteps: MAX_BATCH_STEPS,
    portalTimeoutMs: RESOLVE_PORTAL_TIMEOUT_MS,
    post: authed,
    deadline: deadline2,
    done: (x) => x || {}
  });
  const s = r.stream || (isObj(r.results) ? r.results.stream : null);
  if (!s || !s.url) throw kino.error("unavailable", t("Xuper: no se pudo abrir el video", "Xuper: could not open the video"));
  return s;
}
var PREPARE_START = "/resolve/prepare";
var PREPARE_FAMILY = "prepare";
var SLB_MAX_AHEAD_MS = 6 * 60 * 6e4;
var _prepared = { bearer: "", until: 0 };
function slbUntil(v, now = Date.now()) {
  const exp = epochMs(v);
  return exp > now && exp - now <= SLB_MAX_AHEAD_MS ? exp : 0;
}
function prepareRefuses(r) {
  if (r.egress || !Array.isArray(r.tickets)) return "a classic ticket";
  const plays = (tk) => isObj(tk) && (String(tk.id).toLowerCase() === "play" || /startplay/i.test(String(tk.url || "")));
  return r.tickets.some(plays) ? "a play" : "";
}
async function prepareRelay(deadline2) {
  const b = await storedBearer();
  const now = Date.now();
  if (b && b === _prepared.bearer && now < _prepared.until) {
    log2("prepare: still ready for " + Math.round((_prepared.until - now) / 6e4) + " min: nothing asked");
    return { ready: true, slbExpiresAt: _prepared.until };
  }
  let res;
  try {
    res = await egressFlow({
      start: PREPARE_START,
      family: PREPARE_FAMILY,
      stepPath: RESOLVE_STEP,
      backendTimeoutMs: BACKEND_HOP_TIMEOUT_MS,
      maxSteps: MAX_BATCH_STEPS,
      portalTimeoutMs: RESOLVE_PORTAL_TIMEOUT_MS,
      post: authed,
      getPath: true,
      deadline: deadline2,
      done: resultsOf,
      refuses: prepareRefuses
    });
  } catch (e) {
    if (!wasRefused(e)) throw e;
    _noRoute[PREPARE_FAMILY] = true;
    log2("prepare: the backend asked for " + (e.refused || "work prepare never sends") + ": nothing sent, no prepare for the rest of this runtime");
    return null;
  }
  if (res == null) return null;
  if (res.ready !== true) {
    log2("prepare: the backend answered not ready");
    return res;
  }
  const until = slbUntil(res.slbExpiresAt);
  if (until) _prepared = { bearer: b, until };
  log2("prepare: ready" + (until ? ", " + Math.round((until - Date.now()) / 6e4) + " min of CDN authorization left" : ""));
  return res;
}
async function egressSearch(q) {
  return egressFlow({
    start: "/search/egress?q=" + encodeURIComponent(q) + "&page=1&size=25",
    family: "search",
    stepPath: SEARCH_STEP,
    portalTimeoutMs: SEARCH_PORTAL_TIMEOUT_MS,
    post: authed,
    getPath: true,
    done: (r) => resultsOf(r) || (isObj(r) && RESULT_KEYS.some((k) => k in r) ? r : null)
    // a bare body: tolerated
  });
}
async function egressColumn(columnId, page, size) {
  return egressFlow({
    start: "/column/egress?column_id=" + encodeURIComponent(columnId) + "&page=" + page + "&size=" + size,
    family: "column",
    stepPath: EGRESS_STEP,
    portalTimeoutMs: CATALOG_PORTAL_TIMEOUT_MS,
    post: authed,
    getPath: true,
    done: resultsOf
  });
}
async function egressItem(contentId, type, deadline2) {
  return egressFlow({
    start: "/item/egress?content_id=" + encodeURIComponent(contentId) + "&language=en&type=" + encodeURIComponent(type == null ? "" : type),
    family: "item",
    stepPath: EGRESS_STEP,
    portalTimeoutMs: CATALOG_PORTAL_TIMEOUT_MS,
    post: authed,
    getPath: true,
    done: resultsOf,
    deadline: deadline2,
    backendTimeoutMs: deadline2 ? BACKEND_HOP_TIMEOUT_MS : void 0
  });
}
var TRIAL_KEY = "o2:trial";
var TRIAL_FLIGHT = "xuper:trial";
var TRIAL_BUDGET_MS = 1e4;
var TRIAL_CALL_BUDGET_MS = 16e3;
var TRIAL_PORTAL_TIMEOUT_MS = 6e3;
var TRIAL_OPEN_EVERY_MS = 6 * 60 * 6e4;
var TRIAL_MARGIN_MS = 6e4;
var TRIAL_MAX_AHEAD_MS = 30 * 24 * 60 * 6e4;
function trialFailedText(lng) {
  const es = "No se pudo preparar tu sesi\xF3n de Xuper. Int\xE9ntalo de nuevo en un momento.";
  const enText = "Could not prepare your Xuper session. Try again in a moment.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}
var trialNeeded = (e) => backendStatus(e) === 409 && detailOf(e) === "trial_needed";
function trialStamp() {
  const s = getJson(TRIAL_KEY);
  return isObj(s) ? s : {};
}
function epochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n < 1e12 ? n * 1e3 : n);
}
function trialValid(now = Date.now()) {
  const exp = Number(trialStamp().expiresAt) || 0;
  return exp - now > TRIAL_MARGIN_MS && exp - now <= TRIAL_MAX_AHEAD_MS;
}
async function trialFlow(cap) {
  const deadline2 = Math.min(Date.now() + TRIAL_BUDGET_MS, callStartedAt() + TRIAL_CALL_BUDGET_MS, cap || Infinity);
  const res = await egressFlow({
    start: "/trial/egress",
    family: "trial",
    stepPath: EGRESS_STEP,
    portalTimeoutMs: TRIAL_PORTAL_TIMEOUT_MS,
    post: authedOnce,
    getPath: true,
    deadline: deadline2,
    done: resultsOf
  });
  if (res == null) return false;
  if (res.ready !== true) throw kino.error("unavailable", "Xuper: trial answer not ready");
  const expiresAt = epochMs(res.expiresAt);
  setJson(TRIAL_KEY, { ...trialStamp(), expiresAt });
  log2("trial: ready" + (expiresAt ? ", " + Math.round((expiresAt - Date.now()) / 6e4) + " min left" : ""));
  return true;
}
async function trialForRetry(fam, deadline2) {
  log2("backend 409 trial_needed on /" + fam + ": preparing the trial session");
  if (!inFlight(TRIAL_FLIGHT)) setJson(TRIAL_KEY, { ...trialStamp(), expiresAt: 0 });
  let ok = false;
  try {
    ok = await once(TRIAL_FLIGHT, () => trialFlow(deadline2));
  } catch (e) {
    if (isRateLimited(e) || backendStatus(e) === 401 || backendStatus(e) === 451) throw e;
    log2("trial: failed (" + (e && (e.code || e.message) || e) + ")");
  }
  if (!ok) throw trialError(fam);
}
function trialError(fam) {
  const e = kino.error("unavailable", "Xuper: backend 409 trial_needed " + fam + " (trial not ready)", { userMessage: trialFailedText() });
  try {
    e.status = 409;
    e.detail = "trial_needed";
  } catch (_) {
  }
  return e;
}
async function trialAtOpen() {
  try {
    if (!await storedBearer() || _noRoute.trial) return "skip";
    const now = Date.now();
    if (trialValid(now)) return "valid";
    const s = trialStamp();
    const last = saneAt(s.openAt, now);
    if (last && now - last < TRIAL_OPEN_EVERY_MS) return "recent";
    setJson(TRIAL_KEY, { ...s, openAt: now });
    return await once(TRIAL_FLIGHT, trialFlow) ? "ready" : "skip";
  } catch (e) {
    log2("trial at open: failed (" + (e && (e.code || e.message) || e) + ")");
    return "failed";
  }
}
var CONTRIB_TRIAL_START = "/trial/egress?contrib=1";
var CONTRIB_FAMILY = "contrib";
async function contribTrial(deadline2) {
  if (!await storedBearer()) return { ok: false, status: "nobearer" };
  if (_noRoute[CONTRIB_FAMILY]) return { ok: false, status: "noroute" };
  try {
    const r = await egressFlow({
      start: CONTRIB_TRIAL_START,
      family: CONTRIB_FAMILY,
      stepPath: EGRESS_STEP,
      portalTimeoutMs: TRIAL_PORTAL_TIMEOUT_MS,
      backendTimeoutMs: BACKEND_HOP_TIMEOUT_MS,
      post: authedOnce,
      deadline: deadline2,
      done: resultsOf
    });
    return { ok: true, contributed: r.contributed === true, reason: typeof r.reason === "string" ? r.reason : "" };
  } catch (e) {
    if (routeMissing(e)) {
      _noRoute[CONTRIB_FAMILY] = true;
      return { ok: false, status: "noroute" };
    }
    const st = backendStatus(e);
    if (st === 409 && detailOf(e) === "contrib_not_needed") return { ok: false, status: "blocked" };
    if (isRateLimited(e)) return { ok: false, status: 429 };
    return { ok: false, status: st || "error" };
  }
}

// src/legacy.js
var MAGIS_PREFIX = "magis1";
var LIVE_PREFIX = "xlive1:";
var SERIES = /* @__PURE__ */ new Set(["teleplay", "series", "variety"]);
var INT = /^[+-]?\d+$/;
var CHANNEL_CODE = /^[A-Za-z0-9._~-]{1,128}$/;
var ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
var MAX_CODE_CHARS = 2e3;
var MAX_NUMBER = 99999;
var MAX_SEASON = 999;
var str = (v) => v === null || v === void 0 ? "" : typeof v === "string" ? v : String(v);
var blank = (v) => typeof v !== "string" || v.trim() === "";
var isObj2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function toIntOrNull(v) {
  const text2 = typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
  if (text2 === null || !INT.test(text2)) return null;
  const n = Number(text2);
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}
var make = (contentId, programType, episode) => ({ contentId, programType, episode, isSeries: SERIES.has(programType) });
function encodeMagis({ contentId, programType = "movie", episode = 0 }) {
  return `${MAGIS_PREFIX}:${programType || "movie"}:${episode}:${contentId}`;
}
function encodeChapter(seriesNumber, seasonContentId) {
  return encodeMagis({ contentId: seasonContentId, programType: "teleplay", episode: seriesNumber });
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
    const need2 = b >= 194 && b < 224 ? 1 : b >= 224 && b < 240 ? 2 : b >= 240 && b < 245 ? 3 : 0;
    if (need2 === 0 || i + need2 > bytes.length - 1) {
      out += "\uFFFD";
      i++;
      continue;
    }
    let cp = b & 255 >> need2 + 2;
    let ok = true;
    for (let k = 1; k <= need2; k++) {
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
    i += need2 + 1;
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
  if (dot <= 0) return null;
  const text2 = base64UrlToText(ref.slice(0, dot));
  let json;
  try {
    json = text2 === null ? null : JSON.parse(text2);
  } catch (_) {
    return null;
  }
  if (!isObj2(json) || str(json.s) !== "magis" || !isObj2(json.p)) return null;
  const contentId = str(json.p.content_id);
  if (blank(contentId)) return null;
  return make(contentId, str(json.p.program_type).trim() === "" ? "movie" : str(json.p.program_type), optInt(json.p.episode));
}
function decodeMagis(ref) {
  if (typeof ref !== "string" || blank(ref) || ref.startsWith("plg1:")) return null;
  if (ref.startsWith(MAGIS_PREFIX + ":")) {
    const parts2 = ref.split(":");
    if (parts2.length < 4) return null;
    const contentId = parts2.slice(3).join(":");
    if (blank(contentId)) return null;
    const type = parts2[1];
    return make(contentId, type.trim() === "" ? "movie" : type, toIntOrNull(parts2[2]) ?? 0);
  }
  return fromGatewayRef(ref);
}
function legacyLiveCode(ref) {
  if (typeof ref !== "string") return null;
  if (ref.startsWith(LIVE_PREFIX)) {
    const code = ref.slice(LIVE_PREFIX.length);
    return code.trim() !== "" && code.length <= MAX_CODE_CHARS ? code : null;
  }
  if (!CHANNEL_CODE.test(ref) || ref.startsWith("~") || decodeMagis(ref) !== null) return null;
  return ref;
}
function parseSeasonList(list, ownId) {
  let own = null;
  const all = [];
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) {
    if (!isObj2(entry)) continue;
    const id = typeof entry.contentId === "string" ? entry.contentId : typeof entry.contentId === "number" ? String(entry.contentId) : "";
    const number = toIntOrNull(entry.seasonNumber);
    if (id === ownId) own = number;
    if (id.trim() !== "" && number !== null) all.push({ id, number });
  }
  if (own === null && entries.length === 0) own = 1;
  all.sort((a, b) => a.number - b.number);
  return { own, all };
}
function chaptersOf(assetData, seriesId) {
  const d = isObj2(assetData) ? assetData : {};
  const items = (Array.isArray(d.simpleProgramList) ? d.simpleProgramList : []).filter(isObj2).map((it) => ({
    seriesNumber: typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null,
    contentId: typeof it.contentId === "string" ? it.contentId : typeof it.contentId === "number" ? String(it.contentId) : "",
    name: typeof it.name === "string" ? it.name : ""
  }));
  const seasons = parseSeasonList(d.sameSeasonSeriesList, seriesId);
  return { items, season: seasons.own, seasons: seasons.all };
}
function findChapter(items, episode) {
  if (!Array.isArray(items) || !items.length) return void 0;
  if (!(episode > 0)) return items[0];
  return items.find((it) => typeof it.seriesNumber === "string" && it.seriesNumber.trim() === String(episode));
}
var GENERIC_TITLE = /^(?:(?:capitulo|episodio|chapter|episode|cap|ep|e)\.?\s*#?\s*)?\d*$/;
var TRAILING_NUMBER = /[\s._-]*\d+$/;
var plainTitle = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();
function isGenericTitle(s) {
  if (typeof s !== "string") return true;
  const t2 = plainTitle(s);
  if (GENERIC_TITLE.test(t2)) return true;
  const cut = t2.lastIndexOf("_");
  if (cut < 0) return false;
  const series = t2.slice(0, cut).trim();
  const rest = t2.slice(cut + 1).trim();
  return GENERIC_TITLE.test(rest) || TRAILING_NUMBER.test(rest) && rest.replace(TRAILING_NUMBER, "").trim() === series;
}
function episodesAnswer(m, raw, english) {
  const chapterN = (n) => (english ? "Episode " : "Cap\xEDtulo ") + n;
  const seasonN = (n) => (english ? "Season " : "Temporada ") + n;
  const episodes3 = raw.items.slice(0, 5e3).map((it) => {
    const number = toIntOrNull(it.seriesNumber) ?? 0;
    const numbered = number > 0 && it.name.includes("_") && isGenericTitle(it.name);
    const ep = { number, title: it.name.trim() !== "" && !numbered ? it.name : chapterN(number), ref: encodeChapter(number, m.contentId) };
    if (raw.season !== null) ep.season = raw.season;
    return ep;
  });
  const out = { episodes: episodes3 };
  if (raw.seasons.length > 0) {
    out.seasons = raw.seasons.slice(0, 50).map((s) => ({
      id: s.id,
      // A season is a portal title of the same kind: its ref is what 2.x's search gave it.
      ref: encodeMagis({ contentId: s.id, programType: m.programType, episode: 0 }),
      title: seasonN(s.number),
      number: s.number,
      current: s.id === m.contentId
    }));
  }
  return out;
}
var LIVE_PROVIDERS = /* @__PURE__ */ new Set(["xuper", "legacy"]);
var whole = (v, max) => Number.isInteger(v) && v >= 1 && v <= max ? v : null;
function migrateTitle(input) {
  const m = decodeMagis(input.ref);
  if (!m || !ITEM_ID.test(m.contentId)) return null;
  return { kind: m.isSeries ? "series" : "movie", id: m.contentId, ref: encodeMagis({ contentId: m.contentId, programType: m.programType, episode: 0 }) };
}
function migrateChapter(input) {
  const m = decodeMagis(input.ref);
  if (!m || !ITEM_ID.test(m.contentId)) return null;
  const number = whole(m.episode, MAX_NUMBER) ?? whole(input.episode, MAX_NUMBER) ?? 1;
  const out = { kind: "episode", ref: encodeChapter(number, m.contentId), number };
  const season = whole(input.season, MAX_SEASON);
  if (season !== null) out.season = season;
  return out;
}
function migrateLive(input, liveIdOf) {
  if (!LIVE_PROVIDERS.has(input.provider) || typeof input.code !== "string") return null;
  const code = input.code;
  if (code.trim() === "" || code.length > MAX_CODE_CHARS) return null;
  const id = liveIdOf(code);
  return typeof id === "string" && ITEM_ID.test(id) ? { kind: "live", code: id } : null;
}
function migrate(input, liveIdOf) {
  try {
    if (!isObj2(input)) return null;
    if (input.kind === "title") return migrateTitle(input);
    if (input.kind === "chapter") return migrateChapter(input);
    if (input.kind === "live") return migrateLive(input, liveIdOf);
    return null;
  } catch (_) {
    return null;
  }
}

// src/refs.js
function itemRef(contentId, type) {
  return `v:${contentId}:${type == null ? "" : type}`;
}
function episodeRef(episodeId, seriesId) {
  return `e:${episodeId}:${seriesId || ""}`;
}
function colRef(columnId, adult = false) {
  return `col:${columnId}${adult ? ":a" : ""}`;
}
function liveRef(source, channel) {
  return `L:${source}:${encodeURIComponent(channel == null ? "" : String(channel))}`;
}
function withQuality(ref, quality) {
  return quality ? `${ref}|${quality}` : ref;
}
function mergedRef(members) {
  return "M:" + members.map((r) => {
    const s = String(r);
    return s.startsWith("L:") ? s.slice(2) : s;
  }).join(",");
}
var MEMBER_ID = /^([a-z0-9-]{1,40})_([0-9a-z]{1,16})$/;
function liveMember(part) {
  const j = part.indexOf(":");
  if (j < 0) {
    const m = MEMBER_ID.exec(part);
    if (m) return { source: m[1], channel: null, id: part, ref: null };
  }
  const source = j < 0 ? part : part.slice(0, j);
  let channel = j < 0 ? "" : part.slice(j + 1);
  try {
    channel = decodeURIComponent(channel);
  } catch (_) {
  }
  return { source, channel, ref: "L:" + part };
}
function decodeRef(ref) {
  const raw = String(ref || "");
  let s = raw;
  let quality = "";
  const bar = s.indexOf("|");
  if (bar >= 0) {
    quality = s.slice(bar + 1);
    s = s.slice(0, bar);
  }
  const i = s.indexOf(":");
  const kind = i < 0 ? s : s.slice(0, i);
  const rest = i < 0 ? "" : s.slice(i + 1);
  if (kind === "v") {
    const j = rest.lastIndexOf(":");
    const out = { kind: "item", id: j < 0 ? rest : rest.slice(0, j), type: j < 0 ? "" : rest.slice(j + 1) };
    if (quality) out.quality = quality;
    return out;
  }
  if (kind === "e") {
    const j = rest.indexOf(":");
    const out = { kind: "episode", id: j < 0 ? rest : rest.slice(0, j), series: j < 0 ? "" : rest.slice(j + 1) };
    if (quality) out.quality = quality;
    return out;
  }
  if (kind === "cat") return { kind: "category", name: rest };
  if (kind === "col") {
    const j = rest.indexOf(":");
    if (j < 0) return { kind: "column", columnId: rest };
    const out = { kind: "column", columnId: rest.slice(0, j) };
    if (rest.slice(j + 1) === "a") out.adult = true;
    return out;
  }
  if (kind === "L") {
    const m = liveMember(rest);
    return { kind: "live", source: m.source, channel: m.channel };
  }
  if (kind === "M") {
    const members = rest.split(",").filter(Boolean).map(liveMember);
    if (!members.length) return legacyRef(raw) || { kind: "unknown", raw: s };
    return { kind: "live", source: members[0].source, channel: members[0].channel, members };
  }
  return legacyRef(raw) || { kind: "unknown", raw: s };
}
function legacyRef(raw) {
  const m = decodeMagis(raw);
  if (m) return { kind: "legacy", ...m };
  const code = legacyLiveCode(raw);
  return code !== null ? { kind: "legacyLive", code } : null;
}

// src/liveGate.js
var MAX_IN_FLIGHT = 5;
var MAX_PER_HOST = 4;
var CALL_BUDGET_MS = 16e3;
var MIN_TIMEOUT_MS = 1e3;
var MAX_STARTED = 50;
var DEFAULT_TIMEOUT_MS = 1e4;
var gate = null;
function current() {
  const seq2 = callSeq();
  if (!gate || gate.seq !== seq2) {
    gate = { seq: seq2, deadline: callStartedAt() + CALL_BUDGET_MS, soft: 0, strict: false, maxTimeoutMs: 0, inFlight: 0, hosts: /* @__PURE__ */ new Map(), waiters: [], peak: 0, started: 0 };
  }
  return gate;
}
function deadlineError() {
  const e = new Error("live: past this call's deadline, request not started");
  e.code = "deadline";
  return e;
}
function budgetError() {
  const e = new Error("live: this call's request budget is spent, request not started");
  e.code = "budget";
  return e;
}
var limit = (g) => g.soft > 0 ? Math.min(g.soft, g.deadline) : g.deadline;
var startFloor = (g) => g.soft > 0 && g.strict ? MIN_TIMEOUT_MS : 0;
async function within(ms, fn, opts) {
  const g = current();
  const before = g.soft, beforeStrict = g.strict;
  g.soft = Math.min(g.deadline, Date.now() + Math.max(0, ms));
  g.strict = !!(opts && opts.strict);
  try {
    return await fn();
  } finally {
    if (current() === g) {
      g.soft = before;
      g.strict = beforeStrict;
    }
  }
}
function tighten(opts) {
  const g = current();
  const o = opts || {};
  if (Number.isFinite(o.deadline)) g.deadline = Math.min(g.deadline, o.deadline);
  if (o.maxTimeoutMs > 0) g.maxTimeoutMs = g.maxTimeoutMs > 0 ? Math.min(g.maxTimeoutMs, o.maxTimeoutMs) : o.maxTimeoutMs;
}
function deadline() {
  return limit(current());
}
function remaining() {
  return limit(current()) - Date.now();
}
function startedInCall() {
  return current().started;
}
function inStrictBudget() {
  const g = current();
  return g.soft > 0 && g.strict;
}
function timeoutFor(wantedMs) {
  const g = current();
  const left = limit(g) - Date.now();
  if (left <= 0 || left < startFloor(g)) throw deadlineError();
  const want = wantedMs > 0 ? wantedMs : DEFAULT_TIMEOUT_MS;
  const cap = g.maxTimeoutMs > 0 ? Math.min(want, g.maxTimeoutMs) : want;
  return Math.max(Math.min(MIN_TIMEOUT_MS, cap), Math.min(left, cap));
}
function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(String(url == null ? "" : url));
  return m ? m[1].toLowerCase() : "";
}
var fits = (g, host) => g.inFlight < MAX_IN_FLIGHT && (g.hosts.get(host) || 0) < MAX_PER_HOST;
function take(g, host) {
  g.inFlight++;
  g.hosts.set(host, (g.hosts.get(host) || 0) + 1);
  g.peak = Math.max(g.peak, g.inFlight);
}
function acquire(g, host) {
  if (fits(g, host)) {
    take(g, host);
    return Promise.resolve();
  }
  return new Promise((resolve4) => g.waiters.push({ host, resolve: resolve4 }));
}
function release(g, host) {
  g.inFlight--;
  const n = (g.hosts.get(host) || 1) - 1;
  if (n > 0) g.hosts.set(host, n);
  else g.hosts.delete(host);
  for (let i = 0; i < g.waiters.length && g.inFlight < MAX_IN_FLIGHT; ) {
    const w = g.waiters[i];
    if (fits(g, w.host)) {
      g.waiters.splice(i, 1);
      take(g, w.host);
      w.resolve();
    } else i++;
  }
}
async function liveFetch(url, init) {
  const g = current();
  if (Date.now() >= limit(g) - startFloor(g)) throw deadlineError();
  if (g.started >= MAX_STARTED) throw budgetError();
  const host = hostOf(url);
  await acquire(g, host);
  try {
    const wanted = init && init.timeoutMs > 0 ? init.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timeoutMs = timeoutFor(wanted);
    if (g.started >= MAX_STARTED) throw budgetError();
    g.started++;
    try {
      return await kino.fetch(url, { ...init || {}, timeoutMs });
    } catch (e) {
      throw timeoutMs < wanted ? limitedTimeout(e) : e;
    }
  } finally {
    release(g, host);
  }
}
function limitedTimeout(e) {
  if (!e || e.code !== "timeout") return e;
  try {
    e.limited = true;
  } catch (_) {
  }
  if (e.limited === true) return e;
  return Object.assign(new Error(String(e.message || "timeout")), { code: "timeout", limited: true });
}

// src/sources/xuper-crypto.js
var _enc = new TextEncoder();
var _dec = new TextDecoder("utf-8", { fatal: false });
function utf8Bytes(str6) {
  return _enc.encode(str6);
}
function bytesToUtf8(bytes) {
  return _dec.decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}
function hexToBytes(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) throw new Error("hex inv\xE1lido");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(b)) throw new Error("hex inv\xE1lido");
    out[i] = b;
  }
  return out;
}
function bytesToHex(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}
function asciiToHex(str6) {
  let out = "";
  for (let i = 0; i < str6.length; i++) out += (str6.charCodeAt(i) & 255).toString(16).padStart(2, "0");
  return out;
}
function hexToAscii(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0) throw new Error("hex inv\xE1lido");
  let out = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.substr(i, 2), 16);
    if (Number.isNaN(code)) throw new Error("hex inv\xE1lido");
    out += String.fromCharCode(code);
  }
  return out;
}
var B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function bytesToBase64(bytes) {
  let out = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[(b0 & 3) << 4 | b1 >> 4];
    out += i + 1 < len ? B64_ALPHABET[(b1 & 15) << 2 | b2 >> 6] : "=";
    out += i + 2 < len ? B64_ALPHABET[b2 & 63] : "=";
  }
  return out;
}
var B64_LOOKUP = (() => {
  const t2 = new Int16Array(256).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) t2[B64_ALPHABET.charCodeAt(i)] = i;
  return t2;
})();
function base64ToBytes(b642) {
  let clean = "";
  for (let i = 0; i < b642.length; i++) {
    const c = b642.charCodeAt(i);
    if (c === 61) break;
    if (c === 10 || c === 13 || c === 32 || c === 9) continue;
    if (B64_LOOKUP[c] < 0) throw new Error("base64 inv\xE1lido");
    clean += b642[i];
  }
  const outLen = clean.length * 6 >> 3;
  const out = new Uint8Array(outLen);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = acc << 6 | B64_LOOKUP[clean.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = acc >> bits & 255;
    }
  }
  return out;
}
function md5Bytes(bytes) {
  const rotl2 = (x, c) => x << c | x >>> 32 - c;
  const S2 = [
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
  const K3 = [
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
    3572445317,
    76029189,
    3654602809,
    3873151461,
    530742520,
    3299628645,
    4096336452,
    1126891415,
    2878612391,
    4237533241,
    1700485571,
    2399980690,
    4293915773,
    2240044497,
    1873313359,
    4264355552,
    2734768916,
    1309151649,
    4149444226,
    3174756917,
    718787259,
    3951481745
  ];
  const len = bytes.length;
  const withOne = len + 1;
  const padLen = (56 - withOne % 64 + 64) % 64;
  const total = withOne + padLen + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[len] = 128;
  const bitLenLo = len * 8 >>> 0;
  const bitLenHi = Math.floor(len / 536870912) >>> 0;
  for (let i = 0; i < 4; i++) msg[total - 8 + i] = bitLenLo >>> 8 * i & 255;
  for (let i = 0; i < 4; i++) msg[total - 4 + i] = bitLenHi >>> 8 * i & 255;
  let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
  const M3 = new Int32Array(16);
  for (let off = 0; off < total; off += 64) {
    for (let j = 0; j < 16; j++) {
      const p = off + j * 4;
      M3[j] = msg[p] | msg[p + 1] << 8 | msg[p + 2] << 16 | msg[p + 3] << 24;
    }
    let A = a0, B3 = b0, C = c0, D3 = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) {
        f = B3 & C | ~B3 & D3;
        g = i;
      } else if (i < 32) {
        f = D3 & B3 | ~D3 & C;
        g = 5 * i + 1 & 15;
      } else if (i < 48) {
        f = B3 ^ C ^ D3;
        g = 3 * i + 5 & 15;
      } else {
        f = C ^ (B3 | ~D3);
        g = 7 * i & 15;
      }
      const tmp = D3;
      D3 = C;
      C = B3;
      const sum = A + f + K3[i] + M3[g] | 0;
      B3 = B3 + rotl2(sum, S2[i]) | 0;
      A = tmp;
    }
    a0 = a0 + A | 0;
    b0 = b0 + B3 | 0;
    c0 = c0 + C | 0;
    d0 = d0 + D3 | 0;
  }
  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let w = 0; w < 4; w++) for (let i = 0; i < 4; i++) out[w * 4 + i] = words[w] >>> 8 * i & 255;
  return out;
}
function md5Hex(input) {
  const bytes = typeof input === "string" ? utf8Bytes(input) : input;
  return bytesToHex(md5Bytes(bytes));
}
var _spfunction1 = [16843776, 0, 65536, 16843780, 16842756, 66564, 4, 65536, 1024, 16843776, 16843780, 1024, 16778244, 16842756, 16777216, 4, 1028, 16778240, 16778240, 66560, 66560, 16842752, 16842752, 16778244, 65540, 16777220, 16777220, 65540, 0, 1028, 66564, 16777216, 65536, 16843780, 4, 16842752, 16843776, 16777216, 16777216, 1024, 16842756, 65536, 66560, 16777220, 1024, 4, 16778244, 66564, 16843780, 65540, 16842752, 16778244, 16777220, 1028, 66564, 16843776, 1028, 16778240, 16778240, 0, 65540, 66560, 0, 16842756];
var _spfunction2 = [-2146402272, -2147450880, 32768, 1081376, 1048576, 32, -2146435040, -2147450848, -2147483616, -2146402272, -2146402304, -2147483648, -2147450880, 1048576, 32, -2146435040, 1081344, 1048608, -2147450848, 0, -2147483648, 32768, 1081376, -2146435072, 1048608, -2147483616, 0, 1081344, 32800, -2146402304, -2146435072, 32800, 0, 1081376, -2146435040, 1048576, -2147450848, -2146435072, -2146402304, 32768, -2146435072, -2147450880, 32, -2146402272, 1081376, 32, 32768, -2147483648, 32800, -2146402304, 1048576, -2147483616, 1048608, -2147450848, -2147483616, 1048608, 1081344, 0, -2147450880, 32800, -2147483648, -2146435040, -2146402272, 1081344];
var _spfunction3 = [520, 134349312, 0, 134348808, 134218240, 0, 131592, 134218240, 131080, 134217736, 134217736, 131072, 134349320, 131080, 134348800, 520, 134217728, 8, 134349312, 512, 131584, 134348800, 134348808, 131592, 134218248, 131584, 131072, 134218248, 8, 134349320, 512, 134217728, 134349312, 134217728, 131080, 520, 131072, 134349312, 134218240, 0, 512, 131080, 134349320, 134218240, 134217736, 512, 0, 134348808, 134218248, 131072, 134217728, 134349320, 8, 131592, 131584, 134217736, 134348800, 134218248, 520, 134348800, 131592, 8, 134348808, 131584];
var _spfunction4 = [8396801, 8321, 8321, 128, 8396928, 8388737, 8388609, 8193, 0, 8396800, 8396800, 8396929, 129, 0, 8388736, 8388609, 1, 8192, 8388608, 8396801, 128, 8388608, 8193, 8320, 8388737, 1, 8320, 8388736, 8192, 8396928, 8396929, 129, 8388736, 8388609, 8396800, 8396929, 129, 0, 0, 8396800, 8320, 8388736, 8388737, 1, 8396801, 8321, 8321, 128, 8396929, 129, 1, 8192, 8388609, 8193, 8396928, 8388737, 8193, 8320, 8388608, 8396801, 128, 8388608, 8192, 8396928];
var _spfunction5 = [256, 34078976, 34078720, 1107296512, 524288, 256, 1073741824, 34078720, 1074266368, 524288, 33554688, 1074266368, 1107296512, 1107820544, 524544, 1073741824, 33554432, 1074266112, 1074266112, 0, 1073742080, 1107820800, 1107820800, 33554688, 1107820544, 1073742080, 0, 1107296256, 34078976, 33554432, 1107296256, 524544, 524288, 1107296512, 256, 33554432, 1073741824, 34078720, 1107296512, 1074266368, 33554688, 1073741824, 1107820544, 34078976, 1074266368, 256, 33554432, 1107820544, 1107820800, 524544, 1107296256, 1107820800, 34078720, 0, 1074266112, 1107296256, 524544, 33554688, 1073742080, 524288, 0, 1074266112, 34078976, 1073742080];
var _spfunction6 = [536870928, 541065216, 16384, 541081616, 541065216, 16, 541081616, 4194304, 536887296, 4210704, 4194304, 536870928, 4194320, 536887296, 536870912, 16400, 0, 4194320, 536887312, 16384, 4210688, 536887312, 16, 541065232, 541065232, 0, 4210704, 541081600, 16400, 4210688, 541081600, 536870912, 536887296, 16, 541065232, 4210688, 541081616, 4194304, 16400, 536870928, 4194304, 536887296, 536870912, 16400, 536870928, 541081616, 4210688, 541065216, 4210704, 541081600, 0, 541065232, 16, 16384, 541065216, 4210704, 16384, 4194320, 536887312, 0, 541081600, 536870912, 4194320, 536887312];
var _spfunction7 = [2097152, 69206018, 67110914, 0, 2048, 67110914, 2099202, 69208064, 69208066, 2097152, 0, 67108866, 2, 67108864, 69206018, 2050, 67110912, 2099202, 2097154, 67110912, 67108866, 69206016, 69208064, 2097154, 69206016, 2048, 2050, 69208066, 2099200, 2, 67108864, 2099200, 67108864, 2099200, 2097152, 67110914, 67110914, 69206018, 69206018, 2, 2097154, 67108864, 67110912, 2097152, 69208064, 2050, 2099202, 69208064, 2050, 67108866, 69208066, 69206016, 2099200, 0, 2, 69208066, 0, 2099202, 69206016, 2048, 67108866, 67110912, 2048, 2097154];
var _spfunction8 = [268439616, 4096, 262144, 268701760, 268435456, 268439616, 64, 268435456, 262208, 268697600, 268701760, 266240, 268701696, 266304, 4096, 64, 268697600, 268435520, 268439552, 4160, 266240, 262208, 268697664, 268701696, 4160, 0, 0, 268697664, 268435520, 268439552, 266304, 262144, 266304, 262144, 268701696, 4096, 64, 268697664, 4096, 266304, 268439552, 64, 268435520, 268697600, 268697664, 268435456, 262144, 268439616, 0, 268701760, 262208, 268435520, 268697600, 268439552, 268439616, 0, 268701760, 266240, 266240, 4160, 4160, 262208, 268435456, 268701696];
function desCreateKeys(key) {
  const pc2bytes0 = [0, 4, 536870912, 536870916, 65536, 65540, 536936448, 536936452, 512, 516, 536871424, 536871428, 66048, 66052, 536936960, 536936964];
  const pc2bytes1 = [0, 1, 1048576, 1048577, 67108864, 67108865, 68157440, 68157441, 256, 257, 1048832, 1048833, 67109120, 67109121, 68157696, 68157697];
  const pc2bytes2 = [0, 8, 2048, 2056, 16777216, 16777224, 16779264, 16779272, 0, 8, 2048, 2056, 16777216, 16777224, 16779264, 16779272];
  const pc2bytes3 = [0, 2097152, 134217728, 136314880, 8192, 2105344, 134225920, 136323072, 131072, 2228224, 134348800, 136445952, 139264, 2236416, 134356992, 136454144];
  const pc2bytes4 = [0, 262144, 16, 262160, 0, 262144, 16, 262160, 4096, 266240, 4112, 266256, 4096, 266240, 4112, 266256];
  const pc2bytes5 = [0, 1024, 32, 1056, 0, 1024, 32, 1056, 33554432, 33555456, 33554464, 33555488, 33554432, 33555456, 33554464, 33555488];
  const pc2bytes6 = [0, 268435456, 524288, 268959744, 2, 268435458, 524290, 268959746, 0, 268435456, 524288, 268959744, 2, 268435458, 524290, 268959746];
  const pc2bytes7 = [0, 65536, 2048, 67584, 536870912, 536936448, 536872960, 536938496, 131072, 196608, 133120, 198656, 537001984, 537067520, 537004032, 537069568];
  const pc2bytes8 = [0, 262144, 0, 262144, 2, 262146, 2, 262146, 33554432, 33816576, 33554432, 33816576, 33554434, 33816578, 33554434, 33816578];
  const pc2bytes9 = [0, 268435456, 8, 268435464, 0, 268435456, 8, 268435464, 1024, 268436480, 1032, 268436488, 1024, 268436480, 1032, 268436488];
  const pc2bytes10 = [0, 32, 0, 32, 1048576, 1048608, 1048576, 1048608, 8192, 8224, 8192, 8224, 1056768, 1056800, 1056768, 1056800];
  const pc2bytes11 = [0, 16777216, 512, 16777728, 2097152, 18874368, 2097664, 18874880, 67108864, 83886080, 67109376, 83886592, 69206016, 85983232, 69206528, 85983744];
  const pc2bytes12 = [0, 4096, 134217728, 134221824, 524288, 528384, 134742016, 134746112, 16, 4112, 134217744, 134221840, 524304, 528400, 134742032, 134746128];
  const pc2bytes13 = [0, 4, 256, 260, 0, 4, 256, 260, 1, 5, 257, 261, 1, 5, 257, 261];
  const iterations = key.length > 8 ? 3 : 1;
  const keys2 = new Array(32 * iterations);
  const shifts = [0, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0];
  let m = 0, n = 0;
  for (let j = 0; j < iterations; j++) {
    let left = key[m++] << 24 | key[m++] << 16 | key[m++] << 8 | key[m++];
    let right = key[m++] << 24 | key[m++] << 16 | key[m++] << 8 | key[m++];
    let temp = (left >>> 4 ^ right) & 252645135;
    right ^= temp;
    left ^= temp << 4;
    temp = (right >>> -16 ^ left) & 65535;
    left ^= temp;
    right ^= temp << -16;
    temp = (left >>> 2 ^ right) & 858993459;
    right ^= temp;
    left ^= temp << 2;
    temp = (right >>> -16 ^ left) & 65535;
    left ^= temp;
    right ^= temp << -16;
    temp = (left >>> 1 ^ right) & 1431655765;
    right ^= temp;
    left ^= temp << 1;
    temp = (right >>> 8 ^ left) & 16711935;
    left ^= temp;
    right ^= temp << 8;
    temp = (left >>> 1 ^ right) & 1431655765;
    right ^= temp;
    left ^= temp << 1;
    temp = left << 8 | right >>> 20 & 240;
    left = right << 24 | right << 8 & 16711680 | right >>> 8 & 65280 | right >>> 24 & 240;
    right = temp;
    for (let i = 0; i < shifts.length; i++) {
      if (shifts[i]) {
        left = left << 2 | left >>> 26;
        right = right << 2 | right >>> 26;
      } else {
        left = left << 1 | left >>> 27;
        right = right << 1 | right >>> 27;
      }
      left &= -15;
      right &= -15;
      const lefttemp = pc2bytes0[left >>> 28 & 15] | pc2bytes1[left >>> 24 & 15] | pc2bytes2[left >>> 20 & 15] | pc2bytes3[left >>> 16 & 15] | pc2bytes4[left >>> 12 & 15] | pc2bytes5[left >>> 8 & 15] | pc2bytes6[left >>> 4 & 15];
      const righttemp = pc2bytes7[right >>> 28 & 15] | pc2bytes8[right >>> 24 & 15] | pc2bytes9[right >>> 20 & 15] | pc2bytes10[right >>> 16 & 15] | pc2bytes11[right >>> 12 & 15] | pc2bytes12[right >>> 8 & 15] | pc2bytes13[right >>> 4 & 15];
      temp = (righttemp >>> 16 ^ lefttemp) & 65535;
      keys2[n++] = lefttemp ^ temp;
      keys2[n++] = righttemp ^ temp << 16;
    }
  }
  return keys2;
}
function desCrypt(keys2, bytes, encrypt) {
  const iterations = keys2.length === 32 ? 3 : 9;
  let looping;
  if (keys2.length === 32) looping = encrypt ? [0, 32, 2] : [30, -2, -2];
  else looping = encrypt ? [0, 32, 2, 62, 30, -2, 64, 96, 2] : [94, 62, -2, 32, 64, 2, 30, -2, -2];
  const out = new Uint8Array(bytes.length);
  let o = 0;
  for (let pos = 0; pos < bytes.length; pos += 8) {
    let left = bytes[pos] << 24 | bytes[pos + 1] << 16 | bytes[pos + 2] << 8 | bytes[pos + 3];
    let right = bytes[pos + 4] << 24 | bytes[pos + 5] << 16 | bytes[pos + 6] << 8 | bytes[pos + 7];
    let temp = (left >>> 4 ^ right) & 252645135;
    right ^= temp;
    left ^= temp << 4;
    temp = (left >>> 16 ^ right) & 65535;
    right ^= temp;
    left ^= temp << 16;
    temp = (right >>> 2 ^ left) & 858993459;
    left ^= temp;
    right ^= temp << 2;
    temp = (right >>> 8 ^ left) & 16711935;
    left ^= temp;
    right ^= temp << 8;
    temp = (left >>> 1 ^ right) & 1431655765;
    right ^= temp;
    left ^= temp << 1;
    left = left << 1 | left >>> 31;
    right = right << 1 | right >>> 31;
    for (let j = 0; j < iterations; j += 3) {
      const endloop = looping[j + 1];
      const loopinc = looping[j + 2];
      for (let i = looping[j]; i !== endloop; i += loopinc) {
        const right1 = right ^ keys2[i];
        const right2 = (right >>> 4 | right << 28) ^ keys2[i + 1];
        temp = left;
        left = right;
        right = temp ^ (_spfunction2[right1 >>> 24 & 63] | _spfunction4[right1 >>> 16 & 63] | _spfunction6[right1 >>> 8 & 63] | _spfunction8[right1 & 63] | _spfunction1[right2 >>> 24 & 63] | _spfunction3[right2 >>> 16 & 63] | _spfunction5[right2 >>> 8 & 63] | _spfunction7[right2 & 63]);
      }
      temp = left;
      left = right;
      right = temp;
    }
    left = left >>> 1 | left << 31;
    right = right >>> 1 | right << 31;
    temp = (left >>> 1 ^ right) & 1431655765;
    right ^= temp;
    left ^= temp << 1;
    temp = (right >>> 8 ^ left) & 16711935;
    left ^= temp;
    right ^= temp << 8;
    temp = (right >>> 2 ^ left) & 858993459;
    left ^= temp;
    right ^= temp << 2;
    temp = (left >>> 16 ^ right) & 65535;
    right ^= temp;
    left ^= temp << 16;
    temp = (left >>> 4 ^ right) & 252645135;
    right ^= temp;
    left ^= temp << 4;
    out[o++] = left >>> 24 & 255;
    out[o++] = left >>> 16 & 255;
    out[o++] = left >>> 8 & 255;
    out[o++] = left & 255;
    out[o++] = right >>> 24 & 255;
    out[o++] = right >>> 16 & 255;
    out[o++] = right >>> 8 & 255;
    out[o++] = right & 255;
  }
  return out;
}
function pkcs7Pad(bytes) {
  const pad = 8 - bytes.length % 8;
  const out = new Uint8Array(bytes.length + pad);
  out.set(bytes, 0);
  for (let i = bytes.length; i < out.length; i++) out[i] = pad;
  return out;
}
function pkcs7Unpad(bytes) {
  if (bytes.length === 0 || bytes.length % 8 !== 0) throw new Error("bloque 3DES inv\xE1lido");
  const pad = bytes[bytes.length - 1];
  if (pad < 1 || pad > 8 || pad > bytes.length) throw new Error("padding pkcs7 inv\xE1lido");
  for (let i = bytes.length - pad; i < bytes.length; i++) if (bytes[i] !== pad) throw new Error("padding pkcs7 inv\xE1lido");
  return bytes.subarray(0, bytes.length - pad);
}
function tripleDesEncryptBytes(keyBytes, dataBytes) {
  const keys2 = desCreateKeys(keyBytes);
  return desCrypt(keys2, pkcs7Pad(dataBytes), true);
}
function tripleDesDecryptBytes(keyBytes, dataBytes) {
  const keys2 = desCreateKeys(keyBytes);
  return pkcs7Unpad(desCrypt(keys2, dataBytes, false));
}
function encryptBody(plain, keyHex) {
  const key = hexToBytes(keyHex);
  const cipher = tripleDesEncryptBytes(key, utf8Bytes(plain));
  const b642 = bytesToBase64(cipher);
  return asciiToHex(b642);
}
function decryptBlob(wireHex, keyHex) {
  const key = hexToBytes(keyHex);
  const b642 = hexToAscii(wireHex);
  const cipher = base64ToBytes(b642);
  const plain = tripleDesDecryptBytes(key, cipher);
  return bytesToUtf8(plain);
}
function randomHex(nBytes) {
  let out = "";
  for (let i = 0; i < nBytes; i++) out += Math.floor(Math.random() * 256).toString(16).padStart(2, "0");
  return out;
}

// src/sources/xuper-sign.js
var LIVE_USER_AGENT = "Ranger/4.9.4-17294ac0";
var LIVE_APP = "com.android.msandroid";
var LIVE_APP_VERSION = "49902";
var LIVE_X_BUFFER = "0";
var K = [
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
  // [42] tweaked
  3654602809,
  3871185381,
  530742520,
  3299628645,
  // [45] tweaked
  4096336452,
  1126891415,
  2878612391,
  4237533241,
  1700485571,
  2399980690,
  4293706877,
  2240044497,
  // [54] tweaked
  1873313359,
  4264355552,
  2734768916,
  1309151649,
  4149444226,
  3174756917,
  765973179,
  3951481745
  // [62] tweaked
];
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
function compress(state2, block, off) {
  const m = new Array(16);
  for (let j = 0; j < 16; j++) {
    const p = off + j * 4;
    m[j] = (block[p] | block[p + 1] << 8 | block[p + 2] << 16 | block[p + 3] << 24) >>> 0;
  }
  let [a, b, c, d] = state2;
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
  state2[0] = state2[0] + a >>> 0;
  state2[1] = state2[1] + b >>> 0;
  state2[2] = state2[2] + c >>> 0;
  state2[3] = state2[3] + d >>> 0;
}
function digestHex(bytes) {
  const state2 = [1732584193, 4023233417, 2562383102, 271733878];
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
  for (let off = 0; off < total.length; off += 64) compress(state2, total, off);
  let out = "";
  for (const w of state2) for (let i = 0; i < 4; i++) out += (w >>> 8 * i & 255).toString(16).padStart(2, "0");
  return out;
}
function signO3(token, startMomentMs) {
  const head2 = new TextEncoder().encode(
    `token=${token}&sign2_method=sign_o3&instance=0&start_moment=${startMomentMs}`
  );
  const msg = new Uint8Array(head2.length + SALT.length);
  msg.set(head2, 0);
  msg.set(SALT, head2.length);
  return digestHex(msg);
}
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
  const at2 = m[1].lastIndexOf("@");
  return normalize(at2 >= 0 ? m[1].slice(at2 + 1) : m[1]);
}
function buildSignContext(license, cdns, builtAtMs) {
  const built = Number.isFinite(builtAtMs) ? { b: Math.trunc(builtAtMs / 1e3) } : {};
  const encode = (list, withToken) => JSON.stringify({
    l: license,
    c: list.map((d) => withToken ? { h: d.cflHost, a: d.authBase, t: tokenOf(d.authBase) } : { h: d.cflHost, a: d.authBase }),
    ...built
  });
  const full = encode(cdns, true);
  if (full.length <= MAX_CONTEXT_CHARS) return { context: full, kept: cdns };
  for (let n = cdns.length; n >= 1; n--) {
    const kept = cdns.slice(0, n);
    const context = encode(kept, false);
    if (context.length <= MAX_CONTEXT_CHARS) return { context, kept };
  }
  return null;
}
function readContext(context) {
  let ctx;
  try {
    ctx = JSON.parse(context);
  } catch (_) {
    ctx = null;
  }
  const ok = ctx && typeof ctx === "object" && typeof ctx.l === "string" && Array.isArray(ctx.c) && ctx.c.length > 0 && ctx.c.every((d) => d && typeof d.h === "string" && typeof d.a === "string");
  if (!ok) throw new Error("live signContext no legible");
  return ctx;
}
function signRequest({ url, context }, nowMs) {
  const ctx = readContext(context);
  const want = authorityOf(url);
  const cdn = ctx.c.find((d) => normalize(d.h) === want) || ctx.c[0];
  const token = typeof cdn.t === "string" && HEX32.test(cdn.t) ? cdn.t : tokenOf(cdn.a);
  if (token === "") throw new Error("entrada de CDN de vivo sin token");
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

// src/sources/adult.js
var ADULT_RE = /adult|xxx|porn|erotic|erotik|hentai|playboy|hustler|brazzers|\+ ?18(?!\d)|(?:^|\D)18 ?\+|(?:^|[^a-z])sex(?:y|o)?(?![a-z])/;
function isAdultTitle(title) {
  const t2 = String(title == null ? "" : title).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return ADULT_RE.test(t2);
}

// src/seeds.js
var SEED_KEY = "o2:xseed";
var STATE_KEY = "o2:xseedSt";
var LEASE_KEY = "o2:xseedLease";
var MIN = 6e4;
var H = 60 * MIN;
var MIN_USE_MS = 2 * MIN;
var RENEW_LEFT_MS = 30 * MIN;
var RENEW_EVERY_MS = 30 * MIN;
var AUTO_PER_HOUR = 3;
var MANUAL_PER_HOUR = 2;
var MANUAL_GAP_MS = 10 * MIN;
var PER_CALL = 2;
var GET_MS = 5e3;
var GET_MIN_MS = 3e3;
var LEASE_MS = 15e3;
var LEASE_WAIT_MS = 3e3;
var LEASE_STEP_MS = 250;
var BACKOFF_503_MIN = [2, 4, 8, 16, 30];
var BACKOFF_SHORT_MS = MIN;
var MANUAL_503_GAP_MS = 15e3;
var JITTER_429_MS = 12e4;
var MAX_429_MS = 62 * MIN;
var MAX_BACK_MS = 63 * MIN;
var ASKING_CALLS = /* @__PURE__ */ new Set(["resolve", "liveCategories", "liveChannels"]);
var str2 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var isObj3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var sleep = (ms) => typeof kino !== "undefined" && kino && typeof kino.sleep === "function" ? kino.sleep(ms) : Promise.resolve();
var E = () => lang() === "en";
var WORD = /^[A-Za-z0-9_-]{1,24}$/;
function word(v) {
  const s = typeof v === "number" ? Number.isFinite(v) ? String(Math.round(v)) : "?" : str2(v);
  return WORD.test(s) ? s : "?";
}
function log3(line, report) {
  try {
    if (report && kino.log && typeof kino.log.report === "function") kino.log.report(line);
    else kino.log(line);
  } catch (_) {
  }
}
function readState() {
  const s = getJson(STATE_KEY);
  return isObj3(s) ? s : {};
}
function writeState(patch) {
  const s = { ...readState(), ...patch };
  setJson(STATE_KEY, s);
  return s;
}
var hourWin = (now) => now - now % H;
var hourCount = (st, now) => isObj3(st.hour) && st.hour.win === hourWin(now) ? Number(st.hour.n) || 0 : 0;
var manCount = (st, now) => isObj3(st.man) && st.man.win === hourWin(now) ? Number(st.man.n) || 0 : 0;
var counted = (st, now, manual) => ({
  hour: { win: hourWin(now), n: hourCount(st, now) + 1 },
  ...manual ? { man: { win: hourWin(now), n: manCount(st, now) + 1, at: now } } : {}
});
var toNextHour = (now) => hourWin(now) + H - now;
function manualBudget(st, now) {
  if (manCount(st, now) >= MANUAL_PER_HOUR) return { why: "cap", ms: toNextHour(now) };
  if (hourCount(st, now) >= AUTO_PER_HOUR - 1) return { why: "reserve", ms: toNextHour(now) };
  const at2 = isObj3(st.man) ? saneAt(st.man.at, now) : 0;
  return at2 > 0 && now - at2 < MANUAL_GAP_MS ? { why: "soon", ms: MANUAL_GAP_MS - (now - at2) } : null;
}
function backoff(st, now) {
  const b = st.back;
  if (!isObj3(b)) return null;
  const until = Number(b.until) || 0;
  return until > now && until - now <= MAX_BACK_MS ? { until, why: str2(b.why), n: Number(b.n) || 1 } : null;
}
function readSeed() {
  const s = getJson(SEED_KEY);
  if (!isObj3(s) || s.v !== 1) return null;
  const sn = str2(s.sn), userId = str2(s.userId), userToken = str2(s.userToken);
  const gotAt = Number(s.gotAt), lifeMs = Number(s.lifeMs);
  if (!sn || !userId || !userToken || !(gotAt > 0) || !(lifeMs > 0)) return null;
  return { sn, userId, userToken, gotAt, lifeMs };
}
function leftOf(s, now) {
  const got = saneAt(s.gotAt, now);
  return got === 0 ? Infinity : s.lifeMs - Math.max(0, now - got);
}
function held(now = Date.now()) {
  const s = readSeed();
  return s && leftOf(s, now) >= MIN_USE_MS ? s : null;
}
var same = (a, b) => !!a && !!b && a.gotAt === b.gotAt && a.userToken === b.userToken;
function needOf() {
  const n = readState().need;
  return n === "geo" || n === "mint" || n === "dead" ? n : null;
}
var perCall = { seq: -1, n: 0 };
var callCount = () => perCall.seq === callSeq() ? perCall.n : 0;
var bumpCall = () => {
  perCall = { seq: callSeq(), n: callCount() + 1 };
};
var gen = 0;
var ending = { seq: -1, gotAt: 0 };
var inflight = null;
var runtimeId = "";
var myId = () => runtimeId || (runtimeId = Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
function foreignLease(now) {
  const l = getJson(LEASE_KEY);
  if (!isObj3(l) || str2(l.id) === myId()) return false;
  const at2 = saneAt(l.at, now);
  return at2 > 0 && now - at2 < LEASE_MS;
}
async function takeLease(now, replacing) {
  if (!foreignLease(now)) {
    setJson(LEASE_KEY, { id: myId(), at: now }, { ttlMs: LEASE_MS });
    const back = getJson(LEASE_KEY);
    if (isObj3(back) && str2(back.id) === myId()) return { ok: true };
  }
  for (let waited = 0; waited < LEASE_WAIT_MS; waited += LEASE_STEP_MS) {
    await sleep(LEASE_STEP_MS);
    const h2 = held();
    if (h2 && !same(h2, replacing)) return { seed: h2 };
    if (!foreignLease(Date.now())) break;
  }
  const h = held();
  return h && !same(h, replacing) ? { seed: h } : {};
}
function dropLease() {
  const l = getJson(LEASE_KEY);
  if (isObj3(l) && str2(l.id) === myId()) remove(LEASE_KEY);
}
var skip = (why4, ms) => {
  log3("seed:skip why=" + word(why4) + (ms > 0 ? " min=" + Math.ceil(ms / MIN) : ""));
  return { seed: null, why: why4, min: ms > 0 ? Math.ceil(ms / MIN) : 0 };
};
async function joined(replacing) {
  const r = await inflight;
  const h = held();
  if (h && !same(h, replacing)) return { seed: h };
  return r && r.seed ? { seed: null, why: "bad", min: 0 } : r;
}
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
  if (remaining() < GET_MIN_MS) return skip("time");
  const lease = await takeLease(now, replacing);
  if (lease.seed) return { seed: lease.seed };
  if (!lease.ok) return skip("lease");
  if (inflight) return joined(replacing);
  let timeoutMs;
  try {
    timeoutMs = timeoutFor(GET_MS);
  } catch (_) {
    dropLease();
    return skip("time");
  }
  bumpCall();
  if (manual) writeState({ manualAt: now });
  const flight = (async () => {
    let r;
    try {
      r = await fetchSeed(timeoutMs);
    } catch (_) {
      r = { ok: false, status: "network" };
    }
    dropLease();
    return landed(r, manual);
  })();
  inflight = flight;
  try {
    return await flight;
  } finally {
    if (inflight === flight) inflight = null;
  }
}
function landed(r, manual) {
  const now = Date.now();
  const st = readState();
  if (r && r.ok) {
    setJson(SEED_KEY, {
      v: 1,
      sn: r.seed.sn,
      userId: r.seed.userId,
      userToken: r.seed.userToken,
      gotAt: now,
      lifeMs: r.lifeMs,
      expiresAt: r.expiresAt || 0,
      ...r.seed.mintedAt ? { mintedAt: r.seed.mintedAt } : {}
    }, { ttlMs: r.lifeMs });
    writeState({ back: null, n503: 0, lastOkAt: now, ...counted(st, now, manual) });
    log3("seed:get ok life_min=" + Math.round(r.lifeMs / MIN) + (manual ? " manual=1" : ""), true);
    const s = readSeed();
    return s ? { seed: s } : { seed: null, why: "bad", min: 0 };
  }
  const status2 = r ? r.status : "network";
  let back = null;
  let patch = {};
  let why4;
  if (status2 === 401 || status2 === "nobearer") {
    why4 = "nobearer";
  } else if (status2 === 429) {
    why4 = "429";
    const until = Math.min(hourWin(now) + H + Math.floor(Math.random() * JITTER_429_MS), now + MAX_429_MS);
    back = { until, why: why4, n: 1 };
    patch = counted(st, now, manual);
  } else if (status2 === 503) {
    why4 = "503";
    const n = (Number(st.n503) || 0) + 1;
    back = { until: now + BACKOFF_503_MIN[Math.min(n, BACKOFF_503_MIN.length) - 1] * MIN, why: why4, n };
    patch = { n503: n };
  } else {
    why4 = status2 === "network" ? "net" : "bad";
    back = { until: now + BACKOFF_SHORT_MS, why: why4, n: 1 };
    patch = counted(st, now, manual);
  }
  writeState({ ...patch, ...back ? { back } : {} });
  const min = back ? Math.ceil((back.until - now) / MIN) : 0;
  log3("seed:get fail status=" + word(status2) + (min ? " back_min=" + min : "") + (manual ? " manual=1" : ""), true);
  return { seed: null, why: why4, min };
}
var endingNow = (h) => !!h && ending.seq === callSeq() && ending.gotAt === h.gotAt;
function atEnd(h) {
  if (endingNow(h)) return true;
  const now = Date.now();
  const got = saneAt(h.gotAt, now);
  if (got === 0 || !(leftOf(h, now) < RENEW_LEFT_MS) || now - got < RENEW_EVERY_MS) return false;
  if (!ASKING_CALLS.has(callName())) return false;
  const last = saneAt(readState().renewAt, now);
  if (last > 0 && now - last < RENEW_EVERY_MS) return false;
  writeState({ renewAt: now });
  ending = { seq: callSeq(), gotAt: h.gotAt };
  log3("seed:renew left_min=" + Math.max(0, Math.floor(leftOf(h, now) / MIN)));
  return true;
}
function need(reason) {
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
function drop(s, why4) {
  const cur = readSeed();
  if (!same(cur, s)) return false;
  remove(SEED_KEY);
  gen++;
  const st = readState();
  const doa = st.okGot !== s.gotAt;
  if (doa) writeState({ doa: (Number(st.doa) || 0) + 1 });
  log3("seed:drop why=" + word(why4) + " doa=" + (doa ? 1 : 0), doa);
  return true;
}
function seedOk(s) {
  const st = readState();
  if (st.okGot !== s.gotAt) writeState({ okGot: s.gotAt });
}
function ownOk() {
  if (readState().need) {
    writeState({ need: null, needAt: null });
    log3("seed:need clear");
  }
  const h = readSeed();
  if (endingNow(h)) {
    remove(SEED_KEY);
    gen++;
    log3("seed:end why=own");
  }
}
function status(ownHeld, now = Date.now()) {
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
    leftMin: h ? Number.isFinite(left) ? Math.max(0, Math.floor(left / MIN)) : null : 0,
    geo: st.need === "geo",
    wait
  };
}
async function manualChange() {
  const h = held();
  if (!h) return { result: "noseed" };
  const r = await ask("manual", h);
  if (r.seed && !same(r.seed, h)) return { result: "ok" };
  switch (r.why) {
    case "429":
    case "cap":
      return { result: "hour", min: r.min || 1 };
    case "reserve":
      return { result: "used", min: r.min || 1 };
    case "soon":
      return { result: "soon", min: r.min || 1 };
    case "nobearer":
      return { result: "nobearer" };
    case "net":
    case "time":
      return { result: "offline" };
    default:
      return { result: "busy" };
  }
}
function noSeedText(reason, r) {
  const en6 = E();
  const why4 = r && r.why;
  if (why4 === "call") return null;
  if (why4 === "call_cap" || why4 === "bad") {
    return en6 ? "The backup sessions did not work either right now. Try again in a while." : "Las sesiones de respaldo tampoco funcionaron ahora. Vuelve a intentar en un rato.";
  }
  const p = reason === "geo" ? en6 ? "Xuper blocks your region" : "Xuper bloquea tu zona" : en6 ? "Xuper does not open a session on this device" : "Xuper no abre una sesi\xF3n en este aparato";
  switch (why4) {
    case "503":
      return en6 ? `${p} and there are no free backup sessions right now. Try again in a few minutes.` : `${p} y ahora no hay sesiones de respaldo libres. Vuelve a intentar en unos minutos.`;
    case "429":
    case "cap": {
      const n = Math.max(1, Number(r.min) || 1);
      return en6 ? `${p} and this hour's backup sessions are used up. Try again in ${n} min.` : `${p} y ya se usaron las sesiones de respaldo de esta hora. Vuelve a intentar en ${n} min.`;
    }
    case "nobearer":
      return en6 ? `${p}. Open the Xuper screen to reconnect and use a backup session.` : `${p}. Abre la pantalla de Xuper para reconectarte y usar una sesi\xF3n de respaldo.`;
    case "net":
      return en6 ? `${p} and a backup session could not be requested. Check your connection and try again.` : `${p} y no se pudo pedir una sesi\xF3n de respaldo. Revisa tu conexi\xF3n e int\xE9ntalo de nuevo.`;
    default:
      return en6 ? `${p}. Try again in a few seconds.` : `${p}. Vuelve a intentar en unos segundos.`;
  }
}

// src/sources/xuper.js
var HOSTS = ["osuhk.m3x8o50te.com", "oogoy.f30c96w8.com"];
var APP_ID = "com.android.msandroid";
var APK_VERSION = "49902";
var PORTAL_CODE = "masnew";
var SPKG_VER = "2025-08-07 05:40:11_36_16_";
var APK_VER_HEADER = "43404";
var USER_AGENT = "okhttp/3.12.12";
var CONTENT_TYPE = "application/json;charset=utf-8";
var SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
var PASSWORD_SALT = "cloudstream";
var FIXED_MAC = "02:00:00:00:00:00";
var LIVE_ROOT = "masnew_live";
var REQUEST_TIMEOUT_MS = 2e4;
var RATE_LIMIT_MS = 400;
var LIST_PAGE_SIZE = 250;
var LIST_MAX_PAGES = 20;
var CATEGORIES_PAGE_SIZE = 200;
var DEVICE_FIXED = {
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
};
var FINGERPRINT_FIXED = {
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
};
var str3 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var blank2 = (v) => str3(v).trim() === "";
var notBlank = (v) => str3(v).trim() !== "";
var isObj4 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var sleep2 = (ms) => ms > 0 && typeof kino !== "undefined" && kino.sleep ? kino.sleep(ms) : Promise.resolve();
function rhex(n) {
  try {
    if (typeof kino !== "undefined" && kino.crypto && typeof kino.crypto.randomBytes === "function") return String(kino.crypto.randomBytes(n, "hex"));
  } catch (_) {
  }
  return randomHex(n);
}
function randomMac() {
  return rhex(6).match(/../g).join(":");
}
function fingerprint() {
  return {
    ...FINGERPRINT_FIXED,
    androidId: rhex(8),
    cpuId: rhex(8),
    serialNumber: rhex(8),
    etheMac: randomMac(),
    gatewayMac: randomMac(),
    wifiMac: randomMac()
  };
}
function activateBean(snToken) {
  return { snToken, authVersion: "", authCode: "", preCode: "", macAddr: FIXED_MAC, reserve1: "", openNum: 4, channel: "default", matadata: "", signdata: "" };
}
var snFrom = (j, snToken) => (blank2(j.sn) ? md5Hex(snToken + SNTOKEN_SALT) : str3(j.sn)).toLowerCase();
var WORD2 = /^[A-Za-z0-9_-]{1,24}$/;
function codeOf(e) {
  const c = e instanceof PortalError ? e.code : e && typeof e.code === "string" ? e.code : e && e.name || "error";
  return WORD2.test(str3(c)) ? str3(c) : "?";
}
function log4(line) {
  try {
    kino.log(line);
  } catch (_) {
  }
}
var state = { sn: "", own: null, epoch: 0, preferredHost: null, nextSlotAt: 0, sharedSeq: -1, ownGeoSeq: -1, ownFailSeq: -1 };
var PortalError = class extends Error {
  constructor(code, message, path) {
    super(message || code);
    this.name = "PortalError";
    this.code = code;
    this.path = path || "";
  }
};
function deviceDict(sn) {
  return { ...DEVICE_FIXED, apkVersion: APK_VERSION, sysVersion: SPKG_VER, appId: APP_ID, sn: str3(sn) };
}
function hostOrder() {
  if (!state.preferredHost) return HOSTS.slice();
  return [state.preferredHost, ...HOSTS.filter((h) => h !== state.preferredHost)];
}
var CFG_KEY = "o2:xcfg";
var SN_KEY = "o2:xsn";
var SESS_KEY = "o2:xsess";
var H_MS = 60 * 60 * 1e3;
var CFG_FRESH_MS = 24 * H_MS;
var CFG_MAX_STALE_MS = 7 * 24 * H_MS;
var CFG_RETRY_MS = 10 * 60 * 1e3;
async function fetchBackendCfg(wantedMs) {
  const d = await authed("GET", "/xuper/config", void 0, timeoutFor(wantedMs));
  const magisKey = str3(d && d.magisKey).trim();
  if (blank2(magisKey)) return null;
  return { magisKey, email: str3(d && (d.email || d.username)).trim(), password: str3(d && d.password), at: Date.now() };
}
function getConfig() {
  return once("xuper:cfg", loadConfig);
}
function storedCfg(now) {
  const stored = getJson(CFG_KEY);
  if (!isObj4(stored) || !notBlank(stored.magisKey)) return null;
  const at2 = Number(stored.at) || 0;
  const age = saneAt(at2, now) ? Math.max(0, now - at2) : at2 > now ? CFG_FRESH_MS : Infinity;
  return age < CFG_MAX_STALE_MS ? { cfg: stored, age } : null;
}
async function loadConfig() {
  const now = Date.now();
  const last = storedCfg(now);
  if (last && last.age < CFG_FRESH_MS) return last.cfg;
  const failAt = last ? saneAt(last.cfg.failAt, now) : 0;
  if (last && failAt > 0 && now - failAt < CFG_RETRY_MS) return last.cfg;
  try {
    const fresh = await fetchBackendCfg(last ? 3e3 : 8e3);
    if (fresh) {
      setJson(CFG_KEY, fresh, { ttlMs: CFG_MAX_STALE_MS });
      return fresh;
    }
  } catch (_) {
  }
  if (last) {
    setJson(CFG_KEY, { ...last.cfg, failAt: now }, { ttlMs: Math.max(6e4, CFG_MAX_STALE_MS - last.age) });
    return last.cfg;
  }
  throw new Error(lang() === "en" ? "xuper: no secret from the backend (activate Xuper)" : "xuper: sin secret del backend (activa Xuper)");
}
function openBlob(wireHex, keyHex) {
  const c = typeof kino !== "undefined" && kino ? kino.crypto : null;
  if (c && typeof c.decrypt === "function") {
    try {
      const b642 = typeof c.convert === "function" ? String(c.convert(wireHex, "hex", "utf8")) : hexToAscii(wireHex);
      const plain = c.decrypt("des-ede3-ecb", { key: keyHex, keyEncoding: "hex", data: b642, inputEncoding: "base64", outputEncoding: "utf8" });
      if (typeof plain === "string") return plain;
    } catch (_) {
    }
  }
  return decryptBlob(wireHex, keyHex);
}
async function portalCall(path, bean = {}, opts = {}) {
  const cfg = opts.cfg || await getConfig();
  const { baseFields = true, userId = "", userToken = "", sn = "", timeoutMs = REQUEST_TIMEOUT_MS } = opts;
  const body = {
    ...baseFields ? { portalCode: PORTAL_CODE, userId, userToken } : {},
    ...bean,
    ...deviceDict(sn)
  };
  const wire = encryptBody(JSON.stringify(body), cfg.magisKey);
  const headers = { apk: APP_ID, apkVer: APK_VER_HEADER, spkgVer: SPKG_VER, "User-Agent": USER_AGENT, "Content-Type": CONTENT_TYPE };
  const slot2 = Math.max(Date.now(), state.nextSlotAt);
  state.nextSlotAt = slot2 + RATE_LIMIT_MS;
  if (slot2 > Date.now()) await sleep2(slot2 - Date.now());
  let lastError = null;
  const order = hostOrder();
  for (let i = 0; i < order.length; i++) {
    const host = order[i];
    try {
      const res = await liveFetch(`https://${host}/api/portalCore/${path}`, {
        method: "POST",
        headers,
        body: wire,
        cookies: false,
        timeoutMs
      });
      if (!res || !res.ok) {
        lastError = new Error("http " + (res && res.status));
        continue;
      }
      const answer = JSON.parse(res.text());
      if (!isObj4(answer)) {
        lastError = new Error("respuesta no es objeto");
        continue;
      }
      state.preferredHost = host;
      const rc = answer.returnCode;
      const code = rc === void 0 || rc === null ? "" : String(rc);
      if (code !== "" && code !== "0") {
        const em = typeof answer.errorMessage === "string" ? answer.errorMessage : "";
        throw new PortalError(code, em || code, path);
      }
      if (typeof answer.data === "string" && answer.data !== "") {
        const inner = JSON.parse(openBlob(answer.data, cfg.magisKey));
        if (!isObj4(inner)) throw new Error("datos no son objeto");
        return inner;
      }
      if (isObj4(answer.data)) return answer.data;
      return answer;
    } catch (e) {
      if (e instanceof PortalError) throw e;
      lastError = e;
    }
  }
  throw lastError || new Error("portal no contactable");
}
var SN_RE = /^[0-9a-z]{8,64}$/;
var GEO = "portal100024";
var INVALID_SN = /* @__PURE__ */ new Set(["aaa100080", "aaa100082"]);
var SESSION_DEAD = /* @__PURE__ */ new Set(["aaa100027", "aaa100028", "aaa100083"]);
var NEEDS_ACCOUNT = "aaa100028";
var VERSION_REFUSED = "portal200001";
function knownSn() {
  if (blank2(state.sn)) {
    const s = getJson(SN_KEY);
    const sn = isObj4(s) ? str3(s.sn).toLowerCase() : "";
    if (SN_RE.test(sn)) state.sn = sn;
  }
  return state.sn;
}
function storedOwn(sn) {
  const s = getJson(SESS_KEY);
  return isObj4(s) && str3(s.sn) === sn && notBlank(s.userToken) ? { sn, userId: str3(s.userId), userToken: str3(s.userToken), seq: -1 } : null;
}
function hasOwnSession() {
  const sn = knownSn();
  return !!sn && (state.own && state.own.sn === sn || !!storedOwn(sn));
}
function keepOwn(sn, a) {
  state.own = { sn, userId: str3(a.userId), userToken: str3(a.userToken), seq: callSeq() };
  setJson(SESS_KEY, { sn, userId: state.own.userId, userToken: state.own.userToken, at: Date.now() });
  return state.own;
}
function forgetOwn(token) {
  if (!state.own || state.own.userToken !== token) return;
  state.own = null;
  remove(SESS_KEY);
  state.epoch++;
}
var tagged = (e, step) => {
  if (e && typeof e === "object" && !e.step) {
    try {
      e.step = step;
    } catch (_) {
    }
  }
  return e;
};
async function activateOwn(sn) {
  const a = await portalCall("v8/active", activateBean(""), { baseFields: false, sn });
  if (blank2(a && a.userToken)) throw new PortalError("active_sin_token", "activaci\xF3n sin userToken", "v8/active");
  log4("xsess: activate ok");
  return keepOwn(sn, a);
}
async function mintOwn() {
  const j = await portalCall("v3/snToken", fingerprint(), { baseFields: false, sn: "" });
  if (blank2(j && j.snToken)) throw new PortalError("snToken_failed", "el portal no devolvi\xF3 snToken", "v3/snToken");
  const snToken = str3(j.snToken);
  const sn = snFrom(j, snToken);
  state.sn = sn;
  if (SN_RE.test(sn)) setJson(SN_KEY, { sn, at: Date.now() });
  const a = await portalCall("v8/active", activateBean(snToken), { baseFields: false, sn });
  if (blank2(a && a.userToken)) throw new PortalError("active_sin_token", "activaci\xF3n sin userToken", "v8/active");
  log4("xsess: mint ok");
  return keepOwn(sn, a);
}
async function openOwn() {
  const sn = knownSn();
  if (sn && state.own && state.own.sn === sn) return state.own;
  const stored = sn ? storedOwn(sn) : null;
  if (stored) {
    state.own = stored;
    return stored;
  }
  if (sn) {
    try {
      return await activateOwn(sn);
    } catch (e) {
      log4("xsess: activate fail code=" + codeOf(e));
      if (!(e instanceof PortalError && INVALID_SN.has(e.code))) throw tagged(e, "activate");
    }
  }
  try {
    return await mintOwn();
  } catch (e) {
    log4("xsess: mint fail code=" + codeOf(e));
    throw tagged(e, "mint");
  }
}
function fixable(e) {
  if (!(e instanceof PortalError)) return null;
  if (e.code === GEO) return "geo";
  if (e.code === "snToken_failed" || e.code === "active_sin_token") return "mint";
  if (INVALID_SN.has(e.code) && e.step === "mint") return "mint";
  return null;
}
function explain(e) {
  if (e instanceof PortalError && e.code === VERSION_REFUSED && !e.userMessage) {
    e.userMessage = lang() === "en" ? "Xuper is not accepting connections right now. It usually comes back by itself within a few hours; try again later." : "Xuper no est\xE1 aceptando conexiones por ahora. Suele volver solo en unas horas; vuelve a intentar m\xE1s tarde.";
  }
  return e;
}
function needsAccount(e, channel = true) {
  const en6 = lang() === "en";
  e.userMessage = channel ? en6 ? "This channel needs a Xuper account; it cannot play with the anonymous session. Try another channel." : "Este canal necesita una cuenta de Xuper; con la sesi\xF3n an\xF3nima no se puede ver. Prueba otro canal." : en6 ? "This content needs a Xuper account; it is not available with the anonymous session." : "Este contenido necesita una cuenta de Xuper; con la sesi\xF3n an\xF3nima no est\xE1 disponible.";
  return e;
}
var seedSession = (s) => ({ kind: "seed", sn: s.sn, userId: s.userId, userToken: s.userToken, gotAt: s.gotAt });
var sessionOpts = (s) => ({ baseFields: true, userId: s.userId, userToken: s.userToken, sn: s.sn });
async function viaSeed(reason, cause) {
  const r = await need(reason);
  if (r.seed) {
    log4("seed:use why=" + reason);
    return seedSession(r.seed);
  }
  const err = cause || new PortalError(reason === "geo" ? GEO : "no_session", "xuper: no session and no backup session");
  const text2 = noSeedText(reason, r);
  if (text2) err.userMessage = text2;
  throw explain(err);
}
async function acquire2() {
  const h = held();
  if (h && (!atEnd(h) || state.ownFailSeq === callSeq())) return seedSession(h);
  if (state.ownGeoSeq === callSeq()) return viaSeed("geo", null);
  let own;
  try {
    own = await once("xuper:own:" + state.epoch, openOwn);
  } catch (e) {
    const why4 = fixable(e);
    if (!why4) {
      if (h) return seedSession(h);
      throw explain(e);
    }
    state.ownFailSeq = callSeq();
    return viaSeed(why4, e);
  }
  return { kind: "own", sn: own.sn, userId: own.userId, userToken: own.userToken, seq: own.seq, ending: h };
}
async function replaceSeed(s, e) {
  const why4 = e.code === GEO ? "geo" : "dead";
  drop(s, why4);
  if (state.ownFailSeq === callSeq()) return viaSeed(needOf() || why4, e);
  return acquire2();
}
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
    accountType: "2",
    userName: cfg.email,
    password: md5Hex(cfg.password + PASSWORD_SALT),
    type: "1",
    macAddr: FIXED_MAC,
    areaCode: "",
    verificationCode: "",
    verificationToken: "",
    matadata: "",
    signdata: "",
    channel: "default"
  };
}
async function sharedRetry(step, cause) {
  if (state.sharedSeq === callSeq()) throw needsAccount(cause);
  state.sharedSeq = callSeq();
  const sn = knownSn();
  let cfg = null;
  try {
    cfg = await getConfig();
  } catch (_) {
    cfg = null;
  }
  if (!sn || !cfg || blank2(cfg.email) || blank2(cfg.password)) {
    log4("xsess: shared skip");
    throw needsAccount(cause);
  }
  let j;
  try {
    j = await portalCall("v8/login", loginBean(cfg), { baseFields: false, sn });
  } catch (e) {
    log4("xsess: shared login fail code=" + codeOf(e));
    throw needsAccount(cause);
  }
  if (blank2(j && j.userToken)) throw needsAccount(cause);
  try {
    const out = await step({ kind: "shared", sn, userId: str3(j.userId), userToken: str3(j.userToken) });
    log4("xsess: shared ok");
    return out;
  } catch (e) {
    log4("xsess: shared fail code=" + codeOf(e));
    throw e instanceof PortalError ? needsAccount(e) : e;
  }
}
async function withSession(step, opts = {}) {
  let s = await acquire2();
  let renewed = false;
  for (let round = 0; ; round++) {
    try {
      const out = await step(s);
      if (s.kind === "own") ownOk();
      else if (s.kind === "seed") seedOk(s);
      return out;
    } catch (e) {
      if (!(e instanceof PortalError) || round >= 4) throw explain(e);
      const account2 = e.code === NEEDS_ACCOUNT;
      const liveAccount = account2 && !!opts.liveOpen && e.path === "v4/startPlayLive";
      if (s.kind === "own") {
        if (e.code === GEO) {
          state.ownGeoSeq = state.ownFailSeq = callSeq();
          s = await viaSeed("geo", e);
          continue;
        }
        if (!SESSION_DEAD.has(e.code)) {
          const h = s.ending ? held() : null;
          if (h) {
            s = seedSession(h);
            continue;
          }
          throw explain(e);
        }
        if (!renewed && s.seq !== callSeq()) {
          renewed = true;
          log4("xsess: renew code=" + codeOf(e));
          forgetOwn(s.userToken);
          s = await acquire2();
          continue;
        }
        if (liveAccount) return sharedRetry(step, e);
        if (account2) {
          const v = await probe(s);
          if (v === "alive") throw needsAccount(e, false);
          if (v === "error") throw explain(e);
        }
        state.ownFailSeq = callSeq();
        s = await viaSeed("dead", e);
        continue;
      }
      if (s.kind === "seed") {
        if (account2) {
          const v = await probe(s);
          if (v === "alive") {
            seedOk(s);
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
var call = (path, bean, opts) => withSession((s) => portalCall(path, bean, sessionOpts(s)), opts);
function sessionStatus(now) {
  return status(hasOwnSession(), now);
}
async function portalReady() {
  try {
    return !!await currentBearer() && !!storedCfg(Date.now());
  } catch (_) {
    return false;
  }
}
async function mintAnonymous({ requestMs, validateColumn }) {
  try {
    const last = storedCfg(Date.now());
    if (!last) return { ok: false, why: "nokey" };
    const cfg = last.cfg;
    const mint = await portalCall("v3/snToken", fingerprint(), { baseFields: false, sn: "", timeoutMs: requestMs, cfg });
    if (blank2(mint && mint.snToken)) return { ok: false, why: "no_sntoken" };
    const snToken = str3(mint.snToken);
    const sn = snFrom(mint, snToken);
    const act = await portalCall("v8/active", activateBean(snToken), { baseFields: false, sn, timeoutMs: requestMs, cfg });
    if (blank2(act && act.userToken) || blank2(act && act.userId)) return { ok: false, why: "no_token" };
    const col = await portalCall(
      "getNextColumns",
      { columnCode: validateColumn, pageNum: 1, pageSize: 1, version: "" },
      { baseFields: true, userId: str3(act.userId), userToken: str3(act.userToken), sn, timeoutMs: requestMs, cfg }
    );
    return { ok: true, sn, act, col };
  } catch (e) {
    return { ok: false, why: e instanceof PortalError ? "portal" : "error", code: codeOf(e) };
  }
}
var ALL_CHANNELS = "ChannelList";
var INT2 = /^[+-]?\d+$/;
var intOrNull = (v) => {
  const t2 = str3(v);
  return INT2.test(t2) ? Number(t2) : null;
};
function logoOf(c) {
  for (const k of ["logo", "icon", "pic", "poster", "image", "cover", "verImg", "horImg"]) {
    const v = c && c[k];
    if (typeof v === "string" && /^https?:\/\//.test(v)) return v;
  }
  return "";
}
function bareHost(mainAddr) {
  let s = str3(mainAddr);
  if (s.startsWith("https://")) s = s.slice(8);
  if (s.startsWith("http://")) s = s.slice(7);
  const slash = s.indexOf("/");
  return slash >= 0 ? s.slice(0, slash) : s;
}
function isCfl(url) {
  return str3(url).slice(str3(url).lastIndexOf("?") + 1).split("&").some((p) => p.trim() === "sign_type=cfl");
}
function signalFrom(play) {
  let firstLicense = null;
  const list = isObj4(play) && Array.isArray(play.liveAddressList) ? play.liveAddressList : [];
  for (const a of list) {
    if (!isObj4(a)) continue;
    const license = str3(a.license);
    const playCode = str3(a.playCode);
    if (firstLicense === null) firstLicense = license;
    if (notBlank(playCode) && notBlank(license)) return { playCode, license };
  }
  return firstLicense === null ? null : { playCode: "", license: firstLicense };
}
function liveCdns(slb) {
  const out = [];
  const cdnList = isObj4(slb) && Array.isArray(slb.cdn_list) ? slb.cdn_list : [];
  for (const cdn of cdnList) {
    if (!isObj4(cdn) || str3(cdn.tag) !== "live") continue;
    const urls = Array.isArray(cdn.url_list) ? cdn.url_list : [];
    for (const u of urls) {
      if (!isObj4(u)) continue;
      const url = str3(u.url);
      if (!isCfl(url) && str3(u.sign_type) !== "cfl") continue;
      const host = bareHost(str3(cdn.main_addr));
      if (notBlank(host)) out.push({ cflHost: host, authBase: url });
    }
  }
  return out;
}
var slbBean = (liveCodes) => ({
  hasPay: "0",
  userIdentity: "1",
  type: "merge",
  appVer: APK_VERSION,
  lang: "es",
  encMediaSupported: 1,
  liveCodeList: [...liveCodes],
  appParams: "",
  reserve1: FIXED_MAC,
  pipFlag: "0"
});
function knownEmpty(ctx, columnId) {
  const m = ctx && typeof ctx.listMeta === "function" ? ctx.listMeta(columnId) : null;
  return !!m && m.n === 0;
}
async function categories(ctx) {
  const resp = await call("getNextColumns", { columnCode: LIVE_ROOT, pageNum: 1, pageSize: CATEGORIES_PAGE_SIZE, version: "" });
  const columns = isObj4(resp) && Array.isArray(resp.recommendList) ? resp.recommendList : [];
  const full = [];
  const empties = [];
  for (const c of columns) {
    if (!isObj4(c)) continue;
    const id = intOrNull(c.columnId);
    if (id === null || id <= 0) continue;
    const raw = str3(c.name);
    if (blank2(raw)) continue;
    const title = raw === ALL_CHANNELS ? { es: "Todos", en: "All channels" } : raw;
    const cat = { id: String(id), title };
    if (isAdultTitle(raw)) cat.adult = true;
    (knownEmpty(ctx, cat.id) ? empties : full).push(cat);
  }
  return full.concat(empties);
}
var PART_KEY = "o2:xpart";
var PART_MAX_AGE_MS = 6 * H_MS;
var PART_MAX_COLUMNS = 4;
var OWN_LIMITS = /* @__PURE__ */ new Set(["deadline", "budget", "invalid_request"]);
function parts() {
  const p = getJson(PART_KEY);
  return isObj4(p) ? p : {};
}
function resumePoint(id, ctx) {
  const p = parts()[id];
  if (!isObj4(p)) return null;
  const at2 = saneAt(p.at);
  const page = Number(p.page), n = Number(p.n);
  if (!at2 || Date.now() - at2 > PART_MAX_AGE_MS || !(page >= 2 && page <= LIST_MAX_PAGES) || !(n > 0)) return null;
  const stored = ctx && typeof ctx.storedList === "function" && typeof ctx.rawIdOf === "function" ? ctx.storedList(id) : null;
  if (!Array.isArray(stored) || stored.length !== n) return null;
  const out = [];
  for (const it of stored) {
    const code = str3(ctx.rawIdOf(it));
    if (blank2(code)) return null;
    const ch = { id: code, title: str3(it && it.title) };
    if (it.logo) ch.logo = str3(it.logo);
    out.push(ch);
  }
  return { page, out };
}
function setPart(id, entry) {
  const p = parts();
  if (entry) p[id] = entry;
  else if (id in p) delete p[id];
  else return;
  const ids = Object.keys(p).sort((a, b) => (Number(p[b] && p[b].at) || 0) - (Number(p[a] && p[a].at) || 0));
  for (const k of ids.slice(PART_MAX_COLUMNS)) delete p[k];
  if (Object.keys(p).length) setJson(PART_KEY, p, { ttlMs: PART_MAX_AGE_MS });
  else remove(PART_KEY);
}
function keepPart(id, page, out, ctx, e) {
  if (!out.length || !ctx || typeof ctx.putList !== "function") return e;
  const stored = typeof ctx.storedList === "function" ? ctx.storedList(id) : null;
  if (Array.isArray(stored) && stored.length > out.length) return e;
  try {
    const r = ctx.putList(id, out, { partial: true });
    const n = r && Array.isArray(r.items) ? r.items.length : 0;
    if (n > 0) {
      setPart(id, { page, n, at: Date.now() });
      if (e && typeof e === "object") {
        try {
          e.partial = true;
        } catch (_) {
        }
      }
      log4("xuper: column " + id + " cut at page " + page + ", " + n + " channels kept");
    }
  } catch (_) {
  }
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
      list = isObj4(resp) && Array.isArray(resp.channelList) ? resp.channelList : [];
    } catch (e) {
      if (page === 1) throw e;
      if (e && (OWN_LIMITS.has(e.code) || e.limited === true)) throw keepPart(id, page, out, ctx, e);
      if (!(e instanceof PortalError)) {
        if (resume) throw keepPart(id, page, out, ctx, e);
        const stored = ctx && typeof ctx.storedList === "function" ? ctx.storedList(categoryId) : null;
        if (stored && stored.length > out.length) throw e;
      }
      break;
    }
    for (const c of list) {
      if (!isObj4(c)) continue;
      const code = str3(c.channelCode);
      const title = str3(c.name);
      if (blank2(code) || blank2(title) || seen.has(code)) continue;
      seen.add(code);
      const ch = { id: code, title };
      const logo = logoOf(c);
      if (logo) ch.logo = logo;
      out.push(ch);
    }
    if (list.length < LIST_PAGE_SIZE) break;
  }
  if (resume || isObj4(parts()[id])) setPart(id, null);
  return out;
}
async function resolve(channelId) {
  const code = str3(channelId);
  if (blank2(code)) throw new Error("xuper: canal vac\xEDo");
  const { signal, slb } = await withSession(async (s) => {
    const play = await portalCall("v4/startPlayLive", { channelCode: code, columnId: 0, type: "1" }, sessionOpts(s));
    const signal2 = signalFrom(play);
    if (!signal2) throw new Error("xuper: el canal no dio direcci\xF3n de se\xF1al");
    if (blank2(signal2.license)) throw new Error("xuper: el canal no dio licencia");
    return { signal: signal2, slb: await portalCall("v14/getSlbInfo", slbBean([code]), sessionOpts(s)) };
  }, { liveOpen: true });
  const all = liveCdns(slb);
  if (all.length === 0) throw new Error("xuper: sin servidor de vivo (CDN)");
  const withToken = all.filter((d) => tokenOf(d.authBase) !== "");
  if (withToken.length === 0) throw new Error("xuper: el servidor de vivo no trae token");
  const ALT = /^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/;
  const cdns = withToken.filter((d) => ALT.test(d.cflHost));
  if (cdns.length === 0) throw new Error("xuper: direcci\xF3n de CDN inv\xE1lida");
  const built = buildSignContext(signal.license, cdns, Date.now());
  if (!built) throw new Error("xuper: datos de se\xF1al demasiado largos");
  const primary = built.kept[0].cflHost;
  const playCode = notBlank(signal.playCode) ? signal.playCode : code;
  const url = `http://${primary}/live/${playCode}.m3u8`;
  const { headers } = signRequest({ url, context: built.context }, Date.now());
  return { url, mime: "application/vnd.apple.mpegurl", headers };
}
var UA_CDN = "Ranger/4.9.4-17294ac0";
var SEARCH_PAGE_SIZE = 20;
var MAX_ALTERNATIVES = 8;
var MAX_SUBTITLES = 30;
var AUTH_MARGIN_S = 300;
var EXPIRES_MIN_S = 30;
var EXPIRES_MAX_S = 86400;
var EXPIRED_RE = /expired=(\d+)/;
var VOD_MATCH_THRESHOLD = 0.6;
function normTitle(s) {
  return str3(s).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function titleTokens(s) {
  const n = normTitle(s);
  return n === "" ? [] : n.split(" ");
}
function withScheme(mainAddr) {
  const clean = str3(mainAddr).replace(/\/+$/, "");
  return clean.startsWith("http://") || clean.startsWith("https://") ? clean : `https://${clean}`;
}
var mediaScore = (m) => (str3(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (str3(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);
function rankedMedia(play) {
  const episode = isObj4(play) && Array.isArray(play.episodeList) ? play.episodeList.find(isObj4) : null;
  if (!episode) return [];
  const out = [];
  for (const tm of Array.isArray(episode.totalMovieList) ? episode.totalMovieList : []) {
    if (!isObj4(tm)) continue;
    for (const m of Array.isArray(tm.movieList) ? tm.movieList : []) {
      if (isObj4(m) && notBlank(m.contentId)) out.push(m);
    }
  }
  return out.map((m, i) => ({ m, i, s: mediaScore(m) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.m);
}
function licenseOf(m) {
  const first = isObj4(m) && Array.isArray(m.licenseList) ? m.licenseList.find(isObj4) : null;
  return first ? str3(first.license) : "";
}
function vodCdns(slb) {
  const out = [];
  const list = isObj4(slb) && Array.isArray(slb.cdn_list) ? slb.cdn_list : [];
  for (const cdn of list) {
    if (!isObj4(cdn) || str3(cdn.tag) !== "vod") continue;
    for (const u of Array.isArray(cdn.url_list) ? cdn.url_list : []) {
      if (!isObj4(u)) continue;
      const url = str3(u.url);
      if ((isCfl(url) || str3(u.sign_type) === "cfl") && str3(u.tag) === "free") {
        const bases = [withScheme(str3(cdn.main_addr))];
        const spare = str3(cdn.spared_addr).trim();
        if (notBlank(spare) && !bases.includes(withScheme(spare))) bases.push(withScheme(spare));
        out.push({ bases, auth: url });
        break;
      }
    }
  }
  return out;
}
function readSubtitles(play) {
  const episode = isObj4(play) && Array.isArray(play.episodeList) ? play.episodeList.find(isObj4) : null;
  const out = [];
  for (const sub of isObj4(episode) && Array.isArray(episode.subtitleList) ? episode.subtitleList : []) {
    if (!isObj4(sub)) continue;
    const file = Array.isArray(sub.file) ? sub.file.find(isObj4) : null;
    if (!file) continue;
    const url = str3(file.url);
    if (blank2(url)) continue;
    const s = { url, lang: str3(sub.language) };
    const ft = str3(file.fileType).toLowerCase();
    if (ft === "vtt" || ft === "srt") s.format = ft;
    out.push(s);
    if (out.length >= MAX_SUBTITLES) break;
  }
  return out;
}
function expiresInSeconds(auth, nowMs) {
  const m = EXPIRED_RE.exec(str3(auth));
  if (!m) return null;
  const left = Number(m[1]) - Math.floor(nowMs / 1e3) - AUTH_MARGIN_S;
  if (!Number.isFinite(left)) return null;
  return Math.min(EXPIRES_MAX_S, Math.max(EXPIRES_MIN_S, left));
}
var eachObj = (list, f) => {
  if (Array.isArray(list)) {
    for (const x of list) if (isObj4(x)) f(x);
  }
};
function searchFlatten(resp) {
  const out = [];
  if (isObj4(resp)) {
    eachObj(resp.searchItemList, (group) => eachObj(group.itemList, (x) => out.push(x)));
    if (out.length === 0) eachObj(Array.isArray(resp.assetList) ? resp.assetList : resp.list, (x) => out.push(x));
  }
  return out;
}
function slimHit(raw) {
  if (!isObj4(raw)) return null;
  const c = str3(raw.contentId).trim();
  if (c === "") return null;
  const name = [raw.name, raw.viewPoint, raw.alias].map(str3).find((s) => s.trim() !== "") ?? "";
  if (name === "") return null;
  const programType = str3(raw.programType).trim();
  const legacyType = str3(raw.type).trim();
  const type = programType !== "" ? programType : legacyType !== "" ? legacyType : "movie";
  return { contentId: c, name, type };
}
var SERIES_TYPES = /* @__PURE__ */ new Set(["series", "tv", "variety", "anime", "0"]);
var isSeriesType = (t2) => SERIES_TYPES.has(str3(t2).toLowerCase());
function titleMatchScore(query, title) {
  const nq = normTitle(query), nt = normTitle(title);
  if (nq === "" || nt === "") return 0;
  if (nq === nt) return 1;
  const qs2 = new Set(titleTokens(query)), ts = new Set(titleTokens(title));
  if (qs2.size === 0 || ts.size === 0) return 0;
  let inter = 0;
  for (const t2 of qs2) if (ts.has(t2)) inter++;
  const union = (/* @__PURE__ */ new Set([...qs2, ...ts])).size;
  const jac = inter / union;
  const subset = [...qs2].every((t2) => ts.has(t2));
  return subset ? 0.8 + 0.2 * jac : jac;
}
async function searchVod(title) {
  const q = str3(title).trim();
  if (q === "") return null;
  const resp = await call("v3/searchByName", {
    value: q,
    type: "0",
    columnId: "",
    filter: "",
    pageNum: 1,
    pageSize: SEARCH_PAGE_SIZE
  });
  const hits = [];
  const seen = /* @__PURE__ */ new Set();
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
    const better = score > bestScore + 1e-9 || Math.abs(score - bestScore) <= 1e-9 && best && isSeriesType(best.type) && !isSeriesType(h.type);
    if (better) {
      best = h;
      bestScore = score;
    }
  }
  if (typeof globalThis !== "undefined" && globalThis.__XUPER_DEBUG__ && typeof kino !== "undefined" && kino.log) {
    kino.log("searchVod hits: " + JSON.stringify(hits.slice(0, 10)));
    kino.log("searchVod best score=" + bestScore.toFixed(3) + " -> " + JSON.stringify(best));
  }
  if (!best || bestScore < VOD_MATCH_THRESHOLD) return null;
  return { contentId: best.contentId, type: best.type, name: best.name };
}
async function chapterList(seriesId) {
  const id = str3(seriesId).trim();
  if (id === "") throw new Error("xuper VOD: empty series id");
  const resp = await call("v4/getItemData", { contentId: id, type: "0", sortType: "0", language: "en", macAddr: FIXED_MAC });
  const data = isObj4(resp) ? resp.assetData : null;
  if (!isObj4(data)) throw new Error("xuper VOD: chapter list without data");
  return data;
}
function portalCodeOf(e) {
  return e instanceof PortalError ? str3(e.code) : "";
}
async function resolveVod(contentId, type, seriesContentId = "") {
  const id = str3(contentId).trim();
  if (id === "") throw new Error("xuper VOD: empty contentId");
  const series = str3(seriesContentId).trim();
  const { play, tracks, best, license, slb } = await withSession(async (s) => {
    const play2 = await portalCall("v10/startPlayVOD", {
      contentId: id,
      seriesContentId: series,
      startTime: 0,
      type: "1",
      columnId: 0,
      authType: ""
    }, sessionOpts(s));
    const tracks2 = rankedMedia(play2);
    const best2 = tracks2[0];
    if (!best2) {
      throw new Error("xuper VOD: no playable media" + (isSeriesType(type) && !series ? " (a series needs its chapter)" : ""));
    }
    const license2 = licenseOf(best2);
    if (blank2(license2)) throw new Error("xuper VOD: sin licenseList");
    return { play: play2, tracks: tracks2, best: best2, license: license2, slb: await portalCall("v14/getSlbInfo", slbBean([LIVE_ROOT]), sessionOpts(s)) };
  });
  const cdns = vodCdns(slb);
  if (cdns.length === 0) throw new Error("xuper VOD: sin CDN de vod con token libre");
  const copies = [];
  const seenUrl = /* @__PURE__ */ new Set();
  const seenTrack = /* @__PURE__ */ new Set();
  for (const track of tracks) {
    const tid = str3(track.contentId).trim();
    const tlicense = track === best ? license : licenseOf(track);
    if (track !== best && (blank2(tid) || blank2(tlicense) || seenTrack.has(tid))) continue;
    seenTrack.add(tid);
    const ext = str3(track.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
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
            "Content-Auth": cdn.auth,
            // querystring tal cual: VOD no se re-firma
            "Content-License": tlicense,
            "User-Agent": UA_CDN,
            App: APP_ID,
            "App-Version": APK_VERSION
          }
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
    ...subtitles.length > 0 ? { subtitles } : {},
    ...alternatives.length > 0 ? { alternatives } : {},
    ...expires !== null ? { expiresInSeconds: expires } : {}
  };
}
var xuper = {
  id: "xuper",
  name: "Xuper",
  genre: "otros",
  categories,
  channels,
  resolve
};
var xuper_default = xuper;

// src/seasonRuns.js
function parseSeasonCounts(body) {
  const o = typeof body === "string" ? safeParse(body) : body;
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const seasons = Array.isArray(o.seasons) ? o.seasons : [];
  const out = [];
  for (const s of seasons) {
    if (s === null || typeof s !== "object") continue;
    const season = Number(s.season_number);
    const count = Number(s.episode_count);
    if (Number.isInteger(season) && season >= 1 && Number.isInteger(count) && count > 0) out.push({ season, count });
  }
  out.sort((a, b) => a.season - b.season);
  return out;
}
function safeParse(text2) {
  try {
    return JSON.parse(text2);
  } catch (_) {
    return null;
  }
}
function pickSeasonRun(counts, total, portalSeason) {
  if (!Array.isArray(counts) || counts.length === 0 || !Number.isInteger(total) || total <= 0) return null;
  const runs = [];
  const starts = portalSeason === 1 ? [0] : counts.map((_, i) => i);
  for (const from of starts) {
    let sum = 0;
    for (let i = from; i < counts.length; i++) {
      sum += counts[i].count;
      if (sum === total) {
        runs.push(counts.slice(from, i + 1));
        break;
      }
      if (sum > total) break;
    }
  }
  return runs.length === 1 ? runs[0] : null;
}

// src/tmdb.js
var TMDB_LANGUAGE = "es-MX";
var MIN_LEFT_MS2 = 500;
var IMG = "https://image.tmdb.org/t/p";
var IMDB_ID = /^tt\d{7,}$/;
var AIR_DATE = /^\d{4}-\d{2}-\d{2}$/;
var INT3 = /^[+-]?\d+$/;
var MIN_RUNTIME = 1;
var MAX_RUNTIME = 1e3;
var isObj5 = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
var text = (v) => typeof v === "string" ? v : "";
var blank3 = (s) => s.trim() === "";
function optInt2(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && INT3.test(v.trim())) return Number(v.trim());
  return 0;
}
var imageUrl = (path, size) => typeof path !== "string" || blank3(path) || path === "null" ? "" : `${IMG}/${size}${path}`;
var plainWords = (t2) => String(t2).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function parseSeriesByImdb(body) {
  const o = isObj5(body) ? body : null;
  const tv = o && Array.isArray(o.tv_results) && isObj5(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt2(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}
function pickSeriesByTitle(body, title) {
  const o = isObj5(body) ? body : null;
  const want = plainWords(title);
  if (!o || !Array.isArray(o.results) || want === "") return null;
  const hits = o.results.filter((r2) => isObj5(r2) && optInt2(r2.id) > 0).slice(0, 10);
  const forms2 = (r2) => [plainWords(text(r2.name)), plainWords(text(r2.original_name))];
  const exact = hits.filter((r2) => forms2(r2).includes(want));
  let r = null;
  if (exact.length === 1) r = exact[0];
  else if (exact.length === 0) {
    const words = want.split(" ");
    const holding = hits.filter((h) => forms2(h).some((f) => {
      const fw = f.split(" ");
      return words.every((w) => fw.includes(w));
    }));
    if (holding.length === 1) r = holding[0];
    else if (holding.length > 1) {
      const ranked = holding.slice().sort((a, b) => (Number(b.popularity) || 0) - (Number(a.popularity) || 0));
      if ((Number(ranked[0].popularity) || 0) >= 2 * (Number(ranked[1].popularity) || 0) && (Number(ranked[0].popularity) || 0) > 0) r = ranked[0];
    }
  }
  return r === null ? null : { tmdbId: optInt2(r.id), title: text(r.name), poster: imageUrl(r.poster_path, "w500"), backdrop: imageUrl(r.backdrop_path, "w1280") };
}
function parseSeasonEpisodes(body) {
  const o = isObj5(body) ? body : null;
  if (!o) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObj5).map((e) => {
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
function makeTmdb({ now = () => Date.now() } = {}) {
  async function read2(path, params, deadline2) {
    try {
      if (typeof deadline2 === "number" && deadline2 - now() < MIN_LEFT_MS2) return null;
      if (typeof kino.tmdb !== "function") return null;
      const body = await kino.tmdb(path, { ...params });
      return isObj5(body) ? body : null;
    } catch (_) {
      return null;
    }
  }
  async function seriesByImdb(imdbId, deadline2) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read2(`/find/${imdbId}`, { external_source: "imdb_id", language: TMDB_LANGUAGE }, deadline2);
    return body === null ? null : parseSeriesByImdb(body);
  }
  async function seriesByTitle(title, deadline2) {
    if (typeof title !== "string" || title.trim() === "") return null;
    const body = await read2("/search/tv", { query: title.trim(), language: TMDB_LANGUAGE }, deadline2);
    return body === null ? null : pickSeriesByTitle(body, title);
  }
  async function seriesSeasons(tvId, deadline2) {
    if (!Number.isInteger(tvId) || tvId <= 0) return null;
    const body = await read2(`/tv/${tvId}`, { language: TMDB_LANGUAGE }, deadline2);
    return body === null ? null : parseSeasonCounts(body);
  }
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE, deadline2) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read2(`/tv/${tvId}/season/${season}`, { language }, deadline2);
    return body === null ? null : parseSeasonEpisodes(body);
  }
  return { seriesByImdb, seriesByTitle, seriesSeasons, seasonEpisodes };
}

// src/titleClean.js
var B = "(?<![\\p{L}\\p{N}_])";
var E2 = "(?![\\p{L}\\p{N}_])";
var SEASON_SOURCE = `(?:${B}T\\s?([0-9]{1,2})${E2}|${B}Temp\\.?\\s?([0-9]{1,2})${E2}|${B}Temporada\\s?([0-9]{1,2})${E2}|${B}S([0-9]{1,2})${E2})`;
var LANGUAGE = new RegExp(
  `${B}(?:audio\\s+)?(?:espa[\xF1n]ol(?:\\s+latino)?|castellano|latino|latam|subtitulad[oa]|doblad[oa]|dual|sub(?:\\s+esp)?|hd|4k|\\d{3,4}p)${E2}`,
  "giu"
);
var SEASON = new RegExp(SEASON_SOURCE, "giu");
var BRACKETS = /[([{][^)\]}]*[)\]}]/g;
function cleanSeriesTitle(title) {
  if (typeof title !== "string") return "";
  const t2 = title.replace(BRACKETS, " ").replace(SEASON, " ").replace(LANGUAGE, " ").replace(/[\s_.:;,|/\\-]+/g, " ").trim();
  return t2.length >= 2 ? t2 : "";
}
var ENDS_IN_DIGIT = /[0-9]\s*$/;
var tails = null;
function tailRegexes() {
  if (tails === null) {
    const tags = `(?:${B}audio\\s+(?:latino|espa[\xF1n]ol|castellano)|${B}espa[\xF1n]ol(?:\\s+latino)?|${B}castellano|${B}subtitulad[oa]|${B}doblad[oa]|${B}hd|${B}4k|${B}\\d{3,4}p)${E2}`;
    tails = {
      tags: new RegExp(`(?:[\\s_.:;,|/\\\\-]*${tags})+[\\s_.:;,|/\\\\-]*$`, "iu"),
      season: new RegExp(`(?:[\\s_.:;,|/\\\\-]*)${SEASON_SOURCE}\\s*$`, "iu")
    };
  }
  return tails;
}
function displaySeriesTitle(title) {
  if (typeof title !== "string") return "";
  if (!ENDS_IN_DIGIT.test(title)) return title;
  const { tags, season } = tailRegexes();
  const m = season.exec(title);
  if (!m) return title;
  const rest = title.slice(0, m.index).replace(tags, "").replace(/[\s_.:;,|/\\-]+$/g, "").trim();
  return rest.length >= 2 ? rest : title;
}
function seasonFromName(name) {
  const m = new RegExp(SEASON_SOURCE, "iu").exec(typeof name === "string" ? name : "");
  if (!m) return 1;
  const digits = m.slice(1).find((g) => g !== void 0 && g.trim() !== "");
  return digits === void 0 ? 1 : Number(digits);
}
var seriesKey = (name) => String(name).toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
function collapseSeasons(items, read2) {
  const best = /* @__PURE__ */ new Map();
  items.forEach((it, i) => {
    const { title, series } = read2(it);
    if (!series) return;
    const shown = displaySeriesTitle(title);
    if (shown === title) return;
    const key = seriesKey(shown);
    const season = seasonFromName(title);
    const cur = best.get(key);
    if (cur === void 0 || season < cur.season) best.set(key, { index: i, season });
  });
  if (best.size === 0) return items;
  return items.filter((it, i) => {
    const { title, series } = read2(it);
    if (!series) return true;
    const shown = displaySeriesTitle(title);
    if (shown === title) return true;
    return best.get(seriesKey(shown)).index === i;
  });
}

// src/episodeEnrich.js
var IMDB = /^tt\d{7,}$/;
var INT4 = /^[+-]?\d+$/;
var GENERIC_TITLE2 = /^(?:(?:capitulo|episodio|chapter|episode|cap|ep|e)\.?\s*#?\s*)?\d*$/;
var TRAILING_NUMBER2 = /[\s._-]*\d+$/;
var plainTitle2 = (s) => s.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").replace(/\s+/g, " ").trim();
function isGenericTitle2(s) {
  if (typeof s !== "string") return true;
  const t2 = plainTitle2(s);
  if (GENERIC_TITLE2.test(t2)) return true;
  const cut = t2.lastIndexOf("_");
  if (cut < 0) return false;
  const series = t2.slice(0, cut).trim();
  const rest = t2.slice(cut + 1).trim();
  return GENERIC_TITLE2.test(rest) || TRAILING_NUMBER2.test(rest) && rest.replace(TRAILING_NUMBER2, "").trim() === series;
}
var str4 = (v) => typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
function toIntOrNull2(v) {
  const t2 = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (t2 === null || !INT4.test(t2.trim())) return null;
  const n = Number(t2.trim());
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}
function rawDetail(detail, seriesId) {
  const d = detail && typeof detail === "object" ? detail : {};
  const programs = Array.isArray(d.simpleProgramList) ? d.simpleProgramList : Array.isArray(d.programList) ? d.programList : [];
  const items = programs.filter((x) => x && typeof x === "object").map((it) => ({
    seriesNumber: typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null,
    contentId: str4(it.contentId || it.programContentId),
    name: str4(it.name || it.title)
  }));
  const s = parseSeasonList(d.sameSeasonSeriesList, seriesId);
  const title = [d.name, d.viewPoint, d.alias].find((v) => typeof v === "string" && v.trim() !== "") ?? "";
  return { items, imdb: str4(d.keyWords), season: s.own, declared: toIntOrNull2(d.volumnCount), seasons: s.all, title };
}
async function acrossTmdbSeasons(tmdb, tvId, portalSeason, expected, deadline2) {
  if (typeof tmdb.seriesSeasons !== "function") return null;
  try {
    const all = await tmdb.seriesSeasons(tvId, deadline2);
    const run = pickSeasonRun(all, expected, portalSeason);
    if (run === null) return null;
    const out = [];
    for (const s of run) {
      const eps = await tmdb.seasonEpisodes(tvId, s.season, void 0, deadline2);
      if (!eps || eps.length !== s.count) return null;
      for (const e of eps) out.push({ ...e, episode: out.length + 1 });
    }
    return out.length === expected ? out : null;
  } catch (_) {
    return null;
  }
}
async function enrich(raw, tmdb, deadline2) {
  const none = { extra: /* @__PURE__ */ new Map(), series: null };
  if (!tmdb || !raw || raw.season === null || raw.season === void 0) return none;
  const viaImdb = IMDB.test(raw.imdb || "");
  let byTitle = null;
  if (!viaImdb && typeof tmdb.seriesByTitle === "function") {
    const clean = cleanSeriesTitle(raw.title);
    if (clean !== "") {
      try {
        byTitle = await tmdb.seriesByTitle(clean, deadline2);
      } catch (_) {
        byTitle = null;
      }
    }
  }
  if (!viaImdb && !byTitle) return none;
  try {
    const series = viaImdb ? await tmdb.seriesByImdb(raw.imdb, deadline2) : byTitle;
    if (!series) return none;
    let fromTmdb = await tmdb.seasonEpisodes(series.tmdbId, raw.season, void 0, deadline2);
    if (!fromTmdb) return { extra: /* @__PURE__ */ new Map(), series };
    let acrossSeasons = false;
    const expected = raw.declared !== null && raw.declared > 0 ? raw.declared : raw.items.length;
    if (expected !== fromTmdb.length) {
      const merged = fromTmdb.length < expected ? await acrossTmdbSeasons(tmdb, series.tmdbId, raw.season, expected, deadline2) : null;
      if (merged === null) return { extra: /* @__PURE__ */ new Map(), series };
      fromTmdb = merged;
      acrossSeasons = true;
    }
    const rows = /* @__PURE__ */ new Map();
    for (const c of fromTmdb) {
      const row = {
        still: c.still.trim() !== "" ? c.still : null,
        title: !isGenericTitle2(c.name) ? c.name : null,
        overview: c.overview.trim() !== "" ? c.overview : null,
        airDate: c.airDate || null,
        runtimeMinutes: c.runtimeMinutes > 0 ? c.runtimeMinutes : null
      };
      if (Object.values(row).some((v) => v !== null)) rows.set(c.episode, row);
    }
    const missing = new Set([...rows].filter(([, r]) => r.overview === null).map(([n]) => n));
    if (missing.size === 0 || acrossSeasons) return { extra: rows, series };
    let inEnglish = [];
    try {
      inEnglish = await tmdb.seasonEpisodes(series.tmdbId, raw.season, "en-US", deadline2) ?? [];
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

// src/items.js
function pickPoster(posterList) {
  if (!Array.isArray(posterList)) return void 0;
  const withUrl = posterList.filter((p) => p && p.fileUrl);
  const chosen2 = withUrl.find((p) => /poster|stage|vertical/i.test(p.fileType || "")) || withUrl[0];
  return chosen2 ? chosen2.fileUrl : void 0;
}
var isGif = (u) => /\.gif(?:[?#]|$)/i.test(String(u || ""));
var isHttps = (u) => /^https:\/\//i.test(String(u || ""));
var MAX_URL = 2048;
var ID_RX = /^[A-Za-z0-9._~-]{1,128}$/;
var okImage = (u) => !!u && isHttps(u) && String(u).length <= MAX_URL;
var typeOf = (p) => String(p && p.fileType || "").toLowerCase();
function pickPortrait(posterList) {
  if (!Array.isArray(posterList)) return void 0;
  const icons = posterList.filter((x) => x && x.fileUrl && typeOf(x) === "icon");
  const p = icons.find((x) => !isGif(x.fileUrl)) || icons[0];
  return p ? p.fileUrl : void 0;
}
function pickBackdrop(posterList) {
  if (!Array.isArray(posterList)) return void 0;
  for (const t2 of ["stage", "poster"]) {
    const p = posterList.find((x) => x && x.fileUrl && typeOf(x) === t2);
    if (p) return p.fileUrl;
  }
  return void 0;
}
function durationToMinutes(d) {
  if (typeof d !== "string" || !d) return 0;
  const parts2 = d.split(":").map((x) => parseInt(x, 10));
  if (parts2.length < 2 || parts2.length > 3 || parts2.some((n) => Number.isNaN(n))) return 0;
  const [h, m, s] = parts2.length === 3 ? parts2 : [0, parts2[0], parts2[1]];
  const mins = Math.round((h * 3600 + m * 60 + s) / 60);
  return mins > 0 ? mins : 0;
}
function toItem(card2, adult = false, opts) {
  if (!card2 || !card2.contentId) return null;
  const rec = !!(opts && opts.poster === "recommended");
  if (rec && !ID_RX.test(String(card2.contentId))) return null;
  const type = String(card2.type == null ? "" : card2.type);
  const item = {
    id: String(card2.contentId),
    ref: itemRef(card2.contentId, type),
    title: rec ? String(card2.name || card2.title || "").trim().slice(0, 200) || "\u2014" : String(card2.name || card2.title || "\u2014"),
    kind: type === "0" ? "series" : "movie"
  };
  if (rec) {
    const wide = pickBackdrop(card2.posterList);
    const poster = [pickPortrait(card2.posterList), wide, pickPoster(card2.posterList)].find(okImage);
    if (poster) item.poster = poster;
    if (okImage(wide) && wide !== poster) item.backdrop = wide;
  } else {
    const poster = pickPoster(card2.posterList);
    if (poster) item.poster = poster;
  }
  if (card2.description) item.overview = rec ? String(card2.description).slice(0, 2e3) : String(card2.description);
  const score = Number(card2.score);
  if (score > 0 && (!rec || score <= 10)) item.rating = score;
  let tags = typeof card2.tags === "string" ? card2.tags.split(/[,，/]/).map((s) => s.trim()).filter(Boolean) : Array.isArray(card2.tags) ? card2.tags : [];
  if (rec) tags = tags.filter((g) => typeof g === "string" && g.trim()).map((g) => g.trim());
  if (tags.length) item.genres = tags.slice(0, 5);
  const rt = durationToMinutes(card2.duration);
  if (rt > 0 && (!rec || rt <= 1e3)) item.runtimeMinutes = rt;
  if (adult) item.adult = true;
  return item;
}
function toItems(cards, adult = false, opts) {
  const out = [], seen = /* @__PURE__ */ new Set();
  for (const c of cards || []) {
    const it = toItem(c, adult, opts);
    if (it && !seen.has(it.id)) {
      seen.add(it.id);
      out.push(it);
    }
  }
  return out;
}
function rowList(rowsData) {
  return rowsData && (rowsData.recommendList || rowsData.columnList) || [];
}
function rowCards(r) {
  return r && (r.assetList || r.contentList || r.list) || [];
}
function sectionCards(rowsData) {
  const cards = [];
  for (const r of rowList(rowsData)) cards.push(...rowCards(r));
  return cards;
}

// src/net.js
function isText(r) {
  const h = r && r.headers || {};
  const ct = String(h["content-type"] || "").trim().toLowerCase();
  if (!ct) return true;
  if (/;\s*charset\s*=/.test(ct)) return true;
  const mime = ct.split(";")[0].trim();
  const slash = mime.indexOf("/");
  if (slash < 0) return true;
  const type = mime.slice(0, slash), sub = mime.slice(slash + 1);
  return type === "text" || sub === "json" || sub.endsWith("+json") || sub === "xml" || sub.endsWith("+xml") || sub === "javascript" || sub === "x-javascript" || sub === "x-www-form-urlencoded";
}
function bodyText(r) {
  const c = typeof kino !== "undefined" && kino && kino.crypto;
  if (!isText(r) && c && typeof c.convert === "function") {
    try {
      return c.convert(r.base64(), "base64", "utf8");
    } catch (_) {
    }
  }
  return r.text();
}
async function condGet(url, opts) {
  const o = opts || {};
  const headers = {};
  if (o.etag) headers["If-None-Match"] = String(o.etag);
  if (o.lm) headers["If-Modified-Since"] = String(o.lm);
  let r;
  try {
    r = await kino.fetch(url, { method: "GET", headers, cookies: false, timeoutMs: o.timeoutMs || 8e3 });
  } catch (e) {
    return { status: "err", code: e && e.code || "network" };
  }
  const h = r && r.headers || {};
  if (r.status === 304) return { status: 304, etag: h.etag || o.etag || "", lm: h["last-modified"] || o.lm || "" };
  if (!r.ok) return { status: "err", code: r.status };
  let text2;
  try {
    text2 = bodyText(r);
  } catch (e) {
    return { status: "err", code: "decode" };
  }
  return { status: 200, text: text2, etag: h.etag || "", lm: h["last-modified"] || "" };
}

// src/v2.js
var SCHEMA = 2;
var SECTION_NAMES = SECTIONS.map((s) => s.name);
var ADULT_SECTIONS = new Set(SECTIONS.filter((s) => s.adult).map((s) => s.name));
var HOME_ITEMS = 18;
var BROWSE_PAGE = 100;
var MAX_SLIDES = 6;
var RAIL_CAP = 20;
var GENRES_TOP = 24;
var SLIDE_TEXT = 160;
var HTTP = /^https?:\/\//;
var HTTPS = /^https:\/\//;
var ID_RX2 = /^[A-Za-z0-9._~-]{1,128}$/;
var HASH_RX = /^[0-9a-f]{16}$/;
var COLUMN_ID_RX = /^[1-9]\d{0,11}$/;
var COL_REF_RX = /^col:[1-9]\d{0,11}(:a)?$/;
function heroImage(posterList, httpsOnly = false) {
  if (!Array.isArray(posterList)) return null;
  const withUrl = posterList.filter((p) => p && p.fileUrl && (httpsOnly ? HTTPS : HTTP).test(p.fileUrl));
  const wide = withUrl.find((p) => /stage|land|banner|horizontal|backdrop|still/i.test(p.fileType || ""));
  const chosen2 = wide || withUrl[0];
  return chosen2 ? chosen2.fileUrl : null;
}
function slidesOf(sliderCards, httpsOnly = false, clean = false) {
  const out = [], seen = /* @__PURE__ */ new Set();
  for (const c of sliderCards || []) {
    if (out.length >= MAX_SLIDES) break;
    if (!c || !c.contentId || seen.has(String(c.contentId))) continue;
    if (clean && !ID_RX2.test(String(c.contentId))) continue;
    const image = heroImage(c.posterList, httpsOnly);
    if (!image || clean && image.length > 2048) continue;
    seen.add(String(c.contentId));
    const type = String(c.type == null ? "" : c.type);
    const text2 = typeof c.description === "string" ? c.description.trim() : "";
    out.push({
      id: String(c.contentId),
      ref: itemRef(c.contentId, type),
      kind: type === "0" ? "series" : "movie",
      title: clean ? String(c.name || "").trim().slice(0, 200) || "\u2014" : String(c.name || "\u2014"),
      image,
      text: text2.length > SLIDE_TEXT ? `${text2.slice(0, SLIDE_TEXT - 1).trimEnd()}\u2026` : text2
    });
  }
  return out;
}
function railsOf(rows, adult = false, opts) {
  const out = [];
  for (const r of rowList(rows)) {
    const items = toItems(rowCards(r), adult, opts).slice(0, RAIL_CAP);
    if (!items.length) continue;
    const rail = { title: String(r && (r.name || r.title || r.columnName) || ""), items };
    const col = r && r.columnId != null ? String(r.columnId) : "";
    if (COLUMN_ID_RX.test(col)) rail.columnId = col;
    out.push(rail);
  }
  return out;
}
function genresOf(items) {
  const m = /* @__PURE__ */ new Map();
  for (const it of items) for (const g of it.genres || []) m.set(g, (m.get(g) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, GENRES_TOP).map((e) => e[0]);
}
function fromLegacyHome(legacy, opts) {
  const poster = opts && opts.poster === "legacy" ? "legacy" : "recommended";
  const rec = poster === "recommended";
  const itemOpts = { poster };
  const items = [], index = /* @__PURE__ */ new Map();
  const idx = (it) => {
    let i = index.get(it.id);
    if (i === void 0) {
      i = items.length;
      index.set(it.id, i);
      items.push(it);
    } else if (it.adult && !items[i].adult) items[i].adult = true;
    return i;
  };
  const built = [];
  const src = legacy && legacy.sections || {};
  for (const name of SECTION_NAMES) {
    const s = src[name];
    if (!s || typeof s !== "object") continue;
    const adult = ADULT_SECTIONS.has(name);
    const all = toItems(sectionCards(s.rows), adult, itemOpts);
    const sec = { all: all.map(idx) };
    if (!adult) sec.home = HOME_ITEMS;
    const slides = adult ? [] : slidesOf(s.slider, rec, rec).map((x) => {
      const y = { ...x };
      if (!y.text) delete y.text;
      return y;
    });
    sec.slides = slides;
    const railTitle = (t2) => rec ? t2.slice(0, 200) : t2;
    sec.rails = railsOf(s.rows, adult, itemOpts).map((r) => {
      const rail = r.title ? { title: railTitle(r.title), items: r.items.map(idx) } : { items: r.items.map(idx) };
      if (rec && r.columnId) rail.ref = colRef(r.columnId, adult);
      return rail;
    });
    sec.genres = genresOf(all);
    built.push([name, sec]);
  }
  const adultIds = new Set(items.filter((it) => it.adult).map((it) => it.id));
  const sections = {};
  for (const [name, sec] of built) {
    const slides = sec.slides.filter((x) => !adultIds.has(x.id));
    const out = { all: sec.all };
    if (sec.home !== void 0) out.home = sec.home;
    if (slides.length) out.slides = slides;
    out.rails = sec.rails;
    out.genres = sec.genres;
    sections[name] = out;
  }
  return { schema: SCHEMA, items, sections };
}
var teamObj = (t2) => t2 && typeof t2 === "object" ? t2 : null;
function fromLegacyMatches(legacy) {
  const out = [];
  for (const x of legacy && legacy.matches || []) {
    if (!x || typeof x !== "object") continue;
    const y = {};
    if (x.matchName) y.league = String(x.matchName);
    if (x.gameTime) y.time = String(x.gameTime);
    const a = teamObj(x.team_a), b = teamObj(x.team_b);
    if (a && b) {
      y.a = team(a);
      y.b = team(b);
    } else {
      const t2 = String(x.gameName || "").trim().slice(0, 80);
      if (t2) y.title = t2;
    }
    if (x.channelName) y.ch = String(x.channelName);
    out.push(y);
  }
  return { schema: SCHEMA, matches: out };
}
function team(o) {
  const t2 = { n: String(o.teamName || o.teamAlias || "?") };
  if (HTTPS.test(o.teamLogo || "")) t2.l = String(o.teamLogo);
  return t2;
}
function canonicalText(obj) {
  const rest = {};
  for (const k of Object.keys(obj || {})) if (k !== "gen" && k !== "hash") rest[k] = obj[k];
  return JSON.stringify(rest);
}
function canonicalHash(obj, sha2562) {
  return String(sha2562(canonicalText(obj))).toLowerCase().slice(0, 16);
}
function seal(body, gen2, sha2562) {
  const out = { schema: body.schema, hash: canonicalHash(body, sha2562) };
  if (Number.isFinite(gen2) && gen2 > 0) out.gen = gen2;
  for (const k of Object.keys(body)) if (k !== "schema" && k !== "hash" && k !== "gen") out[k] = body[k];
  return out;
}
function emptyStrings(v, path, bad) {
  if (v === "") {
    bad("empty string at " + path);
    return;
  }
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) emptyStrings(v[i], path + "[" + i + "]", bad);
    return;
  }
  if (v && typeof v === "object") for (const k of Object.keys(v)) emptyStrings(v[k], path + "." + k, bad);
}
var isIdx = (n, len) => Number.isInteger(n) && n >= 0 && n < len;
var httpsUrl = (u) => typeof u === "string" && HTTPS.test(u) && u.length <= 2048;
function validateCatalog(v2) {
  const errs = [];
  const bad = (m) => {
    if (errs.length < 20) errs.push(m);
  };
  if (!v2 || typeof v2 !== "object") return ["not an object"];
  if (v2.schema !== SCHEMA) bad("schema is not 2");
  if (v2.hash !== void 0 && !HASH_RX.test(String(v2.hash))) bad("hash is not 16 hex");
  if (!Array.isArray(v2.items)) {
    bad("items is not an array");
    return errs;
  }
  if (!v2.sections || typeof v2.sections !== "object") {
    bad("sections is not an object");
    return errs;
  }
  emptyStrings(v2, "$", bad);
  const n = v2.items.length;
  const ids = /* @__PURE__ */ new Set();
  const adultIds = /* @__PURE__ */ new Set();
  v2.items.forEach((it, i) => {
    const at2 = "items[" + i + "]";
    if (!it || typeof it !== "object") {
      bad(at2 + " is not an object");
      return;
    }
    if (typeof it.id !== "string" || !ID_RX2.test(it.id)) bad(at2 + ".id");
    else if (ids.has(it.id)) bad(at2 + ".id duplicated");
    else ids.add(it.id);
    if (typeof it.ref !== "string" || !it.ref || it.ref.length > 4096) bad(at2 + ".ref");
    if (typeof it.title !== "string" || !it.title.trim() || it.title.length > 200) bad(at2 + ".title");
    if (it.kind !== "movie" && it.kind !== "series") bad(at2 + ".kind");
    if (it.poster !== void 0 && !httpsUrl(it.poster)) bad(at2 + ".poster is not https");
    if (it.backdrop !== void 0 && !httpsUrl(it.backdrop)) bad(at2 + ".backdrop is not https");
    if (it.overview !== void 0 && (typeof it.overview !== "string" || it.overview.length > 2e3)) bad(at2 + ".overview");
    if (it.rating !== void 0 && !(typeof it.rating === "number" && it.rating > 0 && it.rating <= 10)) bad(at2 + ".rating");
    if (it.genres !== void 0 && !(Array.isArray(it.genres) && it.genres.length <= 5 && it.genres.every((g) => typeof g === "string"))) bad(at2 + ".genres");
    if (it.runtimeMinutes !== void 0 && !(Number.isInteger(it.runtimeMinutes) && it.runtimeMinutes >= 1 && it.runtimeMinutes <= 1e3)) bad(at2 + ".runtimeMinutes");
    if (it.adult !== void 0 && it.adult !== true) bad(at2 + ".adult");
    if (it.adult === true && typeof it.id === "string") adultIds.add(it.id);
  });
  let homeRows2 = 0;
  for (const name of Object.keys(v2.sections)) {
    const s = v2.sections[name];
    const at2 = "sections." + name;
    if (!SECTION_NAMES.includes(name)) {
      bad(at2 + " is unknown");
      continue;
    }
    if (!s || typeof s !== "object") {
      bad(at2 + " is not an object");
      continue;
    }
    const adult = ADULT_SECTIONS.has(name);
    if (!Array.isArray(s.all) || !s.all.every((x) => isIdx(x, n))) bad(at2 + ".all");
    else if (new Set(s.all).size !== s.all.length) bad(at2 + ".all has duplicates");
    else if (adult) {
      const i = s.all.find((x) => !v2.items[x] || v2.items[x].adult !== true);
      if (i !== void 0) bad(at2 + ": item " + (v2.items[i] && v2.items[i].id) + " is in " + name + " but not adult");
    }
    if (adult && s.home !== void 0) bad(at2 + ".home on an adult section");
    if (!adult && s.home !== void 0 && !(Number.isInteger(s.home) && s.home >= 1 && s.home <= 60)) bad(at2 + ".home");
    if (!adult && Number.isInteger(s.home) && Array.isArray(s.all) && s.all.length) homeRows2++;
    if (s.slides !== void 0) {
      if (!Array.isArray(s.slides) || s.slides.length > MAX_SLIDES) bad(at2 + ".slides");
      else {
        if (adult && s.slides.length) bad(at2 + ".slides on an adult section");
        s.slides.forEach((x, i) => {
          const sa = at2 + ".slides[" + i + "]";
          if (!x || typeof x !== "object") {
            bad(sa);
            return;
          }
          if (typeof x.id !== "string" || !ID_RX2.test(x.id)) bad(sa + ".id");
          if (adultIds.has(x.id)) bad(sa + " is an adult title");
          if (typeof x.ref !== "string" || !x.ref) bad(sa + ".ref");
          if (x.kind !== "movie" && x.kind !== "series") bad(sa + ".kind");
          if (typeof x.title !== "string" || !x.title.trim()) bad(sa + ".title");
          if (!httpsUrl(x.image)) bad(sa + ".image is not https");
          if (x.text !== void 0 && (typeof x.text !== "string" || x.text.length > SLIDE_TEXT)) bad(sa + ".text");
        });
      }
    }
    if (!Array.isArray(s.rails)) bad(at2 + ".rails");
    else s.rails.forEach((r, i) => {
      if (!r || !Array.isArray(r.items) || r.items.length > RAIL_CAP || !r.items.every((x) => isIdx(x, n))) bad(at2 + ".rails[" + i + "]");
      if (r && r.title !== void 0 && (typeof r.title !== "string" || r.title.length > 200)) bad(at2 + ".rails[" + i + "].title");
      if (r && r.ref !== void 0 && (typeof r.ref !== "string" || !COL_REF_RX.test(r.ref) || r.ref.endsWith(":a") !== adult)) bad(at2 + ".rails[" + i + "].ref");
    });
    if (!Array.isArray(s.genres) || s.genres.length > GENRES_TOP || !s.genres.every((g) => typeof g === "string")) bad(at2 + ".genres");
  }
  if (!homeRows2) bad("no section has a Home row");
  return errs;
}
function validateMatches(m2) {
  const errs = [];
  const bad = (m) => {
    if (errs.length < 20) errs.push(m);
  };
  if (!m2 || typeof m2 !== "object") return ["not an object"];
  if (m2.schema !== SCHEMA) bad("schema is not 2");
  if (m2.hash !== void 0 && !HASH_RX.test(String(m2.hash))) bad("hash is not 16 hex");
  if (!Array.isArray(m2.matches)) {
    bad("matches is not an array");
    return errs;
  }
  emptyStrings(m2, "$", bad);
  m2.matches.forEach((m, i) => {
    const at2 = "matches[" + i + "]";
    if (!m || typeof m !== "object") {
      bad(at2);
      return;
    }
    for (const side of ["a", "b"]) {
      const t2 = m[side];
      if (t2 === void 0) continue;
      if (!t2 || typeof t2.n !== "string") bad(at2 + "." + side);
      else if (t2.l !== void 0 && !httpsUrl(t2.l)) bad(at2 + "." + side + ".l is not https");
    }
    if (m.kickoff !== void 0 && !Number.isFinite(m.kickoff)) bad(at2 + ".kickoff");
  });
  return errs;
}
var _byId = /* @__PURE__ */ new WeakMap();
function itemById(v2, id) {
  if (!v2 || !Array.isArray(v2.items)) return null;
  let m = _byId.get(v2);
  if (!m) {
    m = /* @__PURE__ */ new Map();
    v2.items.forEach((it, i2) => {
      if (it && it.id != null) m.set(String(it.id), i2);
    });
    _byId.set(v2, m);
  }
  const i = m.get(String(id == null ? "" : id));
  return i === void 0 ? null : v2.items[i];
}
var at = (v2, i) => v2.items[i];
function homeRows(v2) {
  const out = [];
  if (!v2 || !v2.sections) return out;
  const en6 = lang() === "en";
  for (const sec of SECTIONS) {
    if (sec.adult) continue;
    const s = v2.sections[sec.name];
    if (!s || !s.home || !Array.isArray(s.all) || !s.all.length) continue;
    const items = s.all.slice(0, s.home).map((i) => at(v2, i)).filter(Boolean);
    if (!items.length) continue;
    out.push({ id: `sec-${sec.name}`, title: en6 ? sec.titleEn : sec.title, items, ref: `cat:${sec.name}`, genre: sec.genre });
  }
  return out;
}
function sectionView(v2, name) {
  const s = v2 && v2.sections && v2.sections[name];
  if (!s) return null;
  const items = (ids) => (ids || []).map((i) => at(v2, i)).filter(Boolean);
  return {
    slides: (s.slides || []).map((x) => ({ ...x })),
    rails: (s.rails || []).map((r) => {
      const rail = r.title ? { title: r.title, items: items(r.items) } : { items: items(r.items) };
      if (r.ref) rail.ref = r.ref;
      return rail;
    }),
    genres: (s.genres || []).slice(),
    all: items(s.all)
  };
}
var MAX_CATEGORY_TITLE = 40;
function categoryTiles(v2) {
  const out = [];
  if (!v2 || !v2.sections) return out;
  const en6 = lang() === "en";
  for (const sec of SECTIONS) {
    const s = v2.sections[sec.name];
    if (!s || !Array.isArray(s.all) || !s.all.length) continue;
    const tile = { id: `sec-${sec.name}`, title: (en6 ? sec.titleEn : sec.title).slice(0, MAX_CATEGORY_TITLE), ref: `cat:${sec.name}` };
    if (sec.adult) tile.adult = true;
    else {
      const first = s.all.map((i) => at(v2, i)).find(Boolean);
      const art = first && (first.backdrop || first.poster);
      if (art) tile.art = art;
    }
    out.push(tile);
  }
  return out;
}
function browsePage(v2, name, cursor, size = BROWSE_PAGE) {
  const s = v2 && v2.sections && v2.sections[name];
  if (!s || !Array.isArray(s.all)) return { items: [], next: null };
  const page = Math.max(1, parseInt(cursor || "1", 10) || 1);
  const start = (page - 1) * size;
  const items = s.all.slice(start, start + size).map((i) => at(v2, i)).filter(Boolean);
  return { items, next: start + size < s.all.length ? String(page + 1) : null };
}
var LIVE_BEFORE_MS = 5 * 60 * 1e3;
var LIVE_AFTER_MS = 130 * 60 * 1e3;
var HIDE_AFTER_MS = 3 * 3600 * 1e3;
function parseUtcTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(s || ""));
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
}
function matchStart(m) {
  if (m && Number.isFinite(m.kickoff)) return m.kickoff;
  return parseUtcTime(m && m.time);
}
function isLiveMatch(m, now = Date.now()) {
  const t2 = matchStart(m);
  return Number.isFinite(t2) && now >= t2 - LIVE_BEFORE_MS && now <= t2 + LIVE_AFTER_MS;
}
function visibleMatches(list, now = Date.now()) {
  return (list || []).filter((m) => {
    const t2 = matchStart(m);
    return !Number.isFinite(t2) || t2 + HIDE_AFTER_MS >= now;
  });
}

// src/data.js
var MIN2 = 60 * 1e3;
var KEYS = { cat: "o2:cat", catm: "o2:catm", mat: "o2:mat", matm: "o2:matm", ix: "o2:ix", ixm: "o2:ixm" };
var INDEX_MISSING_MS = 6 * 60 * MIN2;
var INDEX_FAILS_BEFORE_RELEASE = 3;
var PART_RETRY_MS = 60 * 1e3;
var BACKOFF_MS = [1, 5, 15, 60].map((m) => m * MIN2);
var CALL_BUDGET_MS2 = 16e3;
var FALLBACK_MAX_MS = 8e3;
var FALLBACK_MIN_MS = 1500;
var FALLBACK_RETRY_MS = 60 * 1e3;
var H12 = /^[0-9a-f]{12}$/;
var PARTS = {
  catalog: {
    key: KEYS.cat,
    meta: KEYS.catm,
    dir: "c",
    asset: "home.json",
    relTtl: 60 * MIN2,
    // The revision of this device-side conversion, kept in the meta as `b`. A Release copy built by an older one is
    // downloaded in full and converted again once (releasePart). 2 = the rails carry their «Ver más» ref (3.0.1).
    build: 2,
    fromLegacy: (j) => fromLegacyHome(j, { poster: "recommended" }),
    validate: validateCatalog,
    shape: (v) => !!v && v.schema === SCHEMA && Array.isArray(v.items) && !!v.sections && typeof v.sections === "object"
  },
  matches: {
    key: KEYS.mat,
    meta: KEYS.matm,
    dir: "m",
    asset: "matches.json",
    relTtl: 30 * MIN2,
    fromLegacy: fromLegacyMatches,
    validate: validateMatches,
    shape: (v) => !!v && v.schema === SCHEMA && Array.isArray(v.matches)
  }
};
var L0 = { catalog: null, matches: null };
var _fallback = /* @__PURE__ */ new Map();
var _fallbackFailAt = /* @__PURE__ */ new Map();
var _committedIn = {};
function log5(m) {
  try {
    kino.log("data: " + m);
  } catch (_) {
  }
}
var sha256 = (t2) => kino.crypto.hash("sha256", t2);
var backoffMs = (n) => BACKOFF_MS[Math.min(Math.max(n | 0, 1), BACKOFF_MS.length) - 1];
var inBackoff = (m, now) => {
  const f = saneAt(m && m.failAt, now);
  return !!f && now - f < backoffMs(m.failN);
};
var dueSince = (stamp2, ttl, now) => {
  const t2 = saneAt(stamp2, now);
  return !t2 || now - t2 >= ttl;
};
var indexMissing = (ixm, now) => {
  const u = Number(ixm && ixm.missingUntil) || 0;
  return u > now && u - now <= INDEX_MISSING_MS + CLOCK_SKEW_MS;
};
var _budget = { seq: -1, ms: CALL_BUDGET_MS2 };
var callBudgetMs = () => _budget.seq === callSeq() ? _budget.ms : CALL_BUDGET_MS2;
function tightenBudget(ms) {
  _budget = { seq: callSeq(), ms: Math.min(callBudgetMs(), ms) };
}
var remaining2 = () => callStartedAt() + callBudgetMs() - Date.now();
var budget = (max) => Math.max(1e3, Math.min(max, remaining2()));
function read(name) {
  const p = PARTS[name];
  const m = getJson(p.meta);
  const l0 = L0[name];
  if (l0 && (!m || !m.h || m.h === l0.h)) return l0.v;
  const t2 = getText(p.key);
  if (t2 === null) return l0 ? l0.v : null;
  let v;
  try {
    v = JSON.parse(t2);
  } catch (_) {
    v = null;
  }
  if (!p.shape(v)) {
    remove(p.key);
    return l0 ? l0.v : null;
  }
  L0[name] = { h: String(v.hash || m && m.h || ""), v };
  return v;
}
function catalog() {
  return read("catalog");
}
function matches() {
  return read("matches");
}
function rev() {
  const c = getJson(KEYS.catm), m = getJson(KEYS.matm);
  return String(c && c.h || "-").slice(0, 8) + "." + String(m && m.h || "-").slice(0, 8);
}
function dataAges() {
  const out = {};
  for (const name of Object.keys(PARTS)) {
    const m = getJson(PARTS[name].meta);
    out[name] = m && m.h ? { checkedAt: Number(m.checkedAt) || 0, gen: Number(m.gen) || 0, src: m.src || "" } : null;
  }
  return out;
}
async function revalidate(opts) {
  const o = opts || {};
  if (o.budgetMs > 0) tightenBudget(o.budgetMs);
  const want = Object.keys(PARTS).filter((n) => o[n]);
  if (!want.length) return { changed: false, rev: rev() };
  const metaH = (n) => {
    const m = getJson(PARTS[n].meta);
    return m && m.h || "";
  };
  const before = want.map(metaH);
  const force = !!o.force;
  await Promise.all(want.map((n) => once("rv:" + n, () => revalPart(n, force), { force }).catch((e) => {
    log5("revalidate " + n + " failed: " + (e && (e.code || e.message) || e));
  })));
  const changed2 = want.some((n, i) => metaH(n) !== before[i]);
  return { changed: changed2, rev: rev() };
}
async function revalPart(name, force) {
  const now = Date.now();
  const stored = !!read(name);
  const ixm = getJson(KEYS.ixm) || {};
  if (!indexMissing(ixm, now)) {
    const ix = await once(force ? "ix!" : "ix", () => probeIndex(force));
    if (ix.ok) {
      const entry = ix.index[name];
      if (entry) {
        const m = getJson(PARTS[name].meta) || {};
        if (stored && m.h && m.h.slice(0, 12) === entry.h) {
          if (ix.probed) patchMeta(name, (cur) => cur.h === m.h ? { ...cur, src: "raw", checkedAt: now, failAt: 0, failN: 0 } : null);
          return;
        }
        const r = await fetchPart(name, entry.h, force || !stored, !!ix.probed);
        if (r === "ok" || stored) return;
      }
    } else if (!ix.missing && stored && lastGoodOnIndexError(force)) {
      return;
    }
  }
  await releasePart(name, force);
}
function lastGoodOnIndexError(force) {
  if (force || !parseIndex(getText(KEYS.ix))) return false;
  const ixm = getJson(KEYS.ixm) || {};
  return (ixm.failN | 0) < INDEX_FAILS_BEFORE_RELEASE;
}
function versionLe(a, b) {
  const pa = String(a || "0").split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b || "0").split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
  }
  return true;
}
function parseIndex(text2) {
  if (typeof text2 !== "string" || !text2) return null;
  let j;
  try {
    j = JSON.parse(text2);
  } catch (_) {
    return null;
  }
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
var probeMsOf = (ix) => Math.min(3600, Math.max(60, Number(ix && ix.probeS) || 300)) * 1e3;
async function probeIndex(force) {
  const now = Date.now();
  const ixm = getJson(KEYS.ixm) || {};
  if (indexMissing(ixm, now)) return { ok: false, missing: true };
  const storedText = getText(KEYS.ix);
  const stored = parseIndex(storedText);
  const due = force || (!stored || dueSince(ixm.checkedAt, probeMsOf(stored), now)) && !inBackoff(ixm, now);
  if (!due) return stored ? { ok: true, index: stored, probed: false } : { ok: false, missing: false };
  if (remaining2() < 1e3) return stored ? { ok: true, index: stored, probed: false } : { ok: false, missing: false };
  const r = await condGet(DATA_BASE + "index.json", {
    etag: stored ? ixm.etag : "",
    lm: stored ? ixm.lm : "",
    timeoutMs: budget(stored ? 3e3 : 6e3)
  });
  if (r.status === 304 && stored) {
    setJson(KEYS.ixm, { ...ixm, checkedAt: now, failAt: 0, failN: 0, missingUntil: 0 });
    return { ok: true, index: stored, probed: true };
  }
  if (r.status === 200) {
    const ix = parseIndex(r.text);
    if (!ix) {
      log5("index unusable (schema/minPlugin): Release for 6 h");
      setJson(KEYS.ixm, { ...ixm, checkedAt: now, missingUntil: now + INDEX_MISSING_MS });
      return { ok: false, missing: true };
    }
    if (r.text !== storedText) setText(KEYS.ix, r.text);
    setJson(KEYS.ixm, { etag: r.etag || "", lm: r.lm || "", checkedAt: now, missingUntil: 0, failAt: 0, failN: 0 });
    return { ok: true, index: ix, probed: true };
  }
  if (r.code === 404) {
    log5("index 404: Release for 6 h");
    setJson(KEYS.ixm, { ...ixm, checkedAt: now, missingUntil: now + INDEX_MISSING_MS });
    return { ok: false, missing: true };
  }
  log5("index failed: " + r.code);
  setJson(KEYS.ixm, { ...ixm, failAt: now, failN: (ixm.failN | 0) + 1 });
  return { ok: false, missing: false };
}
async function fetchPart(name, h, force, authoritative) {
  const p = PARTS[name];
  const now = Date.now();
  const m = getJson(p.meta) || {};
  if (!force && m.failH === h && inBackoff(m, now)) return "skip";
  if (remaining2() < 1e3) return "skip";
  const r = await condGet(DATA_BASE + "v2/" + p.dir + "/" + h + ".json", { timeoutMs: budget(8e3) });
  let v = null, why4 = "";
  if (r.status === 200) {
    try {
      v = JSON.parse(r.text);
    } catch (_) {
      why4 = "parse";
    }
    if (v) {
      const errs = p.validate(v);
      if (errs.length) why4 = "invalid: " + errs.slice(0, 3).join("; ");
      else if (canonicalHash(v, sha256) !== v.hash || String(v.hash).slice(0, 12) !== h) why4 = "hash mismatch";
    }
  } else {
    why4 = "http " + r.code;
    if (r.code === 404) {
      const ixm = getJson(KEYS.ixm) || {};
      const ix = parseIndex(getText(KEYS.ix));
      setJson(KEYS.ixm, { ...ixm, checkedAt: now - probeMsOf(ix) + PART_RETRY_MS });
    }
  }
  if (!why4 && !v) why4 = "not an object";
  if (!why4) why4 = commit(name, r.text, v, { src: "raw", etag: "", lm: "", checkedAt: now }, authoritative);
  if (why4) {
    log5(name + " v2/" + p.dir + "/" + h + " failed: " + why4);
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
  const rebuild = !!have && m.src === "rel" && (Number(m.b) || 0) < (p.build || 0);
  const due = force || !have || (rebuild || dueSince(m.checkedAt, p.relTtl, now)) && !inBackoff(m, now);
  if (!due || remaining2() < 1e3) return;
  const fromRel = !!have && m.src === "rel" && !rebuild;
  const r = await condGet(RELEASE_BASE + "/" + p.asset, {
    etag: fromRel ? m.etag : "",
    lm: fromRel ? m.lm : "",
    // Kino applies the timeout per hop (github.com 302, then the asset): keep two hops inside the call budget.
    timeoutMs: budget(Math.min(have ? 5e3 : 8e3, Math.floor(remaining2() / 2)))
  });
  if (r.status === 304 && fromRel) {
    patchMeta(name, (cur) => cur.h === m.h ? { ...cur, checkedAt: now, failAt: 0, failN: 0 } : null);
    return;
  }
  let v = null, why4 = "";
  if (r.status === 200) {
    let legacy = null;
    try {
      legacy = JSON.parse(r.text);
    } catch (_) {
      why4 = "parse";
    }
    if (legacy) {
      try {
        v = seal(p.fromLegacy(legacy), Number(legacy.generatedAt) || 0, sha256);
        const errs = p.validate(v);
        if (errs.length) why4 = "invalid: " + errs.slice(0, 3).join("; ");
      } catch (e) {
        why4 = "convert: " + (e && e.message || e);
      }
    }
  } else {
    why4 = "http " + r.code;
  }
  if (!why4 && !v) why4 = "not an object";
  if (!why4) why4 = commit(name, JSON.stringify(v), v, { src: "rel", etag: r.etag || "", lm: r.lm || "", checkedAt: now, b: p.build || 0 }, false);
  if (why4) {
    log5(name + " release failed: " + why4);
    patchMeta(name, (cur) => ({ ...cur, failAt: now, failN: (cur.failN | 0) + 1 }));
  }
}
function patchMeta(name, fn) {
  const p = PARTS[name];
  const cur = getJson(p.meta) || {};
  const next = fn(cur);
  if (next) setJson(p.meta, next);
}
function commit(name, text2, v, fields, authoritative) {
  const p = PARTS[name];
  const now = Date.now();
  const cur = getJson(p.meta) || {};
  const gen2 = Number(v.gen) || 0;
  if (cur.h && cur.h !== v.hash) {
    if (_committedIn[name] !== callSeq() && saneAt(cur.writtenAt, now) > callStartedAt()) {
      return "another runtime stored a newer copy after this call began";
    }
    if (!authoritative && (Number(cur.gen) || 0) > gen2) return "older than the stored copy (gen " + gen2 + " < " + cur.gen + ")";
  }
  const have = read(name);
  const same2 = !!have && have.hash === v.hash;
  if (!same2 && !setText(p.key, text2)) {
    if (!have) L0[name] = { h: v.hash, v };
    return "text not stored (storage refused it; " + (have ? "the stored copy stays" : "kept in memory only") + ")";
  }
  setJson(p.meta, {
    h: v.hash,
    gen: Math.max(gen2, cur.h === v.hash ? Number(cur.gen) || 0 : 0),
    etag: fields.etag || "",
    lm: fields.lm || "",
    src: fields.src,
    checkedAt: fields.checkedAt,
    writtenAt: now,
    failAt: 0,
    failN: 0,
    ...fields.b ? { b: fields.b } : {}
  });
  _committedIn[name] = callSeq();
  L0[name] = { h: v.hash, v };
  return "";
}
async function loadFallbackSection(name) {
  if (_fallback.has(name)) return true;
  const failedAt = _fallbackFailAt.get(name) || 0;
  if (failedAt && Date.now() - failedAt < FALLBACK_RETRY_MS) return false;
  const left = remaining2();
  if (left < FALLBACK_MIN_MS) return false;
  let data;
  try {
    data = await authed("GET", `/section/${encodeURIComponent(name)}?page=1&size=30`, void 0, Math.min(FALLBACK_MAX_MS, left));
  } catch (e) {
    _fallbackFailAt.set(name, Date.now());
    throw e;
  }
  const body = fromLegacyHome({ sections: { [name]: data } }, { poster: "recommended" });
  if (!body.sections[name]) return false;
  _fallback.set(name, body);
  return true;
}
function fallbackSectionView(name) {
  const b = _fallback.get(name);
  return b ? sectionView(b, name) : null;
}

// src/sources/m3u.js
var STATE_PREFIX = "o2:m3u:";
var STATE_TTL_MS = 7 * 24 * 3600 * 1e3;
var KEPT_HEADERS = { "user-agent": "User-Agent", referer: "Referer", referrer: "Referer", origin: "Origin", cookie: "Cookie" };
var MAX_HEADER_VALUE = 1024;
function attr(line, key) {
  const m = line.match(new RegExp(key + '="([^"]*)"'));
  return m ? m[1] : "";
}
function extinfTitle(line) {
  const body = line.slice(line.indexOf(":") + 1);
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"') quote = '"';
    else if (c === "'" && i > 0 && body[i - 1] === "=") quote = "'";
    else if (c === ",") return body.slice(i + 1).trim();
  }
  return "";
}
function putHeader(into, rawName, value) {
  const name = KEPT_HEADERS[String(rawName || "").trim().toLowerCase()];
  const v = String(value == null ? "" : value).trim();
  if (!name || !v || v.length > MAX_HEADER_VALUE || /[\u0000-\u001f\u007f]/.test(v)) return;
  into[name] = v;
}
function pairs(s, into) {
  for (const pair2 of String(s || "").split("&")) {
    const eq = pair2.indexOf("=");
    if (eq <= 0) continue;
    let v = pair2.slice(eq + 1).trim();
    try {
      v = decodeURIComponent(v.replace(/\+/g, "%2B"));
    } catch (_) {
    }
    putHeader(into, pair2.slice(0, eq), v);
  }
}
function vlcOpt(v, into) {
  const eq = v.indexOf("=");
  if (eq < 0) return;
  const k = v.slice(0, eq).trim().toLowerCase();
  const name = k === "http-user-agent" ? "user-agent" : k === "http-referrer" || k === "http-referer" ? "referer" : k === "http-origin" ? "origin" : "";
  if (name) putHeader(into, name, v.slice(eq + 1));
}
function kodiProp(v, into) {
  const eq = v.indexOf("=");
  if (eq < 0) return;
  const k = v.slice(0, eq).trim().toLowerCase();
  if (k === "inputstream.adaptive.stream_headers" || k === "inputstream.adaptive.common_headers") pairs(v.slice(eq + 1), into);
}
function extHttp(v, into) {
  let o = null;
  try {
    o = JSON.parse(v.trim());
  } catch (_) {
    return;
  }
  if (!o || typeof o !== "object") return;
  for (const k of Object.keys(o)) if (typeof o[k] === "string") putHeader(into, k, o[k]);
}
function parseM3U(text2) {
  const lines = String(text2 || "").split(/\r?\n/);
  const chans = [];
  let cur = null;
  let pending = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const name = extinfTitle(line);
      cur = { name: name || attr(line, "tvg-name") || "\u2014", logo: attr(line, "tvg-logo"), group: attr(line, "group-title") || "General" };
    } else if (/^#EXTVLCOPT:/i.test(line)) {
      vlcOpt(line.slice(line.indexOf(":") + 1), pending);
    } else if (/^#KODIPROP:/i.test(line)) {
      kodiProp(line.slice(line.indexOf(":") + 1), pending);
    } else if (/^#EXTHTTP:/i.test(line)) {
      extHttp(line.slice(line.indexOf(":") + 1), pending);
    } else if (line.startsWith("#")) {
      continue;
    } else {
      if (cur) {
        cur.url = line;
        const pipe = line.indexOf("|");
        if (pipe >= 0) pairs(line.slice(pipe + 1), pending);
        if (Object.keys(pending).length) cur.headers = pending;
        chans.push(cur);
      }
      cur = null;
      pending = {};
    }
  }
  return chans;
}
var HLS = "application/vnd.apple.mpegurl";
var DASH = "application/dash+xml";
var TS = "video/mp2t";
function pathOf(url) {
  return String(url || "").replace(/[?#].*$/, "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").toLowerCase();
}
function mimeFor(url) {
  const path = pathOf(url);
  if (/\.mpd$/.test(path)) return DASH;
  if (/\.m3u8?$/.test(path)) return HLS;
  if (/\.(?:ts|mts|m2ts)$/.test(path)) return TS;
  if (/\/play\/[^/.]+$/.test(path)) return TS;
  const u = String(url || "").toLowerCase();
  if (u.indexOf(".mpd") >= 0) return DASH;
  if (u.indexOf(".ts") >= 0 && u.indexOf(".m3u8") < 0) return TS;
  return HLS;
}
function isAdultGroup(title) {
  return isAdultTitle(title);
}
function shape(chans) {
  const cats = [];
  const groups = /* @__PURE__ */ new Map();
  const adult = /* @__PURE__ */ new Set();
  const hdr = {};
  for (const c of chans) {
    if (!c.url) continue;
    let list = groups.get(c.group);
    if (!list) {
      list = [];
      groups.set(c.group, list);
      const cat = { id: c.group, title: c.group };
      if (isAdultGroup(c.group)) {
        cat.adult = true;
        adult.add(c.group);
      }
      cats.push(cat);
    }
    const ch = { id: c.url, title: c.name };
    if (c.logo) ch.logo = c.logo;
    if (adult.has(c.group)) ch.adult = true;
    list.push(ch);
    if (c.headers && !hdr[c.url]) hdr[c.url] = c.headers;
  }
  return { cats, groups, hdr };
}
function makeM3U(cfg) {
  const stateKey = STATE_PREFIX + cfg.id;
  function readState2() {
    const s = getJson(stateKey);
    return s && typeof s === "object" && Array.isArray(s.cats) ? s : null;
  }
  function writeState2(next) {
    const cur = readState2();
    if (cur && saneAt(cur.at) > callStartedAt()) return;
    const strip2 = (s) => JSON.stringify({ etag: s.etag || "", lm: s.lm || "", cats: s.cats, hdr: s.hdr || {} });
    if (cur && strip2(cur) === strip2(next) && Date.now() - saneAt(cur.at) < STATE_TTL_MS / 2) return;
    setJson(stateKey, { v: 1, etag: next.etag || "", lm: next.lm || "", at: Date.now(), cats: next.cats, hdr: next.hdr || {} }, { ttlMs: STATE_TTL_MS });
  }
  function keepState(res) {
    if (res.kept) return;
    res.kept = true;
    writeState2(res.state);
  }
  async function download(conditional) {
    const st = conditional ? readState2() : null;
    const headers = cfg.ua ? { "User-Agent": cfg.ua } : {};
    if (st) {
      if (st.etag) headers["If-None-Match"] = st.etag;
      if (st.lm) headers["If-Modified-Since"] = st.lm;
    }
    const r = await liveFetch(cfg.url, { method: "GET", headers, cookies: false, timeoutMs: 15e3 });
    if (r && r.status === 304) {
      if (!st) throw new Error("m3u " + cfg.id + ": 304 without a stored copy");
      return { unchanged: true, state: st };
    }
    if (!r || !r.ok) throw new Error("m3u " + cfg.id + " " + (r && r.status));
    const shaped = shape(parseM3U(bodyText(r)));
    if (!shaped.cats.length) throw new Error("m3u " + cfg.id + ": no channel in the list");
    const h = r.headers || {};
    return { unchanged: false, shaped, etag: h.etag || "", lm: h["last-modified"] || "" };
  }
  const once2 = (ctx, key, fn) => ctx && typeof ctx.once === "function" ? ctx.once(key, fn) : fn();
  const get4 = (ctx, conditional) => once2(ctx, "m3u", () => download(conditional));
  const getFull = (ctx) => once2(ctx, "m3u!full", () => download(false));
  function ingest(ctx, res, skipGroup) {
    if (res.ingested) return;
    res.ingested = true;
    const { cats, groups, hdr } = res.shaped;
    if (ctx && typeof ctx.setCats === "function") ctx.setCats(cats);
    if (ctx && typeof ctx.putList === "function") {
      for (const [g, items] of groups) if (g !== skipGroup) ctx.putList(g, items);
    }
    writeState2({ etag: res.etag, lm: res.lm, cats, hdr });
  }
  return {
    id: cfg.id,
    name: cfg.name,
    genre: cfg.genre || "otros",
    sharedFetch: true,
    // one download stores every group's list: one fetch unit for src/live.js's plan
    blind: true,
    // resolve answers with no request (the URL is the raw id): a merged channel probes it
    async categories(ctx) {
      const res = await get4(ctx, true);
      if (res.unchanged) {
        if (ctx && typeof ctx.touchAll === "function") ctx.touchAll();
        keepState(res);
        return res.state.cats;
      }
      ingest(ctx, res, null);
      return res.shaped.cats;
    },
    async channels(categoryId, ctx) {
      const want = String(categoryId == null ? "" : categoryId);
      const stored = ctx && typeof ctx.storedList === "function" ? ctx.storedList(want) : null;
      let res = await get4(ctx, !!stored);
      if (res.unchanged) {
        if (ctx && typeof ctx.touchAll === "function") ctx.touchAll();
        if (ctx && typeof ctx.setCats === "function") ctx.setCats(res.state.cats);
        keepState(res);
        if (stored && ctx.UNCHANGED) return ctx.UNCHANGED;
        res = await getFull(ctx);
      }
      ingest(ctx, res, want);
      return res.shaped.groups.get(want) || [];
    },
    async resolve(channelId) {
      const raw = String(channelId == null ? "" : channelId);
      const pipe = raw.indexOf("|");
      const url = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
      const headers = {};
      if (cfg.ua) headers["User-Agent"] = cfg.ua;
      const st = readState2();
      const named = st && st.hdr && st.hdr[raw];
      if (named && typeof named === "object") for (const k of Object.keys(named)) putHeader(headers, k, named[k]);
      if (pipe >= 0) pairs(raw.slice(pipe + 1), headers);
      const out = { url, mime: mimeFor(url) };
      if (Object.keys(headers).length) out.headers = headers;
      return out;
    }
  };
}

// src/sources/xtream.js
var SEP = "";
var MIME = { m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t" };
var H2 = 60 * 60 * 1e3;
function qs(obj) {
  const out = [];
  for (const k of Object.keys(obj)) out.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])));
  return out.join("&");
}
function encodeChannel(acc, streamId) {
  return acc.url + SEP + acc.username + SEP + acc.password + SEP + String(streamId);
}
function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_) {
    return "";
  }
}
var accKey = (a) => a ? a.url + "|" + a.username : "";
var why = (e) => String(e && (e.message || e.code) || e).slice(0, 60);
function accountOf(channelId) {
  const p = String(channelId || "").split(SEP);
  return p.length >= 4 && p[0] && p[1] ? p[0] + "|" + p[1] : null;
}
function refused(msg) {
  const e = new Error(msg);
  e.hard = true;
  return e;
}
var hardRefusal = (e) => !!e && e.hard === true;
var refusal = (st) => st >= 400 && st < 500 && st !== 408 && st !== 425 && st !== 429 || st === 509;
function headersFor(ua) {
  const h = { "Accept": "application/json,text/plain,*/*", "Cache-Control": "no-cache", "Pragma": "no-cache" };
  if (ua) h["User-Agent"] = ua;
  return h;
}
function locationOf(r, base) {
  const h = r && r.headers || {};
  const loc = h.location || h.Location || "";
  if (!loc) return "";
  try {
    return new URL(String(loc), base).toString();
  } catch (_) {
    return "";
  }
}
async function get(url, ua, timeoutMs) {
  try {
    return await liveFetch(url, { method: "GET", headers: headersFor(ua), cookies: false, timeoutMs: timeoutMs || 15e3, redirect: "manual" });
  } catch (e) {
    const m = e && e.code === "network" ? /\((\d{3})\)/.exec(String(e.message || "")) : null;
    if (m && refusal(Number(m[1]))) throw Object.assign(new Error(String(e.message || "network")), { code: "network", hard: true });
    throw e;
  }
}
async function call2(acc, action, extra, timeoutMs, ua) {
  const url = acc.url + "/player_api.php?" + qs({ username: acc.username, password: acc.password, ...action ? { action } : {}, ...extra || {} });
  let r = await get(url, ua, timeoutMs);
  if (r && r.status >= 300 && r.status < 400) {
    const next = locationOf(r, url);
    const host = hostnameOf(next);
    if (!next || host !== hostnameOf(acc.url)) throw refused("redirect off the server's host (" + (host || "?") + ")");
    r = await get(next, ua, timeoutMs);
    if (r && r.status >= 300 && r.status < 400) throw refused("too many redirects");
  }
  if (!r || !r.ok) {
    const e = new Error("api " + (r && r.status));
    if (r && refusal(Number(r.status))) e.hard = true;
    throw e;
  }
  let data;
  try {
    data = r.json();
  } catch (_) {
    throw new Error("respuesta no-JSON");
  }
  if (data && !Array.isArray(data) && data.user_info && String(data.user_info.auth) === "0") throw refused("auth 0");
  return data;
}
function probeShared(acc, ua, timeoutMs) {
  return once("xt:probe:" + accKey(acc), async () => {
    const cats = await call2(acc, "get_live_categories", {}, timeoutMs, ua);
    if (!Array.isArray(cats) || !cats.length) throw refused("sin categor\xEDas");
    return cats;
  });
}
var probeKey = (acc) => "xt:probe:" + accKey(acc);
function makeXtream(cfg) {
  const ext = cfg.ext === "ts" ? "ts" : "m3u8";
  const ua = cfg.ua || "";
  const maxProbe = cfg.maxProbe || 20;
  const batch = Math.max(1, cfg.probeBatch || 6);
  const probeMs = cfg.probeTimeoutMs || 3e3;
  const freshMs = cfg.accountFreshMs || 6 * H2;
  const memory = cfg.account || { load: () => null, save: () => {
  } };
  const flight = cfg.flight || cfg.id;
  async function probe2(acc) {
    const cats = await probeShared(acc, ua, probeMs);
    if (!shapeCats(cats).length) throw refused("sin categor\xEDas \xFAtiles");
    return cats;
  }
  async function pick(ctx, exclude) {
    const c = ctx || {};
    const tried = /* @__PURE__ */ new Set();
    if (exclude) tried.add(accKey(exclude));
    let last = "sin cuentas";
    const remembered = memory.load();
    const keep = (acc, cats) => {
      memory.save(acc);
      if (remembered && accKey(acc) !== accKey(remembered) && typeof c.dropLists === "function") c.dropLists();
      if (typeof cfg.onPicked === "function") cfg.onPicked(acc, cats, shapeCats(cats));
    };
    if (remembered && !tried.has(accKey(remembered))) {
      tried.add(accKey(remembered));
      try {
        const cats = await probe2(remembered);
        keep(remembered, cats);
        return { acc: remembered, cats };
      } catch (e) {
        last = why(e);
      }
    }
    const got = await cfg.getAccounts(c);
    const accounts = (Array.isArray(got) ? got : []).filter((a) => a && !tried.has(accKey(a))).slice(0, maxProbe);
    for (let i = 0; i < accounts.length; i += batch) {
      const slice = accounts.slice(i, i + batch);
      const results = await Promise.all(slice.map((acc) => probe2(acc).then((cats) => ({ acc, cats }), (e) => ({ err: why(e) }))));
      for (const res of results) {
        if (res.acc) {
          keep(res.acc, res.cats);
          return res;
        }
        last = res.err;
      }
    }
    throw new Error("ninguna cuenta Xtream respondi\xF3 (" + last + ")");
  }
  function freshAccount() {
    const a = memory.load();
    return a && Date.now() - (Number(a.at) || 0) < freshMs ? a : null;
  }
  function rankOf2(name) {
    const s = String(name || "");
    const adult = isAdultTitle(s);
    if (cfg.adultOnly) return adult ? 0 : -1;
    if (adult && cfg.skipAdult) return -1;
    if (typeof cfg.keepCat === "function" && !cfg.keepCat(s)) return -1;
    if (typeof cfg.rankCat === "function") {
      const r = cfg.rankCat(s);
      return typeof r === "number" && r >= 0 ? r : -1;
    }
    if (typeof cfg.catFilter === "function" && !cfg.catFilter(s)) return -1;
    return 0;
  }
  function shapeCats(raw) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const c of Array.isArray(raw) ? raw : []) {
      const cid = c && c.category_id != null ? String(c.category_id) : "";
      if (!cid || seen.has(cid)) continue;
      const rank = rankOf2(c.category_name);
      if (rank < 0) continue;
      seen.add(cid);
      const e = { id: cid, title: String(c.category_name || "").trim() || cid, rank, i: out.length };
      if (isAdultTitle(c.category_name)) e.adult = true;
      out.push(e);
    }
    out.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return out.slice(0, cfg.maxCats > 0 ? cfg.maxCats : out.length).map((e) => e.adult ? { id: e.id, title: e.title, adult: true } : { id: e.id, title: e.title });
  }
  const hasCat = (raw, id) => (Array.isArray(raw) ? raw : []).some((c) => c && String(c.category_id) === id);
  function toChannels(acc, list) {
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const s of Array.isArray(list) ? list : []) {
      const sid = s && (s.stream_id != null ? s.stream_id : s.id);
      if (sid == null) continue;
      const title = String(s && s.name || "").trim();
      if (!title) continue;
      const id = encodeChannel(acc, sid);
      if (seen.has(id)) continue;
      seen.add(id);
      const ch = { id, title };
      const logo = s && s.stream_icon;
      if (typeof logo === "string" && /^https?:\/\//i.test(logo)) ch.logo = logo;
      out.push(ch);
    }
    return out;
  }
  async function listStreams(acc, cat) {
    return toChannels(acc, await call2(acc, "get_live_streams", { category_id: String(cat) }, void 0, ua));
  }
  const conn3 = {
    id: cfg.id,
    name: cfg.name,
    genre: cfg.genre || "otros",
    blind: true,
    // resolve builds the URL with no request: a merged channel probes it
    accountOf,
    /** Raw categories → this connector's categories (the same filter its lists use). */
    shapeCats,
    async categories(ctx) {
      const p = await once(flight + ":acct", () => pick(ctx || {}));
      return shapeCats(p.cats);
    },
    async channels(categoryId, ctx) {
      const c = ctx || {};
      const cat = String(categoryId);
      let picked = null;
      const adopt = (p) => {
        if (typeof c.setCats === "function") c.setCats(shapeCats(p.cats));
        if (!hasCat(p.cats, cat)) throw new Error("category not on the current server");
        return p.acc;
      };
      let acc = freshAccount();
      if (!acc) {
        picked = await once(flight + ":acct", () => pick(c));
        acc = adopt(picked);
      }
      try {
        return await listStreams(acc, cat);
      } catch (e) {
        if (picked) throw e;
        const dead = acc;
        picked = await once(flight + ":acct!" + accKey(dead), () => pick(c, dead));
        acc = adopt(picked);
        return listStreams(acc, cat);
      }
    },
    async resolve(channelId) {
      const parts2 = String(channelId || "").split(SEP);
      if (parts2.length < 4) throw new Error("canal inv\xE1lido");
      const url = parts2[0];
      const username = parts2[1];
      const password = parts2[2];
      const sid = parts2[3];
      if (!url || !/^\d+$/.test(sid)) throw new Error("canal inv\xE1lido");
      const out = {
        url: `${url}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${sid}.${ext}`,
        mime: MIME[ext]
      };
      if (ua) out.headers = { "User-Agent": ua };
      return out;
    }
  };
  if (cfg.catTtl) conn3.catTtl = cfg.catTtl;
  if (typeof cfg.listTtl === "function") conn3.listTtl = cfg.listTtl;
  if (cfg.secondary) {
    const kit = { shapeCats, listStreams };
    conn3.secondaryOf = cfg.secondary.of;
    conn3.active = cfg.secondary.active;
    conn3.categories = (ctx) => cfg.secondary.categories(ctx || {}, kit);
    conn3.channels = (categoryId, ctx) => cfg.secondary.channels(String(categoryId), ctx || {}, kit);
  }
  return conn3;
}

// src/sources/sports.js
var SPORTS_KW = [
  "deporte",
  "deportiv",
  "sport",
  "futbol",
  "football",
  "soccer",
  "espn",
  "fox sport",
  "fox deportes",
  "dazn",
  "bein",
  "tnt sport",
  "sky sport",
  "directv sport",
  "win sport",
  "tudn",
  "goltv",
  "gol tv",
  "formula",
  "moto gp",
  "motogp",
  "nascar",
  "nba",
  "nfl",
  "nhl",
  "mlb",
  "mls",
  "ufc",
  "wwe",
  "aew",
  "boxeo",
  "boxing",
  "tennis",
  "tenis",
  "golf",
  "cricket",
  "rugby",
  "champions",
  "laliga",
  "la liga",
  "premier league",
  "serie a",
  "bundesliga",
  "ligue 1",
  "eurosport",
  "dsports",
  "d sport",
  "libertadores",
  "sudamericana",
  "olimpic",
  "olympic",
  "wimbledon",
  "pga",
  "handball",
  "voley",
  "volley",
  "hockey"
];
function normCat(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}
function isSports(name) {
  const n = normCat(name);
  for (const kw of SPORTS_KW) if (n.indexOf(kw) >= 0) return true;
  return false;
}
var FOOTBALL_KW = [
  "futbol",
  "football",
  "soccer",
  "laliga",
  "la liga",
  "premier league",
  "champions",
  "libertadores",
  "sudamericana",
  "conmebol",
  "eliminatorias",
  "uefa",
  "fifa",
  "bundesliga",
  "serie a",
  "ligue 1",
  "eredivisie",
  "mls",
  "brasileirao",
  "copa",
  "mundial",
  "liga 1",
  "liga pro",
  "primera",
  "futsal",
  "win sport",
  "goltv",
  "gol tv",
  "gol ",
  "dsport",
  "directv sport",
  "espn",
  "fox sport",
  "fox deportes",
  "bein",
  "tnt sport",
  "sportv",
  "sky sport",
  "liga1",
  "tudn",
  "ligamx",
  "liga mx"
];
function isFootball(name) {
  const n = normCat(name);
  for (const kw of FOOTBALL_KW) if (n.indexOf(kw) >= 0) return true;
  return false;
}

// src/liveMap.js
var MAX_EXPOSED = 90;
var PASS_CAP = { xuper: 24 };
var PASS_CAP_DEFAULT = 6;
var ID = /^[A-Za-z0-9._~-]{1,128}$/;
var fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var LATAM = [
  ["co", "Colombia", "Colombia"],
  ["mx", "M\xE9xico", "Mexico"],
  ["ar", "Argentina", "Argentina"],
  ["pe", "Per\xFA", "Peru"],
  ["cl", "Chile", "Chile"],
  ["ec", "Ecuador", "Ecuador"],
  ["ve", "Venezuela", "Venezuela"],
  ["bo", "Bolivia", "Bolivia"],
  ["py", "Paraguay", "Paraguay"],
  ["uy", "Uruguay", "Uruguay"],
  ["cr", "Costa Rica", "Costa Rica"],
  ["pa", "Panam\xE1", "Panama"],
  ["ni", "Nicaragua", "Nicaragua"],
  ["hn", "Honduras", "Honduras"],
  ["gt", "Guatemala", "Guatemala"],
  ["sv", "El Salvador", "El Salvador"],
  ["do", "Rep\xFAblica Dominicana", "Dominican Republic"],
  ["pr", "Puerto Rico", "Puerto Rico"],
  ["cu", "Cuba", "Cuba"]
];
var WORLD = [
  ["us", "Estados Unidos", "United States"],
  ["ca", "Canad\xE1", "Canada"],
  ["es", "Espa\xF1a", "Spain"],
  ["br", "Brasil", "Brazil"],
  ["pt", "Portugal", "Portugal"],
  ["it", "Italia", "Italy"],
  ["fr", "Francia", "France"],
  ["de", "Alemania", "Germany"],
  ["gb", "Reino Unido", "United Kingdom"]
];
var SPORT_CCS = [
  ["es", "Espa\xF1a", "Spain"],
  ["gb", "Reino Unido", "United Kingdom"],
  ["de", "Alemania", "Germany"],
  ["it", "Italia", "Italy"],
  ["fr", "Francia", "France"],
  ["nl", "Pa\xEDses Bajos", "Netherlands"],
  ["pt", "Portugal", "Portugal"],
  ["us", "Estados Unidos", "United States"]
];
var country = ([cc, es, enT]) => ({ id: "v." + cc, es, en: enT, kind: "country", genre: "otros", cc, country: cc.toUpperCase(), merge: true });
var theme = (id, es, enT, genre) => ({ id, es, en: enT, kind: "theme", genre, merge: true });
var VIRTUAL = [
  country(LATAM[0]),
  { id: "v.sports", es: "Deportes", en: "Sports", kind: "sports", genre: "deportes", merge: true },
  ...LATAM.slice(1).map(country),
  { id: "v.cam", es: "Centroam\xE9rica", en: "Central America", kind: "country", genre: "otros", merge: true },
  { id: "v.latam", es: "Latinoam\xE9rica", en: "Latin America", kind: "country", genre: "otros", merge: true },
  { id: "v.events", es: "Eventos en vivo", en: "Live events", kind: "events", genre: "deportes", merge: false },
  { id: "v.othersp", es: "Otros deportes", en: "Other sports", kind: "othersp", genre: "deportes", merge: true },
  ...WORLD.map(country),
  { id: "v.intl", es: "Internacional", en: "International", kind: "country", genre: "otros", merge: true },
  theme("v.news", "Noticias", "News", "noticias"),
  theme("v.ent", "Entretenimiento", "Entertainment", "entretenimiento"),
  theme("v.novelas", "Novelas", "Telenovelas", "entretenimiento"),
  theme("v.movies", "Cine y series", "Movies and series", "peliculas"),
  theme("v.247", "Series 24/7", "24/7 series", "series"),
  theme("v.kids", "Infantil", "Kids", "infantil"),
  theme("v.anime", "Anime", "Anime", "anime"),
  theme("v.asia", "Doramas y Asia", "Asian dramas", "series"),
  theme("v.docs", "Documentales y cultura", "Documentaries and culture", "documentales"),
  theme("v.music", "M\xFAsica y radio", "Music and radio", "musica"),
  theme("v.faith", "Religi\xF3n", "Faith", "otros"),
  ...SPORT_CCS.map(([cc, es, enT]) => ({ id: "v.sp." + cc, es: "Deportes \xB7 " + es, en: "Sports \xB7 " + enT, kind: "sports", genre: "deportes", cc, country: cc.toUpperCase(), merge: true })),
  { id: "v.sp.eu", es: "F\xFAtbol europeo (UEFA)", en: "European football (UEFA)", kind: "sports", genre: "deportes", merge: true },
  { id: "v.sp.world", es: "Deportes internacionales", en: "International sports", kind: "sports", genre: "deportes", merge: true },
  { id: "v.all.xuper", es: "Todos los canales de Xuper", en: "All Xuper channels", kind: "all", genre: "otros", merge: false }
];
var ADULT_ENTRY = { id: "v.adult", es: "Adultos", en: "Adults", kind: "adult", genre: "otros", merge: true, adult: true };
var BY_ID = new Map([...VIRTUAL, ADULT_ENTRY].map((v) => [v.id, v]));
var isVirtualId = (id) => String(id || "").startsWith("v.");
var OVERRIDES = {
  tvenvivo: {
    deportes: "v.sports",
    co: "v.co",
    mx: "v.mx",
    pe: "v.pe",
    ar: "v.ar",
    us: "v.us",
    intl: "v.intl",
    novelas: "v.novelas",
    infantil: "v.kids",
    docs: "v.docs",
    cine: "v.movies"
  },
  caracol: { all: "v.co" },
  cablevisionhd: {
    sports: "v.sports",
    entertainment: "v.ent",
    news: "v.news",
    movies: "v.movies",
    kids: "v.kids",
    education: "v.docs",
    other: "v.ent"
  },
  premiumtv: { "TV Chichicasteca": "v.gt", "Canela TV": "v.movies", "FreeTV": "v.movies", "LG Channels": "v.movies" },
  futbollibre: { hoy: "v.events", main: "v.sports", mas: "v.sports" },
  // Its 24/7 networks are the US line-up (FOX, FS1, CBS Sports Network, ESPN with "ESPN Deportes" listed apart): their
  // "ESPN 2" or "Fox Sports 2" is not the Latin American channel of that name, so they never share its category.
  "nuvio-sports": { networks: "v.sp.us" }
};
var EVENT_SOURCES = /* @__PURE__ */ new Set(["nuvio-sports", "deportv", "cncverse"]);
var SPORT_SOURCES = /* @__PURE__ */ new Set(["supertv", "futbollibre", "nuvio-sports", "deportv", "cncverse"]);
var CODES = {
  co: "co",
  col: "co",
  mx: "mx",
  mex: "mx",
  pe: "pe",
  cl: "cl",
  ec: "ec",
  ecu: "ec",
  ve: "ve",
  ven: "ve",
  bo: "bo",
  bol: "bo",
  py: "py",
  uy: "uy",
  uru: "uy",
  cr: "cr",
  pa: "pa",
  pan: "pa",
  ni: "ni",
  nic: "ni",
  hn: "hn",
  gt: "gt",
  gua: "gt",
  sv: "sv",
  do: "do",
  rd: "do",
  pr: "pr",
  cu: "cu",
  us: "us",
  usa: "us",
  eeuu: "us",
  es: "es",
  esp: "es",
  br: "br",
  bra: "br",
  pt: "pt",
  it: "it",
  ita: "it",
  fr: "fr",
  fra: "fr",
  de: "de",
  ger: "de",
  nl: "nl",
  uk: "gb",
  gb: "gb",
  arg: "ar",
  lat: "latam",
  latam: "latam",
  latino: "latam",
  latin: "latam",
  ucl: "eu",
  uefa: "eu",
  eu: "eu"
};
function codeOf2(code, srcId) {
  if (code === "ar") return srcId === "supertv" ? "world" : null;
  if (code === "ca" || code === "can") return srcId === "supertv" ? "ca" : null;
  return CODES[code] || null;
}
var NAMES = [
  ["co", /\bcolombia(?:n[oa]s?)?\b/],
  ["mx", /\bmexic(?:o|an[oa]s?)\b/],
  ["ar", /\bargentin(?:a|[oa]s?)\b/],
  ["pe", /\bperu(?:an[oa]s?)?\b/],
  ["cl", /\bchile(?:n[oa]s?)?\b/],
  ["ec", /\becuador\b|\becuatorian[oa]s?\b/],
  ["ve", /\bvenezol\w*|\bvenezuela\b/],
  ["bo", /\bbolivi(?:a|an[oa]s?)\b/],
  ["py", /\bparaguay\w*/],
  ["uy", /\buruguay\w*/],
  ["cr", /\bcosta ?rica\b|\bcostarricense\w*/],
  ["pa", /\bpanam(?:a|en[oa]s?)\b/],
  ["ni", /\bnicaragu\w*/],
  ["hn", /\bhonduras\b|\bhondure\w*/],
  ["gt", /\bguatemal\w*/],
  ["sv", /\bel salvador\b|\bsalvadore\w*/],
  ["do", /\brepublica dominicana\b|\bdominican\w*/],
  ["pr", /\bpuerto rico\b|\bpuertorrique\w*|\bboricua\w*/],
  ["cu", /\bcuba(?:n[oa]s?)?\b/],
  ["us", /\bestados unidos\b|\bunited states\b|\busa\b|\bee ?uu\b/],
  ["es", /\bespana\b|\bspain\b/],
  ["br", /\bbrasil\w*|\bbrazil\b/],
  ["pt", /\bportugal\b/],
  ["it", /\bitalia\b|\bitaly\b/],
  ["fr", /\bfrancia\b|\bfrance\b/],
  ["de", /\balemania\b|\bgermany\b|\bdeutschland\b/],
  ["gb", /\breino unido\b|\bunited kingdom\b|\binglaterra\b|\bengland\b/],
  ["ca", /\bcanada\b/],
  ["cam", /\bcentro ?america\b|\bcentral america\b/],
  ["latam", /\blatin[oa]s?\b|\blatam\b|\blatinoamerica\b|\blatin america\b|\bhispan[oa]s?\b/],
  ["world", /\binternacional(?:es)?\b|\binternational\b|\bmundo\b|\bworld\b|\beuropa\b|\beurope\b|\bturqu\w*|\bturkey\b|\barabe?s?\b|\bindia\b|\brusia\b|\brussia\b|\bafrica\b/]
];
var LATAM_CC = /* @__PURE__ */ new Set([...LATAM.map((c) => c[0]), "cam", "latam"]);
var SPORT_CC = new Set(SPORT_CCS.map((c) => c[0]));
var COUNTRY_IDS = /* @__PURE__ */ new Set([...LATAM.map((c) => c[0]), ...WORLD.map((c) => c[0]), "cam", "latam"]);
var PREFIX = /^\s*[[(┃|]?\s*([a-z]{2,6})\s*(?:[┃▎|:\])]|-\s)/;
var BRACKET = /[[(]\s*([a-z]{2,4})\s*[)\]]/;
function flagCountry(text2) {
  const cps = Array.from(String(text2 == null ? "" : text2));
  for (let i = 0; i + 1 < cps.length; i++) {
    const a = cps[i].codePointAt(0), b = cps[i + 1].codePointAt(0);
    if (a >= 127462 && a <= 127487 && b >= 127462 && b <= 127487) {
      const cc = String.fromCharCode(a - 127462 + 97) + String.fromCharCode(b - 127462 + 97);
      return cc === "uk" ? "gb" : cc;
    }
  }
  return null;
}
function countryOf(srcId, raw, n0) {
  const f = flagCountry(raw);
  if (f) return f;
  const p = PREFIX.exec(n0);
  if (p) {
    const cc = codeOf2(p[1], srcId);
    if (cc) return cc;
    if (srcId === "supertv" && p[1].length <= 4) return "world";
  }
  const b = BRACKET.exec(n0);
  if (b) {
    const cc = codeOf2(b[1], srcId);
    if (cc && cc !== "world") return cc;
  }
  const n = n0.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  for (const [cc, re] of NAMES) if (re.test(n)) return cc;
  return null;
}
var EVENTS = /\beventos?\b|\bevents?\b|\bppv\b|\bpay per view\b|\ben vivo ahora\b|\blive now\b|\bpartidos de hoy\b|\btoday ?s matches\b|\bagenda\b|\bmatch ?day\b/;
var REPLAY = /\breplay\b|\brepeticion\w*/;
var FOOTBALL = /\bfutbol\w*|\bfootball\b|\bsoccer\b|\bfutebol\b|\bcalcio\b|\bfussball\b|\bvoetbal\b|\bliga\b|\blaliga\b|\bligue ?1\b|\bpremier league\b|\bserie a\b|\bbundesliga\b|\bchampions\b|\buefa\b|\bucl\b|\bfifa\b|\bcopa\b|\bsuper ?copa\b|\bcopa mundial\b|\bmundial de clubes\b|\blibertadores\b|\bsudamericana\b|\bconmebol\b|\beliminatorias\b|\beredivisie\b|\bbrasileirao\b|\bmls\b|\bliga ?mx\b|\bliga ?1\b|\bprimera division\b|\bprimera [ab]\b|\bfutsal\b/;
var SPORT_BRANDS = /\bespn\w*|\bfox sports?\b|\bfox deportes\b|\bdazn\b|\bbein\b|\btnt sports?\b|\bsky sports?\b|\bdirec ?tv sports?\b|\bwin sports?\b|\bwin ?\+|\btudn\b|\bgol ?tv\b|\bd ?sports?\b|\btyc sports?\b|\beurosport\w*|\btigo sports?\b|\bclaro sports?\b|\bmovistar deportes\b|\bm\+ deportes\b|\bviaplay\b|\bsportv\b/;
var SPORT_GENERIC = /\bdeportes?\b|\bdeportiv\w*|\bsports?\b|\bsport\b/;
var OTHER_SPORT = /\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bufc\b|\bwwe\b|\baew\b|\bf1\b|\bformula ?(?:1|uno|one)\b|\bmotor\w*|\bmoto ?gp\b|\bnascar\b|\bindy ?car\b|\btenis\b|\btennis\b|\bgolf\b|\bpga\b|\bboxeo\b|\bboxing\b|\bmma\b|\blucha libre\b|\bbaloncesto\b|\bbasket\w*|\bbeisbol\b|\bbaseball\b|\bhockey\b|\brugby\b|\bcricket\b|\bvoley\w*|\bvolley\w*|\bhandball\b|\bbalonmano\b|\bciclismo\b|\bcycling\b|\batletismo\b|\bwimbledon\b|\bjuegos olimpicos\b|\bolimpiadas?\b|\bolympics?\b/;
var THEMES = [
  ["v.kids", /\binfantil\w*|\bkids?\b|\bninos\b|\bchildren\b|\bcaricaturas?\b|\bcartoons?\b|\bdibujos\b|\bdisney\b|\bnick\w*|\bcartoon network\b/],
  ["v.news", /\bnoticias?\b|\bnews\b|\binformativ\w*|\bnoticiero\w*|\bcnn\b|\bbbc\b|\bntn ?24\b|\beuronews\b|\bfrance ?24\b|\btelesur\b/],
  ["v.music", /\bmusica\w*|\bmusic\b|\bradios?\b|\bconciertos?\b|\bconcerts?\b|\bkaraoke\b|\breggaeton\b|\bsalsa\b|\bvallenato\w*|\bcumbia\w*|\bbachata\b|\brock\b|\bhits\b/],
  ["v.docs", /\bdocumental\w*|\bdocumentar\w*|\bdocs?\b|\bcultur\w*|\beducaci\w*|\beducation\b|\bciencia\b|\bscience\b|\btecnolog\w*|\btechnology\b|\bnaturaleza\b|\bnature\b|\bhistoria\b|\bdiscovery\b|\bnat ?geo\b|\bnational geographic\b|\bhistory\b|\banimal planet\b/],
  ["v.faith", /\breligi\w*|\bcristian\w*|\bcatolic\w*|\bevangel\w*|\bfaith\b|\biglesia\w*/],
  ["v.anime", /\banime\b/],
  ["v.asia", /\bdoramas?\b|\bk ?dramas?\b|\bk ?pop\b|\basia\w*|\bcorea\w*|\bkorea\w*|\bjapon\w*|\bjapan\w*|\bchin[ao]s?\b/],
  ["v.247", /\b24 ?\/ ?7\b|\b24 7\b|\b24h\b/],
  ["v.novelas", /\btelenovelas?\b|\bnovelas?\b/],
  ["v.ent", /\bentretenimiento\b|\bentertainment\b|\bvariedad\w*|\brealit\w*|\bfashion\b|\bmoda\b|\blifestyle\b|\bestilo de vida\b|\bcocina\b|\bfood\b|\bviajes?\b|\btravel\b|\bcomedia\b|\bhumor\b/],
  ["v.movies", /\bcine\w*|\bpeliculas?\b|\bmovies?\b|\bfilms?\b|\bseries\b|\bcinema\b|\bestrenos?\b|\bhbo\b|\bcinemax\b|\bstar channel\b|\bwarner\b|\buniversal\b|\bparamount\b|\bsony\b|\brakuten\b|\brun ?time\b|\bamc\b|\baxn\b|\btcm\b|\bmgm\b|\bgolden\b|\bcinecanal\b|\bterror\b|\bhorror\b|\baccion\b|\baction\b|\bsuspenso\b|\bthrillers?\b|\bwestern\b|\bsitcoms?\b/]
];
function titleText(t2) {
  if (t2 && typeof t2 === "object") return [t2.es, t2.en].filter(Boolean).join(" ");
  return String(t2 == null ? "" : t2);
}
var CACHE_MAX = 4e3;
var cache = /* @__PURE__ */ new Map();
function targetOf(srcId, cat) {
  return analyse(srcId, cat).v;
}
var SEC_PER_TARGET = 6;
var singleCountrySports = (v) => {
  const e = BY_ID.get(v);
  return !!e && e.kind === "sports" && !!e.cc;
};
function secondaryKept(primaryId, cats, served) {
  const per = /* @__PURE__ */ new Map();
  const out = [];
  for (const cat of Array.isArray(cats) ? cats : []) {
    if (!cat || cat.id == null) continue;
    const { v, cc } = analyse(primaryId, cat);
    if (!singleCountrySports(v) || !served.has(v)) continue;
    const n = per.get(v) || 0;
    if (n >= SEC_PER_TARGET) continue;
    per.set(v, n + 1);
    out.push({ cat, v, cc });
  }
  return out;
}
function analyse(srcId, cat) {
  const raw = titleText(cat && cat.title);
  const key = srcId + "" + String(cat && cat.id) + "" + raw + "" + (cat && cat.adult ? 1 : 0);
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= CACHE_MAX) cache.clear();
  const out = rules(srcId, cat || {}, raw);
  cache.set(key, out);
  return out;
}
function rules(srcId, cat, raw) {
  const n0 = fold(raw).replace(/\s+/g, " ").trim();
  const cc = countryOf(srcId, raw, n0);
  const at2 = (v) => ({ v, cc });
  if (cat.adult === true || isAdultTitle(raw)) return at2("v.adult");
  const o = OVERRIDES[srcId] && OVERRIDES[srcId][String(cat.id)];
  if (o) return at2(o);
  if (srcId === "xuper" && cat.title && typeof cat.title === "object" && cat.title.en === "All channels") return at2("v.all.xuper");
  if (EVENT_SOURCES.has(srcId)) return at2("v.events");
  const n = n0.replace(/[^a-z0-9+&/ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (EVENTS.test(n) && !REPLAY.test(n)) return at2("v.events");
  const football = FOOTBALL.test(n) || SPORT_BRANDS.test(n);
  const other = OTHER_SPORT.test(n);
  if (SPORT_SOURCES.has(srcId) || football || other || SPORT_GENERIC.test(n)) {
    if (cc && SPORT_CC.has(cc)) return at2("v.sp." + cc);
    if (cc === "eu") return at2("v.sp.eu");
    if (!cc && srcId === "supertv") return at2("v.sp.world");
    if (!cc || LATAM_CC.has(cc)) return at2(other && !football && !SPORT_GENERIC.test(n) ? "v.othersp" : "v.sports");
    return at2("v.sp.world");
  }
  for (const [vid, re] of THEMES) if (re.test(n)) return at2(vid);
  if (cc === "world" || cc === "eu") return at2("v.intl");
  if (cc && COUNTRY_IDS.has(cc)) return at2("v." + cc);
  return at2(null);
}
var localOf = (v) => lang() === "en" ? v.en : v.es;
function rawTitle(t2) {
  if (t2 && typeof t2 === "object") return String((lang() === "en" ? t2.en : t2.es) || t2.es || t2.en || "");
  return String(t2 == null ? "" : t2);
}
function hexEnc(s) {
  const a = encodeURIComponent(String(s == null ? "" : s));
  let h = "";
  for (let i = 0; i < a.length; i++) h += a.charCodeAt(i).toString(16).padStart(2, "0");
  return h;
}
function rawIdOrder(a, b) {
  const na = /^\d{1,15}$/.test(a), nb = /^\d{1,15}$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
var memberOf = (src, cat, cc) => {
  const m = { src, rawCat: String(cat.id) };
  if (cc) m.cc = cc;
  return m;
};
function mapCategories(raw, opts) {
  const o = opts || {};
  const srcName = typeof o.srcName === "function" ? o.srcName : (s) => s;
  const knownEmpty3 = typeof o.knownEmpty === "function" ? o.knownEmpty : () => false;
  const codeBacked = typeof o.codeBacked === "function" ? o.codeBacked : () => false;
  const secondaryOf = typeof o.secondaryOf === "function" ? o.secondaryOf : () => null;
  const virt = /* @__PURE__ */ new Map();
  const cands = [];
  const srcOrder = [];
  const secondary = /* @__PURE__ */ new Map();
  const seen = /* @__PURE__ */ new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || !r.cat || r.cat.id == null) continue;
    const rk = r.src + "" + String(r.cat.id);
    if (seen.has(rk)) continue;
    seen.add(rk);
    if (secondaryOf(r.src)) {
      if (!secondary.has(r.src)) secondary.set(r.src, []);
      secondary.get(r.src).push(r.cat);
      continue;
    }
    if (!srcOrder.includes(r.src)) srcOrder.push(r.src);
    const { v, cc } = analyse(r.src, r.cat);
    if (v) {
      if (!virt.has(v)) virt.set(v, []);
      virt.get(v).push(memberOf(r.src, r.cat, cc));
    } else {
      cands.push({ src: r.src, cat: r.cat, cc, i: cands.length });
    }
  }
  const sec = { kept: 0, dropped: 0 };
  for (const [src, cats] of secondary) {
    const primary = secondaryOf(src);
    const served = new Set([...virt].filter(([, ms]) => ms.some((m) => m.src === primary)).map(([v]) => v));
    const kept = secondaryKept(primary, cats, served);
    for (const k of kept) virt.get(k.v).push(memberOf(src, k.cat, k.cc));
    sec.kept += kept.length;
    sec.dropped += cats.length - kept.length;
  }
  const emptyAll = (members) => {
    const own = members.filter((m) => !secondaryOf(m.src));
    return (own.length ? own : members).every((m) => knownEmpty3(m.src, m.rawCat)) && !members.some((m) => codeBacked(m.src, m.rawCat));
  };
  const ranked = cands.slice().sort((a, b) => {
    const ea = knownEmpty3(a.src, String(a.cat.id)) ? 1 : 0, eb = knownEmpty3(b.src, String(b.cat.id)) ? 1 : 0;
    return ea - eb || srcOrder.indexOf(a.src) - srcOrder.indexOf(b.src) || rawIdOrder(String(a.cat.id), String(b.cat.id));
  });
  const passing = /* @__PURE__ */ new Set();
  const perSrc = /* @__PURE__ */ new Map();
  for (const c of ranked) {
    const id = c.src + "." + hexEnc(String(c.cat.id));
    const cap = PASS_CAP[c.src] != null ? PASS_CAP[c.src] : PASS_CAP_DEFAULT;
    const n = perSrc.get(c.src) || 0;
    if (!ID.test(id) || n >= cap) continue;
    perSrc.set(c.src, n + 1);
    passing.add(c);
  }
  const bucketSrcs = () => new Set(cands.filter((c) => !passing.has(c)).map((c) => c.src));
  const visibleVirt = () => [...virt.entries()].filter(([, ms]) => !emptyAll(ms)).length;
  const visiblePass = () => [...passing].filter((c) => !emptyAll([{ src: c.src, rawCat: String(c.cat.id) }])).length;
  while (visibleVirt() + visiblePass() + bucketSrcs().size > MAX_EXPOSED && passing.size) {
    let last = null;
    for (const c of ranked) if (passing.has(c)) last = c;
    passing.delete(last);
  }
  const all = /* @__PURE__ */ new Map();
  const byRaw = /* @__PURE__ */ new Map();
  const entries = [];
  const add = (e) => {
    all.set(e.id, e);
    for (const m of e.members) byRaw.set(m.src + "" + m.rawCat, e.id);
    entries.push(e);
  };
  const virtualEntry = (v, members) => {
    const e = { id: v.id, title: localOf(v), kind: v.kind, merge: v.merge, cc: v.kind === "country" || v.kind === "sports" ? v.cc || null : null, src: "v", members, genre: v.genre };
    if (v.country) e.country = v.country;
    if (v.adult) e.adult = true;
    if (emptyAll(members)) e.hidden = true;
    return e;
  };
  for (const v of VIRTUAL) if (virt.has(v.id)) add(virtualEntry(v, virt.get(v.id)));
  const titles = new Set(entries.filter((e) => !e.hidden).map((e) => fold(e.title)));
  for (const c of cands) {
    if (!passing.has(c)) continue;
    const id = c.src + "." + hexEnc(String(c.cat.id));
    let title = rawTitle(c.cat.title) || String(c.cat.id);
    if (titles.has(fold(title))) title = title + " \xB7 " + srcName(c.src);
    const e = { id, title, kind: "pass", merge: true, cc: null, src: c.src, members: [memberOf(c.src, c.cat, c.cc)] };
    if (typeof c.cat.genre === "string" && c.cat.genre) e.genre = c.cat.genre;
    if (emptyAll(e.members)) e.hidden = true;
    titles.add(fold(title));
    add(e);
  }
  for (const s of srcOrder) {
    const members = cands.filter((c) => c.src === s && !passing.has(c)).map((c) => memberOf(c.src, c.cat, c.cc));
    if (!members.length) continue;
    const name = srcName(s);
    const e = { id: "v.more." + s, title: lang() === "en" ? "More channels \xB7 " + name : "M\xE1s canales \xB7 " + name, kind: "bucket", merge: false, cc: null, src: s, members, genre: "otros" };
    if (emptyAll(members)) e.hidden = true;
    add(e);
  }
  if (virt.has("v.adult")) add(virtualEntry(ADULT_ENTRY, virt.get("v.adult")));
  const list = entries.filter((e) => !e.hidden);
  const stats = {
    exposed: list.length,
    virtual: list.filter((e) => BY_ID.has(e.id)).length,
    passed: list.filter((e) => e.kind === "pass").length,
    buckets: list.filter((e) => e.kind === "bucket").map((e) => e.src + " " + e.members.length),
    secondary: sec
  };
  return { list, all, byRaw, stats };
}

// src/sources/panels.js
var K2 = 128;
var SAME_RATIO = 0.2;
var SAME_MIN_SHARED = 8;
var fold2 = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
function fnv32(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
function accountKey(acc) {
  return acc ? fnv32(String(acc.url) + "|" + String(acc.username)).toString(36) : "";
}
function fingerprint2(raw) {
  const set = /* @__PURE__ */ new Set();
  for (const c of Array.isArray(raw) ? raw : []) {
    if (!c || c.category_id == null) continue;
    set.add(fnv32(String(c.category_id) + "" + fold2(c.category_name)));
  }
  const h = [...set].sort((a, b) => a - b);
  return { n: h.length, h, tau: Infinity };
}
function sketchOf(fp) {
  return { n: fp.n, k: fp.h.slice(0, K2).map((x) => x.toString(36)).join(".") };
}
function readSketch(s) {
  if (!s || typeof s.k !== "string" || !(Number(s.n) >= 0)) return null;
  const n = Number(s.n);
  const h = s.k ? s.k.split(".").map((x) => parseInt(x, 36)) : [];
  if (h.some((x) => !Number.isFinite(x) || x < 0) || h.length > K2 || h.length > n || n <= K2 && h.length !== n) return null;
  for (let i = 1; i < h.length; i++) if (!(h[i - 1] < h[i])) return null;
  return { n, h, tau: n > h.length ? h[h.length - 1] : Infinity };
}
function overlap(a, b) {
  const tau = Math.min(a.tau, b.tau);
  let i = 0, ma = 0, mb = 0, x = 0, y = 0;
  const A = a.h, B3 = b.h;
  while (x < A.length && A[x] <= tau) {
    ma++;
    x++;
  }
  while (y < B3.length && B3[y] <= tau) {
    mb++;
    y++;
  }
  for (let p = 0, q = 0; p < ma && q < mb; ) {
    if (A[p] === B3[q]) {
      i++;
      p++;
      q++;
    } else if (A[p] < B3[q]) p++;
    else q++;
  }
  return { m: Math.min(ma, mb), i };
}
function samePanel(a, b, unknownIsSame = true) {
  const { m, i } = overlap(a, b);
  if (m === 0) return unknownIsSame;
  return i >= SAME_MIN_SHARED || i / m >= SAME_RATIO;
}

// src/sources/supertv.js
var BOOTSTRAP_URL = "http://vegetatvv2.duckdns.org/bootstrap.php";
var VERSION_CODE = "25";
var UA = "Mozilla/5.0 (compatible; VegetaTVCache/2.0)";
var MAX_SERVERS = 40;
var PROBE_MS = 3e3;
var STV_KEY = "o2:stv";
var H3 = 60 * 60 * 1e3;
var D = 24 * H3;
var BOOT_FRESH_MS = D;
var BOOT_MAX_STALE_MS = 7 * D;
var MAX_CATS = 30;
var HOST_ALLOWLIST = /* @__PURE__ */ new Set([
  "966gaddn.com",
  "9paday.wtf",
  "alakazoo.xyz",
  "alexatv.world",
  "apex-ayoumas.com",
  "ashmedia.site",
  "avefenixtv.com",
  "brumotto00.zapto.org",
  "capitanhero.com",
  "doubleclicktv.live",
  "dreamteev.xyz",
  "dsaiiiilllliillsad.cdnip.online",
  "eu.kartal38.com",
  "fast-smart33.xyz",
  "frido1.live",
  "fv99.nesewvp.top",
  "goodbom.net",
  "hydragold.xyz",
  "interstellar.salex74.xyz",
  "krplay.eu",
  "line.krishkaz.com",
  "line.tmpes.com",
  "line.zee-ott.xyz",
  "line.zen8kk.xyz",
  "line.znn8.xyz",
  "louismag.com",
  "ltv.ddns.net",
  "lunicaoriginaleapp.giize.com",
  "myultratv.com",
  "neezfaopro.top",
  "nexotvplus.com",
  "pp.tresinl.xyz",
  "reborned.cc",
  "sa.xurvani.cfd",
  "toni-tv.com",
  "topcliente.xyz",
  "vca.easy747.com",
  "vewora.com",
  "vip2.sharkhost.xyz",
  "wickediptv.live",
  "xvisnet.xyz"
]);
function log6(m) {
  try {
    kino.log("supertv: " + m);
  } catch (_) {
  }
}
function vegetaHeaders(code) {
  return {
    "X-Vegeta-Version-Code": String(code),
    "X-Vegeta-Servers-Direct": "1",
    "Cache-Control": "no-cache, no-store",
    "Pragma": "no-cache",
    "User-Agent": UA
  };
}
function parseServerLine(line) {
  const url = line.split(/\s/)[0].trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    if (!path.endsWith("player_api.php") && !path.endsWith("get.php")) return null;
    const username = u.searchParams.get("username") || u.searchParams.get("user") || "";
    const password = u.searchParams.get("password") || u.searchParams.get("pass") || "";
    if (!username) return null;
    const base = (u.protocol + "//" + u.host).replace(/\/+$/, "");
    const name = line.slice(url.length).trim().replace(/^\[|\]$/g, "").trim().slice(0, 40);
    return { url: base, username, password, ...name ? { name } : {} };
  } catch (_) {
    return null;
  }
}
function parseServers(text2) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const line of String(text2).split(/\r?\n/)) {
    const t2 = line.trim();
    if (!t2 || t2.startsWith("#")) continue;
    const s = parseServerLine(t2);
    if (!s) continue;
    if (!HOST_ALLOWLIST.has(hostnameOf(s.url))) continue;
    const key = s.url + "|" + s.username;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.sort((a, b) => (b.url.startsWith("https://") ? 1 : 0) - (a.url.startsWith("https://") ? 1 : 0));
}
var wrote = { seq: -1, names: /* @__PURE__ */ new Set() };
function readStv() {
  const v = getJson(STV_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function writeStv(name, value) {
  if (wrote.seq !== callSeq()) wrote = { seq: callSeq(), names: /* @__PURE__ */ new Set() };
  const all = readStv();
  const theirs = all[name];
  if (theirs && !wrote.names.has(name) && saneAt(theirs.at) > callStartedAt()) {
    log6(name + " not saved (a newer one exists)");
    return;
  }
  if (theirs && JSON.stringify(theirs) === JSON.stringify(value)) return;
  all[name] = value;
  setJson(STV_KEY, all, { ttlMs: BOOT_MAX_STALE_MS });
  wrote.names.add(name);
}
var account = {
  load() {
    const a = readStv().acct;
    if (!a || typeof a.server !== "string" || !a.user || !HOST_ALLOWLIST.has(hostnameOf(a.server))) return null;
    return { url: a.server, username: String(a.user), password: String(a.pass || ""), at: saneAt(a.at) };
  },
  save(acc) {
    writeStv("acct", { server: acc.url, user: acc.username, pass: acc.password, at: Date.now() });
  }
};
async function fetchBoot() {
  const stored = readStv().boot;
  let code = String(stored && /^\d{1,4}$/.test(String(stored.ver)) && stored.ver || VERSION_CODE);
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await liveFetch(BOOTSTRAP_URL + "?v=" + Date.now(), { method: "GET", headers: { ...vegetaHeaders(code), "Accept": "application/json" }, cookies: false, timeoutMs: 8e3 });
    let data = null;
    try {
      data = r.json();
    } catch (_) {
      data = null;
    }
    const want = data ? Math.max(Number(data.minimum_version_code) || 0, Number(data.latest_version_code) || 0) : 0;
    if (!r.ok || !data || data.ok === false) {
      if (attempt === 0 && want > Number(code)) {
        code = String(want);
        continue;
      }
      throw new Error("bootstrap " + (r && r.status));
    }
    let list = [];
    if (typeof data.servers_text === "string" && data.servers_text.trim()) list = parseServers(data.servers_text);
    if (!list.length && typeof data.servers_url === "string" && data.servers_url.trim()) {
      const r2 = await liveFetch(data.servers_url, { method: "GET", headers: { ...vegetaHeaders(code), "Accept": "text/plain" }, cookies: false, timeoutMs: 8e3 });
      if (r2 && r2.ok) list = parseServers(r2.text());
    }
    if (!list.length) {
      if (attempt === 0 && want > Number(code)) {
        code = String(want);
        continue;
      }
      throw new Error("bootstrap: sin servidores");
    }
    const servers = list.slice(0, MAX_SERVERS);
    writeStv("boot", { servers, ver: code, at: Date.now() });
    return servers;
  }
  throw new Error("bootstrap: sin servidores");
}
async function bootstrap() {
  const boot = readStv().boot;
  const servers = boot && Array.isArray(boot.servers) ? boot.servers.filter((s) => s && s.url && s.username && HOST_ALLOWLIST.has(hostnameOf(s.url))) : [];
  const age = boot ? Date.now() - saneAt(boot.at) : Infinity;
  if (servers.length && age < BOOT_FRESH_MS) return servers;
  try {
    return await once("stv:boot", fetchBoot);
  } catch (e) {
    if (servers.length && age < BOOT_MAX_STALE_MS) {
      log6("bootstrap failed, using the stored servers: " + (e && (e.code || e.message) || e));
      return servers;
    }
    throw e;
  }
}
var REGION_TAG_RE = /^[\s[(]*(?:es|esp|lat|latam|latin|latino|latinos|lame|mx|mex|co|col|pe|cl|ec|ve|uy|py|bo|cr|pa|do|gt|hn|sv|ni|pr|cu|arg)\s*[▎|:\])-]/;
var REGION_NAME_RE = /\b(?:espana|spain|latin[oa]s?|latam|latinoamerica|hispan\w*|mexico|colombia|argentina|peru|chile|ecuador|venezuela|uruguay|paraguay|bolivia|costa rica|panama|dominican[ao]?|guatemala|honduras|el salvador|nicaragua|puerto rico|cuba|centroamerica|deportes?)\b/;
var FOOTBALL_RE = /\b(?:futbol|football|soccer|laliga|la liga|liga mx|ligamx|liga ?1|liga pro|premier league|champions|uefa|libertadores|sudamericana|conmebol|copa|bundesliga|serie a|ligue ?1|eredivisie|mls|tudn\w*|campeones|hypermotion|rfef|eliminatorias|mundial)\b/;
var SPORTY_RE = /\b(?:events?|eventos?|ppv|baloncesto|acb|ufc|boxeo|box)\b/;
var EVENT_RE = /event|ppv|replay|\d{1,2} \w+ 20\d\d/i;
function rankSupertv(title) {
  const n = normCat(title);
  const football = FOOTBALL_RE.test(n);
  if (!(football || isSports(n) || SPORTY_RE.test(n))) return -1;
  if (REGION_TAG_RE.test(n) || REGION_NAME_RE.test(n)) return 0;
  return football ? 1 : -1;
}
function listTtl(rawCat, cat) {
  return cat && EVENT_RE.test(String(cat.title || "")) ? { fresh: H3, maxStale: 6 * H3 } : null;
}
var supertv = makeXtream({
  id: "supertv",
  name: "SuperTV Deportes",
  genre: "deportes",
  ua: UA,
  ext: "m3u8",
  maxProbe: 30,
  probeBatch: 6,
  probeTimeoutMs: PROBE_MS,
  accountFreshMs: 6 * H3,
  skipAdult: true,
  // gap 5: never an 18+ group
  rankCat: rankSupertv,
  maxCats: MAX_CATS,
  flight: "stv",
  account,
  listTtl,
  onPicked: notePrimary,
  getAccounts: bootstrap
});
var supertv_default = supertv;
var STVS_KEY = "o2:stvs";
var SLOTS = ["s2", "s3"];
var M = 60 * 1e3;
var SEARCH_MAX = 5;
var SEARCH_BACKOFF_MS = [H3, 3 * H3, 6 * H3];
var SEARCH_MIN_LEFT_MS = PROBE_MS;
var MARKS = { bad: D, slow: 6 * H3 };
var MARKS_MAX = 40;
var SOFT_GAP_MS = 10 * M;
var RENEW_MS = H3;
var MIN_MAIN = 2;
var OWN_LIMIT = /* @__PURE__ */ new Set(["deadline", "budget", "invalid_request"]);
var ownLimit = (e) => !!e && (OWN_LIMIT.has(e.code) || e.limited === true);
var why2 = (e) => String(e && (e.message || e.code) || e).slice(0, 60);
var accKey2 = (a) => a ? a.url + "|" + a.username : "";
var deferred = (m) => new Error("secondary panels: " + m);
var wroteS = { seq: -1, names: /* @__PURE__ */ new Set() };
var memo = { seq: -1 };
function callMemo() {
  if (memo.seq !== callSeq()) memo = { seq: callSeq(), prim: null, active: null, asking: /* @__PURE__ */ new Set() };
  return memo;
}
function readStvs() {
  const v = getJson(STVS_KEY);
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}
function saveStvs(changes, marks) {
  if (wroteS.seq !== callSeq()) wroteS = { seq: callSeq(), names: /* @__PURE__ */ new Set() };
  const all = readStvs();
  const now = Date.now();
  const saved = /* @__PURE__ */ new Set();
  let dirty = false;
  for (const name of Object.keys(changes || {})) {
    const theirs = all[name];
    if (theirs && !wroteS.names.has(name) && saneAt(theirs.at) > callStartedAt()) {
      log6(name + " not saved (a newer one exists)");
      continue;
    }
    saved.add(name);
    if (theirs && JSON.stringify(theirs) === JSON.stringify(changes[name])) continue;
    all[name] = changes[name];
    wroteS.names.add(name);
    dirty = true;
  }
  for (const [field, ttl] of Object.entries(MARKS)) {
    const keys2 = marks && Array.isArray(marks[field]) ? [...new Set(marks[field])] : [];
    if (!keys2.length) continue;
    const kept = Object.entries(all[field] && typeof all[field] === "object" ? all[field] : {}).filter(([k, at2]) => now - saneAt(at2) < ttl && !keys2.includes(k));
    for (const k of keys2) kept.push([k, now]);
    all[field] = Object.fromEntries(kept.sort((a, b) => b[1] - a[1]).slice(0, MARKS_MAX));
    dirty = true;
  }
  if (dirty) {
    setJson(STVS_KEY, all, { ttlMs: BOOT_MAX_STALE_MS });
    callMemo().active = null;
  }
  return saved;
}
var marked = (all, acc, now) => Object.entries(MARKS).some(([field, ttl]) => {
  const at2 = all[field] && typeof all[field] === "object" ? saneAt(all[field][accountKey(acc)]) : 0;
  return !!at2 && now - at2 < ttl;
});
function slotOf(all, name) {
  const s = all[name];
  if (!s || s.none || typeof s.server !== "string" || !s.user || !HOST_ALLOWLIST.has(hostnameOf(s.server))) return null;
  return { url: s.server, username: String(s.user), password: String(s.pass || ""), at: saneAt(s.at), sk: s.sk || null, soft: s.soft || null };
}
function activeSlots() {
  const m = callMemo();
  if (m.active) return m.active;
  const all = readStvs();
  const prim = account.load();
  const pfp = prim && all.prim && all.prim.a === accountKey(prim) ? readSketch(all.prim.sk) : null;
  const out = {};
  const held2 = [];
  for (const name of SLOTS) {
    const s = slotOf(all, name);
    const fp = s ? readSketch(s.sk) : null;
    let ok = !!s && accKey2(s) !== accKey2(prim) && !held2.some((h) => accKey2(h.s) === accKey2(s));
    if (ok && fp && pfp && samePanel(pfp, fp, false)) ok = false;
    if (ok && fp && held2.some((h) => h.fp && samePanel(h.fp, fp, false))) ok = false;
    out[name] = ok;
    if (ok) held2.push({ s, fp });
  }
  m.active = out;
  return out;
}
function notePrimary(acc, raw, shaped) {
  const fp = fingerprint2(raw);
  const tg = [...new Set(shaped.map((c) => targetOf("supertv", c)).filter(Boolean))];
  const served = new Set(tg);
  const main = (secondaryKept("supertv", shaped, served)[0] || {}).v || "";
  callMemo().prim = { acc, fp, served, main };
  const now = Date.now();
  const all = readStvs();
  const prim = { a: accountKey(acc), sk: sketchOf(fp), tg, main, at: now };
  const old = all.prim;
  const changes = {};
  if (!old || old.a !== prim.a || old.main !== main || JSON.stringify(old.tg) !== JSON.stringify(tg) || JSON.stringify(old.sk) !== JSON.stringify(prim.sk) || now - saneAt(old.at) >= D) changes.prim = prim;
  for (const name of SLOTS) {
    const s = slotOf(all, name);
    const sfp = s && readSketch(s.sk);
    if (s && (accKey2(s) === accKey2(acc) || sfp && samePanel(sfp, fp, false))) {
      log6(name + ": " + hostnameOf(s.url) + " released (the primary is on its panel now)");
      changes[name] = { none: 1, at: now, n: 0 };
    }
  }
  if (Object.keys(changes).length) saveStvs(changes);
}
async function primaryRef(allow) {
  if (inFlight("stv:acct")) {
    try {
      await once("stv:acct", () => Promise.reject(deferred("no pick")));
    } catch (_) {
    }
  }
  const m = callMemo();
  if (m.prim) return m.prim;
  const acc = account.load();
  if (!acc) throw deferred("no primary account yet");
  const all = readStvs();
  const fp = all.prim && all.prim.a === accountKey(acc) ? readSketch(all.prim.sk) : null;
  if (fp && Array.isArray(all.prim.tg)) return { acc, fp, served: new Set(all.prim.tg), main: String(all.prim.main || "") };
  if (allow <= 0) throw deferred("the primary's panel is not known yet");
  let raw;
  try {
    raw = await probeShared(acc, UA, PROBE_MS);
  } catch (e) {
    throw deferred("the primary's panel is unknown (" + why2(e) + ")");
  }
  const shaped = supertv.shapeCats(raw);
  if (!shaped.length) throw deferred("the primary's panel is unknown (no useful category)");
  notePrimary(acc, raw, shaped);
  return callMemo().prim;
}
async function slotCandidates(net) {
  const boot = readStv().boot;
  const servers = boot && Array.isArray(boot.servers) ? boot.servers.filter((s) => s && s.url && s.username && HOST_ALLOWLIST.has(hostnameOf(s.url))) : [];
  if (servers.length && (net <= 0 || Date.now() - saneAt(boot.at) < BOOT_MAX_STALE_MS)) return servers;
  if (net <= 0) throw deferred("no stored server list");
  try {
    return await bootstrap();
  } catch (e) {
    if (!servers.length) throw e;
    log6("bootstrap failed (" + why2(e) + "); the slots search the stored list");
    return servers;
  }
}
var leanSearch = (ctx) => typeof ctx.searchLean === "function" && !!ctx.searchLean();
var inSearchBackoff = (s, now) => {
  const n = s && s.none ? Math.max(0, Number(s.n) || 0) : 0;
  return n > 0 && now - saneAt(s.at) < SEARCH_BACKOFF_MS[Math.min(n, SEARCH_BACKOFF_MS.length) - 1];
};
var noneAfter = (s, now) => ({ none: 1, at: now, n: (s && s.none ? Math.max(0, Number(s.n) || 0) : 0) + 1 });
var slotShape = (raw) => supertv2.shapeCats(raw);
function evaluate(r, prim) {
  if (accKey2(r.acc) === accKey2(prim.acc)) return { why: "the primary's account", primary: true };
  const fp = fingerprint2(r.raw);
  if (samePanel(prim.fp, fp)) return { why: "the primary's panel", primary: true };
  const cats = slotShape(r.raw);
  const kept = secondaryKept("supertv", cats, prim.served);
  const inMain = kept.filter((k) => k.v === prim.main).length;
  if (!prim.main || inMain < MIN_MAIN) return { why: "too little for the primary's categories" };
  return { score: inMain * 100 + kept.length, fp, cats };
}
async function searchSlots(ctx) {
  const allow = Math.max(0, Math.min(SEARCH_MAX, Number(typeof ctx.searchProbes === "function" ? ctx.searchProbes() : 0) || 0));
  const out = { chosen: {}, none: {}, probed: 0 };
  const free = SLOTS.filter((n) => !activeSlots()[n]);
  if (!free.length) return out;
  const before = readStvs();
  const net = !leanSearch(ctx) && free.some((n) => !inSearchBackoff(before[n], Date.now())) ? allow : 0;
  const prim = await primaryRef(net);
  let servers;
  try {
    servers = await slotCandidates(net);
  } catch (e) {
    if (net <= 0) throw e;
    const now2 = Date.now();
    for (const n of free) if (!inSearchBackoff(before[n], now2)) out.none[n] = noneAfter(before[n], now2);
    log6("slots: no server list to search (" + why2(e) + ")");
    return out;
  }
  const now = Date.now();
  const all = readStvs();
  const act = activeSlots();
  const asking = callMemo().asking;
  const want = SLOTS.filter((n) => !act[n]).sort((a, b) => (asking.has(b) ? 1 : 0) - (asking.has(a) ? 1 : 0));
  if (!want.length) return out;
  const held2 = SLOTS.filter((n) => act[n]).map((n) => slotOf(all, n)).filter(Boolean).map((s) => ({ key: accKey2(s), fp: readSketch(s.sk) }));
  const skip2 = (acc) => accKey2(acc) === accKey2(prim.acc) || held2.some((h) => h.key === accKey2(acc));
  const evals = [];
  const marks = { bad: [], slow: [] };
  const add = (r) => {
    const ev = evaluate(r, prim);
    if (ev.score) evals.push({ ...r, ...ev });
    else marks.bad.push(accountKey(r.acc));
  };
  const noAnswer = (acc, e) => {
    if (hardRefusal(e)) marks.bad.push(accountKey(acc));
    else if (!ownLimit(e)) marks.slow.push(accountKey(acc));
  };
  for (let i = 0; i < servers.length; i++) {
    const acc = servers[i];
    if (skip2(acc) || !inFlight(probeKey(acc))) continue;
    try {
      add({ acc, i, raw: await probeShared(acc, UA, PROBE_MS) });
    } catch (e) {
      noAnswer(acc, e);
    }
  }
  const chosen2 = out.chosen;
  const choose = () => {
    for (const name of want) {
      if (chosen2[name]) continue;
      const others = held2.concat(Object.values(chosen2).map((c) => ({ key: accKey2(c.acc), fp: c.fp })));
      const fits2 = evals.filter((e) => !others.some((o) => o.key === accKey2(e.acc) || o.fp && samePanel(o.fp, e.fp)));
      fits2.sort((a, b) => b.score - a.score || a.i - b.i);
      if (fits2[0]) chosen2[name] = { acc: fits2[0].acc, fp: fits2[0].fp, cats: fits2[0].cats };
    }
  };
  choose();
  let learned = false;
  const searching = want.filter((n) => !chosen2[n] && !inSearchBackoff(all[n], now));
  if (searching.length && allow > 0 && (typeof ctx.remaining !== "function" || ctx.remaining() >= SEARCH_MIN_LEFT_MS)) {
    const next = servers.map((acc, i) => ({ acc, i })).filter(({ acc }) => !skip2(acc) && !inFlight(probeKey(acc)) && !marked(all, acc, now)).slice(0, allow);
    out.probed = next.length;
    const got = await Promise.all(next.map(({ acc, i }) => probeShared(acc, UA, PROBE_MS).then((raw) => ({ acc, i, raw }), (e) => ({ acc, i, e }))));
    for (const g of got) {
      if (g.raw) add(g);
      else noAnswer(g.acc, g.e);
      if (g.raw || !ownLimit(g.e)) learned = true;
    }
    choose();
  }
  if (learned) {
    for (const n of searching) if (!chosen2[n]) out.none[n] = noneAfter(all[n], now);
  }
  saveStvs(null, marks);
  return out;
}
async function searchFor(name, ctx) {
  callMemo().asking.add(name);
  const r = await once("stv:slots", () => searchSlots(ctx));
  const c = r.chosen[name];
  if (c) {
    const rec = { server: c.acc.url, user: c.acc.username, pass: c.acc.password, at: Date.now(), sk: sketchOf(c.fp) };
    if (!saveStvs({ [name]: rec }).has(name)) throw deferred(name + ": another runtime stored a newer account");
    log6(name + ": " + hostnameOf(c.acc.url) + " (another panel; " + c.cats.length + " categories)");
    return c;
  }
  const none = r.none[name];
  if (none && saveStvs({ [name]: none }).has(name)) {
    log6(name + ": no other panel fits (" + r.probed + " probed); next search in " + Math.round(SEARCH_BACKOFF_MS[Math.min(none.n, SEARCH_BACKOFF_MS.length) - 1] / H3) + " h");
  }
  throw deferred(name + ": no account on another panel");
}
function release2(name, acc, reason, bad) {
  log6(name + ": " + hostnameOf(acc.url) + " released (" + reason + ")");
  saveStvs({ [name]: { none: 1, at: Date.now(), n: 0 } }, bad ? { bad: [accountKey(acc)] } : null);
}
function renewSlot(name, acc, fp) {
  const all = readStvs();
  const s = all[name];
  if (!s || s.none || s.server !== acc.url || s.user !== acc.username) return;
  const sk = fp ? sketchOf(fp) : s.sk;
  if (Date.now() - saneAt(s.at) < RENEW_MS && !s.soft && JSON.stringify(sk) === JSON.stringify(s.sk)) return;
  saveStvs({ [name]: { server: s.server, user: s.user, pass: s.pass, at: Date.now(), sk } });
}
function noteUnreachable(name, acc) {
  const all = readStvs();
  const s = all[name];
  if (!s || s.none || s.server !== acc.url || s.user !== acc.username) return;
  const first = s.soft ? saneAt(s.soft.at) : 0;
  if (first && Date.now() - first >= SOFT_GAP_MS) {
    release2(name, acc, "unreachable twice, " + Math.round((Date.now() - first) / M) + " min apart", false);
    return;
  }
  if (!first) saveStvs({ [name]: { ...s, soft: { at: Date.now() } } });
}
async function slotCategories(name, ctx, kit) {
  const allow = leanSearch(ctx) ? 0 : Math.max(0, Number(typeof ctx.searchProbes === "function" ? ctx.searchProbes() : 0) || 0);
  const cur = activeSlots()[name] ? slotOf(readStvs(), name) : null;
  if (cur) {
    let raw = null, reason = "", bad = true;
    try {
      raw = await probeShared(cur, UA, PROBE_MS);
    } catch (e) {
      if (!hardRefusal(e)) {
        if (!ownLimit(e)) noteUnreachable(name, cur);
        throw e;
      }
      reason = "refused: " + why2(e);
    }
    if (raw) {
      let prim = null;
      try {
        prim = await primaryRef(allow);
      } catch (_) {
        prim = null;
      }
      const ev = prim ? evaluate({ acc: cur, raw }, prim) : { score: 1, fp: fingerprint2(raw), cats: kit.shapeCats(raw) };
      if (ev.score && ev.cats.length) {
        renewSlot(name, cur, ev.fp);
        return ev.cats;
      }
      reason = ev.why || "no useful category";
      bad = !ev.primary;
    }
    release2(name, cur, reason, bad);
    if (typeof ctx.dropLists === "function") ctx.dropLists();
  }
  const got = await searchFor(name, ctx);
  if (typeof ctx.dropLists === "function") ctx.dropLists();
  return got.cats;
}
async function slotChannels(name, cat, ctx, kit) {
  const acc = activeSlots()[name] ? slotOf(readStvs(), name) : null;
  if (!acc) throw deferred(name + ": no account");
  try {
    const list = await kit.listStreams(acc, cat);
    renewSlot(name, acc, null);
    return list;
  } catch (e) {
    if (ownLimit(e)) throw e;
    try {
      await probeShared(acc, UA, PROBE_MS);
    } catch (pe) {
      if (hardRefusal(pe)) {
        release2(name, acc, "refused: " + why2(pe), true);
        if (typeof ctx.dropLists === "function") ctx.dropLists();
      } else if (!ownLimit(pe)) noteUnreachable(name, acc);
    }
    throw e;
  }
}
function slot(name, id, title) {
  return makeXtream({
    id,
    name: title,
    genre: "deportes",
    ua: UA,
    ext: "m3u8",
    probeTimeoutMs: PROBE_MS,
    skipAdult: true,
    rankCat: rankSupertv,
    keepCat: (t2) => !EVENT_RE.test(t2),
    // no event, PPV or replay category: their slots differ per panel
    maxCats: MAX_CATS,
    secondary: {
      of: "supertv",
      active: () => !!activeSlots()[name],
      categories: (ctx, kit) => slotCategories(name, ctx, kit),
      channels: (cat, ctx, kit) => slotChannels(name, cat, ctx, kit)
    }
  });
}
var supertv2 = slot("s2", "supertv2", "SuperTV Deportes 2");
var supertv3 = slot("s3", "supertv3", "SuperTV Deportes 3");

// src/sources/caracol.js
var en = () => lang() === "en";
var BASE = "https://middleware.ditu.caracoltv.com/AGL/1.6/A/ENG/ANDROID/ALL";
var LICENSE = BASE + "/CONTENT/LICENSE";
var COOKIE_TOKEN = "playback_token";
var REQUEST_HEADERS = {
  "restful": "yes",
  "Accept": "application/json, text/plain, */*",
  "User-Agent": "okhttp/4.12.0"
};
function api(path, params = {}) {
  const u = new URL(BASE + "/" + path);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v !== void 0 && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}
function httpError(status2, path) {
  const geo = status2 === 403;
  const err = new Error(geo ? en() ? "Caracol: only available in Colombia" : "Caracol: solo disponible en Colombia" : en() ? "Caracol answered " + status2 + " on " + path : "Caracol respondi\xF3 " + status2 + " en " + path);
  err.outsideColombia = geo;
  err.status = status2;
  return err;
}
async function get2(path, params = {}) {
  const r = await liveFetch(api(path, params), { headers: { ...REQUEST_HEADERS } });
  if (!r.ok) throw httpError(r.status, path);
  return r.json();
}
async function getWithToken(path) {
  const url = api(path);
  const r = await liveFetch(url, { headers: { ...REQUEST_HEADERS } });
  if (!r.ok) throw httpError(r.status, path);
  const token = kino.cookies.get(url, COOKIE_TOKEN) || "";
  return { json: r.json(), token };
}
function containers(json) {
  const arr = json && json.resultObj && Array.isArray(json.resultObj.containers) ? json.resultObj.containers : [];
  return arr.filter((c) => c && typeof c === "object");
}
function assetMaster(c) {
  const list = Array.isArray(c && c.assets) ? c.assets : [];
  const master = list.find((a) => a && a.assetType === "MASTER" && a.assetId);
  if (master) return master.assetId;
  const any = list.find((a) => a && a.assetId);
  return any ? any.assetId : null;
}
function channelLogo(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((a) => a && a.logoMedium) ? String(list.find((a) => a.logoMedium).logoMedium) : list.find((a) => a && a.logoBig) ? String(list.find((a) => a.logoBig).logoBig) : list.find((a) => a && a.logoSmall) ? String(list.find((a) => a.logoSmall).logoSmall) : "";
}
function channelOf(c) {
  const m = c.metadata || {};
  if (m.isActive !== true) return null;
  const id = m.channelId && m.channelId !== 0 ? m.channelId : null;
  const name = String(m.channelName || "").trim();
  const assetId = assetMaster(c);
  if (!id || !name || !assetId) return null;
  return { channelId: id, name, assetId, logo: channelLogo(c.assets), adult: m.isAdult === true };
}
var BLOCKS = [
  ["isGeoBlocked", "solo disponible en Colombia", "only available in Colombia"],
  ["isChannelNotSubscribed", "requiere suscripci\xF3n", "needs a subscription"],
  ["isPCBlocked", "control parental activo", "parental control is on"],
  ["isContentOOHBlocked", "contenido OOH bloqueado", "blocked out of home"],
  ["isGeofencedBlocked", "geofence bloqueado", "blocked by geofence"],
  ["isSportBlackoutBlocked", "deportes en blackout", "sports blackout"],
  ["isPlatformBlacklisted", "plataforma no permitida", "platform not allowed"]
];
function entitlementBlock(userData) {
  const list = userData && userData.resultObj && Array.isArray(userData.resultObj.containers) ? userData.resultObj.containers : [];
  const ent = list[0] && list[0].entitlement;
  if (!ent) return null;
  for (const [flag, es, enText] of BLOCKS) {
    if (ent[flag] === true) return en() ? enText : es;
  }
  return null;
}
async function checkEntitlement(path) {
  const data = await get2(path);
  const reason = entitlementBlock(data);
  if (reason) {
    const err = new Error("Caracol: " + reason);
    err.blocked = true;
    throw err;
  }
}
async function livePlayable(channelId, assetId, name) {
  await checkEntitlement("CONTENT/USERDATA/LIVE/" + channelId);
  const r = await getWithToken("CONTENT/VIDEOURL/LIVE/" + channelId + "/" + assetId);
  const src = r.json && r.json.resultObj ? String(r.json.resultObj.src || "").trim() : "";
  if (!src) throw new Error(en() ? "Caracol gave no video URL for " + name : "Caracol no devolvi\xF3 una URL de video para " + name);
  const drm = { type: "widevine", licenseUrl: LICENSE, licenseHeaders: {} };
  if (r.token) drm.licenseHeaders.Cookie = COOKIE_TOKEN + "=" + r.token;
  const streamHeaders = { ...REQUEST_HEADERS };
  if (r.token) streamHeaders.Cookie = COOKIE_TOKEN + "=" + r.token;
  return { url: src, mime: "application/dash+xml", drm, headers: streamHeaders };
}
async function fetchChannels() {
  const json = await get2("TRAY/LIVECHANNELS", { orderBy: "orderId", sortOrder: "asc" });
  const list = containers(json).map(channelOf).filter(Boolean);
  if (!list.length) throw new Error(en() ? "Caracol: empty channel list" : "Caracol: lista de canales vac\xEDa");
  return list;
}
function storedAsset(hit) {
  const a = hit && hit.x && hit.x.assetId;
  return a != null && a !== "" ? a : null;
}
var caracol = {
  id: "caracol",
  name: "Caracol",
  genre: "otros",
  codeCategories: true,
  // categories() never makes a request
  drm: true,
  // its streams are Widevine: a merged channel plays another source while DRM is not declared
  async categories() {
    return [{ id: "all", title: en() ? "Live channels" : "Canales en vivo" }];
  },
  // One list for the only category. `x.assetId` is private (never returned to Kino): resolve reads it back.
  async channels(_categoryId) {
    return (await fetchChannels()).map((ch) => {
      const out = { id: String(ch.channelId), title: ch.name, x: { assetId: ch.assetId } };
      if (ch.logo) out.logo = ch.logo;
      if (ch.adult) out.adult = true;
      return out;
    });
  },
  // Cold runtime with the list stored: USERDATA + VIDEOURL (2 requests). Nothing stored (never listed on this device,
  // or the list expired): the list is fetched once and stored for next time (3 requests). A stored assetId that no
  // longer plays is re-listed once (forced) and retried when the assetId changed.
  async resolve(channelId, ctx) {
    const want = String(channelId || "");
    const unknown = () => new Error(en() ? "Caracol: unknown channel " + want : "Caracol: canal desconocido " + want);
    const relist2 = async () => {
      const items = await ctx.relist("all", { force: true });
      return (items || []).find((c) => ctx.rawIdOf(c) === want) || null;
    };
    let hit = ctx.findChannel(want);
    let fresh = false;
    if (!storedAsset(hit)) {
      hit = await relist2();
      fresh = true;
    }
    const assetId = storedAsset(hit);
    if (!assetId) throw unknown();
    try {
      return await livePlayable(want, assetId, hit.title || want);
    } catch (e) {
      if (fresh || e && (e.outsideColombia || e.blocked || e.code === "deadline")) throw e;
      const again = await relist2().catch(() => null);
      const next = storedAsset(again);
      if (!next || String(next) === String(assetId)) throw e;
      return await livePlayable(want, next, again.title || want);
    }
  }
};
var caracol_default = caracol;

// src/sources/tvenvivo.js
var BASE2 = "https://www.tvenvivo.org";
var HLS2 = "application/vnd.apple.mpegurl";
var CATALOG = [
  // bein-sports-xtra SACADO: defunto (logo placeholder + 404 constante en los 3 skins) → caía de PRIMERO y parecía todo roto.
  ["liga-1", "liga1", "Liga 1", "deportes", "liga1"],
  ["liga-1-max", "liga1max", "Liga 1 Max", "deportes", "liga1max"],
  ["tudn", "tudn", "TUDN", "deportes", "tudn"],
  ["sky-sports-la-liga", "skysportslaliga", "Sky Sports La Liga", "deportes", "skysportslaliga"],
  ["tyc-sports", "tycsports", "TyC Sports", "deportes", "tycsports"],
  ["directv-sports", "directvsports", "Directv Sports", "deportes", "directvsports"],
  ["directv-sports-2", "directvsports2", "Directv Sports 2", "deportes", "directvsports2"],
  ["directv-sports-plus", "directvsportsplus", "Directv Sports Plus", "deportes", "directvsportsplus"],
  ["espn-premium-latino-america", "espnpremiumlat", "ESPN Premium Usa", "deportes", "espnpremium"],
  ["espn-premium-argentina", "espnpremiumar", "ESPN Premium Argentina", "deportes", "espnpremium"],
  ["espn-colombia", "espn", "ESPN Colombia", "deportes", "espn"],
  ["espn-argentina", "espnar", "ESPN Argentina", "deportes", "espn"],
  ["espn-2", "espn2", "ESPN 2", "deportes", "espn2"],
  ["espn-3", "espn3", "ESPN 3", "deportes", "espn3"],
  ["espn-4", "espn4", "ESPN 4", "deportes", "espn4"],
  ["espn-5", "espn5", "ESPN 5", "deportes", "espn5"],
  ["espn-6", "espn6", "ESPN 6", "deportes", "espn6"],
  ["espn-7", "espn7", "ESPN 7", "deportes", "espn7"],
  ["espn-mexico", "espnmexico", "ESPN Mexico", "deportes", "espnmexico"],
  ["espn-2-mexico", "espn2mexico", "ESPN 2 Mexico", "deportes", "espn2mexico"],
  ["espn-3-mexico", "espn3mexico", "ESPN 3 Mexico", "deportes", "espn3mexico"],
  ["espn-4-mexico", "espn4mexico", "ESPN 4 Mexico", "deportes", "espn4mexico"],
  ["fox-sports", "foxsports", "Fox Sports", "deportes", "foxsports"],
  ["fox-sports-2", "foxsports2", "Fox Sports 2", "deportes", "foxsports2"],
  ["fox-sports-3", "foxsports3", "Fox Sports 3", "deportes", "foxsports3"],
  ["fox-sports-mexico", "foxsportsmexico", "Fox Sports Mexico", "deportes", "foxsportsmx"],
  ["fox-sports-2-mexico", "foxsports2mexico", "Fox Sports 2 Mexico", "deportes", "foxsports2mx"],
  ["fox-sports-3-mexico", "foxsports3mexico", "Fox Sports 3 Mexico", "deportes", "foxsports3mexico"],
  // Al FINAL de Deportes: estaban caídos en el probe (geo/sólo en partido) → no deben tapar a los que andan arriba.
  ["fox-sports-premium", "foxsportspremium", "Fox Sports Premium", "deportes", "foxsportspremium"],
  ["movistar-la-liga", "movistarlaliga", "Movistar La Liga", "deportes", "movistarlaliga"],
  ["movistar-liga-campeones", "movistarligadecampeones", "Movistar Liga de Campeones", "deportes", "movistarligadecampeones"],
  ["espn-5-mexico", "espn5mexico", "ESPN 5 Mexico", "deportes", "espn5mexico"],
  ["telefe", "telefe", "Telefe", "ar", "telefe"],
  ["el-trece", "eltrece", "El Trece", "ar", "eltrece"],
  ["telemundo-51", "telemundo51", "Telemundo 51", "us", "telemundo51"],
  ["telemundo-puerto-rico", "telemundopuertorico", "Telemundo Puerto Rico", "us", "telemundopuertorico"],
  ["univision", "univision", "Univision", "us", "univision"],
  ["pasiones", "pasiones", "Pasiones", "novelas", "pasiones"],
  ["tlnovelas", "tlnovelas", "Tlnovelas", "novelas", "tlnovelas"],
  ["las-estrellas", "lasestrellas", "Las Estrellas", "mx", "lasestrellas"],
  ["antena-3", "antena3", "Antena 3", "intl", "antena3"],
  ["dw-espanol", "dwespanol", "DW Espa\xF1ol", "intl", "dwespanol"],
  ["caracol", "caracol", "Caracol", "co", "caracol"],
  ["rcn", "rcn", "RCN", "co", "rcn"],
  ["latina", "latina", "Latina", "pe", "latina"],
  ["america-tv", "americatv", "Am\xE9rica TV", "pe", "americatv"],
  ["atv", "atv", "ATV", "pe", "atv"],
  ["unicable", "unicable", "Unicable", "mx", "unicable"],
  ["imagen-tv", "imagentv", "Imagen TV", "mx", "imagentv"],
  ["azteca-7", "azteca7", "Azteca 7", "mx", "azteca7"],
  ["azteca-uno", "aztecauno", "Azteca Uno", "mx", "aztecauno"],
  ["canal-5", "canal5", "Canal 5", "mx", "canal5"],
  ["tnt-novelas", "tntnovelas", "TNT Novelas", "novelas", "tntnovelas"],
  ["disney-channel", "disneychannel", "Disney Channel", "infantil", "disneychannel"],
  ["cartoon-network", "cartoonnetwork", "Cartoon Network", "infantil", "cartoonnetwork"],
  ["tooncast", "tooncast", "Tooncast", "infantil", "tooncast"],
  ["discovery-channel", "discoverychannel", "Discovery Channel", "docs", "discoverychannel"],
  ["id-investigation", "idinvestigation", "ID Investigation", "docs", "idinvestigation"],
  ["discovery-hh", "discoveryhyh", "Discovery H&H", "docs", "discoveryhyh"],
  ["history", "history", "History", "docs", "history"],
  ["history-2", "history2", "History 2", "docs", "history2"],
  ["animal-planet", "animalplanet", "Animal Planet", "docs", "animalplanet"],
  ["nat-geo", "natgeo", "Nat Geo", "docs", "natgeo"],
  ["universal-channel", "universaltv", "Universal Channel", "cine", "universalchannel"],
  ["tnt", "tnt", "TNT", "cine", "tnt"],
  ["tnt-series", "tntseries", "TNT Series", "cine", "tntseries"],
  ["star-channel", "starchannel", "Star Channel", "cine", "starchannel"],
  ["cinemax", "cinemax", "Cinemax", "cine", "cinemax"],
  ["space", "space", "Space", "cine", "space"],
  ["warner-channel", "warnerchannel", "Warner Channel", "cine", "warnerbrostv"],
  ["cinecanal", "cinecanal", "Cinecanal", "cine", "cinecanal"],
  ["fx", "fx", "FX", "cine", "fx"],
  ["axn", "axn", "AXN", "cine", "axn"],
  ["amc", "amc", "AMC", "cine", "amc"],
  ["studio-universal", "studiouniversal", "Studio Universal", "cine", "studiouniversal"],
  ["multipremier", "multipremier", "Multipremier", "cine", "multipremier"],
  ["golden", "golden", "Golden", "cine", "golden"],
  ["golden-plus", "goldenplus", "Golden Plus", "cine", "goldenplus"],
  ["golden-edge", "goldenedge", "Golden Edge", "cine", "goldenedge"],
  ["golden-premier", "goldenpremier", "Golden Premier", "cine", "goldenpremier"],
  ["canal-sony", "canalsony", "Canal Sony", "cine", "canalsony"],
  ["fm-hot-movies", "fmhotmovies", "FM Hot Movies", "cine", "fmhotmovies"],
  ["fm-hot-kids", "fmhotkids", "FM Hot Kids", "infantil", "fmhotkids"],
  ["extrema-tv", "extrematv", "Extrema TV", "cine", "extrematv"],
  ["distrito-comedia", "distritocomedia", "Distrito Comedia", "cine", "distritocomedia"]
  // grupo "adultos" (venus, play-boy) omitido a propósito: el agregador no tiene gate 18+.
];
var GROUP_TITLES = {
  deportes: "Deportes",
  co: "Colombia",
  mx: "M\xE9xico",
  pe: "Per\xFA",
  ar: "Argentina",
  us: "Estados Unidos",
  intl: "Internacional",
  novelas: "Novelas",
  infantil: "Infantil",
  docs: "Documentales",
  cine: "Cine y series",
  mas: "M\xE1s canales"
};
var GROUP_TITLES_EN = {
  deportes: "Sports",
  co: "Colombia",
  mx: "Mexico",
  pe: "Peru",
  ar: "Argentina",
  us: "United States",
  intl: "International",
  novelas: "Telenovelas",
  infantil: "Kids",
  docs: "Documentaries",
  cine: "Movies and series",
  mas: "More channels"
};
var en2 = () => lang() === "en";
var groupTitle = (g) => (en2() ? GROUP_TITLES_EN[g] : GROUP_TITLES[g]) || GROUP_TITLES[g] || g;
var GROUP_ORDER = ["deportes", "co", "mx", "pe", "ar", "us", "intl", "novelas", "infantil", "docs", "cine", "mas"];
function catalogChannels() {
  return CATALOG.filter(([, , , group]) => group !== "adultos").map(([slug2, canal, name, group, logo]) => ({
    slug: slug2,
    canal,
    name,
    group: GROUP_TITLES[group] ? group : "mas",
    logo: `${BASE2}/imge/${logo}.webp`
  }));
}
var MANIFEST = /https?:\/\/[^"'\s<]+?\/playlist\/\d+\/index\.m3u8\?token=[0-9a-f]{40}-[0-9a-f]{32}-\d+-\d+/;
var PLAYER = /src="(https:\/\/[^"]+\/stream\.php[^"]+)"/;
var TOKEN_MARK = "index.m3u8?token=";
var SKINS = ["1", "2", "3"];
var PLAYER_HEADERS = { Referer: BASE2 + "/", "Sec-Fetch-Dest": "iframe" };
var TVP_KEY = "o2:tvp";
var TVP_TTL_MS = 30 * 24 * 3600 * 1e3;
function manifestIn(text2) {
  const s = String(text2 || "");
  for (let i = s.indexOf(TOKEN_MARK); i >= 0; i = s.indexOf(TOKEN_MARK, i + TOKEN_MARK.length)) {
    const m = MANIFEST.exec(s.slice(Math.max(0, i - 400), i + TOKEN_MARK.length + 160).replace(/\\\//g, "/"));
    if (m) return m[0];
  }
  return null;
}
var skinOf = (url) => (/[?&]target=([123])\b/.exec(String(url || "")) || [])[1] || "1";
async function playerOf(canal, skin) {
  const dir = skin === "1" ? "live" : "live" + skin;
  const core = await liveFetch(`${BASE2}/${dir}/core.php?canal=${encodeURIComponent(canal)}`, {
    headers: { Referer: BASE2 + "/" },
    timeoutMs: 8e3
  });
  const player = core.ok && PLAYER.exec(core.text());
  return player ? player[1].replace(/&amp;/g, "&") : null;
}
async function fromPlayer(playerUrl, verify2) {
  const page = await liveFetch(playerUrl, { headers: PLAYER_HEADERS, timeoutMs: 12e3 });
  const url = page.ok ? manifestIn(page.text()) : null;
  if (!url) return null;
  if (verify2) {
    let status2 = 200;
    try {
      status2 = (await liveFetch(url, { timeoutMs: 3500 })).status;
    } catch (_) {
    }
    if (status2 === 404) return { offline: true };
  }
  return { url, mime: HLS2 };
}
var tvenvivo = {
  id: "tvenvivo",
  name: "TV en Vivo",
  genre: "otros",
  codeCategories: true,
  // categories() never makes a request (src/live.js serves them with 0 requests)
  codeList: true,
  // every channels() list is code too: never stored, never refreshed
  async categories() {
    const have = new Set(catalogChannels().map((c) => c.group));
    return GROUP_ORDER.filter((g) => have.has(g)).map((g) => ({ id: g, title: groupTitle(g) }));
  },
  async channels(categoryId) {
    return catalogChannels().filter((c) => c.group === categoryId).map((c) => ({ id: c.slug, title: c.name, logo: c.logo }));
  },
  // The remembered player page first (1 request); else each skin's core page and its player page (2), the remembered
  // skin first. The next skin is tried only when a page named no stream or its request failed. Off air (only with
  // `ctx.verify`): stops at the first 404 instead of trying every skin (each would say the same).
  async resolve(channelId, ctx) {
    const row = CATALOG.find((r) => r[0] === channelId);
    if (!row) throw new Error(en2() ? "tvenvivo: unknown channel " + channelId : "tvenvivo: canal desconocido " + channelId);
    const canal = row[1];
    const verify2 = !!(ctx && ctx.verify);
    const offAir2 = () => Object.assign(new Error(en2() ? "tvenvivo: no signal right now for " + channelId : "tvenvivo: sin se\xF1al ahora para " + channelId), { code: "offline" });
    const couldNot = () => new Error(en2() ? "tvenvivo: could not open " + channelId : "tvenvivo: no se pudo resolver " + channelId);
    const pages2 = ctx && typeof ctx.memo === "function" ? ctx.memo(TVP_KEY) || {} : {};
    const save = () => {
      if (ctx && typeof ctx.saveMemo === "function") ctx.saveMemo(TVP_KEY, TVP_TTL_MS);
    };
    const known = typeof pages2[channelId] === "string" ? pages2[channelId] : "";
    let stale = "";
    if (known) {
      let out = null, failed = null;
      try {
        out = await fromPlayer(known, verify2);
      } catch (e) {
        failed = e || new Error("fetch failed");
      }
      if (out && out.offline) throw offAir2();
      if (out) return out;
      if (failed && failed.code === "deadline") throw couldNot();
      if (!failed) {
        stale = known;
        delete pages2[channelId];
        save();
      }
    }
    const first = skinOf(known);
    for (const skin of [first, ...SKINS.filter((s) => s !== first)]) {
      let out = null, player = null;
      try {
        player = await playerOf(canal, skin);
        if (player && player !== stale) out = await fromPlayer(player, verify2);
      } catch (e) {
        if (e && e.code === "deadline") break;
        out = null;
      }
      if (out && out.offline) throw offAir2();
      if (out) {
        if (pages2[channelId] !== player) {
          pages2[channelId] = player;
          save();
        }
        return out;
      }
    }
    throw couldNot();
  }
};
var tvenvivo_default = tvenvivo;

// src/sources/cablevisionhd.js
var BASE3 = "https://cablevisionhd.com";
var EMBED_HEADERS = { Referer: "https://www.cablevisionhd.com/", "Sec-Fetch-Dest": "iframe" };
var UA2 = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0";
var HLS_MIME = "application/vnd.apple.mpegurl";
var SKINS2 = ["stream", "stream2", "stream3"];
var CVK_KEY = "o2:cvk";
var CVK_TTL_MS = 30 * 24 * 3600 * 1e3;
var ALL = "all";
var en3 = () => lang() === "en";
var fold3 = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var CATEGORIES = [
  { id: "sports", title: "Deportes", titleEn: "Sports", names: ["TUDN", "WWE", "Afizzionados", "Gol Peru", "Gol TV", "TNT SPORTS", "Fox Sports", "TYC Sports", "Movistar Deportes", "Movistar La Liga", "Movistar Liga De Campeones", "Dazn", "Bein", "Directv Sports", "Espn", "Fox Deportes", "Win Sports", "Claro Sports", "Sky Sports"] },
  { id: "entertainment", title: "Entretenimiento", titleEn: "Entertainment", names: ["Telefe", "El Trece", "Television Publica", "Telemundo", "Univision", "Pasiones", "Caracol", "RCN", "Latina", "America TV", "Willax", "ATV", "Las Estrellas", "Tl Novelas", "Galavision", "Azteca", "Canal 5", "Distrito Comedia", "Canal 13"] },
  { id: "news", title: "Noticias", titleEn: "News", names: ["Telemundo 51", "CNN", "Noticias", "NTN24", "DW", "Euronews", "France 24"] },
  { id: "movies", title: "Pel\xEDculas", titleEn: "Movies", names: ["Movistar Accion", "Movistar Drama", "Universal Channel", "TNT", "TNT Series", "Star Channel", "Star Action", "Star Series", "Cinemax", "Space", "Syfy", "Warner Channel", "Cinecanal", "FX", "AXN", "AMC", "Studio Universal", "Multipremier", "Golden", "Sony", "DHE", "NEXT HD", "HBO"] },
  { id: "kids", title: "Infantil", titleEn: "Kids", names: ["Cartoon Network", "Tooncast", "Cartoonito", "Disney", "Nick"] },
  { id: "education", title: "Educaci\xF3n", titleEn: "Education", names: ["Discovery", "History", "Animal Planet", "Nat Geo", "National Geographic"] }
];
var OTHER = { id: "other", title: "Otros", titleEn: "Other" };
function categoriesOf(title) {
  const f = fold3(title);
  const ids = CATEGORIES.filter((c) => c.names.some((n) => f.includes(fold3(n)))).map((c) => c.id);
  return ids.length ? ids : [OTHER.id];
}
var decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
function parseChannels(html) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const m of String(html || "").matchAll(/<a\s+href="([^"]+)"[^>]*class="[^"]*\bchannel-card\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug2 = /\/?([a-z0-9-]+-ver)\.php(?:\?.*)?$/i.exec(m[1]);
    if (!slug2 || seen.has(slug2[1])) continue;
    const title = decode((/<p[^>]*>([\s\S]*?)<\/p>/.exec(m[2]) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
    if (!title) continue;
    const img = (/<img[^>]*\bsrc="([^"]+)"/.exec(m[2]) || [])[1];
    seen.add(slug2[1]);
    out.push({ id: slug2[1], title, logo: img ? new URL(decode(img), BASE3 + "/").href : void 0 });
  }
  return out;
}
function groupChannels(list) {
  const out = new Map([...CATEGORIES.map((c) => [c.id, []]), [OTHER.id, []]]);
  for (const ch of list) for (const id of categoriesOf(ch.title)) out.get(id).push(ch);
  return out;
}
function rootHost(url) {
  return String(url || "").replace(/^https?:\/\/www\.cablevisionhd\.com\//i, BASE3 + "/");
}
function parseOptions(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\s[^>]*class="[^"]*\boption\b[^"]*"[^>]*>/g)) {
    const href = (/\bhref="([^"]+)"/.exec(m[0]) || [])[1];
    if (href) out.push(rootHost(new URL(decode(href), BASE3 + "/").href));
  }
  return [...new Set(out)];
}
function canalOf(optionUrl2) {
  const m = /[?&]canal=([^&#]+)/.exec(String(optionUrl2 || ""));
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch (_) {
    return m[1];
  }
}
var optionUrl = (skin, key) => `${BASE3}/${skin}/core.php?canal=${encodeURIComponent(key)}`;
function parseIframe(html) {
  const src = (/<iframe[^>]*\bsrc="([^"]+)"/i.exec(String(html || "")) || [])[1];
  return src ? new URL(decode(src), BASE3 + "/").href : null;
}
function parsePlaylist(html) {
  const s = String(html || "");
  const direct = (/\bvar\s+src\s*=\s*"([^"]+)"/.exec(s) || [])[1];
  if (direct) return direct.replace(/\\\//g, "/").replace(/\\:/g, ":");
  const b642 = (/\bvar\s+playbackURL\s*=\s*atob\("([^"]+)"\)/.exec(s) || [])[1];
  if (b642) {
    try {
      return atob(b642);
    } catch (_) {
      return null;
    }
  }
  return null;
}
async function fetchText(url, headers, timeoutMs) {
  const r = await liveFetch(url, { headers: { "User-Agent": UA2, ...headers || {} }, timeoutMs: timeoutMs || 12e3 });
  if (!r.ok) throw new Error("CablevisionHD " + r.status + " " + url);
  return r.text();
}
function grid(ctx) {
  const run = async () => {
    const list = parseChannels(await fetchText(BASE3 + "/parrilla-directo.php", { Referer: BASE3 + "/" }));
    if (!list.length) throw new Error("CablevisionHD: empty grid");
    return list;
  };
  return ctx && typeof ctx.once === "function" ? ctx.once("grid", run) : run();
}
var toItem2 = (c) => {
  const ch = { id: c.id, title: c.title };
  if (c.logo) ch.logo = c.logo;
  return ch;
};
function canalKeys() {
  const m = getJson(CVK_KEY);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
}
function saveKey(slug2, key) {
  const m = canalKeys();
  if (m[slug2] === key) return;
  m[slug2] = key;
  setJson(CVK_KEY, m, { ttlMs: CVK_TTL_MS });
}
async function offAir(url, headers) {
  try {
    return (await liveFetch(url, { headers, timeoutMs: 3500 })).status === 404;
  } catch (_) {
    return false;
  }
}
async function tryOption(option, channelUrl, verify2) {
  try {
    const iframe = parseIframe(await fetchText(option, { Referer: channelUrl }));
    if (!iframe) return null;
    const url = parsePlaylist(await fetchText(iframe, EMBED_HEADERS));
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const origin = /^https?:\/\/[^/]+/.exec(iframe)[0];
    const headers = { "User-Agent": UA2, Referer: origin + "/" };
    if (verify2 && await offAir(url, headers)) return { offline: true };
    return { url, mime: HLS_MIME, headers };
  } catch (e) {
    if (e && e.code === "deadline") throw e;
    return null;
  }
}
var offAirError = (slug2) => Object.assign(new Error(en3() ? "CablevisionHD: no signal right now for " + slug2 : "CablevisionHD: sin se\xF1al ahora para " + slug2), { code: "offline" });
var cablevisionhd = {
  id: "cablevisionhd",
  name: "CablevisionHD",
  genre: "otros",
  codeCategories: true,
  // categories() never makes a request (names are grouped in code)
  sharedFetch: true,
  // one scrape stores every category's list: one fetch unit for src/live.js's plan
  async categories() {
    return [...CATEGORIES, OTHER].map((c) => ({ id: c.id, title: en3() ? c.titleEn : c.title }));
  },
  // One scrape answers every category: the other six lists are stored from the same response.
  async channels(categoryId, ctx) {
    const list = await grid(ctx);
    const groups = groupChannels(list);
    const want = String(categoryId || "");
    if (ctx && typeof ctx.putList === "function") {
      for (const [id, items] of groups) if (id !== want) ctx.putList(id, items.map(toItem2));
    }
    if (!want || want === ALL) return list.map(toItem2);
    return (groups.get(want) || []).map(toItem2);
  },
  async resolve(channelId, ctx) {
    const m = /^([a-z0-9-]+-ver)$/i.exec(String(channelId || ""));
    if (!m) throw new Error(en3() ? "CablevisionHD: unknown ref " + channelId : "CablevisionHD: ref desconocida " + channelId);
    const slug2 = m[1];
    const channelUrl = `${BASE3}/${slug2}.php`;
    const verify2 = !!(ctx && ctx.verify);
    const tried = /* @__PURE__ */ new Set();
    const known = canalKeys()[slug2];
    if (known) {
      const opt = optionUrl(SKINS2[0], known);
      tried.add(opt);
      const out = await tryOption(opt, channelUrl, verify2);
      if (out && out.offline) throw offAirError(slug2);
      if (out && out.url) return out;
    }
    const options = parseOptions(await fetchText(channelUrl, { Referer: BASE3 + "/parrilla-directo.php" })).slice(0, 3);
    if (!options.length) throw new Error(en3() ? "CablevisionHD: no options on " + channelUrl : "CablevisionHD: sin opciones en " + channelUrl);
    const key = canalOf(options[0]);
    if (key) saveKey(slug2, key);
    for (const opt of options) {
      if (tried.has(opt)) continue;
      const out = await tryOption(opt, channelUrl, verify2);
      if (out && out.offline) throw offAirError(slug2);
      if (out && out.url) return out;
    }
    throw new Error(en3() ? "CablevisionHD: no playable option for " + slug2 : "CablevisionHD: ninguna opci\xF3n reproducible para " + slug2);
  }
};
var cablevisionhd_default = cablevisionhd;

// src/sources/futbollibre.js
var PRIMARY = "https://futbollibregol.org";
var BACKUP1 = "https://verfutbol.pro";
var BACKUP2 = "https://futbol-libre.app";
var AGENDA_API = "https://api.wqxag.com/diaries.json";
var IMG2 = "https://img.wqxag.com";
var HOUR = 36e5;
var AGENDA_BUDGET_MS = 1e4;
var VERIFY_TIMEOUT_MS = 2500;
var log7 = (m) => {
  try {
    if (typeof kino !== "undefined" && kino.log) kino.log(m);
  } catch {
  }
};
function entities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function hash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h << 5) + h + s.charCodeAt(i) | 0;
  return (h >>> 0).toString(36);
}
function splitTitle(raw) {
  const text2 = entities(raw);
  const m = /^([^:]{2,80}):\s*(.+)$/.exec(text2);
  return m ? { league: m[1].trim(), title: m[2].trim() } : { league: "", title: text2 };
}
function b64(s) {
  let x = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (x.length % 4) x += "=";
  try {
    return atob(x);
  } catch {
    return "";
  }
}
function tokenOf2(url) {
  const u = String(url || "");
  const id = (/[?&](?:stream|canal)=([A-Za-z0-9_-]{1,40})/.exec(u) || [])[1];
  if (!id) return "";
  if (/^https:\/\/(?:www\.)?tvf90\.com\//.test(u)) return "tvf90." + id;
  if (/^https:\/\/(?:www\.)?la18hd\.su\/vivo\/canales\.php/.test(u)) return "la18c." + id;
  if (/^https:\/\/(?:www\.)?la18hd\.su\//.test(u)) return "la18." + id;
  if (/^https:\/\/streamxhd\.st\//.test(u)) return "sxhd." + id;
  if (/^https:\/\/(?:futbollibretv\.sx|streamtp[a-z0-9.-]*)\//.test(u)) return "tp." + id;
  return "";
}
function withSisters(tokens) {
  const out = [];
  const add = (x) => {
    if (x && !out.includes(x)) out.push(x);
  };
  tokens.forEach(add);
  for (const x of tokens) {
    const [kind, id] = x.split(".");
    if (kind === "tvf90") add("la18." + id);
    if (kind === "la18" || kind === "la18c") add("tvf90." + id);
  }
  return out.slice(0, 7);
}
function makeEvent(source, startMs, league, title, flag, tokens) {
  const clean = withSisters(tokens);
  if (!clean.length || !title || !(startMs > 0)) return null;
  return { id: "e" + hash(source === "backup2" ? title + startMs : title + "|" + startMs), start: startMs, league, title, flag, tokens: clean };
}
function limaMs(date, hour) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hour));
  if (!d || !h) return 0;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]) + 5 * HOUR;
}
async function agendaPrimary(ms) {
  const r = await liveFetch(AGENDA_API, { timeoutMs: Math.min(8e3, ms) });
  if (!r.ok) throw new Error("agenda " + r.status);
  const data = r.json().data;
  if (!Array.isArray(data)) throw new Error("agenda shape");
  const out = [];
  for (const row of data) {
    const a = row && row.attributes || {};
    const { league, title } = splitTitle(a.diary_description);
    const c = a.country && a.country.data && a.country.data.attributes;
    const img = c && c.image && c.image.data && c.image.data.attributes && c.image.data.attributes.url;
    const tokens = [];
    for (const em of a.embeds && a.embeds.data || []) {
      const frame = em.attributes && em.attributes.embed_iframe || "";
      const m = /[?&]r=([^&]+)/.exec(frame);
      const tok = tokenOf2(m ? b64(decodeURIComponent(m[1])) : frame);
      if (tok && !tokens.includes(tok)) tokens.push(tok);
    }
    const ev = makeEvent("primary", limaMs(a.date_diary, a.diary_hour), league || c && c.name || "", title, img ? IMG2 + img : void 0, tokens);
    if (ev) out.push(ev);
  }
  return out;
}
async function agendaBackup1(ms) {
  const r = await liveFetch(BACKUP1 + "/api/agenda", { timeoutMs: Math.min(8e3, ms) });
  if (!r.ok) throw new Error("agenda " + r.status);
  const events = r.json().events;
  if (!Array.isArray(events)) throw new Error("agenda shape");
  const out = [];
  for (const e of events) {
    const { league, title } = splitTitle(e.title);
    const tokens = [];
    for (const em of e.embeds || []) {
      const tok = tokenOf2(em.iframe);
      if (tok && !tokens.includes(tok)) tokens.push(tok);
    }
    const ev = makeEvent("backup1", limaMs(e.date, e.time), league, title, typeof e.flag === "string" && /^https:/.test(e.flag) ? e.flag : void 0, tokens);
    if (ev) out.push(ev);
  }
  return out;
}
async function agendaBackup2(ms) {
  const r = await liveFetch(BACKUP2 + "/agenda", { timeoutMs: Math.min(9e3, ms) });
  if (!r.ok) throw new Error("agenda " + r.status);
  const out = [];
  for (const chunk of r.text().split('<div class="source-agenda-event"').slice(1)) {
    const instant = Date.parse((/data-source-instant="([^"]+)"/.exec(chunk) || [])[1] || "");
    const comp = entities((/source-agenda-competition">([^<]*)</.exec(chunk) || [])[1] || "").replace(/:$/, "");
    const strong = entities(((/<strong>([\s\S]*?)<\/strong>/.exec(chunk) || [])[1] || "").replace(/<[^>]+>/g, " "));
    const title = comp && strong.startsWith(comp) ? strong.slice(comp.length).replace(/^[:\s]+/, "") : strong;
    const flagPath = (/source-agenda-flag" src="([^"]+)"/.exec(chunk) || [])[1];
    const tokens = [];
    const re = /href="\/match\/([a-z0-9-]{1,100})#source=(\d{1,8})"/g;
    let m;
    while (m = re.exec(chunk)) tokens.push(`b2e.${m[1]}.${m[2]}`);
    const ev = makeEvent("backup2", instant, comp, title, flagPath ? BACKUP2 + flagPath : void 0, tokens.slice(0, 7));
    if (ev) out.push(ev);
  }
  return out;
}
function upcoming(list) {
  const now = Date.now();
  return list.filter((e) => e.start + 3 * HOUR > now).sort((a, b) => a.start - b.start);
}
async function loadAgenda() {
  const until = Date.now() + AGENDA_BUDGET_MS;
  let answered = false;
  let last = "";
  for (const fn of [agendaPrimary, agendaBackup1, agendaBackup2]) {
    const left = Math.min(until - Date.now(), remaining());
    if (left < 1e3) {
      last = last || "no time left";
      break;
    }
    try {
      const kept = upcoming(await fn(left));
      answered = true;
      if (kept.length) return kept;
    } catch (e) {
      last = String(e && (e.code || e.message) || e);
      log7("agenda failed: " + last);
    }
  }
  if (answered) return [];
  throw new Error("agenda: " + (last || "no source answered"));
}
function agenda() {
  return once("fl:agenda", loadAgenda);
}
var P_LOGO = PRIMARY + "/img/logo-canal/";
var B1_LOGO = BACKUP1 + "/img/channels/";
var B2_LOGO = BACKUP2 + "/assets/channel-logos/manual/";
var MAIN = [
  ["espn", "ESPN", "espn", B1_LOGO + "espn-1.webp"],
  ["espn2", "ESPN 2", "espn2", B1_LOGO + "espn-2.webp"],
  ["espn3", "ESPN 3", "espn3", P_LOGO + "espn_3.webp"],
  // backup1's espn-3.webp draws "ESPN2"
  ["foxsports", "Fox Sports", "foxsports", B1_LOGO + "fox-sports-1.webp"],
  ["foxsports2", "Fox Sports 2", "foxsports2", B1_LOGO + "fox-sports-2.webp"],
  ["foxsports3", "Fox Sports 3", "foxsports3", B1_LOGO + "fox-sports-3.webp"],
  ["dsports", "DSports", "dsports", B2_LOGO + "channel-8.jpg"],
  ["dsports2", "DSports 2", "dsports2", B2_LOGO + "channel-8.jpg"],
  ["dsportsplus", "DSports Plus", "dsportsplus", B2_LOGO + "channel-8.jpg"],
  ["liga1max", "Liga 1 MAX", "liga1max", P_LOGO + "liga_1_max.webp"],
  ["telemundo", "Telemundo", "telemundo", B2_LOGO + "channel-50.png"],
  ["espnmx", "ESPN M\xE9xico", "espnmx", B1_LOGO + "espn-1.webp"],
  ["espn2mx", "ESPN 2 M\xE9xico", "espn2mx", B1_LOGO + "espn-2.webp"],
  ["espn3mx", "ESPN 3 M\xE9xico", "espn3mx", P_LOGO + "espn_3.webp"],
  ["foxsportsmx", "Fox Sports M\xE9xico", "foxsportsmx", B1_LOGO + "fox-sports-1.webp"],
  ["foxsports2mx", "Fox Sports 2 M\xE9xico", "foxsports2mx", B1_LOGO + "fox-sports-2.webp"],
  ["foxsports3mx", "Fox Sports 3 M\xE9xico", "foxsports3mx", B1_LOGO + "fox-sports-3.webp"],
  ["foxsportspremium", "Fox Sports Premium", "foxsportspremium", B1_LOGO + "fox-sports-premium.webp"],
  ["tudnmx", "TUDN M\xE9xico", "tudn_mx", B1_LOGO + "tudn-mx.webp"]
].map(([id, name, stream, logo]) => ({ id: "c-" + id, name, stream, logo, tokens: withSisters(["tvf90." + stream, "la18." + stream]) }));
async function moreChannels() {
  const r = await liveFetch(BACKUP2 + "/channels", { timeoutMs: 12e3 });
  if (!r.ok) throw new Error("channels " + r.status);
  const out = [];
  const re = /<a class="channel-card" href="\/channel\/([a-z0-9-]{1,80})"><div class="channel-logo"><img src="([^"]+)" alt="([^"]*)"/g;
  const html = r.text();
  let m;
  while (m = re.exec(html)) {
    out.push({ id: "b2-" + m[1], name: entities(m[3]) || m[1], logo: /\.svg$/i.test(m[2]) ? void 0 : BACKUP2 + m[2], tokens: [1, 4, 2, 3].map((s) => `b2c.${m[1]}.${s}`) });
  }
  if (!out.length) throw new Error("channels empty");
  return out;
}
var ID2 = /^[A-Za-z0-9_-]{1,40}$/;
var SLUG = /^[a-z0-9-]{1,100}$/;
var PLAYBACK = /playbackURL\s*=\s*"([^"]+)"/;
var CDNPEER_SRC = /cdnpeer\.clappr\([^,]+,\s*\{[^}]*?"src"\s*:\s*"([^"]+)"/;
function unslash(s) {
  return String(s).replace(/\\\//g, "/");
}
function playbackFrom(html) {
  const m = CDNPEER_SRC.exec(html) || PLAYBACK.exec(html);
  return m ? unslash(m[1]) : "";
}
function get3(url, headers, ms) {
  return liveFetch(url, { headers, timeoutMs: ms });
}
async function viaTvf90(id, ms) {
  const r = await get3(`https://tvf90.com/5.php?stream=${id}`, { Referer: "https://tvf90.com/" }, ms);
  return r.ok ? playbackFrom(r.text()) : "";
}
async function viaLa18(id, plural, ms) {
  const r = await get3(`https://la18hd.su/vivo/${plural ? "canales" : "canal"}.php?stream=${id}`, { "Sec-Fetch-Dest": "iframe" }, ms);
  const m = r.ok && /"src":"([^"]+)"/.exec(r.text());
  return m ? unslash(m[1]) : "";
}
async function viaStreamxhd(id, ms) {
  const r = await get3(`https://streamxhd.st/live1.php?stream=${id}`, { "Sec-Fetch-Dest": "iframe" }, ms);
  if (!r.ok) return "";
  const html = r.text();
  const arr = /var playbackURL="",(\w+)=\[\][^;]*;\s*\1=(\[\[[\s\S]*?\]\]);/.exec(html);
  const keyFns = /var k=(\w+)\(\)\+(\w+)\(\);/.exec(html);
  if (!arr || !keyFns) return "";
  const fn = (name) => {
    const f = new RegExp("function " + name + "\\(\\)\\{return (\\d+);\\}").exec(html);
    return f ? parseInt(f[1], 10) : NaN;
  };
  const k = fn(keyFns[1]) + fn(keyFns[2]);
  const pairs2 = [];
  const re = /\[(\d+),"([A-Za-z0-9+/=]+)"\]/g;
  let m;
  while (m = re.exec(arr[2])) pairs2.push([parseInt(m[1], 10), m[2]]);
  if (!pairs2.length || !Number.isFinite(k)) return "";
  pairs2.sort((a, b) => a[0] - b[0]);
  let out = "";
  for (const [, b] of pairs2) out += String.fromCharCode(parseInt(atob(b).replace(/\D/g, ""), 10) - k);
  return /^https:\/\//.test(out) ? out : "";
}
async function viaStreamtp(id, ms) {
  const r = await get3(`https://streamtp99a.sbs/global1.php?stream=${id}`, {}, ms);
  return r.ok ? playbackFrom(r.text()) : "";
}
async function viaBackup2(query, ms) {
  const r = await get3(`${BACKUP2}/api/direct-playback.php?${query}`, {}, ms);
  if (!r.ok) return "";
  const data = r.json();
  const tok = data && data.success ? tokenOf2(data.url) : "";
  return tok && !tok.startsWith("b2") ? runToken(tok, ms) : "";
}
async function runToken(token, ms) {
  const [kind, a, b] = token.split(".");
  if (kind === "b2e" && SLUG.test(a) && /^\d{1,8}$/.test(b)) return viaBackup2(`type=event&slug=${a}&source=${b}`, ms);
  if (kind === "b2c" && SLUG.test(a) && /^[1-4]$/.test(b)) return viaBackup2(`type=channel&slug=${a}&server=${b}`, ms);
  if (!ID2.test(a || "")) return "";
  if (kind === "tvf90") return viaTvf90(a, ms);
  if (kind === "la18") return viaLa18(a, false, ms);
  if (kind === "la18c") return viaLa18(a, true, ms);
  if (kind === "sxhd") return viaStreamxhd(a, ms);
  if (kind === "tp") return viaStreamtp(a, ms);
  return "";
}
async function verify(url) {
  if (!/^https:\/\/[^/]*\.(?:ftlly|fubo18|domhsd)\.com[:/]/.test(url)) return "ok";
  try {
    const r = await liveFetch(url, { timeoutMs: VERIFY_TIMEOUT_MS });
    if (r.ok) return /^#EXTM3U/.test(r.text().trimStart()) ? "ok" : "offline";
    return r.status >= 400 ? "offline" : "ok";
  } catch {
    return "slow";
  }
}
function eventChannel(e) {
  const title = [e.title, e.league].filter(Boolean).join(" \u2014 ");
  const ch = { id: e.tokens.join(","), key: "hoy." + e.id, title, start: e.start };
  if (e.flag) ch.logo = e.flag;
  return ch;
}
function tokenChannel(c) {
  const ch = { id: c.tokens.join(","), title: c.name };
  if (c.logo) ch.logo = c.logo;
  return ch;
}
var conn = {
  id: "futbollibre",
  name: "F\xFAtbol Libre",
  genre: "deportes",
  codeCategories: true,
  // categories() never makes a request
  codeList: (cat) => cat === "main",
  // "main" is a code list; "hoy" and "mas" are fetched and stored
  // Always the three: the 41 KB /channels probe that decided whether to list "más" is gone (spec §5.1); an empty
  // "más" just shows no channels.
  async categories() {
    return [
      { id: "hoy", title: { es: "Partidos de hoy", en: "Today's matches" } },
      { id: "main", title: { es: "Canales deportivos", en: "Sports channels" } },
      { id: "mas", title: { es: "M\xE1s canales", en: "More channels" } }
    ];
  },
  async channels(categoryId) {
    if (categoryId === "hoy") return (await agenda()).map(eventChannel);
    if (categoryId === "main") return MAIN.map(tokenChannel);
    if (categoryId === "mas") return (await moreChannels()).map(tokenChannel);
    return [];
  },
  async resolve(channelId) {
    const tokens = String(channelId || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (!tokens.length) throw new Error("ref inv\xE1lido");
    const started = Date.now();
    let sawOffline = false;
    let slow = "";
    for (const token of tokens) {
      const left = Math.min(18e3 - (Date.now() - started), remaining());
      if (left < 2500) break;
      try {
        const url = await runToken(token, Math.min(8e3, left - 1500));
        if (!url) {
          log7("player " + token.split(".")[0] + ": sin direcci\xF3n");
          continue;
        }
        const verdict = await verify(url);
        if (verdict === "offline") {
          sawOffline = true;
          continue;
        }
        if (verdict === "slow") {
          slow = slow || url;
          continue;
        }
        return { url, mime: "application/vnd.apple.mpegurl" };
      } catch (e) {
        log7("player " + token.split(".")[0] + " fall\xF3: " + (e && e.message));
      }
    }
    if (slow) return { url: slow, mime: "application/vnd.apple.mpegurl" };
    throw new Error(sawOffline ? "sin se\xF1al por ahora" : "ning\xFAn servidor responde");
  }
};
var futbollibre_default = conn;

// src/sources/stremio.js
var HLS3 = "application/vnd.apple.mpegurl";
var DASH2 = "application/dash+xml";
var TS2 = "video/mp2t";
function httpOk(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}
function mimeFor2(url) {
  const u = String(url || "");
  if (/\.m3u8(\?|$)/i.test(u)) return HLS3;
  if (/\.mpd(\?|$)/i.test(u)) return DASH2;
  if (/\.ts(\?|$)/i.test(u)) return TS2;
  return HLS3;
}
function tierOf(url) {
  if (/^http:\/\//i.test(url)) return 3;
  if (/\.m3u8(\?|$)/i.test(url)) return 0;
  if (/\.(mkv|mp4|webm)(\?|$)/i.test(url)) return 1;
  return 2;
}
function langRank(s, wanted) {
  const l = String(s && s.language || "").toLowerCase();
  const i = wanted.indexOf(l);
  return i < 0 ? wanted.length : i;
}
function headersOf(s) {
  const req = s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request;
  const out = {};
  if (req && typeof req === "object") {
    for (const k of ["Referer", "Origin", "User-Agent"]) if (typeof req[k] === "string" && req[k]) out[k] = req[k];
  }
  return out;
}
function cleanName(name) {
  return String(name || "").replace(/[⠀​]/g, "").replace(/^[^\p{L}\p{N}(\[]+/u, "").slice(0, 120) || "\u2014";
}
async function getJson2(url, timeoutMs) {
  const res = await liveFetch(url, { method: "GET", headers: { Accept: "application/json" }, cookies: false, timeoutMs: timeoutMs || 15e3 });
  if (!res || !res.ok) {
    const e = new Error("stremio " + (res && res.status) + " " + url);
    e.status = res && res.status;
    throw e;
  }
  return res.json();
}
function noStreams(id) {
  const e = new Error("no streams for " + id);
  e.code = "no_streams";
  return e;
}
async function probeCopy(url, headers, timeoutMs) {
  try {
    const r = await liveFetch(url, { method: "GET", headers, cookies: false, timeoutMs: timeoutMs || 5e3 });
    if (!r) return "unknown";
    if (r.ok) {
      if (/\.m3u8(\?|$)/i.test(url)) return /#EXTM3U/.test(r.text()) ? "ok" : "dead";
      return "ok";
    }
    const st = Number(r.status) || 0;
    return st >= 400 && st < 500 && st !== 408 && st !== 425 && st !== 429 ? "dead" : "unknown";
  } catch (e) {
    return "unknown";
  }
}
function noCopy(id) {
  const en6 = lang() === "en";
  const e = new Error(en6 ? "no copy of this event opens from your network right now" : "ninguna copia de este evento abre desde tu red ahora mismo");
  e.code = "no_copy";
  e.id = id;
  e.userMessage = en6 ? "No copy of this event opens from your network right now." : "Ninguna copia de este evento abre desde tu red ahora mismo.";
  return e;
}
var usableMeta = (m) => m && typeof m.id === "string" && m.id && String(m.name || m.title || "").trim();
var titleKey = (t2) => String(t2 || "").toLowerCase().replace(/\s+/g, " ").trim();
function makeStremio(cfg) {
  const base = String(cfg.base || "").replace(/\/+$/, "");
  const streamSort = cfg.streamSort || "hls";
  const langs = (cfg.langs || []).map((x) => String(x).toLowerCase());
  const listCap = cfg.listCap || 1500;
  const fixed = Array.isArray(cfg.categories) ? cfg.categories : null;
  const keyOf = typeof cfg.keyOf === "function" ? cfg.keyOf : () => null;
  const eventOf3 = typeof cfg.eventOf === "function" ? cfg.eventOf : () => null;
  function descriptor(rawCat) {
    const id = String(rawCat == null ? "" : rawCat);
    if (!id) return null;
    if (fixed) return fixed.find((c) => c.id === id) || null;
    if (cfg.catalogFor) return cfg.catalogFor(id);
    return { id, catalog: id };
  }
  async function catalogMetas(cat) {
    const path = cat.path || "/catalog/tv/" + encodeURIComponent(cat.catalog || cat.id) + ".json";
    const body = await getJson2(base + path, cfg.listTimeoutMs || 15e3);
    let metas = Array.isArray(body && body.metas) ? body.metas : [];
    metas = metas.filter(usableMeta);
    if (cfg.filterMeta) metas = metas.filter(cfg.filterMeta);
    return metas;
  }
  function toChannels(metas) {
    const ids = /* @__PURE__ */ new Set();
    const keys2 = /* @__PURE__ */ new Set();
    const titles = /* @__PURE__ */ new Set();
    const out = [];
    for (const m of metas) {
      if (out.length >= listCap) break;
      if (ids.has(m.id)) continue;
      const title = cfg.titleFor ? cfg.titleFor(m) : cleanName(m.name || m.title || m.id);
      const key = keyOf(m.id);
      if (key != null && keys2.has(key)) continue;
      const tk = cfg.dedupeTitles ? titleKey(title) : "";
      if (tk && titles.has(tk)) continue;
      ids.add(m.id);
      if (key != null) keys2.add(key);
      if (tk) titles.add(tk);
      const ch = { id: m.id, title };
      if (key != null) ch.key = key;
      const logo = [m.poster, m.logo].find((u) => typeof u === "string" && u.startsWith("https://"));
      if (logo) ch.logo = logo;
      const ev = eventOf3(m);
      if (ev && ev.start > 0) ch.start = ev.start;
      if (ev && ev.end > 0) ch.end = ev.end;
      if (ev && ev.origin) ch.origin = ev.origin;
      out.push(ch);
    }
    return out;
  }
  async function streamsOf(id) {
    let body;
    try {
      body = await getJson2(base + "/stream/tv/" + encodeURIComponent(id) + ".json", cfg.streamTimeoutMs || 15e3);
    } catch (e) {
      if (e && e.status === 404) throw noStreams(id);
      throw e;
    }
    const streams = (Array.isArray(body && body.streams) ? body.streams : []).filter((s) => httpOk(s && s.url));
    if (!streams.length) throw noStreams(id);
    return streams;
  }
  async function play(id) {
    const streams = await streamsOf(id);
    const indexed = streams.map((s, i) => ({ s, i }));
    if (streamSort === "lang") {
      indexed.sort((a, b) => langRank(a.s, langs) - langRank(b.s, langs) || (b.s.score || 0) - (a.s.score || 0) || a.i - b.i);
    } else {
      indexed.sort((a, b) => tierOf(a.s.url) - tierOf(b.s.url) || a.i - b.i);
    }
    let pick = indexed[0].s;
    if (cfg.probe) {
      const max = cfg.probeMax || 5;
      const deadline2 = Date.now() + (cfg.probeBudgetMs || 11e3);
      let found = null, unsure = null, probed = 0;
      for (const x of indexed.slice(0, max)) {
        if (Date.now() > deadline2) break;
        probed++;
        const v = await probeCopy(x.s.url, headersOf(x.s), cfg.probeTimeoutMs || 3500);
        if (v === "ok") {
          found = x.s;
          break;
        }
        if (v === "unknown" && !unsure) unsure = x.s;
      }
      if (found) pick = found;
      else if (unsure) pick = unsure;
      else if (probed < indexed.length) pick = indexed[probed].s;
      else throw noCopy(id);
    }
    const out = { url: pick.url, mime: mimeFor2(pick.url) };
    const h = headersOf(pick);
    if (Object.keys(h).length) out.headers = h;
    return out;
  }
  async function rematch(rawId, ctx) {
    const key = keyOf(rawId);
    const hit = ctx.findChannel(rawId);
    const title = hit ? titleKey(hit.title) : "";
    const other = (it) => {
      const rid = ctx.rawIdOf(it);
      if (!rid || rid === rawId) return null;
      if (key != null) return keyOf(rid) === key ? rid : null;
      return title && titleKey(it.title) === title ? rid : null;
    };
    if (key == null && !title) return null;
    const scan = hit ? [hit.cat] : fixed ? fixed.map((c) => c.id) : [];
    for (const c of scan) {
      for (const it of ctx.storedList(c) || []) {
        const rid = other(it);
        if (rid) return rid;
      }
    }
    if (!hit || hit.cat == null) return null;
    const items = await ctx.relist(hit.cat, { force: true });
    for (const it of items || []) {
      const rid = other(it);
      if (rid) return rid;
    }
    return null;
  }
  return {
    id: cfg.id,
    name: cfg.name,
    genre: cfg.genre || "otros",
    codeCategories: !cfg.discover,
    // a fixed `categories` list never makes a request; a discovered one does
    async categories() {
      const list = fixed || await once("stremio:manifest:" + cfg.id, () => cfg.discover({ base, getJson: getJson2 }));
      return (Array.isArray(list) ? list : []).map((c) => ({ id: c.id, title: localTitle(c.title) || c.id }));
    },
    async channels(rawCat) {
      const cat = descriptor(rawCat);
      if (!cat) return [];
      return toChannels(await catalogMetas(cat));
    },
    async resolve(rawId, ctx) {
      const id = String(rawId == null ? "" : rawId);
      try {
        return await play(id);
      } catch (e) {
        const canRelist = cfg.relistOnEmpty && ctx && typeof ctx.findChannel === "function" && typeof ctx.relist === "function";
        if (!canRelist || !e || e.code !== "no_streams") throw e;
        const next = await rematch(id, ctx);
        if (!next) throw e;
        if (ctx.log) ctx.log("no streams: re-matched to the channel's current id, retrying once");
        return play(next);
      }
    }
  };
}

// src/sources/nuvio-sports.js
var HOST = "https://nuviosports.xyz";
var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64url(s) {
  const bytes = [];
  for (const ch of unescape(encodeURIComponent(s))) bytes.push(ch.charCodeAt(0));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] || 0) << 8 | (bytes[i + 2] || 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63];
    if (i + 1 < bytes.length) out += B64[n >> 6 & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
var PROFILE = { timezone: "UTC", languages: "Spanish", replayFilter: "disabled", webStreams: "disabled", sports: "all" };
var BASE4 = HOST + "/" + base64url(JSON.stringify(PROFILE));
var CATEGORIES2 = [
  { id: "live", catalog: "nuvio_sports_live", title: { es: "En vivo ahora", en: "Live now" } },
  { id: "networks", catalog: "nuvio_sports_networks", title: { es: "TV deportiva 24/7", en: "24/7 sports TV" } },
  { id: "football", catalog: "nuvio_sports_football", title: { es: "F\xFAtbol", en: "Football" } },
  { id: "basketball", catalog: "nuvio_sports_basketball", title: { es: "Baloncesto", en: "Basketball" } },
  { id: "tennis", catalog: "nuvio_sports_tennis", title: { es: "Tenis", en: "Tennis" } },
  { id: "motorsport", catalog: "nuvio_sports_motorsport", title: { es: "Motor", en: "Motorsport" } },
  { id: "mma", catalog: "nuvio_sports_mma", title: { es: "MMA", en: "MMA" } },
  { id: "baseball", catalog: "nuvio_sports_baseball", title: { es: "B\xE9isbol", en: "Baseball" } },
  { id: "hockey", catalog: "nuvio_sports_hockey", title: { es: "Hockey", en: "Hockey" } },
  { id: "rugby", catalog: "nuvio_sports_rugby", title: { es: "Rugby", en: "Rugby" } },
  { id: "americanfootball", catalog: "nuvio_sports_american_football", title: { es: "F\xFAtbol americano", en: "American football" } },
  { id: "golf", catalog: "nuvio_sports_golf", title: { es: "Golf", en: "Golf" } },
  { id: "cricket", catalog: "nuvio_sports_cricket", title: { es: "Cr\xEDquet", en: "Cricket" } },
  { id: "college", catalog: "nuvio_sports_college", title: { es: "Deporte universitario", en: "College sports" } },
  { id: "other", catalog: "nuvio_sports_other", title: { es: "Otros deportes", en: "Other sports" } }
];
var CHURNING = /^nuvio_sport_(?:cdn_ch_[a-z]{2}|dlv_ch_\d+)_([a-z0-9][a-z0-9._-]*)$/i;
function channelKey(rawId) {
  const m = CHURNING.exec(String(rawId || ""));
  return m ? "ch:" + m[1].toLowerCase() : null;
}
function isPlaceholder(m) {
  return /(^|_)leaf_expired[:_]|expired:notice/i.test(String(m && m.id || "")) || /subscription expired/i.test(String(m && m.name || ""));
}
function eventOf(m) {
  const t2 = Date.parse(String(m && m.released || ""));
  const p = /^nuvio_sport_([a-z0-9]{1,12})_/.exec(String(m && m.id || ""));
  return { start: t2 > 0 ? t2 : 0, origin: p ? p[1] : "" };
}
var nuvio_sports_default = makeStremio({
  id: "nuvio-sports",
  name: "Nuvio Sports",
  base: BASE4,
  genre: "deportes",
  categories: CATEGORIES2,
  filterMeta: (m) => !isPlaceholder(m),
  keyOf: channelKey,
  eventOf,
  relistOnEmpty: true,
  streamSort: "lang",
  langs: ["spanish"]
});

// src/sources/deportv.js
var HOST2 = "https://elcanaldeportivo.org";
var PLAYER_HOSTS = /* @__PURE__ */ new Set(["siempreon.shop", "xstream.st"]);
var MAX_FRAMES = 4;
var TODAY_ID = "today";
var TODAY_TITLE = { es: "Hoy", en: "Today" };
var ON_AIR_MS = 3 * 60 * 60 * 1e3;
var DAY_MS = 24 * 60 * 60 * 1e3;
var LEAGUE_AHEAD_MS = 48 * 60 * 60 * 1e3;
var MAX_CATS2 = 6;
var SCHEDULE_KEY = "o2:dtv";
var SCHEDULE_TTL_MS = 7 * DAY_MS;
var MAX_RAW_CAT = Math.floor((128 - "deportv.".length) / 2);
function frameHeaders(referer) {
  return { Referer: referer, "Sec-Fetch-Dest": "iframe", Accept: "text/html" };
}
async function getText2(url, referer) {
  const r = await liveFetch(url, { headers: frameHeaders(referer), timeoutMs: 12e3 });
  if (!r.ok) throw new Error(url + " respondi\xF3 " + r.status);
  return r.text();
}
function hostOf2(url) {
  const m = /^https?:\/\/([^/]+)/i.exec(String(url));
  return m ? m[1] : "";
}
function originOf(url) {
  const m = /^(https?:\/\/[^/]+)/i.exec(String(url));
  return m ? m[1] : "";
}
function absolute(src, base) {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("//")) return "https:" + src;
  return base.replace(/^(https?:\/\/[^/]+).*$/i, "$1") + (src.startsWith("/") ? "" : "/") + src;
}
function firstIframe(html, base) {
  const m = /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return m ? absolute(m[1], base) : null;
}
function streamUrlOf(script) {
  const m = /streamUrls\s*=\s*\[\s*"([^"]+)"/.exec(script);
  if (!m) return null;
  const url = m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  return /^https:\/\//.test(url) ? url : null;
}
function parseSchedule(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.equipos !== "string") continue;
    const channels2 = (Array.isArray(m.canales) ? m.canales : []).filter((c) => c && typeof c.url === "string" && /^\/ver\/[\w.-]+\.php$/.test(c.url)).map((c) => ({ name: String(c.nombre || "").slice(0, 60), path: c.url, quality: String(c.calidad || "") }));
    if (!channels2.length) continue;
    out.push({
      league: String(m.liga || "").replace(/:\s*$/, "").trim() || "Otros",
      title: m.equipos.replace(/\s+/g, " ").trim().slice(0, 120),
      utc: Date.parse(m.hora_utc) || 0,
      logo: /^img\/[\w.-]+$/.test(m.logo || "") ? HOST2 + "/" + m.logo : "",
      channels: channels2
    });
  }
  return out.sort((a, b) => a.utc - b.utc);
}
function storedSchedule() {
  const v = getJson(SCHEDULE_KEY);
  return v && typeof v.lm === "string" && v.lm && Array.isArray(v.m) ? v : null;
}
async function fetchSchedule() {
  const stored = storedSchedule();
  const headers = { Accept: "application/json", Referer: HOST2 + "/" };
  if (stored) headers["If-Modified-Since"] = stored.lm;
  const r = await liveFetch(HOST2 + "/partidos.json", { headers, timeoutMs: 1e4 });
  if (r.status === 304 && stored) return stored.m;
  if (!r.ok) throw new Error("agenda respondi\xF3 " + r.status);
  const m = parseSchedule(r.json());
  const lm = String(r.headers && (r.headers["last-modified"] || r.headers["Last-Modified"]) || "");
  if (lm) {
    if (!stored || stored.lm !== lm || JSON.stringify(stored.m) !== JSON.stringify(m)) setJson(SCHEDULE_KEY, { lm, m }, { ttlMs: SCHEDULE_TTL_MS });
  }
  return m;
}
function schedule(ctx) {
  return ctx && typeof ctx.once === "function" ? ctx.once("schedule", fetchSchedule) : once("dtv:schedule", fetchSchedule);
}
function slug(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function leagueId(league) {
  return ("l_" + slug(league).slice(0, 60)).slice(0, MAX_RAW_CAT);
}
function clock(utc) {
  const d = new Date(utc);
  const p = (n) => String(n).padStart(2, "0");
  return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC";
}
function baseOfPath(path) {
  const m = /^\/ver\/([\w.-]+)\.php$/.exec(String(path));
  return m ? m[1] : "";
}
function channelsOf(match, categoryId) {
  const out = [];
  for (const c of match.channels) {
    const base = baseOfPath(c.path);
    if (!base) continue;
    const disc = (slug(match.title).slice(0, 40) + "-" + slug(c.name).slice(0, 20)).replace(/^-|-$/g, "") || "x";
    const ch = {
      id: (base + "~" + disc).slice(0, 110),
      title: match.title + " \xB7 " + c.name + (c.quality ? " (" + c.quality + ")" : "") + " \xB7 " + clock(match.utc),
      start: match.utc
    };
    if (match.logo) ch.logo = match.logo;
    out.push(ch);
  }
  return out;
}
function categoriesOf2(matches2, now) {
  const leagues = [];
  for (const m of matches2) {
    if (!(m.utc > now - ON_AIR_MS && m.utc < now + LEAGUE_AHEAD_MS)) continue;
    const id = leagueId(m.league);
    if (!leagues.some((l) => l.id === id)) leagues.push({ id, title: m.league });
  }
  return [{ id: TODAY_ID, title: TODAY_TITLE }, ...leagues].slice(0, MAX_CATS2);
}
function listOf(matches2, categoryId, now) {
  const picked = categoryId === TODAY_ID ? matches2.filter((m) => m.utc > now - ON_AIR_MS && m.utc < now + DAY_MS) : matches2.filter((m) => leagueId(m.league) === categoryId && m.utc > now - ON_AIR_MS && m.utc < now + LEAGUE_AHEAD_MS);
  const out = [];
  for (const m of picked) for (const ch of channelsOf(m, categoryId)) out.push(ch);
  return out.slice(0, 200);
}
function storeAll(ctx, matches2, now, except) {
  const cats = categoriesOf2(matches2, now);
  if (ctx && typeof ctx.setCats === "function") ctx.setCats(cats);
  if (ctx && typeof ctx.putList === "function") {
    for (const c of cats) if (c.id !== except) ctx.putList(c.id, listOf(matches2, c.id, now));
  }
  return cats;
}
var conn2 = {
  id: "deportv",
  name: "DeporTV",
  genre: "deportes",
  sharedFetch: true,
  // one schedule stores every category's list: one fetch unit for src/live.js's plan
  async categories(ctx) {
    const matches2 = await schedule(ctx);
    const now = Date.now();
    const cats = categoriesOf2(matches2, now);
    if (ctx && typeof ctx.putList === "function") for (const c of cats) ctx.putList(c.id, listOf(matches2, c.id, now));
    return cats;
  },
  async channels(categoryId, ctx) {
    const matches2 = await schedule(ctx);
    const now = Date.now();
    const cat = String(categoryId);
    storeAll(ctx, matches2, now, cat);
    return listOf(matches2, cat, now);
  },
  async resolve(channelId) {
    const base = String(channelId || "").split("~")[0];
    if (!/^[\w.-]+$/.test(base)) throw new Error("ref inv\xE1lido");
    let page = HOST2 + "/ver/" + base + ".php";
    let referer = HOST2 + "/";
    for (let i = 0; i < MAX_FRAMES; i++) {
      const html = await getText2(page, referer);
      if (PLAYER_HOSTS.has(hostOf2(page))) {
        const url = streamUrlOf(html);
        if (!url) throw new Error("sin stream en el reproductor");
        return { url, mime: "application/vnd.apple.mpegurl", headers: { Referer: page, Origin: originOf(page) } };
      }
      const next = firstIframe(html, page);
      if (!next) throw new Error("sin iframe");
      const host = hostOf2(next);
      if (host !== hostOf2(HOST2) && !PLAYER_HOSTS.has(host)) throw new Error("reproductor no soportado: " + host);
      referer = page;
      page = next;
    }
    throw new Error("demasiados iframes");
  }
};
var deportv_default = conn2;

// src/sources/cncverse.js
var BASE5 = "https://cncverse.dpdns.org/u/p_48sfkwcafx1s";
var ADULT = /adult|18\+|xxx|porn|erotic|sexy|hentai/i;
var EVENT_CATALOG = /^cnc_[A-Za-z0-9_]{1,100}$/;
function cleanCat(name) {
  return String(name || "").replace(/\((?:other|tv)\)/gi, "").replace(/^[^\p{L}\p{N}]+/u, "").replace(/\s+/g, " ").trim();
}
var ENDED = /[?&]isEnded=true(?:&|$)/;
function isEnded(m) {
  return ENDED.test(String(m && m.poster || "")) || ENDED.test(String(m && m.background || "")) || /^\s*✅/u.test(String(m && m.name || ""));
}
var usable = (m) => m && typeof m.id === "string" && m.id.startsWith("cnc:") && m.id.length <= 4e3 && String(m.name || "").trim() && !ADULT.test(String(m.name)) && !isEnded(m);
function discoverEvents() {
  return async ({ base, getJson: getJson3 }) => {
    const body = await getJson3(base + "/manifest.json", 8e3);
    const cats = Array.isArray(body && body.catalogs) ? body.catalogs : [];
    const out = [];
    const seen = /* @__PURE__ */ new Set();
    for (const c of cats) {
      if (!c || c.type !== "tv" || typeof c.id !== "string" || !c.id.startsWith("cnc_")) continue;
      if (/Highlights/i.test(c.id) || ADULT.test(c.id) || ADULT.test(String(c.name || ""))) continue;
      if (seen.has(c.id)) continue;
      if (!/LiveEvents/i.test(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, catalog: c.id, title: cleanCat(c.name) || c.id });
    }
    return out;
  };
}
var B642 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
var B64_VAL = (() => {
  const t2 = new Int16Array(128).fill(-1);
  for (let i = 0; i < B642.length; i++) t2[B642.charCodeAt(i)] = i;
  t2[43] = 62;
  t2[45] = 62;
  t2[47] = 63;
  t2[95] = 63;
  return t2;
})();
function b64Text(s) {
  const str6 = String(s || "");
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < str6.length; i++) {
    const c = str6.charCodeAt(i);
    if (c === 61) break;
    const v = c < 128 ? B64_VAL[c] : -1;
    if (v < 0) return null;
    acc = acc << 6 | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(acc >> bits & 255);
    }
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
  try {
    return decodeURIComponent(escape(bin));
  } catch (_) {
    return bin;
  }
}
function decodeEventId(rawId) {
  const s = String(rawId || "");
  if (!s.startsWith("cnc:")) return null;
  const text2 = b64Text(s.slice(4));
  if (!text2) return null;
  const i = text2.indexOf("::");
  if (i <= 0) return null;
  try {
    const ev = JSON.parse(text2.slice(i + 2));
    return ev && typeof ev === "object" ? { provider: text2.slice(0, i), ev } : null;
  } catch (_) {
    return null;
  }
}
function eventKey(rawId) {
  const d = decodeEventId(rawId);
  if (!d) return null;
  const ev = d.ev;
  const title = String(ev.title || ev.eventInfo && ev.eventInfo.eventName || "").replace(/\s+/g, " ").trim();
  const start = String(ev.eventInfo && ev.eventInfo.startTime || "").trim();
  const alt = ev.eventId != null ? ev.eventId : ev.channelId != null ? ev.channelId : "";
  if (!title && !start && alt === "") return null;
  return "ev:" + d.provider + "|" + title + "|" + (start || "#" + alt);
}
function bridgeTime(s) {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(?:([+-])(\d{2}):?(\d{2})|Z)?$/.exec(String(s || "").trim());
  if (!m) return 0;
  const off = m[7] ? (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 6e4 : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - off;
}
function eventOf2(meta2) {
  const d = decodeEventId(meta2 && meta2.id);
  if (!d) return null;
  const info = d.ev && d.ev.eventInfo || {};
  return { start: bridgeTime(info.startTime), end: bridgeTime(info.endTime), origin: d.provider.replace(/LiveEvents$/, "").slice(0, 24) };
}
var cncverse = makeStremio({
  id: "cncverse",
  name: "CNCVerse Deportes",
  base: BASE5,
  genre: "deportes",
  discover: discoverEvents(),
  catalogFor: (id) => EVENT_CATALOG.test(id) && /LiveEvents/i.test(id) ? { id, catalog: id } : null,
  filterMeta: usable,
  keyOf: eventKey,
  eventOf: eventOf2,
  dedupeTitles: true,
  streamSort: "hls",
  probe: true,
  // every event carries several copies; many CDNs answer 403 by geo: return the one that answers on THEIR network
  probeMax: 6,
  listCap: 1e3,
  listTimeoutMs: 18e3,
  streamTimeoutMs: 18e3
});
var cncverse_default = cncverse;

// src/sources/index.js
var premiumtv = makeM3U({
  id: "premiumtv",
  name: "Premium TV",
  url: "https://raw.githubusercontent.com/JMigue85/IPTV-SV/refs/heads/main/IPTVSV.m3u",
  genre: "otros"
});
var SOURCES = [
  tvenvivo_default,
  caracol_default,
  cablevisionhd_default,
  premiumtv,
  supertv_default,
  futbollibre_default,
  nuvio_sports_default,
  deportv_default,
  cncverse_default,
  xuper_default,
  supertv2,
  supertv3
];

// src/liveStore.js
var LC_KEY = "o2:lc";
var LM_KEY = "o2:lm";
var LIST_PREFIX = "o2:ll:";
var L0_MAX_CHARS = 2e6;
var FAIL_BACKOFF_MS = 10 * 60 * 1e3;
var CATS_BACKOFF_MS = [10, 30, 60, 180].map((m) => m * 60 * 1e3);
var MAX_TTL_MS = 30 * 24 * 3600 * 1e3;
var TOMBSTONE_MS = 24 * 3600 * 1e3;
function log8(m) {
  try {
    kino.log("liveStore: " + m);
  } catch (_) {
  }
}
function sha1(t2) {
  if (t2.length <= 4e6) {
    try {
      return String(kino.crypto.hash("sha1", t2)).slice(0, 16);
    } catch (_) {
    }
  }
  let a = 5381, b = 52711;
  for (let i = 0; i < t2.length; i++) {
    const c = t2.charCodeAt(i);
    a = (a * 33 ^ c) >>> 0;
    b = (b * 31 ^ c) >>> 0;
  }
  return "j" + a.toString(16).padStart(8, "0") + b.toString(16).padStart(7, "0");
}
var regCache = null;
var metaCache = null;
function emptyMeta() {
  return { v: 1, c: {}, l: {} };
}
function readMeta() {
  const m = getJson(LM_KEY);
  return m && typeof m === "object" && m.c && m.l ? m : emptyMeta();
}
var deferSeq = -1;
function deferWrites() {
  deferSeq = callSeq();
}
var deferring = () => deferSeq === callSeq();
function meta() {
  const seq2 = callSeq();
  if (!metaCache || metaCache.seq !== seq2) {
    const left = metaCache && metaCache.dirty ? metaCache : null;
    if (!deferring()) flushMeta();
    metaCache = { seq: seq2, value: readMeta(), touched: /* @__PURE__ */ new Set(), dirty: false };
    if (left && deferring()) carry(left);
  }
  return metaCache;
}
function carry(left) {
  const m = metaCache;
  for (const t2 of left.touched) {
    const kind = t2.slice(0, 1), id = t2.slice(2);
    const mine = left.value[kind][id], theirs = m.value[kind][id];
    if (!mine) continue;
    if (theirs && saneAt(theirs.at) > saneAt(mine.at)) {
      if (kind === "l") {
        pendingTexts.delete(id);
        l0Drop(id);
      }
      continue;
    }
    m.value[kind][id] = mine;
    m.touched.add(t2);
  }
  m.dirty = m.touched.size > 0;
}
function touch(kind, id, entry) {
  const m = meta();
  m.value[kind][id] = entry;
  m.touched.add(kind + ":" + id);
  m.dirty = true;
}
function newerElsewhere(kind, id) {
  const m = meta();
  if (m.touched.has(kind + ":" + id)) return false;
  if (!m.snapshot) m.snapshot = readMeta();
  const e = m.snapshot[kind][id];
  return !!e && saneAt(e.at) > callStartedAt();
}
function flushMeta() {
  if (deferring()) return;
  writeTexts();
  writeMeta();
  writeHealth();
  writeDocs();
}
function writeMeta() {
  const m = metaCache;
  if (!m || !m.dirty) return;
  const stored = readMeta();
  const now = Date.now();
  for (const t2 of m.touched) {
    const kind = t2.slice(0, 1), id = t2.slice(2);
    const mine = m.value[kind][id], theirs = stored[kind][id];
    if (!mine) continue;
    if (theirs && saneAt(theirs.at, now) > saneAt(mine.at, now)) continue;
    stored[kind][id] = mine;
  }
  for (const kind of ["c", "l"]) {
    for (const id of Object.keys(stored[kind])) {
      const e = stored[kind][id];
      const age = now - Math.max(saneAt(e.at, now), saneAt(e.failAt, now));
      if (age > MAX_TTL_MS || kind === "l" && !e.h && age > TOMBSTONE_MS) delete stored[kind][id];
    }
  }
  setJson(LM_KEY, stored);
  m.value = stored;
  m.touched = /* @__PURE__ */ new Set();
  m.dirty = false;
}
function registry() {
  const seq2 = callSeq();
  if (!regCache || regCache.seq !== seq2) {
    const r = getJson(LC_KEY);
    regCache = { seq: seq2, value: r && typeof r === "object" && r.src && typeof r.src === "object" ? r.src : {} };
  }
  return regCache.value;
}
function catsOf(src) {
  const e = registry()[src];
  if (!e || !Array.isArray(e.cats)) return null;
  const c = meta().value.c[src] || {};
  return { cats: e.cats, at: Math.max(saneAt(e.at), saneAt(c.at)), failAt: saneAt(c.failAt), failN: Number(c.failN) || 0 };
}
function catsFailAt(src) {
  const c = meta().value.c[src];
  return c ? saneAt(c.failAt) : 0;
}
function catsFailN(src) {
  const c = meta().value.c[src];
  return c && c.v === PLUGIN_VERSION ? Math.max(0, Number(c.failN) || 0) : c && saneAt(c.failAt) ? 1 : 0;
}
function catsBackoffMs(failN) {
  return CATS_BACKOFF_MS[Math.min(Math.max(Number(failN) || 1, 1), CATS_BACKOFF_MS.length) - 1];
}
function catsInBackoff(src, now) {
  const t2 = now || Date.now();
  const f = saneAt(catsFailAt(src), t2);
  return !!f && t2 - f < catsBackoffMs(catsFailN(src));
}
function setCats(src, cats) {
  const now = Date.now();
  if (newerElsewhere("c", src)) {
    log8(src + ": categories skipped (a newer write exists)");
    return false;
  }
  const stored = getJson(LC_KEY);
  const all = stored && typeof stored === "object" && stored.src && typeof stored.src === "object" ? stored.src : {};
  const before = all[src];
  const same2 = before && JSON.stringify(before.cats) === JSON.stringify(cats);
  if (!same2) {
    all[src] = { at: now, cats };
    setJson(LC_KEY, { v: 1, src: all });
    regCache = { seq: callSeq(), value: all };
  }
  touch("c", src, { at: now, failAt: 0, failN: 0 });
  return !same2;
}
function failCats(src) {
  const c = meta().value.c[src] || {};
  const n = (c.v === PLUGIN_VERSION ? Math.max(0, Number(c.failN) || 0) : 0) + 1;
  touch("c", src, { at: saneAt(c.at), failAt: Date.now(), failN: n, v: PLUGIN_VERSION });
  return catsBackoffMs(n);
}
var L02 = /* @__PURE__ */ new Map();
var l0Chars = 0;
function l0Get(key) {
  const e = L02.get(key);
  if (!e) return null;
  L02.delete(key);
  L02.set(key, e);
  return e;
}
function l0Put(key, items, chars, h) {
  const old = L02.get(key);
  if (old) {
    l0Chars -= old.chars;
    L02.delete(key);
  }
  if (chars > L0_MAX_CHARS) return;
  L02.set(key, { items, chars, h });
  l0Chars += chars;
  while (l0Chars > L0_MAX_CHARS && L02.size) {
    const [k, e] = L02.entries().next().value;
    L02.delete(k);
    l0Chars -= e.chars;
  }
}
function l0Drop(key) {
  const old = L02.get(key);
  if (old) {
    l0Chars -= old.chars;
    L02.delete(key);
  }
}
function listMeta(key) {
  const e = meta().value.l[key];
  return e ? { at: saneAt(e.at), h: String(e.h || ""), n: Number(e.n) || 0, w: saneAt(e.w), failAt: saneAt(e.failAt), failN: Number(e.failN) || 0, p: e.p === 1 } : null;
}
var LIST_TTL_FACTOR = 3;
function ttlOf(maxStaleMs) {
  const m = Number(maxStaleMs) > 0 ? Number(maxStaleMs) : MAX_TTL_MS;
  return Math.max(6e4, Math.min(MAX_TTL_MS, Math.floor(m * LIST_TTL_FACTOR)));
}
function renewDue(m, ttlMs, now) {
  return now - (m.w || 0) >= ttlMs / LIST_TTL_FACTOR;
}
function listTextEndsAt(key, maxStaleMs) {
  const m = listMeta(key);
  return m && m.h && m.w ? m.w + ttlOf(maxStaleMs) : 0;
}
var pendingTexts = /* @__PURE__ */ new Map();
function readText(key) {
  if (pendingTexts.has(key)) {
    const p = pendingTexts.get(key);
    return p ? p.text : null;
  }
  return getText(LIST_PREFIX + key);
}
function writeText(key, text2, ttlMs, h) {
  if (deferring()) {
    pendingTexts.set(key, { text: text2, ttlMs, h });
    return true;
  }
  pendingTexts.delete(key);
  return setText(LIST_PREFIX + key, text2, { ttlMs });
}
function removeText(key) {
  if (deferring()) {
    pendingTexts.set(key, null);
    return;
  }
  pendingTexts.delete(key);
  remove(LIST_PREFIX + key);
}
function writeTexts() {
  if (!pendingTexts.size) return;
  const m = metaCache;
  const stored = readMeta();
  const now = Date.now();
  for (const [key, p] of pendingTexts) {
    const mine = m && m.value.l[key], theirs = stored.l[key];
    if (!mine || theirs && saneAt(theirs.at, now) > saneAt(mine.at, now)) continue;
    if (p === null) {
      if (!mine.h || !mine.w) remove(LIST_PREFIX + key);
      continue;
    }
    if (mine.h !== p.h) continue;
    if (setText(LIST_PREFIX + key, p.text, { ttlMs: p.ttlMs })) continue;
    log8(key + ": list not stored (" + p.text.length + " chars), kept in memory only");
    remove(LIST_PREFIX + key);
    if (mine.w) {
      m.value.l[key] = { ...mine, w: 0 };
      m.touched.add("l:" + key);
      m.dirty = true;
    }
  }
  pendingTexts.clear();
}
function getList(key) {
  const m = listMeta(key);
  const hit = l0Get(key);
  if (hit && (!m || !m.h || m.h === hit.h)) return { items: hit.items, at: m ? m.at : 0, h: hit.h };
  const text2 = readText(key);
  if (text2 === null) {
    l0Drop(key);
    return null;
  }
  let items;
  try {
    items = JSON.parse(text2);
  } catch (_) {
    items = null;
  }
  if (!Array.isArray(items)) return null;
  const h = m && m.h || sha1(text2);
  l0Put(key, items, text2.length, h);
  return { items, at: m ? m.at : 0, h };
}
function putList(key, items, opts) {
  const o = opts || {};
  const now = Date.now();
  const at2 = o.partial ? Math.max(1, now - Math.max(0, Number(o.freshMs) || 0) - 1) : now;
  const text2 = JSON.stringify(items);
  const h = sha1(text2);
  const m = listMeta(key);
  if (newerElsewhere("l", key)) {
    const cur = getList(key);
    if (cur) {
      log8(key + ": list skipped (a newer write exists)");
      return { ...cur, changed: false };
    }
  }
  const ttlMs = ttlOf(o.maxStaleMs);
  const l0 = L02.get(key);
  const have = m && m.h === h && (l0 && l0.h === h || readText(key) !== null);
  let w = m ? m.w : 0;
  if (!have || renewDue(m, ttlMs, now)) {
    if (writeText(key, text2, ttlMs, h)) w = now;
    else {
      log8(key + ": list not stored (" + text2.length + " chars), kept in memory only");
      if (!have) {
        removeText(key);
        w = 0;
      }
    }
  }
  l0Put(key, items, text2.length, h);
  touch("l", key, { at: at2, h, n: items.length, w, failAt: 0, failN: 0, ...o.partial ? { p: 1 } : {} });
  return { items, h, at: at2, changed: !have };
}
function touchList(key, opts) {
  const m = listMeta(key);
  if (!m) return false;
  const now = Date.now();
  let w = m.w;
  if (opts && opts.maxStaleMs > 0) {
    const ttlMs = ttlOf(opts.maxStaleMs);
    if (renewDue(m, ttlMs, now)) {
      const text2 = readText(key);
      if (text2 !== null && writeText(key, text2, ttlMs, m.h)) w = now;
    }
  }
  touch("l", key, { at: now, h: m.h, n: m.n, w, failAt: 0, failN: 0 });
  return true;
}
function failList(key) {
  const m = listMeta(key) || { at: 0, h: "", n: 0, w: 0, failN: 0 };
  touch("l", key, { at: m.at, h: m.h, n: m.n, w: m.w, failAt: Date.now(), failN: (m.failN || 0) + 1, ...m.p ? { p: 1 } : {} });
}
function inBackoff2(failAt, now) {
  const t2 = now || Date.now();
  const f = saneAt(failAt, t2);
  return !!f && t2 - f < FAIL_BACKOFF_MS;
}
function dropLists(src) {
  const now = Date.now();
  let n = 0;
  dropped.set(src, callSeq());
  for (const key of listKeysOf(src)) {
    removeText(key);
    l0Drop(key);
    touch("l", key, { at: now, h: "", n: 0, w: 0, failAt: 0, failN: 0 });
    n++;
  }
  if (n) log8(src + ": dropped " + n + " stored lists");
  return n;
}
function listKeysOf(src) {
  const prefix = src + ".";
  return Object.keys(meta().value.l).filter((k) => k.startsWith(prefix) && meta().value.l[k].h);
}
var dropped = /* @__PURE__ */ new Map();
function droppedThisCall(src) {
  return dropped.get(src) === callSeq();
}
var lastKey = null;
var resolves = /* @__PURE__ */ new Map();
var RESOLVES_MAX = 64;
function lastResolveOf(key) {
  const r = resolves.get(key);
  return r ? { ...r, consecutive: lastKey === key } : null;
}
function markResolved(key, member, streak) {
  resolves.delete(key);
  resolves.set(key, { endedAt: Date.now(), member: member || null, streak: Math.max(0, Number(streak) || 0) });
  while (resolves.size > RESOLVES_MAX) resolves.delete(resolves.keys().next().value);
  lastKey = key;
}
var LH_KEY = "o2:lh";
var MIN3 = 60 * 1e3;
var HOUR2 = 60 * MIN3;
var DAY = 24 * HOUR2;
var LH_TTL_MS = 7 * DAY;
var SOURCE_KEEP_MS = 7 * DAY;
var PROBE_OK_KEEP_MS = 2 * HOUR2;
var MAX_DEMOTE_MS = HOUR2;
var REDIRECT_KEEP_MS = 6 * HOUR2;
var SOURCES_MAX = 40;
var MEMBERS_MAX = 400;
var REDIRECTS_MAX = 64;
var SAMPLES_MAX = 8;
function hk(s) {
  const t2 = String(s);
  let a = 5381, b = 52711;
  for (let i = 0; i < t2.length; i++) {
    const c = t2.charCodeAt(i);
    a = (a * 33 ^ c) >>> 0;
    b = (b * 31 ^ c) >>> 0;
  }
  return a.toString(36) + "." + b.toString(36);
}
var isMap = (x) => !!x && typeof x === "object" && !Array.isArray(x);
var lh = null;
function readHealth() {
  const v = getJson(LH_KEY);
  return isMap(v) && isMap(v.s) && isMap(v.m) && isMap(v.r) ? v : { v: 1, s: {}, m: {}, r: {} };
}
function health() {
  if (!lh) lh = { value: readHealth(), dirty: false };
  return lh.value;
}
function changed() {
  if (lh) lh.dirty = true;
}
function capMap(obj, max) {
  const keys2 = Object.keys(obj);
  for (let i = 0; i < keys2.length - max; i++) delete obj[keys2[i]];
}
function sourceStats(src) {
  const e = health().s[src] || {};
  return {
    at: saneAt(e.at),
    ms: Math.max(0, Number(e.ms) || 0),
    n: Math.max(0, Number(e.n) || 0),
    ok: saneAt(e.ok),
    f: saneAt(e.f),
    fn: Math.max(0, Number(e.fn) || 0)
  };
}
function putSource(src, e) {
  const s = health().s;
  delete s[src];
  s[src] = { ...e, t: Date.now() };
  capMap(s, SOURCES_MAX);
  changed();
}
function sampled(e, ms) {
  const n = Math.max(0, Number(e.n) || 0);
  const v = Math.max(0, Math.round(Number(ms) || 0));
  return { ms: n ? Math.round(0.6 * (Number(e.ms) || 0) + 0.4 * v) : v, n: Math.min(SAMPLES_MAX, n + 1), at: Date.now() };
}
function noteAnswer(src, ms) {
  const e = health().s[src] || {};
  putSource(src, { ...e, ...sampled(e, ms), ok: Date.now(), fn: 0 });
}
function noteSlow(src, ms) {
  const e = health().s[src] || {};
  putSource(src, { ...e, ...sampled(e, ms) });
}
function noteFailure(src) {
  const e = health().s[src] || {};
  putSource(src, { ...e, f: Date.now(), fn: Math.max(0, Number(e.fn) || 0) + 1 });
}
function memberEntry(member) {
  return health().m[hk(member)] || null;
}
function putMember(member, e) {
  const m = health().m;
  const k = hk(member);
  delete m[k];
  m[k] = { ...e, t: Date.now() };
  capMap(m, MEMBERS_MAX);
  changed();
}
function demote(member, ms) {
  const now = Date.now();
  putMember(member, { ...memberEntry(member) || {}, ok: 0, d: now, u: now + Math.max(0, Math.min(MAX_DEMOTE_MS, Number(ms) || 0)) });
}
function demotedAt(member) {
  const e = memberEntry(member);
  const d = e ? saneAt(e.d) : 0;
  if (!d) return 0;
  return Date.now() < Math.min(Number(e.u) || 0, d + MAX_DEMOTE_MS) ? d : 0;
}
function noteProbeOk(member) {
  putMember(member, { ...memberEntry(member) || {}, ok: Date.now() });
}
function probeOkAt(member) {
  const e = memberEntry(member);
  const ok = e ? saneAt(e.ok) : 0;
  return ok && Date.now() - ok < PROBE_OK_KEEP_MS ? ok : 0;
}
function noteRedirectingScope(scope) {
  if (!scope) return;
  const r = health().r;
  const k = hk(scope);
  delete r[k];
  r[k] = Date.now();
  capMap(r, REDIRECTS_MAX);
  changed();
}
function isRedirectingScope(scope) {
  if (!scope) return false;
  const at2 = saneAt(health().r[hk(scope)]);
  return !!at2 && Date.now() - at2 < REDIRECT_KEEP_MS;
}
function pruneHealth(h, now) {
  for (const id of Object.keys(h.s)) if (now - saneAt(h.s[id] && h.s[id].t, now) > SOURCE_KEEP_MS) delete h.s[id];
  for (const id of Object.keys(h.m)) {
    const e = h.m[id] || {};
    const ok = saneAt(e.ok, now), d = saneAt(e.d, now);
    const until = d ? Math.min(Number(e.u) || 0, d + MAX_DEMOTE_MS) : 0;
    if (!(ok && now - ok < PROBE_OK_KEEP_MS) && !(until > now)) delete h.m[id];
  }
  for (const id of Object.keys(h.r)) {
    const at2 = saneAt(h.r[id], now);
    if (!at2 || now - at2 >= REDIRECT_KEEP_MS) delete h.r[id];
  }
  capMap(h.s, SOURCES_MAX);
  capMap(h.m, MEMBERS_MAX);
  capMap(h.r, REDIRECTS_MAX);
}
function writeHealth() {
  if (!lh || !lh.dirty) return;
  const now = Date.now();
  const stored = readHealth();
  const mine = lh.value;
  for (const kind of ["s", "m"]) {
    for (const id of Object.keys(mine[kind])) {
      const a = mine[kind][id], b = stored[kind][id];
      if (!isMap(b) || saneAt(b.t, now) <= saneAt(a && a.t, now)) stored[kind][id] = a;
    }
  }
  for (const id of Object.keys(mine.r)) stored.r[id] = Math.max(saneAt(stored.r[id], now), saneAt(mine.r[id], now));
  pruneHealth(stored, now);
  setJson(LH_KEY, stored, { ttlMs: LH_TTL_MS });
  lh.value = stored;
  lh.dirty = false;
}
var docs = /* @__PURE__ */ new Map();
function doc(key) {
  let d = docs.get(key);
  if (!d) {
    const v = getJson(key);
    d = { value: isMap(v) ? v : {}, dirty: false, ttlMs: 0 };
    docs.set(key, d);
  }
  return d.value;
}
function saveDoc(key, ttlMs) {
  const d = docs.get(key);
  if (!d) return;
  d.dirty = true;
  d.ttlMs = Number(ttlMs) > 0 ? Number(ttlMs) : 0;
}
function writeDocs() {
  for (const [key, d] of docs) {
    if (!d.dirty) continue;
    if (Object.keys(d.value).length) setJson(key, d.value, d.ttlMs ? { ttlMs: d.ttlMs } : void 0);
    else remove(key);
    d.dirty = false;
  }
}
var firstPages = /* @__PURE__ */ new Map();
function firstPageAt(categoryId) {
  return firstPages.get(categoryId) || 0;
}
function markFirstPage(categoryId) {
  firstPages.set(categoryId, Date.now());
}

// src/liveTitles.js
var fold4 = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var STRONG = "\u2503\u2502\u258E\u258D\u258C\u258F\u2590\u2595\u2016\u254E\u2506\u250A\u2551\u2758\u2759\u275A";
var WEAK = "|\xA6\uFF5C";
var BARS = STRONG + WEAK;
var CODES2 = {
  co: "co",
  col: "co",
  mx: "mx",
  mex: "mx",
  pe: "pe",
  cl: "cl",
  ec: "ec",
  ecu: "ec",
  ve: "ve",
  ven: "ve",
  bo: "bo",
  bol: "bo",
  py: "py",
  uy: "uy",
  uru: "uy",
  cr: "cr",
  pa: "pa",
  pan: "pa",
  ni: "ni",
  nic: "ni",
  hn: "hn",
  gt: "gt",
  gua: "gt",
  sv: "sv",
  do: "do",
  rd: "do",
  pr: "pr",
  cu: "cu",
  us: "us",
  usa: "us",
  eeuu: "us",
  es: "es",
  esp: "es",
  br: "br",
  bra: "br",
  pt: "pt",
  it: "it",
  ita: "it",
  fr: "fr",
  fra: "fr",
  de: "de",
  ger: "de",
  nl: "nl",
  uk: "gb",
  gb: "gb",
  ar: "ar",
  arg: "ar",
  ca: "ca",
  can: "ca",
  be: "be",
  ch: "ch",
  at: "at",
  pl: "pl",
  tr: "tr",
  gr: "gr",
  ru: "ru",
  se: "se",
  dk: "dk",
  no: "no",
  fi: "fi",
  ie: "ie",
  au: "au",
  hr: "hr",
  rs: "rs",
  sr: "rs",
  srb: "rs",
  si: "si",
  sl: "si",
  ba: "ba",
  bih: "ba",
  bg: "bg",
  al: "al",
  mk: "mk",
  ro: "ro",
  hu: "hu",
  cz: "cz",
  sk: "sk",
  lat: "latam",
  latam: "latam",
  latino: "latam",
  latin: "latam",
  ucl: "eu",
  uefa: "eu",
  eu: "eu"
};
var NEUTRAL = /* @__PURE__ */ new Set(["latam", "eu"]);
var UNNAMED = /* @__PURE__ */ new Set(["ar", "ca"]);
var QUALITY = /* @__PURE__ */ new Set(["hd", "sd", "fhd", "uhd", "4k", "8k", "hq", "lq", "2160p", "1080p", "720p", "480p", "auto", "hevc", "h265"]);
var GROUPS = /* @__PURE__ */ new Set(["multi", "vip", "ppv", "f1"]);
var NOT_TAGS = /* @__PURE__ */ new Set(["tv"]);
var COUNTRY_NAMES = {
  co: ["Colombia", "Colombia"],
  mx: ["M\xE9xico", "Mexico"],
  pe: ["Per\xFA", "Peru"],
  cl: ["Chile", "Chile"],
  ec: ["Ecuador", "Ecuador"],
  ve: ["Venezuela", "Venezuela"],
  bo: ["Bolivia", "Bolivia"],
  py: ["Paraguay", "Paraguay"],
  uy: ["Uruguay", "Uruguay"],
  cr: ["Costa Rica", "Costa Rica"],
  pa: ["Panam\xE1", "Panama"],
  ni: ["Nicaragua", "Nicaragua"],
  hn: ["Honduras", "Honduras"],
  gt: ["Guatemala", "Guatemala"],
  sv: ["El Salvador", "El Salvador"],
  do: ["Rep\xFAblica Dominicana", "Dominican Republic"],
  pr: ["Puerto Rico", "Puerto Rico"],
  cu: ["Cuba", "Cuba"],
  us: ["Estados Unidos", "United States"],
  es: ["Espa\xF1a", "Spain"],
  br: ["Brasil", "Brazil"],
  pt: ["Portugal", "Portugal"],
  it: ["Italia", "Italy"],
  fr: ["Francia", "France"],
  de: ["Alemania", "Germany"],
  nl: ["Pa\xEDses Bajos", "Netherlands"],
  gb: ["Reino Unido", "United Kingdom"],
  be: ["B\xE9lgica", "Belgium"],
  ch: ["Suiza", "Switzerland"],
  at: ["Austria", "Austria"],
  pl: ["Polonia", "Poland"],
  tr: ["Turqu\xEDa", "Turkey"],
  gr: ["Grecia", "Greece"],
  ru: ["Rusia", "Russia"],
  se: ["Suecia", "Sweden"],
  dk: ["Dinamarca", "Denmark"],
  no: ["Noruega", "Norway"],
  fi: ["Finlandia", "Finland"],
  ie: ["Irlanda", "Ireland"],
  au: ["Australia", "Australia"],
  hr: ["Croacia", "Croatia"],
  rs: ["Serbia", "Serbia"],
  si: ["Eslovenia", "Slovenia"],
  ba: ["Bosnia", "Bosnia"],
  bg: ["Bulgaria", "Bulgaria"],
  al: ["Albania", "Albania"],
  mk: ["Macedonia del Norte", "North Macedonia"],
  ro: ["Rumania", "Romania"],
  hu: ["Hungr\xEDa", "Hungary"],
  cz: ["Chequia", "Czechia"],
  sk: ["Eslovaquia", "Slovakia"]
};
function tagOf(token, strong) {
  const raw = String(token || "").trim();
  const k = raw.toLowerCase().replace(/[.\s]/g, "");
  if (!k) return null;
  if (QUALITY.has(k)) return { tag: true };
  if (/[a-z]/.test(raw)) return null;
  if (CODES2[k]) return { iso: CODES2[k] };
  if (GROUPS.has(k)) return { tag: true };
  if (strong && /^[A-Z]{2,6}$/.test(raw) && !NOT_TAGS.has(k)) return { tag: true };
  return null;
}
var esc = (s) => s.replace(/[\\\]^-]/g, "\\$&");
var B2 = "[" + esc(BARS) + "]";
var TOK = "([A-Za-z0-9][A-Za-z0-9.+&]{0,7})";
var WRAPPED = new RegExp("(" + B2 + "|!)\\s*" + TOK + "\\s*(" + B2 + "|!)", "gu");
var LEAD_BAR = new RegExp("^\\s*[[(]?\\s*" + TOK + "\\s*[\\])]?\\s*(" + B2 + ")\\s*(?=\\S)", "u");
var LEAD_WRAPPED = new RegExp("^\\s*(" + B2 + "|!)\\s*" + TOK + "\\s*(" + B2 + "|!)\\s*(?=\\S)", "u");
var OPENS_WRAP = new RegExp("^[A-Za-z0-9][A-Za-z0-9.+&]{0,7}\\s*(?:" + B2 + "|!)", "u");
var LEAD_MARK = /^\s*([A-Z][A-Z.]{1,5})\s*(?:[:•·]\s*|\s[-–—]\s+)(?=\S)/u;
var LEAD_BRACKET = new RegExp("^\\s*[[(]\\s*([A-Za-z][A-Za-z. ]{1,6}?)\\s*[\\])]\\s*(?:(?:" + B2 + "|[:\u2022\xB7]|[-\u2013\u2014](?=\\s))\\s*)?(?=\\S)", "u");
var TRAIL_BAR = new RegExp("\\s*(" + B2 + ")\\s*([A-Z][A-Z.]{1,5})\\s*(?:" + B2 + ")?\\s*$", "u");
var BRACKETED = /\s*[[(]\s*([A-Za-z0-9][A-Za-z0-9. ]{0,6}?)\s*[\])]/gu;
var EDGE_START = new RegExp("^\\s*(?:" + B2 + "\\s*|[-\u2013\u2014\u2022\xB7:]\\s+)+", "u");
var EDGE_END = new RegExp("(?:\\s*" + B2 + "|\\s+[-\u2013\u2014\u2022\xB7])+\\s*$", "u");
var MAYBE = new RegExp("[" + esc(BARS) + "!\\[(:\u2022\xB7\u2013\u2014-]", "u");
var CACHE_MAX2 = 2e4;
var cache2 = /* @__PURE__ */ new Map();
function strip(title, cc, brackets) {
  if (!MAYBE.test(title)) return { text: title, lead: null };
  const ck = (cc || "") + (brackets ? "" : "") + title;
  const hit = cache2.get(ck);
  if (hit) return hit;
  if (cache2.size >= CACHE_MAX2) cache2.clear();
  const out = parse(title, cc, brackets);
  cache2.set(ck, out);
  return out;
}
function parse(title, cc, brackets) {
  let s = String(title);
  let lead = null, changed2 = false;
  const went = (t2) => {
    if (t2.iso && t2.iso !== cc && !NEUTRAL.has(t2.iso) && !UNNAMED.has(t2.iso) && !lead) lead = t2.iso;
    changed2 = true;
  };
  const strongBar = (b) => STRONG.includes(b);
  for (let i = 0; i < 4; i++) {
    const before = s;
    let m = LEAD_WRAPPED.exec(s);
    let t2 = m && tagOf(m[2], strongBar(m[1]) && strongBar(m[3]));
    if (t2) {
      went(t2);
      s = s.slice(m[0].length);
    }
    m = LEAD_BAR.exec(s);
    const rest = m ? s.slice(m[0].length) : "";
    t2 = m && (tagOf(m[1], false) || !OPENS_WRAP.test(rest) && /\p{L}{2}/u.test(rest) && !tagOf(rest, false) && tagOf(m[1], strongBar(m[2])));
    if (t2) {
      went(t2);
      s = rest;
    }
    m = LEAD_BRACKET.exec(s);
    t2 = m && tagOf(m[1], false);
    if (t2) {
      went(t2);
      s = s.slice(m[0].length);
    }
    m = LEAD_MARK.exec(s);
    t2 = m && tagOf(m[1], false);
    if (t2 && t2.iso) {
      went(t2);
      s = s.slice(m[0].length);
    }
    if (s === before) break;
  }
  s = s.replace(WRAPPED, (all, b1, tok, b2) => {
    const t2 = tagOf(tok, strongBar(b1) && strongBar(b2));
    if (!t2) return all;
    went(t2);
    return " ";
  });
  const tm = TRAIL_BAR.exec(s);
  const tt = tm && tm.index > 0 && tagOf(tm[2], false);
  if (tt && tt.iso) {
    went(tt);
    s = s.slice(0, tm.index);
  }
  if (brackets) {
    s = s.replace(BRACKETED, (all, tok) => {
      const t2 = tagOf(tok, false);
      if (!t2 || t2.iso && cc && t2.iso !== cc && !NEUTRAL.has(t2.iso)) return all;
      changed2 = true;
      return " ";
    });
  }
  if (!changed2) return { text: String(title), lead: null };
  s = s.replace(/\s+/g, " ").replace(EDGE_START, "").replace(EDGE_END, "").trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return { text: String(title), lead: null };
  return { text: s, lead };
}
var suffix = (iso, en6) => " \xB7 " + COUNTRY_NAMES[iso][en6 ? 1 : 0];
function forms(b, o, brackets) {
  const r = strip(b, o.cc, brackets);
  return { text: r.text, named: r.lead && COUNTRY_NAMES[r.lead] ? r.text + suffix(r.lead, o.en) : "" };
}
function head(title, o) {
  const f = forms(o.copies ? o.copies(title) : title, o, true);
  return o.cc && f.named ? f.named : f.text;
}
function candidates(title, o) {
  const out = [];
  const add = (t2) => {
    if (t2 && !out.includes(t2)) out.push(t2);
  };
  for (const b of o.copies ? [o.copies(title), title] : [title]) {
    for (const brackets of [true, false]) {
      const f = forms(b, o, brackets);
      if (!(o.cc && f.named)) add(f.text);
      add(f.named);
    }
  }
  add(title);
  return out;
}
var sameKey = (t2) => (/^[\x20-\x7e]*$/.test(t2) ? t2.toLowerCase() : fold4(t2)).replace(/\s+/g, " ").trim();
function shownTitles(items, opts) {
  const o = { cc: opts && opts.cc || null, en: !!(opts && opts.en), copies: opts && typeof opts.copies === "function" ? opts.copies : null };
  const list = Array.isArray(items) ? items : [];
  const titles = list.map((c) => String(c && c.title != null ? c.title : ""));
  const first = titles.map((t2) => head(t2, o));
  const cands = list.map(() => null);
  const level = list.map(() => 0);
  const shownOf = (i) => cands[i] ? cands[i][level[i]] : first[i];
  const keys2 = first.map(sameKey);
  const stored = titles.map(sameKey);
  for (let round = 0; round < 10; round++) {
    const n = /* @__PURE__ */ new Map();
    for (let i = 0; i < keys2.length; i++) {
      let g = n.get(keys2[i]);
      if (!g) n.set(keys2[i], g = /* @__PURE__ */ new Set());
      g.add(stored[i]);
    }
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      if (n.get(keys2[i]).size < 2) continue;
      if (!cands[i]) cands[i] = candidates(titles[i], o);
      if (level[i] < cands[i].length - 1) {
        level[i]++;
        keys2[i] = sameKey(shownOf(i));
        moved = true;
      }
    }
    if (!moved) break;
  }
  return list.map((c, i) => {
    const t2 = shownOf(i);
    return t2 === titles[i] ? c : { ...c, title: t2 };
  });
}

// src/liveMerge.js
var MERGED_REF_MAX = 1400;
var MEMBER_REF_MAX = 512;
var SAME_SOURCE_START_MS = 60 * 1e3;
var CROSS_SOURCE_START_MS = 15 * 60 * 1e3;
var EVENT_OVER_AFTER_END_MS = 30 * 60 * 1e3;
var EVENT_OVER_AFTER_START_MS = 14 * 60 * 60 * 1e3;
var fold5 = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
var CODES3 = {
  co: "co",
  col: "co",
  mx: "mx",
  mex: "mx",
  pe: "pe",
  cl: "cl",
  ec: "ec",
  ecu: "ec",
  ve: "ve",
  ven: "ve",
  bo: "bo",
  bol: "bo",
  py: "py",
  uy: "uy",
  uru: "uy",
  cr: "cr",
  pa: "pa",
  pan: "pa",
  ni: "ni",
  nic: "ni",
  hn: "hn",
  gt: "gt",
  gua: "gt",
  sv: "sv",
  do: "do",
  rd: "do",
  pr: "pr",
  cu: "cu",
  us: "us",
  usa: "us",
  eeuu: "us",
  es: "es",
  esp: "es",
  br: "br",
  bra: "br",
  pt: "pt",
  it: "it",
  ita: "it",
  fr: "fr",
  fra: "fr",
  de: "de",
  ger: "de",
  nl: "nl",
  uk: "gb",
  gb: "gb",
  ar: "ar",
  arg: "ar",
  ca: "ca",
  can: "ca",
  lat: "latam",
  latam: "latam",
  latino: "latam",
  latin: "latam",
  ucl: "eu",
  uefa: "eu",
  eu: "eu"
};
var NEUTRAL2 = /* @__PURE__ */ new Set(["latam"]);
var NAMES2 = {
  co: "colombia",
  mx: "mexico",
  ar: "argentina",
  pe: "peru",
  cl: "chile",
  ec: "ecuador",
  ve: "venezuela",
  bo: "bolivia",
  py: "paraguay",
  uy: "uruguay",
  cr: "costa rica",
  pa: "panama",
  ni: "nicaragua",
  hn: "honduras",
  gt: "guatemala",
  sv: "el salvador",
  do: "republica dominicana",
  pr: "puerto rico",
  cu: "cuba",
  us: "usa|estados unidos|united states",
  es: "espana|spain",
  br: "brasil|brazil",
  pt: "portugal",
  it: "italia|italy",
  fr: "francia|france",
  de: "alemania|germany",
  gb: "reino unido|uk|united kingdom",
  ca: "canada"
};
var BARE_CODES = {
  co: "co",
  col: "co",
  mx: "mx",
  mex: "mx",
  pe: "pe",
  cl: "cl",
  ec: "ec",
  ecu: "ec",
  ve: "ve",
  ven: "ve",
  bo: "bo",
  bol: "bo",
  py: "py",
  uy: "uy",
  uru: "uy",
  cr: "cr",
  pa: "pa",
  pan: "pa",
  ni: "ni",
  nic: "ni",
  hn: "hn",
  gt: "gt",
  gua: "gt",
  sv: "sv",
  do: "do",
  rd: "do",
  pr: "pr",
  cu: "cu",
  us: "us",
  usa: "us",
  eeuu: "us",
  es: "es",
  esp: "es",
  br: "br",
  bra: "br",
  pt: "pt",
  it: "it",
  ita: "it",
  fr: "fr",
  fra: "fr",
  de: "de",
  ger: "de",
  uk: "gb",
  gb: "gb",
  arg: "ar"
};
var ALIASES = [
  [/^directv sports\b/, "dsports"],
  [/^win sports plus\b/, "win plus"],
  [/^l 1 max$/, "liga 1 max"],
  [/^dazn liga\b/, "dazn laliga"],
  [/^r madrid\b/, "real madrid"]
];
var LALIGA_TV = /\bla ?liga tv (?=[a-z0-9])/g;
var MPLUS_ES = [[/^movistar(?: plus)*\b/, "m plus"], [/^m (?!plus\b)(?=[a-z])/, "m plus "]];
var LEAD = /^\s*[[(┃|]?\s*([a-z]{2,6})\s*[┃▎|:\]]\s*/;
var TRAIL = /\s*[[(|-]\s*([a-z]{2,6})\s*[\])]?\s*$/;
var COPY = /[[(]\s*(?:opc(?:ion)?|option|op|alt|alterno|backup|respaldo|bk)\.?\s*\d*\s*[\])]|\bopc\.?\s*\d+\b|[[(]\s*v\d\s*[\])]|\(\s*\d\s*\)\s*$|[[(][^\])]*\brepuesto[^\])]*[\])]|\b(?:repuesto|alternativ[ao])\b(?!\s*\d)/g;
var SHOWN_COPY = /\s*[[(]\s*(?:opc(?:i[oó]n)?|option|op|alt|alterno|backup|respaldo|bk)\.?\s*\d*\s*[\])]|\s*[[(][^\])]*\brepuesto[^\])]*[\])]|\s*\(\s*\d\s*\)\s*$/giu;
var NOISE = /[[(]\s*(?:not?\s*24\s*[/.]?\s*7?|24\s*[/.]\s*7|geo\s*-?\s*blocked|inestable|unstable|twitch|dailymotion|youtube|web|nacional|national|1080p?|720p?|480p?|auto|fhd|uhd|hd|sd|4k|hq|lq|low|en vivo|live)\s*[\])]/g;
var QUAL = /\b(?:fhd|uhd|hd|sd|4k|hq|1080p?|720p?|480p?|h\.?265|hevc)\b/g;
var SLOT = /\bvs?\.?\s|\s@\s|\b\d{1,2}[:.h]\d{2}\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b|\b(?:ppv|event|evento|epl|ucl|uel|mls|nfl|nba|nhl|mlb|ufc|match|game|partido)\s*\d{1,3}\s*(?::|$)/;
var GENERIC_NUMBER = /^(?:canal|tv|tele|television|channel)? ?\d+$/;
var SEC_SLOT = /\b(?:eventos?|events?|ppv|alternativ[ao]s?|backup|respaldo|extra|replay)\s*\d{1,3}\b|\bsolo (?:eventos|funciona)\b/;
var SEC_PER_GROUP = 2;
function isSlotTitle(title) {
  const t2 = fold5(title).replace(/\b24\s*[/.]\s*7\b/g, "247").replace(/\s+/g, " ").trim();
  return SLOT.test(t2 + " ") || /\bvs\b/.test(t2);
}
function isSecondarySlot(title) {
  return isSlotTitle(title) || SEC_SLOT.test(fold5(title));
}
var keyCache = /* @__PURE__ */ new Map();
var KEY_CACHE_MAX = 2e4;
function mergeKey(title, cc) {
  const ck = (cc || "") + "" + String(title);
  const hit = keyCache.get(ck);
  if (hit !== void 0) return hit;
  if (keyCache.size >= KEY_CACHE_MAX) keyCache.clear();
  const k = buildKey(String(title == null ? "" : title), cc || null);
  keyCache.set(ck, k);
  return k;
}
function buildKey(title, cc) {
  const tokens = [];
  const regionToken = (code) => {
    const c = CODES3[code];
    if (!c) return false;
    if (c !== cc && !NEUTRAL2.has(c)) tokens.push("@" + c);
    return true;
  };
  const flag = flagCountry(title);
  if (flag && flag !== cc) tokens.push("@" + (CODES3[flag] || flag));
  let s = fold5(title).replace(/[\u{1F1E6}-\u{1F1FF}]/gu, " ");
  const lead = LEAD.exec(s);
  if (lead && regionToken(lead[1])) s = s.slice(lead[0].length);
  s = s.replace(/[▎┃◉•·]/g, " ");
  for (let i = 0; i < 2; i++) s = s.replace(COPY, " ").replace(NOISE, " ");
  if (cc && NAMES2[cc]) s = s.replace(new RegExp("[[(]\\s*(?:" + NAMES2[cc] + "|" + cc + ")\\s*[\\])]", "g"), " ");
  s = s.replace(/\s+/g, " ").trim();
  const trail = TRAIL.exec(s);
  if (trail && s.length > trail[0].length && regionToken(trail[1])) s = s.slice(0, s.length - trail[0].length);
  s = s.replace(QUAL, " ").replace(/\+/g, " plus ").replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2");
  s = s.replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  s = bareCountry(s, cc);
  const m = /^(.{3,}?) (?:tv|television|channel)$/.exec(s);
  if (m && /[a-z].*[a-z]/.test(m[1])) s = m[1];
  if (cc === "es") for (const [re, to] of MPLUS_ES) s = s.replace(re, to);
  s = s.replace(LALIGA_TV, "laliga ");
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  if (s.length < 2 || !/[a-z]/.test(s)) return "";
  const flat = s.replace(/(\d) (?=\d)/g, "$1.").replace(/ /g, "");
  return tokens.length ? flat + " " + tokens.sort().join(" ") : flat;
}
function bareCountry(s, cc) {
  const words = s.split(" ");
  if (words.length < 2) return s;
  let country2 = null, cut = 0;
  const last = words[words.length - 1];
  if (BARE_CODES[last]) {
    country2 = BARE_CODES[last];
    cut = 1;
  } else {
    for (const [code, names] of Object.entries(NAMES2)) {
      for (const name of names.split("|")) {
        const n = name.split(" ").length;
        if (words.length > n && words.slice(-n).join(" ") === name) {
          country2 = code;
          cut = n;
          break;
        }
      }
      if (country2) break;
    }
  }
  if (!country2 || !NAMES2[country2]) return s;
  const head2 = words.slice(0, words.length - cut).join(" ");
  if (head2.length < 2 || !/[a-z]/.test(head2)) return s;
  if (country2 === cc) return head2;
  return head2 + " " + NAMES2[country2].split("|")[0];
}
function qualityOf(title) {
  const t2 = fold5(title);
  if (/\buhd\b|\b4k\b|2160/.test(t2)) return 4;
  if (/\bfhd\b|1080/.test(t2)) return 3;
  if (/\bhd\b|720/.test(t2)) return 2;
  if (/\bsd\b|480|\blow\b|\blq\b/.test(t2)) return 0;
  return 1;
}
function copyOf(title) {
  const t2 = fold5(title);
  const m = /\bopc(?:ion)?\.?\s*(\d{1,2})\b|\boption\s*(\d{1,2})\b|\(\s*(\d)\s*\)\s*$/.exec(t2);
  if (m) return Number(m[1] || m[2] || m[3]);
  const r = /\brepuesto\s*(\d{0,2})/.exec(t2);
  if (r) return 1 + (Number(r[1]) || 1);
  return /\balternativ[ao]\b(?!\s*\d)/.test(t2) ? 2 : 1;
}
function shownTitle(title) {
  const t2 = String(title == null ? "" : title);
  const out = t2.replace(SHOWN_COPY, "").replace(/\s+/g, " ").replace(/(?:\s*[-–|·:])+\s*$/u, "").trim();
  return out || t2;
}
function versionOf(title) {
  const m = /[[(]\s*v(\d)\s*[\])]/.exec(fold5(title));
  return m ? Number(m[1]) : 1;
}
function penaltyOf(title) {
  const t2 = fold5(title);
  return (/geo\s*-?\s*blocked/.test(t2) ? 2 : 0) + (/inestable|unstable/.test(t2) ? 1 : 0) + (/\bnot?\s*24\s*[/.]?\s*7/.test(t2) ? 1 : 0);
}
var QUALITY_LABEL = ["SD", "", "HD", "FHD", "4K"];
function memberLabel(srcName, title, en6) {
  const parts2 = [String(srcName || "").trim() || "?"];
  const q = QUALITY_LABEL[qualityOf(title)];
  if (q) parts2.push(q);
  const c = copyOf(title);
  if (c > 1) parts2.push((en6 ? "option " : "opci\xF3n ") + c);
  return parts2.join(" \xB7 ").slice(0, 48);
}
function composeMerged(memberLists, opts) {
  const o = opts || {};
  const cc = o.cc || null;
  const titles = o.titles instanceof Map ? o.titles : null;
  const now = o.now > 0 ? o.now : Date.now();
  const flat = [];
  const ids = /* @__PURE__ */ new Set();
  for (const ml of memberLists || []) {
    const mcc = ml.member && ml.member.cc ? ml.member.cc : "";
    const src = ml.member && ml.member.src ? ml.member.src : "";
    const sec = !!ml.secondary;
    for (const c of ml.items || []) {
      if (!c || !c.id || ids.has(c.id)) continue;
      if (sec && isSecondarySlot(c.title)) continue;
      ids.add(c.id);
      flat.push({ c, rank: ml.rank || 0, mcc, src, sec, pos: flat.length });
    }
  }
  if (!o.merge && !o.events) return shownTitles(flat.filter((f) => !f.sec).map((f) => f.c), { cc, en: o.en });
  const groups = /* @__PURE__ */ new Map();
  for (const f of flat) {
    const key = o.events ? eventGroupKey(f) : groupKey(f, cc);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.every((f) => f.sec)) continue;
    if (g.length === 1) {
      if (!(o.events && eventOver(g, now))) out.push({ pos: g[0].pos, item: g[0].c });
      continue;
    }
    for (const f of g) {
      f.t = f.c.title;
      f.prio = [f.rank, penaltyOf(f.t), -qualityOf(f.t), copyOf(f.t), versionOf(f.t), f.pos];
    }
    g.sort((a, b) => {
      for (let i = 0; i < a.prio.length; i++) if (a.prio[i] !== b.prio[i]) return a.prio[i] - b.prio[i];
      return 0;
    });
    for (const all of o.events ? sameEvents(g, now) : [g]) {
      if (o.events && eventOver(all, now)) continue;
      if (all.every((f) => f.sec)) continue;
      const same2 = capSecondary(all);
      if (same2.length > 1 && titles) for (const f of same2) titles.set(f.c.ref, f.t);
      splitByLength(same2).forEach((part, i) => {
        if (i > 0 && part.every((f) => f.sec)) return;
        out.push({ pos: Math.min(...part.map((f) => f.pos)), item: channelOf2(part) });
      });
    }
  }
  out.sort((a, b) => a.pos - b.pos);
  return shownTitles(out.map((x) => x.item), { cc, en: o.en, copies: shownTitle });
}
function capSecondary(g) {
  const per = /* @__PURE__ */ new Map();
  return g.filter((f) => {
    if (!f.sec) return true;
    const n = (per.get(f.src) || 0) + 1;
    per.set(f.src, n);
    return n <= SEC_PER_GROUP;
  });
}
function groupKey(f, cc) {
  const c = f.c;
  const own = "#" + c.id;
  if (typeof c.ref !== "string" || !c.ref.startsWith("L:") || c.ref.length > MEMBER_REF_MAX) return own;
  if (isSlotTitle(c.title)) return own;
  const k = mergeKey(c.title, cc);
  if (!k) return own;
  if (GENERIC_NUMBER.test(k) && !cc) return own;
  return (c.adult ? "a|" : "n|") + k + (cc ? "" : "|" + f.mcc);
}
var LIVE_TAG = /^\s*(?:live|en vivo|en directo|directo|ao vivo)\s*[:|-]\s*/;
var SLOT_PREFIX = /^(?:(?:ppv|main|event|evento|epl|ucl|uel|mls|nfl|nba|nhl|mlb|ufc|match|game|partido)\s*)+\d{1,3}\s*:\s*/;
var MATCHUP = /^(.+?)\s+(?:vs?\.?|-|at|@)\s+(.+)$/;
function eventKey2(title) {
  const t2 = fold5(title).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ").replace(/\s+/g, " ").trim();
  const parts2 = t2.split(/\s+[·—|]\s+/).map((p) => p.trim().replace(LIVE_TAG, "").replace(SLOT_PREFIX, "").trim());
  const sides = (p) => {
    const mm = MATCHUP.exec(p);
    return !!(mm && /[a-z0-9]/.test(mm[1]) && /[a-z0-9]/.test(mm[2]));
  };
  const s = parts2.find(sides) || parts2[0] || "";
  const key = s.replace(/\s(?:vs?)\.?(?=\s)/g, " vs").replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
  if (key.length < 2 || !/[a-z]/.test(key)) return { key: "", match: false };
  return { key, match: sides(s) };
}
function eventGroupKey(f) {
  const c = f.c;
  const own = "#" + c.id;
  if (typeof c.ref !== "string" || !c.ref.startsWith("L:")) return own;
  const e = eventKey2(c.title);
  if (!e.key) return own;
  f.match = e.match;
  return (c.adult ? "a|" : "n|") + e.key;
}
var originOf2 = (f) => f.src + "/" + (f.c.origin || "");
function sameEvent(a, b) {
  const sa = a.c.start || 0, sb = b.c.start || 0;
  if (originOf2(a) === originOf2(b)) return !!sa && !!sb && Math.abs(sa - sb) <= SAME_SOURCE_START_MS;
  if (sa && sb) return Math.abs(sa - sb) <= CROSS_SOURCE_START_MS;
  return !!a.match && !!b.match;
}
function startOf(ev) {
  let at2 = 0;
  for (const f of ev) if (f.c.start > 0 && (!at2 || f.c.start < at2)) at2 = f.c.start;
  return at2;
}
function eventOver(rows, now) {
  let end = 0, start = 0;
  for (const f of rows) {
    if (f.c.end > end) end = f.c.end;
    if (f.c.start > start) start = f.c.start;
  }
  if (end) return now > end + EVENT_OVER_AFTER_END_MS;
  if (start) return now > start + EVENT_OVER_AFTER_START_MS;
  return false;
}
function sameEvents(g, now) {
  const events = [];
  const loose = [];
  for (const f of g) {
    if (!f.c.start) {
      loose.push(f);
      continue;
    }
    const hit = events.find((ev) => ev.every((x) => sameEvent(x, f)));
    if (hit) hit.push(f);
    else events.push([f]);
  }
  for (const f of loose) {
    let best = null, bestGap = Infinity;
    for (const ev of events) {
      const at2 = startOf(ev);
      if (!at2 || at2 > now + CROSS_SOURCE_START_MS || eventOver(ev, now) || !ev.every((x) => sameEvent(x, f))) continue;
      if (Math.abs(now - at2) < bestGap) {
        best = ev;
        bestGap = Math.abs(now - at2);
      }
    }
    if (!best) best = events.find((ev) => !startOf(ev) && ev.every((x) => sameEvent(x, f))) || null;
    if (best) best.push(f);
    else events.push([f]);
  }
  const order = new Map(g.map((f, i) => [f, i]));
  for (const ev of events) ev.sort((a, b) => order.get(a) - order.get(b));
  return events;
}
var memberPart = (c) => c.ref.length > MEMBER_REF_MAX ? c.id : c.ref;
function splitByLength(g) {
  const parts2 = [];
  let cur = [], len = 2;
  for (const f of g) {
    const p = memberPart(f.c);
    const size = (p.startsWith("L:") ? p.length - 2 : p.length) + (cur.length ? 1 : 0);
    if (cur.length && len + size > MERGED_REF_MAX) {
      parts2.push(cur);
      cur = [];
      len = 2;
    }
    len += (p.startsWith("L:") ? p.length - 2 : p.length) + (cur.length ? 1 : 0);
    cur.push(f);
  }
  if (cur.length) parts2.push(cur);
  return parts2;
}
function channelOf2(part) {
  const p = part[0].c;
  const k = { id: p.id, title: p.title, ref: part.length === 1 ? p.ref : mergedRef(part.map((f) => memberPart(f.c))) };
  const withLogo = p.logo ? p : (part.find((f) => f.c.logo) || {}).c;
  if (withLogo && withLogo.logo) k.logo = withLogo.logo;
  if (p.adult) k.adult = true;
  return k;
}

// src/live.js
var drmDeclared = DRM_DECLARED;
var M2 = 60 * 1e3;
var H4 = 60 * M2;
var D2 = 24 * H4;
var PAGE_SIZE = 500;
var FIRST_FILL = { deadlineMs: 12e3, maxTimeoutMs: 4e3 };
var SCREEN_FILL = { deadlineMs: 4e3, maxTimeoutMs: 4e3 };
var TICK_BOUNDS = { deadlineMs: 3e3, maxTimeoutMs: 3e3 };
var TICK_LOAD_BOUNDS = { deadlineMs: 6e3, maxTimeoutMs: 4e3 };
var PICK_BOUNDS = { deadlineMs: 8e3, maxTimeoutMs: 4e3 };
var KINO_RELIST_MS = 55 * M2;
var NEXT_LISTING_MS = H4;
var KINO_REFRESH_SOFT_MS = 2500;
var EVENT_BUCKET_MS = 10 * M2;
var HLS4 = "application/vnd.apple.mpegurl";
var isStream = (out) => !!out && !!out.url;
var PLAN_MAX_UNITS = 24;
var PLAN_MAX_XUPER = 6;
var FORCE_MIN_AGE_MS = 10 * M2;
var NOT_A_FAILURE = /* @__PURE__ */ new Set(["deadline", "budget", "invalid_request"]);
var ownLimit2 = (e) => !!e && (NOT_A_FAILURE.has(e.code) || e.limited === true);
var EVENTS_ORDER = ["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv", "xuper"];
var REOPEN_WINDOW_MS = 9e4;
var REOPEN_MIN_GAP_MS = 1500;
var DEMOTE_MS = 10 * M2;
var MEMBER_FIRST_MS = 1e4;
var MEMBER_NEXT_MS = 5e3;
var SCRAPER_SHARE_MS = 4500;
var CUT_SLACK_MS = 250;
var MEMBER_MIN_MS = 1500;
var PROBE_TIMEOUT_MS = 2500;
var PROBE_MAX = 3;
var PROBE_FRESH_MS = 5 * M2;
var SOURCE_FAIL_STREAK = 2;
var SOURCE_FAIL_MS = 30 * M2;
var SLOW_SOURCE_MS = 1500;
var SLOW_EVIDENCE_MS = 24 * H4;
var READY_MS = 2 * H4;
var SOURCE_ALIVE_MS = 30 * M2;
var AUDITIONS_MAX = 2;
var ACCOUNT_STRIKES = 2;
var ALTERNATIVES_MAX = 8;
var ALT_REF_MAX = 512;
var FOOTBALL_SRC = /* @__PURE__ */ new Set(["futbollibre", "deportv"]);
var POLICY = {
  caracol: { cats: [D2, 7 * D2], list: [D2, 7 * D2] },
  cablevisionhd: { cats: [D2, 7 * D2], list: [D2, 7 * D2] },
  premiumtv: { cats: [6 * H4, 3 * D2], list: [6 * H4, 3 * D2] },
  supertv: { cats: [6 * H4, D2], list: [6 * H4, D2] },
  supertv2: { cats: [6 * H4, D2], list: [6 * H4, D2] },
  // supertv's other panels (src/sources/supertv.js)
  supertv3: { cats: [6 * H4, D2], list: [6 * H4, D2] },
  futbollibre: { cats: [D2, 7 * D2], list: [D2, 7 * D2], lists: { hoy: [10 * M2, 2 * H4] } },
  "nuvio-sports": { cats: [D2, 7 * D2], list: [10 * M2, 2 * H4] },
  deportv: { cats: [30 * M2, 6 * H4], list: [30 * M2, 6 * H4] },
  cncverse: { cats: [6 * H4, 3 * D2], list: [30 * M2, 2 * H4] },
  xuper: { cats: [D2, 7 * D2], list: [D2, 7 * D2] }
};
var DEFAULT_POLICY = { cats: [D2, 7 * D2], list: [6 * H4, D2] };
var UNCHANGED = Object.freeze({ unchanged: true });
var SOURCES2 = SOURCES;
function sourceById(id) {
  for (const s of SOURCES2) if (s.id === id) return s;
  return null;
}
var rankOf = (srcId) => {
  const i = SOURCES2.findIndex((s) => s.id === srcId);
  return i < 0 ? SOURCES2.length : i;
};
function log9(m) {
  try {
    kino.log("live: " + m);
  } catch (_) {
  }
}
var en4 = () => lang() === "en";
function hexDec(h) {
  let a = "";
  const s = String(h || "");
  for (let i = 0; i + 1 < s.length; i += 2) a += String.fromCharCode(parseInt(s.slice(i, i + 2), 16));
  try {
    return decodeURIComponent(a);
  } catch (_) {
    return a;
  }
}
function hashId(s) {
  let h = 5381;
  const str6 = String(s == null ? "" : s);
  for (let i = 0; i < str6.length; i++) h = (h * 33 ^ str6.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function listKey(srcId, rawCat) {
  return `${srcId}.${hexEnc(String(rawCat))}`;
}
function codeCategories(src) {
  return !!src && src.codeCategories === true;
}
function codeList(src, rawCat) {
  if (!src) return false;
  if (typeof src.codeList === "function") return !!src.codeList(rawCat);
  return src.codeList === true;
}
function pair(p, fallback) {
  return Array.isArray(p) && p[0] > 0 && p[1] >= p[0] ? { fresh: p[0], maxStale: p[1] } : fallback;
}
function catPolicy(src) {
  const t2 = src && src.catTtl;
  if (t2 && t2.fresh > 0) return { fresh: t2.fresh, maxStale: Math.max(t2.fresh, t2.maxStale || t2.fresh) };
  const p = POLICY[src && src.id] || DEFAULT_POLICY;
  return pair(p.cats, { fresh: D2, maxStale: 7 * D2 });
}
function listPolicy(src, rawCat) {
  if (codeList(src, rawCat)) return { fresh: Infinity, maxStale: Infinity, code: true };
  if (src && typeof src.listTtl === "function") {
    const s = codeCategories(src) ? null : catsOf(src.id);
    const cat = s && s.cats.find((c) => c && c.id === String(rawCat)) || null;
    const t2 = src.listTtl(String(rawCat), cat);
    if (t2 && t2.fresh > 0) return { fresh: t2.fresh, maxStale: Math.max(t2.fresh, t2.maxStale || t2.fresh), code: false };
  }
  const p = POLICY[src && src.id] || DEFAULT_POLICY;
  const per = p.lists && p.lists[String(rawCat)];
  return { ...pair(per || p.list, { fresh: 6 * H4, maxStale: D2 }), code: false };
}
function offSources() {
  let off;
  try {
    const ix = parseIndex(getText(KEYS.ix));
    off = new Set((ix && ix.live && Array.isArray(ix.live.off) ? ix.live.off : []).map(String));
  } catch (_) {
    off = /* @__PURE__ */ new Set();
  }
  for (const s of SOURCES2) if (s.secondaryOf && off.has(s.secondaryOf)) off.add(s.id);
  return off;
}
function inUse(src) {
  if (typeof src.active !== "function") return true;
  try {
    return src.active() !== false;
  } catch (_) {
    return false;
  }
}
var activeSources = () => {
  const off = offSources();
  return SOURCES2.filter((s) => !off.has(s.id) && inUse(s));
};
var lazyMember = (s) => !!(s && s.src && s.src.secondaryOf);
function titleOf(t2, id) {
  if (t2 && typeof t2 === "object" && !Array.isArray(t2)) {
    const es = String(t2.es || t2.en || "").trim(), enT = String(t2.en || t2.es || "").trim();
    return es ? { es, en: enT } : id;
  }
  return String(t2 || id);
}
function normCats(list) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const c of Array.isArray(list) ? list : []) {
    if (!c || c.id == null || String(c.id) === "") continue;
    const id = String(c.id);
    if (seen.has(id)) continue;
    seen.add(id);
    const e = { id, title: titleOf(c.title, id) };
    if (c.adult === true) e.adult = true;
    if (typeof c.genre === "string" && c.genre) e.genre = c.genre;
    out.push(e);
  }
  return out;
}
var stamp = (v) => typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
function normalizeChannels(srcId, list) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const ch of Array.isArray(list) ? list : []) {
    if (!ch || ch.id == null) continue;
    const id = `${srcId}_${hashId(ch.key != null ? ch.key : ch.id)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const c = { id, title: String(ch.title || ch.id), ref: liveRef(srcId, ch.id) };
    if (ch.logo) c.logo = String(ch.logo);
    if (ch.adult === true) c.adult = true;
    const start = stamp(ch.start), end = stamp(ch.end);
    if (start) c.start = start;
    if (end && end > start) c.end = end;
    if (typeof ch.origin === "string" && /^[A-Za-z0-9_-]{1,24}$/.test(ch.origin)) c.origin = ch.origin;
    if (ch.x !== void 0) c.x = ch.x;
    out.push(c);
  }
  return out;
}
function ctxFor(src, opts) {
  return {
    src: src.id,
    // Whether a connector checks the stream it found before answering (a scraper's off-air GET of its playlist): only
    // for a single member re-resolved right after a cut or demoted for failing (`playAlone`). A first open does not pay
    // that request: the player's own request of the same playlist tells the same, and its 404 starts Kino's reopen.
    // A merged channel never asks: its suspect member's playlist is probed here (`playCandidates`).
    verify: !!(opts && opts.verify),
    fetch: liveFetch,
    timeoutFor,
    deadline,
    remaining,
    once: (key, fn, opts2) => once(src.id + ":" + key, fn, opts2),
    // How many new candidate accounts a secondary source may probe to find one (src/sources/supertv.js): in the screen's
    // fill of secondary sources alone (see `fillCategories`) and after Kino's first page (`searchSecondaries`), else 0.
    searchProbes: () => searchAllowance.seq === callSeq() ? searchAllowance.n : 0,
    // Whether that search is lean: candidate probes only (no probe of the primary to learn its panel, no bootstrap).
    searchLean: () => searchAllowance.seq === callSeq() && !!searchAllowance.lean,
    UNCHANGED,
    setCats: (cats) => storeCats(src, cats),
    // `{ partial: true }`: the channels so far of a listing cut by the call's limits, stored stale so the next tick or
    // call refreshes (goes on with) it while the screen shows them.
    putList: (rawCat, channels2, opts2) => storeList(src, rawCat, channels2, opts2),
    storedList: (rawCat) => {
      const l = getList(listKey(src.id, rawCat));
      return l ? l.items : null;
    },
    listMeta: (rawCat) => {
      const m = listMeta(listKey(src.id, rawCat));
      return m && m.h ? { at: m.at, n: m.n } : null;
    },
    touchAll: () => {
      for (const k of listKeysOf(src.id)) touchStored(src, k, hexDec(k.slice(src.id.length + 1)));
    },
    findChannel: (rawId) => findChannel(src, rawId),
    // A small JSON object of the connector's own under storage key `key` (src/sources/tvenvivo.js's player pages): read
    // once per runtime and kept in memory; after changing it, `saveMemo` writes it behind (src/liveStore.js `doc`), so a
    // resolve never pays for that write before its answer.
    memo: (key) => doc(key),
    saveMemo: (key, ttlMs) => saveDoc(key, ttlMs),
    dropLists: () => dropLists(src.id),
    relist: (rawCat, opts2) => relist(src, String(rawCat), !!(opts2 && opts2.force)),
    rawIdOf: (item) => {
      const r = decodeRef(item && item.ref);
      return r.kind === "live" && !r.members ? r.channel : null;
    },
    log: (m) => log9(src.id + ": " + m)
  };
}
function touchStored(src, key, rawCat) {
  const pol = listPolicy(src, rawCat);
  return pol.code ? false : touchList(key, { maxStaleMs: pol.maxStale });
}
function storeCats(src, cats) {
  return setCats(src.id, normCats(cats));
}
function storeList(src, rawCat, channels2, opts) {
  const pol = listPolicy(src, rawCat);
  const items = normalizeChannels(src.id, channels2);
  if (pol.code) return { items, h: codeHash(items), at: Date.now(), changed: false };
  const partial = !!(opts && opts.partial);
  return putList(listKey(src.id, rawCat), items, { maxStaleMs: pol.maxStale, ...partial ? { partial, freshMs: pol.fresh } : {} });
}
var codeHash = (items) => "c" + hashId(items.map((c) => c.id).join(","));
function findChannel(src, rawId) {
  const ref = liveRef(src.id, rawId);
  for (const key of listKeysOf(src.id)) {
    const l = getList(key);
    const hit = l && l.items.find((c) => c && c.ref === ref);
    if (hit) return { ...hit, cat: hexDec(key.slice(src.id.length + 1)) };
  }
  return null;
}
async function relist(src, rawCat, force) {
  const s = memberState({ src: src.id, rawCat }, Date.now());
  if (s.code) return (await codeItems(s)).items;
  const l = await loadMember(s, force);
  if (l.error) throw l.error;
  return l.items;
}
function why3(e) {
  const code = e && e.code != null ? String(e.code) : "";
  const msg = e && e.message != null ? String(e.message).slice(0, 160) : "";
  if (code && msg && msg !== code) return code + " (" + msg + ")";
  return code || msg || String(e);
}
function fetchCats(src, rideAlong) {
  return once("src:" + src.id + ":cats", async () => {
    try {
      const cats = await src.categories(ctxFor(src));
      if (!Array.isArray(cats)) throw new Error("categories() did not answer a list");
      storeCats(src, cats);
      return cats;
    } catch (e) {
      if (rideAlong && (ownLimit2(e) || remaining() < MIN_TIMEOUT_MS)) {
        log9(src.id + ": categories cut short by this call's bounds (" + why3(e) + "); the stored ones stay");
        throw e;
      }
      const wait = failCats(src.id);
      log9(src.id + ": categories failed: " + why3(e) + "; next try in " + Math.round(wait / 6e4) + " min");
      throw e;
    }
  });
}
async function knownCats(src, now) {
  if (codeCategories(src)) {
    try {
      return { cats: normCats(await src.categories(ctxFor(src))), stale: false };
    } catch (e) {
      log9(src.id + ": code categories failed: " + (e && e.message || e));
      return null;
    }
  }
  const s = catsOf(src.id);
  if (!s) return null;
  const pol = catPolicy(src);
  const age = now - s.at;
  if (age >= pol.maxStale) return null;
  if (!s.cats.length && age >= FAIL_BACKOFF_MS) return null;
  return { cats: s.cats, stale: age >= pol.fresh };
}
async function missingSources(now) {
  const out = [];
  const off = offSources();
  for (const src of SOURCES2) {
    if (off.has(src.id) || codeCategories(src)) continue;
    if (inUse(src) && await knownCats(src, now)) continue;
    if (catsInBackoff(src.id, now)) continue;
    out.push(src);
  }
  return out;
}
var SEARCH_PROBES = MAX_IN_FLIGHT;
var searchAllowance = { seq: -1, n: 0, lean: false };
async function fillCategories(bounds, max, opts) {
  const b = bounds || FIRST_FILL;
  const all = await missingSources(Date.now());
  const search3 = !!(opts && opts.search);
  const family = (s) => s.secondaryOf || s.id;
  const missing = search3 ? all : all.filter((s) => !s.secondaryOf || all.some((p) => p.id === s.secondaryOf));
  const families = [...new Set(missing.map(family))];
  const take2 = max > 0 ? new Set(families.slice(0, max)) : null;
  const todo = take2 ? missing.filter((s) => take2.has(family(s))) : missing;
  if (!todo.length) return { n: 0, left: all.length };
  const secondaryOnly = todo.every((s) => s.secondaryOf);
  tighten({ deadline: callStartedAt() + b.deadlineMs, maxTimeoutMs: b.maxTimeoutMs });
  searchAllowance = { seq: callSeq(), n: search3 && secondaryOnly ? SEARCH_PROBES : 0, lean: false };
  const done = await Promise.all(todo.map((src) => fetchCats(src).then(() => 1, () => 0)));
  const n = done.reduce((a, x) => a + x, 0);
  log9("first-ever categories: " + n + " of " + todo.length + " sources" + (todo.length < all.length ? " (" + (all.length - todo.length) + " left)" : ""));
  return { n, left: all.length - todo.length };
}
var KINO_SEARCH_AFTER_MS = 4e3;
var KINO_SEARCH_MS = 3500;
async function searchSecondaries(members, idle) {
  if (startedInCall() === 0 || Date.now() - callStartedAt() > KINO_SEARCH_AFTER_MS) return;
  const fams = new Set((members || []).map((m) => m.src).filter((id) => SOURCES2.some((s) => s.secondaryOf === id)));
  if (!fams.size) return;
  const todo = (await missingSources(Date.now())).filter((s) => fams.has(s.secondaryOf) && (inUse(s) || idle.has(s.id)));
  if (!todo.length) return;
  searchAllowance = { seq: callSeq(), n: SEARCH_PROBES, lean: true };
  try {
    const done = await within(KINO_SEARCH_MS, () => Promise.all(todo.map((src) => fetchCats(src).then(() => 1, () => 0))), { strict: true });
    log9("secondary sources after Kino's first page: " + done.reduce((a, x) => a + x, 0) + " of " + todo.length + " got categories");
  } finally {
    searchAllowance = { seq: -1, n: 0, lean: false };
  }
}
var expo = null;
var lastMapLog = "";
function knownEmpty2(srcId, rawCat) {
  const src = sourceById(srcId);
  if (!src) return false;
  const pol = listPolicy(src, rawCat);
  if (pol.code) return false;
  const m = listMeta(listKey(srcId, rawCat));
  return !!m && !!m.h && m.n === 0 && Date.now() - m.at < pol.fresh;
}
async function exposure() {
  const seq2 = callSeq(), reg = registry(), L = lang();
  if (expo && expo.seq === seq2 && expo.reg === reg && expo.lang === L) return expo.value;
  const now = Date.now();
  const raw = [];
  for (const src of activeSources()) {
    const k = await knownCats(src, now);
    if (!k) continue;
    for (const cat of k.cats) raw.push({ src: src.id, cat });
  }
  const value = mapCategories(raw, {
    srcName: (id) => {
      const s = sourceById(id);
      return s && s.name || id;
    },
    secondaryOf: (id) => {
      const s = sourceById(id);
      return s && s.secondaryOf || null;
    },
    knownEmpty: knownEmpty2,
    codeBacked: (srcId, rawCat) => {
      const s = sourceById(srcId);
      return !!s && listPolicy(s, rawCat).code;
    }
  });
  const st = value.stats;
  const line = "categories: " + st.exposed + " exposed (" + st.virtual + " virtual, " + st.passed + " passed" + (st.buckets.length ? ", buckets " + st.buckets.join(", ") : "") + ") from " + raw.length + " raw";
  if (line !== lastMapLog) log9(line);
  lastMapLog = line;
  expo = { seq: seq2, reg, lang: L, value };
  return value;
}
async function entryOf(categoryId) {
  const id = String(categoryId || "");
  const ex = await exposure();
  const e = ex.all.get(id);
  if (e) return e;
  if (isVirtualId(id)) return null;
  const i = id.indexOf(".");
  if (i <= 0) return null;
  const src = id.slice(0, i);
  return { id, title: "", kind: "old", merge: false, cc: null, src, members: [{ src, rawCat: hexDec(id.slice(i + 1)) }] };
}
async function exposedIdOf(categoryId) {
  const id = String(categoryId || "");
  const ex = await exposure();
  const e = ex.all.get(id);
  if (e) return e.hidden ? "" : id;
  const i = id.indexOf(".");
  if (i <= 0 || isVirtualId(id)) return "";
  const to = ex.byRaw.get(id.slice(0, i) + "" + hexDec(id.slice(i + 1)));
  const t2 = to && ex.all.get(to);
  return t2 && !t2.hidden ? to : "";
}
async function categoryList(opts) {
  const o = opts || {};
  if (o.fill) await fillCategories(o.fill === true ? FIRST_FILL : o.fill);
  return (await exposure()).list;
}
async function liveCategories() {
  if (!await currentBearer()) return [];
  try {
    const list = await categoryList({ fill: FIRST_FILL });
    return list.map((c) => {
      const k = { id: c.id, title: c.title };
      if (c.adult) k.adult = true;
      if (c.genre) k.genre = c.genre;
      if (c.country) k.country = c.country;
      return k;
    });
  } finally {
    flushMeta();
  }
}
function footballOf(list) {
  return list.filter((c) => c.kind === "sports" || c.kind === "events" || (c.kind === "pass" || c.kind === "old") && (FOOTBALL_SRC.has(c.src) || isFootball(c.title)));
}
function memberState(m, now) {
  const src = sourceById(m.src);
  const pol = listPolicy(src, m.rawCat);
  if (pol.code) return { m, src, pol, code: true };
  const key = listKey(src.id, m.rawCat);
  const stored = getList(key);
  const meta2 = listMeta(key);
  return { m, src, pol, key, code: false, stored, meta: meta2, age: stored ? now - stored.at : Infinity, backoff: inBackoff2(meta2 && meta2.failAt, now) };
}
async function codeItems(s) {
  const items = normalizeChannels(s.src.id, await s.src.channels(s.m.rawCat, ctxFor(s.src)));
  return { items, h: codeHash(items), at: Date.now(), stale: false };
}
async function loadMember(s, force) {
  try {
    return { ...await fetchList(s.src, s.m.rawCat, force), stale: false, fetched: true };
  } catch (e) {
    const why4 = e && (e.code || e.message) || e;
    const cut = ownLimit2(e) || remaining() < MIN_TIMEOUT_MS;
    const part = e && e.partial ? getList(s.key) : null;
    const kept = part ? ", " + part.items.length + " channels so far kept" : s.stored ? ", served as stored" : ", nothing stored yet";
    log9(s.key + (cut ? ": cut by this call's budget (" + why4 + ")" + kept : ": list failed: " + why4 + (part ? kept : "")));
    if (part) return { ...part, stale: true };
    if (s.stored) return { ...s.stored, stale: true };
    return { error: e };
  }
}
function fetchList(src, rawCat, force) {
  const key = listKey(src.id, rawCat);
  return once("src:" + src.id + ":list:" + key, async () => {
    let res;
    try {
      const out = await src.channels(rawCat, ctxFor(src));
      if (out === UNCHANGED) {
        const cur = getList(key);
        if (!cur) throw new Error("not modified, but nothing is stored");
        touchStored(src, key, rawCat);
        res = { items: cur.items, h: cur.h, at: Date.now() };
      } else {
        res = storeList(src, rawCat, out);
      }
    } catch (e) {
      if (!ownLimit2(e) && remaining() >= MIN_TIMEOUT_MS) failList(key);
      throw e;
    }
    if (!codeCategories(src) && remaining() > 1e3) {
      const s = catsOf(src.id);
      const now = Date.now();
      const pol = catPolicy(src);
      const age = s ? now - s.at : Infinity;
      const due = age >= (inStrictBudget() ? pol.fresh + (pol.maxStale - pol.fresh) / 2 : pol.fresh);
      if (due && !catsInBackoff(src.id, now)) {
        try {
          await fetchCats(src, true);
        } catch (_) {
        }
      }
    }
    return res;
  }, force ? { force: true } : void 0);
}
function planFetch(st, o, must) {
  const out = /* @__PURE__ */ new Set();
  const multi = st.length > 1;
  if (o.offline) return out;
  if (o.noFetch && st.some((s) => s.code || s.stored)) return out;
  if (!multi) {
    const s = st[0];
    if (s && !s.code && (o.force || !s.stored || o.refresh && (s.age >= s.pol.fresh || !!o.kinoForce) && !s.backoff)) out.add(0);
    return out;
  }
  const wants = [];
  const sharedDown = new Set(st.filter((s) => !s.code && s.src.sharedFetch && s.backoff).map((s) => s.m.src));
  st.forEach((s, i) => {
    if (s.code) return;
    if (sharedDown.has(s.m.src) && !o.force) return;
    const forced = (o.force || o.kinoForce) && s.age >= FORCE_MIN_AGE_MS && !(o.kinoForce && s.backoff);
    const lazy = lazyMember(s) ? 2 : 0;
    if (!s.stored) {
      if (!s.backoff || o.force) wants.push({ i, tier: lazy });
    } else if (o.refresh && must && must.has(i)) wants.push({ i, tier: 0 });
    else if (o.refresh && (s.age >= s.pol.fresh && !s.backoff || forced)) wants.push({ i, tier: 1 + lazy });
  });
  const sharedFirst = (w) => st[w.i].src.sharedFetch ? 1 : 0;
  const behind = (w) => st[w.i].age / st[w.i].pol.maxStale;
  wants.sort((a, b) => a.tier - b.tier || (a.tier % 2 === 0 ? sharedFirst(b) - sharedFirst(a) : behind(b) - behind(a)) || a.i - b.i);
  let units = 0, xuper2 = 0;
  const shared = /* @__PURE__ */ new Set();
  for (const w of wants) {
    const src = st[w.i].src;
    if (src.sharedFetch && shared.has(src.id)) continue;
    if (units >= PLAN_MAX_UNITS) break;
    if (src.id === "xuper" && xuper2 >= PLAN_MAX_XUPER) continue;
    units++;
    if (src.id === "xuper") xuper2++;
    if (src.sharedFetch) shared.add(src.id);
    out.add(w.i);
  }
  return out;
}
function mustRefresh(st, now) {
  const out = /* @__PURE__ */ new Set();
  const bySrc = /* @__PURE__ */ new Map();
  st.forEach((s, i) => {
    if (s.code || !s.stored || s.backoff || lazyMember(s)) return;
    const ends = listTextEndsAt(s.key, s.pol.maxStale);
    if (ends && ends <= now + NEXT_LISTING_MS) out.add(i);
    if (!bySrc.has(s.m.src)) bySrc.set(s.m.src, []);
    bySrc.get(s.m.src).push(i);
  });
  for (const [srcId, idx] of bySrc) {
    const src = sourceById(srcId);
    if (codeCategories(src) || catsInBackoff(srcId, now) || idx.some((i) => out.has(i))) continue;
    const c = catsOf(srcId);
    if (!c || c.at + catPolicy(src).maxStale > now + NEXT_LISTING_MS) continue;
    out.add(idx.reduce((a, b) => st[b].age > st[a].age ? b : a));
  }
  return out;
}
var eventsRank = (srcId) => {
  const i = EVENTS_ORDER.indexOf(srcId);
  return i < 0 ? EVENTS_ORDER.length : i;
};
function orderedMembers(e) {
  if (e.kind !== "events") return e.members;
  return e.members.map((m, i) => ({ m, i })).sort((a, b) => eventsRank(a.m.src) - eventsRank(b.m.src) || a.i - b.i).map((x) => x.m);
}
function categoryAdult(e) {
  if (e.adult) return true;
  for (const m of e.members) {
    const s = catsOf(m.src);
    const hit = s && s.cats.find((c) => c.id === m.rawCat);
    if (hit && hit.adult) return true;
  }
  return false;
}
function adultRefsOf(srcIds) {
  const out = /* @__PURE__ */ new Set();
  for (const id of srcIds) {
    const s = catsOf(id);
    if (!s) continue;
    for (const c of s.cats) {
      if (!c.adult) continue;
      const l = getList(listKey(id, c.id));
      if (l) {
        for (const it of l.items) if (it && it.ref) out.add(it.ref);
      }
    }
  }
  return out;
}
function adultAux(e, now) {
  if (e.kind !== "all") return [];
  const out = [];
  for (const id of new Set(e.members.map((m) => m.src))) {
    const s = catsOf(id);
    if (!s) continue;
    for (const c of s.cats) if (c.adult) out.push(memberState({ src: id, rawCat: c.id }, now));
  }
  return out.filter((s) => s.src && !s.code && !s.stored && !s.backoff);
}
var PAGES_MAX = 8;
var PAGE_ITEMS_MAX = 6e3;
var pages = /* @__PURE__ */ new Map();
var MEMBER_TITLES_MAX = 8e3;
var memberTitles = /* @__PURE__ */ new Map();
function forgetCompositions() {
  pages.clear();
  memberTitles.clear();
}
function composedPage(key, build) {
  const hit = pages.get(key);
  if (hit) {
    pages.delete(key);
    pages.set(key, hit);
    return hit;
  }
  const items = build();
  pages.set(key, items);
  let total = 0;
  for (const v of pages.values()) total += v.length;
  while (pages.size > PAGES_MAX || total > PAGE_ITEMS_MAX && pages.size > 1) {
    const [k, v] = pages.entries().next().value;
    pages.delete(k);
    total -= v.length;
  }
  return items;
}
async function inTurn(list, n, fn, keyOf, perKey) {
  const left = list.slice();
  const running2 = /* @__PURE__ */ new Map();
  const worker = async () => {
    while (remaining() >= MIN_TIMEOUT_MS) {
      const at2 = left.findIndex((x2) => (running2.get(keyOf(x2)) || 0) < perKey);
      if (at2 < 0) return;
      const x = left.splice(at2, 1)[0];
      const k = keyOf(x);
      running2.set(k, (running2.get(k) || 0) + 1);
      try {
        await fn(x);
      } finally {
        running2.set(k, running2.get(k) - 1);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
}
function parseCursor(c) {
  const m = /^([0-9a-z]{1,16}):(\d{1,7})$/.exec(String(c == null ? "" : c));
  return m ? { h: m[1], offset: Number(m[2]) } : null;
}
function kinoChannel(c, categoryId, adult) {
  const k = { id: c.id, title: c.title, ref: c.ref, categoryId };
  if (c.logo) k.logo = c.logo;
  if (adult || c.adult) k.adult = true;
  return k;
}
async function categoryChannels(categoryId, opts) {
  const o = opts || {};
  const e = await entryOf(categoryId);
  if (!e) return null;
  const use = new Set(activeSources().map((s) => s.id));
  const members = orderedMembers(e).filter((m) => use.has(m.src));
  if (!members.length) return null;
  const now = Date.now();
  const st = members.map((m) => memberState(m, now));
  const aux = o.offline || o.noFetch ? [] : adultAux(e, now);
  const must = o.refresh && st.length > 1 && !o.offline && !o.noFetch ? mustRefresh(st, now) : null;
  const plan = planFetch(st, o, must);
  const budgeted = o.softMs > 0 && st.length > 1 && !o.force && !o.kinoForce;
  let later = budgeted ? [...plan].filter((i) => st[i].stored && !(must && must.has(i)) || lazyMember(st[i])) : [];
  const errors = [];
  const results = new Array(st.length).fill(null);
  const loaded = /* @__PURE__ */ new Set();
  const load = async (i) => {
    const l = await loadMember(st[i], !!o.force);
    loaded.add(i);
    if (l.error) errors.push(l.error);
    else results[i] = l;
  };
  await Promise.all(st.map(async (s, i) => {
    if (s.code) {
      try {
        results[i] = await codeItems(s);
      } catch (err) {
        errors.push(err);
      }
      return;
    }
    if (plan.has(i) && !later.includes(i)) await load(i);
  }).concat(aux.slice(0, 2).map((s) => loadMember(s, false))));
  const shows = (s, i) => {
    const l = results[i] || s.stored;
    return !!l && Array.isArray(l.items) && l.items.length > 0;
  };
  if (later.length && !st.some((s, i) => !lazyMember(s) && shows(s, i))) later = later.filter((i) => !lazyMember(st[i]));
  if (later.length) {
    const fresh = (i) => {
      const m = listMeta(st[i].key);
      return !!m && !!m.h && Date.now() - m.at < st[i].pol.fresh;
    };
    const left = callStartedAt() + o.softMs - Date.now();
    if (left >= MIN_TIMEOUT_MS) await within(left, () => inTurn(later, MAX_IN_FLIGHT, (i) => fresh(i) ? null : load(i), (i) => st[i].m.src, MAX_PER_HOST), { strict: true });
  }
  const lists = [];
  let stale = false, partial = false, failed = false, refreshable = 0, have = 0;
  const after = Date.now();
  const sharedDown = new Set(st.filter((s) => !s.code && s.src.sharedFetch && inBackoff2((listMeta(s.key) || {}).failAt, after)).map((s) => s.m.src));
  st.forEach((s, i) => {
    let l = results[i];
    if (!s.code && (!loaded.has(i) || droppedThisCall(s.m.src))) {
      const cur = getList(s.key);
      l = cur ? { ...cur, stale: now - cur.at >= s.pol.fresh } : null;
    }
    const lazy = lazyMember(s);
    if (!s.code) {
      const meta2 = listMeta(s.key);
      const down = !!meta2 && inBackoff2(meta2.failAt, after) || sharedDown.has(s.m.src);
      if (!l && !down) partial = true;
      if (!lazy && down && (!l || l.stale)) failed = true;
      if (!lazy && l && l.stale && !down) refreshable++;
    }
    if (!l) return;
    have++;
    if (l.stale && !lazy) stale = true;
    lists.push({ member: s.m, rank: e.kind === "events" ? eventsRank(s.m.src) : rankOf(s.m.src), items: l.items, h: l.h, secondary: lazy });
  });
  if (!lists.length) {
    if (errors.length) throw errors[0];
    return { items: null, h: "0", stale: false, partial, failed, refreshable, code: false, have: 0, members };
  }
  const adult = categoryAdult(e);
  const adultRefs = adult ? /* @__PURE__ */ new Set() : adultRefsOf(new Set(members.map((m) => m.src)));
  const h = lists.length === 1 && members.length === 1 ? String(lists[0].h || "0").slice(0, 8) : hashId(lists.map((l) => l.member.src + ":" + l.h).join(","));
  const events = e.kind === "events";
  const pageKey = e.id + "|" + h + "|" + adultRefs.size + "|" + (adult ? 1 : 0) + "|" + lang() + (events ? "|" + Math.floor(after / EVENT_BUCKET_MS) : "");
  const items = composedPage(pageKey, () => {
    if (memberTitles.size > MEMBER_TITLES_MAX) forgetCompositions();
    const marked2 = adultRefs.size ? lists.map((l) => ({ ...l, items: l.items.map((c) => c && !c.adult && adultRefs.has(c.ref) ? { ...c, adult: true } : c) })) : lists;
    return composeMerged(marked2, { merge: e.merge, events, cc: e.cc, titles: memberTitles, now: after, en: en4() }).map((c) => kinoChannel(c, e.id, adult));
  });
  return { items, h, stale, partial, failed, refreshable, code: st.every((s) => s.code), have, members };
}
async function liveChannels(arg) {
  if (!await currentBearer()) return [];
  const categoryId = String(arg && arg.categoryId || "");
  if (!categoryId) return [];
  const cursor = parseCursor(arg && arg.cursor);
  try {
    const prev = cursor ? 0 : firstPageAt(categoryId);
    const kinoForce = !!prev && Date.now() - prev < KINO_RELIST_MS;
    const idle = new Set(cursor ? [] : SOURCES2.filter((s) => s.secondaryOf && !inUse(s)).map((s) => s.id));
    let r;
    try {
      r = await categoryChannels(categoryId, { refresh: !cursor, kinoForce, noFetch: !!cursor, softMs: KINO_REFRESH_SOFT_MS });
    } catch (e) {
      if (!await currentBearer()) return [];
      throw kino.error("unavailable", "Xuper: live list failed and nothing is stored (" + (e && (e.code || e.message) || e) + ")");
    }
    if (!cursor && r) {
      try {
        await searchSecondaries(r.members, idle);
      } catch (e) {
        log9("secondary sources: " + why3(e));
      }
    }
    if (!r || !r.items) return [];
    if (!cursor && r.items.length) markFirstPage(categoryId);
    const offset = cursor ? cursor.offset : 0;
    const items = r.items.slice(offset, offset + PAGE_SIZE);
    const next = offset + PAGE_SIZE < r.items.length ? `${r.h}:${offset + PAGE_SIZE}` : null;
    return { items, next };
  } finally {
    flushMeta();
  }
}
async function screenCategories(kind) {
  const list = (await categoryList()).filter((c) => !c.adult);
  const cats = kind === "football" ? footballOf(list) : list;
  const missing = (await missingSources(Date.now())).length > 0;
  return { cats: cats.map((c) => ({ id: c.id, title: c.title, src: c.src })), missing };
}
async function screenList(categoryId) {
  const r = await categoryChannels(categoryId, { offline: true });
  if (!r) return { items: [], stale: false, code: true, failed: false, partial: false, refreshable: 0, have: 0, resume: 0 };
  return {
    items: r.items,
    stale: r.stale,
    code: r.code,
    failed: r.failed,
    partial: r.partial,
    refreshable: r.refreshable,
    have: r.have,
    resume: cutLists(r.members)
  };
}
function cutLists(members) {
  let n = 0;
  for (const m of members || []) {
    const src = sourceById(m.src);
    if (!src || listPolicy(src, m.rawCat).code) continue;
    const meta2 = listMeta(listKey(src.id, m.rawCat));
    if (meta2 && meta2.p && meta2.h) n++;
  }
  return n;
}
async function loadList(categoryId, opts) {
  const o = opts || {};
  try {
    if (o.bounds) tighten({ deadline: callStartedAt() + o.bounds.deadlineMs, maxTimeoutMs: o.bounds.maxTimeoutMs });
    const r = await categoryChannels(categoryId, { refresh: true, force: !!o.force });
    return !!(r && r.items);
  } finally {
    flushMeta();
  }
}
async function fillScreenCategories() {
  try {
    return await fillCategories(SCREEN_FILL, 1, { search: true });
  } finally {
    flushMeta();
  }
}
var unknownSource = () => kino.error("unavailable", en4() ? "Xuper: unknown channel source" : "Xuper: fuente de canal desconocida");
var notLive = () => kino.error("unavailable", en4() ? "Xuper: not a live channel" : "Xuper: no es un canal en vivo");
var shortWhy = (e) => String(e && e.code || "error").slice(0, 40);
async function probeStream(out, opts) {
  const o = opts || {};
  const t2 = o.bound > 0 ? Math.max(MIN_TIMEOUT_MS, Math.min(PROBE_TIMEOUT_MS, o.bound)) : PROBE_TIMEOUT_MS;
  const get4 = () => liveFetch(out.url, { method: "GET", headers: { ...out.headers || {} }, cookies: false, redirect: "manual", timeoutMs: t2, maxBytes: 4096 });
  let r;
  try {
    r = await (o.alone === false ? get4() : within(t2 + 200, get4));
  } catch (e) {
    return e && e.code === "network" && refusal2(statusIn(e)) ? "dead" : "unknown";
  }
  if (!r) return "unknown";
  if (!r.ok) {
    const st = Number(r.status) || 0;
    if (st >= 300 && st < 400) {
      if (blockPage(r)) return "dead";
      noteRedirectingScope(probeScope(out.url));
    }
    return refusal2(st) ? "dead" : "unknown";
  }
  let text2 = "";
  try {
    text2 = String(bodyText(r) || "");
  } catch (_) {
    return "unknown";
  }
  return /^\s*#EXTM3U/.test(text2) ? "ok" : "dead";
}
var BLOCK_PAGE = /(?:^|\.)coljuegos\.gov\.co$/i;
function blockPage(r) {
  const h = r && r.headers || {};
  try {
    return BLOCK_PAGE.test(new URL(String(h.location || h.Location || "")).hostname);
  } catch (_) {
    return false;
  }
}
var refusal2 = (st) => st >= 400 && st < 600 && st !== 408 && st !== 425 && st !== 429;
function statusIn(e) {
  const m = /\((\d{3})\)/.exec(String(e && e.message || ""));
  return m ? Number(m[1]) : 0;
}
function probeScope(url) {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch (_) {
    return "";
  }
}
function probeable(out) {
  let path = "";
  try {
    path = new URL(out.url).pathname;
  } catch (_) {
    return false;
  }
  if (!/\.m3u8?$/i.test(path) || /mp2t/i.test(String(out.mime || ""))) return false;
  return !isRedirectingScope(probeScope(out.url));
}
async function siblingsOf(ref) {
  const d = decodeRef(ref);
  if (d.kind !== "live" || d.members) return [];
  const src = sourceById(d.source);
  if (!src) return [];
  const raws = /* @__PURE__ */ new Map();
  let ownId = "";
  for (const key of listKeysOf(src.id)) {
    const l = getList(key);
    const hits = l ? l.items.filter((c) => c && c.ref === ref) : [];
    if (hits.length) {
      raws.set(hexDec(key.slice(src.id.length + 1)), hits.length);
      ownId = ownId || hits[0].id;
    }
  }
  if (codeCategories(src)) {
    try {
      for (const cat of normCats(await src.categories(ctxFor(src)))) {
        if (!listPolicy(src, cat.id).code) continue;
        const n = normalizeChannels(src.id, await src.channels(cat.id, ctxFor(src))).filter((c) => c.ref === ref).length;
        if (n) raws.set(cat.id, n);
      }
    } catch (_) {
    }
  }
  const ex = await exposure();
  const held2 = [...raws].map(([raw, n]) => {
    const id = ex.byRaw.get(src.id + "" + raw);
    return { e: id && ex.all.get(id) || null, n };
  });
  const oneEvent = held2.every((x) => x.e && x.e.kind === "events") && held2.reduce((a, x) => a + x.n, 0) === 1;
  const out = [];
  const done = /* @__PURE__ */ new Set();
  for (const { e } of held2) {
    if (!e || done.has(e.id) || !(e.kind === "events" ? oneEvent : e.merge)) continue;
    done.add(e.id);
    let r = null;
    try {
      r = await categoryChannels(e.id, { offline: true });
    } catch (_) {
      r = null;
    }
    for (const c of r && r.items || []) {
      const dm = decodeRef(c.ref);
      if (!dm.members || !dm.members.some((x) => x.ref === ref || !!ownId && x.id === ownId)) continue;
      for (const x of memberRefs(dm.members)) if (x.ref !== ref && !out.includes(x.ref)) out.push(x.ref);
    }
  }
  return out;
}
function accountOfRef(src, channel) {
  try {
    return src && typeof src.accountOf === "function" ? src.accountOf(channel) || null : null;
  } catch (_) {
    return null;
  }
}
var accountOfLive = (ref) => {
  const d = decodeRef(ref);
  return d.kind === "live" && !d.members ? accountOfRef(sourceById(d.source), d.channel) : null;
};
function storedById(srcId, id) {
  if (!sourceById(srcId)) return null;
  for (const key of listKeysOf(srcId)) {
    const l = getList(key);
    const hit = l && l.items.find((c) => c && c.id === id);
    if (hit) return hit;
  }
  return null;
}
function memberRefs(members) {
  const out = [];
  for (const m of members) {
    if (m.ref) {
      out.push({ ref: m.ref, id: "" });
      continue;
    }
    const hit = storedById(m.source, m.id);
    if (hit && typeof hit.ref === "string") out.push({ ref: hit.ref, id: m.id });
  }
  return out;
}
function sourceFailing(id, now) {
  const s = sourceStats(id);
  return s.fn >= SOURCE_FAIL_STREAK && now - s.f < SOURCE_FAIL_MS;
}
function slowSource(id, now) {
  const s = sourceStats(id);
  return s.n > 0 && s.ms >= SLOW_SOURCE_MS && now - s.at < SLOW_EVIDENCE_MS;
}
function readyBlind(c, now) {
  const ok = probeOkAt(c.ref);
  if (ok && now - ok < READY_MS) return true;
  const s = sourceStats(c.src.id);
  return !!s.ok && now - s.ok < SOURCE_ALIVE_MS && s.fn === 0;
}
function costLane(list, tier) {
  const moved = /* @__PURE__ */ new Set();
  for (let i = 1; i < list.length; i++) {
    const b = list[i];
    if (!b.ready || tier(b) !== 0) continue;
    let j = i;
    while (j > 0 && list[j - 1].slow && tier(list[j - 1]) === 0) {
      list[j] = list[j - 1];
      j--;
    }
    if (j === i) continue;
    list[j] = b;
    moved.add(b.src.id + " before " + [...new Set(list.slice(j + 1, i + 1).map((x) => x.src.id))].join(", "));
  }
  return moved.size ? "a ready copy with no request first (" + [...moved].join("; ") + ": slow here)" : "";
}
async function playAlone(c, again) {
  const t0 = Date.now();
  let out;
  try {
    out = await c.src.resolve(c.raw, ctxFor(c.src, { verify: !!again || demotedAt(c.ref) > 0 }));
  } catch (e) {
    if (!c.src.blind && !ownLimit2(e) && !(e && e.code === "offline")) noteFailure(c.src.id);
    const reason = e && (e.message || e.code) || "";
    const user = e && typeof e.userMessage === "string" && e.userMessage ? { userMessage: e.userMessage } : void 0;
    throw kino.error("unavailable", en4() ? "Xuper: could not open the channel (" + reason + ")" : "Xuper: no se pudo abrir el canal (" + reason + ")", user);
  }
  if (!isStream(out)) {
    if (!c.src.blind) noteFailure(c.src.id);
    throw kino.error("unavailable", en4() ? "Xuper: channel without a stream" : "Xuper: canal sin stream");
  }
  if (!c.src.blind) noteAnswer(c.src.id, Date.now() - t0);
  if (!out.mime) out.mime = HLS4;
  return { stream: out, member: c.ref };
}
async function playCandidates(refs, tag, suspect, byId, refusedAcct, more, again) {
  const off = offSources();
  const cands = [];
  let unknown = null;
  const seen = /* @__PURE__ */ new Set();
  const take2 = (one) => {
    if (seen.has(one)) return null;
    seen.add(one);
    const d = decodeRef(one);
    if (d.kind !== "live" || d.members) return null;
    const src = sourceById(d.source);
    if (!src || off.has(d.source)) {
      unknown = unknown || unknownSource();
      return null;
    }
    const c = { ref: one, src, raw: d.channel, i: cands.length, acct: accountOfRef(src, d.channel), fo: !!src.secondaryOf };
    cands.push(c);
    return c;
  };
  for (const one of refs) take2(one);
  if (!cands.length) throw unknown || notLive();
  if (cands.length === 1) return playAlone(cands[0], again);
  const now = Date.now();
  let list = drmDeclared ? cands : cands.filter((c) => !c.src.drm);
  if (list.length < cands.length) log9("resolve " + tag + ": " + cands.filter((c) => c.src.drm).map((c) => c.src.id).join(", ") + " needs DRM (not declared), skipped");
  const tier = (c) => c.dAt ? 2 : c.sick || catsInBackoff(c.src.id, now) ? 1 : 0;
  const order = (a, b) => tier(a) - tier(b) || (a.fo ? 1 : 0) - (b.fo ? 1 : 0) || (a.dAt && b.dAt ? a.dAt - b.dAt : 0) || a.i - b.i;
  const mark = (c) => ({
    ...c,
    dAt: demotedAt(c.ref),
    sick: !c.src.blind && sourceFailing(c.src.id, now),
    slow: !c.src.blind && slowSource(c.src.id, now),
    ready: !!c.src.blind && !c.fo && readyBlind(c, now)
  });
  list = list.map(mark).sort(order);
  const lane = costLane(list, tier);
  if (lane) log9("resolve " + tag + ": " + lane);
  const steps = [];
  let userMessage = "";
  let probes = 0;
  let trouble = false;
  const ahead = [];
  const timedProbe = (out, opts) => (async () => {
    const t0 = Date.now();
    const v = await probeStream(out, opts);
    return { v, ms: Date.now() - t0 };
  })();
  const noteVerdict = (x, r) => {
    if (r.v === "ok") {
      noteProbeOk(x.ref);
      if (x.src.blind) noteAnswer(x.src.id, r.ms);
    } else if (r.v === "dead" && x.src.blind) noteFailure(x.src.id);
  };
  const verdictOf = async (x) => {
    const r = await x.pre;
    x.pre = null;
    noteVerdict(x, r);
    return r.v;
  };
  const freshOk = (x) => {
    const ok = probeOkAt(x.ref);
    return !!ok && Date.now() - ok < PROBE_FRESH_MS;
  };
  const aheadable = (x) => !!x.src.blind && !x.fo && !x.dAt && !x.pre && !x.heard && !x.out && !freshOk(x);
  const streamAhead = async (x) => {
    let o = null;
    try {
      o = await x.src.resolve(x.raw, ctxFor(x.src));
    } catch (_) {
      return null;
    }
    return isStream(o) && !(o.drm && !drmDeclared) && probeable(o) ? o : null;
  };
  const startAhead = (x, o, bound) => {
    x.out = o;
    probes++;
    x.pre = timedProbe(o, { alone: false, bound });
    ahead.push(x);
  };
  const settle = async () => {
    for (const x of ahead) {
      if (!x.pre) continue;
      if (await verdictOf(x) === "dead") demote(x.ref, DEMOTE_MS);
    }
  };
  const strikes = new Map(refusedAcct ? [[refusedAcct, 1]] : []);
  const refused2 = (c) => {
    if (c.acct) strikes.set(c.acct, (strikes.get(c.acct) || 0) + 1);
  };
  const passed = (x) => !!x.acct && (strikes.get(x.acct) || 0) >= ACCOUNT_STRIKES;
  const left = list.slice();
  let ask2 = typeof more === "function" ? more : null;
  const auditioned = /* @__PURE__ */ new Set();
  const auditionKey = (x) => x.acct || x.ref;
  const besideSlow = async (c, rest) => {
    if (probes >= PROBE_MAX) return;
    const b = rest.find((x) => tier(x) === 0 && aheadable(x));
    const o = b ? await streamAhead(b) : null;
    if (o) startAhead(b, o, sourceStats(c.src.id).ms);
  };
  const keyOf = (x) => x.acct || "src:" + x.src.id;
  const afterFailure = async (c, rest) => {
    const busy = /* @__PURE__ */ new Set([keyOf(c), ...ahead.filter((x) => x.pre).map(keyOf)]);
    for (let j = 0; j < rest.length && probes < PROBE_MAX; j++) {
      const x = rest[j];
      if (!aheadable(x) || passed(x) || busy.has(keyOf(x)) || j === rest.length - 1 && !ask2) continue;
      const o = await streamAhead(x);
      if (!o) continue;
      busy.add(keyOf(x));
      startAhead(x, o, PROBE_TIMEOUT_MS);
    }
  };
  for (let k = 0; left.length; k++) {
    if (ask2 && left.every(passed)) {
      const fn = ask2;
      ask2 = null;
      let extra = [];
      try {
        extra = await fn();
      } catch (_) {
        extra = [];
      }
      for (const one of Array.isArray(extra) ? extra : []) {
        const c2 = take2(one);
        if (c2 && (drmDeclared || !c2.src.drm)) {
          const x = mark({ ...c2, fo: true });
          list.push(x);
          left.push(x);
        }
      }
      left.sort(order);
      costLane(left, tier);
    }
    let at2 = 0;
    if (passed(left[0])) {
      const t02 = tier(left[0]);
      const hop = left.findIndex((x) => tier(x) === t02 && !passed(x) && !x.heard && !(x.fo && auditioned.has(auditionKey(x))));
      if (hop > 0) at2 = hop;
    }
    let audition = at2 > 0 && left[at2].fo && left.slice(0, at2).some((x) => !x.fo);
    if (audition && auditioned.size >= AUDITIONS_MAX) {
      at2 = 0;
      audition = false;
    }
    if (audition) auditioned.add(auditionKey(left[at2]));
    const c = left.splice(at2, 1)[0];
    const rest = left;
    const full = k === 0 ? MEMBER_FIRST_MS : MEMBER_NEXT_MS;
    const share = !c.src.blind && rest.some((x) => x.src.blind && !x.fo && !x.dAt) ? Math.min(full, SCRAPER_SHARE_MS) : full;
    if (!c.src.blind && remaining() < MEMBER_MIN_MS) {
      steps.push(c.src.id + " skipped (no time left)");
      continue;
    }
    if (c.slow && !c.out) await besideSlow(c, rest);
    const t0 = Date.now();
    let out = c.out || null;
    try {
      if (!out) out = await within(share, () => c.src.resolve(c.raw, ctxFor(c.src)));
    } catch (e) {
      const ms = Date.now() - t0;
      if (share < full && ms >= share - CUT_SLACK_MS) {
        noteSlow(c.src.id, ms);
        steps.push(c.src.id + " cut after " + ms + " ms (a copy with no request waits)");
        continue;
      }
      trouble = true;
      if (!userMessage && e && typeof e.userMessage === "string" && e.userMessage) userMessage = e.userMessage;
      demote(c.ref, DEMOTE_MS);
      refused2(c);
      if (!c.src.blind && !ownLimit2(e) && !(e && e.code === "offline")) noteFailure(c.src.id);
      steps.push(c.src.id + " failed in " + ms + " ms (" + shortWhy(e) + ")");
      continue;
    }
    if (!isStream(out)) {
      trouble = true;
      demote(c.ref, DEMOTE_MS);
      refused2(c);
      if (!c.src.blind) noteFailure(c.src.id);
      steps.push(c.src.id + " gave no stream");
      continue;
    }
    if (out.drm && !drmDeclared) {
      steps.push(c.src.id + " needs DRM (not declared), skipped");
      continue;
    }
    if (!c.src.blind && !c.out) noteAnswer(c.src.id, Date.now() - t0);
    if (audition) {
      let v = "";
      if (probeable(out)) {
        const r = await timedProbe(out);
        noteVerdict(c, r);
        v = r.v;
      }
      if (v === "dead") {
        demote(c.ref, DEMOTE_MS);
        refused2(c);
        trouble = true;
        steps.push(c.src.id + " does not answer (probe)");
        continue;
      }
      if (v !== "ok") {
        left.splice(at2, 0, { ...c, out, heard: v || "unprobed" });
        steps.push(c.src.id + " not confirmed (" + (v || "not probed") + "), after the others");
        continue;
      }
    } else if ((c.src.blind || c.ref === suspect) && (rest.length || ask2 || c.pre) && !c.heard && probeable(out)) {
      let v = "";
      if (c.pre) v = await verdictOf(c);
      else if (c.ref !== suspect && freshOk(c)) {
        steps.push(c.src.id + " unprobed (its playlist answered " + Math.round((Date.now() - probeOkAt(c.ref)) / 1e3) + " s ago)");
      } else if (probes < PROBE_MAX) {
        probes++;
        c.pre = timedProbe(out);
        if (trouble) await afterFailure(c, rest);
        v = await verdictOf(c);
      }
      if (v === "dead") {
        demote(c.ref, DEMOTE_MS);
        refused2(c);
        trouble = true;
        steps.push(c.src.id + " does not answer (probe)");
        continue;
      }
    }
    if (!out.mime) out.mime = HLS4;
    steps.push(c.src.id + " ok in " + (Date.now() - t0) + " ms (" + (c.i + 1) + " of " + cands.length + ")");
    log9("resolve " + tag + " (" + cands.length + " members): " + steps.join("; "));
    const others = list.filter((x) => x.ref !== c.ref).slice(0, ALTERNATIVES_MAX);
    const E4 = en4();
    const seenLabels = /* @__PURE__ */ new Map();
    const label = (x) => {
      const base = memberLabel(x.src.name, memberTitles.get(x.ref) || "", E4);
      const n2 = (seenLabels.get(base) || 0) + 1;
      seenLabels.set(base, n2);
      return n2 === 1 ? base : base.slice(0, 44) + " \xB7 " + n2;
    };
    out.label = label(c);
    const altRef = (x) => x.ref.length <= ALT_REF_MAX ? x.ref : byId && byId.get(x.ref) ? "M:" + byId.get(x.ref) : "";
    out.alternatives = others.filter((x) => altRef(x)).map((x) => ({ label: label(x), ref: altRef(x) }));
    await settle();
    return { stream: out, member: c.ref };
  }
  await settle();
  const n = cands.length;
  log9("resolve " + tag + " (" + n + " members): " + (steps.join("; ") || "nothing tried"));
  const E3 = en4();
  throw kino.error(
    "unavailable",
    E3 ? "Xuper: none of the channel's " + n + " servers worked" : "Xuper: ninguno de los " + n + " servidores del canal funcion\xF3",
    { userMessage: userMessage || (E3 ? "None of this channel's servers works right now. Try another channel or come back in a few minutes." : "Ning\xFAn servidor de este canal funciona ahora mismo. Prueba otro canal o vuelve en unos minutos.") }
  );
}
async function resolveLive(ref, siblings) {
  deferWrites();
  const r = decodeRef(ref);
  const extra = Array.isArray(siblings) ? siblings.filter((x) => typeof x === "string" && x) : [];
  const key = hashId(String(ref));
  const tag = (r.members ? "M#" : "L#") + key;
  const prev = lastResolveOf(key);
  const now = Date.now();
  const gap = prev ? now - prev.endedAt : Infinity;
  const again = !!prev && gap >= REOPEN_MIN_GAP_MS && gap < REOPEN_WINDOW_MS;
  const streak = again ? prev.consecutive ? prev.streak + 1 : 1 : 0;
  let suspect = null;
  let refusedAcct = null;
  if (again && prev.member) {
    const after = "resolve " + tag + ": again after " + Math.round(gap / 1e3) + " s";
    if (streak >= 2) {
      demote(prev.member, DEMOTE_MS);
      refusedAcct = accountOfLive(prev.member);
      log9(after + " (" + streak + " in a row) \u2192 the member it played is demoted for " + Math.round(DEMOTE_MS / M2) + " min");
    } else {
      suspect = prev.member;
      log9(after + " \u2192 the member it played is checked before it plays again");
    }
  }
  let served = null;
  try {
    if (r.kind !== "live") throw notLive();
    if (r.members) {
      const found = memberRefs(r.members);
      if (!found.length) throw kino.error("unavailable", en4() ? "Xuper: this event is no longer listed" : "Xuper: este evento ya no est\xE1 en la lista");
      const byId = new Map(found.filter((x) => x.id).map((x) => [x.ref, x.id]));
      const refs2 = found.map((x) => x.ref);
      const accts = new Set(refs2.map(accountOfLive));
      let sib = null;
      const stored = async () => sib = sib || await siblingsOf(refs2[0]);
      const tried = /* @__PURE__ */ new Set();
      const oneAcct = accts.size === 1 && !accts.has(null) ? [...accts][0] : null;
      const others = oneAcct ? async () => {
        const more = (await stored()).filter((x) => !refs2.includes(x) && !!accountOfLive(x) && accountOfLive(x) !== oneAcct);
        if (more.length) log9("resolve " + tag + ": every member on one account; + " + more.length + " on other panels (stored)");
        for (const x of more) tried.add(x);
        return more;
      } : null;
      try {
        const out = await playCandidates(refs2, tag, suspect, byId, refusedAcct, others, again);
        served = out.member;
        return out.stream;
      } catch (e) {
        if (![...accts].some(Boolean)) throw e;
        const more = (await stored()).filter((x) => !refs2.includes(x) && !tried.has(x) && !!accountOfLive(x));
        if (!more.length) throw e;
        log9("resolve " + tag + ": every member failed, trying " + more.length + " stored copies on other accounts");
        const out = await playCandidates(more, tag);
        served = out.member;
        return out.stream;
      }
    }
    let refs = [String(ref), ...extra];
    const own = sourceById(r.source);
    const drmOnly = !!own && !!own.drm && !drmDeclared;
    if ((again || drmOnly) && !extra.length) refs = refs.concat(await siblingsOf(String(ref)));
    try {
      const out = await playCandidates(refs, tag, suspect, null, refusedAcct, null, again);
      served = out.member;
      return out.stream;
    } catch (e) {
      if (refs.length > 1) throw e;
      const sib = await siblingsOf(String(ref));
      if (!sib.length) throw e;
      log9("resolve " + tag + ": failed, trying " + sib.length + " stored sibling(s)");
      demote(String(ref), DEMOTE_MS);
      const out = await playCandidates(sib, tag);
      served = out.member;
      return out.stream;
    }
  } finally {
    markResolved(key, served, streak);
  }
}

// src/catalog.js
var RESOLVE_BUDGET_MS = 17e3;
var VOD_FALLBACK_MIN_MS = 6e3;
var PREPARE_BUDGET_MS = 12e3;
function log10(m) {
  try {
    kino.log("" + m);
  } catch (_) {
  }
}
function notFound(why4) {
  return kino.error("not_found", "Xuper: " + why4);
}
function subtitlesOf(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const s of list) {
    if (!s || !s.url || out.length >= 30) continue;
    const sub = { url: String(s.url) };
    if (s.language) sub.lang = String(s.language).slice(0, 20);
    const ft = String(s.fileType || "").toLowerCase();
    if (ft === "vtt" || ft === "srt") sub.format = ft;
    out.push(sub);
  }
  return out;
}
var EP_INT = /^[+-]?\d+$/;
var toEpInt = (v) => {
  const t2 = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  return t2 !== null && EP_INT.test(t2.trim()) ? Number(t2.trim()) || 0 : null;
};
function toEpisodes(detail, seriesId, type) {
  const d = detail || {};
  const programs = d.simpleProgramList || d.programList || [];
  const E3 = lang() === "en";
  const chapterN = (n) => (E3 ? "Episode " : "Cap\xEDtulo ") + n;
  const seasonN = (n) => (E3 ? "Season " : "Temporada ") + n;
  const seasonList = parseSeasonList(d.sameSeasonSeriesList, seriesId);
  const episodes3 = [];
  programs.forEach((p, idx) => {
    const cid = p.contentId || p.programContentId;
    if (!cid) return;
    const number = toEpInt(p.seriesNumber) ?? toEpInt(p.programIndex) ?? toEpInt(p.episodeNumber) ?? idx + 1;
    const name = p.name || p.title ? String(p.name || p.title) : "";
    const numbered = number > 0 && name.includes("_") && isGenericTitle2(name);
    const ep = { number, title: name.trim() !== "" && !numbered ? name : chapterN(number), ref: episodeRef(cid, seriesId) };
    const still = pickPoster(p.posterList);
    if (still) ep.still = still;
    if (p.description) ep.overview = String(p.description);
    if (seasonList.own !== null) ep.season = seasonList.own;
    episodes3.push(ep);
  });
  const series = {};
  if (d.name) series.title = displaySeriesTitle(String(d.name));
  const poster = pickPoster(d.posterList);
  if (poster) series.poster = poster;
  if (d.description) series.overview = String(d.description);
  const out = { series, episodes: episodes3 };
  if (seasonList.all.length > 0) {
    out.seasons = seasonList.all.slice(0, 50).map((s) => ({
      id: s.id,
      // A season IS a portal title of the same type: its ref is what a listing gave it.
      ref: itemRef(s.id, type == null ? "" : type),
      title: seasonN(s.number),
      number: s.number,
      current: s.id === seriesId
    }));
  }
  return out;
}
var ENRICH_DEADLINE_MS = 15e3;
var IMDB_ID2 = /^tt\d{7,}$/;
async function enrichEpisodes(answer, detail, seriesId) {
  try {
    if (!answer || !Array.isArray(answer.episodes) || answer.episodes.length === 0) return;
    const raw = rawDetail(detail, seriesId);
    const started = callStartedAt();
    const deadline2 = (Number.isFinite(started) ? started : Date.now()) + ENRICH_DEADLINE_MS;
    const { extra, series } = await enrich(raw, makeTmdb(), deadline2);
    for (const ep of answer.episodes) {
      const t2 = extra.get(ep.number);
      if (!t2) continue;
      if (t2.title && isGenericTitle2(ep.title)) ep.title = t2.title;
      if (t2.still && !ep.still) ep.still = t2.still;
      if (t2.overview && !ep.overview) ep.overview = t2.overview;
      if (t2.airDate) ep.airDate = t2.airDate;
      if (t2.runtimeMinutes) ep.runtimeMinutes = t2.runtimeMinutes;
    }
    const imdb = IMDB_ID2.test(raw.imdb || "") ? raw.imdb : "";
    if (series && series.tmdbId > 0) {
      answer.series = answer.series || {};
      answer.series.ids = imdb ? { imdb, tmdb: series.tmdbId } : { tmdb: series.tmdbId };
      if (!answer.series.title && series.title) answer.series.title = series.title;
      if (!answer.series.poster && series.poster) answer.series.poster = series.poster;
      if (series.backdrop) answer.series.backdrop = series.backdrop;
    } else if (imdb) {
      answer.series = answer.series || {};
      answer.series.ids = { imdb };
    }
  } catch (_) {
  }
}
function expiresIn(expiresAt) {
  const e = Number(expiresAt) || 0;
  if (!e) return void 0;
  const left = e - Math.floor(Date.now() / 1e3);
  return left > 30 ? Math.min(left, 86400) : void 0;
}
var COLUMN_PAGE_SIZE = 30;
async function columnPage(columnId, page) {
  const d = await egressColumn(columnId, page, COLUMN_PAGE_SIZE);
  return d != null ? d : authed("GET", `/column/${columnId}?page=${page}&size=${COLUMN_PAGE_SIZE}`);
}
async function itemData(id, type, deadline2) {
  const d = await egressItem(id, type, deadline2);
  if (d != null) return d;
  const timeoutMs = deadline2 ? BACKEND_HOP_TIMEOUT_MS : void 0;
  return authed("GET", `/item/${encodeURIComponent(id)}`, void 0, timeoutMs, void 0, deadline2);
}
async function home() {
  await revalidate({ catalog: true });
  const v2 = catalog();
  const rows = v2 ? homeRows(v2) : [];
  if (!rows.length) throw kino.error("unavailable", "Xuper: no catalog stored yet and the refresh failed");
  return rows;
}
function columnItems(cards, adult) {
  const items = toItems(cards, adult, { poster: "recommended" });
  const v2 = catalog();
  if (v2 && Array.isArray(v2.items)) {
    const adultIds = new Set(v2.items.filter((it) => it && it.adult === true).map((it) => it.id));
    for (const it of items) if (adultIds.has(it.id)) it.adult = true;
  }
  return items;
}
async function browse(ref, cursor) {
  const r = decodeRef(ref);
  const page = Math.max(1, parseInt(cursor || "1", 10) || 1);
  if (r.kind === "category") {
    let v2 = catalog();
    if (!v2) {
      await revalidate({ catalog: true });
      v2 = catalog();
    }
    if (!v2) throw kino.error("unavailable", "Xuper: no catalog stored yet and the refresh failed");
    return browsePage(v2, r.name, cursor);
  }
  if (r.kind === "column") {
    const data = await columnPage(r.columnId, page);
    let items = columnItems(data && data.items, !!r.adult);
    items = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
    for (const it of items) {
      const clean = displaySeriesTitle(it.title);
      if (clean && clean !== it.title) it.title = clean;
    }
    const total = Number(data && data.total) || 0;
    return { items, next: page * COLUMN_PAGE_SIZE < total ? String(page + 1) : null };
  }
  return { items: [], next: null };
}
async function categories2() {
  let v2 = catalog();
  if (!v2) {
    await revalidate({ catalog: true });
    v2 = catalog();
  }
  if (!v2) throw kino.error("unavailable", "Xuper: no catalog stored yet and the refresh failed");
  return categoryTiles(v2);
}
async function episodes(ref) {
  const r = decodeRef(ref);
  if (r.kind === "legacy") {
    if (!r.isSeries) throw notFound("a 2.x movie has no chapters");
    if (!await currentBearer()) throw notActivated();
    return episodesAnswer(r, await legacyChapters(r.contentId), lang() === "en");
  }
  if (r.kind !== "item" && r.kind !== "episode" || !r.id) throw notFound("no series behind this ref");
  const data = await itemData(r.id, r.type);
  const detail = data && data.detail;
  const answer = toEpisodes(detail, r.id, r.type);
  await enrichEpisodes(answer, detail, r.id);
  return answer;
}
async function details(ref) {
  try {
    const r = decodeRef(ref);
    if (r.kind !== "item" || r.type === "0" || !r.id) return null;
    if (!await currentBearer()) return null;
    const data = await itemData(r.id, r.type);
    const imdb = String(data && data.detail && data.detail.keyWords || "").trim();
    return IMDB_ID2.test(imdb) ? { ids: { imdb } } : null;
  } catch (_) {
    return null;
  }
}
var CHAPTERS_TTL_MS = 30 * 6e4;
var CHAPTERS_MAX = 8;
var _chapters = /* @__PURE__ */ new Map();
async function legacyChapters(seriesId) {
  const now = Date.now();
  const hit = _chapters.get(seriesId);
  if (hit && now - hit.at >= 0 && now - hit.at < CHAPTERS_TTL_MS) return hit.raw;
  let data;
  try {
    data = await chapterList(seriesId);
  } catch (e) {
    throw legacyError(e, "series");
  }
  const raw = chaptersOf(data, seriesId);
  if (raw.items.length) {
    _chapters.delete(seriesId);
    _chapters.set(seriesId, { at: now, raw });
    while (_chapters.size > CHAPTERS_MAX) _chapters.delete(_chapters.keys().next().value);
  }
  return raw;
}
function legacyError(e, what) {
  const code = portalCodeOf(e);
  const msg = String(e && e.message || "");
  const user = e && typeof e.userMessage === "string" && e.userMessage ? { userMessage: e.userMessage } : void 0;
  if (code === "portal100006" || code === "portal100004" || msg.includes("\u4E0D\u5B58\u5728")) return kino.error("not_found", "Xuper: masnew " + (code || "gone") + " (" + what + ")");
  if (code === "portal100024") return kino.error("geo_blocked", "Xuper: masnew portal100024 (" + what + ")", user);
  if (e && typeof e.code === "string" && e.code === "auth_required") return e;
  const reason = code || e && (e.code || e.name) || "error";
  return kino.error("unavailable", "Xuper: masnew " + what + " failed (" + String(reason).slice(0, 40) + ")", user);
}
async function legacyResolve(m) {
  let chapter = null;
  if (m.isSeries) {
    const raw = await legacyChapters(m.contentId);
    if (!raw.items.length) throw notFound("the series has no chapters");
    chapter = findChapter(raw.items, m.episode);
    if (!chapter || !chapter.contentId) throw notFound("the series has no chapter " + m.episode);
  }
  try {
    return await resolveVod(chapter ? chapter.contentId : m.contentId, m.programType, chapter ? m.contentId : "");
  } catch (e) {
    throw legacyError(e, chapter ? "chapter" : "title");
  }
}
function migrate2(input) {
  return migrate(input, (code) => "xuper_" + hashId(code));
}
async function titleForContent(contentId, type, storedOnly, deadline2) {
  const id = String(contentId == null ? "" : contentId);
  if (!id) return "";
  const it = itemById(catalog(), id);
  if (it && it.title && it.title !== "\u2014") return it.title;
  if (storedOnly) return "";
  try {
    const d = await itemData(id, type, deadline2);
    const nm = d && d.detail && (d.detail.name || d.detail.title);
    if (nm) return String(nm);
  } catch (_) {
  }
  return "";
}
async function vodFallback(r, storedOnly, deadline2) {
  if (!r || r.kind !== "item" || r.type === "0") return null;
  const left = deadline2 - Date.now();
  if (left < VOD_FALLBACK_MIN_MS) {
    log10("resolve: the relay failed with " + Math.max(0, left) + " ms left: no time for the masnew fallback");
    return null;
  }
  const title = await titleForContent(r.id, r.type, storedOnly, deadline2);
  if (!title) return null;
  let match;
  try {
    match = await searchVod(title);
  } catch (_) {
    return null;
  }
  if (!match || !match.contentId || match.type && match.type !== "movie") return null;
  let out;
  try {
    out = await resolveVod(match.contentId, match.type);
  } catch (_) {
    return null;
  }
  return out && out.url ? out : null;
}
var FRESH_AGAIN_MS = 5 * 6e4;
var FRESH_MEMORY_MAX = 64;
var _lastResolve = /* @__PURE__ */ new Map();
function freshAgain(key, now = Date.now()) {
  const last = _lastResolve.get(key);
  _lastResolve.delete(key);
  _lastResolve.set(key, now);
  if (_lastResolve.size > FRESH_MEMORY_MAX) _lastResolve.delete(_lastResolve.keys().next().value);
  return last !== void 0 && now - last >= 0 && now - last < FRESH_AGAIN_MS;
}
function playable(r) {
  return r.kind === "live" || r.kind === "legacyLive" || r.kind === "legacy" || (r.kind === "item" || r.kind === "episode") && !!r.id;
}
async function resolve2(ref) {
  const r = decodeRef(ref);
  if (!playable(r)) throw notFound("ref not playable");
  if (!await currentBearer()) throw notActivated();
  if (r.kind === "live") return resolveLive(ref);
  if (r.kind === "legacyLive") return resolveLive(liveRef("xuper", r.code));
  if (r.kind === "legacy") return legacyResolve(r);
  if (r.kind === "item" || r.kind === "episode") {
    const deadline2 = callStartedAt() + RESOLVE_BUDGET_MS;
    const params = [];
    if (r.kind === "episode" && r.series) params.push(`series=${encodeURIComponent(r.series)}`);
    if (r.quality) params.push(`quality=${encodeURIComponent(r.quality)}`);
    const q = params.length ? `?${params.join("&")}` : "";
    let stream;
    try {
      stream = await relayResolve(encodeURIComponent(r.id) + q, deadline2, freshAgain(r.id + "|" + (r.series || "")));
    } catch (e) {
      const fb = await vodFallback(r, isRateLimited(e), deadline2);
      if (fb) return fb;
      throw e;
    }
    const out = { url: stream.url, mime: "video/mp2t" };
    const exp = expiresIn(stream.expiresAt);
    if (exp) out.expiresInSeconds = exp;
    if (!r.quality && Array.isArray(stream.qualities) && stream.qualities.length > 1) {
      const current2 = stream.quality || stream.qualities[0];
      const base = r.kind === "episode" ? episodeRef(r.id, r.series) : itemRef(r.id, r.type);
      out.label = current2;
      out.alternatives = stream.qualities.filter((qq) => qq && qq !== current2).map((qq) => ({ label: qq, ref: withQuality(base, qq) }));
    }
    const subs = subtitlesOf(stream.subtitles);
    if (subs.length) out.subtitles = subs;
    return out;
  }
  throw notFound("ref not playable");
}
async function prepare(ref) {
  try {
    const r = decodeRef(ref);
    if (r.kind !== "item" && r.kind !== "episode" || !r.id) return "skip";
    if (!await currentBearer()) return "skip";
    const out = await prepareRelay(callStartedAt() + PREPARE_BUDGET_MS);
    return out == null ? "skip" : out.ready === true ? "ready" : "failed";
  } catch (e) {
    const code = e && e.code || "error";
    const msg = e && e.message ? String(e.message).slice(0, 160) : "";
    log10("prepare: failed (" + code + (msg && msg !== code ? ": " + msg : "") + ")");
    return "failed";
  }
}
var _searchCache = /* @__PURE__ */ new Map();
var SEARCH_CACHE_TTL_MS = 18e4;
var SEARCH_CACHE_MAX = 32;
async function search(query) {
  if (!await currentBearer()) return [];
  const raw = typeof query === "string" ? query : query && (query.q || query.text) || "";
  const q = String(raw).trim();
  if (!q) return [];
  const key = q.toLowerCase();
  const now = Date.now();
  const hit = _searchCache.get(key);
  if (hit && now - hit.at < SEARCH_CACHE_TTL_MS) return hit.items;
  let data;
  try {
    data = await egressSearch(q);
    if (data == null) data = await authed("GET", `/search?q=${encodeURIComponent(q)}`);
  } catch (e) {
    return isRateLimited(e) && hit ? hit.items : [];
  }
  const cards = [];
  for (const k of ["resourceResult", "programResult", "seriesResult"]) {
    const b = data && data[k];
    const arr = b && (b.list || b.assetList || b.resourceList);
    if (Array.isArray(arr)) cards.push(...arr);
  }
  let items = toItems(cards, false, { poster: "recommended" });
  items = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
  for (const it of items) {
    const clean = displaySeriesTitle(it.title);
    if (clean && clean !== it.title) it.title = clean;
  }
  _searchCache.delete(key);
  _searchCache.set(key, { at: now, items });
  while (_searchCache.size > SEARCH_CACHE_MAX) _searchCache.delete(_searchCache.keys().next().value);
  return items;
}

// src/logo.js
var X_LOGO_DATA = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAOTklEQVR4nOVaeXRU5dl/t3vvbNkIIewoS1hSkEWk7IIBFKES4gABEkETkEUwoIAiIliRLQqFgpAQ9iWtfJVFWcpSpVWLCG2pYmWRpYjZyMwkmbl37rv03DuTENLPZCJ4vpPz/c5k/piZ8z7L+yy/57mBkr0jqMtAoI4DgToOBOo4EKjjQKCOA4E6DgTqOBCo40CgjgOBOg4S4u8ghNV8K4T4aeJhtceGcnJIBggBdN0PIQqKEwDA4LsQhhKSRDjnoJZACFFKORd3rKjQ1vxECIExrt7Img0InNIwtpGmqTBwcIUMQ3ugU3a7qFixWjlnQclBRf5XwUEdEcKazxcVFSHLshA8cByE0PhaGJ7hhlzk8pRRyqqxoWYDEAJM8700O82ZNKjEU4qJZEgy/S+EgADolM6c8cbRo59YIyOpTk35AggcUKYiDMpV4ABwQiSvu7B3n24bNqxUFIUxGlARI2y4BADOGJFIXl7Rk8Ofc+sUIfRjsQRrpNMQCk5ZVIT80YdbHu7W2dSgaurn5RcNGjT2/D8vWxxhpjbC/E25SCFMpwIBhQCcYOIrK23TqunxY3uaNWvyY3IZo0lJz+w/eFq22auJz5oNAIAjRPxerXnTyGMndrdu2UKnOkbIvAMkAGCcyUT6+sKlhIRxeYVu2SJzfsdbpj+F8WdeAcJQV7WYeo4jR3Z36tSeMV5QVJT13iaIrS534YQJyfHt21NKCcETnnlh2/Y9lrDmzIhMcE8GAIFkSS7zuH7Zs8Ohj3aEhduB4BgQI5KMYDKuSCLSiZOfDh+eSoWCMGZmdBkCBIBccMSNqEKQM06g78D+HQMH9vXrKmdgZOKzh46dBtSbmDRoS84ai0WRZWXunEXLV/zW6oihAv1ILtWiDyABoa5r9vDwzz89l5b2shFERt7xoH4AYkIopQMH9NqwYTlVPdAMvAA4EAIKKAAyTdXVko1Z7w4c2FfVVFmyTErLOPTJNyi2/Qin83d7cux2mywrmSvXLV+xymqPYkyrWbkQDIAQQAGBn2qWyOi97x+cM2cJxrJZc8p9LADGWNf18eNGvrVkrq+kmCBs5gCHkHNo2IAR0UpcS5fNG5c8skz1WhTLvLmLt3/wV9SsbZe4+pvWvwEgw5js3Pn+y3MWWR0xQrCQvBuC+qaCRnHAlDIlIvqddzasWr2VEJlSWvmXBBNK9Xlzp0+Zkup1F8iSjATAQkAoiCR5Pd/PzEib89ILPp9qt9jWrslevmaHNa5L80iRm/1GZL1wguU//vGTyZNnW6w2s8qZcmtUL4QqFEhFZNafYO/kqpqbuzoxcQilOsZ3anEgbCilTzvTDh74c1hkJKU+IpGSYleSc8ie3RsZZYoi/2HvB8kT5iutegBQdij79V4PxwMAzp47P2RIYrFblxUHpyyQYABI1edArQ0IdFDuZ3YrPHR4c49HulJGjfpdDs45Quh2sWvw4DFnz34TXj/KU5DXv3+PAwd3Wi0KIeTTz/76xLCxuFkfL0Xbl090Du3HOb9x4/vHEp66fOWaxRZNhdW8gaBP7kMOVDmIc44V7CrRkpOnXr12neC7eARCiDEeXS9q1841zZvHeAry4uPb7dz5nt1uJYRc/PbimDHPsxaPujT69syhzqH9dOZ3uz1OZ+rlSzdtjijB9WD8BF/3jY1WPkswRi0O+3dX8seNn1FSWgohMulAEBgjXadt28Zt3vxux45Nc3M3NGnSUAiQn5/vfHpSga2zD4TPHtcvI92p6TpnMDU1/YsvztgjIrnury2nCiWE/jsEOYBGcyBE8boKRicP37VjjeAconK2F7BSCISgy+WJjIxgjPr9+rChzlNXFdagzage9XetnkUplSR50qSZWVk5trBGjGtIAJ0CKEWG4vva3YCoCiMrKNXtEfVzd++bv2AZJpixu4oSNCqoiIyMoDrFmKSnTTt5wQUat+nfFm9aNk2nTJLkt36dmZW12eqIZVQHHIrKPfz+GlDZloo3KABlui0ieumS9dnZuyVJolSvXDSg0QF1IpH5ryzYefCc0rpPa7u2c8WLkizJkrRl6+7XFrylOGK4GX5G1wi8/RwhVIkMGtzAZL5G5TG6LASIA8jUffuzBiX016lOzMIKAaCMEULWrcuZNiszrOcIq377yIbZneNbAwCOn/jTr4aPY0wCBAmTKDEoIKecAyRFhx5CoXChcr3vvAfsCtyeEIJhjPyaHhttO3Hy9+3iWjHGjFpEDUr84YFDSWNm4G6jOXV/sGzikL5dAQBfffXtY489WVhUpshWFsx+g4IDQZlhQL37ngMG+6k6L1X6hDGmKFJevjtp5DNXr10LjFpEImfOnEuZ8CKJH6Z6b6/NeHJI366csx9++MHpHJ+XX6pYbOXaBygrNe622rb10wwwY8bQNfDjQFODwVoUPMQYLgnGhYXFZaVlQnBJIlevXhszepLa5JEyqi8c3+s55+M6pV6vNjY57cKFS3ZjcmAVIgTgAAW4Q+3SOJSZWACD0wZeRuyXm2FOxOYnECPmZxYF7/2fLfHxHRijJSXeMWOn3uANGan/7KAHX39xrFmLYNrM105+/p0tLKZyyRLmPSCGIIQGhagNQgyhQHFgd7vHtMFke5AjqpduzF7ap1d3v98PIZyYOvnsFU007jigY/TaRc/rOicSeXn+0twDn0W07MR1n65rFVkUlGHy7dpWoRANqDxVVPUQQlgtcS1bumC08ymfqsmynDFz/t7jX0utu7WLotszp8kyliTy7ursd7IPK7FtwtSbB/Zt7dWrq+r1YELKXRGYpDmsRKvuVwhVNrKq9oQQryt/xsz0l2ana5pmtSiZy1f/ZuuJsN6jbb5buzNnNKwfBQDY8/7+l9/eGd6kDbt5btP2FQmDBzRu1iQhITG/wCMrEqNMBKgnhATh6ibIapWrLYQkEa/rdtLTw1euXKCqqqIoe363b+7CNVG9n2S+sl1vp8W3bQkAOPXp6fSMTKVRXOm18+uWzxr8eIKqqh3ax23dtt7YJzF/IK0Cu4ufvRMLY2FjjIoES2XFnl59uuVsWikAs1gsp/78l/RJL0UPfr7ET347bcDAnr8QAHx7+Xry5MX+ei181//25ixn6sQUXdcVRfHrdNBj/VZmLtR8hRhjs7GYY2i1I/y9NLKg/oElCcFE86otW8SeOJnbtGkshOjixSsDBiZ62yd6HA8sfKLJ6+mD/JyVujwJY2b9LV/GRdfTh/9i3boVlDJMcMDblDGJkBcz5q5etcrqaMI55UwHkAAcHXoq18oAAY1CZNBl4WcOGzlyeHv37g9RxtzukoR+iZfq91Q7DUxpUbpp9nCdCsBF0rOvfnjeLUGtV4R28uM9gQ595zhh3CZjbMSIUYcPHbOHNfBrXoCkWhlQqxASxm4BIoMKMTUnZ0X37g/5dY0xPjYp9RulnXhk5IAGvnUzhnEGZEIyFq09+M+yeg0bsSunL1w4f+LExxhjznkFPzeCBgBFlnNyNrZr39Zb5iakhk3oTzaAB3wPAYSIaKWud959fcRTQzRNkyVl8nMvHL8Bw341tV1Y0bbp/WVobCiWr9+77vCVmLgO7rOHEWd5RaUpKemXr3wXsOGOeIQoZY0aNti1a0tUlI1StfIV3S8DjG1mIPoxIarHNWfe1BemTfCpmqIor73y5tbDX9Ubt1Bht7eldW8YYUeEbNt/8tXfn4/p/Kj3iw+Fq1AAbLfbvv/emzJ+usdTUmVpjjHSqb9L544bNqxl1GeMGvBnaGQCQEJkn7tg7LiRby95RdVUq0V5b33WkrX7YlIzdX/Z1uTWHRpFAYg//vLb53NOOXoM0M4f91//Giky4pRSvz0s/LPPvpg2fZ6xE7h7biSY6FR/OumpxYvf0LxF5R06JIS2WjQbls/tfnRA7wMHNsoSlmXlwMGjSc70qDFZ2gOt1w9Fyd0f4IxfuHrr8aXHPQ92Vf6y9/bRHbLFIoQuOIMGb+KSpJR6Ct/89Suvzc8wBh1yVxtlxvCAU56ZvmPHUYvDzhi/bwZgTNSy0nZxDxw/sSc2JgpjfObMl4MGp5Ce88RDw4hS+EiDYvfNG4pMLheVFTV72HbldEH2YmSRkbGSA8yYtJixB0bG1OzzFuzZnTVq1EhKqdkBKgzghODDR089MSTVEh5ZiaveG5XASNJVLTYmIjd3beOG9TnnV6//25n0LI9LkTs5NV5GedSxGyogLQWAjp4POi79vWDzMkkmFdtTI+DNqBCMC4Qk2TFlSkbrNq26dnmIMY4xMkeZoDi/VvM+tDJqiDaIkO7XCNK3bl3VqWM7XfeXlnlHjUi5aetr651a5svHGFtlR2zzVhHt4qP7dYkSBYW/WUAhFVgqH+GMGhCYGBkCuuCE2FwuOnZc2q1beRibT5kYr8D9pBJGSeZCIXzb9swhg/sGPklNmXqmuFX9oa+qFEm2SGYLFw4rs9hRpCJ78n9YNIPdvoVkmfHgft3cVKPgsyljTQx1Sq328H9duDJh4hS/38gEbEKWJYSQxWKplQHVhRCEUPN6R41PbBvX+pNTn1utlk3Z2/d99GXjpDfVm/+QEIClNmCRsU3ixdji8hfvXuP910UUYQeUmhoH9hdm8ARODPA1CBjz28Oijx45OWPmnPS08X6/bu5guKJIF77+CiAS+mPPGpMY2qyKT/WZjoSqV1XsYZxTc55EAeoYeDonOBU6hYoCjBJZdRtZ9VDzKwiR5vNa7RbzoV7QNmGsau5akN2jAcYm1CjMpkMxRsZjASMp75ZgPm01MrXSgjEUIIT/u9rUqpGFUIVweZ5AwxiTT9yRVUmmMU+BWoJzVpU63ClIISGU58TVfVkbWT/h/P8H/yuBQB0HAnUcCNRxIFDHgUAdBwJ1HAjUcSBQx4H+rxW4V/wHCt8U7h3znkwAAAAASUVORK5CYII=";

// src/screenView.js
var en5 = () => lang() === "en";
var HTTP2 = /^https?:\/\//;
var PRESS_MS = 3e4;
var MIN4 = 6e4;
var busyBar = () => ({ type: "LinearProgressIndicator", key: "busy", hidden: true });
var busyEvent = (event, arg) => ({ ui: [{ show: "busy" }], event, ...arg !== void 0 ? { arg } : {} });
var NAV = [
  { key: "home", icon: "home", es: "Inicio", en: "Home" },
  { key: "deportes", icon: "sports", es: "F\xFAtbol", en: "Football" },
  { key: "vivo", icon: "tv", es: "En vivo", en: "Live" },
  { key: "config", icon: "settings", es: "Ajustes", en: "Settings" }
];
var navBar = (active) => ({
  type: "NavigationBar",
  value: active,
  onChanged: busyEvent("nav"),
  items: NAV.map((n) => ({ key: n.key, icon: n.icon, label: en5() ? n.en : n.es, labelEn: n.en }))
});
var navTabs = (active) => ({
  type: "TabBar",
  key: "navTabs",
  divider: false,
  value: active,
  onChanged: busyEvent("nav"),
  tabs: NAV.map((n) => ({ value: n.key, label: en5() ? n.en : n.es, labelEn: n.en }))
});
var brand = () => ({
  type: "Row",
  key: "brand",
  crossAxisAlignment: "center",
  gap: 8,
  children: [
    { type: "Image", key: "brandLogo", url: X_LOGO_DATA, aspect: "1:1", fit: "contain", h: 32, maxHeight: 32, alt: "Xuper", altEn: "Xuper" },
    { type: "Text", key: "brandText", text: "Xuper", textEn: "Xuper", style: "h4" }
  ]
});
var navLabel = (nav) => {
  const n = NAV.find((x) => x.key === nav);
  return n ? en5() ? n.en : n.es : "Xuper";
};
var navLabelEn = (nav) => {
  const n = NAV.find((x) => x.key === nav);
  return n ? n.en : "Xuper";
};
var titleText2 = (nav) => ({ type: "Text", key: "scTitle", text: navLabel(nav), textEn: navLabelEn(nav), style: "h4" });
var closeLeading = (nav) => ({ type: "IconButton", key: "navClose", icon: "arrow_back", labelText: en5() ? "Back" : "Atr\xE1s", labelTextEn: "Back", onPressed: nav && nav !== "home" ? { event: "nav", arg: "home" } : { go: { close: true } } });
var appBar = (actions, title, nav) => ({
  type: "AppBar",
  mergeWithKinoBar: true,
  dense: true,
  divider: false,
  leading: closeLeading(nav),
  title: title || brand(),
  ...actions && actions.length ? { actions } : {}
});
function scaffoldChrome(device, nav, actions) {
  if (device === "tv" && nav) {
    return { appBar: {
      type: "AppBar",
      mergeWithKinoBar: true,
      dense: true,
      divider: false,
      leading: closeLeading(nav),
      title: { type: "Row", key: "tvTitle", gap: 16, crossAxisAlignment: "center", children: [brand(), navTabs(nav)] },
      ...actions && actions.length ? { actions } : {}
    } };
  }
  const phoneTitle = nav === "home" ? brand() : nav ? titleText2(nav) : void 0;
  return { appBar: appBar(actions, phoneTitle, nav), ...nav ? { bottomNavigationBar: navBar(nav) } : {} };
}
var LV_STEP = 50;
var LV_PAGE = 100;
var LV_COLUMNS = Object.freeze({ compact: 2, expanded: 6 });
var scrollPage = (key, gap, children) => ({
  type: "Column",
  key: key + "-page",
  children: [
    busyBar(),
    {
      type: "SingleChildScrollView",
      key,
      flex: 1,
      children: [{ type: "Column", key: key + "-col", padding: { compact: 12, expanded: 24 }, gap, children }]
    }
  ]
});
function supportButton(key, E3, device) {
  if (device === "tv") {
    return {
      type: "Column",
      key,
      crossAxisAlignment: "center",
      children: [
        {
          type: "Text",
          key: key + "Cap",
          color: "muted",
          textAlign: "center",
          text: E3 ? "Scan with your phone to support Xuper on Ko-fi" : "Escanea con tu celular para apoyar a Xuper en Ko-fi",
          textEn: "Scan with your phone to support Xuper on Ko-fi"
        },
        { type: "QrImage", key: key + "Qr", value: SUPPORT_URL, size: "large" }
      ]
    };
  }
  return {
    type: "Button",
    variant: "secondary",
    key,
    icon: "heart",
    labelText: E3 ? "If you want to support me, click here" : "Si me quieres apoyar, haz clic aqu\xED",
    labelTextEn: "If you want to support me, click here",
    onPressed: { go: { url: { href: SUPPORT_URL, title: E3 ? "Support Xuper on Ko-fi" : "Apoya a Xuper en Ko-fi" } } }
  };
}
function welcomeView({ error, device } = {}) {
  const E3 = en5();
  const body = [
    { type: "Text", key: "wTitle", text: E3 ? "Welcome to Xuper" : "Bienvenido a Xuper", textEn: "Welcome to Xuper", style: "h3", textAlign: "center" },
    {
      type: "Text",
      key: "wHint",
      color: "muted",
      textAlign: "center",
      text: E3 ? "To get in, activate your access with your Kino identity." : "Para entrar, activa tu acceso con tu identidad de Kino.",
      textEn: "To get in, activate your access with your Kino identity."
    },
    {
      type: "ElevatedButton",
      key: "activate",
      labelText: E3 ? "Activate" : "Activar",
      labelTextEn: "Activate",
      onPressed: { event: "activate", timeoutMs: PRESS_MS }
    }
  ];
  if (error === "update") body.push({
    type: "MaterialBanner",
    key: "wErrUpd",
    role: "error",
    text: E3 ? "To activate Xuper you need the latest version of Kino. Update Kino and try again." : "Para activar Xuper necesitas la versi\xF3n m\xE1s reciente de Kino. Actualiza Kino y vuelve a intentarlo.",
    textEn: "To activate Xuper you need the latest version of Kino. Update Kino and try again."
  });
  else if (error) body.push({
    type: "MaterialBanner",
    key: "wErr",
    role: "error",
    text: E3 ? "Could not activate. Grant the permission and try again." : "No se pudo activar. Acepta el permiso y vuelve a intentarlo.",
    textEn: "Could not activate. Grant the permission and try again."
  });
  body.push(supportButton("wSupport", E3, device));
  return {
    type: "Scaffold",
    appBar: appBar(),
    body: {
      type: "Column",
      key: "welcome",
      flex: 1,
      mainAxisAlignment: "center",
      crossAxisAlignment: "center",
      gap: 16,
      padding: { compact: 24, expanded: 48 },
      children: body
    }
  };
}
var HERO_H = { compact: 200, expanded: 240 };
var slideNode = (s) => ({
  type: "heroCard",
  key: "slide-" + s.id,
  h: HERO_H,
  title: s.title,
  ...s.text ? { text: s.text } : {},
  image: s.image,
  buttons: [{
    type: "ElevatedButton",
    key: "play-" + s.id,
    icon: "play",
    labelText: en5() ? "Play" : "Reproducir",
    labelTextEn: "Play",
    onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } }
  }]
});
var hero = (slides) => slides.length === 1 ? slideNode(slides[0]) : { type: "PageView", key: "hero" + slides.length, autoPlayMs: 6e3, children: slides.map(slideNode) };
var skeletonRail = (n) => ({
  type: "Column",
  key: "skel" + n,
  gap: 8,
  children: [
    { type: "Skeleton", key: "skl" + n, shape: "line", width: 160 },
    { type: "Row", key: "skr" + n, gap: 12, children: [1, 2, 3, 4].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}-${i}`, flex: 1 })) }
  ]
});
var GENRES = {
  "Action": ["Acci\xF3n", "Action"],
  "Adventure": ["Aventura", "Adventure"],
  "Animation": ["Animaci\xF3n", "Animation"],
  "Adult": ["Adultos", "Adult"],
  "Anime": ["Anime", "Anime"],
  "Biography": ["Biograf\xEDa", "Biography"],
  "Cartoon": ["Dibujos animados", "Cartoon"],
  "Comedy": ["Comedia", "Comedy"],
  "Crime": ["Crimen", "Crime"],
  "Documentary": ["Documental", "Documentary"],
  "Drama": ["Drama", "Drama"],
  "Family": ["Familia", "Family"],
  "Fantasy": ["Fantas\xEDa", "Fantasy"],
  "History": ["Historia", "History"],
  "Horror": ["Terror", "Horror"],
  "Kids": ["Infantil", "Kids"],
  "Music": ["M\xFAsica", "Music"],
  "Musical": ["Musical", "Musical"],
  "Mystery": ["Misterio", "Mystery"],
  "Nacional": ["Nacional", "National"],
  "News": ["Noticias", "News"],
  "Reality": ["Reality", "Reality"],
  "Romance": ["Romance", "Romance"],
  "Sci-Fi": ["Ciencia ficci\xF3n", "Sci-Fi"],
  "Short": ["Cortometraje", "Short"],
  "Sport": ["Deporte", "Sport"],
  "Suspense": ["Suspenso", "Suspense"],
  "Thriller": ["Thriller", "Thriller"],
  "War": ["B\xE9lica", "War"],
  "Western": ["Western", "Western"]
};
function genreLabels(g) {
  const hit = GENRES[g];
  return hit ? hit : [String(g), String(g)];
}
function filterSheet(genres, fTag) {
  const E3 = en5();
  const tile = (key, es, enLabel, val, sel) => ({
    type: "ListTile",
    key,
    title: E3 ? enLabel : es,
    titleEn: enLabel,
    dense: true,
    ...sel ? { selected: true, trailing: { type: "Icon", name: "check" } } : {},
    onTap: { ui: [{ close: "filterSheet" }], event: "fTag", arg: val }
  });
  return {
    type: "BottomSheet",
    key: "filterSheet",
    title: E3 ? "Genre" : "G\xE9nero",
    titleEn: "Genre",
    children: [{ type: "ListView", key: "filterList", items: [
      tile("f-all", "Todos", "All", "", !fTag),
      ...genres.map((g, i) => {
        const [es, enL] = genreLabels(g);
        return tile("f-" + i, es, enL, g, g === fTag);
      })
    ] }]
  };
}
var railNode = (r, i) => ({ type: "titleRail", key: "rail-" + i, ...r.title ? { title: r.title, titleEn: r.title } : {}, ...r.ref ? { ref: r.ref } : {}, items: r.items, size: "medium" });
var SEARCH_FIELD = "sq";
function searchSheet() {
  const E3 = en5();
  return {
    type: "BottomSheet",
    key: "searchSheet",
    title: E3 ? "Search" : "Buscar",
    titleEn: "Search",
    children: [{
      type: "TextField",
      key: SEARCH_FIELD,
      kind: "search",
      maxLength: 200,
      labelText: E3 ? "Movies and series" : "Pel\xEDculas y series",
      labelTextEn: "Movies and series",
      trailingIcon: "search",
      trailingLabel: E3 ? "Search" : "Buscar",
      trailingLabelEn: "Search",
      onSubmitted: { event: "search" },
      onTrailingTap: { event: "search" }
    }]
  };
}
function catalogView({ tab, view, fTag = "", device = "phone", failed = false }) {
  const E3 = en5();
  const tabs = SECTIONS.map((s) => ({ value: s.name, label: E3 ? s.titleEn : s.title, labelEn: s.titleEn }));
  const body = [];
  let genres = [];
  if (!view && failed) {
    body.push({
      type: "MaterialBanner",
      key: "failed",
      role: "error",
      text: E3 ? "Could not load. Check your connection." : "No se pudo cargar. Revisa la conexi\xF3n.",
      textEn: "Could not load. Check your connection.",
      action: { label: E3 ? "Retry" : "Reintentar", labelEn: "Retry", onTap: busyEvent("reload") }
    });
  } else if (!view) {
    body.push(
      { type: "Skeleton", key: "heroSkel", shape: "block", height: HERO_H },
      skeletonRail(1),
      skeletonRail(2),
      skeletonRail(3)
    );
  } else {
    const adult = tab === "adultos";
    genres = view.genres || [];
    if (fTag) {
      const [es, enL] = genreLabels(fTag);
      body.push({ type: "Row", key: "fChip", gap: 8, crossAxisAlignment: "center", children: [
        { type: "Text", key: "fLabel", text: E3 ? `Genre: ${enL}` : `G\xE9nero: ${es}`, textEn: `Genre: ${enL}`, style: "caption", color: "primary", flex: 1, maxLines: 1 },
        { type: "TextButton", key: "fClear", labelText: E3 ? "Clear" : "Quitar", labelTextEn: "Clear", onPressed: { event: "fTag", arg: "" } }
      ] });
      const filtered = (view.all || []).filter((it) => (it.genres || []).includes(fTag));
      body.push(filtered.length ? { type: "titleGrid", key: "fGrid", columns: { compact: 3, expanded: 6 }, items: filtered.slice(0, 60) } : { type: "Text", key: "fEmpty", color: "muted", text: E3 ? "No results" : "Sin resultados", textEn: "No results" });
    } else {
      if (!adult && view.slides && view.slides.length) body.push(hero(view.slides));
      const rails = (view.rails || []).map(railNode);
      if (rails.length) body.push(...rails);
      else body.push({ type: "Text", key: "empty", color: "muted", text: E3 ? "No content" : "Sin contenido", textEn: "No content" });
    }
  }
  const searchBtn = { type: "IconButton", key: "search", icon: "search", labelText: E3 ? "Search" : "Buscar", labelTextEn: "Search", tooltip: E3 ? "Search" : "Buscar", tooltipEn: "Search", onPressed: { ui: [{ open: "searchSheet" }] } };
  const actions = [searchBtn];
  const sheets = [searchSheet()];
  if (genres.length) {
    actions.push({ type: "IconButton", key: "filter", icon: "tune", labelText: E3 ? "Filter" : "Filtros", labelTextEn: "Filter", tooltip: E3 ? "Filter" : "Filtros", tooltipEn: "Filter", onPressed: { ui: [{ open: "filterSheet" }] } });
    sheets.push(filterSheet(genres, fTag));
  }
  return {
    type: "Scaffold",
    ...scaffoldChrome(device, "home", actions),
    body: { type: "Column", key: "page", children: [
      busyBar(),
      // Room above and below the section menu (the owner, 2026-11-18: it looked squeezed between the bar and the list). A
      // margin, not a padding: Kino before its fix draws a TV TabBar without its padding.
      { type: "TabBar", key: "tabs", divider: false, margin: { top: 8, bottom: 8 }, value: tab, onChanged: "tab", tabs },
      { type: "ListView", key: "list-" + tab + (fTag ? "-f" : ""), flex: 1, padding: { compact: 12, expanded: 24 }, gap: 16, items: body },
      ...sheets
    ] }
  };
}
function groupByLeague(matches2) {
  const order = [], byKey = /* @__PURE__ */ new Map();
  for (const m of matches2 || []) {
    if (!m) continue;
    const league = String(m.league || (en5() ? "Other" : "Otros"));
    if (!byKey.has(league)) {
      byKey.set(league, { league, matches: [] });
      order.push(league);
    }
    byKey.get(league).matches.push(m);
  }
  return order.map((k) => byKey.get(k));
}
var pad2 = (n) => String(n).padStart(2, "0");
function localStart(m) {
  const t2 = matchStart(m);
  if (!Number.isFinite(t2)) return null;
  const d = new Date(t2);
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, hm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
var hhmm = (m) => {
  const l = localStart(m);
  if (l) return l.hm;
  const s = String(m && m.time || "");
  const i = s.indexOf(" ");
  return i >= 0 ? s.slice(i + 1, i + 6) : s.slice(0, 5);
};
var teamName = (t2) => String(t2 && t2.n || "?");
var teamCell = (t2, n, side) => {
  const logo = t2 && HTTP2.test(t2.l || "") ? t2.l : null;
  return {
    type: "Column",
    key: `tc-${n}-${side}`,
    gap: 8,
    flex: 1,
    crossAxisAlignment: "center",
    children: [
      logo ? { type: "Image", key: `fl-${n}-${side}`, url: logo, h: 32, aspect: "3:2", fit: "contain" } : { type: "Icon", key: `fi-${n}-${side}`, name: "sports", size: 30 },
      { type: "Text", key: `fn-${n}-${side}`, text: teamName(t2).slice(0, 18), textEn: teamName(t2).slice(0, 18), style: "caption", textAlign: "center", maxLines: 2 }
    ]
  };
};
function matchCard(m, n, now) {
  const E3 = en5();
  const live = isLiveMatch(m, now);
  const hasTeams = !!(m.a && m.b);
  const titleFull = hasTeams ? `${teamName(m.a)} vs ${teamName(m.b)}` : String(m.title || "?").slice(0, 80);
  const centerKids = live ? [
    { type: "Badge", key: "lb-" + n, text: E3 ? "LIVE" : "EN VIVO", textEn: "LIVE", color: "error" },
    { type: "Icon", key: "pl-" + n, name: "play" }
  ] : [
    { type: "Text", key: "tm-" + n, text: hhmm(m), textEn: hhmm(m), style: "h4", color: "primary" },
    { type: "Text", key: "vs-" + n, text: "VS", textEn: "VS", style: "caption", color: "muted" }
  ];
  const center = { type: "Column", key: "ct-" + n, crossAxisAlignment: "center", mainAxisAlignment: "center", gap: 4, children: centerKids };
  const top = hasTeams ? { type: "Row", key: "tr-" + n, gap: 8, crossAxisAlignment: "center", children: [teamCell(m.a, n, "a"), center, teamCell(m.b, n, "b")] } : { type: "Row", key: "tr-" + n, gap: 8, crossAxisAlignment: "center", children: [
    { type: "Text", key: "gn-" + n, text: titleFull, textEn: titleFull, flex: 1, maxLines: 2 },
    center
  ] };
  const ch = m.ch ? String(m.ch) : "";
  const foot = live ? ch ? `\u25B6 ${ch.slice(0, 34)}` : E3 ? "Watch now" : "Mira ahora" : `${E3 ? "Upcoming" : "Pr\xF3ximamente"}${ch ? ` \xB7 ${ch.slice(0, 26)}` : ""}`;
  const footEn = live ? ch ? `\u25B6 ${ch.slice(0, 34)}` : "Watch now" : `Upcoming${ch ? ` \xB7 ${ch.slice(0, 26)}` : ""}`;
  return {
    type: "Card",
    key: "match-" + n,
    // Informative agenda: the old MagisPro live play is retired, so a match is not tappable.
    children: [{ type: "Column", key: "mc-" + n, gap: 8, crossAxisAlignment: "center", children: [
      top,
      { type: "Text", key: "ft-" + n, text: foot, textEn: footEn, style: "caption", color: live ? "primary" : "muted", textAlign: "center", maxLines: 1 }
    ] }]
  };
}
var matchDate = (m) => {
  const l = localStart(m);
  return l ? l.date : String(m && m.time || "").slice(0, 10);
};
var DAYS_ES = ["Dom", "Lun", "Mar", "Mi\xE9", "Jue", "Vie", "S\xE1b"];
var DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dateLabel(d, today, E3) {
  if (d === today) return E3 ? "Today" : "Hoy";
  const [y, m, day] = d.split("-").map(Number);
  let dow = "";
  try {
    const g = new Date(y, m - 1, day).getDay();
    if (g >= 0 && g <= 6) dow = (E3 ? DAYS_EN : DAYS_ES)[g] + " ";
  } catch (_) {
  }
  return `${dow}${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
var leagueHeader = (g, n) => ({
  type: "Row",
  key: "lg-" + n,
  gap: 8,
  crossAxisAlignment: "center",
  children: [
    // No matchLogo: its URLs are often broken and Kino draws a huge placeholder. A reliable icon instead.
    { type: "Icon", key: "lgic-" + n, name: "sports", size: 20, color: "primary" },
    { type: "Text", key: "lgname-" + n, text: g.league, textEn: g.league, style: "h4", flex: 1, maxLines: 1 }
  ]
});
function liveSignature(matches2, now) {
  const out = [];
  visibleMatches(matches2, now).forEach((m, i) => {
    if (isLiveMatch(m, now)) out.push(i);
  });
  return out.join(",");
}
function clockMs(matches2, now) {
  const list = visibleMatches(matches2, now);
  if (list.some((m) => isLiveMatch(m, now))) return 6e4;
  let next = Infinity;
  for (const m of list) {
    const t2 = matchStart(m);
    if (Number.isFinite(t2) && t2 - LIVE_BEFORE_MS > now) next = Math.min(next, t2 - LIVE_BEFORE_MS - now);
  }
  return Math.max(6e4, Math.min(30 * MIN4, Number.isFinite(next) ? next + 1e3 : 30 * MIN4));
}
function deportesView({
  matches: matches2,
  depDate,
  depView = "ligas",
  today = "",
  now = Date.now(),
  device = "phone",
  failed = false,
  depTab = "partidos",
  cats,
  cat,
  channels: channels2,
  chLoading = false,
  chFailed = false,
  chOffline = false,
  timers = [],
  shown = LV_STEP,
  page = 0
}) {
  const E3 = en5();
  const tab = depTab === "canales" ? "canales" : "partidos";
  const body = [];
  body.push({
    type: "TabBar",
    key: "depTopTabs",
    divider: false,
    margin: { top: 8, bottom: 8 },
    value: tab,
    onChanged: busyEvent("depTab"),
    tabs: [{ value: "partidos", label: E3 ? "Matches" : "Partidos", labelEn: "Matches" }, { value: "canales", label: E3 ? "Channels" : "Canales", labelEn: "Channels" }]
  });
  let every = null;
  if (tab === "canales") {
    const head2 = [];
    if (Array.isArray(cats) && cats.length > 1) head2.push(categoryPicker("sportsCat", cats, cat));
    return {
      type: "Scaffold",
      ...scaffoldChrome(device, "deportes", []),
      body: livePage("sp", [body[0], ...head2], { channels: channels2, loading: chLoading, failed: chFailed, offline: chOffline, shown, page, cat, device }),
      ...timers && timers.length ? { every: timers } : {}
    };
  } else if (!matches2 && failed) {
    body.push({
      type: "MaterialBanner",
      key: "depFail",
      role: "error",
      text: E3 ? "Could not load matches." : "No se pudieron cargar los partidos.",
      textEn: "Could not load matches.",
      action: { label: E3 ? "Retry" : "Reintentar", labelEn: "Retry", onTap: busyEvent("reloadDep") }
    });
  } else if (!matches2) {
    body.push(skeletonRail(1), skeletonRail(2));
  } else {
    const list = visibleMatches(matches2, now);
    every = { ms: clockMs(matches2, now), event: "clock" };
    if (!list.length) {
      body.push({ type: "Text", key: "depEmpty", color: "muted", text: E3 ? "No matches" : "Sin partidos", textEn: "No matches" });
    } else {
      const view = depView === "todos" ? "todos" : "ligas";
      body.push({
        type: "TabBar",
        key: "depTabs",
        divider: false,
        value: view,
        onChanged: "depView",
        tabs: [{ value: "ligas", label: E3 ? "Leagues" : "Ligas", labelEn: "Leagues" }, { value: "todos", label: E3 ? "All" : "Todos", labelEn: "All" }]
      });
      const dates = Array.from(new Set(list.map(matchDate).filter(Boolean))).sort();
      const sel = depDate && dates.includes(depDate) ? depDate : dates.includes(today) ? today : dates[0] || "";
      if (dates.length > 1) {
        body.push({ type: "SingleChildScrollView", key: "dateStrip", direction: "horizontal", children: [
          { type: "Row", key: "dateRow", gap: 8, children: dates.map((d, i) => ({
            type: d === sel ? "ElevatedButton" : "TextButton",
            key: "date-" + i,
            radius: "full",
            labelText: dateLabel(d, today, E3),
            labelTextEn: dateLabel(d, today, true),
            onPressed: { event: "depDate", arg: d }
          })) }
        ] });
      }
      const day = sel ? list.filter((m) => matchDate(m) === sel) : list;
      if (!day.length) {
        body.push({ type: "Text", key: "depDayEmpty", color: "muted", text: E3 ? "No matches this day" : "Sin partidos ese d\xEDa", textEn: "No matches this day" });
      } else if (view === "todos") {
        let n = 0;
        for (const m of day) body.push(matchCard(m, n++, now));
      } else {
        let n = 0;
        for (const g of groupByLeague(day)) {
          body.push(leagueHeader(g, n));
          for (const m of g.matches) body.push(matchCard(m, n++, now));
        }
      }
    }
  }
  return {
    type: "Scaffold",
    ...scaffoldChrome(device, "deportes", []),
    body: scrollPage("dep-scroll", 12, body),
    ...every ? { every } : {}
  };
}
function categoryPicker(key, cats, cat) {
  const E3 = en5();
  return {
    type: "DropdownButton",
    key,
    value: cat || cats[0] && cats[0].id,
    labelText: E3 ? "Category" : "Categor\xEDa",
    labelTextEn: "Category",
    onChanged: busyEvent(key),
    // Kino's DropdownButton takes 1 to 500 options (src/live.js screenCategories already stops there).
    options: cats.slice(0, 500).map((c) => ({ value: String(c.id), label: String(c.title), labelEn: String(c.title) }))
  };
}
function pageRow(p, page, pages2, total) {
  const E3 = en5();
  const from = page * LV_PAGE + 1, to = Math.min(total, (page + 1) * LV_PAGE);
  const where = (enL) => enL ? `${from}\u2013${to} of ${total}` : `${from}\u2013${to} de ${total}`;
  const kids = [];
  if (page > 0) kids.push({ type: "TextButton", key: p + "Prev", icon: "arrow_back", labelText: E3 ? `Previous ${LV_PAGE}` : `Anteriores ${LV_PAGE}`, labelTextEn: `Previous ${LV_PAGE}`, onPressed: busyEvent("lvPage", String(page - 1)) });
  kids.push({ type: "Text", key: p + "Where", text: where(E3), textEn: where(true), style: "caption", color: "muted", flex: 1, textAlign: "center", maxLines: 1 });
  if (page + 1 < pages2) kids.push({ type: "TextButton", key: p + "Next", icon: "arrow_forward", labelText: E3 ? `Next ${LV_PAGE}` : `Siguientes ${LV_PAGE}`, labelTextEn: `Next ${LV_PAGE}`, onPressed: busyEvent("lvPage", String(page + 1)) });
  return { type: "Row", key: p + "Pages", gap: 8, crossAxisAlignment: "center", children: kids };
}
var KINO_ID = /^[A-Za-z0-9._~-]{1,128}$/;
var HTTPS2 = /^https:\/\//i;
var MAX_TITLE = 200;
var NAME_STOP = /* @__PURE__ */ new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "the", "of", "and"]);
function channelInitials(title) {
  const words = String(title == null ? "" : title).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = words.length > 1 ? words.filter((w) => !NAME_STOP.has(w.toLowerCase())) : words;
  const ws = kept.length ? kept : words;
  if (!ws.length) return "TV";
  if (ws.length === 1) {
    const w = ws[0];
    const acronym = Array.from(w).length <= 4 && w === w.toUpperCase();
    return (acronym ? w : Array.from(w).slice(0, 2).join("")).toUpperCase();
  }
  const part = (w) => /^\p{N}+$/u.test(w) ? w.slice(0, 3) : Array.from(w)[0];
  return Array.from(ws.slice(0, 3).map(part).join("").toUpperCase()).slice(0, 4).join("");
}
function catTag(cat) {
  const s = String(cat == null ? "" : cat);
  if (/^[A-Za-z0-9._~-]{1,40}$/.test(s)) return s;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0;
  return "h" + h.toString(36);
}
function channelGridKey(p, cat, page = 0) {
  return p + "Grid" + (cat ? "-" + catTag(cat) : "") + (page > 0 ? "-p" + page : "");
}
function channelTile(it, key, device, httpOk2) {
  const E3 = en5();
  const initials = channelInitials(it.title);
  const logo = it.poster && (HTTPS2.test(it.poster) || httpOk2 && HTTP2.test(it.poster)) ? it.poster : null;
  return {
    type: "Card",
    key,
    flush: true,
    background: "surfaceVariant",
    gap: 4,
    badge: { text: E3 ? "LIVE" : "EN VIVO", textEn: "LIVE", color: "error" },
    onTap: { go: { play: { ref: it.ref, kind: "live", id: it.id, title: it.title } } },
    children: [
      {
        type: "Image",
        key: key + "~l",
        ...logo ? { url: logo } : {},
        aspect: "4:3",
        fit: "contain",
        margin: { x: 12, top: 12, bottom: 4 },
        fallback: { type: "Column", key: key + "~f", mainAxisAlignment: "center", crossAxisAlignment: "center", children: [
          { type: "Text", key: key + "~i", text: initials, textEn: initials, style: "h3", maxLines: 1 }
        ] }
      },
      // Two lines of Kino's body text are 40 dp on a phone and 50 on a TV (its text is 1.25 larger), times the system's
      // font size and the theme's text scale; Kino puts minHeight outside the 8 dp padding. 64 holds two lines up to a
      // font scale of 1.4 on a phone, 80 up to 1.44 on a TV (and desktop, whose text size is not the phone's for sure),
      // so a one-line name and a two-line one make tiles of the same height, also with "Large" text.
      {
        type: "Text",
        key: key + "~n",
        text: it.title,
        textEn: it.title,
        maxLines: 2,
        textAlign: "center",
        fill: true,
        padding: { x: 8, bottom: 8 },
        minHeight: device === "phone" ? 64 : 80
      }
    ]
  };
}
function channelTiles(p, items, from, device) {
  const used = /* @__PURE__ */ new Set();
  const httpOk2 = httpImages();
  return items.map((it, i) => {
    const byId = p + "c-" + it.id;
    const key = byId.length <= 120 && !it.id.includes("~") && !used.has(byId) ? byId : `${p}c~${from + i}`;
    used.add(key);
    return it.adult ? { type: "titleCard", key, size: "small", item: it } : channelTile(it, key, device, httpOk2);
  });
}
function channelBody(p, { channels: channels2, loading, failed, offline, shown = LV_STEP, page = 0, cat = "", device = "phone" }) {
  const E3 = en5();
  const out = [];
  if (Array.isArray(channels2)) {
    if (offline) {
      out.push({
        type: "Text",
        key: p + "Offline",
        color: "muted",
        style: "caption",
        maxLines: 2,
        text: E3 ? "No connection to the source: showing the last list." : "Sin conexi\xF3n con la fuente: se muestra la \xFAltima lista.",
        textEn: "No connection to the source: showing the last list."
      });
    }
    const items = channelItems(channels2);
    if (!items.length) {
      out.push({ type: "Text", key: p + "Empty", color: "muted", text: E3 ? "No channels" : "Sin canales", textEn: "No channels" });
      return out;
    }
    const pages2 = Math.ceil(items.length / LV_PAGE);
    const pg = Math.min(Math.max(0, page), pages2 - 1);
    const onPage = items.slice(pg * LV_PAGE, (pg + 1) * LV_PAGE);
    const n = Math.min(onPage.length, Math.max(LV_STEP, shown));
    const drawn = onPage.slice(0, n);
    if (pages2 > 1) out.push(pageRow(p, pg, pages2, items.length));
    out.push({
      type: "ListView",
      key: channelGridKey(p, cat, pg),
      flex: 1,
      columns: LV_COLUMNS,
      gap: { compact: 12, expanded: 16 },
      // Room for the badge, which sits 4 dp outside each tile's top end corner (a list clips at its edges).
      padding: { x: 4, top: 8, bottom: 8 },
      items: channelTiles(p, drawn, pg * LV_PAGE, device),
      onEndReached: { event: "lvMore" },
      done: n >= onPage.length
    });
    const canvas = drawn.filter((it) => !it.adult);
    if (canvas.length) out.push({ type: "titleGrid", key: p + "Titles", hidden: true, items: canvas });
  } else if (failed) {
    out.push({
      type: "MaterialBanner",
      key: p + "Fail",
      role: "error",
      text: E3 ? "Could not load the channels." : "No se pudieron cargar los canales.",
      textEn: "Could not load the channels.",
      action: { label: E3 ? "Retry" : "Reintentar", labelEn: "Retry", onTap: busyEvent("reloadVivo") }
    });
  } else if (loading) {
    out.push(
      {
        type: "Text",
        key: p + "Loading",
        color: "muted",
        style: "caption",
        text: E3 ? "Loading channels\u2026" : "Cargando canales\u2026",
        textEn: "Loading channels\u2026"
      },
      { type: "Row", key: p + "Skel", gap: 12, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `${p}sk${i}`, flex: 1 })) }
    );
  } else {
    out.push({ type: "Text", key: p + "Empty", color: "muted", text: E3 ? "No channels" : "Sin canales", textEn: "No channels" });
  }
  return out;
}
function channelItems(channels2) {
  const out = [];
  for (const c of channels2 || []) {
    if (!c || !c.ref || String(c.ref).length > 4096) continue;
    const id = String(c.id || c.ref);
    if (!KINO_ID.test(id)) continue;
    const it = { id, ref: String(c.ref), title: (String(c.title || "").trim() || "\u2014").slice(0, MAX_TITLE), kind: "live" };
    if (c.logo && HTTP2.test(c.logo)) it.poster = c.logo;
    if (c.adult === true) it.adult = true;
    out.push(it);
  }
  return out;
}
function vivoView({
  cats,
  cat,
  channels: channels2 = null,
  device = "phone",
  loading = false,
  failed = false,
  offline = false,
  timers = [],
  shown = LV_STEP,
  page = 0
}) {
  const head2 = [];
  if (Array.isArray(cats) && cats.length > 1) head2.push(categoryPicker("liveCat", cats, cat));
  return {
    type: "Scaffold",
    ...scaffoldChrome(device, "vivo", []),
    body: livePage("vivo", head2, { channels: channels2, loading, failed, offline, shown, page, cat, device }),
    ...timers && timers.length ? { every: timers } : {}
  };
}
function livePage(p, head2, opts) {
  return {
    type: "Column",
    key: p + "-page",
    gap: 12,
    padding: { compact: 12, expanded: 24 },
    flex: 1,
    children: [
      busyBar(),
      ...head2,
      ...channelBody(p, opts)
    ]
  };
}
function agoText(ms, E3) {
  if (!(ms >= 0)) return E3 ? "just now" : "hace un momento";
  const m = Math.floor(ms / MIN4);
  if (m < 1) return E3 ? "just now" : "hace un momento";
  if (m < 60) return E3 ? `${m} min ago` : `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return E3 ? `${h} h ago` : `hace ${h} h`;
  return E3 ? `${Math.floor(h / 24)} d ago` : `hace ${Math.floor(h / 24)} d`;
}
function ageLine(label, a, now, E3) {
  if (!a) return E3 ? `${label[1]}: no data yet` : `${label[0]}: sin datos todav\xEDa`;
  const parts2 = [E3 ? `${label[1]}: checked ${agoText(now - a.checkedAt, true)}` : `${label[0]}: revisado ${agoText(now - a.checkedAt, false)}`];
  if (a.gen) parts2.push(E3 ? `published ${agoText(now - a.gen, true)}` : `publicado ${agoText(now - a.gen, false)}`);
  return parts2.join(" \xB7 ");
}
function leftText(min) {
  const m = Math.max(0, Math.floor(Number(min) || 0));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}
var both = (key, [es, enText], extra = {}) => ({ type: "Text", key, text: en5() ? enText : es, textEn: enText, ...extra });
function xuperSessionCard(s) {
  const st = s || { kind: "none", leftMin: 0, geo: false, wait: null };
  const line = st.kind === "seed" ? st.leftMin === null ? ["Sesi\xF3n: de respaldo (semilla)", "Session: backup (seed)"] : [`Sesi\xF3n: de respaldo (semilla) \xB7 le quedan ${leftText(st.leftMin)}`, `Session: backup (seed) \xB7 ${leftText(st.leftMin)} left`] : st.kind === "own" ? st.geo ? ["Sesi\xF3n: propia (an\xF3nima) \xB7 bloqueada", "Session: your own (anonymous) \xB7 blocked"] : ["Sesi\xF3n: propia (an\xF3nima)", "Session: your own (anonymous)"] : ["Sesi\xF3n: todav\xEDa ninguna", "Session: none yet"];
  const children = [
    both("cfgXuperTitle", ["Sesi\xF3n de Xuper", "Xuper session"], { style: "h4" }),
    both("cfgXuperKind", line, { color: "muted" })
  ];
  if (st.geo) children.push(both("cfgXuperGeo", ["Tu zona: bloqueada por Xuper", "Your region: blocked by Xuper"], { color: "muted" }));
  const w = st.wait;
  const n = Math.max(1, Number(w && w.min) || 1);
  const usedUp = !!w && (w.why === "429" || w.why === "cap");
  if (w && w.why === "503") {
    children.push(both("cfgXuperWait", [
      `Ahora no hay sesiones de respaldo libres. Se puede pedir otra en ${n} min.`,
      `No backup sessions are free right now. Another one can be requested in ${n} min.`
    ], { color: "muted", style: "caption" }));
  } else if (usedUp) {
    children.push(both("cfgXuperWait", [
      `Ya se usaron las sesiones de respaldo de esta hora. Podr\xE1s pedir otra en ${n} min.`,
      `This hour's backup sessions are used up. You can ask for another in ${n} min.`
    ], { color: "muted", style: "caption" }));
  }
  if (st.kind === "seed" && !usedUp) {
    children.push(
      {
        type: "ElevatedButton",
        key: "seedChange",
        icon: "refresh",
        labelText: en5() ? "Change seed" : "Cambiar semilla",
        labelTextEn: "Change seed",
        onPressed: busyEvent("seedChange")
      },
      both(
        "cfgSeedChangeHint",
        ["Pide otra sesi\xF3n de respaldo si esta va mal", "Asks for another backup session if this one goes wrong"],
        { color: "muted", style: "caption" }
      )
    );
  }
  children.push({ type: "ExpansionTile", key: "cfgSeedsWhat", items: [{
    key: "what",
    title: en5() ? "What are seeds?" : "\xBFQu\xE9 son las semillas?",
    titleEn: "What are seeds?",
    children: [both("cfgSeedsWhatText", [
      "Sesiones an\xF3nimas que comparten otros aparatos. Se usan solo cuando Xuper bloquea tu zona o tu aparato no logra abrir su propia sesi\xF3n.",
      "Anonymous sessions other devices share. They are used only when Xuper blocks your region or your device cannot open its own session."
    ])]
  }] });
  return { type: "Card", key: "cfgXuper", children };
}
function contribCard(c, now) {
  const on = !(c && c.on === false);
  const at2 = c && Number(c.at) > 0 ? Number(c.at) : 0;
  return { type: "Card", key: "cfgContrib", children: [
    both("cfgContribTitle", ["Aportar", "Contribute"], { style: "h4" }),
    {
      type: "Switch",
      key: "contribSwitch",
      value: on,
      labelText: en5() ? "Share an anonymous session" : "Aportar una sesi\xF3n an\xF3nima",
      labelTextEn: "Share an anonymous session",
      onChanged: { event: "contrib" }
    },
    both(
      "cfgContribHelp",
      [
        "De vez en cuando comparte una sesi\xF3n an\xF3nima nueva, creada solo para eso: nunca la tuya ni tus datos. Se env\xEDa al servidor de Xuper con tu acceso.",
        "Now and then it shares a new anonymous session, created only for that: never yours, never your data. It is sent to Xuper's server with your access."
      ],
      { color: "muted", style: "caption" }
    ),
    at2 ? both("cfgContribAt", [`\xDAltimo aporte ${agoText(now - at2, false)}`, `Last contribution ${agoText(now - at2, true)}`], { color: "muted", style: "caption" }) : both("cfgContribAt", ["Este aparato a\xFAn no ha aportado.", "This device has not contributed yet."], { color: "muted", style: "caption" }),
    { type: "ExpansionTile", key: "cfgContribWhat", items: [{
      key: "what",
      title: en5() ? "What is shared?" : "\xBFQu\xE9 se comparte?",
      titleEn: "What is shared?",
      children: [both("cfgContribWhatText", [
        "Una sesi\xF3n de invitado an\xF3nima reci\xE9n creada (un n\xFAmero de aparato y su permiso de acceso), comprobada antes de enviarla. Nunca tu cuenta, tu historial ni datos de este aparato. Como mucho una cada 3 horas.",
        "A brand-new anonymous guest session (a device number and its access grant), checked before it is sent. Never your account, your history or data about this device. At most one every 3 hours."
      ])]
    }] }
  ] };
}
var ordinalEn = (n) => {
  const t2 = n % 100, u = n % 10;
  return n + (t2 >= 11 && t2 <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th");
};
function devicesCard(d, now, device) {
  const used = Math.max(0, Math.floor(Number(d.used) || 0)), max = Math.max(1, Math.floor(Number(d.max) || 0));
  const next = max + 1;
  const me = device === "phone" ? ["Este tel\xE9fono", "This phone"] : ["Este aparato", "This device"];
  const rows = (d.list || []).map((x, i) => {
    const names = x.names && x.names.length ? x.names.join(" \xB7 ") : "\u2014";
    const lines = [both("cfgDevN" + i, [names, names], { maxLines: 2, ...x.current ? { color: "primary" } : {} })];
    if (x.lastSeen > 0) {
      lines.push(both(
        "cfgDevS" + i,
        [`Visto ${agoText(now - x.lastSeen, false)}`, `Seen ${agoText(now - x.lastSeen, true)}`],
        { color: "muted", style: "caption", maxLines: 1 }
      ));
    }
    return { type: "Row", key: "cfgDev" + i, gap: 8, crossAxisAlignment: "center", children: [
      { type: "Column", key: "cfgDevC" + i, flex: 1, gap: 4, children: lines },
      ...x.current ? [{ type: "Badge", key: "cfgDevMe" + i, text: en5() ? me[1] : me[0], textEn: me[1], color: "primary" }] : []
    ] };
  });
  return { type: "Card", key: "cfgDevices", children: [
    both("cfgDevTitle", [`Dispositivos: ${used} de ${max}`, `Devices: ${used} of ${max}`], { style: "h4" }),
    ...rows,
    both("cfgDevNote", [
      `Si activas un ${next}.\xBA tel\xE9fono, se cierra la sesi\xF3n del que usaste hace m\xE1s tiempo.`,
      `If you activate a ${ordinalEn(next)} phone, the one you used longest ago is signed out.`
    ], { color: "muted", style: "caption" }),
    { type: "ExpansionTile", key: "cfgDevWhat", items: [{
      key: "what",
      title: en5() ? "How are they counted?" : "\xBFC\xF3mo se cuentan?",
      titleEn: "How are they counted?",
      children: [
        both("cfgDevRule1", [
          "Un dispositivo es un tel\xE9fono, no un plugin: Xuper y Ultra HD en el mismo tel\xE9fono cuentan como uno.",
          "A device is a phone, not a plugin: Xuper and Ultra HD on the same phone count as one."
        ], { style: "caption" }),
        both("cfgDevRule2", [
          "Un tel\xE9fono deja de contar si no lo usas durante unos 30 d\xEDas: su sesi\xF3n vence.",
          "A phone stops counting after about 30 days without use: its session expires."
        ], { style: "caption" }),
        both("cfgDevRule3", [
          `Activar un ${next}.\xBA tel\xE9fono no se rechaza: se cierra la sesi\xF3n del que usaste hace m\xE1s tiempo, y ese tel\xE9fono te pedir\xE1 activarlo de nuevo.`,
          `Activating a ${ordinalEn(next)} phone is not refused: the one you used longest ago is signed out, and that phone will ask you to activate it again.`
        ], { style: "caption" }),
        both("cfgDevRule4", [
          "El l\xEDmite es por cuenta de Telegram, no por red ni por IP.",
          "The limit is per Telegram account, not per network or IP."
        ], { style: "caption" })
      ]
    }] }
  ] };
}
function configView({ version, device = "phone", ages = null, now = Date.now(), seeds = null, contrib = null, devices = null } = {}) {
  const E3 = en5();
  const a = ages || {};
  const lines = [[["Cat\xE1logo", "Catalog"], a.catalog], [["Partidos", "Matches"], a.matches]];
  return {
    type: "Scaffold",
    ...scaffoldChrome(device, "config", []),
    body: scrollPage("cfg-scroll", 16, [
      { type: "Card", key: "cfgAccount", children: [
        { type: "Text", key: "cfgAccTitle", style: "h4", text: E3 ? "Account" : "Cuenta", textEn: "Account" },
        {
          type: "Text",
          key: "cfgAccHint",
          color: "muted",
          text: E3 ? "Disconnect to activate again with your identity." : "Descon\xE9ctate para volver a activar con tu identidad.",
          textEn: "Disconnect to activate again with your identity."
        },
        {
          type: "ElevatedButton",
          key: "disconnect",
          icon: "lock",
          labelText: E3 ? "Disconnect" : "Desconectar",
          labelTextEn: "Disconnect",
          confirm: E3 ? "Disconnect Xuper?" : "\xBFDesconectar Xuper?",
          confirmEn: "Disconnect Xuper?",
          onPressed: { event: "disconnect", timeoutMs: PRESS_MS }
        }
      ] },
      { type: "Card", key: "cfgSupport", children: [
        { type: "Text", key: "cfgSupTitle", style: "h4", text: E3 ? "Support" : "Apoyar", textEn: "Support" },
        {
          type: "Text",
          key: "cfgSupHint",
          color: "muted",
          text: E3 ? "If you like Xuper, you can support it on Ko-fi." : "Si te gusta Xuper, puedes apoyarlo en Ko-fi.",
          textEn: "If you like Xuper, you can support it on Ko-fi."
        },
        supportButton("cfgSupportBtn", E3, device)
      ] },
      ...devices ? [devicesCard(devices, now, device)] : [],
      xuperSessionCard(seeds),
      contribCard(contrib, now),
      { type: "Card", key: "cfgData", children: [
        { type: "Text", key: "cfgDataTitle", style: "h4", text: E3 ? "Data" : "Datos", textEn: "Data" },
        ...lines.map(([label, age], i) => ({
          type: "Text",
          key: "cfgAge" + i,
          color: "muted",
          style: "caption",
          text: ageLine(label, age, now, E3),
          textEn: ageLine(label, age, now, true)
        }))
      ] },
      { type: "Card", key: "cfgAbout", children: [
        { type: "Text", key: "cfgAboutTitle", style: "h4", text: E3 ? "About" : "Acerca de", textEn: "About" },
        { type: "Text", key: "cfgVer", color: "muted", text: `Xuper ${version || ""}`.trim(), textEn: `Xuper ${version || ""}`.trim() }
      ] }
    ])
  };
}

// src/seedContrib.js
var CONTRIB_INTERVAL_MS = 3 * 36e5;
var VALIDATE_COLUMN = "masnew_movies";
var REQUEST_MS = 1e4;
var TOTAL_MS = 25e3;
var HOME_CONTRIB_END_MS = 15e3;
var CONTRIB_WINDOW_MS = 8e3;
var MIN_WINDOW_MS = 4e3;
var AT_KEY = "o2:contribAt";
var CONTRIBUTE_SETTING = "contributeSeeds";
var OPTIONAL_EXTRAS = ["customer"];
var str5 = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var WORD3 = /^[A-Za-z0-9_-]{1,24}$/;
function trace(event, fields) {
  const parts2 = ["seed_contrib", event];
  for (const [k, v] of Object.entries(fields || {})) {
    if (v === void 0 || v === null) continue;
    const s = typeof v === "boolean" ? v ? "1" : "0" : str5(v);
    parts2.push(k + "=" + (WORD3.test(s) ? s : "?"));
  }
  try {
    kino.log(parts2.join(" "));
  } catch (_) {
  }
}
function hasRealData(col) {
  if (col === null || typeof col !== "object") return false;
  if (Array.isArray(col)) return col.length > 0;
  return Object.keys(col).length > 0;
}
var enabled = () => {
  try {
    return kino.config.get(CONTRIBUTE_SETTING) !== false;
  } catch (_) {
    return true;
  }
};
var readAt = () => {
  const v = Number(getText(AT_KEY));
  return Number.isFinite(v) && v > 0 ? v : null;
};
function contribInfo() {
  return { on: enabled(), at: readAt() };
}
function buildSeed(sn, act) {
  const seed = {
    sn,
    userId: str5(act.userId),
    userToken: str5(act.userToken),
    jwtToken: str5(act.jwtToken || ""),
    mintedAt: Math.floor(Date.now() / 1e3)
  };
  for (const k of OPTIONAL_EXTRAS) {
    const v = act[k];
    if (typeof v === "string" && v !== "") seed[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) seed[k] = v;
  }
  return seed;
}
var running = false;
async function maybeContribute({ deadline: deadline2 = Infinity } = {}) {
  if (running) return null;
  running = true;
  try {
    if (!enabled()) {
      trace("skip", { why: "off" });
      return null;
    }
    const now = Date.now();
    const last = readAt();
    if (last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS) {
      trace("skip", { why: "rate" });
      return null;
    }
    const end = Math.min(now + TOTAL_MS, Number.isFinite(deadline2) ? deadline2 : Infinity);
    if (end - now < MIN_WINDOW_MS) {
      trace("skip", { why: "time" });
      return null;
    }
    return await within(end - now, async () => {
      if (!await portalReady()) {
        trace("skip", { why: "nokey" });
        return null;
      }
      setText(AT_KEY, String(now));
      const m = await mintAnonymous({ requestMs: REQUEST_MS, validateColumn: VALIDATE_COLUMN });
      if (!m.ok) {
        trace("mint", { ok: false, why: m.why, code: m.code });
        return null;
      }
      if (!hasRealData(m.col)) {
        trace("validate", { ok: false, why: "empty" });
        return null;
      }
      const seed = buildSeed(m.sn, m.act);
      const left = end - Date.now();
      if (left < 500) {
        trace("send", { ok: false, why: "time" });
        return null;
      }
      const r = await postSeed(seed, Math.min(REQUEST_MS, left));
      if (!r.ok) {
        trace("send", { ok: false, code: r.status });
        return null;
      }
      trace("done", { ok: 1, jwt: seed.jwtToken ? 1 : 0 });
      return seed;
    });
  } catch (_) {
    return null;
  } finally {
    running = false;
  }
}
var TRIAL_AT_KEY = "o2:contribTrialAt";
var TRIAL_OFF_KEY = "o2:contribTrialOff";
var TRIAL_BLOCKED_MS = 7 * 24 * 36e5;
var TRIAL_MIN_WINDOW_MS = 6e3;
var readStamp = (key) => {
  const v = Number(getText(key));
  return Number.isFinite(v) && v > 0 ? v : null;
};
var trialDue = (now) => {
  const last = readStamp(TRIAL_AT_KEY);
  if (last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS) return false;
  const off = readStamp(TRIAL_OFF_KEY);
  return !(off !== null && now < off && off - now <= TRIAL_BLOCKED_MS);
};
var seedDue = (now) => {
  const last = readAt();
  return !(last !== null && now - last >= 0 && now - last < CONTRIB_INTERVAL_MS);
};
async function maybeContributeTrial({ deadline: deadline2 = Infinity } = {}) {
  if (running) return false;
  running = true;
  try {
    if (!enabled()) {
      trace("trial_skip", { why: "off" });
      return false;
    }
    const now = Date.now();
    if (!trialDue(now)) {
      trace("trial_skip", { why: "rate" });
      return false;
    }
    const end = Math.min(now + TOTAL_MS, Number.isFinite(deadline2) ? deadline2 : Infinity);
    if (end - now < TRIAL_MIN_WINDOW_MS) {
      trace("trial_skip", { why: "time" });
      return false;
    }
    setText(TRIAL_AT_KEY, String(now));
    const r = await contribTrial(end);
    if (!r.ok) {
      if (r.status === "blocked") setText(TRIAL_OFF_KEY, String(now + TRIAL_BLOCKED_MS));
      trace("trial_send", { ok: false, code: r.status });
      return false;
    }
    trace("trial_done", { ok: r.contributed ? 1 : 0, why: r.reason || void 0 });
    return r.contributed;
  } catch (_) {
    return false;
  } finally {
    running = false;
  }
}
async function afterHome(homeStartedAt) {
  const deadline2 = Math.min(Date.now() + CONTRIB_WINDOW_MS, homeStartedAt + HOME_CONTRIB_END_MS);
  if (seedDue(Date.now())) {
    const before = getText(AT_KEY);
    const seed = await maybeContribute({ deadline: deadline2 });
    if (seed || getText(AT_KEY) !== before) return seed;
  }
  return await maybeContributeTrial({ deadline: deadline2 }) || null;
}

// src/devices.js
var TIMEOUT_MS = 4e3;
var MAX_ROWS = 12;
var MAX_NAME = 40;
var PLUGIN_NAMES = { xuper: "Xuper", "ultra-hd": "Ultra HD", "super-tv": "SuperTV" };
function pluginNames(ids) {
  const out = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw == null ? "" : raw).trim();
    if (!id) continue;
    const name = PLUGIN_NAMES[id.toLowerCase()] || id.slice(0, MAX_NAME);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}
var card = null;
function devicesNow() {
  return card && !card.hidden ? card : null;
}
function devicesAsked() {
  return card !== null;
}
function forgetDevices() {
  card = null;
}
async function loadDevices() {
  let r;
  try {
    r = await fetchDevices(TIMEOUT_MS);
  } catch (_) {
    r = { ok: false, status: "network" };
  }
  if (!r || !r.ok) {
    try {
      kino.log("devices: hidden (" + String(r && r.status) + ")");
    } catch (_) {
    }
    card = { hidden: true };
    return false;
  }
  const list = r.devices.filter((d) => d && typeof d === "object" && !Array.isArray(d)).slice(0, MAX_ROWS).map((d) => ({ current: d.current === true, names: pluginNames(d.plugins), lastSeen: Math.max(0, Number(d.lastSeen) || 0) }));
  card = { used: r.used, max: r.max, list };
  return true;
}

// src/screen.js
var HIDE_BUSY = [{ hide: "busy" }];
var TICK_HIDE_BUSY = { ui: { hidden: { busy: true } } };
var EMPTY_VIEW = { slides: [], rails: [], genres: [], all: [] };
var LC_FILL_MAX_TICKS = 8;
var LV_MAX_TICKS = 5;
var CLOCK_BUDGET_MS = 4e3;
function navName(v) {
  const s = String(v);
  return s === "deportes" || s === "vivo" || s === "config" ? s : "home";
}
function tabName(v) {
  const n = String(v == null ? "" : v).toLowerCase();
  return SECTIONS.some((s) => s.name === n) ? n : SECTIONS[0].name;
}
function todayStr() {
  try {
    const d = new Date(Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  } catch (_) {
    return "";
  }
}
var matchList = () => {
  const m = matches();
  return m ? m.matches : null;
};
function landing(cats, prefer) {
  if (!Array.isArray(cats) || !cats.length) return "";
  const hit = cats.find((c) => c && c.id === prefer);
  return String((hit || cats[0]).id);
}
async function chosen(want, cats, prefer) {
  const w = String(want || "");
  if (w && cats.some((c) => c.id === w)) return w;
  const to = w ? await exposedIdOf(w) : "";
  return to && cats.some((c) => c.id === to) ? to : landing(cats, prefer);
}
function liveTab(state2) {
  const nav = navName(state2.nav);
  if (nav === "vivo") return { kind: "vivo", stateKey: "liveCat", prefer: "v.co" };
  if (nav === "deportes" && state2.depTab === "canales") return { kind: "football", stateKey: "sportsCat", prefer: "v.sports" };
  return null;
}
async function liveTabData(tab, state2) {
  const { cats, missing } = await screenCategories(tab.kind);
  const cat = await chosen(state2[tab.stateKey], cats, tab.prefer);
  return { cats, missing, cat };
}
var countOf = (map, cat) => map && cat && Number(map[cat]) || 0;
async function liveView(tab, state2) {
  const { cats, missing, cat } = await liveTabData(tab, state2);
  const tried = !!(state2.lvTried && cat && state2.lvTried[cat]);
  const st = cat ? await screenList(cat) : { items: [], stale: false, code: true, failed: false, partial: false, refreshable: 0 };
  const down = st.failed && !st.partial;
  const timers = [];
  if (!st.code && !tried && !state2.lvStop && (st.items === null || st.partial || st.refreshable > 0)) timers.push({ ms: 1e3, event: "lvRefresh" });
  if (missing && !state2.lcTried) timers.push({ ms: 1e3, event: "lcFill" });
  return {
    cats,
    cat,
    timers,
    channels: st.items,
    shown: Math.min(LV_PAGE, Math.max(LV_STEP, Number(state2.lvShown) || LV_STEP)),
    page: Math.max(0, Math.floor(Number(state2.lvPage) || 0)),
    loading: st.items === null && !tried && !down,
    failed: st.items === null && (tried || down),
    offline: st.items !== null && st.stale && st.failed && !st.refreshable
  };
}
async function listProgress(cat) {
  const st = await screenList(cat);
  return {
    have: st.have || 0,
    partial: !!st.partial,
    refreshable: st.refreshable || 0,
    n: Array.isArray(st.items) ? st.items.length : 0,
    resume: st.resume || 0
  };
}
async function screen(arg) {
  const state2 = arg && arg.state || {};
  const device = arg && arg.device || "phone";
  if (!await currentBearer() && (state2.actError || !reloginPending())) return welcomeView({ error: state2.actError, device });
  const nav = navName(state2.nav);
  if (nav === "config") {
    const view2 = configView({
      version: PLUGIN_VERSION,
      device,
      ages: dataAges(),
      now: Date.now(),
      seeds: sessionStatus(),
      contrib: contribInfo(),
      devices: devicesNow()
    });
    return !devicesAsked() && !state2.devTried ? { ...view2, every: [{ ms: 1e3, event: "devices" }] } : view2;
  }
  if (nav === "deportes") {
    const depTab = state2.depTab === "canales" ? "canales" : "partidos";
    if (depTab === "canales") {
      const lv = await liveView(liveTab(state2), state2);
      return deportesView({
        depTab,
        cats: lv.cats,
        cat: lv.cat,
        channels: lv.channels,
        chLoading: lv.loading,
        chFailed: lv.failed,
        chOffline: lv.offline,
        timers: lv.timers,
        shown: lv.shown,
        page: lv.page,
        device
      });
    }
    return deportesView({
      depTab,
      matches: matchList(),
      failed: !!state2.matFail,
      depDate: state2.depDate,
      depView: state2.depView,
      today: todayStr(),
      now: Date.now(),
      device
    });
  }
  if (nav === "vivo") {
    const lv = await liveView(liveTab(state2), state2);
    return vivoView({
      cats: lv.cats,
      cat: lv.cat,
      channels: lv.channels,
      loading: lv.loading,
      failed: lv.failed,
      offline: lv.offline,
      timers: lv.timers,
      shown: lv.shown,
      page: lv.page,
      device
    });
  }
  const tab = tabName(state2.tab);
  const v2 = catalog();
  const view = v2 ? sectionView(v2, tab) || EMPTY_VIEW : fallbackSectionView(tab);
  return catalogView({ tab, view, fTag: state2.fTag, device, failed: !!state2.catFail });
}
async function tryFallback(tab) {
  if (catalog() || fallbackSectionView(tab)) return;
  if (!await currentBearer()) return;
  try {
    await loadFallbackSection(tab);
  } catch (_) {
  }
}
function failFlags(tab) {
  return { catFail: !catalog() && !fallbackSectionView(tab), matFail: !matches() };
}
async function relogin() {
  if (await currentBearer() || !reloginPending()) return {};
  try {
    await ensureBearer();
    return { auth: Date.now(), actError: null };
  } catch (e) {
    const code = e && e.code;
    try {
      kino.log("screen: sign-in again failed: " + (code || e && e.message || e));
    } catch (_) {
    }
    if (isTokenMissing(e)) {
      forgetRelogin();
      reportActivate(e);
      return { actError: "update" };
    }
    if (code === "permission_denied" || code === "not_available" || code === "bad_request") {
      forgetRelogin();
      reportActivate(e);
      return { actError: true };
    }
    return {};
  }
}
async function onEvent(e, val, state2) {
  switch (e) {
    case "open": {
      forgetDevices();
      const auth = await relogin();
      const [r] = await Promise.all([revalidate({ catalog: true, matches: true }), trialAtOpen()]);
      const tab = tabName(state2.tab);
      const hadFallback = !!fallbackSectionView(tab);
      await tryFallback(tab);
      const flags = failFlags(tab);
      const patch = { ...auth };
      if (navName(state2.nav) === "config" && state2.devTried) patch.devTried = null;
      if (r.changed || !hadFallback && fallbackSectionView(tab)) patch.rev = r.rev;
      if (flags.catFail) patch.catFail = true;
      if (flags.matFail) patch.matFail = true;
      return Object.keys(patch).length ? { state: patch } : {};
    }
    case "activate":
      try {
        await ensureBearer();
        return { state: { actError: null } };
      } catch (e2) {
        reportActivate(e2);
        return { state: { actError: isTokenMissing(e2) ? "update" : true } };
      }
    case "disconnect":
      try {
        await clearBearer();
      } catch (_) {
      }
      return { state: {} };
    case "seedChange": {
      const r = await manualChange();
      return { toast: seedChangeToast(r), state: { sRev: Date.now() }, ui: HIDE_BUSY };
    }
    case "devices":
      if (navName(state2.nav) === "config") await loadDevices();
      return { state: { devTried: true, devRev: Date.now() } };
    case "contrib":
      return { config: { contributeSeeds: val === true || val === "true" }, state: { cRev: Date.now() } };
    case "nav": {
      const nav = navName(val);
      const patch = { nav };
      if (nav === "deportes" && state2.depTab !== "canales") patch.liveSig = liveSignature(matchList(), Date.now());
      if (nav === "config" && navName(state2.nav) !== "config") {
        forgetDevices();
        if (state2.devTried) patch.devTried = null;
      }
      return { state: patch, ui: HIDE_BUSY };
    }
    case "tab": {
      const tab = tabName(val);
      await tryFallback(tab);
      return { state: { tab, fTag: "" } };
    }
    case "fTag":
      return { state: { fTag: String(val || "") } };
    case "search": {
      const typed = [val, state2.inputs && state2.inputs[SEARCH_FIELD]].find((x) => (typeof x === "string" || typeof x === "number") && String(x).trim());
      const q = String(typed == null ? "" : typed).trim().slice(0, 200);
      return q ? { go: { search: { q } }, ui: [{ close: "searchSheet" }] } : {};
    }
    case "liveCat":
    case "sportsCat": {
      const cat = String(val == null ? "" : val);
      const patch = { [e]: cat, lvShown: null, lvPage: null };
      const st = await screenList(cat);
      if (st.items === null) {
        let ok = false;
        try {
          ok = await loadList(cat, { bounds: PICK_BOUNDS });
        } catch (_) {
          ok = false;
        }
        if (!ok) patch.lvTried = { ...state2.lvTried || {}, [cat]: true };
      }
      return { state: patch, ui: HIDE_BUSY };
    }
    case "lvRefresh": {
      const tab = liveTab(state2);
      if (!tab) return { state: { ...TICK_HIDE_BUSY } };
      const { cat } = await liveTabData(tab, state2);
      if (!cat) return { state: { ...TICK_HIDE_BUSY } };
      const before = await listProgress(cat);
      const bounds = before.have === 0 || before.partial || before.resume > 0 ? TICK_LOAD_BOUNDS : TICK_BOUNDS;
      try {
        await loadList(cat, { bounds });
      } catch (_) {
      }
      const after = await listProgress(cat);
      const n = countOf(state2.lvN, cat) + 1;
      const progressed = after.have > before.have || after.refreshable < before.refreshable || after.n > before.n;
      const done = !(after.partial || after.refreshable > 0) || !progressed || n >= LV_MAX_TICKS;
      const patch = done ? { lvTried: { ...state2.lvTried || {}, [cat]: true } } : { lvN: { ...state2.lvN || {}, [cat]: n } };
      return { state: { ...patch, lvRev: Date.now(), ...TICK_HIDE_BUSY } };
    }
    case "lvMore": {
      const shown = Math.min(LV_PAGE, (Number(state2.lvShown) || LV_STEP) + LV_STEP);
      return shown === Number(state2.lvShown) ? {} : { state: { lvShown: shown } };
    }
    case "lvPage": {
      const page = Math.max(0, Math.floor(Number(val) || 0));
      return { state: { lvPage: page, lvShown: null }, ui: HIDE_BUSY };
    }
    case "lcFill": {
      const { n, left } = await fillScreenCategories();
      const ticks = (Number(state2.lcN) || 0) + 1;
      const done = left === 0 || ticks >= LC_FILL_MAX_TICKS;
      return { state: { lcN: ticks, ...n ? { lcRev: Date.now() } : {}, ...done ? { lcTried: true } : {}, ...TICK_HIDE_BUSY } };
    }
    case "depDate":
      return { state: { depDate: String(val) } };
    case "depView":
      return { state: { depView: val === "todos" ? "todos" : "ligas" } };
    case "depTab": {
      const depTab = val === "canales" ? "canales" : "partidos";
      const patch = { depTab };
      if (depTab !== "canales") patch.liveSig = liveSignature(matchList(), Date.now());
      return { state: patch, ui: HIDE_BUSY };
    }
    case "clock": {
      const r = await revalidate({ matches: true, budgetMs: CLOCK_BUDGET_MS });
      const sig = liveSignature(matchList(), Date.now());
      if (!r.changed && sig === state2.liveSig) return {};
      return { state: { liveSig: sig, ...r.changed ? { rev: r.rev } : {} } };
    }
    case "reload": {
      const r = await revalidate({ catalog: true, force: true });
      const tab = tabName(state2.tab);
      await tryFallback(tab);
      return { state: { rev: r.rev, catFail: failFlags(tab).catFail }, ui: HIDE_BUSY };
    }
    case "reloadDep": {
      const r = await revalidate({ matches: true, force: true });
      return { state: { rev: r.rev, matFail: !matches(), liveSig: liveSignature(matchList(), Date.now()) }, ui: HIDE_BUSY };
    }
    case "reloadVivo": {
      const tab = liveTab(state2);
      const patch = { lvRev: Date.now(), lcTried: null, lcN: null, lvStop: null };
      if (tab) {
        const { cat } = await liveTabData(tab, state2);
        if (cat) {
          try {
            await loadList(cat, { force: true, bounds: PICK_BOUNDS });
          } catch (_) {
          }
          patch.lvTried = { ...state2.lvTried || {}, [cat]: true };
          patch.lvN = { ...state2.lvN || {}, [cat]: 0 };
        }
      }
      return { state: patch, ui: HIDE_BUSY };
    }
    default:
      return {};
  }
}
function seedChangeToast(r) {
  const result = r && r.result;
  const n = Math.max(1, Number(r && r.min) || 1);
  const [text2, textEn, role] = result === "ok" ? ["Semilla cambiada", "Seed changed", "success"] : result === "hour" ? [
    `Ya pediste muchas sesiones de respaldo esta hora; podr\xE1s pedir otra en ${n} min.`,
    `You asked for many backup sessions this hour; you can ask for another in ${n} min.`,
    "warning"
  ] : result === "used" ? [
    `Ya se usaron las sesiones de respaldo de esta hora; podr\xE1s pedir otra en ${n} min.`,
    `This hour's backup sessions are used up; you can ask for another in ${n} min.`,
    "warning"
  ] : result === "soon" ? [
    `Acabas de pedir una sesi\xF3n de respaldo; podr\xE1s pedir otra en ${n} min.`,
    `You just asked for a backup session; you can ask for another in ${n} min.`,
    "warning"
  ] : result === "offline" ? ["Sin conexi\xF3n, reintenta", "No connection, try again", "error"] : result === "nobearer" ? [sessionExpiredText("es"), sessionExpiredText("en"), "warning"] : ["Ahora no hay sesiones de respaldo libres; int\xE9ntalo en unos minutos.", "No backup sessions are free right now; try again in a few minutes.", "warning"];
  return { text: lang() === "en" ? textEn : text2, textEn, role };
}
async function screenEvent(ev) {
  const e = ev && (ev.name != null ? ev.name : ev.event);
  const val = ev && (ev.value != null ? ev.value : ev.arg);
  const state2 = ev && ev.state || {};
  try {
    return await onEvent(e, val, state2);
  } catch (err) {
    try {
      kino.log("screenEvent " + e + " failed: " + (err && (err.code || err.message) || err));
    } catch (_) {
    }
    if (e === "lvRefresh") return { state: { lvStop: true, ...TICK_HIDE_BUSY } };
    if (e === "lcFill") return { state: { lcTried: true, ...TICK_HIDE_BUSY } };
    if (e === "devices") return { state: { devTried: true } };
    return { ui: HIDE_BUSY };
  }
}

// src/upgrade.js
var _done = false;
async function upgradeOnce() {
  if (_done) return 0;
  _done = true;
  try {
    const n = sweepOld();
    if (n > 0 && await markRelogin()) {
      try {
        kino.log("upgrade: data of an older version removed; the screen signs in on its next opening");
      } catch (_) {
      }
    }
    return n;
  } catch (_) {
    return 0;
  }
}

// src/plugin.js
async function begin(name) {
  beginCall();
  callFor(name);
  await upgradeOnce();
}
async function screen2(arg) {
  await begin("screen");
  return screen(arg);
}
async function screenEvent2(ev) {
  await begin("screenEvent");
  return screenEvent(ev);
}
async function home2() {
  await begin("home");
  const startedAt2 = Date.now();
  const rows = await home();
  try {
    Promise.resolve(afterHome(startedAt2)).catch(() => {
    });
  } catch (_) {
  }
  return rows;
}
async function search2(query) {
  await begin("search");
  try {
    return await search(query);
  } catch (_) {
    return [];
  }
}
async function episodes2(ref) {
  await begin("episodes");
  return episodes(ref);
}
async function details2(ref) {
  await begin("details");
  return details(ref);
}
async function resolve3(ref, options) {
  await begin("resolve");
  return resolve2(ref, options);
}
async function prepare2(ref) {
  await begin("prepare");
  return prepare(ref);
}
async function browse2(ref, cursor) {
  await begin("browse");
  return browse(ref, cursor);
}
async function categories3() {
  await begin("categories");
  return categories2();
}
async function migrate3(input) {
  await begin("migrate");
  return migrate2(input);
}
async function liveCategories2() {
  await begin("liveCategories");
  return liveCategories();
}
async function liveChannels2(arg) {
  await begin("liveChannels");
  return liveChannels(arg);
}
export {
  browse2 as browse,
  categories3 as categories,
  details2 as details,
  episodes2 as episodes,
  home2 as home,
  liveCategories2 as liveCategories,
  liveChannels2 as liveChannels,
  migrate3 as migrate,
  prepare2 as prepare,
  resolve3 as resolve,
  screen2 as screen,
  screenEvent2 as screenEvent,
  search2 as search
};
