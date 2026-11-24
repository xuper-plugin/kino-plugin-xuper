// 3.1.16: the catalog's cards carry the TMDB ids the publisher added (kinotvapp/oleada-py tools/enrich_ids.py), so
// Kino's Home matches each title with no TMDB request on the device. Items pass them through (`ids`), the v2 catalog
// validates them, a «Ver más» column page borrows them from the stored catalog, and a catalog without ids still works.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const { beginCall } = await import("../src/flight.js");
const api = await import("../src/api.js");
const data = await import("../src/data.js");
const catalog = await import("../src/catalog.js");
const { toItem, cleanIds } = await import("../src/items.js");
const { fromLegacyHome, seal, validateCatalog } = await import("../src/v2.js");
const { toV2 } = await import("../tools/to-v2.mjs");
const { colRef } = await import("../src/refs.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const REC = { poster: "recommended" };
const card = (id, name, type = "1", ids) => ({ contentId: id, name, type, posterList: [], ...(ids ? { ids } : {}) });

test("cleanIds keeps a positive tmdb and a tt imdb, drops anything else", () => {
  assert.deepEqual(cleanIds({ tmdb: 2501 }), { tmdb: 2501 });
  assert.deepEqual(cleanIds({ tmdb: 2501, imdb: "tt0258463", x: 1 }), { tmdb: 2501, imdb: "tt0258463" });
  assert.deepEqual(cleanIds({ tmdb: "2501", imdb: "tt0258463" }), { imdb: "tt0258463" });
  for (const bad of [undefined, null, [], {}, { tmdb: 0 }, { tmdb: -3 }, { tmdb: 1.5 }, { tmdb: 2 ** 31 }, { imdb: "0258463" }]) {
    assert.equal(cleanIds(bad), undefined, JSON.stringify(bad));
  }
});

test("toItem passes the card's ids through (recommended mode); legacy mode and cards without ids are unchanged", () => {
  assert.deepEqual(toItem(card("m1", "Interestelar", "1", { tmdb: 157336 }), false, REC).ids, { tmdb: 157336 });
  assert.deepEqual(toItem(card("s1", "Romelia Senki T1", "0", { tmdb: 12345 }), false, REC).ids, { tmdb: 12345 });
  assert.equal("ids" in toItem(card("m2", "Sin ids"), false, REC), false);
  assert.equal("ids" in toItem(card("m3", "Malo", "1", { tmdb: "x" }), false, REC), false);
  assert.equal("ids" in toItem(card("m1", "Interestelar", "1", { tmdb: 157336 })), false, "legacy = 1.0.43's shape");
});

const LEGACY = { version: 1, generatedAt: 1794844780749, sections: {
  pelicula: { slider: [], rows: { recommendList: [
    { name: "Acción", columnId: 85205, assetList: [card("p1", "Interestelar", "1", { tmdb: 157336 }), card("p2", "Dos")] },
  ] } },
  series: { slider: [], rows: { recommendList: [
    { name: "Anime", assetList: [card("s1", "Romelia Senki T1", "0", { tmdb: 12345 })] },
  ] } },
} };

test("the v2 catalog (device conversion and the data branch builder) carries the ids and validates", () => {
  const v2 = seal(fromLegacyHome(LEGACY, REC), LEGACY.generatedAt, sha256);
  const byId = Object.fromEntries(v2.items.map((it) => [it.id, it]));
  assert.deepEqual(byId.p1.ids, { tmdb: 157336 });
  assert.deepEqual(byId.s1.ids, { tmdb: 12345 });
  assert.equal(byId.p2.ids, undefined);
  assert.deepEqual(validateCatalog(v2), []);
  const built = toV2({ home: LEGACY, matches: { matches: [] }, gen: 1 });
  assert.equal(built.ok, true, built.problems.join("; "));
  const cat = JSON.parse(built.files[0].text);
  assert.deepEqual(cat.items.find((it) => it.id === "p1").ids, { tmdb: 157336 });
});

test("validateCatalog: ids optional; a malformed ids object is refused", () => {
  const base = () => seal(fromLegacyHome(LEGACY, REC), 1, sha256);
  const ok = base();
  delete ok.items[0].ids;
  assert.deepEqual(validateCatalog(ok), [], "an old catalog without ids still validates");
  for (const bad of [{}, { tmdb: 0 }, { tmdb: "1" }, { imdb: "nm123" }, { tmdb: 1, other: 2 }, [], "x"]) {
    const v = base();
    v.items[0].ids = bad;
    assert.ok(validateCatalog(v).some((p) => p.endsWith(".ids")), JSON.stringify(bad));
  }
  const both = base();
  both.items[0].ids = { tmdb: 1, imdb: "tt0816692" };
  assert.deepEqual(validateCatalog(both), []);
});

test("browse(col:<id>): a column page borrows the ids of the titles the stored catalog holds", async () => {
  const BACKEND = "https://x.xkplugins.site";
  const COLUMN = { items: [card("p1", "Interestelar"), card("p9", "Nueva")], total: 2, page: 1, size: 30 };
  const v2 = seal(fromLegacyHome(LEGACY, REC), LEGACY.generatedAt, sha256);
  const storage = {
    "o2:bearer": "bearer-token", "o2:mig": "1",
    "o2:cat": JSON.stringify(v2),
    "o2:catm": JSON.stringify({ h: v2.hash, gen: LEGACY.generatedAt, etag: '"e1"', lm: "", src: "rel", b: 3, checkedAt: Date.now(), writtenAt: Date.now() - 60_000, failAt: 0, failN: 0 }),
  };
  const k = installKino({ storage, routes: [(url, init) => {
    if (url.startsWith(BACKEND + "/column/egress") && (init || {}).method === "POST") {
      return res(200, JSON.stringify({ results: COLUMN }), { "content-type": "application/json" });
    }
    return undefined;
  }] });
  await api.clearBearer();
  for (const [key, v] of Object.entries(storage)) k.kino.storage.set(key, v);
  api._resetRateLimit();
  api._resetEgress();
  data._resetMemory();
  beginCall();
  const page = await catalog.browse(colRef("85205"));
  const byId = Object.fromEntries(page.items.map((it) => [it.id, it]));
  assert.deepEqual(byId.p1.ids, { tmdb: 157336 });
  assert.equal(byId.p9.ids, undefined);
});
