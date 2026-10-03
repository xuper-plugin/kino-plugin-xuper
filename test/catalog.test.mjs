import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput } from "../sdk/contract.mjs";
import { makeCatalog, parseShelveTime, projectRows } from "../src/catalog.js";
import { classify } from "../src/homeClassifier.js";
import { parseTree, encodeTree, storedLength } from "../src/homeTree.js";
import { makeCrypto } from "../src/crypto.js";
import { makePortal } from "../src/portal.js";

const HOUR = 3600_000;
const ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

// ---- fixtures ---------------------------------------------------------------------------------

// A portal asset as getNextColumns sends it.
const asset = (id, extra = {}) => ({
  contentId: id, name: "T " + id, programType: "movie", tags: "Drama", score: 7, ...extra,
});
const column = (name, assets, columnId = 1) => ({ columnId, name, assetList: assets });
const answer = (...columns) => ({ recommendList: columns });
const assets = (prefix, n, extra = {}) => Array.from({ length: n }, (_, i) => asset(`${prefix}${i + 1}`, extra));
// Six drama titles under a plain section: enough for one genre row and the featured ones.
const smallTree = (prefix, programType = "movie") => answer(column("All", assets(prefix, 6, { programType })));

// Fake portal: answers `getNextColumns` per columnCode (a value, an Error, or a function); records calls.
function fakePortal(byCode) {
  const calls = [];
  return {
    calls,
    codes: () => calls.map((c) => c.bean.columnCode),
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      const a = byCode[bean.columnCode];
      if (a === undefined) throw new Error("unscripted root " + bean.columnCode);
      const v = typeof a === "function" ? a() : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function fakeSession({ ensureError = null } = {}) {
  const s = { ensures: 0, blocks: 0 };
  s.ensure = async () => { s.ensures++; if (ensureError) throw ensureError; };
  s.withValidSession = async (block) => { s.blocks++; return block({ userId: "u1", userToken: "tok1" }); };
  return s;
}

// kino with a spy over storage.set (delegating to the kit's real storage, ttl included).
function spyKino() {
  const base = fakeKino();
  const sets = [];
  const storage = Object.freeze({
    ...base.storage,
    set: (k, v, o) => { sets.push({ k, v, o }); return base.storage.set(k, v, o); },
  });
  return { kino: Object.freeze({ ...base, storage }), sets };
}

function setup({ roots, ensureError, now = NOW } = {}) {
  const { kino, sets } = spyKino();
  const portal = fakePortal(roots);
  const session = fakeSession({ ensureError });
  const clock = { t: now, now() { return this.t; } };
  const catalog = makeCatalog({ kino, portal, session, clock });
  return { kino, portal, session, clock, catalog, sets, treeSets: () => sets.filter((s) => s.k.startsWith("tree:")) };
}

const emptyRoots = () => ({ masnew_movies: answer(), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() });
const rowIds = (rows) => rows.map((r) => r.id);
const rowOf = (rows, id) => rows.find((r) => r.id === id);

// ---- home: the call pattern -------------------------------------------------------------------

test("home asks the four roots (never adultos) with getNextColumns, pageSize 60, the session's credentials", async () => {
  const { catalog, portal, session } = setup({
    roots: { masnew_movies: smallTree("p"), masnew_series: smallTree("s", "teleplay"), masnew_anime: answer(), masnew_kids: answer() },
  });
  await catalog.home();
  assert.deepEqual([...portal.codes()].sort(), ["masnew_anime", "masnew_kids", "masnew_movies", "masnew_series"]);
  assert.equal(portal.codes().includes("masnew_adult"), false);
  for (const c of portal.calls) {
    assert.equal(c.path, "getNextColumns");
    assert.deepEqual(c.bean, { columnCode: c.bean.columnCode, pageNum: 1, pageSize: 60, version: "" });
    assert.deepEqual(c.opts, { baseFields: true, userId: "u1", userToken: "tok1" });
  }
  assert.equal(session.ensures, 1, "ensure() once, before the first portal call");
});

test("home projects classifier rows: ids, order, ref = row id, items", async () => {
  const { catalog } = setup({
    roots: {
      masnew_movies: answer(column("2026", assets("n", 2)), column("All", assets("a", 6))),
      masnew_series: answer(column("2026", assets("s", 6, { programType: "teleplay" }))),
      masnew_anime: answer(), masnew_kids: answer(),
    },
  });
  const rows = await catalog.home();
  assert.deepEqual(rowIds(rows).slice(0, 4), ["magis_recent_peliculas", "magis_new_series", "magis_top_peliculas", "magis_top_series"]);
  for (const r of rows) {
    assert.equal(r.ref, r.id);
    assert.ok(r.items.length > 0 && r.items.length <= 20);
  }
  const recent = rowOf(rows, "magis_recent_peliculas");
  assert.equal(recent.title, "Recién agregadas · Películas");
  assert.deepEqual(recent.items.map((i) => i.id), ["n1", "n2"]);
  assert.equal(recent.items[0].ref, "magis1:movie:0:n1");
});

// ---- home: item projection --------------------------------------------------------------------

test("item projection: images, overview, genres cap, rating, runtime, kind, title fallback", async () => {
  const full = asset("F1", {
    name: "Una peli", programType: "variety", tags: "Action, Drama, Comedy, Crime, Horror, Mystery, Short",
    score: 8.5, duration: 5400, description: "Sinopsis",
    posterList: [{ fileType: "poster", fileUrl: "https://img.test/back" }, { fileType: "icon", fileUrl: "https://img.test/icon" }],
    posterUrl: "https://img.test/loose",
  });
  const loose = asset("L1", { name: "", posterUrl: "https://img.test/loose2", score: 11, duration: "7", tags: "" });
  const odd = asset("O1", { score: "n/a", duration: 70000 * 60, description: "", posterList: [{ fileType: "icon", fileUrl: "  " }] });
  const { catalog } = setup({
    roots: { masnew_movies: answer(column("All", [full, loose, odd])), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() },
  });
  const items = rowOf(await catalog.home(), "magis_top_peliculas").items;
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(byId.F1, {
    id: "F1", ref: "magis1:variety:0:F1", title: "Una peli", kind: "series",
    poster: "https://img.test/icon", backdrop: "https://img.test/back", overview: "Sinopsis",
    genres: ["Action", "Drama", "Comedy", "Crime", "Horror"], rating: 8.5, runtimeMinutes: 90,
  });
  // No name: title falls back to the id; score 11 is out of 0..10 (dropped, not clamped); 7 s is under a minute.
  assert.deepEqual(byId.L1, { id: "L1", ref: "magis1:movie:0:L1", title: "L1", kind: "movie", poster: "https://img.test/loose2" });
  // Unreadable score, runtime over 1000 minutes, blank poster url, blank description: all absent.
  assert.deepEqual(byId.O1, { id: "O1", ref: "magis1:movie:0:O1", title: "T O1", kind: "movie", genres: ["Drama"] });
});

test("items with a blank contentId, an invalid id or no section name are skipped; blank programType is movie", async () => {
  const { catalog } = setup({
    roots: {
      masnew_movies: answer(
        column("All", [asset(""), asset("   "), asset("bad id!"), { name: "sin id" }, asset("GOOD", { programType: "" }), asset("ALSO")]),
        { columnId: 2, name: "  ", assetList: [asset("HIDDEN")] },
      ),
      masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer(),
    },
  });
  const rows = await catalog.home();
  const ids = rowOf(rows, "magis_top_peliculas").items.map((i) => i.id);
  assert.deepEqual(ids.sort(), ["ALSO", "GOOD"]);
  assert.equal(rowOf(rows, "magis_top_peliculas").items.find((i) => i.id === "GOOD").ref, "magis1:movie:0:GOOD");
});

test("NUEVO badge: shelved within 48 h (portal time is GMT+8), never when undated or older", async () => {
  // NOW = 2026-10-02 12:00 UTC = 20:00 in China.
  const recent = asset("R", { shelveTime: "2026-10-01 20:00:00" });     // 24 h before
  const edge = asset("E", { shelveTime: "2026-09-30 20:00:00" });       // exactly 48 h: still new
  const old = asset("O", { shelveTime: "2026-09-30 19:59:59" });        // 48 h + 1 s
  const utcMisread = asset("U", { shelveTime: "2026-09-30 12:00:01" }); // 56 h old as GMT+8; would read as 47 h 59 m 59 s (new) if taken as UTC
  const none = asset("N"), junk = asset("J", { shelveTime: "ayer" });
  const { catalog } = setup({
    roots: { masnew_movies: answer(column("All", [recent, edge, old, utcMisread, none, junk])), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() },
  });
  const items = rowOf(await catalog.home(), "magis_top_peliculas").items;
  const badged = items.filter((i) => i.badges).map((i) => i.id).sort();
  assert.deepEqual(badged, ["E", "R"]);
  assert.deepEqual(items.find((i) => i.id === "R").badges, ["NUEVO"]);
});

test("parseShelveTime: yyyy-MM-dd HH:mm:ss in GMT+8, 0 when missing or unreadable", () => {
  assert.equal(parseShelveTime("2026-10-02 08:00:00"), Date.UTC(2026, 9, 2, 0, 0, 0));
  assert.equal(parseShelveTime(" 2026-10-02 08:00:00 "), Date.UTC(2026, 9, 2, 0, 0, 0));
  for (const bad of ["", null, undefined, "x", "2026-13-01 00:00:00", "2026-02-30 10:00:00", "2026-10-02", "2026-10-02 25:00:00"]) {
    assert.equal(parseShelveTime(bad), 0, String(bad));
  }
});

// ---- home: caps -------------------------------------------------------------------------------

test("output caps: at most 20 rows, at most 60 items a row, contract-valid", async () => {
  const genres = ["Action", "Comedy", "Drama", "Thriller", "Crime", "Sci-Fi", "Fantasy", "Romance", "Mystery", "Horror", "Family", "War"];
  const mk = (prefix, type) => genres.flatMap((g, i) => assets(`${prefix}${i}-`, 8 + i, { tags: g, programType: type }));
  const { catalog } = setup({
    roots: {
      masnew_movies: answer(column("2026", assets("n", 3)), column("All", mk("m", "movie"))),
      masnew_series: answer(column("2026", assets("u", 3, { programType: "teleplay" })), column("All", mk("s", "teleplay"))),
      masnew_anime: answer(column("All", mk("a", "series"))), masnew_kids: answer(column("All", mk("k", "movie"))),
    },
  });
  const rows = await catalog.home();
  assert.equal(rows.length, 20);
  assert.ok(rows.every((r) => r.items.length <= 60));
  const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  const checked = checkOutput("home", rows, manifest);
  assert.deepEqual(checked.drops, []);
  assert.equal(checked.value.length, 20);
});

// ---- home: real captured rows (git-excluded, read by absolute path) ----------------------------

const HOME_FIXTURE = "/Users/cristian/kino-light/.claude/worktrees/xuper-plain-plugin/app/src/test/resources/xuper-parity/home-1.json";
test("projection of the real captured rows (home-1.json) keeps ids, refs, kind, images, genres, rating", {
  skip: existsSync(HOME_FIXTURE) ? false : "home-1.json is git-excluded and absent here: nothing to compare against",
}, () => {
  const captured = JSON.parse(readFileSync(HOME_FIXTURE, "utf8"));
  const rows = captured.map((r) => ({
    id: r.id, title: r.title,
    shown: r.shown.map((i) => ({ ...i, genres: i.genres || [], score: i.score ?? null, shelvedAtMs: i.shelvedAtMs || 0 })),
    all: r.all.map((i) => ({ ...i, genres: i.genres || [], score: i.score ?? null, shelvedAtMs: i.shelvedAtMs || 0 })),
  }));
  assert.ok(rows.length > 0);
  const projected = projectRows(rows, NOW);
  assert.deepEqual(rowIds(projected), rowIds(rows));
  const SERIES = new Set(["teleplay", "series", "variety"]);
  for (const [src, out] of rows.map((r, i) => [r, projected[i]])) {
    assert.equal(out.ref, src.id);
    assert.deepEqual(out.items.map((i) => i.id), src.shown.map((i) => i.id), src.id);
    assert.deepEqual(out.items.map((i) => i.ref), src.shown.map((i) => i.ref), src.id);
    assert.deepEqual(out.items.map((i) => i.kind), src.shown.map((i) => (SERIES.has(i.type) ? "series" : "movie")), src.id);
    assert.deepEqual(out.items.map((i) => i.poster), src.shown.map((i) => i.poster ?? undefined), src.id);
    assert.deepEqual(out.items.map((i) => i.backdrop), src.shown.map((i) => i.backdrop ?? undefined), src.id);
    assert.deepEqual(out.items.map((i) => i.rating), src.shown.map((i) => i.score ?? undefined), src.id);
    // The contract caps genres at 5; the capture has an item with 7.
    assert.deepEqual(out.items.map((i) => i.genres), src.shown.map((i) => (i.genres.length ? i.genres.slice(0, 5) : undefined)), src.id);
    assert.ok(out.items.every((i) => i.runtimeMinutes === undefined)); // no captured durationS is positive
  }
  const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.deepEqual(checkOutput("home", projected, manifest).drops, []);
});

// ---- home: cache ------------------------------------------------------------------------------

test("trees are cached 2 h per root: a second home makes no portal call, after 2 h it refetches", async () => {
  const { catalog, portal, treeSets, session } = setup({
    roots: { masnew_movies: smallTree("p"), masnew_series: smallTree("s", "teleplay"), masnew_anime: smallTree("a"), masnew_kids: smallTree("k") },
  });
  const first = await catalog.home();
  assert.equal(portal.calls.length, 4);
  assert.deepEqual(treeSets().map((s) => s.o), Array(4).fill({ ttlMs: 2 * HOUR }));
  const second = await catalog.home();
  assert.equal(portal.calls.length, 4, "served from storage");
  assert.deepEqual(second, first);
  assert.equal(session.ensures, 1, "no ensure() when nothing needs the portal");
});

test("the cache expires through the storage ttl (real expiry)", async () => {
  const realNow = Date.now;
  const { catalog, portal } = setup({
    roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() },
  });
  await catalog.home();
  const before = portal.calls.length;
  Date.now = () => realNow() + 2 * HOUR + 1000;
  try { await catalog.home(); } finally { Date.now = realNow; }
  assert.equal(portal.calls.length, before + 4, "peliculas expired; the empty roots were never cached");
});

test("one root down: that root is empty, the others still show, and only the failing/empty ones are retried", async () => {
  let down = true;
  const { catalog, portal, treeSets } = setup({
    roots: {
      masnew_movies: () => (down ? new Error("portal down") : smallTree("p")),
      masnew_series: smallTree("s", "teleplay"), masnew_anime: answer(), masnew_kids: answer(),
    },
  });
  const rows = await catalog.home();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => !r.id.includes("peliculas")), rowIds(rows).join());
  assert.ok(rowOf(rows, "magis_top_series"));
  assert.deepEqual(treeSets().map((s) => s.k), ["tree:series"]);
  down = false;
  portal.calls.length = 0;
  const again = await catalog.home();
  assert.deepEqual([...portal.codes()].sort(), ["masnew_anime", "masnew_kids", "masnew_movies"], "series came from the cache");
  assert.ok(rowOf(again, "magis_top_peliculas"));
});

