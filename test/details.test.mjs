// A movie's `details(ref)` (2.2.30): only its ids, so the page can ask TMDB. No portal fixtures: fakes only.
import test from "node:test";
import assert from "node:assert/strict";
import { pickMovieByTitle } from "../src/tmdb.js";
import { makeDetails } from "../src/details.js";
import { encode } from "../src/refs.js";

const film = (title, original, popularity, id) => ({ id, title, original_title: original, popularity });
const body = (...results) => ({ results });

test("a movie's title that IS one result's title or original title is that movie", () => {
  assert.deepEqual(pickMovieByTitle(body(film("Vengadores: Endgame", "Avengers: Endgame", 90, 299534), film("Otra", "Other", 5, 1)), "Avengers: Endgame"), { tmdbId: 299534, title: "Vengadores: Endgame" });
  assert.deepEqual(pickMovieByTitle(body(film("Vengadores: Endgame", "Avengers: Endgame", 90, 299534)), "Vengadores Endgame"), { tmdbId: 299534, title: "Vengadores: Endgame" });
});

test("a portal title that holds every word of one result's title is that movie (Avengers: Era de Ultrón)", () => {
  const results = body(film("Avengers: La era de Ultrón", "Avengers: Age of Ultron", 70, 99861), film("Avengers: Endgame", "Avengers: Endgame", 90, 299534));
  assert.deepEqual(pickMovieByTitle(results, "Avengers: Era de Ultrón"), { tmdbId: 99861, title: "Avengers: La era de Ultrón" });
});

test("two equally clear candidates are no match, a wrong id would paint another film's page", () => {
  assert.equal(pickMovieByTitle(body(film("Rocky", "Rocky", 40, 1), film("Rocky", "Rocky", 39, 2)), "Rocky"), null);
  // Neither title IS "Avengers", both hold its words, and 50 is not twice 45: no clear winner.
  assert.equal(pickMovieByTitle(body(film("Avengers: Age", "x", 50, 1), film("Avengers: Age II", "y", 45, 2)), "Avengers"), null);
});

test("the most popular of several candidates wins only when it has at least twice the popularity of the next", () => {
  assert.equal(pickMovieByTitle(body(film("Dragon Ball Z", "a", 80, 1), film("Dragon Ball Super", "b", 30, 2)), "Dragon Ball")?.tmdbId, 1);
  assert.equal(pickMovieByTitle(body(film("Dragon Ball Z", "a", 50, 1), film("Dragon Ball Super", "b", 40, 2)), "Dragon Ball"), null);
});

const dated = (title, original, popularity, id, date) => ({ ...film(title, original, popularity, id), release_date: date });

test("films that share a name are told apart by the card's year (Avatar)", () => {
  const results = body(dated("Avatar", "Avatar", 90, 19995, "2009-12-10"), dated("Avatar", "Avatar", 20, 777, "1916-01-01"), dated("Avatar: El camino del agua", "Avatar: The Way of Water", 80, 76600, "2022-12-14"));
  assert.equal(pickMovieByTitle(results, "Avatar"), null, "without a year two films are called Avatar: no clear one");
  assert.deepEqual(pickMovieByTitle(results, "Avatar", "2009"), { tmdbId: 19995, title: "Avatar" });
  assert.deepEqual(pickMovieByTitle(results, "Avatar", 1916), { tmdbId: 777, title: "Avatar" });
});

test("with the year, the single film of that year that shares most of the title's words is that film (Avatar 2 / Fuego y Cenizas)", () => {
  const way = body(dated("Avatar: El camino del agua", "Avatar: The Way of Water", 80, 76600, "2022-12-14"));
  assert.deepEqual(pickMovieByTitle(way, "Avatar 2: El camino del agua", "2022"), { tmdbId: 76600, title: "Avatar: El camino del agua" });
  const fire = body(dated("Avatar: Fuego y ceniza", "Avatar: Fire and Ash", 90, 83533, "2025-12-17"));
  assert.deepEqual(pickMovieByTitle(fire, "Avatar: Fuego y Cenizas", "2025"), { tmdbId: 83533, title: "Avatar: Fuego y ceniza" });
});

test("that relaxation needs the year AND a single film of that year AND most of the words", () => {
  const way = body(dated("Avatar: El camino del agua", "Avatar: The Way of Water", 80, 76600, "2022-12-14"));
  assert.equal(pickMovieByTitle(way, "Avatar 2: El camino del agua"), null, "no year: the strict rules only");
  assert.equal(pickMovieByTitle(way, "Avatar 2: El camino del agua", "2009"), null, "no film of that year: not this one");
  const two = body(dated("Avatar: El camino del agua", "x", 80, 1, "2022-12-14"), dated("Avatar: El camino del agua II", "y", 70, 2, "2022-01-01"));
  assert.equal(pickMovieByTitle(two, "Avatar 2: El camino del agua", "2022"), null, "two films that year: no clear one");
  const other = body(dated("Un título totalmente distinto", "Another", 80, 3, "2022-05-05"));
  assert.equal(pickMovieByTitle(other, "Avatar 2: El camino del agua", "2022"), null, "the only film of the year shares nothing");
  const half = body(dated("Avatar", "Avatar", 80, 4, "2022-05-05"));
  assert.equal(pickMovieByTitle(half, "Avatar Aang: el último maestro del aire", "2022"), null, "one word in seven is not most of them");
  assert.equal(pickMovieByTitle(body(dated("Avatar", "Avatar", 80, 5, "2022-05-05")), "Avatar", "2022")?.tmdbId, 5, "a one-word title still goes by the strict rule");
});

