// Breadcrumbs at the decision points a field error is diagnosed from (Kino sends a failed call's
// kino.log lines to its error board), and the guarantee that none of them carries a secret, an
// email, a host or an sn. Real portal + session over a scripted fetch (test/helpers/portalWorld.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld, SEEDS, STORED } from "./helpers/portalWorld.mjs";
import { traced } from "../src/trace.js";
import { signRequest } from "../src/liveSign.js";

const GEO = { returnCode: "portal100024", errorMessage: "版权限制 geo" };
const DEAD = { returnCode: "aaa100027", errorMessage: "not logged in" };
const isSeed = (bean) => String(bean.userToken).startsWith("seedtok");
const searchAnswer = { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie" }] }] };
const query = { q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 };
const has = (w, re) => assert.ok(w.logs.some((l) => re.test(l)), `no line ${re} in:\n${w.logs.join("\n")}`);
const FORMAT = /^xuper:[a-z?][a-z0-9_]* [a-z?][a-z0-9_]*( [a-z][a-zA-Z0-9]*=[A-Za-z0-9_\/?-]+)*$/;

test("host failover: the failing host's index and why, then which index answered; never a host name", async () => {
  const w = portalWorld({ hosts: ["a.test", "b.test"], dead: ["a.test"] });
  await w.catalog.search(query);
  has(w, /^xuper:portal host_fail path=v3\/searchByName i=0 why=Error$/);
  has(w, /^xuper:portal failover path=v3\/searchByName to=1$/);
  assert.ok(!w.logs.join("\n").includes("a.test"));
});

test("every host down: one line saying all failed", async () => {
  const w = portalWorld({ hosts: ["a.test", "b.test"], dead: ["a.test", "b.test"] });
  await assert.rejects(w.catalog.search(query));
  has(w, /^xuper:portal all_fail path=v3\/searchByName n=2$/);
});

test("a portal error code is logged with its path", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v4/getItemData": { returnCode: "portal100006", errorMessage: "剧集不存在" } } });
  await assert.rejects(w.catalog.episodes("magis1:teleplay:2:SERIE"));
  has(w, /^xuper:portal rc path=v4\/getItemData code=portal100006$/);
});

test("a deadline already gone: the path that was not even asked", async () => {
  const w = portalWorld({ hosts: ["a.test"] });
  await assert.rejects(w.portal.call("v3/searchByName", {}, { deadline: w.clock.now() - 1 }));
  has(w, /^xuper:portal deadline path=v3\/searchByName$/);
});

test("fresh install: the mint and activation outcomes", async () => {
  const w = portalWorld({ hosts: ["a.test"], session: null });
  await w.catalog.search(query);
  has(w, /^xuper:session mint ok=1$/);
});

test("a mint the portal refuses: its code", async () => {
  const w = portalWorld({ hosts: ["a.test"], session: null, routes: { "v3/snToken": { returnCode: "aaa100099" } } });
  await assert.rejects(w.catalog.search(query));
  has(w, /^xuper:session mint ok=0 code=aaa100099$/);
});

test("reactivation of the stored sn refused with an invalid-sn code: logged, then a new device is minted", async () => {
  let n = 0;
  const w = portalWorld({ hosts: ["a.test"], session: { ...STORED, userToken: "" }, routes: {
    "v8/active": () => (n++ === 0 ? { returnCode: "aaa100080" } : { userId: "u-new", userToken: "tok-new", jwtToken: "" }),
  } });
  await w.catalog.search(query);
  has(w, /^xuper:session activate ok=0 code=aaa100080$/);
  has(w, /^xuper:session mint ok=1$/);
});

test("geo-block on content, anonymous: geo detected, the pool downloaded and a seed switched to (hash, pool size)", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: JSON.stringify(SEEDS), routes: { "v3/searchByName": (b) => (isSeed(b) ? searchAnswer : GEO) } });
  await w.catalog.search(query);
  has(w, /^xuper:session err code=portal100024 mode=anon$/);
  has(w, /^xuper:session geo at=content mode=anon$/);
  has(w, /^xuper:seeds refresh ok=1 n=2$/);
  has(w, /^xuper:session seed_switch pool=2 seed=[0-9a-f]{8}$/);
});