test("all roots empty: no rows and NO cache write (Review Focus 5)", async () => {
  const { catalog, sets, kino } = setup({ roots: emptyRoots() });
  assert.deepEqual(await catalog.home(), []);
  assert.deepEqual(sets, []);
  assert.deepEqual(kino.storage.keys(), []);
});

// ---- every root failing (port of main 2d285106 + 465773f1): one retry, then the error ----------

const allRoots = (a) => ({ masnew_movies: a, masnew_series: a, masnew_anime: a, masnew_kids: a });
const kinoErr = (code, message) => (e) => { assert.equal(e.name, "KinoError_" + code, e.message); if (message) assert.equal(e.message, message); return true; };

test("all roots failing twice: one retry of the pass, then the error is thrown (Home shows the failure and Reintentar), nothing cached", async () => {
  const { catalog, sets, portal } = setup({ roots: allRoots(() => new Error("down")) });
  await assert.rejects(catalog.home(), kinoErr("unavailable", "Xuper no está disponible ahora"));
  assert.equal(portal.calls.length, 8, "one pass + exactly one retry");
  assert.deepEqual(sets, []);
});

test("all roots failing once: the retried pass answers and Home shows its rows", async () => {
  let n = 0;
  const { catalog, portal } = setup({ roots: allRoots(() => (++n <= 4 ? new Error("down") : smallTree("p" + n))) });
  const rows = await catalog.home();
  assert.ok(rows.length > 0);
  assert.equal(portal.calls.length, 8);
});

