import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";

// The plugin runtime provides `kino` as a global: do the same, before the modules under test load.
globalThis.kino = fakeKino();
const { getDeps, guarded } = await import("../src/wiring.js");
const plugin = await import("../src/plugin.js");

test("getDeps builds crypto, portal, session and catalog once", () => {
  const a = getDeps();
  assert.equal(getDeps(), a);
  assert.equal(typeof a.catalog.home, "function");
  assert.equal(typeof a.catalog.browse, "function");
  assert.equal(typeof a.session.ensure, "function");
  assert.equal(typeof a.clock.now(), "number");
});

test("home and browse go through the catalog; with no configured host the failure is a kino unavailable", async () => {
  await assert.rejects(() => plugin.home(), (e) => e.code === "unavailable");
  await assert.rejects(() => plugin.browse("magis_top_peliculas", null), (e) => e.code === "unavailable");
});

test("guarded passes kino errors through and maps anything else to a Spanish unavailable", async () => {
  const mine = kino.error("geo_blocked", "Este contenido no está disponible en tu región");
  await assert.rejects(() => guarded(() => { throw mine; }), (e) => e === mine);
  await assert.rejects(() => guarded(() => { throw new TypeError("x is undefined"); }), (e) => {
    return e.code === "unavailable" && e.message === "Xuper no está disponible ahora";
  });
  assert.equal(await guarded(() => 7), 7);
});

test("search goes through the catalog: an empty query is [], with no configured host the failure is a kino unavailable", async () => {
  assert.equal(typeof getDeps().tmdb.titleForms, "function");
  assert.deepEqual(await plugin.search({ q: "  ", type: "any", season: 0, episode: 0, tmdbId: 0 }), []);
  await assert.rejects(() => plugin.search({ q: "Dune", type: "any", season: 0, episode: 0, tmdbId: 0 }), (e) => e.code === "unavailable");
});
