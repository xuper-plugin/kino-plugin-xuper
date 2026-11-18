// Seeds (seed design §9 tests 1–20, owner decisions D1 = A′ … D6): the device's own anonymous guest session is the
// primary; GET /seed is asked only when it cannot be created or kept for a reason a seed gets around, under every
// limit (backoffs, caps, single flight, lease). A fake backend whose /seed POPS (one-use) and a real-3DES fake portal
// (test/helpers/seed-world.mjs) on a virtual clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, poolSeed, portalError, T0, MIN, BEARER, KEY } from "./helpers/seed-world.mjs";
import { res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { beginCall, callFor } = await import("../src/flight.js");
const { clearBearer, fetchSeed } = await import("../src/api.js");
const xuper = xmod.default;

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

const SN = "0f1e2d3c4b5a69788796a5b4c3d2e1f0";   // a stored device sn

/** A fresh device: the world, a cold runtime, the Bearer in storage only. */
async function device(opts = {}) {
  const w = await world(opts);
  await clearBearer();
  if (opts.bearer !== false) w.kino.storage.set("o2:bearer", BEARER);
  xmod._resetSession();
  seeds._newRuntime();
  return w;
}
/** A new plugin call named like the export that starts it. */
function call(name) { beginCall(); callFor(name); }
const seedBeans = (w) => w.portal.filter((r) => String(r.bean.userToken).startsWith("SEEDTOK"));
const rejection = async (p) => { try { await p; } catch (e) { return e; } assert.fail("expected a rejection"); };

// ── 1–4: no seed when the own session works, or when a seed cannot help ──

test("1. the own session works: listing, open and the VOD fallback, warm and cold (o2:xsess), make 0 GET /seed", async () => {
  const w = await device({ pool: [poolSeed(1)] });
  call("liveCategories"); assert.equal((await xuper.categories({})).length, 2);
  call("liveChannels"); assert.equal((await xuper.channels("31", {})).length, 1);
  call("resolve"); assert.ok((await xuper.resolve("ch31")).url);
  call("resolve");
  const hit = await xmod.searchVod("Pelicula Uno");
  assert.equal(hit.contentId, "m1");
  assert.ok((await xmod.resolveVod("m1", "movie")).url.endsWith("/vod/t1_media.mp4"));
  xmod._resetSession();                                    // a cold runtime: the own session comes from o2:xsess
  call("resolve"); assert.ok((await xuper.resolve("ch31")).url);
  call("liveChannels"); await xuper.channels("40", {});
  assert.equal(w.gets, 0, "no GET /seed");
  assert.equal(w.count("v3/snToken"), 1);
  assert.equal(w.count("v8/active"), 1, "one activation, reused across runtimes");
  assert.equal(w.count("v8/login"), 0, "never the shared account");
  assert.equal(w.held(), null);
  assert.ok(w.portal.filter((r) => r.path !== "v3/snToken" && r.path !== "v8/active").every((r) => r.bean.userToken === "OWNTOK-SECRET-1"));
});

test("2. a transport error at the activation asks no seed (a seed goes to the same hosts)", async () => {
  const w = await device({ sn: SN, pool: [poolSeed(1)], handlers: { "v8/active": () => new Error("socket closed") } });
  call("resolve");
  await assert.rejects(() => xuper.resolve("ch1"), /socket closed/);
  assert.equal(w.gets, 0);
  assert.equal(w.count("v8/active"), 2, "both hosts tried, nothing else");
});

test("3. portal200001 at v3/snToken asks no seed; the person reads that it comes back by itself", async () => {
  const w = await device({ pool: [poolSeed(1)], handlers: { "v3/snToken": () => portalError("portal200001", "版本已停止使用") } });
  call("liveChannels");
  const e = await rejection(xuper.channels("31", {}));
  assert.equal(e.code, "portal200001");
  assert.match(e.userMessage, /Xuper no está aceptando conexiones por ahora\. Suele volver solo en unas horas/);
  assert.equal(w.gets, 0);
  kino.lang = "en";
  call("liveChannels");
  assert.match((await rejection(xuper.channels("31", {}))).userMessage, /It usually comes back by itself within a few hours/);
  kino.lang = "es";
  // on content too
  const w2 = await device({ pool: [poolSeed(1)], handlers: { "v4/startPlayLive": () => portalError("portal200001") } });
  call("resolve");
  assert.equal((await rejection(xuper.resolve("ch1"))).code, "portal200001");
  assert.equal(w2.gets, 0);
});

test("4. an unknown code at the activation or on content asks no seed", async () => {
  const w = await device({ sn: SN, pool: [poolSeed(1)], handlers: { "v8/active": () => portalError("aaa999999") } });
  call("liveCategories");
  assert.equal((await rejection(xuper.categories({}))).code, "aaa999999");
  assert.equal(w.gets, 0);
  const w2 = await device({ pool: [poolSeed(1)], handlers: { getNextColumns: () => portalError("aaa555555") } });
  call("liveCategories");
  assert.equal((await rejection(xuper.categories({}))).code, "aaa555555");
  assert.equal(w2.gets, 0);
});

// ── 5–8: the seed-fixable cases ──

test("5. geo on content: exactly 1 GET; the retry carries the seed's sn, userId and userToken, never its jwtToken; o2:xseed has a TTL and no jwtToken", async () => {
  const s1 = poolSeed(1, 5 * 3600, { exp: 1, customer: "M-2" });
  const w = await device({ geo: "own", pool: [s1, poolSeed(2)] });
  call("liveCategories");
  assert.equal((await xuper.categories({})).length, 2);
  assert.equal(w.gets, 1);
  const retry = w.portal.filter((r) => r.path === "getNextColumns").pop().bean;
  assert.equal(retry.sn, s1.seed.sn);
  assert.equal(retry.userId, s1.seed.userId);
  assert.equal(retry.userToken, s1.seed.userToken);
  assert.ok(w.portal.every((r) => !JSON.stringify(r.bean).includes("SEEDJWT")), "the jwtToken is never sent");
  const held = w.held();
  assert.deepEqual(Object.keys(held).sort(), ["expiresAt", "gotAt", "lifeMs", "mintedAt", "sn", "userId", "userToken", "v"]);
  assert.equal(held.lifeMs, 5 * 3600 * 1000);
  assert.equal(w.ttl.get("o2:xseed"), 5 * 3600 * 1000, "Kino drops it when the seed dies");
  assert.equal(w.state().need, "geo");
  assert.ok(w.logs.some((l) => /^seed:get ok life_min=300$/.test(l)));
});

test("6. the portal refusing this device a guest session asks 1 GET: geo at activation, no snToken, aaa100080 on a brand-new device", async () => {
  const cases = [
    { sn: SN, handlers: { "v8/active": () => portalError("portal100024") } },
    { handlers: { "v3/snToken": () => ({ snToken: "", sn: "" }) } },
    { handlers: { "v8/active": () => portalError("aaa100080") } },
    { sn: SN, handlers: { "v8/active": () => portalError("aaa100082") } },   // stored device refused → new device refused too
    { handlers: { "v8/active": () => ({ userId: "x", userToken: "" }) } },  // activation without a token
  ];
  for (const c of cases) {
    const w = await device({ ...c, pool: [poolSeed(1)] });
    call("liveCategories");
    assert.equal((await xuper.categories({})).length, 2, JSON.stringify(c.handlers && Object.keys(c.handlers)));
    assert.equal(w.gets, 1);
    assert.equal(w.state().need, c.sn && c.handlers["v8/active"]().returnCode === "portal100024" ? "geo" : "mint");
  }
});

test("7. own session dead after a renewal on a listing: 1 GET; aaa100028 on startPlayLive after a fresh renewal: 0 GET, ONE shared retry (A′)", async () => {
  const dead = (b) => (String(b.userToken).startsWith("OWNTOK") ? portalError("aaa100027") : undefined);
  const w = await device({ sn: SN, own: "OWNTOK-SECRET-old", pool: [poolSeed(1)], handlers: { "v6/getLiveData": dead } });
  call("liveChannels");
  assert.equal((await xuper.channels("31", {})).length, 1);
  assert.equal(w.count("v8/active"), 1, "one renewal (reactivation of the stored device)");
  assert.equal(w.count("v3/snToken"), 0);
  assert.equal(w.gets, 1, "still dead right after the renewal: one seed");
  assert.equal(w.state().need, "dead");

  // The channel needs an account: the shared retry plays it, no seed.
  const needs = (b) => (String(b.userToken).startsWith("OWNTOK") ? portalError("aaa100028") : undefined);
  const w2 = await device({ sn: SN, own: "OWNTOK-SECRET-old", pool: [poolSeed(1)], handlers: { "v4/startPlayLive": needs } });
  call("resolve");
  assert.ok((await xuper.resolve("ch9")).url);
  assert.equal(w2.count("v8/active"), 1, "renewed first");
  assert.equal(w2.count("v8/login"), 1, "then ONE shared login");
  const login = w2.beans("v8/login")[0];
  assert.equal(login.sn, SN, "on this device's sn");
  assert.equal(w2.beans("v14/getSlbInfo")[0].userToken, "SHAREDTOK-SECRET-1", "the open's two calls on the same (shared) session");
  assert.equal(w2.gets, 0);
  assert.equal(w2.store.get("o2:xsess") && JSON.parse(w2.store.get("o2:xsess")).userToken, "OWNTOK-SECRET-1", "the shared token is never stored");

  // The shared account refused too: the person reads that the channel needs an account; still 0 GET.
  const w3 = await device({ sn: SN, own: "OWNTOK-SECRET-old", pool: [poolSeed(1)], handlers: { "v4/startPlayLive": () => portalError("aaa100028") } });
  call("resolve");
  const e = await rejection(xuper.resolve("ch9"));
  assert.match(e.userMessage, /Este canal necesita una cuenta de Xuper; con la sesión anónima no se puede ver\. Prueba otro canal\./);
  assert.equal(w3.count("v8/login"), 1);
  assert.equal(w3.gets, 0);
  call("resolve");                                    // a later call: one shared retry again
  await rejection(xuper.resolve("ch9"));
  assert.equal(w3.count("v8/login"), 2);
  call("resolve");                                    // never two in one call (two account-only channels opened in it)
  await Promise.all([rejection(xuper.resolve("ch9")), rejection(xuper.resolve("ch8"))]);
  await rejection(xuper.resolve("ch7"));
  assert.equal(w3.count("v8/login"), 3);
  assert.equal(w3.gets, 0);
});

test("8. on a seed, aaa100028 on an open: the probe answers → seed kept, 0 GET; the probe answers dead → dropped and ONE replacement", async () => {
  const s1 = poolSeed(1), s2 = poolSeed(2);
  const w = await device({ geo: "own", pool: [s1, s2], handlers: {
    "v4/startPlayLive": (b) => (b.userToken === s1.seed.userToken ? portalError("aaa100028") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});           // on seed 1 (geo)
  assert.equal(w.gets, 1);
  call("resolve");
  const e = await rejection(xuper.resolve("ch9"));               // seed answers the probe; shared login is geo-blocked
  assert.match(e.userMessage, /necesita una cuenta/);
  const probe = w.beans("getNextColumns").pop();
  assert.equal(probe.userToken, s1.seed.userToken);
  assert.equal(probe.pageSize, 1);
  assert.equal(w.gets, 1, "the seed is kept");
  assert.equal(w.held().userToken, s1.seed.userToken);

  // the probe answers dead: drop, one replacement, the open plays on it
  const w2 = await device({ geo: "own", pool: [s1, s2], handlers: {
    "v4/startPlayLive": (b) => (b.userToken === s1.seed.userToken ? portalError("aaa100028") : undefined),
    getNextColumns: (b, n) => (b.userToken === s1.seed.userToken && b.pageSize === 1 ? portalError("aaa100027") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});
  call("resolve");
  assert.ok((await xuper.resolve("ch9")).url);
  assert.equal(w2.gets, 2);
  assert.equal(w2.held().userToken, s2.seed.userToken);
  assert.equal(w2.beans("v14/getSlbInfo").pop().userToken, s2.seed.userToken);
});

// ── 9–11: reuse, renewal, expiry ──

test("9. reuse: later calls and a cold runtime ask 0 more; with need=geo and a seed held no own attempt is made", async () => {
  const w = await device({ geo: "own", pool: [poolSeed(1), poolSeed(2)] });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  const ownCalls = () => w.portal.filter((r) => r.path === "v8/active" || r.path === "v3/snToken" || (r.bean.userToken && !String(r.bean.userToken).startsWith("SEEDTOK"))).length;
  const before = ownCalls();
  for (let i = 0; i < 4; i++) { w.advance(5 * MIN); call("liveChannels"); await xuper.channels(String(31 + i), {}); }
  xmod._resetSession();
  call("resolve"); assert.ok((await xuper.resolve("ch31")).url);
  call("resolve"); assert.ok((await xmod.resolveVod("m1")).url);
  assert.equal(w.gets, 1, "no new GET");
  assert.equal(ownCalls(), before, "no own attempt while the seed is held");
});

test("10. renewal: <30 min left and received ≥30 min ago → 1 early renewal, never two within 30 min; a short seed is used to its 2 min floor; server/device skew changes nothing", async () => {
  // remaining 3600 s, the server's clock 2 h behind (expires_at already "past"): decisions use remaining_s only
  const w = await device({ geo: "own", pool: [{ ...poolSeed(1, 3600), expires_at: T0 - 2 * 3600_000 }, poolSeed(2, 3600), poolSeed(3, 3600)] });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 1);
  w.advance(20 * MIN); call("liveChannels"); await xuper.channels("31", {});
  assert.equal(w.gets, 1, "40 min left: no renewal");
  w.advance(11 * MIN); call("liveChannels"); await xuper.channels("31", {});
  assert.equal(w.gets, 2, "+31 min: 29 min left, received 31 min ago → one early renewal");
  assert.equal(w.held().userToken, "SEEDTOK-SECRET-2");
  for (const step of [5, 10, 10]) { w.advance(step * MIN); call("liveChannels"); await xuper.channels("31", {}); }
  assert.equal(w.gets, 2, "never two renewals within 30 min");

  // a renewal that fails (no seed free) keeps the held seed, and is not tried again within 30 min (D3)
  const f = await device({ geo: "own", pool: [poolSeed(1, 3600)], seedAnswer: (n) => (n > 1 ? res(503, "{}") : undefined) });
  call("liveCategories"); await xuper.categories({});
  f.advance(31 * MIN); call("liveChannels"); await xuper.channels("31", {});
  assert.equal(f.gets, 2, "the renewal was tried");
  assert.equal(f.beans("v6/getLiveData").pop().userToken, "SEEDTOK-SECRET-1", "and the held seed kept");
  for (const step of [5, 10, 10]) { f.advance(step * MIN); call("liveChannels"); await xuper.channels("31", {}); }
  assert.equal(f.gets, 2, "not again within 30 min, although the 503 backoff (2 min) ended");
  f.advance(4 * MIN); call("liveChannels"); await rejection(xuper.channels("31", {}));
  assert.equal(f.gets, 3, "past the seed's floor: the own session (geo), then a GET");

  // remaining 600 s: no early renewal (received < 30 min ago); used to the 2 min floor, then the own session, then 1 GET
  const v = await device({ geo: "own", pool: [poolSeed(1, 600), poolSeed(2, 3600)] });
  call("liveCategories"); await xuper.categories({});
  v.advance(7 * MIN + 59_000); call("liveChannels"); await xuper.channels("31", {});
  assert.equal(v.gets, 1, "2 min 1 s left: still used");
  assert.equal(v.beans("v6/getLiveData").pop().userToken, "SEEDTOK-SECRET-1");
  v.advance(2000); call("liveChannels"); await xuper.channels("31", {});
  assert.equal(v.gets, 2, "past the floor: one GET");
  assert.equal(v.beans("v6/getLiveData").pop().userToken, "SEEDTOK-SECRET-2");
});

test("10b. a seed received under a clock that ran ahead (gotAt > 60 s in the future) is kept until the portal refuses it", async () => {
  const w = await device({ geo: "own" });
  w.kino.storage.set("o2:xseed", JSON.stringify({ v: 1, sn: "5eedf", userId: "SEEDUID-SECRET-f", userToken: "SEEDTOK-SECRET-f", gotAt: Date.now() + 5 * 3600_000, lifeMs: 3600_000 }));
  call("liveCategories"); await xuper.categories({});
  w.advance(2 * 3600_000); call("liveChannels"); await xuper.channels("31", {});
  assert.equal(w.gets, 0);
  assert.ok(w.beans("v6/getLiveData").every((b) => b.userToken === "SEEDTOK-SECRET-f"));
  assert.equal(seeds.status(true).leftMin, null, "time left unknown");
});

test("11. a seed that ends naturally: the own session is tried first (one v8/active), then a GET", async () => {
  const w = await device({ geo: "own", sn: SN, pool: [poolSeed(1, 600), poolSeed(2)], handlers: { "v8/active": () => portalError("portal100024") } });
  call("liveCategories"); await xuper.categories({});
  assert.deepEqual(w.events, ["portal:v8/active", "seed:200", "portal:getNextColumns"]);
  w.events.length = 0;
  w.advance(9 * MIN);
  call("liveCategories"); await xuper.categories({});
  assert.deepEqual(w.events, ["portal:v8/active", "seed:200", "portal:getNextColumns"], "one own reactivation, then one GET");
  // and the block lifted: the own session answers, the seed path ends
  const v = await device({ geo: "own", sn: SN, pool: [poolSeed(1, 600)], handlers: {} });
  call("liveCategories"); await xuper.categories({});
  assert.equal(v.state().need, "geo");
  v.handlers.getNextColumns = () => ({ recommendList: [{ columnId: 31, name: "Colombia" }] });
  v.advance(9 * MIN);
  call("liveCategories"); await xuper.categories({});
  assert.equal(v.gets, 1);
  assert.equal(v.state().need, null, "a content answer on the own session clears need");
});

// ── 12–15: backoffs and caps ──

test("12. 503: backoff 2 → 4 → 8 min, no local quota counted, the person reads it; a manual tap bypasses it once per 15 s", async () => {
  const w = await device({ geo: "own", seedAnswer: () => res(503, JSON.stringify({ detail: "no_seeds" })) });
  call("liveCategories");
  const e = await rejection(xuper.categories({}));
  assert.match(e.userMessage, /^Xuper bloquea tu zona y ahora no hay sesiones de respaldo libres\. Vuelve a intentar en unos minutos\.$/);
  assert.equal(w.gets, 1);
  for (const [wait, gets] of [[MIN, 1], [MIN + 1000, 2], [3 * MIN, 2], [MIN + 1000, 3], [7 * MIN, 3], [MIN + 1000, 4]]) {
    w.advance(wait); call("liveCategories"); await rejection(xuper.categories({}));
    assert.equal(w.gets, gets, "at " + (Date.now() - T0) / MIN + " min");
  }
  assert.equal(w.state().back.n, 4);
  assert.ok(!(w.state().hour && w.state().hour.n), "a 503 is refunded: no local quota");

  // manual: on a seed, inside a 503 backoff
  const v = await device({ geo: "own", pool: [poolSeed(1)], seedAnswer: (n) => (n > 1 ? res(503, "{}") : undefined) });
  call("liveCategories"); await xuper.categories({});
  call("liveCategories");
  seeds.drop(seeds.held(), "dead");           // force a need → 503 backoff
  await xuper.categories({}).catch(() => {});
  assert.equal(v.gets, 2);
  v.kino.storage.set("o2:xseed", JSON.stringify({ v: 1, sn: "5eedx", userId: "SEEDUID-SECRET-x", userToken: "SEEDTOK-SECRET-x", gotAt: Date.now(), lifeMs: 3600_000 }));
  call("screenEvent");
  assert.equal((await seeds.manualChange()).result, "busy");
  assert.equal(v.gets, 3, "the tap bypassed the 503 backoff");
  v.advance(5000); call("screenEvent"); await seeds.manualChange();
  assert.equal(v.gets, 3, "a second tap within 15 s waits");
  v.advance(11_000); call("screenEvent"); await seeds.manualChange();
  assert.equal(v.gets, 4);
});

test("13. 429: no GET until the next UTC hour plus jitter, a manual tap included", async () => {
  const w = await device({ geo: "own", seedAnswer: (n) => (n === 1 ? res(429, JSON.stringify({ detail: "rate_limited" })) : undefined), pool: [poolSeed(1), poolSeed(2)] });
  call("liveCategories");
  const e = await rejection(xuper.categories({}));
  assert.match(e.userMessage, /^Xuper bloquea tu zona y ya se usaron las sesiones de respaldo de esta hora\. Vuelve a intentar en (5[5-7]) min\.$/);
  const back = w.state().back;
  const hour = Date.UTC(2026, 10, 17, 11, 0, 0);
  assert.ok(back.until >= hour && back.until <= hour + 120_000, "the next UTC hour + 0–120 s");
  w.kino.storage.set("o2:xseed", JSON.stringify({ v: 1, sn: "5eedx", userId: "SEEDUID-SECRET-x", userToken: "SEEDTOK-SECRET-x", gotAt: Date.now(), lifeMs: 3600_000 }));
  call("screenEvent");
  assert.deepEqual(await seeds.manualChange(), { result: "hour", min: Math.ceil((back.until - Date.now()) / MIN) });
  w.kino.storage.remove("o2:xseed");
  w.advance(54 * MIN);   // 10:59
  call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.gets, 1);
  w.advance(4 * MIN);    // 11:03, past any jitter
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 2);
});

test("14. 401 on GET /seed: the Bearer is dropped and o2:relogin set; no retry; then nothing asks until the screen signs in", async () => {
  const w = await device({ geo: "own", seedAnswer: () => res(401, JSON.stringify({ detail: "no_session" })) });
  call("liveCategories");
  const e = await rejection(xuper.categories({}));
  assert.equal(w.gets, 1);
  assert.equal(w.store.get("o2:bearer"), undefined, "Bearer dropped");
  assert.equal(w.store.get("o2:relogin"), "1");
  assert.match(e.userMessage, /^Xuper bloquea tu zona\. Abre la pantalla de Xuper para reconectarte y usar una sesión de respaldo\.$/);
  w.advance(10 * MIN);
  call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.gets, 1, "no Bearer: no request");
});

test("15. local cap: the 4th automatic GET in one UTC hour is not made", async () => {
  const dead = (b) => (String(b.userToken).startsWith("SEEDTOK") ? portalError("aaa100027") : portalError("portal100024"));
  const w = await device({ pool: [1, 2, 3, 4, 5].map((n) => poolSeed(n)), handlers: { getNextColumns: dead } });
  call("liveCategories");
  assert.match((await rejection(xuper.categories({}))).userMessage, /tampoco funcionaron/);
  assert.equal(w.gets, 2, "the first + one replacement");
  w.advance(MIN);
  call("liveCategories");
  const e = await rejection(xuper.categories({}));
  assert.equal(w.gets, 3, "the third, then the cap");
  assert.match(e.userMessage, /ya se usaron las sesiones de respaldo de esta hora\. Vuelve a intentar en 5[0-9] min/);
  w.advance(MIN);
  call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.gets, 3);
  assert.equal(w.state().doa, 3, "three seeds dead on arrival");
  w.advance(55 * MIN);   // the next UTC hour
  call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.gets, 5);
});

