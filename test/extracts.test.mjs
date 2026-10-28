// The additive extracts the configuration screen calls (E1-E5): new parameters default to today's values and new functions
// are only ADDED to the objects makeSettings/makeSession return, so the old settings form behaves exactly as before
// (settings.test.mjs, registration.test.mjs and the account tests are unchanged and pin that).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeSettings } from "../src/settings.js";
import { accountWorld, goodRoutes, refuse } from "./helpers/accountWorld.mjs";

const PW = "stand-in-pw-9"; // never a real credential
const EMAIL = "persona@ejemplo.test";

// A scripted session that records the bounds every call gets.
function boundsSession(over = {}) {
  const calls = [];
  return {
    calls,
    kind: () => "own", usingShared: () => false, sharedConfigured: () => false, accountState: () => "none",
    regionBlocked: () => false, seedsExhausted: () => false, seedPool: () => [],
    login: async (e, p, b) => { calls.push(["login", b]); },
    logout: async (b) => { calls.push(["logout", b]); },
    switchSeed: async (b) => { calls.push(["switchSeed", b]); return { result: "ok", tries: 1 }; },
    refreshSeeds: async (b) => { calls.push(["refreshSeeds", b]); return true; },
    ...over,
  };
}
const NOW = 1_000;
function settingsOver(session, config = {}) {
  const kino = fakeKino({ config });
  return makeSettings({ kino, session, clock: { now: () => NOW } });
}

// ---- E1: action(key, { totalMs }) ---------------------------------------------------------------------------------

test("E1: without opts every handler keeps today's total bound (25 s login and logout, 22 s seed switch)", async () => {
  const s = boundsSession();
  const settings = settingsOver(s, { email: EMAIL, password: PW });
  await settings.action("login");
  await settings.action("logout");
  await settings.action("switchSeed");
  await settings.action("switchSeed", null);
  await settings.action("switchSeed", { totalMs: "x" });
  assert.deepEqual(s.calls.map(([n, b]) => [n, b.deadline - NOW, b.timeoutMs]), [
    ["login", 25_000, 12_000], ["logout", 25_000, 10_000], ["switchSeed", 22_000, 5_000], ["switchSeed", 22_000, 5_000], ["switchSeed", 22_000, 5_000],
  ]);
});

test("E1: totalMs caps the total bound, never raises it, and leaves the per-request bound alone", async () => {
  const s = boundsSession();
  const settings = settingsOver(s, { email: EMAIL, password: PW });
  await settings.action("login", { totalMs: 17_000 });
  await settings.action("logout", { totalMs: 17_000 });
  await settings.action("switchSeed", { totalMs: 17_000 });
  await settings.action("switchSeed", { totalMs: 90_000 });
  assert.deepEqual(s.calls.map(([n, b]) => [n, b.deadline - NOW, b.timeoutMs]), [
    ["login", 17_000, 12_000], ["logout", 17_000, 10_000], ["switchSeed", 17_000, 5_000], ["switchSeed", 22_000, 5_000],
  ]);
});

test("E1: the answers keep their old shape (message, refresh, clearSettings)", async () => {
  const settings = settingsOver(boundsSession(), { email: EMAIL, password: PW });
  assert.deepEqual(await settings.action("logout", { totalMs: 17_000 }),
    { message: "Sesión cerrada", refresh: true, clearSettings: ["email", "password", "regEmail", "regPassword", "useSharedAccount"] });
  assert.deepEqual(await settings.action("login", { totalMs: 17_000 }), { message: "Sesión iniciada", refresh: true });
  assert.equal(await settings.action("nope", { totalMs: 17_000 }), null);
});

// ---- E2: statusFacts() ---------------------------------------------------------------------------------------------

test("E2: statusFacts names the facts the status line is built from, and the line is unchanged", async () => {
  const pool = [1, 2, 3].map((n) => ({ sn: "s" + n, userId: "", userToken: "t" + n }));
  const s = boundsSession({ kind: () => "own", regionBlocked: () => true, seedPool: () => pool, seedsExhausted: () => true });
  const settings = settingsOver(s, { autoRefreshSeeds: false });
  assert.deepEqual(settings.statusFacts(), {
    account: false, kind: "own", accountState: "none", sharedConfigured: false, usingShared: false, email: "",
    regionBlocked: true, pool: 3, seedsExhausted: true, autoRefresh: false,
  });
  assert.equal((await settings.settingsStatus()).status,
    "Sin cuenta: sesión anónima. Zona bloqueada: 3 semillas cargadas. Por ahora no hay sesiones disponibles para tu zona; vuelve a intentar en un rato o toca Actualizar semillas.");
});

