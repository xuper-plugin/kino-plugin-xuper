import { test } from "node:test";
import assert from "node:assert/strict";

import { toEpisodes, expiresIn, subtitlesOf, resolve } from "../src/catalog.js";
import { toItem, toItems, sectionCards, pickPoster, durationToMinutes } from "../src/items.js";
import { liveCategories, liveChannels } from "../src/live.js";
import { decodeRef, itemRef, episodeRef, liveRef, withQuality } from "../src/refs.js";
import { clearBearer } from "../src/api.js";

// GATEO: sin activar (sin Bearer) NO se carga NI reproduce NADA — ni canales, ni VOD, ni el fallback masnew.
test("gateo: sin Bearer no hay live ni reproducción (activar es obligatorio)", async () => {
  const prev = globalThis.kino;
  globalThis.kino = { storage: { get: () => null }, error: (c, m) => Object.assign(new Error(m), { code: c }) };
  await clearBearer();
  try {
    assert.deepEqual(await liveCategories(), [], "liveCategories vacío sin activar (as 1.0.43: [], never a throw)");
    assert.deepEqual(await liveChannels({ categoryId: "supertv.31" }), [], "liveChannels vacío sin activar");
    const notActivated = (e) => e.code === "auth_required" && /not activated/.test(e.message);
    await assert.rejects(() => resolve("v:123:1"), notActivated, "VOD bloqueado sin activar");
    await assert.rejects(() => resolve("L:supertv:abc"), notActivated, "canal en vivo bloqueado sin activar");
  } finally { globalThis.kino = prev; }
});

test("toItem maps a movie card", () => {
  const it = toItem({
    contentId: "BCF4902C", name: "Un amor extraordinario", type: "1", score: 6.6,
    description: "sinopsis", tags: "Drama,Romance",
    posterList: [{ fileUrl: "http://x/p.jpg", fileType: "poster" }],
  });
  assert.equal(it.id, "BCF4902C");
  assert.equal(it.kind, "movie");
  assert.equal(it.ref, "v:BCF4902C:1");
  assert.equal(it.title, "Un amor extraordinario");
  assert.equal(it.poster, "http://x/p.jpg");
  assert.equal(it.rating, 6.6);
  assert.deepEqual(it.genres, ["Drama", "Romance"]);
});

test("toItem marks a series by type 0", () => {
  assert.equal(toItem({ contentId: "S1", name: "Serie", type: "0" }).kind, "series");
});

test("durationToMinutes parses HH:MM:SS (y vacío/ inválido → 0)", () => {
  assert.equal(durationToMinutes("02:12:00"), 132);
  assert.equal(durationToMinutes("00:45:30"), 46);   // 45.5 → 46
  assert.equal(durationToMinutes(""), 0);
  assert.equal(durationToMinutes("x"), 0);
  assert.equal(durationToMinutes(null), 0);
});

test("toItem sets runtimeMinutes from duration (seguir viendo nativo)", () => {
  assert.equal(toItem({ contentId: "M", name: "m", type: "1", duration: "01:30:00" }).runtimeMinutes, 90);
  assert.equal(toItem({ contentId: "N", name: "n", duration: "" }).runtimeMinutes, undefined);
});

test("toItem drops a card without contentId", () => {
  assert.equal(toItem({ name: "x" }), null);
});

test("toItems dedupes by id", () => {
  const items = toItems([{ contentId: "A", name: "a" }, { contentId: "A", name: "a2" }, { contentId: "B", name: "b" }]);
  assert.deepEqual(items.map((i) => i.id), ["A", "B"]);
});

test("sectionCards flattens recommendList assetLists", () => {
  const cards = sectionCards({ recommendList: [
    { name: "Row1", assetList: [{ contentId: "A", name: "a" }] },
    { name: "Row2", assetList: [{ contentId: "B", name: "b" }] },
  ] });
  assert.equal(cards.length, 2);
  assert.equal(cards[1].contentId, "B");
});

