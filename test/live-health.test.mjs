// What live resolves learn on the device (src/liveStore.js o2:lh) and how it orders a merged channel's members
// (src/live.js playCandidates), on a virtual clock (test/helpers/virtual-kino.mjs): Kino reads a call's answer only once
// every request of it has settled, so `heldMs` is what the person waits for the stream. Measured 2026-11-17 on the
// emulator: a merged Deportes channel took 4.8 s with tvenvivo (a scraper, ~660 KB player page) first, while its
// supertv / premiumtv copies play with no request.
import { test } from "node:test";
import assert from "node:assert/strict";
import { res } from "./helpers/fake-kino.mjs";
import { installVirtualKino } from "./helpers/virtual-kino.mjs";

const vk = installVirtualKino({ storage: { "o2:bearer": "bearer-token" } });
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");

const M = 60_000;
const PLAYLIST = "#EXTM3U\n#EXT-X-VERSION:3\n";

/** A scraper (needs the network): its resolve asks a core page (300 ms) then a player page (`pageMs`, or hangs). */
function scraper(id, o = {}) {
  return {
    id, name: id, genre: "deportes", codeCategories: true,
    async categories() { return [{ id: "d", title: "Deportes" }]; },
    async channels() { return []; },
    async resolve(raw, ctx) {
      if (o.fail) {
        await ctx.fetch(`https://${id}.test/core/${raw}`, { timeoutMs: 8000 });
        throw Object.assign(new Error(id + ": " + o.fail), o.code ? { code: o.code } : {});
      }
      const core = await ctx.fetch(`https://${id}.test/core/${raw}`, { timeoutMs: 8000 });
      if (!core.ok) throw new Error("core " + core.status);
      const page = await ctx.fetch(`https://${id}.test/page/${raw}`, { timeoutMs: 12000 });
      if (!page.ok) throw new Error("page " + page.status);
      return { url: `https://${id}-cdn.test/play/${raw}.m3u8` };
    },
  };
}

/** A copy that needs no request (an M3U line, an Xtream stream): `blind`; `acct` names its account by the raw id's prefix. */
function blind(id, o = {}) {
  return {
    id, name: id, genre: "deportes", codeCategories: true, blind: true,
    ...(o.acct ? { accountOf: (raw) => String(raw).split("-")[0] } : {}),
    async categories() { return [{ id: "d", title: "Deportes" }]; },
    async channels() { return []; },
    async resolve(raw) { return { url: `https://${id}-cdn.test/live/${raw}.m3u8`, mime: "application/vnd.apple.mpegurl" }; },
  };
}

/**
 * Routes: a scraper's core page 300 ms, its player page `page[id]` ms (Infinity: hangs); a copy's playlist answers in
 * `slowMs[raw]` (else 200 ms; a `dead` one: 404, else `deadMs`).
 */
function routes({ page = {}, dead = new Set(), slowMs = {}, deadMs = 200 } = {}) {
  vk.setRoute((url) => {
    const u = new URL(url);
    const host = u.hostname;
    if (host.endsWith("-cdn.test")) {
      const raw = u.pathname.split("/").pop().replace(".m3u8", "");
      if (dead.has(raw)) return { ms: slowMs[raw] || deadMs, res: res(404, "") };
      return { ms: slowMs[raw] || 200, res: res(200, PLAYLIST) };
    }
    const id = host.replace(".test", "");
    if (u.pathname.startsWith("/core/")) return { ms: 300, res: res(200, "<iframe>") };
    const ms = page[id] == null ? 500 : page[id];
    return ms === Infinity ? { hang: true } : { ms, res: res(200, "<script>var src</script>") };
  });
}

/** A device: an empty store (with a Bearer) and a cold runtime. */
async function device() {
  vk.clearStore();
  vk.store.set("o2:bearer", "bearer-token");
  vk.reset();
  ls._resetMemory();
  await clearBearer();
  vk.store.set("o2:bearer", "bearer-token");
}

/** One plugin call of `fn` on the virtual clock → `{ out, heldMs, reqs: [{ url, at, t }] }`. */
async function call(fn) {
  vk.reset();
  beginCall();
  const t0 = vk.now();
  const out = await vk.run(fn);
  return { out, heldMs: vk.now() - t0, reqs: vk.requests.map((r) => ({ url: r.url, at: r.at - t0, t: r.timeoutMs })) };
}
const resolve = (ref) => call(() => live.resolveLive(ref));
const playedRaw = (out) => out.url.split("/").pop().replace(".m3u8", "");
const paths = (r) => r.reqs.map((x) => new URL(x.url).hostname.replace(".test", "") + new URL(x.url).pathname);

