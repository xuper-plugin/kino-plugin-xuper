// Connector group C (spec §5.1 / Step 2): stremio.js + nuvio-sports.js + cncverse.js + xuper.js, with a fake Kino
// (same runtime across calls: node --test). Payloads: test/fixtures/sources-c.json (real answers of 2026-11-17,
// trimmed) and a fake Magis portal that speaks the real 3DES wire format (xuper-crypto.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const live = await import("../src/live.js");
const { hexEnc } = await import("../src/liveMap.js");
const ls = await import("../src/liveStore.js");
const { beginCall } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { liveRef } = await import("../src/refs.js");
const nuvioMod = await import("../src/sources/nuvio-sports.js");
const cncMod = await import("../src/sources/cncverse.js");
const xuperMod = await import("../src/sources/xuper.js");
const { encryptBody, decryptBlob, md5Hex } = await import("../src/sources/xuper-crypto.js");
const { isAdultTitle } = await import("../src/sources/adult.js");
const nuvio = nuvioMod.default;
const cncverse = cncMod.default;
const xuper = xuperMod.default;

const FX = JSON.parse(readFileSync(new URL("./fixtures/sources-c.json", import.meta.url), "utf8"));
const M = 60_000, H = 60 * M, D = 24 * H;

// ── helpers ──

/** A device: a fresh fake Kino (with a Bearer unless `bearer: false`), a cold live memory, and a new call. */
async function device(opts = {}) {
  const storage = { ...(opts.storage || {}) };
  if (opts.bearer !== false) storage["o2:bearer"] = "bearer-token";
  const k = installKino({ ...opts, storage });
  await clearBearer();
  if (opts.bearer !== false) k.kino.storage.set("o2:bearer", "bearer-token");
  k.writes.length = 0;
  ls._resetMemory();
  beginCall();
  return k;
}

/** Storage with a fresh stored category registry for one source (as liveStore writes it). */
function registry(src, cats, at = Date.now()) {
  return {
    "o2:lc": JSON.stringify({ v: 1, src: { [src]: { at, cats } } }),
    "o2:lm": JSON.stringify({ v: 1, c: { [src]: { at, failAt: 0, failN: 0 } }, l: {} }),
  };
}

const json = (o) => res(200, JSON.stringify(o));
const pathOf = (u) => { try { return new URL(u).pathname; } catch (_) { return u; } };

test.afterEach(() => { live._setSources(null); kino.lang = "es"; });

// ═════════════════════════════ nuvio-sports ═════════════════════════════

const NUVIO = "https://nuviosports.xyz/";
function nuvioRoutes(st) {
  return [(url) => {
    if (!url.startsWith(NUVIO)) return undefined;
    let m = /\/catalog\/tv\/([^/]+)\.json$/.exec(url);
    if (m) {
      const c = st.catalogs[m[1]];
      return c ? json(typeof c === "function" ? c() : c) : res(404, "");
    }
    m = /\/stream\/tv\/([^/]+)\.json$/.exec(url);
    if (m) return json({ streams: st.streams[decodeURIComponent(m[1])] || [] });
    return undefined;
  }];
}
const golfCat = "nuvio-sports." + hexEnc("golf");
const OLD = "nuvio_sport_dlv_ch_528_movistar-golf";
const NEW = "nuvio_sport_cdn_ch_xx_movistar-golf";
const renamed = () => ({ metas: FX.nuvioGolf.metas.map((m) => (m.id === OLD ? { ...m, id: NEW } : m)) });

test("nuvio: the stable key strips the provider prefix cdn_ch_xx_ / dlv_ch_<n>_; other ids keep their raw id", () => {
  assert.equal(nuvioMod.channelKey("nuvio_sport_cdn_ch_xx_bein-sports-max-8"), "ch:bein-sports-max-8");
  assert.equal(nuvioMod.channelKey("nuvio_sport_dlv_ch_498_bein-sports-max-8"), "ch:bein-sports-max-8");
  assert.equal(nuvioMod.channelKey(OLD), nuvioMod.channelKey(NEW));
  for (const id of ["nuvio_sport_ts_ch_golf-channel", "nuvio_sport_dlv_event_52abde25a7e3317103dc4a48", "nuvio_sport_cdn_2590079", "nuvio_sport_vavoo_ch_golf-hd-france"]) {
    assert.equal(nuvioMod.channelKey(id), null, id);
  }
  assert.ok(nuvioMod.isPlaceholder(FX.nuvioOther.metas[0]), "the ⚠️ Subscription Expired row");
  assert.ok(!nuvioMod.isPlaceholder(FX.nuvioOther.metas[1]));
});

