// Transport for the Magis portal: encrypted POST, host failover, pacing. Port of MagisPortalClient.
import {
  PORTAL_CODE, SPKG_VER, APK_VER_HEADER, USER_AGENT, CONTENT_TYPE, RATE_LIMIT_MS,
  REQUEST_TIMEOUT_MS, DEVICE_FIXED,
} from "./config.js";
import { isObject } from "./util.js";
import { trace, errCode } from "./trace.js";

const MAX_SLEEP_MS = 5000; // kino.sleep ceiling
const MAX_REQUEST_MS = 30000; // kino.fetch ceiling
const CONTACT_FAILED = "No se pudo contactar a Xuper; intenta de nuevo en un momento";

/** The portal answered with a non-zero returnCode: final, never retried on another host. */
export class PortalError extends Error {
  constructor(code, message) {
    // No text from the portal: the code is the message (never an empty one).
    super(message || code);
    this.name = "PortalError";
    this.code = code;
    this.message = message || code;
  }
}

// What the person's OWN linked account's dead session (after every re-login) or `aaa100083` (the
// account logged in on another device) tells them, as the error's `userMessage`: the account, not
// Xuper or the title, is what needs them. The native MagisSession.accountProblemMessage sentences,
// pointing to the plugin's own settings tab instead of the app's old account screen. The SHARED
// account never gets them: nobody can re-link it (Ruling R33: it falls to anonymous / seeds).
export const SETTINGS_PLACE = "Ajustes ▸ Xuper";
export const ACCOUNT_SESSION_LOST =
  `Tu sesión de Xuper se cerró y no pudimos volver a entrar con tu cuenta. Vuelve a vincularla en ${SETTINGS_PLACE}.`;
export const ACCOUNT_IN_USE_ELSEWHERE_TEXT =
  "Tu cuenta de Xuper se abrió en otro dispositivo, y solo puede usarse en uno a la vez. " +
  `Vuelve a intentarlo, o vincúlala de nuevo en ${SETTINGS_PLACE}.`;
export const ACCOUNT_IN_USE_ELSEWHERE = "aaa100083";
export const SESSION_DEAD_CODES = new Set(["aaa100027", "aaa100028"]);
/** The account sentence for `code` on the person's own linked account, or null. */
export function accountProblemMessage(code) {
  if (SESSION_DEAD_CODES.has(code)) return ACCOUNT_SESSION_LOST;
  if (code === ACCOUNT_IN_USE_ELSEWHERE) return ACCOUNT_IN_USE_ELSEWHERE_TEXT;
  return null;
}

// `portal100006` ("剧集不存在"): the series behind a chapter is gone (native 0.9.45, ERRORES-AO3, a
// "Seguir viendo" card). Word for word the native XuperErrorMapping sentences, as `userMessage`.
export const EPISODE_GONE = "Este capítulo ya no está disponible.";
/** [EPISODE_GONE] when what was asked is the series' chapter list rather than one chapter. */
export const SERIES_GONE = "Esta serie ya no está disponible.";

/** A kino error whose `userMessage` is `sentence` (what the person reads); `message` is for the log. */
export const told = (kino, code, message, sentence) => kino.error(code, message, { userMessage: sentence });

const GENERIC = "Xuper no está disponible ahora";

/**
 * `goneMessage`: what a `portal100006` says ([EPISODE_GONE] for a playback, [SERIES_GONE] for a listing).
 * `accountLinked`: the person's own account's session code (still dead after the re-logins, or open
 * on another device) gets the account sentence. `sharedAccount`: the shared pair's session codes
 * are the generic `unavailable` (nothing the person can re-link).
 */
