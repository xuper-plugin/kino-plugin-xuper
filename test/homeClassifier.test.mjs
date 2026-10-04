import test from "node:test";
import assert from "node:assert/strict";
import { classify, isFeatured, rootOfRow } from "../src/homeClassifier.js";

// Ported case by case from the native MagisHomeClassifierTest.
const item = (id, tags = "", score = 7.0, type = "movie") => ({
  id, title: id, poster: null, backdrop: null, durationS: 0, type, score, description: "", shelvedAtMs: 0,
  genres: tags.split(",").map((t) => t.trim()).filter((t) => t),
});
const section = (name, items) => ({ name, items });
const many = (prefix, n, tags, score = 7.0, type = "movie") =>
  Array.from({ length: n }, (_, i) => item(`${prefix}${i + 1}`, tags, score, type));
const rows = (roots) =>
  classify(Object.fromEntries(Object.entries(roots).map(([k, items]) => [k, [section("All", items)]])));
const row = (list, id) => list.find((r) => r.id === id);
const ids = (items) => items.map((i) => i.id);
const shelved = (id, at, type = "movie") => ({ ...item(id, "", 7, type), shelvedAtMs: at });

test("a genre with six titles gets a row, one with five does not", () => {
  const r = rows({ peliculas: [...many("a", 6, "Action"), ...many("h", 5, "Horror")] });
  assert.ok(row(r, "magis_g_peliculas_action"));
  assert.equal(row(r, "magis_g_peliculas_horror"), undefined);
});

test("rows use our own Spanish genre and type names", () => {
  const r = rows({ peliculas: many("a", 6, "Action"), series: many("s", 6, "Sci-Fi", 7, "teleplay") });
  assert.equal(row(r, "magis_g_peliculas_action").title, "Acción · Películas");
  assert.equal(row(r, "magis_g_series_scifi").title, "Ciencia ficción · Series");
});

test("Music and Musical are the same row", () => {
  const r = rows({ peliculas: [...many("m", 3, "Music"), ...many("u", 3, "Musical")] });
  const music = row(r, "magis_g_peliculas_music");
  assert.equal(music.title, "Música · Películas");
  assert.equal(music.all.length, 6);
});

test("tags that are not genres make no row", () => {
  const r = rows({ peliculas: many("x", 8, "Short, 2021, Animation, Anime, Cartoon") });
  assert.equal(r.some((x) => x.id.startsWith("magis_g_")), false);
});

test("trailers never reach the home", () => {
  const r = rows({ peliculas: [...many("a", 6, "Action"), item("t1", "Action", 9.9, "trailer")] });
  assert.equal(row(r, "magis_g_peliculas_action").all.some((i) => i.id === "t1"), false);
  assert.equal(row(r, "magis_top_peliculas").all.some((i) => i.id === "t1"), false);
});

test("a title in several roots keeps the most specific kind", () => {
  const shared = item("x", "Action");
  const r = rows({ peliculas: [...many("p", 5, "Action"), shared], anime: [...many("n", 5, "Action"), shared] });
  assert.ok(row(r, "magis_g_anime_action").all.some((i) => i.id === "x"));
  assert.equal(row(r, "magis_g_peliculas_action"), undefined);
});

test("recent movie uploads come from the newest plain year section", () => {
  const r = classify({
    peliculas: [
      section("2025", many("old", 3, "Drama")),
      section("2026", many("new", 2, "Drama")),
      section("HBO Movie", many("hbo", 3, "Drama")),
    ],
    series: [section("HBO Series", many("s", 3, "Drama", 7, "teleplay"))],
  });
  const recent = row(r, "magis_recent_peliculas");
  assert.equal(recent.title, "Recién agregadas · Películas");
  assert.deepEqual(ids(recent.shown), ["new1", "new2"]);
  assert.equal(row(r, "magis_new_peliculas"), undefined);
  assert.equal(row(r, "magis_new_series"), undefined);
});

