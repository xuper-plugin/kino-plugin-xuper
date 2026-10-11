// 2.2.25: a device where refreshing one kept root makes the call slow refreshes at most once per
// SLOW_REFRESH_GAP_MS. On the board (ERRORES-A07 home timeout, D6A categories timeout, 0.9.60, 7 days) the warm
// calls served kept rows (`served=cache got=1`) yet took 8-30 s: on a weak TV one root's decode (perf_decode up to
// 8-60 s), parse, classification and snapshot write (perf_store up to 4-20 s) came on top of the network, so
// Home ran past Kino's 20 s, and categories and section right after it each refreshed the next stale root:
// timeouts in a row, "No responde". The kept rows are what such a device serves meanwhile.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { makeCatalog, HEAVY_REFRESH_MS, SLOW_REFRESH_GAP_MS } from "../src/catalog.js";

const HOUR = 3600_000;
const START = 1_790_000_000_000;
const CODES = { masnew_movies: "p", masnew_series: "s", masnew_anime: "a", masnew_kids: "k" };
const asset = (id) => ({ contentId: id, name: "Titulo " + id, programType: "movie", tags: "Drama", score: 7 });
const tree = (p) => ({ recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => asset(`${p}${i + 1}`)) }] });

/**
 * A TV over one storage: `answerMs` per portal answer, `writeMs` per snapshot storage write (the costly part of a
 * root on a weak TV: decoding, parsing and storing run after the network, modelled where the clock can see them).
 * `make()` is a new sandbox (Kino drops it after 5 idle minutes or a timeout): nothing in memory, storage kept.
 */
function tv() {
  const base = fakeKino();
  const clock = { t: START, now() { return this.t; } };
  const cost = { answerMs: 300, writeMs: 0 };
  const storage = {
    get: (k) => base.storage.get(k),
    remove: (k) => base.storage.remove(k),
    set: (k, v, o) => { if (k.startsWith("rows:")) clock.t += cost.writeMs; return base.storage.set(k, v, o); },
  };
  const kino = Object.freeze({ ...base, storage });
  const asked = [];
  const portal = {
    async call(path, bean, opts = {}) {
      asked.push({ code: bean.columnCode, at: clock.t });
      const end = typeof opts.deadline === "number" ? Math.min(clock.t + cost.answerMs, opts.deadline) : clock.t + cost.answerMs;
      const late = clock.t + cost.answerMs > end;
      clock.t = end;
      await null;
      if (late) throw kino.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento");
      return tree(CODES[bean.columnCode]);
    },
  };
  const session = { ensure: async () => {}, withValidSession: async (block, o = {}) => block({ userId: "u", userToken: "t", deadline: o.deadline }) };
  const make = () => makeCatalog({ kino, portal, session, clock });
  return { kino, clock, cost, asked, make };
}

// Four quick starts: every root kept.
async function kept(t) {
  for (let i = 0; i < 4; i++) await t.make().home();
  assert.deepEqual(new Set(t.asked.map((a) => a.code)), new Set(Object.keys(CODES)), "the whole catalog is kept");
  t.asked.length = 0;
}

async function timed(t, call) {
  const t0 = t.clock.t;
  const out = await call();
  return { out, ms: t.clock.t - t0, asked: t.asked.splice(0).map((a) => a.code) };
}

test("a weak TV: after a warm refresh that made Home slow, the next calls serve the kept rows without refreshing", async () => {
  const t = tv();
  await kept(t);
  t.clock.t += 3 * HOUR; // every root stale
  t.cost.answerMs = 3_000;
  t.cost.writeMs = 6_000; // a root's snapshot write: 12 s or more on this TV
  const first = await timed(t, () => t.make().home());
  assert.equal(first.asked.length, 1, "the first call still refreshes one root");
  assert.ok(first.ms >= HEAVY_REFRESH_MS, `slow refresh (${first.ms} ms)`);
  for (const fn of ["categories", "section", "home"]) {
    const c = t.make();
    const next = await timed(t, () => (fn === "home" ? c.home() : c.rows(fn === "section" ? "categories" : fn)));
    assert.deepEqual(next.asked, [], `${fn} right after it asks nothing`);
    assert.ok(next.ms < 1_000, `${fn} answers from the kept rows (${next.ms} ms)`);
    assert.ok(next.out.length > 0);
  }
  // After the gap, one root is refreshed again (one per gap, the rows never frozen for good).
  t.clock.t += SLOW_REFRESH_GAP_MS;
  const later = await timed(t, () => t.make().home());
  assert.equal(later.asked.length, 1);
  const after = await timed(t, () => t.make().home());
  assert.deepEqual(after.asked, [], "and again not in the next call");
});

test("a fast device keeps refreshing one stale root per call, as before", async () => {
  const t = tv();
  await kept(t);
  t.clock.t += 3 * HOUR;
  t.cost.answerMs = 2_000; // one root per call (a call starts no root once it is 1.5 s old)
  const seen = [];
  for (let i = 0; i < 4; i++) {
    const r = await timed(t, () => t.make().home());
    assert.equal(r.asked.length, 1, `call ${i + 1} refreshes one root`);
    assert.ok(r.ms < HEAVY_REFRESH_MS);
    seen.push(r.asked[0]);
  }
  assert.deepEqual(new Set(seen), new Set(Object.keys(CODES)), "all four refreshed in four calls");
});

test("a device that was slow once and refreshes quickly again is no longer held back", async () => {
  const t = tv();
  await kept(t);
  t.clock.t += 3 * HOUR;
  t.cost.answerMs = 3_000;
  t.cost.writeMs = 6_000;
  await timed(t, () => t.make().home()); // slow: marked
  t.cost.answerMs = 2_000;
  t.cost.writeMs = 0;
  t.clock.t += SLOW_REFRESH_GAP_MS; // the next refresh is allowed, and it is quick
  assert.equal((await timed(t, () => t.make().home())).asked.length, 1);
  assert.equal((await timed(t, () => t.make().home())).asked.length, 1, "quick again: the next call refreshes too");
});

test("a held-back device still fetches a root it never had (a partial snapshot) and what a row page needs", async () => {
  const t = tv();
  t.cost.answerMs = 2_000; // one root per call
  await t.make().home();
  const keptRoot = t.asked.splice(0)[0].code;
  t.clock.t += 3 * HOUR; // the kept root is stale
  // Held back: a heavy refresh started a moment ago (as a call Kino gave up on leaves it).
  t.kino.storage.set("refreshHeavy", String(t.clock.t));
  t.kino.storage.set("refreshAt", String(t.clock.t));
  const c = t.make();
  const home = await timed(t, () => c.home());
  assert.equal(home.asked.length, 1, "a missing root is still asked");
  assert.notEqual(home.asked[0], keptRoot, "but not the stale kept one");
  assert.deepEqual(c.servedBy(), { served: "partial", got: 1, fail: 0, held: 1 }, "the call's lines say it was held back");
  // A row page needs its root with every item: fetched even while held back.
  const row = home.out.find((r) => r.id !== "live-country");
  const page = await timed(t, () => t.make().browse(row.ref, null));
  assert.ok(page.asked.length >= 1, "the row's root is fetched for its page");
  assert.ok(page.out.items.length > 0);
});