export function mapPortalError(code, message, kino, { accountLinked = false, sharedAccount = false, goneMessage = EPISODE_GONE } = {}) {
  const msg = typeof message === "string" ? message : "";
  const accountText = accountLinked ? accountProblemMessage(code) : null;
  if (accountText) return told(kino, "auth_required", `cuenta propia: ${code}`, accountText);
  if (code === "portal100006") return told(kino, "not_found", `portal100006: ${goneMessage === SERIES_GONE ? "serie" : "capítulo"} borrado`, goneMessage);
  if (code === "portal100004" || msg.includes("不存在")) {
    return kino.error("not_found", "No se encontró en Xuper");
  }
  if (code === "portal100024") {
    return kino.error("geo_blocked", "Este contenido no está disponible en tu región");
  }
  if (sharedAccount && (SESSION_DEAD_CODES.has(code) || code === ACCOUNT_IN_USE_ELSEWHERE)) {
    return kino.error("unavailable", `${GENERIC} (shared session: ${code})`);
  }
  if (SESSION_DEAD_CODES.has(code)) {
    return kino.error("auth_required", "Configura Xuper en Ajustes ▸ Plugins");
  }
  return kino.error("unavailable", GENERIC);
}

// The app's time cap per call (guide: 20 s for resolve/home/browse/episodes, 15 s for search), minus
// a margin for the rate-limit wait and the work after the last answer.
export const CALL_BUDGET_MS = {
  home: 20_000, browse: 20_000, episodes: 20_000, resolve: 20_000, search: 15_000, liveCategories: 20_000, liveChannels: 20_000,
  section: 20_000, categories: 20_000,
};
const BUDGET_MARGIN_MS = 2_000;
/** The absolute instant (injected clock) by which a call that starts now must stop asking the portal. */
export const callDeadline = (clock, budgetMs) => clock.now() + budgetMs - BUDGET_MARGIN_MS;

/**
 * portal.call opts for a session view from `withValidSession`: the stored session's view has
 * `sn: null` (the device's own sn) and no deadline; a per-call seed view carries the seed's sn and
 * the call's deadline. Only present fields are added, so a stored-session call is the same as before.
 */
export const viewOpts = ({ userId, userToken, sn, deadline }) => ({
  baseFields: true, userId, userToken,
  ...(typeof sn === "string" && sn !== "" ? { sn } : {}),
  ...(typeof deadline === "number" ? { deadline } : {}),
});

// What a body (or its `data`) LOOKS like, for the decrypt-fail breadcrumb: never any of its content.
// One pass with charCodeAt, no regex: a body can be megabytes (see crypto.js).
export function shapeOf(s) {
  if (typeof s !== "string") return "none";
  if (s === "") return "empty";
  const first = s.charCodeAt(0);
  if (first === 0x1f) return "gzip";
  const t = s.trimStart();
  if (t === "") return "blank";
  if (t[0] === "<") return "html";
  if (t[0] === "{" || t[0] === "[") return "json";
  // Hex in either case; base64 (standard or url alphabet) with line breaks at most (MIME wraps it).
  let hex = true, upperHex = false, b64 = true, wrapped = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const digit = c >= 48 && c <= 57, lower = c >= 97 && c <= 122, upper = c >= 65 && c <= 90;
    const newline = c === 10 || c === 13;
    if (newline) wrapped = true;
    if (!(digit || (c >= 97 && c <= 102))) {
      if (c >= 65 && c <= 70) upperHex = true; else hex = false;
    }
    if (!(digit || lower || upper || c === 43 || c === 47 || c === 61 || c === 45 || c === 95 || newline)) b64 = false;
    if (!hex && !b64) return "text";
  }
  if (hex) return (upperHex ? "hex-upper" : "hex") + (s.length % 2 === 0 ? "" : "-odd");
  return wrapped ? "b64-ws" : "b64";
}

// The response's content-type as a class, never the header itself.
function contentClass(res) {
  const h = res !== null && typeof res === "object" && res.headers !== null && typeof res.headers === "object" ? res.headers : null;
  const ct = h && typeof h["content-type"] === "string" ? h["content-type"].toLowerCase() : "";
  if (ct === "") return "none";
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.startsWith("text/")) return "text";
  return "other";
}