test("nuvio: 15 code categories (0 requests), 1.0.43 ids, titles in ES and EN", async () => {
  await device({ noFetch: true });
  const es = await nuvio.categories({});
  assert.equal(nuvio.codeCategories, true);
  assert.equal(es.length, 15);
  assert.deepEqual(es.map((c) => c.id), ["live", "networks", "football", "basketball", "tennis", "motorsport", "mma", "baseball", "hockey", "rugby", "americanfootball", "golf", "cricket", "college", "other"]);
  assert.equal(es[0].title, "En vivo ahora");
  assert.equal(es[2].title, "Fútbol");
  kino.lang = "en";
  const en = await nuvio.categories({});
  assert.equal(en[0].title, "Live now");
  assert.equal(en[13].title, "College sports");
  assert.ok(en.every((c, i) => c.id === es[i].id));
});

test("nuvio: one request per list, stable-key ids with raw refs, the placeholder left out, no module memo (0 requests later)", async () => {
  live._setSources([nuvio]);
  const st = { catalogs: { nuvio_sports_golf: { metas: FX.nuvioGolf.metas }, nuvio_sports_other: { metas: FX.nuvioOther.metas } }, streams: {} };
  const k = await device({ routes: nuvioRoutes(st) });
  const page = await live.liveChannels({ categoryId: golfCat });
  assert.equal(k.requests.length, 1);
  assert.match(pathOf(k.requests[0].url), /\/catalog\/tv\/nuvio_sports_golf\.json$/);
  const mov = page.items.find((c) => c.ref === liveRef("nuvio-sports", OLD));
  assert.equal(mov.id, "nuvio-sports_" + live.hashId("ch:movistar-golf"), "id from the stable key");
  const golfCh = page.items.find((c) => c.ref === liveRef("nuvio-sports", "nuvio_sport_ts_ch_golf-channel"));
  assert.equal(golfCh.id, "nuvio-sports_" + live.hashId("nuvio_sport_ts_ch_golf-channel"), "no key: 1.0.43's id");
  assert.equal(page.items.length, FX.nuvioGolf.metas.length);

  beginCall();
  const other = await live.liveChannels({ categoryId: "nuvio-sports." + hexEnc("other") });
  assert.equal(other.items.length, 2);
  assert.ok(!other.items.some((c) => /expired/i.test(c.ref) || /expired/i.test(c.title)));

  // a cold runtime, within the list's fresh window: from storage, 0 requests (listMemo is gone)
  ls._resetMemory();
  k.requests.length = 0;
  beginCall();
  const again = await live.liveChannels({ categoryId: golfCat });
  assert.equal(k.requests.length, 0);
  assert.deepEqual(again.items, page.items);
});

test("nuvio: a provider rename keeps Kino's channel id and changes only the ref", async () => {
  live._setSources([nuvio]);
  const st = { catalogs: { nuvio_sports_golf: { metas: FX.nuvioGolf.metas } }, streams: {} };
  await device({ routes: nuvioRoutes(st) });
  const before = (await live.liveChannels({ categoryId: golfCat })).items.find((c) => c.ref === liveRef("nuvio-sports", OLD));
  st.catalogs.nuvio_sports_golf = renamed();
  beginCall();
  await live.loadList(golfCat, { force: true });
  beginCall();
  const after = (await live.liveChannels({ categoryId: golfCat })).items.find((c) => c.title === before.title);
  assert.equal(after.id, before.id);
  assert.equal(after.ref, liveRef("nuvio-sports", NEW));
});

