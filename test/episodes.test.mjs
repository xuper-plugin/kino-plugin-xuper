import test from "node:test";
import { fixturesDir } from "./helpers/fixtures.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput } from "../sdk/contract.mjs";
import { makeCatalog } from "../src/catalog.js";
import { parseSeasonList, isGenericTitle } from "../src/episodes.js";
import { makeTmdb, parseSeriesByImdb, parseSeasonEpisodes } from "../src/tmdb.js";
import { PortalError } from "../src/portal.js";
import { decode } from "../src/refs.js";

const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);
const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const bytes = (s) => Buffer.byteLength(s, "utf8");

// ---- fixtures ---------------------------------------------------------------------------------

const chapter = (n, extra = {}) => ({ seriesNumber: String(n), contentId: `EP${n}`, name: `Capitulo ${n}`, ...extra });
// A v4/getItemData answer as the portal sends it.
const detail = ({ imdb = "", seasons = [], volumnCount = undefined, chapters = [chapter(1), chapter(2, { name: "" })], extra = {} } = {}) => ({
  assetData: { keyWords: imdb, volumnCount: volumnCount ?? String(chapters.length), sameSeasonSeriesList: seasons, simpleProgramList: chapters, ...extra },
});
const SERIES = "magis1:teleplay:0:SERIE";

