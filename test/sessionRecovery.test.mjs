// A fresh install in a blocked region loads the seed pool by itself (native fetched it at
// activation), the region flag is cleared only by a content call that answered on the device's own
// session, and a burst of calls on a dead token renews it once. Real portal + session over a
// scripted fetch (test/helpers/portalWorld.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld, SEEDS, STORED, ANSWERS } from "./helpers/portalWorld.mjs";
import { viewOpts } from "../src/portal.js";

const GEO = { returnCode: "portal100024", errorMessage: "geo" };
const isSeed = (bean) => String(bean.userToken).startsWith("seedtok");
const searchAnswer = { searchItemList: [{ itemList: [{ contentId: "D1", name: "Dune Test", programType: "movie" }] }] };
const onlySeeds = (answer) => (bean) => (isSeed(bean) ? answer : GEO);
const query = { q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 };
const kinoErr = (code) => (e) => { assert.equal(e.name, "KinoError_" + code, e.message); return true; };

test("blocked region, fresh install: the activation itself is geo-refused and the empty pool is downloaded", async () => {
  const w = portalWorld({
    hosts: ["a.test"], session: null, seedsText: JSON.stringify(SEEDS),
    routes: { "v8/active": GEO, "v3/searchByName": onlySeeds(searchAnswer) },
  });
  const out = await w.catalog.search(query);
  assert.equal(out[0].id, "D1");
  assert.equal(w.seedDownloads.length, 1, "the pool was loaded without the manual button");
  assert.ok(w.stored().userToken.startsWith("seedtok"), "the device runs on a pool seed");
  assert.equal(w.session.regionBlocked(), true, "a geo-refused activation flags the region");
});

test("blocked region: activation works but content is geo-blocked; the empty pool is downloaded on the block", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: JSON.stringify(SEEDS), routes: { "v3/searchByName": onlySeeds(searchAnswer) } });
  const out = await w.catalog.search(query);
  assert.equal(out[0].id, "D1");
  assert.equal(w.seedDownloads.length, 1);
  assert.ok(w.stored().userToken.startsWith("seedtok"));
  assert.equal(w.session.regionBlocked(), true);
  assert.equal(w.paths().filter((p) => p === "v8/active").length, 0, "the seed answered: no reactivation");
});

test("blocked region with no pool to load: a re-activation does not clear the region flag", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: "404: Not Found", routes: { "v3/searchByName": GEO } });
  await assert.rejects(w.catalog.search(query), kinoErr("geo_blocked"));
  assert.ok(w.paths().includes("v8/active"), "the session was renewed (it proved nothing about the region)");
  assert.equal(w.session.regionBlocked(), true, "the flag stays, so the periodic refresh keeps trying");
});

test("a failed pool download is not repeated by every blocked call: a short cooldown, then again", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: "404: Not Found", routes: { "v3/searchByName": GEO } });
  await assert.rejects(w.catalog.search(query), kinoErr("geo_blocked"));
  assert.equal(w.seedDownloads.length, 1);
  await assert.rejects(w.catalog.search({ ...query, q: "Otra" }), kinoErr("geo_blocked"));
  assert.equal(w.seedDownloads.length, 1, "inside the cooldown: no second download");
  w.clock.t += 31_000;
  await assert.rejects(w.catalog.search({ ...query, q: "Tercera" }), kinoErr("geo_blocked"));
  assert.equal(w.seedDownloads.length, 2, "after the cooldown it tries again");
});

test("the region flag clears when a content call answers on the device's own session, not on a seed", async () => {
  const onSeed = portalWorld({ hosts: ["a.test"], seeds: SEEDS, session: { ...SEEDS[0], jwtToken: "", acct: "" } });
  onSeed.kino.storage.set("region", JSON.stringify({ blocked: true }));
  await onSeed.catalog.search(query);
  assert.equal(onSeed.session.regionBlocked(), true, "a seed answering proves nothing about this device");

  const own = portalWorld({ hosts: ["a.test"], seeds: SEEDS });
  own.kino.storage.set("region", JSON.stringify({ blocked: true }));
  await own.catalog.search(query);
  assert.equal(own.session.regionBlocked(), false, "the device's own session answered: the region is open");
});

