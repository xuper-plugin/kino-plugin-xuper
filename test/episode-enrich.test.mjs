// The restored season grouping + TMDB enrichment on the NEW masnew path (src/catalog.js toEpisodes, src/episodeEnrich.js,
// src/tmdb.js, src/seasonRuns.js), ported from Xuper 2.x. The portal detail already carries the chapter list, the season
// number, the sibling seasons (sameSeasonSeriesList) and the IMDb id (keyWords); TMDB (through a fake kino.tmdb) adds the
// stills, real names and synopses. The season chips need no TMDB.
import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.kino = { lang: "es" };
const { toEpisodes } = await import("../src/catalog.js");
const { enrich, rawDetail, isGenericTitle } = await import("../src/episodeEnrich.js");
const { makeTmdb, parseSeriesByImdb, parseSeasonEpisodes, pickSeriesByTitle } = await import("../src/tmdb.js");
const { parseSeasonCounts, pickSeasonRun } = await import("../src/seasonRuns.js");

/** A fake kino.tmdb routed by path; `season1` is /tv/42/season/1 (es-MX), `season1En` its en-US. */
function fakeTmdb({ find = null, tv = null, season = {} } = {}) {
  globalThis.kino.tmdb = async (path, params) => {
    if (path.startsWith("/find/")) return find;
    if (/^\/tv\/\d+$/.test(path)) return tv;
    const m = /^\/tv\/\d+\/season\/(\d+)$/.exec(path);
    if (m) { const key = params && params.language === "en-US" ? `${m[1]}en` : m[1]; return season[key] ?? null; }
    return null;
  };
}

// ── src/seasonRuns.js ──
test("parseSeasonCounts: only real seasons (>=1) with chapters, in order", () => {
  assert.deepEqual(parseSeasonCounts({ seasons: [{ season_number: 2, episode_count: 12 }, { season_number: 0, episode_count: 5 }, { season_number: 1, episode_count: 26 }] }),
    [{ season: 1, count: 26 }, { season: 2, count: 12 }]);
  assert.equal(parseSeasonCounts(null), null);
});

test("pickSeasonRun: consecutive TMDB seasons that sum to the portal total, in one way only", () => {
  const counts = [{ season: 1, count: 26 }, { season: 2, count: 26 }, { season: 3, count: 20 }];
  assert.deepEqual(pickSeasonRun(counts, 52, 1), [{ season: 1, count: 26 }, { season: 2, count: 26 }]);
  assert.equal(pickSeasonRun(counts, 30, 1), null);        // no exact sum
  assert.deepEqual(pickSeasonRun(counts, 26, 1), [{ season: 1, count: 26 }]);
});

// ── src/tmdb.js parsers ──
test("parseSeriesByImdb / parseSeasonEpisodes / pickSeriesByTitle", () => {
  assert.deepEqual(parseSeriesByImdb({ tv_results: [{ id: 42, name: "S", poster_path: "/p.jpg", backdrop_path: "/b.jpg" }] }),
    { tmdbId: 42, title: "S", poster: "https://image.tmdb.org/t/p/w500/p.jpg", backdrop: "https://image.tmdb.org/t/p/w1280/b.jpg" });
  assert.equal(parseSeriesByImdb({ tv_results: [] }), null);
  const eps = parseSeasonEpisodes({ episodes: [{ episode_number: 1, name: "Pilot", overview: "o", still_path: "/s.jpg", air_date: "2020-01-02", runtime: 22 }, { episode_number: 2, name: "", overview: "", still_path: null }] });
  assert.equal(eps[0].still, "https://image.tmdb.org/t/p/w300/s.jpg");
  assert.equal(eps[0].airDate, "2020-01-02");
  assert.equal(eps[0].runtimeMinutes, 22);
  assert.equal(eps[1].name, "Episodio 2");   // blank name
  assert.equal(eps[1].still, "");
  // one clear exact-title match
  assert.equal(pickSeriesByTitle({ results: [{ id: 7, name: "Dragon Ball Kai" }, { id: 8, name: "Otra" }] }, "Dragón Ball Kai").tmdbId, 7);
  assert.equal(pickSeriesByTitle({ results: [{ id: 7, name: "A" }, { id: 8, name: "B" }] }, "Nada"), null);
});

