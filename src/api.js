// api.js — the client of the Xuper backend, plus the EGRESS RELAY.
// Auth: kino.identity only answers from screen/screenEvent (never from home/resolve). So:
//   · ensureBearer()  → signs in through identity and stores the Bearer. Only the screen calls it (screen.js).
//   · authed(...)     → uses the STORED Bearer; without one it fails with "open Xuper to activate it". Never signs in.
// The plugin holds no crypto and no credentials: sign-in, cookies and resolution live in the backend.

import { serverUrl, lang, PLUGIN_ID, PLUGIN_VERSION } from "./config.js";
import { getText, setText, getJson, setJson, remove } from "./store.js";
import { once, inFlight, saneAt, callStartedAt } from "./flight.js";

let _bearer = null;

/**
 * Where the backend's Bearer is kept. Never `session`: Xuper 2.x kept its portal session there (JSON with the person's
 * portal tokens), and reading that as a Bearer would send it to the backend.
 */
export const BEARER_KEY = "o2:bearer";

// The screen's `open` signs in with no tap (identity was approved on the consent sheet; Kino asks only at install or
// update) while this is set: the backend refused the stored Bearer (a 401: it moved and lost its sessions, or it
// expired), or this device updated from Xuper 2.x and never signed in (src/upgrade.js). Kept until the next sign-in;
// "Desconectar" clears it.
const RELOGIN_KEY = "o2:relogin";

// Set only when a re-activation genuinely FAILED with a cause the person must act on (identity off / needs re-link / an
// old Kino), never on a routine session expiry (which the screen's `open` re-signs in silently). The scheduled job
// (src/reauthNotice.js) mirrors it to the Home bell so the person is told to reautenticate without opening Xuper first.
// Cleared the moment a session mints again.
const REAUTH_KEY = "o2:reauth";

// The group-membership freeze (backend oleada: 403 {"detail":"not_member"} on /session or any authenticated endpoint
// when the person is no longer in the Kino Telegram group). While set, authed calls fail FAST with the "join the group"
// message instead of hammering the backend; only a successful sign-in (they rejoined → /session passes) clears it.
// Re-auth alone never fixes a leaver: they must rejoin the group FIRST, then the next /session clears this.
const NOT_MEMBER_KEY = "o2:notmember";

/** The Kino Telegram group a member must be in (the welcome's "Join the group" button opens it). */
export const KINO_GROUP_URL = "https://t.me/Kinoapptv";

function log(m) { try { kino.log("" + m); } catch (_) { /* ignore */ } }
const t = (es, en) => (lang() === "en" ? en : es);

function jsonBody(body) {
  return body === undefined ? undefined : { json: body };
}

