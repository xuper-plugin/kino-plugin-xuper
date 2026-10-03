// liveSearch({ query }) (Kino's F17 contract, apiVersion 6): En vivo's search over Xuper's whole channel
// list. The list is swept once (the 18+ categories first, then "ChannelList", the portal's all-channels
// category) and kept in memory for an hour: a search inside that hour asks the portal nothing. Every hit
// carries its categoryId and an explicit `adult`, so the app never has to guess (an unmarked hit is 18+).
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput, markSearchHits } from "../sdk/contract.mjs";
import { makeLiveCatalog } from "../src/liveCatalog.js";
import { PortalError } from "../src/portal.js";

const manifest = {
  id: "xuper", name: "Xuper", version: "2.0.0", apiVersion: 6, entry: "plugin.js",
  hosts: ["portal.test"], capabilities: ["search", "home", "channels"], liveStreamHostsAny: true,
};

// ---- fixtures (invented names and hosts) -------------------------------------------------------

const TODOS = 76182;
const DEPORTES = 76183;
const ADULT = 76184;
const CATS = [
  { columnId: TODOS, name: "ChannelList" },
  { columnId: DEPORTES, name: "Deportes" },
  { columnId: ADULT, name: "18+" },
];
const chan = (code, extra = {}) => ({
  channelCode: code, name: "Canal " + code, channelNumber: "7",
  posterList: [{ fileType: "icon", fileUrl: `https://img.test/${code}.png` }],
  ...extra,
});
const many = (prefix, n) => Array.from({ length: n }, (_, i) => chan(`${prefix}-${i + 1}`));

// The usual world: the adult category has AD1 and MIX (MIX is also in Todos); Todos has 500 + 2 channels.
const WORLD = {
  [ADULT]: [[chan("AD1", { name: "Calor Nocturno" }), chan("MIX", { name: "Canal Mixto" })]],
  [TODOS]: [many("T", 500), [chan("MIX", { name: "Canal Mixto" }), chan("NEWS", { name: "Noticias Caracol", channelNumber: "42" })]],
  [DEPORTES]: [[chan("SPORT", { name: "Deportes Uno" })]],
};

// Fake portal: getNextColumns answers `cats` (or the Error), v6/getLiveData answers world[columnId][pageNum - 1].
function fakePortal({ cats = CATS, world = WORLD, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    count: (path) => calls.filter((c) => c.path === path).length,
    pages: () => calls.filter((c) => c.path === "v6/getLiveData").map((c) => `${c.bean.columnId}:${c.bean.pageNum}`),
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      if (path === "getNextColumns") {
        if (cats instanceof Error) throw cats;
        return { recommendList: cats };
      }
      if (path === "v6/getLiveData") {
        const key = `${bean.columnId}:${bean.pageNum}`;
        if (fail[key]) throw fail[key];
        const pages = world[bean.columnId] || [];
        return { channelList: pages[bean.pageNum - 1] || [] };
      }
      throw new Error("unscripted " + path);
    },
  };
}

function setup(opts = {}) {
  const kino = fakeKino();
  const portal = fakePortal(opts);
  const session = { ensures: 0 };
  session.ensure = async () => { session.ensures++; };
  session.withValidSession = async (block) => block({ userId: "u1", userToken: "tok1" });
  const clock = { t: 0, now() { return this.t; } };
  const live = makeLiveCatalog({ kino, portal, session, clock });
  return { kino, portal, session, clock, live };
}

const ids = (out) => out.items.map((c) => c.id);

// ---- the sweep and the marks -------------------------------------------------------------------

test("liveSearch: sweeps the 18+ categories first, then Todos page by page, inside its own 13 s deadline; Deportes is not asked", async () => {
  const t = setup();
  const out = await t.live.liveSearch({ query: "mixto" });
  assert.deepEqual(t.portal.pages(), [`${ADULT}:1`, `${TODOS}:1`, `${TODOS}:2`]);
  assert.equal(t.portal.count("getNextColumns"), 1);
  // liveSearch's 15 s cap minus the 2 s margin, on the injected clock (0 here).
  for (const c of t.portal.calls) assert.equal(c.opts.deadline, 13_000, c.path);
  assert.deepEqual(ids(out), ["MIX"]);
});

