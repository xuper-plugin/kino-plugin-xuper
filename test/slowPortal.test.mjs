// 2.2.14: a slow portal never makes Kino time a call out. From 2026-10-06 the portal took 10-20 s an
// answer; Home waited for one root (18 s, split between the two hosts) and then parsed it, past Kino's
// 20 s, and three such timeouts in a row switched Xuper off ("No responde"). A typed error never counts.
// Now: with kept rows (or a kept chapter list) the call serves them inside a short refresh window; with
// nothing kept it serves the roots in by its deadline, or throws a typed `unavailable` with its sentence.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { portalWorld, START } from "./helpers/portalWorld.mjs";
import { shownSentence } from "../sdk/kino-shim.mjs";
import { makeCatalog, WARM_REFRESH_MS, COLD_DEADLINE_MS, LIVE_ROW_MS } from "../src/catalog.js";
import { makeSection } from "../src/section.js";
import { makeCategories } from "../src/categories.js";
import { CHAPTERS_REFRESH_MS, CHAPTERS_COLD_MS, EPISODES_DEADLINE_MS } from "../src/episodes.js";
import { PORTAL_SLOW, slowPortal } from "../src/portal.js";
import { traced } from "../src/trace.js";

const HOUR = 3600_000;
const KINO_LIMIT_MS = 20_000; // home, section, categories, browse, episodes (README limits table)
const SLOW = 30_000; // an answer slower than any request's timeout: every request times out

const isSlowSentence = (e) => {
  assert.equal(e.name, "KinoError_unavailable", e.message);
  assert.equal(e.userMessage, PORTAL_SLOW);
  assert.equal(shownSentence(e), PORTAL_SLOW, "Kino shows the sentence as is");
  return true;
};

// ---- a virtual-time portal: concurrent requests each end at their own time ------------------------
// Each call ends at min(start + latency, its deadline); past the deadline it fails like a request that
// timed out. `drive(promise)` advances the clock to the next ending request until the promise settles.
const asset = (id) => ({ contentId: id, name: "T " + id, programType: "movie", tags: "Drama", score: 7 });
const tree = (p) => ({ recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => asset(`${p}${i + 1}`)) }] });
const PREFIX = { masnew_movies: "p", masnew_series: "s", masnew_anime: "a", masnew_kids: "k" };

