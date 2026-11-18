// 1.0.46 joins three pieces of work: supertv from 2–3 panels (src/sources/supertv.js, src/live.js), the device's own
// Xuper session with seeds as its fallback (src/sources/xuper.js, src/seeds.js) and the plugin's own channel tiles
// (src/screenView.js). Each has its own tests; these pin the points where they meet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";
import { stvWorld, hostOf, PLAYLIST } from "./helpers/stv-world.mjs";
import { gridOf, tilesOf, channelsOf } from "./helpers/tiles.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { decodeRef } = await import("../src/refs.js");
const { screen } = await import("../src/screen.js");
const { vivoView, deportesView, configView, LV_PAGE } = await import("../src/screenView.js");
const stvMod = await import("../src/sources/supertv.js");
const supertv = stvMod.default, { supertv2, supertv3 } = stvMod;

const M = 60_000, H = 60 * M;

async function device(opts = {}) {
  const storage = { ...(opts.storage || {}), "o2:bearer": "bearer-token" };
  const k = installKino({ ...opts, storage });
  await clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  k.writes.length = 0;
  ls._resetMemory();
  beginCall();
  return k;
}
function nextCall(k) {
  ls.flushMeta();
  ls._resetMemory();
  beginCall();
  k.requests.length = 0;
  k.logs.length = 0;
  return k;
}
const membersOf = (ref) => (ref.startsWith("M:") ? decodeRef(ref).members : [{ ref }]);
const srcOf = (m) => (m.ref ? decodeRef(m.ref).source : String(m.id).split("_")[0]);

function walk(node, fn, path = []) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn, path)); return; }
  if (!node || typeof node !== "object") return;
  fn(node, path);
  const next = typeof node.type === "string" ? [...path, node] : path;
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn, next);
}
const all = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
/** The nodes Kino counts against its 600 (every object with a `type`). */
const nodeCount = (tree) => all(tree, (n) => typeof n.type === "string").length;

test.afterEach(() => live._setSources(null));

// ── C × A: the tiles play the merged channels, the other panels' copies included ──

test("tiles × multipanel: every merged row of 'Deportes · España' is a tile whose play is the row's own M: ref (other panels' members included), and it plays another panel's copy when the primary refuses", async () => {
  live._setSources([supertv, supertv2, supertv3]);
  const refused = new Set();
  let k = await device({ routes: [stvWorld({ stream: (url) => (refused.has(hostOf(url))
    ? Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" })
    : res(200, PLAYLIST)) })] });
  await live.liveCategories();                       // first install: the primary and both slots
  k = nextCall(k);
  const page = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });   // the primary's lists, then the slots'
  const rows = page.items;
  const slotRows = rows.filter((r) => membersOf(r.ref).some((m) => /^supertv[23]$/.test(srcOf(m))));
  assert.ok(slotRows.length >= 5, "rows that gained copies on other panels: " + slotRows.length);
  const dazn = rows.find((r) => r.title === "DAZN 1 FHD");
  assert.deepEqual([...new Set(membersOf(dazn.ref).map(srcOf))], ["supertv", "supertv3"]);

  // the same rows through the screen (no network: everything is stored and fresh), on both live tabs, phone and TV
  for (const device of ["phone", "tv"]) {
    for (const [p, state] of [["vivo", { nav: "vivo", liveCat: "v.sp.es" }], ["sp", { nav: "deportes", depTab: "canales", sportsCat: "v.sp.es" }]]) {
      k = nextCall(k);
      const tree = await screen({ state: { ...state, lcTried: true, lvShown: LV_PAGE }, device });
      assert.equal(k.requests.length, 0, "the screen draws stored lists without the network");
      const drawn = channelsOf(tree, p);
      const want = rows.slice(0, LV_PAGE);
      assert.equal(drawn.length, want.length, p + " " + device + ": no merged row left out by the tiles");
      drawn.forEach((c, i) => {
        assert.equal(c.ref, want[i].ref, "the tile plays the row's own ref: " + want[i].title);
        assert.equal(c.id, want[i].id);
        assert.equal(c.kind, "live");
      });
      const tile = tilesOf(tree, p).find((t) => t.onTap && t.onTap.go.play.ref === dazn.ref);
      assert.ok(tile && tile.type === "Card", "DAZN 1 is the plugin's tile");
      assert.equal(tile.children[0].fit, "contain");
      // the hidden title grid holds the very item Kino plays (with its logo)
      const canvas = all(tree, (n) => n.type === "titleGrid" && n.hidden)[0];
      assert.ok(canvas.items.some((it) => it.ref === dazn.ref && it.id === dazn.id && it.poster), "the canvas item of the merged row");
      assert.ok(all(tree, (n) => n.go && n.go.play && n.go.play.ref.length > 4096).length === 0);
    }
  }

  // the tile's ref, opened by Kino while the primary's account refuses every stream: another panel's copy plays
  const vivo = await screen({ state: { nav: "vivo", liveCat: "v.sp.es", lcTried: true } });
  const ref = tilesOf(vivo, "vivo").find((t) => t.onTap && t.onTap.go.play.title === "DAZN 1 FHD").onTap.go.play.ref;
  refused.add("line.zee-ott.xyz");
  k = nextCall(k);
  const out = await live.resolveLive(ref);
  assert.equal(hostOf(out.url), "pp.tresinl.xyz", "the slot's copy plays");
  assert.match(out.label, /^SuperTV Deportes 3/);
  assert.deepEqual(k.requests.filter((r) => r.url.includes("/live/")).map((r) => hostOf(r.url)), ["line.zee-ott.xyz", "line.zee-ott.xyz", "pp.tresinl.xyz"]);
});

