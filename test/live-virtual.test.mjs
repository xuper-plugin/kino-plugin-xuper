// src/live.js with the virtual categories (src/liveMap.js) and the merged channels (src/liveMerge.js), through Kino's
// entry points: liveCategories / liveChannels / resolve, with a fake Kino (same runtime across calls: node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const gate = await import("../src/liveGate.js");
const { hexEnc } = await import("../src/liveMap.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { decodeRef, liveRef } = await import("../src/refs.js");
const { screen, screenEvent } = await import("../src/screen.js");
const { gridOf, tilesOf, channelsOf } = await import("./helpers/tiles.mjs");

const M = 60_000, H = 60 * M, D = 24 * H;
const sha16 = (t) => createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);
const REAL = JSON.parse(readFileSync(new URL("./fixtures/live-categories-121.json", import.meta.url), "utf8")).categories;
const XUPER = JSON.parse(readFileSync(new URL("./fixtures/xuper-columns-synthetic.json", import.meta.url), "utf8")).columns;
const ORDER = ["tvenvivo", "caracol", "cablevisionhd", "premiumtv", "supertv", "futbollibre", "nuvio-sports", "deportv", "cncverse", "xuper"];
const CODE = new Set(["tvenvivo", "caracol", "cablevisionhd", "futbollibre", "nuvio-sports"]);

async function device(opts = {}) {
  const storage = { ...(opts.storage || {}) };
  if (opts.bearer !== false) storage["o2:bearer"] = "bearer-token";
  const k = installKino({ ...opts, storage });
  await clearBearer();
  if (opts.bearer !== false) k.kino.storage.set("o2:bearer", "bearer-token");
  k.writes.length = 0;
  ls._resetMemory();
  beginCall();
  return k;
}

/** A fake connector: `cats`, `lists[cat]` (channels), `resolve(ch)`; `code` = code categories; flags pass through. */
function fakeSource(id, o = {}) {
  const calls = { categories: 0, channels: [], resolve: [] };
  const host = `https://${id}.test`;
  return {
    id, name: o.name || id, genre: "otros",
    codeCategories: !!o.code,
    ...(o.codeList ? { codeList: o.codeList } : {}),
    ...(o.flags || {}),
    calls,
    async categories(ctx) {
      calls.categories++;
      if (o.code) return o.cats || [];
      const r = await ctx.fetch(host + "/cats", { timeoutMs: 8000 });
      if (!r.ok) throw new Error("cats " + r.status);
      return o.cats || [];
    },
    async channels(cat, ctx) {
      calls.channels.push(cat);
      if (o.codeList && o.codeList(cat)) return (o.lists && o.lists[cat]) || [];
      const r = await ctx.fetch(host + "/list/" + encodeURIComponent(cat), { timeoutMs: 8000 });
      if (!r.ok) throw new Error("list " + r.status);
      return (o.lists && o.lists[cat]) || [];
    },
    async resolve(ch, ctx) {
      calls.resolve.push(ch);
      if (o.resolve) return o.resolve(ch, ctx);
      return { url: `${host}/play/${encodeURIComponent(ch)}.m3u8` };
    },
  };
}

function storedLive({ registry = {}, lists = {} } = {}) {
  const now = Date.now();
  const st = {};
  const lc = { v: 1, src: {} };
  const lm = { v: 1, c: {}, l: {} };
  for (const [src, cats] of Object.entries(registry)) { lc.src[src] = { at: now, cats }; lm.c[src] = { at: now, failAt: 0, failN: 0 }; }
  for (const [key, { items, at, failAt }] of Object.entries(lists)) {
    const text = JSON.stringify(items);
    st["o2:ll:" + key] = text;
    const t = at != null ? at : now;
    lm.l[key] = { at: t, h: sha16(text), n: items.length, w: t, failAt: failAt || 0, failN: failAt ? 1 : 0 };
  }
  st["o2:lc"] = JSON.stringify(lc);
  st["o2:lm"] = JSON.stringify(lm);
  return st;
}
const norm = (src, raw) => live.normalizeChannels(src, raw);
const key = (src, cat) => live.listKey(src, cat);
const ch = (id, title, logo) => ({ id, title, ...(logo ? { logo } : {}) });
const membersOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.ref) : [c.ref]);

test.afterEach(() => live._setSources(null));

// ── categories ──

test("a stored registry (121 real + 147 xuper-like) → liveCategories: 0 requests, 0 writes, ≤ 90, country and genre", async () => {
  const bySrc = {};
  for (const c of REAL) (bySrc[c.src] ||= []).push({ id: c.rawId, title: c.title, ...(c.adult ? { adult: true } : {}) });
  bySrc.xuper = XUPER.map((c) => ({ id: c.id, title: c.title, ...(c.expect === "v.adult" ? { adult: true } : {}) }));
  live._setSources(ORDER.map((id) => fakeSource(id, { code: CODE.has(id), cats: bySrc[id] })));
  const registry = Object.fromEntries(Object.entries(bySrc).filter(([s]) => !CODE.has(s)));
  const k = await device({ noFetch: true, storage: storedLive({ registry }) });
  const cats = await live.liveCategories();
  assert.equal(k.requests.length, 0);
  assert.deepEqual(k.writes, []);
  assert.equal(cats.length, 67);
  assert.deepEqual(cats.slice(0, 2), [{ id: "v.co", title: "Colombia", genre: "otros", country: "CO" }, { id: "v.sports", title: "Deportes", genre: "deportes" }]);
  assert.deepEqual(cats.find((c) => c.id === "v.sp.de"), { id: "v.sp.de", title: "Deportes · Alemania", genre: "deportes", country: "DE" });
  assert.deepEqual(cats[cats.length - 1], { id: "v.adult", title: "Adultos", adult: true, genre: "otros" });
  for (const c of cats) assert.match(c.id, /^[A-Za-z0-9._~-]{1,128}$/);
  for (const c of cats) if (c.country) assert.match(c.country, /^[A-Z]{2}$/);
  const genres = new Set(["peliculas", "series", "anime", "infantil", "documentales", "deportes", "noticias", "musica", "entretenimiento", "otros"]);
  for (const c of cats) assert.ok(!c.genre || genres.has(c.genre), c.genre);
  // the own screen: the same list, adult left out; Canales: the sports and events categories (not "Otros deportes")
  const vivo = await live.screenCategories("vivo");
  assert.equal(vivo.cats.length, 66);
  const futbol = await live.screenCategories("football");
  assert.deepEqual(futbol.cats.map((c) => c.id), ["v.sports", "v.events", "v.sp.es", "v.sp.gb", "v.sp.de", "v.sp.nl", "v.sp.us", "v.sp.eu"]);
});

// ── lists: merged channels, paging, members arriving later ──

function colombia(opts = {}) {
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "co", title: "Colombia" }], lists: { co: [ch("caracol", "Caracol", "https://l/tv.png"), ch("rcn", "RCN")] } });
  const car = fakeSource("caracol", { code: true, cats: [{ id: "all", title: "Canales en vivo" }], flags: { drm: true }, lists: { all: [ch("20", "Caracol TV"), ch("21", "Noticias Caracol")] }, ...(opts.caracol || {}) });
  const ptv = fakeSource("premiumtv", { flags: { blind: true, sharedFetch: true }, name: "Premium TV", ...(opts.premiumtv || {}) });
  return { tv, car, ptv };
}
const PTV_CO = [ch("http://a.example/caracol1.m3u8", "Caracol HD [Opc.1]", "https://l/p1.png"), ch("http://a.example/caracol2.m3u8", "Caracol HD [Opc.2]"),
  ch("http://a.example/rcn.m3u8", "RCN HD"), ...Array.from({ length: 600 }, (_, i) => ch("http://b.example/c" + i + ".m3u8", "Canal local " + i))];

test("liveChannels(v.co): tvenvivo (code) + caracol + premiumtv; Caracol once (tvenvivo's id, an M: ref); page 2 makes 0 requests", async () => {
  const { tv, car, ptv } = colombia();
  live._setSources([tv, car, ptv]);
  const k = await device({ routes: [(u) => (u.startsWith("https://caracol.test/list") ? res(200, "{}") : undefined)],
    storage: storedLive({ registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }] }, lists: { [key("premiumtv", "Colombia")]: { items: norm("premiumtv", PTV_CO) } } }) });
  const p1 = await live.liveChannels({ categoryId: "v.co", cursor: null });
  assert.equal(k.requests.length, 1, "caracol's list only (tvenvivo is code, premiumtv stored)");
  assert.equal(p1.items.length, 500);
  const caracol = p1.items.filter((c) => /caracol/i.test(c.title) && !/noticias/i.test(c.title));
  assert.equal(caracol.length, 1);
  assert.equal(caracol[0].id, "tvenvivo_" + live.hashId("caracol"));
  assert.equal(caracol[0].title, "Caracol");
  assert.equal(caracol[0].logo, "https://l/tv.png");
  assert.deepEqual(membersOf(caracol[0]).map((r) => decodeRef(r).source), ["tvenvivo", "caracol", "premiumtv", "premiumtv"]);
  assert.equal(caracol[0].categoryId, "v.co");
  assert.equal(p1.items.find((c) => c.title === "RCN").ref, "M:tvenvivo:rcn,premiumtv:" + encodeURIComponent("http://a.example/rcn.m3u8"));
  assert.match(p1.next, /^[0-9a-z]{1,16}:500$/);
  beginCall();
  const p2 = await live.liveChannels({ categoryId: "v.co", cursor: p1.next });
  assert.equal(k.requests.length, 1, "page 2: 0 requests");
  // Caracol (4 members), RCN (2), Noticias Caracol, 600 local channels = 603 channels: 500 + 103
  assert.equal(p2.items.length, 103, "every channel listed once across the pages");
  assert.equal(p2.next, null);
  const all = [...p1.items, ...p2.items];
  assert.equal(new Set(all.map((c) => c.id)).size, all.length);
  const refs = all.flatMap(membersOf);
  assert.equal(refs.length, 2 + 2 + PTV_CO.length, "each raw channel exactly once");
  // an old remembered raw id still answers with its own list, unmerged
  beginCall();
  const old = await live.liveChannels({ categoryId: key("premiumtv", "Colombia") });
  assert.equal(old.items[0].ref, liveRef("premiumtv", "http://a.example/caracol1.m3u8"));
  assert.equal(old.items.length, 500);
});

