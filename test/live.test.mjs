// src/live.js + src/liveStore.js + src/liveGate.js, with a fake Kino (same runtime across calls: node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";
import { tilesOf, channelsOf } from "./helpers/tiles.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const { hexEnc } = await import("../src/liveMap.js");
const ls = await import("../src/liveStore.js");
const gate = await import("../src/liveGate.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { screen, screenEvent } = await import("../src/screen.js");
const { liveRef } = await import("../src/refs.js");

const M = 60_000, H = 60 * M, D = 24 * H;
const sha16 = (t) => createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);

// ── helpers ──

/** A device: a fresh fake Kino (with a Bearer unless `bearer: false`), a cold live memory, and a new call. */
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

/** A fake connector. `cats` raw categories; `lists[cat]` = channels or a function (n) → channels; host `<id>.test`. */
function fakeSource(id, o = {}) {
  const calls = { categories: 0, channels: [], resolve: [] };
  const host = `https://${id}.test`;
  return {
    id, name: id, genre: "otros",
    codeCategories: !!o.code,
    ...(o.codeList ? { codeList: o.codeList } : {}),
    ...(o.listTtl ? { listTtl: o.listTtl } : {}),
    calls,
    async categories(ctx) {
      calls.categories++;
      if (o.code) return o.cats || [];
      const r = await ctx.fetch(host + "/cats", { timeoutMs: o.catTimeout || 8000 });
      if (!r.ok) throw new Error("cats " + r.status);
      return o.cats || [];
    },
    async channels(cat, ctx) {
      calls.channels.push(cat);
      if (o.channels) return o.channels(cat, ctx, calls);
      if (o.codeList && o.codeList(cat)) return (o.lists && o.lists[cat]) || [];
      const r = await ctx.fetch(host + "/list/" + encodeURIComponent(cat), { timeoutMs: 8000 });
      if (!r.ok) throw new Error("list " + r.status);
      const l = o.lists && o.lists[cat];
      return typeof l === "function" ? l(calls.channels.length) : (l || []);
    },
    async resolve(ch, ctx) {
      calls.resolve.push(ch);
      if (o.resolve) return o.resolve(ch, ctx);
      return { url: `${host}/play/${ch}.m3u8` };
    },
  };
}

