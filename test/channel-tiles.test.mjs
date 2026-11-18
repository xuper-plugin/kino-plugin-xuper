// The live tabs' channel tiles (src/screenView.js): the plugin's own cards, so a channel's logo shows whole (Kino's
// titleCard is a 2:3 poster that cropped it: "ARACO / ELEVISIÓ", "NAL R", "ISPI"). Every grid that shows live channels
// (En vivo, Fútbol ▸ Canales), the fallback, the 18+ rule, Kino's node budget and the lazy list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";
import { gridOf, tilesOf, channelsOf } from "./helpers/tiles.mjs";

globalThis.kino = { lang: "es", config: {} };
const sv = await import("../src/screenView.js");
const { vivoView, deportesView, channelItems, channelInitials, LV_STEP, LV_PAGE } = sv;
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { screen, screenEvent } = await import("../src/screen.js");
const tvenvivo = (await import("../src/sources/tvenvivo.js")).default;
const caracol = (await import("../src/sources/caracol.js")).default;

const CARACOL_JSON = readFileSync(new URL("./fixtures/sources-a/caracol-livechannels.json", import.meta.url), "utf8");

// ── tree helpers ──
function walk(node, fn, path = []) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn, path)); return; }
  if (!node || typeof node !== "object") return;
  fn(node, path);
  const next = typeof node.type === "string" ? [...path, node] : path;
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn, next);
}
const all = (tree, pred) => { const out = []; walk(tree, (n, path) => { if (pred(n)) out.push({ n, path }); }); return out; };
/** The nodes Kino counts against its 600 (every object with a `type`: the tabs' and options' entries have none). */
const nodeCount = (tree) => all(tree, (n) => typeof n.type === "string").length;
const KEY_RULE = /^[A-Za-z0-9._~-]{1,128}$/;

const cats = [{ id: "v.co", title: "Colombia" }, { id: "v.sports", title: "Deportes" }];
const chans = (n, o = {}) => Array.from({ length: n }, (_, i) => ({
  id: "src_" + i.toString(36), ref: "L:src:" + i, title: (o.title || "Canal ") + i,
  ...(o.noLogo ? {} : { logo: "https://img.example.com/" + i + ".png" }),
}));
/** Both live tabs, on a phone and on a TV. */
const liveTabs = (opts) => ["phone", "tv"].flatMap((device) => [
  ["vivo", device, vivoView({ cats, cat: "v.co", device, ...opts })],
  ["sp", device, deportesView({ depTab: "canales", cats, cat: "v.sports", device, chLoading: opts.loading, chFailed: opts.failed, chOffline: opts.offline, ...opts })],
]);
const inLang = (lang, fn) => { const was = globalThis.kino.lang; globalThis.kino.lang = lang; try { return fn(); } finally { globalThis.kino.lang = was; } };

// ── the tile ──

test("every live grid (En vivo, Fútbol ▸ Canales) draws the plugin's tiles: the logo whole (contain, 4:3, inset), EN VIVO, the name, a tap that plays", () => {
  for (const lang of ["es", "en"]) {
    inLang(lang, () => {
      for (const [p, device, v] of liveTabs({ channels: chans(3) })) {
        const grid = gridOf(v, p);
        assert.equal(grid.type, "ListView", p + " " + device);
        assert.deepEqual(grid.columns, { compact: 2, expanded: 6 }, "two tiles a row on a phone, six on a wide screen");
        assert.equal(all(v, (n) => n.type === "titleCard" || (n.type === "titleGrid" && !n.hidden)).length, 0, "no Kino poster card left");
        const tiles = tilesOf(v, p);
        assert.equal(tiles.length, 3);
        tiles.forEach((t, i) => {
          assert.equal(t.type, "Card");
          assert.equal(t.flush, true);
          assert.equal(t.background, "surfaceVariant", "Kino's neutral raised surface: the same colour as the logo's box");
          assert.deepEqual(t.badge, { text: lang === "en" ? "LIVE" : "EN VIVO", textEn: "LIVE", color: "error" });
          assert.deepEqual(t.onTap, { go: { play: { ref: "L:src:" + i, kind: "live", id: "src_" + i.toString(36), title: "Canal " + i } } });
          const [logo, name] = t.children;
          assert.equal(logo.type, "Image");
          assert.equal(logo.url, "https://img.example.com/" + i + ".png");
          assert.equal(logo.fit, "contain", "the whole logo, never cropped");
          assert.equal(logo.aspect, "4:3");
          assert.deepEqual(logo.margin, { x: 12, top: 12, bottom: 4 }, "the logo never touches the tile's edges");
          assert.equal(logo.fallback.type, "Column");
          assert.equal(name.type, "Text");
          assert.equal(name.text, "Canal " + i);
          assert.equal(name.maxLines, 2);
          assert.equal(name.minHeight, device === "phone" ? 64 : 80, "one-line and two-line names make tiles of one height");
        });
      }
    });
  }
});

