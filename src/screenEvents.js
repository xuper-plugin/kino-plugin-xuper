// The configuration screen's events: a thin layer over the old logic. Every handler CALLS what the old settings form
// calls (settings.validateSettings, settings.action, the E1-E5 extracts) and turns its answer into a screen answer:
// a sentence becomes a toast or a field's verdict (forceErrorText), a clearSettings becomes `config`. Nothing here talks
// to the portal by itself, and only the person's own presses (and the shared-account switch) reach the network.
import { say, twin, TEXTS } from "./i18n.js";
import { trace, errCode } from "./trace.js";
import { maskEmail, snapshot, fingerprint } from "./screenModel.js";
import { TABS } from "./screenView.js";

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
/** What a toast's own action may ask (no press budget): the old 17 s check bound, E1's cap. */
export const TOAST_PRESS_MS = 17_000;

export function makeEvents({ kino, clock, deps }) {
  // The sentence the person reads for a failure: the kino error's own (already in Kino's language, free of secrets),
  // else a fixed one. Never the error's `message` (a developer's line).
  const sentence = (e) => (e && typeof e.userMessage === "string" && e.userMessage.trim() !== "" ? e.userMessage.trim() : say(kino, "scrGenericError"));
  // A catalog key gives both languages; a sentence the old logic already said in Kino's language is shown as it is.
  const toastOf = (textOrKey, role, vars) => (typeof textOrKey === "string" && Object.hasOwn(TEXTS, textOrKey)
    ? { ...twin(textOrKey, "text", vars), role }
    : { text: str(textOrKey).slice(0, 300), role });
  const cfg = (k) => { try { return kino.config.get(k); } catch (_) { return undefined; } };
  const pending = () => { const d = deps(); return d.registration; };
  const capOf = (arg) => (arg === "toast" ? TOAST_PRESS_MS : undefined);
  const bump = () => ({ v: clock.now() });

  /** A registration this device asked for and can still confirm, for the address saved in regEmail. */
  function resumeReg() {
    const email = str(cfg("regEmail")).trim();
    if (email === "") return null;
    let p = null;
    try { p = pending().pendingFor(email); } catch (_) { p = null; }
    return p && typeof p.at === "number" ? { step: "code", email, emailMasked: maskEmail(email), sentAt: p.at } : null;
  }

  const on = {
    // Nothing to load: the tabs read what is stored. A registration under way on this device is picked up again.
    open({ route, state }) {
      const name = route && route.name;
      const patch = { fp: fingerprint(snapshot({ kino, ...deps() })) };
      if (name === "register" && !(state.reg && state.reg.step)) patch.reg = resumeReg() || { step: "email" };
      return { state: patch };
    },
    tab({ value, arg }) {
      const tab = TABS.includes(value) ? value : TABS.includes(arg) ? arg : null;
      return tab ? { state: { tab, notice: null, seedsBanner: null } } : null;
    },
    refresh() { return { state: { ...bump(), fp: fingerprint(snapshot({ kino, ...deps() })) } }; },
    // A timer: re-render only when what the tabs show changed (no network).
    tick({ state }) {
      const fp = fingerprint(snapshot({ kino, ...deps() }));
      return fp === state.fp ? null : { state: { fp } };
    },
    // Kino's own settings items in the screen saved (keys only, never values): draw the status again.
    saved() { return { state: { ...bump(), fp: fingerprint(snapshot({ kino, ...deps() })) } }; },
    go({ arg }) {
      if (arg === "signin") return { route: { push: "signin" }, state: { signin: null } };
      if (arg === "register") return { route: { push: "register" }, state: { reg: resumeReg() || { step: "email" } } };
      return null;
    },
    dismiss() { return null; },

    // ---- sign in: the old pre-save check (a real login), then the pair is written as Ajustes' Guardar would ----
    async "signin.submit"({ value }) {
      const v = value && typeof value === "object" ? value : {};
      const email = str(v.signinEmail).trim();
      // Trimmed like every reader of the setting (configuredPair), so the login and the stored account key agree.
      const password = str(v.signinPw).trim();
      const missing = {};
      if (!email.includes("@")) missing.emailError = say(kino, "enterValidEmail");
      if (password === "") missing.pwError = say(kino, "scrPasswordError");
      if (Object.keys(missing).length) return { state: { signin: missing } };
      let errors;
      try { errors = await deps().settings.validateSettings({ email, password, useSharedAccount: cfg("useSharedAccount") === true }); }
      catch (e) {
        trace(kino, "screen", "signin", { ok: false, code: errCode(e) });
        // The old form lets the person save what the service could not check (it is checked on the next catalog call).
        return { state: { signin: { unchecked: true, banner: { role: "warning", text: sentence(e) } } } };
      }
      if (errors && typeof errors === "object") {
        trace(kino, "screen", "signin", { ok: false, why: Object.keys(errors).sort().join("+") });
        const s = {};
        if (errors.useSharedAccount) s.banner = { role: "error", text: errors.useSharedAccount, action: { ...twin("scrSharedTurnOff", "label"), onTap: "shared.off" } };
        if (errors.email) s.emailError = errors.email;
        if (errors.password) s.pwError = errors.password;
        if (!s.banner && !s.emailError && !s.pwError) s.banner = { role: "error", text: Object.values(errors).map(str).find(Boolean) || say(kino, "scrGenericError") };
        return { state: { signin: s } };
      }
      trace(kino, "screen", "signin", { ok: true });
      return { config: { email, password }, route: { pop: true }, state: { signin: null, ...bump() }, toast: toastOf("signedIn", "success") };
    },
    "signin.saveUnchecked"({ state }) {
      const inputs = state.inputs || {};
      const email = str(inputs.signinEmail).trim();
      const password = str(inputs.signinPw).trim();
      if (!email.includes("@") || password === "") return { toast: toastOf("scrTypeBoth", "warning") };
      return { config: { email, password }, route: { pop: true }, state: { signin: null, ...bump() }, toast: toastOf("scrSavedUnchecked", "info") };
    },

    // ---- the account in use ----
    async "account.retry"({ arg }) {
      try {
        const out = await deps().settings.action("login", { totalMs: capOf(arg) });
        return { state: bump(), toast: toastOf(out ? out.message : say(kino, "signedIn"), "success") };
      } catch (e) {
        return { state: bump(), toast: toastOf(sentence(e), "error") };
      }
    },
    // The old "Cerrar sesión" (log out, re-activate the anonymous session), then its clearSettings as `config`. Unlike the
    // old form, the settings are cleared even when the anonymous re-activation failed: the token is already forgotten by
    // then, and keeping the account would sign it in again on the next call although the person asked to sign out.
    async "account.logout"() {
      let out = null;
      let failed = null;
      try { out = await deps().settings.action("logout"); } catch (e) { failed = e; }
      trace(kino, "screen", "logout", failed ? { ok: false, code: errCode(failed) } : { ok: true });
      const cleared = out && Array.isArray(out.clearSettings) ? out.clearSettings : ["email", "password", "regEmail", "regPassword", "useSharedAccount"];
      const config = Object.fromEntries(cleared.map((k) => [k, k === "useSharedAccount" ? false : null]));
      return {
        config,
        state: { ...bump(), sharedError: null, inputs: { sharedSwitch: false } },
        toast: failed ? toastOf("scrSignOutPartial", "warning") : toastOf(out && out.message ? out.message : say(kino, "signedOut"), "success"),
      };
    },

    // ---- the shared account: the old pre-save check runs at the switch, not at Guardar ----
    async "shared.change"({ value }) {
      if (value !== true) return { config: { useSharedAccount: false }, state: { sharedError: null, ...bump() }, toast: toastOf("scrSharedOff", "info") };
      const values = {
        email: cfg("email"), password: cfg("password"), regEmail: cfg("regEmail"), regPassword: cfg("regPassword"),
        verifyCode: cfg("verifyCode"), useSharedAccount: true,
      };
      let errors;
      try { errors = await deps().settings.validateSettings(values); }
      catch (e) { return { state: { sharedError: sentence(e), inputs: { sharedSwitch: false } } }; }
      if (errors && typeof errors === "object") {
        const msg = str(errors.useSharedAccount) || Object.values(errors).map(str).find(Boolean) || say(kino, "scrGenericError");
        return { state: { sharedError: msg, inputs: { sharedSwitch: false } } };
      }
      return { config: { useSharedAccount: true }, state: { sharedError: null, ...bump() }, toast: toastOf("scrSharedOn", "success") };
    },
    "shared.off"() {
      return { config: { useSharedAccount: false }, state: { signin: null, sharedError: null, inputs: { sharedSwitch: false }, ...bump() }, toast: toastOf("scrSharedOff", "info") };
    },

    // ---- seeds ----
    async "seeds.switch"({ arg }) {
      const d = deps();
      let before = "";
      try { before = str(d.session.current().sn); } catch (_) { before = ""; }
      let out;
      try { out = await d.settings.action("switchSeed", { totalMs: capOf(arg) }); }
      catch (e) { return { state: bump(), toast: toastOf(sentence(e), "error") }; }
      let after = "";
      try { after = str(d.session.current().sn); } catch (_) { after = ""; }
      const message = out ? out.message : say(kino, "scrGenericError");
      if (after !== "" && after !== before) return { state: bump(), toast: toastOf(message, "success") };
      // Nothing switched: an outcome worth another try gets a "Reintentar" on the toast (its own budget: E1's cap).
      const final = [say(kino, "accountNoSeeds"), say(kino, "noOtherSeed")].includes(message);
      return {
        state: bump(),
        toast: { ...toastOf(message, final ? "info" : "error"), ...(final ? {} : { action: { ...twin("scrRetry", "label"), event: "seeds.switch", arg: "toast" } }) },
      };
    },
    async "seeds.refresh"() {
      const d = deps();
      const seq = () => { try { const o = d.session.seedsOutcome(); return o ? o.n : 0; } catch (_) { return 0; } };
      const before = seq();
      let out;
      try { out = await d.settings.action("refreshSeeds"); }
      catch (e) { return { state: bump(), toast: toastOf(sentence(e), "error") }; }
      let o = null;
      try { o = d.session.seedsOutcome(); } catch (_) { o = null; }
      if (o && o.n !== before) {
        if (!o.ok) return { state: bump(), toast: toastOf(o.why === "fetch" ? say(kino, "offlineRetry") : say(kino, "scrSeedsBadFile"), "error") };
        let usable = 0;
        try { usable = d.session.usableSeeds(); } catch (_) { usable = 0; }
        return { state: bump(), toast: toastOf("scrSeedsLoadedUsable", "success", { n: d.session.seedPool().length, usable }) };
      }
      // No download ran (one finished seconds ago): the old answer.
      return { state: bump(), toast: toastOf(out ? out.message : say(kino, "scrGenericError"), "info") };
    },

    // ---- create an account: three steps, the old portal calls (E3) with what was typed here ----
    async "reg.send"({ value }) {
      const email = str(value && value.regEmailInput).trim();
      if (!email.includes("@")) return { state: { reg: { step: "email", errors: { email: say(kino, "enterValidEmail") } } } };
      return sendTo(email, false);
    },
    async "reg.resend"({ state }) {
      const email = str(state.reg && state.reg.email).trim();
      if (!email.includes("@")) return { state: { reg: { step: "email" } } };
      return sendTo(email, true);
    },
    async "reg.confirm"({ value, state }) {
      const reg = state.reg && typeof state.reg === "object" ? state.reg : {};
      const email = str(reg.email).trim();
      if (!email.includes("@")) return { state: { reg: { step: "email" } } };
      const v = value && typeof value === "object" ? value : {};
      const password = str(v.regPw).trim();
      const keep = { step: "code", email, emailMasked: maskEmail(email), sentAt: reg.sentAt };
      let done;
      try { done = await deps().settings.registerWith({ email, code: v.regCode, password }); }
      catch (e) {
        const msg = sentence(e);
        trace(kino, "screen", "register", { ok: false, code: errCode(e) });
        if (msg === say(kino, "fillCode") || msg === say(kino, "codeRefused")) return { state: { reg: { ...keep, errors: { code: msg } } } };
        if (msg === say(kino, "fillAccount")) return { state: { reg: { ...keep, errors: { pw: msg } } } };
        if (msg === say(kino, "askCodeAgain")) {
          return { state: { reg: { ...keep, banner: { role: "error", text: msg, action: { ...twin("scrAskAgain", "label"), onTap: { event: "reg.resend", timeoutMs: 30_000 } } } } } };
        }
        return { state: { reg: { ...keep, banner: { role: "error", text: msg } } } };
      }
      trace(kino, "screen", "register", { ok: true, in: done.loggedIn === true });
      // The new account becomes THE account (the sign-in pair), so no second pair is left behind (old devices read it too).
      return {
        config: { email, password, regEmail: null, regPassword: null, verifyCode: null },
        state: { reg: { step: "done", loggedIn: done.loggedIn === true, emailMasked: maskEmail(email) }, ...bump() },
        toast: toastOf(done.loggedIn ? "accountCreatedSignedIn" : "scrCreatedPending", done.loggedIn ? "success" : "info"),
      };
    },
    "reg.back"({ arg, state }) {
      const reg = state.reg && typeof state.reg === "object" ? state.reg : {};
      if (arg !== "email" || reg.step === "done") return null;
      return { state: { reg: { step: "email", email: reg.email } } };
    },
    "reg.finish"() { return { route: { pop: true }, state: { reg: null, ...bump() } }; },
  };

  async function sendTo(email, resend) {
    const masked = maskEmail(email);
    let r;
    try { r = await deps().settings.sendCodeTo(email); }
    catch (e) {
      const msg = sentence(e);
      trace(kino, "screen", "send_code", { ok: false, code: errCode(e) });
      if (msg === say(kino, "requestNotSaved")) {
        return { state: { reg: { step: "email", email, banner: { role: "error", text: msg, action: { ...twin("scrAskAgain", "label"), onTap: { event: "reg.resend", timeoutMs: 30_000 } } } } } };
      }
      return { state: { reg: { step: resend ? "code" : "email", email, emailMasked: masked, errors: resend ? {} : { email: msg }, ...(resend ? { banner: { role: "error", text: msg } } : {}) } } };
    }
    trace(kino, "screen", "send_code", { ok: true, sent: r.sent === true });
    const toast = !r.sent ? toastOf("codeAlreadySent", "info") : resend ? toastOf("scrResent", "success") : toastOf("scrCodeSentTo", "success", { email: masked });
    return { config: { regEmail: email }, state: { reg: { step: "code", email, emailMasked: masked, sentAt: r.at } }, toast };
  }

  /** The answer to event `name` (null when there is nothing to do). Never throws: a bug is a generic toast. */
  return async function screenEvent(ev) {
    const e = ev && typeof ev === "object" ? ev : {};
    const name = typeof e.name === "string" ? e.name : "";
    const handler = Object.hasOwn(on, name) ? on[name] : null;
    if (!handler) return null;
    const state = e.state && typeof e.state === "object" ? e.state : {};
    try { return (await handler({ ...e, state })) ?? null; }
    catch (err) {
      trace(kino, "screen", "bug", { event: name, code: errCode(err) });
      return { toast: toastOf("scrGenericError", "error") };
    }
  };
}
