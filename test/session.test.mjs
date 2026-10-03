import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { PortalError } from "../src/portal.js";
import { SNTOKEN_SALT, PASSWORD_SALT, FIXED_MAC } from "../src/config.js";
import { makeSession } from "../src/session.js";

const md5 = (s) => createHash("md5").update(s).digest("hex");
const SEEDS_URL = "https://seeds.test/seeds.json";
const reply = (obj) => ({ text: () => JSON.stringify(obj) });
const dead = () => new PortalError("aaa100028", "未登录");
const sess = (userToken, sn = "sn-own", userId = "u1", acct = "") => ({ userId, userToken, jwtToken: "", sn, acct });
// The key the session stores for an own account.
const acctKey = (email, password) => createHash("sha256").update(email + "\n" + md5(password + PASSWORD_SALT)).digest("hex");
const act = (userToken, userId = "u1") => ({ userId, userToken, jwtToken: "jwt" });

// Fake portal: a FIFO queue of answers per path (ok objects, thrown errors), and a record of every
// call with the stored session as it was AT THAT MOMENT.
function fakePortal(kino) {
  const queues = {};
  const calls = [];
  return {
    calls,
    paths: () => calls.map((c) => c.path),
    queue(path, ...answers) { (queues[path] ??= []).push(...answers); },
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts, stored: kino.storage.get("session") });
      await Promise.resolve(); // a real await: concurrent callers interleave here
      const q = queues[path];
      if (!q || q.length === 0) throw new Error("unscripted portal call: " + path);
      const a = q.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  };
}

function setup({ config = {}, seeds = null, stored = null, fetchAnswer = [], random = () => 0 } = {}) {
  const fetches = [];
  const timeouts = [];
  const kino = fakeKino({
    config,
    fetch: async (url, o) => {
      fetches.push(url);
      timeouts.push(o && o.timeoutMs);
      if (fetchAnswer instanceof Error) throw fetchAnswer;
      return reply(fetchAnswer);
    },
  });
  if (seeds) kino.storage.set("seeds", JSON.stringify(seeds));
  if (stored) kino.storage.set("session", JSON.stringify(stored));
  const portal = fakePortal(kino);
  const clock = { t: 1_000_000, now() { return this.t; } };
  const session = makeSession({ kino, portal, clock, seedsUrl: SEEDS_URL, random });
  const read = () => JSON.parse(kino.storage.get("session"));
  return { kino, portal, clock, session, fetches, timeouts, read };
}

const seed = (n) => ({ sn: "seed-" + n, userId: "su" + n, userToken: "st" + n });
const account = { email: "a@b.test", password: "pw1" };

// ---- mint / reactivate -----------------------------------------------------------------------

test("mint saves the sn (empty token) BEFORE v8/active, and activates with that sn", async () => {
  const { portal, session, read } = setup();
  portal.queue("v3/snToken", { snToken: "TOK" });
  portal.queue("v8/active", act("T1"));
  await session.ensure();
  assert.deepEqual(portal.paths(), ["v3/snToken", "v8/active"]);
  const sn = md5("TOK" + SNTOKEN_SALT);
  const active = portal.calls[1];
  assert.equal(active.opts.sn, sn);
  assert.equal(active.opts.baseFields, false);
  assert.equal(active.bean.snToken, "TOK");
  assert.equal(active.bean.macAddr, FIXED_MAC);
  assert.deepEqual(JSON.parse(active.stored), { userId: "", userToken: "", jwtToken: "", sn, acct: "" });
  assert.deepEqual(read(), { userId: "u1", userToken: "T1", jwtToken: "jwt", sn, acct: "" });
});

test("sn comes from the response when present, lowercased; else md5(snToken+salt) lowercase", async () => {
  const a = setup();
  a.portal.queue("v3/snToken", { snToken: "TOK", sn: "ABCDEF" });
  a.portal.queue("v8/active", act("T1"));
  await a.session.ensure();
  assert.equal(a.read().sn, "abcdef");
  assert.equal(a.portal.calls[1].opts.sn, "abcdef");
});

