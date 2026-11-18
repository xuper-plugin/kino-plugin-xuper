import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const { beginCall } = await import("../src/flight.js");
const data = await import("../src/data.js");
const { fromLegacyHome, fromLegacyMatches, seal } = await import("../src/v2.js");
const { DATA_BASE, RELEASE_BASE } = await import("../src/config.js");
const catalogMod = await import("../src/catalog.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const legacy = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));
const legacyText = (gen = 1794844780749) => JSON.stringify({ ...legacy, generatedAt: gen });
const legacyMatches = { version: 1, generatedAt: 1794838230926, matches: [
  { matchName: "UEFA Nations League", gameTime: "2026-11-16 15:00", channelName: "FOX", team_a: { teamName: "A" }, team_b: { teamName: "B" } },
] };
const v2Of = (gen = 1794844780749) => seal(fromLegacyHome(legacy, { poster: "recommended" }), gen, sha256);
const REL_HOME = RELEASE_BASE + "/home.json";
const REL_MATCHES = RELEASE_BASE + "/matches.json";
const INDEX = DATA_BASE + "index.json";

/** A fresh device: new storage, cold runtime (no L0), a new call. */
function device(opts) {
  const k = installKino(opts);
  data._resetMemory();
  beginCall();
  return k;
}
const call = () => beginCall();
const count = (requests, url) => requests.filter((r) => r.url === url).length;

// Routes: index 404 (phase 1), Release answers 200 or 304 by ETag.
function phase1Routes({ etag = '"e1"', body = legacyText(), matchesBody = JSON.stringify(legacyMatches), fail = false } = {}) {
  return [
    (url) => (url === INDEX ? res(404, "") : undefined),
    (url, init) => {
      if (url !== REL_HOME) return undefined;
      if (fail) return res(503, "");
      if (init.headers && init.headers["If-None-Match"] === etag) return res(304, "");
      return res(200, body, { ETag: etag }, { binary: true });
    },
    (url) => (url === REL_MATCHES ? (fail ? res(503, "") : res(200, matchesBody, { ETag: '"m1"' }, { binary: true })) : undefined),
  ];
}

test("phase 1: index 404 → missingUntil 6 h → Release; text written before meta; native decode", async () => {
  const { requests, writes, store, kino } = device({ routes: phase1Routes() });
  const r = await data.revalidate({ catalog: true, matches: true });
  assert.equal(r.changed, true);
  assert.equal(count(requests, INDEX), 1, "one index probe for both parts");
  assert.equal(count(requests, REL_HOME), 1);
  assert.equal(count(requests, REL_MATCHES), 1);
  assert.ok(writes.indexOf("o2:cat") < writes.indexOf("o2:catm"), "data text first, then meta");
  const ixm = JSON.parse(store.get("o2:ixm"));
  assert.ok(ixm.missingUntil - Date.now() > 5.9 * 3600000);
  const catm = JSON.parse(store.get("o2:catm"));
  assert.equal(catm.src, "rel");
  assert.equal(catm.etag, '"e1"');
  assert.equal(catm.h, v2Of().hash);
  assert.ok(kino.crypto.convertCalls >= 2, "octet-stream bodies decoded with crypto.convert");
  assert.equal(data.catalog().hash, catm.h);
  assert.equal(data.matches().matches.length, 1);
  assert.ok([...store.values()].every((v) => v !== "[object Object]"));
  for (const k of ["o2:cat", "o2:catm", "o2:mat", "o2:matm", "o2:ixm"]) JSON.parse(store.get(k));
});

test("a cold runtime with storage makes 0 requests (reads and revalidation within TTL)", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true, matches: true });
  const storage = Object.fromEntries(first.store);
  const { requests } = device({ storage, noFetch: true });
  assert.ok(data.catalog(), "catalog from L1 with no network");
  assert.ok(data.matches());
  const r = await data.revalidate({ catalog: true, matches: true });
  assert.equal(r.changed, false);
  assert.equal(requests.length, 0);
  call();
  const rows = await catalogMod.home();
  assert.equal(rows.length, 1, "the reduced fixture has one non-adult section");
  assert.equal(requests.length, 0);
});

