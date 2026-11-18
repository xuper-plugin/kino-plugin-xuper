// How long the screen's ticks and events hold the runtime, on a virtual clock (test/helpers/virtual-kino.mjs).
// Kino never preempts a running tick and runs one screen event at a time, so a tick's duration is what a person's tap
// waits; a screenEvent past 20 s is cut and shows Kino's error state instead of the plugin's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { res } from "./helpers/fake-kino.mjs";
import { installVirtualKino } from "./helpers/virtual-kino.mjs";

const vk = installVirtualKino({ storage: { "o2:bearer": "bearer-token" } });
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const data = await import("../src/data.js");
const { beginCall } = await import("../src/flight.js");
const { screen, screenEvent } = await import("../src/screen.js");
const { DATA_BASE, RELEASE_BASE } = await import("../src/config.js");

const M = 60_000, D = 24 * 60 * M;
const chans = (n, p = "c") => Array.from({ length: n }, (_, i) => ({ id: p + i, title: "Canal " + i }));
const legacyHome = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));

/** A fresh device on the virtual clock: storage with only the Bearer, cold memory. */
function fresh() {
  vk.reset();
  vk.store.clear();
  vk.store.set("o2:bearer", "bearer-token");
  ls._resetMemory();
  data._resetMemory();
  live._setSources(null);
}

/** Runs one screen event as its own plugin call. → { out, heldMs, reqs: [{ path, t, at (ms after start) }] }. */
async function event(name, state, value) {
  vk.requests.length = 0;
  beginCall();
  const t0 = vk.now();
  const out = await vk.run(() => screenEvent({ name, state, value }));
  const reqs = vk.requests.map((r) => ({ path: r.url, t: r.timeoutMs, at: r.at - t0 }));
  return { out, heldMs: vk.now() - t0, reqs };
}

const tvenvivo = () => ({ id: "tvenvivo", name: "t", genre: "otros", codeCategories: true, codeList: () => true,
  async categories() { return [{ id: "d", title: "D" }]; }, async channels() { return chans(2, "tv"); }, async resolve() { return null; } });

/** A network source whose list is a two-hop scrape (12 s wanted per request, like cablevisionhd's grid). */
function scraper(id) {
  const calls = { cats: 0, lists: 0 };
  return {
    id, name: id, genre: "otros", calls,
    async categories(ctx) { calls.cats++; await ctx.fetch(`https://${id}.test/cats`, { timeoutMs: 8000 }); return [{ id: "31", title: "Colombia" }]; },
    async channels(cat, ctx) {
      calls.lists++;
      const a = await ctx.fetch(`https://${id}.test/page`, { timeoutMs: 12000 });
      if (!a.ok) throw new Error("page " + a.status);
      const b = await ctx.fetch(`https://${id}.test/grid`, { timeoutMs: 12000 });
      if (!b.ok) throw new Error("grid " + b.status);
      return chans(5, "new");
    },
    async resolve() { return { url: "https://x/y.m3u8" }; },
  };
}

test.afterEach(() => live._setSources(null));

// ── contract-1: the lvRefresh tick has its own short bounds ──

test("lvRefresh on a stale list: every request ≤ 3 s and started within 3 s; the tick ends by ~3 s and keeps the stored list", async () => {
  fresh();
  const src = scraper("xuper");
  live._setSources([tvenvivo(), src]);
  beginCall();
  ls.setCats("xuper", [{ id: "31", title: "Zeta" }]);   // unknown title: passes through as xuper.3331
  ls.putList("xuper.3331", live.normalizeChannels("xuper", chans(2, "old")), { maxStaleMs: 7 * D });
  ls.flushMeta();
  vk.advance(2 * D);   // list and categories past fresh (24 h), within max-stale (7 d)
  vk.setRoute((url) => (url.endsWith("/page") ? { ms: 9000, res: res(200, "ok") } : { hang: true }));
  const { out, heldMs, reqs } = await event("lvRefresh", { nav: "vivo", liveCat: "xuper.3331" });
  for (const r of reqs) {
    assert.ok(r.t <= 3000, "timeoutMs " + r.t + " for " + r.path);
    assert.ok(r.at <= 3000, "started at +" + r.at + " ms");
  }
  assert.ok(heldMs <= 3500, "held the runtime " + heldMs + " ms (was up to 16 s)");
  assert.deepEqual(out.state.lvTried, { "xuper.3331": true });
  beginCall();
  const st = await live.screenList("xuper.3331");
  assert.deepEqual(st.items.map((c) => c.ref), ["L:xuper:old0", "L:xuper:old1"], "the stored list is kept");
});

