// Kino's first page of a merged category whose member lists are all stored but stale, on a virtual clock
// (test/helpers/virtual-kino.mjs): the Redmi took 7.9 s and 23 requests for "Eventos en vivo" (~21 lists) in the 1.0.45
// merge build. Kino waits for every request in flight before it takes the answer, so the time the call holds is what
// the person waits before the grid paints.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { res } from "./helpers/fake-kino.mjs";
import { installVirtualKino } from "./helpers/virtual-kino.mjs";

const vk = installVirtualKino({ storage: { "o2:bearer": "bearer-token" } });
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");

const M = 60_000, H = 60 * M;
const sha16 = (t) => createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);
const NUVIO = ["live", "football", "basketball", "tennis", "motorsport", "mma", "baseball", "hockey", "rugby", "americanfootball", "golf", "cricket", "college", "other"];
const CNC = ["cnc_SKTechLiveEvents_tv", "cnc_SportzXLiveEvents_tv", "cnc_PlayFyLiveEvents_tv", "cnc_PlayZTVLiveEvents_tv", "cnc_LivXowLiveEvents_tv"];
const DTV = ["today", "l_uefa-nations-league", "l_amistoso-internacional"];
const STV = [{ id: "2923", title: "┃UK┃ UEFA EVENTS" }, { id: "3409", title: "┃UK┃ LIGUE 1 PPV" }];

/**
 * The device's "Eventos en vivo" members: [src, rawCat, age of its stored list (min), latency of each request (ms),
 * requests per refresh]. Ages are past each list's fresh window (nuvio and futbollibre "hoy" 10 min, deportv and
 * cncverse 30 min, supertv 6 h) and inside its max-stale; latencies are the Redmi's (deportv's 304 took 3.4 s).
 */
const members = (nuvio = {}, deportvMs = 3400) => [
  ["futbollibre", "hoy", 45, 700, 2],
  ...DTV.map((c) => ["deportv", c, 50, deportvMs, 1]),
  ...NUVIO.map((c, i) => ["nuvio-sports", c, nuvio.age != null ? nuvio.age + i : 25 + i * 5, nuvio.ms != null ? nuvio.ms : 300 + (i % 4) * 300, 1]),
  ...CNC.map((c, i) => ["cncverse", c, 35 + i * 11, 800 + i * 400, 1]),
  ...STV.map((c) => ["supertv", c.id, 7 * 60, 600, 1]),
];
let MEMBERS = members();
const items = (src, cat, n = 10) => live.normalizeChannels(src, Array.from({ length: n }, (_, i) => ({ id: cat + "-" + i, title: src + " " + cat + " " + i })));

/** A connector of `src`: `chain` requests per list; deportv answers 304 for all its lists (one shared schedule). */
function source(src) {
  const own = MEMBERS.filter((m) => m[0] === src);
  const cats = src === "supertv" ? STV : own.map((m) => ({ id: m[1], title: m[1] }));
  return {
    id: src, name: src, genre: "deportes",
    codeCategories: src === "nuvio-sports" || src === "futbollibre",
    ...(src === "deportv" ? { sharedFetch: true } : {}),
    async categories() { return cats; },
    async channels(cat, ctx) {
      const m = own.find((x) => x[1] === cat);
      for (let i = 0; i < m[4]; i++) {
        const r = await ctx.fetch(`https://${src}.test/list/${cat}/${i}`, { timeoutMs: 15000 });
        if (r.status === 304) { ctx.touchAll(); return ctx.UNCHANGED; }
        if (!r.ok) throw new Error("list " + r.status);
      }
      const raw = (c) => items(src, c, 11).map((x) => ({ id: decodeURIComponent(x.ref.split(":")[2]), title: x.title }));
      // a shared source's one response stores every list
      if (src === "deportv") for (const o of own) if (o[1] !== cat) ctx.putList(o[1], raw(o[1]));
      return raw(cat);
    },
    async resolve() { return { url: "https://x.test/a.m3u8" }; },
  };
}