// ── 16–19: single flight, lease, shapes, one use ──

test("16. single flight: 6 parallel steps of a call share 1 GET; a seed dead on arrival gets exactly 1 replacement, never more than 2 per call", async () => {
  const w = await device({ geo: "own", pool: [poolSeed(1), poolSeed(2)] });
  call("liveChannels");
  const lists = await Promise.all(["31", "32", "33", "34", "35", "36"].map((c) => xuper.channels(c, {})));
  assert.equal(lists.length, 6);
  assert.equal(w.gets, 1);

  const s1 = poolSeed(1);
  const v = await device({ geo: "own", pool: [s1, poolSeed(2), poolSeed(3)], handlers: {
    "v6/getLiveData": (b) => (b.userToken === s1.seed.userToken ? portalError("aaa100027") : undefined),
  } });
  call("liveChannels");
  await Promise.all(["31", "32", "33"].map((c) => xuper.channels(c, {})));
  assert.equal(v.gets, 2, "the DOA seed: one replacement shared by the three");
  assert.equal(v.held().userToken, "SEEDTOK-SECRET-2");

  const u = await device({ geo: "own", pool: [1, 2, 3].map((n) => poolSeed(n)), handlers: {
    "v6/getLiveData": (b) => (String(b.userToken).startsWith("SEEDTOK") ? portalError("aaa100027") : undefined),
  } });
  call("liveChannels");
  await Promise.all(["31", "32", "33"].map((c) => rejection(xuper.channels(c, {}))));
  assert.equal(u.gets, 2, "never more than 2 per call");
});