test("lvRefresh: a refresh that ends near the deadline skips the categories ride-along (no pointless backoff)", async () => {
  fresh();
  const src = scraper("xuper");
  live._setSources([tvenvivo(), src]);
  beginCall();
  ls.setCats("xuper", [{ id: "31", title: "Zeta" }]);   // unknown title: passes through as xuper.3331
  ls.putList("xuper.3331", live.normalizeChannels("xuper", chans(2, "old")), { maxStaleMs: 7 * D });
  ls.flushMeta();
  vk.advance(2 * D);
  vk.setRoute((url) => (url.endsWith("/page") ? { ms: 2500, res: res(200, "ok") } : { ms: 300, res: res(200, "ok") }));
  const { heldMs, reqs } = await event("lvRefresh", { nav: "vivo", liveCat: "xuper.3331" });
  assert.ok(heldMs <= 3000, "held " + heldMs);
  assert.equal(src.calls.lists, 1);
  assert.equal(src.calls.cats, 0, "under a second left: the stale categories wait for another call");
  assert.ok(!reqs.some((r) => r.path.endsWith("/cats")));
  beginCall();
  assert.equal(ls.catsFailAt("xuper"), 0, "no failure recorded for a fetch that never started");
  assert.deepEqual((await live.screenList("xuper.3331")).items.map((c) => c.ref).slice(0, 1), ["L:xuper:new0"]);
});

test("lvRefresh loading a missing list: bounded at 6 s (requests ≤ 4 s)", async () => {
  fresh();
  const src = scraper("xuper");
  live._setSources([tvenvivo(), src]);
  beginCall();
  ls.setCats("xuper", [{ id: "31", title: "Zeta" }]);   // unknown title: passes through as xuper.3331
  ls.flushMeta();
  vk.setRoute(() => ({ hang: true }));
  const { out, heldMs, reqs } = await event("lvRefresh", { nav: "vivo", liveCat: "xuper.3331" });
  for (const r of reqs) assert.ok(r.t <= 4000 && r.at <= 6000, JSON.stringify(r));
  assert.ok(heldMs <= 6500, "held " + heldMs);
  assert.deepEqual(out.state.lvTried, { "xuper.3331": true });
});

test("lvRefresh on a merged category with many stale lists: the ticks go on while one refreshes some; no offline banner when nothing failed", async () => {
  fresh();
  const sports = Array.from({ length: 15 }, (_, i) => ({ id: "s" + i, title: "Sport " + i }));
  const nuvio = { id: "nuvio-sports", name: "Nuvio", genre: "deportes", codeCategories: true,
    async categories() { return sports; },
    async channels(cat, ctx) {
      const r = await ctx.fetch(`https://nuvio.test/${cat}`, { timeoutMs: 8000 });
      if (!r.ok) throw new Error("list " + r.status);
      return [{ id: "e" + cat, title: "Arsenal vs Chelsea " + cat }];
    },
    async resolve() { return null; } };
  live._setSources([nuvio]);
  beginCall();
  for (const c of sports) ls.putList(live.listKey("nuvio-sports", c.id), live.normalizeChannels("nuvio-sports", [{ id: "old" + c.id, title: "Boca vs River " + c.id }]), { maxStaleMs: 2 * 60 * M });
  ls.flushMeta();
  vk.advance(20 * M);   // past nuvio's 10 min fresh, within its 2 h max-stale
  vk.setRoute(() => ({ ms: 1200, res: res(200, "{}") }));
  const draw = async (state) => { beginCall(); return vk.run(() => screen({ state })); };
  const timers = (v) => (Array.isArray(v.every) ? v.every : v.every ? [v.every] : []).map((t) => t.event);
  const offline = (v) => JSON.stringify(v).includes('"spOffline"');
  const refreshed = () => { beginCall(); return sports.filter((c) => vk.now() - ls.listMeta(live.listKey("nuvio-sports", c.id)).at < 10 * M).length; };
  let state = { nav: "deportes", depTab: "canales", sportsCat: "v.events", lcTried: true };
  assert.deepEqual(timers(await draw(state)), ["lvRefresh"]);
  const t1 = await event("lvRefresh", state);
  assert.ok(t1.heldMs <= 3500, "held " + t1.heldMs);
  assert.equal(refreshed(), 8, "the 3 s tick refreshed two rounds of 4 (Kino runs 4 per host); the third ran out of the tick's time");
  assert.equal(t1.out.state.lvTried, undefined, "lists still stale and this tick refreshed some: it goes on");
  assert.deepEqual(t1.out.state.lvN, { "v.events": 1 });
  state = { ...state, ...t1.out.state };
  let v = await draw(state);
  assert.deepEqual(timers(v), ["lvRefresh"]);
  assert.equal(offline(v), false, "nothing failed: no offline banner");
  const t2 = await event("lvRefresh", state);
  assert.deepEqual(t2.out.state.lvTried, { "v.events": true });
  state = { ...state, ...t2.out.state };
  v = await draw(state);
  assert.deepEqual(timers(v), []);
  assert.equal(offline(v), false);
  assert.equal(refreshed(), 15, "every stale list refreshed");
});