/** Storage: the registry of the network sources and every member list stored `age` minutes ago. */
function seed(missing = []) {
  const now = vk.now();
  const lc = { v: 1, src: {} }, lm = { v: 1, c: {}, l: {} };
  for (const src of ["deportv", "cncverse", "supertv"]) {
    lc.src[src] = { at: now - H, cats: src === "supertv" ? STV : MEMBERS.filter((m) => m[0] === src).map((m) => ({ id: m[1], title: m[1] })) };
    lm.c[src] = { at: now - H, failAt: 0, failN: 0 };
  }
  vk.store.clear();
  vk.store.set("o2:bearer", "bearer-token");
  for (const [src, cat, age] of MEMBERS) {
    if (missing.includes(src + ":" + cat)) continue;
    const text = JSON.stringify(items(src, cat));
    const key = live.listKey(src, cat);
    vk.store.set("o2:ll:" + key, text);
    lm.l[key] = { at: now - age * M, h: sha16(text), n: 10, w: now - age * M, failAt: 0, failN: 0 };
  }
  vk.store.set("o2:lc", JSON.stringify(lc));
  vk.store.set("o2:lm", JSON.stringify(lm));
}

async function firstPage() {
  vk.reset();
  ls._resetMemory();
  await clearBearer();
  vk.store.set("o2:bearer", "bearer-token");
  beginCall();
  const t0 = vk.now();
  const out = await vk.run(() => live.liveChannels({ categoryId: "v.events", cursor: null }));
  return { out, heldMs: vk.now() - t0, reqs: vk.requests.map((r) => ({ url: r.url, at: r.at - t0, t: r.timeoutMs })) };
}

test.afterEach(() => { live._setSources(null); MEMBERS = members(); vk.setTtl(false); });

/** The routes of MEMBERS: each list answers after its latency; deportv answers 304 (one shared schedule). */
const routeMembers = () => {
  const lat = new Map(MEMBERS.map((m) => [m[0] + "/" + m[1], m[3]]));
  vk.setRoute((url) => {
    const u = new URL(url);
    const [, , cat] = u.pathname.split("/");
    const ms = lat.get(u.hostname.replace(".test", "") + "/" + decodeURIComponent(cat));
    return { ms, res: u.hostname === "deportv.test" ? res(304, "") : res(200, "ok") };
  });
};

test("Kino's first page of 'Eventos en vivo' with every list stored but stale: answers within the 2.5 s budget, stalest first, the rest served stale, no backoff", async () => {
  live._setSources(["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv"].map(source));
  const lat = new Map(MEMBERS.map((m) => [m[0] + "/" + m[1], m[3]]));
  vk.setRoute((url) => {
    const u = new URL(url);
    const [, , cat] = u.pathname.split("/");
    const ms = lat.get(u.hostname.replace(".test", "") + "/" + decodeURIComponent(cat));
    return { ms, res: u.hostname === "deportv.test" ? res(304, "") : res(200, "ok") };
  });
  seed();
  const { out, heldMs, reqs } = await firstPage();
  assert.ok(heldMs <= live.KINO_REFRESH_SOFT_MS, "held " + heldMs + " ms (the Redmi: 7.9 s)");
  assert.ok(out.items.length >= 25 * 10, "every stored channel is listed (the lists not refreshed are served stale)");
  for (const r of reqs) {
    assert.ok(r.at <= live.KINO_REFRESH_SOFT_MS - 1000, "started at +" + r.at + " ms");
    assert.ok(r.at + r.t <= live.KINO_REFRESH_SOFT_MS, "ends by the budget: +" + r.at + " + " + r.t);
  }
  assert.ok(reqs.length >= 5 && reqs.length < 23, reqs.length + " requests");
  // stalest first: the five that start at once are the lists with the most of their max-stale used (2 h for nuvio and
  // cncverse: the oldest of either), never deportv (6 h) or supertv (24 h)
  const first = reqs.filter((r) => r.at === 0).map((r) => new URL(r.url).pathname.split("/")[2]);
  assert.deepEqual(first, ["other", "college", "cricket", "cnc_LivXowLiveEvents_tv", "golf"]);
  // what was cut short by the budget is not the source failing; what answered is fresh now
  ls.flushMeta();
  const lm = JSON.parse(vk.store.get("o2:lm"));
  for (const [src, cat] of MEMBERS) assert.equal(lm.l[live.listKey(src, cat)].failAt, 0, src + " " + cat);
  assert.ok(lm.l[live.listKey("nuvio-sports", "other")].at >= vk.now() - live.KINO_REFRESH_SOFT_MS, "refreshed");
  assert.ok(lm.l[live.listKey("supertv", "2923")].at < vk.now() - H, "the least behind waits for the next listing");
  // the next first page (Kino's listing 40 min later, a new runtime) starts with the ones that waited: nothing waits
  // past its max-stale (it would be dropped, then load in full)
  const waited = MEMBERS.filter(([src, cat]) => lm.l[live.listKey(src, cat)].at < vk.now() - live.KINO_REFRESH_SOFT_MS).map(([src, cat]) => src + "/" + cat);
  vk.advance(40 * M);
  const again = await firstPage();
  assert.ok(again.heldMs <= live.KINO_REFRESH_SOFT_MS);
  const firstAgain = again.reqs.filter((r) => r.at === 0).map((r) => new URL(r.url).hostname.replace(".test", "") + "/" + new URL(r.url).pathname.split("/")[2]);
  assert.ok(firstAgain.every((x) => waited.includes(x)), JSON.stringify(firstAgain));
});