test("due + unchanged: conditional request → 304, checkedAt moves, o2:cat is not rewritten", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(first.store);
  const m = JSON.parse(storage["o2:catm"]); m.checkedAt = Date.now() - 2 * 3600000; storage["o2:catm"] = JSON.stringify(m);
  const { requests, writes, store } = device({ storage, routes: phase1Routes() });
  const r = await data.revalidate({ catalog: true });
  assert.equal(r.changed, false);
  assert.equal(count(requests, INDEX), 0, "index skipped while missingUntil is ahead");
  assert.equal(requests[0].headers["If-None-Match"], '"e1"');
  assert.ok(!writes.includes("o2:cat"));
  assert.ok(JSON.parse(store.get("o2:catm")).checkedAt > m.checkedAt);
});

test("a 200 with the same content (new ETag/generatedAt) does not rewrite o2:cat", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(first.store);
  const { writes, store } = device({ storage, routes: phase1Routes({ etag: '"e2"', body: legacyText(1794844780749 + 1000) }) });
  const r = await data.revalidate({ catalog: true, force: true });
  assert.equal(r.changed, false);
  assert.ok(!writes.includes("o2:cat"), "hash unchanged → no set of o2:cat");
  const catm = JSON.parse(store.get("o2:catm"));
  assert.equal(catm.etag, '"e2"');
  assert.equal(catm.gen, 1794844780749 + 1000);
});

test("stale-if-error: a failing Release keeps the stored copy and backs off", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(first.store);
  const m = JSON.parse(storage["o2:catm"]); m.checkedAt = 1; storage["o2:catm"] = JSON.stringify(m);
  const { requests, store } = device({ storage, routes: phase1Routes({ fail: true }) });
  await data.revalidate({ catalog: true });
  assert.equal(count(requests, REL_HOME), 1);
  assert.ok(data.catalog(), "last-good still served");
  const after = JSON.parse(store.get("o2:catm"));
  assert.equal(after.failN, 1);
  call();
  await data.revalidate({ catalog: true });
  assert.equal(count(requests, REL_HOME), 1, "inside the backoff: no new request");
});

test("nothing stored and everything failing → home() and browse() reject (never [])", async () => {
  device({ routes: [() => res(503, "")] });
  await assert.rejects(() => catalogMod.home());
  call();
  await assert.rejects(() => catalogMod.browse("cat:pelicula", null));
  assert.equal(data.catalog(), null);
});

test("browse with nothing stored revalidates once, then serves pages of 100", async () => {
  const { requests } = device({ routes: phase1Routes() });
  const page = await catalogMod.browse("cat:populares", null);
  assert.equal(page.items.length, 28);
  assert.equal(page.next, null);
  assert.equal(count(requests, REL_HOME), 1);
});

test("phase 2: index 200 → hashed part fetched once, then a 304 keeps it; a new h fetches only that part", async () => {
  const v = v2Of();
  const h = v.hash.slice(0, 12);
  let indexEtag = '"i1"';
  let index = { schema: 2, minPlugin: "1.0.44", gen: 1, probeS: 300, catalog: { h, n: 1 } };
  const routes = [
    (url, init) => {
      if (url !== INDEX) return undefined;
      if (init.headers["If-None-Match"] === indexEtag) return res(304, "");
      return res(200, JSON.stringify(index), { ETag: indexEtag, "content-type": "text/plain; charset=utf-8" });
    },
    (url) => (url === DATA_BASE + "v2/c/" + h + ".json" ? res(200, JSON.stringify(v), { "content-type": "text/plain; charset=utf-8" }) : undefined),
  ];
  const { requests, store } = device({ routes });
  let r = await data.revalidate({ catalog: true });
  assert.equal(r.changed, true);
  assert.equal(count(requests, INDEX), 1);
  assert.equal(count(requests, REL_HOME), 0, "the Release is never touched in phase 2");
  assert.equal(JSON.parse(store.get("o2:catm")).src, "raw");
  // due again: the index answers 304 → nothing else
  const ixm = JSON.parse(store.get("o2:ixm")); ixm.checkedAt = 1; store.set("o2:ixm", JSON.stringify(ixm));
  call();
  r = await data.revalidate({ catalog: true });
  assert.equal(r.changed, false);
  assert.equal(count(requests, INDEX), 2);
  assert.equal(requests.at(-1).headers["If-None-Match"], '"i1"');
  assert.equal(requests.length, 3);
  // the publisher changed the catalog: new h, new index ETag
  const changedBody = fromLegacyHome(legacy, { poster: "recommended" });
  changedBody.items[0].title = "Changed";
  const sealed = seal(changedBody, 1794844780749 + 5000, sha256);   // a newer generation
  const h2 = sealed.hash.slice(0, 12);
  index = { ...index, catalog: { h: h2, n: 1 } };
  indexEtag = '"i2"';
  routes.push((url) => (url === DATA_BASE + "v2/c/" + h2 + ".json" ? res(200, JSON.stringify(sealed)) : undefined));
  const ixm2 = JSON.parse(store.get("o2:ixm")); ixm2.checkedAt = 1; store.set("o2:ixm", JSON.stringify(ixm2));
  call();
  r = await data.revalidate({ catalog: true });
  assert.equal(r.changed, true);
  assert.equal(data.catalog().items[0].title, "Changed");
});

