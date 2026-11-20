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