test.afterEach(() => live._setSources(null));

test("a scraper first while a copy that needs no request waits: 4.5 s, not the 12 s it got; cut by it, it is not demoted, its time is noted, the copy plays", async () => {
  live._setSources([scraper("tvenvivo"), blind("premiumtv")]);
  await device();
  routes({ page: { tvenvivo: Infinity } });
  const r = await resolve("M:tvenvivo:espn,premiumtv:e1");
  assert.equal(playedRaw(r.out), "e1");
  assert.ok(r.heldMs <= 4_600, "held " + r.heldMs + " ms (the first member got 12 s when every later one needs no request)");
  const page = r.reqs.find((x) => x.url.includes("/page/"));
  assert.ok(page.t <= 4_500 - 300, "the player page is cut at the share: t=" + page.t);
  assert.equal(ls.demotedAt("L:tvenvivo:espn"), 0, "no evidence it is dead: not demoted");
  assert.ok(ls.sourceStats("tvenvivo").ms >= 4_000, "its time is noted: " + ls.sourceStats("tvenvivo").ms);
  assert.ok(vk.logs.some((l) => /tvenvivo cut after \d+ ms \(a copy with no request waits\)/.test(l)), vk.logs.join("\n"));
  // with no such copy, its share stays 10 s, and a member that hangs that long is demoted as before
  live._setSources([scraper("tvenvivo"), scraper("cablevisionhd")]);
  const r2 = await resolve("M:tvenvivo:fox,cablevisionhd:fox-ver");
  assert.equal(playedRaw(r2.out), "fox-ver");
  assert.ok(r2.reqs.find((x) => x.url.includes("tvenvivo.test/page/")).t > 9_000);
  assert.ok(ls.demotedAt("L:tvenvivo:fox") > 0);
});

test("the cost lane: without evidence the order stays; tvenvivo measured slow, a copy is probed beside it; once that copy's source answered, it plays first", async () => {
  live._setSources([scraper("tvenvivo"), blind("premiumtv")]);
  await device();
  routes({ page: { tvenvivo: 2_000 } });
  // a first open on a new device: tvenvivo first, as composed (no evidence), 2 requests
  const a = await resolve("M:tvenvivo:a,premiumtv:a1,premiumtv:a2");
  assert.equal(playedRaw(a.out), "a");
  assert.deepEqual(paths(a), ["tvenvivo/core/a", "tvenvivo/page/a"]);
  assert.ok(ls.sourceStats("tvenvivo").ms >= 2_000, "tvenvivo took " + ls.sourceStats("tvenvivo").ms + " ms here");
  // the next channel: tvenvivo is slow here (evidence) but no copy is known to play: tvenvivo first, and the first copy
  // after it is probed beside it (it ends well before: the answer waits no longer)
  const b = await resolve("M:tvenvivo:b,premiumtv:b1,premiumtv:b2");
  assert.equal(playedRaw(b.out), "b");
  assert.deepEqual(paths(b).sort(), ["premiumtv-cdn/live/b1.m3u8", "tvenvivo/core/b", "tvenvivo/page/b"]);
  const probe = b.reqs.find((x) => x.url.includes("/live/b1"));
  assert.equal(probe.at, 0, "beside tvenvivo, from its start");
  assert.ok(b.reqs.find((x) => x.url.includes("/page/b")).t > 3_000, "tvenvivo's own share is not cut by the probe");
  assert.ok(b.heldMs < 2_500, "held " + b.heldMs);
  assert.ok(ls.probeOkAt("L:premiumtv:b1") > 0);
  // the next channel: premiumtv's playlists answer here, tvenvivo is slow: the copy plays first, tvenvivo is never asked
  const c = await resolve("M:tvenvivo:c,premiumtv:c1,premiumtv:c2");
  assert.equal(playedRaw(c.out), "c1");
  assert.deepEqual(paths(c), ["premiumtv-cdn/live/c1.m3u8"], "one probe, no scraper request");
  assert.ok(c.heldMs <= 300, "held " + c.heldMs);
  assert.ok(vk.logs.some((l) => /a ready copy with no request first \(premiumtv before tvenvivo: slow here\)/.test(l)), vk.logs.join("\n"));
  assert.deepEqual(c.out.alternatives.map((x) => x.ref), ["L:premiumtv:c2", "L:tvenvivo:c"], "the alternatives in play order");
  // a member with no evidence against it never moves: a scraper of unknown speed stays before the ready copy
  live._setSources([scraper("tvenvivo"), scraper("cablevisionhd"), blind("premiumtv")]);
  const d = await resolve("M:cablevisionhd:d-ver,tvenvivo:d,premiumtv:d1");
  assert.equal(playedRaw(d.out), "d-ver", "cablevisionhd (unknown here) keeps its place");
});