test("phase 2: a part whose hash does not match is refused (stored copy kept)", async () => {
  const v = v2Of();
  const h = v.hash.slice(0, 12);
  const tampered = { ...v, items: v.items.map((it, i) => (i === 0 ? { ...it, title: "tampered" } : it)) };
  const routes = [
    (url) => (url === INDEX ? res(200, JSON.stringify({ schema: 2, probeS: 300, catalog: { h } })) : undefined),
    (url) => (url.includes("/v2/c/") ? res(200, JSON.stringify(tampered)) : undefined),
    (url) => (url === REL_HOME ? res(200, legacyText(), { ETag: '"e1"' }, { binary: true }) : undefined),
  ];
  const { requests } = device({ routes });
  await data.revalidate({ catalog: true });
  assert.notEqual(data.catalog().items[0].title, "tampered");
  assert.equal(count(requests, REL_HOME), 1, "nothing stored → the Release fills in");
});

test("an index error with a fresh copy stored makes no Release request (the Release's own TTL gates it)", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(first.store);
  storage["o2:ixm"] = JSON.stringify({ checkedAt: 1 });   // index no longer "missing"
  const { requests, store } = device({ storage, routes: [() => res(500, "")] });
  await data.revalidate({ catalog: true });
  assert.equal(count(requests, INDEX), 1);
  assert.equal(count(requests, REL_HOME), 0);
  assert.equal(JSON.parse(store.get("o2:ixm")).failN, 1);
});

// ── raw.githubusercontent.com failing with something other than a 404 (cache-1, regression-2) ──

const TIMEOUT = () => Object.assign(new Error("timeout"), { code: "timeout" });
/** raw times out; the Release serves `rel.body` with `rel.etag` (304 to a matching If-None-Match). */
function rawDownRoutes(rel) {
  return [
    (url) => (url.startsWith(DATA_BASE) ? TIMEOUT() : undefined),
    (url, init) => {
      if (url !== REL_HOME) return undefined;
      if (init.headers && init.headers["If-None-Match"] === rel.etag) return res(304, "");
      return res(200, rel.body, { ETag: rel.etag }, { binary: true });
    },
  ];
}
const newerHome = (gen, row) => { const j = JSON.parse(legacyText(gen)); j.sections.populares.rows.recommendList[0].name = row; return JSON.stringify(j); };
const firstRail = () => data.catalog().sections.populares.rails[0].title;
const age = (store, key, field, ms) => { const m = JSON.parse(store.get(key)); m[field] = Date.now() - ms; store.set(key, JSON.stringify(m)); };