// ── C × events: an event merged across providers (members by Kino id) plays from its tile ──

/** A fake connector: `cats`, `lists[cat]`, `resolve(raw)`; `code` = code categories. */
function fakeSource(id, o = {}) {
  return {
    id, name: id, genre: "otros", codeCategories: !!o.code,
    async categories(ctx) { if (o.code) return o.cats; const r = await ctx.fetch(`https://${id}.test/cats`); if (!r.ok) throw new Error("cats"); return o.cats; },
    async channels(cat, ctx) { if (!o.code) { const r = await ctx.fetch(`https://${id}.test/list/` + cat); if (!r.ok) throw new Error("list"); } return o.lists[cat] || []; },
    async resolve(raw) { if (o.resolve) return o.resolve(raw); return { url: `https://${id}.test/play/${encodeURIComponent(raw)}.m3u8` }; },
  };
}

test("tiles × events: an event in nuvio and in cncverse's providers is one tile whose M: ref names the long cncverse members by Kino id; Kino's open from the tile plays them from the stored lists (0 lookups); a lone long event keeps its own ref", async () => {
  const T = Date.now();
  const long = (p) => "cnc:" + p + "-" + "x".repeat(1500);
  const nuvio = fakeSource("nuvio-sports", { code: true, cats: [{ id: "live", title: "En vivo" }],
    lists: { live: [{ id: "n1", title: "LIVE: Chile vs Colombia", start: T - 30 * M }] },
    resolve: () => { throw Object.assign(new Error("no streams"), { code: "no_streams" }); } });
  const cnc = fakeSource("cncverse", { cats: [{ id: "cnc_AEvents", title: "A" }, { id: "cnc_BEvents", title: "B" }],
    lists: {
      cnc_AEvents: [{ id: long("a"), title: "Chile vs Colombia", start: T - 30 * M, end: T + 90 * M }],
      cnc_BEvents: [{ id: long("b"), title: "Chile vs Colombia", start: T - 30 * M + 20_000, end: T + 90 * M },
        { id: long("c"), title: "Japan vs Ghana", start: T - 10 * M, end: T + 2 * H }],
    },
    resolve: (raw) => ({ url: "https://cdn.test/" + raw.slice(4, 5) + ".m3u8" }) });
  live._setSources([nuvio, cnc]);
  let k = await device({ routes: [() => res(200, "{}")] });
  await live.liveCategories();
  k = nextCall(k);
  const rows = (await live.liveChannels({ categoryId: "v.events", cursor: null })).items;
  assert.deepEqual(rows.map((r) => r.title).sort(), ["Japan vs Ghana", "LIVE: Chile vs Colombia"]);

  k = nextCall(k);
  const tree = await screen({ state: { nav: "vivo", liveCat: "v.events", lcTried: true } });
  assert.equal(k.requests.length, 0);
  const drawn = channelsOf(tree, "vivo");
  assert.deepEqual(drawn.map((c) => c.ref), rows.map((r) => r.ref), "every event a tile, with the row's own ref");
  const match = drawn.find((c) => c.title === "LIVE: Chile vs Colombia");
  const parts = membersOf(match.ref);
  assert.deepEqual(parts.map((m) => m.ref || m.id), ["L:nuvio-sports:n1", "cncverse_" + live.hashId(long("a")), "cncverse_" + live.hashId(long("b"))]);
  const lone = drawn.find((c) => c.title === "Japan vs Ghana");
  assert.ok(lone.ref.startsWith("L:cncverse:") && lone.ref.length > 1500 && lone.ref.length <= 4096, "a lone event keeps its long L: ref (Kino takes ≤ 4,096)");
  for (const c of drawn) assert.match(c.id, /^[A-Za-z0-9._~-]{1,128}$/);

  // Kino opens the tile's ref in a cold runtime: nuvio has no stream, the first cncverse copy (found by id) plays
  k = nextCall(k);
  const out = await live.resolveLive(match.ref);
  assert.equal(out.url, "https://cdn.test/a.m3u8");
  assert.deepEqual(k.requests, [], "0 requests to find the members");
  k = nextCall(k);
  assert.equal((await live.resolveLive(lone.ref)).url, "https://cdn.test/c.m3u8");
});