test("a member list arriving later: the hash changes, a cursor keeps its offset, unaffected channels keep their ids", async () => {
  const { tv, car, ptv } = colombia();
  live._setSources([tv, car, ptv]);
  let caracolUp = false;
  const k = await device({ routes: [(u) => (u.startsWith("https://caracol.test/list") ? res(caracolUp ? 200 : 503, "{}") : undefined)],
    storage: storedLive({ registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }] }, lists: { [key("premiumtv", "Colombia")]: { items: norm("premiumtv", PTV_CO) } } }) });
  const a = await live.liveChannels({ categoryId: "v.co", cursor: null });
  assert.ok(!a.items.some((c) => c.ref.includes("caracol:20")), "caracol failed: composed without it");
  assert.ok(JSON.parse(k.store.get("o2:lm")).l[key("caracol", "all")].failAt > 0);
  caracolUp = true;
  ls._resetMemory();
  // 11 min later, past the list backoff, Kino asks again
  const real = Date.now;
  try {
    Date.now = () => real() + 11 * M;
    beginCall();
    const b = await live.liveChannels({ categoryId: "v.co", cursor: null });
    assert.notEqual(b.next.split(":")[0], a.next.split(":")[0], "another composition");
    assert.ok(b.items.find((c) => c.title === "Caracol").ref.includes("caracol:20"));
    const ids = (p) => new Map(p.items.map((c) => [c.title, c.id]));
    const ia = ids(a), ib = ids(b);
    for (const t of ["Caracol", "RCN", "Canal local 7"]) assert.equal(ib.get(t), ia.get(t), t + " keeps its id");
    beginCall();
    const n = k.requests.length;
    const old = await live.liveChannels({ categoryId: "v.co", cursor: a.next });   // the cursor of the old composition
    beginCall();
    const cur = await live.liveChannels({ categoryId: "v.co", cursor: b.next });
    assert.deepEqual(old.items.map((c) => c.id), cur.items.map((c) => c.id), "an old cursor keeps its offset in the new list");
    assert.equal(k.requests.length, n, "a cursor page never fetches");
  } finally { Date.now = real; }
});

test("cursor pages never fetch, even with a member list missing (a page boundary must not move)", async () => {
  const { tv, car, ptv } = colombia();
  live._setSources([tv, car, ptv]);
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }] }, lists: { [key("premiumtv", "Colombia")]: { items: norm("premiumtv", PTV_CO) } } }) });
  const p2 = await live.liveChannels({ categoryId: "v.co", cursor: "deadbeef:500" });
  assert.equal(k.requests.length, 0);
  assert.ok(p2.items.length > 0);
});

test("first page of a merged category: ≤ 24 fetch units (a shared source once, xuper ≤ 6), ≤ 5 in flight", async () => {
  const xcols = Array.from({ length: 20 }, (_, i) => ({ id: String(100 + i), title: "Deportes " + (i + 1) }));
  const xuper = fakeSource("xuper", { lists: Object.fromEntries(xcols.map((c) => [c.id, [ch("x" + c.id, "Canal X" + c.id)]])) });
  const ptvGroups = ["Deportes", "ESPN", "FOX Sports", "Win Sports"];
  const ptv = fakeSource("premiumtv", { flags: { sharedFetch: true },
    lists: Object.fromEntries(ptvGroups.map((g) => [g, [ch("http://p/" + g, g + " HD")]])) });
  ptv.channels = async (cat, ctx) => {   // one download stores every group (like m3u.js)
    ptv.calls.channels.push(cat);
    await ctx.fetch("https://premiumtv.test/list.m3u", { timeoutMs: 8000 });
    for (const g of ptvGroups) if (g !== cat) ctx.putList(g, [ch("http://p/" + g, g + " HD")]);
    return [ch("http://p/" + cat, cat + " HD")];
  };
  const fl = fakeSource("futbollibre", { code: true, cats: [{ id: "mas", title: "Más canales" }], lists: { mas: [ch("f1", "beIN Sports")] } });
  live._setSources([ptv, fl, xuper]);
  const k = await device({ routes: [(u) => new Promise((r) => setTimeout(() => r(res(200, "{}")), 15))],
    storage: storedLive({ registry: { premiumtv: ptvGroups.map((g) => ({ id: g, title: g })), xuper: xcols } }) });
  const p = await live.liveChannels({ categoryId: "v.sports", cursor: null });
  const lists = k.requests.map((r) => new URL(r.url).host + new URL(r.url).pathname);
  assert.equal(lists.filter((u) => u.startsWith("premiumtv")).length, 1, "premiumtv: one download for its 4 groups");
  assert.equal(lists.filter((u) => u.startsWith("xuper")).length, 6, "xuper: at most 6 columns per call");
  assert.equal(lists.filter((u) => u.startsWith("futbollibre")).length, 1);
  assert.ok(gate._gateStats().peak <= 5);
  assert.ok(k.requests.every((r) => r.timeoutMs === 8000), "each request keeps its connector's own timeout (the call's deadline bounds them)");
  for (const g of ptvGroups) assert.ok(p.items.some((c) => c.title === g + " HD"), g + " shown (stored by the shared download)");
  // the screen sees it partial; the next call loads the next batch
  beginCall();
  assert.equal((await live.screenList("v.sports")).partial, true);
  beginCall();
  await live.loadList("v.sports", { bounds: live.TICK_LOAD_BOUNDS });
  assert.equal(k.requests.filter((r) => r.url.startsWith("https://xuper.test/")).length, 12);
});

test("live events: every nuvio sport catalog is fetched beside 'live' (they are not subsets of it), Spanish agendas first", async () => {
  const nuvio = fakeSource("nuvio-sports", { code: true,
    cats: [{ id: "live", title: { es: "En vivo ahora", en: "Live now" } }, { id: "football", title: "Fútbol" }, { id: "golf", title: "Golf" }],
    lists: { live: [ch("e1", "Arsenal vs Chelsea")], football: [ch("e1", "Arsenal vs Chelsea"), ch("e3", "Boca vs River")], golf: [ch("e9", "The Open")] } });
  const fl = fakeSource("futbollibre", { code: true, cats: [{ id: "hoy", title: "Partidos de hoy" }], lists: { hoy: [ch("f1", "Boca vs River — Liga")] } });
  live._setSources([nuvio, fl]);
  const k = await device({ routes: [() => res(200, "{}")] });
  const p = await live.liveChannels({ categoryId: "v.events", cursor: null });
  assert.deepEqual(k.requests.map((r) => new URL(r.url).pathname).sort(), ["/list/football", "/list/golf", "/list/hoy", "/list/live"]);
  assert.deepEqual(p.items.map((c) => c.title), ["Boca vs River — Liga", "Arsenal vs Chelsea", "The Open"], "futbollibre first; nuvio's e1 once (same id); the same match in two sources is one channel");
  assert.deepEqual(decodeRef(p.items[0].ref).members.map((m) => m.ref), ["L:futbollibre:f1", "L:nuvio-sports:e3"], "the Spanish agenda's copy leads");
});

test("a deadline or a spent request budget is not the source failing: no list backoff", async () => {
  const src = fakeSource("xuper", { lists: { "7": [ch("a", "A")] } });
  src.channels = async () => { throw gate.liveFetch.length >= 0 ? Object.assign(new Error("past"), { code: "deadline" }) : null; };
  const src2 = fakeSource("supertv");
  src2.channels = async () => { throw Object.assign(new Error("spent"), { code: "budget" }); };
  live._setSources([src, src2]);
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry: { xuper: [{ id: "7", title: "Zona" }], supertv: [{ id: "8", title: "┃ES┃ DAZN" }] } }) });
  await assert.rejects(() => live.liveChannels({ categoryId: key("xuper", "7") }));
  beginCall();
  await assert.rejects(() => live.liveChannels({ categoryId: "v.sp.es" }));
  ls.flushMeta();
  const lm = JSON.parse(k.store.get("o2:lm"));
  assert.ok(!(lm.l[key("xuper", "7")] && lm.l[key("xuper", "7")].failAt));
  assert.ok(!(lm.l[key("supertv", "8")] && lm.l[key("supertv", "8")].failAt));
});