const chans = (n, prefix = "c") => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, title: `Canal ${i}`, logo: `https://l/${i}.png` }));
const hostOf = (u) => { try { return new URL(u).host; } catch (_) { return ""; } };
const okRoute = (url) => (/\.test\//.test(url) ? res(200, "{}") : undefined);

/** Storage for a stored registry + lists, written exactly as liveStore writes them. */
function storedLive({ registry = {}, catAt = {}, lists = {} } = {}) {   // lists: { key: { items, at, w? } }
  const now = Date.now();
  const st = {};
  const lc = { v: 1, src: {} };
  const lm = { v: 1, c: {}, l: {} };
  for (const [src, cats] of Object.entries(registry)) {
    lc.src[src] = { at: catAt[src] != null ? catAt[src] : now, cats };
    lm.c[src] = { at: catAt[src] != null ? catAt[src] : now, failAt: 0, failN: 0 };
  }
  for (const [key, { items, at, w }] of Object.entries(lists)) {
    const text = JSON.stringify(items);
    st["o2:ll:" + key] = text;
    const t = at != null ? at : now;
    lm.l[key] = { at: t, h: sha16(text), n: items.length, w: w != null ? w : t, failAt: 0, failN: 0 };
  }
  st["o2:lc"] = JSON.stringify(lc);
  st["o2:lm"] = JSON.stringify(lm);
  return st;
}
const stored = (srcId, raw) => live.normalizeChannels(srcId, raw);

/**
 * Runs `fn(after)` on a virtual clock: `Date.now` stands still while promises settle and moves only to the next
 * `after(ms, value)` (a promise that resolves `ms` later), earliest first, ties in the order they were asked. So a
 * test that measures the gate's deadline orders its events by the clock, never by the machine's load.
 */
async function onVirtualClock(fn) {
  const realNow = Date.now;
  let now = realNow();
  let seq = 0;
  const pending = [];
  Date.now = () => now;
  const after = (ms, value) => new Promise((resolve) => pending.push({ at: now + ms, seq: seq++, fire: () => resolve(value) }));
  try {
    let done = false, out, err;
    const p = Promise.resolve().then(() => fn(after)).then((v) => { done = true; out = v; }, (e) => { done = true; err = e; });
    while (!done) {
      await new Promise((r) => setImmediate(r));   // every promise that can settle now settles first
      if (done) break;
      if (!pending.length) throw new Error("virtual clock: stuck (nothing pending)");
      pending.sort((a, b) => a.at - b.at || a.seq - b.seq);
      const e = pending.shift();
      now = Math.max(now, e.at);
      e.fire();
    }
    await p;
    if (err) throw err;
    return out;
  } finally { Date.now = realNow; }
}

test.afterEach(() => live._setSources(null));

// ── identity: exactly 1.0.43's ids (favourites and remembered categories depend on them) ──

test("ids are 1.0.43's: category `<src>.<hex>`, channel `<src>_<hashId>`, ref `L:<src>:<raw>`", () => {
  // Reference values computed with `git show 2687323:src/catalog.js` (1.0.43's hexEnc / catEntry / hashId). A raw
  // category's 1.0.43 id is its stored list's key (and its id when it passes through the mapping unmapped).
  assert.equal(live.listKey("futbollibre", "main"), "futbollibre.6d61696e");
  assert.equal(live.listKey("tvenvivo", "deportes"), "tvenvivo.6465706f72746573");
  assert.equal(live.listKey("premiumtv", "Películas Ñ"), "premiumtv.50656c25433325414463756c6173253230254333253931");
  assert.equal(live.hashId("liga-1"), "nhh3mi");
  assert.equal(live.hashId("http://x/a:b.m3u8"), "1xrz10");
  assert.equal(live.hexDec(hexEnc("Películas Ñ")), "Películas Ñ");
  const [c] = live.normalizeChannels("premiumtv", [{ id: "http://x/a:b.m3u8", title: "A" }]);
  assert.deepEqual(c, { id: "premiumtv_1xrz10", title: "A", ref: liveRef("premiumtv", "http://x/a:b.m3u8") });
  // a stable key changes the id only, never the ref
  const [k] = live.normalizeChannels("nuvio-sports", [{ id: "cdn_ch_es_abc", key: "abc", title: "B" }]);
  assert.equal(k.id, "nuvio-sports_" + live.hashId("abc"));
  assert.equal(k.ref, "L:nuvio-sports:cdn_ch_es_abc");
});

test("the old seams answer through the mapping: an old `<src>.<hex>` id still lists its own channels, unmerged", async () => {
  const src = fakeSource("xuper", { lists: { "31": [{ id: "a", title: "Caracol HD" }, { id: "b", title: "Caracol SD" }] } });
  live._setSources([src]);
  await device({ routes: [okRoute], storage: storedLive({ registry: { xuper: [{ id: "31", title: "Colombia" }] } }) });
  assert.deepEqual((await live.liveCategories()).map((c) => c.id), ["v.co"], "the raw category went into Colombia");
  assert.equal(await live.exposedIdOf("xuper.3331"), "v.co", "a remembered raw id lands on its virtual category");
  const old = await live.liveChannels({ categoryId: "xuper.3331" });
  assert.deepEqual(old.items.map((c) => c.ref), ["L:xuper:a", "L:xuper:b"], "the old id: 1.0.45's list, one channel per raw channel");
  beginCall();
  const merged = await live.liveChannels({ categoryId: "v.co" });
  assert.deepEqual(merged.items.map((c) => c.ref), ["M:xuper:a,xuper:b"], "v.co merges the HD and SD copies");
  assert.equal(merged.items[0].id, "xuper_" + live.hashId("a"));
  assert.equal(src.calls.channels.length, 1, "one list fetch serves both");
});

// ── no Bearer: exactly 1.0.43 (quiet [], never a throw, no request) ──

test("no Bearer → liveCategories [] and liveChannels [] (as 1.0.43), no request, no throw", async () => {
  const { requests } = await device({ bearer: false, noFetch: true });
  const plugin = await import("../src/plugin.js");
  assert.deepEqual(await plugin.liveCategories(), []);
  assert.deepEqual(await plugin.liveChannels({ categoryId: "tvenvivo.6465706f72746573", cursor: null }), []);
  assert.equal(requests.length, 0);
});

// ── categories ──

test("the real code-only sources answer with 0 requests on a first install; each network source is asked once", async () => {
  const k = await device({ routes: [() => Object.assign(new Error("offline"), { code: "network" })] });
  const cats = await live.liveCategories();
  const entries = await live.categoryList();
  const srcs = new Set(entries.flatMap((e) => e.members.map((m) => m.src)));
  for (const s of ["tvenvivo", "caracol", "cablevisionhd", "futbollibre", "nuvio-sports"]) assert.ok(srcs.has(s), s + " missing");
  assert.ok(!srcs.has("cncverse-tv"), "cncverse-tv is gone (owner, 2026-11-16)");
  assert.equal(cats[0].id, "v.co", "Colombia first (tvenvivo + caracol: code)");
  assert.ok(entries.find((e) => e.id === "v.sports").members.some((m) => m.src === "futbollibre" && m.rawCat === "main"));
  const perHost = {};
  for (const r of k.requests) perHost[hostOf(r.url)] = (perHost[hostOf(r.url)] || 0) + 1;
  for (const [h, n] of Object.entries(perHost)) assert.equal(n, 1, h + " asked " + n + " times");
  assert.ok(k.requests.length >= 4 && k.requests.length <= 6, "one request per network source: " + JSON.stringify(perHost));
  for (const r of k.requests) assert.ok(r.timeoutMs >= 1000 && r.timeoutMs <= 4000, "first-ever timeout " + r.timeoutMs);
  // the next call: the failed sources are inside their 10 min backoff → 0 requests
  beginCall();
  const n = k.requests.length;
  await live.liveCategories();
  assert.equal(k.requests.length, n);
});

test("stored registry → liveCategories makes 0 requests and 0 storage writes", async () => {
  const code = fakeSource("tvenvivo", { code: true, cats: [{ id: "deportes", title: "Deportes" }] });
  const net = fakeSource("xuper", { cats: [] });
  live._setSources([code, net]);
  const k = await device({ noFetch: true, storage: storedLive({ registry: { xuper: [{ id: "31", title: "Colombia" }, { id: "9", title: "XXX", adult: true }] }, catAt: { xuper: Date.now() - 3 * D } }) });
  const cats = await live.liveCategories();
  assert.deepEqual(cats, [
    { id: "v.co", title: "Colombia", genre: "otros", country: "CO" },
    { id: "v.sports", title: "Deportes", genre: "deportes" },
    { id: "v.adult", title: "Adultos", adult: true, genre: "otros" },
  ]);
  assert.equal(net.calls.categories, 0, "stale (3 d) but within 7 d: served, refreshed only as a side effect of a list fetch");
  assert.equal(k.requests.length, 0);
  assert.deepEqual(k.writes, []);
});

test("cold: each network source's categories run once per call, stored per source as each completes", async () => {
  const fast = fakeSource("caracol", { cats: [{ id: "all", title: "Canales" }], lists: { all: chans(3) } });
  const down = fakeSource("deportv", { cats: [{ id: "hoy", title: "Hoy" }] });
  live._setSources([fast, down]);
  const k = await device({ routes: [(url) => (url.startsWith("https://deportv.test") ? res(503, "") : res(200, "{}"))] });
  const cats = await live.liveCategories();
  assert.deepEqual(cats.map((c) => c.id), ["v.co"], "caracol's one category goes into Colombia");
  assert.equal(fast.calls.categories, 1);
  assert.equal(down.calls.categories, 1);
  assert.deepEqual(JSON.parse(k.store.get("o2:lc")).src.caracol.cats, [{ id: "all", title: "Canales" }]);
  assert.ok(JSON.parse(k.store.get("o2:lm")).c.deportv.failAt > 0, "the failure is recorded (10 min backoff)");
  // same call: a list fetch of caracol does not run its categories again (single flight)
  await live.liveChannels({ categoryId: "caracol." + hexEnc("all") });
  assert.equal(fast.calls.categories, 1);
});

test("budget: ≤ 90 in all, unknown titles pass through (6 per source, 24 for xuper), the rest in a bucket; logged once", async () => {
  const mk = (n, p = "") => Array.from({ length: n }, (_, i) => ({ id: p + i, title: "T" + p + i }));
  const srcs = [
    fakeSource("tvenvivo", { code: true, cats: mk(11) }),
    fakeSource("premiumtv", { code: true, cats: mk(60) }),
    fakeSource("supertv", { code: true, cats: [...mk(40), { id: "3", title: "dup" }] }),
    fakeSource("cncverse", { code: true, cats: mk(5) }),
    fakeSource("xuper", { code: true, cats: mk(200) }),
  ];
  live._setSources(srcs);
  const k = await device({ noFetch: true });
  const cats = await live.liveCategories();
  assert.ok(cats.length <= 90, String(cats.length));
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length, "no duplicate ids");
  const count = (s) => cats.filter((c) => c.id.startsWith(s + ".")).length;
  assert.equal(count("tvenvivo"), 6);
  assert.equal(count("premiumtv"), 6);
  assert.equal(count("xuper"), 24);
  assert.equal(count("cncverse"), 0, "every cncverse category is a live event");
  assert.ok(cats.some((c) => c.id === "v.events"));
  assert.ok(cats.some((c) => c.id === "v.sp.world"), "supertv's unprefixed categories: international sports");
  for (const s of ["tvenvivo", "premiumtv", "xuper"]) assert.ok(cats.some((c) => c.id === "v.more." + s), s + " bucket");
  const entries = await live.categoryList();
  const members = entries.flatMap((e) => e.members.map((m) => m.src + ":" + m.rawCat));
  assert.equal(members.length, 11 + 60 + 40 + 5 + 200, "every raw category is in exactly one exposed category");
  assert.equal(new Set(members).size, members.length);
  assert.equal(k.logs.filter((l) => /live: categories: \d+ exposed/.test(l)).length, 1, k.logs.join("\n"));
  beginCall();
  await live.liveCategories();
  assert.equal(k.logs.filter((l) => /live: categories: \d+ exposed/.test(l)).length, 1, "logged once per change");
});

