// Kino's scopedSearch (apiVersion 6, app Task 14c): search({ q, within: <a browse ref> }) searches inside one "Ver más"
// page — a Home row, a section row or a category (they all share the classified rows' ids), or the 18+ tile. The rows
// are Xuper's own classification across the portal's sections (type x genre, featured), so no portal column matches one
// and the portal's searchByName cannot be restricted to it: the plugin filters the row's cached tree, ranked like the
// global search (kino.rank), paged by a numeric cursor, inside the search's own 15 s budget, with no new storage key.
import test from "node:test";
import assert from "node:assert/strict";
import { checkOutput, validateManifest } from "../sdk/contract.mjs";
import { readFileSync } from "node:fs";
import { makeCatalog, ADULT_REF, ADULT_ROOT_CODE } from "../src/catalog.js";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { answer, column, asset, assets, NOW, kinoErr } from "./helpers/fakeCatalog.mjs";

const manifestText = readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8");

const roots = () => ({
  masnew_movies: answer(column("All", [
    asset("p1", { name: "El Padrino", tags: "Drama" }),
    asset("p2", { name: "El Padrino II", tags: "Drama" }),
    asset("p3", { name: "Padres e hijos", tags: "Drama" }),
    asset("p4", { name: "Pequeña Miss Sunshine", tags: "Drama" }),
    asset("p5", { name: "Batman: el caballero de la noche", tags: "Drama" }),
    asset("p6", { name: "Rocky", tags: "Drama" }),
    ...assets("ac", 6, { tags: "Action" }),
    asset("x1", { name: "El Padrino de acción", tags: "Action" }),
  ])),
  masnew_series: answer(column("All", assets("sd", 6, { programType: "teleplay" }))),
  masnew_anime: answer(column("All", assets("an", 6, { programType: "series", tags: "Comedy" }))),
  masnew_kids: answer(column("All", assets("kf", 6, { tags: "Family" }))),
  masnew_adult: answer(column("All", [asset("ad1", { name: "Padrino XXX" }), asset("ad2", { name: "Otra" }), asset("ads", { name: "Padrino serie", programType: "teleplay" })])),
});

function setup({ byCode = roots() } = {}) {
  const base = fakeKino();
  const sets = [];
  const kino = Object.freeze({ ...base, storage: Object.freeze({ ...base.storage, set: (k, v, o) => { sets.push(k); return base.storage.set(k, v, o); } }) });
  const calls = [];
  const portal = {
    async call(path, bean, opts) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      const a = byCode[bean.columnCode];
      if (a === undefined) throw new Error("unscripted " + path);
      return typeof a === "function" ? a() : a;
    },
  };
  const deadlines = [];
  const session = {
    ensure: async (o) => { deadlines.push(o && o.deadline); },
    withValidSession: async (block, o) => { deadlines.push(o && o.deadline); return block({ userId: "u1", userToken: "tok1" }); },
  };
  const clock = { t: NOW, now() { return this.t; } };
  return { kino, sets, calls, deadlines, clock, catalog: makeCatalog({ kino, portal, session, clock }) };
}

const DRAMA = "magis_g_peliculas_drama";
const ids = (out) => out.items.map((i) => i.id);

test("the manifest declares scopedSearch, which the kit accepts at apiVersion 6", () => {
  const m = JSON.parse(manifestText);
  assert.ok(m.capabilities.includes("scopedSearch"));
  assert.ok(m.apiVersion >= 6);
  assert.ok(validateManifest(manifestText).ok);
});

test("within a row: only that row's titles, accent/case insensitive, part of a word counts, ranked like global search", async () => {
  const w = setup();
  const out = await w.catalog.search({ q: "padrino", type: "any", within: DRAMA, cursor: null });
  // "El Padrino" (the whole query) first, then the sequel; the Action row's "El Padrino de acción" is another row.
  assert.deepEqual(ids(out), ["p1", "p2"]);
  assert.deepEqual(ids(await w.catalog.search({ q: "PEQUENA miss", within: DRAMA })), ["p4"]);
  assert.deepEqual(ids(await w.catalog.search({ q: "padr", within: DRAMA })).sort(), ["p1", "p2", "p3"]);
  assert.deepEqual(ids(await w.catalog.search({ q: "zzz", within: DRAMA })), []);
  assert.equal(checkOutput("search", out, validateManifest(manifestText).manifest).drops.length, 0);
});

test("within never asks the portal's searchByName, and a warm tree costs no portal call at all", async () => {
  const w = setup();
  await w.catalog.home();
  const before = w.calls.length;
  await w.catalog.search({ q: "rocky", within: DRAMA });
  assert.equal(w.calls.length, before);
  assert.ok(w.calls.every((c) => c.path !== "v3/searchByName"));
});

test("a cold tree is fetched inside the search's own budget (15 s less the margin), never home's 20 s", async () => {
  const w = setup();
  await w.catalog.search({ q: "rocky", within: DRAMA });
  assert.ok(w.deadlines.length > 0);
  for (const d of w.deadlines) assert.equal(d, NOW + 15_000 - 2_000);
});

test("cursor paging: 50 a page, next as a string, garbage cursor is the first page", async () => {
  const many = roots();
  many.masnew_movies = answer(column("All", Array.from({ length: 70 }, (_, i) => asset("m" + i, { name: "Rocky " + i, tags: "Drama" }))));
  const w = setup({ byCode: many });
  const first = await w.catalog.search({ q: "rocky", within: DRAMA, cursor: null });
  assert.equal(first.items.length, 50);
  assert.equal(first.next, "50");
  const second = await w.catalog.search({ q: "rocky", within: DRAMA, cursor: first.next });
  assert.equal(second.items.length, 20);
  assert.equal("next" in second, false);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, 70);
  assert.deepEqual(ids(await w.catalog.search({ q: "rocky", within: DRAMA, cursor: "abc" })), ids(first));
});

test("the 18+ tile is searched only when the app asks for it, its movies kept marked adult", async () => {
  const w = setup();
  await w.catalog.search({ q: "padrino", within: DRAMA });
  assert.equal(w.calls.filter((c) => c.bean.columnCode === ADULT_ROOT_CODE).length, 0);
  const out = await w.catalog.search({ q: "padrino", within: ADULT_REF });
  assert.deepEqual(ids(out), ["ad1"]); // the series is not one of the 18+ movies
  assert.ok(out.items.every((i) => i.adult === true));
  assert.equal(w.calls.filter((c) => c.bean.columnCode === ADULT_ROOT_CODE).length, 1);
});

test("an unknown row is not_found, an empty query lists nothing, and no new storage key is ever written", async () => {
  const w = setup();
  await assert.rejects(() => w.catalog.search({ q: "x", within: "no-such-row" }), kinoErr("not_found"));
  assert.deepEqual(await w.catalog.search({ q: "  ", within: DRAMA }), { items: [] });
  await w.catalog.search({ q: "padrino", within: DRAMA });
  await w.catalog.search({ q: "padrino", within: ADULT_REF });
  assert.ok(w.sets.every((k) => k.startsWith("tree:")), w.sets.join(","));
});

test("without within the global search runs as before (the portal's searchByName)", async () => {
  const w = setup();
  await w.catalog.search({ q: "padrino", type: "any" }).catch(() => {});
  assert.ok(w.calls.some((c) => c.path === "v3/searchByName"));
});
