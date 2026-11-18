// 1.0.46: secondary panels in src/live.js with fake connectors: the screen's notes, the stream probe's block page, and
// the panel hop of a merged channel's resolve. A fake "supertv" plays every channel `<account>-<n>` from that account;
// "supertv2" is a secondary panel of it (`secondaryOf`, `accountOf`, `active`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { decodeRef } = await import("../src/refs.js");

const M = 60_000, H = 60 * M;
const sha16 = (t) => createHash("sha1").update(t, "utf8").digest("hex").slice(0, 16);
const PLAYLIST = "#EXTM3U\n#EXTINF:6,\na.ts\n";
const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return ""; } };

async function device(opts = {}) {
  const k = installKino({ ...opts, storage: { ...(opts.storage || {}), "o2:bearer": "bearer-token" } });
  await clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  k.writes.length = 0;
  ls._resetMemory();
  beginCall();
  return k;
}

/** A fake Xtream-like source: channel `<acct>-<n>` plays `http://<acct>.test/live/<acct>-<n>.m3u8`. */
function panel(id, o = {}) {
  const calls = { channels: [] };
  return {
    id, name: o.name || id, genre: "deportes", blind: true, calls,
    accountOf: (raw) => String(raw).split("-")[0] || null,
    ...(o.secondaryOf ? { secondaryOf: o.secondaryOf, active: () => o.active !== false } : {}),
    async categories() { return o.cats || []; },
    async channels(cat, ctx) {
      calls.channels.push(cat);
      const r = await ctx.fetch(`http://${id}.test/list/${cat}`, { timeoutMs: 8000 });
      if (!r.ok) throw new Error("list " + r.status);
      return (o.lists && o.lists[cat]) || [];
    },
    async resolve(raw) { const acct = String(raw).split("-")[0]; return { url: `http://${acct}.test/live/${raw}.m3u8`, mime: "application/vnd.apple.mpegurl" }; },
  };
}

function storedLive({ registry = {}, lists = {} } = {}) {
  const now = Date.now();
  const st = {};
  const lc = { v: 1, src: {} }, lm = { v: 1, c: {}, l: {} };
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
const PRIM_CATS = [{ id: "1", title: "ES ▎DAZN" }];
const SEC_CATS = [{ id: "9", title: "ESPAÑA DAZN" }];
const PRIM = [{ id: "A-1", title: "ES ▎DAZN 1 FHD" }, { id: "A-2", title: "ES ▎DAZN 1 HD" }, { id: "A-3", title: "ES ▎DAZN 2 FHD" }];
const SEC = [{ id: "B-1", title: "DAZN 1 FHD" }, { id: "B-7", title: "DAZN PREMIER 1 FHD" }];
const membersOf = (c) => (c.ref.startsWith("M:") ? decodeRef(c.ref).members.map((m) => m.ref) : [c.ref]);

test.afterEach(() => live._setSources(null));

test("a secondary panel joins only beside its primary: 'Deportes · España' merges both; nothing else is exposed for it", async () => {
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);
  await device({ noFetch: true, storage: storedLive({ registry: { supertv: PRIM_CATS, supertv2: SEC_CATS },
    lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) }, [key("supertv2", "9")]: { items: norm("supertv2", SEC) } } }) });
  assert.deepEqual((await live.liveCategories()).map((c) => c.id), ["v.sp.es"]);
  const page = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.deepEqual(page.items.map((c) => c.title), ["DAZN 1 FHD", "DAZN 2 FHD"], "DAZN PREMIER 1, only the other panel's, is not listed");
  assert.deepEqual(membersOf(page.items[0]), ["L:supertv:A-1", "L:supertv:A-2", "L:supertv2:B-1"]);
  // a secondary source without an account (`active()` false) is left out at once, 0 requests
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS, active: false })]);
  beginCall();
  const alone = await live.liveChannels({ categoryId: "v.sp.es", cursor: null });
  assert.deepEqual(alone.items.map((c) => c.ref), ["M:supertv:A-1,supertv:A-2", "L:supertv:A-3"]);
});

test("the screen's notes follow the primary: a stale or failing secondary list never shows 'stale' or the offline note; a missing one keeps the tick going", async () => {
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);
  const now = Date.now();
  await device({ noFetch: true, storage: storedLive({ registry: { supertv: PRIM_CATS, supertv2: SEC_CATS },
    lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) }, [key("supertv2", "9")]: { items: norm("supertv2", SEC), at: now - 8 * H, failAt: now - M } } }) });
  const r = await live.screenList("v.sp.es");
  assert.deepEqual([r.stale, r.failed, r.refreshable, r.partial], [false, false, 0, false]);
  assert.equal(r.items.length, 2);
  await device({ noFetch: true, storage: storedLive({ registry: { supertv: PRIM_CATS, supertv2: SEC_CATS }, lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) } } }) });
  const missing = await live.screenList("v.sp.es");
  assert.equal(missing.partial, true, "the lvRefresh tick loads the missing secondary list");
  assert.equal(missing.stale, false);
});

