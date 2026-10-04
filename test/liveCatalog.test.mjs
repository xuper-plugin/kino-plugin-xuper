import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { checkOutput } from "../sdk/contract.mjs";
import { makeLiveCatalog } from "../src/liveCatalog.js";
import { PortalError } from "../src/portal.js";
import { channelOf, idOfCode, codeOfId, codeOfRef } from "../src/channelId.js";
import { isChannelRef } from "../src/refs.js";

const manifest = {
  id: "xuper", name: "Xuper", version: "2.0.0", apiVersion: 6, entry: "plugin.js",
  hosts: ["portal.test"], capabilities: ["search", "home", "channels"], liveStreamHostsAny: true,
};

// ---- fixtures (invented names and hosts) -------------------------------------------------------

const categories = () => ({
  recommendList: [
    { columnId: 76182, name: "ChannelList" },
    { columnId: 76183, name: "Deportes" },
    { columnId: 76184, name: "18+" },
    { name: "sin columnId" },
  ],
});
const chan = (code, extra = {}) => ({
  channelCode: code, name: "Canal " + code, channelNumber: "7",
  posterList: [{ fileType: "poster", fileUrl: `https://img.test/${code}.jpg` }, { fileType: "icon", fileUrl: `https://img.test/${code}.png` }],
  ...extra,
});
const page = (...channels) => ({ channelList: channels });
const many = (prefix, n) => Array.from({ length: n }, (_, i) => chan(`${prefix}-${i + 1}`));

// Fake portal: a FIFO queue of answers per path (a value, an Error, or a function); records calls.
function fakePortal(queues = {}) {
  const calls = [];
  return {
    calls,
    count: (path) => calls.filter((c) => c.path === path).length,
    async call(path, bean, opts = {}) {
      calls.push({ path, bean, opts });
      await Promise.resolve();
      const q = queues[path];
      if (!q || q.length === 0) throw new Error("unscripted " + path);
      const a = q.shift();
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

function setup({ queues, ensureError } = {}) {
  const kino = fakeKino();
  const portal = fakePortal(queues);
  const session = fakeSession({ ensureError });
  const live = makeLiveCatalog({ kino, portal, session, clock: { now: () => 0 } });
  return { kino, portal, session, live };
}

const checkChannels = (value) => checkOutput("liveChannels", value, manifest);

// ---- categories --------------------------------------------------------------------------------

test("categories: ChannelList is Todos, ids are decimal text, the adult one is marked and the column with no id is out", async () => {
  const { live } = setup({ queues: { getNextColumns: [categories()] } });
  assert.deepEqual(await live.liveCategories(), [
    { id: "76182", title: "Todos" },
    { id: "76183", title: "Deportes" },
    { id: "76184", title: "18+", adult: true },
  ]);
});

test("categories: asks masnew_live with pageSize 200, the session's credentials, after ensure", async () => {
  const { live, portal, session } = setup({ queues: { getNextColumns: [categories()] } });
  await live.liveCategories();
  assert.equal(session.ensures, 1);
  assert.equal(portal.calls.length, 1);
  const { path, bean, opts } = portal.calls[0];
  assert.equal(path, "getNextColumns");
  assert.deepEqual(bean, { columnCode: "masnew_live", pageNum: 1, pageSize: 200, version: "" });
  // The app's 20 s cap minus the 2 s margin, on the injected clock (0 here).
  assert.deepEqual(opts, { baseFields: true, userId: "u1", userToken: "tok1", deadline: 18_000 });
});

test("categories: every adult name is recognized, trimmed and case-insensitive", async () => {
  const names = ["18+", "Adultos", " adulto ", "XXX", "+18"];
  const recommendList = [...names.map((name, i) => ({ columnId: 100 + i, name })), { columnId: 200, name: "Cine" }];
  const { live } = setup({ queues: { getNextColumns: [{ recommendList }] } });
  assert.deepEqual((await live.liveCategories()).filter((c) => !c.adult), [{ id: "200", title: "Cine" }]);
});

test("categories: a text columnId counts, a non-integer or blank-named column is skipped, the SDK cap of 200 holds", async () => {
  const recommendList = [
    { columnId: "55", name: "Texto" }, { columnId: "x", name: "Mala" }, { columnId: 56, name: "  " },
    { columnId: 57.5, name: "Decimal" },
    ...Array.from({ length: 205 }, (_, i) => ({ columnId: 1000 + i, name: "C" + i })),
  ];
  const { live } = setup({ queues: { getNextColumns: [{ recommendList }] } });
  const out = await live.liveCategories();
  assert.equal(out.length, 200);
  assert.deepEqual(out[0], { id: "55", title: "Texto" });
  assert.equal(out[1].id, "1000");
});

test("categories: an answer without recommendList is an empty list, not an error", async () => {
  const { live } = setup({ queues: { getNextColumns: [{}, { recommendList: [] }] } });
  assert.deepEqual(await live.liveCategories(), []);
  assert.deepEqual(await live.liveCategories(), []);
});

test("categories: a failing ensure surfaces and the portal is never called", async () => {
  const boom = fakeKino().error("auth_required", "Configura Xuper en Ajustes ▸ Plugins");
  const { live, portal } = setup({ queues: { getNextColumns: [categories()] }, ensureError: boom });
  await assert.rejects(() => live.liveCategories(), (e) => e === boom);
  assert.equal(portal.calls.length, 0);
});

test("categories: a portal error is the mapped kino error; a transport failure is unavailable", async () => {
  let s = setup({ queues: { getNextColumns: [new PortalError("portal100024", "")] } });
  await assert.rejects(() => s.live.liveCategories(), (e) => e.code === "geo_blocked");
  s = setup({ queues: { getNextColumns: [new TypeError("x")] } });
  await assert.rejects(() => s.live.liveCategories(), (e) => e.code === "unavailable");
});

test("categories: the output passes the kit with zero drops", async () => {
  const { live } = setup({ queues: { getNextColumns: [categories()] } });
  const r = checkOutput("liveCategories", await live.liveCategories(), manifest);
  assert.deepEqual(r.drops, []);
  assert.deepEqual(r.value.categories.map((c) => c.id), ["76182", "76183", "76184"]);
});

// ---- channels ----------------------------------------------------------------------------------

const withCats = (extra = {}) => ({ getNextColumns: [categories()], ...extra });

test("channels: maps a portal entry (id, title, bare ref, category, icon logo, number)", async () => {
  const { live, portal, session } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("A"))] }) });
  const r = await live.liveChannels({ categoryId: "76183", cursor: null });
  assert.deepEqual(r, { items: [{
    id: "A", title: "Canal A", ref: "A", categoryId: "76183", number: 7, logo: "https://img.test/A.png",
  }] });
  const call = portal.calls.find((c) => c.path === "v6/getLiveData");
  assert.deepEqual(call.bean, { columnId: 76183, pageNum: 1, pageSize: 500, dataVersion: "", expireTimeStr: "" });
  assert.deepEqual(call.opts, { baseFields: true, userId: "u1", userToken: "tok1", deadline: 18_000 });
  assert.ok(session.ensures >= 1);
});

