// src/sources/panels.js: which Xtream accounts sit on one panel, from the categories the probe already fetched.
// Fixture: the get_live_categories of 9 real bootstrap panels (2026-11-17, ids and names only). zee-ott, krishkaz and
// tmpes are one panel (same ids and names; tmpes's account sees about half the bouquet); every other pair is two panels.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const P = await import("../src/sources/panels.js");
const FIX = JSON.parse(readFileSync(new URL("./fixtures/stv-panels.json", import.meta.url), "utf8")).panels;
const raw = (host) => FIX[host].map(([category_id, category_name]) => ({ category_id, category_name, parent_id: 0 }));
const HOSTS = Object.keys(FIX);
const ONE_PANEL = new Set(["line.zee-ott.xyz", "line.krishkaz.com", "line.tmpes.com"]);
const same = (a, b) => ONE_PANEL.has(a) && ONE_PANEL.has(b);

test("panels: the pairs are (id, folded name), deduped (zee-ott lists 2845 twice); a sketch keeps n and the 128 smallest", () => {
  const fp = P.fingerprint(raw("line.zee-ott.xyz"));
  assert.equal(fp.n, 515, "524 rows, 515 distinct (id, name) pairs");
  assert.equal(fp.h.length, 515);
  for (let i = 1; i < fp.h.length; i++) assert.ok(fp.h[i - 1] < fp.h[i], "sorted, unique");
  // case, accents and spacing do not make another pair
  const a = P.fingerprint([{ category_id: 1, category_name: "ESPAÑA  Deportes" }]);
  const b = P.fingerprint([{ category_id: "1", category_name: "espana deportes" }]);
  assert.deepEqual(a.h, b.h);
  const sk = P.sketchOf(fp);
  assert.equal(sk.n, 515);
  assert.equal(sk.k.split(".").length, 128);
  assert.ok(JSON.stringify(sk).length < 1100, "about 1 KB stored per panel: " + JSON.stringify(sk).length);
  const back = P.readSketch(sk);
  assert.deepEqual(back.h, fp.h.slice(0, 128));
  assert.equal(back.n, 515);
  assert.equal(P.readSketch({ n: 3, k: "zz" }), null, "a sketch that does not add up is not read");
  assert.equal(P.readSketch(null), null);
});

test("panels: a sketch of a small panel (≤ 128 pairs) is the whole set, so every comparison with it is exact", () => {
  const fp = P.fingerprint(raw("pp.tresinl.xyz"));
  assert.equal(fp.n, 50);
  const back = P.readSketch(P.sketchOf(fp));
  assert.deepEqual(back.h, fp.h);
  assert.equal(back.tau, Infinity);
  for (const h of HOSTS) {
    const full = P.fingerprint(raw(h));
    assert.deepEqual(P.overlap(back, full), P.overlap(fp, full), h);
  }
});

test("panels: one panel under three hostnames is one panel (krishkaz: the same bouquet; tmpes: a subset of it)", () => {
  const z = P.fingerprint(raw("line.zee-ott.xyz")), k = P.fingerprint(raw("line.krishkaz.com")), t = P.fingerprint(raw("line.tmpes.com"));
  const r = (a, b) => { const o = P.overlap(a, b); return o.i / o.m; };
  assert.ok(r(z, k) >= 0.99, "zee-ott ↔ krishkaz " + r(z, k));
  assert.ok(r(z, t) >= 0.95, "zee-ott ↔ tmpes " + r(z, t) + " (Jaccard would be 0.48)");
  assert.ok(P.samePanel(z, k) && P.samePanel(k, t) && P.samePanel(t, z));
});

test("panels: every other measured pair is two panels: 0 shared (id, name) pairs, exact and through a stored sketch", () => {
  let pairs = 0;
  for (const a of HOSTS) for (const b of HOSTS) {
    if (a >= b) continue;
    const fa = P.fingerprint(raw(a)), fb = P.fingerprint(raw(b));
    const sa = P.readSketch(P.sketchOf(fa)), sb = P.readSketch(P.sketchOf(fb));
    // exact (both probed in this call), stored sketch against a full set (either way), and two stored sketches
    for (const [x, y, how] of [[fa, fb, "exact"], [sa, fb, "sketch-full"], [fa, sb, "full-sketch"], [sa, sb, "sketch-sketch"]]) {
      assert.equal(P.samePanel(x, y), same(a, b), a + " vs " + b + " (" + how + ")");
      if (!same(a, b)) assert.equal(P.overlap(x, y).i, 0, a + " vs " + b + " (" + how + ")");
    }
    if (!same(a, b)) pairs++;
  }
  assert.equal(pairs, 33);
});

test("panels: unknown (nothing comparable) counts as the same panel; a partial bouquet still matches (≥ 0.2 or ≥ 8 shared)", () => {
  const empty = { n: 0, h: [], tau: Infinity };
  assert.equal(P.samePanel(empty, P.fingerprint(raw("line.zee-ott.xyz"))), true, "m = 0 is never two independent panels");
  assert.equal(P.samePanel(empty, P.fingerprint(raw("line.zee-ott.xyz")), false), false, "… nor evidence to release a held one");
  // two resellers of one panel with overlapping bouquets: categories 1–300 and 200–500 (overlap 0.33)
  const cats = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => ({ category_id: String(from + i), category_name: "CAT " + (from + i) }));
  const a = P.fingerprint(cats(1, 300)), b = P.fingerprint(cats(200, 500));
  assert.equal(P.samePanel(a, b), true);
  assert.equal(P.samePanel(P.readSketch(P.sketchOf(a)), b), true, "through a sketch too");
  // 8 shared pairs between two big bouquets is a shared back-end, whatever the ratio
  const c = P.fingerprint([...cats(1, 8), ...cats(1000, 1400)]);
  assert.equal(P.samePanel(c, P.fingerprint(cats(1, 300))), true);
  assert.equal(P.samePanel(P.fingerprint(cats(1, 7).concat(cats(2000, 2300))), P.fingerprint(cats(1, 7).concat(cats(5000, 5300)))), false, "7 of 307");
});

test("panels: an account key names no secret (url and user only) and is stable", () => {
  const k = P.accountKey({ url: "http://line.zee-ott.xyz", username: "u1", password: "secret" });
  assert.equal(k, P.accountKey({ url: "http://line.zee-ott.xyz", username: "u1", password: "other" }));
  assert.match(k, /^[0-9a-z]{1,7}$/);
  assert.notEqual(k, P.accountKey({ url: "http://line.zee-ott.xyz", username: "u2" }));
});
