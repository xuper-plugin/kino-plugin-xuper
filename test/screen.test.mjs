// Device time zone for every date in this file: Bogotá (UTC−5), so local hours and dates are deterministic. The
// published match `time` is UTC; the screen shows it in the device's own time.
process.env.TZ = "America/Bogota";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";
import { gridOf, tilesOf, channelsOf } from "./helpers/tiles.mjs";

globalThis.kino = { lang: "es", config: {} };
const { welcomeView, catalogView, deportesView, vivoView, configView, channelItems, clockMs, liveSignature, genreLabels } =
  await import("../src/screenView.js");
const { isLiveMatch } = await import("../src/v2.js");
const { screen, screenEvent } = await import("../src/screen.js");
const { fromLegacyHome, fromLegacyMatches, sectionView, seal, parseUtcTime } = await import("../src/v2.js");
const { beginCall } = await import("../src/flight.js");
const data = await import("../src/data.js");
const { clearBearer } = await import("../src/api.js");
const { RELEASE_BASE } = await import("../src/config.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const legacy = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));

// ── tree helpers ──
function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn);
}
const all = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const byKey = (tree, key) => all(tree, (n) => n.key === key)[0];
const byType = (tree, type) => all(tree, (n) => n.type === type);
const viewOf = (tab, sectionData) => sectionView(fromLegacyHome({ sections: { [tab]: sectionData } }), tab);

const KINO_ICONS = new Set(["info", "tune", "settings", "star", "bolt", "language", "subtitles", "list", "magic", "heart", "movie", "tv", "sports", "music", "bookmark", "help", "refresh", "sync", "add", "remove", "delete", "edit", "search", "close", "check", "share", "play", "pause", "download", "upload", "link", "open_in_new", "home", "person", "lock", "notifications", "warning", "error", "visibility", "copy", "arrow_back", "arrow_forward", "expand_more", "expand_less", "more_vert", "filter_list", "calendar", "schedule", "send", "mood"]);
const SIZE_SCALE = new Set([16, 24, 32, 40, 48, 64, 80, 96, 120, 160, 200, 240, 320, 400, 480, 560, 640]);
const GAP_SCALE = new Set([0, 4, 8, 12, 16, 24, 32, 48]);
const scaleValues = (v) => (v && typeof v === "object" ? Object.values(v) : [v]);

const T0 = parseUtcTime("2026-11-16 15:00");   // 10:00 in Bogotá
const MATCHES = fromLegacyMatches({ matches: [
  { matchName: "UEFA Nations League", gameTime: "2026-11-16 15:00", channelName: "FOX", score: "0-0", gameState: "pre",
    team_a: { teamName: "Faroe Islands", teamLogo: "https://x/a.png" }, team_b: { teamName: "Moldova", teamLogo: "https://x/b.png" } },
  { matchName: "UEFA Nations League", gameTime: "2026-11-16 19:45", gameName: "C vs D", channelName: "ESPN" },
  { matchName: "Liga", gameTime: "2026-11-17 12:00", team_a: { teamName: "E" }, team_b: { teamName: "F" } },
] }).matches;

function everyView() {
  const view = viewOf("pelicula", legacy.sections.populares);
  return [
    welcomeView(), welcomeView({ error: true }),
    catalogView({ tab: "pelicula", view: null }), catalogView({ tab: "pelicula", view: null, failed: true }),
    catalogView({ tab: "pelicula", view }), catalogView({ tab: "pelicula", view, fTag: "Action" }), catalogView({ tab: "adultos", view, device: "tv" }),
    deportesView({ matches: MATCHES, now: T0 }), deportesView({ matches: null }), deportesView({ matches: null, failed: true }),
    deportesView({ depTab: "canales", chLoading: true }), deportesView({ depTab: "canales", cats: [{ id: "a", title: "A" }, { id: "b", title: "B" }], cat: "a", channels: [] }),
    vivoView({ loading: true }), vivoView({ failed: true }), vivoView({ cats: [{ id: "1", title: "x" }, { id: "2", title: "y" }], cat: "1", channels: [{ id: "c", ref: "L:a:b", title: "C" }], offline: true }),
    configView({ version: "1.0.44", ages: { catalog: { checkedAt: T0, gen: T0 - 3600000 }, matches: null }, now: T0 + 5 * 60000 }),
  ];
}

// ── views ──