test("channels: with no icon the loose posterUrl is the logo, with neither there is no logo", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [page(
    { channelCode: "B", name: "B", posterUrl: "https://img.test/b.png", posterList: [{ fileType: "poster", fileUrl: "https://img.test/b.jpg" }] },
    { channelCode: "C", name: "C" },
  )] }) });
  const { items } = await live.liveChannels({ categoryId: "76183" });
  assert.equal(items[0].logo, "https://img.test/b.png");
  assert.equal("logo" in items[1], false);
});

test("channels: number is the integer in 1..9999, else 0", async () => {
  const num = (channelNumber) => chan("N" + String(channelNumber), { channelNumber });
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [page(
    num(1), num(9999), num(0), num(10000), num(-3), num("abc"), num(12.5), num(undefined), num("42"),
  )] }) });
  const { items } = await live.liveChannels({ categoryId: "76183" });
  assert.deepEqual(items.map((i) => i.number), [1, 9999, 0, 0, 0, 0, 0, 0, 42]);
});

test("channels: blank code or name and in-page duplicates are skipped; odd codes are encoded, not dropped", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [page(
    chan("ok1"), chan("  "), { name: "sin código" }, chan("with space"), chan("~hidden"),
    chan("ok1", { name: "Repetido" }), chan("ok2", { name: "   " }), chan(5), chan("ok3"),
  )] }) });
  const { items } = await live.liveChannels({ categoryId: "76183" });
  assert.deepEqual(items.map((i) => i.id), ["ok1", idOfCode("with space"), idOfCode("~hidden"), "5", "ok3"]);
  assert.equal(items[0].title, "Canal ok1");
});

