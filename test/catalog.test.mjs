import test from "node:test";
import { fixturePath } from "./helpers/fixtures.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput } from "../sdk/contract.mjs";
import { makeCatalog, parseShelveTime, projectRows } from "../src/catalog.js";
import { classify } from "../src/homeClassifier.js";
import { storedLength } from "../src/homeTree.js";
import { META_KEY, PART_BUDGET_BYTES, SNAPSHOT_BUDGET_BYTES, checksum } from "../src/rowsStore.js";
import { makeCategories } from "../src/categories.js";
import { makeSection } from "../src/section.js";
import { makeCrypto } from "../src/crypto.js";
import { makePortal } from "../src/portal.js";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
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
  // A new runtime over the same storage (Kino dropped the sandbox): nothing in memory, the snapshot kept.
  const restart = (other = null) => makeCatalog({ kino, portal: other ? fakePortal(other) : portal, session, clock });
  return { kino, portal, session, clock, catalog, sets, restart, rowSets: () => sets.filter((s) => s.k.startsWith("rows:")) };
}

// Lets the background refresh (a few portal round trips of microtasks) run to its end.
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
// Kino's call semantics (PluginRuntime: quickjs-kt's evaluate): the answer reaches Kino only once the
// sandbox's job queue is empty and every kino.fetch has settled, so work a call leaves running is paid
// by that call. `onTv(t)` makes every portal answer inside a `kinoCall` cost ROOT_MS of the (fake) clock,
// about what a root costs on the KALLEY (fetch, decrypt, parse); plain calls (a test's setup) stay free.
// `kinoCall` answers `{ value, ms }`, ms being when Kino would have received the answer.
const ROOT_MS = 3_000;
function onTv(t) {
  const call = t.portal.call.bind(t.portal);
  t.inFlight = 0;
  t.portal.call = async (...args) => {
    t.inFlight++;
    try { if (t.slow) t.clock.t += ROOT_MS; await new Promise((r) => setImmediate(r)); return await call(...args); } finally { t.inFlight--; }
  };
  return t;
}
async function kinoCall(t, f) {
  const start = t.clock.t;
  t.slow = true;
  try {
    const value = await f();
    do { await settle(); } while (t.inFlight > 0);
    return { value, ms: t.clock.t - start };
  } finally { t.slow = false; }
}
// One slice at most: a call that started one root fetch, never the whole build.
const ONE_SLICE_MS = ROOT_MS;

const everyRoot = (a) => ({ masnew_movies: a, masnew_series: a, masnew_anime: a, masnew_kids: a });

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
    const { onFetchMs, ...opts } = c.opts;
    assert.deepEqual(opts, { baseFields: true, userId: "u1", userToken: "tok1" });
    assert.equal(typeof onFetchMs, "function", "the network time is measured (a slow portal: cold roots two at a time)");
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
    // Kino runs in Spanish (es-CO): the portal's IMDb genres come out in Spanish.
    genres: ["Acción", "Drama", "Comedia", "Crimen", "Terror"], rating: 8.5, runtimeMinutes: 90,
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

// ---- home: real captured rows (kept outside the repo, see helpers/fixtures.mjs) ----------------------------

