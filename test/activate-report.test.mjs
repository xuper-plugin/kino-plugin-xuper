// The activation-failure cause reported to Kino's error board (GlitchTip) so "No se pudo activar" is not a black box:
// activateCause maps the error to a safe word, reportActivate sends it via kino.log.report (never a tap/token/private text).
import { test } from "node:test";
import assert from "node:assert/strict";

const reports = [];
globalThis.kino = { lang: "es", log: Object.assign(() => {}, { report: (line) => reports.push(line) }) };
const { activateCause, reportActivate, activateBanner, identityWhy } = await import("../src/api.js");

// What Kino 0.9.90 says for each not_available identity answer (PluginIdentityBridge), word for word.
const KINO_NO_TG = { code: "not_available", message: "kino.identity: this device was never validated with a Telegram account" };
const KINO_NO_KEY = { code: "not_available", message: "kino.identity: this device cannot sign a challenge" };
const KINO_KEY_FAILED = { code: "not_available", message: "kino.identity: this device cannot sign a challenge right now" };
const KINO_NO_ATTEST = { code: "not_available", message: "kino.identity: the installed plugin cannot be attested" };

test("activateCause: consent, identity, update, and the mint-attached causes", () => {
  assert.equal(activateCause({ noToken: true }), "update_needed");                      // identity answered without the gate token
  assert.equal(activateCause({ code: "permission_denied" }), "consent_denied");         // the person refused / identity off
  assert.equal(activateCause({ code: "not_available" }), "identity_off");
  assert.equal(activateCause({ code: "bad_request" }), "identity_bad_request");
  assert.equal(activateCause({ actCause: "session_401" }), "session_401");               // the backend refused /session
  assert.equal(activateCause({ actCause: "session_403:bad_token" }), "session_403:bad_token");
  assert.equal(activateCause({ actCause: "challenge_503" }), "challenge_503");
  assert.equal(activateCause({ actCause: "no_session" }), "no_session");
  assert.equal(activateCause({ code: "weird_thing" }), "err_weird_thing");
  assert.equal(activateCause({}), "unknown");
});

test("activateBanner: the welcome banner matches the cause (consent → settings, not a retry)", () => {
  assert.equal(activateBanner({ noToken: true }), "update");               // older Kino
  assert.equal(activateBanner({ code: "permission_denied" }), "consent");  // identity off → point at the settings toggle
  assert.equal(activateBanner({ code: "not_available" }), "link");         // no Telegram on this device → the "validate your Telegram" gate
  assert.equal(activateBanner({ actCause: "session_401" }), "server");     // the backend refused → retry later, not a permission
  assert.equal(activateBanner({}), "server");
});

test("reportActivate: one clean line to the error board, never throws", () => {
  reports.length = 0;
  reportActivate({ code: "permission_denied" });
  reportActivate({ actCause: "session_401" });
  assert.deepEqual(reports, ["activate_fail cause=consent_denied", "activate_fail cause=session_401"]);
  // no kino.log.report (older Kino / telemetry off): still never throws
  const saved = globalThis.kino.log.report;
  globalThis.kino.log.report = undefined;
  assert.doesNotThrow(() => reportActivate({ code: "permission_denied" }));
  globalThis.kino.log.report = saved;
});

test("identityWhy: tells apart Kino's four not_available reasons (all show the same 'Valida tu Telegram' gate)", () => {
  assert.equal(identityWhy(KINO_NO_TG), "no_tg");             // never validated, or a validation without the Telegram id
  assert.equal(identityWhy(KINO_NO_KEY), "no_key");           // no device keys to sign the challenge
  assert.equal(identityWhy(KINO_KEY_FAILED), "key_failed");   // the device key threw
  assert.equal(identityWhy(KINO_NO_ATTEST), "no_attest");     // Kino could not attest the installed plugin
  assert.equal(identityWhy({ code: "not_available", message: "something new" }), "unknown");
  assert.equal(identityWhy({ code: "not_available" }), "unknown");
  assert.equal(identityWhy({ code: "permission_denied", message: "never validated" }), "", "only for not_available");
  assert.equal(identityWhy(null), "");
  // The gate stays the same for all of them: only the board learns which one it was.
  for (const e of [KINO_NO_TG, KINO_NO_KEY, KINO_KEY_FAILED, KINO_NO_ATTEST]) assert.equal(activateBanner(e), "link");
});

test("reportActivate: carries why= for a not_available identity and via= for what started the sign-in", () => {
  reports.length = 0;
  reportActivate(KINO_NO_TG, "enter");        // the welcome's "Ingresar"
  reportActivate(KINO_KEY_FAILED, "open");    // the sign-in Xuper does by itself
  reportActivate({ code: "permission_denied" }, "activate");
  reportActivate({ actCause: "session_403:not_member" }, "reauth");
  reportActivate({ code: "not_available", message: "x" }, "made-up");   // an unknown trigger word is left out
  assert.deepEqual(reports, [
    "activate_fail cause=identity_off why=no_tg via=enter",
    "activate_fail cause=identity_off why=key_failed via=open",
    "activate_fail cause=consent_denied via=activate",
    "activate_fail cause=session_403:not_member via=reauth",
    "activate_fail cause=identity_off why=unknown",
  ]);
  // Only fixed words: nothing of Kino's message (or anything private) reaches the board.
  for (const line of reports) assert.match(line, /^activate_fail( [a-z]+=[a-z0-9_:]+)+$/);
});