test("a pool download that fails says why", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: "404: Not Found", routes: { "v3/searchByName": GEO } });
  await assert.rejects(w.catalog.search(query));
  has(w, /^xuper:seeds refresh ok=0 why=parse$/);
});

test("a dead token: the error, then the reauthentication outcome", async () => {
  let n = 0;
  const w = portalWorld({ hosts: ["a.test"], routes: { "v3/searchByName": () => (n++ === 0 ? DEAD : searchAnswer) } });
  await w.catalog.search(query);
  has(w, /^xuper:session err code=aaa100027 mode=anon$/);
  has(w, /^xuper:session reauth ok=1 mode=anon$/);
});

test("dead seeds all the way: the rescue rounds and the pool marked exhausted", async () => {
  const w = portalWorld({ hosts: ["a.test"], seeds: SEEDS, seedsText: JSON.stringify(SEEDS), routes: { "v3/searchByName": DEAD } });
  await assert.rejects(w.catalog.search(query));
  has(w, /^xuper:session exhausted rounds=\d+$/);
});

test("an account the portal refuses: acct kind, code and that it is remembered as refused", async () => {
  const w = portalWorld({ hosts: ["a.test"], session: null, config: { email: "persona@correo.test", password: "clave-secreta-9" },
    routes: { "v8/login": { returnCode: "aaa100002" } } });
  await w.catalog.search(query);
  has(w, /^xuper:session login acct=own ok=0 code=aaa100002 refused=1$/);
});

test("an account that logs in: acct kind and ok", async () => {
  const w = portalWorld({ hosts: ["a.test"], session: null, config: { email: "persona@correo.test", password: "clave-secreta-9" } });
  await w.catalog.search(query);
  has(w, /^xuper:session login acct=own ok=1$/);
});

test("shared account, still geo-blocked: the per-call seed fallback with counts", async () => {
  const shared = { email: "compartida@correo.test", password: "compartida-pw-7" };
  const w = portalWorld({ hosts: ["a.test"], seeds: SEEDS, shared, config: { useSharedAccount: true },
    routes: { "v3/searchByName": (b) => (isSeed(b) ? searchAnswer : GEO) } });
  await w.catalog.search(query);
  has(w, /^xuper:session seed_fallback outcome=answered tries=1 pool=2 refreshed=0$/);
});

test("live: a conflict retry says what the rotation did; a seed that cannot open is logged by hash and code", async () => {
  const w = portalWorld({ hosts: ["a.test"], seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } });
  await w.resolve.resolve("cyx-RCNHD", { retry: { reason: "conflict", attempt: 1 } });
  has(w, /^xuper:live retry reason=conflict attempt=1$/);
  has(w, /^xuper:live conflict mode=seed outcome=rotated tried=\d+ of=4$/);
});

test("live: an open that fails says at which step and the code", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v4/startPlayLive": { returnCode: "portal100024" } } });
  await assert.rejects(w.resolve.resolve("cyx-RCNHD"));
  has(w, /^xuper:live open_fail step=play code=portal100024 seed=0$/);
});

test("live: a channel with no usable CDN says which check failed", async () => {
  const w = portalWorld({ hosts: ["a.test"], routes: { "v14/getSlbInfo": { invalidTime: "14400", cdn_list: [] } } });
  await assert.rejects(w.resolve.resolve("cyx-RCNHD"));
  has(w, /^xuper:live bad why=no_cdn$/);
});

test("storage budget: a home tree that only fits trimmed says how far it was trimmed", async () => {
  const big = { recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 120 }, (_, i) => ({
    contentId: `PEL${i}`, name: "Titulo " + i, programType: "movie", tags: "Drama,Acción,Comedia", score: 7, description: "d".repeat(400),
  })) }] };
  const w = portalWorld({ hosts: ["a.test"], routes: { getNextColumns: big } });
  await w.catalog.home();
  has(w, /^xuper:store trim what=tree root=[a-z_]+ step=[1-9]\d*$/);
});