test("liveSearch: every hit carries its categoryId and an explicit adult; a channel in an 18+ category is adult wherever else it is listed", async () => {
  const t = setup();
  const mix = (await t.live.liveSearch({ query: "mixto" })).items[0];
  assert.equal(mix.adult, true);
  assert.equal(mix.categoryId, String(ADULT));
  const news = (await t.live.liveSearch({ query: "noticias" })).items[0];
  assert.deepEqual(news, { id: "NEWS", title: "Noticias Caracol", ref: "NEWS", categoryId: String(TODOS), number: 42, adult: false, logo: "https://img.test/NEWS.png" });
  const hot = (await t.live.liveSearch({ query: "calor" })).items[0];
  assert.equal(hot.adult, true);
  assert.equal(hot.categoryId, String(ADULT));
});

test("liveSearch: the name matches case- and accent-insensitively, a number matches exactly and comes first, at most 100 hits", async () => {
  const t = setup();
  assert.deepEqual(ids(await t.live.liveSearch({ query: "  NOTICÍAS " })), ["NEWS"]);
  const byNumber = await t.live.liveSearch({ query: "42" });
  assert.equal(byNumber.items[0].id, "NEWS");
  assert.ok(byNumber.items.slice(1).every((c) => c.title.includes("42")), "the rest match by name");
  const all = await t.live.liveSearch({ query: "canal" });
  assert.equal(all.items.length, 100);
  assert.equal(new Set(ids(all)).size, 100);
  // A name that starts with the query ranks before one that only contains it.
  const ranked = setup({ world: { [ADULT]: [[]], [TODOS]: [[chan("A", { name: "Mi Fox" }), chan("B", { name: "Fox Sports" })]] } });
  assert.deepEqual(ids(await ranked.live.liveSearch({ query: "fox" })), ["B", "A"]);
});

test("liveSearch: a second search inside the hour asks the portal nothing; after the hour it sweeps again", async () => {
  const t = setup();
  await t.live.liveSearch({ query: "mixto" });
  const asked = t.portal.calls.length;
  const ensures = t.session.ensures;
  t.clock.t = 59 * 60_000;
  assert.deepEqual(ids(await t.live.liveSearch({ query: "noticias" })), ["NEWS"]);
  assert.equal(t.portal.calls.length, asked, "no portal call while cached");
  assert.equal(t.session.ensures, ensures, "not even a session check");
  t.clock.t = 61 * 60_000;
  await t.live.liveSearch({ query: "noticias" });
  assert.equal(t.portal.count("getNextColumns"), 2);
  assert.equal(t.portal.calls.at(-1).opts.deadline, 61 * 60_000 + 13_000);
});

test("liveSearch: a query under 2 characters, or no query at all, is an empty answer with no portal call", async () => {
  const t = setup();
  for (const arg of [{ query: "a" }, { query: "  b  " }, { query: "" }, { query: 42 }, {}, null, undefined]) {
    assert.deepEqual(await t.live.liveSearch(arg), { items: [] }, JSON.stringify(arg));
  }
  assert.equal(t.portal.calls.length, 0);
  assert.equal(t.session.ensures, 0);
});

test("liveSearch: with no ChannelList category every plain category is swept (18+ first)", async () => {
  const cats = [{ columnId: DEPORTES, name: "Deportes" }, { columnId: 500, name: "Cine" }, { columnId: ADULT, name: "18+" }];
  const world = { ...WORLD, 500: [[chan("FILM", { name: "Cine Uno" })]] };
  const t = setup({ cats, world });
  const out = await t.live.liveSearch({ query: "uno" });
  assert.deepEqual(t.portal.pages(), [`${ADULT}:1`, `${DEPORTES}:1`, "500:1"]);
  assert.deepEqual(out.items.map((c) => [c.id, c.categoryId, c.adult]), [["SPORT", String(DEPORTES), false], ["FILM", "500", false]]);
});