test("E2: an account in use; the email is the configured one (the screen masks it), never the password", async () => {
  const s = boundsSession({ kind: () => "account", accountState: () => "held" });
  const settings = settingsOver(s, { email: EMAIL, password: PW });
  const f = settings.statusFacts();
  assert.equal(f.account, true);
  assert.equal(f.email, EMAIL);
  assert.ok(!JSON.stringify(f).includes(PW));
});

test("E2: a session that cannot be read throws from statusFacts, and settingsStatus still answers its unknown line", async () => {
  const settings = settingsOver(boundsSession({ kind: () => { throw new Error("boom"); } }));
  assert.throws(() => settings.statusFacts());
  assert.deepEqual(await settings.settingsStatus(), { status: "No se pudo consultar el estado" });
});

// ---- E3: sendCodeTo / registerWith --------------------------------------------------------------------------------

test("E3: sendCodeTo sends to the given address (no setting read) and a second press within a minute sends nothing", async () => {
  const w = accountWorld({ saved: {} });
  const first = await w.settings.sendCodeTo(EMAIL);
  assert.equal(first.sent, true);
  assert.equal(typeof first.at, "number");
  assert.deepEqual(w.paths(), ["v3/snToken", "v8/active", "v2/sendEmailVerifyCode"]);
  assert.equal(w.requests[2].bean.email, EMAIL);
  const again = await w.settings.sendCodeTo(EMAIL);
  assert.deepEqual(again, { sent: false, at: first.at });
  assert.equal(w.requests.length, 3, "no second device minted");
  w.clock.t += 60_000;
  assert.equal((await w.settings.sendCodeTo(EMAIL)).sent, true, "after a minute it may send again");
});

test("E3: sendCodeTo's budget is the old 25 s, or the caller's cap", async () => {
  const seen = [];
  const routes = goodRoutes({ "v3/snToken": (bean, req) => { seen.push(req.timeoutMs); return { snToken: "S" }; } });
  const w = accountWorld({ routes });
  await w.settings.sendCodeTo(EMAIL, { cap: 3_000 });
  assert.ok(seen[0] <= 3_000, `the first request fits the 3 s cap (${seen[0]})`);
});

test("E3: sendCodeTo failures are kino errors carrying the old sentences", async () => {
  const w = accountWorld({ routes: goodRoutes({ "v2/sendEmailVerifyCode": refuse() }) });
  await assert.rejects(w.settings.sendCodeTo(EMAIL), (e) => {
    assert.equal(e.name, "KinoError_unavailable");
    assert.match(e.userMessage, /no pudo enviar el código/);
    return true;
  });
});

test("E3: registerWith runs the old checks in the old order, with the old sentences", async () => {
  const w = accountWorld();
  const msg = async (args) => { try { await w.settings.registerWith(args); return null; } catch (e) { return [e.name, e.userMessage]; } };
  assert.deepEqual(await msg({ email: EMAIL, code: "  ", password: PW }), ["KinoError_auth_required", "Escribe el código que te enviamos en Ajustes ▸ Xuper."]);
  assert.deepEqual(await msg({ email: EMAIL, code: "123456", password: "" }), ["KinoError_auth_required", "Faltan los datos de tu cuenta: complétalos en Ajustes ▸ Xuper."]);
  assert.deepEqual(await msg({ email: EMAIL, code: "123456", password: PW }), ["KinoError_unavailable", "Pide el código otra vez."]);
  assert.equal(w.requests.length, 0, "no check costs a portal call");
});

test("E3: registerWith on the device that asked: created and signed in, the code trimmed; the session adopted", async () => {
  const w = accountWorld();
  await w.settings.sendCodeTo(EMAIL);
  const out = await w.settings.registerWith({ email: EMAIL, code: " 482913 ", password: PW });
  assert.deepEqual(out, { loggedIn: true });
  const val = w.requests.find((r) => r.path === "v2/validateVerifyCode");
  assert.equal(val.bean.verifyCode, "482913");
  assert.equal(w.stored().userToken, "tok-new");
  assert.equal(w.stored().acct, w.session.accountKey(EMAIL, PW));
});

