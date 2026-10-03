// Every content export ends inside the app's cap (search 15 s, the rest 20 s) with a ~2 s margin,
// even when the first portal host is a black hole: the app counts a call it has to time out against
// the plugin and disables it after 3 in a row. The clock is injected; a dead host spends its whole
// request timeout. Everything runs through the real portal/session/catalog/resolve/live modules.
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld, SEEDS, ANSWERS, START } from "./helpers/portalWorld.mjs";
import { makeSection } from "../src/section.js";
import { makeCategories } from "../src/categories.js";

const CAP = { search: 15_000, other: 20_000 };
const MARGIN = 1_000; // the plugin must stop with at least this much of the cap left
const kinoErr = (code) => (e) => { assert.equal(e.name, "KinoError_" + code, e.message); return true; };
const within = (w, cap, what) => assert.ok(w.elapsed() <= cap - MARGIN, `${what} ran ${w.elapsed()} ms (cap ${cap})`);
const query = { q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 };

// The id of a home row, read once from a healthy portal (browse is asked for it on a cold cache).
let rowId = null;
async function firstRowId() {
  rowId ??= (await portalWorld().catalog.home())[0].id;
  return rowId;
}

// Each export kind, as plugin.js calls it.
const EXPORTS = {
  search: { cap: CAP.search, run: (w) => w.catalog.search(query), ok: (out) => assert.equal(out[0].id, "D1") },
  home: { cap: CAP.other, run: (w) => w.catalog.home(), ok: (out) => assert.ok(out.length > 0) },
  browse: { cap: CAP.other, run: async (w) => w.catalog.browse(await firstRowId(), null), ok: (out) => assert.ok(out.items.length > 0) },
  section: { cap: CAP.other, run: (w) => makeSection({ kino: w.kino, catalog: w.catalog, clock: w.clock }).section({ tab: "anime" }), ok: (out) => assert.ok(out.rows.length > 0) },
  categories: { cap: CAP.other, run: (w) => makeCategories({ catalog: w.catalog }).categories(null), ok: (out) => assert.ok(out.length > 0) },
  episodes: { cap: CAP.other, run: (w) => w.catalog.episodes("magis1:tv:0:SERIE"), ok: (out) => assert.equal(out.episodes.length, 1) },
  resolveVod: { cap: CAP.other, run: (w) => w.resolve.resolve("magis1:movie:0:M1"), ok: (out) => assert.match(out.url, /vod\.cdn\.test/) },
  resolveChapter: { cap: CAP.other, run: (w) => w.resolve.resolve("magis1:teleplay:1:SERIE"), ok: (out) => assert.match(out.url, /vod\.cdn\.test/) },
  liveCategories: { cap: CAP.other, run: (w) => w.live.liveCategories(), ok: (out) => assert.equal(out[0].title, "Noticias") },
  liveChannels: { cap: CAP.other, run: (w) => w.live.liveChannels({ categoryId: "7" }), ok: (out) => assert.equal(out.items[0].id, "CH1") },
  resolveLive: { cap: CAP.other, run: (w) => w.resolve.resolve("CH1"), ok: (out) => assert.equal(out.signing, "request") },
};

for (const [name, e] of Object.entries(EXPORTS)) {
  test(`${name}: a dead first host fails over to the second inside the cap`, async () => {
    const w = portalWorld({ dead: ["a.test"] });
    e.ok(await e.run(w));
    within(w, e.cap, name);
    assert.ok(w.requests.some((r) => r.host === "b.test"), "the second host was reached");
  });

  test(`${name}: every host dead ends in the plugin's own unavailable inside the cap`, async () => {
    const w = portalWorld({ dead: ["a.test", "b.test"] });
    // Every root failing makes home (and browse over it) throw too, so Home offers "Reintentar".
    await assert.rejects(e.run(w), kinoErr("unavailable"));
    within(w, e.cap, name);
  });

  test(`${name}: a fresh install (mint + activation inside the call) with a dead first host stays inside the cap`, async () => {
    const w = portalWorld({ dead: ["a.test"], session: null });
    e.ok(await e.run(w));
    within(w, e.cap, name);
    assert.ok(w.paths().includes("v3/snToken"), "the device was minted inside the call");
  });

  test(`${name}: a dead token (reauth inside the call) with a dead first host stays inside the cap`, async () => {
    // The stored token is dead for every content path: each one renews it, then answers.
    const routes = {};
    for (const p of ["v3/searchByName", "getNextColumns", "v4/getItemData", "v10/startPlayVOD", "v4/startPlayLive", "v6/getLiveData"]) {
      const base = ANSWERS[p];
      routes[p] = (bean) => (bean.userToken === "tok-dev" ? { returnCode: "aaa100027", errorMessage: "dead" }
        : typeof base === "function" ? base(bean) : base);
    }
    const w = portalWorld({ dead: ["a.test"], routes });
    e.ok(await e.run(w));
    within(w, e.cap, name);
    assert.ok(w.paths().includes("v8/active"), "the session was renewed inside the call");
  });
}

