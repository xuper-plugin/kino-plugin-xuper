import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { fakeKino, STAND_IN_SEED_KEY } from "./helpers/fakeKino.mjs";
import { makeSession, SEALED_SEEDS_URL } from "../src/session.js";

const seed = (n) => ({ sn: "seed-" + n, userId: "su" + n, userToken: "st" + n });

/** What the collector publishes: AES-256-GCM, data = ciphertext || 16-byte tag, base64 iv and data. */
function seal(list, keyHex = STAND_IN_SEED_KEY) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(list), "utf8"), c.final(), c.getAuthTag()]);
  return { v: 1, iv: iv.toString("base64"), data: ct.toString("base64") };
}

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
  const session = makeSession({ kino, portal: { call: async () => { throw new Error("no portal"); } }, clock, seedsUrl: SEALED_SEEDS_URL, random: () => 0 });
  return { session, fetches };
}

test("the sealed pool is opened inside Kino, with ONE request", async () => {
  const { session, fetches } = setup({ [SEALED_SEEDS_URL]: seal([seed(1), seed(2)]) });
  assert.equal(await session.refreshSeeds(), true);
  assert.deepEqual(fetches, [SEALED_SEEDS_URL]);
  assert.deepEqual(session.seedPool().map((s) => s.sn), ["seed-1", "seed-2"]);
});

test("a sealed file under another key (what a copy outside Kino would hold) loads nothing", async () => {
  const { session } = setup({ [SEALED_SEEDS_URL]: seal([seed(1)], "bb".repeat(32)) });
  assert.equal(await session.refreshSeeds(), false);
  assert.deepEqual(session.seedPool(), []);
});

test("a tampered sealed file loads nothing", async () => {
  const box = seal([seed(1)]);
  box.data = Buffer.from(box.data, "base64").map((b, i) => (i === 3 ? b ^ 1 : b)).toString("base64");
  const { session } = setup({ [SEALED_SEEDS_URL]: box });
  assert.equal(await session.refreshSeeds(), false);
});

test("a plain array is still taken as it is", async () => {
  const { session } = setup({ [SEALED_SEEDS_URL]: [seed(5)] });
  assert.equal(await session.refreshSeeds(), true);
  assert.deepEqual(session.seedPool().map((s) => s.sn), ["seed-5"]);
});

test("the plugin reads the sealed pool file", () => {
  assert.match(SEALED_SEEDS_URL, /\/seeds\/seeds\.enc\.json$/);
});