test("the gate: past 50 started requests a call refuses with `budget`; within() bounds what starts inside it", async () => {
  const k = await device({ routes: [() => res(200, "{}")] });
  const out = [];
  for (let i = 0; i < 52; i++) out.push(await gate.liveFetch("https://h.test/" + i, {}).then(() => "ok", (e) => e.code));
  assert.equal(out.filter((x) => x === "ok").length, 50);
  assert.deepEqual(out.slice(50), ["budget", "budget"]);
  assert.equal(k.requests.length, 50);
  beginCall();
  const t = await gate.within(3000, async () => gate.timeoutFor(15000));
  assert.ok(t <= 3000 && t > 2000, String(t));
  assert.ok(gate.timeoutFor(15000) > 10000, "restored after within()");
  const late = await gate.within(0, () => gate.liveFetch("https://h.test/late", {}).then(() => "ok", (e) => e.code));
  assert.equal(late, "deadline");
});

test("v.all.xuper: a channel of an adult column is flagged adult there too (the column's list loads with it)", async () => {
  const xuper = fakeSource("xuper", { lists: { "1": [ch("a", "Venus"), ch("b", "Caracol TV")], "9": [ch("a", "Venus")] } });
  live._setSources([xuper]);
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry: { xuper: [{ id: "1", title: { es: "Todos", en: "All channels" } }, { id: "9", title: "XXX", adult: true }] } }) });
  const p = await live.liveChannels({ categoryId: "v.all.xuper", cursor: null });
  assert.deepEqual(p.items.map((c) => [c.title, !!c.adult]), [["Venus", true], ["Caracol TV", false]]);
  assert.ok(k.requests.some((r) => r.url.endsWith("/list/9")), "the adult column loaded with it");
});

// ── resolve ──

const PTV_ROUTES = (dead = []) => [(u) => {
  if (u.startsWith("http://a.example/")) return dead.some((d) => u.includes(d)) ? res(404, "") : res(200, "#EXTM3U\n#EXT-X-VERSION:3\n");
  return undefined;
}];

/** Runs [fn] as if kino-plugin.json did not declare `drm` (the 1.0.45 fallbacks), then restores the manifest's flag. */
async function drmUndeclared(fn) { live._setDrmDeclared(false); try { return await fn(); } finally { live._setDrmDeclared(); } }

const WIDEVINE = () => ({ url: "https://c/x.mpd", mime: "application/dash+xml", drm: { type: "widevine", licenseUrl: "https://l" } });

test("DRM declared: a merged channel whose tvenvivo fails plays caracol's own Widevine copy next (no longer skipped)", async () => {
  const { tv, car, ptv } = colombia({ caracol: { resolve: WIDEVINE } });
  tv.resolve = async (c, ctx) => { tv.calls.resolve.push(c); await ctx.fetch("https://tvenvivo.test/core", { timeoutMs: 8000 }); throw new Error("sin señal"); };
  ptv.resolve = async (raw) => { ptv.calls.resolve.push(raw); return { url: raw, mime: "application/vnd.apple.mpegurl" }; };
  live._setSources([tv, car, ptv]);
  const k = await device({ routes: [...PTV_ROUTES(), () => res(200, "<html>")],
    storage: storedLive({ registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }] }, lists: { [key("premiumtv", "Colombia")]: { items: norm("premiumtv", PTV_CO) } } }) });
  const page = await live.liveChannels({ categoryId: "v.co", cursor: null });
  const caracol = page.items.find((c) => c.title === "Caracol");
  beginCall();
  const out = await live.resolveLive(caracol.ref);
  assert.equal(out.url, "https://c/x.mpd", "caracol's Widevine copy plays after tvenvivo fails");
  assert.deepEqual(out.drm, { type: "widevine", licenseUrl: "https://l" });
  assert.equal(car.calls.resolve.length, 1);
  assert.equal(ptv.calls.resolve.length, 0, "premiumtv's copies stay alternatives");
  const logs = k.logs.filter((l) => l.includes("live: resolve"));
  assert.ok(!logs.some((l) => /needs DRM/.test(l)), logs.join("\n"));
});

test("DRM not declared: a merged channel whose tvenvivo fails skips caracol (DRM, 0 requests) and plays premiumtv's first copy; alternatives", () => drmUndeclared(async () => {
  const { tv, car, ptv } = colombia();
  tv.resolve = async (c, ctx) => { tv.calls.resolve.push(c); await ctx.fetch("https://tvenvivo.test/core", { timeoutMs: 8000 }); throw new Error("sin señal"); };
  ptv.resolve = async (raw) => { ptv.calls.resolve.push(raw); return { url: raw, mime: "application/vnd.apple.mpegurl" }; };
  live._setSources([tv, car, ptv]);
  const k = await device({ routes: [...PTV_ROUTES(), () => res(200, "<html>")],
    storage: storedLive({ registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }] }, lists: { [key("premiumtv", "Colombia")]: { items: norm("premiumtv", PTV_CO) } } }) });
  const page = await live.liveChannels({ categoryId: "v.co", cursor: null });
  const caracol = page.items.find((c) => c.title === "Caracol");
  beginCall();
  const out = await live.resolveLive(caracol.ref);
  assert.equal(out.url, "http://a.example/caracol1.m3u8");
  assert.equal(car.calls.resolve.length, 0, "the DRM member is skipped with no request");
  assert.deepEqual(k.requests.slice(-2).map((r) => r.url), ["https://tvenvivo.test/core", "http://a.example/caracol1.m3u8"], "tvenvivo, then premiumtv's probe");
  assert.equal(out.label, "Premium TV · HD");
  assert.deepEqual(out.alternatives, [
    { label: "tvenvivo", ref: liveRef("tvenvivo", "caracol") },
    { label: "Premium TV · HD · opción 2", ref: liveRef("premiumtv", "http://a.example/caracol2.m3u8") },
  ], "the other members in play order (no DRM member)");
  for (const a of out.alternatives) { assert.ok(a.ref.length <= 512); assert.ok(a.label.length <= 48); }
  const logs = k.logs.filter((l) => l.includes("live: resolve"));
  assert.ok(logs.length > 0);
  for (const l of logs) { assert.ok(!/https?:|L:|M:|a\.example|caracol1/.test(l), "no URL or ref in the log: " + l); }
  assert.ok(logs.some((l) => /caracol needs DRM \(not declared\), skipped/.test(l)));
  assert.ok(logs.some((l) => /tvenvivo failed in \d+ ms \(error\); premiumtv ok in \d+ ms \(3 of 4\)/.test(l)), logs.join("\n"));
  // English labels (tvenvivo failed: it is demoted for 10 min, so it is now the last alternative)
  k.kino.lang = "en";
  beginCall();
  const en = await live.resolveLive(caracol.ref);
  assert.deepEqual(en.alternatives.map((a) => a.label), ["Premium TV · HD · option 2", "tvenvivo"]);
}));

