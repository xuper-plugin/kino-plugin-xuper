// Task 18 (D4): the Home "Canales en vivo" row for the country the person picks (port of the native
// ui/live/CountryChannels.kt: CATEGORIES_BY_COUNTRY and the country part of homeChannelsRow). The
// plugin cannot read the SIM or the time zone, so the country is the `homeCountry` select setting
// (default "none" = no row); the channels are one liveChannels page of that country's portal
// category, at most 20, never cached plugin-side (R19). A failure of the row never fails home().
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkOutput } from "../sdk/contract.mjs";
import {
  makeCountryRow, CATEGORIES_BY_COUNTRY, COUNTRY_OPTIONS, COUNTRY_ROW_ID, COUNTRY_ROW_TITLE, COUNTRY_ROW_LIMIT, countriesOf,
} from "../src/countryRow.js";
import { catalogSetup, manifest } from "./helpers/fakeCatalog.mjs";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { portalWorld } from "./helpers/portalWorld.mjs";
import { makeCatalog, LIVE_ROW_MS } from "../src/catalog.js";
import { callDeadline, CALL_BUDGET_MS } from "../src/portal.js";

const chan = (code, extra = {}) => ({ id: code, title: "Canal " + code, ref: code, categoryId: "41", number: 0, logo: `https://img.test/${code}.png`, ...extra });
const CATS = [
  { id: "40", name: "Todos", adult: false },
  { id: "41", name: "Colombia", adult: false },
  { id: "42", name: "Centroamérica", adult: false },
];

// A live catalog stand-in: what categoriesWithin / channelsWithin answer, and the calls they got.
function fakeLive({ cats = CATS, channels = { 41: Array.from({ length: 25 }, (_, i) => chan("CO" + (i + 1))), 42: [chan("CA1")] }, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    async categoriesWithin(deadline) {
      calls.push(["categories", deadline]);
      if (fail.categories) throw fail.categories;
      return cats;
    },
    async channelsWithin(id, deadline) {
      calls.push(["channels", id, deadline]);
      if (fail.channels) throw fail.channels;
      return channels[id] ?? [];
    },
  };
}
const kinoWith = (homeCountry) => fakeKino({ config: homeCountry === undefined ? {} : { homeCountry } });

test("the country map is the native one: 20 countries, Guatemala, Nicaragua and Belize on Centroamérica", () => {
  assert.equal(Object.keys(CATEGORIES_BY_COUNTRY).length, 20);
  assert.equal(CATEGORIES_BY_COUNTRY.CO, "Colombia");
  assert.equal(CATEGORIES_BY_COUNTRY.MX, "México");
  for (const cc of ["GT", "NI", "BZ"]) assert.equal(CATEGORIES_BY_COUNTRY[cc], "Centroamérica", cc);
});

test("CO: one live row of at most 20 channels of the Colombia category, each a live card", async () => {
  const live = fakeLive();
  const row = await makeCountryRow({ kino: kinoWith("CO"), live })(123_456);
  assert.equal(row.id, COUNTRY_ROW_ID);
  assert.equal(row.id, "live-country");
  assert.equal(row.title, COUNTRY_ROW_TITLE);
  assert.equal(row.title, "Canales en vivo");
  assert.equal(COUNTRY_ROW_LIMIT, 20);
  assert.equal(row.items.length, 20);
  assert.deepEqual(row.items[0], { kind: "live", id: "CO1", title: "Canal CO1", ref: "CO1", poster: "https://img.test/CO1.png" });
  assert.equal("ref" in row, false, "no Ver más: the full grid lives in En vivo");
  // One categories read and ONE channels page, both inside the caller's deadline.
  assert.deepEqual(live.calls, [["categories", 123_456], ["channels", "41", 123_456]]);
});

test("a channel without a logo has no poster; an adult-marked channel stays marked", async () => {
  const live = fakeLive({ channels: { 41: [chan("A", { logo: undefined }), chan("B", { adult: true })] } });
  const row = await makeCountryRow({ kino: kinoWith("CO"), live })(1);
  assert.deepEqual(row.items, [
    { kind: "live", id: "A", title: "Canal A", ref: "A" },
    { kind: "live", id: "B", title: "Canal B", ref: "B", poster: "https://img.test/B.png", adult: true },
  ]);
});