function fakePortal(queue = []) {
  const calls = [];
  const pending = [...queue];
  return {
    calls,
    queue: (v) => pending.push(v),
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      if (pending.length === 0) throw new Error("unscripted portal call " + path);
      const a = pending.shift();
      const v = typeof a === "function" ? a(bean) : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function fakeSession({ ensureError = null } = {}) {
  const s = { ensures: 0, blocks: 0 };
  s.ensure = async () => { s.ensures++; if (ensureError) throw ensureError; };
  s.withValidSession = async (block) => { s.blocks++; return block({ userId: "u1", userToken: "tok1" }); };
  return s;
}

// kino over the kit's real storage with spies (and an optional failure) on storage.set; the TMDB
// secret and fetch are scripted per test.
function spyKino({ failSet = false, tmdbFetch = null, secret = () => "KEYMARKER" } = {}) {
  const base = fakeKino();
  const sets = [];
  const storage = Object.freeze({
    ...base.storage,
    set: (k, v, o) => {
      sets.push({ k, v, o });
      if (failSet) throw new Error("quota");
      return base.storage.set(k, v, o);
    },
  });
  const fetch = tmdbFetch ?? (async () => { throw new Error("unscripted fetch"); });
  return { kino: Object.freeze({ ...base, storage, secret, fetch }), sets };
}

// A fake TMDB over kino.fetch: bodies keyed by `path@language` (the es-MX and en-US season calls share a path).
function tmdbWorld(bodies = {}) {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    const key = `${u.pathname}@${u.searchParams.get("language")}`;
    calls.push(key);
    const c = bodies[key] ?? { code: 404, body: "{}" };
    return { ok: c.code >= 200 && c.code < 300, status: c.code, text: () => (typeof c.body === "string" ? c.body : JSON.stringify(c.body)) };
  };
  return { calls, fetch };
}

function setup({ queue = [], ensureError, tmdb = undefined, failSet = false, bodies = null, now = NOW } = {}) {
  const world = tmdbWorld(bodies ?? {});
  const { kino, sets } = spyKino({ failSet, tmdbFetch: world.fetch });
  const portal = fakePortal(queue);
  const session = fakeSession({ ensureError });
  const clock = { t: now, now() { return this.t; } };
  const catalog = makeCatalog({ kino, portal, session, clock, tmdb: tmdb === undefined ? makeTmdb({ kino }) : tmdb });
  return { kino, portal, session, clock, catalog, sets, world, cacheSets: () => sets.filter((s) => s.k === "chapters:v1") };
}

const find = (imdbBody) => ({ code: 200, body: imdbBody });
const FIND = (imdb) => `/3/find/${imdb}@es-MX`;
const tvHit = (id, name = "Serie TMDB") => ({ tv_results: [{ id, name, poster_path: "/p.jpg", backdrop_path: "/b.jpg" }] });
const season = (...eps) => ({ code: 200, body: { episodes: eps } });
const tep = (n, name, overview, still) => ({ episode_number: n, name, overview, still_path: still });

// ---- parseSeasonList (SeasonListTest.kt) ------------------------------------------------------

test("parseSeasonList: an empty or missing list is season 1 (a single-season series)", () => {
  assert.deepEqual(parseSeasonList([], "c1"), { own: 1, all: [] });
  assert.deepEqual(parseSeasonList(undefined, "c1"), { own: 1, all: [] });
  assert.deepEqual(parseSeasonList("nope", "c1"), { own: 1, all: [] });
});

test("parseSeasonList: a multi-season series lists every season including its own, by number", () => {
  const out = parseSeasonList([{ contentId: "c3", seasonNumber: 3 }, { contentId: "c1", seasonNumber: 1 }, { contentId: "c2", seasonNumber: "2" }], "c2");
  assert.deepEqual(out, { own: 2, all: [{ id: "c1", number: 1 }, { id: "c2", number: 2 }, { id: "c3", number: 3 }] });
});

test("parseSeasonList: a list that does not include this season leaves it unknown (never guesses 1)", () => {
  assert.deepEqual(parseSeasonList([{ contentId: "c8", seasonNumber: 1 }], "c1"), { own: null, all: [{ id: "c8", number: 1 }] });
});

test("parseSeasonList: malformed entries are dropped, an unreadable own number stays unknown", () => {
  const list = [{ contentId: "", seasonNumber: 1 }, { contentId: "c4" }, { contentId: "c5", seasonNumber: "x" }, null, "z", { contentId: "c1", seasonNumber: 1 }];
  assert.deepEqual(parseSeasonList(list, "c1"), { own: 1, all: [{ id: "c1", number: 1 }] });
  assert.deepEqual(parseSeasonList([{ contentId: "c1", seasonNumber: "x" }, { contentId: "c2", seasonNumber: 2 }], "c1"), { own: null, all: [{ id: "c2", number: 2 }] });
});

// ---- src/tmdb.js ------------------------------------------------------------------------------

test("parseSeriesByImdb: first tv result with a positive id; images at w500/w1280; junk is null", () => {
  assert.deepEqual(parseSeriesByImdb(JSON.stringify(tvHit(12))), { tmdbId: 12, title: "Serie TMDB", poster: "https://image.tmdb.org/t/p/w500/p.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/b.jpg" });
  assert.deepEqual(parseSeriesByImdb(JSON.stringify({ tv_results: [{ id: "7", name: "S", poster_path: null, backdrop_path: "" }] })), { tmdbId: 7, title: "S", poster: "", backdrop: "" });
  for (const bad of ["<html>", "[]", "{}", JSON.stringify({ tv_results: [] }), JSON.stringify({ tv_results: [{ id: 0 }] }), JSON.stringify({ tv_results: ["x"] })]) assert.equal(parseSeriesByImdb(bad), null, bad);
});

test("parseSeasonEpisodes: null = unanswerable, [] = answered with none, blank names read 'Episodio N', stills at w300", () => {
  assert.equal(parseSeasonEpisodes("<html>"), null);
  assert.equal(parseSeasonEpisodes("[]"), null);
  assert.deepEqual(parseSeasonEpisodes("{}"), []);
  assert.deepEqual(parseSeasonEpisodes(JSON.stringify({ episodes: [tep(1, "", "o", "/s.jpg"), 5, tep(2, "Dos", null, null)] })), [
    { episode: 1, name: "Episodio 1", overview: "o", still: "https://image.tmdb.org/t/p/w300/s.jpg", airDate: "", runtimeMinutes: 0 },
    { episode: 2, name: "Dos", overview: "", still: "", airDate: "", runtimeMinutes: 0 },
  ]);
});

test("parseSeasonEpisodes: air_date (YYYY-MM-DD only) and runtime (1..1000) ride along; kino.tmdb's parsed object reads like the text", () => {
  const body = { episodes: [
    { episode_number: 1, name: "Uno", air_date: "2011-04-17", runtime: 57 },
    { episode_number: 2, name: "Dos", air_date: "2011", runtime: 0 },
    { episode_number: 3, name: "Tres", air_date: null, runtime: "45" },
    { episode_number: 4, name: "Cuatro", air_date: "17/04/2011", runtime: 5000 },
  ] };
  const fromText = parseSeasonEpisodes(JSON.stringify(body));
  assert.deepEqual(fromText.map((e) => [e.airDate, e.runtimeMinutes]), [["2011-04-17", 57], ["", 0], ["", 45], ["", 0]]);
  assert.deepEqual(parseSeasonEpisodes(body), fromText, "an object (kino.tmdb) parses exactly like its text (kino.fetch)");
  assert.deepEqual(parseSeriesByImdb(tvHit(12)), parseSeriesByImdb(JSON.stringify(tvHit(12))));
  assert.equal(parseSeasonEpisodes(null), null);
  assert.equal(parseSeasonEpisodes([]), null);
});

test("isGenericTitle: a name that only numbers the chapter (the portal's usual ones included), never a real title", () => {
  for (const t of ["", "  ", "3", "001", "Capítulo 3", "CAPITULO 03", "Episodio 7", "Cap. 2", "Ep 4", "E05", "Chapter 1", "Episode 12",
    "Nada Miniserie_1", "One Piece T1_8", "La Rosa de Guadalupe T17_153", "La voz kids Colombia 2021_La voz kids Colombia 2021-01", null]) {
    assert.equal(isGenericTitle(t), true, String(t));
  }
  for (const t of ["El secreto", "Capítulo final", "3 - Inicio", "La casa de papel Temporada 5_La casa de Papel TEMPORADA 5 - Tráiler Español", "Foo_bar 2"]) {
    assert.equal(isGenericTitle(t), false, t);
  }
});

test("makeTmdb reads: the secret MARKER in the query, the right paths, es-MX default, language override, silent failures", async () => {
  const urls = [];
  const kino = { ...fakeKino(), secret: () => "KEYMARKER", fetch: async (url, opts) => { urls.push([url, opts]); return { ok: true, status: 200, text: () => JSON.stringify({ tv_results: [{ id: 3 }], episodes: [] }) }; } };
  const tmdb = makeTmdb({ kino });
  assert.equal((await tmdb.seriesByImdb("tt1234567")).tmdbId, 3);
  assert.deepEqual(await tmdb.seasonEpisodes(3, 2), []);
  assert.deepEqual(await tmdb.seasonEpisodes(3, 2, "en-US"), []);
  const parsed = urls.map(([u]) => new URL(u));
  assert.deepEqual(parsed.map((u) => u.origin + u.pathname), ["https://api.themoviedb.org/3/find/tt1234567", "https://api.themoviedb.org/3/tv/3/season/2", "https://api.themoviedb.org/3/tv/3/season/2"]);
  assert.deepEqual(parsed.map((u) => u.searchParams.get("language")), ["es-MX", "es-MX", "en-US"]);
  assert.equal(parsed[0].searchParams.get("external_source"), "imdb_id");
  for (const u of parsed) assert.equal(u.searchParams.get("api_key"), "KEYMARKER");
  for (const [, o] of urls) assert.equal(o.cookies, false);
  // No key, a failing request, junk, bad input: always null, never a throw, no request without a key.
  let fetched = 0;
  const count = async () => { fetched++; return { ok: true, status: 200, text: () => "{}" }; };
  const noKey = makeTmdb({ kino: { ...fakeKino(), secret: () => { throw new Error("undeclared"); }, fetch: count } });
  assert.equal(await noKey.seriesByImdb("tt1234567"), null);
  assert.equal(await noKey.seasonEpisodes(3, 1), null);
  assert.equal(fetched, 0);
  const net = makeTmdb({ kino: { ...fakeKino(), secret: () => "K", fetch: async () => { throw new Error("net"); } } });
  assert.equal(await net.seriesByImdb("tt1234567"), null);
  assert.equal(await net.seasonEpisodes(3, 1), null);
  const bad = makeTmdb({ kino: { ...fakeKino(), secret: () => "K", fetch: count } });
  for (const id of ["", "tt12", "TT1234567", "tt1234567x", null, 5]) assert.equal(await bad.seriesByImdb(id), null);
  assert.equal(await bad.seasonEpisodes(0, 1), null);
  assert.equal(await bad.seasonEpisodes("3", 1), null);
  assert.equal(fetched, 0, "bad input never makes a request");
});

// ---- the chapter listing ----------------------------------------------------------------------

test("chapters: number, name (blank -> 'Capítulo N') and chapter ref; no imdb means no series block and no TMDB call", async () => {
  const t = setup({ queue: [detail({ imdb: "" })] });
  const out = await t.catalog.episodes(SERIES);
  assert.deepEqual(out.episodes.map((e) => e.number), [1, 2]);
  assert.deepEqual(out.episodes.map((e) => e.title), ["Capitulo 1", "Capítulo 2"]);
  assert.deepEqual(out.episodes.map((e) => e.ref), ["magis1:teleplay:1:SERIE", "magis1:teleplay:2:SERIE"]);
  assert.equal(decode(out.episodes[1].ref).episode, 2);
  assert.ok(!("series" in out));
  assert.ok(!("seasons" in out));
  assert.deepEqual(t.world.calls, []);
  for (const e of out.episodes) assert.ok(!("still" in e) && !("tmdbTitle" in e) && !("overview" in e));
});

test("the portal call: v4/getItemData with the exact bean, baseFields, the session's credentials, ensure() first", async () => {
  const t = setup({ queue: [detail()] });
  await t.catalog.episodes(SERIES);
  assert.equal(t.portal.calls.length, 1);
  const [c] = t.portal.calls;
  assert.equal(c.path, "v4/getItemData");
  assert.deepEqual(c.bean, { contentId: "SERIE", type: "0", sortType: "0", language: "en", macAddr: "02:00:00:00:00:00" });
  assert.deepEqual(c.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
  assert.equal(t.session.ensures, 1);
});

test("a ref that is not Xuper's is unavailable with the native text, before any portal call", async () => {
  const t = setup();
  for (const ref of ["https://example.com/video.mp4", "", null, undefined, "magis1:movie:0"]) {
    await assert.rejects(() => t.catalog.episodes(ref), (e) => e.code === "unavailable" && e.message === "ese ref no es de Xuper: no se pueden listar capítulos");
  }
  assert.equal(t.portal.calls.length, 0);
  assert.equal(t.session.ensures, 0);
});

test("an Ok answer without assetData is unavailable with the native text", async () => {
  for (const body of [{}, { assetData: null }, { assetData: "x" }, []]) {
    const t = setup({ queue: [body] });
    await assert.rejects(() => t.catalog.episodes(SERIES), (e) => e.code === "unavailable" && e.message === "Xuper devolvió una capítulos sin datos");
  }
});

test("portal errors map: not found, geo-blocked (synthetic), auth, anything else unavailable; a network failure is unavailable", async () => {
  const cases = [
    [new PortalError("portal100004", "x"), "not_found"],
    [new PortalError("portal1", "内容不存在"), "not_found"],
    [new PortalError("portal100024", "blocked"), "geo_blocked"],
    [new PortalError("aaa100027", "x"), "auth_required"],
    [new PortalError("portal999", "x"), "unavailable"],
    [new Error("timeout"), "unavailable"],
  ];
  for (const [error, code] of cases) {
    const t = setup({ queue: [error] });
    await assert.rejects(() => t.catalog.episodes(SERIES), (e) => e.code === code, code);
    assert.equal(t.cacheSets().length, 0);
  }
});

test("a failing ensure() surfaces as the mapped error and no portal call is made", async () => {
  let t = setup({ ensureError: new PortalError("aaa100027", "no"), queue: [detail()] });
  await assert.rejects(() => t.catalog.episodes(SERIES), (e) => e.code === "auth_required");
  assert.equal(t.portal.calls.length, 0);
  t = setup({ ensureError: new Error("net"), queue: [detail()] });
  await assert.rejects(() => t.catalog.episodes(SERIES), (e) => e.code === "unavailable");
  assert.equal(t.portal.calls.length, 0);
});

test("a chapter whose seriesNumber does not parse is number 0 with a ref for 0 (native); the SDK then keeps only the valid ones", async () => {
  const chapters = [chapter(1), { seriesNumber: "abc", contentId: "X", name: "Especial" }, { contentId: "Y", name: "" }, { seriesNumber: " 3", contentId: "Z" }, chapter(4, { seriesNumber: 4 }), chapter(5, { seriesNumber: "05" })];
  const t = setup({ queue: [detail({ chapters })] });
  const out = await t.catalog.episodes(SERIES);
  assert.deepEqual(out.episodes.map((e) => e.number), [1, 0, 0, 0, 4, 5]);
  assert.equal(out.episodes[1].ref, "magis1:teleplay:0:SERIE");
  assert.equal(out.episodes[2].title, "Capítulo 0");
  const checked = checkOutput("episodes", out, manifest);
  assert.deepEqual(checked.value.episodes.map((e) => e.number), [1, 4, 5], "number 0 is not an SDK episode and is dropped by its contract reader");
});

// ---- TMDB enrichment --------------------------------------------------------------------------

test("imdb + known season + matching count: still, name and synopsis from TMDB, and the series block", async () => {
  const t = setup({
    queue: [detail({ imdb: "tt0088509" })],
    bodies: {
      [FIND("tt0088509")]: find(tvHit(12, "Dragon Ball")),
      "/3/tv/12/season/1@es-MX": season(tep(1, "El secreto", "Sinopsis 1", "/s1.jpg"), tep(2, "La busqueda", "Sinopsis 2", "/s2.jpg")),
    },
  });
  const out = await t.catalog.episodes(SERIES);
  assert.deepEqual(out.episodes.map((e) => e.title), ["El secreto", "La busqueda"], "the portal's 'Capitulo 1' and blank name give way to TMDB's");
  assert.equal(out.episodes[0].overview, "Sinopsis 1");
  assert.equal(out.episodes[0].still, "https://image.tmdb.org/t/p/w300/s1.jpg");
  for (const e of out.episodes) assert.ok(!("tmdbTitle" in e), "no field outside the contract");
  assert.deepEqual(out.series, { ids: { imdb: "tt0088509", tmdb: 12 }, title: "Dragon Ball", poster: "https://image.tmdb.org/t/p/w500/p.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/b.jpg" });
  assert.deepEqual(out.episodes.map((e) => e.season), [1, 1], "empty season list = single season = the 1st");
  assert.deepEqual(t.world.calls, [FIND("tt0088509"), "/3/tv/12/season/1@es-MX"]);
});

test("the guard: a season TMDB splits differently gets no per-episode data, but the series block travels", async () => {
  const t = setup({
    queue: [detail({ imdb: "tt0088509" })],
    bodies: { [FIND("tt0088509")]: find(tvHit(12, "One Piece")), "/3/tv/12/season/1@es-MX": season(tep(1, "A", "", "/a.jpg"), tep(2, "B", "", "/b.jpg"), tep(3, "C", "", "/c.jpg")) },
  });
  const out = await t.catalog.episodes(SERIES);
  for (const e of out.episodes) assert.ok(!("still" in e) && !("tmdbTitle" in e) && !("airDate" in e));
  assert.deepEqual(out.episodes.map((e) => e.title), ["Capitulo 1", "Capítulo 2"], "the guard keeps the portal's names");
  assert.equal(out.series.ids.tmdb, 12);
  assert.equal(out.series.title, "One Piece");
  assert.deepEqual(t.world.calls, [FIND("tt0088509"), "/3/tv/12/season/1@es-MX"], "no en-US call when nothing was enriched");
});

test("an airing season: declared 3, published 2 - enriched with what is published; declared 0 falls back to the published count", async () => {
  const eps = season(tep(1, "A", "x", "/a.jpg"), tep(2, "B", "x", "/b.jpg"), tep(3, "C", "x", "/c.jpg"));
  let t = setup({ queue: [detail({ imdb: "tt0088509", volumnCount: "3" })], bodies: { [FIND("tt0088509")]: find(tvHit(12)), "/3/tv/12/season/1@es-MX": eps } });
  let out = await t.catalog.episodes(SERIES);
  assert.deepEqual(out.episodes.map((e) => e.title), ["A", "B"]);
  t = setup({ queue: [detail({ imdb: "tt0088509", volumnCount: "0" })], bodies: { [FIND("tt0088509")]: find(tvHit(12)), "/3/tv/12/season/1@es-MX": season(tep(1, "A", "x", "/a.jpg"), tep(2, "B", "x", "/b.jpg")) } });
  out = await t.catalog.episodes(SERIES);
  assert.deepEqual(out.episodes.map((e) => e.title), ["A", "B"]);
});

test("a synopsis TMDB lacks in Spanish is filled from en-US, and a Spanish one is never overwritten", async () => {
  const t = setup({
    queue: [detail({ imdb: "tt0088509" })],
    bodies: {
      [FIND("tt0088509")]: find(tvHit(12)),
      "/3/tv/12/season/1@es-MX": season(tep(1, "Uno", "", "/a.jpg"), tep(2, "Dos", "La que si estaba", "/b.jpg")),
      "/3/tv/12/season/1@en-US": season(tep(1, "One", "The english one", null), tep(2, "Two", "No deberia pisar", null)),
    },
  });
  const out = await t.catalog.episodes(SERIES);
  assert.equal(out.episodes[0].overview, "The english one");
  assert.equal(out.episodes[1].overview, "La que si estaba");
  assert.equal(out.episodes[0].title, "Uno");
  assert.deepEqual(t.world.calls, [FIND("tt0088509"), "/3/tv/12/season/1@es-MX", "/3/tv/12/season/1@en-US"]);
});

test("the en-US fallback is best-effort: when it fails the chapters still come out with what es-MX gave", async () => {
  const t = setup({
    queue: [detail({ imdb: "tt0088509" })],
    bodies: { [FIND("tt0088509")]: find(tvHit(12)), "/3/tv/12/season/1@es-MX": season(tep(1, "Uno", "", "/a.jpg"), tep(2, "Dos", "ya", "/b.jpg")) },
  });
  const out = await t.catalog.episodes(SERIES);
  assert.ok(!("overview" in out.episodes[0]));
  assert.equal(out.episodes[1].overview, "ya");
  assert.equal(out.episodes[0].still, "https://image.tmdb.org/t/p/w300/a.jpg");
});

test("an episode TMDB has nothing for (no still, name or synopsis) gets no extra fields", async () => {
  const t = setup({
    queue: [detail({ imdb: "tt0088509", chapters: [chapter(1), chapter(2)] })],
    bodies: { [FIND("tt0088509")]: find(tvHit(12)), "/3/tv/12/season/1@es-MX": { code: 200, body: { episodes: [{ episode_number: 1, name: "X", overview: "", still_path: null }, { episode_number: 2, name: "", overview: "", still_path: "" }] } } },
  });
  const out = await t.catalog.episodes(SERIES);
  assert.equal(out.episodes[0].title, "X");
  assert.equal(out.episodes[1].title, "Capitulo 2", "a blank TMDB name ('Episodio N') never replaces the portal's");
});

test("an unknown season (the list carries others) is never enriched, asks TMDB for nothing, and carries no season", async () => {
  const t = setup({
    queue: [detail({ imdb: "tt0088509", seasons: [{ contentId: "OTRA", seasonNumber: 5 }] })],
    bodies: { [FIND("tt0088509")]: find(tvHit(12)), "/3/tv/12/season/5@es-MX": season(tep(1, "No va", "", "/x.jpg")) },
  });
  const out = await t.catalog.episodes(SERIES);
  assert.ok(!("tmdbTitle" in out.episodes[0]) && !("season" in out.episodes[0]));
  assert.deepEqual(out.series, { ids: { imdb: "tt0088509" }, title: "", poster: "", backdrop: "" }, "no tmdb id when TMDB named none");
  assert.deepEqual(t.world.calls, []);
});

test("an imdb that is not tt + 7 digits is no imdb: no series block, no TMDB request", async () => {
  for (const imdb of ["tt123456", "x", "tt1234567a", " tt1234567"]) {
    const t = setup({ queue: [detail({ imdb })], bodies: {} });
    const out = await t.catalog.episodes(SERIES);
    assert.ok(!("series" in out), imdb);
    assert.deepEqual(t.world.calls, []);
  }
});

test("TMDB failing (network, no key, junk, unknown imdb, season 404) never fails the listing; the series block still travels", async () => {
  const failing = [
    { tmdbFetch: async () => { throw new Error("net"); } },
    { secret: () => { throw new Error("undeclared"); } },
    { tmdbFetch: async () => ({ ok: true, status: 200, text: () => "<html>" }) },
  ];
  for (const f of failing) {
    const { kino } = spyKino(f);
    const catalog = makeCatalog({ kino, portal: fakePortal([detail({ imdb: "tt0088509" })]), session: fakeSession(), clock: { now: () => NOW }, tmdb: makeTmdb({ kino }) });
    const out = await catalog.episodes(SERIES);
    assert.equal(out.episodes.length, 2);
    assert.deepEqual(out.series, { ids: { imdb: "tt0088509" }, title: "", poster: "", backdrop: "" });
  }
  // Season 404 keeps the series TMDB found.
  const t = setup({ queue: [detail({ imdb: "tt0088509" })], bodies: { [FIND("tt0088509")]: find(tvHit(12, "Hallada")) } });
  const out = await t.catalog.episodes(SERIES);
  assert.equal(out.series.ids.tmdb, 12);
  assert.equal(out.series.title, "Hallada");
  assert.ok(!("still" in out.episodes[0]));
});

test("a tmdb dependency that throws synchronously or is absent never fails the listing", async () => {
  for (const tmdb of [null, { seriesByImdb: () => { throw new Error("sync"); } }, { seriesByImdb: async () => { throw new Error("boom"); } }]) {
    const t = setup({ queue: [detail({ imdb: "tt0088509" })], tmdb });
    const out = await t.catalog.episodes(SERIES);
    assert.equal(out.episodes.length, 2);
    assert.ok(!("tmdb" in out.series.ids));
  }
});

// ---- seasons chips ----------------------------------------------------------------------------

test("seasons: sorted by number, this one flagged current, each ref is that season's own series ref (the request's programType), entries without a usable number dropped", async () => {
  const t = setup({ queue: [detail({ seasons: [{ contentId: "S3", seasonNumber: 3 }, { contentId: "SERIE", seasonNumber: "2" }, { contentId: "S1", seasonNumber: 1 }, { contentId: "SINNUM" }] })] });
  const out = await t.catalog.episodes("magis1:variety:0:SERIE");
  assert.deepEqual(out.seasons, [
    { id: "S1", ref: "magis1:variety:0:S1", title: "Temporada 1", number: 1, current: false },
    { id: "SERIE", ref: "magis1:variety:0:SERIE", title: "Temporada 2", number: 2, current: true },
    { id: "S3", ref: "magis1:variety:0:S3", title: "Temporada 3", number: 3, current: false },
  ]);
  assert.deepEqual(out.episodes.map((e) => e.season), [2, 2]);
  const checked = checkOutput("episodes", out, manifest);
  assert.equal(checked.value.seasons.length, 3);
});

test("seasons: a single-season series names none; at most 50 are listed", async () => {
  let t = setup({ queue: [detail({ seasons: [] })] });
  assert.ok(!("seasons" in await t.catalog.episodes(SERIES)));
  const many = Array.from({ length: 60 }, (_, i) => ({ contentId: "S" + (i + 1), seasonNumber: i + 1 }));
  t = setup({ queue: [detail({ seasons: many })] });
  const out = await t.catalog.episodes("magis1:teleplay:0:S7");
  assert.equal(out.seasons.length, 50);
  assert.equal(out.seasons[0].number, 1);
});

test("a legacy gateway ref decodes too, and the chapter refs are built from its content id", async () => {
  const legacy = Buffer.from(JSON.stringify({ s: "magis", p: { content_id: "LEG", program_type: "teleplay", episode: 0 } })).toString("base64url") + ".sig";
  const t = setup({ queue: [detail()] });
  const out = await t.catalog.episodes(legacy);
  assert.equal(t.portal.calls[0].bean.contentId, "LEG");
  assert.equal(out.episodes[0].ref, "magis1:teleplay:1:LEG");
});

test("output caps: at most 5000 episodes", async () => {
  const chapters = Array.from({ length: 5200 }, (_, i) => chapter(i + 1));
  const t = setup({ queue: [detail({ chapters })] });
  const out = await t.catalog.episodes(SERIES);
  assert.equal(out.episodes.length, 5000);
});

// ---- the chapter cache ------------------------------------------------------------------------

test("cache: a second listing within 6 h makes no portal call (not even ensure) and returns the same answer; at 6 h it refetches", async () => {
  const withSeasons = detail({ imdb: "tt0088509", seasons: [{ contentId: "SERIE", seasonNumber: 2 }, { contentId: "S3", seasonNumber: 3 }], volumnCount: "2" });
  const t = setup({ queue: [withSeasons, withSeasons], bodies: { [FIND("tt0088509")]: find(tvHit(12)), "/3/tv/12/season/2@es-MX": season(tep(1, "A", "x", "/a.jpg"), tep(2, "B", "x", "/b.jpg")) } });
  const first = await t.catalog.episodes(SERIES);
  t.clock.t += 6 * HOUR - 1;
  const second = await t.catalog.episodes(SERIES);
  assert.deepEqual(second, first);
  assert.equal(t.portal.calls.length, 1);
  assert.equal(t.session.ensures, 1);
  t.clock.t += 1;
  await t.catalog.episodes(SERIES);
  assert.equal(t.portal.calls.length, 2);
});

test("cache: one storage key `chapters:v1`, no ttlMs on it, one entry per series", async () => {
  const t = setup({ queue: [detail(), detail()] });
  await t.catalog.episodes(SERIES);
  await t.catalog.episodes("magis1:teleplay:0:OTRA");
  assert.deepEqual(t.kino.storage.keys().filter((k) => k.startsWith("chapters")), ["chapters:v1"]);
  for (const s of t.cacheSets()) assert.equal(s.o, undefined);
  assert.deepEqual(JSON.parse(t.kino.storage.get("chapters:v1")).e.map((e) => e.k), ["SERIE", "OTRA"]);
});

test("cache: an empty chapter list is never cached", async () => {
  const t = setup({ queue: [detail({ chapters: [] }), detail({ chapters: [] })] });
  assert.deepEqual((await t.catalog.episodes(SERIES)).episodes, []);
  await t.catalog.episodes(SERIES);
  assert.equal(t.portal.calls.length, 2);
  assert.equal(t.cacheSets().length, 0);
});

const realistic = (n, prefix = "Serie de ejemplo") => Array.from({ length: n }, (_, i) => ({
  seriesNumber: String(i + 1), contentId: (i + 1).toString(16).toUpperCase().padStart(32, "A"), name: `${prefix} T17_${String(i + 1).padStart(3, "0")}`, duration: "", quality: "HD", posterList: [{ fileType: "icon", fileUrl: "https://img1.cdn.example/p/x.jpg" }],
}));

test("cache: measured size of a 154-episode list; the key never exceeds 32,000 bytes; the oldest series is evicted first", async () => {
  const t = setup({ queue: Array.from({ length: 6 }, () => detail({ chapters: realistic(154) })) });
  const sizes = [];
  for (let n = 0; n < 6; n++) {
    await t.catalog.episodes(`magis1:teleplay:0:S${n}`);
    t.clock.t += 1000;
    const stored = t.kino.storage.get("chapters:v1");
    sizes.push(bytes(stored));
    assert.ok(bytes(stored) <= 32_000, `after ${n}: ${bytes(stored)}`);
  }
  const entries = JSON.parse(t.kino.storage.get("chapters:v1")).e;
  const one = bytes(JSON.stringify({ v: 1, e: [entries[0]] }));
  console.log(`# one 154-episode entry: ${one} bytes; key after 1..6 lists: ${sizes.join(", ")}; entries kept: ${entries.length}`);
  assert.ok(entries.length >= 2 && entries.length < 6);
  assert.equal(entries.at(-1).k, "S5");
  assert.ok(!entries.some((e) => e.k === "S0"));
});

test("cache: a list that alone exceeds 32,000 bytes is not cached, evicts nothing, and the call still succeeds", async () => {
  const t = setup({ queue: [detail({ chapters: realistic(20) }), detail({ chapters: realistic(600, "Un nombre de capitulo bastante largo para pesar") }), detail({ chapters: realistic(600, "Un nombre de capitulo bastante largo para pesar") })] });
  await t.catalog.episodes("magis1:teleplay:0:SMALL");
  const out = await t.catalog.episodes("magis1:teleplay:0:HUGE");
  assert.equal(out.episodes.length, 600);
  assert.ok(bytes(JSON.stringify({ v: 1, e: [{ k: "HUGE", s: NOW, i: { big: "x".repeat(32_000) } }] })) > 32_000);
  assert.deepEqual(JSON.parse(t.kino.storage.get("chapters:v1")).e.map((e) => e.k), ["SMALL"]);
  await t.catalog.episodes("magis1:teleplay:0:HUGE");
  assert.equal(t.portal.calls.length, 3, "the huge one refetches");
});

test("cache: a storage that throws on set (quota) never fails the call", async () => {
  const t = setup({ failSet: true, queue: [detail()] });
  assert.equal((await t.catalog.episodes(SERIES)).episodes.length, 2);
  assert.ok(t.cacheSets().length >= 1, "it did try to write");
});

test("cache: a corrupt or foreign stored value reads as a miss", async () => {
  for (const junk of ["not json", "{}", '{"v":2,"e":[]}', '{"v":1,"e":[{"k":"SERIE","s":1}]}', "[]", JSON.stringify({ v: 1, e: [{ k: "SERIE", s: NOW, i: { e: "no" } }] })]) {
    const t = setup({ queue: [detail()] });
    t.kino.storage.set("chapters:v1", junk);
    assert.equal((await t.catalog.episodes(SERIES)).episodes.length, 2);
    assert.equal(t.portal.calls.length, 1, junk);
  }
});

test("cache: the chapter lookup Task 5 needs - portalChapters keeps contentId, raw seriesNumber and duration, from the cache too", async () => {
  const { makePortalChapters, findChapter } = await import("../src/episodes.js");
  const t = setup({ queue: [detail({ chapters: [chapter(1, { duration: "1800" }), chapter(2), { seriesNumber: " 3 ", contentId: "EP3", name: "Tres" }] })] });
  const portalChapters = makePortalChapters({ kino: t.kino, portal: t.portal, session: t.session, clock: t.clock });
  for (let round = 0; round < 2; round++) {
    const raw = await portalChapters("SERIE");
    assert.equal(raw.items[0].contentId, "EP1");
    assert.equal(raw.items[0].duration, "1800");
    assert.equal(findChapter(raw.items, 2).contentId, "EP2");
    assert.equal(findChapter(raw.items, 3).contentId, "EP3", "the lookup trims, like native");
    assert.equal(findChapter(raw.items, 0).contentId, "EP1", "episode 0 is the first");
    assert.equal(findChapter(raw.items, 9), undefined);
  }
  assert.equal(t.portal.calls.length, 1);
});

// ---- the parity fixtures ----------------------------------------------------------------------
// episodes-1..10 were captured on a real device with the native implementation; they are git-excluded
// (real titles and hosts) and read by absolute path, never copied here.

const fixtureFiles = Array.from({ length: 10 }, (_, i) => `${fixturesDir}/episodes-${i + 1}.json`);

const canonical = (bean) => Object.keys(bean).sort().map((k) => `${k}=${bean[k]}`).join(",");
const sorted = (v) => {
  if (Array.isArray(v)) return `[${v.map(sorted).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${sorted(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
};

// What the device's GatewayEpisode/GatewaySeries held, rebuilt from the plugin shape (the Kotlin test's `rebuilt()`).
// 2.2.15 left two of its fields out of the plugin's answer (Kino never read them): `tmdbTitle` is the episode's
// `title` when the portal's only numbers the chapter, and the series' `seasonNumber` rides in each episode.
function rebuilt(data) {
  const episodes = data.episodes.map((e) => ({
    number: e.number, title: e.title, ref: e.ref, still: e.still ?? null, overview: e.overview ?? null, season: null,
  }));
  const series = data.series
    ? { imdbId: data.series.ids.imdb, tmdbId: data.series.ids.tmdb ?? 0, title: data.series.title, posterUrl: data.series.poster, backdropUrl: data.series.backdrop }
    : null;
  return { episodes, series };
}

// The native capture as 2.2.15 answers it: TMDB's name where the portal's is generic, no tmdbTitle, no seasonNumber.
function expectedNow(expected) {
  const episodes = expected.episodes.map(({ tmdbTitle, ...e }) => ({
    ...e, title: tmdbTitle && isGenericTitle(e.title) && !isGenericTitle(tmdbTitle) ? tmdbTitle : e.title,
  }));
  const series = expected.series ? (({ seasonNumber, ...s }) => s)(expected.series) : null;
  return { episodes, series };
}

const answerOf = (c) => {
  if (c.ok) return c.ok;
  if (c.portalError) return new PortalError(c.portalError.code, c.portalError.msg ?? "");
  return new Error(c.redError);
};

for (const [i, file] of fixtureFiles.entries()) {
  test(`parity: episodes-${i + 1}.json reproduces the device's captured answer, portal calls and TMDB calls`, async () => {
    const fixture = JSON.parse(readFileSync(file, "utf8"));
    const bodies = {};
    for (const c of fixture.tmdb) bodies[`${c.path}@${c.language}`] = { code: c.code, body: c.body };
    // The harness refused every call that would (re)activate a device: the fake session never makes those.
    const queue = fixture.portal.filter((c) => !c.blockedByHarness).map(answerOf);
    const t = setup({ queue, bodies });
    const request = fixture.request.ref;
    if (fixture.expected.error) {
      await assert.rejects(() => t.catalog.episodes(request), (e) => e.code === "not_found");
    } else {
      const out = await t.catalog.episodes(request);
      assert.equal(sorted(rebuilt(out)), sorted(expectedNow(fixture.expected)));
      // The contract reader takes the season from the EPISODES, so each must carry the series block's season.
      const seasonNumber = fixture.expected.series?.seasonNumber ?? 0;
      if (seasonNumber > 0) assert.deepEqual(out.episodes.map((e) => e.season), out.episodes.map(() => seasonNumber));
      const checked = checkOutput("episodes", out, manifest);
      assert.equal(checked.value.episodes.length, out.episodes.length, "the SDK contract keeps every episode");
      assert.deepEqual(checked.value.episodes.map((e) => [e.number, e.ref]), fixture.expected.episodes.map((e) => [e.number, e.ref]));
      if (fixture.expected.series) {
        assert.equal(checked.value.series.ids.imdb, fixture.expected.series.imdbId);
        assert.equal(checked.value.series.title, fixture.expected.series.title);
      }
    }
    const recorded = fixture.portal.filter((c) => !c.blockedByHarness);
    assert.deepEqual(t.portal.calls.map((c) => c.path + " " + canonical(c.bean)), recorded.map((c) => c.path + " " + canonical(c.bean)));
    assert.deepEqual(t.world.calls, fixture.tmdb.map((c) => `${c.path}@${c.language}`));
  });
}