test("projection of the real captured rows (home-1.json) keeps ids, refs, kind, images, genres, rating", () => {
  const captured = JSON.parse(readFileSync(fixturePath("home-1.json"), "utf8"));
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

test("the rows are kept: a second home makes no portal call, and the snapshot is stored for 14 days", async () => {
  const { catalog, portal, rowSets, session, restart } = setup({
    roots: { masnew_movies: smallTree("p"), masnew_series: smallTree("s", "teleplay"), masnew_anime: smallTree("a"), masnew_kids: smallTree("k") },
  });
  const first = await catalog.home();
  assert.equal(portal.calls.length, 4);
  assert.deepEqual(rowSets().map((s) => s.k), ["rows:0", META_KEY], "one part, the meta last");
  assert.ok(rowSets().every((s) => s.o.ttlMs === 14 * DAY));
  const second = await catalog.home();
  assert.equal(portal.calls.length, 4, "served from memory");
  assert.deepEqual(second, first);
  assert.equal(session.ensures, 1, "no ensure() when nothing needs the portal");
  assert.deepEqual(await restart().home(), first, "a new runtime answers from the snapshot");
  assert.equal(portal.calls.length, 4);
});

test("stale rows: each call refreshes one root within one slice, the rest stay served, and the snapshot follows", async () => {
  let fresh = false;
  const t = onTv(setup({ roots: { masnew_movies: () => smallTree(fresh ? "q" : "p"), masnew_series: smallTree("s", "teleplay"), masnew_anime: answer(), masnew_kids: answer() } }));
  await t.catalog.home();
  const meta = t.kino.storage.get(META_KEY);
  assert.equal(t.portal.calls.length, 4);
  t.clock.t += 2 * HOUR;
  fresh = true;
  let last = null;
  for (let i = 0; i < 6; i++) {
    const { value, ms } = await kinoCall(t, () => t.catalog.home());
    assert.ok(ms <= ONE_SLICE_MS, `call ${i}: delivered after ${ms} ms`);
    assert.ok(rowOf(value, "magis_top_series"), `call ${i}: the series rows stay served`);
    last = value;
  }
  assert.ok(last.some((r) => r.items.some((it) => it.id === "q1")), "the refreshed movies replace the stale ones");
  assert.equal(t.portal.calls.length, 8, "each root asked once by the refresh");
  assert.notEqual(t.kino.storage.get(META_KEY), meta, "and stored as the new snapshot");
  assert.ok((await t.restart().home()).some((r) => r.items.some((it) => it.id === "q1")));
});

test("cold start with a stale snapshot: the stale rows are delivered within one slice", async () => {
  const t = onTv(setup({ roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } }));
  const first = await t.catalog.home();
  t.clock.t += 2 * HOUR + 1;
  const cold = t.restart();
  const { value, ms } = await kinoCall(t, () => cold.home());
  assert.deepEqual(value, first);
  assert.ok(ms <= ONE_SLICE_MS, `delivered after ${ms} ms`);
  assert.equal(t.portal.calls.length, 5, "one slice: one root asked");
});

test("a failed refresh keeps the rows served and is tried again only 5 minutes later", async () => {
  let down = false;
  const t = onTv(setup({ roots: everyRoot(() => (down ? new Error("down") : smallTree("p"))) }));
  const first = await t.catalog.home();
  down = true;
  t.clock.t += 2 * HOUR;
  for (let i = 0; i < 6; i++) {
    const { value, ms } = await kinoCall(t, () => t.catalog.home());
    assert.deepEqual(value, first);
    assert.ok(ms <= ONE_SLICE_MS, `call ${i}: ${ms} ms`);
  }
  const after = t.portal.calls.length;
  assert.equal(after, 8, "the four roots were asked once each, all failed");
  for (let i = 0; i < 3; i++) assert.deepEqual((await kinoCall(t, () => t.catalog.home())).value, first);
  assert.equal(t.portal.calls.length, after, "no new pass within 5 minutes");
  t.clock.t += 5 * 60_000;
  await kinoCall(t, () => t.catalog.home());
  assert.ok(t.portal.calls.length > after, "the next pass, 5 minutes later");
  assert.deepEqual(await t.restart().home(), first, "the stored snapshot was not replaced by a failed refresh");
});

test("the snapshot expires through the storage ttl (real expiry): a cold start after 14 days rebuilds", async () => {
  const realNow = Date.now;
  const t = setup({ roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  await t.catalog.home();
  const before = t.portal.calls.length;
  Date.now = () => realNow() + 14 * DAY + 1000;
  try { await t.restart().home(); } finally { Date.now = realNow; }
  assert.equal(t.portal.calls.length, before + 4, "nothing kept: the four roots are asked, and waited for");
});

test("one root down: the others show and are stored, and the failed root alone is asked again 5 minutes later", async () => {
  let down = true;
  const { catalog, portal, rowSets, clock } = setup({
    roots: {
      masnew_movies: () => (down ? new Error("portal down") : smallTree("p")),
      masnew_series: smallTree("s", "teleplay"), masnew_anime: answer(), masnew_kids: answer(),
    },
  });
  const rows = await catalog.home();
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => !r.id.includes("peliculas")), rowIds(rows).join());
  assert.ok(rowOf(rows, "magis_top_series"));
  const meta = JSON.parse(rowSets().find((s) => s.k === META_KEY).v);
  assert.deepEqual(Object.keys(meta.r).sort(), ["anime", "infantil", "series"], "what answered is stored; the failed root is not in it");
  down = false;
  portal.calls.length = 0;
  await catalog.home();
  assert.deepEqual(portal.codes(), [], "a failed root waits 5 minutes while something is served");
  clock.t += 5 * 60_000;
  const again = await catalog.home();
  assert.deepEqual(portal.codes(), ["masnew_movies"], "then only it is asked: the others are stored and fresh");
  assert.ok(rowOf(again, "magis_top_peliculas"));
  assert.ok(rowOf(again, "magis_top_series"));
});

test("all roots empty: no rows and NO cache write (Review Focus 5)", async () => {
  const { catalog, sets, kino } = setup({ roots: emptyRoots() });
  assert.deepEqual(await catalog.home(), []);
  assert.deepEqual(sets, []);
  assert.deepEqual(kino.storage.keys(), []);
});

// ---- every root failing (port of main 2d285106 + 465773f1): the error, so Home offers Reintentar ---

const allRoots = (a) => ({ masnew_movies: a, masnew_series: a, masnew_anime: a, masnew_kids: a });
const kinoErr = (code, message) => (e) => { assert.equal(e.name, "KinoError_" + code, e.message); if (message) assert.equal(e.message, message); return true; };

test("all roots failing with nothing kept: the call asks each root once, throws, stores nothing; the next call asks again", async () => {
  const { catalog, sets, portal } = setup({ roots: allRoots(() => new Error("down")) });
  await assert.rejects(catalog.home(), kinoErr("unavailable", "Xuper no está disponible ahora"));
  assert.equal(portal.calls.length, 4, "each root once");
  assert.deepEqual(sets, []);
  await assert.rejects(catalog.home(), kinoErr("unavailable"));
  assert.equal(portal.calls.length, 8, "nothing to show: no wait before asking again");
});

test("all roots failing once: the next call answers once the portal is back", async () => {
  let n = 0;
  const { catalog, portal } = setup({ roots: allRoots(() => (++n <= 4 ? new Error("down") : smallTree("p" + n))) });
  await assert.rejects(catalog.home(), kinoErr("unavailable"));
  const rows = await catalog.home();
  assert.ok(rows.length > 0);
  assert.equal(portal.calls.length, 5, "the first root answers; the others, failed a moment ago, wait while it is served");
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

  let answered = 0;
  const cached = setup({ roots: { ...allRoots(() => new Error("down")), masnew_movies: () => (answered++ === 0 ? smallTree("c") : new Error("down")) } });
  await cached.catalog.home(); // peliculas answers, the other three fail: peliculas is kept (and stored)
  const rows = await cached.catalog.home();
  assert.ok(rows.length > 0, "the kept root still shows");
  assert.equal(cached.portal.calls.length, 4, "the failed roots wait 5 minutes while something is served");
  cached.clock.t += 5 * 60_000;
  assert.ok((await cached.catalog.home()).length > 0);
  assert.equal(cached.portal.calls.length, 4 + 3, "then only the three missing roots are asked, once");
});

test("a slow portal with nothing kept: the call that asked a root and has nothing to show says why at once", async () => {
  const t = setup({ roots: allRoots(() => new Error("down")) });
  t.portal.call = async (path, bean, opts) => { t.portal.calls.push({ path, bean, opts }); t.clock.t += 16_000; throw new Error("down"); };
  await assert.rejects(t.catalog.home(), kinoErr("unavailable"));
  assert.equal(t.portal.calls.length, 1, "one slice: one root, the call does not go on to the next");
  await assert.rejects(t.catalog.home(), kinoErr("unavailable"));
  assert.equal(t.portal.calls.length, 2, "the next call goes on with the next root");
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

test("a corrupt, torn or partial snapshot is a miss, never an error: the rows are rebuilt and stored again", async () => {
  const t = setup({ roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  const first = await t.catalog.home();
  const meta = t.kino.storage.get(META_KEY);
  const part = t.kino.storage.get("rows:0");
  const m = JSON.parse(meta);
  const tag = m.g + ":";
  // A text with a valid meta (length and checksum) that is still not the rows format.
  const forged = (text) => {
    assert.notEqual(text, part.slice(tag.length), "the forged text differs from the stored one");
    t.kino.storage.set("rows:0", tag + text, { ttlMs: HOUR });
    t.kino.storage.set(META_KEY, JSON.stringify({ ...m, len: text.length, h: checksum(text) }), { ttlMs: HOUR });
  };
  const breakers = {
    "meta not json": () => t.kino.storage.set(META_KEY, "{not json", { ttlMs: HOUR }),
    "meta of another format": () => t.kino.storage.set(META_KEY, JSON.stringify({ ...m, v: 99 }), { ttlMs: HOUR }),
    "a part missing": () => t.kino.storage.set(META_KEY, JSON.stringify({ ...m, n: 2 }), { ttlMs: HOUR }),
    "no part at all": () => t.kino.storage.remove("rows:0"),
    "a truncated part": () => t.kino.storage.set("rows:0", part.slice(0, part.length - 5), { ttlMs: HOUR }),
    "a part of another generation": () => t.kino.storage.set("rows:0", "zzzz:" + part.slice(tag.length), { ttlMs: HOUR }),
    "same length, other bytes": () => t.kino.storage.set("rows:0", part.replace("T p1", "T x1"), { ttlMs: HOUR }),
    "checksummed, not json": () => forged("{nope"),
    "checksummed, an index out of range": () => forged(part.slice(tag.length).replace(/\[0,1,2,3,4,5\]/, "[0,1,2,3,4,99]")),
    "checksummed, an item without an id": () => forged(part.slice(tag.length).replace('["p1"', '[7')),
  };
  for (const [name, brk] of Object.entries(breakers)) {
    t.kino.storage.set(META_KEY, meta, { ttlMs: HOUR });
    t.kino.storage.set("rows:0", part, { ttlMs: HOUR });
    brk();
    const calls = t.portal.calls.length;
    assert.deepEqual(await t.restart().home(), first, name);
    assert.equal(t.portal.calls.length, calls + 4, `${name}: rebuilt from the portal`);
    assert.equal(JSON.parse(t.kino.storage.get(META_KEY)).v, 1, `${name}: stored again`);
  }
});

test("ensure() failing surfaces as the mapped error, not as an empty home, and no portal call is made", async () => {
  const { kino } = spyKino();
  const err = kino.error("geo_blocked", "Este contenido no está disponible en tu región");
  const { catalog, portal } = setup({ roots: emptyRoots(), ensureError: err });
  await assert.rejects(() => catalog.home(), (e) => e === err);
  await assert.rejects(() => catalog.browse("magis_top_peliculas", null), (e) => e === err);
  assert.equal(portal.calls.length, 0);
});

// A tree as wide as the real ones: many sections, items repeated across them, long descriptions and
// picture urls (the real roots never fit one 20 KB value; 2.2.3 could never store them).
function realisticRoots() {
  const words = "Un hermano y una hermana descubren un ritual aterrador en la apartada casa de su nueva madre adoptiva donde nada es lo que parece ".split(" ");
  const tags = ["Action", "Drama", "Thriller", "Crime", "Comedy", "Horror", "Romance", "Sci-Fi", "Family", "Fantasy", "Mystery", "Adventure"];
  const hex = (n) => n.toString(16).padStart(32, "0").toUpperCase();
  const mkRoot = (offset, pool, columns, perColumn, type) => {
    const items = Array.from({ length: pool }, (_, k) => {
      const n = offset + k;
      return {
        contentId: hex(n), name: `Titulo largo de ejemplo numero ${n}`, programType: type,
        tags: [tags[n % 12], tags[(n * 7) % 12], tags[(n * 5) % 12]].join(", "),
        score: (n % 90) / 10, duration: 6000, description: words.slice(n % 5).join(" ") + " " + words.slice(0, 12).join(" "),
        shelveTime: "2026-09-30 10:00:00",
        posterList: [{ fileType: "icon", fileUrl: `https://img.test/public/images/${hex(n)}-aaaa-bbbb` }, { fileType: "poster", fileUrl: `https://img.test/public/images/${hex(n + 99999)}-cccc` }],
      };
    });
    return answer(...Array.from({ length: columns }, (_, c) => column(c === 0 ? "2026" : `Seccion ${c}`,
      Array.from({ length: perColumn }, (_, k) => items[(c * 37 + k * 11) % pool]), c)));
  };
  return { masnew_movies: mkRoot(0, 700, 40, 25, "movie"), masnew_series: mkRoot(10_000, 500, 30, 25, "teleplay"), masnew_anime: mkRoot(20_000, 250, 20, 25, "series"), masnew_kids: mkRoot(30_000, 250, 20, 25, "movie") };
}

test("a snapshot bigger than one value is split into parts: each under 20 KB, all under 80 KB, read back whole", async () => {
  const t = setup({ roots: realisticRoots() });
  const fresh = await t.catalog.home();
  assert.equal(fresh.length, 20);
  const meta = JSON.parse(t.kino.storage.get(META_KEY));
  assert.ok(meta.n >= 2, `${meta.n} part(s): the rows do not fit one value`);
  const keys = t.kino.storage.keys().filter((k) => k.startsWith("rows:"));
  assert.equal(keys.length, meta.n + 1);
  // Measured as the app stores them: escaped by Android's org.json, in UTF-8.
  const sizes = keys.map((k) => storedLength(t.kino.storage.get(k)));
  assert.ok(sizes.every((n) => n <= PART_BUDGET_BYTES), sizes.join(","));
  assert.ok(sizes.reduce((a, b) => a + b, 0) <= SNAPSHOT_BUDGET_BYTES, sizes.join(","));
  // A cold start answers Home from the parts: the same rows, ids, refs, titles and pictures.
  const cold = await t.restart().home();
  assert.equal(t.portal.calls.length, 4);
  const shape = (rows) => rows.map((r) => [r.id, r.title, r.ref, r.items.map((i) => [i.id, i.ref, i.title, i.kind, i.poster, i.backdrop, i.genres, i.rating, i.runtimeMinutes, i.badges])]);
  assert.deepEqual(shape(cold), shape(fresh));
  // A description is whole or absent, never cut; the first rows keep theirs.
  const overview = new Map(fresh.flatMap((r) => r.items.map((i) => [i.id, i.overview])));
  for (const r of cold) for (const i of r.items) assert.ok(i.overview === undefined || i.overview === overview.get(i.id), i.id);
  assert.ok(cold[0].items.every((i) => i.overview === overview.get(i.id)));
});

test("a smaller snapshot replaces a bigger one: no part of the old one is left behind", async () => {
  const t = setup({ roots: realisticRoots() });
  await t.catalog.home();
  assert.ok(JSON.parse(t.kino.storage.get(META_KEY)).n >= 2);
  const small = { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() };
  t.clock.t += 2 * HOUR;
  await t.restart(small).home(); // stale: served, refreshed in the background with the small tree
  await settle();
  assert.deepEqual(t.kino.storage.keys().filter((k) => k.startsWith("rows:")).sort(), ["rows:0", META_KEY]);
  assert.ok(rowOf(await t.restart(small).home(), "magis_top_peliculas").items.some((i) => i.id === "p1"));
});

test("the per-root trees of 2.2.3 and older are removed when the snapshot is written", async () => {
  const t = setup({ roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  t.kino.storage.set("tree:anime", "x".repeat(19_000), { ttlMs: HOUR });
  t.kino.storage.set("tree:infantil", "y", { ttlMs: HOUR });
  t.kino.storage.set("search:v1", "kept", { ttlMs: HOUR });
  await t.catalog.home();
  assert.deepEqual(t.kino.storage.keys().filter((k) => k.startsWith("tree:")), []);
  assert.equal(t.kino.storage.get("search:v1"), "kept");
});

test("warm calls never rebuild: home, categories and section after the first are served without classifying again", async () => {
  const t = setup({ roots: realisticRoots() });
  const categories = makeCategories({ catalog: t.catalog });
  const section = makeSection({ kino: t.kino, catalog: t.catalog, clock: t.clock });
  const time = async (f) => { const s = performance.now(); await f(); return performance.now() - s; };
  // Medians, so one garbage-collection pause under a loaded test run cannot decide the result.
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const cold = await time(() => categories.categories());
  const warm = [];
  for (let i = 0; i < 9; i++) {
    warm.push(await time(() => t.catalog.home()), await time(() => categories.categories()), await time(() => section.section({ tab: "series" })));
  }
  assert.equal(t.portal.calls.length, 4);
  assert.equal(t.rowSets().length, JSON.parse(t.kino.storage.get(META_KEY)).n + 1, "the snapshot was written once");
  assert.ok(median(warm) < cold / 4, `warm ${median(warm).toFixed(2)} ms vs cold ${cold.toFixed(2)} ms`);
  // A cold start reads the snapshot instead of rebuilding: no portal, well below a rebuild.
  const starts = [];
  for (let i = 0; i < 5; i++) { const restarted = t.restart(); starts.push(await time(() => makeCategories({ catalog: restarted }).categories())); }
  const coldStart = median(starts);
  assert.equal(t.portal.calls.length, 4);
  assert.ok(coldStart < cold / 2, `cold start from storage ${coldStart.toFixed(2)} ms vs rebuild ${cold.toFixed(2)} ms`);
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

test("rows too big for the snapshot keep Home and the category tiles whole from a cold start, and start no work", async () => {
  const t = onTv(setup({ roots: realisticRoots() }));
  const fresh = { home: await t.catalog.home(), tiles: await makeCategories({ catalog: t.catalog }).categories() };
  const cold = t.restart();
  const refs = (rows) => rows.map((r) => [r.id, r.items.map((i) => i.ref)]);
  const home = await kinoCall(t, () => cold.home());
  assert.deepEqual(refs(home.value), refs(fresh.home));
  const tiles = await kinoCall(t, () => makeCategories({ catalog: cold }).categories());
  assert.deepEqual(tiles.value, fresh.tiles);
  assert.equal(home.ms + tiles.ms, 0, "no portal call at all");
  assert.equal(t.portal.calls.length, 4);
});

test("partial snapshot (the KALLEY): the first open of a tab fetches that tab's root inside one slice and is whole; every later open costs nothing", async () => {
  const t = onTv(setup({ roots: realisticRoots() }));
  await t.catalog.home();
  const ref = makeSection({ kino: t.kino, catalog: t.catalog, clock: t.clock });
  const full = { anime: (await ref.section({ tab: "anime" })).rows, series: (await ref.section({ tab: "series" })).rows };
  const section = makeSection({ kino: t.kino, catalog: t.restart(), clock: t.clock });
  const first = await kinoCall(t, () => section.section({ tab: "anime" }));
  assert.ok(first.ms <= ONE_SLICE_MS, `first open delivered after ${first.ms} ms (2.2.7: about 8 s on the TV, then again on every open)`);
  assert.deepEqual(first.value.rows, full.anime, "the whole tab at the first open");
  assert.equal(t.portal.calls.length, 5, "its root alone");
  const warm = await kinoCall(t, () => section.section({ tab: "anime" }));
  assert.equal(warm.ms, 0, "a warm open costs nothing");
  assert.deepEqual(warm.value.rows, full.anime);
  const other = await kinoCall(t, () => section.section({ tab: "series" }));
  assert.ok(other.ms <= ONE_SLICE_MS);
  assert.deepEqual(other.value.rows, full.series);
  assert.equal((await kinoCall(t, () => section.section({ tab: "series" }))).ms, 0);
  assert.equal(t.portal.calls.length, 6, "no fetch on later opens");
  // The trimmed snapshot cannot keep a tab's rows past Home's whole: a new sandbox pays one slice again.
  const next = makeSection({ kino: t.kino, catalog: t.restart(), clock: t.clock });
  const again = await kinoCall(t, () => next.section({ tab: "anime" }));
  assert.ok(again.ms <= ONE_SLICE_MS);
  assert.deepEqual(again.value.rows, full.anime);
});

test("a section that keeps landing in a new runtime (Kino drops it after a timeout) is delivered within one slice every time", async () => {
  const t = onTv(setup({ roots: realisticRoots() }));
  await t.catalog.home();
  for (let i = 0; i < 3; i++) {
    const { value, ms } = await kinoCall(t, () => makeSection({ kino: t.kino, catalog: t.restart(), clock: t.clock }).section({ tab: "series" }));
    assert.ok(value.rows.length > 0);
    assert.ok(ms <= ONE_SLICE_MS, `try ${i}: ${ms} ms`);
  }
});

test("browse and the scoped search on a cold start: the row's root is fetched inside one slice and the page is whole at once", async () => {
  const t = onTv(setup({ roots: realisticRoots() }));
  const whole = await t.catalog.browse("magis_top_peliculas", null);
  assert.equal(whole.items.length, 50);
  const cold = t.restart();
  const page = await kinoCall(t, () => cold.browse("magis_top_peliculas", null));
  assert.ok(page.ms <= ONE_SLICE_MS, `${page.ms} ms`);
  assert.deepEqual(page.value, whole);
  const hit = whole.items[3].title;
  const found = await kinoCall(t, () => cold.search({ q: hit, within: "magis_top_peliculas" }));
  assert.equal(found.ms, 0, "same root: nothing more to fetch");
  assert.ok(found.value.items.some((i) => i.title === hit));
  assert.equal(t.portal.calls.length, 5, "the row's root alone");
});

// ---- first start and the upgrade from 2.2.3: nothing stored, built one root per call, kept as it goes --

async function completeHome(roots) {
  const ref = setup({ roots });
  return { home: await ref.catalog.home(), tiles: await makeCategories({ catalog: ref.catalog }).categories() };
}

test("fresh install on the TV: every call within one slice, each start stores one more root, complete after 4 starts of one call each", async () => {
  const roots = realisticRoots();
  const want = await completeHome(roots);
  const t = onTv(setup({ roots }));
  // The KALLEY's pattern: each start makes one categories call, then the sandbox idles out.
  for (let start = 1; start <= 4; start++) {
    const { value, ms } = await kinoCall(t, () => makeCategories({ catalog: t.restart() }).categories());
    assert.ok(ms <= ONE_SLICE_MS, `start ${start}: delivered after ${ms} ms`);
    assert.ok(value.length > 0, `start ${start}: tiles from the roots in so far`);
    const meta = JSON.parse(t.kino.storage.get(META_KEY));
    assert.equal(Object.keys(meta.r).length, start, `start ${start}: one more root stored`);
  }
  assert.equal(t.portal.calls.length, 4, "each root asked once");
  const next = await kinoCall(t, () => t.restart().home());
  assert.equal(next.ms, 0, "the next start answers from storage alone");
  // One root at a time across sandboxes: the same rows, ids and refs as one build (no item is in two roots here).
  const refs = (rows) => rows.map((r) => [r.id, r.items.map((i) => i.ref)]);
  assert.deepEqual(refs(next.value).map(([id]) => id), refs(want.home).map(([id]) => id));
  assert.deepEqual(await makeCategories({ catalog: t.restart() }).categories(), want.tiles);
});

test("fresh install, one sandbox: Home shows the first root at once, every call within one slice, exact after 4 calls", async () => {
  const roots = realisticRoots();
  const want = await completeHome(roots);
  const t = onTv(setup({ roots }));
  const first = await kinoCall(t, () => t.catalog.home());
  assert.ok(first.ms <= ONE_SLICE_MS, `first home delivered after ${first.ms} ms (2.2.6: the whole build)`);
  assert.ok(first.value.length > 0 && first.value.every((r) => r.id.includes("peliculas")), "the movies root, the first one in");
  for (let i = 0; i < 3; i++) assert.ok((await kinoCall(t, () => t.catalog.home())).ms <= ONE_SLICE_MS);
  assert.deepEqual((await kinoCall(t, () => t.catalog.home())).value, want.home, "all four in memory: classified together, exact");
  assert.equal(t.portal.calls.length, 4);
});

test("upgrade from 2.2.3: its tree:* keys are dropped, and the catalog is built like a fresh install", async () => {
  const roots = realisticRoots();
  const t = onTv(setup({ roots }));
  t.kino.storage.set("tree:anime", "x".repeat(19_000), { ttlMs: 2 * HOUR });
  t.kino.storage.set("tree:infantil", "{}", { ttlMs: 2 * HOUR });
  const first = await kinoCall(t, () => makeCategories({ catalog: t.catalog }).categories());
  assert.ok(first.ms <= ONE_SLICE_MS, `${first.ms} ms`);
  assert.ok(first.value.length > 0);
  assert.deepEqual(t.kino.storage.keys().filter((k) => k.startsWith("tree:")), [], "2.2.3's keys are gone");
  assert.ok(t.kino.storage.get(META_KEY) !== null, "the first root is stored at once");
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

test("a snapshot with another format version is a miss and the rows are rebuilt", async () => {
  const t = setup({ roots: { masnew_movies: smallTree("p"), masnew_series: answer(), masnew_anime: answer(), masnew_kids: answer() } });
  await t.catalog.home();
  const meta = JSON.parse(t.kino.storage.get(META_KEY));
  const text = t.kino.storage.get("rows:0").slice(meta.g.length + 1).replace('"v":1', '"v":2');
  t.kino.storage.set("rows:0", `${meta.g}:${text}`, { ttlMs: HOUR });
  t.kino.storage.set(META_KEY, JSON.stringify({ ...meta, len: text.length, h: checksum(text) }), { ttlMs: HOUR });
  assert.ok(rowOf(await t.restart().home(), "magis_top_peliculas"));
  assert.equal(t.portal.calls.length, 8);
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