test("a missing list still loads with its connector's own timeout first; the stale ones then refresh only within what is left of the budget", async () => {
  live._setSources(["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv"].map(source));
  vk.setRoute((url) => (url.includes("/list/football/") ? { ms: 4000, res: res(200, "ok") } : { ms: 400, res: res(200, "ok") }));
  seed(["nuvio-sports:football"]);
  const { out, heldMs, reqs } = await firstPage();
  const football = reqs.find((r) => r.url.includes("/list/football/"));
  assert.equal(football.t, 15000, "its connector's own timeout");
  assert.equal(heldMs, 4000, "the missing list, then nothing stale fits in the 2.5 s budget");
  assert.equal(reqs.length, 1);
  assert.equal(out.items.length, 25 * 10 + 1, "the new list's 11 channels and every stored one");
});

test("the budget holds on Kino's gate (4 per host): a 5th stale list of one host waits in the plugin, never in Kino's queue with a timeout already running", async () => {
  // nuvio's 14 lists (one host) are the stalest and answer in 2 s: Kino runs 4 of them at once, so a 5th started by the
  // plugin would wait for a place there with t=2500 computed at +0 and end at +4000 (the Redmi: nuviosports.xyz 2–12 s)
  MEMBERS = members({ age: 100, ms: 2000 });
  live._setSources(["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv"].map(source));
  routeMembers();
  seed();
  const { out, heldMs, reqs } = await firstPage();
  assert.ok(heldMs <= live.KINO_REFRESH_SOFT_MS, "held " + heldMs + " ms");
  for (const r of vk.requests) assert.equal(r.at, r.queuedAt, "never queued in Kino: " + r.url);
  for (const r of reqs) assert.ok(r.at + r.t <= live.KINO_REFRESH_SOFT_MS, "ends by the budget: +" + r.at + " + " + r.t);
  const nuvio = reqs.filter((r) => r.url.includes("nuvio-sports.test"));
  assert.equal(nuvio.filter((r) => r.at === 0).length, 4, "4 at once on one host");
  assert.ok(out.items.length >= 25 * 10, "the rest served stale");
});

test("Kino's Recargar (a first page again within 55 min, same runtime) refreshes every list checked over 10 min ago, not only what fits the 2.5 s budget", async () => {
  live._setSources(["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv"].map(source));
  routeMembers();
  seed();
  const lm0 = JSON.parse(vk.store.get("o2:lm"));
  for (const k of Object.keys(lm0.l)) lm0.l[k].at = vk.now() - 30 * M;   // every list 30 min old
  vk.store.set("o2:lm", JSON.stringify(lm0));
  const first = await firstPage();
  assert.ok(first.heldMs <= live.KINO_REFRESH_SOFT_MS, "the first page keeps its budget: " + first.heldMs);
  const checked = () => { ls.flushMeta(); const lm = JSON.parse(vk.store.get("o2:lm")); return MEMBERS.filter(([src, cat]) => vk.now() - lm.l[live.listKey(src, cat)].at < 10 * M).length; };
  assert.ok(checked() < MEMBERS.length, "the first page left some stale: " + checked());
  // the person presses Recargar 20 min later (same runtime: Kino's forced re-list reaches the plugin as a first page)
  vk.advance(20 * M);
  vk.reset();
  beginCall();
  const t0 = vk.now();
  await vk.run(() => live.liveChannels({ categoryId: "v.events", cursor: null }));
  assert.ok(vk.now() - t0 <= 16000, "under the call's deadline: " + (vk.now() - t0));
  assert.equal(checked(), MEMBERS.length, "every list checked in the last 10 min");
});