test("the retry waits a short pause first, as native (1.5 s)", async () => {
  const t = setup({ roots: allRoots(() => new Error("down")) });
  const sleeps = [];
  const kino = Object.freeze({ ...t.kino, sleep: async (ms) => { sleeps.push(ms); } });
  const catalog = makeCatalog({ kino, portal: t.portal, session: t.session, clock: t.clock });
  await assert.rejects(catalog.home());
  assert.deepEqual(sleeps, [1500]);
});

test("the thrown error is the person-actionable one: a kino error from a root wins over a plain unavailable", async () => {
  const { kino } = spyKino();
  const geo = kino.error("geo_blocked", "Este contenido no está disponible en tu región");
  const { catalog } = setup({ roots: { masnew_movies: () => new Error("down"), masnew_series: () => geo, masnew_anime: () => new Error("x"), masnew_kids: () => new Error("y") } });
  await assert.rejects(catalog.home(), (e) => e === geo);
});

test("browse over a home whose every root failed throws the same error, not \"No se encontró esa lista\"", async () => {
  const { catalog } = setup({ roots: allRoots(() => new Error("down")) });
  await assert.rejects(catalog.browse("magis_top_peliculas", null), kinoErr("unavailable", "Xuper no está disponible ahora"));
});

test("not every root failed: no retry, no error (an empty root is not a failure, a cached root is content)", async () => {
  const empty = setup({ roots: emptyRoots() });
  assert.deepEqual(await empty.catalog.home(), []);
  assert.equal(empty.portal.calls.length, 4, "all empty but none failed: no retry");

  const mixed = setup({ roots: { ...allRoots(() => new Error("down")), masnew_kids: answer() } });
  assert.deepEqual(await mixed.catalog.home(), []);
  assert.equal(mixed.portal.calls.length, 4, "three failed, one answered empty: no retry");

  const cached = setup({ roots: allRoots(() => new Error("down")) });
  cached.kino.storage.set("tree:peliculas", encodeTree(parseTree(smallTree("c"))), { ttlMs: HOUR });
  const rows = await cached.catalog.home();
  assert.ok(rows.length > 0, "the cached root still shows");
  assert.equal(cached.portal.calls.length, 3, "only the three missing roots were asked, once");
});

