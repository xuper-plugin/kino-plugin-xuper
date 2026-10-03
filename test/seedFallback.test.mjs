// Ruling R33: while the SHARED account is in use, a non-live call (search, home, episodes, VOD
// resolve) that is still geo-blocked or session-dead after the usual geo + reauth steps is retried
// with up to 3 pool seeds as a PER-CALL override; the stored session (the shared account), the
// region flag, `exhausted` and `acct` are never written by those attempts. Live never uses it.
// Everything runs through the REAL makeSession + makePortal + makeCrypto over a scripted fetch.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makePortal } from "../src/portal.js";
import { makeCrypto } from "../src/crypto.js";
import { makeSession } from "../src/session.js";
import { makeSearch } from "../src/search.js";
import { makePortalChapters } from "../src/episodes.js";
import { makeCatalog } from "../src/catalog.js";
import { makeResolve } from "../src/resolve.js";
import { makeLive } from "../src/live.js";

const HOST = "portal-a.test";
const SH = { email: "compartida@stand-in.test", password: "shared-stand-in-pw" };
const OWN = { email: "ana@x.test", password: "own-stand-in-pw" };
const ACCT_TOKEN = "acct-token-TS";
const SEEDS = [
  { sn: "seed-sn-1", userId: "seed-u1", userToken: "seedtok1" },
  { sn: "seed-sn-2", userId: "seed-u2", userToken: "seedtok2" },
  { sn: "seed-sn-3", userId: "seed-u3", userToken: "seedtok3" },
  { sn: "seed-sn-4", userId: "seed-u4", userToken: "seedtok4" },
];
const FAR = "9999999999";
const GEO = { returnCode: "portal100024", errorMessage: "geo" };
const DEAD = { returnCode: "aaa100028", errorMessage: "未登录" };
const isSeed = (bean) => String(bean.userToken).startsWith("seedtok");

const searchAnswer = { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie", releaseTime: "2021-10-22" }] }] };
const detailAnswer = { assetData: { keyWords: "", volumnCount: "1", sameSeasonSeriesList: [], simpleProgramList: [{ seriesNumber: "1", contentId: "EP1", name: "Capitulo 1" }] } };
const playAnswer = { episodeList: [{ totalMovieList: [{ movieList: [{ contentId: "M1", videoFormat: "mp4", encodeFormat: "h264", licenseList: [{ license: "LIC" }] }] }] }] };
// The CDN auth names the session it was given to, so a cross-session SLB shows in the headers.
const slbAnswer = (who) => ({ invalidTime: "14400", cdn_list: [{ tag: "vod", main_addr: "https://vod.cdn.test", url_list: [{ tag: "free", url: `cdn_type=1&sign_type=cfl&token=${who}&expired=${FAR}` }] }] });
const treeAnswer = { recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => ({ contentId: `PEL${i + 1}`, name: "Titulo " + i, programType: "movie", tags: "Drama", score: 7 })) }] };

/**
 * `routes`: path -> (bean, req) => answer object ({ returnCode } is an error) or an Error to throw.
 * `account`: "shared" | "own" | "none". `stepMs`: the clock advances by this on every portal request
 * (capped by the request's own timeout, which then throws: a slow portal).
 */
