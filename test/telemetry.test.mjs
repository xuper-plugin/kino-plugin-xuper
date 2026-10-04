// Breadcrumbs at the decision points a field error is diagnosed from (Kino sends a failed call's
// kino.log lines to its error board), and the guarantee that none of them carries a secret, an
// email, a host or an sn. Real portal + session over a scripted fetch (test/helpers/portalWorld.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld, SEEDS, STORED } from "./helpers/portalWorld.mjs";
import { traced, report, makeSignStats } from "../src/trace.js";
import { signRequest, buildSignContext, contextAgeS } from "../src/liveSign.js";
import { makeRegistration } from "../src/registration.js";
import { appScrub } from "./helpers/appScrubber.mjs";

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
  has(w, /^xuper:session err code=portal100024 sess=anon$/);
  has(w, /^xuper:session geo at=content sess=anon$/);
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
  has(w, /^xuper:session err code=aaa100027 sess=anon$/);
  has(w, /^xuper:session reauth ok=1 sess=anon$/);
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
  has(w, /^xuper:anon_fallback login acct=own ok=0 code=aaa100002 refused=1$/);
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
  has(w, /^xuper:shared_seed answered tries=1 pool=2 refreshed=0$/);
  // A seed that answered for the shared account is a degraded success: reported to the error board.
  assert.deepEqual(w.reports, ["xuper:shared_seed answered tries=1 pool=2 refreshed=0"]);
});

test("degraded results are reported, failures and successes are not", async () => {
  // A refused own account: the call goes on anonymous, and that fallback is reported.
  const refused = portalWorld({ hosts: ["a.test"], session: null, config: { email: "persona@correo.test", password: "clave-secreta-9" },
    routes: { "v8/login": { returnCode: "aaa100002" } } });
  await refused.catalog.search(query);
  assert.deepEqual(refused.reports, ["xuper:anon_fallback login acct=own ok=0 code=aaa100002 refused=1"]);
  // A login that works reports nothing.
  const ok = portalWorld({ hosts: ["a.test"], session: null, config: { email: "persona@correo.test", password: "clave-secreta-9" } });
  await ok.catalog.search(query);
  assert.deepEqual(ok.reports, []);
  // Every seed dead: the call fails (its own failure event carries the lines), nothing is reported as degraded.
  const dead = portalWorld({ hosts: ["a.test"], seeds: SEEDS, seedsText: JSON.stringify(SEEDS), routes: { "v3/searchByName": DEAD } });
  await assert.rejects(dead.catalog.search(query));
  assert.ok(dead.reports.every((l) => !/shared_seed|seed_fallback/.test(l)), dead.reports.join("\n"));
});

test("live: a conflict retry says what the rotation did; a seed that cannot open is logged by hash and code", async () => {
  const w = portalWorld({ hosts: ["a.test"], seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } });
  await w.resolve.resolve("cyx-RCNHD", { retry: { reason: "conflict", attempt: 1 } });
  has(w, /^xuper:live retry reason=conflict attempt=1$/);
  has(w, /^xuper:live conflict sess=seed outcome=rotated tried=\d+ of=4$/);
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

test("storage budget: rows that only fit trimmed say how far they were trimmed", async () => {
  const big = { recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 120 }, (_, i) => ({
    contentId: `PEL${i}`, name: "Titulo " + i, programType: "movie", tags: "Drama,Acción,Comedia", score: 7, description: "d".repeat(4000),
  })) }] };
  const w = portalWorld({ hosts: ["a.test"], routes: { getNextColumns: big } });
  await w.catalog.home();
  has(w, /^xuper:store trim what=rows step=[1-9]\d*$/);
});

test("traced: every export says when it starts and how it ended, with its time (and its count for a list)", async () => {
  const w = portalWorld({ hosts: ["a.test"] });
  const err = Object.defineProperty(new Error("x"), "name", { value: "KinoError_unavailable" });
  await assert.rejects(traced(w.kino, w.clock, "home", async () => { w.clock.t += 1234; throw err; }), (e) => e === err);
  has(w, /^xuper:call start fn=home$/);
  has(w, /^xuper:call fail fn=home code=unavailable ms=1234$/);
  assert.deepEqual(await traced(w.kino, w.clock, "search", async () => { w.clock.t += 40; return [1, 2, 3]; }), [1, 2, 3]);
  assert.equal(await traced(w.kino, w.clock, "search", async () => 7), 7);
  has(w, /^xuper:call start fn=search$/);
  has(w, /^xuper:call ok fn=search ms=40 n=3$/);
  has(w, /^xuper:call ok fn=search ms=0$/);
  await traced(w.kino, w.clock, "resolve", async () => ({}), { kind: "live" });
  has(w, /^xuper:call start fn=resolve kind=live$/);
  has(w, /^xuper:call ok fn=resolve kind=live ms=0$/);
});