test("no retry when the call's time is nearly spent: the error comes at once", async () => {
  const t = setup({ roots: allRoots(() => new Error("down")) });
  t.portal.call = async (path, bean, opts) => { t.portal.calls.push({ path, bean, opts }); t.clock.t += 16_000; throw new Error("down"); };
  await assert.rejects(t.catalog.home(), kinoErr("unavailable"));
  assert.equal(t.portal.calls.length, 4);
});

test("a tree whose columns hold no usable items is empty, not cached", async () => {
  const { catalog, sets } = setup({
    roots: {
      masnew_movies: answer(column("All", [])), masnew_series: { recommendList: "nope" },
      masnew_anime: {}, masnew_kids: answer(column("2026", [asset("")])),
    },
  });
  assert.deepEqual(await catalog.home(), []);
  assert.deepEqual(sets, []);
});

test("a corrupt or truncated cache entry is a miss, never an error", async () => {
  const { catalog, kino, portal } = setup({
    roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() },
  });
  kino.storage.set("tree:peliculas", "{not json", { ttlMs: HOUR });
  kino.storage.set("tree:series", JSON.stringify({ i: "x", s: 3 }), { ttlMs: HOUR });
  const rows = await catalog.home();
  assert.ok(rowOf(rows, "magis_top_peliculas"));
  assert.equal(portal.calls.length, 4);
});

