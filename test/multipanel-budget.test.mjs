// 1.0.46: Kino's first page of a category that supertv's other panels also feed, on a virtual clock
// (test/helpers/virtual-kino.mjs). The secondary panels' lists are failover: they never cost the primary's lists a
// place, never push the call past its 2.5 s budget, and load at once only when nothing else has a channel to show.
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
// 8 primary categories (Spain) and 9 of two other panels: 5 + 4
const PRIM = Array.from({ length: 8 }, (_, i) => ({ id: "p" + i, title: "ES ▎DEPORTE " + (i + 1) }));
const S2 = Array.from({ length: 5 }, (_, i) => ({ id: "a" + i, title: "ES | DEPORTES " + (i + 1) }));
const S3 = Array.from({ length: 4 }, (_, i) => ({ id: "b" + i, title: "ESPAÑA DEPORTES " + (i + 1) }));
const CATS = { supertv: PRIM, supertv2: S2.slice(0, 5), supertv3: S3 };
const titles = (src, cat) => Array.from({ length: 6 }, (_, i) => ({ id: src[src.length - 1] + "-" + cat + "-" + i, title: "Canal " + cat + " " + i }));

function source(id) {
  return {
    id, name: id, genre: "deportes", blind: true,
    ...(id !== "supertv" ? { secondaryOf: "supertv", active: () => true } : {}),
    accountOf: (raw) => String(raw).split("-")[0],
    async categories() { return CATS[id]; },
    async channels(cat, ctx) {
      const r = await ctx.fetch(`http://${id}.test/list/${cat}`, { timeoutMs: 15000 });
      if (!r.ok) throw new Error("list " + r.status);
      return titles(id, cat);
    },
    async resolve() { return { url: "http://x.test/a.m3u8" }; },
  };
}