test("every host dead: no request is ever given more time than the call has left", async () => {
  for (const [name, e] of Object.entries(EXPORTS)) {
    const w = portalWorld({ dead: ["a.test", "b.test"], session: null, seeds: null, seedsDead: true });
    try { await e.run(w); } catch (_) { /* the error is checked above */ }
    within(w, e.cap, name);
    for (const r of w.requests) assert.ok(r.at - START + r.timeoutMs <= e.cap - 2_000, `${name}: ${r.path} at ${r.at - START} for ${r.timeoutMs}`);
  }
});

test("search: several sequential queries share one 13 s deadline", async () => {
  // Five title forms, every answer takes 4 s: without a shared deadline that is 20 s.
  const w = portalWorld({ aliveMs: 4_000 });
  const out = await w.catalog.search({ ...query, altTitles: ["Duna", "Dune Parte Uno", "Dune 2021", "Dune la pelicula"] });
  assert.equal(out[0].id, "D1", "what answered in time is served");
  within(w, CAP.search, "search");
  assert.ok(w.paths().filter((p) => p === "v3/searchByName").length < 5, "the queries after the deadline were not asked");
});

test("episodes: a dead TMDB never pushes the call past its cap", async () => {
  const routes = { "v4/getItemData": { assetData: { keyWords: "tt1234567", volumnCount: "1", sameSeasonSeriesList: [], simpleProgramList: [{ seriesNumber: "1", contentId: "EP1", name: "Capitulo 1" }] } } };
  const w = portalWorld({ dead: ["a.test"], routes, withTmdb: true, tmdbDead: true });
  const out = await w.catalog.episodes("magis1:tv:0:SERIE");
  assert.equal(out.episodes.length, 1);
  within(w, CAP.other, "episodes");
});

test("search: a dead TMDB leaves the portal time to answer", async () => {
  const w = portalWorld({ dead: ["a.test"], withTmdb: true, tmdbDead: true });
  const out = await w.catalog.search({ ...query, tmdbId: 438631, type: "movie" });
  assert.equal(out[0].id, "D1");
  within(w, CAP.search, "search");
});

test("resolve: a seed attempt never eats the time getSlbInfo needs after it", async () => {
  // The shared account is geo-blocked; seeds would answer; every request costs 4 s. The play, its
  // reauth and its seed attempts must stop 3 s before the deadline so getSlbInfo can still run.
  const SH = { email: "compartida@stand-in.test", password: "shared-stand-in-pw" };
  const geoUnlessSeed = (answer) => (bean) => (String(bean.userToken).startsWith("seedtok")
    ? (typeof answer === "function" ? answer(bean) : answer) : { returnCode: "portal100024", errorMessage: "geo" });
  const w = portalWorld({
    hosts: ["a.test"], aliveMs: 4_000, seeds: SEEDS, config: { useSharedAccount: true }, shared: SH,
    session: { userId: "u-sh", userToken: "tok-sh", jwtToken: "", sn: "sn-dev", acct: "shared" },
    routes: { "v10/startPlayVOD": geoUnlessSeed(ANSWERS["v10/startPlayVOD"]), "v14/getSlbInfo": geoUnlessSeed(ANSWERS["v14/getSlbInfo"]), "v8/login": { userId: "u-sh", userToken: "tok-sh" } },
  });
  await assert.rejects(w.resolve.resolve("magis1:movie:0:M1"), kinoErr("geo_blocked"));
  within(w, CAP.other, "resolve");
  for (const r of w.requests.filter((x) => x.path === "v10/startPlayVOD")) {
    assert.ok(r.at - START + r.timeoutMs <= 15_000, `a play request ran until ${r.at - START + r.timeoutMs} ms`);
  }
});

