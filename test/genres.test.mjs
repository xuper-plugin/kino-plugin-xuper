// The portal's genre tags are IMDb's English names: a Spanish Kino shows them in Spanish (i18n.js GENRES_ES).
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENRES_ES, genreName, isSpanish } from "../src/i18n.js";
import { projectRows } from "../src/catalog.js";
import { rowsOfTab } from "../src/section.js";

const IMDB_GENRES = [
  "Action", "Adventure", "Animation", "Biography", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy",
  "History", "Horror", "Music", "Musical", "Mystery", "Romance", "Sci-Fi", "Sport", "Thriller", "War", "Western",
  "Reality-TV", "Talk-Show", "Game-Show", "News", "Film-Noir", "Short", "Adult",
];

test("GENRES_ES: every IMDb genre has a Spanish name, and nothing else is in the map", () => {
  assert.deepEqual(Object.keys(GENRES_ES).sort(), [...IMDB_GENRES].sort());
  for (const g of IMDB_GENRES) assert.ok(typeof GENRES_ES[g] === "string" && GENRES_ES[g].trim() !== "", g);
  assert.equal(GENRES_ES.Action, "Acción");
  assert.equal(GENRES_ES["Sci-Fi"], "Ciencia ficción");
  assert.equal(GENRES_ES.Thriller, "Suspenso");
  assert.equal(GENRES_ES.Horror, "Terror");
});

test("isSpanish: kino.lang starting with es; anything else, missing or throwing is not", () => {
  for (const lang of ["es", "es-CO", "ES-mx", " es_419 "]) assert.equal(isSpanish({ lang }), true, lang);
  for (const lang of ["en", "en-US", "pt-BR", "", undefined, null, 5]) assert.equal(isSpanish({ lang }), false, String(lang));
  assert.equal(isSpanish(undefined), false);
  assert.equal(isSpanish({ get lang() { throw new Error("boom"); } }), false);
});

test("genreName: Spanish for a known IMDb genre when spanish, unchanged otherwise; unknown names pass through", () => {
  assert.equal(genreName("Action", true), "Acción");
  assert.equal(genreName(" Drama ", true), "Drama");
  assert.equal(genreName("Reality-TV", true), "Reality");
  assert.equal(genreName("Action", false), "Action");
  assert.equal(genreName("Telenovela", true), "Telenovela");
  assert.equal(genreName("action", true), "action"); // IMDb's spelling only
  assert.equal(genreName("toString", true), "toString");
  assert.equal(genreName("__proto__", true), "__proto__");
});

const NOW = Date.UTC(2026, 9, 6);
const item = (id, genres) => ({ id, title: `T ${id}`, poster: "", backdrop: "", durationS: 0, type: "movie", genres, score: null, description: "", shelvedAtMs: 0 });
const rows = [{ id: "magis_top_peliculas", title: "Mejor valoradas · Películas", shown: [item("A", ["Action", "Sci-Fi", "Telenovela"])] }];

test("projected items: genres in Spanish only when Kino runs in Spanish", () => {
  const genresOf = (out) => out[0].items[0].genres;
  assert.deepEqual(genresOf(projectRows(rows, NOW, undefined, false, true)), ["Acción", "Ciencia ficción", "Telenovela"]);
  assert.deepEqual(genresOf(projectRows(rows, NOW, undefined, true, false)), ["Action", "Sci-Fi", "Telenovela"]);
  assert.deepEqual(genresOf(projectRows(rows, NOW)), ["Action", "Sci-Fi", "Telenovela"]);
  assert.deepEqual(genresOf(rowsOfTab(rows, "peliculas", NOW, undefined, false, true)), ["Acción", "Ciencia ficción", "Telenovela"]);
  // The source item keeps the portal's names (the classifier groups by them).
  assert.deepEqual(rows[0].shown[0].genres, ["Action", "Sci-Fi", "Telenovela"]);
});