test("parity: the captures cover the labelled cases (full + en-US fallback, guard refusal, no imdb, season missing, unknown imdb, not found, single-season list, declared over published, a season > 1)", () => {
  const labels = fixtureFiles.map((f) => JSON.parse(readFileSync(f, "utf8")).case);
  for (const want of ["full-tmdb-en-fallback", "full-tmdb", "no-imdb", "guard-refuses", "tmdb-season-missing", "tmdb-unknown-imdb", "not-found", "single-season-list", "declared-over-published"]) {
    assert.ok(labels.includes(want), want);
  }
  const seasons = fixtureFiles.map((f) => JSON.parse(readFileSync(f, "utf8")).expected.series?.seasonNumber ?? 0);
  assert.ok(seasons.some((s) => s > 1));
});

// ---- kino.tmdb (Kino 0.9.53+), with the sealed key as the fallback (2.2.15) -----------------------

test("kino.tmdb present: every read goes through it (path without a query, params apart, parsed JSON), never kino.fetch", async () => {
  const calls = [];
  let fetched = 0;
  const tmdbFn = async (path, params) => {
    calls.push([path, params]);
    if (path.startsWith("/find/")) return tvHit(12, "Dragon Ball");
    if (path === "/tv/12/season/1") return { episodes: [{ episode_number: 1, name: "El secreto", overview: "S1", still_path: "/s1.jpg", air_date: "1986-02-26", runtime: 24 }, { episode_number: 2, name: "La busqueda", overview: "S2", still_path: "/s2.jpg" }] };
    if (path === "/movie/603") return { title: "Matrix", original_title: "The Matrix", translations: { translations: [{ iso_639_1: "en", data: { title: "The Matrix" } }] } };
    throw new Error("unscripted " + path);
  };
  const kino = { ...fakeKino(), tmdb: tmdbFn, secret: () => "KEYMARKER", fetch: async () => { fetched++; throw new Error("no fetch"); } };
  const tmdb = makeTmdb({ kino });
  const catalog = makeCatalog({ kino, portal: fakePortal([detail({ imdb: "tt0088509" })]), session: fakeSession(), clock: { now: () => NOW }, tmdb });
  const out = await catalog.episodes(SERIES);
  assert.deepEqual(out.episodes.map((e) => e.title), ["El secreto", "La busqueda"]);
  assert.equal(out.episodes[0].airDate, "1986-02-26");
  assert.equal(out.episodes[0].runtimeMinutes, 24);
  assert.ok(!("airDate" in out.episodes[1]) && !("runtimeMinutes" in out.episodes[1]));
  assert.deepEqual(out.series.ids, { imdb: "tt0088509", tmdb: 12 });
  const forms = await tmdb.titleForms("movie", 603);
  assert.equal(forms.originalTitle, "The Matrix");
  assert.deepEqual(calls, [
    ["/find/tt0088509", { external_source: "imdb_id", language: "es-MX" }],
    ["/tv/12/season/1", { language: "es-MX" }],
    ["/movie/603", { language: "es-MX", append_to_response: "translations" }],
  ]);
  for (const [path] of calls) assert.ok(!path.includes("?"));
  assert.equal(fetched, 0);
  const checked = checkOutput("episodes", out, manifest);
  assert.equal(checked.value.episodes[0].airDate, "1986-02-26");
  assert.equal(checked.value.episodes[0].runtimeMinutes, 24);
});

