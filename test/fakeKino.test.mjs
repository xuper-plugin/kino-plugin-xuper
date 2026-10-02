import test from "node:test";
import assert from "node:assert/strict";
import { fakeKino } from "./helpers/fakeKino.mjs";

test("typed secret key round-trips through kino.crypto 3DES", async () => {
  const kino = fakeKino();
  const key = kino.secret("magisKey");
  assert.notEqual(key, "000102030405060708090a0b0c0d0e0f1011121314151617"); // a marker, never the value
  const enc = await kino.crypto.encrypt("des-ede3-ecb", { key, data: "hello magis" });
  const dec = await kino.crypto.decrypt("des-ede3-ecb", { key, data: enc });
  assert.equal(dec, "hello magis");
});

test("fetch is scripted and sleep is a no-op", async () => {
  const kino = fakeKino({ fetch: async (url) => ({ status: 200, body: url }) });
  assert.equal((await kino.fetch("https://x")).body, "https://x");
  await kino.sleep(100000);
});
