// The titles of the movie cards shown (titlesStore.js) and a movie's details(ref) using them (2.2.30). Fakes only.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeTitlesStore } from "../src/titlesStore.js";
import { makeDetails } from "../src/details.js";
import { encode } from "../src/refs.js";

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const clockAt = (t = NOW) => ({ now: () => t });
const movie = (id, title, year) => ({ id, kind: "movie", title, ...(year ? { year } : {}) });
const series = (id, title) => ({ id, kind: "series", title });

test("the movie cards shown are remembered by contentId, their title and year", () => {
  const store = makeTitlesStore({ kino: fakeKino(), clock: clockAt() });
  store.rememberMovies([movie("M1", "Avengers: Era de Ultrón", "2015"), movie("M2", "Avatar")]);
  assert.deepEqual(store.titleOf("M1"), { title: "Avengers: Era de Ultrón", year: "2015" });
  assert.deepEqual(store.titleOf("M2"), { title: "Avatar", year: "" });
  assert.equal(store.titleOf("nope"), null);
});

test("a series card, a blank title and a card with no id are not remembered", () => {
  const store = makeTitlesStore({ kino: fakeKino(), clock: clockAt() });
  store.rememberMovies([series("S1", "Una serie"), movie("M3", "   "), { kind: "movie", title: "Sin id" }, null, "x", movie("", "Vacío")]);
  assert.equal(store.titleOf("S1"), null);
  assert.equal(store.titleOf("M3"), null);
  assert.equal(store.titleOf(""), null);
});

test("something that is not a list is ignored, and a later card of the same movie replaces the title", () => {
  const store = makeTitlesStore({ kino: fakeKino(), clock: clockAt() });
  assert.doesNotThrow(() => { store.rememberMovies(null); store.rememberMovies(undefined); store.rememberMovies("x"); store.rememberMovies({}); });
  store.rememberMovies([movie("M1", "Viejo")]);
  store.rememberMovies([movie("M1", "Nuevo")]);
  assert.equal(store.titleOf("M1").title, "Nuevo");
});

test("a very long title is cut, and the store never outgrows its budget: the oldest go first", () => {
  let t = NOW;
  const store = makeTitlesStore({ kino: fakeKino(), clock: { now: () => (t += 1) } });
  store.rememberMovies([movie("L1", "x".repeat(500))]);
  assert.equal(store.titleOf("L1").title.length, 100);
  for (let batch = 0; batch < 60; batch++) store.rememberMovies(Array.from({ length: 10 }, (_, i) => movie(`B${batch}-${i}`, `Una película con un nombre bastante largo número ${batch}-${i}`)));
  assert.ok(store.titleOf("B59-9"), "the newest is kept");
  assert.equal(store.titleOf("L1"), null, "the oldest was evicted to fit the budget");
});

test("an entry older than a month is gone", () => {
  const kino = fakeKino();
  makeTitlesStore({ kino, clock: clockAt(NOW) }).rememberMovies([movie("M1", "Vieja")]);
  assert.ok(makeTitlesStore({ kino, clock: clockAt(NOW + 29 * 24 * 3600_000) }).titleOf("M1"));
  assert.equal(makeTitlesStore({ kino, clock: clockAt(NOW + 31 * 24 * 3600_000) }).titleOf("M1"), null);
});

// ---- details(ref) with the remembered title -------------------------------------------------------------------------------

const movieRef = encode({ contentId: "M1", programType: "movie", episode: 0 });

function deps({ remembered = "Avengers: Era de Ultrón", portal = "fails", tmdbAnswer = { tmdbId: 99861 } } = {}) {
  const calls = { chapters: 0, movieByTitle: [], remembered: [] };
  const titles = { titleOf: (id) => (id === "M1" && remembered ? { title: remembered, year: "2015" } : null) };
  const portalChapters = async () => {
    calls.chapters++;
    if (portal === "fails") throw new Error("portal says no");
    return portal;
  };
  const tmdb = { movieByTitle: async (title, _bounds, year) => { calls.movieByTitle.push(title); calls.year = year; return typeof tmdbAnswer === "function" ? tmdbAnswer(title) : tmdbAnswer; } };
  const ids = { remember: (...a) => calls.remembered.push(a) };
  return { calls, details: makeDetails({ kino: {}, tmdb, portalChapters, clock: clockAt(), ids, titles }) };
}

test("a remembered title is searched on TMDB first, and the portal is not even asked when it matches", async () => {
  const { details, calls } = deps();
  assert.deepEqual(await details(movieRef), { ids: { tmdb: 99861 } });
  assert.deepEqual(calls.movieByTitle, ["Avengers: Era de Ultrón"]);
  assert.equal(calls.chapters, 0);
  assert.deepEqual(calls.remembered, [["M1", "", 99861]]);
});

test("the year the card was shown with travels to the TMDB search", async () => {
  const { details, calls } = deps();
  await details(movieRef);
  assert.equal(calls.year, "2015");
});

test("the portal failing is no reason to answer nothing when the card's title is known (the xuper:details portal ok=0 case)", async () => {
  const { details } = deps({ portal: "fails" });
  assert.deepEqual(await details(movieRef), { ids: { tmdb: 99861 } });
});

test("no TMDB match for the remembered title falls to the portal's IMDb id", async () => {
  const { details, calls } = deps({ tmdbAnswer: null, portal: { imdb: "tt2395427", title: "Otro" } });
  assert.deepEqual(await details(movieRef), { ids: { imdb: "tt2395427" } });
  assert.equal(calls.chapters, 1);
});

test("the portal's own title is tried only when it is a different one", async () => {
  const same = deps({ tmdbAnswer: null, portal: { imdb: "", title: "Avengers: Era de Ultrón" } });
  assert.equal(await same.details(movieRef), null);
  assert.equal(same.calls.movieByTitle.length, 1, "the same title is not searched twice");
  const other = deps({ tmdbAnswer: (t) => (t === "Age of Ultron" ? { tmdbId: 99861 } : null), portal: { imdb: "", title: "Age of Ultron" } });
  assert.deepEqual(await other.details(movieRef), { ids: { tmdb: 99861 } });
  assert.deepEqual(other.calls.movieByTitle, ["Avengers: Era de Ultrón", "Age of Ultron"]);
});

test("nothing remembered and the portal failing is null, never a guess", async () => {
  const { details, calls } = deps({ remembered: null, portal: "fails" });
  assert.equal(await details(movieRef), null);
  assert.deepEqual(calls.movieByTitle, []);
});

test("a series ref never reads the remembered titles", async () => {
  const { details, calls } = deps();
  assert.equal(await details(encode({ contentId: "S1", programType: "series", episode: 0 })), null);
  assert.deepEqual(calls.movieByTitle, []);
});