function virtualWorld({ latency = () => 100, fail = () => null } = {}) {
  const base = fakeKino();
  const logs = [];
  const log = Object.assign((l) => logs.push(String(l)), { report: (l) => logs.push(String(l)) });
  const kino = Object.freeze({ ...base, log });
  const clock = { t: START, now() { return this.t; } };
  const pending = [];
  const calls = [];
  const portal = {
    call(path, bean, opts = {}) {
      const at = clock.t;
      calls.push({ path, code: bean.columnCode, at, deadline: opts.deadline });
      const ms = latency(bean.columnCode, calls.length);
      const end = typeof opts.deadline === "number" ? Math.min(at + ms, opts.deadline) : at + ms;
      return new Promise((resolve, reject) => {
        pending.push({
          at: end,
          run: () => {
            const err = fail(bean.columnCode);
            if (err) return reject(err);
            if (at + ms > end) return reject(kino.error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento"));
            if (typeof opts.onFetchMs === "function") opts.onFetchMs(ms);
            resolve(tree(PREFIX[bean.columnCode]));
          },
        });
      });
    },
  };
  const session = {
    ensure: async () => {},
    withValidSession: async (block, o = {}) => block({ userId: "u", userToken: "t", deadline: o.deadline }),
  };
  const make = () => makeCatalog({ kino, portal, session, clock });
  const tick = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  async function drive(promise) {
    let done = false;
    const watched = promise.then((v) => { done = true; return v; }, (e) => { done = true; throw e; });
    watched.catch(() => {});
    for (;;) {
      await tick();
      if (done) break;
      if (pending.length === 0) throw new Error("stuck: nothing pending and the call has not answered");
      pending.sort((a, b) => a.at - b.at);
      const next = pending.shift();
      clock.t = Math.max(clock.t, next.at);
      next.run();
    }
    return watched;
  }
  return { kino, clock, calls, logs, make, drive, elapsed: () => clock.t - START };
}

// ---- home with kept rows: served at once, the refresh bounded --------------------------------------

test("home with kept rows and a portal that stopped answering: the kept rows within WARM_REFRESH_MS, served=cache", async () => {
  const w = portalWorld();
  const first = await w.catalog.home();
  assert.ok(first.length > 0);
  w.clock.t += 3 * HOUR; // every root stale
  w.setAliveMs(SLOW);
  const t0 = w.clock.t;
  const cold = makeCatalog({ kino: w.kino, portal: w.portal, session: w.session, clock: w.clock }); // a new sandbox
  const rows = await cold.home();
  assert.deepEqual(rows, first, "the kept rows, as they were");
  const ms = w.clock.t - t0;
  assert.ok(ms <= WARM_REFRESH_MS, `answered after ${ms} ms`);
  assert.ok(ms <= KINO_LIMIT_MS / 2, "well inside Kino's 20 s");
  for (const r of w.requests.filter((x) => x.at >= t0)) assert.ok(r.at + r.timeoutMs <= t0 + WARM_REFRESH_MS, `${r.path} ran past the refresh window`);
  assert.deepEqual(cold.servedBy(), { served: "cache", got: 0, fail: 1 });
  assert.deepEqual(cold.servedBy(), {}, "read once");
});

test("home with kept rows: the same holds with the country row asked too (it gets LIVE_ROW_MS)", async () => {
  const routes = {
    getNextColumns: (bean) => (bean.columnCode === "masnew_live"
      ? { recommendList: [{ columnId: 41, name: "Colombia" }] }
      : { recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => asset("PEL" + i)) }] }),
    "v6/getLiveData": { channelList: [{ channelCode: "CH1", name: "Canal 1", channelNumber: 1 }] },
  };
  const w = portalWorld({ config: { homeCountry: "CO" }, routes });
  const first = await w.catalog.home();
  assert.equal(first.at(-1).id, "live-country");
  w.clock.t += 3 * HOUR;
  w.setAliveMs(SLOW);
  const t0 = w.clock.t;
  const rows = await w.catalog.home();
  assert.ok(rows.length > 0 && rows.every((r) => r.id !== "live-country"), "the VOD rows; the live row is dropped");
  assert.ok(w.clock.t - t0 <= Math.max(WARM_REFRESH_MS, LIVE_ROW_MS) + 1_000, `answered after ${w.clock.t - t0} ms`);
});

test("home with kept rows, the portal back: the stale root is refreshed and the call says fresh once all are", async () => {
  const w = virtualWorld({ latency: () => 300 });
  const t = w.make();
  await w.drive(t.home());
  w.clock.t += 3 * HOUR;
  t.servedBy();
  await w.drive(t.home());
  assert.deepEqual(t.servedBy(), { served: "fresh", got: 4, fail: 0 }, "a quick portal: every stale root inside the call's first 1.5 s");
  await w.drive(t.home());
  assert.deepEqual(t.servedBy(), { served: "fresh", got: 0, fail: 0 }, "then nothing to ask");
});

test("section, categories and a row's browse with kept rows answer inside WARM_REFRESH_MS on a dead-slow portal", async () => {
  const w = portalWorld();
  const first = await w.catalog.home();
  w.clock.t += 3 * HOUR;
  w.setAliveMs(SLOW);
  const fresh = () => makeCatalog({ kino: w.kino, portal: w.portal, session: w.session, clock: w.clock });
  const runs = {
    section: (c) => makeSection({ kino: w.kino, catalog: c, clock: w.clock }).section({ tab: "anime" }),
    categories: (c) => makeCategories({ catalog: c }).categories(),
    browse: (c) => c.browse(first[0].id, null),
  };
  for (const [name, run] of Object.entries(runs)) {
    const t0 = w.clock.t;
    await run(fresh());
    assert.ok(w.clock.t - t0 <= WARM_REFRESH_MS, `${name}: ${w.clock.t - t0} ms`);
  }
});