test("sign: a running tally (count, time, the context's age, failures) on the first sign and every 50th, a slow one on its own", () => {
  const w = portalWorld({ hosts: ["a.test"] });
  const stats = makeSignStats({ kino: w.kino, every: 50, slowMs: 200 });
  stats.record({ kind: "playlist", ms: 3, ageS: 12, ok: true });
  has(w, /^xuper:sign stats n=1 fail=0 maxMs=3 age=12 kind=playlist$/);
  for (let i = 0; i < 48; i++) stats.record({ kind: "segment", ms: 1, ageS: 20, ok: true });
  stats.record({ kind: "segment", ms: 250, ageS: 21, ok: true });
  has(w, /^xuper:sign slow kind=segment ms=250$/);
  has(w, /^xuper:sign stats n=50 fail=0 maxMs=250 age=21 kind=segment$/);
  stats.record({ kind: "segment", ms: 1, ageS: null, ok: false });
  assert.equal(w.logs.filter((l) => l.startsWith("xuper:sign stats")).length, 2);
});

test("sign context: its build time rides along (seconds), and its age is read back without parsing", () => {
  const ctx = buildSignContext("L", [{ cflHost: "h.live.test", authBase: "sign_type=cfl&token=941d98961990d67e249dcd1ac57378c8" }], 1_700_000_000_123).context;
  assert.equal(JSON.parse(ctx).b, 1_700_000_000);
  assert.equal(contextAgeS(ctx, 1_700_000_090_999), 90);
  assert.equal(contextAgeS(JSON.stringify({ l: "L", c: [] }), 5), null);
  // Without a time (older callers): no `b`, as before.
  assert.equal("b" in JSON.parse(buildSignContext("L", [{ cflHost: "h.live.test", authBase: "token=941d98961990d67e249dcd1ac57378c8" }]).context), false);
});

test("live: an open says which SLB entry became the primary, how many were kept and the alternates; a skipped first entry is reported", async () => {
  const w = portalWorld({ hosts: ["a.test"] });
  await w.resolve.resolve("cyx-RCNHD");
  has(w, /^xuper:live open cdns=\d+ kept=\d+ primary=0 alts=\d+ seed=0 exp=\d+$/);
  assert.ok(w.reports.every((l) => !l.startsWith("xuper:live_cdn")), w.reports.join("\n"));
});

test("edge cases are reported (kino.log.report): a failed sign, a conflict's rotation, a portal failover, a failed migrate", async () => {
  const lines = [];
  const reports = [];
  const kino = { log: Object.assign((l) => lines.push(l), { report: (l) => { lines.push(l); reports.push(l); } }) };
  report(kino, "sign", "fail", { why: "context" });
  assert.deepEqual(reports, ["xuper:sign fail why=context"]);
  const w = portalWorld({ hosts: ["a.test"], seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } });
  await w.resolve.resolve("cyx-RCNHD", { retry: { reason: "conflict", attempt: 1 } });
  assert.ok(w.reports.some((l) => /^xuper:live_rotation conflict outcome=rotated tried=\d+ of=4$/.test(l)), w.reports.join("\n"));
  const f = portalWorld({ hosts: ["a.test", "b.test"], dead: ["a.test"] });
  await f.catalog.search(query);
  assert.ok(f.reports.some((l) => /^xuper:portal failover path=v3\/searchByName to=1$/.test(l)), f.reports.join("\n"));
});

test("sign: a broken context or a CDN entry without a token throws with a short `why` the export logs", () => {
  assert.throws(() => signRequest({ url: "http://x.test/a", context: "nope" }, 1), (e) => e.why === "context");
  assert.throws(() => signRequest({ url: "http://x.test/a", context: JSON.stringify({ l: "L", c: [{ h: "x.test", a: "no" }] }) }, 1), (e) => e.why === "no_token");
});

// The representative flows every line-level guarantee below is checked over.
async function collectFlows() {
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
  return { all, email, password, shared };
}