test("E3: bound but not signed in is { loggedIn: false }; a refused code is the old 'code refused' sentence", async () => {
  const bound = accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) });
  await bound.settings.sendCodeTo(EMAIL);
  assert.deepEqual(await bound.settings.registerWith({ email: EMAIL, code: "1", password: PW }), { loggedIn: false });
  const refused = accountWorld({ routes: goodRoutes({ "v2/validateVerifyCode": refuse() }) });
  await refused.settings.sendCodeTo(EMAIL);
  await assert.rejects(refused.settings.registerWith({ email: EMAIL, code: "1", password: PW }), (e) => /no aceptó el código/.test(e.userMessage));
});

test("E3: the old buttons still read the settings and answer the old messages", async () => {
  const w = accountWorld({ saved: { regEmail: EMAIL, regPassword: PW, verifyCode: "482913" } });
  assert.deepEqual(await w.settings.action("sendCode"), { message: "Te enviamos un código a " + EMAIL });
  assert.deepEqual(await w.settings.action("sendCode"), { message: "Ya te enviamos un código; espera un minuto antes de pedir otro" });
  assert.deepEqual(await w.settings.action("register"),
    { message: "Cuenta creada y sesión iniciada", refresh: true, clearSettings: ["verifyCode", "email", "password"] });
});

test("E3: without registration (older wiring) the extracts are not offered", () => {
  const settings = settingsOver(boundsSession());
  assert.equal(settings.sendCodeTo, undefined);
  assert.equal(settings.registerWith, undefined);
});

// ---- E4: seedsAt / usableSeeds ---------------------------------------------------------------------------------------

test("E4: seedsAt reads the stored stamp; usableSeeds leaves out expiring and dead seeds", () => {
  const nowS = Math.floor(5_000_000 / 1000);
  const seeds = [
    { sn: "a", userId: "1", userToken: "ta" },
    { sn: "b", userId: "2", userToken: "tb", exp: nowS + 3600 },
    { sn: "c", userId: "3", userToken: "tc", exp: nowS + 60 }, // under 5 minutes left
    { sn: "d", userId: "4", userToken: "td" },
  ];
  const w = accountWorld({ seeds, storageExtra: { seedsAt: 4_000_000, deadSeeds: { "d|td": 4_999_000 } } });
  assert.equal(w.session.seedsAt(), 4_000_000);
  assert.equal(w.session.seedPool().length, 4);
  assert.equal(w.session.usableSeeds(), 2);
  const none = accountWorld();
  assert.equal(none.session.seedsAt(), null);
  assert.equal(none.session.usableSeeds(), 0);
  const odd = accountWorld({ storageExtra: { seedsAt: "\"yesterday\"" } });
  assert.equal(odd.session.seedsAt(), null);
});

// ---- E5: seedsOutcome ---------------------------------------------------------------------------------------------

test("E5: each download's outcome is kept beside the unchanged boolean: fetch, http, parse, empty, ok", async () => {
  const cases = [
    [() => { throw new Error("offline"); }, false, "fetch"],
    [() => ({ ok: false, status: 404, text: () => "" }), false, "http"],
    [() => ({ ok: true, status: 200, text: () => "<html>" }), false, "parse"],
    [() => ({ ok: true, status: 200, text: () => "[]" }), false, "empty"],
    [() => ({ ok: true, status: 200, text: () => JSON.stringify([{ sn: "x", userId: "1", userToken: "t" }]) }), true, null],
  ];
  for (const [answer, ok, why] of cases) {
    const w = accountWorld({ seedsAnswer: answer });
    assert.equal(w.session.seedsOutcome(), null, "nothing before a download");
    const got = await w.session.refreshSeeds({ timeoutMs: 10_000, manual: true });
    assert.equal(got, ok, String(why));
    const o = w.session.seedsOutcome();
    assert.equal(o.ok, ok);
    assert.equal(o.why, why);
    assert.equal(o.at, w.clock.now());
    assert.equal(o.n, 1);
  }
});

test("E5: the old refreshSeeds button still answers 'Sin conexión, reintenta' for every failure (old form unchanged)", async () => {
  const w = accountWorld({ seedsAnswer: () => ({ ok: false, status: 500, text: () => "" }) });
  assert.deepEqual(await w.settings.action("refreshSeeds"), { message: "Sin conexión, reintenta", refresh: true });
  assert.equal(w.session.seedsOutcome().why, "http");
});
