import test from "node:test";
import assert from "node:assert/strict";
import { makeMigrate } from "../src/migrate.js";
import { decode, encode } from "../src/refs.js";
import { findChapter } from "../src/episodes.js";
import { migrateAnswer } from "../sdk/contract.mjs";

const { migrate } = makeMigrate();
const b64url = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
const legacy = (p) => `${b64url({ s: "magis", p })}.deadbeefsig`;

// The kit's own check of the answer: zero drops means the app would keep it as is.
function kept(input, out) {
  const r = migrateAnswer(out, input);
  assert.deepEqual(r.drops, [], JSON.stringify(out));
  return r.value;
}

test("a movie title: kind movie, id = contentId, canonical ref", async () => {
  const input = { kind: "title", ref: "magis1:movie:0:C100" };
  const out = await migrate(input);
  assert.deepEqual(out, { kind: "movie", id: "C100", ref: "magis1:movie:0:C100" });
  assert.deepEqual(kept(input, out), out);
});

test("a series title: kind series for teleplay, series and variety", async () => {
  for (const type of ["teleplay", "series", "variety"]) {
    const input = { kind: "title", ref: `magis1:${type}:0:S9` };
    const out = await migrate(input);
    assert.deepEqual(out, { kind: "series", id: "S9", ref: `magis1:${type}:0:S9` });
    kept(input, out);
  }
});

test("a legacy gateway ref is normalized to the magis1 form", async () => {
  const input = { kind: "title", ref: legacy({ content_id: "L7", program_type: "teleplay", episode: 3 }) };
  const out = await migrate(input);
  assert.equal(out.kind, "series");
  assert.equal(out.id, "L7");
  assert.equal(out.ref, "magis1:teleplay:0:L7");
  kept(input, out);
  const noType = await migrate({ kind: "title", ref: legacy({ content_id: "L8" }) });
  assert.deepEqual(noType, { kind: "movie", id: "L8", ref: "magis1:movie:0:L8" });
});

test("a title whose contentId cannot be an item id is not claimed", async () => {
  assert.equal(await migrate({ kind: "title", ref: "magis1:movie:0:has space" }), null);
  assert.equal(await migrate({ kind: "title", ref: "magis1:movie:0:a:b" }), null); // ':' is no id char
});

test("a chapter: teleplay ref over the series id and the chapter number", async () => {
  const input = { kind: "chapter", ref: "magis1:teleplay:5:S9", season: 2, episode: 5 };
  const out = await migrate(input);
  assert.deepEqual(out, { kind: "episode", ref: "magis1:teleplay:5:S9", season: 2, number: 5 });
  assert.deepEqual(kept(input, out), out);
});

test("a chapter ref of another program type is rewritten to teleplay (as episodes() emits)", async () => {
  const out = await migrate({ kind: "chapter", ref: "magis1:variety:4:V1", season: null, episode: null });
  assert.deepEqual(out, { kind: "episode", ref: "magis1:teleplay:4:V1", number: 4 });
});

test("a legacy chapter ref: the number comes from its episode", async () => {
  const ref = legacy({ content_id: "L7", program_type: "teleplay", episode: 6 });
  const out = await migrate({ kind: "chapter", ref, season: 1, episode: 6 });
  assert.deepEqual(out, { kind: "episode", ref: "magis1:teleplay:6:L7", season: 1, number: 6 });
});

test("a chapter ref with no usable number takes the given episode; the ref's own number wins otherwise", async () => {
  const zero = await migrate({ kind: "chapter", ref: "magis1:teleplay:0:S9", season: 1, episode: 7 });
  assert.deepEqual(zero, { kind: "episode", ref: "magis1:teleplay:7:S9", season: 1, number: 7 });
  const clash = await migrate({ kind: "chapter", ref: "magis1:teleplay:3:S9", season: 1, episode: 8 });
  assert.equal(clash.number, 3);
  assert.equal(decode(clash.ref).episode, 3);
});

test("a chapter whose ref says 'first' and with no episode given is chapter 1, as resolve reads it", async () => {
  for (const episode of [null, 0, undefined]) {
    const out = await migrate({ kind: "chapter", ref: "magis1:teleplay:0:S9", season: 1, episode });
    assert.deepEqual(out, { kind: "episode", ref: "magis1:teleplay:1:S9", season: 1, number: 1 });
  }
  const items = [{ seriesNumber: "1", contentId: "c1" }, { seriesNumber: "2", contentId: "c2" }];
  // the old ref (episode 0) played items[0]; the migrated one finds the same chapter
  assert.equal(findChapter(items, 0).contentId, findChapter(items, decode("magis1:teleplay:1:S9").episode).contentId);
});