test("none, unset or an unknown value: no row and no portal call", async () => {
  for (const value of ["none", undefined, "ZZ", "__proto__", "constructor"]) {
    const live = fakeLive();
    assert.equal(await makeCountryRow({ kino: kinoWith(value), live })(1), null, String(value));
    assert.deepEqual(live.calls, [], String(value));
  }
});

test("GT, NI and BZ all read the Centroamérica category", async () => {
  for (const cc of ["GT", "NI", "BZ"]) {
    const live = fakeLive();
    const row = await makeCountryRow({ kino: kinoWith(cc), live })(1);
    assert.deepEqual(row.items.map((i) => i.id), ["CA1"], cc);
    assert.deepEqual(live.calls[1], ["channels", "42", 1]);
  }
});

test("the country's category missing, or listing no channel: no row", async () => {
  const missing = fakeLive({ cats: [CATS[0]] });
  assert.equal(await makeCountryRow({ kino: kinoWith("CO"), live: missing })(1), null);
  assert.equal(missing.calls.length, 1, "no channels call");
  assert.equal(await makeCountryRow({ kino: kinoWith("CO"), live: fakeLive({ channels: { 41: [] } }) })(1), null);
});

test("the categories or the channels call failing: no row, never a throw", async () => {
  const k = kinoWith("CO");
  for (const fail of [{ categories: k.error("unavailable", "x") }, { channels: k.error("auth_required", "x") }, { channels: new TypeError("bug") }]) {
    assert.equal(await makeCountryRow({ kino: k, live: fakeLive({ fail }) })(1), null);
  }
});

// ---- home() ------------------------------------------------------------------------------------

function homeWith({ country, live = fakeLive(), roots } = {}) {
  const w = catalogSetup(roots ? { roots } : {});
  const kino = kinoWith(country);
  const catalog = makeCatalog({ kino, portal: w.portal, session: { ensure: async () => {}, withValidSession: async (b) => b({ userId: "u", userToken: "t" }) }, clock: w.clock, countryRow: makeCountryRow({ kino, live }) });
  return { ...w, kino, catalog, live };
}

test("home() appends the country row after the VOD rows, inside LIVE_ROW_MS (2.2.14: never home's whole 18 s)", async () => {
  const h = homeWith({ country: "CO" });
  const rows = await h.catalog.home();
  assert.equal(rows.at(-1).id, "live-country");
  assert.ok(rows.length >= 2, "the VOD rows are still there");
  assert.ok(rows.slice(0, -1).every((r) => r.items.every((i) => i.kind !== "live")));
  assert.equal(h.live.calls[0][1], Math.min(h.clock.now() + LIVE_ROW_MS, callDeadline(h.clock, CALL_BUDGET_MS.home)));
  assert.ok(h.live.calls[0][1] - h.clock.now() <= 8_000, "the live row gets 8 s at most");
});

test("home() with none: no live row; the country row failing or missing: home still answers its VOD rows", async () => {
  const vod = (await homeWith({ country: "none" }).catalog.home()).map((r) => r.id);
  assert.ok(vod.length > 0 && !vod.includes("live-country"));
  const k = fakeKino();
  for (const live of [fakeLive({ fail: { channels: k.error("unavailable", "x") } }), fakeLive({ fail: { categories: new TypeError("bug") } }), fakeLive({ cats: [] })]) {
    assert.deepEqual((await homeWith({ country: "CO", live }).catalog.home()).map((r) => r.id), vod);
  }
});

test("home() keeps the live row within the 20-row cap", async () => {
  const h = homeWith({ country: "CO" });
  const rows = await h.catalog.home();
  assert.ok(rows.length <= 20);
  assert.equal(rows.at(-1).id, "live-country");
});

test("the kit at apiVersion 6 keeps the live items of the Home row (zero drops)", async () => {
  const rows = await homeWith({ country: "CO" }).catalog.home();
  const r = checkOutput("home", rows, manifest());
  assert.deepEqual(r.drops, []);
  const liveRow = r.value.find((x) => x.id === "live-country");
  assert.equal(liveRow.items.length, 20);
  assert.ok(liveRow.items.every((i) => i.kind === "live"));
});