// Kino's size scale (PluginScreenDecl ScreenLimits.SIZE_SCALE): a minHeight off it drops the node.
const SIZE_SCALE = [16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640];

test("the name's box holds two lines at a large font size (system font size or theme scale), so a row's tiles end level", () => {
  // Kino applies minHeight outside the text's padding (screenOuter, then screenInner): the box holds two lines of its
  // body text (20 dp a line on a phone; 25 on a TV, its text 1.25 larger) times the font scale, plus the 8 dp bottom
  // padding. "Large" on a Redmi is 1.15; a Kino theme can scale text up too. Desktop takes the TV's room.
  const LINE = { phone: 20, tv: 25, desktop: 25 };
  const channels = [{ id: "a", ref: "L:a:1", title: "TUDN" }, { id: "b", ref: "L:b:1", title: "Sky Sports La Liga" }];
  for (const device of ["phone", "tv", "desktop"]) {
    for (const [p, v] of [["vivo", vivoView({ cats, cat: "v.co", device, channels })],
      ["sp", deportesView({ depTab: "canales", cats, cat: "v.sports", device, channels })]]) {
      const names = tilesOf(v, p).map((t) => t.children[1]);
      assert.equal(names.length, 2);
      for (const name of names) {
        assert.ok(SIZE_SCALE.includes(name.minHeight), `${device} ${p}: ${name.minHeight} off Kino's size scale`);
        assert.equal(name.padding.bottom, 8);
        for (const scale of [1, 1.15, 1.3, 1.4]) {
          const twoLines = 2 * LINE[device] * scale + name.padding.bottom;
          assert.ok(twoLines <= name.minHeight, `${device} ${p} at font scale ${scale}: two lines ${twoLines} dp > ${name.minHeight}`);
        }
      }
    }
  }
});

test("a tile without a logo, with an http one (an Image takes https only) or whose logo fails shows the channel's initials, never Kino's mark", () => {
  const v = vivoView({ cats, cat: "v.co", channels: [
    { id: "a", ref: "L:a:1", title: "Canal RCN" },
    { id: "b", ref: "L:b:1", title: "Fox Sports 3", logo: "http://insecure.example.com/fox.png" },
    { id: "c", ref: "L:c:1", title: "ESPN", logo: "https://img.example.com/espn.png" },
  ] });
  const [a, b, c] = tilesOf(v, "vivo");
  for (const [t, initials] of [[a, "CR"], [b, "FS3"], [c, "ESPN"]]) {
    const logo = t.children[0];
    const fb = logo.fallback;
    assert.equal(fb.mainAxisAlignment, "center");
    assert.equal(fb.crossAxisAlignment, "center");
    assert.equal(fb.children.length, 1);
    assert.deepEqual({ type: fb.children[0].type, text: fb.children[0].text, textEn: fb.children[0].textEn }, { type: "Text", text: initials, textEn: initials });
    assert.ok(all(fb, (n) => n.onTap || n.onPressed).length === 0, "nothing in a fallback is pressed");
  }
  assert.equal("url" in a.children[0], false, "no logo: no url (Kino draws the fallback without a log line)");
  assert.equal("url" in b.children[0], false, "an http logo is left out rather than refused");
  assert.equal(c.children[0].url, "https://img.example.com/espn.png", "with a logo the fallback is what a failed load shows");
});

