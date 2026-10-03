// The shared "cuenta compartida" fallback account (native "Omitir por ahora"): session source, the
// synced toggle `useSharedAccount`, its validation, the status line and the manifest entry. Stand-in pairs only; the REAL pair
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

// `toggle`: the synced setting (true / false / undefined = never saved); `flag`: the legacy storage
// flag of the version that kept the choice in kino.storage.
function setup({ config = {}, shared = SH, toggle, flag = false, session: sess = stored("T0"), seeds = null } = {}) {
  const cfg = { ...config };
  const kino0 = fakeKino({ config });
  if (sess) kino0.storage.set("session", JSON.stringify(sess));
  if (flag) kino0.storage.set("sharedAccount", "true");
  if (seeds) kino0.storage.set("seeds", JSON.stringify(seeds));
  // The kit reports an unset toggle as false; the app leaves it absent (undefined): mirror the app.
  const kino = Object.freeze({ ...kino0, config: Object.freeze({
    get: (k) => (k === "useSharedAccount" ? (k in cfg ? cfg[k] : toggle) : kino0.config.get(k)),
    all: () => ({ ...kino0.config.all() }),
  }) });
  const portal = fakePortal();
  const clock = { now: () => 1_000_000 };
  const session = makeSession({ kino, portal, clock, random: () => 0, shared });
  const settings = makeSettings({ kino, session, clock });
  return { kino, cfg, portal, session, settings, flag: () => kino.storage.get("sharedAccount"), stored: () => JSON.parse(kino.storage.get("session")) };
}
const rejects = (p, code, msg) => assert.rejects(p, (e) => { assert.equal(e.name, "KinoError_" + code); if (msg) assert.equal(e.message, msg); return true; });
const sharedSession = (token, sn = "sn-own") => ({ ...stored(token, sn), acct: "shared" });
const dying = async ({ userToken }) => { if (userToken === "T0") throw dead(); return userToken; };

// ---- session: account resolution -------------------------------------------------------------

test("kind: shared counts as an account only with the toggle on AND its token held; blank pair disables it", () => {
  assert.equal(setup().session.kind(), "own");
  assert.equal(setup({ toggle: true, session: sharedSession("T0") }).session.kind(), "account");
  assert.equal(setup({ toggle: true }).session.kind(), "own", "chosen but not logged in yet: the token held is anonymous");
  assert.equal(setup({ toggle: false, session: sharedSession("T0") }).session.kind(), "own");
  for (const shared of [{ email: "", password: "x" }, { email: " ", password: " " }, null]) {
    assert.equal(setup({ toggle: true, shared, session: sharedSession("T0") }).session.kind(), "own");
  }
  const own = setup({ config: OWN });
  own.kino.storage.set("session", JSON.stringify({ ...stored("T0"), acct: own.session.accountKey(OWN.email, OWN.password) }));
  assert.equal(own.session.kind(), "account");
});

test("relogin after a dead token uses the shared pair when the toggle is on", async () => {
  const t = setup({ toggle: true, session: sharedSession("T0") });
  t.portal.queue("v8/login", ok("T1"));
  await t.session.withValidSession(dying);
  const login = t.portal.calls.find((c) => c.path === "v8/login");
  assert.equal(login.bean.userName, SH.email);
  assert.equal(login.bean.password, md5(SH.password + PASSWORD_SALT));
  assert.equal(t.stored().acct, "shared");
});

test("the person's own account wins over the shared toggle", async () => {
  const t = setup({ toggle: true, config: OWN, session: stored("") });
  t.portal.queue("v8/login", ok("T1"));
  await t.session.ensure();
  assert.equal(t.portal.calls[0].bean.userName, OWN.email);
});

test("with the toggle off or unset the shared pair is never used", async () => {
  for (const toggle of [false, undefined]) {
    const t = setup({ toggle, session: stored("") });
    t.portal.queue("v8/active", ok("T1"));
    await t.session.ensure();
    assert.ok(!t.portal.paths().includes("v8/login"));
  }
});