// ── toEpisodes: season chips + each episode's season (no TMDB) ──
test("toEpisodes: the sibling seasons become chips, and each episode carries its season", () => {
  const out = toEpisodes({
    name: "Serie", keyWords: "tt1234567",
    simpleProgramList: [{ contentId: "E1", seriesNumber: "1", name: "One Piece_1" }, { contentId: "E2", seriesNumber: "2", name: "Un título" }],
    sameSeasonSeriesList: [{ contentId: "S1", seasonNumber: "1" }, { contentId: "S2", seasonNumber: "2" }],
  }, "S1", "0");
  assert.deepEqual(out.seasons, [
    { id: "S1", ref: "v:S1:0", title: "Temporada 1", number: 1, current: true },
    { id: "S2", ref: "v:S2:0", title: "Temporada 2", number: 2, current: false },
  ]);
  assert.equal(out.episodes[0].season, 1);
  assert.equal(out.episodes[0].number, 1);
  assert.equal(out.episodes[0].title, "Capítulo 1");   // "One Piece_1" is a file name → numbered
  assert.equal(out.episodes[1].title, "Un título");    // a real name stays
});

test("toEpisodes: no sameSeasonSeriesList is a single-season series (season 1, no chips)", () => {
  const out = toEpisodes({ name: "Serie", simpleProgramList: [{ contentId: "E1", seriesNumber: "1", name: "x" }] }, "SOLO", "0");
  assert.equal(out.seasons, undefined);
  assert.equal(out.episodes[0].season, 1);
});

// ── enrich: TMDB stills/names/synopses matched by the IMDb id ──
test("enrich: matched by keyWords, maps stills/names and keeps TMDB's name only where the portal just numbers it", async () => {
  fakeTmdb({
    find: { tv_results: [{ id: 42, name: "Serie TMDB", poster_path: "/p.jpg", backdrop_path: "/b.jpg" }] },
    season: { "1": { episodes: [
      { episode_number: 1, name: "El comienzo", overview: "sinopsis 1", still_path: "/s1.jpg", air_date: "2020-01-01", runtime: 24 },
      { episode_number: 2, name: "Episodio 2", overview: "", still_path: "/s2.jpg" },
    ] }, "1en": { episodes: [{ episode_number: 2, name: "Episode 2", overview: "english synopsis", still_path: "/s2.jpg" }] } },
  });
  const raw = rawDetail({ name: "Serie", keyWords: "tt1234567", volumnCount: "2",
    simpleProgramList: [{ contentId: "E1", seriesNumber: "1", name: "1" }, { contentId: "E2", seriesNumber: "2", name: "2" }] }, "S1");
  const { extra, series } = await enrich(raw, makeTmdb());
  assert.equal(series.tmdbId, 42);
  assert.equal(extra.get(1).title, "El comienzo");
  assert.equal(extra.get(1).still, "https://image.tmdb.org/t/p/w300/s1.jpg");
  assert.equal(extra.get(1).runtimeMinutes, 24);
  assert.equal(extra.get(2).title, null);               // "Episodio 2" is generic → no better than the portal's number
  assert.equal(extra.get(2).still, "https://image.tmdb.org/t/p/w300/s2.jpg");
  assert.equal(extra.get(2).overview, "english synopsis");  // English fallback filled the empty synopsis
});

test("enrich: the numbering guard — a portal total TMDB cannot match attaches no stills (series still travels)", async () => {
  fakeTmdb({
    find: { tv_results: [{ id: 42, name: "S" }] },
    tv: { seasons: [{ season_number: 1, episode_count: 10 }] },     // TMDB season 1 has 10
    season: { "1": { episodes: [{ episode_number: 1, name: "a", overview: "", still_path: "/x.jpg" }] } },  // but only 1 came back
  });
  const raw = rawDetail({ keyWords: "tt1234567", volumnCount: "98", simpleProgramList: [{ contentId: "E1", seriesNumber: "1", name: "1" }] }, "S1");
  const { extra, series } = await enrich(raw, makeTmdb());
  assert.equal(series.tmdbId, 42);
  assert.equal(extra.size, 0);   // 98 declared ≠ 10 from TMDB, no single run adds up → nothing attached
});

test("enrich: no kino.tmdb (or no id) returns nothing, never throws", async () => {
  delete globalThis.kino.tmdb;
  const raw = rawDetail({ keyWords: "tt1234567", simpleProgramList: [{ contentId: "E1", seriesNumber: "1", name: "1" }] }, "S1");
  const got = await enrich(raw, makeTmdb());
  assert.deepEqual([...got.extra], []);
  assert.equal(got.series, null);
});

test("isGenericTitle: numbers and file names are generic; real names are not", () => {
  for (const s of ["Capítulo 3", "Episode 7", "3", "", "One Piece T1_8"]) assert.equal(isGenericTitle(s), true, s);
  for (const s of ["El comienzo", "La batalla final"]) assert.equal(isGenericTitle(s), false, s);
});