test("channels: a full page of 500 has next = the following portal page; a short page has none", async () => {
  const { live, portal } = setup({ queues: withCats({ "v6/getLiveData": [page(...many("p1", 500)), page(...many("p2", 40))] }) });
  const first = await live.liveChannels({ categoryId: "76183" });
  assert.equal(first.items.length, 500);
  assert.equal(first.next, "2");
  const second = await live.liveChannels({ categoryId: "76183", cursor: first.next });
  assert.equal(second.items.length, 40);
  assert.equal("next" in second, false);
  assert.deepEqual(portal.calls.filter((c) => c.path === "v6/getLiveData").map((c) => c.bean.pageNum), [1, 2]);
});

test("channels: Todos (about 1040 channels) flows through 3 SDK pages and the kit drops nothing", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [page(...many("a", 500)), page(...many("b", 500)), page(...many("c", 40))] }) });
  let cursor = null;
  const ids = [];
  let pages = 0;
  do {
    const r = await live.liveChannels({ categoryId: "76182", cursor });
    assert.deepEqual(checkChannels(r).drops, []);
    ids.push(...r.items.map((i) => i.id));
    cursor = r.next ?? null;
    pages++;
  } while (cursor !== null);
  assert.equal(pages, 3);
  assert.equal(ids.length, 1040);
  assert.equal(new Set(ids).size, 1040);
});

test("channels: the listing stops at page 10 even when the portal keeps sending full pages", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": Array.from({ length: 12 }, (_, i) => page(...many("q" + i, 500))) }) });
  const r9 = await live.liveChannels({ categoryId: "76183", cursor: "9" });
  assert.equal(r9.next, "10");
  const r10 = await live.liveChannels({ categoryId: "76183", cursor: "10" });
  assert.equal(r10.items.length, 500);
  assert.equal("next" in r10, false);
  assert.deepEqual(await live.liveChannels({ categoryId: "76183", cursor: "11" }), { items: [] });
});

test("channels: a portal failure on page 1 is the mapped error", async () => {
  let s = setup({ queues: withCats({ "v6/getLiveData": [new PortalError("portal100024", "")] }) });
  await assert.rejects(() => s.live.liveChannels({ categoryId: "76183" }), (e) => e.code === "geo_blocked");
  s = setup({ queues: withCats({ "v6/getLiveData": [new TypeError("x")] }) });
  await assert.rejects(() => s.live.liveChannels({ categoryId: "76183" }), (e) => e.code === "unavailable");
});

test("channels: a portal failure on a later page ends the listing with an empty page", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [new PortalError("portal100024", "")] }) });
  assert.deepEqual(await live.liveChannels({ categoryId: "76183", cursor: "2" }), { items: [] });
});

test("channels: a failing ensure on page 1 surfaces, on a later page it ends the listing", async () => {
  const boom = fakeKino().error("auth_required", "Configura Xuper en Ajustes ▸ Plugins");
  const s = setup({ queues: withCats(), ensureError: boom });
  await assert.rejects(() => s.live.liveChannels({ categoryId: "76183" }), (e) => e === boom);
  assert.deepEqual(await s.live.liveChannels({ categoryId: "76183", cursor: "2" }), { items: [] });
  assert.equal(s.portal.calls.length, 0);
});

test("channels: an answer without channelList is an empty page", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [{}] }) });
  assert.deepEqual(await live.liveChannels({ categoryId: "76183" }), { items: [] });
});

test("channels: a categoryId that is not a positive integer is not_found, with no portal call", async () => {
  const { live, portal } = setup({ queues: withCats() });
  for (const categoryId of [undefined, null, "", "abc", "0", "-5", "12.5", "1e3", "999999999999", 76183]) {
    await assert.rejects(() => live.liveChannels({ categoryId }), (e) => e.code === "not_found", String(categoryId));
  }
  await assert.rejects(() => live.liveChannels(), (e) => e.code === "not_found");
  assert.equal(portal.calls.length, 0);
});

test("channels: a garbage or zero cursor is page 1", async () => {
  const { live, portal } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("A")), page(chan("A")), page(chan("A")), page(chan("A"))] }) });
  for (const cursor of ["abc", "0", "-2", ""]) await live.liveChannels({ categoryId: "76183", cursor });
  assert.deepEqual(portal.calls.filter((c) => c.path === "v6/getLiveData").map((c) => c.bean.pageNum), [1, 1, 1, 1]);
});

// ---- adult categories --------------------------------------------------------------------------

test("adult: an adult category's channels are served marked adult (one channel call)", async () => {
  const { live, portal } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("X"))] }) });
  assert.deepEqual((await live.liveChannels({ categoryId: "76184" })).items.map((c) => c.adult), [true]);
  assert.equal(portal.count("v6/getLiveData"), 1);
});

