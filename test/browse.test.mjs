// The browse screen (route "categories"): skeletons first, the active tab then the rest as the timer fetches them, the
// featured slider, the rails, "Continuar viendo", and a tab that fails. Kino's kit reads every tree as the app does.
import test from "node:test";
import assert from "node:assert/strict";
import { accountWorld } from "./helpers/accountWorld.mjs";
import { screenHarness, allNodes, byKey } from "./helpers/screenHarness.mjs";

/** A row of the list: a column of its heading and its poster cards (the plugin draws them itself so a card's tap can open its own page). */
const railsOf = (tree) => allNodes(tree).filter((n) => n.type === "col" && typeof n.key === "string" && (n.key === "recent" || n.key === "live" || n.key.startsWith("rail-")) && allNodes(n).some((c) => c.type === "titleCard"));
const cardsOf = (node) => allNodes(node).filter((n) => n.type === "titleCard");
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
    search: async ({ q }) => { state.searched = (state.searched || []).concat(q); if (state.searchFails) throw new Error("portal"); return q === "nada" ? [] : [item("peliculas", 1), item("series", 2, { adult: true })].map((i) => ({ id: i.id, ref: "magis1:movie:0:" + i.id, title: i.title, kind: "movie", poster: i.poster, adult: i.adult })); },
  };
}

/** Live pieces: two genres of channels, a country row and a search over the channels. */
function fakeLive({ empty = false } = {}) {
  const ch = (n, g) => ({ id: `${g}-${n}`, ref: `chan${g}${n}`, title: `Canal ${g} ${n}`, kind: "live", poster: `https://img.test/c${g}${n}.png` });
  const pages = { "xlive:deportes": [1, 2, 3].map((n) => ch(n, "d")), "xlive:noticias": [1, 2].map((n) => ch(n, "n")) };
  return {
    liveTiles: { tiles: async () => (empty ? [] : [{ id: "xlive:deportes", ref: "xlive:deportes", title: "Deportes" }, { id: "xlive:noticias", ref: "xlive:noticias", title: "Noticias" }]), browse: async (ref) => ({ items: pages[ref] || [] }) },
    countryRow: async () => (empty ? null : { id: "country", title: "Canales en vivo", items: [ch(9, "c")] }),
    live: { liveSearch: async ({ q }) => ({ items: q === "nada" ? [] : [ch(7, "s")] }) },
  };
}

function harness({ device = "phone", lang = "es", catalog = fakeCatalog() } = {}) {
  const world = accountWorld();
  const recent = makeRecentStore({ kino: world.kino, clock: world.clock });
  const liveDeps = fakeLive();
  const h = screenHarness(world, { device, lang, start: "main", deps: () => ({ settings: world.settings, session: world.session, registration: world.registration, catalog, recent, ...liveDeps }) });
  return { h, catalog, recent, world };
}

const types = (tree) => allNodes(tree).map((n) => n.type);

test("before anything is kept: skeletons shaped like the slider and the rails, a tab bar, no timer until open", async () => {
  const { h } = harness();
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(types(r.tree).includes("skeleton"));
  assert.ok(!types(r.tree).includes("pageView") && railsOf(r.tree).length === 0);
  assert.deepEqual(byKey(r.tree, "tabs").tabs.map((t) => t.value), ["peliculas", "series", "infantil", "anime"]);
  assert.equal(r.raw.every, undefined);
});

test("open on a phone queues the active tab first, then the others; the timer fills them one per tick", async () => {
  const { h, catalog } = harness();
  await h.send("open");
  assert.deepEqual(h.state.pending, ["peliculas", "live", "series", "infantil", "anime"]);
  assert.ok((await h.render()).every, "a timer while something is pending");
  await h.send("tick", { timer: true });
  assert.deepEqual(catalog.state.fetched, ["peliculas"]);
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(types(r.tree).includes("pageView"), "the featured slider");
  assert.equal(allNodes(r.tree).find((n) => n.type === "pageView").autoPlayMs, 6000);
  assert.match(allNodes(r.tree).find((n) => n.type === "pageView").key, /^hero\d+$/, "the slider's key carries its slide count");
  const rails = railsOf(r.tree);
  assert.equal(rails.length, 2);
  assert.ok(rails.every((n) => cardsOf(n).length > 0));
  for (let i = 0; i < 4; i++) await h.send("tick", { timer: true });
  assert.deepEqual(catalog.state.fetched, ["peliculas", "series", "infantil", "anime"]);
  assert.equal(h.state.pending.length, 0);
  assert.equal((await h.render()).raw.every, undefined, "nothing pending: no timer");
});

test("on a TV only the tab in view is fetched; the others load when they are selected", async () => {
  const { h, catalog } = harness({ device: "tv" });
  await h.send("open");
  assert.deepEqual(h.state.pending, ["peliculas", "live"]);
  await h.send("tick", { timer: true });
  assert.deepEqual(catalog.state.fetched, ["peliculas"]);
  await h.send("tab", { value: "series" });
  assert.equal(h.state.tab, "series");
  assert.deepEqual(h.state.pending, ["series", "live"]);
  const before = await h.render();
  assert.ok(types(before.tree).includes("skeleton"), "the new tab shows skeletons until it arrives");
  await h.send("tick", { timer: true });
  assert.ok(railsOf((await h.render()).tree).length > 0);
});