test("the snToken request is unauthenticated and carries a randomized fingerprint", async () => {
  const a = setup();
  a.portal.queue("v3/snToken", { snToken: "T" });
  a.portal.queue("v8/active", act("T1"));
  await a.session.ensure();
  const b = setup();
  b.portal.queue("v3/snToken", { snToken: "T" });
  b.portal.queue("v8/active", act("T1"));
  await b.session.ensure();
  assert.equal(a.portal.calls[0].opts.baseFields, false);
  const fa = a.portal.calls[0].bean, fb = b.portal.calls[0].bean;
  assert.match(fa.androidId, /^[0-9a-f]{16}$/);
  assert.match(fa.etheMac, /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/);
  assert.notEqual(fa.androidId, fb.androidId);
  assert.equal(fa.verId, "");
});

test("reactivating a stored sn (v8/active, snToken empty) succeeds without minting", async () => {
  const { portal, session, read } = setup({ stored: sess("", "sn-stored") });
  portal.queue("v8/active", act("T9"));
  await session.ensure();
  assert.deepEqual(portal.paths(), ["v8/active"]);
  assert.equal(portal.calls[0].bean.snToken, "");
  assert.equal(portal.calls[0].opts.sn, "sn-stored");
  assert.deepEqual(read(), { userId: "u1", userToken: "T9", jwtToken: "jwt", sn: "sn-stored", acct: "" });
});

test("only aaa100080 / aaa100082 authorize minting a new device", async () => {
  for (const code of ["aaa100080", "aaa100082"]) {
    const { portal, session, read } = setup({ stored: sess("", "old-sn") });
    portal.queue("v8/active", new PortalError(code, "bad sn"));
    portal.queue("v3/snToken", { snToken: "NEW" });
    portal.queue("v8/active", act("T2"));
    await session.ensure();
    assert.deepEqual(portal.paths(), ["v8/active", "v3/snToken", "v8/active"], code);
    assert.equal(read().sn, md5("NEW" + SNTOKEN_SALT));
    assert.equal(read().userToken, "T2");
  }
});

test("any other reactivation failure returns as-is: no new device, stored sn kept", async () => {
  const { portal, session, read, kino } = setup({ stored: sess("", "keep-sn") });
  portal.queue("v8/active", new PortalError("aaa100099", "other"));
  await assert.rejects(session.ensure(), (e) => e.code === "unavailable");
  assert.deepEqual(portal.paths(), ["v8/active"]);
  assert.equal(read().sn, "keep-sn");
  const net = setup({ stored: sess("", "keep-sn") });
  net.portal.queue("v8/active", net.kino.error("unavailable", "red caída"));
  await assert.rejects(net.session.ensure(), (e) => e.code === "unavailable");
  assert.deepEqual(net.portal.paths(), ["v8/active"]);
  void kino;
});

test("never invents an sn: a snToken answer without snToken fails and saves nothing", async () => {
  const { portal, session, kino } = setup();
  portal.queue("v3/snToken", { sn: "x" });
  await assert.rejects(session.ensure(), (e) => e.code === "unavailable");
  assert.equal(kino.storage.get("session"), null);
  assert.deepEqual(portal.paths(), ["v3/snToken"]);
});

test("an activation without userToken is an error (active_sin_token), not a session", async () => {
  const { portal, session, read } = setup();
  portal.queue("v3/snToken", { snToken: "T" });
  portal.queue("v8/active", { userId: "u" });
  await assert.rejects(session.ensure(), (e) => e.code === "unavailable");
  assert.equal(read().userToken, "");
});

test("two concurrent ensure() with no session mint exactly once (Review Focus 3)", async () => {
  const { portal, session, read } = setup();
  portal.queue("v3/snToken", { snToken: "ONE" });
  portal.queue("v8/active", act("T1"));
  await Promise.all([session.ensure(), session.ensure(), session.ensure()]);
  assert.deepEqual(portal.paths(), ["v3/snToken", "v8/active"]);
  assert.equal(read().userToken, "T1");
});

test("ensure is a no-op with a token", async () => {
  const { portal, session } = setup({ stored: sess("T0") });
  await session.ensure();
  assert.deepEqual(portal.paths(), []);
});

test("a failed direct mint with a seed pool falls back to a pool seed", async () => {
  const { portal, session, read } = setup({ seeds: [seed(1), seed(2)], random: () => 0.99 });
  portal.queue("v3/snToken", new PortalError("portal100024", "geo"));
  await session.ensure();
  assert.deepEqual(read(), { userId: "su2", userToken: "st2", jwtToken: "", sn: "seed-2", acct: "" });
});

