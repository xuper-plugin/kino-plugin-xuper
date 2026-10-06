// The account tab of Ajustes: the status line, the action buttons and the check that runs before
// the person's email and password are saved. The account itself is NOT stored here: it is the
// plugin's own settings (`kino.config`), which only the person can edit.
import { isKinoError } from "./util.js";
import { trace, errCode } from "./trace.js";
import { told } from "./portal.js";
import { say } from "./i18n.js";
const STATUS_MAX = 200;
const MESSAGE_MAX = 300;

// The app caps validateSettings at 20 s and an action at 30 s, and a call it has to time out counts
// against the plugin. So every portal exchange here carries its own bounds, measured on the injected
// clock, and a slow portal ends as an error the plugin itself throws.
const VALIDATE_REQUEST_MS = 12_000; // one request of the pre-save credential check
const VALIDATE_TOTAL_MS = 17_000; // the whole check, failover included (cap 20 s)
const LOGIN_REQUEST_MS = 12_000;
const LOGIN_TOTAL_MS = 25_000; // cap 30 s
const SEED_PROBE_MS = 5_000; // one "Cambiar semilla" probe
const SEED_SWITCH_TOTAL_MS = 22_000; // no probe starts after this (cap 30 s)
const SEED_DOWNLOAD_MS = 10_000;
const SEND_CODE_REQUEST_MS = 10_000; // three portal calls: mint, activate, send
const SEND_CODE_TOTAL_MS = 25_000; // cap 30 s
const RESEND_WAIT_MS = 60_000;
const REGISTER_REQUEST_MS = 10_000; // three portal calls: validate, bind, login
const REGISTER_TOTAL_MS = 25_000;
const LOGOUT_REQUEST_MS = 10_000; // log out, then reactivate the anonymous session
const LOGOUT_TOTAL_MS = 25_000; // cap 30 s


const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const clip = (text, max) => (text.length <= max ? text : text.slice(0, max - 1) + "…");
// The session already turns a refused credential into this; a raw PortalError counts as one too.
const refusedCredentials = (e) => e !== null && typeof e === "object" && (e.name === "KinoError_auth_required" || e.name === "PortalError");

// What the person reads when an action fails on purpose. Without its own `userMessage` the app shows
// its fallback for the code ("Configura Xuper en Menú ▸ Plugins" for auth_required), which points to
// the wrong screen. Worded for the app's sentence filter: no "contraseña", "credencial" or "código
// de verificación" (it refuses sentences that ask for credentials), and the place is the plugin's tab.
// Every text here is in i18n.js, Spanish or English by kino.lang.