test("resolve: when a seed's play answers in time, its getSlbInfo still has its 3 s", async () => {
  const SH = { email: "compartida@stand-in.test", password: "shared-stand-in-pw" };
  const geoUnlessSeed = (answer) => (bean) => (String(bean.userToken).startsWith("seedtok")
    ? (typeof answer === "function" ? answer(bean) : answer) : { returnCode: "portal100024", errorMessage: "geo" });
  const w = portalWorld({
    hosts: ["a.test"], aliveMs: 3_000, seeds: SEEDS, config: { useSharedAccount: true }, shared: SH,
    session: { userId: "u-sh", userToken: "tok-sh", jwtToken: "", sn: "sn-dev", acct: "shared" },
    routes: { "v10/startPlayVOD": geoUnlessSeed(ANSWERS["v10/startPlayVOD"]), "v14/getSlbInfo": geoUnlessSeed(ANSWERS["v14/getSlbInfo"]), "v8/login": { userId: "u-sh", userToken: "tok-sh" } },
  });
  const out = await w.resolve.resolve("magis1:movie:0:M1");
  assert.match(out.headers["Content-Auth"], /token=x/);
  within(w, CAP.other, "resolve");
  const slb = w.requests.filter((r) => r.path === "v14/getSlbInfo");
  assert.ok(slb.at(-1).timeoutMs >= 3_000, `getSlbInfo had ${slb.at(-1).timeoutMs} ms`);
});

test("portal.call with a deadline already passed throws the plugin's unavailable without any request", async () => {
  const w = portalWorld();
  await assert.rejects(w.portal.call("v3/searchByName", {}, { deadline: w.clock.now() - 1 }), (e) => {
    assert.equal(e.name, "KinoError_unavailable");
    assert.equal(e.message, "No se pudo contactar a Xuper; intenta de nuevo en un momento");
    return true;
  });
  assert.equal(w.requests.length, 0);
});

test("portal.call with a deadline splits the time left between the hosts still to try", async () => {
  const w = portalWorld({ dead: ["a.test"] });
  await w.portal.call("v3/searchByName", {}, { deadline: w.clock.now() + 18_000 });
  assert.deepEqual(w.requests.map((r) => [r.host, r.timeoutMs]), [["a.test", 9_000], ["b.test", 9_000]]);
});

// ---- Task 18: the Home country row rides inside home's own cap ------------------------------------

const countryRoutes = {
  getNextColumns: (bean) => (bean.columnCode === "masnew_live"
    ? { recommendList: [{ columnId: 7, name: "Noticias" }, { columnId: 41, name: "Colombia" }] }
    : ANSWERS.getNextColumns(bean)),
};

test("home with a country row: a dead first host fails over and the row is there, inside the cap", async () => {
  const w = portalWorld({ dead: ["a.test"], config: { homeCountry: "CO" }, routes: countryRoutes });
  const rows = await w.catalog.home();
  assert.equal(rows.at(-1).id, "live-country");
  within(w, CAP.other, "home + country row");
});

test("home with a country row: every host dead is still the plugin's own unavailable inside the cap", async () => {
  const w = portalWorld({ dead: ["a.test", "b.test"], config: { homeCountry: "CO" }, routes: countryRoutes });
  await assert.rejects(w.catalog.home(), kinoErr("unavailable"));
  within(w, CAP.other, "home + country row");
  for (const r of w.requests) assert.ok(r.at - START + r.timeoutMs <= CAP.other - 2_000, `${r.path} at ${r.at - START} for ${r.timeoutMs}`);
});

test("home with a country row on a slow portal (4 s an answer): the VOD rows come inside the cap", async () => {
  const w = portalWorld({ aliveMs: 4_000, config: { homeCountry: "CO" }, routes: countryRoutes });
  const rows = await w.catalog.home();
  assert.ok(rows.some((r) => r.id !== "live-country"), "the VOD rows are served");
  within(w, CAP.other, "home + country row");
});