test("raw keeps failing (timeout, not 404): the stored Release copy is still revalidated after its TTL, and a reload reaches it at once", async () => {
  const rel = { body: legacyText(), etag: '"e1"' };
  const first = device({ routes: rawDownRoutes(rel) });
  await data.revalidate({ catalog: true });
  assert.equal(JSON.parse(first.store.get("o2:catm")).src, "rel", "first install: raw failed, the Release filled in");
  rel.body = newerHome(1794844780749 + 5000, "Newer row"); rel.etag = '"e2"';

  // within the Release TTL: the copy is served, the Release is not asked
  let k = device({ storage: Object.fromEntries(first.store), routes: rawDownRoutes(rel) });
  age(k.store, "o2:ixm", "failAt", 2 * 3600000);   // the index probe is due again (and fails again)
  await data.revalidate({ catalog: true });
  assert.equal(count(k.requests, REL_HOME), 0);
  assert.notEqual(firstRail(), "Newer row");

  // past the Release TTL (60 min): unforced, the Release answers with the newer copy
  age(k.store, "o2:catm", "checkedAt", 2 * 3600000);
  age(k.store, "o2:ixm", "failAt", 2 * 3600000);
  k = device({ storage: Object.fromEntries(k.store), routes: rawDownRoutes(rel) });
  const r = await data.revalidate({ catalog: true });
  assert.equal(count(k.requests, INDEX), 1);
  assert.equal(count(k.requests, REL_HOME), 1);
  assert.equal(k.requests.find((x) => x.url === REL_HOME).headers["If-None-Match"], '"e1"');
  assert.equal(r.changed, true);
  assert.equal(firstRail(), "Newer row");

  // a person's reload: the Release at once, although its TTL is not due
  rel.body = newerHome(1794844780749 + 9000, "Reloaded row"); rel.etag = '"e3"';
  k = device({ storage: Object.fromEntries(k.store), routes: rawDownRoutes(rel) });
  await data.revalidate({ catalog: true, force: true });
  assert.equal(count(k.requests, REL_HOME), 1);
  assert.equal(firstRail(), "Reloaded row");
});

test("phase 2 (an index stored): a raw blip serves last-good; the 3rd failed probe in a row consults the Release", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(first.store);
  const h12 = JSON.parse(storage["o2:catm"]).h.slice(0, 12);
  storage["o2:ix"] = JSON.stringify({ schema: 2, probeS: 300, catalog: { h: h12 } });
  const m = JSON.parse(storage["o2:catm"]); m.checkedAt = 1; storage["o2:catm"] = JSON.stringify(m);   // Release TTL due
  for (const [failN, release] of [[0, 0], [1, 0], [2, 1]]) {
    storage["o2:ixm"] = JSON.stringify({ checkedAt: 1, failN, failAt: 0 });
    const k = device({ storage, routes: [(url) => (url === INDEX ? res(500, "") : undefined), ...phase1Routes().slice(1)] });
    await data.revalidate({ catalog: true });
    assert.equal(count(k.requests, INDEX), 1);
    assert.equal(count(k.requests, REL_HOME), release, "after " + (failN + 1) + " failed probes");
    assert.equal(JSON.parse(k.store.get("o2:ixm")).failN, failN + 1);
  }
  // and a person's reload goes to the Release after a single failure
  storage["o2:ixm"] = JSON.stringify({ checkedAt: 1, failN: 0, failAt: 0 });
  const k = device({ storage, routes: [(url) => (url === INDEX ? res(500, "") : undefined), ...phase1Routes().slice(1)] });
  await data.revalidate({ catalog: true, force: true });
  assert.equal(count(k.requests, REL_HOME), 1);
});

// ── a publisher revert (cache-2): the file the index names wins, whatever its gen ──

test("phase 2: X → Y → X again (the reused file keeps its old gen): the device stores X and stops fetching", async () => {
  const body = (row) => { const b = fromLegacyHome(legacy, { poster: "recommended" }); b.sections.populares.rails[0].title = row; return b; };
  const X = seal(body("Row X"), 1000, sha256), Y = seal(body("Row Y"), 2000, sha256);
  const hx = X.hash.slice(0, 12), hy = Y.hash.slice(0, 12);
  let current = hx;
  const routes = [
    (url, init) => {
      if (url !== INDEX) return undefined;
      const etag = '"' + current + '"';
      if (init.headers["If-None-Match"] === etag) return res(304, "");
      return res(200, JSON.stringify({ schema: 2, probeS: 300, catalog: { h: current } }), { ETag: etag });
    },
    (url) => (url === DATA_BASE + "v2/c/" + hx + ".json" ? res(200, JSON.stringify(X)) : undefined),
    (url) => (url === DATA_BASE + "v2/c/" + hy + ".json" ? res(200, JSON.stringify(Y)) : undefined),
  ];
  const k = device({ routes });
  const due = () => { const ixm = JSON.parse(k.store.get("o2:ixm")); ixm.checkedAt = 1; k.store.set("o2:ixm", JSON.stringify(ixm)); };
  await data.revalidate({ catalog: true });
  assert.equal(firstRail(), "Row X");
  current = hy; due(); call();
  await data.revalidate({ catalog: true });
  assert.equal(firstRail(), "Row Y");
  current = hx; due(); call();
  const r = await data.revalidate({ catalog: true });
  assert.equal(r.changed, true);
  assert.equal(firstRail(), "Row X", "the reverted file is stored although its gen (1000) is older than Y's (2000)");
  assert.equal(JSON.parse(k.store.get("o2:catm")).h, X.hash);
  // the next calls (probe not due): nothing more is downloaded
  const n = k.requests.length;
  for (let i = 0; i < 3; i++) { call(); await data.revalidate({ catalog: true }); }
  assert.equal(k.requests.length, n);
});

