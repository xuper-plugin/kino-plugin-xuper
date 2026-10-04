// The Home rows snapshot (src/rowsStore.js): its stored form, how it is cut to fit, and how it is
// split across several storage values and read back only when every part belongs together.
import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";
import { storedLength } from "../src/homeTree.js";
import {
  encodeRows, decodeRows, fitRows, splitParts, checksum, makeRowsStore, META_KEY, PART_BUDGET_BYTES, SNAPSHOT_BUDGET_BYTES,
} from "../src/rowsStore.js";

const item = (n, extra = {}) => ({
  id: `ID${n}`, title: `Título "${n}"`, poster: `https://img.test/p/${n}.jpg`, backdrop: n % 2 ? `https://img.test/b/${n}.jpg` : null,
  durationS: 5400, type: n % 3 ? "movie" : "teleplay", genres: ["Drama", "Sci-Fi"].slice(0, 1 + (n % 2)), score: n % 4 ? 7.5 : null,
  description: `Sinopsis ${n} con ñandú y "comillas" / barras `.repeat(1 + (n % 3)), shelvedAtMs: n % 5 ? Date.UTC(2026, 9, 1, n % 24) : 0, ...extra,
});
const rowsOf = (count, per, offset = 0) => Array.from({ length: count }, (_, r) => {
  const shown = Array.from({ length: per }, (_, k) => item(offset + r * per + k));
  return { id: `row_${r}`, title: `Fila ${r}`, shown, all: shown };
});

test("encode/decode round-trips every field the projection and the tiles read; `all` is not kept", () => {
  const rows = rowsOf(3, 4);
  rows[2].shown.push(rows[0].shown[0]); // an item in two rows is stored once
  const { rows: back, complete } = decodeRows(encodeRows(rows));
  assert.equal(complete, true);
  assert.deepEqual(back.map((r) => ({ ...r, all: undefined })), rows.map((r) => ({ id: r.id, title: r.title, shown: r.shown, all: undefined })));
  assert.ok(back.every((r) => r.all === null));
  assert.equal(JSON.parse(encodeRows(rows)).i.length, 12);
});

test("a description is kept whole for the first items and absent for the rest, never cut", () => {
  const rows = rowsOf(2, 5);
  const { rows: back } = decodeRows(encodeRows(rows, { descItems: 3 }));
  const all = back.flatMap((r) => r.shown);
  assert.deepEqual(all.map((i) => i.description !== ""), [true, true, true, false, false, false, false, false, false, false]);
  all.slice(0, 3).forEach((i, n) => assert.equal(i.description, rows.flatMap((r) => r.shown)[n].description));
});

test("fitRows: everything when it fits; else Home's rows whole and the tiles' first items; null when nothing fits", () => {
  const small = rowsOf(4, 5);
  assert.deepEqual(fitRows(small).step, 0);
  const big = rowsOf(60, 20);
  const fit = fitRows(big, { keepFull: 21 });
  assert.ok(fit !== null && fit.step >= 1);
  assert.ok(storedLength(fit.text) <= SNAPSHOT_BUDGET_BYTES);
  const { rows, complete } = decodeRows(fit.text);
  assert.equal(complete, false);
  assert.deepEqual(rows.slice(0, 21).map((r) => r.shown.map((i) => i.id)), big.slice(0, 21).map((r) => r.shown.map((i) => i.id)));
  assert.deepEqual(rows.slice(21).map((r) => r.shown.map((i) => i.id)), big.slice(21).map((r) => [r.shown[0].id]));
  assert.equal(fitRows(big, { keepFull: 21, budget: 2_000 }), null);
});

test("splitParts: every part within the budget as stored (escapes, multi-byte, surrogate pairs), rejoined exactly", () => {
  const text = JSON.stringify({ s: 'a/b"c\\d ñ 日本 😀😀 '.repeat(3000) });
  for (const budget of [1000, 7, PART_BUDGET_BYTES]) {
    const parts = splitParts(text, budget);
    assert.equal(parts.join(""), text);
    assert.ok(parts.every((p) => storedLength(p) <= budget), String(budget));
    assert.ok(parts.every((p) => !/[\ud800-\udbff]$/.test(p)), "no part ends inside a surrogate pair");
  }
  assert.deepEqual(splitParts(""), [""]);
});

test("checksum tells apart texts of the same length", () => {
  assert.notEqual(checksum("abcd"), checksum("abce"));
  assert.equal(checksum("abcd"), checksum("abcd"));
});

test("the store writes the parts then the meta, reads them back, and a write that does not fit leaves no part behind", () => {
  const kino = fakeKino();
  const store = makeRowsStore({ kino, ttlMs: 3600_000 });
  const text = encodeRows(rowsOf(8, 20));
  assert.ok(storedLength(text) > PART_BUDGET_BYTES);
  assert.equal(store.write(text, 1_000), true);
  const meta = JSON.parse(kino.storage.get(META_KEY));
  assert.ok(meta.n >= 2);
  const back = store.read();
  assert.equal(back.at, 1_000);
  assert.deepEqual(back.rows.map((r) => r.id), rowsOf(8, 20).map((r) => r.id));
  // Storage almost full: the new snapshot cannot be written, and none of its parts stay.
  for (const k of kino.storage.keys()) kino.storage.remove(k);
  // Room for about half of it: the first part(s) are written, a later one is refused.
  kino.storage.set("filler", "x".repeat(262_144 - 200 - Math.floor(text.length / 2)));
  assert.throws(() => store.write(text, 2_000));
  assert.deepEqual(kino.storage.keys().filter((k) => k.startsWith("rows:")), []);
  assert.equal(store.read(), null);
});