function harness({ routes = {}, account = "shared", seeds = SEEDS, seedsText = "[]", stepMs = 0, sessionSn = "sn-dev" } = {}) {
  const clock = { t: 1_000_000, now() { return this.t; } };
  const requests = [];
  const logs = [];
  const seedDownloads = [];
  let crypto = null;
  const reply = (obj) => ({ text: () => JSON.stringify(obj) });
  const fetch = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.host === "raw.githubusercontent.com") { seedDownloads.push(opts.timeoutMs); return { text: () => seedsText }; }
    assert.equal(u.host, HOST);
    const path = u.pathname.slice("/api/portalCore/".length);
    const bean = JSON.parse(crypto.decryptBlob(opts.body));
    requests.push({ path, bean, timeoutMs: opts.timeoutMs, at: clock.t });
    if (stepMs > 0) {
      if (opts.timeoutMs < stepMs) { clock.t += opts.timeoutMs; throw new Error("timeout"); }
      clock.t += stepMs;
    }
    const route = routes[path];
    if (!route) throw new Error("unscripted portal path " + path);
    const out = typeof route === "function" ? route(bean) : route;
    if (out instanceof Error) throw out;
    if (out.returnCode !== undefined) return reply(out);
    return reply({ returnCode: "0", data: crypto.encryptBody(JSON.stringify(out)) });
  };
  const config = account === "own" ? { ...OWN } : {};
  const base = fakeKino({ config, fetch });
  const kino = Object.freeze({
    ...base,
    config: Object.freeze({
      get: (k) => (k === "useSharedAccount" ? account === "shared" : base.config.get(k)),
      all: () => ({ ...base.config.all(), useSharedAccount: account === "shared" }),
    }),
    log: (...a) => logs.push(a.map(String).join(" ")),
  });
  crypto = makeCrypto(kino);
  let session = null;
  const portal = makePortal({ kino, crypto, config: { hosts: [HOST], appId: "app.test", apkVersion: "9.9.9" }, clock, snProvider: () => session.current().sn });
  session = makeSession({ kino, portal, clock, random: () => 0, shared: SH });
  const acct = account === "shared" ? "shared" : account === "own" ? session.accountKey(OWN.email, OWN.password) : "";
  kino.storage.set("session", JSON.stringify({ userId: "acct-u", userToken: ACCT_TOKEN, jwtToken: "", sn: sessionSn, acct }));
  if (seeds) kino.storage.set("seeds", JSON.stringify(seeds));
  return {
    kino, clock, requests, logs, seedDownloads, portal, session,
    stored: () => JSON.parse(kino.storage.get("session")),
    seedRequests: (path) => requests.filter((r) => isSeed(r.bean) && (!path || r.path === path)),
  };
}

// The account relogs in to the same token (the portal may hand the same one back).
const routesWith = (extra) => ({ "v8/login": { userId: "acct-u", userToken: ACCT_TOKEN, jwtToken: "j" }, ...extra });
const onlySeeds = (answer, fail = GEO) => (bean) => (isSeed(bean) ? answer : fail);
const searchQuery = { q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 };
const kinoError = (code) => (e) => { assert.equal(e.name, "KinoError_" + code); return true; };
const noSecretsLogged = (t) => {
  const text = t.logs.join("\n");
  for (const s of [ACCT_TOKEN, ...SEEDS.flatMap((e) => [e.sn, e.userToken])]) assert.ok(!text.includes(s), "logged " + s);
};

// ---- search ------------------------------------------------------------------------------------