test("nuvio resolve: Spanish stream first; 'no streams' re-lists the category once, re-matches by key, retries once", async () => {
  live._setSources([nuvio]);
  const st = {
    catalogs: { nuvio_sports_golf: { metas: FX.nuvioGolf.metas } },
    streams: {
      [NEW]: [{ url: "https://cdn.test/en.m3u8", language: "english", score: 9 }, { url: "https://cdn.test/es.m3u8", language: "spanish" }],
    },
  };
  const k = await device({ routes: nuvioRoutes(st) });
  await live.liveChannels({ categoryId: golfCat });            // stores the list holding OLD
  st.catalogs.nuvio_sports_golf = renamed();                    // the addon renamed it; OLD has no streams now
  k.requests.length = 0;
  beginCall();
  const out = await live.resolveLive(liveRef("nuvio-sports", OLD));
  assert.equal(out.url, "https://cdn.test/es.m3u8");
  assert.deepEqual(k.requests.map((r) => pathOf(r.url).split("/").slice(-3).join("/")),
    ["stream/tv/" + OLD + ".json", "catalog/tv/nuvio_sports_golf.json", "stream/tv/" + NEW + ".json"]);

  // Kino still holds the old ref: the stored list already has the new id under the same key → no re-list
  k.requests.length = 0;
  beginCall();
  const again = await live.resolveLive(liveRef("nuvio-sports", OLD));
  assert.equal(again.url, "https://cdn.test/es.m3u8");
  assert.equal(k.requests.length, 2);
});

test("nuvio resolve: no match after the re-list → the 'no streams' error, with no second retry", async () => {
  live._setSources([nuvio]);
  const st = { catalogs: { nuvio_sports_golf: { metas: FX.nuvioGolf.metas } }, streams: {} };
  const k = await device({ routes: nuvioRoutes(st) });
  await live.liveChannels({ categoryId: golfCat });
  k.requests.length = 0;
  beginCall();
  await assert.rejects(() => live.resolveLive(liveRef("nuvio-sports", OLD)), /no streams/);
  assert.equal(k.requests.length, 2, "the stream request + one re-list");
  // a channel never listed: no category to re-list → just the stream request
  k.requests.length = 0;
  beginCall();
  await assert.rejects(() => live.resolveLive(liveRef("nuvio-sports", "nuvio_sport_cdn_ch_xx_nowhere")), /no streams/);
  assert.equal(k.requests.length, 1);
});

// ═════════════════════════════ cncverse ═════════════════════════════

const CNC = "https://cncverse.dpdns.org/u/p_48sfkwcafx1s";
function cncRoutes(st) {
  return [(url) => {
    if (!url.startsWith(CNC)) return undefined;
    if (url === CNC + "/manifest.json") return json(st.manifest || FX.cncManifest);
    const m = /\/catalog\/tv\/([^/]+)\.json$/.exec(url);
    if (m) { const c = (st.catalogs || {})[m[1]]; return c ? json(typeof c === "function" ? c() : c) : res(404, ""); }
    const s = /\/stream\/tv\/([^/]+)\.json$/.exec(url);
    if (s) return json({ streams: (st.streams || {})[decodeURIComponent(s[1])] || [] });
    return undefined;
  }];
}
const SK = "cnc_SKTechLiveEvents_tv";
const skCat = "cncverse." + hexEnc(SK);
const EVENT_CATS = ["cnc_SportzXLiveEvents_tv", "cnc_PlayZTVLiveEvents_tv", "cnc_LivXowLiveEvents_tv", "cnc_SKTechLiveEvents_tv", "cnc_PlayFyLiveEvents_tv"];

/** Re-encodes a bridge id after editing its event JSON (what the bridge does when an event goes live). */
function reencode(rawId, edit) {
  const d = cncMod.decodeEventId(rawId);
  const ev = edit(JSON.parse(JSON.stringify(d.ev)));
  return "cnc:" + Buffer.from(d.provider + "::" + JSON.stringify(ev), "utf8").toString("base64url");
}

test("cncverse: the stable key decodes provider | title | start from the real bridge id; base64 UTF-8 decodes", () => {
  const up = FX.cncSKTech.metas.find((m) => m.name.startsWith("🔜"));
  assert.equal(cncMod.eventKey(up.id), "ev:SKTechLiveEvents|New Zealand vs India|2026/11/18 22:00:00 +0000");
  const live1 = reencode(up.id, (ev) => ({ ...ev, poster: ev.poster.replace("isLive=false", "isLive=true") }));
  assert.notEqual(live1, up.id, "the raw id changes when the event goes live");
  assert.equal(cncMod.eventKey(live1), cncMod.eventKey(up.id), "the key does not");
  assert.equal(cncMod.b64Text(Buffer.from("Albacete Balompié ⚽", "utf8").toString("base64url")), "Albacete Balompié ⚽");
  assert.equal(cncMod.eventKey("cnc:%%%"), null);
  assert.equal(cncMod.eventKey("nuvio_sport_x"), null);
  assert.equal(FX.cncSKTech.metas.filter(cncMod.isEnded).length, 3);
});