// Every backend request names this plugin's version: Xuper 2.x and 3.x share the plugin id "xuper" and the backend
// keeps nothing else that tells them apart, so its per-plugin counters (seed_stats) read this header (none: 2.x, or a
// 3.x older than 3.0.2).
async function rawBackend(method, path, body, bearer, timeoutMs = 20000) {
  const headers = { "Content-Type": "application/json", "X-Plugin-Version": PLUGIN_VERSION };
  if (bearer) headers["Authorization"] = "Bearer " + bearer;
  return kino.fetch(serverUrl() + path, {
    method, headers, body: jsonBody(body), cookies: false, timeoutMs,
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

/** The sentence for a call that needs Xuper activated (no Bearer). `lng`: "es" | "en" (default: the visible one). */
export function notActivatedText(lng) {
  const es = "Abre Xuper desde el menú para activarlo y vuelve a intentarlo.";
  const enText = "Open Xuper from the menu to activate it, then try again.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}

/** The error of a call that needs the Bearer when none is stored: `auth_required` with the sentence above. */
export function notActivated() {
  return kino.error("auth_required", "Xuper: not activated", { userMessage: notActivatedText() });
}

/**
 * The error of an identity answer without the gate token (a Kino that gives it only to other authors): nothing is sent
 * to /session, which could not sign in without it. `noToken` tells the screen to say Kino must be updated.
 */
function tokenMissing() {
  const e = kino.error("auth_required", "Xuper: identity answered without the token");
  try { e.noToken = true; } catch (_) { /* frozen: the message says it */ }
  return e;
}

/** Whether `e` is the error of an identity answer without the token (`tokenMissing`). */
export function isTokenMissing(e) {
  return !!e && (e.noToken === true || /answered without the token/.test(String(e.message || "")));
}

async function mintSession() {
  const ch = await rawBackend("POST", "/session/challenge", undefined, null);
  log("mint: challenge -> " + ch.status);
  if (!ch.ok) {
    const reason = reasonOf(ch);   // the backend names one in `detail` (e.g. rate_limited)
    log("mint: challenge FAIL status=" + ch.status + reason);
    throw withCause(kino.error("unavailable", t("Xuper: el servidor no respondió (" + ch.status + ")", "Xuper: the server did not answer (" + ch.status + ")")), "challenge_" + ch.status + reason);
  }
  const challenge = ch.json().challenge;
  let idn;
  try {
    idn = await kino.identity.telegram({ challenge });   // only answers inside a screen call
  } catch (e) {
    log("mint: identity FAIL code=" + (e && e.code) + " msg=" + (e && (e.message || e)));
    throw e;
  }
  log("mint: identity OK author=" + (idn && idn.author) + " token=" + !!(idn && idn.token) +
      " sig=" + !!(idn && idn.signature) + " dk=" + !!(idn && idn.deviceKey) + " ch=" + !!(idn && idn.codeHash));
  if (!idn || typeof idn.token !== "string" || !idn.token) throw tokenMissing();
  const res = await rawBackend("POST", "/session", {
    token: idn.token, challenge, deviceKey: idn.deviceKey,
    signature: idn.signature, author: idn.author, codeHash: idn.codeHash, pluginId: PLUGIN_ID,
  }, null);
  log("mint: /session -> " + res.status);
  if (!res.ok) {
    const reason = reasonOf(res);   // the backend names one in `detail` (bad_proof, bad_token, unofficial_plugin…)
    log("mint: /session FAIL status=" + res.status + reason);
    // The person is not in the Kino group: freeze and show the "join the group" message (they must rejoin, then re-auth).
    if (res.status === 403 && reason === ":not_member") { markNotMember(); throw withCause(notMember(), "session_403:not_member"); }
    const msg = res.status === 403 ? t("Xuper: esta instalación no está autorizada", "Xuper: this install is not authorized")
      : t("Xuper: no se pudo iniciar sesión (" + res.status + ")", "Xuper: could not sign in (" + res.status + ")");
    throw withCause(kino.error("unavailable", msg), "session_" + res.status + reason);
  }
  const session = res.json().session;
  if (!session) throw withCause(kino.error("unavailable", t("Xuper: el servidor no devolvió la sesión", "Xuper: the server returned no session")), "no_session");
  return session;
}

/** Tags an activation error with a GlitchTip-safe cause word (challenge_* / session_* / no_session), for [activateCause]. */
function withCause(e, cause) { try { e.actCause = cause; } catch (_) { /* frozen: activateCause falls back to the code */ } return e; }

/** The `:<reason>` suffix for a failed backend call — the JSON body's `detail` (bad_proof, bad_token, rate_limited…),
 *  sanitized to a safe word, or "" when the backend names none. Fed into the activation cause so GlitchTip shows WHY. */
function reasonOf(res) {
  try {
    const j = res.json();
    const d = j && typeof j.detail === "string" ? j.detail.slice(0, 40) : "";
    return d ? ":" + d.replace(/[^A-Za-z0-9]+/g, "_") : "";
  } catch (_) {
    return "";
  }
}

/**
 * The cause word of an activation failure, for Kino's error board — never a tap, token or any private text:
 *   consent_denied | identity_off | identity_bad_request | update_needed | challenge_<status> | session_<status>[:reason] |
 *   no_session | err_<code> | unknown.
 */
export function activateCause(e) {
  if (isTokenMissing(e)) return "update_needed";
  const code = e && e.code;
  if (code === "permission_denied") return "consent_denied";
  if (code === "not_available") return "identity_off";
  if (code === "bad_request") return "identity_bad_request";
  if (e && typeof e.actCause === "string") return e.actCause;
  if (code) return "err_" + String(code).replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 24);
  return "unknown";
}

/**
 * Which of Kino's reasons is behind a `not_available` identity answer, from the message Kino gives each one
 * (PluginIdentityBridge): the device was never validated with a Telegram account, or its validation predates the
 * Telegram id (no_tg); this install has no device key to sign the challenge (no_key) or the key failed to sign
 * (key_failed); or Kino could not attest the installed plugin (no_attest). They all show the same "Valida tu Telegram"
 * gate, but only no_tg is fixed by re-validating Telegram, so the board must tell them apart. "" for any other error.
 */
export function identityWhy(e) {
  if (!e || e.code !== "not_available") return "";
  const m = String((e && e.message) || "").toLowerCase();
  if (m.includes("never validated")) return "no_tg";
  if (m.includes("right now")) return "key_failed";        // "cannot sign a challenge right now": the key threw
  if (m.includes("cannot sign")) return "no_key";          // "cannot sign a challenge": no device keys at all
  if (m.includes("attest")) return "no_attest";
  return "unknown";
}

/** The trigger words a report may carry (`via=`): the button or event that started the sign-in. */
const VIA = new Set(["enter", "open", "activate", "reauth", "setup"]);

/**
 * Tells Kino's error board (GlitchTip; telemetry is on) WHY an activation failed, as a non-fatal degraded report
 * (`kino.log.report`, throttled to once an hour per device): the fleet's cause distribution shows up without a thrown
 * error, so "No se pudo activar" stops being a black box. The line carries only fixed words, never anything private:
 * `cause=` (activateCause), `why=` (identityWhy, for a not_available identity) and `via=` — what started the sign-in:
 * enter (the welcome's "Ingresar"), open (the sign-in Xuper does by itself), activate ("Reintentar"), reauth (Ajustes),
 * setup (Kino's setup run).
 */
export function reportActivate(e, via) {
  const why = identityWhy(e);
  const line = "activate_fail cause=" + activateCause(e) + (why ? " why=" + why : "") + (VIA.has(via) ? " via=" + via : "");
  try { kino.log.report(line); } catch (_) { /* telemetry off, or an older Kino */ }
}

/**
 * Which welcome banner an activation failure deserves, so the message matches the real problem:
 *   "member"  → the person is not in the Kino Telegram group (403 not_member): they must rejoin, then re-authenticate.
 *   "update"  → an older Kino answered without the gate token.
 *   "consent" → the identity permission is off / not approved (kino.identity rejects and never re-prompts; the person must
 *               turn it on in Kino's settings — "Acepta el permiso y vuelve a intentarlo" is misleading here).
 *   "server"  → the backend refused, the challenge failed, or anything else (a retry later, not a permission).
 */
export function activateBanner(e) {
  if (isNotMember(e)) return "member";
  if (isTokenMissing(e)) return "update";
  if (e && e.code === "permission_denied") return "consent";
  if (e && e.code === "not_available") return "link";   // this device has no Telegram identity: link it in Kino
  return "server";
}

/** The stored Bearer (or null), never signing in: whether the screen is already connected. */
export async function currentBearer() { return storedBearer(); }

/** Forgets the stored session: the screen goes back to Welcome/Activate. Ajustes' "Desconectar". */
export async function clearBearer() { dropBearer(); remove(RELOGIN_KEY); remove(TRIAL_KEY); remove(NOT_MEMBER_KEY); }

/** Whether the screen's `open` signs in with no tap (RELOGIN_KEY above). */
export function reloginPending() { return getText(RELOGIN_KEY) === "1"; }

/** The person said no (identity switched off or refused): stop signing in on our own, the welcome view asks again. */
export function forgetRelogin() { remove(RELOGIN_KEY); }

/**
 * The re-authenticate reminder (`REAUTH_KEY`): the scheduled job (src/reauthNotice.js) reads it to post or clear the Home
 * bell notice. Marked only when `activateBanner` is a cause the PERSON must act on ("consent" = identity off / needs
 * re-link, "update" = an old Kino) — never a transient server error, and never a routine expiry (that re-signs in by
 * itself). Cleared on a fresh sign-in (the mint paths above) or when the welcome succeeds.
 */
export function markReauthNeeded(banner) { if (banner === "consent" || banner === "update") setText(REAUTH_KEY, "1"); }
export function clearReauthNeeded() { remove(REAUTH_KEY); }
export function reauthNeeded() { return getText(REAUTH_KEY) === "1"; }

/**
 * The group-membership freeze (`NOT_MEMBER_KEY`): set on a 403 {"detail":"not_member"} from the backend (the person left
 * the Kino Telegram group). While active, `authed` calls fail fast with the "join the group" message (no request leaves
 * the device), and the screen shows the "join the group" welcome even with a Bearer stored. Cleared only by a successful
 * sign-in (the mint paths above clear it) — i.e. once the person rejoined and the next /session passed.
 */
function markNotMember() { setText(NOT_MEMBER_KEY, "1"); }
export function notMemberActive() { return getText(NOT_MEMBER_KEY) === "1"; }
export function clearNotMember() { remove(NOT_MEMBER_KEY); }

// The one-time intro (`o2:intro`): the FIRST time a person opens Xuper with no session, the screen shows a short welcome
// with "Apoyar" + "Ingresar" (the person taps Ingresar to go in). From then on Xuper signs in by itself on open (a loading
// screen, no button). Set the moment they tap Ingresar.
const INTRO_KEY = "o2:intro";
export function introSeen() { return getText(INTRO_KEY) === "1"; }
export function markIntroSeen() { setText(INTRO_KEY, "1"); }
export function clearIntro() { remove(INTRO_KEY); }

/** Whether a backend error is the group-membership refusal (403 {"detail":"not_member"}). */
export function isNotMember(e) { return !!e && Number(e && e.status) === 403 && (e && e.detail) === "not_member"; }

/** The sentence for someone not in the Kino group. `lng`: "es" | "en" (default: the visible one). */
export function notMemberText(lng) {
  const es = "Debes estar en el grupo de Kino en Telegram. Únete al grupo y vuelve a validar tu Telegram.";
  const enText = "You must be in the Kino group on Telegram. Join the group, then re-validate your Telegram.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}

/** The 403 not_member error: the per-request refusal and the freeze's fail-fast, carrying the "join the group" message. */
function notMember() {
  const e = kino.error("unavailable", "Xuper: not a Kino group member (403 not_member)", { userMessage: notMemberText() });
  try { e.status = 403; e.detail = "not_member"; } catch (_) { /* frozen: the message says it */ }
  return e;
}

/**
 * After an update from Xuper 2.x (src/upgrade.js): with no Bearer stored, the screen's next `open` signs in with no tap,
 * as after a 401. → whether it was marked.
 */
export async function markRelogin() {
  if (await storedBearer()) return false;
  setText(RELOGIN_KEY, "1");
  return true;
}

let _minting = null;

/** Signs in through kino.identity (a screen call) and stores the Bearer. Coalesced: quick taps never start several
 *  sign-ins (each would close the consent sheet of the one before). */
export async function ensureBearer() {
  const b = await storedBearer();
  if (b) return b;
  if (_minting) return _minting;
  _minting = (async () => {
    try {
      const bearer = await mintSession();
      _bearer = bearer;
      setText(BEARER_KEY, String(bearer));
      remove(RELOGIN_KEY);
      remove(TRIAL_KEY);   // a new session: the next `open` prepares its trial
      remove(REAUTH_KEY);  // signed in again: the re-authenticate reminder (if any) no longer applies
      remove(NOT_MEMBER_KEY);  // /session passed: the person is a group member again, lift the freeze
      return bearer;
    } finally {
      _minting = null;
    }
  })();
  return _minting;
}

/**
 * Ajustes ▸ "Reautenticar": forces a FRESH session through kino.identity, for when the backend still trusts the person
 * but this device's session went stale (the real-world fix of a reinstall + re-link, without the reinstall). Unlike
 * [ensureBearer] it never returns the session already stored — it always mints a new one. The new session replaces the
 * old ONLY once it is in hand: a failed mint throws and leaves the working session untouched, so a failure never
 * disconnects the person. Coalesced like ensureBearer (quick taps never open several consent sheets).
 */
export async function reauth() {
  if (_minting) return _minting;
  _minting = (async () => {
    try {
      const bearer = await mintSession();
      _bearer = bearer;
      setText(BEARER_KEY, String(bearer));
      remove(RELOGIN_KEY);
      remove(TRIAL_KEY);   // a new session: the next `open` prepares its trial
      remove(REAUTH_KEY);  // signed in again: the re-authenticate reminder (if any) no longer applies
      remove(NOT_MEMBER_KEY);  // /session passed: the person is a group member again, lift the freeze
      return bearer;
    } finally {
      _minting = null;
    }
  })();
  return _minting;
}

/** The sentence for a Bearer the backend refused (401): the screen's next opening signs in again. `lng`: "es" | "en" (default: the visible one). */
export function sessionExpiredText(lng) {
  const es = "La sesión venció. Abre la pantalla de Xuper para reconectarte.";
  const enText = "The session expired. Open the Xuper screen to reconnect.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}

/**
 * The backend refused Bearer `b` (a 401): forgotten and marked for the screen's sign-in again. Only when the Bearer refused
 * is still the stored one (a concurrent call may have minted a new one meanwhile).
 */
function bearerRefused(b) {
  if (getText(BEARER_KEY) === b) {
    log("session refused by the backend (401): forgotten; the screen signs in again on its next opening");
    dropBearer();
    setText(RELOGIN_KEY, "1");
  } else if (_bearer === b) _bearer = null;
}

// ── backend rate limit (backend 5b4630e, 2026-11-17) ──
// The catalog endpoints answer 429 {"detail":"rate_limited"} past 120 calls a minute or 600 an hour per account, and
// Cloudflare answers 429 with a page of its own (over 50 requests in 10 s per IP). Either way: no retry now; that
// endpoint family (the path's first segment: search, item, column, resolve…) waits at least 60 s (Retry-After when
// longer, 10 min at most), in memory and in a small stored stamp so a new runtime waits too. Inside the wait a call
// fails at once with no request.
export const RL_KEY = "o2:rl";   // {"<family>": <until, epoch ms>}
const RL_MIN_MS = 60_000;
const RL_MAX_MS = 10 * 60_000;
let _rl = null;                  // this runtime's copy (read once from storage)

/** The endpoint family of a backend path: its first segment ("/resolve/step" → "resolve", "/search?q=" → "search"). */
export function familyOf(path) {
  const m = /^\/*([^/?#]+)/.exec(String(path == null ? "" : path));
  return m ? m[1].toLowerCase() : "";
}

function rlMap() {
  if (!_rl) {
    _rl = {};
    const s = getJson(RL_KEY);
    if (s && typeof s === "object" && !Array.isArray(s)) for (const k of Object.keys(s)) { const v = Number(s[k]); if (v > 0) _rl[k] = v; }
  }
  return _rl;
}

/** Until when (epoch ms) family `fam` waits after a 429, or 0. A stamp past the longest wait (a clock set back) is none. */
export function limitedUntil(fam, now = Date.now()) {
  const u = Number(rlMap()[fam]) || 0;
  return u > now && u - now <= RL_MAX_MS ? u : 0;
}

function retryAfterMs(res) {
  const h = (res && res.headers) || {};
  const v = Number(h["retry-after"] != null ? h["retry-after"] : h["Retry-After"]);
  return Number.isFinite(v) && v > 0 ? v * 1000 : 0;
}

function noteLimited(fam, res) {
  const now = Date.now();
  const m = rlMap();
  m[fam] = Math.max(Number(m[fam]) || 0, now + Math.min(RL_MAX_MS, Math.max(RL_MIN_MS, retryAfterMs(res))));
  for (const k of Object.keys(m)) if (!(m[k] > now)) delete m[k];
  setJson(RL_KEY, m, { ttlMs: RL_MAX_MS });
  log("backend 429 on /" + fam + ": that family waits " + Math.round((m[fam] - now) / 1000) + " s");
}

/** The sentence for a rate-limited call. `lng`: "es" | "en" (default: the visible one). */
export function rateLimitedText(lng) {
  const es = "Demasiadas solicitudes. Prueba en un minuto.";
  const enText = "Too many requests. Try again in a minute.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}

function rateLimited(fam) {
  const e = kino.error("unavailable", "Xuper: backend rate limited (429) on " + fam, { userMessage: rateLimitedText() });
  try { e.rateLimited = true; } catch (_) { /* frozen: the message still says it */ }
  return e;
}

// ── region blocked (backend 6092526 region.py) ──
// 451 {"detail":"region_blocked"}: the portal blocks this person's region and the backend could not get around it (its
// own trials are spent for now, or the portal blocks the content itself from this address). Never retried by the plugin.

/** The sentence for a call the person's region blocks. `lng`: "es" | "en" (default: the visible one). */
function regionBlockedText(lng) {
  const es = "Xuper no está disponible en tu región en este momento. Prueba más tarde.";
  const enText = "Xuper is not available in your region right now. Try again later.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}

function regionBlocked(fam) {
  const e = kino.error("unavailable", "Xuper: backend 451 region_blocked " + fam, { userMessage: regionBlockedText() });
  try { e.status = 451; e.detail = "region_blocked"; } catch (_) { /* frozen: the message says it */ }
  return e;
}

/** Whether `e` is a backend 429 (or a call refused inside its family's wait). */
export function isRateLimited(e) {
  return !!e && (e.rateLimited === true || /rate limited \(429\)/.test(String(e.message || "")));
}

/** Test helper: forget this runtime's copy of the waits (a new runtime reads the stored stamp). */
export function _resetRateLimit() { _rl = null; }

/**
 * An authenticated GET/POST → JSON, with the STORED Bearer. No Bearer → `notActivated` (auth_required). A 429 (or a family still
 * in its wait) throws a rate-limited error (`isRateLimited`) with the "too many requests" sentence and is never retried.
 * `fam` names the rate-limit family when the path's first segment is not it (a flow's POST /egress/step). A 409
 * {"detail":"trial_needed"} (egress v2: the person's trial session is missing or expired) runs the trial flow (once per
 * plugin call, shared by parallel calls) and repeats this request once; a second 409 throws.
 * `deadline` (epoch ms, optional: a resolve's, src/catalog.js): each attempt's `timeoutMs` is cut to what is left of it,
 * and an attempt with less than MIN_LEFT_MS left is never sent (an out-of-time error instead). The repeat after the trial
 * is why: the trial may take up to 10 s of the call (TRIAL_BUDGET_MS), and the first attempt's timeout, computed before
 * it, would then end past Kino's 20 s. The trial itself ends by it too, when that is sooner than its own end (`trialFlow`).
 */
export async function authed(method, path, body, timeoutMs, fam, deadline) {
  const family = fam || familyOf(path);
  try { return await authedOnce(method, path, body, timeoutBefore(deadline, timeoutMs, family), fam); }
  catch (e) {
    if (!trialNeeded(e)) throw e;
  }
  await trialForRetry(family, deadline);
  try { return await authedOnce(method, path, body, timeoutBefore(deadline, timeoutMs, family), fam); }
  catch (e) { throw trialNeeded(e) ? trialError(family) : e; }   // still no trial: never a second round
}

/**
 * A flow's step under `authed`, without its repeat: a 409 trial_needed on a step answers a portal reply from a trial
 * that is gone, and repeating that step made the backend renew the trial again, dropping the one just made (KALLEY,
 * 2026-11-18). The flow starts over from its start instead (`egressFlow`).
 */
function authedStep(method, path, body, timeoutMs, fam, deadline) {
  return authedOnce(method, path, body, timeoutBefore(deadline, timeoutMs, fam || familyOf(path)), fam);
}

/** `authed` without the 409 trial recovery (the trial flow itself, so it never recurses). */
async function authedOnce(method, path, body, timeoutMs, fam) {
  const b = await storedBearer();
  if (!b) throw notActivated();
  if (notMemberActive()) throw notMember();   // frozen: fail fast until a successful /session (a rejoin) lifts it
  const family = fam || familyOf(path);
  if (limitedUntil(family)) throw rateLimited(family);
  const res = await rawBackend(method, path, body, b, timeoutMs);
  if (res.status === 401) {
    bearerRefused(b);
    const e = kino.error("unavailable", "Xuper: session refused (401) on " + path, { userMessage: sessionExpiredText() });
    try { e.status = 401; } catch (_) { /* frozen: the message says it */ }
    throw e;
  }
  if (res.status === 429) { noteLimited(family, res); throw rateLimited(family); }
  if (res.status === 451) throw regionBlocked(family);
  if (!res.ok) {
    let detail = "";
    try { const j = res.json(); detail = j && typeof j.detail === "string" ? j.detail : ""; } catch (_) { /* not JSON */ }
    // Left the Kino group: freeze and fail with the "join the group" message (any authenticated endpoint can answer this).
    if (res.status === 403 && detail === "not_member") { markNotMember(); throw notMember(); }
    const e = kino.error("unavailable", "Xuper: backend " + res.status + (detail ? " " + detail : "") + " " + family);
    try { e.status = Number(res.status) || 0; e.detail = detail; } catch (_) { /* frozen: the message says it */ }
    throw e;
  }
  return res.json();
}

/** The HTTP status a backend error carries (`authed`), or 0. */
export function backendStatus(e) {
  if (e && Number(e.status) > 0) return Number(e.status);
  const m = /backend (\d{3})\b/.exec(String((e && e.message) || ""));
  return m ? Number(m[1]) : 0;
}

/** A seed's least remaining life worth taking (s): GET /seed hands out the soonest-expiring seed first, with no floor. */
const SEED_MIN_REMAINING_S = 120;
const seedField = (v) => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

/**
 * One backup session from the backend's pool (GET /seed, design §4): one-use, so the caller stores it and reuses it.
 * → `{ ok: true, seed: { sn, userId, userToken, mintedAt? }, lifeMs, expiresAt }` (only the three ids the portal calls
 * use, plus the mint time; never the jwtToken or the portal's extras), or `{ ok: false, status }` with `status` one of
 * 401 (the Bearer was refused: dropped here, the screen signs in again), 429 (this hour's quota is spent), 503 (no seed
 * free), another HTTP status, "bad" (an answer that is not a usable seed), "network" (no answer) or "nobearer". Never
 * throws and never logs: the caller logs codes only.
 * `fresh`: `GET /seed?fresh=1` skips the backend's sticky assignment and hands out a seed other than the one this
 * account was given (releasing that one): for a seed the portal geo-blocked, and for the person's "Cambiar semilla".
 */
export async function fetchSeed(timeoutMs, fresh = false) {
  const b = await storedBearer();
  if (!b) return { ok: false, status: "nobearer" };
  let res;
  try { res = await rawBackend("GET", fresh ? "/seed?fresh=1" : "/seed", undefined, b, timeoutMs); } catch (_) { return { ok: false, status: "network" }; }
  if (!res) return { ok: false, status: "network" };
  if (res.status === 401) { bearerRefused(b); return { ok: false, status: 401 }; }
  if (res.status === 403) { try { const j = res.json(); if (j && j.detail === "not_member") markNotMember(); } catch (_) { /* not JSON */ } return { ok: false, status: 403 }; }
  if (res.status !== 200) return { ok: false, status: Number(res.status) || "network" };
  let body;
  try { body = res.json(); } catch (_) { return { ok: false, status: "bad" }; }
  let seed = body && body.seed;
  if (typeof seed === "string") { try { seed = JSON.parse(seed); } catch (_) { seed = null; } }
  if (!seed || typeof seed !== "object" || Array.isArray(seed)) return { ok: false, status: "bad" };
  const out = { sn: seedField(seed.sn), userId: seedField(seed.userId), userToken: seedField(seed.userToken) };
  if (!out.sn || !out.userId || !out.userToken) return { ok: false, status: "bad" };
  const remaining = Number(body.remaining_s);
  if (!Number.isFinite(remaining) || remaining <= SEED_MIN_REMAINING_S) return { ok: false, status: "bad" };
  const minted = Number(seed.mintedAt);
  if (Number.isFinite(minted) && minted > 0) out.mintedAt = Math.floor(minted);
  const expiresAt = Number(body.expires_at);
  return { ok: true, seed: out, lifeMs: Math.floor(remaining * 1000), expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0 };
}

/**
 * The seed contribution (src/seedContrib.js): POST /seed {seed} with the stored Bearer, so the backend loads the fresh
 * anonymous session into the pool GET /seed hands out. → `{ ok: true }` on a 2xx, or `{ ok: false, status }` with
 * `status` 401 (the Bearer was refused: dropped here, the screen signs in again), 429, another HTTP status (405: a
 * backend without the route yet), "network" or "nobearer". Never throws and never logs: the caller logs codes only.
 */
export async function postSeed(seed, timeoutMs) {
  const b = await storedBearer();
  if (!b) return { ok: false, status: "nobearer" };
  let res;
  try { res = await rawBackend("POST", "/seed", { seed }, b, timeoutMs); } catch (_) { return { ok: false, status: "network" }; }
  if (!res) return { ok: false, status: "network" };
  if (res.status === 401) { bearerRefused(b); return { ok: false, status: 401 }; }
  const status = Number(res.status) || 0;
  if (status >= 200 && status < 300) return { ok: true };
  return { ok: false, status: status || "network" };
}

/**
 * Ajustes ▸ Dispositivos: GET /devices with the stored Bearer (backend 71a1a3b). → `{ ok: true, used, max, devices }`
 * (`devices`: `[{ current, plugins, lastSeen }]` as the backend sends them, newest first) or `{ ok: false, status }`:
 * 401 (the Bearer was refused: dropped and marked for the screen's sign-in again, as every endpoint), 404 (an older
 * backend), 429, another HTTP status, "bad" (not the expected shape), "network" or "nobearer". Never throws.
 */
export async function fetchDevices(timeoutMs) {
  const b = await storedBearer();
  if (!b) return { ok: false, status: "nobearer" };
  if (limitedUntil("devices")) return { ok: false, status: 429 };
  let res;
  try { res = await rawBackend("GET", "/devices", undefined, b, timeoutMs); } catch (_) { return { ok: false, status: "network" }; }
  if (!res) return { ok: false, status: "network" };
  if (res.status === 401) { bearerRefused(b); return { ok: false, status: 401 }; }
  if (res.status === 429) { noteLimited("devices", res); return { ok: false, status: 429 }; }
  if (res.status !== 200) return { ok: false, status: Number(res.status) || "network" };
  let body;
  try { body = res.json(); } catch (_) { return { ok: false, status: "bad" }; }
  const used = Number(body && body.used), max = Number(body && body.max);
  if (!body || !Array.isArray(body.devices) || !Number.isFinite(used) || !Number.isFinite(max) || used < 0 || max <= 0) return { ok: false, status: "bad" };
  return { ok: true, used: Math.floor(used), max: Math.floor(max), devices: body.devices };
}

// ── egress (backend 5127e50 resolve, f545db3 search, b3f1849 + a11c604 egress v2) ──
// Every start (POST /resolve/<id>, /search/egress, /column/egress, /item/egress, /trial/egress) answers the same
// envelope: {results} (done, or the backend's cache) or {egress: {method, url, headers, body}, step}. While a ticket
// comes, this device sends it to the portal from ITS address (kino.fetch, no cookies: the ticket brings its own headers)
// and posts the raw answer to the flow's step path, which answers the same envelope again. The backend needs at most 4
// steps a flow; 6 is the anti-loop guard. A step that expired, was used or belongs to another device (400 bad_step /
// step_mismatch) starts the flow over once. Steps go to POST /egress/step (column, item, trial), /search/step (search:
// an alias of /egress/step, kept until the backend says otherwise) and /resolve/step (resolve, prepare).
// A 429 on a step counts against the flow's family (resolve, prepare, search, column, item, trial), never an "egress"
// family of its own: a flow is one family from its start to its last step.
// A resolve asks for the BATCH flow (backend b45b73e): POST /resolve/<id>?…&batch=1 answers {step, parallel, tickets:
// [{id, method, url, headers, body}]} instead of {egress, step}. Every ticket of a step goes to the portal from this
// device (all at once when `parallel`), and POST /resolve/step {step, answers: {<id>: {response}}} answers the next step
// or {stream}; a step with an id missing is refused (400 bad_answer) and not used up. Ids: play (startPlayVOD), slb
// (getSlbInfo), login (account mode), tok/act/free (the trial, made inside the resolve: a batch resolve never answers 409).
// With the CDN authorization (slb) the backend cached for this person and device, a step is [play] alone; `fresh=1` makes
// it ask for a new one (`relayResolve`'s `fresh`). A backend without batch ignores the parameter and answers the classic
// envelope, which this flow runs as before.
// An older backend: a start it lacks answers 404 with FastAPI's own detail "Not Found" (/trial/egress), or 405 when an
// older GET route's pattern takes the path (POST /item/egress hits GET /item/{content_id}, POST /column/egress hits GET
// /column/{column_id}). Either keeps that family's GET path for the rest of this runtime; a 404 with no JSON detail
// (unsure: a proxy's page) takes the GET path this once; any other 404 detail is the backend's own answer (the item does
// not exist) and throws. A missing /egress/step (404 "Not Found" or 405) sends the steps to its /search/step alias for
// the rest of the runtime.
const EGRESS_STEP = "/egress/step";
const SEARCH_STEP = "/search/step";
const RESOLVE_STEP = "/resolve/step";
const ROUTE_MISSING = "Not Found";           // FastAPI's detail for a route this backend does not have
const MAX_EGRESS_STEPS = 6;
// A batch resolve's own guard: it needs up to 8 steps (a trial made inside it, made again once when the portal drops it
// mid-play) and a login.
const MAX_BATCH_STEPS = 10;
const MIN_LEFT_MS = 800;                     // a flow under a deadline never starts a request with less than this left
/**
 * One backend request under a call deadline (the relay's start and steps, a resolve's title lookup): at most this. With
 * no cap a stalled hop took rawBackend's 20 s, all of Kino's resolve (PluginContentSource.RESOLVE_TIMEOUT_MS): Kino timed
 * the call out instead of the plugin failing it.
 */
export const BACKEND_HOP_TIMEOUT_MS = 8000;
/** One portal call of the relay (login, startPlayVOD, getSlbInfo). It was 25 s: more than Kino's whole 20 s resolve. */
const RESOLVE_PORTAL_TIMEOUT_MS = 10000;
const SEARCH_PORTAL_TIMEOUT_MS = 8000;
const CATALOG_PORTAL_TIMEOUT_MS = 8000;      // column, item
const RESULT_KEYS = ["programResult", "seriesResult", "personResult", "resourceResult"];
const _noRoute = {};                          // "search" | "column" | "item" | "trial" | "prepare" | "egressStep" → true: missing here

/** Test helper: forget what this runtime learnt about the backend's egress routes. */
export function _resetEgress() { for (const k of Object.keys(_noRoute)) delete _noRoute[k]; }
/** Test helper (older name). */
export const _resetSearchEgress = _resetEgress;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const detailOf = (e) => (e && typeof e.detail === "string" ? e.detail : "");
const routeMissing = (e) => (backendStatus(e) === 404 && detailOf(e) === ROUTE_MISSING) || backendStatus(e) === 405;
const staleStep = (e) => backendStatus(e) === 400 && (detailOf(e) === "bad_step" || detailOf(e) === "step_mismatch");
const resultsOf = (r) => (r && isObj(r.results) ? r.results : null);
const wasRefused = (e) => !!e && (typeof e.refused === "string" || / never sends /.test(String(e.message || "")));

/**
 * The timeout of a request that must end by `deadline` (epoch ms): at most `max` (no `max`: what is left), or throws
 * `family`'s out-of-time error when less than MIN_LEFT_MS is left (the request is not sent). No `deadline`: `max` as is
 * (undefined keeps rawBackend's 20 s).
 */
function timeoutBefore(deadline, max, family) {
  if (!deadline) return max;
  const left = deadline - Date.now();
  if (left < MIN_LEFT_MS) throw kino.error("unavailable", "Xuper: " + family + " flow out of time");
  return max ? Math.min(max, left) : left;
}

/** A request's timeout under flow `o`'s deadline (at most `max`; no `max`: what is left), or throws when out of time. */
function timeoutIn(o, max) { return timeoutBefore(o.deadline, max, o.family); }

/**
 * Posts one step: `{step, response}` (a classic ticket's raw portal answer) or `{step, answers}` (a batch step's); a
 * backend with no /egress/step takes it on its /search/step alias.
 */
async function postStep(body, o) {
  const path = o.stepPath === EGRESS_STEP && _noRoute.egressStep ? SEARCH_STEP : o.stepPath;
  const post = o.post === authed ? authedStep : o.post;   // a step is never repeated after a trial (`authedStep`)
  try { return await post("POST", path, body, timeoutIn(o, o.backendTimeoutMs), o.family, o.deadline); }
  catch (e) {
    if (path !== EGRESS_STEP || !routeMissing(e)) throw e;
    _noRoute.egressStep = true;
    log("egress: the backend has no /egress/step: steps go to /search/step");
    return post("POST", SEARCH_STEP, body, timeoutIn(o, o.backendTimeoutMs), o.family, o.deadline);
  }
}

/**
 * While the answer carries portal work, the portal from this device, then the step: a classic `egress` ticket, or a batch
 * step's `tickets` (every one answered in the same step). Work the flow `refuses` stops it before the portal. → the last
 * answer.
 */
async function runEgress(first, o) {
  let r = first;
  let n = 0;
  while (r && (r.egress || Array.isArray(r.tickets))) {
    if (n++ >= (o.maxSteps || MAX_EGRESS_STEPS)) throw kino.error("unavailable", "Xuper: too many egress steps (" + o.family + ")");
    const refused = o.refuses ? o.refuses(r) : "";
    if (refused) throw refusedStep(o.family, refused);
    r = r.egress
      ? await postStep({ step: r.step, response: await askPortal(r.egress, o) }, o)
      : await postStep({ step: r.step, answers: await answerTickets(r.tickets, r.parallel === true, o) }, o);
  }
  return r;
}

/** The error of a step whose portal work its flow never sends (`refuses`: `what`): nothing of it left this device. */
function refusedStep(family, what) {
  const e = kino.error("unavailable", "Xuper: " + family + " never sends " + what);
  try { e.refused = what; } catch (_) { /* frozen: the message says it */ }
  return e;
}

/** One ticket's portal request from this device's address (no cookies: the ticket brings its own headers). → its raw text. */
async function askPortal(tk, o) {
  const resp = await kino.fetch(tk.url, {
    method: tk.method || "POST",
    headers: tk.headers || {},
    body: tk.body,              // opaque ciphertext (string)
    cookies: false,
    timeoutMs: timeoutIn(o, o.portalTimeoutMs),
  });
  return resp.text();
}

/** A batch step's `answers` ({<id>: {response}}): every ticket asked, all at once when `parallel`, else in the order given. */
async function answerTickets(tickets, parallel, o) {
  if (!tickets.length || tickets.some((tk) => !isObj(tk) || !tk.id || !tk.url)) {
    throw kino.error("unavailable", "Xuper: malformed batch step (" + o.family + ")");
  }
  const texts = [];
  if (parallel) texts.push(...(await Promise.all(tickets.map((tk) => askPortal(tk, o)))));
  else for (const tk of tickets) texts.push(await askPortal(tk, o));
  const answers = {};
  tickets.forEach((tk, i) => { answers[tk.id] = { response: texts[i] }; });
  return answers;
}

/**
 * One egress flow. `o`: `start` (path), `family`, `stepPath`, `portalTimeoutMs`, `post` (`authed`, or `authedOnce` for
 * the trial), `maxSteps` (optional: the anti-loop guard, MAX_EGRESS_STEPS by default), `done(answer)` → the value or null (an answer without results throws), `getPath` (the family has a GET
 * path or can do without: a missing start answers null), `deadline` (epoch ms, optional; `authed` also cuts its repeat
 * after a trial to it, and the trial itself), `backendTimeoutMs` (optional: the start's and each step's most; none:
 * rawBackend's 20 s, or what is left of the deadline), `refuses(answer)` (optional: prepare's) → what of an answer's
 * portal work this flow never sends ("" for none), which fails the flow before the portal (`wasRefused`). → `done`'s
 * value, or null when this backend has no such start (the caller uses its GET path).
 */
async function egressFlow(o) {
  if (o.getPath && _noRoute[o.family]) return null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r;
    try { r = await o.post("POST", o.start, undefined, timeoutIn(o, o.backendTimeoutMs), o.family, o.deadline); }
    catch (e) {
      if (o.getPath && routeMissing(e)) { _noRoute[o.family] = true; log(o.family + ": the backend has no " + o.family + " egress: GET path"); return null; }
      if (o.getPath && backendStatus(e) === 404 && !detailOf(e)) { log(o.family + ": 404 with no detail on the egress start: GET path this once"); return null; }
      throw e;
    }
    try { r = await runEgress(r, o); }
    catch (e) {
      if (attempt === 0 && staleStep(e)) { log(o.family + ": step refused (" + detailOf(e) + "): starting over"); continue; }
      if (o.post === authed && trialNeeded(e)) {
        // The step carried a portal answer from a trial that is gone (`authedStep`): a new trial, then the flow anew.
        if (attempt > 0) throw trialError(o.family);
        await trialForRetry(o.family, o.deadline);
        log(o.family + ": the trial was renewed mid-flow: starting over");
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

/**
 * EGRESS RELAY. `tail` = what follows /resolve/ (contentId [+ query]).
 * The backend builds each portal request (login→startPlayVOD→getSlbInfo), encrypted for the account; this device
 * posts it (from its own address) and the raw answer goes back to the backend, which decrypts it and moves on. At the
 * end it answers {stream:{url,...}} (or {results:{stream}}) signed for this device's address. Asks for the batch flow (see above);
 * `fresh`: the backend asks the portal for a new CDN authorization instead of the one it cached (`fresh=1`).
 * `deadline` (epoch ms): the plugin call's (src/catalog.js RESOLVE_BUDGET_MS). Every hop ends by it, each backend one in
 * at most BACKEND_HOP_TIMEOUT_MS and each portal one in at most RESOLVE_PORTAL_TIMEOUT_MS, so a stalled hop fails the call
 * with the plugin's own error inside Kino's 20 s instead of Kino timing the whole call out.
 */
export async function relayResolve(tail, deadline, fresh = false) {
  const r = await egressFlow({
    start: "/resolve/" + tail + (tail.includes("?") ? "&" : "?") + "batch=1" + (fresh ? "&fresh=1" : ""), family: "resolve", stepPath: RESOLVE_STEP, backendTimeoutMs: BACKEND_HOP_TIMEOUT_MS, maxSteps: MAX_BATCH_STEPS,
    portalTimeoutMs: RESOLVE_PORTAL_TIMEOUT_MS, post: authed, deadline, done: (x) => x || {},
  });
  const s = r.stream || (isObj(r.results) ? r.results.stream : null);
  if (!s || !s.url) throw kino.error("unavailable", t("Xuper: no se pudo abrir el video", "Xuper: could not open the video"));
  return s;
}

// ── prepare: a title page's play ahead (backend 7046b17, owner 2026-11-18) ──
// Kino calls `prepare` while the person rests on a title page (src/catalog.js). A full resolve there would spend one of
// /resolve's 60 an hour per account, and may spend one of the portal's free plays, on a title nobody may play: this plugin
// never declares resolveAhead. POST /resolve/prepare readies the rest instead: the person's trial session and this
// device's CDN authorization (slb). It answers {results: {ready: true, slbExpiresAt}} when all is ready (no portal call),
// or the batch steps of a resolve without its play, through POST /resolve/step: tok → act → free (no trial), slb (no valid
// authorization), login (account mode). Never a play ticket, and this device never sends one there (`prepareRefuses`).
// Its own quota (30 an hour per account) and so its own family: a 429 there never holds up the person's resolve. After it,
// the resolve brings only [play] while the slb lasts (~2.5–3 h; slbExpiresAt has a 5-minute margin off already), and until
// then a prepare under the same Bearer asks nothing at all.
const PREPARE_START = "/resolve/prepare";
const PREPARE_FAMILY = "prepare";   // its rate-limit family, and its `_noRoute` latch
/** An slb lasts about 2.5–3 h: an expiry further ahead than this is a clock (or a unit) gone wrong, never trusted. */
const SLB_MAX_AHEAD_MS = 6 * 60 * 60_000;
let _prepared = { bearer: "", until: 0 };   // the last prepare that was ready: its Bearer, and its slb's end (epoch ms)

/** Test helper: forget what this runtime's prepares readied. */
export function _resetPrepare() { _prepared = { bearer: "", until: 0 }; }

/** The end (epoch ms) of the slb a prepare readied (`slbExpiresAt`: ms, seconds tolerated), or 0: none, past or absurd. */
function slbUntil(v, now = Date.now()) {
  const exp = epochMs(v);
  return exp > now && exp - now <= SLB_MAX_AHEAD_MS ? exp : 0;
}

/**
 * Portal work a prepare never sends ("" when there is none): a classic ticket (prepare answers batch steps only, so this is
 * an older backend's POST /resolve/{content_id} taking the path) or a play (startPlayVOD may spend a free play), known by
 * its ticket id or by the portal request it names.
 */
function prepareRefuses(r) {
  if (r.egress || !Array.isArray(r.tickets)) return "a classic ticket";
  const plays = (tk) => isObj(tk) && (String(tk.id).toLowerCase() === "play" || /startplay/i.test(String(tk.url || "")));
  return r.tickets.some(plays) ? "a play" : "";
}

/**
 * Readies the person's trial session and this device's CDN authorization for the plays that follow (above). Every hop ends
 * by `deadline` (epoch ms: src/catalog.js PREPARE_BUDGET_MS), a backend one in at most BACKEND_HOP_TIMEOUT_MS and a portal
 * one in at most RESOLVE_PORTAL_TIMEOUT_MS, as the relay's. While the slb of the last ready prepare under this Bearer lasts,
 * nothing is asked. → the results ({ready, slbExpiresAt}; the remembered ones when nothing was asked), or null when this
 * backend has no prepare: 404 "Not Found" or 405 on the start, or portal work prepare never sends (nothing of it is sent),
 * both for the rest of this runtime (a 404 with no detail: this once). Throws like `authed` (401, 429, 5xx, out of time).
 */
export async function prepareRelay(deadline) {
  const b = await storedBearer();
  const now = Date.now();
  if (b && b === _prepared.bearer && now < _prepared.until) {
    log("prepare: still ready for " + Math.round((_prepared.until - now) / 60000) + " min: nothing asked");
    return { ready: true, slbExpiresAt: _prepared.until };
  }
  let res;
  try {
    res = await egressFlow({
      start: PREPARE_START, family: PREPARE_FAMILY, stepPath: RESOLVE_STEP, backendTimeoutMs: BACKEND_HOP_TIMEOUT_MS, maxSteps: MAX_BATCH_STEPS,
      portalTimeoutMs: RESOLVE_PORTAL_TIMEOUT_MS, post: authed, getPath: true, deadline, done: resultsOf, refuses: prepareRefuses,
    });
  } catch (e) {
    if (!wasRefused(e)) throw e;
    _noRoute[PREPARE_FAMILY] = true;   // a backend that asked for it once would ask again: no more prepares on this runtime
    log("prepare: the backend asked for " + (e.refused || "work prepare never sends") + ": nothing sent, no prepare for the rest of this runtime");
    return null;
  }
  if (res == null) return null;
  if (res.ready !== true) { log("prepare: the backend answered not ready"); return res; }
  const until = slbUntil(res.slbExpiresAt);
  if (until) _prepared = { bearer: b, until };
  log("prepare: ready" + (until ? ", " + Math.round((until - Date.now()) / 60000) + " min of CDN authorization left" : ""));
  return res;
}

/**
 * The search results for `q` through this device ({programResult, seriesResult, personResult, resourceResult}), or null
 * when the backend has no /search/egress (the caller then uses GET /search). Throws like `authed` (401, 429, 5xx).
 */
export async function egressSearch(q) {
  return egressFlow({
    start: "/search/egress?q=" + encodeURIComponent(q) + "&page=1&size=25", family: "search", stepPath: SEARCH_STEP,
    portalTimeoutMs: SEARCH_PORTAL_TIMEOUT_MS, post: authed, getPath: true,
    done: (r) => resultsOf(r) || (isObj(r) && RESULT_KEYS.some((k) => k in r) ? r : null),   // a bare body: tolerated
  });
}

/**
 * One page of a column through this device: what GET /column/{id} answers ({items, total, channels, channelsTotal,
 * page, size}), or null when the backend has no /column/egress (the caller then uses GET /column/{id}).
 */
export async function egressColumn(columnId, page, size) {
  return egressFlow({
    start: "/column/egress?column_id=" + encodeURIComponent(columnId) + "&page=" + page + "&size=" + size, family: "column",
    stepPath: EGRESS_STEP, portalTimeoutMs: CATALOG_PORTAL_TIMEOUT_MS, post: authed, getPath: true, done: resultsOf,
  });
}

/**
 * An item's detail through this device: what GET /item/{id} answers ({detail, related}), or null when the backend has
 * no /item/egress (or a 404 with no detail: the caller then uses GET /item/{id}). An item that does not exist throws (404).
 * `deadline` (epoch ms, optional: a resolve's title lookup for the masnew fallback): every hop ends by it, each backend
 * one in at most BACKEND_HOP_TIMEOUT_MS. Without it (Kino's detail page) the backend hops keep rawBackend's 20 s.
 */
export async function egressItem(contentId, type, deadline) {
  return egressFlow({
    start: "/item/egress?content_id=" + encodeURIComponent(contentId) + "&language=en&type=" + encodeURIComponent(type == null ? "" : type),
    family: "item", stepPath: EGRESS_STEP, portalTimeoutMs: CATALOG_PORTAL_TIMEOUT_MS, post: authed, getPath: true, done: resultsOf,
    deadline, backendTimeoutMs: deadline ? BACKEND_HOP_TIMEOUT_MS : undefined,
  });
}

// ── the person's trial session (egress v2) ──
// The catalog and the relay run on the person's own trial session, created FROM THIS DEVICE: POST /trial/egress →
// three portal steps (v3/snToken → v8/active → v2/getFree) → {results: {ready: true, expiresAt: epoch ms}}, or
// {results} at once while one is still valid. Two triggers only: a 409 {"detail":"trial_needed"} on any backend call
// (`authed` runs the flow once per plugin call, then repeats that call once), and the screen's `open` event (after the
// sign-in) at most once every 6 h and never while the stored expiry is still ahead. Never from timers, Home or search
// on their own. The stored stamp: {"expiresAt": epoch ms, "openAt": epoch ms of the last attempt from `open`}.
export const TRIAL_KEY = "o2:trial";
const TRIAL_FLIGHT = "xuper:trial";
const TRIAL_BUDGET_MS = 10_000;              // the whole flow (start + 3 portal calls + 3 steps)
const TRIAL_CALL_BUDGET_MS = 16_000;         // and never past this much of the plugin call (Kino cuts at 15–20 s)
const TRIAL_PORTAL_TIMEOUT_MS = 6000;
const TRIAL_OPEN_EVERY_MS = 6 * 60 * 60_000;
const TRIAL_MARGIN_MS = 60_000;              // an expiry closer than this is already gone
const TRIAL_MAX_AHEAD_MS = 30 * 24 * 60 * 60_000;   // an expiry further than this is a clock (or a unit) gone wrong

/** The sentence for a call whose trial session could not be prepared. `lng`: "es" | "en" (default: the visible one). */
export function trialFailedText(lng) {
  const es = "No se pudo preparar tu sesión de Xuper. Inténtalo de nuevo en un momento.";
  const enText = "Could not prepare your Xuper session. Try again in a moment.";
  return lng === "en" ? enText : lng === "es" ? es : t(es, enText);
}

const trialNeeded = (e) => backendStatus(e) === 409 && detailOf(e) === "trial_needed";

function trialStamp() {
  const s = getJson(TRIAL_KEY);
  return isObj(s) ? s : {};
}

/** Epoch ms from the backend's `expiresAt` (ms; seconds tolerated), or 0. */
function epochMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n < 1e12 ? n * 1000 : n);
}

/** Whether the stored trial is still valid at `now` (more than a minute left, and not absurdly far ahead). */
export function trialValid(now = Date.now()) {
  const exp = Number(trialStamp().expiresAt) || 0;
  return exp - now > TRIAL_MARGIN_MS && exp - now <= TRIAL_MAX_AHEAD_MS;
}

/**
 * The trial flow. → true when the trial is ready (its expiry stored), false when this backend has no /trial/egress.
 * `cap` (epoch ms, optional): the deadline of the call that needs the trial, when it comes before TRIAL_CALL_BUDGET_MS.
 * A prepare's does (src/catalog.js PREPARE_BUDGET_MS, 12 s): Kino gives that background call 15 s, and a call it times out
 * loses its runtime, so the person's play that follows would open a cold one.
 */
async function trialFlow(cap) {
  const deadline = Math.min(Date.now() + TRIAL_BUDGET_MS, callStartedAt() + TRIAL_CALL_BUDGET_MS, cap || Infinity);
  const res = await egressFlow({
    start: "/trial/egress", family: "trial", stepPath: EGRESS_STEP, portalTimeoutMs: TRIAL_PORTAL_TIMEOUT_MS,
    post: authedOnce, getPath: true, deadline, done: resultsOf,
  });
  if (res == null) return false;
  if (res.ready !== true) throw kino.error("unavailable", "Xuper: trial answer not ready");
  const expiresAt = epochMs(res.expiresAt);
  setJson(TRIAL_KEY, { ...trialStamp(), expiresAt });
  log("trial: ready" + (expiresAt ? ", " + Math.round((expiresAt - Date.now()) / 60000) + " min left" : ""));
  return true;
}

/**
 * The 409 recovery: the trial flow (shared by every call of this plugin call), or throws why the call cannot go on.
 * `deadline` (epoch ms, optional): the call's, which the trial never outlasts (`trialFlow`'s `cap`).
 */
async function trialForRetry(fam, deadline) {
  log("backend 409 trial_needed on /" + fam + ": preparing the trial session");
  // The stored expiry was wrong: `open` may try again (unless this call's flow already ran and stored a new one).
  if (!inFlight(TRIAL_FLIGHT)) setJson(TRIAL_KEY, { ...trialStamp(), expiresAt: 0 });
  let ok = false;
  try { ok = await once(TRIAL_FLIGHT, () => trialFlow(deadline)); }
  catch (e) {
    // Their own sentences: wait / sign in again / not in this region (never "could not prepare your session").
    if (isRateLimited(e) || backendStatus(e) === 401 || backendStatus(e) === 451) throw e;
    log("trial: failed (" + ((e && (e.code || e.message)) || e) + ")");
  }
  if (!ok) throw trialError(fam);
}

/** The error of a call that needs a trial session this device could not prepare (409 trial_needed, localized). */
function trialError(fam) {
  const e = kino.error("unavailable", "Xuper: backend 409 trial_needed " + fam + " (trial not ready)", { userMessage: trialFailedText() });
  try { e.status = 409; e.detail = "trial_needed"; } catch (_) { /* frozen: the message says it */ }
  return e;
}

/**
 * The screen's `open` (after the sign-in): prepares the trial session unless the stored one is still valid or `open`
 * already tried in the last 6 h. Never throws. → "ready" | "valid" | "recent" | "skip" (no Bearer, or no /trial/egress
 * on this backend) | "failed".
 */
export async function trialAtOpen() {
  try {
    if (!(await storedBearer()) || _noRoute.trial) return "skip";
    const now = Date.now();
    if (trialValid(now)) return "valid";
    const s = trialStamp();
    const last = saneAt(s.openAt, now);
    if (last && now - last < TRIAL_OPEN_EVERY_MS) return "recent";
    setJson(TRIAL_KEY, { ...s, openAt: now });
    return (await once(TRIAL_FLIGHT, trialFlow)) ? "ready" : "skip";
  } catch (e) {
    log("trial at open: failed (" + ((e && (e.code || e.message)) || e) + ")");
    return "failed";
  }
}

// ── the trial contribution (backend f69e68d: POST /trial/egress?contrib=1) ──
// A device whose region is not blocked now and then runs ONE extra trial flow that is not its own: the same classic
// tickets (v3/snToken → v8/active → v2/getFree through /egress/step) on a brand-new device the backend makes up, which
// the backend keeps in its contrib_trials pool for accounts blocked by region. The tokens never reach this device. Its
// own rate-limit family ("contrib"), so a 429 there never holds up the person's trial or catalog. The answers:
//   {results: {ready: true, contributed: true}}                    → contributed
//   {results: {ready: true, contributed: false, reason: "pool_full"}} → nothing asked of the portal (the pool is full)
//   {results: {ready: false, contributed: false, reason: "region"}}  → the portal refused it by region (portal100024)
//   409 {"detail":"contrib_not_needed"}                             → this account is blocked by region itself
//   429 {"detail":"rate_limited"}                                   → one every 3 h per account
const CONTRIB_TRIAL_START = "/trial/egress?contrib=1";
const CONTRIB_FAMILY = "contrib";

/**
 * One trial contribution, every hop ending by `deadline` (epoch ms). Never throws. → `{ ok: true, contributed, reason }`
 * (the backend's results) or `{ ok: false, status }` with `status` "nobearer", "noroute" (an older backend), "blocked"
 * (409 contrib_not_needed), 401, 429, another HTTP status, or "error" (network, out of time, a malformed flow).
 */
export async function contribTrial(deadline) {
  if (!(await storedBearer())) return { ok: false, status: "nobearer" };
  if (_noRoute[CONTRIB_FAMILY]) return { ok: false, status: "noroute" };
  try {
    const r = await egressFlow({
      start: CONTRIB_TRIAL_START, family: CONTRIB_FAMILY, stepPath: EGRESS_STEP, portalTimeoutMs: TRIAL_PORTAL_TIMEOUT_MS,
      backendTimeoutMs: BACKEND_HOP_TIMEOUT_MS, post: authedOnce, deadline, done: resultsOf,
    });
    return { ok: true, contributed: r.contributed === true, reason: typeof r.reason === "string" ? r.reason : "" };
  } catch (e) {
    if (routeMissing(e)) { _noRoute[CONTRIB_FAMILY] = true; return { ok: false, status: "noroute" }; }
    const st = backendStatus(e);
    if (st === 409 && detailOf(e) === "contrib_not_needed") return { ok: false, status: "blocked" };
    if (isRateLimited(e)) return { ok: false, status: 429 };
    return { ok: false, status: st || "error" };
  }
}