test("ensure() failing surfaces as the mapped error, not as an empty home, and no portal call is made", async () => {
  const { kino } = spyKino();
  const err = kino.error("geo_blocked", "Este contenido no está disponible en tu región");
  const { catalog, portal } = setup({ roots: emptyRoots(), ensureError: err });
  await assert.rejects(() => catalog.home(), (e) => e === err);
  await assert.rejects(() => catalog.browse("magis_top_peliculas", null), (e) => e === err);
  assert.equal(portal.calls.length, 0);
});

test("bytes stored for the four roots stay under the storage budget with a realistic tree", async () => {
  const words = "Un hermano y una hermana descubren un ritual aterrador en la apartada casa de su nueva madre adoptiva donde nada es lo que parece ".split(" ");
  const hex = (n) => n.toString(16).padStart(32, "0").toUpperCase();
  const mkRoot = (offset, count, perColumn, type) => {
    const cols = [];
    for (let c = 0; c * perColumn < count; c++) {
      cols.push(column(c === 0 ? "2026" : `Seccion ${c}`, Array.from({ length: Math.min(perColumn, count - c * perColumn) }, (_, k) => {
        const n = offset + c * perColumn + k;
        return {
          contentId: hex(n), name: `Titulo largo de ejemplo numero ${n}`, programType: type, tags: "Action, Drama, Thriller, Crime",
          score: 7.5, duration: 6000, description: words.slice(n % 5).join(" ") + " " + words.slice(0, 12).join(" "),
          shelveTime: "2026-09-30 10:00:00",
          posterList: [{ fileType: "icon", fileUrl: `https://img.test/public/images/${hex(n)}-aaaa-bbbb` }, { fileType: "poster", fileUrl: `https://img.test/public/images/${hex(n + 99999)}-cccc` }],
        };
      })));
    }
    return answer(...cols);
  };
  const roots = { masnew_movies: mkRoot(0, 200, 10, "movie"), masnew_series: mkRoot(1000, 150, 10, "teleplay"), masnew_anime: mkRoot(2000, 100, 10, "series"), masnew_kids: mkRoot(3000, 80, 10, "movie") };
  const { catalog, kino } = setup({ roots });
  const rows = await catalog.home();
  assert.equal(rows.length, 20);
  const keys = kino.storage.keys().filter((k) => k.startsWith("tree:")).sort();
  // Measured as the app stores them: escaped by Android's org.json, in UTF-8.
  const sizes = keys.map((k) => storedLength(kino.storage.get(k)));
  assert.ok(sizes.every((n) => n <= 20_000));
  assert.ok(sizes.reduce((a, b) => a + b, 0) <= 80_000);
  // EVERY root that can fit is cached, and only those: the smallest form the catalog ever tries
  // (everything shed, 50 items per section) decides, measured here independently of the catalog.
  const smallest = { descMax: 0, genres: false, backdrop: false, perSection: 50 };
  const expected = Object.entries({ masnew_movies: "peliculas", masnew_series: "series", masnew_anime: "anime", masnew_kids: "infantil" })
    .filter(([code]) => storedLength(encodeTree(parseTree(roots[code]), smallest)) <= 20_000)
    .map(([, root]) => `tree:${root}`).sort();
  assert.deepEqual(keys, expected);
  assert.deepEqual(keys, ["tree:anime", "tree:infantil"], "with these synthetic sizes the two smaller roots fit, the two large ones cannot");
});