// ── contract-1: the Fútbol clock tick revalidates the matches within 4 s ──

test("clock tick: the matches revalidation stays within 4 s, even with GitHub hanging on both hops", async () => {
  fresh();
  const legacyM = { generatedAt: 1, matches: [{ matchName: "L", gameTime: "2026-11-16 15:00", team_a: { teamName: "A" }, team_b: { teamName: "B" } }] };
  vk.setRoute((url) => (url.endsWith("index.json") ? { ms: 50, res: res(404, "") } : { ms: 50, res: res(200, JSON.stringify(legacyM), { etag: '"m1"' }) }));
  beginCall();
  await vk.run(() => data.revalidate({ matches: true }));
  assert.ok(data.matches());
  for (const skip of [31 * M, 6 * 60 * M]) {   // Release due (index still missing); then the index probe due too
    vk.advance(skip);
    vk.setRoute((url) => ({ hang: true, hops: url.startsWith(RELEASE_BASE) ? 2 : 1 }));   // the Release redirects once
    const { heldMs, reqs } = await event("clock", { nav: "deportes" });
    assert.ok(reqs.length >= 1, "it did revalidate");
    for (const r of reqs) assert.ok(r.t <= 4000 && r.at <= 4000, JSON.stringify(r));
    assert.ok(heldMs <= 4500, "held " + heldMs + " ms (was up to ~10 s) " + JSON.stringify(reqs));
  }
});

// ── contract-2: lcFill fills one source per tick ──

test("lcFill: one network source per tick (≤ 4 s each), the timer keeps going while sources are missing", async () => {
  fresh();
  const slow = (id) => ({
    id, name: id, genre: "otros", calls: 0,
    async categories(ctx) {
      this.calls++;
      for (const step of ["a", "b", "c"]) await ctx.fetch(`https://${id}.test/${step}`, { timeoutMs: 8000 });
      return [{ id: "x", title: id }];
    },
    async channels() { return []; }, async resolve() { return null; },
  });
  const srcs = [slow("supertv"), slow("premiumtv"), slow("deportv")];
  live._setSources([tvenvivo(), ...srcs]);
  vk.setRoute(() => ({ ms: 3900, res: res(200, "{}") }));
  let state = { nav: "vivo" };
  for (let tick = 1; tick <= 3; tick++) {
    const { out, heldMs, reqs } = await event("lcFill", state);
    assert.ok(heldMs <= 5000, "tick " + tick + " held " + heldMs + " ms (was up to ~9 s for all sources)");
    for (const r of reqs) assert.ok(r.t <= 4000 && r.at <= 4000, JSON.stringify(r));
    assert.deepEqual(srcs.map((s) => s.calls), srcs.map((_, i) => (i < tick ? 1 : 0)), "one source per tick, in order");
    assert.equal(out.state.lcN, tick);
    assert.equal(out.state.lcTried, tick === 3 ? true : undefined, "stops once none is left");
    assert.deepEqual(out.state.ui, { hidden: { busy: true } });
    state = { ...state, ...out.state };
  }
  // a fast source: its categories arrive in the tick, which asks for a redraw
  fresh();
  const quick = slow("cncverse");
  live._setSources([tvenvivo(), quick]);
  vk.setRoute(() => ({ ms: 100, res: res(200, "{}") }));
  const { out } = await event("lcFill", { nav: "vivo" });
  assert.ok(out.state.lcRev > 0);
  assert.equal(out.state.lcTried, true);
});