test("the index kill switch (live.off) hides a source from categories, channels and resolve", async () => {
  const a = fakeSource("caracol", { code: true, cats: [{ id: "all", title: "A" }], codeList: () => true, lists: { all: chans(2) } });
  const b = fakeSource("tvenvivo", { code: true, cats: [{ id: "x", title: "B" }], codeList: () => true, lists: { x: chans(2) } });
  live._setSources([a, b]);
  const ix = JSON.stringify({ schema: 2, live: { off: ["caracol"] } });
  await device({ noFetch: true, storage: { "o2:ix": ix } });
  assert.deepEqual((await live.liveCategories()).map((c) => c.id), ["tvenvivo." + hexEnc("x")]);
  assert.deepEqual(await live.liveChannels({ categoryId: "caracol." + hexEnc("all") }), []);
  await assert.rejects(() => live.resolveLive("L:caracol:c0"), /fuente de canal desconocida/);
});

// ── the gate: ≤ 5 in flight, clamped timeouts, nothing after the deadline ──

test("gate: at most 5 requests in flight; timeoutMs = clamp(deadline − now, 1000, 4000); none started past the deadline", async () => {
  // every request answers 60 ms after it starts; the deadline is 100 ms away (a virtual clock: no machine load can
  // stretch the first wave past it)
  const { k, results, starts } = await onVirtualClock(async (after) => {
    const starts = [];
    const k = await device({ routes: [() => { starts.push(Date.now()); return after(60, res(200, "{}")); }] });
    const t0 = Date.now();
    gate.tighten({ deadline: t0 + 100, maxTimeoutMs: 4000 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
      gate.liveFetch("https://h" + i + ".test/x", { timeoutMs: 15000 }).then(() => "ok", (e) => e.code)));
    return { k, results, starts: starts.map((t) => t - t0) };
  });
  assert.deepEqual(starts, [0, 0, 0, 0, 0, 60, 60, 60, 60, 60], "a wave of 5, then the next 5 as places free up");
  const stats = gate._gateStats();
  assert.ok(stats.peak <= gate.MAX_IN_FLIGHT, "peak " + stats.peak);
  assert.equal(results.filter((x) => x === "ok").length, 10, "two waves of 5 before the deadline");
  assert.equal(results.filter((x) => x === "deadline").length, 2, "the rest never start");
  assert.equal(k.requests.length, 10);
  for (const r of k.requests) assert.equal(r.timeoutMs, 1000, "clamped up to the 1 s floor near the deadline");
  // a fresh call has its own gate
  beginCall();
  assert.ok(gate.timeoutFor(15000) <= 15000 && gate.timeoutFor(15000) > 4000);
  gate.tighten({ maxTimeoutMs: 4000 });
  assert.equal(gate.timeoutFor(15000), 4000);
});

test("first-ever aggregation: a slow source stops at the deadline, the fast ones are already stored", async () => {
  const fast = fakeSource("caracol", { cats: [{ id: "all", title: "A" }] });
  const slow = fakeSource("xuper", {
    channels: () => [],
    cats: [{ id: "1", title: "never" }],
  });
  // xuper's categories need two sequential requests, each answering after 80 ms
  slow.categories = async (ctx) => { slow.calls.categories++; await ctx.fetch("https://xuper.test/a"); await ctx.fetch("https://xuper.test/b"); return [{ id: "1", title: "late" }]; };
  live._setSources([fast, slow]);
  const { k, cats } = await onVirtualClock(async (after) => {
    const k = await device({ routes: [(url) => after(url.includes("xuper") ? 80 : 5, res(200, "{}"))] });
    return { k, cats: await live.categoryList({ fill: { deadlineMs: 50, maxTimeoutMs: 4000 } }) };
  });
  ls.flushMeta();
  assert.deepEqual(cats.flatMap((c) => c.members.map((m) => m.src)), ["caracol"]);
  assert.ok(k.store.get("o2:lc").includes('"caracol"'));
  assert.ok(!k.store.get("o2:lc").includes('"xuper"'));
  assert.equal(k.requests.filter((r) => r.url.includes("xuper")).length, 1, "the second xuper request was never started");
});

// ── lists ──

test("liveChannels: pages of 500 with next `<h8>:<offset>`, Kino-ready items with categoryId", async () => {
  const src = fakeSource("supertv", { lists: { "7": chans(1203) } });
  live._setSources([src]);
  const k = await device({ routes: [okRoute], storage: storedLive({ registry: { supertv: [{ id: "7", title: "Deportes" }] } }) });
  const cat = "supertv." + hexEnc("7");
  const p1 = await live.liveChannels({ categoryId: cat, cursor: null });
  assert.equal(p1.items.length, 500);
  assert.match(p1.next, /^[0-9a-f]{8}:500$/);
  assert.deepEqual(p1.items[0], { id: "supertv_" + live.hashId("c0"), title: "Canal 0", ref: "L:supertv:c0", categoryId: cat, logo: "https://l/0.png" });
  beginCall();
  const p2 = await live.liveChannels({ categoryId: cat, cursor: p1.next });
  assert.equal(p2.items[0].title, "Canal 500");
  assert.equal(p2.next, p1.next.split(":")[0] + ":1000");
  beginCall();
  const p3 = await live.liveChannels({ categoryId: cat, cursor: p2.next });
  assert.equal(p3.items.length, 203);
  assert.equal(p3.next, null);
  assert.equal(src.calls.channels.length, 1, "pages 2 and 3 come from the stored list");
  assert.ok(k.store.get("o2:ll:" + cat), "stored under o2:ll:<src>.<hex>");
});

