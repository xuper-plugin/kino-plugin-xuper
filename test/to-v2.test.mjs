// The publisher's v2 builder (tools/to-v2.mjs): deterministic output, the same hash the device computes, the
// validator's refusals, and a round trip through the device's own revalidation (src/data.js) with a fake kino.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const T = await import("../tools/to-v2.mjs");
const V2 = await import("../src/v2.js");
const data = await import("../src/data.js");
const { beginCall } = await import("../src/flight.js");
const { DATA_BASE, RELEASE_BASE } = await import("../src/config.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const fixture = (name) => JSON.parse(readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8"));
const home = fixture("home.reduced.json");
const matches = fixture("matches.reduced.json");
const TOOL = fileURLToPath(new URL("../tools/to-v2.mjs", import.meta.url));
// The release assets as published (home.json, matches.json), e.g. a download of the catalog Release: XUPER_PUBLISHED_DIR.
const GH = process.env.XUPER_PUBLISHED_DIR || join(tmpdir(), "xuper-published");
const tmp = () => mkdtempSync(join(tmpdir(), "xuper-tov2-"));
const listFiles = (dir, base = "") => readdirSync(join(dir, base), { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? listFiles(dir, join(base, e.name)) : [join(base, e.name)]).sort();
const withoutGen = (ix) => { const o = { ...ix }; delete o.gen; return o; };

test("deterministic: the same legacy input gives the same payload bytes, names and index (but gen)", () => {
  const a = T.toV2({ home, matches, gen: 1 });
  const b = T.toV2({ home: JSON.parse(JSON.stringify(home)), matches: JSON.parse(JSON.stringify(matches)), gen: 2 });
  assert.equal(a.ok, true, a.problems.join("; "));
  assert.deepEqual(a.files, b.files);
  assert.deepEqual(withoutGen(a.index), withoutGen(b.index));
  assert.notEqual(a.index.gen, b.index.gen);
  const cat = JSON.parse(a.files[0].text);
  assert.equal(a.files[0].path, `v2/c/${cat.hash.slice(0, 12)}.json`);
  assert.equal(a.index.catalog.h, cat.hash.slice(0, 12));
  assert.equal(a.index.catalog.n, Buffer.byteLength(a.files[0].text));
  assert.equal(cat.gen, home.generatedAt, "payload gen = the legacy generatedAt (stable input → stable bytes)");
  assert.deepEqual(a.index.live, { off: [] });
  assert.equal(a.index.minPlugin, "3.0.0", "the first Xuper that reads the data branch");
  assert.equal(a.index.probeS, 300);
  assert.equal(a.index.schema, 2);
});

test("a regenerated legacy file with the same content (new generatedAt) keeps the hash", () => {
  const a = T.toV2({ home, matches });
  const b = T.toV2({ home: { ...home, generatedAt: home.generatedAt + 3600000 }, matches: { ...matches, generatedAt: 7 } });
  assert.equal(a.index.catalog.h, b.index.catalog.h);
  assert.equal(a.index.matches.h, b.index.matches.h);
});

test("the publisher's hash equals what a device computes from the same Release file (phase 1 → 2 rewrites nothing)", () => {
  const a = T.toV2({ home, matches });
  const device = V2.seal(V2.fromLegacyHome(home, { poster: "recommended" }), Number(home.generatedAt), sha256);
  assert.equal(JSON.parse(a.files[0].text).hash, device.hash);
  assert.equal(a.files[0].text, JSON.stringify(device));
  const dm = V2.seal(V2.fromLegacyMatches(matches), Number(matches.generatedAt), sha256);
  assert.equal(a.files[1].text, JSON.stringify(dm));
});

test("matches: legacy-only fields are dropped, http crests left out, no kickoff written", () => {
  const m = JSON.parse(T.toV2({ home, matches }).files[1].text);
  assert.equal(m.matches.length, matches.matches.length);
  const s = JSON.stringify(m);
  for (const k of ["gameState", "score", "channelCode", "matchLogo", "kickoff", "http:"]) assert.ok(!s.includes(k), k);
  assert.equal(m.matches[1].a.l, undefined, "Iceland's crest is http: left out");
  assert.equal(m.matches[4].title, "Final sin equipos");
});

test("CLI: two runs write byte-identical payloads; the index differs only in gen", () => {
  const out1 = tmp(), out2 = tmp(), quiet = () => {};
  try {
    const args = (out, gen) => ["--home", fileURLToPath(new URL("./fixtures/home.reduced.json", import.meta.url)),
      "--matches", fileURLToPath(new URL("./fixtures/matches.reduced.json", import.meta.url)), "--out", out, "--gen", String(gen)];
    const log = console.log; console.log = quiet;
    try {
      assert.equal(T.main(args(out1, 100), {}), 0);
      assert.equal(T.main(args(out2, 200), {}), 0);
    } finally { console.log = log; }
    const f1 = listFiles(out1), f2 = listFiles(out2);
    assert.deepEqual(f1, f2);
    assert.equal(f1.length, 3);
    for (const f of f1.filter((p) => p.startsWith("v2"))) assert.equal(readFileSync(join(out1, f), "utf8"), readFileSync(join(out2, f), "utf8"), f);
    const i1 = JSON.parse(readFileSync(join(out1, "index.json"), "utf8")), i2 = JSON.parse(readFileSync(join(out2, "index.json"), "utf8"));
    assert.deepEqual(withoutGen(i1), withoutGen(i2));
    assert.deepEqual([i1.gen, i2.gen], [100, 200]);
    assert.ok(!f1.some((p) => p.includes(".tmp-")), "no temporary file left behind");
  } finally {
    rmSync(out1, { recursive: true, force: true });
    rmSync(out2, { recursive: true, force: true });
  }
});

test("CLI as a process: --live-off / XUPER_LIVE_OFF feed the kill switch; bad usage exits 2", () => {
  const out = tmp();
  try {
    const r = spawnSync(process.execPath, [TOOL, "--home", fileURLToPath(new URL("./fixtures/home.reduced.json", import.meta.url)),
      "--matches", fileURLToPath(new URL("./fixtures/matches.reduced.json", import.meta.url)), "--out", out],
    { encoding: "utf8", env: { ...process.env, XUPER_LIVE_OFF: "supertv, xuper,supertv" } });
    assert.equal(r.status, 0, r.stderr);
    const summary = JSON.parse(r.stdout.trim());
    assert.deepEqual(summary.index.liveOff, ["supertv", "xuper"]);
    assert.deepEqual(JSON.parse(readFileSync(join(out, "index.json"), "utf8")).live.off, ["supertv", "xuper"]);
    assert.equal(spawnSync(process.execPath, [TOOL, "--bogus"], { encoding: "utf8" }).status, 2);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("validator: an empty legacy catalog is refused and nothing is written", () => {
  const built = T.toV2({ home: { version: 1, generatedAt: 1, sections: {} }, matches });
  assert.equal(built.ok, false);
  assert.ok(built.problems.some((p) => /no section has a Home row/.test(p)), built.problems.join("; "));
  assert.deepEqual(built.files, []);
  const out = tmp();
  try {
    assert.throws(() => T.writeOut(out, built));
    assert.deepEqual(readdirSync(out), []);
    const r = spawnSync(process.execPath, [TOOL, "--in", fileURLToPath(new URL("./fixtures/", import.meta.url)), "--home", "/nonexistent/home.json", "--out", out], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /cannot read home/);
    assert.equal(existsSync(join(out, "index.json")), false);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("validator: Kino's item limits, 18+ flags, https images, no \"\" and the size limit", () => {
  const good = T.buildCatalog(home);
  assert.deepEqual(T.checkCatalog(good), []);
  const reseal = (fn) => { const c = JSON.parse(JSON.stringify(good)); fn(c); return V2.seal({ schema: c.schema, items: c.items, sections: c.sections }, c.gen, sha256); };
  const cases = [
    [(c) => { c.items[0].title = "x".repeat(201); }, /title/],
    [(c) => { c.items[0].poster = "http://example.com/a.jpg"; }, /poster is not https/],
    [(c) => { c.items[0].overview = ""; }, /empty string/],
    [(c) => { c.items[0].id = "bad id"; }, /\.id/],
    [(c) => { c.items[0].overview = "y".repeat(2001); }, /overview/],
    [(c) => { c.items[0].poster = "https://e.com/" + "a".repeat(2048); }, /poster is not https/],
    [(c) => { const i = c.sections.adultos.all[0]; delete c.items[i].adult; }, /in adultos but not adult/],
    [(c) => { c.items[0].title = "bad \uD800 surrogate"; }, /lone surrogate/],
    [(c) => { c.sections.populares.home = 61; }, /home/],
  ];
  for (const [mutate, rx] of cases) {
    const p = T.checkCatalog(reseal(mutate));
    assert.ok(p.some((x) => rx.test(x)), `${rx} not in: ${p.join("; ")}`);
  }
  assert.ok(T.checkCatalog({ ...good, schema: 3 }).some((p) => /schema/.test(p)));
  assert.ok(T.checkCatalog({ ...good, hash: "0000000000000000" }).some((p) => /round trip/.test(p)), "a wrong hash is caught like the device would");
  assert.ok(T.checkCatalog(good, JSON.stringify(good), { maxChars: 1000 }).some((p) => /over the 1000 limit/.test(p)));
});

test("validator: matches and index rules", () => {
  const m = T.buildMatches(matches);
  assert.deepEqual(T.checkMatches(m), []);
  const bad = V2.seal({ schema: 2, matches: [{ a: { n: "A", l: "http://x/a.png" } }] }, 1, sha256);
  assert.ok(T.checkMatches(bad).some((p) => /not https/.test(p)));
  assert.ok(T.checkMatches({ ...m, schema: 3 }).some((p) => /schema/.test(p)));
  const ix = T.toV2({ home, matches }).index;
  assert.deepEqual(T.checkIndex(ix), []);
  assert.ok(T.checkIndex({ ...ix, catalog: { h: "../../evil", n: 1 } }).some((p) => /catalog\.h/.test(p)));
  assert.ok(T.checkIndex({ ...ix, live: { off: ["Bad Id"] } }).some((p) => /live\.off/.test(p)));
  assert.ok(T.checkIndex({ ...ix, probeS: 5 }).some((p) => /probeS/.test(p)));
  assert.equal(T.toV2({ home, matches, liveOff: "Bad Id" }).ok, false);
});

test("round trip: a device reading the publisher's files from DATA_BASE stores them (phase 2, no Release)", async () => {
  const built = T.toV2({ home, matches });
  const files = new Map(built.files.map((f) => [DATA_BASE + f.path, f.text]));
  files.set(DATA_BASE + "index.json", built.indexText);
  const k = installKino({ routes: [(url) => (files.has(url) ? res(200, files.get(url), { "content-type": "text/plain; charset=utf-8", etag: 'W/"x"' }) : undefined)] });
  data._resetMemory();
  beginCall();
  const r = await data.revalidate({ catalog: true, matches: true });
  assert.equal(r.changed, true);
  assert.equal(k.requests.filter((q) => q.url.startsWith(RELEASE_BASE)).length, 0);
  assert.equal(k.requests.length, 3, "index + catalog + matches");
  const catm = JSON.parse(k.store.get("o2:catm"));
  assert.equal(catm.src, "raw");
  assert.equal(catm.h.slice(0, 12), built.index.catalog.h);
  assert.equal(k.store.get("o2:cat"), built.files[0].text, "stored as published");
  assert.equal(data.matches().matches.length, matches.matches.length);
  assert.deepEqual(data.parseIndex(built.indexText).catalog, { h: built.index.catalog.h });
});

test("the published release assets (XUPER_PUBLISHED_DIR) convert and validate", { skip: !existsSync(join(GH, "home.json")) && "no copy of the published files" }, () => {
  const built = T.toV2({ home: JSON.parse(readFileSync(join(GH, "home.json"), "utf8")), matches: JSON.parse(readFileSync(join(GH, "matches.json"), "utf8")) });
  assert.equal(built.ok, true, built.problems.join("; "));
  assert.ok(built.summary.catalog.items > 300);
  assert.ok(built.summary.catalog.n < T.MAX_FILE_CHARS);
  assert.ok(Number.isInteger(built.summary.matches.count) && built.summary.matches.count >= 0);
});