test("kino.tmdb throwing (not_allowed, rate_limited, anything) or answering a non-object falls back to kino.fetch with the sealed key", async () => {
  for (const tmdbFn of [
    async () => { const e = new Error("not_allowed"); e.code = "not_allowed"; throw e; },
    async () => { throw new Error("rate_limited"); },
    () => { throw new Error("sync"); },
    async () => null,
  ]) {
    const world = tmdbWorld({ [FIND("tt0088509")]: find(tvHit(12, "Dragon Ball")), "/3/tv/12/season/1@es-MX": season(tep(1, "Uno", "x", "/a.jpg"), tep(2, "Dos", "y", "/b.jpg")) });
    const kino = { ...fakeKino(), tmdb: tmdbFn, secret: () => "KEYMARKER", fetch: world.fetch };
    const catalog = makeCatalog({ kino, portal: fakePortal([detail({ imdb: "tt0088509" })]), session: fakeSession(), clock: { now: () => NOW }, tmdb: makeTmdb({ kino }) });
    const out = await catalog.episodes(SERIES);
    assert.deepEqual(out.episodes.map((e) => e.title), ["Uno", "Dos"]);
    assert.deepEqual(world.calls, [FIND("tt0088509"), "/3/tv/12/season/1@es-MX"]);
  }
});

