// Search shows one entry per series again (ported from Xuper 2.x): the portal lists each season as its own title
// ("Lupin T1/T2/T3"); collapseSeasons keeps only the lowest, and displaySeriesTitle drops the season tag from the name.
// The other seasons are the chips inside the detail (src/catalog.js toEpisodes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { displaySeriesTitle, seasonFromName, collapseSeasons } from "../src/titleClean.js";

test("displaySeriesTitle: drops a trailing season (and dub) tag, leaves other titles alone", () => {
  assert.equal(displaySeriesTitle("Lupin T2"), "Lupin");
  assert.equal(displaySeriesTitle("Dragón Ball Kai español T2"), "Dragón Ball Kai");
  assert.equal(displaySeriesTitle("Lupin"), "Lupin");            // no tag
  assert.equal(displaySeriesTitle("Amor Latino"), "Amor Latino"); // "Latino" is part of the name, not a trailing tag
});

test("seasonFromName: the tag's number, or 1 when there is none", () => {
  assert.equal(seasonFromName("Lupin T2"), 2);
  assert.equal(seasonFromName("Lupin Temporada 3"), 3);
  assert.equal(seasonFromName("Lupin"), 1);
});

test("collapseSeasons: one result per series (the lowest season), movies and single-season series untouched", () => {
  const items = [
    { id: "a", title: "Lupin T2", kind: "series" },
    { id: "b", title: "Lupin T1", kind: "series" },
    { id: "c", title: "Lupin T3", kind: "series" },
    { id: "d", title: "Una Película", kind: "movie" },
    { id: "e", title: "Otra Serie", kind: "series" },     // single-season (no tag) — kept
  ];
  const out = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
  assert.deepEqual(out.map((x) => x.id), ["b", "d", "e"]);   // only Lupin T1 of the three, plus the movie and the single-season series
  assert.equal(out[0].title, "Lupin T1");                    // collapse keeps the raw title; search cleans it with displaySeriesTitle after
});

test("collapseSeasons: nothing to collapse leaves the list as is", () => {
  const items = [{ id: "a", title: "Lupin", kind: "series" }, { id: "b", title: "Peli", kind: "movie" }];
  assert.deepEqual(collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" })).map((x) => x.id), ["a", "b"]);
});

// 3.1.3: a long-running show (Survivor, ~40 seasons) must NOT collapse to one entry — its seasons stay findable in search.
import { COLLAPSE_SEASON_LIMIT } from "../src/titleClean.js";
import { episodesAnswer, MAX_SEASON_CHIPS } from "../src/legacy.js";

test("collapseSeasons: a long-running show (more distinct seasons than the limit) stays fully listed", () => {
  const items = Array.from({ length: COLLAPSE_SEASON_LIMIT + 4 }, (_, k) => ({ id: "s" + (k + 1), title: "Survivor T" + (k + 1), kind: "series" }));
  const out = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
  assert.equal(out.length, COLLAPSE_SEASON_LIMIT + 4, "none hidden: every season stays findable in search");
});

test("collapseSeasons: at the limit it still collapses; duplicate entries of one season count once (distinct seasons, not entries)", () => {
  const items = [{ id: "dup", title: "Show T1", kind: "series" }];   // a second entry for season 1
  for (let n = 1; n <= COLLAPSE_SEASON_LIMIT; n++) items.push({ id: "s" + n, title: "Show T" + n, kind: "series" });
  const out = collapseSeasons(items, (it) => ({ title: it.title, series: it.kind === "series" }));
  assert.equal(out.length, 1, "distinct seasons <= limit -> collapses to one, despite the extra entry");
  assert.equal(out[0].id, "dup", "keeps the first-seen lowest season");
});

test("episodesAnswer: the season-chip cap is raised past 50 so long shows keep every season chip", () => {
  assert.ok(MAX_SEASON_CHIPS >= 100, "cap covers Survivor-scale shows");
  const seasons = Array.from({ length: 60 }, (_, k) => ({ id: "c" + (k + 1), number: k + 1 }));
  const out = episodesAnswer({ contentId: "x", programType: "teleplay" }, { items: [], season: 1, seasons }, false);
  assert.equal(out.seasons.length, 60, "all 60 seasons become chips (was cut at 50)");
});