test("welcomeView: Scaffold + Activate press with a timeout for identity; tuteo, no voseo", () => {
  const v = welcomeView({ error: true });
  const btn = byKey(v, "activate");
  assert.equal(btn.onPressed.event, "activate");
  assert.ok(btn.onPressed.timeoutMs >= 20_000);
  assert.ok(byType(v, "MaterialBanner").length === 1);
  const txt = JSON.stringify(v);
  assert.ok(/activa tu acceso/.test(txt) && /Acepta el permiso/.test(txt));
  assert.ok(!/activá|Aceptá|reintentá/.test(txt));
});

test("no view carries the 1 s tick; the only timers are the Fútbol clock and the live tabs' one-shot timers", () => {
  for (const v of everyView()) {
    if (v.every) assert.equal(v.every.event, "clock");
    assert.ok(!JSON.stringify(v).includes('"tick"'));
  }
  const live = vivoView({ loading: true, timers: [{ ms: 1000, event: "lvRefresh" }, { ms: 1000, event: "lcFill" }] });
  assert.deepEqual(live.every.map((t) => t.event), ["lvRefresh", "lcFill"]);
  assert.ok(deportesView({ matches: MATCHES, now: T0 }).every);
  assert.ok(!catalogView({ tab: "pelicula", view: null }).every, "the skeleton never has a timer");
});

test("every app view carries the hidden busy bar (LinearProgressIndicator `busy`)", () => {
  for (const v of everyView().slice(2)) {
    const b = byKey(v, "busy");
    assert.ok(b, "busy bar missing");
    assert.equal(b.type, "LinearProgressIndicator");
    assert.equal(b.hidden, true);
  }
});

test("icons are Kino's (no play_arrow) and sizes/gaps sit on Kino's scales", () => {
  for (const v of everyView()) {
    walk(v, (n) => {
      if (n.type === "Icon") assert.ok(KINO_ICONS.has(n.name), "unknown icon " + n.name);
      if (typeof n.icon === "string") assert.ok(KINO_ICONS.has(n.icon), "unknown icon " + n.icon);
      for (const k of ["height", "width", "h"]) if (n[k] !== undefined && n.type !== "Image") for (const x of scaleValues(n[k])) assert.ok(SIZE_SCALE.has(x), `${n.type}.${k}=${x}`);
      if (n.gap !== undefined) for (const x of scaleValues(n.gap)) assert.ok(GAP_SCALE.has(x), `${n.type}.gap=${x}`);
    });
  }
});

test("catalogView: TabBar with 6 tabs; skeleton (no timer) while nothing was ever stored", () => {
  const v = catalogView({ tab: "pelicula", view: null });
  const tabbar = byKey(v, "tabs");
  assert.equal(tabbar.value, "pelicula");
  assert.deepEqual(tabbar.tabs.map((t) => t.value), ["populares", "pelicula", "series", "anime", "ninos", "adultos"]);
  assert.ok(byType(v, "Skeleton").length > 0);
});

test("catalogView: failed → error banner whose Retry shows the busy bar and reloads", () => {
  const v = catalogView({ tab: "series", view: null, failed: true });
  const b = byKey(v, "failed");
  assert.deepEqual(b.action.onTap, { ui: [{ show: "busy" }], event: "reload" });
  assert.ok(/Revisa la conexión/.test(b.text));
});

test("catalogView: hero + named rails from the section view", () => {
  const view = viewOf("pelicula", {
    slider: [{ contentId: "H", name: "Banner", type: "1", description: "x", posterList: [{ fileType: "stage", fileUrl: "https://x/h.jpg" }] }],
    rows: { recommendList: [{ name: "Estrenos", assetList: [{ contentId: "A", name: "a", type: "1" }] }] },
  });
  const v = catalogView({ tab: "pelicula", view });
  const rail = byType(v, "titleRail")[0];
  assert.equal(rail.title, "Estrenos");
  assert.equal(rail.items[0].id, "A");
  const hero = byType(v, "heroCard")[0];
  assert.ok(hero);
  assert.deepEqual(hero.h, { compact: 200, expanded: 240 });
  assert.equal(hero.buttons[0].icon, "play");
  assert.ok(!v.every);
});