/** Storage: every category registered; `lists[src]` = { age (min) } of each stored list, or absent (missing). */
function seed(stored, opts = {}) {
  const now = vk.now();
  const lc = { v: 1, src: {} }, lm = { v: 1, c: {}, l: {} };
  for (const src of Object.keys(CATS)) { lc.src[src] = { at: now - H, cats: CATS[src] }; lm.c[src] = { at: now - H, failAt: 0, failN: 0 }; }
  vk.store.clear();
  vk.store.set("o2:bearer", "bearer-token");
  for (const [src, ageMin] of Object.entries(stored)) {
    for (const c of CATS[src]) {
      const items = opts.empty && opts.empty.includes(src) ? [] : live.normalizeChannels(src, titles(src, c.id));
      const text = JSON.stringify(items);
      const key = live.listKey(src, c.id);
      vk.store.set("o2:ll:" + key, text);
      const at = now - ageMin * M;
      lm.l[key] = { at, h: sha16(text), n: items.length, w: opts.w && opts.w[src] != null ? now - opts.w[src] * M : at, failAt: 0, failN: 0 };
    }
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
  const out = await vk.run(() => live.liveChannels({ categoryId: "v.sp.es", cursor: null }));
  return { out, heldMs: vk.now() - t0, reqs: vk.requests.map((r) => ({ url: r.url, src: new URL(r.url).hostname.replace(".test", ""), at: r.at - t0, t: r.timeoutMs })) };
}

const lat = (url) => { const u = new URL(url); const n = Number(u.pathname.slice(-1)) || 0; return 500 + (n % 6) * 100; };
test.afterEach(() => live._setSources(null));

test("first page: 8 stale primary lists and 9 missing secondary ones answer within 2.5 s; no secondary list takes a place a primary one could use; no backoff for what the budget cut", async () => {
  live._setSources(["supertv", "supertv2", "supertv3"].map(source));
  vk.setRoute((url) => ({ ms: lat(url), res: res(200, "ok") }));
  seed({ supertv: 7 * 60 });
  const { out, heldMs, reqs } = await firstPage();
  assert.ok(heldMs <= live.KINO_REFRESH_SOFT_MS, "held " + heldMs + " ms");
  for (const r of reqs) assert.ok(r.at + r.t <= live.KINO_REFRESH_SOFT_MS, r.src + " at +" + r.at + " for " + r.t);
  // a secondary list starts only while the primary already uses its 4 places (Kino's per-host share) or has none left
  const prim = reqs.filter((r) => r.src === "supertv");
  assert.equal(prim.length, 8, "every stale primary list refreshed");
  for (const r of reqs.filter((x) => x.src !== "supertv")) {
    const waiting = prim.filter((p) => p.at > r.at).length;
    const running = prim.filter((p) => p.at <= r.at && p.at + lat(p.url) > r.at).length;
    assert.ok(waiting === 0 || running >= 4, r.src + " at +" + r.at + " while " + waiting + " primary lists wait and " + running + " run");
  }
  assert.ok(reqs.some((r) => r.src !== "supertv"), "secondary lists load in what is left of the budget");
  assert.equal(out.items.length >= 8 * 6, true);
  ls.flushMeta();
  const lm = JSON.parse(vk.store.get("o2:lm")).l;
  for (const src of ["supertv2", "supertv3"]) for (const c of CATS[src]) {
    const m = lm[live.listKey(src, c.id)];
    assert.ok(!m || !m.failAt, "no backoff for a list the budget cut: " + src + " " + c.id);
  }
  // the next first page (a new runtime) loads the rest; all fresh → 0 requests
  vk.advance(5 * M);
  await firstPage();
  vk.advance(5 * M);
  const third = await firstPage();
  assert.equal(third.reqs.length, 0);
});

test("first page: every list stored, the secondary ones stale too: the primary's go first, and stale secondary lists never set the page stale", async () => {
  live._setSources(["supertv", "supertv2", "supertv3"].map(source));
  vk.setRoute((url) => ({ ms: lat(url), res: res(200, "ok") }));
  seed({ supertv: 7 * 60, supertv2: 7 * 60, supertv3: 7 * 60 });
  const { heldMs, reqs } = await firstPage();
  assert.ok(heldMs <= live.KINO_REFRESH_SOFT_MS);
  const firstSec = Math.min(...reqs.filter((r) => r.src !== "supertv").map((r) => r.at));
  assert.ok(reqs.filter((r) => r.src === "supertv").every((r) => r.at <= firstSec || reqs.filter((p) => p.src === "supertv" && p.at <= firstSec).length >= 4));
  // the primary's lists are fresh now; the secondary ones left stale never make the screen say so
  const sc = await vk.run(() => live.screenList("v.sp.es"));
  assert.deepEqual([sc.stale, sc.refreshable, sc.failed], [false, 0, false]);
});

test("first page: nothing else to show (the primary's lists are empty) → the secondary panels' lists are not fetched: they could add no row", async () => {
  live._setSources(["supertv", "supertv2", "supertv3"].map(source));
  vk.setRoute((url) => ({ ms: url.includes("supertv3") ? 3000 : 400, res: res(200, "ok") }));
  seed({ supertv: 10 }, { empty: ["supertv"] });
  const { out, heldMs, reqs } = await firstPage();
  assert.deepEqual(reqs, []);
  assert.equal(heldMs, 0);
  assert.equal(out.items.length, 0);
});

test("mustRefresh never picks a secondary list: one whose text would vanish within the hour waits for the budget like any other", async () => {
  live._setSources(["supertv", "supertv2", "supertv3"].map(source));
  vk.setRoute((url) => ({ ms: url.includes("supertv.test") ? 2000 : 300, res: res(200, "ok") }));
  // primary lists fresh (nothing to refresh), secondary lists stored 23 h ago, written 71 h ago (text ends within 1 h)
  seed({ supertv: 10, supertv2: 23 * 60, supertv3: 23 * 60 }, { w: { supertv2: 71 * 60, supertv3: 71 * 60 } });
  const { reqs, heldMs } = await firstPage();
  assert.ok(heldMs <= live.KINO_REFRESH_SOFT_MS, "held " + heldMs);
  assert.ok(reqs.length > 0 && reqs.every((r) => r.src !== "supertv"), "only the stale secondary lists refresh");
  for (const r of reqs) assert.ok(r.at + r.t <= live.KINO_REFRESH_SOFT_MS, "inside the budget: " + r.src + " +" + r.at + " for " + r.t);
});
