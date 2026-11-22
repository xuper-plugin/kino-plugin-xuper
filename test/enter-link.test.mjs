// The welcome's "Ingresar" on a device Kino holds no Telegram identity for (3.1.8): the sign-in fails with Kino's
// not_available, and the screen moves to the "Valida tu Telegram" gate. Field case (2026-11-22, an A95X F4 TV box on Kino
// 0.9.90): the board only said `cause=identity_off`, which hides WHICH of Kino's four reasons it was. Now the report says
// why= (Kino's reason) and via= (what started the sign-in), and the plugin's own log follows every step. Entry points only,
// so it also runs against a built bundle:
//   XUPER_PLUGIN=/abs/path/plugin.js node --test test/enter-link.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");

const BACKEND = "https://x.xkplugins.site";

/** A device on the one-time welcome (no session, intro not seen), whose Kino answers identity with `identity`. */
async function welcomeDevice(identity) {
  const seen = [];
  const route = (url) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    seen.push(path);
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return res(200, JSON.stringify({ session: "fresh" }));
    return res(404, "");
  };
  const k = installKino({ storage: {}, routes: [route] });
  await P.screenEvent({ name: "disconnect", state: {} });   // no Bearer, welcome not passed: the "Ingresar" screen
  k.kino.identity = { telegram: identity };
  const reports = [];
  k.kino.log.report = (line) => reports.push(line);
  k.requests.length = 0; k.writes.length = 0; k.logs.length = 0;
  return { k, seen, reports };
}

const notAvailable = (message) => async () => { throw Object.assign(new Error(message), { code: "not_available" }); };

test("Ingresar on a device with no Telegram identity → the 'Valida tu Telegram' gate, with why=no_tg via=enter on the board", async () => {
  const { k, seen, reports } = await welcomeDevice(notAvailable("kino.identity: this device was never validated with a Telegram account"));

  const out = await P.screenEvent({ name: "enter", state: {} });

  assert.equal(out.state.actError, "link", "the link banner: the 'Valida tu Telegram' gate");
  assert.deepEqual(seen, ["/session/challenge"], "the challenge went out, Kino's identity failed: /session never did");
  assert.equal(reports.length, 1);
  assert.match(reports[0], /^activate_fail cause=identity_off why=no_tg via=in at=id att=[0-9a-f]{6} ch=\d+ id=\d+ tot=\d+$/, "failed at Kino's identity (at=id), with the attempt");
  // The plugin's own log tells the whole story, in order.
  const log = k.logs.join("\n");
  assert.match(log, /screen: sign-in via=enter: Ingresar pressed/);
  assert.match(log, /mint: start att=[0-9a-f]{6}/);
  assert.match(log, /mint: challenge -> 200 in \d+ ms/);
  assert.match(log, /mint: FAILED at=id att=[0-9a-f]{6}/);
  assert.match(log, /mint: identity FAIL code=not_available msg=kino\.identity: this device was never validated/);
  assert.match(log, /screen: sign-in via=enter FAILED cause=identity_off why=no_tg -> banner=link code=not_available/);
  assert.ok(log.indexOf("Ingresar pressed") < log.indexOf("FAILED"), "pressed, then failed");

  // And the screen that follows is the gate itself (no session, welcome passed, actError "link").
  const v = JSON.stringify(await P.screen({ state: { actError: "link" }, device: "tv" }));
  assert.match(v, /Valida tu Telegram/);
});

test("Ingresar when the device key fails: the same gate, but the board says why=key_failed (re-validating would not fix it)", async () => {
  const { reports, k } = await welcomeDevice(notAvailable("kino.identity: this device cannot sign a challenge right now"));

  const out = await P.screenEvent({ name: "enter", state: {} });

  assert.equal(out.state.actError, "link");
  assert.match(reports.join("|"), /^activate_fail cause=identity_off why=key_failed via=in at=id att=[0-9a-f]{6} ch=\d+ id=\d+ tot=\d+$/);
  assert.match(k.logs.join("\n"), /FAILED cause=identity_off why=key_failed -> banner=link/);
});

test("Reintentar on the gate reports via=activate and logs the banner it came from", async () => {
  const { reports, k } = await welcomeDevice(notAvailable("kino.identity: the installed plugin cannot be attested"));
  await P.screenEvent({ name: "enter", state: {} });
  reports.length = 0; k.logs.length = 0;

  const out = await P.screenEvent({ name: "activate", state: { actError: "link" } });

  assert.equal(out.state.actError, "link");
  assert.match(reports.join("|"), /^activate_fail cause=identity_off why=no_attest via=ac at=id att=[0-9a-f]{6} ch=\d+ id=\d+ tot=\d+$/);
  assert.match(k.logs.join("\n"), /sign-in via=activate: Reintentar pressed \(last banner=link\)/);
});

test("Ingresar that works logs OK and reports nothing", async () => {
  const ok = async () => ({ id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" });
  const { reports, k, seen } = await welcomeDevice(ok);

  const out = await P.screenEvent({ name: "enter", state: {} });

  assert.equal(out.state.actError, null);
  assert.deepEqual(seen, ["/session/challenge", "/session"]);
  assert.deepEqual(reports, []);
  assert.match(k.logs.join("\n"), /sign-in via=enter OK/);
});

test("a /session that times out: the board says at=se with each stage's ms, and both requests carried the attempt id", async () => {
  const ok = async () => ({ id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" });
  const { reports, k } = await welcomeDevice(ok);
  const timeout = Object.assign(new Error("kino.fetch: timed out"), { code: "timeout" });
  const real = k.kino.fetch;
  k.kino.fetch = async (url, init = {}) => {
    if (!url.endsWith("/session")) return real(url, init);
    k.requests.push({ url, headers: { ...(init.headers || {}) } });
    throw timeout;   // what kino.fetch throws when the request runs out of time
  };

  await P.screenEvent({ name: "enter", state: {} });

  assert.equal(reports.length, 1);
  const m = reports[0].match(/^activate_fail cause=err_timeout via=in at=se att=([0-9a-f]{6}) ch=\d+ id=\d+ se=\d+ tot=\d+$/);
  assert.ok(m, reports[0]);
  const sent = k.requests.filter((r) => r.url.startsWith(BACKEND + "/session")).map((r) => r.headers["X-Kino-Attempt"]);
  assert.deepEqual(sent, [m[1], m[1]], "the challenge and the /session carried the report's attempt id (the backend logs it)");
});

test("a sign-in that works: its attempt id went to the backend, nothing reported", async () => {
  const ok = async () => ({ id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" });
  const { reports, k } = await welcomeDevice(ok);
  await P.screenEvent({ name: "enter", state: {} });
  assert.deepEqual(reports, []);
  const ids = k.requests.filter((r) => r.url.startsWith(BACKEND + "/session")).map((r) => r.headers["X-Kino-Attempt"]);
  assert.equal(ids.length, 2);
  assert.match(ids[0], /^[0-9a-f]{6}$/);
  assert.equal(ids[0], ids[1]);
});
