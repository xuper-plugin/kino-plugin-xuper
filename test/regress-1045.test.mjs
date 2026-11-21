// Regressions from the 1.0.45 run on the Redmi Note 9 Pro (S/device/report-1.0.45.md, "Fixes after the device run").
// Written against the plugin's entry points only (screen, screenEvent, resolve, liveCategories, liveChannels), so the
// same file also runs against a built bundle:
//   XUPER_PLUGIN=/abs/path/plugin.js node --test test/regress-1045.test.mjs
// The bundle that went to the device (pre-fix 1.0.45) fails every test here except the guards marked "guard".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import(process.env.XUPER_PLUGIN ? pathToFileURL(process.env.XUPER_PLUGIN).href : "../src/plugin.js");
const { fromLegacyHome, fromLegacyMatches, seal } = await import("../src/v2.js");
const { PLUGIN_VERSION } = await import("../src/config.js");

const M = 60_000;
const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const legacy = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));
const BACKEND = "https://x.xkplugins.site";
const hex = (s) => Buffer.from(encodeURIComponent(s), "utf8").toString("hex");   // src/live.js hexEnc, for ASCII
const liveRef = (src, ch) => `L:${src}:${encodeURIComponent(ch)}`;

// ── tree helpers ──
function walk(node, fn, path = []) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn, path)); return; }
  if (!node || typeof node !== "object") return;
  fn(node, path);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn, node.type ? [...path, node] : path);
}
const all = (tree, pred) => { const out = []; walk(tree, (n, path) => { if (pred(n)) out.push({ n, path }); }); return out; };
const byKey = (tree, key) => (all(tree, (n) => n.key === key)[0] || {}).n;