function gzipped(res, text) {
  const h = res !== null && typeof res === "object" && res.headers !== null && typeof res.headers === "object" ? res.headers : null;
  const enc = h && typeof h["content-encoding"] === "string" ? h["content-encoding"].toLowerCase() : "";
  return enc.includes("gzip") || (typeof text === "string" && text.charCodeAt(0) === 0x1f);
}

/**
 * `modeOf`: the session mode for breadcrumbs only (anon / shared / own / seed / none), never which
 * account or device.
 */
export function makePortal({ kino, crypto, config, clock, snProvider, modeOf = () => "?" }) {
  let preferredHost = null;
  let lastCallMs = null;
  // Decrypt failures in a row per path (reset by that path's next good answer): the breadcrumb's `attempt`.
  const decryptFails = new Map();

  const hostOrder = () => {
    const hosts = config.hosts || [];
    if (preferredHost === null) return hosts;
    return [preferredHost, ...hosts.filter((h) => h !== preferredHost)];
  };

  // Slots are taken one caller at a time (promise chain): parallel calls queue up, each measures
  // from the previous one's slot and reserves its own before the next caller looks.
  let slotTail = Promise.resolve();
  function waitTurn() {
    const run = slotTail.then(async () => {
      const now = clock.now();
      if (lastCallMs !== null) {
        const wait = Math.min(MAX_SLEEP_MS, Math.ceil(RATE_LIMIT_MS - (now - lastCallMs)));
        if (wait > 0) await kino.sleep(wait);
      }
      // Slot taken at the moment the request actually starts (after any wait).
      lastCallMs = clock.now();
    });
    slotTail = run.then(() => {}, () => {});
    return run;
  }

  function deviceDict(sn) {
    return {
      ...DEVICE_FIXED,
      apkVersion: config.apkVersion,
      sysVersion: SPKG_VER,
      appId: config.appId,
      sn: sn ?? snProvider(),
    };
  }

  async function call(path, bean = {}, opts = {}) {
    const { baseFields = true, userId = "", userToken = "", sn = null, timeoutMs, deadline } = opts;
    // Optional bounds for callers with a cap of their own: a per-request timeout (default
    // REQUEST_TIMEOUT_MS, clamped like kino.fetch) and an absolute `deadline` on the injected
    // clock that no request, failover included, may run past.
    const requested = Math.trunc(Number(timeoutMs));
    const perRequest = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_REQUEST_MS) : REQUEST_TIMEOUT_MS;
    const body = {
      ...(baseFields ? { portalCode: PORTAL_CODE, userId, userToken } : {}),
      ...bean,
      ...deviceDict(sn),
    };
    const wire = crypto.encryptBody(JSON.stringify(body));
    const headers = {
      apk: config.appId,
      apkVer: APK_VER_HEADER,
      spkgVer: SPKG_VER,
      "User-Agent": USER_AGENT,
      "Content-Type": CONTENT_TYPE,
    };

    const outOfTime = () => typeof deadline === "number" && Math.floor(deadline - clock.now()) < 1;
    // A deadline already gone: the plugin's own answer, no request at all.
    if (outOfTime()) {
      trace(kino, "portal", "deadline", { path });
      throw kino.error("unavailable", CONTACT_FAILED);
    }
    await waitTurn();

    let lastError = null;
    const order = hostOrder();
    for (let i = 0; i < order.length; i++) {
      const host = order[i];
      let requestMs = perRequest;
      if (typeof deadline === "number") {
        const left = Math.floor(deadline - clock.now());
        if (left < 1) { trace(kino, "portal", "deadline", { path, i }); break; }
        // The time left is shared with the hosts still to try, so a black-holed host cannot use it
        // all and the failover still reaches the next one; the last host gets whatever is left.
        const remaining = order.length - i;
        requestMs = Math.min(perRequest, remaining > 1 ? Math.ceil(left / remaining) : left);
      }
      let answer;
      // How far this host's answer got, for the decrypt-fail breadcrumb: fetch, body, data, inner.
      let stage = "fetch";
      let res = null, bodyText = null;
      try {
        res = await kino.fetch(`https://${host}/api/portalCore/${path}`, {
          method: "POST", headers, body: wire, cookies: false, timeoutMs: requestMs,
        });
        stage = "body";
        bodyText = res.text();
        answer = JSON.parse(bodyText);
        if (!isObject(answer)) throw new Error("respuesta del portal no es un objeto");
        if (i > 0) trace(kino, "portal", "failover", { path, to: i });
        preferredHost = host;
        const rc = answer.returnCode;
        const code = rc === undefined || rc === null ? "" : String(rc);
        if (code !== "" && code !== "0") {
          const em = answer.errorMessage;
          // A thrown PortalError must escape the catch below untouched.
          answer = { portalFailure: new PortalError(code, typeof em === "string" && em.trim() ? em : "") };
        } else if (typeof answer.data === "string" && answer.data !== "") {
          stage = "data";
          const plain = crypto.decryptBlob(answer.data);
          stage = "inner";
          const inner = JSON.parse(plain);
          if (!isObject(inner)) throw new Error("datos del portal no son un objeto");
          answer = { ok: inner };
        } else if (isObject(answer.data)) {
          answer = { ok: answer.data }; // sent unencrypted: still the data, not the envelope
        } else if (answer.data === undefined || answer.data === null || answer.data === "") {
          answer = { ok: answer }; // an answer with no data (sendEmailVerifyCode, loginOut...)
        } else {
          stage = "data";
          throw new Error("datos del portal de un tipo inesperado"); // this host's answer is no good
        }
      } catch (e) {
        lastError = e;
        // The host's INDEX and the error's code, never its message: a fetch error names the host or the url.
        trace(kino, "portal", "host_fail", { path, i, why: errCode(e) });
        if (stage !== "fetch") decryptFail(path, i, stage, res, bodyText, answer, e);
        continue;
      }
      decryptFails.delete(path);
      if (answer.portalFailure) {
        trace(kino, "portal", "rc", { path, code: answer.portalFailure.code });
        throw answer.portalFailure;
      }
      return answer.ok;
    }
    // Fixed text: the underlying error may echo the URL (host) and must not reach the caller.
    if (order.length > 0) trace(kino, "portal", "all_fail", { path, n: order.length });
    throw kino.error("unavailable", order.length === 0 ? "sin hosts configurados" : CONTACT_FAILED);
  }

  /**
   * One `xuper:portal decrypt-fail` line for an answer that came back but could not be read: the
   * SHAPE of what the host sent (status, content-type class, lengths, hex / base64 / json / html /
   * empty, gzip), the session mode and how many times in a row this path failed so. Never the body,
   * the host or a token. Never throws.
   */
  function decryptFail(path, i, at, res, bodyText, answer, e) {
    try {
      const attempt = (decryptFails.get(path) || 0) + 1;
      decryptFails.set(path, attempt);
      const data = at === "body" || !isObject(answer) ? undefined : answer.data;
      let mode = "?";
      try { mode = String(modeOf()); } catch (_) { /* breadcrumb only */ }
      trace(kino, "portal", "decrypt-fail", {
        path, i, at,
        status: res !== null && typeof res === "object" && typeof res.status === "number" ? res.status : -1,
        ctype: contentClass(res),
        len: typeof bodyText === "string" ? bodyText.length : -1,
        shape: shapeOf(at === "body" ? bodyText : data),
        dlen: typeof data === "string" ? data.length : -1,
        gzip: gzipped(res, bodyText),
        mode, attempt, why: errCode(e),
      });
    } catch (_) { /* a breadcrumb never fails a call */ }
  }

  return { call };
}