test("cncverse: categories from the manifest once per call (events only), then 0 requests from the registry", async () => {
  live._setSources([cncverse]);
  const k = await device({ routes: cncRoutes({}) });
  const cats = await live.liveCategories();
  assert.deepEqual(cats.map((c) => c.id), ["v.events"], "every cncverse category is a live event");
  const stored = JSON.parse(k.store.get("o2:lc")).src.cncverse.cats;
  assert.deepEqual(stored.map((c) => c.id), EVENT_CATS);
  assert.deepEqual(stored.map((c) => c.title), ["SportzX Live Events", "PlayZTV Live Events", "LivXow Live Events", "SKTech Live Events", "PlayFy Live Events"]);
  await cncverse.categories({});                                  // same call: the manifest flight is shared
  assert.equal(k.requests.length, 1);
  ls._resetMemory();
  beginCall();
  await live.liveCategories();
  assert.equal(k.requests.length, 1, "stored registry: no manifest request");
});

test("cncverse: one request per list (no manifest), finished events and duplicate titles left out, key ids, raw refs", async () => {
  live._setSources([cncverse]);
  const metas = FX.cncSKTech.metas.slice();
  const canada = metas.find((m) => /Canada vs Guatemala/.test(m.name));
  const twin = reencode(canada.id, (ev) => ({ ...ev, eventId: 9999, eventInfo: { ...ev.eventInfo, startTime: "2026/11/17 09:00:00 +0000" } }));
  metas.push({ ...canada, id: twin });                            // same title, another event id
  const k = await device({ routes: cncRoutes({ catalogs: { [SK]: { metas } } }), storage: registry("cncverse", EVENT_CATS.map((id) => ({ id, title: id }))) });
  const page = await live.liveChannels({ categoryId: skCat });
  assert.deepEqual(k.requests.map((r) => pathOf(r.url)), ["/u/p_48sfkwcafx1s/catalog/tv/" + SK + ".json"]);
  const titles = page.items.map((c) => c.title);
  assert.deepEqual(titles, ["New Zealand vs India", "Canada vs Guatemala", "Baltimore Ravens vs Los Angeles Chargers", "Miami Heat vs Houston Rockets", "Brooklyn Nets vs Philadelphia 76ers"]);
  for (const c of page.items) {
    const raw = metas.find((m) => liveRef("cncverse", m.id) === c.ref).id;
    assert.equal(c.id, "cncverse_" + live.hashId(cncMod.eventKey(raw)));
  }
});

test("nuvio and cncverse store each event's kick-off (and end) and its upstream provider; Kino never sees them", async () => {
  // nuvio: `released` (ISO), the provider from the raw id; a 24/7 channel has no time
  const metas = [{ ...FX.nuvioOther.metas[1], released: "2026-11-17T08:10:00.000Z" }, FX.nuvioGolf.metas.find((m) => m.id === "nuvio_sport_ts_ch_golf-channel")];
  await device({ routes: nuvioRoutes({ catalogs: { nuvio_sports_other: { metas } }, streams: {} }) });
  const nv = await nuvio.channels("other", {});
  assert.deepEqual(nv.map((c) => [c.start || 0, c.origin]), [[Date.UTC(2026, 10, 17, 8, 10), "dlv"], [0, "ts"]]);
  // cncverse: the descriptor's eventInfo ("2026/11/17 01:00:00 +0000"), the provider from the bridge id
  live._setSources([cncverse]);
  const k = await device({ routes: cncRoutes({ catalogs: { [SK]: { metas: FX.cncSKTech.metas } } }), storage: registry("cncverse", EVENT_CATS.map((id) => ({ id, title: id }))) });
  const page = await live.liveChannels({ categoryId: skCat });
  assert.ok(page.items.length > 0 && page.items.every((c) => !("start" in c) && !("origin" in c)), "not in what Kino gets");
  const stored = JSON.parse(k.store.get("o2:ll:" + live.listKey("cncverse", SK)));
  const nz = stored.find((c) => c.title === "New Zealand vs India");
  assert.deepEqual([nz.start, nz.end, nz.origin], [Date.UTC(2026, 10, 18, 22, 0), undefined, "SKTech"]);
  const cg = stored.find((c) => c.title === "Canada vs Guatemala");
  assert.deepEqual([cg.start, cg.end, cg.origin], [Date.UTC(2026, 10, 17, 1, 0), Date.UTC(2026, 10, 17, 3, 20), "SKTech"]);
});