test("http logos: drawn when Kino says screen.httpImages === true, else the initials (an older Kino refuses an http picture)", () => {
  const channels = [
    { id: "b", ref: "L:b:1", title: "Fox Sports 3", logo: "http://insecure.example.com/fox.png" },
    { id: "c", ref: "L:c:1", title: "ESPN", logo: "https://img.example.com/espn.png" },
  ];
  const urls = () => liveTabs({ channels }).map(([p, device, v]) => [p + " " + device, tilesOf(v, p).map((t) => t.children[0].url)]);
  const was = globalThis.kino.screen;
  try {
    for (const screen of [undefined, {}, { httpImages: false }, { httpImages: "true" }, { httpImages: 1 }]) {
      globalThis.kino.screen = screen;
      for (const [where, u] of urls()) assert.deepEqual(u, [undefined, "https://img.example.com/espn.png"], where + " " + JSON.stringify(screen));
    }
    globalThis.kino.screen = { httpImages: true };
    for (const [where, u] of urls()) assert.deepEqual(u, ["http://insecure.example.com/fox.png", "https://img.example.com/espn.png"], where);
    // the initials stay the fallback of a failed load either way
    const fox = tilesOf(vivoView({ cats, cat: "v.co", channels }), "vivo")[0];
    assert.equal(fox.children[0].fallback.children[0].text, "FS3");
  } finally {
    if (was === undefined) delete globalThis.kino.screen; else globalThis.kino.screen = was;
  }
});

test("channelInitials: words' first letters (articles skipped, numbers whole), an acronym kept, two letters of one word", () => {
  const cases = { "Canal RCN": "CR", "Fox Sports 3": "FS3", "ESPN": "ESPN", "AXN": "AXN", "Telefe": "TE", "Caracol TV": "CT",
    "Liga 1 Max": "L1M", "Discovery H&H": "DHH", "Canal de las Estrellas": "CE", "DW Español": "DE", "ESPN 2": "E2",
    "Señal Colombia": "SC", "Ñ": "Ñ", "—": "TV", "": "TV", "Canal 100": "C100", "fx": "FX" };
  for (const [title, want] of Object.entries(cases)) assert.equal(channelInitials(title), want, title);
});

test("18+: an adult channel is Kino's own titleCard (Kino hides it while the 18+ code is locked), never the plugin's tile", () => {
  const channels = [
    { id: "a", ref: "L:a:1", title: "Canal A", logo: "https://img.example.com/a.png" },
    { id: "x", ref: "L:x:1", title: "XXX", logo: "https://img.example.com/x.png", adult: true },
    { id: "b", ref: "L:b:1", title: "Canal B" },
  ];
  for (const [p, , v] of liveTabs({ channels })) {
    const tiles = tilesOf(v, p);
    assert.deepEqual(tiles.map((t) => t.type), ["Card", "titleCard", "Card"]);
    assert.deepEqual(tiles[1].item, { id: "x", ref: "L:x:1", title: "XXX", kind: "live", poster: "https://img.example.com/x.png", adult: true });
    assert.equal(tiles[1].onTap, undefined, "its tap is Kino's own (the title, gated)");
    const plays = all(v, (n) => n.go && n.go.play).map(({ n }) => n.go.play);
    assert.ok(plays.every((pl) => pl.ref !== "L:x:1" && !("adult" in pl)), "no tile of the plugin plays an 18+ channel");
    const hidden = all(v, (n) => n.type === "titleGrid")[0].n;
    assert.ok(!hidden.items.some((it) => it.adult), "the canvas grid holds no 18+ channel");
  }
});