// ---- nothing kept ------------------------------------------------------------------------------

test("nothing kept, every root slower than the deadline: a typed unavailable with the sentence, by COLD_DEADLINE_MS", async () => {
  const w = virtualWorld({ latency: () => SLOW });
  await assert.rejects(w.drive(w.make().home()), isSlowSentence);
  assert.ok(w.elapsed() <= COLD_DEADLINE_MS, `${w.elapsed()} ms`);
  for (const c of w.calls) assert.ok(c.deadline <= START + COLD_DEADLINE_MS);
});

test("nothing kept, the portal unreachable at once: the typed unavailable at once (no wait for a deadline)", async () => {
  const w = virtualWorld({ latency: () => 0, fail: () => fakeKino().error("unavailable", "No se pudo contactar a Xuper; intenta de nuevo en un momento") });
  await assert.rejects(w.drive(w.make().home()), isSlowSentence);
  assert.equal(w.elapsed(), 0);
});

test("nothing kept, through the real portal and session: every host dead is the sentence inside the cap", async () => {
  const w = portalWorld({ dead: ["a.test", "b.test"] });
  await assert.rejects(w.catalog.home(), isSlowSentence);
  assert.ok(w.elapsed() <= COLD_DEADLINE_MS, `${w.elapsed()} ms`);
});

test("a person-actionable error is never replaced by the slow sentence", () => {
  const k = fakeKino();
  const geo = k.error("geo_blocked", "Este contenido no está disponible en tu región");
  assert.equal(slowPortal(k, geo), geo);
  const own = k.error("unavailable", "x", { userMessage: "Esta serie ya no está disponible." });
  assert.equal(slowPortal(k, own), own);
});

test("nothing kept on a portal measured slow: two roots at once, what is in by the deadline is served (partial)", async () => {
  // Movies answer in 5 s, series never in time, anime and kids are not reached (a lane starts a root only
  // in the call's first 1.5 s).
  const w = virtualWorld({ latency: (code) => ({ masnew_movies: 5_000, masnew_series: SLOW })[code] ?? 100 });
  w.kino.storage.set("portalSlow", String(START - 60_000));
  const c = w.make();
  const rows = await w.drive(c.home());
  assert.ok(rows.length > 0 && rows.every((r) => r.id.includes("peliculas")), rows.map((r) => r.id).join());
  assert.deepEqual(w.calls.map((x) => [x.code, x.at - START]), [["masnew_movies", 0], ["masnew_series", 0]], "both asked at once");
  assert.ok(w.elapsed() <= COLD_DEADLINE_MS, `${w.elapsed()} ms`);
  assert.deepEqual(c.servedBy(), { served: "partial", got: 1, fail: 1 });
});

test("nothing kept on a portal not measured slow: one root at a time (a 32-bit TV's CPU is the cost there)", async () => {
  const w = virtualWorld({ latency: () => 2_000 });
  const c = w.make();
  const rows = await w.drive(c.home());
  assert.ok(rows.length > 0);
  assert.equal(w.calls.length, 1, "one root: 2 s is past the 1.5 s a call starts roots in");
});

test("a root's network time over 4 s marks the portal slow, kept for the next sandbox; a fast one clears it", async () => {
  let ms = 5_000;
  const w = virtualWorld({ latency: () => ms });
  const forget = () => { for (const k of w.kino.storage.keys()) if (k.startsWith("rows:")) w.kino.storage.remove(k); };
  await w.drive(w.make().home());
  assert.equal(w.calls.length, 1, "not known slow yet: one root");
  assert.ok(w.kino.storage.get("portalSlow") !== null, "remembered in storage");
  forget(); // a sandbox with nothing kept again
  w.calls.length = 0;
  const t0 = w.clock.t;
  await w.drive(w.make().home());
  assert.deepEqual(w.calls.map((c) => c.at - t0), [0, 0], "the next cold sandbox asks two roots at once");
  forget();
  ms = 200;
  await w.drive(w.make().home());
  assert.equal(w.kino.storage.get("portalSlow"), null, "a fast answer clears it");
});

