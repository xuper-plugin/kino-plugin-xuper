// Fix round 1 (owner D3, "Xuper keeps offering them"): the portal's 18+ VOD root (native "adultos" →
// masnew_adult, TvCatalogSections "18+", movies only) as ONE `adult: true` Categorías tile whose
// browse(ref) lists the root's movies, every item `adult: true`. Kino hides the tile and the items
// while the device's 18+ code is locked and plays them without writing history (app Task 7). The
// root is fetched on demand only (never one of Home's four shared roots) and never stored.
import test from "node:test";
import assert from "node:assert/strict";
import { checkOutput } from "../sdk/contract.mjs";
import { makeCatalog, ADULT_REF, ADULT_ROOT_CODE } from "../src/catalog.js";
import { makeCategories } from "../src/categories.js";
import { makeSection } from "../src/section.js";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { fourRoots, answer, column, asset, assets, manifest, NOW } from "./helpers/fakeCatalog.mjs";
import { portalWorld } from "./helpers/portalWorld.mjs";

const adultRoot = () => answer(
  column("Recientes", [...assets("x", 3), asset("xs1", { programType: "teleplay" })]),
  column("Populares", [asset("x2"), ...assets("y", 60)]),
);

function setup({ roots = { ...fourRoots(), masnew_adult: adultRoot() } } = {}) {
  const base = fakeKino();
  const sets = [];
  const kino = Object.freeze({ ...base, storage: Object.freeze({ ...base.storage, set: (k, v, o) => { sets.push(k); return base.storage.set(k, v, o); } }) });
  const calls = [];
  const portal = {
    async call(path, bean, opts) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      const a = roots[bean.columnCode];
      if (a === undefined) throw new Error("unscripted root " + bean.columnCode);
      const v = typeof a === "function" ? a() : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
  const session = { ensure: async () => {}, withValidSession: async (block, o) => { session.opts = o; return block({ userId: "u1", userToken: "tok1" }); } };
  const clock = { t: NOW, now() { return this.t; } };
  const catalog = makeCatalog({ kino, portal, session, clock });
  return { kino, sets, calls, session, clock, catalog, categories: makeCategories({ catalog }), section: makeSection({ kino, catalog, clock }) };
}
const adultCalls = (w) => w.calls.filter((c) => c.bean.columnCode === ADULT_ROOT_CODE);

test("Categorías ends with ONE 18+ tile, adult: true, whose ref is browse's; asking for it costs no portal call", async () => {
  const w = setup();
  const tiles = await w.categories.categories();
  const adult = tiles.filter((t) => t.adult === true);
  assert.equal(adult.length, 1);
  assert.deepEqual(adult[0], { id: ADULT_REF, title: "18+", ref: ADULT_REF, adult: true });
  assert.equal(tiles.at(-1).id, ADULT_REF);
  assert.ok(tiles.length <= 24);
  assert.equal(ADULT_ROOT_CODE, "masnew_adult");
  assert.equal(adultCalls(w).length, 0, "on demand only");
});

test("home, section and the other browses never ask for the adult root", async () => {
  const w = setup();
  const rows = await w.catalog.home();
  await w.section.section(null);
  await w.catalog.browse(rows[0].ref, null);
  assert.equal(adultCalls(w).length, 0);
  assert.ok(rows.every((r) => r.items.every((i) => i.adult !== true)));
});

test("browse(18+): the root's movies only, deduplicated, every item adult: true, paged by 50", async () => {
  const w = setup();
  const first = await w.catalog.browse(ADULT_REF, null);
  assert.equal(first.items.length, 50);
  assert.ok(first.items.every((i) => i.adult === true && i.kind === "movie"));
  assert.ok(!first.items.some((i) => i.id === "xs1"), "a series is left out (native plays movies only)");
  assert.deepEqual(first.items.slice(0, 4).map((i) => i.id), ["x1", "x2", "x3", "y1"]);
  assert.equal(first.next, "50");
  const second = await w.catalog.browse(ADULT_REF, first.next);
  assert.equal(second.items.length, 63 - 50);
  assert.equal(second.next, undefined);
  const call = adultCalls(w)[0];
  assert.deepEqual(call.bean, { columnCode: "masnew_adult", pageNum: 1, pageSize: 60, version: "" });
  assert.equal(typeof w.session.opts.deadline, "number", "inside browse's deadline");
});

test("browse(18+) stores nothing and is asked again on the next call; concurrent pages share one fetch", async () => {
  const w = setup();
  await Promise.all([w.catalog.browse(ADULT_REF, null), w.catalog.browse(ADULT_REF, "50")]);
  assert.equal(adultCalls(w).length, 1);
  await w.catalog.browse(ADULT_REF, null);
  assert.equal(adultCalls(w).length, 2);
  assert.deepEqual(w.sets.filter((k) => !k.startsWith("tree:")), []);
  assert.ok(!w.sets.some((k) => k.includes("adult")));
});

test("browse(18+): an empty root is an empty page; a failing one is the error (a kino one passes)", async () => {
  const empty = setup({ roots: { ...fourRoots(), masnew_adult: answer() } });
  assert.deepEqual(await empty.catalog.browse(ADULT_REF, null), { items: [] });
  const k = fakeKino();
  const failing = setup({ roots: { ...fourRoots(), masnew_adult: () => { throw k.error("geo_blocked", "x"); } } });
  await assert.rejects(failing.catalog.browse(ADULT_REF, null), (e) => e.name === "KinoError_geo_blocked");
});

test("kit at apiVersion 6 keeps the 18+ tile and its adult items; with the adult gate locked (below 6) both are dropped", async () => {
  const w = setup();
  const m = manifest();
  const tiles = await w.categories.categories();
  const kept = checkOutput("categories", tiles, m);
  assert.deepEqual(kept.drops, []);
  assert.equal(kept.value.at(-1).adult, true);
  const page = await w.catalog.browse(ADULT_REF, null);
  const keptPage = checkOutput("browse", page, m);
  assert.deepEqual(keptPage.drops, []);
  assert.ok(keptPage.value.items.every((i) => i.adult === true));

  const locked = { ...m, apiVersion: 5, settings: m.settings.filter((s) => !["section", "status", "action"].includes(s.type)) };
  delete locked.section;
  const lockedTiles = checkOutput("categories", tiles, locked);
  assert.ok(!lockedTiles.value.some((t) => t.id === ADULT_REF), "the 18+ tile is hidden");
  assert.ok(lockedTiles.drops.some((d) => d.includes("adult")));
  const lockedPage = checkOutput("browse", page, locked);
  assert.deepEqual(lockedPage.value.items, []);
});

test("over the real portal + session: the 18+ browse goes through the paced portal and its retries", async () => {
  const w = portalWorld({ hosts: ["a.test"] });
  const page = await w.catalog.browse(ADULT_REF, null);
  assert.ok(page.items.length > 0 && page.items.every((i) => i.adult === true));
  assert.deepEqual(w.requests.filter((r) => r.path === "getNextColumns").map((r) => r.bean.columnCode), ["masnew_adult"]);
});
