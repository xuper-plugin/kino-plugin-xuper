import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeCrypto } from "../src/crypto.js";
import { makePortal } from "../src/portal.js";
import { makeSession } from "../src/session.js";
import { makeSettings } from "../src/settings.js";
import { makeRegistration } from "../src/registration.js";
import { PASSWORD_SALT, SNTOKEN_SALT } from "../src/config.js";
import { checkSettingsOutput } from "../sdk/contract.mjs";
import { shownSentence } from "../sdk/kino-shim.mjs";

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const md5 = (s) => createHash("md5").update(s).digest("hex");
const PW = "stand-in-pw-9"; // never a real credential
const EMAIL = "persona@ejemplo.test";
const CODE = "482913";
const STORED = { userId: "u-old", userToken: "tok-old", jwtToken: "", sn: "sn-old" };
const PENDING_KEY = "pendingRegistration";
/** What the person reads for `e` (its userMessage when the app's filter lets it through), else null. */
const shown = (e) => shownSentence(e);
const reply = (obj) => ({ text: () => JSON.stringify(obj) });
const hexToText = (hex) => Buffer.from(hex, "hex").toString("utf8");

// Real portal + real session over a scripted fetch. Requests are decrypted with the stand-in key;
// answers go out plain ({returnCode:"0", ...fields}), which the portal accepts as-is.
function world({ routes = {}, config = { email: EMAIL, password: PW }, hosts = ["h1.test"], onFetch, saved = null } = {}) {
  const clock = { t: 5_000_000, now() { return this.t; } };
  const requests = [];
  const base = fakeKino({ config });
  const decrypt = (wire) => base.crypto.decrypt("des-ede3-ecb", { key: base.secret("magisKey"), data: hexToText(wire), padding: "pkcs7" });
  // A mutable wrapper: the kit's storage is frozen and tests need to make it throw or spy on it.
  const storage = { get: (k) => base.storage.get(k), set: (k, v, o) => base.storage.set(k, v, o), remove: (k) => base.storage.remove(k) };
  // `saved`: a plain map the test edits like the app's settings store (the kit's config is frozen).
  const configOver = saved ? { config: Object.freeze({ get: (k) => saved[k], all: () => ({ ...saved }) }) } : {};
  const kino = Object.freeze({
    ...base, ...configOver, storage, sleep: async () => {},
    fetch: async (url, opts) => {
      const path = new URL(url).pathname.replace("/api/portalCore/", "");
      const bean = JSON.parse(decrypt(opts.body));
      const req = { path, bean, timeoutMs: opts.timeoutMs, at: clock.t, session: base.storage.get("session") };
      requests.push(req);
      if (onFetch) { const o = onFetch(req, clock); if (o !== undefined) return o; }
      const route = routes[path];
      if (!route) throw new Error("unscripted portal path " + path);
      const out = typeof route === "function" ? route(bean, req) : route;
      if (out instanceof Error) throw out;
      return reply({ returnCode: "0", ...out });
    },
  });
  base.storage.set("session", JSON.stringify(STORED));
  const crypto = makeCrypto(kino);
  let session = null;
  const portal = makePortal({ kino, crypto, clock, snProvider: () => session.current().sn, config: { hosts, appId: "app-1", apkVersion: "9.9" } });
  session = makeSession({ kino, portal, clock, random: () => 0 });
  const registration = makeRegistration({ kino, portal, session, clock });
  const settings = makeSettings({ kino, session, clock, registration });
  return { kino, base, storage, clock, requests, session, settings, paths: () => requests.map((r) => r.path), stored: () => JSON.parse(base.storage.get("session")) };
}
const refuse = (errorMessage = "no") => ({ returnCode: "aaa100099", errorMessage });
const goodRoutes = (over = {}) => ({
  "v3/snToken": { snToken: "SNTOK-P" },
  "v8/active": { userId: "u-pend", userToken: "tok-pend", jwtToken: "" },
  "v2/sendEmailVerifyCode": {},
  "v2/validateVerifyCode": {},
  "v2/bindEmail": {},
  "v8/login": { userId: "u-new", userToken: "tok-new", jwtToken: "jwt-new" },
  ...over,
});
const keep = (out) => {
  const drops = [];
  const kept = checkSettingsOutput("action", out, manifest, (t) => t, (d) => drops.push(d));
  assert.deepEqual(drops, [], "the kit dropped something");
  assert.equal(kept.message, out.message);
  return kept;
};
const rejects = (promise, code, msg) =>
  assert.rejects(promise, (e) => { assert.equal(e.name, "KinoError_" + code); if (msg) assert.equal(e.message, msg); return true; });

