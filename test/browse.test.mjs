// The browse screen (route "categories"): skeletons first, the active tab then the rest as the timer fetches them, the
// featured slider, the rails, "Continuar viendo", and a tab that fails. Kino's kit reads every tree as the app does.
import test from "node:test";
import assert from "node:assert/strict";
import { accountWorld } from "./helpers/accountWorld.mjs";
import { screenHarness, allNodes, byKey } from "./helpers/screenHarness.mjs";
import { makeRecentStore } from "../src/recentStore.js";
import { encode } from "../src/refs.js";

const item = (root, n, extra = {}) => ({
  id: `${root}-${n}`, title: `Título ${root} ${n}`, poster: `https://img.test/${root}${n}p.jpg`, backdrop: `https://img.test/${root}${n}b.jpg`,
  durationS: 5400, type: root === "series" ? "series" : "movie", genres: ["Drama"], score: 7.5,
  description: `Sinopsis de ${root} ${n}.`, shelvedAtMs: 0, ...extra,
});
const row = (root, name, count = 8) => ({ id: `magis_top_${root}`, title: name, shown: Array.from({ length: count }, (_, i) => item(root, i + 1)) });
const rowsOf = (root) => [row(root, `Lo más visto en ${root}`), { ...row(root, "Recién llegadas", 5), id: `magis_new_${root}` }];

/** A catalog that keeps nothing until a tab is fetched; `failing` makes a tab's fetch throw. */
function fakeCatalog({ kept = [], failing = new Set() } = {}) {
  const state = { rows: [...kept], fetched: [] };
  return {
    state,
    peek: () => (state.rows.length > 0 ? { rows: state.rows, roots: {}, whole: [] } : null),
    rows: async (need, root) => {
      state.fetched.push(root);
      if (failing.has(root)) throw new Error("portal");
      state.rows = [...state.rows.filter((r) => !r.id.endsWith(root)), ...rowsOf(root)];
      return state.rows;
    },
    idsLookup: () => () => null,
  };
}

function harness({ device = "phone", lang = "es", catalog = fakeCatalog() } = {}) {
  const world = accountWorld();
  const recent = makeRecentStore({ kino: world.kino, clock: world.clock });
  const h = screenHarness(world, { device, lang, start: "main", deps: () => ({ settings: world.settings, session: world.session, registration: world.registration, catalog, recent }) });
  return { h, catalog, recent, world };
}

const types = (tree) => allNodes(tree).map((n) => n.type);

test("before anything is kept: skeletons shaped like the slider and the rails, a tab bar, no timer until open", async () => {
  const { h } = harness();
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(types(r.tree).includes("skeleton"));
  assert.ok(!types(r.tree).includes("pageView") && !types(r.tree).includes("titleRail"));
  assert.deepEqual(byKey(r.tree, "tabs").tabs.map((t) => t.value), ["peliculas", "series", "infantil", "anime"]);
  assert.equal(r.raw.every, undefined);
});

test("open on a phone queues the active tab first, then the others; the timer fills them one per tick", async () => {
  const { h, catalog } = harness();
  await h.send("open");
  assert.deepEqual(h.state.pending, ["peliculas", "series", "infantil", "anime"]);
  assert.ok((await h.render()).every, "a timer while something is pending");
  await h.send("tick", { timer: true });
  assert.deepEqual(catalog.state.fetched, ["peliculas"]);
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(types(r.tree).includes("pageView"), "the featured slider");
  assert.equal(byKey(r.tree, "hero").autoPlayMs, 6000);
  const rails = allNodes(r.tree).filter((n) => n.type === "titleRail");
  assert.equal(rails.length, 2);
  assert.ok(rails.every((n) => n.items.length > 0));
  for (let i = 0; i < 3; i++) await h.send("tick", { timer: true });
  assert.deepEqual(catalog.state.fetched, ["peliculas", "series", "infantil", "anime"]);
  assert.equal(h.state.pending.length, 0);
  assert.equal((await h.render()).raw.every, undefined, "nothing pending: no timer");
});

