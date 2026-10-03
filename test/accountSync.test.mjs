// The stored session belongs to an account (`acct`): credentials that arrive by sync (no
// validateSettings, the sandbox is just reopened), a changed or cleared account, refused pairs and
// the status line, through the REAL session/portal over a scripted fetch. The device (`sn`) is this
// device's own and never changes with the account; no snToken is ever minted by a config change.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeCrypto } from "../src/crypto.js";
import { makePortal, PortalError } from "../src/portal.js";
import { makeSession } from "../src/session.js";
import { makeSettings } from "../src/settings.js";
import { PASSWORD_SALT } from "../src/config.js";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const keyOf = (email, pw) => createHash("sha256").update(email + "\n" + md5(pw + PASSWORD_SALT)).digest("hex");
const hexToText = (hex) => Buffer.from(hex, "hex").toString("utf8");
const reply = (obj) => ({ text: () => JSON.stringify(obj) });
const A = { email: "ana@x.test", password: "pw-ana-stand-in" };
const B = { email: "beto@x.test", password: "pw-beto-stand-in" };
const SN = "sn-this-device";

// `routes` answer by path; `login` decides per userName. Every request is recorded (decrypted).
function world({ stored = { userId: "u0", userToken: "T0", jwtToken: "", sn: SN, acct: "" }, config = {}, login } = {}) {
  const clock = { t: 5_000_000, now() { return this.t; } };
  const cfg = { ...config };
  const requests = [];
  const logs = [];
  const base = fakeKino({ config });
  const decrypt = (wire) => base.crypto.decrypt("des-ede3-ecb", { key: base.secret("magisKey"), data: hexToText(wire), padding: "pkcs7" });
  let n = 0;
  const failNext = { network: false };
  const kino = Object.freeze({
    ...base, sleep: async () => {}, log: (m) => logs.push(String(m)),
    config: Object.freeze({ get: (k) => cfg[k], all: () => ({ ...cfg }) }),
    fetch: async (url, opts) => {
      const path = new URL(url).pathname.replace("/api/portalCore/", "");
      const bean = JSON.parse(decrypt(opts.body));
      requests.push({ path, bean });
      if (failNext.network) throw new Error("offline");
      if (path === "v8/login") return reply(login ? login(bean) : { returnCode: "0", userId: "ul", userToken: "TL" + ++n, jwtToken: "j" });
      if (path === "v8/active") return reply({ returnCode: "0", userId: "ua", userToken: "TA" + ++n, jwtToken: "j" });
      if (path === "v3/snToken") return reply({ returnCode: "0", snToken: "NEW-SNTOKEN" });
      if (path === "v5/loginOut") return reply({ returnCode: "0" });
      throw new Error("unscripted portal path " + path);
    },
  });
  if (stored) base.storage.set("session", JSON.stringify(stored));
  let session = null;
  const portal = makePortal({ kino, crypto: makeCrypto(kino), clock, snProvider: () => session.current().sn, config: { hosts: ["h1.test"], appId: "app-1", apkVersion: "9.9" } });
  session = makeSession({ kino, portal, clock, random: () => 0, shared: { email: "compartida@stand-in.test", password: "shared-stand-in-pw" } });
  const settings = makeSettings({ kino, session, clock });
  return {
    kino, base, cfg, session, settings, requests, logs, failNext, clock,
    paths: () => requests.map((r) => r.path),
    stored: () => JSON.parse(base.storage.get("session")),
    status: async () => (await settings.settingsStatus()).status,
  };
}
const refuse = (bean) => ({ returnCode: "aaa100011", errorMessage: "bad " + bean.userName });

// ---- credentials appear by sync ---------------------------------------------------------------

test("credentials appear in config (no validateSettings): the next ensure logs in on the SAME sn, minting nothing", async () => {
  const w = world();
  assert.equal(w.session.kind(), "own");
  w.cfg.email = A.email; w.cfg.password = A.password; // what the sync does, then the sandbox reopens
  assert.equal(w.session.kind(), "own", "the token held is still the anonymous one");
  assert.equal(await w.status(), "Conectando con tu cuenta… Mientras tanto, sesión anónima");
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/login"]);
  assert.equal(w.requests[0].bean.sn, SN, "the asserted login bean carries the old sn");
  assert.equal(w.requests[0].bean.userName, A.email);
  assert.equal(w.requests[0].bean.password, md5(A.password + PASSWORD_SALT));
  assert.ok(!w.paths().includes("v3/snToken"));
  const s = w.stored();
  assert.equal(s.sn, SN);
  assert.equal(s.acct, keyOf(A.email, A.password));
  assert.equal(w.session.kind(), "account");
  assert.equal(await w.status(), `Conectado como ${A.email}`);
  await w.session.ensure();
  assert.equal(w.requests.length, 1, "a held account token costs no more calls");
});