function withConfig(extra) { return { email: EMAIL, password: PW, verifyCode: CODE, ...extra }; }

// ---- sendCode ----------------------------------------------------------------------------------

test("sendCode: mints a SEPARATE device, asks for the code, never touches the stored session", async () => {
  const w = world({ routes: goodRoutes() });
  const out = await w.settings.action("sendCode");
  assert.equal(out.message, "Te enviamos un código a " + EMAIL);
  keep(out);
  assert.deepEqual(w.paths(), ["v3/snToken", "v8/active", "v2/sendEmailVerifyCode"]);
  const sn = md5("SNTOK-P" + SNTOKEN_SALT);
  const [mintReq, activeReq, sendReq] = w.requests;
  assert.notEqual(mintReq.bean.androidId, undefined, "randomized fingerprint");
  assert.equal(activeReq.bean.sn, sn);
  assert.equal(activeReq.bean.snToken, "SNTOK-P");
  assert.equal(sendReq.bean.sn, sn);
  assert.equal(sendReq.bean.email, EMAIL);
  assert.equal(sendReq.bean.type, "1");
  assert.equal(sendReq.bean.userId, "u-pend");
  assert.equal(sendReq.bean.userToken, "tok-pend");
  for (const r of w.requests) assert.equal(r.session, JSON.stringify(STORED), "stored session untouched during " + r.path);
  assert.deepEqual(w.stored(), STORED);
});

test("sendCode: the portal's own sn wins over the md5 rule, lowercased", async () => {
  const w = world({ routes: goodRoutes({ "v3/snToken": { snToken: "T", sn: "ABCDEF0123" } }) });
  await w.settings.action("sendCode");
  assert.equal(w.requests[1].bean.sn, "abcdef0123");
});

test("sendCode: the pending device sits in storage with a 30 minute ttl, under 1 KB, email included", async () => {
  const w = world({ routes: goodRoutes() });
  const sets = [];
  const orig = w.storage.set;
  w.storage.set = (k, v, o) => { sets.push([k, v, o]); return orig(k, v, o); };
  await w.settings.action("sendCode");
  const pend = sets.find(([k]) => k === PENDING_KEY);
  assert.ok(pend, "pending device stored");
  assert.deepEqual(pend[2], { ttlMs: 30 * 60_000 });
  assert.ok(pend[1].length <= 1024, "size " + pend[1].length);
  const o = JSON.parse(pend[1]);
  assert.deepEqual(Object.keys(o).sort(), ["at", "email", "sn", "userId", "userToken"]);
  assert.equal(o.email, EMAIL);
  assert.ok(!pend[1].includes(PW));
});

test("sendCode: a failed save of the pending device is told, never a false \"we sent it\"", async () => {
  const w = world({ routes: goodRoutes() });
  w.storage.set = () => { throw new Error("quota " + PW); };
  await assert.rejects(w.settings.action("sendCode"), (e) => {
    assert.equal(e.name, "KinoError_unavailable");
    assert.equal(e.message, "No se pudo guardar el pedido; inténtalo de nuevo");
    assert.ok(!e.message.includes(PW));
    assert.equal(shown(e), "No pudimos guardar tu pedido. Vuelve a tocar Crear cuenta.");
    return true;
  });
});

test("sendCode: blank or malformed email never reaches the portal", async () => {
  for (const [config, msg] of [[{ password: PW }, "Escribe tu correo en Ajustes"], [{ email: "  ", password: PW }, "Escribe tu correo en Ajustes"], [{ email: "sin-arroba" }, "Escribe un correo válido"]]) {
    const w = world({ routes: goodRoutes(), config });
    await rejects(w.settings.action("sendCode"), "auth_required", msg);
    assert.deepEqual(w.requests, []);
  }
});

