// A portal season that TMDB splits into several (seasonRuns.js) and the chapters' stills crossed across them (2.2.30). Fakes only.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { parseSeasonCounts, pickSeasonRun } from "../src/seasonRuns.js";
import { makeEpisodes } from "../src/episodes.js";
import { encode } from "../src/refs.js";

const counts = (...n) => n.map((count, i) => ({ season: i + 1, count }));

test("only the real seasons with chapters count, in order (specials and empty seasons are out)", () => {
  const body = { seasons: [{ season_number: 2, episode_count: 26 }, { season_number: 0, episode_count: 5 }, { season_number: 1, episode_count: 26 }, { season_number: 3, episode_count: 0 }, null, { season_number: "x" }] };
  assert.deepEqual(parseSeasonCounts(body), [{ season: 1, count: 26 }, { season: 2, count: 26 }]);
  assert.deepEqual(parseSeasonCounts(JSON.stringify(body)), [{ season: 1, count: 26 }, { season: 2, count: 26 }]);
  assert.deepEqual(parseSeasonCounts({}), []);
  for (const bad of [null, undefined, "no json", 5, []]) assert.equal(parseSeasonCounts(bad), null);
});

test("the portal's first season is the run of TMDB seasons from the first that adds up to its total (98 = 26+26+26+20)", () => {
  assert.deepEqual(pickSeasonRun(counts(26, 26, 26, 20, 26, 26, 17), 98, 1), counts(26, 26, 26, 20));
});

test("a later portal season is the one run that adds up anywhere at season boundaries (69 = 26+26+17)", () => {
  const run = pickSeasonRun(counts(26, 26, 26, 20, 26, 26, 17), 69, 2);
  assert.deepEqual(run.map((s) => s.season), [5, 6, 7]);
});

test("no exact sum, or more than one way to reach it, is no run", () => {
  assert.equal(pickSeasonRun(counts(26, 26, 26, 20), 97, 1), null, "no boundary adds up to 97");
  assert.equal(pickSeasonRun(counts(10, 88), 88, 1), null, "the first portal season starts at TMDB's first season: 10 then 98 overshoots");
  assert.equal(pickSeasonRun(counts(10, 20, 10, 20), 30, 2), null, "10+20 twice: two ways, no clear one");
});

test("junk in, no run out", () => {
  assert.equal(pickSeasonRun([], 98, 1), null);
  assert.equal(pickSeasonRun(null, 98, 1), null);
  assert.equal(pickSeasonRun(counts(26), 0, 1), null);
  assert.equal(pickSeasonRun(counts(26), 26.5, 1), null);
});

// ---- episodes(ref) across TMDB seasons ----------------------------------------------------------------------------------

const clock = { now: () => 1_000_000 };
const ref = encode({ contentId: "S1", programType: "series", episode: 0 });
const KAI = 61709;

function rawSeason({ total, season = 1, imdb = "tt1409055" }) {
  return {
    items: Array.from({ length: total }, (_, i) => ({ seriesNumber: String(i + 1), contentId: `E${i + 1}`, name: `Capítulo ${i + 1}`, duration: undefined })),
    imdb, season, declared: total, seasons: [{ id: "S1", number: season }], title: "Dragon Ball Kai",
  };
}

/** A TMDB with `seasons` = [chapter counts]: each chapter has a still named after its season and number. */
function fakeTmdb(seasonCounts, { failSeason = null, answerSeasons = true } = {}) {
  const calls = { seasons: [], list: 0 };
  return {
    calls,
    tmdb: {
      seriesByImdb: async () => ({ tmdbId: KAI, title: "Dragon Ball Kai", poster: "", backdrop: "" }),
      seriesSeasons: answerSeasons ? async () => { calls.list++; return seasonCounts.map((count, i) => ({ season: i + 1, count })); } : undefined,
      seasonEpisodes: async (id, season) => {
        calls.seasons.push(season);
        if (season === failSeason) return null;
        const count = seasonCounts[season - 1];
        if (count === undefined) return [];
        return Array.from({ length: count }, (_, i) => ({ episode: i + 1, name: `T${season}E${i + 1}`, overview: `sinopsis ${season}-${i + 1}`, still: `https://t/s${season}e${i + 1}.jpg`, airDate: "", runtimeMinutes: 24 }));
      },
    },
  };
}

const run = (raw, tmdb) => makeEpisodes({ kino: fakeKino(), tmdb, portalChapters: async () => raw, clock })(ref);

test("98 portal chapters over TMDB's 26+26+26+20 get each its own still, numbered in a row (Dragon Ball Kai T1)", async () => {
  const { tmdb, calls } = fakeTmdb([26, 26, 26, 20]);
  const out = await run(rawSeason({ total: 98 }), tmdb);
  assert.equal(out.episodes.length, 98);
  assert.equal(out.episodes[0].still, "https://t/s1e1.jpg");
  assert.equal(out.episodes[25].still, "https://t/s1e26.jpg");
  assert.equal(out.episodes[26].still, "https://t/s2e1.jpg", "chapter 27 is TMDB's season 2 chapter 1");
  assert.equal(out.episodes[97].still, "https://t/s4e20.jpg");
  assert.equal(out.episodes[26].title, "T2E1", "TMDB's name where the portal only numbers it");
  assert.deepEqual([...new Set(calls.seasons)].sort(), [1, 2, 3, 4]);
});

test("a later portal season takes the TMDB seasons it adds up to (69 = 26+26+17 after a 98)", async () => {
  const { tmdb } = fakeTmdb([26, 26, 26, 20, 26, 26, 17]);
  const out = await run(rawSeason({ total: 69, season: 2 }), tmdb);
  assert.equal(out.episodes.length, 69);
  assert.equal(out.episodes[0].still, "https://t/s5e1.jpg");
  assert.equal(out.episodes[68].still, "https://t/s7e17.jpg");
});

test("when no consecutive seasons add up to the portal's total, no still is attached, as before", async () => {
  const { tmdb } = fakeTmdb([26, 26, 26, 21]);
  const out = await run(rawSeason({ total: 98 }), tmdb);
  assert.equal(out.episodes.length, 98);
  assert.ok(out.episodes.every((e) => e.still === undefined));
});

test("one of the seasons failing to load attaches nothing instead of a partial list", async () => {
  const { tmdb } = fakeTmdb([26, 26, 26, 20], { failSeason: 3 });
  const out = await run(rawSeason({ total: 98 }), tmdb);
  assert.ok(out.episodes.every((e) => e.still === undefined));
});

test("a season whose total already matches TMDB's goes the old way and never asks the season list", async () => {
  const { tmdb, calls } = fakeTmdb([12]);
  const out = await run(rawSeason({ total: 12 }), tmdb);
  assert.equal(out.episodes[0].still, "https://t/s1e1.jpg");
  assert.equal(calls.list, 0);
});

test("a TMDB with MORE chapters than the portal in that season is not crossed (never a run of fewer than the season)", async () => {
  const { tmdb, calls } = fakeTmdb([30]);
  const out = await run(rawSeason({ total: 12 }), tmdb);
  assert.ok(out.episodes.every((e) => e.still === undefined));
  assert.equal(calls.list, 0);
});

test("a TMDB client without the season list (an older one) just attaches nothing", async () => {
  const { tmdb } = fakeTmdb([26, 26, 26, 20], { answerSeasons: false });
  const out = await run(rawSeason({ total: 98 }), tmdb);
  assert.ok(out.episodes.every((e) => e.still === undefined));
});