test("catalogView: genre filter — button, sheet with localized chips, filtered grid by the raw tag", () => {
  const view = viewOf("pelicula", { slider: [], rows: { recommendList: [{ name: "X", assetList: [
    { contentId: "A", name: "a", type: "1", tags: "Action,Drama" },
    { contentId: "B", name: "b", type: "1", tags: "Comedy" },
  ] }] } });
  const v0 = catalogView({ tab: "pelicula", view });
  assert.ok(v0.appBar.actions.some((a) => a.key === "filter"));
  const sheet = byKey(v0, "filterSheet");
  const titles = sheet.children[0].items.map((t) => t.title);
  assert.ok(titles.includes("Acción") && titles.includes("Comedia"), "chips in Spanish");
  const tile = sheet.children[0].items.find((t) => t.title === "Acción");
  assert.equal(tile.titleEn, "Action");
  assert.equal(tile.onTap.arg, "Action", "the filter keeps the raw tag");
  const v1 = catalogView({ tab: "pelicula", view, fTag: "Action" });
  assert.deepEqual(byKey(v1, "fGrid").items.map((i) => i.id), ["A"]);
  assert.equal(byKey(v1, "fLabel").text, "Género: Acción");
  assert.deepEqual(genreLabels("2022"), ["2022", "2022"]);
});

test("catalogView: the adult tab marks items adult:true and has no hero", () => {
  const view = viewOf("adultos", { slider: [{ contentId: "H", name: "b", type: "1", posterList: [{ fileType: "banner", fileUrl: "https://x/h.jpg" }] }],
    rows: { recommendList: [{ name: "X", assetList: [{ contentId: "A", name: "a", type: "1" }] }] } });
  const v = catalogView({ tab: "adultos", view });
  assert.equal(byType(v, "titleRail")[0].items[0].adult, true);
  assert.equal(byType(v, "heroCard").length + byType(v, "PageView").length, 0);
});

test("TV: navigation as a TabBar on top (no bottom bar); phone: NavigationBar whose change shows the busy bar", () => {
  const tv = catalogView({ tab: "pelicula", view: null, device: "tv" });
  assert.ok(!tv.bottomNavigationBar);
  assert.deepEqual(byKey(tv, "navTabs").tabs.map((t) => t.value), ["home", "deportes", "vivo", "config"]);
  const nav = catalogView({ tab: "pelicula", view: null }).bottomNavigationBar;
  assert.equal(nav.type, "NavigationBar");
  assert.equal(nav.value, "home");
  assert.deepEqual(nav.items.map((i) => i.key), ["home", "deportes", "vivo", "config"]);
  assert.deepEqual(nav.onChanged, { ui: [{ show: "busy" }], event: "nav" });
});

test("configView: Disconnect press, version, and data ages in ES and EN", () => {
  const v = configView({ version: "1.0.44", ages: { catalog: { checkedAt: T0, gen: T0 - 3 * 3600000 }, matches: null }, now: T0 + 5 * 60000 });
  assert.equal(v.bottomNavigationBar.value, "config");
  const disc = byKey(v, "disconnect");
  assert.ok(disc.onPressed.event === "disconnect" && disc.onPressed.timeoutMs >= 20_000);
  assert.ok(byKey(v, "cfgVer").text.includes("1.0.44"));
  assert.equal(byKey(v, "cfgAge0").text, "Catálogo: revisado hace 5 min · publicado hace 3 h");
  assert.equal(byKey(v, "cfgAge0").textEn, "Catalog: checked 5 min ago · published 3 h ago");
  assert.equal(byKey(v, "cfgAge1").text, "Partidos: sin datos todavía");
  assert.ok(/Desconéctate/.test(JSON.stringify(v)));
});

test("vivoView: category dropdown (busy on change) + channel grid; loading → skeleton; failed → Retry; offline note", () => {
  const cats = [{ id: "1", title: "Deportes" }, { id: "2", title: "Noticias" }];
  const v = vivoView({ cats, cat: "1", channels: [{ id: "ch1", ref: "c:ch1", title: "ESPN", logo: "https://x/l.png" }] });
  assert.equal(v.bottomNavigationBar.value, "vivo");
  assert.deepEqual(byKey(v, "liveCat").onChanged, { ui: [{ show: "busy" }], event: "liveCat" });
  const [espn] = channelsOf(v, "vivo");
  assert.ok(espn.ref === "c:ch1" && espn.poster === "https://x/l.png");
  assert.ok(!v.every, "nothing to load: no timer");
  const loading = vivoView({ cats, cat: "1", loading: true });
  assert.ok(byKey(loading, "vivoLoading") && byType(loading, "Skeleton").length > 0);
  const failed = vivoView({ cats, cat: "1", failed: true });
  assert.deepEqual(byKey(failed, "vivoFail").action.onTap, { ui: [{ show: "busy" }], event: "reloadVivo" });
  const off = vivoView({ cats, cat: "1", channels: [{ id: "a", ref: "L:a:b", title: "A" }], offline: true });
  assert.equal(byKey(off, "vivoOffline").text, "Sin conexión con la fuente: se muestra la última lista.");
  assert.equal(byKey(off, "vivoOffline").textEn, "No connection to the source: showing the last list.");
});

