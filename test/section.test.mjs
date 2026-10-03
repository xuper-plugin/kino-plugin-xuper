import test from "node:test";
import assert from "node:assert/strict";
import { checkOutput } from "../sdk/contract.mjs";
import { makeSection, rowsOfTab, TABS } from "../src/section.js";
import { rootOfRow } from "../src/homeClassifier.js";
import { catalogSetup, manifest, fixtureRows, fixtureSkip, kinoErr, NOW } from "./helpers/fakeCatalog.mjs";

const ids = (rows) => rows.map((r) => r.id);
const setup = (opts) => {
  const w = catalogSetup(opts);
  return { ...w, section: makeSection({ kino: w.kino, catalog: w.catalog, clock: w.clock }) };
};
// Native TvCatalogSections order; never the adult root.
const EXPECTED_TABS = [
  { id: "peliculas", label: "Películas" }, { id: "series", label: "Series" },
  { id: "infantil", label: "Infantil" }, { id: "anime", label: "Anime" },
];

test("section(null) answers the four tabs in the native order and the first tab's rows", async () => {
  const { section } = setup();
  const out = await section.section(null);
  assert.deepEqual(out.tabs, EXPECTED_TABS);
  assert.equal(out.tab, "peliculas");
  assert.deepEqual(ids(out.rows), ["magis_recent_peliculas", "magis_top_peliculas", "magis_g_peliculas_drama", "magis_g_peliculas_action"]);
  assert.ok(out.rows.every((r) => r.ref === r.id && r.items.length > 0));
});

test("section with no tab (undefined, {}, {tab:null}, {tab:\"\"}) is the first tab", async () => {
  const { section } = setup();
  const first = await section.section(null);
  for (const arg of [undefined, {}, { tab: null }, { tab: "" }]) assert.deepEqual(await section.section(arg), first, JSON.stringify(arg));
});

test("section({tab:\"series\"}) answers the series root's classified rows", async () => {
  const { section } = setup();
  const out = await section.section({ tab: "series" });
  assert.equal(out.tab, "series");
  assert.deepEqual(out.tabs, EXPECTED_TABS);
  assert.deepEqual(ids(out.rows), ["magis_new_series", "magis_top_series", "magis_g_series_drama"]);
  assert.deepEqual(ids((await section.section({ tab: "anime" })).rows), ["magis_g_anime_comedy"]);
  assert.deepEqual(ids((await section.section({ tab: "infantil" })).rows), ["magis_g_infantil_family"]);
});

test("a tab's rows are the home's rows of that root, same items (the home's shared trees, no extra portal call)", async () => {
  const { section, catalog, portal } = setup();
  const home = await catalog.home();
  const calls = portal.calls.length;
  for (const { id } of EXPECTED_TABS) {
    const out = await section.section({ tab: id });
    assert.deepEqual(out.rows, home.filter((r) => rootOfRow(r.id) === id), id);
  }
  assert.equal(portal.calls.length, calls, "served from the stored trees");
});

test("an unknown tab, and the adult root, are not_found", async () => {
  const { section } = setup();
  for (const tab of ["nope", "adultos", "18+", "PELICULAS"]) await assert.rejects(section.section({ tab }), kinoErr("not_found"), tab);
});

test("no tab names the adult root", () => {
  assert.ok(TABS.every((t) => !/adult|18/i.test(t.id + t.label)));
});

test("the kit accepts every tab's answer with zero drops", async () => {
  const { section } = setup();
  for (const { id } of EXPECTED_TABS) {
    const out = await section.section({ tab: id });
    const checked = checkOutput("section", out, manifest());
    assert.deepEqual(checked.drops, [], id);
    assert.equal(checked.value.tab, id);
    assert.equal(checked.value.rows.length, out.rows.length);
  }
});

test("rootOfRow maps every classifier row id to its root; anything else is null", () => {
  assert.equal(rootOfRow("magis_recent_peliculas"), "peliculas");
  assert.equal(rootOfRow("magis_new_peliculas"), "peliculas");
  assert.equal(rootOfRow("magis_new_series"), "series");
  assert.equal(rootOfRow("magis_top_series"), "series");
  assert.equal(rootOfRow("magis_g_anime_adventure"), "anime");
  assert.equal(rootOfRow("magis_g_infantil_scifi"), "infantil");
  for (const bad of ["magis_g_adultos_x", "magis_top_", "other", "", undefined]) assert.equal(rootOfRow(bad), null, String(bad));
});

test("the real captured rows (home-1.json) split by root, kit-valid", { skip: fixtureSkip }, () => {
  const rows = fixtureRows();
  assert.deepEqual(ids(rowsOfTab(rows, "peliculas", NOW)), ["magis_new_peliculas"]);
  assert.deepEqual(ids(rowsOfTab(rows, "series", NOW)), ["magis_new_series", "magis_g_series_thriller"]);
  assert.deepEqual(ids(rowsOfTab(rows, "anime", NOW)), ["magis_g_anime_adventure"]);
  assert.deepEqual(ids(rowsOfTab(rows, "infantil", NOW)), []);
  for (const { id } of TABS) {
    const out = { tabs: TABS, tab: id, rows: rowsOfTab(rows, id, NOW) };
    assert.deepEqual(checkOutput("section", out, manifest()).drops, [], id);
  }
});

// ---- Task 15 review minor 1: concurrent cold calls share the pending root fetches ----------------

test("home, section and categories called cold at the same moment ask each root once (4 getNextColumns, not 12)", async () => {
  const { makeCategories } = await import("../src/categories.js");
  const w = setup();
  const categories = makeCategories({ catalog: w.catalog });
  await Promise.all([w.catalog.home(), w.section.section(null), categories.categories()]);
  const roots = w.portal.calls.filter((c) => c.path === "getNextColumns").map((c) => c.bean.columnCode);
  assert.equal(roots.length, 4, roots.join(","));
  assert.equal(new Set(roots).size, 4);
  // Once settled, a later cold root is asked again (nothing stays pinned in memory).
  w.kino.storage.remove("tree:peliculas");
  await w.catalog.home();
  assert.equal(w.portal.calls.filter((c) => c.path === "getNextColumns").length, 5);
});
