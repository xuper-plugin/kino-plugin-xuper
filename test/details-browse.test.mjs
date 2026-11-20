// details(ref) for movies (apiVersion 8: the IMDb id from the portal detail's keyWords, so Kino pins the right film on
// TMDB) and the season collapse carried into browse (a live column's "Ver más" shows one entry per series, like search).
import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const catalog = await import("../src/catalog.js");
const data = await import("../src/data.js");
const { itemRef, colRef } = await import("../src/refs.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });

async function device(backend) {
  const k = installKino({ storage: { "o2:bearer": "bearer-token", "o2:mig": "1" }, routes: [(url, init) => {
    if (url.startsWith(BACKEND)) return backend(url.slice(BACKEND.length), init || {});
    return undefined;
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  api._resetRateLimit();
  api._resetEgress();
  data._resetMemory();
  beginCall();
  return k;
}

test("details: a movie's IMDb id comes from the detail's keyWords (pins the film on TMDB)", async () => {
  const MOVIE = { results: { detail: { name: "Matrix español latino", keyWords: "tt0133093" }, related: [] } };
  await device((p) => (p.startsWith("/item/egress") ? json(MOVIE) : undefined));
  assert.deepEqual(await catalog.details(itemRef("101", "1")), { ids: { imdb: "tt0133093" } });
});

test("details: a series ref is never pinned here (it uses episodes().series), and no keyWords → null", async () => {
  let itemCalls = 0;
  await device((p) => { if (p.startsWith("/item/egress")) { itemCalls++; return json({ results: { detail: { name: "Sin id" }, related: [] } }); } return undefined; });
  assert.equal(await catalog.details(itemRef("5", "0")), null);   // a series: movies only, no backend call
  assert.equal(itemCalls, 0);
  assert.equal(await catalog.details(itemRef("101", "1")), null); // a movie with no keyWords → null (Kino's title match still enriches)
  assert.equal(itemCalls, 1);
});

test("browse: a live column collapses a series' seasons to one (Lupin) and cleans the name; movies untouched", async () => {
  const COL = { results: { items: [
    { contentId: "101", name: "Lupin T2", type: "0", posterList: [] },
    { contentId: "102", name: "Lupin T1", type: "0", posterList: [] },
    { contentId: "200", name: "Matrix", type: "1", posterList: [] },
  ], total: 3, page: 1, size: 30 } };
  await device((p) => (p.startsWith("/column/egress") ? json(COL) : undefined));
  const page = await catalog.browse(colRef("77"));
  assert.deepEqual(page.items.map((it) => it.title), ["Lupin", "Matrix"]);   // Lupin T1 (lowest) kept and cleaned, T2 dropped, the movie stays
});