test("shared account + geo-blocked search: retried with a seed, stored session stays the shared account", async () => {
  const t = harness({ routes: routesWith({ "v3/searchByName": onlySeeds(searchAnswer) }) });
  const { search } = makeSearch({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  const out = await search(searchQuery);
  assert.equal(out[0].id, "D1");
  const seedCalls = t.seedRequests("v3/searchByName");
  assert.equal(seedCalls.length, 1);
  const pick = SEEDS.find((e) => e.userToken === seedCalls[0].bean.userToken);
  assert.ok(pick, "a pool seed");
  assert.equal(seedCalls[0].bean.userId, pick.userId, "the seed's userId");
  assert.equal(seedCalls[0].bean.sn, pick.sn, "the seed's sn in the device dict");
  const s = t.stored();
  assert.equal(s.acct, "shared");
  assert.equal(s.sn, "sn-dev");
  assert.equal(s.userToken, ACCT_TOKEN);
  assert.equal(t.session.regionBlocked(), true, "the geo-block still flags the region");
  assert.equal(t.session.seedsExhausted(), false);
  assert.equal(t.session.kind(), "account");
  assert.ok(t.logs.some((l) => /seed_fallback|shared_seed/.test(l)), "one counts-only log line");
  noSecretsLogged(t);
});

// ---- episodes ----------------------------------------------------------------------------------

test("shared account + dead after reauth on episodes: a seed answers, nothing stored changes", async () => {
  const t = harness({ routes: routesWith({ "v4/getItemData": onlySeeds(detailAnswer, DEAD) }) });
  const chapters = makePortalChapters({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  const out = await chapters("SERIE");
  assert.equal(out.items[0].contentId, "EP1");
  assert.ok(t.requests.some((r) => r.path === "v8/login"), "reauth ran first");
  assert.equal(t.seedRequests("v4/getItemData").length, 1);
  const s = t.stored();
  assert.deepEqual([s.acct, s.sn, s.userToken], ["shared", "sn-dev", ACCT_TOKEN]);
  assert.equal(t.session.regionBlocked(), false, "a dead token alone does not flag the region on the account path");
  assert.equal(t.session.seedsExhausted(), false);
  noSecretsLogged(t);
});

// ---- VOD resolve and the SLB cache ----------------------------------------------------------------

test("shared account + dead VOD resolve: startPlayVOD and getSlbInfo both run on the seed; the SLB cache never crosses sessions", async () => {
  let accountWorks = true;
  const byWho = (answer) => (bean) => (isSeed(bean) ? answer(bean.userToken) : accountWorks ? answer("acct") : DEAD);
  const t = harness({ routes: routesWith({
    "v10/startPlayVOD": byWho(() => playAnswer),
    "v14/getSlbInfo": byWho((who) => slbAnswer(who)),
  }) });
  const { resolve } = makeResolve({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock, config: { appId: "app.test", apkVersion: "9.9.9" }, portalChapters: async () => ({ items: [] }) });
  const slbCalls = () => t.requests.filter((r) => r.path === "v14/getSlbInfo");

  const a = await resolve("magis1:movie:0:M1");
  assert.match(a.headers["Content-Auth"], /token=acct&/);
  assert.equal(slbCalls().length, 1);

  accountWorks = false;
  const b = await resolve("magis1:movie:0:M1");
  const seedPlay = t.seedRequests("v10/startPlayVOD");
  assert.equal(seedPlay.length, 1);
  const seedTok = seedPlay[0].bean.userToken;
  assert.match(b.headers["Content-Auth"], new RegExp(`token=${seedTok}&`), "the seed's own CDN auth, not the account's cached one");
  assert.equal(slbCalls().length, 2);
  assert.equal(slbCalls()[1].bean.userToken, seedTok);
  assert.equal(slbCalls()[1].bean.sn, seedPlay[0].bean.sn);

  accountWorks = true;
  const c = await resolve("magis1:movie:0:M1");
  assert.match(c.headers["Content-Auth"], /token=acct&/, "the account never gets the seed's SLB");
  const s = t.stored();
  assert.deepEqual([s.acct, s.sn, s.userToken], ["shared", "sn-dev", ACCT_TOKEN]);
  noSecretsLogged(t);
});

// ---- home ----------------------------------------------------------------------------------------

test("shared account + geo-blocked home: the roots come from seeds", async () => {
  const t = harness({ routes: routesWith({ getNextColumns: onlySeeds(treeAnswer) }) });
  const catalog = makeCatalog({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  const rows = await catalog.home();
  assert.ok(rows.length > 0);
  assert.ok(t.seedRequests("getNextColumns").length >= 1);
  assert.equal(t.stored().acct, "shared");
});

// ---- who never uses it -------------------------------------------------------------------------------

test("own account + geo-blocked: no seed attempt (unchanged)", async () => {
  const t = harness({ account: "own", routes: routesWith({ "v3/searchByName": onlySeeds(searchAnswer) }) });
  const { search } = makeSearch({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  await assert.rejects(search(searchQuery), kinoError("geo_blocked"));
  assert.equal(t.seedRequests().length, 0);
  assert.equal(t.seedDownloads.length, 0);
});

test("no account + geo-blocked: today's path (the stored session switches to a seed)", async () => {
  const t = harness({ account: "none", routes: routesWith({ "v3/searchByName": onlySeeds(searchAnswer) }) });
  const { search } = makeSearch({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  const out = await search(searchQuery);
  assert.equal(out[0].id, "D1");
  assert.ok(t.stored().userToken.startsWith("seedtok"), "the old switchToBackup swap, as before");
  assert.ok(!t.logs.some((l) => /seed_fallback|shared_seed/.test(l)), "not the per-call fallback");
});

test("live open with the shared account geo-blocked: no seed attempt", async () => {
  const t = harness({ routes: routesWith({ "v4/startPlayLive": onlySeeds({ liveAddressList: [{ playCode: "pc", license: "L" }] }) }) });
  const live = makeLive({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock, config: { appId: "app.test", apkVersion: "9.9.9" }, random: () => 0 });
  await assert.rejects(live.resolveLive("CH1"), kinoError("geo_blocked"));
  assert.equal(t.seedRequests().length, 0);
  assert.equal(t.stored().acct, "shared");
});

// ---- pool and limits -----------------------------------------------------------------------------------

test("empty pool: one refresh attempt, then the original error", async () => {
  const t = harness({ seeds: null, routes: routesWith({ "v3/searchByName": GEO }) });
  const { search } = makeSearch({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  await assert.rejects(search(searchQuery), kinoError("geo_blocked"));
  assert.equal(t.seedDownloads.length, 1, "refreshed once");
  assert.equal(t.seedRequests().length, 0);
});

test("empty pool that the refresh fills: the downloaded seed answers", async () => {
  const t = harness({ seeds: null, seedsText: JSON.stringify(SEEDS.slice(0, 1)), routes: routesWith({ "v3/searchByName": onlySeeds(searchAnswer) }) });
  const { search } = makeSearch({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  assert.equal((await search(searchQuery))[0].id, "D1");
  assert.equal(t.seedDownloads.length, 1);
  assert.equal(t.stored().acct, "shared");
});

test("all seeds fail: at most 3 distinct ones are tried, then the original error (the shared account's: generic unavailable)", async () => {
  const dup = [...SEEDS, SEEDS[0], SEEDS[1], SEEDS[0]];
  const t = harness({ seeds: dup, routes: routesWith({ "v4/getItemData": DEAD }) });
  const chapters = makePortalChapters({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  await assert.rejects(chapters("SERIE"), kinoError("unavailable"));
  const tried = t.seedRequests("v4/getItemData").map((r) => r.bean.sn);
  assert.equal(tried.length, 3);
  assert.equal(new Set(tried).size, 3, "distinct");
  for (const r of t.seedRequests()) assert.equal(r.bean.userId, SEEDS.find((e) => e.sn === r.bean.sn).userId);
  const s = t.stored();
  assert.deepEqual([s.acct, s.sn, s.userToken], ["shared", "sn-dev", ACCT_TOKEN]);
  assert.equal(t.session.seedsExhausted(), false, "per-call attempts never mark the pool exhausted");
  noSecretsLogged(t);
});

test("a seed that answers with another portal error wins: that error, no more seeds", async () => {
  const t = harness({ routes: routesWith({ "v3/searchByName": onlySeeds({ returnCode: "portal100004", errorMessage: "不存在" }) }) });
  const { search } = makeSearch({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  await assert.rejects(search(searchQuery), kinoError("not_found"));
  // Search retries the full title once when nothing comes back: one seed per portal query.
  assert.equal(t.seedRequests("v3/searchByName").length, 1);
});

test("budget: a slow portal stops inside the resolve budget with the original error", async () => {
  const t = harness({ stepMs: 4000, routes: routesWith({ "v10/startPlayVOD": GEO, "v14/getSlbInfo": slbAnswer("x") }) });
  const { resolve } = makeResolve({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock, config: { appId: "app.test", apkVersion: "9.9.9" }, portalChapters: async () => ({ items: [] }) });
  const t0 = t.clock.now();
  await assert.rejects(resolve("magis1:movie:0:M1"), kinoError("geo_blocked"));
  assert.ok(t.clock.now() - t0 <= 20_000, `ran ${t.clock.now() - t0} ms`);
  assert.ok(t.seedRequests().length >= 1, "seeds were tried while time was left");
  assert.ok(t.seedRequests().length < 3, "and stopped when it ran out");
  for (const r of t.seedRequests()) assert.ok(r.at + r.timeoutMs <= t0 + 20_000, "no seed request may run past the budget");
});