test("an account in a blocked region never downloads the pool on a geo-block (seeds are not for accounts)", async () => {
  const w = portalWorld({ hosts: ["a.test"], seedsText: JSON.stringify(SEEDS), config: { email: "ana@x.test", password: "stand-in-pw" },
    session: { ...STORED, acct: "" }, routes: { "v3/searchByName": GEO } });
  await assert.rejects(w.catalog.search(query), kinoErr("geo_blocked"));
  assert.equal(w.seedDownloads.length, 0);
});

test("4 concurrent calls on a dead token renew it ONCE and all 4 succeed", async () => {
  const w = portalWorld({
    hosts: ["a.test"],
    routes: { getNextColumns: (bean) => (bean.userToken === STORED.userToken ? { returnCode: "aaa100027", errorMessage: "dead" } : { recommendList: [] }) },
  });
  const run = () => w.session.withValidSession((v) => w.portal.call("getNextColumns", { columnCode: "x" }, viewOpts(v)));
  const out = await Promise.all([run(), run(), run(), run()]);
  assert.equal(out.length, 4);
  for (const o of out) assert.deepEqual(o.recommendList, []);
  assert.equal(w.paths().filter((p) => p === "v8/active").length, 1, "single-flight: one reactivation");
  assert.equal(w.paths().filter((p) => p === "v3/snToken").length, 0, "the stored sn is kept: nothing minted");
  assert.equal(w.stored().userToken, "tok-new");
});

test("parallel calls share ONE in-flight pool download", async () => {
  // Home asks its four roots in parallel; with an empty pool each one is geo-blocked.
  const w = portalWorld({ hosts: ["a.test"], seedsText: JSON.stringify(SEEDS),
    routes: { getNextColumns: (bean) => (isSeed(bean) ? ANSWERS.getNextColumns(bean) : GEO) } });
  const rows = await w.catalog.home();
  assert.ok(rows.length > 0);
  assert.equal(w.seedDownloads.length, 1, "four blocked roots, one download");
  assert.equal(w.requests.filter((r) => isSeed(r.bean)).length, 4, "every root answered on the seed");
});

test("shared account, empty pool, dead pool URL: home's four parallel roots share one bounded download and end inside 20 s", async () => {
  // Each root falls to the per-call seed fallback, which needs the pool: one download for all of
  // them, none of them waiting past the call's deadline, and no second download after the failure.
  const w = portalWorld({
    hosts: ["a.test"], seedsDead: true, config: { useSharedAccount: true },
    session: { userId: "u-sh", userToken: "tok-sh", jwtToken: "", sn: "sn-dev", acct: "shared" },
    routes: { getNextColumns: GEO, "v8/login": { userId: "u-sh", userToken: "tok-sh" } },
  });
  assert.deepEqual(await w.catalog.home(), []);
  assert.ok(w.elapsed() <= 19_000, `home ran ${w.elapsed()} ms`);
  assert.equal(w.seedDownloads.length, 1, "one shared download");
});

test("an account whose login fails keeps the working anonymous token: no reactivation of the device", async () => {
  for (const login of [new Error("offline"), { returnCode: "aaa100099", errorMessage: "refused" }]) {
    const w = portalWorld({ hosts: ["a.test"], config: { email: "ana@x.test", password: "stand-in-pw" }, routes: { "v8/login": login } });
    const out = await w.catalog.search(query);
    assert.equal(out[0].id, "D1");
    assert.deepEqual(w.paths(), ["v8/login", "v3/searchByName"], "the anonymous token served the call as it was");
    assert.equal(w.stored().userToken, STORED.userToken);
  }
});

test("a token of ANOTHER account is still dropped before the login (it must never serve this one)", async () => {
  const w = portalWorld({ hosts: ["a.test"], config: { email: "ana@x.test", password: "stand-in-pw" },
    session: { ...STORED, acct: "someone-else" }, routes: { "v8/login": new Error("offline") } });
  await w.catalog.search(query);
  assert.deepEqual(w.paths(), ["v8/login", "v8/active", "v3/searchByName"]);
});