test("17. lease: while another runtime asks (≤15 s), this one waits for its seed instead of asking; a stale lease is ignored", async () => {
  const w = await device({ geo: "own", pool: [poolSeed(9)] });
  w.kino.storage.set("o2:xseedLease", JSON.stringify({ id: "other-runtime", at: Date.now() }), { ttlMs: 15_000 });
  let slept = 0;
  const sleep = w.kino.sleep;
  w.kino.sleep = async (ms) => {
    await sleep(ms);
    if (++slept === 3) {                         // the other runtime's GET lands 750 ms later
      w.kino.storage.set("o2:xseed", JSON.stringify({ v: 1, sn: "5eedother", userId: "SEEDUID-SECRET-o", userToken: "SEEDTOK-SECRET-o", gotAt: Date.now(), lifeMs: 3600_000 }), { ttlMs: 3600_000 });
      w.kino.storage.remove("o2:xseedLease");
    }
  };
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 0, "1 GET in all: the other runtime's");
  assert.equal(w.beans("getNextColumns").pop().userToken, "SEEDTOK-SECRET-o");

  // the other runtime's GET brings nothing within 3 s: this call goes on without a seed
  const v = await device({ geo: "own", pool: [poolSeed(1)] });
  v.kino.storage.set("o2:xseedLease", JSON.stringify({ id: "other-runtime", at: Date.now() }), { ttlMs: 15_000 });
  call("liveCategories");
  const e = await rejection(xuper.categories({}));
  assert.equal(v.gets, 0);
  assert.match(e.userMessage, /Vuelve a intentar en unos segundos/);
  // a lease older than 15 s is another runtime that died: ignored
  v.kino.storage.set("o2:xseedLease", JSON.stringify({ id: "other-runtime", at: Date.now() - 16_000 }));
  v.advance(MIN);
  call("liveCategories"); await xuper.categories({});
  assert.equal(v.gets, 1);
  assert.equal(v.store.get("o2:xseedLease"), undefined, "our lease is removed once the GET ends");
});