test("a refused file is not fetched on every call: it waits out the backoff (failH)", async () => {
  const v = v2Of();
  const h = v.hash.slice(0, 12);
  // another runtime commits a different copy while this call downloads (the timed-out-runtime race)
  const routes = [
    (url) => (url === INDEX ? res(200, JSON.stringify({ schema: 2, probeS: 300, catalog: { h } })) : undefined),
    (url) => {
      if (!url.includes("/v2/c/")) return undefined;
      globalThis.kino.storage.set("o2:catm", JSON.stringify({ h: "ffffffffffffffff", gen: 1, writtenAt: Date.now() + 5, checkedAt: Date.now() }));
      return res(200, JSON.stringify(v));
    },
  ];
  const k = device({ routes });
  await data.revalidate({ catalog: true });
  const catm = JSON.parse(k.store.get("o2:catm"));
  assert.equal(catm.h, "ffffffffffffffff", "the newer write of the other runtime stays");
  assert.equal(catm.failH, h);
  assert.ok(k.logs.some((l) => /another runtime stored a newer copy/.test(l)));
});

// ── storage refusing the text (cache-6): the meta never moves ahead of the stored text ──

test("o2:cat refused (storage full) while its meta fits: hash and ETag stay, so the next revalidation downloads again", async () => {
  const rel = { body: legacyText(), etag: '"v1"' };
  const routes = [(url) => (url === INDEX ? res(404, "") : undefined), ...rawDownRoutes(rel).slice(1)];
  const first = device({ routes });
  await data.revalidate({ catalog: true });
  const h1 = JSON.parse(first.store.get("o2:catm")).h;
  rel.body = newerHome(1794844780749 + 1, "Title v2"); rel.etag = '"v2"';
  let k = device({ storage: Object.fromEntries(first.store), routes });
  const realSet = k.kino.storage.set;
  k.kino.storage.set = (key, val) => {
    if (key === "o2:cat") throw Object.assign(new Error("plugin storage full (16 MB)"), { code: "too_large" });
    return realSet(key, val);
  };
  await data.revalidate({ catalog: true, force: true });
  const catm = JSON.parse(k.store.get("o2:catm"));
  assert.equal(catm.h, h1, "the meta keeps the hash of the text actually stored");
  assert.equal(catm.etag, '"v1"', "and its validator: a 304 can never confirm the copy that was not stored");
  assert.equal(catm.failN, 1);
  assert.notEqual(firstRail(), "Title v2");
  // storage has room again: the next due revalidation sends the OLD validator and gets the new copy
  k.kino.storage.set = realSet;
  age(k.store, "o2:catm", "failAt", 2 * 3600000);
  age(k.store, "o2:catm", "checkedAt", 2 * 3600000);
  k = device({ storage: Object.fromEntries(k.store), routes });
  await data.revalidate({ catalog: true });
  assert.equal(k.requests.find((x) => x.url === REL_HOME).headers["If-None-Match"], '"v1"');
  assert.equal(firstRail(), "Title v2");
});

