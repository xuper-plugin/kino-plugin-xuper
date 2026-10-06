import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput } from "../sdk/contract.mjs";
import { makeLiveCatalog, CATEGORIES_KEY } from "../src/liveCatalog.js";
import { makeLiveTiles, genresOf, isLiveTileRef, MAX_LIVE_TILES } from "../src/liveTiles.js";
import { makeCategories } from "../src/categories.js";
import { isChannelRef } from "../src/refs.js";
import { PortalError } from "../src/portal.js";
import { catalogSetup, manifest } from "./helpers/fakeCatalog.mjs";

// Invented names: the shapes of the portal's live root (getNextColumns masnew_live) and pages (v6/getLiveData).
const CATEGORIES = [
  { columnId: 1, name: "ChannelList" }, { columnId: 2, name: "Colombia" }, { columnId: 3, name: "Deportes" },
  { columnId: 4, name: "18+" }, { columnId: 5, name: "Noticias" }, { columnId: 6, name: "Fútbol" },
  { columnId: 7, name: "Kids" }, { columnId: 8, name: "Cine" },
];
const chan = (code) => ({ channelCode: code, name: "Canal " + code, posterList: [{ fileType: "icon", fileUrl: `https://img.test/${code}.png` }] });
const channels = (prefix, n) => Array.from({ length: n }, (_, i) => chan(`${prefix}-${i + 1}`));

function setup({ categories = CATEGORIES, byColumn = {}, lang = null, failCategories = null } = {}) {
  const base = fakeKino();
  const kino = lang ? { ...base, lang } : base;
  const calls = [];
  const portal = {
    calls,
    count: (path) => calls.filter((c) => c.path === path).length,
    async call(path, bean) {
      calls.push({ path, bean });
      await Promise.resolve();
      if (path === "getNextColumns") {
        if (failCategories) throw failCategories;
        return { recommendList: categories };
      }
      if (path === "v6/getLiveData") {
        const all = byColumn[bean.columnId] ?? [];
        if (all instanceof Error) throw all;
        const from = (bean.pageNum - 1) * bean.pageSize;
        return { channelList: all.slice(from, from + bean.pageSize) };
      }
      throw new Error("unscripted " + path);
    },
  };
  const session = { ensure: async () => {}, withValidSession: async (b) => b({ userId: "u", userToken: "t" }) };
  const clock = { now: () => 0 };
  const live = makeLiveCatalog({ kino, portal, session, clock });
  return { kino, portal, live, tiles: makeLiveTiles({ kino, live, clock }) };
}

test("one tile per genre, in a fixed order; countries, Todos and 18+ are never tiles; kit-valid", async () => {
  const { tiles } = setup();
  const out = await tiles.tiles();
  assert.deepEqual(out.map((t) => t.ref), ["xlive:deportes", "xlive:noticias", "xlive:infantil"]);
  assert.deepEqual(out.map((t) => t.title), ["Deportes en vivo", "Noticias en vivo", "Infantil en vivo"]);
  assert.ok(out.every((t) => isLiveTileRef(t.ref) && !("adult" in t)));
  assert.deepEqual(checkOutput("categories", out, manifest()).drops, []);
});

test("several categories of one genre share its tile (Deportes and Fútbol)", async () => {
  const { live } = setup();
  const g = genresOf(await live.genreCategories(Infinity));
  assert.deepEqual(g.find((x) => x.genre === "deportes").ids, ["3", "6"]);
  assert.equal(g.some((x) => x.ids.includes("4") || x.ids.includes("1") || x.ids.includes("2")), false);
});

test("what is kept is only [id, genre] of the genre categories", async () => {
  const { live, kino } = setup();
  await live.liveCategories();
  assert.deepEqual(JSON.parse(kino.storage.get(CATEGORIES_KEY)), [["3", "deportes"], ["5", "noticias"], ["6", "deportes"], ["7", "infantil"]]);
});

test("titles follow Kino's language", async () => {
  const out = await setup({ lang: "en-US" }).tiles.tiles();
  assert.deepEqual(out.map((t) => t.title), ["Live sports", "Live news", "Live kids"]);
});

test("at most MAX_LIVE_TILES tiles", async () => {
  const names = ["Deportes", "Noticias", "Infantil", "Peliculas", "Series", "Entretenimiento", "Musica", "Documentales", "Anime"];
  const out = await setup({ categories: names.map((name, i) => ({ columnId: 10 + i, name })) }).tiles.tiles();
  assert.equal(out.length, MAX_LIVE_TILES);
  assert.equal(out[0].ref, "xlive:deportes");
});