test("a session stored before `acct` existed is treated as anonymous: re-logged once with an own account, kept without one", async () => {
  const legacy = { userId: "u0", userToken: "T0", jwtToken: "", sn: SN };
  const w = world({ stored: legacy, config: A });
  await w.session.ensure();
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/login"]);
  assert.equal(w.stored().acct, keyOf(A.email, A.password));
  const n = world({ stored: legacy });
  await n.session.ensure();
  assert.deepEqual(n.requests, []);
  assert.equal(n.stored().userToken, "T0");
});

// ---- account changes ---------------------------------------------------------------------------

test("account A to B: relogin with B on the same sn, no new device", async () => {
  const w = world({ stored: { userId: "u0", userToken: "TA", jwtToken: "", sn: SN, acct: keyOf(A.email, A.password) }, config: A });
  await w.session.ensure();
  assert.deepEqual(w.requests, [], "A's token is held while A is configured");
  w.cfg.email = B.email; w.cfg.password = B.password;
  assert.equal(w.session.kind(), "own");
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/login"]);
  assert.equal(w.requests[0].bean.userName, B.email);
  assert.equal(w.requests[0].bean.sn, SN);
  assert.equal(w.stored().acct, keyOf(B.email, B.password));
});

test("account cleared: the token is dropped and the same sn is reactivated anonymously (v8/active, empty snToken, never a mint)", async () => {
  const w = world({ stored: { userId: "u0", userToken: "TA", jwtToken: "", sn: SN, acct: keyOf(A.email, A.password) }, config: A });
  w.cfg.email = ""; w.cfg.password = "";
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/active"]);
  assert.equal(w.requests[0].bean.snToken, "");
  assert.equal(w.requests[0].bean.sn, SN);
  assert.deepEqual([w.stored().sn, w.stored().acct], [SN, ""]);
  await w.session.ensure();
  assert.equal(w.requests.length, 1);
  assert.equal(await w.status(), "Sin cuenta: sesión anónima");
});

test("only the email, or only the password, is NO own account: no login, no portal call, no storm", async () => {
  for (const half of [{ email: A.email }, { password: A.password }]) {
    const w = world({ config: half });
    for (let i = 0; i < 3; i++) await w.session.ensure();
    assert.deepEqual(w.requests, [], JSON.stringify(Object.keys(half)));
    assert.equal(w.session.kind(), "own");
    assert.equal(await w.status(), "Sin cuenta: sesión anónima");
  }
  // an account held, then the password disappears (sync delivered half): back to anonymous once
  const w = world({ stored: { userId: "u0", userToken: "TA", jwtToken: "", sn: SN, acct: keyOf(A.email, A.password) }, config: { email: A.email } });
  await w.session.ensure();
  await w.session.ensure();
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/active"]);
});

// ---- refused pairs ----------------------------------------------------------------------------

test("a refused pair falls to anonymous, is remembered, and is retried only when the key changes or on explicit login/reauth", async () => {
  const w = world({ config: A, login: (bean) => (bean.userName === B.email ? { returnCode: "0", userId: "ub", userToken: "TB", jwtToken: "j" } : refuse(bean)) });
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/login", "v8/active"]);
  assert.equal(w.stored().acct, "");
  assert.equal(await w.status(), "No se pudo iniciar sesión con tu cuenta: sesión anónima. Revisa tu correo y contraseña");
  assert.equal(w.session.kind(), "own");
  for (let i = 0; i < 3; i++) await w.session.ensure();
  assert.equal(w.requests.length, 2, "not retried on every call");

  // explicit login retries (and a refusal keeps it remembered)
  await assert.rejects(w.session.login(A.email, A.password), (e) => e.name === "KinoError_auth_required");
  assert.equal(w.requests.length, 3);

  // reauth after a dead token retries the refused account once, then falls back
  let first = true;
  await w.session.withValidSession(async ({ userToken }) => {
    if (first) { first = false; throw new PortalError("aaa100028", "dead"); }
    return userToken;
  });
  assert.deepEqual(w.paths().slice(3), ["v8/login", "v8/active"]);

  // a different key is tried at once
  w.cfg.email = B.email; w.cfg.password = B.password;
  await w.session.ensure();
  assert.equal(w.requests.at(-1).bean.userName, B.email);
  assert.equal(w.stored().acct, keyOf(B.email, B.password));
  assert.equal(w.session.kind(), "account");
});