test("a stale list is refreshed only on the first page (cursor null); a changed hash keeps the offset", async () => {
  let version = 0;
  const src = fakeSource("supertv", { lists: { "7": () => chans(1100, "v" + version + "_") } });
  live._setSources([src]);
  const cat = "supertv." + hexEnc("7");
  const key = cat;
  await device({ routes: [okRoute], storage: storedLive({ registry: { supertv: [{ id: "7", title: "D" }] },
    lists: { [key]: { items: stored("supertv", chans(1100, "v0_")), at: Date.now() - 7 * H } } }) });
  version = 1;
  const p2 = await live.liveChannels({ categoryId: cat, cursor: "deadbeef:500" });
  assert.equal(src.calls.channels.length, 0, "a later page never refreshes (offsets would shift)");
  assert.equal(p2.items[0].title, "Canal 500");
  beginCall();
  const p1 = await live.liveChannels({ categoryId: cat, cursor: null });
  assert.equal(src.calls.channels.length, 1, "the first page refreshes the stale list");
  assert.equal(p1.items[0].ref, "L:supertv:v1_0");
  beginCall();
  const again = await live.liveChannels({ categoryId: cat, cursor: "deadbeef:1000" });
  assert.equal(again.items.length, 100, "an old cursor's offset still applies to the new list");
  assert.equal(again.items[0].ref, "L:supertv:v1_1000");
});

test("stale-if-error: a failed refresh serves the stored list and backs off; nothing stored → it throws (with a Bearer)", async () => {
  const src = fakeSource("supertv", { lists: { "7": chans(3) } });
  live._setSources([src]);
  const cat = "supertv." + hexEnc("7");
  const k = await device({ routes: [() => res(500, "")], storage: storedLive({ registry: { supertv: [{ id: "7", title: "D" }, { id: "8", title: "E" }] },
    lists: { [cat]: { items: stored("supertv", chans(2, "old")), at: Date.now() - 7 * H } } }) });
  const r = await live.liveChannels({ categoryId: cat });
  assert.deepEqual(r.items.map((c) => c.ref), ["L:supertv:old0", "L:supertv:old1"]);
  assert.ok(JSON.parse(k.store.get("o2:lm")).l[cat].failAt > 0);
  beginCall();
  await live.liveChannels({ categoryId: cat });
  assert.equal(src.calls.channels.length, 1, "inside the 10 min backoff: no new attempt");
  beginCall();
  await assert.rejects(() => live.liveChannels({ categoryId: "supertv." + hexEnc("8") }), (e) => e.code === "unavailable");
});

test("an unchanged list is not rewritten (only the batched meta moves); a changed one is", async () => {
  let items = chans(5);
  const src = fakeSource("caracol", { lists: { all: () => items } });
  live._setSources([src]);
  const cat = "caracol." + hexEnc("all");
  const k = await device({ routes: [okRoute], storage: storedLive({ registry: { caracol: [{ id: "all", title: "A" }] },
    lists: { [cat]: { items: stored("caracol", chans(5)), at: Date.now() - 2 * D } } }) });
  await live.liveChannels({ categoryId: cat });
  assert.equal(src.calls.channels.length, 1);
  assert.deepEqual(k.writes, ["o2:lm"], "same sha1: no list write, one meta write");
  items = chans(6);
  ls._resetMemory();
  beginCall();
  await live.loadList(cat, { force: true });
  assert.deepEqual(k.writes, ["o2:lm", "o2:ll:" + cat, "o2:lm"]);
});

test("an unchanged list is written again once its text is a max-stale old (TTL renewal), by a refetch or by a 304", async () => {
  // caracol lists: fresh 24 h / max-stale 7 d → the text's TTL (3 × 7 d) is renewed once it was written ≥ 7 d ago, so a
  // list checked now stays at least 14 d (past max-stale it is overdue, served stale and refreshed first).
  const items = chans(5);
  let mode = "full";
  const src = fakeSource("caracol", { channels: (cat, ctx) => (mode === "304" ? ctx.UNCHANGED : items) });
  live._setSources([src]);
  const cat = "caracol." + hexEnc("all");
  const old = Date.now() - 8 * D;
  const k = await device({ routes: [okRoute], storage: storedLive({ registry: { caracol: [{ id: "all", title: "A" }] },
    lists: { [cat]: { items: stored("caracol", items), at: Date.now() - 2 * D, w: old } } }) });
  await live.liveChannels({ categoryId: cat });
  assert.deepEqual(k.writes, ["o2:ll:" + cat, "o2:lm"], "same sha1, written 8 d ago: renewed once");
  assert.ok(JSON.parse(k.store.get("o2:lm")).l[cat].w > old);

  // the same by a 304: touchList rewrites the stored text when its renewal is due
  const lm = JSON.parse(k.store.get("o2:lm"));
  lm.l[cat].w = old; lm.l[cat].at = Date.now() - 2 * D;
  k.store.set("o2:lm", JSON.stringify(lm));
  mode = "304";
  ls._resetMemory();
  beginCall();
  k.writes.length = 0;
  await live.liveChannels({ categoryId: cat });
  assert.deepEqual(k.writes, ["o2:ll:" + cat, "o2:lm"], "a 304 renews the text too");
  // and right after, nothing more (not due again for 7 d)
  ls._resetMemory();
  beginCall();
  k.writes.length = 0;
  const lm2 = JSON.parse(k.store.get("o2:lm"));
  lm2.l[cat].at = Date.now() - 2 * D;
  k.store.set("o2:lm", JSON.stringify(lm2));
  k.writes.length = 0;
  await live.liveChannels({ categoryId: cat });
  assert.deepEqual(k.writes, ["o2:lm"]);
});

test("UNCHANGED (a 304 upstream) keeps the stored list; putList stores siblings; setCats refreshes categories", async () => {
  let mode = "full";
  const src = fakeSource("premiumtv", {
    channels: (cat, ctx) => {
      if (mode === "304") { ctx.touchAll(); return ctx.UNCHANGED; }
      ctx.setCats([{ id: "News", title: "News" }, { id: "Kids", title: "Kids" }]);
      ctx.putList("Kids", [{ id: "k1", title: "Kid 1", x: { ua: "UA" } }]);
      return [{ id: "n1", title: "News 1" }];
    },
  });
  live._setSources([src]);
  const k = await device({ noFetch: true, storage: storedLive({ registry: { premiumtv: [{ id: "News", title: "News" }] }, catAt: { premiumtv: Date.now() - 10 * H } }) });
  const news = "premiumtv." + hexEnc("News"), kids = "premiumtv." + hexEnc("Kids");
  await live.liveChannels({ categoryId: news });
  assert.equal(src.calls.categories, 0, "the connector set its categories from the list response: no separate fetch");
  assert.deepEqual(JSON.parse(k.store.get("o2:lc")).src.premiumtv.cats.map((c) => c.id), ["News", "Kids"]);
  beginCall();
  const kidsPage = await live.liveChannels({ categoryId: kids });
  assert.equal(src.calls.channels.length, 1, "the sibling list was stored by the first fetch");
  assert.deepEqual(kidsPage.items, [{ id: "premiumtv_" + live.hashId("k1"), title: "Kid 1", ref: "L:premiumtv:k1", categoryId: kids }], "x stays private");
  assert.deepEqual(JSON.parse(k.store.get("o2:ll:" + kids))[0].x, { ua: "UA" });
  mode = "304";
  beginCall();
  const again = await live.loadList(news, { force: true });
  assert.equal(again, true);
  assert.equal(JSON.parse(k.store.get("o2:lm")).l[news].h, sha16(k.store.get("o2:ll:" + news)));
});