test("resolve: a blind member whose playlist is dead is probed and skipped; an MPEG-TS one is not probed; ≤ 3 probes", async () => {
  const a = fakeSource("premiumtv", { flags: { blind: true }, name: "Premium TV", resolve: (raw) => ({ url: raw, mime: /\/play\//.test(raw) ? "video/mp2t" : "application/vnd.apple.mpegurl" }) });
  live._setSources([a]);
  const k = await device({ routes: PTV_ROUTES(["dead"]) });
  const ref = "M:" + ["http://a.example/dead1.m3u8", "http://a.example/dead2.m3u8", "http://a.example/ok.m3u8"].map((u) => "premiumtv:" + encodeURIComponent(u)).join(",");
  const out = await live.resolveLive(ref);
  assert.equal(out.url, "http://a.example/ok.m3u8");
  assert.equal(k.requests.length, 2, "two dead probes; the last member has nothing to fall to: not probed");
  beginCall();
  const ts = "M:" + ["http://c.example/play/a03r", "http://a.example/ok.m3u8"].map((u) => "premiumtv:" + encodeURIComponent(u)).join(",");
  const n = k.requests.length;
  const t = await live.resolveLive(ts);
  assert.equal(t.url, "http://c.example/play/a03r", "an MPEG-TS address cannot be probed: it plays");
  assert.equal(k.requests.length, n);
  // host_not_allowed (an http host Kino refuses to fetch under "fetchHosts": "any"): cannot tell, it plays
  const k2 = await device({ routes: [() => Object.assign(new Error("nope"), { code: "host_not_allowed" })] });
  const h = await live.resolveLive("M:" + ["http://d.example/x.m3u8", "http://a.example/ok.m3u8"].map((u) => "premiumtv:" + encodeURIComponent(u)).join(","));
  assert.equal(h.url, "http://d.example/x.m3u8");
  assert.equal(k2.requests.length, 1);
});

test("resolve: each member gets its share of the call (10 s first, 5 s next): a hanging member never eats the 16 s", async () => {
  const slow = fakeSource("tvenvivo", { resolve: async (c, ctx) => { await ctx.fetch("https://tvenvivo.test/core", { timeoutMs: 15000 }); throw new Error("x"); } });
  const slow2 = fakeSource("cablevisionhd", { resolve: async (c, ctx) => { await ctx.fetch("https://cablevisionhd.test/core", { timeoutMs: 15000 }); throw new Error("x"); } });
  const ok = fakeSource("xuper", {});
  live._setSources([slow, slow2, ok]);
  const k = await device({ routes: [(u) => (u.includes("/core") ? Object.assign(new Error("timeout"), { code: "timeout" }) : undefined)] });
  const out = await live.resolveLive("M:tvenvivo:a,cablevisionhd:b,xuper:c");
  assert.equal(out.url, "https://xuper.test/play/c.m3u8");
  const t = k.requests.map((r) => r.timeoutMs);
  assert.ok(t[0] <= 10000 && t[0] > 9000, "first member's share: " + t[0]);
  assert.ok(t[1] <= 5000 && t[1] > 4000, "next member's share: " + t[1]);
  // all members fail: one error with the merged message, in ES and EN, with a sentence for the person
  live._setSources([slow, slow2]);
  beginCall();
  await assert.rejects(() => live.resolveLive("M:tvenvivo:a,cablevisionhd:b"), (e) => e.code === "unavailable" &&
    e.message === "Xuper: ninguno de los 2 servidores del canal funcionó" &&
    e.userMessage === "Ningún servidor de este canal funciona ahora mismo. Prueba otro canal o vuelve en unos minutos.");
  k.kino.lang = "en";
  beginCall();
  await assert.rejects(() => live.resolveLive("M:tvenvivo:a,cablevisionhd:b"), (e) => e.message === "Xuper: none of the channel's 2 servers worked" &&
    e.userMessage === "None of this channel's servers works right now. Try another channel or come back in a few minutes.");
});

test("re-resolve within 90 s: the member it played is re-checked (zapping never demotes a healthy one); Kino's chain of reopens demotes", async () => {
  const a = fakeSource("tvenvivo", {}), b = fakeSource("cablevisionhd", {}), c = fakeSource("xuper", {});
  live._setSources([a, b, c]);
  await device({ routes: [() => res(200, PLAYLIST)] });   // every playlist answers (a cut of its segments, say)
  const A = "M:tvenvivo:a1,cablevisionhd:a2,xuper:a3", B = "M:tvenvivo:b1,cablevisionhd:b2", Z = "L:xuper:z", C = "L:xuper:c";
  const real = Date.now;
  let now = real();
  Date.now = () => now;
  const R = async (ref) => { beginCall(); const out = await live.resolveLive(ref); now += 3000; return out.url.split("/play/")[1].replace(".m3u8", ""); };
  try {
    // zapping A → B → C: Kino preheats the neighbours (the channel just left among them) one at a time
    assert.equal(await R(A), "a1");
    assert.equal(await R(B), "b1");
    assert.equal(await R(Z), "z");
    assert.equal(await R(C), "c");
    assert.equal(await R(A), "a1", "the same channel again: its playlist answers, it plays again");
    assert.equal(ls.demotedAt("L:tvenvivo:a1"), 0);
    // a cut: Kino reopens the channel 2, 4 and 8 s later with the same ref, nothing resolved in between
    assert.equal(await R(A), "a2", "a second re-resolve in a row: a1 demoted");
    assert.equal(await R(A), "a3", "again: a2 demoted too");
    assert.equal(await R(A), "a1", "every member demoted: the oldest demotion first");
    // B again 71 s after its preheat (other channels in between): checked, it plays
    now += 50_000;
    assert.equal(await R(B), "b1");
    now += 91_000;
    assert.equal(await R(B), "b1", "91 s later: not a reopen");
    // demotions expire after 10 min
    now += 11 * M;
    assert.equal(await R(Z), "z");
    assert.equal(await R(A), "a1");
    // a back-to-back preheat (under 1.5 s) is not a cut
    now -= 2000;
    assert.equal(await R(A), "a1");
  } finally { Date.now = real; }
});

test("an old single L: favourite plays exactly as 1.0.45; when it fails, its same-name siblings in the stored lists play (0 lookup requests)", async () => {
  const { tv, car, ptv } = colombia();
  tv.resolve = async () => { throw new Error("sin señal"); };
  ptv.resolve = async (raw) => ({ url: raw, mime: "application/vnd.apple.mpegurl" });
  live._setSources([tv, car, ptv]);
  const k = await device({ routes: PTV_ROUTES(),
    storage: storedLive({ registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }] }, lists: { [key("premiumtv", "Colombia")]: { items: norm("premiumtv", PTV_CO) } } }) });
  const plain = await live.resolveLive(liveRef("premiumtv", "http://a.example/rcn.m3u8"));
  assert.deepEqual(plain, { url: "http://a.example/rcn.m3u8", mime: "application/vnd.apple.mpegurl" }, "1.0.45's answer: no probe, no label");
  assert.equal(k.requests.length, 0);
  beginCall();
  const out = await live.resolveLive(liveRef("tvenvivo", "caracol"));
  assert.equal(out.url, "http://a.example/caracol1.m3u8", "tvenvivo failed: premiumtv's copy of Caracol (caracol's own needs DRM)");
  assert.deepEqual(k.requests.map((r) => r.url), ["http://a.example/caracol1.m3u8"], "only the probe of the copy played");
  // with no sibling stored, the 1.0.45 error is unchanged
  beginCall();
  await assert.rejects(() => live.resolveLive(liveRef("tvenvivo", "nada")), /no se pudo abrir el canal \(sin señal\)/);
});

test("a single caracol ref (DRM) returns its Widevine stream, which Kino plays because the manifest declares drm", async () => {
  const car = fakeSource("caracol", { flags: { drm: true }, resolve: () => ({ url: "https://c/x.mpd", mime: "application/dash+xml", drm: { type: "widevine", licenseUrl: "https://l" } }) });
  live._setSources([car]);
  await device({ noFetch: true });
  const out = await live.resolveLive("L:caracol:20");
  assert.deepEqual(out, { url: "https://c/x.mpd", mime: "application/dash+xml", drm: { type: "widevine", licenseUrl: "https://l" } });
});

// ── the own screen ──

function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn);
}
const byKey = (tree, k) => { let out; walk(tree, (n) => { if (!out && n.key === k) out = n; }); return out; };
const parentsOf = (tree, k) => { const path = []; let found = null; (function go(n, st) { if (found || !n || typeof n !== "object") return; if (Array.isArray(n)) { n.forEach((x) => go(x, st)); return; } if (n.key === k) { found = st; return; } for (const v of Object.values(n)) if (v && typeof v === "object") go(v, n.type ? [...st, n.type] : st); })(tree, path); return found; };
const timersOf = (v) => (Array.isArray(v.every) ? v.every : v.every ? [v.every] : []).map((t) => t.event);

test("screen: a remembered raw id lands on its virtual category; the grid is lazy (no scroll around it); 700 channels reachable", async () => {
  const many = Array.from({ length: 700 }, (_, i) => ch("c" + i, "Canal " + i));
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "co", title: "Colombia" }, { id: "deportes", title: "Deportes" }], lists: { co: many, deportes: [ch("e", "ESPN")] } });
  live._setSources([tv]);
  const k = await device({ noFetch: true });
  const state = { nav: "vivo", liveCat: "tvenvivo.636f", lcTried: true };
  const v = await screen({ state });
  assert.equal(byKey(v, "liveCat").value, "v.co", "tvenvivo.636f (1.0.45's Colombia) → v.co");
  const grid = gridOf(v, "vivo");
  assert.equal(grid.type, "ListView");
  assert.equal(grid.key, "vivoGrid-v.co");
  assert.ok(!parentsOf(v, grid.key).includes("SingleChildScrollView") && !parentsOf(v, grid.key).includes("ListView"), "a list in a scroll is drawn whole");
  assert.equal(grid.items.length, 50, "LV_STEP tiles first");
  assert.deepEqual(grid.onEndReached, { event: "lvMore" });
  assert.equal(grid.done, false);
  assert.ok(byKey(v, "vivoNext") && !byKey(v, "vivoPrev"));
  assert.equal(byKey(v, "vivoNext").labelText, "Siguientes 100");
  assert.ok(JSON.stringify(state).length < 200, "no list in the state");
  // scrolling: lvMore grows it to the page of 100 (each tile is 5 of the 600 nodes Kino reads), then stops
  let st = { ...state };
  for (let i = 0; i < 3; i++) { beginCall(); const r = await screenEvent({ name: "lvMore", state: st }); st = { ...st, ...(r.state || {}) }; }
  assert.equal(st.lvShown, 100);
  beginCall();
  const v2 = await screen({ state: st });
  assert.equal(tilesOf(v2, "vivo").length, 100);
  assert.equal(gridOf(v2, "vivo").done, true);
  assert.equal(gridOf(v2, "vivo").key, grid.key, "the same category and page keep their key (and the person's place)");
  // the next 100: a page of its own key, so it opens at its top
  beginCall();
  const nx = await screenEvent({ name: "lvPage", value: 1, state: st });
  st = { ...st, ...nx.state };
  beginCall();
  const v3 = await screen({ state: st });
  assert.equal(channelsOf(v3, "vivo")[0].title, "Canal 100");
  assert.equal(tilesOf(v3, "vivo").length, 50);
  assert.equal(gridOf(v3, "vivo").key, "vivoGrid-v.co-p1");
  assert.ok(byKey(v3, "vivoPrev"));
  assert.equal(byKey(v3, "vivoWhere").text, "101–200 de 700");
  // the last page: 601–700, no "Siguientes"
  beginCall();
  const v4 = await screen({ state: { ...st, lvPage: 6 } });
  assert.equal(byKey(v4, "vivoWhere").text, "601–700 de 700");
  assert.ok(!byKey(v4, "vivoNext"));
  assert.equal(channelsOf(v4, "vivo")[0].title, "Canal 600");
  // a new category starts at its top
  beginCall();
  const pick = await screenEvent({ name: "liveCat", value: "v.sports", state: st });
  assert.deepEqual(pick.state, { liveCat: "v.sports", lvShown: null, lvPage: null });
  beginCall();
  const v5 = await screen({ state: { ...st, ...pick.state } });
  assert.equal(gridOf(v5, "vivo").key, "vivoGrid-v.sports");
  assert.equal(k.requests.length, 0);
});