/** The catalog and matches stored as the plugin stores them (no request needed to draw the screen). */
function storedCatalog() {
  const cat = seal(fromLegacyHome(legacy), 1794844780749, sha256);
  const mat = seal(fromLegacyMatches({ matches: [] }), 1794838230926, sha256);
  const now = Date.now();
  return {
    "o2:mig": "1",
    "o2:cat": JSON.stringify(cat),
    "o2:catm": JSON.stringify({ h: cat.hash, gen: cat.gen, etag: '"e1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:mat": JSON.stringify(mat),
    "o2:matm": JSON.stringify({ h: mat.hash, gen: mat.gen, etag: '"m1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:ixm": JSON.stringify({ checkedAt: now, missingUntil: now + 3600000 }),
  };
}

/**
 * A device: a fresh fake Kino, this runtime's Bearer memo cleared (the screen's own "Desconectar"), then `session`
 * stored when `bearer` is given. `identity` = kino.identity.telegram's stand-in.
 */
async function device({ storage = {}, routes = [], bearer = "bearer-token", identity, noFetch = false } = {}) {
  const k = installKino({ storage: {}, routes, noFetch });
  await P.screenEvent({ name: "disconnect", state: {} });
  for (const [key, v] of Object.entries(storage)) k.store.set(key, v);
  if (bearer) k.store.set("o2:bearer", bearer);
  if (identity) k.kino.identity = { telegram: identity };
  k.requests.length = 0;
  k.writes.length = 0;
  k.logs.length = 0;
  return k;
}

/** Kino's identity answer for a signed install (what the backend's /session checks). */
function identityOk(calls) {
  return async (opts) => {
    calls.push(opts);
    return { id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" };
  };
}

/** The Xuper backend after the move: it refuses `oldBearer`, signs in again, and refuses VOD resolves with it. */
function movedBackend({ oldBearer = "old-bearer", newBearer = "new-bearer" } = {}) {
  const seen = [];
  const route = (url, init) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    const auth = (init && init.headers && init.headers.Authorization) || "";
    seen.push(path);
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return res(200, JSON.stringify({ session: newBearer }));
    if (auth === "Bearer " + oldBearer) return res(401, '{"detail":"bad session"}');
    return res(404, "");
  };
  return { route, seen };
}

// ═════════════════ BUG-1: moving the backend logged every device out ═════════════════

test("BUG-1: a Bearer the moved backend refuses (401) → the loading screen, and `open` signs in again with no tap", async () => {
  const ids = [];
  const be = movedBackend();
  // An existing user (intro already seen): a cached catalog, a Bearer, and `o2:intro` set.
  const k = await device({ storage: { ...storedCatalog(), "o2:intro": "1" }, bearer: "old-bearer", routes: [be.route], identity: identityOk(ids) });
  // The first call after the update meets the new backend: 401, the stored session is forgotten; the person reads why.
  await assert.rejects(P.resolve("v:ABC123:1"), (e) => e.userMessage === "La sesión venció. Abre la pantalla de Xuper para reconectarte.");
  assert.equal(k.store.get("o2:bearer"), undefined, "the refused Bearer is dropped (as designed)");
  // Opening Xuper with no Bearer (but the intro already seen): the loading screen while it signs in by itself — never
  // the one-time intro, and never a welcome/Activar.
  const first = await P.screen({ state: {}, device: "phone" });
  assert.equal(byKey(first, "activate"), undefined, "no welcome view after a server-side session loss");
  assert.equal(byKey(first, "iEnter"), undefined, "an existing user never sees the one-time intro");
  assert.ok(all(first, (n) => n.type === "CircularProgressIndicator").length > 0, "the loading screen shows while it signs in");
  // `open` (the screen's own event: identity is allowed there, Kino approved it at install) signs in again.
  const out = await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 1, "one identity call, no press");
  assert.match(ids[0].challenge, /^c{32}$/);
  assert.equal(k.store.get("o2:bearer"), "new-bearer");
  assert.ok(out.state && out.state.auth > 0, "the answer re-renders the screen");
  const again = await P.screen({ state: out.state });
  assert.equal(byKey(again, "activate"), undefined);
  assert.ok(all(again, (n) => n.type === "titleRail").length > 0, "the catalog is drawn once signed in");
  // and nothing more on the next opening
  await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 1);
});

test("BUG-1 guard: a first install shows the one-time intro and «Desconectar» returns to it; `open` never signs in by itself", async () => {
  const ids = [];
  await device({ storage: storedCatalog(), bearer: null, identity: identityOk(ids), noFetch: true });
  assert.ok(byKey(await P.screen({ state: {} }), "iEnter"), "never activated: the one-time intro");
  await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 0);

  const be = movedBackend();
  // An existing user (intro seen) disconnects: it clears the Bearer AND the intro, back to the one-time welcome.
  const k = await device({ storage: { ...storedCatalog(), "o2:intro": "1" }, bearer: "old-bearer", routes: [be.route], identity: identityOk(ids) });
  await assert.rejects(P.resolve("v:ABC123:1"));            // 401: a sign-in is pending
  await P.screenEvent({ name: "disconnect", state: {} });    // the person disconnects anyway
  assert.ok(byKey(await P.screen({ state: {} }), "iEnter"), "disconnected: back to the one-time intro");
  await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 0, "a disconnected person is never signed in without a press");
  assert.equal(k.store.get("o2:bearer"), undefined);
});

test("BUG-1: the person's identity says no → the retry surface with its error; `open` auto-recovers once it's back on", async () => {
  let asked = 0;
  const be = movedBackend();
  const refused = async () => { asked++; throw Object.assign(new Error("switched off"), { code: "permission_denied" }); };
  await device({ storage: { ...storedCatalog(), "o2:intro": "1" }, bearer: "old-bearer", routes: [be.route], identity: refused });
  await assert.rejects(P.resolve("v:ABC123:1"));
  const out = await P.screenEvent({ name: "open", state: {} });
  assert.equal(asked, 1);
  assert.equal(out.state.actError, "consent");   // identity off/denied → the "turn it on in settings" banner
  const v = await P.screen({ state: out.state });
  assert.ok(byKey(v, "retry") && byKey(v, "wErrId"), "the retry surface with the identity banner");
  // Auto-activate retries on each open (no "Activar" button to press): the moment the permission is back on, the next
  // opening recovers by itself. While it is still off, the call simply fails again (kino.identity never re-prompts).
  await P.screenEvent({ name: "open", state: {} });
  assert.equal(asked, 2, "signed in again on the next open — it auto-recovers without a tap when the permission returns");
});