test("Kino plays a tile's channel with the canvas's own item: a hidden titleGrid holds every drawn non-18+ channel with its logo", () => {
  const channels = [...chans(4), { id: "x", ref: "L:x:1", title: "XXX", adult: true }];
  for (const [p, , v] of liveTabs({ channels })) {
    const hidden = all(v, (n) => n.type === "titleGrid");
    assert.equal(hidden.length, 1);
    const g = hidden[0].n;
    assert.equal(g.key, p + "Titles");
    assert.equal(g.hidden, true, "never drawn");
    assert.ok(!hidden[0].path.some((n) => n.type === "SingleChildScrollView" || n.type === "ListView"));
    // ScreenGoHandler.findTitle: the first canvas title with the go's ref, kind and id
    for (const { n } of all(v, (x) => x.go && x.go.play)) {
      const { ref, kind, id } = n.go.play;
      const item = g.items.find((it) => it.ref === ref && it.kind === kind && it.id === id);
      assert.ok(item && item.poster, "found, with its logo: " + ref);
    }
    assert.equal(g.items.length, 4);
  }
  // nothing drawn (loading, failed, empty): no hidden grid either (a titleGrid needs 1 to 500 items)
  for (const opts of [{ channels: null, loading: true }, { channels: null, failed: true }, { channels: [] }]) {
    for (const [, , v] of liveTabs(opts)) assert.equal(all(v, (n) => n.type === "titleGrid").length, 0);
  }
});

test("channelItems leaves out what Kino would refuse (no ref, a ref over 4,096, an id off its rule), trims and caps the title", () => {
  const items = channelItems([
    { id: "ok", ref: "L:a:1", title: "  Caracol  ", logo: "https://x/a.png" },
    { id: "bad id!", ref: "L:a:2", title: "B" },
    { id: "long", ref: "L:" + "x".repeat(4100), title: "C" },
    { id: "blank", ref: "L:a:3", title: "   " },
    { id: "big", ref: "L:a:4", title: "T".repeat(300) },
  ]);
  assert.deepEqual(items.map((i) => i.id), ["ok", "blank", "big"]);
  assert.equal(items[0].title, "Caracol");
  assert.equal(items[1].title, "—", "a blank title would drop the tap's go");
  assert.equal(items[2].title.length, 200);
});

test("keys: unique on the whole screen and on Kino's rule, also with an id met twice, a long id and one holding '~'", () => {
  const channels = [
    { id: "dup", ref: "L:a:1", title: "A" }, { id: "dup", ref: "L:a:2", title: "B" },
    { id: "z".repeat(125), ref: "L:a:3", title: "C" }, { id: "a~l", ref: "L:a:4", title: "D" },
    { id: "page", ref: "L:a:5", title: "E" }, ...chans(150),
  ];
  for (const lang of ["es", "en"]) {
    inLang(lang, () => {
      for (const [p, , v] of liveTabs({ channels, shown: LV_PAGE })) {
        const keys = all(v, (n) => typeof n.type === "string" && n.key !== undefined).map(({ n }) => n.key);
        assert.equal(new Set(keys).size, keys.length, "duplicate key in " + p);
        for (const k of keys) assert.ok(KEY_RULE.test(k), "key off Kino's rule: " + k);
        const tiles = tilesOf(v, p);
        assert.equal(tiles[0].key, p + "c-dup");
        assert.equal(tiles[1].key, p + "c~1", "the second 'dup' takes its place");
        assert.equal(tiles[2].key, p + "c~2", "too long for a key with its parts' suffixes");
        assert.equal(tiles[3].key, p + "c~3");
        assert.equal(tiles[4].key, p + "c-page", "never the page column's own key");
      }
    });
  }
});