test("a network source's stale categories ride along a list fetch (one extra request in that call)", async () => {
  const src = fakeSource("xuper", { cats: [{ id: "31", title: "Colombia" }, { id: "40", title: "Nueva" }], lists: { "31": chans(2) } });
  live._setSources([src]);
  const k = await device({ routes: [okRoute], storage: storedLive({ registry: { xuper: [{ id: "31", title: "Colombia" }] }, catAt: { xuper: Date.now() - 2 * D } }) });
  await live.liveChannels({ categoryId: "xuper.3331" });
  assert.equal(src.calls.categories, 1);
  assert.deepEqual(k.requests.map((r) => r.url), ["https://xuper.test/list/31", "https://xuper.test/cats"]);
  beginCall();
  assert.deepEqual((await live.liveCategories()).map((c) => c.title), ["Colombia", "Nueva"]);
});

test("18+: an adult category is marked for Kino, its channels carry adult, and the screen's dropdown leaves it out", async () => {
  const src = fakeSource("xuper", { lists: { "9": chans(2) } });
  live._setSources([src]);
  await device({ routes: [okRoute], storage: storedLive({ registry: { xuper: [{ id: "31", title: "Colombia" }, { id: "9", title: "Adultos", adult: true }] } }) });
  assert.equal((await live.liveCategories()).find((c) => c.id === "v.adult").adult, true);
  const page = await live.liveChannels({ categoryId: "v.adult" });
  assert.ok(page.items.length && page.items.every((c) => c.adult === true));
  const old = await live.liveChannels({ categoryId: "xuper.39" });
  assert.ok(old.items.every((c) => c.adult === true), "the old raw id keeps its adult flag");
  const { cats } = await live.screenCategories("vivo");
  assert.deepEqual(cats.map((c) => c.id), ["v.co"]);
});

test("L0 keeps at most 2,000,000 characters of lists", async () => {
  await device({ noFetch: true });
  const big = Array.from({ length: 6000 }, (_, i) => ({ id: "s_" + i, title: "x".repeat(60), ref: "L:s:" + i }));
  for (let i = 0; i < 8; i++) ls.putList("s." + i, big, { maxStaleMs: D });
  const st = ls._l0Stats();
  assert.ok(st.chars <= ls.L0_MAX_CHARS, "L0 " + st.chars);
  assert.ok(st.entries < 8, "the oldest lists were evicted");
  assert.ok(ls.getList("s.0"), "an evicted list is read back from storage");
});

test("stale-write guard: a list stored by a later runtime after this call began is not overwritten", async () => {
  const k = await device({ noFetch: true });
  const later = storedLive({ lists: { "s.1": { items: [{ id: "s_n", title: "new", ref: "L:s:n" }], at: Date.now() + 5000 } } });
  for (const [kk, v] of Object.entries(later)) k.store.set(kk, v);
  const r = ls.putList("s.1", [{ id: "s_o", title: "old", ref: "L:s:o" }], { maxStaleMs: D });
  assert.equal(r.items[0].title, "new");
  assert.equal(JSON.parse(k.store.get("o2:ll:s.1"))[0].title, "new");
});

test("stale-write guard, written behind: a list a resolve stored never goes over the copy a later runtime stored before the flush", async () => {
  const later = () => storedLive({ lists: { "s.1": { items: [{ id: "s_n", title: "new", ref: "L:s:n" }], at: Date.now() + 5000 } } });
  const OLD = [{ id: "s_o", title: "old", ref: "L:s:o" }];
  // the flush: the later runtime's entry is newer, so its text stays with its meta
  const k = await device({ noFetch: true });
  ls.deferWrites();
  ls.putList("s.1", OLD, { maxStaleMs: D });
  assert.equal(k.store.get("o2:ll:s.1"), undefined, "a resolve writes nothing");
  for (const [kk, v] of Object.entries(later())) k.store.set(kk, v);
  beginCall();
  ls.flushMeta();
  assert.equal(JSON.parse(k.store.get("o2:ll:s.1"))[0].title, "new");
  assert.equal(JSON.parse(k.store.get("o2:lm")).l["s.1"].h, sha16(k.store.get("o2:ll:s.1")), "the stored meta labels the stored text");
  // another resolve in between (the zapping preheat) takes the later runtime's copy, not the text left unwritten
  const k2 = await device({ noFetch: true });
  ls.deferWrites();
  ls.putList("s.1", OLD, { maxStaleMs: D });
  for (const [kk, v] of Object.entries(later())) k2.store.set(kk, v);
  beginCall();
  ls.deferWrites();
  assert.equal(ls.getList("s.1").items[0].title, "new");
  beginCall();
  ls.flushMeta();
  assert.equal(JSON.parse(k2.store.get("o2:ll:s.1"))[0].title, "new");
});

// ── resolve ──

test("resolveLive: the connector resolves with its ctx; siblings are tried when the first ref fails", async () => {
  const a = fakeSource("caracol", { code: true, resolve: () => { throw new Error("geo"); } });
  const b = fakeSource("tvenvivo", { code: true });
  live._setSources([a, b]);
  await device({ noFetch: true });
  await assert.rejects(() => live.resolveLive("L:caracol:1"), /no se pudo abrir el canal \(geo\)/);
  beginCall();
  const out = await live.resolveLive("L:caracol:1", ["L:tvenvivo:espn"]);
  // several candidates: the one played is labelled and the others are listed as lazy alternatives
  assert.deepEqual(out, { url: "https://tvenvivo.test/play/espn.m3u8", mime: "application/vnd.apple.mpegurl", label: "tvenvivo",
    alternatives: [{ label: "caracol", ref: "L:caracol:1" }] });
});

test("a connector finds its own stored channel (with x) by raw id; relist forces a fresh list in the same call", async () => {
  let n = 0;
  const src = fakeSource("caracol", {
    lists: { all: () => [{ id: "77", title: "Caracol", x: { assetId: "a" + (++n) } }] },
    resolve: async (ch, ctx) => {
      const hit = ctx.findChannel(ch);
      assert.equal(hit.cat, "all");
      const again = await ctx.relist("all", { force: true });
      assert.equal(ctx.rawIdOf(again[0]), "77");
      return { url: "https://p/" + hit.x.assetId + "/" + again[0].x.assetId };
    },
  });
  live._setSources([src]);
  await device({ routes: [okRoute], storage: storedLive({ registry: { caracol: [{ id: "all", title: "A" }] } }) });
  await live.loadList("caracol." + hexEnc("all"));
  beginCall();
  assert.equal((await live.resolveLive("L:caracol:77")).url, "https://p/a1/a2");
});