// ═════════════════ BUG-8: the catalog's search button did nothing ═════════════════

test("BUG-8: no `go.search` with an empty query anywhere; the button opens a field whose submit searches", async () => {
  await device({ storage: storedCatalog(), noFetch: true });
  for (const tab of ["populares", "pelicula", "series", "anime"]) {
    const v = await P.screen({ state: { tab }, device: "phone" });
    const searches = all(v, (n) => n.go && n.go.search);
    for (const { n } of searches) assert.ok(String(n.go.search.q || "").trim().length > 0, "Kino drops go.search with q '' (" + tab + ")");
    const btn = byKey(v, "search");
    assert.deepEqual(btn.onPressed, { ui: [{ open: "searchSheet" }] });
    const sheet = byKey(v, "searchSheet");
    assert.equal(sheet.type, "BottomSheet");
    const field = all(sheet, (n) => n.type === "TextField")[0].n;
    assert.equal(field.onSubmitted.event, "search");
    assert.equal(field.onTrailingTap.event, "search");
    assert.equal(field.maxLength, 200);
    assert.ok(field.labelText && field.labelTextEn, "ES and EN");
  }
  assert.deepEqual(await P.screenEvent({ name: "search", value: "  Matrix  ", state: {} }),
    { go: { search: { q: "Matrix" } }, ui: [{ close: "searchSheet" }] });
  assert.deepEqual(await P.screenEvent({ name: "search", state: { inputs: { sq: "Dune" } } }),
    { go: { search: { q: "Dune" } }, ui: [{ close: "searchSheet" }] });
  assert.deepEqual(await P.screenEvent({ name: "search", value: "", state: { inputs: { sq: " Dune " } } }),
    { go: { search: { q: "Dune" } }, ui: [{ close: "searchSheet" }] }, "the icon's tap: the field's text from state.inputs");
  assert.deepEqual(await P.screenEvent({ name: "search", value: "   ", state: {} }), {}, "an empty field does nothing");
  const long = await P.screenEvent({ name: "search", value: "x".repeat(300), state: {} });
  assert.equal(long.go.search.q.length, 200, "Kino takes at most 200 characters");
});

// ═════════════════ PERF-1: catalog tabs held Kino's main thread 0.5–0.75 s ═════════════════

test("PERF-1: a catalog tab is a lazy ListView (Kino composes only the rails in view); the sheets sit outside it", async () => {
  await device({ storage: storedCatalog(), noFetch: true });
  // The fixture holds Populares (hero + 4 rails) and Adultos (3 rails); a genre filter draws a grid in the same list.
  for (const state of [{ tab: "populares" }, { tab: "adultos" }, { tab: "populares", fTag: "Action" }, { tab: "pelicula" }]) {
    for (const deviceKind of ["phone", "tv"]) {
      const v = await P.screen({ state, device: deviceKind });
      const content = all(v, (n) => ["titleRail", "heroCard", "PageView", "titleGrid", "MaterialBanner"].includes(n.type) ||
        ["fChip", "fEmpty", "empty"].includes(n.key));
      assert.ok(content.length > 0, JSON.stringify(state));
      for (const { n, path } of content) {
        assert.ok(!path.some((p) => p.type === "SingleChildScrollView"), n.type + " drawn whole by a SingleChildScrollView");
        assert.ok(path.some((p) => p.type === "ListView"), n.type + " inside the lazy list");
      }
      for (const key of ["searchSheet", "filterSheet"]) {
        const sheet = all(v, (n) => n.key === key)[0];
        if (sheet) assert.ok(!sheet.path.some((p) => p.type === "ListView" && p.key && p.key.startsWith("list-")), key + " outside the lazy list");
      }
      const list = all(v, (n) => n.type === "ListView" && String(n.key).startsWith("list-"))[0].n;
      assert.equal(list.flex, 1);
      assert.ok(list.items.length <= 500 && list.items.every((it) => typeof it.key === "string" && it.key), "every item has its own key");
    }
  }
});