// ---- account ---------------------------------------------------------------------------------

test("an account whose login fails falls back to anonymous in ensure", async () => {
  const { portal, session, read } = setup({ config: account, stored: sess("", "sn-x") });
  portal.queue("v8/login", new PortalError("aaa100099", "bad creds"));
  portal.queue("v8/active", act("TA"));
  await session.ensure();
  assert.deepEqual(portal.paths(), ["v8/login", "v8/active"]);
  assert.equal(read().userToken, "TA");
});

test("ensure with an account logs in (hashed password) and does not activate", async () => {
  const { portal, session, read } = setup({ config: account, stored: sess("", "sn-x") });
  portal.queue("v8/login", act("TL"));
  await session.ensure();
  assert.deepEqual(portal.paths(), ["v8/login"]);
  const { bean, opts } = portal.calls[0];
  assert.equal(bean.userName, account.email);
  assert.equal(bean.password, md5(account.password + PASSWORD_SALT));
  assert.equal(bean.accountType, "2");
  assert.equal(opts.baseFields, false);
  assert.equal(read().sn, "sn-x");
});

test("login does NOT re-activate, saves the session with the EXISTING sn", async () => {
  const { portal, session, read } = setup({ stored: sess("T-anon", "sn-keep") });
  portal.queue("v8/login", act("TL", "ulogin"));
  await session.login("e@x.test", "secret");
  assert.deepEqual(portal.paths(), ["v8/login"]);
  assert.deepEqual(read(), { userId: "ulogin", userToken: "TL", jwtToken: "jwt", sn: "sn-keep", acct: acctKey("e@x.test", "secret") });
});

test("login without userToken fails and leaves the session alone", async () => {
  const { portal, session, read } = setup({ stored: sess("T-anon", "sn-keep") });
  portal.queue("v8/login", { userId: "u" });
  await assert.rejects(session.login("e@x.test", "secret"), (e) => e.code === "auth_required");
  assert.equal(read().userToken, "T-anon");
});

test("login rejected by the portal says the credentials are invalid", async () => {
  const { portal, session } = setup({ stored: sess("T", "sn") });
  portal.queue("v8/login", new PortalError("aaa100005", "wrong"));
  await assert.rejects(session.login("e@x.test", "secret"),
    (e) => e.code === "auth_required" && e.message === "Credenciales de Xuper inválidas");
});

test("logout: loginOut result ignored, token dropped, sn kept, back to anonymous", async () => {
  const { portal, session, read } = setup({ stored: sess("T-acc", "sn-keep", "uacc") });
  portal.queue("v5/loginOut", new PortalError("aaa100099", "ignored"));
  portal.queue("v8/active", act("T-anon"));
  await session.logout();
  assert.deepEqual(portal.paths(), ["v5/loginOut", "v8/active"]);
  assert.deepEqual(portal.calls[0].bean, { userId: "uacc", userToken: "T-acc" });
  assert.equal(portal.calls[0].opts.baseFields, false);
  assert.deepEqual(JSON.parse(portal.calls[1].stored), sess("", "sn-keep", ""));
  assert.deepEqual(read(), { userId: "u1", userToken: "T-anon", jwtToken: "jwt", sn: "sn-keep", acct: "" });
});

// ---- kind ------------------------------------------------------------------------------------

test("kind(): none / own / seed (iff sn in the live pool) / account", async () => {
  const { session, kino } = setup();
  assert.equal(session.kind(), "none");
  kino.storage.set("session", JSON.stringify(sess("T", "sn-own")));
  assert.equal(session.kind(), "own");
  kino.storage.set("seeds", JSON.stringify([seed(1), { ...seed(2), sn: "sn-own" }]));
  assert.equal(session.kind(), "seed");
  kino.storage.set("seeds", JSON.stringify([seed(1)]));
  assert.equal(session.kind(), "own");
  const acc = setup({ config: account, stored: sess("T", "seed-1", "u1", acctKey(account.email, account.password)), seeds: [seed(1)] });
  assert.equal(acc.session.kind(), "account");
});