test("18. GET /seed answer shapes: seed as text or object, unknown keys ignored, extras optional; a missing id or too little life is bad (nothing stored, 1 min)", async () => {
  const ok = async (body) => {
    const w = await device({ pool: [{ raw: body }] });
    call("resolve");
    return { r: await fetchSeed(5000), w };
  };
  const seed = { sn: "5eed1", userId: 967000001, userToken: "SEEDTOK-SECRET-1", jwtToken: "SEEDJWT-SECRET-1", mintedAt: 1763373600, exp: 1763402400 };
  let { r } = await ok({ seed: JSON.stringify(seed), expires_at: T0 + 3600_000, remaining_s: 3600 });
  assert.deepEqual(r, { ok: true, seed: { sn: "5eed1", userId: "967000001", userToken: "SEEDTOK-SECRET-1", mintedAt: 1763373600 }, lifeMs: 3600_000, expiresAt: T0 + 3600_000 });
  ({ r } = await ok({ seed: { sn: "5eed1", userId: "u", userToken: "t" }, expires_at: T0 + 3600_000, remaining_s: 3600 }));
  assert.equal(r.ok, true);
  for (const bad of [
    { seed: { userId: "u", userToken: "t" }, remaining_s: 3600 },
    { seed: { sn: "s", userToken: "t" }, remaining_s: 3600 },
    { seed: { sn: "s", userId: "u", userToken: " " }, remaining_s: 3600 },
    { seed: { sn: "s", userId: "u", userToken: "t" }, remaining_s: 120 },
    { seed: { sn: "s", userId: "u", userToken: "t" } },
    { seed: "not json", remaining_s: 3600 },
    { seed: [1], remaining_s: 3600 },
    "not json at all",
  ]) {
    ({ r } = await ok(bad));
    assert.deepEqual(r, { ok: false, status: "bad" }, JSON.stringify(bad));
  }
  // through the session chain: a bad answer stores nothing and backs off 1 min
  const w = await device({ geo: "own", pool: [{ raw: { seed: { sn: "s" }, remaining_s: 3600 } }, poolSeed(2)] });
  call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.held(), null);
  assert.equal(w.state().back.why, "bad");
  w.advance(30_000); call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.gets, 1);
  w.advance(31_000); call("liveCategories"); await xuper.categories({});
  assert.equal(w.gets, 2);
});