// ── B × C: the tree budget (Kino reads ≤ 600 nodes per tree) ──

const SEED_STATES = [
  { kind: "own", leftMin: 0, geo: false, wait: null },
  { kind: "own", leftMin: 0, geo: true, wait: { why: "503", min: 12 } },
  { kind: "seed", leftMin: 212, geo: true, wait: null },
  { kind: "seed", leftMin: null, geo: false, wait: { why: "503", min: 4 } },
  { kind: "seed", leftMin: 30, geo: true, wait: { why: "cap", min: 40 } },
  { kind: "none", leftMin: 0, geo: false, wait: { why: "429", min: 55 } },
];
const CONTRIB = [{ on: true, at: null }, { on: false, at: Date.now() - 5 * H }];
const AGES = { catalog: { at: Date.now() - H, stale: false }, matches: { at: Date.now() - 2 * H, stale: true } };
const chans = (n) => Array.from({ length: n }, (_, i) => ({ id: "src_" + i, ref: "L:src:" + i, title: "Un canal con un nombre largo número " + i, logo: "https://img.example.com/" + i + ".png" }));
const cats = Array.from({ length: 40 }, (_, i) => ({ id: "v.c" + i, title: "Categoría " + i }));

test("tree budget: Ajustes with the session and Aportar cards stays far under Kino's 600 nodes in every seed state; a live page of 100 tiles stays ≤ 540 and carries no Ajustes card", () => {
  for (const lang of ["es", "en"]) {
    globalThis.kino.lang = lang;
    for (const device of ["phone", "tv", "desktop"]) {
      for (const seeds of SEED_STATES) {
        for (const contrib of CONTRIB) {
          const v = configView({ version: "1.0.46", device, ages: AGES, now: Date.now(), seeds, contrib });
          const n = nodeCount(v);
          assert.ok(n <= 80, `Ajustes ${lang} ${device} ${seeds.kind}: ${n} nodes`);
          assert.equal(all(v, (x) => x.type === "ListView" || x.type === "titleGrid").length, 0);
          assert.equal(all(v, (x) => x.key === "cfgXuper").length, 1);
          assert.equal(all(v, (x) => x.key === "cfgContrib").length, 1);
        }
      }
      const channels = chans(260);
      for (const [p, v] of [["vivo", vivoView({ cats, cat: "v.c1", device, channels, shown: LV_PAGE, page: 1, timers: [{ ms: 1000, event: "lvRefresh" }] })],
        ["sp", deportesView({ depTab: "canales", cats, cat: "v.c1", device, channels, shown: LV_PAGE, page: 1 })]]) {
        const n = nodeCount(v);
        assert.ok(n <= 540, `${p} ${lang} ${device}: ${n} nodes`);
        assert.equal(gridOf(v, p).items.length, 100);
        assert.equal(all(v, (x) => x.key === "cfgXuper" || x.key === "cfgContrib" || x.key === "seedChange").length, 0);
      }
    }
  }
  globalThis.kino.lang = "es";
});

const KIT = process.env.KINO_SCREEN_KIT || homedir() + "/kino-app/plugins/sdk/screen.mjs";
const MANIFEST_API = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8")).apiVersion;