test("toEpisodes maps simpleProgramList", () => {
  const { series, episodes } = toEpisodes({
    name: "Mi Serie",
    simpleProgramList: [
      { contentId: "E1", name: "Ep 1", programIndex: 1 },
      { contentId: "E2", name: "Ep 2", programIndex: 2 },
    ],
  }, "SERIES1");
  assert.equal(series.title, "Mi Serie");
  assert.equal(episodes.length, 2);
  assert.equal(episodes[0].ref, "e:E1:SERIES1");
  assert.equal(episodes[1].number, 2);
});

test("decodeRef round-trips", () => {
  assert.deepEqual(decodeRef(itemRef("CID", "1")), { kind: "item", id: "CID", type: "1" });
  assert.deepEqual(decodeRef(episodeRef("E", "S")), { kind: "episode", id: "E", series: "S" });
  // Canal en vivo agregado: "L:<fuente>:<canal URL-encoded>" → {kind:"live", source, channel}. El canal puede
  // ser una URL/slug/id con ":" o "|" (se URL-encodea), así no colisiona con los separadores de ref.
  assert.deepEqual(decodeRef(liveRef("premiumtv", "http://x/a:b.m3u8")), { kind: "live", source: "premiumtv", channel: "http://x/a:b.m3u8" });
  assert.deepEqual(decodeRef(liveRef("supertv", "12345")), { kind: "live", source: "supertv", channel: "12345" });
  assert.deepEqual(decodeRef("cat:pelicula"), { kind: "category", name: "pelicula" });
  assert.deepEqual(decodeRef("col:85231"), { kind: "column", columnId: "85231" });
});

test("withQuality / decodeRef: la marca de calidad es ortogonal (selector de calidad)", () => {
  // un ref de calidad agrega `quality`, sin tocar id/type/series
  assert.deepEqual(decodeRef(withQuality(itemRef("CID", "1"), "720p")), { kind: "item", id: "CID", type: "1", quality: "720p" });
  assert.deepEqual(decodeRef(withQuality(episodeRef("E", "S"), "480p")), { kind: "episode", id: "E", series: "S", quality: "480p" });
  // sin calidad, el ref NO cambia y el decode NO agrega `quality` (el caso por defecto queda intacto)
  assert.equal(withQuality(itemRef("CID", "1"), ""), itemRef("CID", "1"));
  assert.equal(decodeRef(itemRef("CID", "1")).quality, undefined);
});

test("subtitlesOf: mapea al formato de Kino (lang/url/format), filtra vacíos y topa en 30", () => {
  assert.deepEqual(subtitlesOf([
    { language: "Spanish", url: "https://cdn/es.vtt", fileType: "VTT" },
    { language: "en", url: "https://cdn/en.srt", fileType: "srt" },
    { language: "pt", url: "https://cdn/pt.ass", fileType: "ass" }, // formato raro → sin `format` (Kino infiere)
    { url: "" },                                                     // sin url → se descarta
    null,
  ]), [
    { url: "https://cdn/es.vtt", lang: "Spanish", format: "vtt" },
    { url: "https://cdn/en.srt", lang: "en", format: "srt" },
    { url: "https://cdn/pt.ass", lang: "pt" },
  ]);
  assert.deepEqual(subtitlesOf(null), []);
  assert.equal(subtitlesOf(Array.from({ length: 40 }, (_, i) => ({ url: `u${i}`, language: "x" }))).length, 30);
});

test("expiresIn clamps and ignores the past", () => {
  const soon = Math.floor(Date.now() / 1000) + 1000;
  assert.equal(expiresIn(soon), 1000);
  assert.equal(expiresIn(Math.floor(Date.now() / 1000) - 10), undefined);
  assert.equal(expiresIn(0), undefined);
});

test("pickPoster prefers a poster/stage fileType", () => {
  assert.equal(pickPoster([{ fileUrl: "a", fileType: "icon" }, { fileUrl: "b", fileType: "poster" }]), "b");
  assert.equal(pickPoster([{ fileUrl: "a" }]), "a");
  assert.equal(pickPoster(null), undefined);
});