test("current() mirrors the stored session", async () => {
  const { session } = setup({ stored: sess("T", "s", "u") });
  assert.deepEqual(session.current(), { userId: "u", userToken: "T", jwtToken: "", sn: "s", acct: "" });
  assert.deepEqual(setup().session.current(), { userId: "", userToken: "", jwtToken: "", sn: "", acct: "" });
});

// ---- withValidSession ------------------------------------------------------------------------

test("a block that works runs once and its value comes back", async () => {
  const { portal, session } = setup({ stored: sess("T1") });
  assert.equal(await session.withValidSession(async ({ userId, userToken }) => userId + userToken), "u1T1");
  assert.deepEqual(portal.paths(), []);
});

test("a dead token reauths ONCE and reruns with the NEW token (Review Focus 4)", async () => {
  const { portal, session } = setup({ stored: sess("T1", "sn-a") });
  portal.queue("v8/active", act("T2"));
  const seen = [];
  const out = await session.withValidSession(async ({ userToken }) => {
    seen.push(userToken);
    if (userToken === "T1") throw dead();
    return "ok";
  });
  assert.equal(out, "ok");
  assert.deepEqual(seen, ["T1", "T2"]);
  assert.deepEqual(portal.paths(), ["v8/active"]);
  assert.equal(portal.calls[0].bean.snToken, "");
});

test("reauth is any portal error, not only the session codes", async () => {
  const { portal, session } = setup({ stored: sess("T1") });
  portal.queue("v8/active", act("T2"));
  const out = await session.withValidSession(async ({ userToken }) => {
    if (userToken === "T1") throw new PortalError("aaa100099", "他处登录");
    return userToken;
  });
  assert.equal(out, "T2");
});

test("a non-portal failure (network) does not reauth and propagates", async () => {
  const { portal, session, kino } = setup({ stored: sess("T1") });
  await assert.rejects(session.withValidSession(async () => { throw kino.error("unavailable", "caída"); }),
    (e) => e.code === "unavailable");
  assert.deepEqual(portal.paths(), []);
});

test("two calls dead on the same token reauth once (single-flight on the stale token)", async () => {
  const { portal, session } = setup({ stored: sess("T1") });
  portal.queue("v8/active", act("T2"));
  const block = async ({ userToken }) => { if (userToken === "T1") throw dead(); return userToken; };
  const out = await Promise.all([session.withValidSession(block), session.withValidSession(block)]);
  assert.deepEqual(out, ["T2", "T2"]);
  assert.deepEqual(portal.paths(), ["v8/active"]);
});

test("reauth with an account logs in again instead of re-activating", async () => {
  const { portal, session } = setup({ config: account, stored: sess("T1", "sn-a") });
  portal.queue("v8/login", act("T2"));
  const out = await session.withValidSession(async ({ userToken }) => {
    if (userToken === "T1") throw dead();
    return userToken;
  });
  assert.equal(out, "T2");
  assert.deepEqual(portal.paths(), ["v8/login"]);
});

test("geo-blocked anonymous: marks the region, swaps to a pool seed and reruns", async () => {
  const { portal, session, read } = setup({
    stored: sess("T1", "sn-own"), seeds: [seed(1), seed(2), seed(3)], random: () => 0.5,
  });
  const seen = [];
  const out = await session.withValidSession(async ({ userToken }) => {
    seen.push(userToken);
    if (userToken === "T1") throw new PortalError("portal100024", "区域");
    return "ok";
  });
  assert.equal(out, "ok");
  assert.deepEqual(seen, ["T1", "st2"]);
  assert.equal(read().sn, "seed-2");
  assert.equal(session.regionBlocked(), true);
  assert.deepEqual(portal.paths(), []);
});

test("geo-blocked WITH an account does not swap seeds, but marks the region", async () => {
  const { portal, session, read } = setup({
    config: account, stored: sess("T1", "sn-acc"), seeds: [seed(1)],
  });
  portal.queue("v8/login", act("T2"));
  await assert.rejects(
    session.withValidSession(async () => { throw new PortalError("portal100024", "区域"); }),
    (e) => e.code === "geo_blocked" && e.message === "Este contenido no está disponible en tu región");
  assert.equal(read().sn, "sn-acc");
  assert.equal(session.regionBlocked(), true);
});

