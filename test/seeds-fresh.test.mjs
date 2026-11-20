// GET /seed?fresh=1: the backend's sticky assignment would hand back the seed this account just had blocked, so a seed
// the portal geo-blocked and the person's "Cambiar semilla" ask for a different one. Every other GET is bare.
import { test } from "node:test";
import assert from "node:assert/strict";
import { world, poolSeed, portalError, MIN, BEARER } from "./helpers/seed-world.mjs";

globalThis.kino = { lang: "es", config: {} };
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { beginCall, callFor } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const xuper = xmod.default;

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; });

async function device(opts = {}) {
  const w = await world(opts);
  await clearBearer();
  w.kino.storage.set("o2:bearer", BEARER);
  xmod._resetSession();
  seeds._newRuntime();
  return w;
}
function call(name) { beginCall(); callFor(name); }
const paths = (w) => w.getUrls.map((u) => u.replace(/^https?:\/\/[^/]+/, ""));

test("fresh: the first GET is bare; a seed the portal geo-blocks is dropped and its replacement asks ?fresh=1", async () => {
  const s1 = poolSeed(1), s2 = poolSeed(2);
  const w = await device({ geo: "own", pool: [s1, s2], handlers: {
    getNextColumns: (b) => (b.userToken === s1.seed.userToken ? portalError("portal100024") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});
  assert.deepEqual(paths(w), ["/seed", "/seed?fresh=1"]);
  assert.equal(w.held().userToken, s2.seed.userToken);
  assert.equal(w.state().fresh, false, "a seed landed: the next GET is bare again");
});

test("fresh: the flag outlives the call — the next call after a geo drop that found no seed still asks ?fresh=1, then goes bare", async () => {
  const s1 = poolSeed(1), s2 = poolSeed(2), s3 = poolSeed(3);
  const w = await device({ geo: "own", pool: [s1, s2, s3], seedAnswer: (n) => (n === 2 ? { status: 503, text: "{}", json: () => ({}) } : undefined), handlers: {
    getNextColumns: (b) => (b.userToken === s1.seed.userToken ? portalError("portal100024") : undefined),
  } });
  call("liveCategories"); await rejection(xuper.categories({}));
  assert.equal(w.state().fresh, true, "the geo drop is remembered");
  w.advance(10 * MIN);
  call("liveCategories"); await xuper.categories({});
  assert.deepEqual(paths(w), ["/seed", "/seed?fresh=1", "/seed?fresh=1"]);
  assert.equal(w.state().fresh, false);
  w.advance(40 * MIN); w.store.delete("o2:xseed");
  seeds._newRuntime();
  call("liveCategories"); await xuper.categories({});
  assert.equal(paths(w).at(-1), "/seed", "bare once a seed has landed");
});

test("fresh: a seed that is just dead (not geo) does not turn fresh on", async () => {
  const s1 = poolSeed(1), s2 = poolSeed(2);
  const w = await device({ geo: "own", pool: [s1, s2], handlers: {
    getNextColumns: (b) => (b.userToken === s1.seed.userToken ? portalError("aaa100027") : undefined),
  } });
  call("liveCategories"); await xuper.categories({});
  assert.deepEqual(paths(w), ["/seed", "/seed"]);
});

test("fresh: 'Cambiar semilla' asks ?fresh=1", async () => {
  const w = await device({ geo: "own", pool: [poolSeed(1), poolSeed(2)] });
  call("liveCategories"); await xuper.categories({});
  w.advance(11 * MIN);
  call("screenEvent");
  assert.equal((await seeds.manualChange()).result, "ok");
  assert.deepEqual(paths(w), ["/seed", "/seed?fresh=1"]);
});

async function rejection(p) { try { await p; } catch (e) { return e; } assert.fail("expected a rejection"); }