test("a login that fails on the network is never remembered as refused; the anonymous token is used for 60 s without any portal call, then one retry", async () => {
  const w = world({ config: A });
  w.failNext.network = true;
  await assert.rejects(w.session.ensure()); // login and anonymous both fail offline
  assert.equal(w.base.storage.get("refusedAcct"), null);
  w.failNext.network = false;
  await w.session.ensure(); // cooling: no login, only the anonymous reactivation
  assert.ok(!w.paths().slice(2).includes("v8/login"));
  const calls = w.requests.length;
  for (let i = 0; i < 3; i++) await w.session.ensure();
  assert.equal(w.requests.length, calls, "token held (anonymous) and cooling: zero portal calls");
  assert.equal(w.session.kind(), "own");
  assert.equal(await w.status(), "Conectando con tu cuenta… Mientras tanto, sesión anónima");
  w.clock.t += 61_000;
  await w.session.ensure();
  assert.deepEqual(w.paths().slice(calls), ["v8/login"], "one retry after the cooldown");
  assert.equal(w.stored().acct, keyOf(A.email, A.password));
});

test("explicit login and reauthentication ignore the cooldown", async () => {
  const w = world({ config: A });
  w.failNext.network = true;
  await assert.rejects(w.session.ensure());
  w.failNext.network = false;
  await w.session.ensure();
  const before = w.requests.length;
  await w.session.login(A.email, A.password);
  assert.deepEqual(w.paths().slice(before), ["v8/login"]);
});

test("geo-block and 'no session' answers on login are not remembered as a refusal; any other code is, for 10 minutes", async () => {
  for (const code of ["portal100024", "login_sin_token"]) {
    const w = world({ config: A, login: () => (code === "login_sin_token" ? { returnCode: "0" } : { returnCode: code, errorMessage: "geo" }) });
    await w.session.ensure();
    assert.equal(w.base.storage.get("refusedAcct"), null, code);
  }
  const w = world({ config: A, login: refuse });
  await w.session.ensure();
  assert.equal(JSON.parse(w.base.storage.get("refusedAcct")).key, keyOf(A.email, A.password));
  const calls = w.requests.length;
  w.clock.t += 9 * 60_000;
  await w.session.ensure();
  assert.equal(w.requests.length, calls, "still remembered inside 10 minutes");
  assert.equal(w.session.kind(), "own");
  w.clock.t += 2 * 60_000; // 11 min
  assert.equal(w.session.accountState(), "pending", "expired: not remembered any more");
  await w.session.ensure();
  assert.deepEqual(w.paths().slice(calls), ["v8/login", "v8/active"], "retried after 10 minutes");
});

test("a password fix (key change) retries at once, even inside the 10 minutes", async () => {
  const w = world({ config: A, login: (bean) => (bean.password === md5("fixed-pw" + PASSWORD_SALT) ? { returnCode: "0", userId: "u", userToken: "TF", jwtToken: "" } : refuse(bean)) });
  await w.session.ensure();
  w.cfg.password = "fixed-pw";
  await w.session.ensure();
  assert.equal(w.stored().userToken, "TF");
  assert.equal(w.session.kind(), "account");
});

test("stray whitespace around email and password: ensure, login and the stored key agree, no relogin loop", async () => {
  const w = world({ config: { email: "  " + A.email + " ", password: " " + A.password + "\n" } });
  await w.session.ensure();
  assert.equal(w.requests[0].bean.userName, A.email);
  assert.equal(w.requests[0].bean.password, md5(A.password + PASSWORD_SALT));
  assert.equal(w.stored().acct, keyOf(A.email, A.password));
  await w.session.ensure();
  await w.session.login(A.email, A.password);
  await w.session.ensure();
  assert.deepEqual(w.paths(), ["v8/login", "v8/login"], "only the explicit login hit the portal again");
  assert.equal(w.session.kind(), "account");
});

test("a failing storage write on the refused-key memory never breaks the call", async () => {
  const w = world({ config: A, login: refuse });
  const real = w.base.storage;
  const kino2 = Object.freeze({ ...w.kino, storage: { ...real, get: (k) => real.get(k), remove: (k) => real.remove(k), set: (k, v, o) => { if (k === "refusedAcct") throw new Error("quota"); real.set(k, v, o); } } });
  const session = makeSession({ kino: kino2, portal: { call: async (p, b, o) => { if (p === "v8/login") { throw new PortalError("aaa100011", "bad"); } return { userId: "u", userToken: "TZ", jwtToken: "" }; } }, clock: { now: () => 1 }, random: () => 0 });
  await session.ensure();
  assert.equal(JSON.parse(real.get("session")).userToken, "TZ");
});

// ---- no secret in anything stored or logged -------------------------------------------------------

test("the password (typed or hashed for the portal) is never in the stored values, the logs or the status", async () => {
  const w = world({ config: A });
  await w.session.ensure();
  await w.session.login(A.email, A.password);
  await assert.rejects(world({ config: A, login: refuse }).session.login(A.email, A.password));
  const dump = [...w.base.storage.keys()].map((k) => w.base.storage.get(k)).join("\n") + w.logs.join("\n") + (await w.status());
  assert.ok(!dump.includes(A.password));
  assert.ok(!dump.includes(md5(A.password + PASSWORD_SALT)), "the portal's password hash is not stored either");
  assert.match(w.stored().acct, /^[0-9a-f]{64}$/);
});
