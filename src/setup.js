// setup.js — Xuper and Kino's plugin setup (apiVersion 29).
// 1. Xuper's own setup is its activation: `setupStatus` (ready = a session is stored; cheap, also asked at app start, so it
//    never touches kino.identity or the vault) and `setupRun` (person-started: step 0 signs in through identity, with the
//    per-cause message of the welcome view when it fails).
// 2. "Preparar todo": from a press (a screen event) Xuper asks Kino to set up Movie+ and HDFull (`kino.plugins.setup`, which
//    makes Kino ask the person), then follows them with `kino.plugins.setupStatus`. The result per target lives in the
//    screen state as `prep[key] = { s, p?, l? }` (s: SETTING_UP | READY | not_installed | no_setup | busy | rate_limited |
//    timeout | error); a target the person refused is `null` (nothing to say).
import { ensureBearer, currentBearer, notMemberActive, markIntroSeen, reportActivate, activateBanner, markReauthNeeded, reauthNeeded, notMemberText } from "./api.js";
import { syncReauthNotice } from "./reauthNotice.js";
import { PREP_TARGETS, lang } from "./config.js";

const t = (es, en) => (lang() === "en" ? en : es);
const POLL_MAX = 150;   // the status timer ends by itself after this many ticks (~5 min at 2 s)

/** The sentence for an activation failure, by the same cause as the welcome view's banner. */
export function setupErrorText(banner) {
  if (banner === "member") return notMemberText();
  if (banner === "update") return t("Para activar Xuper necesitas la versión más reciente de Kino. Actualiza Kino y vuelve a intentarlo.", "To activate Xuper you need the latest version of Kino. Update Kino and try again.");
  if (banner === "consent") return t("Xuper necesita tu identidad de Kino y ahora está apagada. Actívala en Kino ▸ Ajustes ▸ Plugins ▸ Xuper (el permiso de identidad), y vuelve a abrir Xuper.", "Xuper needs your Kino identity, and it is off. Turn it on in Kino ▸ Settings ▸ Plugins ▸ Xuper (the identity permission), then open Xuper again.");
  if (banner === "link") return t("Este aparato todavía no está validado con una cuenta de Telegram. Valida tu Telegram en Kino y vuelve.", "This device isn't validated with a Telegram account yet. Validate your Telegram in Kino, then come back.");
  return t("No se pudo conectar con el servidor de Xuper. Inténtalo de nuevo en un momento.", "Could not reach Xuper's server. Try again in a moment.");
}

/** `setupStatus()`: ready when Xuper is activated (a stored session, not frozen as a non-member). Reads storage only. */
export async function setupStatus() {
  if (notMemberActive()) return { ready: false, label: setupErrorText("member") };
  if (reauthNeeded()) return { ready: false, label: t("Xuper necesita que te reautentiques", "Xuper needs you to re-authenticate") };
  if (await currentBearer()) return { ready: true };
  return { ready: false, label: t("Falta activar Xuper (iniciar sesión)", "Xuper needs activating (signing in)") };
}

/** `setupRun({ step })`: the activation, in one step. Throws a step error carrying the per-cause message. */
export async function setupRun() {
  if (await currentBearer()) return { done: true };   // already activated: the intro state is not touched
  try {
    await ensureBearer();
    markIntroSeen();   // only a successful sign-in stands in for "Ingresar" (setupView still offers Apoyar)
    await syncReauthNotice();
    return { done: true };
  } catch (e) {
    reportActivate(e);
    const banner = activateBanner(e);
    markReauthNeeded(banner);
    await syncReauthNotice();
    throw kino.error((e && e.code) || "unavailable", "Xuper: setup failed (" + banner + ")", { userMessage: setupErrorText(banner) });
  }
}

const KNOWN = ["not_installed", "no_setup", "busy", "rate_limited", "timeout"];

/** "Preparar todo": asks Kino to set up each target, one after the other (each has its own confirmation). → the new `prep`. */
export async function prepareAll() {
  const prep = {};
  for (const target of PREP_TARGETS) {
    try {
      const r = await kino.plugins.setup(target.repo);
      prep[target.key] = { s: r && r.state === "READY" ? "READY" : "SETTING_UP" };
    } catch (e) {
      const code = e && e.code;
      prep[target.key] = code === "refused" ? null : { s: KNOWN.includes(code) ? code : "error" };
    }
  }
  return prep;
}

/** Whether some target is still setting up (the view keeps its poll timer while true and the ticks are not spent). */
export function prepActive(state) {
  const prep = state && state.prep;
  return !!prep && !state.prepStop && PREP_TARGETS.some((x) => prep[x.key] && prep[x.key].s === "SETTING_UP");
}

/** One poll tick: where each target still setting up stands (`kino.plugins.setupStatus`, from the screen's timer). → a state patch. */
export async function prepPoll(state) {
  const prep = { ...(state.prep || {}) };
  for (const target of PREP_TARGETS) {
    const cur = prep[target.key];
    if (!cur || cur.s !== "SETTING_UP") continue;
    try {
      const st = await kino.plugins.setupStatus(target.repo);
      prep[target.key] = st && st.ready ? { s: "READY" }
        : { s: "SETTING_UP", ...(st && typeof st.progress === "number" ? { p: Math.max(0, Math.min(1, st.progress)) } : {}), ...(st && typeof st.label === "string" ? { l: st.label.slice(0, 120) } : {}) };
    } catch (_) { /* rate limited or gone: the next tick asks again */ }
  }
  const n = (Number(state.prepN) || 0) + 1;
  return { prep, prepN: n, ...(n >= POLL_MAX ? { prepStop: true } : {}) };
}
