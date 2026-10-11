// 2.2.25: a pool seed the portal answered "not logged in" (aaa100027/aaa100028) is remembered as dead for a while
// and never picked again; a rescue does not re-download a pool fetched minutes ago that still has live seeds.
// On the board (0.9.60, 7 days) geo-blocked TVs spent Home on dead seeds: `session err code=aaa100027 sess=seed`,
// `v8/active portal100024`, `seed pick` (a random seed, often dead too), `aaa100027` again, `seeds refresh` (the
// pool downloaded again), `seed_switch`, and only then the content (ERRORES-A07, D6A; DC8 `xuper:seed` 8.8k).
// Real portal + session over a scripted fetch (test/helpers/portalWorld.mjs); its random source is 0, so a pick
// is the first usable seed: without the memory the seed that just died is picked again.
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld } from "./helpers/portalWorld.mjs";
import { DEAD_SEED_MS, RESCUE_POOL_FRESH_MS } from "../src/session.js";

const GEO = { returnCode: "portal100024", errorMessage: "geo" };
const DEAD = { returnCode: "aaa100027", errorMessage: "not logged in" };
const POOL = ["A", "B", "C", "D"].map((x) => ({ sn: `seed-sn-${x}`, userId: `seed-u${x}`, userToken: `seedtok${x}` }));
const answer = { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie" }] }] };
const query = (q = "Dune") => ({ q, type: "any", season: 0, episode: 0, tmdbId: 0 });

/** A blocked region running on seed A; `dead` are the tokens the portal says are not logged in. */
function blocked(dead, { seedsAtAgoMs = null } = {}) {
  const w = portalWorld({
    hosts: ["a.test"], seeds: POOL, session: { ...POOL[0], jwtToken: "", acct: "" }, seedsText: JSON.stringify(POOL),
    routes: { "v8/active": GEO, "v3/searchByName": (bean) => (dead.has(bean.userToken) ? DEAD : answer) },
  });
  w.kino.storage.set("region", JSON.stringify({ blocked: true }));
  if (seedsAtAgoMs !== null) w.kino.storage.set("seedsAt", JSON.stringify(w.clock.t - seedsAtAgoMs));
  w.searches = () => w.requests.filter((r) => r.path === "v3/searchByName").map((r) => r.bean.userToken);
  return w;
}

test("a seed found dead is not picked again: the call reaches the live seed, each dead one asked once", async () => {
  const w = blocked(new Set(["seedtokA", "seedtokB", "seedtokC"]));
  const out = await w.catalog.search(query());
  assert.equal(out[0].id, "D1");
  assert.equal(w.stored().userToken, "seedtokD", "the device now runs on the live seed");
  const asked = w.searches();
  for (const t of ["seedtokA", "seedtokB", "seedtokC"]) assert.ok(asked.filter((x) => x === t).length <= 1, `${t} asked ${asked.join(",")}`);
});

test("when the live seed dies too, the seeds already found dead are not asked again", async () => {
  const dead = new Set(["seedtokA", "seedtokB", "seedtokC"]);
  const w = blocked(dead);
  await w.catalog.search(query());
  dead.add("seedtokD");
  w.requests.length = 0;
  await w.catalog.search(query("Otra")).catch(() => {});
  const asked = w.searches();
  assert.ok(asked.includes("seedtokD"));
  for (const t of ["seedtokA", "seedtokB", "seedtokC"]) assert.ok(!asked.includes(t), `${t} asked again: ${asked.join(",")}`);
});

test("a rescue does not re-download a pool fetched minutes ago that still has live seeds", async () => {
  const w = blocked(new Set(["seedtokA", "seedtokB"]), { seedsAtAgoMs: 60_000 });
  const out = await w.catalog.search(query());
  assert.equal(out[0].id, "D1");
  assert.equal(w.seedDownloads.length, 0, "the pool kept a minute ago still had live seeds");
});

test("an old pool, or one whose seeds are all dead, is still downloaded by the rescue", async () => {
  const old = blocked(new Set(["seedtokA", "seedtokB"]), { seedsAtAgoMs: RESCUE_POOL_FRESH_MS + 1 });
  await old.catalog.search(query());
  assert.equal(old.seedDownloads.length, 1);
  const allDead = blocked(new Set(["seedtokA", "seedtokB", "seedtokC", "seedtokD"]), { seedsAtAgoMs: 60_000 });
  await allDead.catalog.search(query()).catch(() => {});
  assert.ok(allDead.seedDownloads.length >= 1, "nothing live left: the rescue downloads");
});

test("a dead mark expires: after DEAD_SEED_MS the seed may be picked again", async () => {
  const dead = new Set(["seedtokA", "seedtokB", "seedtokC"]);
  const w = blocked(dead);
  await w.catalog.search(query());
  const marks = JSON.parse(w.kino.storage.get("deadSeeds"));
  assert.equal(Object.keys(marks).length, 3, "three marks kept");
  assert.ok(!JSON.stringify(marks).includes("seedtok"), "a mark never holds a whole token");
  w.clock.t += DEAD_SEED_MS + 1;
  dead.clear();
  dead.add("seedtokD");
  w.requests.length = 0;
  const out = await w.catalog.search(query("Dune Test"));
  assert.equal(out[0].id, "D1");
  assert.equal(w.stored().userToken, "seedtokA", "A (first in the pool) is usable again");
});
