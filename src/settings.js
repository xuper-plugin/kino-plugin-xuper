// The account tab of Ajustes: the status line, the action buttons and the check that runs before
// the person's email and password are saved. The account itself is NOT stored here: it is the
// plugin's own settings (`kino.config`), which only the person can edit.
const STATUS_MAX = 200;
const MESSAGE_MAX = 300;

const SEEDS_BANNER = "Por ahora no hay sesiones disponibles para tu zona; vuelve a intentar en un rato o toca Actualizar semillas";
const LOGOUT_MESSAGE = "Sesión cerrada. Borra tu correo y contraseña de estos ajustes para que no se vuelva a iniciar sesión sola.";

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const clip = (text, max) => (text.length <= max ? text : text.slice(0, max - 1) + "…");
// The session already turns a refused credential into this; a raw PortalError counts as one too.
const refusedCredentials = (e) => e !== null && typeof e === "object" && (e.name === "KinoError_auth_required" || e.name === "PortalError");
const isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");

export function makeSettings({ kino, session }) {
  // Kino errors (already Spanish, already free of secrets) pass; anything else is a fixed text, so
  // an underlying message that might echo the password never reaches the person.
  const surface = (e) => {
    if (isKinoError(e)) return e;
    try { kino.log("xuper settings: " + String((e && e.name) || "error")); } catch (_) { /* no log */ }
    return kino.error("unavailable", "Xuper no está disponible ahora");
  };

  const savedAccount = () => ({ email: str(kino.config.get("email")).trim(), password: str(kino.config.get("password")).trim() });

  /** `{ status }`: one line of at most a few short sentences; never throws. */
  async function settingsStatus() {
    await null;
    try {
      const account = session.kind() === "account";
      const parts = [account ? `Conectado como ${savedAccount().email}` : "Sin cuenta: sesión anónima"];
      if (!account && session.regionBlocked()) {
        const n = session.seedPool().length;
        parts.push(n > 0 ? `Zona bloqueada: ${n} semillas cargadas` : "Zona bloqueada: sin semillas cargadas");
        if (session.seedsExhausted()) parts.push(SEEDS_BANNER);
      }
      const text = parts.length === 1 ? parts[0] : parts.join(". ") + ".";
      return { status: clip(text, STATUS_MAX) };
    } catch (_) {
      return { status: "No se pudo consultar el estado" };
    }
  }

  async function login() {
    const { email, password } = savedAccount();
    if (email === "" || password === "") throw kino.error("auth_required", "Escribe tu correo y contraseña en Ajustes");
    try { await session.login(email, password); }
    catch (e) {
      throw refusedCredentials(e) ? kino.error("auth_required", "Credenciales de Xuper inválidas") : surface(e);
    }
    return { message: "Sesión iniciada", refresh: true };
  }

  async function logout() {
    try { await session.logout(); }
    catch (e) { throw surface(e); }
    return { message: LOGOUT_MESSAGE, refresh: true };
  }

  async function switchSeed() {
    let r;
    try { r = await session.switchSeed(); }
    catch (e) { throw surface(e); }
    const message = r.result === "ok" ? `Semilla cambiada (intento ${r.tries})`
      : r.result === "account_linked" ? "Tu cuenta no usa semillas"
        : r.result === "no_other_seed" ? "No hay otra semilla para probar"
          : `Probé ${r.tries} semillas y ninguna funcionó`;
    return { message, refresh: true };
  }

  async function refreshSeeds() {
    let ok;
    try { ok = await session.refreshSeeds(); }
    catch (e) { throw surface(e); }
    return { message: ok ? `${session.seedPool().length} semillas cargadas` : "Sin conexión, reintenta", refresh: true };
  }

  const ACTIONS = { login, logout, switchSeed, refreshSeeds };

  /** Runs the button `key`; an unknown key is `null` (the app shows "Listo"). */
  async function action(key) {
    await null;
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, key) ? ACTIONS[key] : null;
    if (!run) return null;
    const out = await run();
    return { ...out, message: clip(out.message, MESSAGE_MAX) };
  }

  /**
   * Runs BEFORE the new email/password are saved. Blank both = anonymous use. Both set = one real
   * login: refused credentials are a field error; anything else (network, portal down) throws, so
   * the person can still save without checking.
   */
  async function validateSettings(values) {
    await null;
    const v = values && typeof values === "object" ? values : {};
    const email = str(v.email).trim(), password = str(v.password).trim();
    if (email === "" && password === "") return null;
    const errors = {};
    if (email === "") errors.email = "Escribe tu correo";
    else if (!email.includes("@")) errors.email = "Escribe un correo válido";
    if (password === "") errors.password = "Escribe tu contraseña";
    if (Object.keys(errors).length > 0) return errors;
    try { await session.login(email, password); return null; }
    catch (e) {
      if (refusedCredentials(e)) return { password: "Credenciales de Xuper inválidas" };
      throw surface(e);
    }
  }

  return { settingsStatus, action, validateSettings };
}
