import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { PortalError } from "../src/portal.js";
import { makeSession } from "../src/session.js";
import { makeSettings } from "../src/settings.js";
import { checkSettingsOutput } from "../sdk/contract.mjs";

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const PW = "stand-in-pw-9"; // never a real credential

// What the app keeps of an answer, asserting the kit drops nothing and every text fits.
function keptStatus(out) {
  const kept = checkSettingsOutput("settingsStatus", out, manifest);
  assert.deepEqual(Object.keys(kept), Object.keys(out), "the kit dropped a status key");
  for (const [k, v] of Object.entries(kept)) { assert.equal(v, out[k]); assert.ok(v.length <= 200, k); }
  return kept;
}
function keptAction(out) {
  const kept = checkSettingsOutput("action", out, manifest);
  assert.equal(kept.message, out.message);
  assert.ok(kept.message.length <= 300);
  return kept;
}

// A scripted session that records every call.
function fakeSession(over = {}) {
  const calls = [];
  const s = {
    calls,
    kind: () => "own",
    regionBlocked: () => false,
    seedsExhausted: () => false,
    seedPool: () => [],
    login: async (e, p) => { calls.push(["login", e, p]); },
    logout: async () => { calls.push(["logout"]); },
    switchSeed: async () => { calls.push(["switchSeed"]); return { result: "ok", tries: 1 }; },
    refreshSeeds: async () => { calls.push(["refreshSeeds"]); return true; },
    ...over,
  };
  return s;
}
function setup({ config = {}, session } = {}) {
  const kino = fakeKino({ config });
  const sess = session ?? fakeSession();
  const settings = makeSettings({ kino, session: sess, clock: { now: () => 0 } });
  return { kino, sess, settings };
}
const rejects = (promise, code, msg) =>
  assert.rejects(promise, (e) => { assert.equal(e.name, "KinoError_" + code); if (msg) assert.equal(e.message, msg); return true; });

// ---- settingsStatus --------------------------------------------------------------------------

test("status: linked account", async () => {
  const { settings } = setup({ session: fakeSession({ kind: () => "account" }), config: { email: "ana@x.test", password: PW } });
  const out = await settings.settingsStatus();
  assert.equal(out.status, "Conectado como ana@x.test");
  keptStatus(out);
  assert.ok(!JSON.stringify(out).includes(PW));
});

test("status: anonymous session, with and without a stored device", async () => {
  for (const kind of ["own", "none", "seed"]) {
    const { settings } = setup({ session: fakeSession({ kind: () => kind }) });
    const out = await settings.settingsStatus();
    assert.equal(out.status, "Sin cuenta: sesión anónima", kind);
    keptStatus(out);
  }
});

test("status: region blocked adds the seed count; exhausted adds the banner, all within 200 chars", async () => {
  const pool = [1, 2, 3].map((n) => ({ sn: "s" + n, userId: "", userToken: "t" + n }));
  let { settings } = setup({ session: fakeSession({ kind: () => "seed", regionBlocked: () => true, seedPool: () => pool }) });
  let out = await settings.settingsStatus();
  assert.match(out.status, /^Sin cuenta: sesión anónima\. .*3 semillas cargadas/);
  keptStatus(out);

  ({ settings } = setup({ session: fakeSession({ regionBlocked: () => true, seedsExhausted: () => true, seedPool: () => pool }) }));
  out = await settings.settingsStatus();
  assert.match(out.status, /no hay sesiones disponibles para tu zona/);
  assert.match(out.status, /Actualizar semillas/);
  keptStatus(out);

  ({ settings } = setup({ session: fakeSession({ regionBlocked: () => true }) }));
  out = await settings.settingsStatus();
  assert.match(out.status, /sin semillas cargadas/i);
  keptStatus(out);
});

test("status: an account with a very long email still fits 200 chars; a failing session never throws", async () => {
  const email = "a".repeat(250) + "@x.test";
  let { settings } = setup({ session: fakeSession({ kind: () => "account" }), config: { email, password: PW } });
  const out = await settings.settingsStatus();
  assert.ok(out.status.length <= 200);

  ({ settings } = setup({ session: fakeSession({ kind: () => { throw new Error("boom " + PW); } }) }));
  const failed = await settings.settingsStatus();
  assert.equal(typeof failed.status, "string");
  assert.ok(!failed.status.includes(PW));
  keptStatus(failed);
});

