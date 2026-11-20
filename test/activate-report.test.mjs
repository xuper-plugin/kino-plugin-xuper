// The activation-failure cause reported to Kino's error board (GlitchTip) so "No se pudo activar" is not a black box:
// activateCause maps the error to a safe word, reportActivate sends it via kino.log.report (never a tap/token/private text).
import { test } from "node:test";
import assert from "node:assert/strict";

const reports = [];
globalThis.kino = { lang: "es", log: Object.assign(() => {}, { report: (line) => reports.push(line) }) };
const { activateCause, reportActivate } = await import("../src/api.js");

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