test("screen: a partly stored category answers at once and the lvRefresh tick loads the rest in batches", async () => {
  const xcols = Array.from({ length: 14 }, (_, i) => ({ id: String(100 + i), title: "Colombia " + (i + 1) }));
  const xuper = fakeSource("xuper", { lists: Object.fromEntries(xcols.map((c) => [c.id, [ch("x" + c.id, "Canal " + c.id)]])) });
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "co", title: "Colombia" }], lists: { co: [ch("caracol", "Caracol")] } });
  live._setSources([tv, xuper]);
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry: { xuper: xcols } }) });
  const pick = await screenEvent({ name: "liveCat", value: "v.co", state: { nav: "vivo", lcTried: true } });
  assert.equal(k.requests.length, 0, "tvenvivo's code list is there: answered at once");
  let state = { nav: "vivo", lcTried: true, ...pick.state };
  beginCall();
  let v = await screen({ state });
  assert.deepEqual(timersOf(v), ["lvRefresh"]);
  let ticks = 0;
  while (timersOf(v).includes("lvRefresh") && ticks < 10) {
    beginCall();
    const t = await screenEvent({ name: "lvRefresh", state });
    state = { ...state, ...t.state };
    ticks++;
    beginCall();
    v = await screen({ state });
  }
  assert.equal(ticks, 3, "6 + 6 + 2 xuper columns");
  assert.equal(tilesOf(v, "vivo").length, 15);
  assert.equal(state.lvTried["v.co"], true);
  assert.ok(JSON.stringify(state).length < 400);
});

test("Fútbol ▸ Canales lands on Deportes and its dropdown holds only sports and live events (no adult, no 'Otros deportes')", async () => {
  const cats = [{ id: "1", title: "NBA" }, { id: "2", title: "Liga MX" }, { id: "3", title: "XXX", adult: true }, { id: "4", title: "Eventos" }, { id: "5", title: "Noticias" }];
  live._setSources([fakeSource("xuper", { code: true, cats })]);
  await device({ noFetch: true });
  const v = await screen({ state: { nav: "deportes", depTab: "canales", lcTried: true } });
  const dd = byKey(v, "sportsCat");
  assert.equal(dd.value, "v.sports");
  assert.deepEqual(dd.options.map((o) => o.value), ["v.sports", "v.events"]);
  const sp = gridOf(v, "sp");
  assert.ok(!sp || !parentsOf(v, sp.key).includes("SingleChildScrollView"));
});

test("resolve: two copies with the same label are told apart ('Fútbol Libre', 'Fútbol Libre · 2')", async () => {
  const fl = fakeSource("futbollibre", { name: "Fútbol Libre" });
  const tv = fakeSource("tvenvivo", { name: "TV en Vivo" });
  live._setSources([tv, fl]);
  await device({ noFetch: true });
  const out = await live.resolveLive("M:tvenvivo:fox,futbollibre:a,futbollibre:b");
  assert.equal(out.label, "TV en Vivo");
  assert.deepEqual(out.alternatives.map((a) => a.label), ["Fútbol Libre", "Fútbol Libre · 2"]);
});

// ── review fixes (2026-11-17) ──

const PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n";
/** Resolves `ref` as one plugin call on the clock `now()`; → the played member's raw id ("a1"). */
const resolvedAs = async (ref) => { beginCall(); const out = await live.resolveLive(ref); return decodeURIComponent(out.url.split("/play/")[1]).replace(".m3u8", ""); };
function onClock(fn) {
  const real = Date.now;
  const clock = { now: real() };
  Date.now = () => clock.now;
  return Promise.resolve().then(() => fn(clock)).finally(() => { Date.now = real; });
}

test("DRM declared: an old single caracol favourite plays caracol's own Widevine stream at once, no sibling tried", async () => {
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "co", title: "Colombia" }], lists: { co: [ch("caracol", "Caracol"), ch("rcn", "RCN")] } });
  const car = fakeSource("caracol", { code: true, cats: [{ id: "all", title: "Canales en vivo" }], flags: { drm: true }, resolve: WIDEVINE });
  live._setSources([tv, car]);
  const k = await device({ noFetch: true, storage: storedLive({ lists: { [key("caracol", "all")]: { items: norm("caracol", [ch("20", "Caracol TV")]) } } }) });
  const out = await live.resolveLive("L:caracol:20");
  assert.equal(out.url, "https://c/x.mpd", "caracol's own copy plays: Kino takes its DRM");
  assert.deepEqual(out.drm, { type: "widevine", licenseUrl: "https://l" });
  assert.equal(car.calls.resolve.length, 1);
  assert.equal(tv.calls.resolve.length, 0, "no sibling is tried");
  assert.equal(k.requests.length, 0);
});

test("DRM not declared: an old single caracol favourite plays its stored same-name sibling at the first open; caracol's own costs nothing", () => drmUndeclared(async () => {
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "co", title: "Colombia" }], lists: { co: [ch("caracol", "Caracol"), ch("rcn", "RCN")] } });
  const car = fakeSource("caracol", { code: true, cats: [{ id: "all", title: "Canales en vivo" }], flags: { drm: true },
    resolve: () => ({ url: "https://c/x.mpd", mime: "application/dash+xml", drm: { type: "widevine", licenseUrl: "https://l" } }) });
  live._setSources([tv, car]);
  // a cold runtime: nothing listed in it, only caracol's stored list ("Caracol TV": not the same name as tvenvivo's)
  const k = await device({ noFetch: true, storage: storedLive({ lists: { [key("caracol", "all")]: { items: norm("caracol", [ch("20", "Caracol TV")]) } } }) });
  const out = await live.resolveLive("L:caracol:20");
  assert.equal(out.url, "https://tvenvivo.test/play/caracol.m3u8", "Caracol TV plays from tvenvivo");
  assert.equal(out.drm, undefined);
  assert.equal(car.calls.resolve.length, 0, "the DRM member is skipped with no request");
  assert.equal(k.requests.length, 0);
}));

test("nuvio's 24/7 networks (the US line-up) never merge with Latin American feeds of the same name: 'Deportes · Estados Unidos'", async () => {
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "deportes", title: "Deportes" }], lists: { deportes: [ch("espn-2", "ESPN 2"), ch("fs2", "Fox Sports 2")] } });
  const nuvio = fakeSource("nuvio-sports", { code: true, cats: [{ id: "networks", title: { es: "TV deportiva 24/7", en: "24/7 sports TV" } }],
    lists: { networks: [ch("espn2us", "ESPN 2"), ch("fs2us", "FOX Sports 2")] } });
  live._setSources([tv, nuvio]);
  await device({ routes: [() => res(200, "{}")] });
  const cats = await live.liveCategories();
  assert.deepEqual(cats.find((c) => c.id === "v.sp.us"), { id: "v.sp.us", title: "Deportes · Estados Unidos", genre: "deportes", country: "US" });
  beginCall();
  const sp = await live.liveChannels({ categoryId: "v.sports", cursor: null });
  assert.deepEqual(sp.items.map((c) => c.ref), ["L:tvenvivo:espn-2", "L:tvenvivo:fs2"], "Spanish ESPN 2 and Fox Sports 2 stay apart from the US feeds");
  beginCall();
  const us = await live.liveChannels({ categoryId: "v.sp.us", cursor: null });
  assert.deepEqual(us.items.map((c) => c.ref), ["L:nuvio-sports:espn2us", "L:nuvio-sports:fs2us"]);
});

test("a person reopening a healthy merged channel (nothing resolved in between) keeps its best member: checked, not demoted", async () => {
  live._setSources([fakeSource("tvenvivo"), fakeSource("cablevisionhd"), fakeSource("xuper")]);
  const k = await device({ routes: [() => res(200, PLAYLIST)] });
  const A = "M:tvenvivo:a1,cablevisionhd:a2,xuper:a3";
  await onClock(async (clock) => {
    assert.equal(await resolvedAs(A), "a1");
    clock.now += 20_000;   // watched 20 s, pressed Back, tapped it again (own grid, a Home card: no preheat in between)
    assert.equal(await resolvedAs(A), "a1", "its playlist still answers: it plays again");
    assert.equal(ls.demotedAt("L:tvenvivo:a1"), 0, "not demoted");
    assert.deepEqual(k.requests.map((r) => r.url), ["https://tvenvivo.test/play/a1.m3u8"], "one playlist request checked it");
    clock.now += 20_000;   // a second reopen in a row inside the window counts as a cut (Kino's reopen chain)
    assert.equal(await resolvedAs(A), "a2");
  });
});