test("a year no result has leaves the strict rules to decide on the whole answer, and a malformed year is ignored", () => {
  const results = body(dated("Rocky Balboa", "Rocky Balboa", 40, 1, "2006-12-20"));
  assert.deepEqual(pickMovieByTitle(results, "Rocky Balboa", "1999"), { tmdbId: 1, title: "Rocky Balboa" });
  assert.deepEqual(pickMovieByTitle(results, "Rocky Balboa", "dos mil"), { tmdbId: 1, title: "Rocky Balboa" });
  assert.deepEqual(pickMovieByTitle(results, "Rocky Balboa", null), { tmdbId: 1, title: "Rocky Balboa" });
});

test("nothing, an empty title, unreadable answers and results without an id are no match", () => {
  assert.equal(pickMovieByTitle(body(), "Avengers"), null);
  assert.equal(pickMovieByTitle(body(film("Avengers", "Avengers", 9, 1)), "   "), null);
  assert.equal(pickMovieByTitle(body(film("Avengers", "Avengers", 9, 1)), "!!!"), null);
  for (const bad of [null, undefined, "not json", 5, [], {}, { results: "x" }]) assert.equal(pickMovieByTitle(bad, "Avengers"), null);
  assert.equal(pickMovieByTitle(body({ id: 0, title: "Avengers" }, null, "x"), "Avengers"), null);
});

// ---- details(ref) -------------------------------------------------------------------------------------------------------

const movieRef = encode({ contentId: "M1", programType: "movie", episode: 0 });
const seriesRef = encode({ contentId: "S1", programType: "series", episode: 0 });
const clock = { now: () => 1_000_000 };

function deps({ raw, tmdbAnswer, chaptersThrows = false, noTmdb = false } = {}) {
  const calls = { chapters: [], movieByTitle: [], remembered: [] };
  const portalChapters = async (id) => { calls.chapters.push(id); if (chaptersThrows) throw new Error("portal down"); return raw; };
  const tmdb = noTmdb ? null : { movieByTitle: async (title, bounds) => { calls.movieByTitle.push({ title, bounds }); return tmdbAnswer ?? null; } };
  const ids = { remember: (id, imdb, tmdbId = 0) => calls.remembered.push([id, imdb, tmdbId]) };
  return { calls, details: makeDetails({ kino: {}, tmdb, portalChapters, clock, ids }) };
}

test("a movie whose portal detail names an IMDb id answers it, and the card learns it", async () => {
  const { details, calls } = deps({ raw: { imdb: "tt4154796", title: "Avengers: Endgame" } });
  assert.deepEqual(await details(movieRef), { ids: { imdb: "tt4154796" } });
  assert.deepEqual(calls.chapters, ["M1"]);
  assert.deepEqual(calls.movieByTitle, [], "no TMDB search when the portal already named the film");
  assert.deepEqual(calls.remembered, [["M1", "tt4154796", 0]]);
});

test("with no IMDb id, a clear TMDB match by the portal's title answers its TMDB id, and the card learns it", async () => {
  const { details, calls } = deps({ raw: { imdb: "", title: "Avengers: Era de Ultrón" }, tmdbAnswer: { tmdbId: 99861, title: "Avengers: La era de Ultrón" } });
  assert.deepEqual(await details(movieRef), { ids: { tmdb: 99861 } });
  assert.equal(calls.movieByTitle[0].title, "Avengers: Era de Ultrón");
  assert.equal(typeof calls.movieByTitle[0].bounds.deadline, "number", "the TMDB search runs under a deadline");
  assert.deepEqual(calls.remembered, [["M1", "", 99861]]);
});

test("no IMDb id and no clear TMDB match is null, never a guess, and nothing is remembered", async () => {
  const { details, calls } = deps({ raw: { imdb: "", title: "Peli rara" }, tmdbAnswer: null });
  assert.equal(await details(movieRef), null);
  assert.deepEqual(calls.remembered, []);
});

test("an id TMDB answers that is not a positive integer is not published", async () => {
  for (const tmdbAnswer of [{ tmdbId: 0 }, { tmdbId: -3 }, { tmdbId: 1.5 }, { tmdbId: "7" }, {}]) {
    const { details } = deps({ raw: { imdb: "", title: "X" }, tmdbAnswer });
    assert.equal(await details(movieRef), null, JSON.stringify(tmdbAnswer));
  }
});

test("a malformed IMDb id from the portal is not published", async () => {
  for (const imdb of ["tt12", "12345678", "xx1234567", " tt1234567"]) {
    const { details } = deps({ raw: { imdb, title: "" } });
    assert.equal(await details(movieRef), null, imdb);
  }
});

test("a series ref is none of details' business: its ids come from episodes().series", async () => {
  const { details, calls } = deps({ raw: { imdb: "tt0944947", title: "X" } });
  assert.equal(await details(seriesRef), null);
  assert.deepEqual(calls.chapters, []);
});

test("an unreadable ref, a portal that fails, a blank title or no TMDB client answer null, never throw", async () => {
  assert.equal(await deps({ raw: { imdb: "", title: "X" } }).details("not a ref"), null);
  assert.equal(await deps({ raw: {}, chaptersThrows: true }).details(movieRef), null);
  assert.equal(await deps({ raw: { imdb: "", title: "   " }, tmdbAnswer: { tmdbId: 5 } }).details(movieRef), null);
  assert.equal(await deps({ raw: { imdb: "", title: "X" }, noTmdb: true }).details(movieRef), null);
  assert.equal(await deps({ raw: null }).details(movieRef), null);
});