test("dead seed: three rescue rounds (refresh with cooldown + switch + rerun), then seedsExhausted", async () => {
  const pool = [seed(1), seed(2)];
  const { portal, session, fetches } = setup({
    stored: sess("T1", "sn-own"), seeds: pool, fetchAnswer: pool, random: () => 0,
  });
  portal.queue("v8/active", new PortalError("aaa100099", "x")); // reauth: reactivation fails -> pool seed
  let blockRuns = 0;
  await assert.rejects(
    session.withValidSession(async () => { blockRuns++; throw dead(); }),
    (e) => e.code === "auth_required");
  // 1 first + 1 after reauth + 3 rescue rounds; never an infinite loop.
  assert.equal(blockRuns, 5);
  assert.equal(session.seedsExhausted(), true);
  assert.equal(fetches.length, 1, "10 s cooldown collapses the three refreshes into one fetch");
  assert.equal(session.regionBlocked(), true);
});

test("seed rescue: the first non-session-dead result wins and clears seedsExhausted", async () => {
  const pool = [seed(1), seed(2)];
  const { portal, session } = setup({
    stored: sess("T1", "sn-own"), seeds: pool, fetchAnswer: pool, random: () => 0,
  });
  portal.queue("v8/active", new PortalError("aaa100099", "x"));
  let runs = 0;
  const out = await session.withValidSession(async () => {
    runs++;
    if (runs <= 3) throw dead();
    return "alive";
  });
  assert.equal(out, "alive");
  assert.equal(runs, 4);
  assert.equal(session.seedsExhausted(), false);
});

test("a rescue retry that ends in an error that is not 'dead' clears seedsExhausted too", async () => {
  const pool = [seed(1), seed(2)];
  const { portal, session } = setup({ stored: sess("T1", "sn-own"), seeds: pool, fetchAnswer: pool, random: () => 0 });
  portal.queue("v8/active", new PortalError("aaa100099", "x"), new PortalError("aaa100099", "x"));
  await assert.rejects(session.withValidSession(async () => { throw dead(); }), (e) => e.code === "auth_required");
  assert.equal(session.seedsExhausted(), true, "every round was dead: exhausted");
  let runs = 0;
  await assert.rejects(
    session.withValidSession(async () => {
      runs++;
      if (runs <= 2) throw dead();
      throw new PortalError("portal100006", "剧集不存在");
    }),
    (e) => e.code === "not_found");
  assert.equal(runs, 3);
  assert.equal(session.seedsExhausted(), false, "the retry reached a live session");
});

test("geo-blocked anonymous with an EMPTY pool: one bounded pool download, one reauth, then the mapped geo error", async () => {
  const { portal, session, fetches } = setup({ stored: sess("T1", "sn-own") });
  portal.queue("v8/active", act("T2"));
  let runs = 0;
  await assert.rejects(
    session.withValidSession(async () => { runs++; throw new PortalError("portal100024", "区域"); }),
    (e) => e.code === "geo_blocked" && e.message === "Este contenido no está disponible en tu región");
  assert.equal(runs, 2, "first try + the one after the reauth (the download brought no seed)");
  assert.deepEqual(portal.paths(), ["v8/active"]);
  // A fresh install in a blocked region has no other way out (final review I2): the pool is asked for once.
  assert.equal(fetches.length, 1, "the empty pool is downloaded on the geo block");
  assert.equal(session.regionBlocked(), true, "the reactivation did not clear the flag");
  assert.equal(session.seedsExhausted(), false);
});

test("a half session (sn saved, empty token) after a failed mint is completed by the next ensure, without a second device", async () => {
  const { portal, session, read } = setup();
  portal.queue("v3/snToken", { snToken: "TOK" });
  portal.queue("v8/active", new PortalError("portal100099", "down"));
  await assert.rejects(session.ensure(), (e) => e.code === "unavailable");
  const sn = md5("TOK" + SNTOKEN_SALT);
  assert.deepEqual(read(), { userId: "", userToken: "", jwtToken: "", sn, acct: "" });
  portal.queue("v8/active", act("T5"));
  await session.ensure();
  assert.deepEqual(portal.paths(), ["v3/snToken", "v8/active", "v8/active"], "reactivated the saved sn: no second mint");
  assert.equal(portal.calls[2].opts.sn, sn);
  assert.deepEqual(read(), { userId: "u1", userToken: "T5", jwtToken: "jwt", sn, acct: "" });
});

