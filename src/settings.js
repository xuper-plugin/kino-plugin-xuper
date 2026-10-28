// The account tab of Ajustes: the status line, the action buttons and the check that runs before
// the person's email and password are saved. The account itself is NOT stored here: it is the
// plugin's own settings (`kino.config`), which only the person can edit.
import { isKinoError, configuredPair, creationFields, savesBeforeAction } from "./util.js";
import { trace, errCode } from "./trace.js";
import { told, namedCause } from "./portal.js";
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
    const named = namedCause(kino, e);
    if (named) return named;
    if (isKinoError(e)) return e;
    trace(kino, "settings", "fail", { code: errCode(e) });
    return kino.error("unavailable", "Xuper no está disponible ahora");
  };

  // The account the settings ask for: the "Cuenta" fields, else the pair typed in "Crear cuenta".
  const savedAccount = () => configuredPair(kino.config);

  /**
   * The facts the status line is made of (E2), read from the session and the settings, never from the network. Throws
   * when the session cannot be read (settingsStatus turns that into its "unknown" line). `email` is the account's as
   * typed: whoever shows it masks it.
   */
  function statusFacts() {
    // What the stored token really is: an account configured but not logged in yet (credentials that
    // arrived by sync, a change of account) or refused is NOT reported as connected.
    return {
      account: session.kind() === "account",
      kind: session.kind(),
      accountState: session.accountState(),
      sharedConfigured: session.sharedConfigured(),
      usingShared: session.usingShared(),
      email: savedAccount().email,
      regionBlocked: session.regionBlocked(),
      pool: session.seedPool().length,
      seedsExhausted: session.seedsExhausted(),
      autoRefresh: kino.config.get("autoRefreshSeeds") !== false,
    };
  }

  /** `{ status }`: one line of at most a few short sentences; never throws. */
  async function settingsStatus() {
    await null;
    try {
      const f = statusFacts();
      const anonymous = f.accountState === "pending"
        ? say(kino, "statusConnecting", { who: say(kino, f.sharedConfigured ? "whoShared" : "whoOwn") })
        : f.accountState === "refused"
          ? say(kino, f.sharedConfigured ? "statusSharedBroken" : "statusOwnRefused")
          : say(kino, "statusAnonymous");
      const who = f.usingShared ? say(kino, "statusShared") : say(kino, "statusConnectedAs", { email: f.email });
      const parts = [f.account ? who : anonymous];
      if (!f.account && f.regionBlocked) {
        parts.push(f.pool > 0 ? say(kino, "statusBlockedSeeds", { n: f.pool }) : say(kino, "statusBlockedNoSeeds"));
        if (f.seedsExhausted) parts.push(say(kino, "seedsBanner"));
        else if (!f.autoRefresh) parts.push(say(kino, "statusAutoRefreshOff"));
      }
      const text = parts.length === 1 ? parts[0] : parts.join(". ") + ".";
      return { status: clip(text, STATUS_MAX) };
    } catch (_) {
      return { status: say(kino, "statusUnknown") };
    }
  }

  // E1: a caller with less time than Kino's 30 s action (a screen call without a press budget of its own) caps the total
  // bound of a handler; Kino's own `action(key)` passes nothing, and every bound stays as it was.
  const capped = (ms, cap) => (typeof cap === "number" && Number.isFinite(cap) && cap > 0 ? Math.min(ms, cap) : ms);

  async function login(cap) {
    const { email, password } = savedAccount();
    if (email === "" || password === "") throw told(kino, "auth_required", "Escribe tu correo y contraseña en Ajustes", say(kino, "fillAccount"));
    const bounds = { timeoutMs: LOGIN_REQUEST_MS, deadline: clock.now() + capped(LOGIN_TOTAL_MS, cap) };
    try { await session.login(email, password, bounds); }
    catch (e) {
      // A region block or an unreadable key is not a wrong password: told as what it is.
      const named = namedCause(kino, e);
      if (named) throw named;
      throw refusedCredentials(e) ? told(kino, "auth_required", "Credenciales de Xuper inválidas", say(kino, "accountRefused")) : surface(e);
    }
    return { message: say(kino, "signedIn"), refresh: true };
  }

  async function logout(cap) {
    try { await session.logout({ timeoutMs: LOGOUT_REQUEST_MS, deadline: clock.now() + capped(LOGOUT_TOTAL_MS, cap) }); }
    catch (e) { throw surface(e); }
    // The app clears these only if this action succeeded; session.logout() runs first on purpose.
    return { message: say(kino, "signedOut"), refresh: true, clearSettings: ["email", "password", "regEmail", "regPassword", "useSharedAccount"] };
  }

  async function switchSeed(cap) {
    let r;
    try { r = await session.switchSeed({ timeoutMs: SEED_PROBE_MS, deadline: clock.now() + capped(SEED_SWITCH_TOTAL_MS, cap) }); }
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
    const { email } = creationFields(kino.config);
    if (email === "") throw told(kino, "auth_required", "Escribe tu correo en Ajustes", say(kino, savesBeforeAction(kino) ? "fillEmail" : "fillEmailSave"));
    if (!email.includes("@")) throw told(kino, "auth_required", "Escribe un correo válido", say(kino, "badEmail"));
    return email;
  }

  /**
   * E3: asks the portal to email `email` (already checked by the caller) a code. `{ sent: false, at }` when one went to the
   * same address less than a minute ago (a double tap must not mint a second device and invalidate the code on its way),
   * `{ sent: true, at }` when it went now. A failure is a kino error carrying the sentence the person reads.
   */
  async function sendCodeTo(email, { cap } = {}) {
    const prev = registration.pendingFor(email);
    if (prev && prev.at !== null && clock.now() >= prev.at && clock.now() - prev.at < RESEND_WAIT_MS) return { sent: false, at: prev.at };
    const bounds = { timeoutMs: SEND_CODE_REQUEST_MS, deadline: clock.now() + capped(SEND_CODE_TOTAL_MS, cap) };
    let pending;
    try { pending = await registration.sendRegistrationCode(email, bounds); }
    catch (e) { throw surface(e); }
    return { sent: true, at: pending && typeof pending.at === "number" ? pending.at : clock.now() };
  }

  /**
   * E3: confirms the registration of `email` with `code` (trimmed here) and `password` (as the caller gives it), on the
   * temporary device THIS device kept when the code was asked. The checks, their order and their sentences are the
   * "Crear cuenta" button's. `{ loggedIn }`: false when the account was created but the login after it failed.
   */
  async function registerWith({ email, code: typedCode, password }, { cap } = {}) {
    const code = str(typedCode).trim();
    if (code === "") throw told(kino, "auth_required", "Escribe el código de verificación", say(kino, "fillCode"));
    if (str(password) === "") throw told(kino, "auth_required", "Escribe tu contraseña en Ajustes", say(kino, "fillAccount"));
    const pending = registration.pendingFor(email);
    if (!pending) throw told(kino, "unavailable", "Pide el código otra vez", say(kino, "askCodeAgain"));
    const bounds = { timeoutMs: REGISTER_REQUEST_MS, deadline: clock.now() + capped(REGISTER_TOTAL_MS, cap) };
    let done;
    try { done = await registration.confirmRegistration(pending, code, password, bounds); }
    catch (e) { throw surface(e); }
    return { loggedIn: !(done && done.loggedIn === false) };
  }

  async function sendCode(cap) {
    const email = typedEmail();
    const out = await sendCodeTo(email, { cap });
    if (!out.sent) return { message: say(kino, "codeAlreadySent") };
    return { message: say(kino, savesBeforeAction(kino) ? "codeSent" : "codeSentSave", { email }) };
  }

  async function register(cap) {
    const email = typedEmail();
    const done = await registerWith({ email, code: kino.config.get("verifyCode"), password: creationFields(kino.config).password }, { cap });
    // Created but the login after it failed: the account exists, so this is no error (the code is spent).
    const message = done.loggedIn === false ? say(kino, "accountCreatedSignIn") : say(kino, "accountCreatedSignedIn");
    // The new account is the one typed in "Crear cuenta" (it stays there: the session reads it from there). An
    // older pair in "Cuenta" would win over it and drop the session just adopted, so it is emptied.
    return { message, refresh: true, clearSettings: ["verifyCode", "email", "password"] };
  }

  const ACTIONS = { login, logout, switchSeed, refreshSeeds, ...(registration ? { sendCode, register } : {}) };

  /**
   * Runs the button `key`; an unknown key is `null` (the app shows "Listo"). `opts.totalMs` (E1) caps each handler's
   * total bound for a caller with less time than Kino's 30 s action; Kino's own call passes nothing.
   */
  async function action(key, opts) {
    await null;
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, key) ? ACTIONS[key] : null;
    if (!run) return null;
    const out = await run(opts !== null && typeof opts === "object" ? opts.totalMs : undefined);
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
    const t = (k) => str(v[k]).trim();
    const email = t("email"), password = t("password");
    const regEmail = t("regEmail"), regPassword = t("regPassword");
    const sharedOn = v.useSharedAccount === true || v.useSharedAccount === "true";
    const hasCreated = regEmail !== "" || regPassword !== "";
    // Typing in "Crear cuenta" is its own flow: what sits in "Cuenta" (an old or wrong pair) is neither checked nor
    // allowed to refuse the save, or the person never gets the email they typed below saved.
    const hasOwn = !hasCreated && (email !== "" || password !== "");
    if (sharedOn && !hasOwn && !hasCreated) {
      // The shared account: one bounded login, so a dead pair is told before saving.
      const bounds = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock.now() + VALIDATE_TOTAL_MS };
      try { await session.useShared(bounds); return null; }
      catch (e) {
        if (refusedCredentials(e)) return { useSharedAccount: say(kino, "sharedActivationFailed") };
        throw surface(e);
      }
    }
    if (!hasOwn && !hasCreated) return null;
    const errors = {};
    if (sharedOn) errors.useSharedAccount = say(kino, "removeAccountOrShared");
    if (hasOwn) {
      if (email === "") errors.email = say(kino, "enterEmail");
      else if (!email.includes("@")) errors.email = say(kino, "enterValidEmail");
    }
    if (hasCreated) {
      if (regEmail === "") errors.regEmail = say(kino, "enterEmail");
      else if (!regEmail.includes("@")) errors.regEmail = say(kino, "enterValidEmail");
    }
    if (Object.keys(errors).length > 0) return errors;
    // The account that will be used: the "Cuenta" pair, else the "Crear cuenta" one (same rule as configuredPair).
    const pair = hasOwn && email !== "" && password !== "" ? { email, password, field: "password" }
      : regEmail !== "" && regPassword !== "" ? { email: regEmail, password: regPassword, field: "regPassword" } : null;
    if (pair === null) return null;
    // A registration under way (a code typed, or one sent to that email): the account may not exist yet, so a refused
    // login is accepted anyway. Skipped, then: the button that triggered this save would only wait for a call whose
    // answer cannot change the verdict.
    if (pair.field === "regPassword" && (t("verifyCode") !== "" || (registration && registration.pendingFor(pair.email) !== null))) return null;
    const bounds = { timeoutMs: VALIDATE_REQUEST_MS, deadline: clock.now() + VALIDATE_TOTAL_MS };
    try { await session.login(pair.email, pair.password, bounds); return null; }
    catch (e) {
      if (refusedCredentials(e)) {
        const creating = t("verifyCode") !== "" || (registration !== undefined && registration !== null && registration.pendingFor(pair.email) !== null);
        return creating ? null : { [pair.field]: say(kino, "credentialsRefused") };
      }
      throw surface(e);
    }
  }

  return { settingsStatus, action, validateSettings, statusFacts, ...(registration ? { sendCodeTo, registerWith } : {}) };
}