export function makeSettings({ kino, session, clock, registration }) {
  // Kino errors (already Spanish, already free of secrets) pass; anything else is a fixed text, so
  // an underlying message that might echo the password never reaches the person.
  const surface = (e) => {
    if (isKinoError(e)) return e;
    trace(kino, "settings", "fail", { code: errCode(e) });
    return kino.error("unavailable", "Xuper no está disponible ahora");
  };

  const savedAccount = () => ({ email: str(kino.config.get("email")).trim(), password: str(kino.config.get("password")).trim() });

  /** `{ status }`: one line of at most a few short sentences; never throws. */
  async function settingsStatus() {
    await null;
    try {
      // What the stored token really is: an account configured but not logged in yet (credentials that
      // arrived by sync, a change of account) or refused is NOT reported as connected.
      const account = session.kind() === "account";
      const state = session.accountState();
      const shared = session.sharedConfigured();
      const anonymous = state === "pending"
        ? say(kino, "statusConnecting", { who: say(kino, shared ? "whoShared" : "whoOwn") })
        : state === "refused"
          ? say(kino, shared ? "statusSharedBroken" : "statusOwnRefused")
          : say(kino, "statusAnonymous");
      const who = session.usingShared() ? say(kino, "statusShared") : say(kino, "statusConnectedAs", { email: savedAccount().email });
      const parts = [account ? who : anonymous];
      if (!account && session.regionBlocked()) {
        const n = session.seedPool().length;
        parts.push(n > 0 ? say(kino, "statusBlockedSeeds", { n }) : say(kino, "statusBlockedNoSeeds"));
        if (session.seedsExhausted()) parts.push(say(kino, "seedsBanner"));
        else if (kino.config.get("autoRefreshSeeds") === false) parts.push(say(kino, "statusAutoRefreshOff"));
      }
      const text = parts.length === 1 ? parts[0] : parts.join(". ") + ".";
      return { status: clip(text, STATUS_MAX) };
    } catch (_) {
      return { status: say(kino, "statusUnknown") };
    }
  }

  async function login() {
    const { email, password } = savedAccount();
    if (email === "" || password === "") throw told(kino, "auth_required", "Escribe tu correo y contraseña en Ajustes", say(kino, "fillAccount"));
    const bounds = { timeoutMs: LOGIN_REQUEST_MS, deadline: clock.now() + LOGIN_TOTAL_MS };
    try { await session.login(email, password, bounds); }
    catch (e) {
      throw refusedCredentials(e) ? told(kino, "auth_required", "Credenciales de Xuper inválidas", say(kino, "accountRefused")) : surface(e);
    }
    return { message: say(kino, "signedIn"), refresh: true };
  }

  async function logout() {
    try { await session.logout({ timeoutMs: LOGOUT_REQUEST_MS, deadline: clock.now() + LOGOUT_TOTAL_MS }); }
    catch (e) { throw surface(e); }
    // The app clears these only if this action succeeded; session.logout() runs first on purpose.
    return { message: say(kino, "signedOut"), refresh: true, clearSettings: ["email", "password", "useSharedAccount"] };
  }

  async function switchSeed() {
    let r;
    try { r = await session.switchSeed({ timeoutMs: SEED_PROBE_MS, deadline: clock.now() + SEED_SWITCH_TOTAL_MS }); }
    catch (e) { throw surface(e); }
    const message = r.result === "ok" ? say(kino, "seedSwitched", { n: r.tries })
      : r.result === "offline" ? say(kino, "offlineRetry")
      : r.result === "account_linked" ? say(kino, "accountNoSeeds")
        : r.result === "no_other_seed" ? say(kino, "noOtherSeed")
          : say(kino, "seedsAllFailed", { n: r.tries });
    return { message, refresh: true };
  }

  async function refreshSeeds() {
    let ok;
    try { ok = await session.refreshSeeds({ timeoutMs: SEED_DOWNLOAD_MS, manual: true }); }
    catch (e) { throw surface(e); }
    return { message: ok ? say(kino, "seedsLoaded", { n: session.seedPool().length }) : say(kino, "offlineRetry"), refresh: true };
  }

  // The registration steps need the saved email (and password) as typed: nothing is read from the
  // portal or logged. Blank fields are the person's to fill, so they never cost a portal call.
  function typedEmail() {
    const { email } = savedAccount();
    if (email === "") throw told(kino, "auth_required", "Escribe tu correo en Ajustes", say(kino, "fillEmail"));
    if (!email.includes("@")) throw told(kino, "auth_required", "Escribe un correo válido", say(kino, "badEmail"));
    return email;
  }

  async function sendCode() {
    const email = typedEmail();
    // A double tap must not mint a second device and invalidate the code that is on its way.
    const prev = registration.pendingFor(email);
    if (prev && prev.at !== null && clock.now() >= prev.at && clock.now() - prev.at < RESEND_WAIT_MS) {
      return { message: say(kino, "codeAlreadySent") };
    }
    const bounds = { timeoutMs: SEND_CODE_REQUEST_MS, deadline: clock.now() + SEND_CODE_TOTAL_MS };
    try { await registration.sendRegistrationCode(email, bounds); }
    catch (e) { throw surface(e); }
    return { message: say(kino, "codeSent", { email }) };
  }

  async function register() {
    const email = typedEmail();
    const code = str(kino.config.get("verifyCode")).trim();
    if (code === "") throw told(kino, "auth_required", "Escribe el código de verificación", say(kino, "fillCode"));
    const { password } = savedAccount();
    if (password === "") throw told(kino, "auth_required", "Escribe tu contraseña en Ajustes", say(kino, "fillAccount"));
    const pending = registration.pendingFor(email);
    if (!pending) throw told(kino, "unavailable", "Pide el código otra vez", say(kino, "askCodeAgain"));
    const bounds = { timeoutMs: REGISTER_REQUEST_MS, deadline: clock.now() + REGISTER_TOTAL_MS };
    let done;
    try { done = await registration.confirmRegistration(pending, code, password, bounds); }
    catch (e) { throw surface(e); }
    // Created but the login after it failed: the account exists, so this is no error (the code is spent).
    const message = done && done.loggedIn === false ? say(kino, "accountCreatedSignIn") : say(kino, "accountCreatedSignedIn");
    return { message, refresh: true, clearSettings: ["verifyCode"] };
  }

  const ACTIONS = { login, logout, switchSeed, refreshSeeds, ...(registration ? { sendCode, register } : {}) };

  /** Runs the button `key`; an unknown key is `null` (the app shows "Listo"). */
  async function action(key) {
    await null;
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, key) ? ACTIONS[key] : null;
    if (!run) return null;
    const out = await run();
    return { ...out, message: clip(out.message, MESSAGE_MAX) };
  }

  /**
   * Runs BEFORE the new email/password are saved. Blank both = anonymous use. An email alone is
   * saved as is ("Crear cuenta" sends the code to the SAVED email; no password means no login). Both
   * set = one real login: refused credentials are a field error, except while an account is being
   * created (a pending registration for that email, or a verify code typed): that account may not
   * exist yet. Anything else (network, portal down) throws, so the person can still save without
   * checking. The shared-account toggle on (and no own account) is one bounded shared login; on
   * together with an own account it is a field error.
   */
  async function validateSettings(values) {
    await null;
    const v = values && typeof values === "object" ? values : {};
    const email = str(v.email).trim(), password = str(v.password).trim();
    const sharedOn = v.useSharedAccount === true || v.useSharedAccount === "true";
    if (sharedOn && email === "" && password === "") {
      // The shared account: one bounded login, so a dead pair is told before saving.
      const bounds = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock.now() + VALIDATE_TOTAL_MS };
      try { await session.useShared(bounds); return null; }
      catch (e) {
        if (refusedCredentials(e)) return { useSharedAccount: say(kino, "sharedActivationFailed") };
        throw surface(e);
      }
    }
    if (email === "" && password === "") return null;
    const errors = {};
    if (sharedOn) errors.useSharedAccount = say(kino, "removeAccountOrShared");
    if (email === "") errors.email = say(kino, "enterEmail");
    else if (!email.includes("@")) errors.email = say(kino, "enterValidEmail");
    if (Object.keys(errors).length > 0) return errors;
    if (password === "") return null;
    const bounds = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock.now() + VALIDATE_TOTAL_MS };
    try { await session.login(email, password, bounds); return null; }
    catch (e) {
      if (refusedCredentials(e)) {
        const creating = str(v.verifyCode).trim() !== "" || (registration !== undefined && registration !== null && registration.pendingFor(email) !== null);
        return creating ? null : { password: say(kino, "credentialsRefused") };
      }
      throw surface(e);
    }
  }

  return { settingsStatus, action, validateSettings };
}