test("the categories riding along a list inside the first page's budget: never a failure when the budget cuts them; only once half-way to max-stale", async () => {
  // cncverse's categories (fresh 6 h, max-stale 3 d) come from a manifest asked with timeoutMs 8000; its lists refresh in 0.9 s
  const NV = ["live", "football", "basketball"], CN = ["cnc_SKTechLiveEvents_tv", "cnc_PlayFyLiveEvents_tv"];
  let manifestMs = 1800;
  const mk = (id, cats) => ({
    id, name: id, genre: "deportes", codeCategories: id === "nuvio-sports",
    async categories(ctx) {
      if (id === "cncverse") { const r = await ctx.fetch("https://cncverse.test/manifest", { timeoutMs: 8000 }); if (!r.ok) throw new Error("manifest " + r.status); }
      return cats.map((c) => ({ id: c, title: c }));
    },
    async channels(cat, ctx) {
      const r = await ctx.fetch(`https://${id}.test/list/${cat}`, { timeoutMs: 15000 });
      if (!r.ok) throw new Error("list " + r.status);
      return items(id, cat, 11).map((c) => ({ id: decodeURIComponent(c.ref.split(":")[2]), title: c.title }));
    },
    async resolve() { return { url: "https://x.test/a.m3u8" }; },
  });
  live._setSources([mk("nuvio-sports", NV), mk("cncverse", CN)]);
  vk.setRoute((url) => (url.endsWith("/manifest") ? { ms: manifestMs, res: res(200, "{}") } : { ms: 900, res: res(200, "ok") }));
  const seedCats = (catsAgeMs) => {
    const now = vk.now();
    const lm = { v: 1, c: { cncverse: { at: now - catsAgeMs, failAt: 0, failN: 0 } }, l: {} };
    vk.store.clear();
    vk.store.set("o2:bearer", "bearer-token");
    for (const [src, cats] of [["nuvio-sports", NV], ["cncverse", CN]]) {
      for (const cat of cats) {
        const text = JSON.stringify(items(src, cat));
        vk.store.set("o2:ll:" + live.listKey(src, cat), text);
        lm.l[live.listKey(src, cat)] = { at: now - 100 * M, h: sha16(text), n: 10, w: now - 100 * M, failAt: 0, failN: 0 };
      }
    }
    vk.store.set("o2:lc", JSON.stringify({ v: 1, src: { cncverse: { at: now - catsAgeMs, cats: CN.map((c) => ({ id: c, title: c })) } } }));
    vk.store.set("o2:lm", JSON.stringify(lm));
  };
  const catsMeta = () => { ls.flushMeta(); return JSON.parse(vk.store.get("o2:lm")).c.cncverse; };
  const manifests = () => vk.requests.filter((r) => r.url.endsWith("/manifest"));
  // 7 h old (past fresh, far from max-stale): they do not ride along inside the budget
  seedCats(7 * H);
  let p = await firstPage();
  assert.ok(p.heldMs <= live.KINO_REFRESH_SOFT_MS, "held " + p.heldMs);
  assert.equal(manifests().length, 0, "no place or budget taken from the stale lists");
  assert.equal(catsMeta().failAt, 0);
  // 50 h old (past half-way to the 3 d max-stale): they ride along; a 1.8 s manifest cut by the budget is no failure
  seedCats(50 * H);
  p = await firstPage();
  assert.ok(p.heldMs <= live.KINO_REFRESH_SOFT_MS, "held " + p.heldMs);
  assert.equal(manifests().length, 1);
  assert.ok(manifests()[0].timeoutMs < 8000, "cut by the budget: t=" + manifests()[0].timeoutMs);
  assert.equal(catsMeta().failAt, 0, "a cut made by the call's own budget is not the source failing");
  assert.equal(ls.catsInBackoff("cncverse", vk.now()), false, "cncverse members are not put behind other sources");
  assert.ok(vk.logs.some((l) => /cncverse: categories cut short by this call's bounds/.test(l)));
  // … and a manifest that answers within it refreshes them
  manifestMs = 300;
  seedCats(50 * H);
  p = await firstPage();
  assert.ok(catsMeta().at >= vk.now() - live.KINO_REFRESH_SOFT_MS, "refreshed");
});

/**
 * Kino listing "Eventos en vivo" every hour from the first install on, storage TTLs honoured (Kino keeps a listing 1 h
 * and closes an idle runtime after 5 min: a cold first page each time) → per listing `{ k, heldMs, reqs, served, gone }`.
 */
async function hourly(listings) {
  live._setSources(["futbollibre", "deportv", "nuvio-sports", "cncverse", "supertv"].map(source));
  const lat = new Map(MEMBERS.map((m) => [m[0] + "/" + m[1], m[3]]));
  vk.setRoute((url) => {
    const u = new URL(url);
    return { ms: lat.get(u.hostname.replace(".test", "") + "/" + decodeURIComponent(u.pathname.split("/")[2])), res: res(200, "ok") };
  });
  vk.setTtl(true);
  vk.clearStore();
  vk.store.set("o2:bearer", "bearer-token");
  const lc = { v: 1, src: {} }, lm = { v: 1, c: {}, l: {} };
  for (const src of ["deportv", "cncverse", "supertv"]) {
    lc.src[src] = { at: vk.now(), cats: src === "supertv" ? STV : MEMBERS.filter((m) => m[0] === src).map((m) => ({ id: m[1], title: m[1] })) };
    lm.c[src] = { at: vk.now(), failAt: 0, failN: 0 };
  }
  vk.store.set("o2:lc", JSON.stringify(lc));
  vk.store.set("o2:lm", JSON.stringify(lm));
  const gone = () => MEMBERS.filter(([src, cat]) => !vk.has("o2:ll:" + live.listKey(src, cat))).map(([src, cat]) => src + "/" + cat);
  const install = await firstPage();   // the first ever: every list loads
  assert.deepEqual(gone(), []);
  assert.equal(install.out.items.length, 25 * 11);
  const out = [];
  for (let k = 1; k <= listings; k++) {
    vk.advance(60 * M);
    const g = gone();
    const p = await firstPage();
    out.push({ k, heldMs: p.heldMs, reqs: p.reqs, served: p.out.items.length, gone: g });
  }
  return out;
}

test("Kino listing 'Eventos en vivo' every hour, storage TTLs honoured: no list ever vanishes into a full reload; each listing keeps its budget", async () => {
  MEMBERS = members({}, 900);   // every source answers within the budget
  for (const l of await hourly(10)) {
    assert.deepEqual(l.gone, [], "listing " + l.k + ": no list vanished (it would load in full with a 15 s timeout)");
    assert.equal(l.served, 25 * 11, "listing " + l.k + ": every list served");
    assert.ok(l.heldMs <= live.KINO_REFRESH_SOFT_MS, "listing " + l.k + " held " + l.heldMs + " ms");
  }
});

test("a source slower than the budget (deportv's 3.4 s) refreshes outside it about once a max-stale, before its categories or lists would be lost: its channels never leave the listing", async () => {
  const ls10 = await hourly(10);
  for (const l of ls10) {
    assert.deepEqual(l.gone, [], "listing " + l.k);
    assert.equal(l.served, 25 * 11, "listing " + l.k + ": every list served, deportv's too");
  }
  const over = ls10.filter((l) => l.heldMs > live.KINO_REFRESH_SOFT_MS);
  assert.deepEqual(over.map((l) => l.reqs.map((r) => new URL(r.url).hostname)), [["deportv.test"], ["deportv.test"]], "only deportv, once every ~5 h (its categories' 6 h max-stale)");
  for (const l of over) assert.ok(l.heldMs <= 3400, "its own answer: " + l.heldMs);
});
