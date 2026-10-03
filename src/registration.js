// Creating a Xuper account from Ajustes: a port of the native MagisSession.sendRegistrationCode /
// confirmRegistration. The code is asked for with a SEPARATE temporary device so the person's own
// stored session and sn are never touched; only a fully confirmed registration replaces them.
import { PortalError } from "./portal.js";
import { PASSWORD_SALT, FIXED_MAC } from "./config.js";
import { activateBean, makeFingerprint, snFrom, blank } from "./device.js";

const PENDING_KEY = "pendingRegistration";
const PENDING_TTL_MS = 30 * 60_000; // the code is useless after a while: the device goes with it
const SEND_FAILED = "No se pudo enviar el código: revisa el email";
const BOUND_BUT_NOT_IN = "Cuenta creada. Toca Iniciar sesión para entrar.";
const NOT_SAVED = "No se pudo guardar el pedido; inténtalo de nuevo";
const CONFIRM_FAILED = "Código inválido o cuenta ya registrada";

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

export function makeRegistration({ kino, portal, session, clock }) {
  const fingerprint = makeFingerprint(kino);

  // A portal refusal reads the native text; a kino error (network, bounds) passes; a bug is fixed text.
  const failure = (e, text) => {
    if (e instanceof PortalError) return kino.error("unavailable", text);
    if (e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_")) return e;
    try { kino.log("xuper registration: " + String((e && e.name) || "error")); } catch (_) { /* no log */ }
    return kino.error("unavailable", "Xuper no está disponible ahora");
  };

  /**
   * The temporary device kept for `email`, or null (never asked, expired, another email, unreadable).
   * It lives in kino.storage with a ttl, so it also survives the app being closed between steps.
   */
  function pendingFor(email) {
    try {
      const raw = kino.storage.get(PENDING_KEY);
      const o = raw === null || raw === undefined ? null : JSON.parse(raw);
      if (!o || typeof o !== "object" || blank(o.userToken) || blank(o.sn) || str(o.email) !== email) return null;
      return { userId: str(o.userId), userToken: str(o.userToken), sn: str(o.sn), email: str(o.email), at: typeof o.at === "number" ? o.at : null };
    } catch (_) { return null; }
  }
  // A storage failure (quota) must never fail an action: the code was already sent.
  const savePending = (p) => {
    try { kino.storage.set(PENDING_KEY, JSON.stringify(p), { ttlMs: PENDING_TTL_MS }); return true; } catch (_) { return false; }
  };
  const dropPending = () => { try { kino.storage.remove(PENDING_KEY); } catch (_) { /* ignored */ } };

  /** Mints a temporary device and asks the portal to email `email` a code; keeps the device. */
  async function sendRegistrationCode(email, bounds = {}) {
    await null;
    try {
      const mint = await portal.call("v3/snToken", fingerprint(), { baseFields: false, ...bounds });
      if (blank(mint && mint.snToken)) throw new PortalError("snToken_failed", "el portal no devolvió snToken");
      const snToken = str(mint.snToken);
      const sn = snFrom(kino, mint, snToken);
      const act = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn, ...bounds });
      if (blank(act && act.userToken)) throw new PortalError("active_sin_token", "activación sin userToken");
      const pending = { userId: str(act.userId), userToken: str(act.userToken), sn, email, at: clock.now() };
      await portal.call("v2/sendEmailVerifyCode",
        { email, type: "1", userId: pending.userId, userToken: pending.userToken }, { baseFields: false, sn, ...bounds });
      // The code is out, but without the device the person could never confirm it: say so.
      if (!savePending(pending)) throw kino.error("unavailable", NOT_SAVED);
      return pending;
    } catch (e) { throw failure(e, SEND_FAILED); }
  }

  /** validate -> bind -> login on the pending device; only on full success is the session replaced. */
  async function confirmRegistration(pending, code, password, bounds = {}) {
    await null;
    const { email, userId, userToken, sn } = pending;
    const pwd = kino.crypto.hash("md5", password + PASSWORD_SALT);
    const opts = { baseFields: false, sn, ...bounds };
    let bound = false;
    try {
      await portal.call("v2/validateVerifyCode", { type: "1", email, verifyCode: code, userToken, userId }, opts);
      await portal.call("v2/bindEmail", { email, pwd, type: "1", userId, userToken }, opts);
      bound = true;
      const j = await portal.call("v8/login", {
        accountType: "2", userName: email, password: pwd, type: "1", macAddr: FIXED_MAC, areaCode: "",
        verificationCode: "", verificationToken: "", matadata: "", signdata: "", channel: "default",
      }, opts);
      if (blank(j && j.userToken)) throw new PortalError("login_sin_token", "login sin userToken");
      await session.adoptSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn });
    } catch (e) {
      // The account exists now: the old code is spent, so the pending device is useless.
      if (bound) { dropPending(); throw kino.error("unavailable", BOUND_BUT_NOT_IN); }
      throw failure(e, CONFIRM_FAILED);
    }
    dropPending();
  }

  return { sendRegistrationCode, confirmRegistration, pendingFor };
}