test("sendCode: a refusal at any step reads the native text and leaves the session alone", async () => {
  for (const failing of ["v3/snToken", "v8/active", "v2/sendEmailVerifyCode"]) {
    const w = world({ routes: goodRoutes({ [failing]: refuse("secret " + PW) }) });
    await assert.rejects(w.settings.action("sendCode"), (e) => {
      assert.equal(e.message, "No se pudo enviar el código: revisa el email");
      assert.ok(!e.message.includes(PW));
      assert.equal(shown(e), "Xuper no pudo enviar el código a ese correo. Revisa que esté bien escrito en Ajustes ▸ Xuper.");
      return true;
    });
    assert.deepEqual(w.stored(), STORED, failing);
    assert.equal(w.base.storage.get(PENDING_KEY), null);
  }
  const w = world({ routes: goodRoutes({ "v8/active": { userId: "u", userToken: "" } }) });
  await rejects(w.settings.action("sendCode"), "unavailable", "No se pudo enviar el código: revisa el email");
});

test("every registration failure the person reads passes the app's sentence filter (no generic fallback)", async () => {
  const cases = [
    [() => world({ routes: goodRoutes({ "v2/sendEmailVerifyCode": refuse() }) }), "sendCode"],
    [() => sent({}, { "v2/validateVerifyCode": refuse() }), "register"],
    [() => sent({}, { "v2/bindEmail": refuse() }), "register"],
  ];
  for (const [make, key] of cases) {
    const w = await make();
    await assert.rejects(w.settings.action(key), (e) => {
      assert.equal(e.name, "KinoError_unavailable");
      assert.equal(typeof shown(e), "string", key + ": " + e.message);
      return true;
    });
  }
});

test("sendCode: a network failure is the plugin's own unavailable", async () => {
  const w = world({ routes: goodRoutes({ "v3/snToken": new Error("offline " + PW) }) });
  await assert.rejects(w.settings.action("sendCode"), (e) => e.name === "KinoError_unavailable" && !e.message.includes(PW));
});

// ---- register ----------------------------------------------------------------------------------

async function sent(extra = {}, over = {}) {
  const w = world({ routes: goodRoutes(over), config: withConfig(extra) });
  await w.settings.action("sendCode");
  w.requests.length = 0;
  return w;
}

test("register: validate -> bind -> login with the pending device; only then the session is replaced", async () => {
  const w = await sent();
  const out = await w.settings.action("register");
  assert.deepEqual(out, { message: "Cuenta creada y sesión iniciada", refresh: true, clearSettings: ["verifyCode"] });
  keep(out);
  assert.deepEqual(w.paths(), ["v2/validateVerifyCode", "v2/bindEmail", "v8/login"]);
  const pendSn = md5("SNTOK-P" + SNTOKEN_SALT);
  const [val, bind, login] = w.requests;
  assert.deepEqual([val.bean.type, val.bean.email, val.bean.verifyCode, val.bean.userId, val.bean.userToken, val.bean.sn], ["1", EMAIL, CODE, "u-pend", "tok-pend", pendSn]);
  assert.deepEqual([bind.bean.email, bind.bean.pwd, bind.bean.type, bind.bean.userId, bind.bean.userToken, bind.bean.sn], [EMAIL, md5(PW + PASSWORD_SALT), "1", "u-pend", "tok-pend", pendSn]);
  assert.equal(login.bean.userName, EMAIL);
  assert.equal(login.bean.password, md5(PW + PASSWORD_SALT));
  assert.equal(login.bean.sn, pendSn);
  for (const r of w.requests) assert.equal(r.session, JSON.stringify(STORED), "stored session untouched during " + r.path);
  assert.deepEqual(w.stored(), { userId: "u-new", userToken: "tok-new", jwtToken: "jwt-new", sn: pendSn,
    acct: createHash("sha256").update(EMAIL + "\n" + md5(PW + PASSWORD_SALT)).digest("hex") });
  assert.equal(w.base.storage.get(PENDING_KEY), null, "pending device deleted");
  assert.equal(w.session.kind(), "account");
});