// ---- episodes ----------------------------------------------------------------------------------

const SERIES = "magis1:tv:0:SERIE";

test("episodes with a kept chapter list past its 6 h and a dead-slow portal: the kept list within CHAPTERS_REFRESH_MS", async () => {
  const w = portalWorld();
  const first = await w.catalog.episodes(SERIES);
  assert.equal(w.catalog.servedBy().served, "fresh");
  w.clock.t += 7 * HOUR;
  w.setAliveMs(SLOW);
  const t0 = w.clock.t;
  const again = await w.catalog.episodes(SERIES);
  assert.deepEqual(again, first);
  assert.ok(w.clock.t - t0 <= CHAPTERS_REFRESH_MS, `${w.clock.t - t0} ms`);
  assert.equal(w.catalog.servedBy().served, "cache");
  assert.ok(w.logs.some((l) => /^xuper:episodes kept code=unavailable$/.test(l)));
});

test("episodes with a fresh kept list asks nothing (served=cache)", async () => {
  const w = portalWorld();
  await w.catalog.episodes(SERIES);
  w.catalog.servedBy();
  const n = w.requests.length;
  await w.catalog.episodes(SERIES);
  assert.equal(w.requests.length, n);
  assert.equal(w.catalog.servedBy().served, "cache");
});

test("episodes with nothing kept and a dead-slow portal: the typed sentence by CHAPTERS_COLD_MS", async () => {
  const w = portalWorld();
  w.setAliveMs(SLOW);
  await assert.rejects(w.catalog.episodes(SERIES), isSlowSentence);
  assert.ok(w.elapsed() <= CHAPTERS_COLD_MS, `${w.elapsed()} ms`);
  assert.ok(CHAPTERS_COLD_MS < EPISODES_DEADLINE_MS && EPISODES_DEADLINE_MS <= KINO_LIMIT_MS - 5_000);
});

test("episodes: a series the portal says is gone is never answered from the kept list", async () => {
  let gone = false;
  const ok = { assetData: { keyWords: "", volumnCount: "1", sameSeasonSeriesList: [], simpleProgramList: [{ seriesNumber: "1", contentId: "EP1", name: "Capitulo 1" }] } };
  const w = portalWorld({ routes: { "v4/getItemData": () => (gone ? { returnCode: "portal100006", errorMessage: "x" } : ok) } });
  await w.catalog.episodes(SERIES);
  w.clock.t += 7 * HOUR;
  gone = true;
  await assert.rejects(w.catalog.episodes(SERIES), (e) => e.name === "KinoError_not_found");
});

test("the kept chapter list is dropped after a week", async () => {
  const w = portalWorld();
  await w.catalog.episodes(SERIES);
  w.clock.t += 8 * 24 * HOUR;
  w.setAliveMs(SLOW);
  await assert.rejects(w.catalog.episodes(SERIES), isSlowSentence);
});

// ---- telemetry ---------------------------------------------------------------------------------

test("traced: the late fields (served, got, fail) ride on the end line and on the perf reports", async () => {
  const lines = [];
  const reports = [];
  const kino = { log: Object.assign((l) => lines.push(l), { report: (l) => { lines.push(l); reports.push(l); } }) };
  const clock = { t: 0, now() { return this.t; } };
  await traced(kino, clock, "home", async () => { clock.t += 9_000; return [1, 2]; }, {}, () => ({ served: "cache", got: 0, fail: 1 }));
  assert.equal(lines.at(-1).startsWith("xuper:perf_slow call fn=home b=8-12s ok=1 served=cache got=0 fail=1"), true, lines.join("\n"));
  assert.ok(lines.some((l) => l === "xuper:call ok fn=home ms=9000 n=2 served=cache got=0 fail=1"), lines.join("\n"));
  // A late function that throws or answers garbage adds nothing and never fails the call.
  assert.deepEqual(await traced(kino, clock, "home", async () => [], {}, () => { throw new Error("x"); }), []);
  assert.deepEqual(await traced(kino, clock, "home", async () => [], {}, () => "nope"), []);
});