// ═════════════════ BUG-3: blank logos on Fútbol ▸ Canales ═════════════════

test("BUG-3: 'Canales deportivos' logos never point at futbollibreliga.online (301 → an HTML page); ESPN 3 draws ESPN 3", async () => {
  await device({ noFetch: true });
  const page = await P.liveChannels({ categoryId: "futbollibre." + hex("main"), cursor: null });
  const items = Array.isArray(page) ? page : page.items;
  assert.equal(items.length, 19);
  for (const c of items) {
    assert.ok(c.logo, c.title + " has a logo");
    assert.ok(!/futbollibreliga\.online/.test(c.logo), c.title + ": " + c.logo);
    assert.match(c.logo, /^https:\/\//);
  }
  const logo = (t) => items.find((c) => c.title === t).logo;
  assert.equal(logo("ESPN"), "https://verfutbol.pro/img/channels/espn-1.webp");
  assert.equal(logo("Fox Sports Premium"), "https://verfutbol.pro/img/channels/fox-sports-premium.webp");
  assert.equal(logo("TUDN México"), "https://verfutbol.pro/img/channels/tudn-mx.webp");
  assert.equal(logo("ESPN 3"), "https://futbollibregol.org/img/logo-canal/espn_3.webp");
});

test("BUG-3: the agenda's first backup is asked at verfutbol.pro (where futbollibreliga.online moved)", async () => {
  const ev = { title: "Liga MX: América vs Chivas", date: "2030-01-01", time: "20:00", embeds: [{ iframe: "https://tvf90.com/5.php?stream=espn" }] };
  const k = await device({ routes: [(url) => {
    if (url === "https://api.wqxag.com/diaries.json") return res(500, "");
    if (url === "https://verfutbol.pro/api/agenda") return res(200, JSON.stringify({ events: [ev] }), { "content-type": "application/json" });
    return undefined;
  }] });
  const page = await P.liveChannels({ categoryId: "futbollibre." + hex("hoy"), cursor: null });
  const items = Array.isArray(page) ? page : page.items;
  assert.ok(k.requests.some((r) => r.url === "https://verfutbol.pro/api/agenda"));
  assert.ok(!k.requests.some((r) => /futbollibreliga\.online/.test(r.url)));
  assert.equal(items.length, 1);
  assert.match(items[0].title, /América vs Chivas/);
});

// ═════════════════ BUG-4: TS streams handed to Kino as HLS ═════════════════

test("BUG-4: premiumtv's Astra `/play/<id>` addresses (MPEG-TS) go as video/mp2t, not HLS; others unchanged, 0 requests", async () => {
  const k = await device({ noFetch: true });
  const mimeOf = async (url) => (await P.resolve(liveRef("premiumtv", url))).mime;
  assert.equal(await mimeOf("http://181.225.190.242/play/a03r"), "video/mp2t", "Win Sports HD (premiumtv)");
  assert.equal(await mimeOf("http://45.167.1.139:8000/play/CARACOL_HD_2"), "video/mp2t");
  assert.equal(await mimeOf("http://38.65.175.87:8000/play/a0fl/index.m3u8"), "application/vnd.apple.mpegurl", "Astra's own HLS");
  assert.equal(await mimeOf("https://jmp2.uk/stvp-MX1000001"), "application/vnd.apple.mpegurl", "an https redirect to HLS stays HLS");
  assert.equal(await mimeOf("https://x.example/live/index.m3u8?token=a.ts"), "application/vnd.apple.mpegurl");
  assert.equal(await mimeOf("http://190.104.15.135/0.ts"), "video/mp2t");
  assert.equal(await mimeOf("https://x.example/a/manifest.mpd"), "application/dash+xml");
  assert.equal(k.requests.length, 0);
});

// ═════════════════ BUG-6: cncverse handed a copy its own probe saw refused ═════════════════

const CNC = "https://cncverse.dpdns.org/u/p_48sfkwcafx1s";
function cncStreams(id, streams, copies) {
  return (url) => {
    if (url === `${CNC}/stream/tv/${encodeURIComponent(id)}.json`) return res(200, JSON.stringify({ streams }));
    for (const [prefix, answer] of Object.entries(copies)) if (url.startsWith(prefix)) return typeof answer === "function" ? answer() : answer;
    return undefined;
  };
}

test("BUG-6: every copy refused (403 by geo, 404 gone) → a clear 'no copy' error in ES and EN, not a dead URL", async () => {
  const streams = [{ url: "https://tencent-cdn.tapmad.example/a.m3u8" }, { url: "https://live.msnetworks.example/b.m3u8" }, { url: "https://tencent-cdn.tapmad.example/c.m3u8" }];
  const copies = { "https://tencent-cdn.tapmad.example/": res(403, ""), "https://live.msnetworks.example/": res(404, "") };
  const k = await device({ routes: [cncStreams("cnc:pak-sl", streams, copies)] });
  await assert.rejects(P.resolve(liveRef("cncverse", "cnc:pak-sl")),
    (e) => /ninguna copia de este evento/.test(e.message) && e.userMessage === "Ninguna copia de este evento abre desde tu red ahora mismo.");
  assert.equal(k.requests.filter((r) => /\.m3u8$/.test(r.url)).length, 3, "each copy probed once");
  k.kino.lang = "en";
  await assert.rejects(P.resolve(liveRef("cncverse", "cnc:pak-sl")),
    (e) => /no copy of this event/.test(e.message) && e.userMessage === "No copy of this event opens from your network right now.");
  k.kino.lang = "es";
});

test("BUG-6: a copy that answers wins; else one that could not be told (timeout, 5xx) goes before a refused one", async () => {
  const streams = [{ url: "https://a.example/1.m3u8" }, { url: "https://b.example/2.m3u8" }, { url: "https://c.example/3.m3u8" }];
  await device({ routes: [cncStreams("cnc:ok", streams, {
    "https://a.example/": res(403, ""), "https://b.example/": res(200, "#EXTM3U\n#EXT-X-VERSION:3\n"), "https://c.example/": res(200, "#EXTM3U\n"),
  })] });
  assert.equal((await P.resolve(liveRef("cncverse", "cnc:ok"))).url, "https://b.example/2.m3u8");
  await device({ routes: [cncStreams("cnc:slow", streams, {
    "https://a.example/": res(404, ""), "https://b.example/": () => Object.assign(new Error("timeout"), { code: "timeout" }), "https://c.example/": res(503, ""),
  })] });
  assert.equal((await P.resolve(liveRef("cncverse", "cnc:slow"))).url, "https://b.example/2.m3u8", "the first copy that may still open");
});

// ═════════════════ BUG-2 + PERF-2: xuper refused by its portal on every try ═════════════════

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHERS = ["premiumtv", "supertv", "deportv", "cncverse"];   // the other network sources: categories stored, fresh

/** Storage where only xuper has no categories, with its failure meta `x` (`{ failAt, failN, v }`). */
function xuperFailing(x) {
  const now = Date.now();
  const lc = { v: 1, src: {} };
  const lm = { v: 1, c: {}, l: {} };
  for (const s of OTHERS) { lc.src[s] = { at: now, cats: [{ id: "g", title: "G" }] }; lm.c[s] = { at: now, failAt: 0, failN: 0 }; }
  lm.c.xuper = { at: 0, ...x };
  return {
    "o2:lc": JSON.stringify(lc), "o2:lm": JSON.stringify(lm),
    "o2:xcfg": JSON.stringify({ magisKey: KEY, email: "shared@test", password: "pw", at: now }),
  };
}
const portalRefuses = (url) => (/\/api\/portalCore\//.test(url) ? res(200, JSON.stringify({ returnCode: "portal200001", errorMessage: "版本已停止使用" })) : undefined);
const portalCalls = (k) => k.requests.filter((r) => /\/api\/portalCore\//.test(r.url)).length;
const xuperMeta = (k) => JSON.parse(k.store.get("o2:lm")).c.xuper;

test("BUG-2: the log names the portal's refusal (code and its own text), so a dead app version is told from a bad key", async () => {
  const k = await device({ storage: xuperFailing({ failAt: 0, failN: 0 }), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 1, "the first portal call (v3/snToken) is refused");
  const line = k.logs.find((l) => /xuper: categories failed/.test(l));
  assert.ok(line, "logged");
  assert.match(line, /portal200001 \(版本已停止使用\)/);
});

test("PERF-2: a source that keeps failing is asked less and less often (10 → 30 → 60 min); a new plugin version starts over", async () => {
  const at = (minAgo, failN, v = PLUGIN_VERSION) => xuperFailing({ failAt: Date.now() - minAgo * M, failN, v });
  // one failure 11 min ago: past its 10 min → asked again, fails again (2 in a row)
  let k = await device({ storage: at(11, 1), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 1);
  assert.equal(xuperMeta(k).failN, 2);
  assert.ok(k.logs.some((l) => /next try in 30 min/.test(l)));
  // two in a row, 11 min ago: inside 30 min → no request, no write
  k = await device({ storage: at(11, 2), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 0, "inside the 30 min backoff");
  // two in a row, 31 min ago: asked again → three in a row
  k = await device({ storage: at(31, 2), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 1);
  assert.equal(xuperMeta(k).failN, 3);
  // three in a row, 31 min ago: inside 60 min
  k = await device({ storage: at(31, 3), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 0, "inside the 60 min backoff");
  // a long run of failures caps at 3 h
  k = await device({ storage: at(179, 9), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 0);
  k = await device({ storage: at(181, 9), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 1);
  // the count of an older plugin version: back to 10 min
  k = await device({ storage: at(11, 3, "0.0.1"), routes: [portalRefuses] });
  await P.liveCategories();
  assert.equal(portalCalls(k), 1, "a new version may carry the fix");
  assert.equal(xuperMeta(k).failN, 1);
});

// ═════════════════ BUG-9: the search export read `query.text`, Kino sends `query.q` ═════════════════

test("BUG-9: search reads Kino's `q` (KinoSearchQuery) and asks the backend once; an empty `q` asks nothing", async () => {
  const asked = [];
  const route = (url) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    asked.push(path);
    if (path.startsWith("/search?q=")) {
      return res(200, JSON.stringify({ resourceResult: { list: [{ id: 101, name: "Matrix", type: 1, poster: "https://img.example/m.jpg" }] } }));
    }
    return res(404, "");
  };
  await device({ routes: [route] });
  const q = { q: "Matrix", type: "any", year: 0, season: 0, episode: 0, tmdbId: 0, originalTitle: "", altTitles: [], cursor: null };
  const items = await P.search(q);
  assert.equal(asked.filter((p) => p.startsWith("/search?q=Matrix")).length, 1, `asked: ${JSON.stringify(asked)}`);
  assert.ok(Array.isArray(items));
  asked.length = 0;
  assert.deepEqual(await P.search({ ...q, q: "  " }), []);
  assert.equal(asked.length, 0);
});