test("recent uploads keep the portal's order when there are no dates", () => {
  const r = classify({ peliculas: [section("2026", [item("u1", "", 4), item("u2", "", 9), item("u3", "", 6)])] });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["u1", "u2", "u3"]);
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").all), ["u1", "u2", "u3"]);
});

test("the theatrical section is its own cinema row, next to the recent uploads one", () => {
  const r = classify({
    peliculas: [section("2026", many("upload", 3, "Comedy")), section("2026 Peliculas teatrales", many("cinema", 2, "Action"))],
  });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["upload1", "upload2", "upload3"]);
  const cinema = row(r, "magis_new_peliculas");
  assert.equal(cinema.title, "Estrenos de cine");
  assert.deepEqual(ids(cinema.shown), ["cinema1", "cinema2"]);
});

test("a theatrical section alone makes the cinema row and no recent row", () => {
  const r = classify({ peliculas: [section("2026 Peliculas teatrales", many("cinema", 2, "Action"))] });
  assert.deepEqual(ids(row(r, "magis_new_peliculas").shown), ["cinema1", "cinema2"]);
  assert.equal(row(r, "magis_recent_peliculas"), undefined);
});

test("the theatrical section is found regardless of accents and case", () => {
  const r = classify({ peliculas: [section("2026 PELÍCULAS TEATRALES", many("cinema", 2, "Action"))] });
  assert.deepEqual(ids(row(r, "magis_new_peliculas").shown), ["cinema1", "cinema2"]);
});

test("the newest theatrical section wins", () => {
  const r = classify({
    peliculas: [section("2025 Peliculas teatrales", many("old", 2, "Action")), section("2026 Peliculas teatrales", many("new", 2, "Action"))],
  });
  assert.deepEqual(ids(row(r, "magis_new_peliculas").shown), ["new1", "new2"]);
});

test("next year's plain section takes over once it has titles", () => {
  const r = classify({
    peliculas: [section("2026", many("old", 2, "Drama")), section("2027", many("new", 2, "Drama"))],
    series: [section("2026", many("so", 2, "Drama", 7, "teleplay")), section(" 2027 ", many("sn", 2, "Drama", 7, "teleplay"))],
  });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["new1", "new2"]);
  assert.deepEqual(ids(row(r, "magis_new_series").shown), ["sn1", "sn2"]);
});

test("an empty (or trailers-only) new year section falls back to the previous year", () => {
  const r = classify({
    peliculas: [section("2027", [item("t", "", 7, "trailer")]), section("2026", many("old", 2, "Drama"))],
    series: [section("2027", []), section("2026", many("so", 2, "Drama", 7, "teleplay"))],
  });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["old1", "old2"]);
  assert.deepEqual(ids(row(r, "magis_new_series").shown), ["so1", "so2"]);
});

test("the plain year series section is the shows with new episodes", () => {
  const shows = [item("s1", "", 5, "teleplay"), item("s2", "", 9, "teleplay")];
  const r = classify({ series: [section("2026", shows)] });
  const updated = row(r, "magis_new_series");
  assert.equal(updated.title, "Series con capítulos nuevos");
  assert.deepEqual(ids(updated.shown), ["s1", "s2"]);
});

test("top rated keeps twenty, best first, and every title in all", () => {
  const movies = Array.from({ length: 25 }, (_, i) => item(`m${i + 1}`, "Drama", i + 1));
  const top = row(rows({ peliculas: movies }), "magis_top_peliculas");
  assert.equal(top.title, "Películas mejor valoradas");
  assert.equal(top.shown.length, 20);
  assert.equal(top.shown[0].id, "m25");
  assert.equal(top.all.length, 25);
});

test("top rated ties break by title then id, a missing score sorts last", () => {
  const a = { ...item("b", "", 8), title: "Zeta" }, b = { ...item("a", "", 8), title: "Alfa" };
  const c = item("c", "", null), d = { ...item("d", "", 8), title: "Alfa" };
  const top = row(rows({ peliculas: [c, a, d, b] }), "magis_top_peliculas");
  assert.deepEqual(ids(top.all), ["a", "d", "b", "c"]);
});