// ---- browse -----------------------------------------------------------------------------------

function pagingSetup() {
  return setup({
    roots: { masnew_movies: answer(column("All", assets("it", 55))), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() },
  });
}

test("browse pages a row's full list by numeric offset, 50 a page, next as a string", async () => {
  const { catalog } = pagingSetup();
  const first = await catalog.browse("magis_top_peliculas", null);
  assert.equal(first.items.length, 50);
  assert.equal(first.next, "50");
  const second = await catalog.browse("magis_top_peliculas", first.next);
  assert.equal(second.items.length, 5);
  assert.equal("next" in second, false, "no next on the last page");
  const all = [...first.items, ...second.items].map((i) => i.id);
  assert.equal(new Set(all).size, 55);
  assert.deepEqual(first.items[0], { id: "it1", ref: "magis1:movie:0:it1", title: "T it1", kind: "movie", genres: ["Drama"], rating: 7 });
});

test("browse cursor: null/undefined/garbage/negative mean offset 0; an offset past the end is an empty last page", async () => {
  const { catalog } = pagingSetup();
  const zero = (await catalog.browse("magis_top_peliculas", null)).items.map((i) => i.id);
  for (const c of [undefined, "", "-5", "abc", "1.5", "NaN"]) {
    assert.deepEqual((await catalog.browse("magis_top_peliculas", c)).items.map((i) => i.id), zero, String(c));
  }
  const past = await catalog.browse("magis_top_peliculas", "500");
  assert.deepEqual(past, { items: [] });
  const mid = await catalog.browse("magis_top_peliculas", "3");
  assert.equal(mid.items[0].id, zero[3]);
  assert.equal(mid.next, "53");
});