test("a playlist that answered a probe within 5 min plays unprobed; the suspect of a re-resolve is probed; past 5 min it is probed again", async () => {
  live._setSources([blind("premiumtv")]);
  await device();
  routes();
  const ref = "M:premiumtv:x1,premiumtv:x2";
  assert.equal((await resolve(ref)).reqs.length, 1, "the first open probes it");
  vk.advance(2 * M);
  const again = await resolve(ref);
  assert.equal(playedRaw(again.out), "x1");
  assert.equal(again.reqs.length, 0, "answered 2 min ago: plays unprobed");
  assert.ok(vk.logs.some((l) => /premiumtv unprobed \(its playlist answered 120 s ago\)/.test(l)), vk.logs.join("\n"));
  vk.advance(3_000);   // Kino's reopen right after a cut: the member it played is the suspect, always checked
  assert.equal((await resolve(ref)).reqs.length, 1);
  vk.advance(6 * M);
  assert.equal((await resolve(ref)).reqs.length, 1, "past 5 min: probed again");
});

test("a resolve writes nothing before its answer; Kino's next live call writes what it learned; a cold runtime then starts from it", async () => {
  live._setSources([blind("premiumtv")]);
  await device();
  routes({ dead: new Set(["y1"]) });
  const ref = "M:premiumtv:y1,premiumtv:y2,premiumtv:y3";
  const before = new Map(vk.store);
  const first = await resolve(ref);
  assert.equal(playedRaw(first.out), "y2");
  assert.deepEqual([...vk.store.keys()].sort(), [...before.keys()].sort(), "no key written by the resolve");
  assert.equal(vk.store.get(ls.LH_KEY), undefined);
  // the zapping preheat right after (another resolve): it carries what the first one learned, still writing nothing
  await resolve("M:premiumtv:z1,premiumtv:z2");
  assert.equal(vk.store.get(ls.LH_KEY), undefined, "a resolve never writes what an earlier one left");
  // Kino's next live call that is not a resolve (here its liveCategories) writes the live health
  await call(() => live.liveCategories());
  const saved = JSON.parse(vk.store.get(ls.LH_KEY));
  assert.equal(Object.keys(saved.m).length, 3, "y1's demotion, y2's and z1's answered probes");
  assert.equal(saved.s.premiumtv.fn, 0, "y2 answered after y1 was found dead");
  // a cold runtime: y1 stays demoted (tried last), y2 answered a minute ago: 0 requests
  ls._resetMemory();
  vk.advance(M);
  const cold = await resolve(ref);
  assert.equal(playedRaw(cold.out), "y2");
  assert.equal(cold.reqs.length, 0);
  assert.ok(ls.demotedAt("L:premiumtv:y1") > 0);
  // a runtime discarded before such a call forgot it: the dead copy is probed again first
  await device();
  routes({ dead: new Set(["y1"]) });
  await resolve(ref);
  ls._resetMemory();
  vk.advance(M);
  assert.deepEqual(paths(await resolve(ref)), ["premiumtv-cdn/live/y1.m3u8", "premiumtv-cdn/live/y2.m3u8"]);
});

test("after a failure in a resolve, the next copies are probed at once, one per account; copies on one account wait their turn", async () => {
  live._setSources([blind("supertv", { acct: true }), blind("premiumtv")]);
  await device();
  routes({ dead: new Set(["A-1", "A-2"]), slowMs: { "A-2": 800 }, deadMs: 300 });
  // A-1 dead → A-2's probe, and beside it p1's (another account); p2, the last one, is never probed
  const r = await resolve("M:supertv:A-1,supertv:A-2,premiumtv:p1,premiumtv:p2");
  assert.equal(playedRaw(r.out), "p1");
  const at = (q) => q.reqs.map((x) => [x.url.split("/").pop(), x.at]).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
  assert.deepEqual(at(r), [["A-1.m3u8", 0], ["A-2.m3u8", 300], ["p1.m3u8", 300]]);
  assert.equal(r.heldMs, 1_100, "A-1 (300) then A-2 and p1 together (800); one after the other: 1,300");
  // every copy on one account: one probe at a time (an Xtream account's connection limit); the account passed over,
  // the copy on another one plays (A-3 is never probed)
  await device();
  routes({ dead: new Set(["A-1", "A-2"]), deadMs: 300 });
  const one = await resolve("M:supertv:A-1,supertv:A-2,supertv:A-3,premiumtv:q1");
  assert.equal(playedRaw(one.out), "q1");
  assert.deepEqual(at(one), [["A-1.m3u8", 0], ["A-2.m3u8", 300], ["q1.m3u8", 600]]);
  // a healthy first copy: one probe, nothing beside it
  await device();
  routes();
  const ok = await resolve("M:supertv:A-1,premiumtv:p1,premiumtv:p2");
  assert.deepEqual(ok.reqs.map((x) => x.url.split("/").pop()), ["A-1.m3u8"]);
});