test("no seed swap while on the shared account (geo-block, dead token)", async () => {
  const seeds = [{ sn: "seed-1", userId: "s", userToken: "st1" }];
  const t = setup({ toggle: true, seeds, session: sharedSession("T0") });
  t.portal.queue("v8/login", ok("T1"));
  const out = await t.session.withValidSession(async ({ userToken }) => {
    if (userToken === "T0") throw new PortalError("portal100024", "geo");
    return userToken;
  });
  assert.equal(out, "T1");
  assert.equal(t.stored().sn, "sn-own");
  assert.deepEqual(await t.session.switchSeed(), { result: "account_linked", tries: 0 });
});

// ---- session.useShared: no flag any more ------------------------------------------------------

test("useShared: logs in with the pair on this device's sn and stores it as the shared account's token; a refusal is remembered", async () => {
  const t = setup();
  t.portal.queue("v8/login", ok("T9"));
  await t.session.useShared({ timeoutMs: 5, deadline: 99 });
  assert.equal(t.flag(), null, "no storage flag: the toggle is the choice");
  assert.equal(t.portal.calls[0].bean.userName, SH.email);
  assert.equal(t.portal.calls[0].opts.timeoutMs, 5);
  assert.equal(t.portal.calls[0].opts.deadline, 99);
  assert.equal(t.portal.calls[0].opts.sn, "sn-own");
  assert.equal(t.stored().acct, "shared");

  const f = setup();
  f.portal.queue("v8/login", new PortalError("aaa100011", "bad"));
  await rejects(f.session.useShared(), "auth_required", "No se pudo activar la cuenta compartida");
  assert.equal(f.stored().userToken, "T0", "a refusal leaves the session alone");
  assert.equal(JSON.parse(f.kino.storage.get("refusedAcct")).key, "shared");
});

test("useShared: a blank pair is unavailable with no portal call", async () => {
  const t = setup({ shared: { email: "", password: "" } });
  await rejects(t.session.useShared(), "unavailable");
  assert.deepEqual(t.portal.calls, []);
});

// ---- the legacy `sharedAccount` flag (versions before the toggle) ------------------------------

test("legacy flag: honoured while the toggle is unset and there is no own account", async () => {
  const t = setup({ flag: true, session: stored("") });
  t.portal.queue("v8/login", ok("T1"));
  await t.session.ensure();
  assert.equal(t.portal.calls[0].bean.userName, SH.email);
  assert.equal(t.session.usingShared(), true);
  assert.equal(t.flag(), "true", "kept until the person saves settings");
});

test("legacy flag: deleted when the toggle is explicitly set, when an own account shows up, on logout and on an own login", async () => {
  for (const toggle of [true, false]) {
    const t = setup({ flag: true, toggle });
    t.session.kind();
    assert.equal(t.flag(), null, "toggle " + toggle);
    assert.equal(t.session.usingShared(), toggle);
  }
  const o = setup({ flag: true, config: OWN });
  o.session.kind();
  assert.equal(o.flag(), null);
  o.cfg.email = ""; // blanking later must not bring the shared pair back
  assert.equal(o.session.usingShared(), false);

  const l = setup({ flag: true });
  l.portal.queue("v5/loginOut", {});
  l.portal.queue("v8/active", ok("T2"));
  await l.session.logout();
  assert.equal(l.flag(), null);
  assert.equal(l.session.usingShared(), false, "clearing the setting later (unset) must not revive the old flag");

  const n = setup({ flag: true });
  n.portal.queue("v8/login", ok("T3"));
  await n.session.login(OWN.email, OWN.password);
  assert.equal(n.flag(), null);

  const r = setup({ flag: true });
  r.portal.queue("v8/login", new PortalError("aaa100011", "bad"));
  await assert.rejects(r.session.login(OWN.email, "nope"));
  assert.equal(r.flag(), "true", "a refused own login keeps the old choice");
});