// ── the own screen: Vivo and Fútbol ▸ Canales ──

function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn);
}
const byKey = (tree, key) => { let out; walk(tree, (n) => { if (!out && n.key === key) out = n; }); return out; };
const timersOf = (v) => (Array.isArray(v.every) ? v.every : v.every ? [v.every] : []).map((t) => t.event);

test("screen Vivo on a first install: code-only categories, Colombia landing, 0 requests; lcFill one-shot tick", async () => {
  const k = await device({ noFetch: true });
  const nav = await screenEvent({ name: "nav", value: "vivo", state: {} });
  assert.deepEqual(nav, { state: { nav: "vivo" }, ui: [{ hide: "busy" }] });
  beginCall();
  const v = await screen({ state: { nav: "vivo" } });
  const dd = byKey(v, "liveCat");
  assert.equal(dd.value, "v.co");
  assert.deepEqual(dd.onChanged, { ui: [{ show: "busy" }], event: "liveCat" });
  assert.ok(dd.options.some((o) => o.value === "v.sports") && dd.options.some((o) => o.value === "v.events"));
  assert.ok(tilesOf(v, "vivo").length > 0, "tvenvivo's Colombia list is code");
  // caracol's list (Colombia's other member) is not stored yet: the one-shot lvRefresh loads it
  assert.deepEqual(timersOf(v), ["lvRefresh", "lcFill"], "network sources not listed yet; Colombia paints from code, loads the rest");
  assert.equal(k.requests.length, 0);
  beginCall();
  const v2 = await screen({ state: { nav: "vivo", lcTried: true } });
  assert.deepEqual(timersOf(v2), ["lvRefresh"], "lcFill fires once per opening");
});

test("screen Canales lands on Deportes (tvenvivo and futbollibre code lists) with 0 requests", async () => {
  const k = await device({ noFetch: true });
  const v = await screen({ state: { nav: "deportes", depTab: "canales", lcTried: true } });
  assert.equal(byKey(v, "sportsCat").value, "v.sports");
  const items = channelsOf(v, "sp");
  assert.equal(items.length, 35, "tvenvivo's 32 + futbollibre's 19, the same channel shown once (Directv Sports = DSports)");
  assert.equal(items.filter((c) => c.ref.startsWith("M:")).length, 16);
  assert.equal(items.find((c) => c.title === "Fox Sports").ref, "M:tvenvivo:fox-sports,futbollibre:" + items.find((c) => c.title === "Fox Sports").ref.split(",futbollibre:")[1]);
  assert.equal(k.requests.length, 0);
});

// The screen-mechanics tests below use a title the mapping does not know ("Zeta"): the category passes through with its
// raw id (`xuper.3331`), so they keep testing the picker and the ticks on one source.
test("picking a category whose list is missing loads only that source, under the busy bar; state holds no list", async () => {
  const a = fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "Deportes" }], codeList: () => true, lists: { d: chans(3) } });
  const b = fakeSource("xuper", { lists: { "31": chans(40) } });
  const c = fakeSource("supertv", { lists: { "5": chans(4) } });
  live._setSources([a, b, c]);
  const k = await device({ routes: [okRoute], storage: storedLive({ registry: { xuper: [{ id: "31", title: "Zeta" }], supertv: [{ id: "5", title: "S" }] } }) });
  const out = await screenEvent({ name: "liveCat", value: "xuper.3331", state: { nav: "vivo" } });
  assert.deepEqual(out, { state: { liveCat: "xuper.3331", lvShown: null, lvPage: null }, ui: [{ hide: "busy" }] });
  assert.ok(k.requests.every((r) => r.url.startsWith("https://xuper.test/")), JSON.stringify(k.requests.map((r) => r.url)));
  assert.ok(JSON.stringify(out).length < 200);
  beginCall();
  const v = await screen({ state: { nav: "vivo", liveCat: "xuper.3331" } });
  assert.equal(tilesOf(v, "vivo").length, 40);
  assert.deepEqual(timersOf(v), []);
});

test("a failed pick shows the failure at once (tried), never a ticking timer", async () => {
  const b = fakeSource("xuper", { lists: { "31": chans(2) } });
  live._setSources([fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "D" }], codeList: () => true }), b]);
  await device({ routes: [() => res(500, "")], storage: storedLive({ registry: { xuper: [{ id: "31", title: "Zeta" }] } }) });
  const out = await screenEvent({ name: "liveCat", value: "xuper.3331", state: { nav: "vivo", lvTried: { other: true } } });
  assert.deepEqual(out.state.lvTried, { other: true, "xuper.3331": true });
  assert.deepEqual(out.ui, [{ hide: "busy" }]);
  beginCall();
  const v = await screen({ state: { nav: "vivo", ...out.state } });
  assert.ok(byKey(v, "vivoFail"));
  assert.deepEqual(timersOf(v), []);
});

test("a stale list shows at once with a one-shot lvRefresh; the tick always marks it tried and hides busy via state", async () => {
  const b = fakeSource("xuper", { lists: { "31": chans(5) } });
  live._setSources([fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "D" }], codeList: () => true }), b]);
  const cat = "xuper.3331";
  const base = storedLive({ registry: { xuper: [{ id: "31", title: "Zeta" }] }, lists: { [cat]: { items: stored("xuper", chans(2, "old")), at: Date.now() - 2 * D } } });
  const k = await device({ routes: [() => res(500, "")], storage: base });
  const state = { nav: "vivo", liveCat: cat };
  const v = await screen({ state });
  assert.equal(tilesOf(v, "vivo").length, 2, "the stale list is drawn at once");
  assert.deepEqual(timersOf(v), ["lvRefresh"]);
  beginCall();
  const tick = await screenEvent({ name: "lvRefresh", state });
  assert.deepEqual(tick.state.lvTried, { [cat]: true });
  assert.deepEqual(tick.state.ui, { hidden: { busy: true } }, "a timer's answer drops `ui`: it patches state.ui instead");
  assert.equal(tick.ui, undefined);
  assert.equal(k.requests.length, 1, "the refresh failed");
  beginCall();
  const v2 = await screen({ state: { ...state, ...tick.state } });
  assert.deepEqual(timersOf(v2), [], "tried: the timer is gone even though the refresh failed");
  assert.ok(byKey(v2, "vivoOffline"), "and the stale list says the source is unreachable");
  assert.equal(tilesOf(v2, "vivo").length, 2);
});