test("a scraper cut by the shorter share is no failure: the next copy is probed alone, never beside a copy whose host hangs", async () => {
  live._setSources([scraper("tvenvivo"), blind("supertv", { acct: true }), blind("premiumtv")]);
  await device();
  // p1's host never answers in time: probed beside A-1 it would hold the answer until its 2.5 s timeout (7,000 ms)
  routes({ page: { tvenvivo: Infinity }, slowMs: { p1: 10_000 } });
  const r = await resolve("M:tvenvivo:e,supertv:A-1,premiumtv:p1,premiumtv:p2");
  assert.equal(playedRaw(r.out), "A-1");
  assert.deepEqual(paths(r), ["tvenvivo/core/e", "tvenvivo/page/e", "supertv-cdn/live/A-1.m3u8"]);
  assert.equal(r.heldMs, 4_700, "the 4.5 s share, then A-1's probe alone");
});

test("the failing tier: a source whose last two resolves failed here goes after the healthy members; one success brings it back; a channel off the air never counts", async () => {
  live._setSources([scraper("tvenvivo", { fail: "no stream in the page" }), scraper("cablevisionhd")]);
  await device();
  routes();
  for (const ch of ["a", "b"]) assert.equal(playedRaw((await resolve(`M:tvenvivo:${ch},cablevisionhd:${ch}-ver`)).out), ch + "-ver");
  assert.equal(ls.sourceStats("tvenvivo").fn, 2);
  const c = await resolve("M:tvenvivo:c,cablevisionhd:c-ver");
  assert.equal(playedRaw(c.out), "c-ver");
  assert.ok(!c.reqs.some((x) => x.url.includes("tvenvivo")), "tvenvivo goes after: never asked");
  // 30 min later it is tried first again; one success clears the count
  vk.advance(31 * M);
  live._setSources([scraper("tvenvivo"), scraper("cablevisionhd")]);
  assert.equal(playedRaw((await resolve("M:tvenvivo:d,cablevisionhd:d-ver")).out), "d");
  assert.equal(ls.sourceStats("tvenvivo").fn, 0);
  // off the air (code "offline": a channel's state, not the source's) never counts
  live._setSources([scraper("tvenvivo", { fail: "sin señal", code: "offline" }), scraper("cablevisionhd")]);
  for (const ch of ["e", "f", "g"]) await resolve(`M:tvenvivo:${ch},cablevisionhd:${ch}-ver`);
  assert.equal(ls.sourceStats("tvenvivo").fn, 0);
});

test("liveStore: the live health merges with a copy another runtime wrote since (the later change wins) and drops what says nothing", async () => {
  await device();
  beginCall();
  ls.demote("L:premiumtv:m1", 10 * M);
  ls.noteAnswer("tvenvivo", 2_000);
  // meanwhile another runtime wrote its own entries (a later change of tvenvivo, an old member, an expired redirect)
  const t = vk.now();
  vk.store.set(ls.LH_KEY, JSON.stringify({ v: 1, s: { tvenvivo: { at: t + 1, ms: 900, n: 3, ok: t + 1, fn: 0, t: t + 1 }, xuper: { at: t, ms: 4000, n: 1, t } },
    m: { "old.member": { ok: t - 3 * 60 * M, t: t - 3 * 60 * M } }, r: { "old.redirect": t - 7 * 60 * M } }));
  vk.advance(5);
  beginCall();
  ls.flushMeta();
  const h = JSON.parse(vk.store.get(ls.LH_KEY));
  assert.equal(h.s.tvenvivo.ms, 900, "the other runtime's later change wins");
  assert.equal(h.s.xuper.ms, 4000, "an entry only it has is kept");
  assert.ok(!("old.member" in h.m), "a member with neither a recent probe nor a demotion goes");
  assert.deepEqual(h.r, {}, "a redirect older than 6 h goes");
  assert.equal(Object.keys(h.m).length, 1, "this runtime's demotion is kept");
  // a cold runtime reads it
  ls._resetMemory();
  beginCall();
  assert.ok(ls.demotedAt("L:premiumtv:m1") > 0);
  assert.equal(ls.sourceStats("tvenvivo").ms, 900);
});