test("channelItems: maps channels, drops those without a ref, keeps 18+", () => {
  const items = channelItems([{ id: "a", ref: "c:a", title: "A", logo: "https://x/a.png" }, { id: "b", title: "no ref" },
    { id: "x", ref: "c:x", title: "X", adult: true }]);
  assert.equal(items.length, 2);
  assert.equal(items[0].poster, "https://x/a.png");
  assert.equal(items[0].adult, undefined);
  assert.equal(items[1].adult, true);
});

test("deportesView: v2 matches with crests, grouped by league; never '[object Object]' nor '0-0'; not tappable", () => {
  const v = deportesView({ matches: MATCHES, today: "2026-11-16", now: T0 - 3600000 });
  assert.equal(v.bottomNavigationBar.value, "deportes");
  const txt = JSON.stringify(v);
  assert.ok(txt.includes("Faroe Islands") && txt.includes("Moldova") && txt.includes("https://x/a.png"));
  assert.ok(!txt.includes("[object Object]") && !txt.includes("0-0"));
  assert.ok(all(v, (n) => n.key && String(n.key).startsWith("lg-")).length >= 1);
  const cards = byType(v, "Card");
  assert.equal(cards.length, 2, "only today's matches (date strip selects today)");
  assert.ok(!cards.some((c) => c.onTap));
  assert.ok(byKey(v, "dateStrip"));
});

test("deportesView: LIVE badge from the time window; 60 s clock only inside a live window", () => {
  const live = deportesView({ matches: MATCHES, today: "2026-11-16", now: T0 + 10 * 60000 });
  assert.equal(all(live, (n) => n.type === "Badge").length, 1);
  assert.deepEqual(live.every, { ms: 60_000, event: "clock" });
  const before = deportesView({ matches: MATCHES, today: "2026-11-16", now: T0 - 3600000 });
  assert.equal(all(before, (n) => n.type === "Badge").length, 0);
  assert.equal(before.every.event, "clock");
  assert.ok(before.every.ms > 60_000 && before.every.ms <= 30 * 60000);
  assert.equal(clockMs([], T0), 30 * 60000, "no match: a 30 min tick still revalidates long-open screens");
  assert.equal(isLiveMatch(MATCHES[0], T0), true);
  assert.equal(liveSignature(MATCHES, T0), "0");
  assert.equal(liveSignature(MATCHES, T0 - 3600000), "");
});

test("match times are UTC: the badge follows the real kickoff, and the card shows the device's own hour and day", () => {
  // Germany–Netherlands, Nations League: gameTime "2026-11-16 19:45" = 20:45 CET = 14:45 in Bogotá.
  const de = { league: "UEFA Nations League", time: "2026-11-16 19:45", a: { n: "Germany" }, b: { n: "Netherlands" } };
  assert.equal(isLiveMatch(de, Date.UTC(2026, 10, 16, 20, 15)), true, "live 30 min after the real kickoff");
  assert.equal(isLiveMatch(de, Date.UTC(2026, 10, 17, 0, 45)), false, "not live 5 h later (the old local reading said so)");
  const v = deportesView({ matches: [de], today: "2026-11-16", now: Date.UTC(2026, 10, 16, 18, 0) });
  assert.equal(byKey(v, "tm-0").text, "14:45");
  // Canada–Guatemala: "2026-11-17 01:00" UTC = 20:00 on the 16th in Bogotá (and 20:00 ET): it is today's match.
  const ca = { league: "Friendly", time: "2026-11-17 01:00", a: { n: "Canada" }, b: { n: "Guatemala" } };
  const v2 = deportesView({ matches: [de, ca], today: "2026-11-16", now: Date.UTC(2026, 10, 16, 18, 0) });
  assert.equal(byType(v2, "Card").length, 2, "both on the 16th in Bogotá");
  assert.equal(byKey(v2, "dateStrip"), undefined, "one local day: no date strip");
  assert.equal(byKey(v2, "tm-1").text, "20:00");
  // a match that started 2 h 20 min ago in real time is still visible and live until +130 min
  assert.equal(isLiveMatch(ca, Date.UTC(2026, 10, 17, 3, 9)), true);
  assert.equal(isLiveMatch(ca, Date.UTC(2026, 10, 17, 3, 11)), false);
});

