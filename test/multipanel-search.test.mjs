// 1.0.46: the secondary panels' account search on a virtual clock (test/helpers/virtual-kino.mjs), with the real
// connectors (src/sources/supertv.js): when every candidate panel hangs, a search probes one batch with whole timeouts,
// then backs off and reaches other candidates next; Kino's En vivo never waits for it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { res } from "./helpers/fake-kino.mjs";
import { installVirtualKino } from "./helpers/virtual-kino.mjs";

const vk = installVirtualKino({ storage: { "o2:bearer": "bearer-token" } });
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const stvMod = await import("../src/sources/supertv.js");
const SOURCES = [stvMod.default, stvMod.supertv2, stvMod.supertv3];

const M = 60_000, H = 60 * M;
const PANELS = JSON.parse(readFileSync(new URL("./fixtures/stv-panels.json", import.meta.url), "utf8")).panels;
const BOOT = "vegetatvv2.duckdns.org";
const MAC = ["line.znn8.xyz", "line.zee-ott.xyz", "line.krishkaz.com", "fv99.nesewvp.top:8080", "pp.tresinl.xyz", "capitanhero.com",
  "line.tmpes.com", "ltv.ddns.net:8080", "reborned.cc:8080", "nexotvplus.com:8080", "myultratv.com:8080"];
const PRIMARY = "line.zee-ott.xyz";
const hostOf = (u) => { try { return new URL(u).hostname; } catch (_) { return ""; } };

/** The bootstrap and the primary's panel answer; every other panel hangs. */
function route(url) {
  const u = new URL(url);
  if (u.host === BOOT) {
    const text = MAC.map((h, i) => `http://${h}/get.php?username=u${i}&password=p${i}&type=m3u_plus`).join("\n");
    if (u.searchParams.get("servers") === "1") return { ms: 150, res: res(200, text) };
    return { ms: 150, res: res(200, JSON.stringify({ ok: true, minimum_version_code: 25, latest_version_code: 25, servers_text: "", servers_url: `http://${BOOT}/bootstrap.php?servers=1` })) };
  }
  if (u.pathname === "/player_api.php") {
    if (u.hostname !== PRIMARY) return { hang: true };
    const action = u.searchParams.get("action");
    if (action === "get_live_categories") return { ms: 200, res: res(200, JSON.stringify(PANELS[PRIMARY].map(([category_id, category_name]) => ({ category_id, category_name })))) };
    return { ms: 200, res: res(200, "[]") };
  }
  return { ms: 10, res: res(404, "") };
}

async function call(fn) {
  vk.reset();
  ls._resetMemory();
  await clearBearer();
  vk.store.set("o2:bearer", "bearer-token");
  beginCall();
  const t0 = vk.now();
  const out = await vk.run(fn);
  return { out, heldMs: vk.now() - t0, reqs: vk.requests.map((r) => ({ host: hostOf(r.url), at: r.at, t: r.timeoutMs, probe: /get_live_categories/.test(r.url) })) };
}

test.afterEach(() => live._setSources(null));

test("every candidate panel hangs: each search is one batch of ≤ 5 probes with their whole 3 s, then it backs off and the next one reaches other candidates; En vivo never waits (perf-F1, perf-F2)", async () => {
  live._setSources(SOURCES);
  vk.setRoute(route);
  vk.clearStore();
  await call(() => live.liveCategories());   // first install: the primary (zee-ott), no slot
  const probes = [];   // { host, at } of every candidate probe after the install
  let batches = 0;
  for (let t = 30 * M; t < 24 * H; t += 30 * M) {   // (at 24 h the primary's own categories pass their max-stale)
    vk.advance(30 * M);
    const kinoOpen = await call(() => live.liveCategories());
    assert.deepEqual([kinoOpen.reqs.length, kinoOpen.heldMs], [0, 0], "Kino's En vivo at +" + t / M + " min");
    const tick = await call(() => live.fillScreenCategories());
    const batch = tick.reqs.filter((r) => r.probe && r.host !== PRIMARY);
    if (!batch.length) continue;
    batches++;
    assert.ok(batch.length <= 5, "a batch of " + batch.length);
    for (const r of batch) {
      assert.equal(r.t, 3000, r.host + " at +" + t / M + " min started with " + r.t + " ms");
      const last = probes.filter((p) => p.host === r.host).pop();
      assert.ok(!last || r.at - last.at >= 6 * H, r.host + " probed again " + Math.round((r.at - (last && last.at)) / M) + " min later");
      probes.push(r);
    }
    assert.ok(tick.heldMs <= 4000, "the tick held " + tick.heldMs);
  }
  assert.ok(batches >= 2 && batches <= 6, batches + " batches in a day");
  assert.ok(probes.length <= 25, probes.length + " candidate probes in a day");
});

test("Kino's own path (B-M2): a first page that already went to the network searches after its lists, one batch of ≤ 5 probes with their whole 3 s, nothing past 3.5 s; a stored-and-fresh page makes 0 requests in 0 ms", async () => {
  live._setSources(SOURCES);
  vk.setRoute(route);
  vk.clearStore();
  await call(() => live.liveCategories());   // first install: the primary (zee-ott), no slot; the batch's hung panels marked
  // Kino's first page 11 min later (past the slots' 10 min categories backoff): its lists are missing (requests), then
  // the lean search
  vk.advance(11 * M);
  const page = await call(() => live.liveChannels({ categoryId: "v.sp.es", cursor: null }));
  const lists = page.reqs.filter((r) => !r.probe);
  const cands = page.reqs.filter((r) => r.probe);
  assert.ok(lists.length > 0, "the page loads its lists");
  assert.ok(cands.length > 0 && cands.length <= 5, cands.length + " candidate probes");
  const listsEnd = Math.max(...lists.map((r) => r.at)) + 200;
  for (const r of cands) {
    assert.equal(r.t, 3000, r.host + " started with " + r.t + " ms");
    assert.ok(r.at >= listsEnd, r.host + " started before the page's lists ended");
  }
  assert.ok(page.heldMs <= listsEnd - Math.min(...page.reqs.map((r) => r.at)) + 3500, "held " + page.heldMs + " ms");
  // 30 min later, every list fresh: 0 requests in 0 ms (the search backoff is not even asked)
  vk.advance(30 * M);
  const again = await call(() => live.liveChannels({ categoryId: "v.sp.es", cursor: null }));
  assert.deepEqual([again.reqs.length, again.heldMs], [0, 0]);
  const cats = await call(() => live.liveCategories());
  assert.deepEqual([cats.reqs.length, cats.heldMs], [0, 0]);
  // 2 h later its replay list (fresh 1 h) refreshes: past the search backoff, but every candidate was found unreachable
  // within 6 h, so the search probes nothing and the page holds only for its list
  vk.advance(2 * H);
  const later = await call(() => live.liveChannels({ categoryId: "v.sp.es", cursor: null }));
  assert.ok(later.reqs.length > 0 && later.reqs.every((r) => !r.probe), JSON.stringify(later.reqs));
  assert.ok(later.heldMs <= 2500, "held " + later.heldMs);
});