test("cncverse: an event going live keeps Kino's channel id; the ref follows the new raw id", async () => {
  live._setSources([cncverse]);
  const up = FX.cncSKTech.metas.find((m) => m.name.startsWith("🔜"));
  const st = { catalogs: { [SK]: { metas: [up] } } };
  await device({ routes: cncRoutes(st), storage: registry("cncverse", [{ id: SK, title: "SKTech" }]) });
  const before = (await live.liveChannels({ categoryId: skCat })).items[0];
  const nowLive = reencode(up.id, (ev) => ({ ...ev, poster: ev.poster.replace("isLive=false", "isLive=true") }));
  st.catalogs[SK] = { metas: [{ ...up, id: nowLive, name: "🔴 New Zealand vs India", poster: up.poster.replace("isLive=false", "isLive=true") }] };
  beginCall();
  await live.loadList(skCat, { force: true });
  beginCall();
  const after = (await live.liveChannels({ categoryId: skCat })).items[0];
  assert.equal(after.id, before.id);
  assert.equal(before.ref, liveRef("cncverse", up.id));
  assert.equal(after.ref, liveRef("cncverse", nowLive));
});

test("cncverse: a non-event catalog id lists nothing with 0 requests; resolve probes copies on the device", async () => {
  const k = await device({
    routes: [
      ...cncRoutes({ streams: { "cnc:x": [{ url: "https://a.test/1.m3u8" }, { url: "https://b.test/2.m3u8", behaviorHints: { proxyHeaders: { request: { Referer: "https://r.test/" } } } }] } }),
      (url) => (url.startsWith("https://a.test/") ? res(403, "") : url.startsWith("https://b.test/") ? res(200, "#EXTM3U\n") : undefined),
    ],
  });
  assert.deepEqual(await cncverse.channels("cnc_JIOTVIND_tv", {}), []);
  assert.deepEqual(await cncverse.channels("", {}), []);
  assert.equal(k.requests.length, 0);
  const out = await cncverse.resolve("cnc:x", {});
  assert.deepEqual(out, { url: "https://b.test/2.m3u8", mime: "application/vnd.apple.mpegurl", headers: { Referer: "https://r.test/" } });
});

// ═════════════════════════════ xuper ═════════════════════════════

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
const COLUMNS = [
  { columnId: 31, name: "Colombia" },
  { columnId: 1, name: "ChannelList" },
  { columnId: 9, name: "XXX Adultos" },
  { columnId: 12, name: "Canales +18" },
  { columnId: 14, name: "Sexto Sentido" },
  { columnId: 40, name: "Nueva" },
];
const chanList = (col, n, from = 0) => Array.from({ length: n }, (_, i) => ({ channelCode: `c${col}_${from + i}`, name: `Canal ${col}-${from + i}`, logo: `https://logo.test/${col}/${i}.png` }));

/** A fake Magis portal + Xuper backend: real 3DES wire, per-path handlers, a call log. */
function portal(o = {}) {
  const calls = [];
  const beans = [];
  let logins = 0, activations = 0;
  const h = {
    "v3/snToken": () => ({ snToken: "sntok-1", sn: "" }),
    "v8/active": () => ({ userId: "anon", userToken: "A" + (++activations) }),
    "v8/login": () => ({ userId: "u1", userToken: "T" + (++logins) }),
    getNextColumns: () => ({ recommendList: o.columns || COLUMNS }),
    "v6/getLiveData": (b) => ({ channelList: b.pageNum === 1 ? chanList(b.columnId, 2) : [] }),
    ...(o.handlers || {}),
  };
  const route = (url, init) => {
    if (/\/xuper\/config$/.test(url)) {
      calls.push("config");
      if (o.backendDown) return res(503, "");
      return json({ magisKey: KEY, email: "shared@test", password: "pw" });
    }
    const m = /^https:\/\/[^/]+\/api\/portalCore\/(.+)$/.exec(url);
    if (!m) return undefined;
    const path = m[1];
    const bean = JSON.parse(decryptBlob(init.body, KEY));
    calls.push(path);
    beans.push({ path, bean });
    const out = h[path] ? h[path](bean) : {};
    if (out instanceof Error) return out;
    if (out && out.returnCode) return json(out);
    return json({ returnCode: "0", data: encryptBody(JSON.stringify(out), KEY) });
  };
  return { calls, beans, route, count: (p) => calls.filter((c) => c === p).length };
}