test("traced: a failing export says which, the code and how long it ran; a success writes nothing", async () => {
  const w = portalWorld({ hosts: ["a.test"] });
  const err = Object.defineProperty(new Error("x"), "name", { value: "KinoError_unavailable" });
  await assert.rejects(traced(w.kino, w.clock, "home", async () => { w.clock.t += 1234; throw err; }), (e) => e === err);
  has(w, /^xuper:call fail fn=home code=unavailable ms=1234$/);
  const before = w.logs.length;
  assert.equal(await traced(w.kino, w.clock, "search", async () => 7), 7);
  assert.equal(w.logs.length, before);
});

test("sign: a broken context or a CDN entry without a token throws with a short `why` the export logs", () => {
  assert.throws(() => signRequest({ url: "http://x.test/a", context: "nope" }, 1), (e) => e.why === "context");
  assert.throws(() => signRequest({ url: "http://x.test/a", context: JSON.stringify({ l: "L", c: [{ h: "x.test", a: "no" }] }) }, 1), (e) => e.why === "no_token");
});

test("NO secret ever reaches a log line: tokens, sns, seeds, emails, passwords, hosts, licenses over many flows", async () => {
  const email = "persona@correo.test", password = "clave-secreta-9";
  const shared = { email: "compartida@correo.test", password: "compartida-pw-7" };
  const all = [];
  const run = async (opts, body) => {
    const w = portalWorld({ hosts: ["a.test", "b.test"], ...opts });
    try { await body(w); } catch (_) { /* failures are part of the flows */ }
    all.push(...w.logs);
  };
  await run({ dead: ["a.test"], session: null }, (w) => w.catalog.search(query));
  await run({ seedsText: JSON.stringify(SEEDS), routes: { "v3/searchByName": (b) => (isSeed(b) ? searchAnswer : GEO) } }, (w) => w.catalog.search(query));
  await run({ seeds: SEEDS, routes: { "v3/searchByName": DEAD } }, (w) => w.catalog.search(query));
  await run({ session: null, config: { email, password }, routes: { "v8/login": { returnCode: "aaa100002", errorMessage: email } } }, (w) => w.catalog.search(query));
  await run({ session: null, config: { email, password } }, (w) => w.catalog.home());
  await run({ seeds: SEEDS, shared, config: { useSharedAccount: true }, routes: { "v3/searchByName": (b) => (isSeed(b) ? searchAnswer : GEO) } }, (w) => w.catalog.search(query));
  await run({ seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } }, (w) => w.resolve.resolve("cyx-RCNHD", { retry: { reason: "conflict", attempt: 1 } }));
  await run({ routes: { "v4/startPlayLive": GEO } }, (w) => w.resolve.resolve("cyx-RCNHD"));
  await run({}, (w) => w.resolve.resolve("magis1:movie:0:M1"));
  await run({ dead: ["a.test", "b.test"] }, (w) => w.catalog.episodes("magis1:teleplay:2:SERIE"));
  await run({ seeds: SEEDS }, (w) => w.session.switchSeed());
  await run({ seedsDead: true, routes: { "v3/searchByName": GEO } }, (w) => w.catalog.search(query));
  assert.ok(all.length >= 20, `representative flows logged (${all.length} lines)`);
  const text = all.join("\n");
  const secrets = [
    email, password, shared.email, shared.password, "correo.test",
    STORED.userToken, STORED.sn, STORED.userId, "tok-new", "tok-acct", "u-acct", "SNTOK",
    ...SEEDS.flatMap((e) => [e.sn, e.userId, e.userToken]),
    "a.test", "b.test", "cdn.test", "raw.githubusercontent", "http", "LIC-LIVE", "0123456789abcdef",
  ];
  for (const s of secrets) assert.ok(!text.includes(s), `logged ${s}`);
  for (const line of all.filter((l) => l.startsWith("xuper:"))) {
    assert.match(line, FORMAT);
    assert.ok(line.length <= 160, line);
  }
  // Every line the plugin writes is a breadcrumb in the format (no free text left).
  assert.deepEqual(all.filter((l) => !l.startsWith("xuper:")), []);
});