test("rescue never runs for an account", async () => {
  const { portal, session, fetches } = setup({ config: account, stored: sess("T1"), seeds: [seed(1)] });
  portal.queue("v8/login", act("T2"));
  let runs = 0;
  await assert.rejects(session.withValidSession(async () => { runs++; throw dead(); }));
  assert.equal(runs, 2);
  assert.equal(fetches.length, 0);
  assert.equal(session.seedsExhausted(), false);
});

test("a surviving non-dead error is mapped to a Spanish kino error", async () => {
  const { session, portal } = setup({ stored: sess("T1") });
  portal.queue("v8/active", act("T2"));
  await assert.rejects(
    session.withValidSession(async () => { throw new PortalError("portal100006", "剧集不存在"); }),
    (e) => e.code === "not_found" && e.message === "No se encontró en Xuper");
});

// ---- region flag -----------------------------------------------------------------------------

test("regionBlocked: cleared only by a content call that answered on the device's OWN session", async () => {
  const { session, portal, kino } = setup({ stored: sess("", "sn-r"), seeds: [seed(1)] });
  kino.storage.set("region", JSON.stringify({ blocked: true }));
  assert.equal(session.regionBlocked(), true);
  // direct fails -> pool seed: still blocked, and a content answer on the seed proves nothing
  portal.queue("v8/active", new PortalError("aaa100099", "x"));
  await session.ensure();
  assert.equal(session.regionBlocked(), true);
  await session.withValidSession(async () => "ok");
  assert.equal(session.regionBlocked(), true);
  // a direct reactivation alone proves nothing either (a blocked region activates fine)
  kino.storage.set("session", JSON.stringify(sess("", "sn-r")));
  portal.queue("v8/active", act("T"));
  await session.ensure();
  assert.equal(session.regionBlocked(), true);
  // content answered on the own session -> cleared
  await session.withValidSession(async () => "ok");
  assert.equal(session.regionBlocked(), false);
});

test("regionBlocked is false by default and the flag is stored without ttl", async () => {
  const { session, kino } = setup({ stored: sess("T1") });
  assert.equal(session.regionBlocked(), false);
  await assert.rejects(session.withValidSession(async () => { throw new PortalError("portal100024", "g"); }));
  assert.deepEqual(JSON.parse(kino.storage.get("region")), { blocked: true });
});

// ---- switchSeed ------------------------------------------------------------------------------

test("switchSeed: refused for an account, and with no other seed", async () => {
  const a = setup({ config: account, stored: sess("T", "sn"), seeds: [seed(1)] });
  assert.equal((await a.session.switchSeed()).result, "account_linked");
  const b = setup({ stored: sess("T", "seed-1"), seeds: [seed(1)] });
  assert.equal((await b.session.switchSeed()).result, "no_other_seed");
  assert.deepEqual(b.portal.paths(), []);
});

test("switchSeed probes other seeds for real; the first token wins and is saved", async () => {
  const { portal, session, read } = setup({
    stored: sess("T-old", "seed-1"), seeds: [seed(1), seed(2), seed(3)], random: () => 0,
  });
  portal.queue("v8/active", new PortalError("aaa100099", "busy"), act("T-new", "unew"));
  const res = await session.switchSeed();
  assert.deepEqual(res, { result: "ok", tries: 2 });
  assert.equal(portal.calls.length, 2);
  for (const c of portal.calls) {
    assert.equal(c.bean.snToken, "");
    assert.notEqual(c.opts.sn, "seed-1");
    assert.equal(c.opts.baseFields, false);
  }
  assert.equal(read().userToken, "T-new");
  assert.equal(read().sn, portal.calls[1].opts.sn);
  assert.equal(read().userId, "unew");
});

test("switchSeed gives up after 5 probes and leaves the session untouched", async () => {
  const seeds = Array.from({ length: 8 }, (_, i) => seed(i + 1));
  const { portal, session, read } = setup({ stored: sess("T-old", "mine"), seeds });
  portal.queue("v8/active", ...Array.from({ length: 8 }, () => new PortalError("aaa100099", "x")));
  assert.deepEqual(await session.switchSeed(), { result: "all_failed", tries: 5 });
  assert.equal(portal.calls.length, 5);
  assert.equal(read().userToken, "T-old");
  assert.equal(new Set(portal.calls.map((c) => c.opts.sn)).size, 5);
});