test("adult: ids seen by liveCategories are remembered, so channels re-reads nothing", async () => {
  const { live, portal } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("X")), page(chan("A")), page(chan("B"))] }) });
  await live.liveCategories();
  assert.equal((await live.liveChannels({ categoryId: "76184" })).items[0].adult, true);
  await live.liveChannels({ categoryId: "76183" });
  await live.liveChannels({ categoryId: "76183", cursor: "2" });
  assert.equal(portal.count("getNextColumns"), 1);
});

test("adult: with no categories read yet, liveChannels reads them once (not once per page)", async () => {
  const { live, portal } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("A")), page(chan("B"))] }) });
  await live.liveChannels({ categoryId: "76183" });
  await live.liveChannels({ categoryId: "76183", cursor: "2" });
  assert.equal(portal.count("getNextColumns"), 1);
});

test("adult: if the categories cannot be read at all, channels fail closed on page 1 instead of risking an adult one", async () => {
  const { live, portal } = setup({ queues: { getNextColumns: [{ recommendList: [] }], "v6/getLiveData": [page(chan("A"))] } });
  await assert.rejects(() => live.liveChannels({ categoryId: "76183" }), (e) => e.code === "unavailable");
  assert.equal(portal.count("v6/getLiveData"), 0);
});

test("adult: a later EMPTY categories answer does not wipe the adult ids from the last non-empty one", async () => {
  const { live, portal } = setup({ queues: { getNextColumns: [categories(), { recommendList: [] }], "v6/getLiveData": [page(chan("A"))] } });
  assert.ok((await live.liveCategories()).length > 0);
  assert.deepEqual(await live.liveCategories(), []);
  assert.equal((await live.liveChannels({ categoryId: "76184" })).items[0].adult, true, "the adult category is still known as adult");
  assert.equal(portal.count("v6/getLiveData"), 1);
  assert.equal(portal.count("getNextColumns"), 2, "channels re-read nothing");
});

test("adult: a page-2 call with no adult ids known and a failing categories re-read ends the listing, with no channel call", async () => {
  const { live, portal } = setup({ queues: { getNextColumns: [new TypeError("down")], "v6/getLiveData": [page(chan("A"))] } });
  assert.deepEqual(await live.liveChannels({ categoryId: "76183", cursor: "2" }), { items: [] });
  assert.equal(portal.count("v6/getLiveData"), 0);
  assert.equal(portal.count("getNextColumns"), 1);
});

// ---- Task 17 (D3): 18+ is marked, not hidden; the app gates it behind the device's 18+ code ------

test("D3: liveCategories lists every adult name, marked adult: true; the others carry no flag", async () => {
  const names = ["18+", "Adultos", " adulto ", "XXX", "+18"];
  const recommendList = [...names.map((name, i) => ({ columnId: 100 + i, name })), { columnId: 200, name: "Cine" }];
  const { live } = setup({ queues: { getNextColumns: [{ recommendList }] } });
  assert.deepEqual(await live.liveCategories(), [
    ...names.map((title, i) => ({ id: String(100 + i), title, adult: true })),
    { id: "200", title: "Cine" },
  ]);
});

test("D3: an adult category's channels are returned, each marked adult: true", async () => {
  const { live, portal } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("X1"), chan("X2"))] }) });
  const out = await live.liveChannels({ categoryId: "76184" });
  assert.deepEqual(out.items.map((c) => [c.id, c.adult]), [["X1", true], ["X2", true]]);
  assert.equal(portal.count("v6/getLiveData"), 1);
  const plain = setup({ queues: withCats({ "v6/getLiveData": [page(chan("A"))] }) });
  assert.equal("adult" in (await plain.live.liveChannels({ categoryId: "76183" })).items[0], false);
});

test("D3: the kit at apiVersion 6 keeps the adult category and the adult channels", async () => {
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("X1"))] }) });
  const cats = checkOutput("liveCategories", await live.liveCategories(), manifest);
  assert.deepEqual(cats.drops, []);
  assert.deepEqual(cats.value.categories.find((c) => c.id === "76184"), { id: "76184", title: "18+", country: "", genre: cats.value.categories[0].genre, adult: true });
  const chans = checkChannels(await live.liveChannels({ categoryId: "76184" }));
  assert.deepEqual(chans.drops, []);
  assert.equal(chans.value.items[0].adult, true);
});

// ---- breadcrumbs: what a page loses before the app sees it ---------------------------------------

function loggedSetup(queues) {
  const logs = [];
  const k = Object.create(fakeKino(), { log: { value: (line) => logs.push(String(line)) } });
  const live = makeLiveCatalog({ kino: k, portal: fakePortal(queues), session: fakeSession(), clock: { now: () => 0 } });
  return { live, logs };
}