test("register: a refusal at validate or bind reads the native text; session and pending intact", async () => {
  for (const failing of ["v2/validateVerifyCode", "v2/bindEmail"]) {
    const w = await sent({}, { [failing]: refuse("x " + CODE + PW) });
    await assert.rejects(w.settings.action("register"), (e) => {
      assert.equal(e.message, "Código inválido o cuenta ya registrada");
      assert.ok(!e.message.includes(PW) && !e.message.includes(CODE));
      assert.equal(shown(e), "Xuper no aceptó el código, o ese correo ya tiene cuenta. Pide otro código o toca Iniciar sesión.");
      return true;
    });
    assert.deepEqual(w.stored(), STORED, failing);
    assert.notEqual(w.base.storage.get(PENDING_KEY), null, "pending kept for a retry");
  }
});

test("register: no pending device (never asked, expired, or another email) asks for a new code", async () => {
  let w = world({ routes: goodRoutes(), config: withConfig() });
  await rejects(w.settings.action("register"), "unavailable", "Pide el código otra vez");
  assert.deepEqual(w.requests, []);

  w = await sent();
  w.base.storage.set(PENDING_KEY, JSON.stringify({ userId: "u", userToken: "t", sn: "s", email: "otra@ejemplo.test" }));
  await rejects(w.settings.action("register"), "unavailable", "Pide el código otra vez");
  assert.deepEqual(w.requests, []);

  w = await sent();
  w.base.storage.set(PENDING_KEY, "{not json");
  await rejects(w.settings.action("register"), "unavailable", "Pide el código otra vez");
});

test("register: a pending device of a ttl that ran out is gone", async () => {
  const w = await sent();
  w.base.storage.set(PENDING_KEY, JSON.stringify({ userId: "u", userToken: "t", sn: "s", email: EMAIL }), { ttlMs: 1 });
  await new Promise((r) => setTimeout(r, 15));
  await rejects(w.settings.action("register"), "unavailable", "Pide el código otra vez");
});

test("register: missing code, password or email never reaches the portal", async () => {
  for (const [extra, code, msg] of [
    [{ verifyCode: "  " }, "auth_required", "Escribe el código de verificación"],
    [{ password: "" }, "auth_required", "Escribe tu contraseña en Ajustes"],
    [{ email: "" }, "auth_required", "Escribe tu correo en Ajustes"],
  ]) {
    const w = await sent();
    const w2 = world({ routes: goodRoutes(), config: withConfig(extra) });
    w2.base.storage.set(PENDING_KEY, w.base.storage.get(PENDING_KEY));
    await rejects(w2.settings.action("register"), code, msg);
    assert.deepEqual(w2.requests, []);
  }
});

test("register: a code with digits typed with spaces is trimmed", async () => {
  const w = await sent({ verifyCode: "  " + CODE + " " });
  await w.settings.action("register");
  assert.equal(w.requests[0].bean.verifyCode, CODE);
});

// ---- bounds ------------------------------------------------------------------------------------

const hang = (ms) => (req, clock) => { clock.t += Math.min(ms, req.timeoutMs); throw new Error("timed out"); };

test("slow portal: sendCode ends in unavailable inside 30 s, session untouched", async () => {
  const w = world({ routes: goodRoutes(), hosts: ["h1.test", "h2.test"], onFetch: hang(12_000) });
  await assert.rejects(w.settings.action("sendCode"), (e) => e.name === "KinoError_unavailable");
  assert.ok(w.clock.t - 5_000_000 < 30_000, `elapsed ${w.clock.t - 5_000_000}`);
  assert.ok(w.requests.every((r) => r.timeoutMs <= 12_000));
  assert.deepEqual(w.stored(), STORED);
});

