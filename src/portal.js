// Transport for the Magis portal: encrypted POST, host failover, pacing. Port of MagisPortalClient.
import {
  PORTAL_CODE, SPKG_VER, APK_VER_HEADER, USER_AGENT, CONTENT_TYPE, RATE_LIMIT_MS,
  REQUEST_TIMEOUT_MS, DEVICE_FIXED,
} from "./config.js";

const MAX_SLEEP_MS = 5000; // kino.sleep ceiling

/** The portal answered with a non-zero returnCode: final, never retried on another host. */
export class PortalError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PortalError";
    this.code = code;
    this.message = message || "";
  }
}

export function mapPortalError(code, message, kino) {
  const msg = typeof message === "string" ? message : "";
  if (code === "portal100004" || msg.includes("不存在")) {
    return kino.error("not_found", "No se encontró en Xuper");
  }
  if (code === "portal100024") {
    return kino.error("geo_blocked", "Este contenido no está disponible en tu región");
  }
  if (code === "aaa100027" || code === "aaa100028") {
    return kino.error("auth_required", "Configura Xuper en Ajustes ▸ Plugins");
  }
  return kino.error("unavailable", "Xuper no está disponible ahora");
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function makePortal({ kino, crypto, config, clock, snProvider }) {
  let preferredHost = null;
  let lastCallMs = null;

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
    const { baseFields = true, userId = "", userToken = "", sn = null } = opts;
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

    await waitTurn();

    let lastError = null;
    for (const host of hostOrder()) {
      let answer;
      try {
        const res = await kino.fetch(`https://${host}/api/portalCore/${path}`, {
          method: "POST", headers, body: wire, cookies: false, timeoutMs: REQUEST_TIMEOUT_MS,
        });
        answer = JSON.parse(res.text());
        if (!isObject(answer)) throw new Error("respuesta del portal no es un objeto");
        preferredHost = host;
        const rc = answer.returnCode;
        const code = rc === undefined || rc === null ? "" : String(rc);
        if (code !== "" && code !== "0") {
          const em = answer.errorMessage;
          // A thrown PortalError must escape the catch below untouched.
          answer = { portalFailure: new PortalError(code, typeof em === "string" && em.trim() ? em : "") };
        } else if (typeof answer.data === "string" && answer.data !== "") {
          const inner = JSON.parse(crypto.decryptBlob(answer.data));
          if (!isObject(inner)) throw new Error("datos del portal no son un objeto");
          answer = { ok: inner };
        } else {
          answer = { ok: answer };
        }
      } catch (e) {
        lastError = e;
        // Debug trail only: one truncated line, never the wire, token or headers.
        try { kino.log("portal " + path + ": " + String(e && e.message).replace(/\s+/g, " ").slice(0, 200)); } catch (_) {}
        continue;
      }
      if (answer.portalFailure) throw answer.portalFailure;
      return answer.ok;
    }
    // Fixed text: the underlying error may echo the URL (host) and must not reach the caller.
    const detail = lastError === null
      ? "sin hosts configurados" : "No se pudo contactar a Xuper; intenta de nuevo en un momento";
    throw kino.error("unavailable", detail);
  }

  return { call };
}