test("a genre row prefers titles not shown in an earlier genre row", () => {
  const r = rows({
    peliculas: [...many("a", 20, "Drama, Action", 9.0), ...many("e", 10, "Drama", 2.0), ...many("c", 6, "Action", 1.0)],
  });
  const action = row(r, "magis_g_peliculas_action");
  assert.deepEqual(ids(action.shown).slice(0, 6), [1, 2, 3, 4, 5, 6].map((n) => `c${n}`));
  assert.equal(action.shown.length, 20);
  assert.equal(action.all[0].score, 9.0);
  assert.equal(action.all.length, 26);
});

test("genre rows alternate between kinds, bigger genres first", () => {
  const r = rows({
    peliculas: [...many("a", 6, "Action"), ...many("c", 6, "Comedy")],
    series: many("s", 6, "Drama", 7, "teleplay"),
  });
  assert.deepEqual(r.map((x) => x.id).filter((x) => x.startsWith("magis_g_")),
    ["magis_g_peliculas_action", "magis_g_series_drama", "magis_g_peliculas_comedy"]);
});

test("featured rows come before genre rows", () => {
  const r = classify({ peliculas: [section("2026", many("n", 2, "Action")), section("All", many("a", 6, "Action"))] });
  assert.deepEqual(r.map((x) => x.id), ["magis_recent_peliculas", "magis_top_peliculas", "magis_g_peliculas_action"]);
});

test("recent uploads lead and the cinema row closes the featured rows", () => {
  const r = classify({
    peliculas: [
      section("2026", many("n", 2, "Action")),
      section("2026 Peliculas teatrales", many("c", 2, "Action")),
      section("All", many("a", 6, "Action")),
    ],
    series: [section("2026", many("s", 6, "Drama", 7, "teleplay"))],
  });
  assert.deepEqual(r.map((x) => x.id), [
    "magis_recent_peliculas", "magis_new_series", "magis_top_peliculas", "magis_top_series",
    "magis_new_peliculas", "magis_g_peliculas_action", "magis_g_series_drama",
  ]);
});

test("under a twenty row cap every featured row survives and only small genres drop", () => {
  const genres = ["Action", "Comedy", "Drama", "Thriller", "Crime", "Sci-Fi", "Fantasy", "Romance", "Mystery", "Horror"];
  const movies = genres.flatMap((g, i) => many(`m${i}-`, 20 - i, g));
  const series = genres.flatMap((g, i) => many(`s${i}-`, 20 - i, g, 7, "teleplay"));
  const r = classify({
    peliculas: [section("2026", many("n", 3, "Drama")), section("2026 Peliculas teatrales", many("c", 3, "Drama")), section("All", movies)],
    series: [section("2026", many("u", 3, "Drama", 7, "teleplay")), section("All", series)],
  });
  const kept = r.slice(0, 20).map((x) => x.id), dropped = r.slice(20).map((x) => x.id);
  for (const id of ["magis_recent_peliculas", "magis_new_series", "magis_top_peliculas", "magis_top_series", "magis_new_peliculas"]) {
    assert.ok(kept.includes(id), id);
  }
  assert.ok(dropped.length > 0);
  assert.ok(dropped.every((x) => x.startsWith("magis_g_")));
  assert.ok(dropped.includes("magis_g_peliculas_horror"));
  assert.ok(kept.includes("magis_g_peliculas_action"));
});

test("featured ids are the recent, release and top rated rows, never a genre", () => {
  assert.equal(isFeatured("magis_recent_peliculas"), true);
  assert.equal(isFeatured("magis_new_series"), true);
  assert.equal(isFeatured("magis_top_peliculas"), true);
  assert.equal(isFeatured("magis_g_peliculas_action"), false);
});

test("nothing loaded means no rows", () => {
  assert.deepEqual(classify({}), []);
});

test("recent uploads keep the root's year section even for titles another root claims", () => {
  const shared = item("x", "Action");
  const r = classify({
    peliculas: [section("2026", [shared, ...many("p", 1, "Action")]), section("All", many("a", 6, "Action"))],
    anime: [section("All", [shared, ...many("n", 5, "Action")])],
  });
  assert.ok(row(r, "magis_recent_peliculas").shown.some((i) => i.id === "x"));
  assert.equal(row(r, "magis_top_peliculas").all.some((i) => i.id === "x"), false);
});