test("liveSearch: with no 18+ category every hit is adult: false", async () => {
  const t = setup({ cats: [{ columnId: TODOS, name: "ChannelList" }] });
  const out = await t.live.liveSearch({ query: "mixto" });
  assert.deepEqual(out.items.map((c) => [c.id, c.categoryId, c.adult]), [["MIX", String(TODOS), false]]);
});

// ---- failures: never a plain hit that could be 18+, never an empty "nothing found" for a failure ----

test("liveSearch: categories that fail are the mapped error; none at all is unavailable", async () => {
  await assert.rejects(setup({ cats: new PortalError("portal100024", "") }).live.liveSearch({ query: "mixto" }), (e) => e.code === "geo_blocked");
  await assert.rejects(setup({ cats: [] }).live.liveSearch({ query: "mixto" }), (e) => e.code === "unavailable");
});

test("liveSearch: an 18+ category that cannot be read fails the whole search (fail closed) and nothing is cached", async () => {
  for (const page of [1, 2]) {
    const world = { ...WORLD, [ADULT]: [many("AD", 500), [chan("AD-LAST")]] };
    const t = setup({ world, fail: { [`${ADULT}:${page}`]: new TypeError("x") } });
    await assert.rejects(t.live.liveSearch({ query: "noticias" }), (e) => e.code === "unavailable");
    t.portal.calls.length = 0;
    await assert.rejects(t.live.liveSearch({ query: "noticias" }), (e) => e.code === "unavailable");
    assert.ok(t.portal.count("getNextColumns") === 1, "it swept again");
  }
});

test("liveSearch: Todos' first page failing is the error; a later page failing serves what was found and sweeps again next time", async () => {
  const first = setup({ fail: { [`${TODOS}:1`]: new PortalError("aaa100028", "x") } });
  await assert.rejects(first.live.liveSearch({ query: "noticias" }), (e) => e.code === "auth_required");
  const later = setup({ fail: { [`${TODOS}:2`]: new TypeError("x") } });
  const out = await later.live.liveSearch({ query: "mixto" });
  assert.deepEqual(out.items.map((c) => [c.id, c.adult]), [["MIX", true]], "the 18+ list was read: MIX stays adult");
  assert.deepEqual(ids(await later.live.liveSearch({ query: "noticias" })), [], "page 2 was not read");
  assert.equal(later.portal.count("getNextColumns"), 2, "an incomplete sweep is not kept");
});

// ---- what the kit and the app make of it ------------------------------------------------------

test("liveSearch: the kit keeps every hit with zero drops and the app's 18+ rule finds none unmarked", async () => {
  const t = setup();
  const cats = checkOutput("liveCategories", await t.live.liveCategories(), manifest).value.categories;
  for (const query of ["canal", "mixto", "noticias", "calor"]) {
    const checked = checkOutput("liveSearch", await t.live.liveSearch({ query }), manifest);
    assert.deepEqual(checked.drops, [], query);
    const marked = markSearchHits(checked.value, cats, manifest);
    assert.deepEqual(marked.unmarked, [], query);
    // Readable categories or not, the app reads the same verdict from each hit.
    const blind = markSearchHits(checked.value, null, manifest);
    assert.deepEqual(blind.value.items.map((h) => h.adult === true), marked.value.items.map((h) => h.adult === true), query);
  }
  const adultOnes = markSearchHits(checkOutput("liveSearch", await t.live.liveSearch({ query: "canal" }), manifest).value, cats, manifest).value.items.filter((h) => h.adult);
  assert.deepEqual(adultOnes.map((h) => h.id), ["MIX"]);
});

test("liveSearch: kino.storage is never touched (the list lives in memory only)", async () => {
  const kino = { ...fakeKino(), storage: new Proxy({}, { get() { throw new Error("storage touched"); } }) };
  const portal = fakePortal();
  const session = { ensure: async () => {}, withValidSession: async (block) => block({ userId: "u1", userToken: "tok1" }) };
  const live = makeLiveCatalog({ kino, portal, session, clock: { now: () => 0 } });
  assert.deepEqual(ids(await live.liveSearch({ query: "mixto" })), ["MIX"]);
});