test("big lists stay lazy: the grid is never inside a scroll or a list, a page is 100 tiles under Kino's 600 nodes, every channel is reachable", () => {
  assert.equal(LV_PAGE, 100);
  assert.equal(LV_STEP, 50);
  const channels = chans(730, { title: "Un canal con un nombre largo de prueba número " });
  for (const [p, device, v] of liveTabs({ channels, shown: LV_PAGE, page: 7, timers: [{ ms: 1000, event: "lvRefresh" }] })) {
    const grid = all(v, (n) => n === gridOf(v, p))[0];
    assert.ok(!grid.path.some((n) => n.type === "SingleChildScrollView" || n.type === "ListView"), "a list inside a scroll is drawn whole");
    assert.equal(grid.n.flex, 1);
    assert.equal(grid.n.items.length, 30, "page 8 of 8: 701–730");
    assert.equal(channelsOf(v, p)[0].title.endsWith(" 700"), true);
  }
  for (const [p, device, v] of liveTabs({ channels, shown: LV_PAGE, page: 1 })) {
    const nodes = nodeCount(v);
    assert.ok(nodes <= 540, `${p} ${device}: ${nodes} nodes (Kino drops past 600)`);
    assert.equal(tilesOf(v, p).length, 100);
    assert.equal(all(v, (n) => n.type === "Card").length, 100);
    assert.equal(gridOf(v, p).done, true);
    assert.ok(all(v, (n) => n.key === p + "Next").length === 1 && all(v, (n) => n.key === p + "Prev").length === 1);
  }
  // the first frame of a page: LV_STEP tiles, the rest on lvMore
  for (const [p, , v] of liveTabs({ channels })) {
    assert.equal(tilesOf(v, p).length, 50);
    assert.deepEqual(gridOf(v, p).onEndReached, { event: "lvMore" });
    assert.equal(gridOf(v, p).done, false);
  }
});

test("the grid's key follows the category and the page (each opens at its top) and stays put while the same list grows", () => {
  const a = vivoView({ cats, cat: "v.co", channels: chans(250) });
  const b = vivoView({ cats, cat: "v.co", channels: chans(250), shown: 100 });
  const c = vivoView({ cats, cat: "v.co", channels: chans(250), page: 1 });
  const d = vivoView({ cats, cat: "v.sports", channels: chans(250) });
  const e = vivoView({ cats, cat: "tvenvivo.6465706f72746573:with/odd chars", channels: chans(3) });
  assert.equal(gridOf(a, "vivo").key, "vivoGrid-v.co");
  assert.equal(gridOf(b, "vivo").key, "vivoGrid-v.co");
  assert.equal(gridOf(c, "vivo").key, "vivoGrid-v.co-p1");
  assert.equal(gridOf(d, "vivo").key, "vivoGrid-v.sports");
  assert.ok(KEY_RULE.test(gridOf(e, "vivo").key) && gridOf(e, "vivo").key.length < 60);
  assert.equal(gridOf(deportesView({ depTab: "canales", cats, cat: "v.sports", channels: chans(2) }), "sp").key, "spGrid-v.sports");
});

test("the page buttons speak of the page's size in ES and EN", () => {
  for (const lang of ["es", "en"]) {
    inLang(lang, () => {
      const v = vivoView({ cats, cat: "v.co", channels: chans(250), page: 1 });
      const prev = all(v, (n) => n.key === "vivoPrev")[0].n, next = all(v, (n) => n.key === "vivoNext")[0].n;
      assert.equal(prev.labelText, lang === "en" ? "Previous 100" : "Anteriores 100");
      assert.equal(prev.labelTextEn, "Previous 100");
      assert.equal(next.labelText, lang === "en" ? "Next 100" : "Siguientes 100");
      assert.equal(next.labelTextEn, "Next 100");
      const where = all(v, (n) => n.key === "vivoWhere")[0].n;
      assert.equal(where.text, lang === "en" ? "101–200 of 250" : "101–200 de 250");
    });
  }
});

// ── Kino's own reading of the trees (the kit's mirror of PluginScreenOutput), when this Mac has it ──

const KIT = process.env.KINO_SCREEN_KIT || homedir() + "/kino-app/plugins/sdk/screen.mjs";
const MANIFEST_API = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8")).apiVersion;

