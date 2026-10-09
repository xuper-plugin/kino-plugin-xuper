import test from "node:test";
import assert from "node:assert/strict";
import { displaySeriesTitle } from "../src/titleClean.js";

test("a title that ends in a season tag loses the tag and the dub tags before it", () => {
  const cases = {
    "Dragon Ball Kai Español T1": "Dragon Ball Kai",
    "Dragón Ball Kai español T2": "Dragón Ball Kai",
    "One Piece T1": "One Piece",
    "Naruto Temporada 4": "Naruto",
    "Bleach S2": "Bleach",
    "Fargo (2014) T2": "Fargo (2014)",
    "Dragon Ball Z Kai audio latino T10": "Dragon Ball Z Kai",
    "Breaking Bad Castellano 1080p T5": "Breaking Bad",
    "Show Español Latino T1": "Show",
    "Nombre subtitulado S1": "Nombre",
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(displaySeriesTitle(from), to, from);
});

test("a title with no season tag is never touched, whatever words it holds", () => {
  for (const t of ["Friends", "Amor Latino", "HD", "Sub Zero", "Nada Miniserie", "Español", "La casa de papel"]) assert.equal(displaySeriesTitle(t), t);
});

test("a bare 'latino' or 'sub' before the season is part of the name", () => {
  assert.equal(displaySeriesTitle("Amor Latino T3"), "Amor Latino");
  assert.equal(displaySeriesTitle("Sub Zero T2"), "Sub Zero");
});

test("nothing readable left means the title as it was", () => {
  assert.equal(displaySeriesTitle("T1"), "T1");
  assert.equal(displaySeriesTitle("Español T1"), "Español T1");
  assert.equal(displaySeriesTitle(""), "");
  assert.equal(displaySeriesTitle(undefined), "");
});

import { collapseSeasons } from "../src/search.js";

const row = (title, series = true) => ({ title, series });
const read = (x) => x;

test("collapseSeasons keeps the lowest season of each tagged series, at its own place", () => {
  const list = [row("Naruto T2"), row("Matrix", false), row("Naruto T1"), row("Bleach T3"), row("Bleach T2")];
  assert.deepEqual(collapseSeasons(list, read).map((x) => x.title), ["Matrix", "Naruto T1", "Bleach T2"]);
});

test("collapseSeasons never touches a title with no season tag, a movie, or two different series", () => {
  const list = [row("Friends"), row("Friends"), row("Dune T1", false), row("Dune T2", false), row("Alfa T1"), row("Beta T1")];
  assert.deepEqual(collapseSeasons(list, read), list);
});

test("collapseSeasons groups by the shown name: accents, case and the dub tag do not split a series", () => {
  const list = [row("Dragón Ball Kai español T2"), row("Dragon Ball Kai Español T1")];
  assert.deepEqual(collapseSeasons(list, read).map((x) => x.title), ["Dragon Ball Kai Español T1"]);
});