// ---- seed pool -------------------------------------------------------------------------------

test("seedPool reads the stored pool live; junk is ignored", async () => {
  const { session, kino } = setup();
  assert.deepEqual(session.seedPool(), []);
  kino.storage.set("seeds", JSON.stringify([seed(1)]));
  assert.deepEqual(session.seedPool(), [seed(1)]);
  kino.storage.set("seeds", "not json");
  assert.deepEqual(session.seedPool(), []);
});

test("refreshSeeds fetches seedsUrl, drops entries without sn or userToken", async () => {
  const answer = [seed(1), { sn: "", userToken: "t" }, { sn: "s", userToken: "" }, { userToken: "t" }, null,
    { sn: "seed-9", userToken: "st9", userId: 7, extra: "dropped" }];
  const { session, fetches } = setup({ fetchAnswer: answer });
  assert.equal(await session.refreshSeeds(), true);
  assert.deepEqual(fetches, [SEEDS_URL]);
  assert.deepEqual(session.seedPool(), [seed(1), { sn: "seed-9", userId: "7", userToken: "st9" }]);
});

test("refreshSeeds replaces the pool ONLY with a non-empty answer", async () => {
  const empty = setup({ seeds: [seed(1)], fetchAnswer: [] });
  assert.equal(await empty.session.refreshSeeds(), true); // old pool still available
  assert.deepEqual(empty.session.seedPool(), [seed(1)]);
  const junk = setup({ seeds: [seed(1)], fetchAnswer: [{ sn: "", userToken: "" }] });
  await junk.session.refreshSeeds();
  assert.deepEqual(junk.session.seedPool(), [seed(1)]);
  const failing = setup({ seeds: [seed(1)], fetchAnswer: new Error("down") });
  assert.equal(await failing.session.refreshSeeds(), true);
  assert.deepEqual(failing.session.seedPool(), [seed(1)]);
  const none = setup({ fetchAnswer: new Error("down") });
  assert.equal(await none.session.refreshSeeds(), false);
});

test("refreshSeeds: 10 s single-flight cooldown, even for concurrent callers", async () => {
  const { session, fetches, clock } = setup({ fetchAnswer: [seed(1)] });
  await Promise.all([session.refreshSeeds(), session.refreshSeeds(), session.refreshSeeds()]);
  assert.equal(fetches.length, 1);
  clock.t += 9_999;
  await session.refreshSeeds();
  assert.equal(fetches.length, 1);
  clock.t += 1;
  await session.refreshSeeds();
  assert.equal(fetches.length, 2);
});

test("periodic refresh: only when region-blocked without an account, and at most every 3 h", async () => {
  const a = setup({ fetchAnswer: [seed(1)] });
  await a.session.refreshSeeds({ periodic: true });
  assert.equal(a.fetches.length, 0, "not region blocked: native never re-downloads");
  const b = setup({ fetchAnswer: [seed(1)], config: account });
  b.kino.storage.set("region", JSON.stringify({ blocked: true }));
  await b.session.refreshSeeds({ periodic: true });
  assert.equal(b.fetches.length, 0, "account: no seeds");
  const c = setup({ fetchAnswer: [seed(1)] });
  c.kino.storage.set("region", JSON.stringify({ blocked: true }));
  await c.session.refreshSeeds({ periodic: true });
  assert.equal(c.fetches.length, 1);
  c.clock.t += 3 * 3600_000 - 1;
  await c.session.refreshSeeds({ periodic: true });
  assert.equal(c.fetches.length, 1);
  c.clock.t += 1;
  await c.session.refreshSeeds({ periodic: true });
  assert.equal(c.fetches.length, 2);
});

test("periodic refresh: the 'Actualizar semillas automáticamente' switch gates it (default on)", async () => {
  const blocked = (w) => w.kino.storage.set("region", JSON.stringify({ blocked: true }));
  const off = setup({ fetchAnswer: [seed(1)], config: { autoRefreshSeeds: false } });
  blocked(off);
  await off.session.refreshSeeds({ periodic: true });
  assert.equal(off.fetches.length, 0, "switch off: no periodic download");
  assert.equal(off.session.seedPool().length, 0);
  await off.session.refreshSeeds(); // the manual button is not gated
  assert.equal(off.fetches.length, 1);

  const on = setup({ fetchAnswer: [seed(1)], config: { autoRefreshSeeds: true } });
  blocked(on);
  await on.session.refreshSeeds({ periodic: true });
  assert.equal(on.fetches.length, 1, "switch on + region blocked + no account");

  const acc = setup({ fetchAnswer: [seed(1)], config: { ...account, autoRefreshSeeds: true } });
  blocked(acc);
  await acc.session.refreshSeeds({ periodic: true });
  assert.equal(acc.fetches.length, 0, "an account never uses seeds");
});