/** A cold runtime of xuper on a fresh device. */
async function xdev(p, opts = {}) {
  const k = await device({ routes: [p.route], ...opts });
  xuperMod._resetSession();
  return k;
}
const freshCfg = (at) => JSON.stringify({ magisKey: KEY, email: "shared@test", password: "pw", at });

test("xuper: adult columns by title (broad, not 'Sexto'), the all-channels column in ES and EN", async () => {
  // The shared 18+ rule (src/sources/adult.js), with xuper's column cases.
  for (const t of ["XXX", "Adultos", "Canales +18", "18+ Premium", "Playboy TV", "Erótico", "Sexy", "Hot Sex", "Porn Hub"]) assert.ok(isAdultTitle(t), t);
  for (const t of ["Colombia", "Sexto Sentido", "Essex TV", "Deportes 1", "Canal 18", "Fox Sports 2"]) assert.ok(!isAdultTitle(t), t);
  const p = portal();
  await xdev(p);
  const cats = await xuper.categories({});
  const all = { es: "Todos", en: "All channels" };
  assert.deepEqual(cats, [
    { id: "31", title: "Colombia" }, { id: "1", title: all }, { id: "9", title: "XXX Adultos", adult: true },
    { id: "12", title: "Canales +18", adult: true }, { id: "14", title: "Sexto Sentido" }, { id: "40", title: "Nueva" },
  ], "the all-channels title is stored whole ({es, en})");
  // Through the framework the all-channels column is its own category, in the visible language, also after a switch.
  live._setSources([xuper]);
  xuperMod._resetSession();
  beginCall();
  assert.equal((await live.liveCategories()).find((c) => c.id === "v.all.xuper").title, "Todos los canales de Xuper");
  kino.lang = "en";
  beginCall();
  assert.equal((await live.liveCategories()).find((c) => c.id === "v.all.xuper").title, "All Xuper channels");
});

test("xuper: a cold device stores the secret, its portal sn and its own guest session; the next runtime reuses all three", async () => {
  const p = portal();
  const k = await xdev(p);
  await xuper.categories({});
  assert.deepEqual(p.calls, ["config", "v3/snToken", "v8/active", "getNextColumns"], "the own anonymous session: no shared login");
  const cfg = JSON.parse(k.store.get(xuperMod.CFG_KEY));
  assert.equal(cfg.magisKey, KEY);
  const sn = JSON.parse(k.store.get(xuperMod.SN_KEY)).sn;
  assert.equal(sn, md5Hex("sntok-1" + "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"));
  assert.equal(JSON.parse(k.store.get(xuperMod.SESS_KEY)).sn, sn, "the own session is bound to the stored device");
  assert.ok(![...k.store.values()].includes("[object Object]"));
  assert.equal(p.beans.find((b) => b.path === "getNextColumns").bean.userToken, "A1");

  xuperMod._resetSession();                                       // a new runtime: memory gone, storage kept
  p.calls.length = 0;
  p.beans.length = 0;
  beginCall();
  await xuper.categories({});
  assert.deepEqual(p.calls, ["getNextColumns"], "the stored own session: no activation");
  assert.equal(p.beans[0].bean.sn, sn);
  assert.equal(p.beans[0].bean.userToken, "A1");

  k.store.delete(xuperMod.SESS_KEY);                              // the session forgotten: the stored device reactivates
  xuperMod._resetSession();
  p.calls.length = 0;
  p.beans.length = 0;
  beginCall();
  await xuper.categories({});
  assert.deepEqual(p.calls, ["v8/active", "getNextColumns"]);
  assert.equal(p.beans[0].bean.sn, sn, "reactivation of the persisted device");
  assert.equal(p.beans[0].bean.snToken, "");

  p.calls.length = 0;                                             // same runtime, next call: the session is reused
  beginCall();
  await xuper.channels("31", {});
  assert.deepEqual(p.calls, ["v6/getLiveData"]);
});

test("xuper: concurrent listings open ONE session (one device, one activation) in a call", async () => {
  const p = portal();
  await xdev(p);
  const [a, b, cats] = await Promise.all([xuper.channels("31", {}), xuper.channels("40", {}), xuper.categories({})]);
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.equal(cats.length, 6);
  assert.equal(p.count("config"), 1);
  assert.equal(p.count("v3/snToken"), 1);
  assert.equal(p.count("v8/active"), 1);
  assert.equal(p.count("v8/login"), 0);
});