test("slow portal: each step's request is clamped to what is left of the 25 s budget", async () => {
  // every answered call spends up to 9 s of the injected clock (never more than its own timeout)
  const slowOk = (req, clock) => { clock.t += Math.min(9_000, req.timeoutMs); return undefined; };
  const send = world({ routes: goodRoutes(), hosts: ["h1.test"], onFetch: slowOk });
  await send.settings.action("sendCode");
  assert.deepEqual(send.requests.map((r) => r.timeoutMs), [10_000, 10_000, 7_000]);
  assert.ok(send.clock.t - 5_000_000 <= 30_000);

  const reg = world({ routes: goodRoutes(), hosts: ["h1.test"], config: withConfig(), onFetch: slowOk });
  reg.base.storage.set(PENDING_KEY, JSON.stringify({ userId: "u", userToken: "t", sn: "s", email: EMAIL }));
  await reg.settings.action("register");
  assert.deepEqual(reg.requests.map((r) => r.timeoutMs), [10_000, 10_000, 7_000]);
  assert.ok(reg.clock.t - 5_000_000 <= 30_000);

  // a budget that runs out mid-flow replaces nothing; here it runs out at the login AFTER bindEmail,
  // so the account exists: the person is told to log in, not shown an error
  const dead = world({ routes: goodRoutes(), hosts: ["h1.test"], config: withConfig(), onFetch: (req, clock) => { clock.t += 13_000; return undefined; } });
  dead.base.storage.set(PENDING_KEY, JSON.stringify({ userId: "u", userToken: "t", sn: "s", email: EMAIL }));
  assert.equal((await dead.settings.action("register")).message, "Cuenta creada. Toca Iniciar sesión para entrar.");
  assert.deepEqual(dead.paths(), ["v2/validateVerifyCode", "v2/bindEmail"], "the login was never even asked");
  assert.ok(dead.clock.t - 5_000_000 < 30_000);
  assert.deepEqual(dead.stored(), STORED);
});

test("sendCode: a second tap inside 60 s for the same email mints nothing; after 60 s it sends again", async () => {
  const w = world({ routes: goodRoutes() });
  await w.settings.action("sendCode");
  assert.equal(JSON.parse(w.base.storage.get(PENDING_KEY)).at, w.clock.t);
  w.requests.length = 0;
  w.clock.t += 59_999;
  const out = await w.settings.action("sendCode");
  assert.equal(out.message, "Ya te enviamos un código; espera un minuto antes de pedir otro");
  keep(out);
  assert.deepEqual(w.requests, []);
  w.clock.t += 1;
  assert.equal((await w.settings.action("sendCode")).message, "Te enviamos un código a " + EMAIL);
  assert.equal(w.requests.length, 3);
});

test("register: login failing AFTER bindEmail is not an error: the account exists, the person is told to log in", async () => {
  for (const failure of [refuse("x"), new Error("offline"), { userId: "u", userToken: "" }]) {
    const w = await sent({}, { "v8/login": failure });
    const out = keep(await w.settings.action("register"));
    assert.equal(out.message, "Cuenta creada. Toca Iniciar sesión para entrar.");
    assert.equal(out.refresh, true);
    assert.deepEqual(out.clearSettings, ["verifyCode"], "the code is spent");
    assert.equal(w.base.storage.get(PENDING_KEY), null);
    assert.deepEqual(w.stored(), STORED);
  }
});

test("register: success clears the region-blocked flag and the exhausted state", async () => {
  const w = await sent();
  w.base.storage.set("region", JSON.stringify({ blocked: true }));
  assert.equal(w.session.regionBlocked(), true);
  await w.settings.action("register");
  assert.equal(w.session.regionBlocked(), false);
  assert.equal(w.session.seedsExhausted(), false);
});

// ---- the whole "Crear cuenta" flow through the settings form -----------------------------------

// The app's Guardar: validateSettings first; only a null answer stores the draft.
async function save(w, saved, values) {
  const verdict = await w.settings.validateSettings(values);
  if (verdict === null) Object.assign(saved, values);
  return verdict;
}