test("the probe: a playlist redirected to the ISP's block page (coljuegos.gov.co) is dead: the next copy plays at the first open", async () => {
  live._setSources([panel("supertv"), panel("supertv2", { secondaryOf: "supertv" })]);
  const k = await device({ routes: [(u) => (hostOf(u) === "a.test" ? res(302, "", { Location: "https://www.coljuegos.gov.co/publicaciones/301824" }) : res(200, PLAYLIST))] });
  const out = await live.resolveLive("M:supertv:A-1,supertv2:B-1");
  assert.equal(out.url, "http://B.test/live/B-1.m3u8");
  assert.ok(ls.demotedAt("L:supertv:A-1") > 0);
  assert.ok(!k.requests.some((r) => hostOf(r.url) === "www.coljuegos.gov.co"), "the block page is never requested");
  // any other redirect still cannot tell (it plays, as 1.0.45)
  await device({ routes: [(u) => (hostOf(u) === "a.test" ? res(302, "", { Location: "http://185.1.2.3/x.m3u8" }) : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive("M:supertv:A-1,supertv2:B-1")).url, "http://A.test/live/A-1.m3u8");
});

test("a refused copy refuses that member only: the same account's next copy plays; two refused copies pass the account over; a secondary panel's copy comes after the others", async () => {
  live._setSources([panel("supertv"), panel("supertv2", { secondaryOf: "supertv" })]);
  const proxyAuth = () => Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" });
  const ref = "M:supertv:A-1,supertv:A-2,supertv2:B-1,supertv2:B-2";
  // one stream refused (the phone: 407 on one stream while the next plays): the next copy on that account
  let k = await device({ routes: [(u) => (u.includes("A-1") ? proxyAuth() : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive(ref)).url, "http://A.test/live/A-2.m3u8");
  assert.deepEqual(k.requests.map((r) => hostOf(r.url)), ["a.test", "a.test"]);
  assert.ok(ls.demotedAt("L:supertv:A-1") > 0 && ls.demotedAt("L:supertv:A-2") === 0);
  // every stream of the account refused: two strikes pass it over, the other panel's copy plays
  k = await device({ routes: [(u) => (hostOf(u) === "a.test" ? proxyAuth() : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive(ref)).url, "http://B.test/live/B-1.m3u8");
  assert.deepEqual(k.requests.map((r) => hostOf(r.url)), ["a.test", "a.test", "b.test"]);
  // no refusal: the first member plays (one probe), nothing demoted
  k = await device({ routes: [() => res(200, PLAYLIST)] });
  assert.equal((await live.resolveLive(ref)).url, "http://A.test/live/A-1.m3u8");
  assert.equal(ls.demotedAt("L:supertv:A-1"), 0);
  // a secondary panel's copy listed before one of the others still comes after it (failover)
  k = await device({ routes: [(u) => (u.includes("A-1") ? res(404, "") : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive("M:supertv:A-1,supertv2:B-1,supertv:A-2")).url, "http://A.test/live/A-2.m3u8");
});

test("Kino's chain of reopens: the demoted member is one strike: its account's next copy plays before another panel's; the suspect found dead and a second refusal pass the account over", async () => {
  live._setSources([panel("supertv"), panel("supertv2", { secondaryOf: "supertv" })]);
  const ref = "M:supertv:A-1,supertv:A-2,supertv2:B-1";
  const clock = { now: Date.now() };
  const realNow = Date.now;
  Date.now = () => clock.now;
  try {
    // every playlist answers a redirect (unknown: plays), as supertv's panels do
    let k = await device({ routes: [() => res(302, "", { Location: "http://10.0.0.1/x.m3u8" })] });
    assert.equal((await live.resolveLive(ref)).url, "http://A.test/live/A-1.m3u8");
    clock.now += 3000; beginCall();
    assert.equal((await live.resolveLive(ref)).url, "http://A.test/live/A-1.m3u8", "the suspect cannot be probed (it redirected): it plays again");
    clock.now += 5000; beginCall();
    const third = await live.resolveLive(ref);
    assert.equal(third.url, "http://A.test/live/A-2.m3u8", "streak 2: A-1 demoted; the account's next copy, not the other panel's");
    assert.ok(k.logs.some((l) => /in a row\) → the member it played is demoted/.test(l)));
    // the suspect re-checked and found dead, then the account's next copy refused too: the other panel plays
    let refuseA = false;
    k = await device({ routes: [(u) => (hostOf(u) === "a.test" && refuseA ? res(503, "") : res(200, PLAYLIST))] });
    const ref2 = "M:supertv:A-5,supertv:A-6,supertv2:B-5";
    assert.equal((await live.resolveLive(ref2)).url, "http://A.test/live/A-5.m3u8");
    refuseA = true;
    clock.now += 4000; beginCall();
    k.requests.length = 0;
    assert.equal((await live.resolveLive(ref2)).url, "http://B.test/live/B-5.m3u8");
    assert.deepEqual(k.requests.map((r) => r.url.split("/").pop()), ["A-5.m3u8", "A-6.m3u8"], "B-5, the last one left, plays unprobed");
    assert.ok(ls.demotedAt("L:supertv:A-5") > 0 && ls.demotedAt("L:supertv:A-6") > 0);
  } finally { Date.now = realNow; }
});

test("an M: ref whose members all play from one account also tries the same channel on other panels from the stored lists (0 lookup requests)", async () => {
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);
  const st = storedLive({ registry: { supertv: PRIM_CATS, supertv2: SEC_CATS },
    lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) }, [key("supertv2", "9")]: { items: norm("supertv2", SEC) } } });
  const proxyAuth = () => Object.assign(new Error("network error: (407)"), { code: "network" });
  const k = await device({ storage: st, routes: [(u) => (hostOf(u) === "a.test" ? proxyAuth() : res(200, PLAYLIST))] });
  // a favourite kept from before the other panel was listed: two copies on account A, both refused
  const out = await live.resolveLive("M:supertv:A-1,supertv:A-2");
  assert.equal(out.url, "http://B.test/live/B-1.m3u8");
  assert.ok(k.logs.some((l) => /every member failed, trying 1 stored copies on other accounts/.test(l)), k.logs.join("\n"));
  assert.ok(!k.requests.some((r) => r.url.includes("/list/")), "no list request to find it");
  assert.deepEqual(k.requests.map((r) => hostOf(r.url)), ["a.test", "a.test"], "A-2 (the same account) first");
  // three copies on A: once two are refused the third is on an account passed over, so the other panel's copy is
  // looked up then and plays on its probe's ok, before A-3
  k.requests.length = 0; k.logs.length = 0;
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);
  ls._resetMemory(); beginCall();
  assert.equal((await live.resolveLive("M:supertv:A-1,supertv:A-2,supertv:A-3")).url, "http://B.test/live/B-1.m3u8");
  assert.ok(k.logs.some((l) => /every member on one account; \+ 1 on other panels/.test(l)), k.logs.join("\n"));
  assert.deepEqual(k.requests.map((r) => hostOf(r.url)), ["a.test", "a.test", "b.test"]);
  // a single old L: favourite finds it the same way once it fails (1.0.45's siblings)
  const k2 = await device({ storage: st, routes: [(u) => (hostOf(u) === "a.test" ? res(404, "") : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive("L:supertv:A-3")).url, "http://A.test/live/A-3.m3u8", "an L: ref plays itself first (no probe: 1.0.45)");
  assert.equal(k2.requests.length, 0);
});

test("an M: ref whose members all play from one account: a first open or a preheat that plays composes nothing (no stored list read); a refusal does", async () => {
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);
  const st = storedLive({ registry: { supertv: PRIM_CATS, supertv2: SEC_CATS },
    lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) }, [key("supertv2", "9")]: { items: norm("supertv2", SEC) } } });
  const k = await device({ storage: st, routes: [() => res(200, PLAYLIST)] });
  const reads = [];
  const get = k.kino.storage.get;
  k.kino.storage.get = (key) => { if (String(key).startsWith("o2:ll:")) reads.push(key); return get(key); };
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);   // a cold runtime
  assert.equal((await live.resolveLive("M:supertv:A-1,supertv:A-2")).url, "http://A.test/live/A-1.m3u8");
  beginCall();
  assert.equal((await live.resolveLive("M:supertv:A-1,supertv:A-2")).url, "http://A.test/live/A-1.m3u8", "the zapping preheat");
  assert.deepEqual(reads, [], "no stored list read: the category is not composed");
  // its account refused (both copies): the other panel's copy is looked up then (0 requests) and plays
  live._setSources([panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })]);
  const k2 = await device({ storage: st, routes: [(u) => (hostOf(u) === "a.test" ? res(403, "") : res(200, PLAYLIST))] });
  assert.equal((await live.resolveLive("M:supertv:A-1,supertv:A-2")).url, "http://B.test/live/B-1.m3u8");
  assert.deepEqual(k2.requests.map((r) => hostOf(r.url)), ["a.test", "a.test"]);
});