test("Kino's order after a cut: the open, its neighbours preheated, then the reopen → the next member; a slow cut + 30 s retry too", async () => {
  live._setSources([fakeSource("tvenvivo"), fakeSource("cablevisionhd"), fakeSource("xuper")]);
  const dead = new Set();
  await device({ routes: [(u) => ([...dead].some((d) => u.endsWith("/play/" + d + ".m3u8")) ? res(404, "") : res(200, PLAYLIST))] });
  const A = "M:tvenvivo:a1,cablevisionhd:a2,xuper:a3", B = "M:tvenvivo:b1,xuper:b2", C = "L:xuper:c";
  await onClock(async (clock) => {
    assert.equal(await resolvedAs(A), "a1");   // the open from En vivo
    clock.now += 1500; await resolvedAs(B);    // a second later, Kino resolves its neighbours one at a time
    clock.now += 1500; await resolvedAs(C);
    dead.add("a1");
    clock.now += 6000;                         // a1 dies; Kino reopens 2 s after the cut (attempt 1/3)
    assert.equal(await resolvedAs(A), "a2", "the first reopen already moves on");
    dead.add("a2");
    clock.now += 5000;                         // attempt 2/3, 4 s after the next cut
    assert.equal(await resolvedAs(A), "a3");
    // A player that takes 20 s to report the cut, then Kino's quiet retry 30 s later: still a reopen.
    clock.now += 11 * M;                       // the demotions are over
    dead.clear();
    assert.equal(await resolvedAs(A), "a1");
    dead.add("a1");
    clock.now += 50_000;
    assert.equal(await resolvedAs(A), "a2", "50 s after the open");
  });
});

test("screen: one member failing (its list still fresh) neither blocks the refresh of another stale member nor shows the offline banner", async () => {
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, cats: [{ id: "co", title: "Colombia" }], lists: { co: [ch("caracol", "Caracol")] } });
  const ptv = fakeSource("premiumtv", { name: "Premium TV", flags: { blind: true, sharedFetch: true }, lists: { Colombia: [ch("http://a/x.m3u8", "Canal Uno"), ch("http://a/y.m3u8", "Citytv")] } });
  const xu = fakeSource("xuper", { lists: { "100": [ch("x1", "Teleantioquia")] } });
  live._setSources([tv, ptv, xu]);
  const now = Date.now();
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({
    registry: { premiumtv: [{ id: "Colombia", title: "Colombia" }], xuper: [{ id: "100", title: "Colombia" }] },
    lists: {
      [key("premiumtv", "Colombia")]: { items: norm("premiumtv", [ch("http://a/x.m3u8", "Canal Uno")]), at: now - 7 * H },   // stale, its host healthy
      [key("xuper", "100")]: { items: norm("xuper", [ch("x1", "Teleantioquia")]), at: now - 2 * H, failAt: now - 2 * M },   // fresh, its last refresh failed
    } }) });
  let state = { nav: "vivo", lcTried: true };
  let v = await screen({ state });
  assert.equal(tilesOf(v, "vivo").length, 3, "Colombia (the only category): the three stored and code lists");
  assert.deepEqual(timersOf(v), ["lvRefresh"], "premiumtv's stale list is refreshed");
  assert.equal(byKey(v, "vivoOffline"), undefined, "no offline banner over the whole category");
  beginCall();
  const t = await screenEvent({ name: "lvRefresh", state });
  assert.deepEqual(k.requests.map((r) => r.url), ["https://premiumtv.test/list/Colombia"]);
  state = { ...state, ...t.state };
  beginCall();
  v = await screen({ state });
  assert.equal(tilesOf(v, "vivo").length, 4);
  assert.equal(byKey(v, "vivoOffline"), undefined);
});

test("a merged category's missing lists get their connector's own timeout from Kino's liveChannels (1.0.45's); a timeout this call's own bound cut short is not the source failing", async () => {
  const mk = (id, ms) => {
    const s = fakeSource(id, { flags: { sharedFetch: true }, lists: { sports: [ch(id + "1", "ESPN")] } });
    s.channels = async (cat, ctx) => {   // one big page (cablevisionhd's 915 KB scrape, premiumtv's m3u)
      const r = await ctx.fetch(`https://${id}.test/big`, { timeoutMs: ms });
      if (!r.ok) throw new Error("big " + r.status);
      return [ch(id + "1", "ESPN")];
    };
    return s;
  };
  live._setSources([mk("cablevisionhd", 12000), mk("premiumtv", 15000)]);
  const now = Date.now();
  const registry = { cablevisionhd: [{ id: "sports", title: "Deportes" }], premiumtv: [{ id: "sports", title: "Deportes" }] };
  const stale = { registry,
    lists: { [key("cablevisionhd", "sports")]: { items: norm("cablevisionhd", [ch("c1", "ESPN")]), at: now - 25 * H }, [key("premiumtv", "sports")]: { items: norm("premiumtv", [ch("p1", "ESPN")]), at: now - 7 * H } } };
  const timeout = () => Object.assign(new Error("timeout"), { code: "timeout" });
  // nothing stored: Kino's first page waits for both lists, each under its connector's own timeout
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry }) });
  await live.liveChannels({ categoryId: "v.sports", cursor: null });
  assert.deepEqual(k.requests.map((r) => r.timeoutMs).sort((a, b) => a - b), [12000, 15000]);
  // the own screen's tick (3 s per request): the 12 s and 15 s downloads time out at 3 s → no failure backoff. On a
  // frozen clock each request starts exactly when the tick does, so it gets the tick's whole 3 s (no real time between).
  await onClock(async () => {
    const k2 = await device({ routes: [timeout], storage: storedLive(stale) });
    await live.loadList("v.sports", { bounds: live.TICK_BOUNDS });
    assert.equal(k2.requests.length, 2);
    assert.deepEqual(k2.requests.map((r) => r.timeoutMs), [3000, 3000]);
    const lm = JSON.parse(k2.store.get("o2:lm"));
    assert.equal(lm.l[key("cablevisionhd", "sports")].failAt, 0);
    assert.equal(lm.l[key("premiumtv", "sports")].failAt, 0);
  });
  // a timeout at the source's own timeout still is a failure
  const k3 = await device({ routes: [timeout], storage: storedLive({ registry }) });
  await assert.rejects(() => live.liveChannels({ categoryId: "v.sports", cursor: null }));
  assert.deepEqual(k3.requests.map((r) => r.timeoutMs).sort((a, b) => a - b), [12000, 15000]);
  assert.ok(JSON.parse(k3.store.get("o2:lm")).l[key("premiumtv", "sports")].failAt > 0);
});

test("a column known to be empty is hidden only while that empty list is fresh; past it, it is listed again so a first page re-checks it", async () => {
  const cols = [{ id: "3331", title: "Zeta" }, { id: "3332", title: "Omega" }];
  live._setSources([fakeSource("xuper", { lists: { "3331": [ch("z1", "Zeta TV")], "3332": [ch("o1", "Omega TV")] } })]);
  const now = Date.now();
  const at = (hoursAgo) => storedLive({ registry: { xuper: cols }, lists: {
    [key("xuper", "3331")]: { items: [], at: now - hoursAgo * H },
    [key("xuper", "3332")]: { items: norm("xuper", [ch("o1", "Omega TV")]), at: now - H } } });
  const titles = async () => (await live.liveCategories()).map((c) => c.title);
  let k = await device({ noFetch: true, storage: at(2) });
  assert.deepEqual(await titles(), ["Omega"], "empty 2 h ago (xuper's lists are fresh 24 h): hidden");
  k = await device({ routes: [() => res(200, "{}")], storage: at(25) });
  assert.deepEqual(await titles(), ["Zeta", "Omega"], "empty 25 h ago: listed again");
  beginCall();
  assert.deepEqual((await live.screenCategories("vivo")).cats.map((c) => c.title), ["Zeta", "Omega"]);
  beginCall();
  const p = await live.liveChannels({ categoryId: key("xuper", "3331"), cursor: null });
  assert.deepEqual(p.items.map((c) => c.title), ["Zeta TV"], "its first page re-checked it");
  assert.equal(k.requests.length, 1);
});

test("resolving a merged channel reads no stored list for its labels (cold runtime: the sources' names)", async () => {
  const ptv = fakeSource("premiumtv", { name: "Premium TV" });
  live._setSources([fakeSource("tvenvivo", { name: "TV en Vivo" }), ptv]);
  const groups = Array.from({ length: 40 }, (_, i) => "G" + i);
  const lists = Object.fromEntries(groups.map((g) => [key("premiumtv", g), { items: norm("premiumtv", [ch("http://a/" + g + ".m3u8", "Caracol HD [Opc." + g.slice(1) + "]")]) }]));
  const k = await device({ noFetch: true, storage: storedLive({ registry: { premiumtv: groups.map((g) => ({ id: g, title: g })) }, lists }) });
  const get = k.kino.storage.get;
  let reads = 0;
  k.kino.storage.get = (key) => { if (String(key).startsWith("o2:ll:")) reads++; return get(key); };
  const out = await live.resolveLive("M:tvenvivo:caracol,premiumtv:" + encodeURIComponent("http://a/G1.m3u8") + ",premiumtv:" + encodeURIComponent("http://a/G2.m3u8"));
  assert.equal(out.url, "https://tvenvivo.test/play/caracol.m3u8");
  assert.equal(reads, 0, "no stored list read");
  assert.equal(out.label, "TV en Vivo");
  assert.deepEqual(out.alternatives.map((a) => a.label), ["Premium TV", "Premium TV · 2"]);
});