test("xuper: a dead own token is renewed once (one reactivation) for every caller that saw it die", async () => {
  const p = portal({
    handlers: { "v6/getLiveData": (b) => (b.userToken === "A1" ? { returnCode: "aaa100027", errorMessage: "not logged in" } : { channelList: chanList(b.columnId, 1) }) },
  });
  await xdev(p);
  await xuper.categories({});                                     // own session A1
  xuperMod._resetSession();                                       // a later runtime: A1 comes from storage
  beginCall();
  const [a, b] = await Promise.all([xuper.channels("31", {}), xuper.channels("40", {})]);
  assert.equal(a.length, 1);
  assert.equal(b.length, 1);
  assert.equal(p.count("v8/active"), 2, "the first activation + ONE reactivation");
  assert.equal(p.count("v3/snToken"), 1, "the device is kept");
  assert.equal(p.count("v8/login"), 0);
});

test("xuper: a remembered device the portal says cannot activate (aaa100080) is replaced once", async () => {
  let refused = true;
  const p = portal({ handlers: { "v8/active": (b) => (refused && b.sn === "deadbeefdeadbeef" ? (refused = false, { returnCode: "aaa100080" }) : { userId: "u", userToken: "A9" }) } });
  const k = await xdev(p, { storage: { [xuperMod.CFG_KEY]: freshCfg(Date.now()), [xuperMod.SN_KEY]: JSON.stringify({ sn: "deadbeefdeadbeef" }) } });
  await xuper.categories({});
  assert.deepEqual(p.calls, ["v8/active", "v3/snToken", "v8/active", "getNextColumns"]);
  assert.notEqual(JSON.parse(k.store.get(xuperMod.SN_KEY)).sn, "deadbeefdeadbeef");
});

test("xuper config: backend down → last-good (≤ 7 d) with a 10 min retry backoff; nothing usable → throws", async () => {
  const p = portal({ backendDown: true });
  const k = await xdev(p, { storage: { [xuperMod.CFG_KEY]: freshCfg(Date.now() - 2 * D) } });
  await xuper.categories({});
  assert.equal(p.count("config"), 1);
  assert.ok(JSON.parse(k.store.get(xuperMod.CFG_KEY)).failAt > 0);
  xuperMod._resetSession();
  p.calls.length = 0;
  beginCall();
  await xuper.categories({});
  assert.equal(p.count("config"), 0, "inside the retry backoff: no backend request");

  const p2 = portal({ backendDown: true });
  await xdev(p2);
  await assert.rejects(() => xuper.categories({}), /sin secret del backend/);
  const p3 = portal({ backendDown: true });
  await xdev(p3, { storage: { [xuperMod.CFG_KEY]: freshCfg(Date.now() - 8 * D) } });
  await assert.rejects(() => xuper.categories({}), /secret/, "past 7 d the old secret is not used");
  kino.lang = "en";
  beginCall();
  await assert.rejects(() => xuper.categories({}), /no secret from the backend \(activate Xuper\)/);
});

test("xuper: columns whose stored list is empty go last (the framework's list meta, no key of its own)", async () => {
  let empty31 = true;
  const p = portal({ handlers: { "v6/getLiveData": (b) => ({ channelList: b.columnId === 31 && empty31 ? [] : b.pageNum === 1 ? chanList(b.columnId, 1) : [] }) } });
  live._setSources([xuper]);
  const k = await xdev(p);
  // the connector's own order, as stored in the registry (the mapping then places each column in its category)
  const order = async () => { await live.liveCategories(); return JSON.parse(k.store.get("o2:lc")).src.xuper.cats.map((c) => c.id); };
  assert.deepEqual(await order(), ["31", "1", "9", "12", "14", "40"], "portal order");
  beginCall();
  await live.loadList("xuper." + hexEnc("31"));
  assert.ok(!k.writes.some((w) => w === "o2:xe"), "no connector key for empty columns");
  // the next category refresh (registry aged past fresh) reads the list meta: the empty column moves last
  const age = (ms) => { const lc = JSON.parse(k.store.get("o2:lc")); lc.src.xuper.at -= ms; k.store.set("o2:lc", JSON.stringify(lc)); const lm = JSON.parse(k.store.get("o2:lm")); lm.c.xuper.at -= ms; k.store.set("o2:lm", JSON.stringify(lm)); };
  age(8 * D);
  ls._resetMemory();
  beginCall();
  assert.deepEqual(await order(), ["1", "9", "12", "14", "40", "31"], "the empty column moved last");
  empty31 = false;
  beginCall();
  await live.loadList("xuper." + hexEnc("31"), { force: true });
  age(8 * D);
  ls._resetMemory();
  beginCall();
  assert.deepEqual(await order(), ["31", "1", "9", "12", "14", "40"], "back in portal order");
});