test("nothing stored and the text refused: this runtime keeps the new copy in memory; a cold one downloads again", async () => {
  const k = device({ routes: phase1Routes() });
  const realSet = k.kino.storage.set;
  k.kino.storage.set = (key, val) => {
    if (key === "o2:cat") throw Object.assign(new Error("too large"), { code: "too_large" });
    return realSet(key, val);
  };
  await data.revalidate({ catalog: true });
  assert.ok(data.catalog(), "served from memory in this runtime");
  assert.equal(k.store.get("o2:cat"), undefined);
  k.kino.storage.set = realSet;
  data._resetMemory();
  call();
  assert.equal(data.catalog(), null, "a cold runtime has nothing to serve");
  const m = JSON.parse(k.store.get("o2:catm") || "{}");
  age(k.store, "o2:catm", "failAt", 2 * 3600000);
  await data.revalidate({ catalog: true });
  assert.ok(data.catalog());
  assert.ok(k.store.get("o2:cat"));
  assert.ok(!m.h, "no hash was ever recorded for the text that was not stored");
});

// ── a clock that ran ahead and was set back (cache-7) ──

test("stamps in the future (clock set back): the catalog counts as due and is revalidated, not frozen", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true, matches: true });
  const storage = Object.fromEntries(first.store);
  const ahead = Date.now() + 30 * 24 * 3600000;
  for (const key of ["o2:catm", "o2:matm"]) { const m = JSON.parse(storage[key]); m.checkedAt = ahead; m.writtenAt = ahead; storage[key] = JSON.stringify(m); }
  const ixm = JSON.parse(storage["o2:ixm"]); ixm.missingUntil = ahead; storage["o2:ixm"] = JSON.stringify(ixm);
  const { requests } = device({ storage, routes: phase1Routes() });
  await data.revalidate({ catalog: true, matches: true });
  assert.equal(count(requests, INDEX), 1, "a missingUntil 30 d ahead is not trusted (6 h at most)");
  assert.equal(count(requests, REL_HOME), 1, "a checkedAt in the future reads as due");
  assert.equal(count(requests, REL_MATCHES), 1);
});

test("index: a bad h, a higher minPlugin or another schema make it unusable → Release", async () => {
  for (const index of [
    { schema: 2, catalog: { h: "../../evil" } },
    { schema: 2, minPlugin: "9.0.0", catalog: { h: "0123456789ab" } },
    { schema: 3, catalog: { h: "0123456789ab" } },
  ]) {
    const { requests } = device({ routes: [
      (url) => (url === INDEX ? res(200, JSON.stringify(index)) : undefined),
      ...phase1Routes().slice(1),
    ] });
    await data.revalidate({ catalog: true });
    assert.ok(!requests.some((r) => r.url.includes("/v2/")), "no URL built from an unchecked h");
    assert.equal(count(requests, REL_HOME), 1);
    assert.ok(data.catalog());
  }
});

test("stale-write guard: never write older data over newer", async () => {
  const first = device({ routes: phase1Routes() });
  await data.revalidate({ catalog: true });
  const storage = Object.fromEntries(first.store);
  const m = JSON.parse(storage["o2:catm"]); m.gen = 9e15; m.checkedAt = 1; storage["o2:catm"] = JSON.stringify(m);
  const older = JSON.parse(legacyText(1)); older.sections.populares.rows.recommendList[0].name = "Older row";
  const { writes } = device({ storage, routes: phase1Routes({ etag: '"old"', body: JSON.stringify(older) }) });
  await data.revalidate({ catalog: true });
  assert.ok(!writes.includes("o2:cat"));
  assert.notEqual(data.catalog().sections.populares.rails[0].title, "Older row");
});

test("single-flight: one call with home + browse revalidates once", async () => {
  const { requests } = device({ routes: phase1Routes() });
  await Promise.all([data.revalidate({ catalog: true }), data.revalidate({ catalog: true })]);
  assert.equal(count(requests, REL_HOME), 1);
});

test("dataAges reports checkedAt/gen per part, null when nothing stored", async () => {
  device({ routes: phase1Routes() });
  assert.deepEqual(data.dataAges(), { catalog: null, matches: null });
  await data.revalidate({ catalog: true, matches: true });
  const a = data.dataAges();
  assert.equal(a.catalog.gen, 1794844780749);
  assert.equal(a.matches.gen, 1794838230926);
  assert.ok(a.catalog.checkedAt > 0);
  assert.equal(a.catalog.src, "rel");
});

test("matches converted from the legacy Release are valid v2", async () => {
  device({ routes: phase1Routes() });
  await data.revalidate({ matches: true });
  assert.deepEqual(data.matches().matches, fromLegacyMatches(legacyMatches).matches);
});