test("browse of a row whose list fits in one page has no next", async () => {
  const { catalog } = pagingSetup();
  const page = await catalog.browse("magis_top_peliculas", "5");
  assert.equal(page.items.length, 50);
  assert.equal("next" in page, false); // 5 + 50 == 55 is not < 55
});

test("browse makes no portal call when the home was just built, and finds rows by id", async () => {
  const { catalog, portal } = setup({
    roots: { masnew_movies: answer(column("All", assets("it", 55))), masnew_series: smallTree("s", "teleplay"), masnew_anime: smallTree("a"), masnew_kids: smallTree("k") },
  });
  await catalog.home();
  const calls = portal.calls.length;
  const page = await catalog.browse("magis_g_peliculas_drama", null);
  assert.equal(portal.calls.length, calls);
  assert.equal(page.items.length, 50);
});

test("browse of an unknown row is not_found", async () => {
  const { catalog } = pagingSetup();
  await assert.rejects(() => catalog.browse("no-such-row", null), (e) => e.code === "not_found");
  await assert.rejects(() => catalog.browse(undefined, null), (e) => e.code === "not_found");
  await assert.rejects(() => catalog.browse(42, "0"), (e) => e.code === "not_found");
});

test("browse items carry the NUEVO badge like home items", async () => {
  const { catalog } = setup({
    roots: {
      masnew_movies: answer(column("All", [asset("R", { shelveTime: "2026-10-02 19:00:00" })])),
      masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer(),
    },
  });
  const page = await catalog.browse("magis_top_peliculas", null);
  assert.deepEqual(page.items[0].badges, ["NUEVO"]);
});

test("classify and projectRows are reusable pieces: projectRows drops empty rows", () => {
  const rows = classify({ peliculas: [{ name: "All", items: [] }] });
  assert.deepEqual(projectRows(rows, NOW), []);
  assert.deepEqual(projectRows([{ id: "x", title: "X", shown: [], all: [] }], NOW), []);
});

// ---- storage budget -----------------------------------------------------------------------------