// ── merge pass 2 (Redmi run 2026-11-17): M1 probe, O1 events ──

test("probe: supertv's playlist answering 302 to http://<ip> (Kino re-issues it over https: TLS fails) is not dead; only a refusal is", async () => {
  const stv = fakeSource("supertv", { flags: { blind: true }, name: "SuperTV", resolve: (raw) => ({ url: "https://line.znn8.xyz/live/u/p/" + raw + ".m3u8" }) });
  live._setSources([stv]);
  const ref = "M:" + ["a", "b", "c", "d"].map((x) => "supertv:" + x).join(",");
  // Kino follows a redirect by default and re-issues http://185.227.34.91 over https; asked not to, it hands back the 302
  const k = await device({ routes: [(u, init) => (init.redirect === "manual" ? res(302, "", { Location: "http://185.227.34.91/live/x.m3u8" }) : Object.assign(new Error("SSLHandshakeException"), { code: "network" }))] });
  const out = await live.resolveLive(ref);
  assert.equal(out.url, "https://line.znn8.xyz/live/u/p/a.m3u8", "the best copy plays (720p only as the last resort)");
  assert.equal(k.requests.length, 1, "one probe, no redirect followed");
  assert.equal(ls.demotedAt("L:supertv:a"), 0, "not demoted");
  // a network error, a TLS failure or a timeout cannot tell either: it plays
  for (const err of [{ code: "network" }, { code: "timeout" }, { code: "host_not_allowed" }]) {
    await device({ routes: [() => Object.assign(new Error("x"), err)] });
    assert.equal((await live.resolveLive(ref)).url, "https://line.znn8.xyz/live/u/p/a.m3u8", err.code);
  }
  // 408 / 425 / 429: the server is busy, not refusing
  for (const st of [408, 425, 429]) {
    await device({ routes: [() => res(st, "")] });
    assert.equal((await live.resolveLive(ref)).url, "https://line.znn8.xyz/live/u/p/a.m3u8", String(st));
  }
  // an HTTP refusal (4xx, 5xx: supertv's 509 too) or a body that is not a playlist: dead, the next copy plays
  for (const r of [res(404, ""), res(403, ""), res(509, ""), res(200, "<html>blocked</html>")]) {
    await device({ routes: [(u) => (u.endsWith("/a.m3u8") ? r : res(200, PLAYLIST))] });
    assert.equal((await live.resolveLive(ref)).url, "https://line.znn8.xyz/live/u/p/b.m3u8", String(r.status));
    assert.ok(ls.demotedAt("L:supertv:a") > 0);
  }
});

test("v.events: one event in nuvio and in cncverse's providers is one channel; its long cncverse refs go by id and resolve from the stored lists (0 lookup requests); an event that is over is not listed", async () => {
  const T = Date.now();
  const long = (p) => "cnc:" + p + "-" + "x".repeat(1500);   // a cncverse id carries its whole event descriptor
  const nuvio = fakeSource("nuvio-sports", { code: true, cats: [{ id: "live", title: "En vivo" }],
    lists: { live: [{ id: "n1", title: "LIVE: Chile vs Colombia", start: T - 30 * M }, { id: "n2", title: "LIVE: Peru vs Bolivia", start: T - 15 * H }, { id: "n3", title: "Willow Cricket" }] } });
  const cnc = fakeSource("cncverse", { cats: [{ id: "cnc_AEvents", title: "A" }, { id: "cnc_BEvents", title: "B" }],
    lists: { cnc_AEvents: [{ id: long("a"), title: "Chile vs Colombia", start: T - 30 * M, end: T + 90 * M }], cnc_BEvents: [{ id: long("b"), title: "Chile vs Colombia", start: T - 30 * M + 20_000, end: T + 90 * M }, { id: long("c"), title: "Japan vs Ghana", start: T - 5 * H, end: T - 3 * H }] },
    resolve: (raw) => ({ url: "https://cdn.test/" + raw.slice(4, 5) + ".m3u8" }) });
  nuvio.resolve = async () => { throw Object.assign(new Error("no streams"), { code: "no_streams" }); };
  live._setSources([nuvio, cnc]);
  const k = await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry: { cncverse: [{ id: "cnc_AEvents", title: "A" }, { id: "cnc_BEvents", title: "B" }] } }) });
  const p = await live.liveChannels({ categoryId: "v.events", cursor: null });
  assert.deepEqual(p.items.map((c) => c.title), ["LIVE: Chile vs Colombia", "Willow Cricket"], "Peru vs Bolivia started 15 h ago (no end) and Japan vs Ghana ended 3 h ago: not listed");
  const match = p.items[0];
  const parts = decodeRef(match.ref).members;
  assert.deepEqual(parts.map((m) => m.ref || m.id), ["L:nuvio-sports:n1", "cncverse_" + live.hashId(long("a")), "cncverse_" + live.hashId(long("b"))]);
  assert.ok(match.ref.length < 200, "short enough for a favourite: " + match.ref.length);
  // resolve in a cold runtime: nuvio fails, the first cncverse copy (found by its id in the stored lists) plays
  ls._resetMemory();
  k.requests.length = 0;
  beginCall();
  const out = await live.resolveLive(match.ref);
  assert.equal(out.url, "https://cdn.test/a.m3u8");
  assert.deepEqual(k.requests, [], "0 requests to find the members");
  assert.deepEqual(out.alternatives.map((a) => a.ref), ["L:nuvio-sports:n1", "M:cncverse_" + live.hashId(long("b"))], "a long ref goes as a one-member M: ref (≤ 512)");
  // an alternative written by id resolves alone
  beginCall();
  assert.equal((await live.resolveLive(out.alternatives[1].ref)).url, "https://cdn.test/b.m3u8");
  // once the stored lists dropped the event, its members by id are gone
  k.store.delete("o2:ll:" + key("cncverse", "cnc_AEvents"));
  k.store.delete("o2:ll:" + key("cncverse", "cnc_BEvents"));
  ls._resetMemory();
  beginCall();
  await assert.rejects(() => live.resolveLive("M:" + parts.slice(1).map((m) => m.id).join(",")), /ya no está en la lista/);
});

// ── merge pass 3 (review 2026-11-17) ──

test("probe: a stream whose playlist answered a redirect (supertv's panels: 302 to http://<ip>) is not probed again in this runtime; another stream on the panel is", async () => {
  const stv = fakeSource("supertv", { flags: { blind: true }, name: "SuperTV", resolve: (raw) => ({ url: "https://line.znn8.xyz/live/u/p/" + raw + ".m3u8" }) });
  const ptv = fakeSource("premiumtv", { flags: { blind: true }, name: "Premium TV", resolve: (raw) => ({ url: "https://p.example/" + raw + ".m3u8" }) });
  live._setSources([stv, ptv]);
  const k = await device({ routes: [(u, init) => (init.redirect === "manual" ? res(302, "", { Location: "http://185.227.34.91/live/x.m3u8" }) : undefined)] });
  const out1 = await live.resolveLive("M:supertv:101,premiumtv:201");
  assert.equal(out1.url, "https://line.znn8.xyz/live/u/p/101.m3u8");
  assert.equal(k.requests.length, 1, "the first probe tells the stream redirects");
  // the same stream again (another channel that leads with it, or a later open): played unprobed
  beginCall();
  const out2 = await live.resolveLive("M:supertv:101,premiumtv:202");
  assert.equal(out2.url, "https://line.znn8.xyz/live/u/p/101.m3u8", "the member plays unprobed");
  assert.equal(k.requests.length, 1, "no probe that could only say 'can't tell'");
  // another stream on the same panel and account is still probed (it may be refused: a 407 over the account's limit)
  beginCall();
  await live.resolveLive("M:supertv:102,premiumtv:203");
  assert.equal(k.requests.length, 2);
  // a new runtime asks again
  ls._resetMemory();
  beginCall();
  await live.resolveLive("M:supertv:101,premiumtv:204");
  assert.equal(k.requests.length, 3);
});