test("ensure(): the periodic refresh runs once per 3 h, bounded, only with no token / blocked / no account / switch on", async () => {
  const blocked = (w) => w.kino.storage.set("region", JSON.stringify({ blocked: true }));
  const mintOk = (w) => { w.portal.queue("v3/snToken", { snToken: "T" }); w.portal.queue("v8/active", act("T1")); };
  // token present: returns first, no refresh
  let w = setup({ fetchAnswer: [seed(1)], stored: sess("tok") });
  blocked(w);
  await w.session.ensure();
  assert.equal(w.fetches.length, 0);
  // blocked + no account + on + stale: exactly one fetch with a 5 s timeout
  w = setup({ fetchAnswer: [seed(1)] });
  blocked(w); mintOk(w);
  await w.session.ensure();
  assert.deepEqual(w.timeouts, [5000]);
  assert.equal(w.session.current().userToken, "T1", "ensure result unaffected");
  // fresh (< 3 h): none
  w.kino.storage.set("session", JSON.stringify({ ...sess(""), userToken: "" }));
  w.clock.t += 3 * 3600_000 - 1; mintOk(w);
  await w.session.ensure();
  assert.equal(w.fetches.length, 1);
  // switch off / account: none
  for (const config of [{ autoRefreshSeeds: false }, account]) {
    w = setup({ fetchAnswer: [seed(1)], config }); blocked(w); mintOk(w); w.portal.queue("v8/login", act("T2"));
    await w.session.ensure();
    assert.equal(w.fetches.length, 0);
  }
});

test("ensure(): a failing seeds download is swallowed and seedsAt still advances (no retry per call)", async () => {
  const w = setup({ fetchAnswer: new Error("offline") });
  w.kino.storage.set("region", JSON.stringify({ blocked: true }));
  w.portal.queue("v3/snToken", { snToken: "T" }); w.portal.queue("v8/active", act("T1"));
  await w.session.ensure();
  assert.equal(w.fetches.length, 1);
  assert.equal(JSON.parse(w.kino.storage.get("seedsAt")), w.clock.t);
  w.kino.storage.set("session", JSON.stringify(sess("")));
  w.clock.t += 10_000;
  w.portal.queue("v8/active", act("T2"));
  await w.session.ensure();
  assert.equal(w.fetches.length, 1, "no retry inside the 3 h window");
});

test("a 50-seed pool stored stays well under the 256 KB storage limit (< 12 KB)", async () => {
  const big = Array.from({ length: 50 }, (_, i) => ({
    sn: md5("s" + i), userId: String(1000000 + i), userToken: md5("t" + i),
  }));
  const { session, kino } = setup({ fetchAnswer: big });
  await session.refreshSeeds();
  assert.equal(session.seedPool().length, 50);
  assert.ok(kino.storage.get("seeds").length < 12 * 1024, String(kino.storage.get("seeds").length));
});

test("no Date.now / Math.random: the injected clock and random drive everything", async () => {
  const dn = Date.now, mr = Math.random;
  // The kit itself reads Date.now (storage expiry): only a call coming from session.js is a failure.
  const guard = (orig, name) => (...a) => {
    if ((new Error().stack.split("\n")[2] || "").includes("src/session.js")) throw new Error(name + " used by session.js");
    return orig(...a);
  };
  Date.now = guard(dn, "Date.now");
  Math.random = guard(mr, "Math.random");
  try {
    const { portal, session } = setup({ seeds: [seed(1), seed(2)] });
    portal.queue("v3/snToken", { snToken: "T" });
    portal.queue("v8/active", act("T1"));
    await session.ensure();
    await session.refreshSeeds().catch(() => {});
  } finally { Date.now = dn; Math.random = mr; }
});