test("Kino's screen rules drop no node of the live tabs (ES/EN × phone/TV: full pages, 18+, page row, offline, loading, failed)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  const mixed = chans(260).map((c, i) => (i % 9 === 4 ? { ...c, adult: true } : i % 7 === 3 ? { ...c, logo: undefined } : c));
  const variants = [
    { channels: chans(260, { title: "Un canal con un nombre largo de prueba número " }), shown: LV_PAGE, page: 1 },
    { channels: mixed, shown: LV_PAGE },
    { channels: chans(40, { noLogo: true }), offline: true },
    { channels: null, loading: true },
    { channels: null, failed: true },
    { channels: [] },
  ];
  for (const lang of ["es", "en"]) {
    for (const opts of variants) {
      const trees = inLang(lang, () => liveTabs(opts));
      for (const [p, device, v] of trees) {
        const r = checkScreenTree(v, lang, undefined, { apiVersion: MANIFEST_API });
        assert.deepEqual(r.dropped, [], `${lang} ${device} ${p} ${JSON.stringify(Object.keys(opts))}`);
        if (Array.isArray(opts.channels) && opts.channels.length) {
          let list = null;
          walk(r.tree, (n) => { if (!list && n.type === "list") list = n; });
          assert.equal(list.items.length, tilesOf(v, p).length, "Kino keeps every tile");
        }
      }
    }
  }
});

// ── the real lists: Colombia (tvenvivo's code list + caracol's fixture) and Deportes (code lists) ──

async function device(opts = {}) {
  const storage = { ...(opts.storage || {}), "o2:bearer": "bearer-token" };
  const k = installKino({ ...opts, storage });
  await clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  ls._resetMemory();
  beginCall();
  return k;
}
const caracolRoute = (url) => (/middleware\.ditu\.caracoltv\.com\/.*\/TRAY\/LIVECHANNELS\?/.test(url)
  ? res(200, CARACOL_JSON, { "content-type": "application/json" }) : undefined);

test("En vivo ▸ Colombia and Fútbol ▸ Canales with the real lists: every channel a contain tile with its https logo", async () => {
  live._setSources([tvenvivo, caracol]);
  try {
    await device({ routes: [caracolRoute] });
    // tvenvivo's Colombia is code (answered at once); the lvRefresh tick lists caracol's (one request, the fixture)
    const pick = await screenEvent({ name: "liveCat", value: "v.co", state: { nav: "vivo", lcTried: true } });
    let state = { nav: "vivo", lcTried: true, ...pick.state };
    beginCall();
    state = { ...state, ...(await screenEvent({ name: "lvRefresh", state })).state };
    for (const deviceKind of ["phone", "tv"]) {
      beginCall();
      const v = await screen({ state, device: deviceKind });
      const tiles = tilesOf(v, "vivo");
      assert.equal(tiles.length, 22, "tvenvivo's Caracol and RCN, caracol's 21, Caracol once");
      const names = channelsOf(v, "vivo").map((c) => c.title);
      for (const n of ["Caracol", "RCN", "Yo Me Llamo", "Caracol Sports", "Negocios"]) assert.ok(names.includes(n), n + " in " + names.join(", "));
      for (const t of tiles) {
        assert.equal(t.type, "Card");
        assert.equal(t.children[0].fit, "contain");
        assert.match(t.children[0].url, /^https:\/\//, t.onTap.go.play.title);
      }
    }
  } finally { live._setSources(null); }
  await device({ noFetch: true });
  const sp = await screen({ state: { nav: "deportes", depTab: "canales", lcTried: true } });
  const tiles = tilesOf(sp, "sp");
  assert.equal(tiles.length, 35, "tvenvivo's and futbollibre's Deportes, as before");
  const espn = channelsOf(sp, "sp").find((c) => c.title === "ESPN Colombia" || c.title === "ESPN");
  assert.ok(espn && /^https:\/\//.test(espn.poster));
  assert.ok(tiles.every((t) => t.type === "Card" && t.children[0].fit === "contain"));
});
