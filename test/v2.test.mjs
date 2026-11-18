import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

globalThis.kino = { lang: "es", config: {} };
const {
  fromLegacyHome, fromLegacyMatches, validateCatalog, validateMatches, canonicalHash, canonicalText, seal,
  homeRows, sectionView, browsePage, itemById, slidesOf, isLiveMatch, visibleMatches, parseUtcTime,
} = await import("../src/v2.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const fixture = (n) => JSON.parse(readFileSync(new URL("./fixtures/" + n, import.meta.url), "utf8"));
const reduced = fixture("home.reduced.json");
const golden = fixture("golden-1.0.43.json");   // what 1.0.43's own functions drew from home.reduced.json

// The joined surfaces of a v2 catalog, in 1.0.43's shapes (slide text "" when absent, rail title "" when absent).
function surfaces(v2, name) {
  const v = sectionView(v2, name);
  const s = v2.sections[name];
  return {
    all: v.all,
    home: s.home ? v.all.slice(0, s.home) : null,
    slides: v.slides.map((x) => ({ ...x, text: x.text || "" })),
    rails: v.rails.map((r) => ({ title: r.title || "", items: r.items })),
    genres: v.genres,
  };
}

test("legacy poster mode reproduces 1.0.43 exactly (golden from home.reduced.json)", () => {
  const v2 = fromLegacyHome(reduced, { poster: "legacy" });
  for (const name of Object.keys(golden)) {
    const got = surfaces(v2, name);
    for (const k of ["all", "home", "slides", "rails", "genres"]) {
      assert.deepEqual(got[k], golden[name][k], `${name}.${k}`);
    }
  }
});

test("recommended mode: poster = portrait icon (non-GIF), backdrop = landscape stage|poster", () => {
  const v2 = fromLegacyHome({ sections: { pelicula: { slider: [], rows: { recommendList: [{ name: "R", assetList: [
    { contentId: "A", name: "a", type: "1", posterList: [{ fileType: "icon", fileUrl: "https://i/a.jpg" }, { fileType: "poster", fileUrl: "https://i/a-wide.jpg" }] },
    { contentId: "B", name: "b", type: "1", posterList: [{ fileType: "icon", fileUrl: "https://i/b.gif" }, { fileType: "stage", fileUrl: "https://i/b-wide.jpg" }] },
    { contentId: "C", name: "c", type: "1", posterList: [{ fileType: "stage", fileUrl: "http://i/c.jpg" }] },
  ] }] } } } });
  const [a, b, c] = v2.items;
  assert.equal(a.poster, "https://i/a.jpg");
  assert.equal(a.backdrop, "https://i/a-wide.jpg");
  assert.equal(b.poster, "https://i/b-wide.jpg", "a GIF icon falls back to the landscape art");
  assert.equal(b.backdrop, undefined, "no backdrop equal to the poster");
  assert.equal(c.poster, undefined, "plain http is left out in recommended mode");
  assert.deepEqual(Object.keys(a), ["id", "ref", "title", "kind", "poster", "backdrop"]);
});

test("adult is OR-ed across sections and an adult title never becomes a hero slide", () => {
  const card = (id) => ({ contentId: id, name: id, type: "1", posterList: [{ fileType: "stage", fileUrl: "https://i/" + id + ".jpg" }] });
  const v2 = fromLegacyHome({ sections: {
    populares: { slider: [card("X"), card("Y")], rows: { recommendList: [{ name: "R", assetList: [card("X"), card("Y")] }] } },
    adultos: { slider: [], rows: { recommendList: [{ name: "A", assetList: [card("X")] }] } },
  } });
  assert.equal(itemById(v2, "X").adult, true);
  assert.equal(itemById(v2, "Y").adult, undefined);
  assert.deepEqual(v2.sections.populares.slides.map((s) => s.id), ["Y"]);
  assert.equal(v2.sections.adultos.home, undefined);
  assert.equal(v2.sections.adultos.slides, undefined);
});

test("seal: hash = 16 hex of sha256(canonical JSON without gen/hash); deterministic; keys in order", () => {
  const body = fromLegacyHome(reduced);
  const a = seal(body, 1794844780749, sha256);
  const b = seal(fromLegacyHome(reduced), 1, sha256);
  assert.match(a.hash, /^[0-9a-f]{16}$/);
  assert.equal(a.hash, b.hash, "gen does not change the hash");
  assert.deepEqual(Object.keys(a), ["schema", "hash", "gen", "items", "sections"]);
  assert.equal(canonicalHash(a, sha256), a.hash);
  assert.equal(canonicalText(a), JSON.stringify({ schema: 2, items: a.items, sections: a.sections }));
  assert.equal(canonicalHash(JSON.parse(JSON.stringify(a)), sha256), a.hash, "survives a JSON round trip");
});

test("validator accepts the converter's output and Kino-valid payloads", () => {
  const v2 = seal(fromLegacyHome(reduced), 1, sha256);
  assert.deepEqual(validateCatalog(v2), []);
});

test("validator rejects schema ≠ 2, \"\" values, non-https images, bad indexes and adult slides", () => {
  const ok = () => seal(fromLegacyHome(reduced), 1, sha256);
  const v1 = ok(); v1.schema = 3;
  assert.ok(validateCatalog(v1).some((e) => /schema/.test(e)));
  const v2 = ok(); v2.items[0].overview = "";
  assert.ok(validateCatalog(v2).some((e) => /empty string/.test(e)));
  const v3 = ok(); v3.items[0].poster = "http://x/p.jpg";
  assert.ok(validateCatalog(v3).some((e) => /poster is not https/.test(e)));
  const v4 = ok(); v4.sections.populares.all.push(99999);
  assert.ok(validateCatalog(v4).some((e) => /populares\.all/.test(e)));
  const v5 = ok(); v5.items[v5.sections.populares.all[0]].id = "bad id";
  assert.ok(validateCatalog(v5).some((e) => /\.id/.test(e)));
  const v6 = ok(); const sid = v6.sections.populares.slides[0].id; const idx = v6.items.findIndex((i) => i.id === sid);
  if (idx >= 0) { v6.items[idx].adult = true; assert.ok(validateCatalog(v6).some((e) => /adult title/.test(e))); }
  assert.deepEqual(validateCatalog(null), ["not an object"]);
});

test("homeRows: one row per non-adult section, first 18 of `all`, adultos never; titles in the person's language", () => {
  const rows = (n) => ({ recommendList: [{ name: "R", assetList: Array.from({ length: n }, (_, i) => ({ contentId: "C" + n + "x" + i, name: "t" + i, type: "1" })) }] });
  const legacy = { sections: {} };
  for (const s of ["populares", "pelicula", "series", "anime", "ninos", "adultos"]) legacy.sections[s] = { slider: [], rows: rows(25) };
  const v2 = fromLegacyHome(legacy);
  const out = homeRows(v2);
  assert.deepEqual(out.map((r) => r.id), ["sec-populares", "sec-pelicula", "sec-series", "sec-anime", "sec-ninos"]);
  assert.ok(out.every((r) => r.items.length === 18));
  assert.deepEqual(Object.keys(out[1]), ["id", "title", "items", "ref", "genre"]);
  assert.equal(out[1].title, "Películas");
  assert.equal(out[1].ref, "cat:pelicula");
  globalThis.kino = { lang: "en" };
  assert.equal(homeRows(v2)[1].title, "Movies");
  globalThis.kino = { lang: "es" };
});

test("browsePage: pages of 100 (a whole section), page-number cursors", () => {
  const legacy = { sections: { adultos: { slider: [], rows: { recommendList: [{ name: "R", assetList: Array.from({ length: 130 }, (_, i) => ({ contentId: "A" + i, name: "a", type: "1" })) }] } } } };
  const v2 = fromLegacyHome(legacy);
  const p1 = browsePage(v2, "adultos", null);
  assert.equal(p1.items.length, 100);
  assert.equal(p1.next, "2");
  const p2 = browsePage(v2, "adultos", p1.next);
  assert.equal(p2.items.length, 30);
  assert.equal(p2.next, null);
  assert.ok(p1.items.every((i) => i.adult === true));
  assert.deepEqual(browsePage(v2, "nope", null), { items: [], next: null });
});

test("itemById finds an item and misses cleanly", () => {
  const v2 = fromLegacyHome(reduced);
  const first = v2.items[0];
  assert.equal(itemById(v2, first.id), first);
  assert.equal(itemById(v2, "nope"), null);
  assert.equal(itemById(null, "x"), null);
});

test("slidesOf keeps 1.0.43's behaviour: image required, duplicates skipped", () => {
  const slides = slidesOf([
    { contentId: "A", name: "a", type: "1", posterList: [{ fileType: "stage", fileUrl: "https://x/a.jpg" }] },
    { contentId: "A", name: "a-dup", posterList: [{ fileType: "stage", fileUrl: "https://x/a.jpg" }] },
    { contentId: "B", name: "b", posterList: [] },
  ]);
  assert.equal(slides.length, 1);
  assert.equal(slides[0].ref, "v:A:1");
});

test("fromLegacyMatches: drops state/score/channelCode/matchLogo, keeps https crests, title only without teams", () => {
  const m = fromLegacyMatches({
    matches: [
      { matchName: "Liga", gameTime: "2026-11-16 15:00", gameState: "pre", score: "0-0", channelCode: "c", matchLogo: "https://l",
        channelName: "FOX", team_a: { teamName: "A", teamLogo: "https://a.png" }, team_b: { teamAlias: "BB", teamLogo: "http://b.png" } },
      { matchName: "Copa", gameTime: "2026-11-16 18:00", gameName: "X vs Y" },
    ],
  });
  assert.deepEqual(m, { schema: 2, matches: [
    { league: "Liga", time: "2026-11-16 15:00", a: { n: "A", l: "https://a.png" }, b: { n: "BB" }, ch: "FOX" },
    { league: "Copa", time: "2026-11-16 18:00", title: "X vs Y" },
  ] });
  assert.deepEqual(validateMatches(seal(m, 1, sha256)), []);
  const bad = seal(m, 1, sha256); bad.matches[0].a.l = "http://x";
  assert.ok(validateMatches(bad).length > 0);
});

test("live window: [kickoff − 5 min, kickoff + 130 min]; hidden 3 h after kickoff", () => {
  const t = parseUtcTime("2026-11-16 15:00");
  assert.equal(t, Date.UTC(2026, 10, 16, 15, 0), "the portal's gameTime is UTC");
  const m = { time: "2026-11-16 15:00" };
  assert.equal(isLiveMatch(m, t - 6 * 60000), false);
  assert.equal(isLiveMatch(m, t - 4 * 60000), true);
  assert.equal(isLiveMatch(m, t + 129 * 60000), true);
  assert.equal(isLiveMatch(m, t + 131 * 60000), false);
  assert.equal(isLiveMatch({ time: "x" }, t), false);
  assert.equal(isLiveMatch({ kickoff: t, time: "2000-01-01 00:00" }, t + 60000), true, "kickoff wins over time");
  assert.equal(visibleMatches([m], t + 3 * 3600000 - 1).length, 1);
  assert.equal(visibleMatches([m], t + 3 * 3600000 + 1).length, 0);
  assert.equal(visibleMatches([{ title: "no time" }], t).length, 1);
});

test("recommended mode: one card Kino would refuse is left out, never the whole catalog (contract-4)", () => {
  const base = seal(fromLegacyHome(reduced, { poster: "recommended" }), 1, sha256);
  assert.deepEqual(validateCatalog(base), []);
  const ids = (v) => new Set(v.items.map((it) => it.id));
  const card = (j) => j.sections.populares.rows.recommendList[0].assetList[0];
  const long = "https://x.test/" + "a".repeat(2100) + ".jpg";
  const cases = {
    "contentId with ':'": (j) => { card(j).contentId = "ab:cd"; return "ab:cd"; },
    "contentId of 130 characters": (j) => { card(j).contentId = "A".repeat(130); return "A".repeat(130); },
    "slider name of spaces": (j) => { j.sections.populares.slider[0].name = "   "; },
    "poster URL over 2,048 characters": (j) => { card(j).posterList = [{ fileType: "icon", fileUrl: long }, ...(card(j).posterList || [])]; },
    "slide image over 2,048 characters": (j) => { j.sections.populares.slider[1].posterList = [{ fileType: "stage", fileUrl: long }]; },
    "row title of 250 characters": (j) => { j.sections.populares.rows.recommendList[0].name = "R".repeat(250); },
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const j = JSON.parse(JSON.stringify(reduced));
    const badId = mutate(j);
    const v = seal(fromLegacyHome(j, { poster: "recommended" }), 1, sha256);
    assert.deepEqual(validateCatalog(v), [], name);
    if (badId) {
      assert.ok(!ids(v).has(badId), name + ": the bad card is left out");
      assert.equal(v.items.length, base.items.length - 1, name + ": only that card");
    }
  }
  // the specifics
  const blank = JSON.parse(JSON.stringify(reduced)); blank.sections.populares.slider[0].name = "  ";
  assert.equal(fromLegacyHome(blank, { poster: "recommended" }).sections.populares.slides[0].title, "—");
  const longPoster = JSON.parse(JSON.stringify(reduced));
  card(longPoster).posterList = [{ fileType: "icon", fileUrl: long }, { fileType: "stage", fileUrl: "https://x.test/s.jpg" }];
  const it = fromLegacyHome(longPoster, { poster: "recommended" }).items.find((x) => x.id === card(reduced).contentId);
  assert.equal(it.poster, "https://x.test/s.jpg", "an unusable portrait falls back to the landscape art");
  const badSlide = JSON.parse(JSON.stringify(reduced)); badSlide.sections.populares.slider[0].contentId = "a:b";
  const slides = fromLegacyHome(badSlide, { poster: "recommended" }).sections.populares.slides;
  assert.ok(!slides.some((x) => x.id === "a:b"));
  assert.equal(slides.length, base.sections.populares.slides.length - 1);
  const longRow = JSON.parse(JSON.stringify(reduced)); longRow.sections.populares.rows.recommendList[0].name = "R".repeat(250);
  assert.equal(fromLegacyHome(longRow, { poster: "recommended" }).sections.populares.rails[0].title.length, 200);
  // legacy mode is untouched (1.0.43's output): a bad id there still fails validation, as before
  const legacyBad = JSON.parse(JSON.stringify(reduced)); card(legacyBad).contentId = "ab:cd";
  assert.ok(fromLegacyHome(legacyBad, { poster: "legacy" }).items.some((x) => x.id === "ab:cd"));
});