test("lcFill fetches the network sources never listed (bounded) and marks the opening tried", async () => {
  const b = fakeSource("xuper", { cats: [{ id: "31", title: "Zeta" }] });
  live._setSources([fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "D" }], codeList: () => true }), b]);
  const k = await device({ routes: [okRoute] });
  const tick = await screenEvent({ name: "lcFill", state: { nav: "vivo" } });
  assert.equal(tick.state.lcTried, true);
  assert.ok(tick.state.lcRev > 0);
  assert.deepEqual(tick.state.ui, { hidden: { busy: true } });
  for (const r of k.requests) assert.ok(r.timeoutMs <= 4000);
  beginCall();
  const v = await screen({ state: { nav: "vivo", ...tick.state } });
  assert.ok(byKey(v, "liveCat").options.some((o) => o.value === "xuper.3331"));
  assert.deepEqual(timersOf(v), [], "tvenvivo (code) is the landing: nothing to load");
});

test("Recargar on a live tab refetches the list on screen and answers hide busy", async () => {
  const b = fakeSource("xuper", { lists: { "31": chans(3) } });
  live._setSources([fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "D" }], codeList: () => true }), b]);
  const cat = "xuper.3331";
  await device({ routes: [okRoute], storage: storedLive({ registry: { xuper: [{ id: "31", title: "C" }] }, lists: { [cat]: { items: stored("xuper", chans(1)) } } }) });
  const out = await screenEvent({ name: "reloadVivo", state: { nav: "vivo", liveCat: cat } });
  assert.equal(b.calls.channels.length, 1, "forced although fresh");
  assert.deepEqual(out.ui, [{ hide: "busy" }]);
  assert.equal(out.state.lcTried, null);
});

test("a one-shot tick whose handler throws still switches itself off (a timer's answer keeps only state)", async () => {
  const broken = fakeSource("xuper", { cats: [] });
  Object.defineProperty(broken, "codeCategories", { get() { throw new Error("boom"); } });
  live._setSources([fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "D" }], codeList: () => true }), broken]);
  await device({ noFetch: true });
  const lv = await screenEvent({ name: "lvRefresh", state: { nav: "vivo" } });
  assert.deepEqual(lv, { state: { lvStop: true, ui: { hidden: { busy: true } } } });
  beginCall();
  const lc = await screenEvent({ name: "lcFill", state: { nav: "vivo" } });
  assert.deepEqual(lc, { state: { lcTried: true, ui: { hidden: { busy: true } } } });
  beginCall();
  const pick = await screenEvent({ name: "liveCat", value: "xuper.3331", state: { nav: "vivo" } });
  assert.deepEqual(pick.ui, [{ hide: "busy" }], "a person's event always hides the busy bar");
});

test("a raw id Kino would drop (over 128 characters) goes into its source's bucket instead of being left out", async () => {
  const long = "l_" + "x".repeat(70);   // premiumtv.<hex of 72 chars> = 154 characters: not a valid id for Kino
  live._setSources([fakeSource("premiumtv", { code: true, codeList: () => true, cats: [{ id: long, title: "Long" }, ...Array.from({ length: 6 }, (_, i) => ({ id: "l" + i, title: "L" + i }))],
    lists: { [long]: chans(2, "long") } })]);
  await device({ noFetch: true });
  const cats = await live.liveCategories();
  assert.equal(cats.filter((c) => c.id.startsWith("premiumtv.")).length, 6, "the 6 pass-through places go to valid ids");
  assert.ok(cats.every((c) => /^[A-Za-z0-9._~-]{1,128}$/.test(c.id)));
  const bucket = cats.find((c) => c.id === "v.more.premiumtv");
  assert.equal(bucket.title, "Más canales · premiumtv");
  const page = await live.liveChannels({ categoryId: "v.more.premiumtv" });
  assert.deepEqual(page.items.map((c) => c.ref), ["L:premiumtv:long0", "L:premiumtv:long1"], "its channels are listed in the bucket");
  const { cats: own } = await live.screenCategories("vivo");
  assert.ok(own.some((c) => c.id === "v.more.premiumtv"), "the own screen shows the same list");
});

// ── fixes after the adversarial review ──

test("an empty categories answer is asked again after the 10 min backoff, not trusted until max-stale (cache-4)", async () => {
  let cats = [];
  const src = fakeSource("xuper", {});
  src.categories = async (ctx) => { src.calls.categories++; await ctx.fetch("https://xuper.test/cats"); return cats; };
  live._setSources([fakeSource("tvenvivo", { code: true, cats: [{ id: "d", title: "D" }], codeList: () => true }), src]);
  const k = await device({ routes: [okRoute] });
  assert.deepEqual((await live.categoryList({ fill: live.FIRST_FILL })).flatMap((c) => c.members.map((m) => m.src)), ["tvenvivo"]);
  assert.equal(src.calls.categories, 1);
  beginCall();
  await live.liveCategories();
  assert.equal(src.calls.categories, 1, "within 10 min: the empty answer stands");
  assert.equal((await live.screenCategories("vivo")).missing, false);
  // 11 min later the portal answers normally again
  cats = [{ id: "31", title: "Colombia" }];
  const lc = JSON.parse(k.store.get("o2:lc")); lc.src.xuper.at = Date.now() - 11 * M; k.store.set("o2:lc", JSON.stringify(lc));
  const lm = JSON.parse(k.store.get("o2:lm")); lm.c.xuper.at = Date.now() - 11 * M; k.store.set("o2:lm", JSON.stringify(lm));
  ls._resetMemory();
  beginCall();
  assert.equal((await live.screenCategories("vivo")).missing, true, "the screen's lcFill picks it up too");
  const again = await live.liveCategories();
  assert.equal(src.calls.categories, 2);
  assert.ok(again.some((c) => c.id === "v.co"), "xuper's Colombia column is listed again (in Colombia)");
});

test("Kino's Recargar: a second first page of a category in this runtime refetches although the list is fresh (cache-5)", async () => {
  let version = 0;
  const src = fakeSource("supertv", { lists: { "7": () => chans(3, "v" + version + "_") } });
  live._setSources([src]);
  const cat = "supertv." + hexEnc("7");
  await device({ routes: [okRoute], storage: storedLive({ registry: { supertv: [{ id: "7", title: "D" }] },
    lists: { [cat]: { items: stored("supertv", chans(3, "v0_")) } } }) });
  const p1 = await live.liveChannels({ categoryId: cat, cursor: null });
  assert.equal(src.calls.channels.length, 0, "fresh: served from storage");
  assert.equal(p1.items[0].ref, "L:supertv:v0_0");
  version = 1;
  beginCall();
  await live.liveChannels({ categoryId: cat, cursor: "deadbeef:0" });
  assert.equal(src.calls.channels.length, 0, "a later page is never a Recargar");
  beginCall();
  const p2 = await live.liveChannels({ categoryId: cat, cursor: null });
  assert.equal(src.calls.channels.length, 1, "Kino keeps a listing 1 h: asked again, it is Recargar");
  assert.equal(p2.items[0].ref, "L:supertv:v1_0");
  // 70 min later (Kino's own listing expired): an ordinary first page, fresh by policy (6 h) → no fetch
  const real = Date.now;
  try {
    Date.now = () => real() + 70 * M;
    beginCall();
    await live.liveChannels({ categoryId: cat, cursor: null });
    assert.equal(src.calls.channels.length, 1);
  } finally { Date.now = real; }
  // a cold runtime has no memory of it: no extra fetch
  ls._resetMemory();
  beginCall();
  await live.liveChannels({ categoryId: cat, cursor: null });
  assert.equal(src.calls.channels.length, 1);
});

