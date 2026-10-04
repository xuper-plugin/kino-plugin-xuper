import test from "node:test";
import assert from "node:assert/strict";
import { checkOutput } from "../sdk/contract.mjs";
import { makeCategories, tilesOf } from "../src/categories.js";
import { catalogSetup, manifest, fixtureRows, answer, column, assets, asset } from "./helpers/fakeCatalog.mjs";

const setup = (opts) => {
  const w = catalogSetup(opts);
  return { ...w, categories: makeCategories({ catalog: w.catalog }) };
};

test("categories are the home's featured and genre rows in the classifier's order, ref = row id", async () => {
  const { categories, catalog } = setup();
  const all = await categories.categories(null);
  // The 18+ tile closes the list (D3); the rest are Home's rows.
  assert.equal(all.at(-1).adult, true);
  const tiles = all.slice(0, -1);
  const home = await catalog.home();
  assert.deepEqual(tiles.map((t) => t.id), home.map((r) => r.id));
  assert.deepEqual(tiles.map((t) => t.title), home.map((r) => r.title));
  assert.ok(tiles.every((t) => t.ref === t.id));
  assert.ok(tiles.some((t) => t.id === "magis_g_anime_comedy" && t.title === "Comedia · Anime"));
});

test("every tile's ref pages through browse", async () => {
  const { categories, catalog } = setup();
  for (const t of await categories.categories(null)) {
    const page = await catalog.browse(t.ref, null);
    assert.ok(page.items.length > 0, t.id);
  }
});

test("a tile's art is its first shown item's backdrop, else its poster; none when the item has neither", async () => {
  const poster = (u) => ({ posterList: [{ fileType: "icon", fileUrl: u }] });
  const both = (p, b) => ({ posterList: [{ fileType: "icon", fileUrl: p }, { fileType: "poster", fileUrl: b }] });
  // Anime and kids: one genre each; the best-scored item is first in the row.
  const roots = {
    masnew_movies: answer(), masnew_series: answer(),
    masnew_anime: answer(column("All", [asset("a0", { programType: "series", tags: "Comedy", score: 9, ...both("https://img.test/p.jpg", "https://img.test/b.jpg") }),
      ...assets("a", 5, { programType: "series", tags: "Comedy" })])),
    masnew_kids: answer(column("All", [asset("k0", { tags: "Family", score: 9, ...poster("https://img.test/k.jpg") }), ...assets("k", 5, { tags: "Family" })])),
  };
  const tiles = await setup({ roots }).categories.categories(null);
  const art = Object.fromEntries(tiles.map((t) => [t.id, t.art]));
  assert.equal(art.magis_g_anime_comedy, "https://img.test/b.jpg");
  assert.equal(art.magis_g_infantil_family, "https://img.test/k.jpg");
  const plain = await setup().categories.categories(null);
  assert.ok(plain.every((t) => !("art" in t)), "no picture: the field is left out");
});

test("at most 24 tiles (the contract cap), the tail of the genre round-robin is what goes", async () => {
  const genres = ["Action", "Comedy", "Drama", "Thriller", "Crime", "Sci-Fi", "Fantasy", "Romance", "Mystery", "Horror", "Family", "War"];
  const mk = (prefix, type) => genres.flatMap((g, i) => assets(`${prefix}${i}-`, 8 + i, { tags: g, programType: type }));
  const roots = {
    masnew_movies: answer(column("2026", assets("n", 3)), column("All", mk("m", "movie"))),
    masnew_series: answer(column("2026", assets("u", 3, { programType: "teleplay" })), column("All", mk("s", "teleplay"))),
    masnew_anime: answer(column("All", mk("a", "series"))), masnew_kids: answer(column("All", mk("k", "movie"))),
  };
  const tiles = await setup({ roots }).categories.categories(null);
  assert.equal(tiles.length, 24);
  assert.equal(tiles.at(-1).adult, true, "the 18+ tile survives the cap");
  assert.deepEqual(tiles.slice(0, 4).map((t) => t.id), ["magis_recent_peliculas", "magis_new_series", "magis_top_peliculas", "magis_top_series"]);
  const checked = checkOutput("categories", tiles, manifest());
  assert.deepEqual(checked.drops, []);
  assert.equal(checked.value.length, 24);
});

test("only the last tile is 18+ (marked adult); no other tile names the adult root; every title fits 40 characters", async () => {
  const all = await setup().categories.categories(null);
  assert.deepEqual(all.filter((t) => t.adult === true).map((t) => t.id), [all.at(-1).id]);
  const tiles = all.slice(0, -1);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every((t) => !/adult|18\+/i.test(t.id + t.title + t.ref) && !("adult" in t)));
  assert.ok(all.every((t) => t.title.length <= 40));
  assert.ok(tiles.every((t) => t.title.length <= 40));
});

test("the kit accepts the answer with zero drops", async () => {
  const tiles = await setup().categories.categories(null);
  const checked = checkOutput("categories", tiles, manifest());
  assert.deepEqual(checked.drops, []);
  assert.equal(checked.value.length, tiles.length);
});

test("an empty catalog is no tiles, not an error", async () => {
  const roots = { masnew_movies: answer(), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() };
  assert.deepEqual(await setup({ roots }).categories.categories(null), []);
});

test("the real captured rows (home-1.json) as tiles, kit-valid", () => {
  const rows = fixtureRows();
  const tiles = tilesOf(rows);
  assert.deepEqual(tiles.map((t) => t.id), rows.map((r) => r.id));
  assert.ok(tiles.every((t) => t.ref === t.id));
  assert.deepEqual(checkOutput("categories", tiles, manifest()).drops, []);
});