test("19. one use: a dropped seed is gone from storage and never sent again", async () => {
  const s1 = poolSeed(1);
  const w = await device({ geo: "own", pool: [s1, poolSeed(2)], handlers: {
    "v6/getLiveData": (b) => (b.userToken === s1.seed.userToken ? portalError("aaa100027") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});
  assert.equal(w.held().userToken, s1.seed.userToken);
  call("liveChannels"); await xuper.channels("31", {});
  assert.equal(w.held().userToken, "SEEDTOK-SECRET-2");
  const sent = w.portal.length;
  xmod._resetSession();
  for (let i = 0; i < 3; i++) { call("liveChannels"); await xuper.channels("40", {}); }
  call("resolve"); await xuper.resolve("ch1");
  assert.ok(w.portal.slice(sent).every((r) => r.bean.userToken !== s1.seed.userToken && r.bean.sn !== s1.seed.sn));
  assert.ok(![...w.store.values()].some((v) => v.includes(s1.seed.userToken)), "nowhere in storage");
});

// ── only when needed: the calls that never ask ──

test("only Kino's resolve, liveCategories and liveChannels ask: Home, search, browse, episodes, the screen and its ticks never do", async () => {
  for (const name of ["home", "search", "browse", "episodes", "screen", "screenEvent", ""]) {
    const w = await device({ geo: "own", pool: [poolSeed(1)] });
    beginCall(); if (name) callFor(name);
    await rejection(xuper.channels("31", {}));
    assert.equal(w.gets, 0, name || "an unnamed call");
  }
  // a held seed is still reused by them (free)
  const w = await device({ geo: "own", pool: [poolSeed(1)] });
  call("liveChannels"); await xuper.channels("31", {});
  call("screenEvent"); assert.equal((await xuper.channels("40", {})).length, 1);
  assert.equal(w.gets, 1);
});