// ---- a refused shared pair falls to anonymous (no flag to clear: the key is remembered) --------

test("a REFUSED shared relogin falls to anonymous and is not retried on every call", async () => {
  const t = setup({ toggle: true, session: sharedSession("T0") });
  t.portal.queue("v8/login", new PortalError("aaa100011", "bad"));
  t.portal.queue("v8/active", ok("TA"));
  await t.session.withValidSession(dying);
  assert.equal(t.stored().acct, "");
  assert.equal(t.session.kind(), "own");
  assert.equal((await t.settings.settingsStatus()).status, "La cuenta compartida ya no funciona: sesión anónima");
  await t.session.ensure();
  await t.session.ensure();
  assert.equal(t.portal.paths().filter((p) => p === "v8/login").length, 1, "no login storm");
});

test("ensure with a refused shared pair goes anonymous; a network failure does not remember a refusal", async () => {
  const t = setup({ toggle: true, session: stored("") });
  t.portal.queue("v8/login", new PortalError("aaa100011", "bad"));
  t.portal.queue("v8/active", ok("TA"));
  await t.session.ensure();
  assert.equal(JSON.parse(t.kino.storage.get("refusedAcct")).key, "shared");

  const n = setup({ toggle: true, session: stored("") });
  n.portal.queue("v8/login", n.kino.error("unavailable", "red"));
  n.portal.queue("v8/active", ok("TA"));
  await n.session.ensure();
  assert.equal(n.kino.storage.get("refusedAcct"), null);
  assert.equal(n.session.usingShared(), true, "still chosen: retried after the cooldown");
});

test("a storage failure while saving the shared token never leaks the pair", async () => {
  const t = setup();
  const real = t.kino.storage;
  const kino2 = Object.freeze({ ...t.kino, storage: { ...real, get: (k) => real.get(k), set: (k, v) => { if (k === "session") throw new Error("quota " + SH.password); real.set(k, v); } } });
  const session = makeSession({ kino: kino2, portal: t.portal, clock: { now: () => 1 }, random: () => 0, shared: SH });
  const settings = makeSettings({ kino: kino2, session, clock: { now: () => 1 } });
  t.portal.queue("v8/login", ok("T9"));
  await assert.rejects(settings.validateSettings({ useSharedAccount: true }), (e) => e.name === "KinoError_unavailable" && !e.message.includes(SH.password));
});

// ---- settings: validateSettings, logout, status, manifest --------------------------------------

test("validateSettings: toggle on with no own account = one shared login, null when it works", async () => {
  const t = setup();
  t.portal.queue("v8/login", ok("T9"));
  assert.equal(await t.settings.validateSettings({ useSharedAccount: true }), null);
  assert.deepEqual(t.portal.paths(), ["v8/login"]);
  assert.equal(t.portal.calls[0].bean.userName, SH.email);
  assert.deepEqual([t.portal.calls[0].opts.timeoutMs, t.portal.calls[0].opts.deadline], [12_000, 1_017_000]);
});

test("validateSettings: toggle on with an own account is a field error and never touches the portal", async () => {
  const t = setup();
  const msg = "Quita tu cuenta o apaga la cuenta compartida";
  assert.deepEqual(await t.settings.validateSettings({ useSharedAccount: true, email: OWN.email, password: OWN.password }), { useSharedAccount: msg });
  assert.ok(msg.length <= 200);
  const half = await t.settings.validateSettings({ useSharedAccount: true, email: OWN.email, password: "" });
  assert.equal(half.useSharedAccount, msg);
  assert.equal(half.password, undefined, "an email alone is no field error");
  assert.deepEqual(t.portal.calls, []);
});