test("deportesView: matches more than 3 h past their kickoff are hidden", () => {
  const v = deportesView({ matches: MATCHES, today: "2026-11-16", now: T0 + 4 * 3600000 });
  assert.ok(!JSON.stringify(v).includes("Faroe Islands"));
});

test("deportesView: skeleton while nothing was ever stored; banner when that load failed", () => {
  assert.ok(byType(deportesView({ matches: null }), "Skeleton").length > 0);
  const f = deportesView({ matches: null, failed: true });
  assert.deepEqual(byKey(f, "depFail").action.onTap, { ui: [{ show: "busy" }], event: "reloadDep" });
});

test("deportesView: the Canales tab = category picker + channel grid", () => {
  const cats = [{ id: "supertv.31", title: "ESPN" }, { id: "futbollibre.6d61696e", title: "Canales deportivos" }];
  const channels = [{ id: "a", title: "ESPN", ref: "L:supertv:a" }, { id: "b", title: "Fox Sports", ref: "L:supertv:b" }];
  const v = deportesView({ depTab: "canales", cats, cat: "supertv.31", channels });
  assert.equal(byKey(v, "depTopTabs").value, "canales");
  assert.equal(byKey(v, "sportsCat").options.length, 2);
  assert.equal(tilesOf(v, "sp").length, 2);
  assert.ok(!byKey(deportesView({ matches: [] }), "sportsCat"));
});

// ── screen() and screenEvent() with a fake Kino ──