test("lcFill stops after 8 ticks in one opening, whatever is left; Recargar resets the count", async () => {
  fresh();
  const many = Array.from({ length: 12 }, (_, i) => scraper("s" + i));
  live._setSources([tvenvivo(), ...many]);
  vk.setRoute(() => ({ ms: 50, res: res(503, "") }));
  const { out } = await event("lcFill", { nav: "vivo", lcN: 7 });
  assert.equal(out.state.lcN, 8);
  assert.equal(out.state.lcTried, true);
  const reload = await event("reloadVivo", { nav: "vivo", lcN: 8, lcTried: true });
  assert.equal(reload.out.state.lcN, null);
  assert.equal(reload.out.state.lcTried, null);
});

// ── contract-3 / cache-8: the backend /section fallback is bounded by the call's budget ──

test("open with nothing stored, GitHub and the backend hanging: answers catFail within 17 s; tab waits ≤ 8 s, once a minute", async () => {
  fresh();
  vk.setRoute((url) => (url.includes("/section/") || url.startsWith(DATA_BASE) || url.startsWith(RELEASE_BASE) ? { hang: true, hops: url.startsWith(RELEASE_BASE) ? 2 : 1 } : undefined));
  const open = await event("open", {});
  assert.ok(open.heldMs < 17000, "open held " + open.heldMs + " ms (Kino cuts screenEvent at 20 s)");
  assert.equal(open.out.state.catFail, true);
  assert.equal(open.out.state.matFail, true);
  for (const r of open.reqs) assert.ok(r.at + r.t * (r.path.startsWith(RELEASE_BASE) ? 2 : 1) <= 16500, JSON.stringify(r));

  const tab = await event("tab", {}, "series");
  const section = tab.reqs.filter((r) => r.path.includes("/section/"));
  assert.equal(section.length, 1);
  assert.ok(section[0].t <= 8000, "fallback timeout " + section[0].t);
  assert.ok(tab.heldMs <= 8000, "tab held " + tab.heldMs);
  assert.deepEqual(tab.out, { state: { tab: "series", fTag: "" } });

  const again = await event("tab", {}, "series");
  assert.equal(again.reqs.length, 0, "a failed fallback is not asked again within a minute");
  vk.advance(61_000);
  const later = await event("tab", {}, "series");
  assert.equal(later.reqs.filter((r) => r.path.includes("/section/")).length, 1);
});

test("open: the fallback still runs when GitHub fails fast (time left), bounded at 8 s", async () => {
  fresh();
  vk.setRoute((url) => (url.includes("/section/") ? { hang: true } : { ms: 100, res: res(503, "") }));
  const open = await event("open", {});
  const section = open.reqs.filter((r) => r.path.includes("/section/"));
  assert.equal(section.length, 1);
  assert.ok(section[0].t <= 8000);
  assert.ok(open.heldMs <= 9000, "held " + open.heldMs);
  assert.equal(open.out.state.catFail, true);
  // a home.json the fallback is never needed for: the catalog stored, no /section at all
  fresh();
  vk.setRoute((url) => (url.endsWith("index.json") ? { ms: 50, res: res(404, "") }
    : url.endsWith("home.json") ? { ms: 50, res: res(200, JSON.stringify({ ...legacyHome, generatedAt: 1 }), { etag: '"e"' }) }
      : { ms: 50, res: res(503, "") }));
  const ok = await event("open", {});
  assert.equal(ok.reqs.filter((r) => r.path.includes("/section/")).length, 0);
  assert.ok(ok.out.state.rev);
});