test("Kino's screen rules drop no node of Ajustes with the seed cards (every state, ES/EN × phone/TV/desktop)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  for (const lang of ["es", "en"]) {
    globalThis.kino.lang = lang;
    for (const device of ["phone", "tv", "desktop"]) {
      for (const seeds of SEED_STATES) {
        for (const contrib of CONTRIB) {
          const v = configView({ version: "1.0.46", device, ages: AGES, now: Date.now(), seeds, contrib });
          const r = checkScreenTree(v, lang, undefined, { apiVersion: MANIFEST_API });
          assert.deepEqual(r.dropped, [], `${lang} ${device} ${seeds.kind} ${JSON.stringify(seeds.wait)}`);
        }
      }
    }
  }
  globalThis.kino.lang = "es";
});

// ── B × A: the seed / own-session chain is xuper's alone; supertv's panels never touch it ──

const SESSION_KEYS = ["o2:xsess", "o2:xsn", "o2:xseed", "o2:xseedSt", "o2:contribAt"];

test("seeds × multipanel: xuper's session chain (own session blocked → one seed) is the same with or without supertv's three panels beside it; supertv's listings and its panel hop make 0 portal calls, 0 GET /seed and leave every session key as it was", async () => {
  const { world, poolSeed, T0 } = await import("./helpers/seed-world.mjs");
  const plugin = await import("../src/plugin.js");
  const xmod = await import("../src/sources/xuper.js");
  const seeds = await import("../src/seeds.js");
  const realNow = Date.now;
  const refused = new Set();
  const stream = (url) => (refused.has(hostOf(url))
    ? Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" })
    : res(200, PLAYLIST));
  const xuperCat = async () => (await live.categoryList()).find((c) => c.members.some((m) => m.src === "xuper"));
  const run = async (sources) => {
    const w = await world({ geo: "own", pool: [poolSeed(1), poolSeed(2), poolSeed(3)], routes: [stvWorld({ stream })] });
    await clearBearer();
    w.kino.storage.set("o2:bearer", "bearer-SECRET-token");
    w.kino.config = { get: () => undefined };
    xmod._resetSession();
    seeds._newRuntime();
    ls._resetMemory();
    live._setSources(sources);
    const xuperOnly = () => w.paths().join(",") + " | " + w.events.join(",");
    const trace = [];
    await plugin.liveCategories();
    trace.push(xuperOnly());
    const cat = await xuperCat();
    assert.ok(cat, "xuper's category is listed");
    const page = await plugin.liveChannels({ categoryId: cat.id, cursor: null });
    trace.push(xuperOnly());
    const ch = page.items.find((c) => membersOf(c.ref).some((m) => srcOf(m) === "xuper"));
    const out = await plugin.resolve(ch.ref);
    trace.push(xuperOnly());
    const session = Object.fromEntries(SESSION_KEYS.map((key) => [key, w.store.get(key) ?? null]));
    return { w, trace, out, session };
  };
  try {
    const xuper = xmod.default;
    const alone = await run([xuper]);
    const mixed = await run([supertv, supertv2, supertv3, xuper]);
    assert.equal(alone.w.gets, 1, "the blocked own session takes one seed");
    assert.deepEqual(mixed.trace, alone.trace, "the same portal calls and seed events, call after call");
    assert.deepEqual(mixed.session, alone.session, "the same session and seed state");
    assert.equal(mixed.out.url, alone.out.url);
    assert.ok(JSON.parse(mixed.w.store.get("o2:stvs")).s2, "supertv's slots were filled in the same calls");

    // supertv alone: its listing and a panel hop (the primary refuses every stream) go nowhere near Xuper
    const w = mixed.w;
    const before = { paths: w.paths().length, events: w.events.length, gets: w.gets,
      session: Object.fromEntries(SESSION_KEYS.map((key) => [key, w.store.get(key) ?? null])) };
    const es = await plugin.liveChannels({ categoryId: "v.sp.es", cursor: null });
    const dazn = es.items.find((c) => c.title === "DAZN 1 FHD");
    refused.add("line.zee-ott.xyz");
    const hop = await plugin.resolve(dazn.ref);
    assert.equal(hostOf(hop.url), "pp.tresinl.xyz");
    await plugin.liveCategories();
    assert.equal(w.paths().length, before.paths, "no portal call");
    assert.equal(w.events.length, before.events);
    assert.equal(w.gets, before.gets, "no GET /seed");
    assert.deepEqual(Object.fromEntries(SESSION_KEYS.map((key) => [key, w.store.get(key) ?? null])), before.session);
    assert.ok(Date.now() >= T0);
  } finally {
    Date.now = realNow;
  }
});