test("Crear cuenta end to end: save the email alone, send the code, save code + password, register", async () => {
  const saved = {};
  let bound = false;
  const routes = goodRoutes({
    // The account does not exist until bindEmail: the portal refuses its login before that.
    "v2/bindEmail": () => { bound = true; return {}; },
    "v8/login": () => (bound ? { userId: "u-new", userToken: "tok-new", jwtToken: "jwt-new" } : refuse("用户不存在")),
  });
  const w = world({ routes, saved });

  assert.equal(await save(w, saved, { email: EMAIL }), null, "an email alone is saved");
  assert.equal(saved.email, EMAIL);
  assert.deepEqual(w.requests, [], "an email alone costs no portal call");

  assert.equal((await w.settings.action("sendCode")).message, "Te enviamos un código a " + EMAIL);

  assert.equal(await save(w, saved, { email: EMAIL, password: PW, verifyCode: CODE }), null,
    "a refused login does not block saving while a registration is pending");
  assert.equal(saved.password, PW);

  const out = await w.settings.action("register");
  assert.equal(out.message, "Cuenta creada y sesión iniciada");
  assert.deepEqual(out.clearSettings, ["verifyCode"]);
  const s = w.stored();
  assert.equal(s.userToken, "tok-new");
  assert.equal(s.acct, w.session.accountKey(EMAIL, PW));
  assert.equal(w.session.accountState(), "held", "the new account is the one in use");
});

test("validateSettings: a filled verify code alone (no pending device here) also saves over a refused login", async () => {
  const saved = {};
  const w = world({ routes: goodRoutes({ "v8/login": refuse("用户不存在") }), saved });
  assert.equal(await save(w, saved, { email: EMAIL, password: PW, verifyCode: CODE }), null);
  // Without either, a refused login is still the field error.
  assert.deepEqual(await save(w, {}, { email: EMAIL, password: PW }), { password: "Credenciales de Xuper inválidas" });
  assert.deepEqual(await save(w, {}, { email: EMAIL, password: PW, verifyCode: "  " }), { password: "Credenciales de Xuper inválidas" });
});

// ---- the reason the person reads is the real one ---------------------------------------------------
// Every failure used to say "check that the email is spelled right", so someone blocked by region or on a device that could not
// open the portal's key kept retyping a correct email.

test("sendCode: a region block reads as a region block, not as a bad email", async () => {
  const w = world({ routes: goodRoutes({ "v8/active": { returnCode: "portal100024", errorMessage: "区域" } }) });
  await assert.rejects(w.settings.action("sendCode"), (e) => {
    assert.match(shown(e), /región|red/i);
    assert.doesNotMatch(shown(e), /correo|email/i);
    return true;
  });
  assert.equal(w.base.storage.get(PENDING_KEY), null);
});

test("sendCode: a portal that cannot be reached over the device's crypto says so, not a bad email", async () => {
  const base = fakeKino({ config: { email: EMAIL, password: PW } });
  const portal = { call: async () => { throw base.error("unavailable", "el portal no se pudo cifrar"); } };
  const registration = makeRegistration({ kino: base, portal, session: {}, clock: { now: () => 1 } });
  await assert.rejects(registration.sendRegistrationCode(EMAIL), (e) => {
    assert.match(shown(e), /actualiza|update/i);
    assert.doesNotMatch(shown(e), /correo|email/i);
    return true;
  });
});

test("login: a crypto failure and a region block are told as such", async () => {
  const mk = (err) => {
    const base = fakeKino({ config: { email: EMAIL, password: PW } });
    const session = { login: async () => { throw typeof err === "function" ? err(base) : err; } };
    return { base, settings: makeSettings({ kino: base, session, clock: { now: () => 1 }, registration: {} }) };
  };
  const crypto = mk((b) => b.error("unavailable", "el portal no se pudo cifrar"));
  await assert.rejects(crypto.settings.action("login"), (e) => { assert.match(shown(e), /actualiza|update/i); return true; });
  const geo = mk(new (await import("../src/portal.js")).PortalError("portal100024", "x"));
  await assert.rejects(geo.settings.action("login"), (e) => { assert.match(shown(e), /región|region|red|network/i); return true; });
});

test("sendCode: a refused email still says to check the email", async () => {
  const w = world({ routes: goodRoutes({ "v2/sendEmailVerifyCode": refuse() }) });
  await assert.rejects(w.settings.action("sendCode"), (e) => { assert.match(shown(e), /correo/); return true; });
});