test("a kept categories list (En vivo read it) means listing the tiles asks the portal nothing", async () => {
  const { live, tiles, portal } = setup();
  await live.liveCategories(); // En vivo, the country row or an earlier Categorías
  assert.equal(portal.count("getNextColumns"), 1);
  assert.equal((await tiles.tiles()).length, 3);
  assert.equal(portal.count("getNextColumns"), 1, "no new portal call");
});

test("with nothing kept, one categories read, kept for the next time (and a new sandbox)", async () => {
  const w = setup();
  await w.tiles.tiles();
  assert.equal(w.portal.count("getNextColumns"), 1);
  assert.equal(typeof w.kino.storage.get(CATEGORIES_KEY), "string");
  await w.tiles.tiles();
  assert.equal(w.portal.count("getNextColumns"), 1);
  // A fresh sandbox (new modules) over the same storage.
  const live2 = makeLiveCatalog({ kino: w.kino, portal: w.portal, session: { ensure: async () => {}, withValidSession: async (b) => b({}) }, clock: { now: () => 0 } });
  assert.equal((await makeLiveTiles({ kino: w.kino, live: live2, clock: { now: () => 0 } }).tiles()).length, 3);
  assert.equal(w.portal.count("getNextColumns"), 1);
});

test("a failing categories read is no live tiles, never an error", async () => {
  const out = await setup({ failCategories: new PortalError("network", "down") }).tiles.tiles();
  assert.deepEqual(out, []);
});

test("browse of a tile: live items whose ref resolve routes to a channel, kit-valid, paged by 100", async () => {
  const { tiles } = setup({ byColumn: { 3: channels("d", 130), 6: channels("f", 20) } });
  const p1 = await tiles.browse("xlive:deportes", null);
  assert.equal(p1.items.length, 100);
  assert.ok(p1.items.every((i) => i.kind === "live" && isChannelRef(i.ref) && i.poster.startsWith("https://img.test/")));
  const checked = checkOutput("browse", p1, manifest());
  assert.deepEqual(checked.drops, []);
  assert.equal(checked.value.items.length, 100);
  const p2 = await tiles.browse("xlive:deportes", p1.next);
  assert.equal(p2.items.length, 30);
  // Deportes is done: Fútbol, the genre's other category, follows.
  const p3 = await tiles.browse("xlive:deportes", p2.next);
  assert.deepEqual(p3.items.map((i) => i.title), channels("f", 20).map((c) => c.name));
  assert.equal(p3.next, undefined);
});

test("browse skips a category that turns out empty inside the same call", async () => {
  const { tiles } = setup({ byColumn: { 3: [], 6: channels("f", 2) } });
  const p = await tiles.browse("xlive:deportes", null);
  assert.equal(p.items.length, 2);
  assert.equal(p.next, undefined);
});

test("browse of an unknown genre is not_found; a first page that fails is the mapped error; a later one ends the grid", async () => {
  const { tiles } = setup({ byColumn: { 3: new PortalError("network", "down") } });
  await assert.rejects(tiles.browse("xlive:nada", null), (e) => e.name === "KinoError_not_found");
  await assert.rejects(tiles.browse("xlive:deportes", null), (e) => e.name.startsWith("KinoError_"));
  assert.deepEqual(await tiles.browse("xlive:deportes", "0.2"), { items: [] });
});

test("Categorías: VOD tiles, then the live tiles, then 18+; live tiles alone when the VOD catalog fails", async () => {
  const vod = catalogSetup();
  const { tiles } = setup();
  const all = await makeCategories({ catalog: vod.catalog, kino: vod.kino, liveTiles: tiles }).categories();
  const live = all.filter((t) => isLiveTileRef(t.ref));
  assert.equal(live.length, 3);
  assert.equal(all.at(-1).adult, true);
  assert.equal(all.indexOf(live[0]), all.length - 1 - live.length, "right before 18+");
  assert.ok(all.length <= 24);
  assert.deepEqual(checkOutput("categories", all, manifest()).drops, []);
  const broken = { rows: async () => { throw new Error("portal down"); } };
  const alone = await makeCategories({ catalog: broken, liveTiles: tiles }).categories();
  assert.deepEqual(alone.map((t) => t.ref), live.map((t) => t.ref));
  await assert.rejects(makeCategories({ catalog: broken, liveTiles: { tiles: async () => [] } }).categories());
});

test("searching inside a live tile's grid is Kino's own filter (null), with no portal call", async () => {
  const vod = catalogSetup();
  assert.equal(await vod.catalog.search({ q: "canal", within: "xlive:deportes", cursor: null }), null);
  assert.equal(vod.portal.calls.length, 0);
});