test("kino.tmdb absent (Kino before 0.9.53): the sealed-key kino.fetch path, the key in the query", async () => {
  const urls = [];
  const kino = { ...fakeKino(), secret: () => "KEYMARKER", fetch: async (url) => { urls.push(url); return { ok: true, status: 200, text: () => JSON.stringify({ tv_results: [{ id: 3 }] }) }; } };
  assert.equal(typeof kino.tmdb, "undefined");
  assert.equal((await makeTmdb({ kino }).seriesByImdb("tt1234567")).tmdbId, 3);
  const u = new URL(urls[0]);
  assert.equal(u.pathname, "/3/find/tt1234567");
  assert.equal(u.searchParams.get("api_key"), "KEYMARKER");
  assert.equal(u.searchParams.get("external_source"), "imdb_id");
});

test("the deadline rule holds for kino.tmdb too: under 500 ms left, TMDB is not asked at all", async () => {
  let asked = 0;
  const kino = { ...fakeKino(), tmdb: async () => { asked++; return tvHit(1); }, secret: () => "K", fetch: async () => { asked++; throw new Error("x"); } };
  const clock = { now: () => NOW };
  const tmdb = makeTmdb({ kino, clock });
  assert.equal(await tmdb.seriesByImdb("tt1234567", { deadline: NOW + 499 }), null);
  assert.equal(await tmdb.titleForms("movie", 603, { deadline: NOW + 100 }), null);
  assert.equal(asked, 0);
  assert.equal((await tmdb.seriesByImdb("tt1234567", { deadline: NOW + 5000 })).tmdbId, 1);
});