test("Recargar detection still honours the failure backoff, and an empty answer does not arm it", async () => {
  const src = fakeSource("supertv", { lists: { "7": chans(2), "8": [] } });
  live._setSources([src]);
  const c7 = "supertv." + hexEnc("7"), c8 = "supertv." + hexEnc("8");
  const k = await device({ routes: [() => res(500, "")], storage: storedLive({ registry: { supertv: [{ id: "7", title: "A" }, { id: "8", title: "B" }] },
    lists: { [c7]: { items: stored("supertv", chans(2)) }, [c8]: { items: [] } } }) });
  await live.liveChannels({ categoryId: c7 });
  beginCall();
  await live.liveChannels({ categoryId: c7 });   // Recargar → refetch fails → stored list, backoff
  assert.equal(src.calls.channels.length, 1);
  assert.ok(JSON.parse(k.store.get("o2:lm")).l[c7].failAt > 0);
  beginCall();
  const again = await live.liveChannels({ categoryId: c7 });
  assert.equal(src.calls.channels.length, 1, "inside the backoff: no new attempt");
  assert.equal(again.items.length, 2);
  beginCall();
  await live.liveChannels({ categoryId: c8 });
  beginCall();
  await live.liveChannels({ categoryId: c8 });
  assert.equal(src.calls.channels.length, 1, "Kino never keeps an empty listing: a second ask is not a Recargar");
});

test("a list storage refuses never leaves its old text labelled with the new hash (cache-6)", async () => {
  const k = await device({ noFetch: true });
  ls.putList("s.1", [{ id: "s_o", title: "old", ref: "L:s:o" }], { maxStaleMs: D });
  ls.flushMeta();
  const realSet = k.kino.storage.set;
  k.kino.storage.set = (key, val) => {
    if (key === "o2:ll:s.1") throw Object.assign(new Error("plugin storage full"), { code: "too_large" });
    return realSet(key, val);
  };
  beginCall();
  const r = ls.putList("s.1", [{ id: "s_n", title: "new", ref: "L:s:n" }], { maxStaleMs: D });
  ls.flushMeta();
  assert.equal(r.items[0].title, "new", "this runtime serves the new list (L0)");
  assert.equal(k.store.get("o2:ll:s.1"), undefined, "the old text is gone");
  assert.equal(ls.getList("s.1").items[0].title, "new");
  k.kino.storage.set = realSet;
  ls._resetMemory();
  beginCall();
  assert.equal(ls.getList("s.1"), null, "a cold runtime misses and refetches instead of serving 'old' as current");
});

test("a clock set back (stamps 30 d ahead) does not freeze lists and categories (cache-7)", async () => {
  let ver = 1, catCalls = 0, listCalls = 0;
  const src = { id: "xuper", name: "X", genre: "otros",
    async categories() { catCalls++; return [{ id: "31", title: "Zeta v" + ver }]; },   // unknown title: passes through
    async channels() { listCalls++; return [{ id: "a" + ver, title: "A v" + ver }]; },
    async resolve() { return { url: "https://x/y.m3u8" }; } };
  live._setSources([src]);
  await device({ noFetch: true });
  const real = Date.now;
  const cat = "xuper." + hexEnc("31");
  try {
    Date.now = () => real() + 30 * D;   // the clock runs a month ahead
    beginCall(); await live.liveCategories();
    beginCall(); await live.liveChannels({ categoryId: cat });
  } finally { Date.now = real; }      // then NTP corrects it
  ver = 2;
  ls._resetMemory();
  beginCall();
  assert.deepEqual((await live.liveChannels({ categoryId: cat })).items.map((c) => c.title), ["A v2"], "a future `at` reads as stale");
  assert.equal(listCalls, 2);
  ls._resetMemory();
  beginCall();
  await live.loadList(cat, { force: true });
  ls._resetMemory();
  beginCall();
  assert.deepEqual((await live.screenList(cat)).items.map((c) => c.title), ["A v2"], "a forced reload is stored (not 'newer elsewhere')");
  beginCall();
  await live.liveChannels({ categoryId: cat });
  assert.equal(catCalls, 2, "the categories rode along the list fetch");
  beginCall();
  assert.deepEqual((await live.liveCategories()).map((c) => c.title), ["Zeta v2"]);
});

test("the own screen offers the same ≤ 90 categories as Kino's native list, without the adult ones (regression-3)", async () => {
  const mk = (n, p) => Array.from({ length: n }, (_, i) => ({ id: p + i, title: p + " " + i, ...(p === "x" && i % 10 === 0 ? { adult: true } : {}) }));
  live._setSources([
    fakeSource("tvenvivo", { code: true, cats: mk(11, "t") }),
    fakeSource("supertv", { code: true, cats: mk(100, "s") }),
    fakeSource("cablevisionhd", { code: true, cats: mk(13, "c") }),
    fakeSource("xuper", { code: true, cats: mk(131, "x") }),
  ]);
  await device({ noFetch: true });
  const native = await live.liveCategories();
  assert.ok(native.length <= 90, String(native.length));
  const { cats } = await live.screenCategories("vivo");
  assert.deepEqual(cats.map((c) => c.id), native.filter((c) => !c.adult).map((c) => c.id), "the same list, adult left out");
  assert.ok(native.some((c) => c.id === "v.adult" && c.adult));
  assert.equal(cats.filter((c) => c.src === "xuper").length, 24 + 1, "24 xuper columns pass through, the rest in its bucket");
  assert.ok(cats.some((c) => c.id === "v.more.xuper"));
  assert.ok(cats.some((c) => c.id === "v.sp.world"), "supertv's 100 unprefixed sports categories: one category");
  assert.equal(new Set(cats.map((c) => c.id)).size, cats.length);
  beginCall();
  const v = await screen({ state: { nav: "vivo", lcTried: true } });
  assert.equal(byKey(v, "liveCat").options.length, cats.length);
});

test("the backend refusing the Bearer mid-call (401) answers [] like no Bearer, and drops it (regression-5)", async () => {
  live._setSources(null);   // the real xuper connector
  const { DEFAULT_SERVER } = await import("../src/config.js");
  const k = await device({ routes: [(url) => (url.startsWith(DEFAULT_SERVER) ? res(401, "{}") : undefined)] });
  const out = await live.liveChannels({ categoryId: "xuper." + hexEnc("31") });
  assert.deepEqual(out, []);
  assert.equal(k.store.get("o2:bearer"), undefined, "the session is removed");
  assert.ok(k.requests.some((r) => r.url.includes("/xuper/config")));
});