test("recent movies are ordered by upload date, whatever order the portal sent", () => {
  const r = classify({ peliculas: [section("2026", [shelved("old", 100), shelved("newest", 300), shelved("mid", 200)])] });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["newest", "mid", "old"]);
});

test("without upload dates the portal's order is kept", () => {
  const r = classify({ peliculas: [section("2026", [shelved("b", 0), shelved("a", 0), shelved("c", 0)])] });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["b", "a", "c"]);
});

test("an item with no date sits after the dated ones, in its own order", () => {
  const r = classify({ peliculas: [section("2026", [shelved("nodate1", 0), shelved("dated", 500), shelved("nodate2", 0)])] });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").shown), ["dated", "nodate1", "nodate2"]);
});

test("series with new chapters are ordered by upload date too", () => {
  const r = classify({ series: [section("2026", [shelved("s1", 10, "teleplay"), shelved("s2", 20, "teleplay")])] });
  assert.deepEqual(ids(row(r, "magis_new_series").shown), ["s2", "s1"]);
});

test("duplicates inside a year section collapse; roots are classified by kind order, not by input order", () => {
  const r = classify({ peliculas: [section("2026", [item("d"), item("d"), item("e")])] });
  assert.deepEqual(ids(row(r, "magis_recent_peliculas").all), ["d", "e"]);
});

// ---- one root at a time (2.2.8): the catalog stores its progress root by root ------------------------

test("orderRows puts rows of any source in classify's order, and mergeRoot one root at a time gives classify's rows", async () => {
  const { orderRows, mergeRoot } = await import("../src/homeClassifier.js");
  const tags = [["Drama", "Action"], ["Comedy"], ["Horror", "Drama"], ["Sci-Fi"], ["Family", "Comedy"]];
  const mk = (p, n, type) => Array.from({ length: n }, (_, i) => ({ id: p + i, title: "T" + p + i, poster: null, backdrop: null, durationS: 0, type, genres: tags[i % tags.length], score: (i * 37) % 10, description: "", shelvedAtMs: i }));
  const roots = {
    peliculas: [{ name: "2026", items: mk("p", 60, "movie") }, { name: "2026 Peliculas teatrales", items: mk("q", 20, "movie") }],
    series: [{ name: "2026", items: mk("s", 50, "teleplay") }], anime: [{ name: "x", items: mk("a", 40, "series") }], infantil: [{ name: "x", items: mk("k", 30, "movie") }],
  };
  const rows = classify(roots);
  const ids = (list) => list.map((r) => r.id);
  assert.deepEqual(ids(orderRows(rows)), ids(rows));
  assert.deepEqual(ids(orderRows(["infantil", "anime", "series", "peliculas"].flatMap((root) => rows.filter((r) => rootOfRow(r.id) === root)))), ids(rows));
  let merged = [];
  for (const root of ["anime", "peliculas", "infantil", "series"]) merged = mergeRoot(merged, root, classify({ [root]: roots[root] }));
  // No item is in two roots here: the same rows, in the same order, with the same items (genre rows' first
  // items aside, which classify orders across roots).
  assert.deepEqual(ids(merged), ids(rows));
  for (const r of rows) assert.deepEqual(new Set(merged.find((m) => m.id === r.id).all.map((i) => i.id)), new Set(r.all.map((i) => i.id)), r.id);
  // A root fetched again replaces its rows and leaves the others alone.
  const again = mergeRoot(merged, "series", classify({ series: [{ name: "2026", items: mk("z", 50, "teleplay") }] }));
  assert.ok(again.find((r) => r.id === "magis_top_series").all.every((i) => i.id.startsWith("z")));
  assert.deepEqual(again.find((r) => r.id === "magis_top_peliculas"), merged.find((r) => r.id === "magis_top_peliculas"));
});