test("review D1: a one-account favourite whose account is passed over plays the other panel's stored copy before a demoted member of that account, never the demoted one again", async () => {
  const srcs = () => [panel("supertv", { cats: PRIM_CATS }), panel("supertv2", { secondaryOf: "supertv", cats: SEC_CATS })];
  const st = storedLive({ registry: { supertv: PRIM_CATS, supertv2: SEC_CATS },
    lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) }, [key("supertv2", "9")]: { items: norm("supertv2", SEC) } } });
  const proxyAuth = () => Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" });
  const clock = { now: Date.now() };
  const realNow = Date.now;
  Date.now = () => clock.now;
  try {
    // a 1.0.45 favourite (FHD + HD on one account): A-1 redirects (its probe cannot tell), A-2 is refused (407), B-1 plays
    live._setSources(srcs());
    const k = await device({ storage: st, routes: [(u) => (u.includes("A-1") ? res(302, "", { Location: "http://10.0.0.1/x.m3u8" }) : u.includes("A-2") ? proxyAuth() : res(200, PLAYLIST))] });
    const ref = "M:supertv:A-1,supertv:A-2";
    assert.equal((await live.resolveLive(ref)).url, "http://A.test/live/A-1.m3u8", "the open: A-1's redirect cannot tell, it plays");
    clock.now += 3000; beginCall();
    assert.equal((await live.resolveLive(ref)).url, "http://A.test/live/A-1.m3u8", "Kino's first retry: A-1 cannot be re-checked, it plays again");
    // Kino's second retry: A-1 demoted (one strike), A-2 refused (the second): the account is passed over, and the stored
    // copy on the other panel (healthy) comes before the demoted A-1
    clock.now += 5000; beginCall(); k.requests.length = 0; k.logs.length = 0;
    const third = await live.resolveLive(ref);
    assert.equal(third.url, "http://B.test/live/B-1.m3u8");
    assert.deepEqual(k.requests.map((r) => r.url.split("/").pop()), ["A-2.m3u8", "B-1.m3u8"]);
    assert.ok(k.logs.some((l) => /every member on one account; \+ 1 on other panels/.test(l)), k.logs.join("\n"));
    assert.ok(ls.demotedAt("L:supertv:A-1") > 0 && ls.demotedAt("L:supertv2:B-1") === 0);
    // a fresh open within A-1's demotion: three copies on A, A-2 and A-3 refused: B-1 plays, not the demoted A-1
    live._setSources(srcs());
    const k2 = await device({ storage: st, routes: [(u) => (hostOf(u) === "a.test" ? proxyAuth() : res(200, PLAYLIST))] });
    ls.demote("L:supertv:A-1", 10 * M);
    const fresh = await live.resolveLive("M:supertv:A-1,supertv:A-2,supertv:A-3");
    assert.equal(fresh.url, "http://B.test/live/B-1.m3u8");
    assert.deepEqual(k2.requests.map((r) => r.url.split("/").pop()), ["A-2.m3u8", "A-3.m3u8", "B-1.m3u8"]);
  } finally { Date.now = realNow; }
});

