import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino, sealSeeds as seal } from "./helpers/fakeKino.mjs";
import { makeSession, SEEDS_URL } from "../src/session.js";

const seed = (n) => ({ sn: "seed-" + n, userId: "su" + n, userToken: "st" + n });

function setup(files) {
  const fetches = [];
  const kino = fakeKino({
    fetch: async (url) => {
      fetches.push(url);
      const f = files[url];
      if (f === undefined) return { ok: false, status: 404, text: () => "" };
      return { text: () => JSON.stringify(f) };
    },
  });
  const clock = { t: 1_000_000, now() { return this.t; } };
  const session = makeSession({ kino, portal: { call: async () => { throw new Error("no portal"); } }, clock, random: () => 0 });
  return { session, fetches };
}

test("the sealed pool is opened inside Kino, with ONE request", async () => {
  const { session, fetches } = setup({ [SEEDS_URL]: seal([seed(1), seed(2)]) });
  assert.equal(await session.refreshSeeds(), true);
  assert.deepEqual(fetches, [SEEDS_URL]);
  assert.deepEqual(session.seedPool().map((s) => s.sn), ["seed-1", "seed-2"]);
});

test("a sealed file under another key (what a copy outside Kino would hold) loads nothing", async () => {
  const { session } = setup({ [SEEDS_URL]: seal([seed(1)], "bb".repeat(32)) });
  assert.equal(await session.refreshSeeds(), false);
  assert.deepEqual(session.seedPool(), []);
});

test("a tampered sealed file loads nothing", async () => {
  const box = seal([seed(1)]);
  box.data = Buffer.from(box.data, "base64").map((b, i) => (i === 3 ? b ^ 1 : b)).toString("base64");
  const { session } = setup({ [SEEDS_URL]: box });
  assert.equal(await session.refreshSeeds(), false);
});

test("a plain list (an unsealed copy) loads nothing", async () => {
  const { session } = setup({ [SEEDS_URL]: [seed(5)] });
  assert.equal(await session.refreshSeeds(), false);
  assert.deepEqual(session.seedPool(), []);
});

test("the plugin reads the sealed pool file by default", () => {
  assert.match(SEEDS_URL, /\/seeds\/seeds\.enc\.json$/);
});
