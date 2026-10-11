// 2.2.25: the portal host that answered last is tried first by the next sandbox. Kino drops a sandbox after 5 idle
// minutes and after every timeout, and the answering host was kept in memory only, so every start asked the first
// host again: where it is down, each start spent its share of the call's window on it before failing over (board,
// 0.9.60: 104 of 200 `xuper:portal failover` reports `getNextColumns to=1`; timed-out Homes ending
// `host_fail i=0 why=timeout`, then `deadline i=1`: no time left for the host that works).
import test from "node:test";
import assert from "node:assert/strict";
import { portalWorld } from "./helpers/portalWorld.mjs";
import { makePortal } from "../src/portal.js";
import { makeCrypto } from "../src/crypto.js";

const HOSTS = ["a.test", "b.test"];
// A new sandbox: a new portal over the same storage (what the world's own portal kept).
const sandbox = (w, hosts = HOSTS) => makePortal({
  kino: w.kino, crypto: makeCrypto(w.kino), config: { hosts, appId: "app.test", apkVersion: "9.9.9" }, clock: w.clock, snProvider: () => "sn-dev",
});
const ask = (p) => p.call("v3/searchByName", { name: "Dune", pageNum: 1, pageSize: 10 });

test("a down first host: the next sandbox goes straight to the host that answered", async () => {
  const w = portalWorld({ dead: ["a.test"] });
  await ask(w.portal);
  assert.deepEqual(w.requests.map((r) => r.host), ["a.test", "b.test"], "the first start fails over");
  w.requests.length = 0;
  await ask(sandbox(w));
  assert.deepEqual(w.requests.map((r) => r.host), ["b.test"], "the next start does not wait for the dead host");
});

test("the remembered host going down fails over to the other, which is remembered instead", async () => {
  // b answered last time (remembered), and now b is down while a is back: fail over once, then a is the first again.
  const flipped = portalWorld({ dead: ["b.test"] });
  flipped.kino.storage.set("portalHost", "b.test");
  await ask(sandbox(flipped));
  assert.deepEqual(flipped.requests.map((r) => r.host), ["b.test", "a.test"]);
  flipped.requests.length = 0;
  await ask(sandbox(flipped));
  assert.deepEqual(flipped.requests.map((r) => r.host), ["a.test"]);
});

test("a remembered host that is no longer in the host list is ignored", async () => {
  const w = portalWorld();
  w.kino.storage.set("portalHost", "gone.test");
  await ask(sandbox(w));
  assert.deepEqual(w.requests.map((r) => r.host), ["a.test"]);
});

test("a healthy first host writes nothing", async () => {
  const w = portalWorld();
  await ask(w.portal);
  await ask(sandbox(w));
  assert.equal(w.kino.storage.get("portalHost"), null);
});