test("a chapter whose series id cannot be an item id is not claimed", async () => {
  assert.equal(await migrate({ kind: "chapter", ref: "magis1:teleplay:2:has space", season: 1, episode: 2 }), null);
  assert.equal(await migrate({ kind: "chapter", ref: "magis1:teleplay:2:a:b", season: 1, episode: 2 }), null);
});

test("a migrated chapter round-trips refs.decode and findChapter", async () => {
  const out = await migrate({ kind: "chapter", ref: "magis1:teleplay:2:S9", season: 1, episode: 2 });
  const magis = decode(out.ref);
  assert.deepEqual([magis.contentId, magis.programType, magis.episode, magis.isSeries], ["S9", "teleplay", 2, true]);
  const items = [{ seriesNumber: "1", contentId: "c1" }, { seriesNumber: "2", contentId: "c2" }];
  assert.equal(findChapter(items, magis.episode).contentId, "c2");
  // a migrated title ref is a plain series ref: episode 0 = first chapter, as episodes() reads it
  const title = await migrate({ kind: "title", ref: "magis1:teleplay:0:S9" });
  assert.equal(decode(title.ref).episode, 0);
  assert.equal(decode(title.ref).contentId, "S9");
  assert.equal(title.ref, encode({ contentId: "S9", programType: "teleplay", episode: 0 }));
});

test("a live channel of the xuper provider answers its bare code", async () => {
  const input = { kind: "live", provider: "xuper", code: "CH_01" };
  const out = await migrate(input);
  assert.deepEqual(out, { kind: "live", code: "CH_01" });
  assert.deepEqual(kept(input, out), out);
});

test("another provider's live channel, or a code that is no id, is not claimed", async () => {
  assert.equal(await migrate({ kind: "live", provider: "plugin:other", code: "CH_01" }), null);
  assert.equal(await migrate({ kind: "live", provider: "own", code: "CH_01" }), null);
  const odd = await migrate({ kind: "live", provider: "xuper", code: "bad code" });
  assert.match(odd.code, /^x\.b[A-Za-z0-9_-]+$/); // an odd saved code is answered as its encoded id
  assert.equal(await migrate({ kind: "live", provider: "xuper", code: "" }), null);
});

test("plg1 refs are never answered", async () => {
  const wrapped = "plg1:xuper:" + Buffer.from(JSON.stringify({ id: "C1", k: "movie", r: "magis1:movie:0:C1" })).toString("base64url");
  assert.equal(await migrate({ kind: "title", ref: wrapped }), null);
  assert.equal(await migrate({ kind: "chapter", ref: wrapped, season: 1, episode: 1 }), null);
});

test("foreign and garbage input is null, never a throw", async () => {
  const inputs = [
    { kind: "title", ref: "https://example.test/x" }, { kind: "title", ref: "magis2:movie:0:C1" },
    { kind: "title", ref: "" }, { kind: "title", ref: "magis1:movie" }, { kind: "title", ref: "magis1:movie:0:" },
    { kind: "title", ref: "abc.def" }, { kind: "title", ref: legacy({ s: "other" }) }, { kind: "title" },
    { kind: "title", ref: 12 }, { kind: "chapter", ref: null }, { kind: "live" }, { kind: "live", provider: "xuper" },
    { kind: "nope", ref: "magis1:movie:0:C1" }, null, undefined, 5, "magis1:movie:0:C1", [], {},
    { kind: "title", ref: "magis1:movie:0:" + "x".repeat(200) },
  ];
  for (const input of inputs) assert.equal(await migrate(input), null, JSON.stringify(input));
});

test("migrate is async from the first line", () => {
  assert.ok(migrate({ kind: "title", ref: "x" }) instanceof Promise);
});

// ---- Task 17: Kino's neutral "legacy" live key (0.9.50 on) is claimed as well as "xuper" ----------

test("a live channel under Kino's neutral legacy key answers its bare code; xuper still does; a plugin key does not", async () => {
  const input = { kind: "live", provider: "legacy", code: "123" };
  const out = await migrate(input);
  assert.deepEqual(out, { kind: "live", code: "123" });
  assert.deepEqual(kept(input, out), out);
  assert.deepEqual(await migrate({ kind: "live", provider: "xuper", code: "123" }), { kind: "live", code: "123" });
  assert.equal(await migrate({ kind: "live", provider: "plugin:x", code: "123" }), null);
  assert.equal((await migrate({ kind: "live", provider: "legacy", code: "bad code" })).kind, "live");
});