test("kept rows paint at once: the first render after open already shows the rails, the fetch only refreshes them", async () => {
  const { h } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(railsOf(r.tree).length > 0);
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
  assert.equal(byKey(r.tree, "recent-h").children[0].text, "Continuar viendo");
  assert.deepEqual(cardsOf(rail).map((n) => n.item.id), ["peliculas-1", "peliculas-3"]);
  assert.equal(railsOf(r.tree)[0].key, "recent");
});

test("in English; every tree draws with nothing dropped, on the phone and on the TV", async () => {
  for (const device of ["phone", "tv"]) {
    const { h } = harness({ device, lang: "en", catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
    await h.send("open");
    await h.send("tick", { timer: true });
    const r = await h.render();
    assert.deepEqual(r.dropped, [], device);
    assert.equal(byKey(r.tree, "tabs").tabs[0].label, "Movies");
  }
});

test("the settings route still draws the settings screen", async () => {
  const world = accountWorld();
  const recent = makeRecentStore({ kino: world.kino, clock: world.clock });
  const h = screenHarness(world, { deps: () => ({ settings: world.settings, session: world.session, registration: world.registration, catalog: fakeCatalog(), recent }) });
  const r = await h.render();
  assert.equal(r.raw.type, "Scaffold");
  assert.deepEqual(byKey(r.tree, "tabs").tabs.map((t) => t.value), ["account", "connection", "more"]);
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

test("the floating button opens the search page in the plugin; submitting words shows skeletons, then the results as a grid", async () => {
  const { h, catalog } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.equal(r.raw.floatingActionButton.icon, "search");
  assert.equal(byKey(r.tree, "searchBox"), null, "no search box on the browse page");
  await h.send("openSearch");
  assert.equal(h.route(), "search");
  const idle = await h.render();
  assert.deepEqual(idle.dropped, []);
  assert.ok(byKey(idle.tree, "q") && !types(idle.tree).includes("skeleton"), "the box alone, nothing loading");
  assert.equal((await h.send("search", { value: { q: "   " } })).raw, null);
  await h.send("search", { value: { q: "  dune  " } });
  const loading = await h.render();
  assert.deepEqual(loading.dropped, []);
  assert.ok(types(loading.tree).includes("skeleton") && !types(loading.tree).includes("grid"));
  assert.ok(loading.every, "a timer runs the search");
  await h.send("stick", { timer: true });
  assert.deepEqual(catalog.state.searched, ["dune"]);
  const done = await h.render();
  assert.deepEqual(done.dropped, []);
  assert.equal((done.every || []).length, 0);
  const grid = byKey(done.tree, "results");
  assert.equal(cardsOf(grid).length, 2);
  assert.equal(cardsOf(grid)[1].item.adult, true, "Kino hides it unless the 18+ code is unlocked");
  assert.equal(byKey(done.tree, "q").value, "dune");
});

test("a search that finds nothing says so; one that fails offers a retry; back returns to the browse", async () => {
  const { h, catalog } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  await h.send("search", { value: { q: "nada" } });
  await h.send("stick", { timer: true });
  assert.ok(allNodes((await h.render()).tree).some((n) => n.type === "text" && /Nada|nada|encontramos/.test(String(n.text))));
  catalog.state.searchFails = true;
  await h.send("search", { value: { q: "otra" } });
  await h.send("stick", { timer: true });
  assert.ok(byKey((await h.render()).tree, "searchFailed"));
  catalog.state.searchFails = false;
  await h.send("sretry");
  await h.send("stick", { timer: true });
  assert.ok(byKey((await h.render()).tree, "results"));
  await h.send("back");
  assert.equal(h.route(), "main");
});

test("the empty search page paints what earlier searches found (never an 18+ title); a new search replaces it", async () => {
  const { h } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  await h.send("openSearch");
  assert.equal(byKey((await h.render()).tree, "history"), null, "nothing yet, nothing painted");
  await h.send("search", { value: { q: "dune" } });
  await h.send("stick", { timer: true });
  await h.send("back");
  await h.send("openSearch");
  const again = await h.render();
  assert.deepEqual(again.dropped, []);
  const hist = byKey(again.tree, "history");
  assert.equal(cardsOf(hist).length, 1, "the adult one was not kept");
  assert.ok(!types(again.tree).includes("skeleton"));
  await h.send("search", { value: { q: "otra" } });
  const loading = await h.render();
  assert.equal(byKey(loading.tree, "history"), null, "the real search replaces it");
  assert.ok(types(loading.tree).includes("skeleton"));
});

test("the home gets a live row once the timer has asked, and the live button opens the live page", async () => {
  const { h } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  assert.equal(byKey((await h.render()).tree, "live"), null, "no row until it is asked");
  await h.send("tick", { timer: true });
  await h.send("tick", { timer: true });
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  const row = byKey(r.tree, "live");
  assert.equal(byKey(r.tree, "live-h").children[0].text, "En vivo");
  assert.equal(cardsOf(row)[0].item.kind, "live");
  assert.equal(r.raw.appBar.actions[0].icon, "tv");
  await h.send("go", { arg: "live" });
  assert.equal(h.route(), "live");
});

test("the live page: genres as tabs, channels as a grid, a search over the channels, back returns", async () => {
  const { h } = harness({ catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  await h.send("go", { arg: "live" });
  const first = await h.render();
  assert.deepEqual(first.dropped, []);
  assert.ok(types(first.tree).includes("skeleton"));
  await h.send("ltick", { timer: true });
  await h.send("ltick", { timer: true });
  const done = await h.render();
  assert.deepEqual(done.dropped, []);
  assert.equal(byKey(done.tree, "channels").items.length, 3);
  assert.equal(byKey(done.tree, "genres").tabs.length, 2);
  await h.send("lcat", { value: "xlive:noticias" });
  await h.send("ltick", { timer: true });
  assert.equal(byKey((await h.render()).tree, "channels").items.length, 2);
  await h.send("lsearch", { value: { lq: " liga " } });
  const searching = await h.render();
  assert.deepEqual(searching.dropped, []);
  assert.ok(types(searching.tree).includes("skeleton") && byKey(searching.tree, "genres") === null);
  await h.send("ltick", { timer: true });
  const found = await h.render();
  assert.equal(byKey(found.tree, "channels").items[0].title, "Canal s 7");
  await h.send("lsearch", { value: { lq: "" } });
  assert.ok(byKey((await h.render()).tree, "genres"), "cleared words bring the genres back");
  await h.send("back");
  assert.equal(h.route(), "main");
});

test("on a TV the search is a button of the bar (no floating one) and the live channels are round tiles", async () => {
  const { h } = harness({ device: "tv", catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  await h.send("tick", { timer: true });
  await h.send("tick", { timer: true });
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.equal(r.raw.floatingActionButton, undefined);
  assert.ok(r.raw.appBar.actions.some((a) => a.key === "searchButton" && a.icon === "search"));
  assert.ok(byKey(r.tree, "liveScroll"), "a sideways row of round channels");
  assert.ok(allNodes(r.tree).filter((n) => n.type === "avatar").length >= 1);
  await h.send("go", { arg: "live" });
  await h.send("ltick", { timer: true });
  await h.send("ltick", { timer: true });
  const page = await h.render();
  assert.deepEqual(page.dropped, []);
  assert.ok(allNodes(page.tree).filter((n) => n.type === "avatar").length >= 3);
});

test("on a TV the search box and its button live in the bar (field left, button right) and the bar has no title", async () => {
  const { h } = harness({ device: "tv", catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  await h.send("openSearch");
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.equal(typeof r.raw.appBar.title, "object");
  assert.ok(byKey(r.tree, "q") && byKey(r.tree, "searchGo"));
  assert.equal(r.raw.body.children[0].children.some((n) => n.key === "searchForm"), false, "not repeated in the page");
});

test("on a TV the live page's search box also lives in the bar", async () => {
  const { h } = harness({ device: "tv", catalog: fakeCatalog({ kept: rowsOf("peliculas") }) });
  await h.send("open");
  await h.send("go", { arg: "live" });
  await h.send("ltick", { timer: true });
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  assert.ok(byKey(r.tree, "lq") && byKey(r.tree, "lsearchGo"));
  assert.equal(typeof r.raw.appBar.title, "object");
});

test("TMDB ids and title logos: asked through kino.meta after a tab loads, the cards then carry the id and the slide its logo", async () => {
  const calls = [];
  const world = accountWorld();
  const kino = Object.assign(Object.create(Object.getPrototypeOf(world.kino)), world.kino);
  const meta = async (q) => { calls.push(q.title); return { ids: { tmdb: 4242 }, logo: `https://image.tmdb.org/t/p/w500/${calls.length}.png` }; };
  meta.byTitle = true;
  const catalog = fakeCatalog({ kept: [] });
  const recent = makeRecentStore({ kino: world.kino, clock: world.clock });
  const h = screenHarness({ ...world, kino: { ...world.kino, meta } }, { device: "phone", start: "main", deps: () => ({ settings: world.settings, session: world.session, registration: world.registration, catalog, recent, ...fakeLive() }) });
  await h.send("open");
  await h.send("tick", { timer: true });
  assert.equal(h.state.pending[0], "meta:peliculas");
  await h.send("tick", { timer: true });
  assert.ok(calls.length > 0);
  const r = await h.render();
  assert.deepEqual(r.dropped, []);
  const hero = allNodes(r.tree).find((n) => n.type === "pageView");
  assert.ok(allNodes(hero).some((n) => n.type === "heroCard" && /image\.tmdb\.org/.test(String(n.logo))), "a slide carries its logo");
  assert.equal(cardsOf(railsOf(r.tree)[0])[0].item.tmdb, 4242);
});