test("NO secret ever reaches a log line: tokens, sns, seeds, emails, passwords, hosts, licenses over many flows", async () => {
  const { all, email, password, shared } = await collectFlows();
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

test("the app's log scrubber leaves every breadcrumb whole: no [id], [host] or [REDACTED] on the board", async () => {
  const { all } = await collectFlows();
  const more = [];
  const run = async (opts, body) => {
    const w = portalWorld({ hosts: ["a.test", "b.test"], ...opts });
    try { await body(w); } catch (_) { /* failures are part of the flows */ }
    more.push(...w.logs);
  };
  const refused = { returnCode: "aaa100099", errorMessage: "no" };
  // Registration: the two long endpoint names, refused (rc) and on dead hosts (host_fail, all_fail).
  const reg = (w) => makeRegistration({ kino: w.kino, portal: w.portal, session: w.session, clock: w.clock });
  await run({ routes: { "v2/sendEmailVerifyCode": refused } }, (w) => reg(w).sendRegistrationCode("ana@x.test"));
  await run({ routes: { "v2/validateVerifyCode": refused } }, (w) => reg(w).confirmRegistration(
    { email: "ana@x.test", userId: "u-p", userToken: "tok-p", sn: "SN-P" }, "123456", "pw-1"));
  await run({ dead: ["a.test", "b.test"] }, (w) => reg(w).confirmRegistration(
    { email: "ana@x.test", userId: "u-p", userToken: "tok-p", sn: "SN-P" }, "123456", "pw-1"));
  // Live rotation spent, then asked again (already_exhausted); an undecryptable live page.
  await run({ seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } }, async (w) => {
    for (let a = 1; a <= 6; a++) await w.resolve.resolve("cyx-RCNHD", { retry: { reason: "conflict", attempt: a } }).catch(() => {});
  });
  await run({ routes: { "v6/getLiveData": { returnCode: "0", data: "deadbeef".repeat(4) } } }, (w) => w.portal.call("v6/getLiveData", {}));
  const lines = [...all, ...more].filter((l) => l.startsWith("xuper:"));
  assert.ok(lines.some((l) => l.includes("path=v2/sendCode")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("path=v2/checkCode")), lines.join("\n"));
  assert.ok(lines.some((l) => l.includes("outcome=spent")), lines.join("\n"));
  assert.ok(lines.some((l) => l.startsWith("xuper:portal decrypt-fail ")), lines.join("\n"));
  for (const line of lines) assert.equal(appScrub(line), line);
});

test("a Home where every root fails ends with one compact summary line, inside the app's 30-line / 2 KB cut", async () => {
  const GEO_ALL = { "getNextColumns": GEO };
  const w = portalWorld({ hosts: ["a.test", "b.test"], seedsDead: true, routes: GEO_ALL });
  await assert.rejects(w.catalog.home());
  const lines = w.logs.filter((l) => l.startsWith("xuper:"));
  // The app keeps a ring of 30 lines and sends the NEWEST that fit in 2048 characters.
  const ring = lines.slice(-30);
  const sent = [];
  let total = 0;
  for (const l of [...ring].reverse()) { if (total + l.length + 1 > 2048) break; sent.unshift(l); total += l.length + 1; }
  const summary = sent.filter((l) => l.startsWith("xuper:home all_fail "));
  assert.equal(summary.length, 1, lines.join("\n"));
  assert.match(summary[0], /^xuper:home all_fail roots=\d rounds=\d c1=geo_blocked( c2=[a-z0-9_]+)?( c3=[a-z0-9_]+)?$/);
  assert.equal(appScrub(summary[0]), summary[0]);
  assert.equal(lines[lines.length - 1], summary[0], "the newest line, so it is the last one cut");
});

test("each degraded result has its own area (its own hourly report), each a namespaced word the app keeps", async () => {
  const AREA = /^(?=[a-z0-9_:]*[_:])[a-z0-9_:]{1,24}$/;
  const shared = { email: "compartida@correo.test", password: "compartida-pw-7" };
  const seed = portalWorld({ hosts: ["a.test"], seeds: SEEDS, shared, config: { useSharedAccount: true },
    routes: { "v3/searchByName": (b) => (isSeed(b) ? searchAnswer : GEO) } });
  await seed.catalog.search(query);
  const refused = portalWorld({ hosts: ["a.test"], session: null, config: { email: "persona@correo.test", password: "clave-secreta-9" },
    routes: { "v8/login": { returnCode: "aaa100002" } } });
  await refused.catalog.search(query);
  const areas = [...seed.reports, ...refused.reports].map((l) => l.split(" ")[0]);
  assert.ok(areas.length >= 2);
  assert.equal(new Set(areas).size, areas.length, areas.join(","));
  for (const a of areas) assert.match(a, AREA);
});

test("live: a retry's HTTP status is logged when the app sends one", async () => {
  const w = portalWorld({ hosts: ["a.test"], seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } });
  await w.resolve.resolve("cyx-RCNHD", { retry: { reason: "expired", attempt: 2, status: 403 } });
  has(w, /^xuper:live retry reason=expired attempt=2 status=403$/);
});