// ---- action ----------------------------------------------------------------------------------

test("action login: logs in with the saved email and password", async () => {
  const { settings, sess } = setup({ config: { email: "ana@x.test", password: PW } });
  const out = await settings.action("login");
  assert.deepEqual(out, { message: "Sesión iniciada", refresh: true });
  assert.deepEqual(sess.calls, [["login", "ana@x.test", PW]]);
  keptAction(out);
});

test("action login: empty email or password asks for them", async () => {
  for (const config of [{}, { email: "ana@x.test" }, { password: PW }, { email: "  ", password: PW }]) {
    const { settings, sess } = setup({ config });
    await rejects(settings.action("login"), "auth_required", "Escribe tu correo y contraseña en Ajustes");
    assert.deepEqual(sess.calls, []);
  }
});

test("action login: a refused login is auth_required without the password; a network failure passes through", async () => {
  const { kino } = setup();
  const refused = fakeSession({ login: async () => { throw kino.error("auth_required", "Credenciales de Xuper inválidas"); } });
  let t = setup({ config: { email: "ana@x.test", password: PW }, session: refused });
  await rejects(t.settings.action("login"), "auth_required", "Credenciales de Xuper inválidas");

  const rawPortal = fakeSession({ login: async () => { throw new PortalError("aaa100011", "bad " + PW); } });
  t = setup({ config: { email: "ana@x.test", password: PW }, session: rawPortal });
  await assert.rejects(t.settings.action("login"), (e) => {
    assert.equal(e.name, "KinoError_auth_required");
    assert.ok(!e.message.includes(PW));
    return true;
  });

  const down = fakeSession({ login: async () => { throw t.kino.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento"); } });
  t = setup({ config: { email: "ana@x.test", password: PW }, session: down });
  await rejects(t.settings.action("login"), "unavailable");

  const bug = fakeSession({ login: async () => { throw new Error("secret " + PW); } });
  t = setup({ config: { email: "ana@x.test", password: PW }, session: bug });
  await assert.rejects(t.settings.action("login"), (e) => {
    assert.equal(e.name, "KinoError_unavailable");
    assert.ok(!e.message.includes(PW));
    return true;
  });
});

test("action logout: drops the session and says the saved account must be cleared by the person", async () => {
  const { settings, sess } = setup({ config: { email: "ana@x.test", password: PW } });
  const out = await settings.action("logout");
  assert.deepEqual(sess.calls, [["logout"]]);
  assert.equal(out.message, "Sesión cerrada. Borra tu correo y contraseña de estos ajustes para que no se vuelva a iniciar sesión sola.");
  assert.equal(out.refresh, true);
  keptAction(out);
});

test("action switchSeed: the native texts for each outcome", async () => {
  const cases = [
    [{ result: "ok", tries: 2 }, "Semilla cambiada (intento 2)"],
    [{ result: "account_linked", tries: 0 }, "Tu cuenta no usa semillas"],
    [{ result: "no_other_seed", tries: 0 }, "No hay otra semilla para probar"],
    [{ result: "all_failed", tries: 5 }, "Probé 5 semillas y ninguna funcionó"],
  ];
  for (const [answer, message] of cases) {
    const { settings } = setup({ session: fakeSession({ switchSeed: async () => answer }) });
    const out = await settings.action("switchSeed");
    assert.equal(out.message, message);
    keptAction(out);
  }
});

test("action refreshSeeds: count when loaded, 'Sin conexión' otherwise", async () => {
  const pool = [1, 2, 3, 4].map((n) => ({ sn: "s" + n, userId: "", userToken: "t" + n }));
  let { settings } = setup({ session: fakeSession({ seedPool: () => pool }) });
  let out = await settings.action("refreshSeeds");
  assert.equal(out.message, "4 semillas cargadas");
  assert.equal(out.refresh, true);
  keptAction(out);

  ({ settings } = setup({ session: fakeSession({ refreshSeeds: async () => false }) }));
  out = await settings.action("refreshSeeds");
  assert.equal(out.message, "Sin conexión, reintenta");
  keptAction(out);
});

test("action: an unknown key answers null", async () => {
  const { settings, sess } = setup();
  assert.equal(await settings.action("nope"), null);
  assert.deepEqual(sess.calls, []);
});

// ---- validateSettings (fake session) ---------------------------------------------------------

test("validate: blank email and password is anonymous use, no login attempt", async () => {
  for (const values of [{}, { email: "", password: "" }, { email: "  " }]) {
    const { settings, sess } = setup();
    assert.equal(await settings.validateSettings(values), null);
    assert.deepEqual(sess.calls, []);
  }
});

test("validate: field errors without a login attempt", async () => {
  let t = setup();
  assert.deepEqual(await t.settings.validateSettings({ email: "ana", password: PW }), { email: "Escribe un correo válido" });
  assert.deepEqual(await t.settings.validateSettings({ email: "ana@x.test" }), { password: "Escribe tu contraseña" });
  assert.deepEqual(await t.settings.validateSettings({ password: PW }), { email: "Escribe tu correo" });
  assert.deepEqual(await t.settings.validateSettings({ email: "ana", password: "" }),
    { email: "Escribe un correo válido", password: "Escribe tu contraseña" });
  assert.deepEqual(t.sess.calls, []);
  const kept = checkSettingsOutput("validateSettings", { password: "Escribe tu contraseña" }, manifest);
  assert.equal(kept.accepted, false);
  assert.deepEqual(kept.fieldErrors, { password: "Escribe tu contraseña" });
});

test("validate: both set makes one real login attempt: accepted, refused, or thrown", async () => {
  let t = setup();
  assert.equal(await t.settings.validateSettings({ email: "ana@x.test", password: PW }), null);
  assert.deepEqual(t.sess.calls, [["login", "ana@x.test", PW]]);
  assert.deepEqual(checkSettingsOutput("validateSettings", null, manifest), { accepted: true });

  const { kino } = t;
  t = setup({ session: fakeSession({ login: async () => { throw kino.error("auth_required", "Credenciales de Xuper inválidas"); } }) });
  const refused = await t.settings.validateSettings({ email: "ana@x.test", password: PW });
  assert.deepEqual(refused, { password: "Credenciales de Xuper inválidas" });
  const keptRefusal = checkSettingsOutput("validateSettings", refused, manifest);
  assert.equal(keptRefusal.accepted, false);
  assert.deepEqual(keptRefusal.fieldErrors, refused);

  t = setup({ session: fakeSession({ login: async () => { throw kino.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento"); } }) });
  await rejects(t.settings.validateSettings({ email: "ana@x.test", password: PW }), "unavailable");

  t = setup({ session: fakeSession({ login: async () => { throw new Error("x " + PW); } }) });
  await assert.rejects(t.settings.validateSettings({ email: "ana@x.test", password: PW }), (e) => {
    assert.ok(!String(e.message).includes(PW));
    return true;
  });
});

test("validate: values are trimmed before use", async () => {
  const { settings, sess } = setup();
  assert.equal(await settings.validateSettings({ email: " ana@x.test ", password: ` ${PW} ` }), null);
  assert.deepEqual(sess.calls, [["login", "ana@x.test", PW]]);
});

// ---- through the real session and a fake portal ----------------------------------------------

function fakePortal() {
  const queues = {};
  const calls = [];
  return {
    calls,
    queue(path, ...answers) { (queues[path] ??= []).push(...answers); },
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      const q = queues[path];
      if (!q || q.length === 0) throw new Error("unscripted portal call: " + path);
      const a = q.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

function real({ config = {}, stored = null } = {}) {
  const kino = fakeKino({ config });
  if (stored) kino.storage.set("session", JSON.stringify(stored));
  const portal = fakePortal();
  const clock = { now: () => 1_000_000 };
  const session = makeSession({ kino, portal, clock, random: () => 0 });
  const settings = makeSettings({ kino, session, clock });
  return { kino, portal, session, settings, stored: () => kino.storage.get("session") };
}
const STORED = { userId: "u0", userToken: "T0", jwtToken: "j0", sn: "sn-own" };

test("real session: a refused credential check leaves the stored session untouched", async () => {
  const t = real({ stored: STORED });
  const before = t.stored();
  t.portal.queue("v8/login", new PortalError("aaa100011", "wrong password " + PW));
  const out = await t.settings.validateSettings({ email: "ana@x.test", password: PW });
  assert.deepEqual(out, { password: "Credenciales de Xuper inválidas" });
  assert.equal(t.stored(), before);
  assert.deepEqual(t.portal.calls.map((c) => c.path), ["v8/login"]);
  assert.ok(!JSON.stringify(out).includes(PW));
});

test("real session: a network failure during the check throws and leaves the session untouched", async () => {
  const t = real({ stored: STORED });
  const before = t.stored();
  t.portal.queue("v8/login", t.kino.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento"));
  await assert.rejects(t.settings.validateSettings({ email: "ana@x.test", password: PW }), (e) => {
    assert.equal(e.name, "KinoError_unavailable");
    assert.ok(!e.message.includes(PW));
    return true;
  });
  assert.equal(t.stored(), before);
});

test("real session: an accepted check stores the new token", async () => {
  const t = real({ stored: STORED });
  t.portal.queue("v8/login", { userId: "u1", userToken: "T1", jwtToken: "j1" });
  assert.equal(await t.settings.validateSettings({ email: "ana@x.test", password: PW }), null);
  assert.deepEqual(JSON.parse(t.stored()), { userId: "u1", userToken: "T1", jwtToken: "j1", sn: "sn-own" });
  assert.equal(t.portal.calls[0].bean.userName, "ana@x.test");
});

test("real session: the login action and the status line follow the saved account", async () => {
  const t = real({ stored: STORED, config: { email: "ana@x.test", password: PW } });
  t.portal.queue("v8/login", { userId: "u1", userToken: "T1", jwtToken: "j1" });
  assert.deepEqual(await t.settings.action("login"), { message: "Sesión iniciada", refresh: true });
  assert.equal((await t.settings.settingsStatus()).status, "Conectado como ana@x.test");

  const refused = real({ stored: STORED, config: { email: "ana@x.test", password: PW } });
  refused.portal.queue("v8/login", new PortalError("aaa100011", "no"));
  await rejects(refused.settings.action("login"), "auth_required", "Credenciales de Xuper inválidas");
  assert.deepEqual(JSON.parse(refused.stored()), STORED);
});

test("real session: the status line reads the seed pool and region from storage", async () => {
  const t = real({ stored: STORED });
  t.kino.storage.set("region", JSON.stringify({ blocked: true }));
  t.kino.storage.set("seeds", JSON.stringify([{ sn: "a", userId: "", userToken: "t" }, { sn: "b", userId: "", userToken: "t" }]));
  const out = await t.settings.settingsStatus();
  assert.match(out.status, /2 semillas cargadas/);
  keptStatus(out);
  const empty = real();
  assert.equal((await empty.settings.settingsStatus()).status, "Sin cuenta: sesión anónima");
});

// ---- manifest --------------------------------------------------------------------------------

test("manifest: the account form has the actions and no leftover portalUrl", () => {
  const byKey = Object.fromEntries(manifest.settings.map((s) => [s.key, s]));
  assert.equal(byKey.portalUrl, undefined);
  assert.equal(byKey.switchSeed.type, "action");
  assert.equal(byKey.switchSeed.label, "Cambiar semilla");
  assert.equal(byKey.refreshSeeds.type, "action");
  assert.equal(byKey.refreshSeeds.label, "Actualizar semillas");
  for (const s of manifest.settings) {
    assert.ok(s.label.length <= 40, s.key);
    if (s.hint) assert.ok(s.hint.length <= 80, s.key);
  }
  const valueless = manifest.settings.filter((s) => ["section", "status", "action"].includes(s.type));
  assert.ok(valueless.length <= 8);
  assert.ok(manifest.settings.length - valueless.length <= 12);
});
