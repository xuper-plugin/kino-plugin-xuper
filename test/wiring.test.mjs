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

test("episodes goes through the catalog: a ref that is not Xuper's is a Spanish unavailable, with no configured host a real ref is too", async () => {
  assert.equal(typeof getDeps().catalog.episodes, "function");
  assert.equal(typeof getDeps().catalog.portalChapters, "function");
  await assert.rejects(() => plugin.episodes("https://example.com/x"), (e) => e.code === "unavailable" && e.message === "ese ref no es de Xuper: no se pueden listar capítulos");
  await assert.rejects(() => plugin.episodes("magis1:teleplay:0:ABC"), (e) => e.code === "unavailable");
});

test("resolve goes through makeResolve: a ref that is not Xuper's is a Spanish unavailable, with no configured host a real ref is too", async () => {
  assert.equal(typeof getDeps().resolve.resolve, "function");
  await assert.rejects(() => plugin.resolve("https://example.com/video.mp4"), (e) => e.code === "unavailable" && e.message === "ese ref no es de Xuper: no se puede reproducir");
  await assert.rejects(() => plugin.resolve("magis1:movie:0:ABC", { reason: "retry" }), (e) => e.code === "unavailable");
});

test("liveCategories and liveChannels go through the live catalog: bad input is a kino not_found, with no configured host the failure is a kino unavailable", async () => {
  assert.equal(typeof getDeps().live.liveChannels, "function");
  await assert.rejects(() => plugin.liveChannels({ categoryId: "abc" }), (e) => e.code === "not_found");
  await assert.rejects(() => plugin.liveCategories(), (e) => e.code === "unavailable");
  await assert.rejects(() => plugin.liveChannels({ categoryId: "76183" }), (e) => e.code === "unavailable");
});

test("a bare channel code resolves through the live stream: with no configured host it is a kino unavailable, never a VOD 'no es de Xuper'", async () => {
  assert.equal(typeof getDeps().liveStream.resolveLive, "function");
  await assert.rejects(() => plugin.resolve("cyx-RCNHD", { retry: { reason: "expired", attempt: 1 } }), (e) => e.code === "unavailable" && !e.message.includes("no es de Xuper"));
});

test("sign is exported and a broken context is a Spanish unavailable", async () => {
  assert.equal(typeof plugin.sign, "function");
  await assert.rejects(() => plugin.sign({ url: "http://x.live.test/a.m3u8", kind: "playlist", ref: "c", context: "nope" }), (e) => e.code === "unavailable" && e.message === "No se pudo firmar la petición del canal");
});