// ---- the setting -------------------------------------------------------------------------------

test("the manifest declares homeCountry: a select, default none, its options the map's countries (≤ 20, labels ≤ 40)", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  const s = m.settings.find((x) => x.key === "homeCountry");
  assert.equal(s.type, "select");
  assert.equal(s.default, "none");
  assert.deepEqual(s.options, COUNTRY_OPTIONS);
  assert.ok(s.options.length <= 20);
  assert.ok(s.options.every((o) => o.label.length >= 1 && o.label.length <= 40));
  for (const o of s.options) assert.ok(o.value === "none" || countriesOf(o.value).length > 0, o.value);
  // Every portal category of the map is reachable from the setting.
  const reachable = new Set(s.options.flatMap((o) => countriesOf(o.value)).map((cc) => CATEGORIES_BY_COUNTRY[cc]));
  assert.deepEqual([...reachable].sort(), [...new Set(Object.values(CATEGORIES_BY_COUNTRY))].sort());
  assert.equal(m.apiVersion, 6);
});

// ---- the real live catalog over a scripted portal ------------------------------------------------

test("over the real portal + live catalog: one categories call and one channels page, nothing stored", async () => {
  const w = portalWorld({
    hosts: ["a.test"], config: { homeCountry: "CO" },
    routes: {
      getNextColumns: (bean) => (bean.columnCode === "masnew_live"
        ? { recommendList: [{ columnId: 12, name: "ChannelList" }, { columnId: 41, name: "Colombia" }] }
        : { recommendList: [{ columnId: 1, name: "All", assetList: Array.from({ length: 6 }, (_, i) => ({ contentId: `PEL${i + 1}`, name: "Titulo " + i, programType: "movie", tags: "Drama", score: 7 })) }] }),
      "v6/getLiveData": (bean) => {
        assert.equal(bean.columnId, 41);
        assert.equal(bean.pageNum, 1);
        return { channelList: Array.from({ length: 30 }, (_, i) => ({ channelCode: "C" + (i + 1), name: "Canal " + (i + 1), channelNumber: i + 1 })) };
      },
    },
  });
  const rows = await w.catalog.home();
  const row = rows.find((r) => r.id === "live-country");
  assert.equal(row.items.length, 20);
  assert.equal(w.paths().filter((p) => p === "v6/getLiveData").length, 1);
  assert.equal(w.requests.filter((r) => r.path === "getNextColumns" && r.bean.columnCode === "masnew_live").length, 1);
});

test("the row never touches kino.storage (R19: live lists are not cached plugin-side)", async () => {
  const base = kinoWith("CO");
  const kino = { ...base, storage: new Proxy({}, { get() { throw new Error("storage touched"); } }) };
  const row = await makeCountryRow({ kino, live: fakeLive() })(1);
  assert.equal(row.items.length, 20);
});

// ---- review minor 3: the merged option reaches all three countries ------------------------------

test("every country of the map is reached by exactly one option; the merged one stands for GT, NI and BZ", () => {
  const merged = COUNTRY_OPTIONS.find((o) => o.label === "Guatemala, Nicaragua o Belice");
  assert.deepEqual(countriesOf(merged.value), ["GT", "NI", "BZ"]);
  const covered = COUNTRY_OPTIONS.flatMap((o) => countriesOf(o.value));
  assert.deepEqual([...covered].sort(), Object.keys(CATEGORIES_BY_COUNTRY).sort());
  assert.equal(new Set(covered).size, covered.length);
  assert.deepEqual(countriesOf("none"), []);
  assert.deepEqual(countriesOf("__proto__"), []);
});

test("the merged option lists the categories of GT, NI and BZ (one call per distinct category)", async () => {
  const merged = COUNTRY_OPTIONS.find((o) => o.label === "Guatemala, Nicaragua o Belice").value;
  const live = fakeLive();
  const row = await makeCountryRow({ kino: kinoWith(merged), live })(7);
  assert.deepEqual(row.items.map((i) => i.id), ["CA1"]);
  assert.deepEqual(live.calls, [["categories", 7], ["channels", "42", 7]]);
});