test("xuper: a later page cut by the network keeps a stored full list; the portal ending it does not", async () => {
  let page2 = "net";
  const p = portal({ handlers: { "v6/getLiveData": (b) => (b.pageNum === 1 ? { channelList: chanList(b.columnId, 250) } : page2 === "net" ? new Error("socket") : { returnCode: "aaa200001" }) } });
  await xdev(p);
  const storedFull = { storedList: () => Array.from({ length: 300 }, (_, i) => ({ id: "x" + i })) };
  await assert.rejects(() => xuper.channels("31", storedFull), /socket/);
  beginCall();
  assert.equal((await xuper.channels("31", { storedList: () => null })).length, 250, "nothing stored: the partial list beats nothing");
  page2 = "portal";
  beginCall();
  assert.equal((await xuper.channels("31", storedFull)).length, 250, "the portal ending the listing is the real end");
});

test("xuper: a later page cut by this call's own limits (deadline, request budget) is never stored as the whole list", async () => {
  const p = portal({ handlers: { "v6/getLiveData": (b) => (b.pageNum === 1 ? { channelList: chanList(b.columnId, 250) } : Object.assign(new Error("past"), { code: "deadline" })) } });
  await xdev(p);
  await assert.rejects(() => xuper.channels("31", { storedList: () => null }), (e) => e.code === "deadline");
});

test("xuper: portal calls queue 400 ms apart, also when several columns load at once", async () => {
  // A frozen clock: the waits are measured against Date.now, which a slow or busy machine would move between callers.
  const real = Date.now;
  const t0 = real();
  Date.now = () => t0;
  try {
    const p = portal();
    const k = await xdev(p, { storage: { "o2:xcfg": freshCfg(Date.now()) } });
    const sleeps = [];
    k.kino.sleep = (ms) => { sleeps.push(ms); return Promise.resolve(); };
    await Promise.all(["31", "40", "14"].map((c) => xuper.channels(c, {})));
    // the activation + 3 lists: each call waits for its own slot (0, 400, 800, 1200 ms…) instead of all sleeping 400 ms together
    const waits = sleeps.filter((ms) => ms > 0).sort((a, b) => a - b);
    assert.ok(waits.length >= 3, JSON.stringify(sleeps));
    for (let i = 1; i < waits.length; i++) assert.ok(waits[i] - waits[i - 1] >= 350, JSON.stringify(waits));
  } finally { Date.now = real; }
});

test("xuper through src/live.js: Kino gets adult flags, 1.0.43 ids and refs", async () => {
  const p = portal();
  live._setSources([xuper]);
  await xdev(p);
  const cats = await live.liveCategories();
  assert.deepEqual(cats.filter((c) => c.adult).map((c) => c.id), ["v.adult"]);
  assert.deepEqual((await live.categoryList()).find((c) => c.id === "v.adult").members.map((m) => m.rawCat), ["9", "12"]);
  beginCall();
  const page = await live.liveChannels({ categoryId: "xuper." + hexEnc("31") });
  assert.deepEqual(page.items[0], { id: "xuper_" + live.hashId("c31_0"), title: "Canal 31-0", ref: liveRef("xuper", "c31_0"), logo: "https://logo.test/31/0.png", categoryId: "xuper.3331" });
  beginCall();
  const adultPage = await live.liveChannels({ categoryId: "xuper." + hexEnc("9") });
  assert.ok(adultPage.items.length > 0 && adultPage.items.every((c) => c.adult === true));
});

// ═════════════════════════════ no module memos ═════════════════════════════

test("group C keeps no module-level memo caches (once() + the live store instead)", () => {
  for (const f of ["stremio", "nuvio-sports", "cncverse", "xuper"]) {
    const code = readFileSync(new URL(`../src/sources/${f}.js`, import.meta.url), "utf8");
    assert.ok(!/\b(listMemo|catsMemo|catsAt|descById|_cfg|_cache|MEM)\b/.test(code), f + " still has a module memo");
    assert.ok(!/kino\.(fetch|storage)\s*\./.test(code) && !/kino\.fetch\s*\(/.test(code), f + " calls kino.fetch/storage directly");
  }
  assert.ok(createHash, "node:crypto available");
});
