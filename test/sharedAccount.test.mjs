// The shared "cuenta compartida" fallback account (native "Omitir por ahora"): session source,
// the useShared action, the status line and the manifest entry. Stand-in pairs only; the REAL pair
// is read from src/config.js at test time just to prove it never leaks (never printed).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { PortalError, makePortal } from "../src/portal.js";
import { makeCrypto } from "../src/crypto.js";
import { PASSWORD_SALT, SHARED_EMAIL, SHARED_PASSWORD } from "../src/config.js";
import { makeSession } from "../src/session.js";
import { makeSettings } from "../src/settings.js";
import { checkSettingsOutput, validateManifest } from "../sdk/contract.mjs";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const manifestText = readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8");
const manifest = JSON.parse(manifestText);
const SH = { email: "compartida@stand-in.test", password: "shared-stand-in-pw" };
const OWN = { email: "ana@x.test", password: "own-stand-in-pw" };
const dead = () => new PortalError("aaa100028", "未登录");
const stored = (userToken, sn = "sn-own") => ({ userId: "u0", userToken, jwtToken: "", sn });
const ok = (userToken) => ({ userId: "u1", userToken, jwtToken: "j" });

function fakePortal() {
  const queues = {}; const calls = [];
  return {
    calls, paths: () => calls.map((c) => c.path),
    queue(path, ...a) { (queues[path] ??= []).push(...a); },
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

function setup({ config = {}, shared = SH, flag = false, session: sess = stored("T0"), seeds = null } = {}) {
  const kino = fakeKino({ config });
  if (sess) kino.storage.set("session", JSON.stringify(sess));
  if (flag) kino.storage.set("sharedAccount", "true");
  if (seeds) kino.storage.set("seeds", JSON.stringify(seeds));
  const portal = fakePortal();
  const clock = { now: () => 1_000_000 };
  const session = makeSession({ kino, portal, clock, random: () => 0, shared });
  const settings = makeSettings({ kino, session, clock });
  return { kino, portal, session, settings, flag: () => kino.storage.get("sharedAccount") };
}
const rejects = (p, code, msg) => assert.rejects(p, (e) => { assert.equal(e.name, "KinoError_" + code); if (msg) assert.equal(e.message, msg); return true; });

// ---- session: account resolution -------------------------------------------------------------

test("kind: shared account counts as an account only when chosen; blank pair disables it", () => {
  assert.equal(setup().session.kind(), "own");
  assert.equal(setup({ flag: true }).session.kind(), "account");
  assert.equal(setup({ flag: true, shared: { email: "", password: "x" } }).session.kind(), "own");
  assert.equal(setup({ flag: true, shared: { email: " ", password: " " } }).session.kind(), "own");
  assert.equal(setup({ flag: true, shared: null }).session.kind(), "own");
  assert.equal(setup({ config: OWN }).session.kind(), "account");
});

test("relogin after a dead token uses the shared pair when chosen", async () => {
  const t = setup({ flag: true });
  t.portal.queue("v8/login", ok("T1"));
  await t.session.withValidSession(async ({ userToken }) => { if (userToken === "T0") throw dead(); return userToken; });
  const login = t.portal.calls.find((c) => c.path === "v8/login");
  assert.equal(login.bean.userName, SH.email);
  assert.equal(login.bean.password, md5(SH.password + PASSWORD_SALT));
});

test("the person's own account wins over the shared one", async () => {
  const t = setup({ flag: true, config: OWN });
  t.kino.storage.set("session", JSON.stringify(stored("")));
  t.portal.queue("v8/login", ok("T1"));
  await t.session.ensure();
  assert.equal(t.portal.calls[0].bean.userName, OWN.email);
});

test("without the flag the shared pair is never used", async () => {
  const t = setup({ session: stored("") });
  t.portal.queue("v8/active", ok("T1"));
  await t.session.ensure();
  assert.ok(!t.portal.paths().includes("v8/login"));
});

test("no seed swap while on the shared account (geo-block, dead token)", async () => {
  const seeds = [{ sn: "seed-1", userId: "s", userToken: "st1" }];
  const t = setup({ flag: true, seeds });
  t.portal.queue("v8/login", ok("T1"));
  const out = await t.session.withValidSession(async ({ userToken }) => {
    if (userToken === "T0") throw new PortalError("portal100024", "geo");
    return userToken;
  });
  assert.equal(out, "T1");
  assert.equal(JSON.parse(t.kino.storage.get("session")).sn, "sn-own");
  assert.deepEqual(await t.session.switchSeed(), { result: "account_linked", tries: 0 });
});

// ---- session.useShared / flag lifecycle ------------------------------------------------------

test("useShared: logs in with the pair, then sets the flag; failure leaves it unset", async () => {
  const t = setup();
  t.portal.queue("v8/login", ok("T9"));
  await t.session.useShared({ timeoutMs: 5, deadline: 99 });
  assert.equal(t.flag(), "true");
  assert.equal(t.portal.calls[0].bean.userName, SH.email);
  assert.equal(t.portal.calls[0].opts.timeoutMs, 5);
  assert.equal(t.portal.calls[0].opts.deadline, 99);
  assert.equal(t.session.kind(), "account");

  const f = setup();
  f.portal.queue("v8/login", new PortalError("aaa100011", "bad"));
  await rejects(f.session.useShared(), "auth_required", "No se pudo activar la cuenta compartida");
  assert.equal(f.flag(), null);
});

test("useShared: blank pair is unavailable with no portal call; an own account blocks it", async () => {
  const t = setup({ shared: { email: "", password: "" } });
  await rejects(t.session.useShared(), "unavailable");
  assert.deepEqual(t.portal.calls, []);
  const o = setup({ config: OWN });
  await rejects(o.session.useShared(), "auth_required");
  assert.deepEqual(o.portal.calls, []);
});

test("logout and a successful own login clear the flag", async () => {
  let t = setup({ flag: true });
  t.portal.queue("v5/loginOut", { });
  t.portal.queue("v8/active", ok("T2"));
  await t.session.logout();
  assert.notEqual(t.flag(), "true");
  assert.equal(t.session.kind(), "own");

  t = setup({ flag: true });
  t.portal.queue("v8/login", ok("T3"));
  await t.session.login(OWN.email, OWN.password);
  assert.notEqual(t.flag(), "true");

  t = setup({ flag: true });
  t.portal.queue("v8/login", new PortalError("aaa100011", "bad"));
  await assert.rejects(t.session.login(OWN.email, "nope"));
  assert.equal(t.flag(), "true", "a refused own login keeps the choice");
});

test("a failing storage write on the flag never leaks and useShared reports unavailable", async () => {
  const t = setup();
  const real = t.kino.storage;
  const kino2 = { ...t.kino, storage: { ...real, get: (k) => real.get(k), set: (k, v) => { if (k === "sharedAccount") throw new Error("quota " + SH.password); real.set(k, v); } } };
  const session = makeSession({ kino: kino2, portal: t.portal, clock: { now: () => 1 }, random: () => 0, shared: SH });
  t.portal.queue("v8/login", ok("T9"));
  await assert.rejects(session.useShared(), (e) => e.name === "KinoError_unavailable" && !e.message.includes(SH.password));
});

// ---- settings: action, status, manifest ------------------------------------------------------

test("action useShared: success answers the plugin message with refresh", async () => {
  const t = setup();
  t.portal.queue("v8/login", ok("T9"));
  const out = await t.settings.action("useShared");
  assert.deepEqual(out, { message: "Cuenta compartida activada", refresh: true });
  assert.equal(checkSettingsOutput("action", out, manifest).message, out.message);
  assert.equal(t.flag(), "true");
});

test("action useShared: failure texts, no pair anywhere", async () => {
  const t = setup();
  t.portal.queue("v8/login", new PortalError("aaa100011", "bad " + SH.password));
  await rejects(t.settings.action("useShared"), "auth_required", "No se pudo activar la cuenta compartida");
  const d = setup();
  d.portal.queue("v8/login", new Error("boom " + SH.password));
  await assert.rejects(d.settings.action("useShared"), (e) => e.name === "KinoError_unavailable" && !e.message.includes(SH.password));
});

function slowWorld() {
  const clock = { t: 5_000_000, now() { return this.t; } };
  const fetches = [];
  const base = fakeKino({ fetch: async (url, opts) => { fetches.push(opts.timeoutMs); clock.t += Math.min(12_000, opts.timeoutMs); throw new Error("timed out"); } });
  const kino = Object.freeze({ ...base, sleep: async () => {} });
  kino.storage.set("session", JSON.stringify(stored("T0")));
  let session = null;
  const portal = makePortal({ kino, crypto: makeCrypto(kino), clock, snProvider: () => session.current().sn, config: { hosts: ["h1.test", "h2.test"], appId: "a", apkVersion: "9" } });
  session = makeSession({ kino, portal, clock, random: () => 0, shared: SH });
  return { kino, clock, fetches, settings: makeSettings({ kino, session, clock }), elapsed: () => clock.t - 5_000_000 };
}

test("slow portal: useShared throws unavailable inside 30 s and sets no flag", async () => {
  const w = slowWorld();
  await assert.rejects(w.settings.action("useShared"), (e) => e.name === "KinoError_unavailable" && !e.message.includes(SH.password));
  assert.deepEqual(w.fetches, [12_000, 12_000]);
  assert.ok(w.elapsed() < 30_000);
  assert.notEqual(w.kino.storage.get("sharedAccount"), "true");
});

test("logout action keeps clearSettings and clears the flag (real session)", async () => {
  const t = setup({ flag: true });
  t.portal.queue("v5/loginOut", {});
  t.portal.queue("v8/active", ok("T2"));
  const out = await t.settings.action("logout");
  assert.deepEqual(out.clearSettings, ["email", "password"]);
  assert.notEqual(t.flag(), "true");
});

test("status: shared account line, within 200 chars, no pair", async () => {
  const t = setup({ flag: true });
  const out = await t.settings.settingsStatus();
  assert.equal(out.status, "Cuenta compartida");
  assert.deepEqual(checkSettingsOutput("settingsStatus", out, manifest), out);
  assert.ok(!JSON.stringify(out).includes(SH.email));
  const own = setup({ flag: true, config: OWN });
  assert.equal((await own.settings.settingsStatus()).status, `Conectado como ${OWN.email}`);
});

test("manifest: useShared action after logout, valid for the kit, hint and confirm within caps", () => {
  const checked = validateManifest(manifestText);
  assert.ok(checked.ok, checked.message);
  const keys = manifest.settings.map((s) => s.key);
  assert.equal(keys[keys.indexOf("logout") + 1], "useShared");
  const a = manifest.settings.find((s) => s.key === "useShared");
  assert.equal(a.type, "action");
  assert.equal(a.label, "Usar cuenta compartida");
  assert.equal(a.hint, "Sin crear cuenta: usa la cuenta que Kino comparte con todos.");
  assert.ok(a.hint.length <= 80);
  assert.equal(a.confirm, "Esta cuenta la usan muchas personas. ¿Continuar?");
  assert.ok(a.confirm.length <= 120);
});

// ---- the real pair never leaks ---------------------------------------------------------------

test("the REAL shared pair never shows in messages, errors, logs or stored values", async () => {
  const logs = [];
  const seen = [];
  const run = async (portalAnswer) => {
    const t = setup({ shared: { email: SHARED_EMAIL, password: SHARED_PASSWORD } });
    const kino = Object.freeze({ ...t.kino, log: (m) => logs.push(String(m)) });
    const session = makeSession({ kino, portal: t.portal, clock: { now: () => 1 }, random: () => 0, shared: { email: SHARED_EMAIL, password: SHARED_PASSWORD } });
    const settings = makeSettings({ kino, session, clock: { now: () => 1 } });
    t.portal.queue("v8/login", portalAnswer);
    try { seen.push(JSON.stringify(await settings.action("useShared"))); } catch (e) { seen.push(String(e.name) + e.message); }
    seen.push(JSON.stringify(await settings.settingsStatus()));
    for (const k of ["session", "sharedAccount", "region", "seeds"]) seen.push(String(t.kino.storage.get(k)));
  };
  await run(ok("T1"));
  await run(new PortalError("aaa100011", "x " + SHARED_PASSWORD));
  await run(new Error(SHARED_EMAIL + SHARED_PASSWORD));
  const all = seen.join("\n") + logs.join("\n");
  assert.ok(SHARED_EMAIL !== "" && SHARED_PASSWORD !== "", "the owner filled the pair");
  assert.ok(!all.includes(SHARED_EMAIL), "email leaked");
  assert.ok(!all.includes(SHARED_PASSWORD), "password leaked");
});