test("liveStore: a list's tombstone (an account switch drops its lists) is pruned after a day, not kept for 30", async () => {
  live._setSources([panel("supertv", { cats: PRIM_CATS })]);
  const k = await device({ noFetch: true, storage: storedLive({ registry: { supertv: PRIM_CATS }, lists: { [key("supertv", "1")]: { items: norm("supertv", PRIM) } } }) });
  ls.dropLists("supertv");
  ls.flushMeta();
  assert.equal(JSON.parse(k.store.get("o2:lm")).l[key("supertv", "1")].h, "");
  const lm = JSON.parse(k.store.get("o2:lm"));
  lm.l[key("supertv", "1")].at -= 25 * H;
  lm.l.other = { at: Date.now() - 25 * H, h: "abc", n: 1, w: Date.now() - 25 * H, failAt: 0, failN: 0 };
  k.store.set("o2:lm", JSON.stringify(lm));
  ls._resetMemory();
  beginCall();
  ls.failList("x.1");
  ls.flushMeta();
  const after = JSON.parse(k.store.get("o2:lm")).l;
  assert.equal(after[key("supertv", "1")], undefined, "the day-old tombstone is gone");
  assert.ok(after.other, "a day-old list with text stays (30 d)");
  assert.ok(after["x.1"], "a fresh failure stays");
});