test("on a TV only the tab in view is fetched; the others load when they are selected", async () => {
  const { h, catalog } = harness({ device: "tv" });
  await h.send("open");
  assert.deepEqual(h.state.pending, ["peliculas"]);
  await h.send("tick", { timer: true });
  assert.deepEqual(catalog.state.fetched, ["peliculas"]);
  await h.send("tab", { value: "series" });
  assert.equal(h.state.tab, "series");
  assert.deepEqual(h.state.pending, ["series"]);
  const before = await h.render();
  assert.ok(types(before.tree).includes("skeleton"), "the new tab shows skeletons until it arrives");
  await h.send("tick", { timer: true });
  assert.ok(types((await h.render()).tree).includes("titleRail"));
});

test("kept rows paint at once: the first render after open already shows the rails, the fetch only refreshes them", async () => {
  const { h } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(types(r.tree).includes("titleRail"));
  assert.ok(!types(r.tree).includes("skeleton"));
});

test("a tab that cannot load says so with a retry button; the retry fetches it again", async () => {
  const catalog = fakeCatalog({ failing: new Set(["peliculas"]) });
  const { h } = harness({ catalog });
  await h.send("open");
  await h.send("tick", { timer: true });
  let r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(byKey(r.tree, "loadFailed"));
  catalog.state.fetched.length = 0;
  await h.send("retry");
  assert.equal(h.state.failed, undefined);
  assert.equal(h.state.pending[0], "peliculas");
});

test("Continuar viendo: the played titles come first, newest first; a title that left the lists is not shown", async () => {
  const { h, recent } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  recent.note(encode({ contentId: "peliculas-3" }));
  recent.note(encode({ contentId: "peliculas-1" }));
  recent.note(encode({ contentId: "gone-9" }));
  await h.send("open");
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  const rail = byKey(r.tree, "recent");
  assert.equal(rail.title, "Continuar viendo");
  assert.deepEqual(rail.items.map((i) => i.id), ["peliculas-1", "peliculas-3"]);
  const first = allNodes(r.tree).filter((n) => n.type === "titleRail")[0];
  assert.equal(first.key, "recent");
});

test("in English; every tree draws with nothing dropped, on the phone and on the TV", async () => {
  for (const device of ["phone", "tv"]) {
    const { h } = harness({ device, lang: "en", catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
    await h.send("open");
    await h.send("tick", { timer: true });
    const r = await h.render();
    assert.deepEqual(r.dropped, [], device);
    assert.equal(r.raw.body.children[0].tabs[0].labelEn, "Movies");
  }
});

test("the settings route still draws the settings screen", async () => {
  const world = accountWorld();
  const recent = makeRecentStore({ kino: world.kino, clock: world.clock });
  const h = screenHarness(world, { deps: () => ({ settings: world.settings, session: world.session, registration: world.registration, catalog: fakeCatalog(), recent }) });
  const r = await h.render();
  assert.equal(r.raw.type, "Scaffold");
  assert.deepEqual(r.raw.appBar.title.tabs.map((t) => t.value), ["account", "connection", "more"]);
});

test("a play is noted: the same title twice moves nothing, the list is capped", () => {
  const world = accountWorld();
  const recent = makeRecentStore({ kino: world.kino, clock: world.clock });
  for (let i = 0; i < 20; i++) recent.note(encode({ contentId: `t${i}` }));
  recent.note(encode({ contentId: "t19" }));
  recent.note("not a ref");
  assert.equal(recent.ids().length, 12);
  assert.equal(recent.ids()[0], "t19");
});

test("the search icon opens a box under the bar; submitting it sends Kino's search narrowed to Xuper", async () => {
  const { h } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.equal(r.raw.floatingActionButton.icon, "search");
  assert.equal(byKey(r.tree, "searchBox").hidden, true);
  const a = await h.send("search", { value: { q: "  dune  " } });
  assert.deepEqual(a.raw, { go: { search: { q: "dune" } } });
  assert.equal((await h.send("search", { value: { q: "   " } })).raw, null);
});