test("v.events through Kino's liveChannels: a whole-day event (no end) is still listed 8 h 15 min after its start; a start-only copy stays in its event until the latest stored end", async () => {
  await onClock(async (clock) => {
    const T = clock.now, H = 3600000;
    const nuvio = fakeSource("nuvio-sports", { code: true, cats: [{ id: "tennis", title: "Tennis" }, { id: "cricket", title: "Cricket" }],
      lists: {
        tennis: [{ id: "dlv-atp-d3", title: "LIVE: 2026 Nitto ATP Finals Round Robin, Day 3", start: T - 8.25 * H, origin: "dlv" }],
        cricket: [{ id: "dlv-pak-sl", title: "Pakistan vs Sri Lanka", start: T - 8.25 * H, origin: "dlv" }],
      } });
    const cnc = fakeSource("cncverse", { cats: [{ id: "cnc_PlayFyLiveEvents_tv", title: "PlayFy" }],
      lists: { cnc_PlayFyLiveEvents_tv: [{ id: "playfy-pak-sl", title: "Pakistan vs Sri Lanka", start: T - 8.25 * H, end: T + 0.25 * H, origin: "PlayFy" }] } });
    live._setSources([nuvio, cnc]);
    await device({ routes: [() => res(200, "{}")], storage: storedLive({ registry: { cncverse: [{ id: "cnc_PlayFyLiveEvents_tv", title: "PlayFy" }] } }) });
    const p = await live.liveChannels({ categoryId: "v.events", cursor: null });
    assert.deepEqual(p.items.map((c) => c.title), ["LIVE: 2026 Nitto ATP Finals Round Robin, Day 3", "Pakistan vs Sri Lanka"]);
    assert.deepEqual(membersOf(p.items[1]), ["L:nuvio-sports:dlv-pak-sl", "L:cncverse:playfy-pak-sl"], "dlv's copy (start only) still beside cncverse's");
    // 46 min later the cricket match is over by cncverse's own end; the ATP day is not
    clock.now += 46 * 60000;
    beginCall();
    const q = await live.liveChannels({ categoryId: "v.events", cursor: null });
    assert.deepEqual(q.items.map((c) => c.title), ["LIVE: 2026 Nitto ATP Finals Round Robin, Day 3"]);
  });
});

test("an old futbollibre channel ref that is also an agenda event's (the match on that channel) falls through to the channel's copies, never to other sources' copies of the match", async () => {
  const T = Date.now(), start = T - 20 * 60000;
  const failing = async () => { throw new Error("sin señal"); };
  // futbollibre: "main" (code) lists ESPN and Win Sports 2; its "hoy" agenda plays each match on one of them (same ref)
  const fl = fakeSource("futbollibre", { code: true, codeList: (c) => c === "main", name: "Fútbol Libre",
    cats: [{ id: "hoy", title: { es: "Partidos de hoy", en: "Today's matches" } }, { id: "main", title: { es: "Canales deportivos", en: "Sports channels" } }],
    lists: { main: [ch("espn-tok", "ESPN"), ch("ws2-tok", "Win Sports 2")] }, resolve: failing });
  const hoy = norm("futbollibre", [
    { id: "espn-tok", key: "hoy.e1", title: "Gales vs Portugal — UEFA Nations League", start },
    { id: "ws2-tok", key: "hoy.e2", title: "Atlético Nacional vs Once Caldas — Liga BetPlay", start },
    { id: "ws2-tok", key: "hoy.e3", title: "América de Cali vs Inter Bogotá — Liga BetPlay", start },
    { id: "dup-tok", key: "hoy.e4", title: "Bolivia vs Paraguay — Amistoso", start },
    { id: "dup-tok", key: "hoy.e5", title: "Uruguay vs Ecuador — Amistoso", start },
    { id: "solo-tok", key: "hoy.e6", title: "Chile vs Perú — Amistoso", start },
  ]);
  const dtv = fakeSource("deportv", { name: "DeporTV", cats: [{ id: "today", title: "Hoy" }] });
  const today = norm("deportv", [
    { id: "dtv-gp", title: "Gales vs. Portugal · ESPN 2 (720p) · 19:45 UTC", start },
    { id: "dtv-nac", title: "Atlético Nacional vs. Once Caldas · Win Sports (720p)", start },
    { id: "dtv-bp", title: "Bolivia vs. Paraguay · Tigo Sports (720p)", start },
    { id: "dtv-cp", title: "Chile vs. Perú · Caracol (720p)", start },
  ]);
  const tv = fakeSource("tvenvivo", { code: true, codeList: () => true, name: "TV en Vivo", cats: [{ id: "deportes", title: "Deportes" }], lists: { deportes: [ch("espn", "ESPN"), ch("ws2", "Win Sports 2")] } });
  live._setSources([tv, fl, dtv]);
  await device({ noFetch: true, storage: storedLive({ registry: { deportv: [{ id: "today", title: "Hoy" }] },
    lists: { [key("futbollibre", "hoy")]: { items: hoy }, [key("deportv", "today")]: { items: today } } }) });
  const played = async (ref) => { beginCall(); return (await live.resolveLive(ref)).url; };
  // a 1.0.45 favourite "ESPN" (futbollibre failing): ESPN from tvenvivo, not deportv's ESPN 2 copy of the match on it
  assert.equal(await played("L:futbollibre:espn-tok"), "https://tvenvivo.test/play/espn.m3u8");
  assert.equal(await played("L:futbollibre:ws2-tok"), "https://tvenvivo.test/play/ws2.m3u8", "two matches on Win Sports 2: its channel copy");
  assert.deepEqual(dtv.calls.resolve, [], "no copy of a match played under a channel's name");
  // two matches sharing a ref and no channel listing it: which one the person opened is unknown, so no event copy
  beginCall();
  await assert.rejects(() => live.resolveLive("L:futbollibre:dup-tok"), /no se pudo abrir el canal \(sin señal\)/);
  assert.deepEqual(dtv.calls.resolve, []);
  // a ref that is one event's alone still falls through to that event's copies
  assert.equal(await played("L:futbollibre:solo-tok"), "https://deportv.test/play/dtv-cp.m3u8");
});

// ── Redmi recheck 2026-11-17 (B1): supertv's 407 cost 22 s ──

test("B1: a probe that Kino reports as a network error naming a refusal (OkHttp's 'HTTP_PROXY_AUTH (407)') is dead: the next copy plays at the first open", async () => {
  const stv = fakeSource("supertv", { flags: { blind: true }, name: "SuperTV", resolve: (raw) => ({ url: "https://line.znn8.xyz/live/" + raw + "/1.m3u8" }) });
  live._setSources([stv]);
  const ref = "M:supertv:u1,supertv:u2";
  const proxyAuth = () => Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" });
  await device({ routes: [(u) => (u.includes("/live/u1/") ? proxyAuth() : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive(ref)).url, "https://line.znn8.xyz/live/u2/1.m3u8");
  assert.ok(ls.demotedAt("L:supertv:u1") > 0);
  // a network error with no status (TLS, reset) still cannot tell: it plays
  await device({ routes: [() => Object.assign(new Error("network error: SSLHandshakeException"), { code: "network" })] });
  assert.equal((await live.resolveLive(ref)).url, "https://line.znn8.xyz/live/u1/1.m3u8");
  // a status left open (429: busy) in the message is not a refusal either
  await device({ routes: [() => Object.assign(new Error("network error: Too many requests (429)"), { code: "network" })] });
  assert.equal((await live.resolveLive(ref)).url, "https://line.znn8.xyz/live/u1/1.m3u8");
});

test("B1: a redirect is remembered per stream: on the one supertv account, a neighbour's 302 never hides another stream's 407", async () => {
  const stv = fakeSource("supertv", { flags: { blind: true }, name: "SuperTV", resolve: (raw) => ({ url: "https://line.znn8.xyz/live/U/P/" + raw + ".m3u8" }) });
  live._setSources([stv]);
  const proxyAuth = () => Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" });
  const k = await device({ routes: [(u) => (u.endsWith("/897426.m3u8") ? proxyAuth() : res(302, "", { Location: "http://185.227.34.91/x.m3u8" }))] });
  // the neighbour (another channel on the same account) is preheated first and redirects
  await live.resolveLive("M:supertv:500,supertv:501");
  assert.equal(k.requests.length, 1);
  beginCall();
  const out = await live.resolveLive("M:supertv:897426,supertv:897427,supertv:897428");
  assert.equal(out.url, "https://line.znn8.xyz/live/U/P/897427.m3u8", "the refused member is caught at the first open");
  beginCall();
  await live.resolveLive("M:supertv:500,supertv:501");
  assert.equal(k.requests.length, 3, "the stream that redirected is not probed again (2 probes for M+ Deportes)");
});

test("B1: Kino's zapping preheat re-resolving the channel just left (no cut) never demotes its healthy member, probeable or not", async () => {
  const ptv = fakeSource("premiumtv", { flags: { blind: true }, name: "Premium TV", resolve: (raw) => ({ url: "http://1.2.3.4:8000/play/" + raw, mime: "video/mp2t" }) });
  live._setSources([ptv, fakeSource("tvenvivo")]);
  await device({ routes: [() => res(200, PLAYLIST)] });
  const A = "M:premiumtv:a1,tvenvivo:a2";
  await onClock(async (clock) => {
    beginCall();
    assert.equal((await live.resolveLive(A)).url, "http://1.2.3.4:8000/play/a1");
    clock.now += 6_000;   // the person zapped to B 4 s in; B's preheat resolves A (its previous neighbour) 2 s later
    beginCall();
    assert.equal((await live.resolveLive(A)).url, "http://1.2.3.4:8000/play/a1", "the same member, not the next one");
    assert.equal(ls.demotedAt("L:premiumtv:a1"), 0, "not demoted");
  });
});
