// A catalog over a scripted portal (getNextColumns per root code) for the section and categories
// tests; the same fakes catalog.test.mjs uses inline.
import { readFileSync } from "node:fs";
import { fixturePath } from "./fixtures.mjs";
import { fakeKino } from "./fakeKino.mjs";
import { makeCatalog } from "../../src/catalog.js";

export const NOW = Date.UTC(2026, 9, 2, 12, 0, 0);

export const asset = (id, extra = {}) => ({ contentId: id, name: "T " + id, programType: "movie", tags: "Drama", score: 7, ...extra });
export const column = (name, assets, columnId = 1) => ({ columnId, name, assetList: assets });
export const answer = (...columns) => ({ recommendList: columns });
export const assets = (prefix, n, extra = {}) => Array.from({ length: n }, (_, i) => asset(`${prefix}${i + 1}`, extra));

/** Four roots with featured rows (movies and series have a year section) and genre rows each. */
export const fourRoots = () => ({
  masnew_movies: answer(
    column("2026", assets("n", 3)),
    column("All", [...assets("pd", 6, { tags: "Drama" }), ...assets("pa", 7, { tags: "Action" })]),
  ),
  masnew_series: answer(column("2026", assets("u", 3, { programType: "teleplay" })), column("All", assets("sd", 6, { programType: "teleplay" }))),
  masnew_anime: answer(column("All", assets("ac", 6, { programType: "series", tags: "Comedy" }))),
  masnew_kids: answer(column("All", assets("kf", 6, { tags: "Family" }))),
  // Only ever asked by browse of the 18+ tile.
  masnew_adult: answer(column("All", assets("ad", 6))),
});

function fakePortal(byCode) {
  const calls = [];
  return {
    calls,
    async call(path, bean) {
      calls.push({ path, bean });
      await Promise.resolve();
      const a = byCode[bean.columnCode];
      if (a === undefined) throw new Error("unscripted root " + bean.columnCode);
      const v = typeof a === "function" ? a() : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
}

function fakeSession() {
  return {
    ensure: async () => {},
    withValidSession: async (block) => block({ userId: "u1", userToken: "tok1" }),
  };
}

export function catalogSetup({ roots = fourRoots(), now = NOW } = {}) {
  const kino = fakeKino();
  const portal = fakePortal(roots);
  const clock = { t: now, now() { return this.t; } };
  const catalog = makeCatalog({ kino, portal, session: fakeSession(), clock });
  return { kino, portal, clock, catalog };
}

export const manifest = () => JSON.parse(readFileSync(new URL("../../kino-plugin.json", import.meta.url), "utf8"));

// The captured classified rows (kept outside the repo, see fixtures.mjs).
export function fixtureRows() {
  const norm = (i) => ({ ...i, genres: i.genres || [], score: i.score ?? null, shelvedAtMs: i.shelvedAtMs || 0, description: i.description || "" });
  return JSON.parse(readFileSync(fixturePath("home-1.json"), "utf8")).map((r) => ({ id: r.id, title: r.title, shown: r.shown.map(norm), all: r.all.map(norm) }));
}

export const kinoErr = (code) => (e) => { if (e.name !== "KinoError_" + code) throw e; return true; };
