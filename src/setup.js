// setup.js — Xuper's own setup in Kino (apiVersion 30) is its activation: `setupStatus` (ready = a session is stored; cheap,
// also asked at app start, so it never touches kino.identity or the vault) and `setupRun` (person-started: signs in through
// identity, with the per-cause message of the welcome view when it fails). Other plugins set themselves up on their own.
import { ensureBearer, reauth, currentBearer, notMemberActive, markIntroSeen, reportActivate, activateBanner, markReauthNeeded, reauthNeeded, notMemberText } from "./api.js";
import { syncReauthNotice } from "./reauthNotice.js";
import { lang } from "./config.js";

const t = (es, en) => (lang() === "en" ? en : es);

/** The sentence for an activation failure, by the same cause as the welcome view's banner. */
export function setupErrorText(banner) {
  if (banner === "member") return notMemberText();
  if (banner === "update") return t("Para activar Xuper necesitas la versión más reciente de Kino. Actualiza Kino y vuelve a intentarlo.", "To activate Xuper you need the latest version of Kino. Update Kino and try again.");
  if (banner === "consent") return t("Xuper necesita tu identidad de Kino y ahora está apagada. Actívala en Kino ▸ Ajustes ▸ Plugins ▸ Xuper (el permiso de identidad), y vuelve a abrir Xuper.", "Xuper needs your Kino identity, and it is off. Turn it on in Kino ▸ Settings ▸ Plugins ▸ Xuper (the identity permission), then open Xuper again.");
  if (banner === "link") return t("Este aparato todavía no está validado con una cuenta de Telegram. Valida tu Telegram en Kino y vuelve.", "This device isn't validated with a Telegram account yet. Validate your Telegram in Kino, then come back.");
  return t("No se pudo conectar con el servidor de Xuper. Inténtalo de nuevo en un momento.", "Could not reach Xuper's server. Try again in a moment.");
}

/**
 * `setupStatus()`: ready when Xuper is activated (a stored session, not frozen as a non-member). Reads storage only. A pending
 * re-authentication does not gate it: the Home bell (syncReauthNotice) asks for that, and Kino's setup is for a first activation.
 */
export async function setupStatus() {
  if (notMemberActive()) return { ready: false, label: setupErrorText("member") };
  if (await currentBearer()) return { ready: true };
  return { ready: false, label: t("Falta activar Xuper (iniciar sesión)", "Xuper needs activating (signing in)") };
}

/** `setupRun({ step })`: the activation, in one step. Throws a step error carrying the per-cause message. */
export async function setupRun() {
  // A session is stored but a re-activation failed, or it is frozen as a non-member: only a fresh sign-in clears either
  // (a passed /session lifts the freeze), so the stored session is no shortcut then.
  const stale = reauthNeeded() || notMemberActive();
  if (!stale && await currentBearer()) return { done: true };   // already activated: the intro state is not touched
  try {
    if (stale) await reauth(); else await ensureBearer();   // reauth mints fresh and keeps the old session if it fails
    markIntroSeen();   // only a successful sign-in stands in for "Ingresar"
    await syncReauthNotice();
    return { done: true };
  } catch (e) {
    reportActivate(e, "setup");
    const banner = activateBanner(e);
    markReauthNeeded(banner);
    await syncReauthNotice();
    throw kino.error((e && e.code) || "unavailable", "Xuper: setup failed (" + banner + ")", { userMessage: setupErrorText(banner) });
  }
}