/** A device with the catalog and matches stored (as 1.0.44 stores them) and a Bearer. */
// The portal's gameTime format, in UTC (what the publisher passes through).
const utcTime = (ms) => { const d = new Date(ms); const p = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
function storedDevice(extra = {}) {
  const cat = seal(fromLegacyHome(legacy), 1794844780749, sha256);
  const soon = utcTime(Date.now() + 3600000);   // a match in an hour: visible, not live
  const mat = seal(fromLegacyMatches({ matches: [{ matchName: "L", gameTime: soon, team_a: { teamName: "A" }, team_b: { teamName: "B" } }] }), 1794838230926, sha256);
  const now = Date.now();
  return {
    "o2:bearer": "bearer-token",
    "o2:mig": "1",
    "o2:cat": JSON.stringify(cat),
    "o2:catm": JSON.stringify({ h: cat.hash, gen: cat.gen, etag: '"e1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:mat": JSON.stringify(mat),
    "o2:matm": JSON.stringify({ h: mat.hash, gen: mat.gen, etag: '"m1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:ixm": JSON.stringify({ checkedAt: now, missingUntil: now + 3600000 }),
    "o2:trial": JSON.stringify({ expiresAt: now + 3600000 }),   // the trial session is valid: `open` does not ask for it
    ...extra,
  };
}
function cold(opts) {
  const k = installKino(opts);
  data._resetMemory();
  return k;
}

test("screen(): a cold runtime with storage paints full content in the first frame with 0 requests", async () => {
  const { requests } = cold({ storage: storedDevice(), noFetch: true });
  await clearBearer(); globalThis.kino.storage.set("o2:bearer", "bearer-token");
  beginCall();
  const v = await screen({ state: {}, device: "phone" });
  assert.ok(byType(v, "titleRail").length > 0, "rails in the first frame");
  assert.ok(byType(v, "Skeleton").length === 0);
  beginCall();
  const dep = await screen({ state: { nav: "deportes" } });
  assert.ok(JSON.stringify(dep).includes('"A"'));
  beginCall();
  await screen({ state: { nav: "config" } });
  assert.equal(requests.length, 0, "screen() never fetches");
});

test("screen(): no Bearer → welcome view", async () => {
  cold({ storage: storedDevice({ "o2:bearer": undefined }), noFetch: true });
  globalThis.kino.storage.remove("o2:bearer");
  await clearBearer();
  beginCall();
  const v = await screen({ state: {} });
  assert.ok(byKey(v, "activate"));
});

test("open: {} when fresh (0 requests), {state:{rev}} when the catalog changed", async () => {
  const fresh = cold({ storage: storedDevice(), noFetch: true });
  beginCall();
  assert.deepEqual(await screenEvent({ name: "open", state: {} }), {});
  assert.equal(fresh.requests.length, 0);

  const stale = storedDevice();
  const m = JSON.parse(stale["o2:catm"]); m.checkedAt = 1; stale["o2:catm"] = JSON.stringify(m);
  const changed = JSON.parse(JSON.stringify(legacy)); changed.generatedAt = 1794844780749 + 1; changed.sections.populares.rows.recommendList[0].name = "Nueva fila";
  const { requests } = cold({ storage: stale, routes: [(url) => (url === RELEASE_BASE + "/home.json" ? res(200, JSON.stringify(changed), { ETag: '"e9"' }, { binary: true }) : undefined)] });
  beginCall();
  const out = await screenEvent({ name: "open", state: {} });
  assert.ok(out.state && typeof out.state.rev === "string");
  assert.equal(requests.length, 1);
  beginCall();
  const v = await screen({ state: { ...out.state } });
  assert.equal(byType(v, "titleRail")[0].title, "Nueva fila");
});

test("open with nothing stored and everything failing → catFail/matFail flags → error banners (no skeleton forever)", async () => {
  cold({ storage: { "o2:bearer": "bearer-token" }, routes: [() => res(503, "")] });
  beginCall();
  const out = await screenEvent({ name: "open", state: {} });
  assert.equal(out.state.catFail, true);
  assert.equal(out.state.matFail, true);
  beginCall();
  const v = await screen({ state: out.state });
  assert.ok(byKey(v, "failed"));
});

test("reload forces a revalidation in the event and hides the busy bar", async () => {
  const { requests } = cold({ storage: storedDevice(), routes: [(url) => (url.endsWith("/home.json") ? res(304, "") : undefined)] });
  beginCall();
  const out = await screenEvent({ name: "reload", state: {} });
  assert.deepEqual(out.ui, [{ hide: "busy" }]);
  assert.equal(out.state.catFail, false);
  assert.equal(requests.length, 1, "forced even though fresh");
  assert.equal(requests[0].headers["If-None-Match"], '"e1"');
});

test("clock: {} when nothing is due and no badge flipped", async () => {
  const { requests } = cold({ storage: storedDevice(), noFetch: true });
  beginCall();
  const sig = liveSignature(data.matches().matches, Date.now());
  assert.deepEqual(await screenEvent({ name: "clock", state: { liveSig: sig } }), {});
  assert.equal(requests.length, 0);
});

test("screenEvent: pure state events", async () => {
  cold({ storage: storedDevice(), noFetch: true });
  beginCall();
  const dep = await screenEvent({ name: "nav", value: "deportes", state: {} });
  assert.equal(dep.state.nav, "deportes");
  assert.deepEqual(dep.ui, [{ hide: "busy" }]);
  assert.equal(typeof dep.state.liveSig, "string");
  assert.deepEqual((await screenEvent({ name: "nav", value: "config", state: {} })).state, { nav: "config" });
  assert.deepEqual((await screenEvent({ name: "nav", value: "raro", state: {} })).state, { nav: "home" });
  assert.deepEqual(await screenEvent({ name: "tab", value: "anime", state: {} }), { state: { tab: "anime", fTag: "" } });
  assert.deepEqual(await screenEvent({ name: "tab", value: "bogus", state: {} }), { state: { tab: "populares", fTag: "" } });
  assert.deepEqual(await screenEvent({ name: "fTag", value: "Action", state: {} }), { state: { fTag: "Action" } });
  assert.deepEqual(await screenEvent({ name: "depView", value: "todos", state: {} }), { state: { depView: "todos" } });
  assert.deepEqual(await screenEvent({ name: "depDate", value: "2026-11-17", state: {} }), { state: { depDate: "2026-11-17" } });
  assert.equal((await screenEvent({ name: "depTab", value: "x", state: {} })).state.depTab, "partidos");
  assert.deepEqual(await screenEvent({ name: "tick", state: {} }), {}, "the old tick event is gone");
  assert.deepEqual(await screenEvent({ name: "other", state: {} }), {});
  assert.deepEqual(await screenEvent({ name: "disconnect", state: {} }), { state: {} });
});