test("channels: each page writes one breadcrumb with the raw count, the kept count and the drops by reason (counts only)", async () => {
  const { live, logs } = loggedSetup(withCats({ "v6/getLiveData": [page(
    chan("ok1"), chan("  "), chan("with space"), chan("~hidden"), chan("ok1", { name: "Repetido" }), chan("ok2", { name: "   " }), "junk", chan("a".repeat(2001)), chan("ok3"),
  )] }));
  await live.liveChannels({ categoryId: "76183" });
  assert.deepEqual(logs.filter((l) => l.startsWith("xuper:live page")), [
    "xuper:live page cat=76183 page=1 raw=9 kept=4 blank=2 dup=1 shape=1 badid=1",
  ]);
});

test("channels: a later page that fails still ends the listing, and says so in a breadcrumb", async () => {
  const { live, logs } = loggedSetup(withCats({ "v6/getLiveData": [new PortalError("portal100024", "")] }));
  assert.deepEqual(await live.liveChannels({ categoryId: "76183", cursor: "2" }), { items: [] });
  assert.equal(logs.filter((l) => l.startsWith("xuper:live page_fail cat=76183 page=2")).length, 1);
});

// ---- odd portal codes: encoded into valid ids, raw code kept in ref -------------------------------

const ID_RE = /^[A-Za-z0-9._~-]{1,128}$/;

test("odd codes (spaces, slash, accents, leading ~, very long) become valid, stable, distinct ids; the ref keeps the raw code", async () => {
  const odd = ["with space", "a/b", "canal ñandú", "~hidden", "x.looks", "z ".repeat(50), "z ".repeat(150), "日本 TV"];
  const one = () => page(...odd.map((c) => chan(c)), chan("OK_1"));
  const { live } = setup({ queues: { getNextColumns: [categories(), categories()], "v6/getLiveData": [one(), one()] } });
  const run = async () => (await live.liveChannels({ categoryId: "76183" })).items;
  const items = await run();
  assert.equal(items.length, odd.length + 1);
  for (const [i, c] of odd.entries()) {
    assert.match(items[i].id, ID_RE);
    assert.ok(items[i].id.startsWith("x."));
    assert.equal(items[i].ref, "xlive1:" + c);
    assert.equal(codeOfId(items[i].id), c.length <= 90 ? c : null); // reversible when it fits, hashed otherwise
  }
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
  assert.deepEqual(items[odd.length], { ...items[odd.length], id: "OK_1", ref: "OK_1" }); // a valid code is untouched
  // stable across calls and equal to what migrate answers for the raw saved code
  assert.deepEqual((await run()).map((i) => i.id), items.map((i) => i.id));
  for (const [i, c] of odd.entries()) assert.equal(idOfCode(c), items[i].id);
  assert.equal(idOfCode("OK_1"), "OK_1");
});

test("odd codes: the two long codes sharing a prefix hash apart, and the same code in two spellings dedupes by id", async () => {
  const a = "z ".repeat(150) + "1";
  const b = "z ".repeat(150) + "2";
  assert.notEqual(idOfCode(a), idOfCode(b));
  assert.equal(idOfCode(a).length <= 128, true);
  const { live } = setup({ queues: withCats({ "v6/getLiveData": [page(chan("a b"), chan("a b", { name: "Otra" }))] }) });
  assert.equal((await live.liveChannels({ categoryId: "76183" })).items.length, 1);
});

test("odd codes: round-trip id -> code for every reversible case, wrapped refs are channel refs and unwrap", () => {
  for (const c of ["a b", "ñ", "~x", "x.y", "a/b/c", "日本", "🙂 live"]) {
    const { id, ref } = channelOf(c);
    assert.match(id, ID_RE);
    assert.equal(codeOfId(id), c);
    assert.equal(isChannelRef(ref), true);
    assert.equal(codeOfRef(ref), c);
  }
  for (const c of ["CH_01", "123", "a.b-c~d"]) assert.deepEqual(channelOf(c), { id: c, ref: c });
  assert.equal(channelOf("  "), null);
  assert.equal(channelOf("a".repeat(2001)), null);
});

test("liveSearch finds an odd-code channel with the same id and ref the listing gives", async () => {
  const { live } = setup({ queues: { getNextColumns: [categories()], "v6/getLiveData": [page(), page(chan("odd code/1", { name: "Canal Raro" }))] } });
  const out = await live.liveSearch({ query: "raro" });
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].id, idOfCode("odd code/1"));
  assert.equal(out.items[0].ref, "xlive1:odd code/1");
});