test("validateSettings: a refused shared pair is a field error on the toggle; toggle off does nothing", async () => {
  const t = setup();
  t.portal.queue("v8/login", new PortalError("aaa100011", "bad " + SH.password));
  const out = await t.settings.validateSettings({ useSharedAccount: true });
  assert.deepEqual(out, { useSharedAccount: "No se pudo activar la cuenta compartida" });
  assert.ok(!JSON.stringify(out).includes(SH.password));
  const off = setup();
  assert.equal(await off.settings.validateSettings({ useSharedAccount: false }), null);
  assert.equal(await off.settings.validateSettings({}), null);
  assert.deepEqual(off.portal.calls, []);
});

test("validateSettings: a non-refusal failure throws unavailable (the app offers saving without checking)", async () => {
  const d = setup();
  d.portal.queue("v8/login", new Error("boom " + SH.password));
  await assert.rejects(d.settings.validateSettings({ useSharedAccount: true }), (e) => e.name === "KinoError_unavailable" && !e.message.includes(SH.password));
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

test("slow portal: the shared check throws unavailable inside 17 s (cap 20) and stores nothing", async () => {
  const w = slowWorld();
  await assert.rejects(w.settings.validateSettings({ useSharedAccount: true }), (e) => e.name === "KinoError_unavailable" && !e.message.includes(SH.password));
  assert.deepEqual(w.fetches, [8_500, 8_500], "the 17 s are shared by the two hosts");
  assert.ok(w.elapsed() <= 17_000);
  assert.equal(JSON.parse(w.kino.storage.get("session")).userToken, "T0");
});

test("logout action: clearSettings lists the toggle and the kit drops nothing; the session logs out first", async () => {
  const t = setup({ toggle: true, session: sharedSession("T0") });
  t.portal.queue("v5/loginOut", {});
  t.portal.queue("v8/active", ok("T2"));
  const out = await t.settings.action("logout");
  assert.deepEqual(out.clearSettings, ["email", "password", "useSharedAccount"]);
  const drops = [];
  const kept = checkSettingsOutput("action", out, manifest, (x) => x, (d) => drops.push(d));
  assert.deepEqual(drops, []);
  assert.deepEqual(kept.clearSettings, ["email", "password", "useSharedAccount"]);
  assert.deepEqual(t.portal.paths(), ["v5/loginOut", "v8/active"]);
});

test("the useShared action is gone", async () => {
  const t = setup();
  assert.equal(await t.settings.action("useShared"), null);
  assert.deepEqual(t.portal.calls, []);
});

test("status: shared account line, within 200 chars, no pair", async () => {
  const t = setup({ toggle: true, session: sharedSession("T0") });
  const out = await t.settings.settingsStatus();
  assert.equal(out.status, "Cuenta compartida");
  assert.deepEqual(checkSettingsOutput("settingsStatus", out, manifest), out);
  assert.ok(!JSON.stringify(out).includes(SH.email));
  const own = setup({ toggle: true, config: OWN });
  own.kino.storage.set("session", JSON.stringify({ ...stored("T0"), acct: own.session.accountKey(OWN.email, OWN.password) }));
  assert.equal((await own.settings.settingsStatus()).status, `Conectado como ${OWN.email}`);
  const pending = setup({ toggle: true });
  assert.equal((await pending.settings.settingsStatus()).status, "Conectando con la cuenta compartida… Mientras tanto, sesión anónima");
});

test("manifest: the toggle follows logout, valid for the kit, hint within caps, counts 5 valued / 10 non-valued", () => {
  const checked = validateManifest(manifestText);
  assert.ok(checked.ok, checked.message);
  const keys = manifest.settings.map((s) => s.key);
  assert.equal(keys[keys.indexOf("logout") + 1], "useSharedAccount");
  assert.ok(!keys.includes("useShared"));
  const a = manifest.settings.find((s) => s.key === "useSharedAccount");
  assert.equal(a.type, "toggle");
  assert.equal(a.label, "Usar cuenta compartida");
  assert.equal(a.hint, "Muchas personas la usan; puede cerrar la sesión de otra.");
  assert.ok(a.hint.length <= 80);
  assert.ok(!a.required);
  assert.equal(a.confirm, undefined);
});

// ---- the real pair never leaks ---------------------------------------------------------------

test("the REAL shared pair never shows in messages, errors, logs or stored values", async () => {
  const logs = [];
  const seen = [];
  const run = async (portalAnswer) => {
    const t = setup({ toggle: true, shared: { email: SHARED_EMAIL, password: SHARED_PASSWORD } });
    const kino = Object.freeze({ ...t.kino, log: (m) => logs.push(String(m)) });
    const session = makeSession({ kino, portal: t.portal, clock: { now: () => 1 }, random: () => 0, shared: { email: SHARED_EMAIL, password: SHARED_PASSWORD } });
    const settings = makeSettings({ kino, session, clock: { now: () => 1 } });
    t.portal.queue("v8/login", portalAnswer);
    try { seen.push(JSON.stringify(await settings.validateSettings({ useSharedAccount: true }))); } catch (e) { seen.push(String(e.name) + e.message); }
    t.portal.queue("v8/login", portalAnswer);
    t.portal.queue("v8/active", ok("TA"));
    try { await session.ensure(); } catch (e) { seen.push(String(e.name) + e.message); }
    seen.push(JSON.stringify(await settings.settingsStatus()));
    for (const k of ["session", "sharedAccount", "refusedAcct", "region", "seeds"]) seen.push(String(t.kino.storage.get(k)));
  };
  await run(ok("T1"));
  await run(new PortalError("aaa100011", "x " + SHARED_PASSWORD));
  await run(new Error(SHARED_EMAIL + SHARED_PASSWORD));
  const all = seen.join("\n") + logs.join("\n");
  assert.ok(SHARED_EMAIL !== "" && SHARED_PASSWORD !== "", "the owner filled the pair");
  assert.ok(!all.includes(SHARED_EMAIL), "email leaked");
  assert.ok(!all.includes(SHARED_PASSWORD), "password leaked");
});

// ---- the seed pool file (dedicated `seeds` branch) --------------------------------------------

test("seeds: default URL is the seeds branch; a 600-entry answer stores 200 newest-first, three fields, < 30000 bytes", async () => {
  const { DEFAULT_SEEDS_URL } = await import("../src/session.js");
  assert.equal(DEFAULT_SEEDS_URL, "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/seeds/seeds.json");
  const hex = (n, w) => n.toString(16).padStart(w, "0");
  const list = [];
  for (let i = 0; i < 600; i++) {
    if (i === 3) list.push({ sn: "", userId: "x", userToken: "t", mintedAt: 1 });
    if (i === 5) list.push({ sn: "nosession" + i, userId: "x", userToken: "  ", mintedAt: 1 });
    list.push({ sn: hex(i, 32), userId: "9000" + hex(i, 6), userToken: hex(i * 7919, 32), mintedAt: 1_700_000_000_000 + i, extra: "x".repeat(10) });
  }
  const fetchedUrls = [];
  const kino = fakeKino({ fetch: async (url) => { fetchedUrls.push(url); return { text: () => JSON.stringify(list) }; } });
  const session = makeSession({ kino, portal: fakePortal(), clock: { now: () => 1_000_000 }, random: () => 0 });
  assert.equal(await session.refreshSeeds(), true);
  assert.deepEqual(fetchedUrls, [DEFAULT_SEEDS_URL]);
  const raw = kino.storage.get("seeds");
  const pool = JSON.parse(raw);
  assert.equal(pool.length, 200);
  const valid = list.filter((e) => e.sn && e.userToken.trim());
  assert.deepEqual(pool, valid.slice(0, 200).map((e) => ({ sn: e.sn, userId: e.userId, userToken: e.userToken })));
  for (const e of pool) assert.deepEqual(Object.keys(e), ["sn", "userId", "userToken"]);
  const bytes = Buffer.byteLength(raw, "utf8");
  assert.equal(bytes, 22201, "exact stored size");
  assert.ok(bytes < 30_000);
});