test("an oversized tree sheds descriptions to fit the budget; one that never fits is served uncached", async () => {
  const long = "x".repeat(400);
  const big = (n, extra) => answer(column("All", Array.from({ length: n }, (_, i) => asset(`b${i}`, { description: long, ...extra }))));
  const a = setup({ roots: { masnew_movies: big(150, {}), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  const rows = await a.catalog.home();
  assert.ok(rowOf(rows, "magis_top_peliculas"));
  const stored = a.kino.storage.get("tree:peliculas");
  assert.ok(stored !== null && Buffer.byteLength(stored) <= 20_000, "cached within budget");
  const again = await a.catalog.home();
  assert.ok(rowOf(again, "magis_top_peliculas").items.length > 0);

  // 300 sections of 10: shedding per-section items cannot help, so it never fits.
  const wide = answer(...Array.from({ length: 300 }, (_, c) => column(`S${c}`, Array.from({ length: 10 }, (_, i) => asset(`w${c}-${i}`)), c)));
  const b = setup({ roots: { masnew_movies: wide, masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  assert.ok(rowOf(await b.catalog.home(), "magis_top_peliculas"));
  assert.equal(b.kino.storage.get("tree:peliculas"), null, "does not fit even without descriptions: not cached");
});

test("the stored form round-trips every field the projection reads", async () => {
  const rich = asset("Z9", {
    name: "Ñandú", programType: "teleplay", tags: "Drama, Sci-Fi", score: 6.5, duration: 3600, description: "descripción",
    shelveTime: "2026-10-02 19:00:00",
    posterList: [{ fileType: "icon", fileUrl: "https://img.test/public/images/aaaa1111" }, { fileType: "poster", fileUrl: "https://img.test/public/images/bbbb2222" }],
  });
  const roots = { masnew_movies: answer(), masnew_series: answer(column("All", [rich, asset("Z8")])), masnew_anime: answer(), masnew_kids: answer() };
  const fresh = setup({ roots });
  const first = await fresh.catalog.home();
  const cached = makeCatalog({ kino: fresh.kino, portal: fakePortal(emptyRoots()), session: fakeSession(), clock: fresh.clock });
  assert.deepEqual(await cached.home(), first);
});

test("a single huge section sheds items per section (not below 50) before giving up", async () => {
  const one = answer(column("All", Array.from({ length: 3000 }, (_, i) => asset(`h${i}`))));
  const a = setup({ roots: { masnew_movies: one, masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  await a.catalog.home();
  const stored = JSON.parse(a.kino.storage.get("tree:peliculas"));
  assert.ok(stored.s[0][1].length >= 50 && stored.s[0][1].length <= 100);
  assert.ok(Buffer.byteLength(JSON.stringify(stored)) <= 20_000);
});

test("a stored tree without the current format version is a miss and refetches", async () => {
  const { catalog, kino, portal } = setup({
    roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() },
  });
  await catalog.home();
  const stored = JSON.parse(kino.storage.get("tree:peliculas"));
  assert.equal(stored.v, 1);
  delete stored.v;
  kino.storage.set("tree:peliculas", JSON.stringify(stored), { ttlMs: HOUR });
  portal.calls.length = 0;
  assert.ok(rowOf(await catalog.home(), "magis_top_peliculas"));
  assert.ok(portal.codes().includes("masnew_movies"));
  assert.equal(JSON.parse(kino.storage.get("tree:peliculas")).v, 1);
});

test("home's four root calls are paced >= 400 ms apart through the real portal client", async () => {
  let now = 5000;
  const clock = { now: () => now };
  const starts = [];
  const base = fakeKino({
    fetch: async () => { starts.push(now); return { text: () => JSON.stringify(smallTree("p")) }; },
  });
  const kino = Object.freeze({ ...base, sleep: async (ms) => { now += ms; } });
  const portal = makePortal({
    kino, crypto: makeCrypto(kino), clock, snProvider: () => "sn", config: { hosts: ["h.test"], appId: "a", apkVersion: "1" },
  });
  const catalog = makeCatalog({ kino, portal, session: fakeSession(), clock });
  await catalog.home();
  assert.equal(starts.length, 4);
  for (let i = 1; i < 4; i++) assert.ok(starts[i] - starts[i - 1] >= 400, `gap ${i}: ${starts[i] - starts[i - 1]}`);
});
