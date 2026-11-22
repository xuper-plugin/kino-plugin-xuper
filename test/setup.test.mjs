// Plugin setup (apiVersion 30; "29": {} stays for go.relinkTelegram): Xuper's activation is its setup (setupStatus / setupRun), and its screen's "Preparar todo"
// asks Kino to set up Movie+ and HDFull (kino.plugins.setup / setupStatus), offering go.installPlugin for a missing one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import("../src/plugin.js");
const api = await import("../src/api.js");
const { screen, screenEvent } = await import("../src/screen.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";

const identityOk = (calls) => async () => { calls.n++; return { id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "07DA-B67F-2ACF-B4D3", codeHash: "c0de" }; };
const backend = (url) => {
  if (!url.startsWith(BACKEND)) return undefined;
  const path = url.slice(BACKEND.length);
  if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
  if (path === "/session") return res(200, JSON.stringify({ session: "fresh-bearer" }));
  return res(200, "{}");
};

async function fresh({ bearer, identity } = {}) {
  const k = installKino({ storage: {}, routes: [backend] });
  await api.clearBearer();
  if (bearer) k.store.set("o2:bearer", bearer);
  const calls = { n: 0 };
  k.kino.identity = { telegram: identity || identityOk(calls) };
  k.kino.vault = { get: async () => { calls.vault = (calls.vault || 0) + 1; return "x"; } };
  return { ...k, calls };
}

const walk = (node, fn) => {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const key of Object.keys(node)) if (node[key] && typeof node[key] === "object") walk(node[key], fn);
};
const all = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const byKey = (tree, key) => all(tree, (n) => n.key === key)[0];

// ── manifest ──
test("manifest: apiVersion 30 (Kino 0.9.91) declares setup at the route `setup` (no inputs), no enhancements left", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.deepEqual(m.setup, { route: "setup" });
  assert.equal(m.enhancements, undefined);
  assert.equal(m.apiVersion, 30);
  assert.ok(m.capabilities.includes("screen"));
});

// ── setupStatus ──
test("setupStatus: not ready until activated, ready after; never asks identity or the vault", async () => {
  const k = await fresh();
  beginCall();
  let st = await P.setupStatus();
  assert.equal(st.ready, false);
  assert.equal(typeof st.label, "string");
  k.store.set("o2:bearer", "b");
  await api.clearBearer(); k.store.set("o2:bearer", "b");   // clear the memo, keep the stored session
  st = await P.setupStatus();
  assert.equal(st.ready, true);
  assert.equal(k.calls.n, 0, "identity untouched");
  assert.equal(k.calls.vault, undefined, "vault untouched");
  assert.equal(k.requests.length, 0, "no request");
});

test("setupStatus: frozen as a non-member is not ready", async () => {
  const k = await fresh({ bearer: "b" });
  k.store.set("o2:notmember", "1");
  assert.equal((await P.setupStatus()).ready, false);
});

// ── setupRun ──
test("setupRun step 0 runs the activation (identity sign-in) and is done", async () => {
  const k = await fresh();
  const out = await P.setupRun({ step: 0 });
  assert.equal(out.done, true);
  assert.equal(k.calls.n, 1);
  assert.equal(k.store.get("o2:bearer"), "fresh-bearer");
  assert.equal(k.store.get("o2:intro"), "1", "the first-time intro counts as seen: later opens sign in by themselves");
  assert.equal((await P.setupStatus()).ready, true);
});

test("setupRun when already activated is done without asking identity", async () => {
  const k = await fresh({ bearer: "b" });
  assert.equal((await P.setupRun({ step: 0 })).done, true);
  assert.equal(k.calls.n, 0);
});

test("setupRun failing: a step error with the per-cause message", async () => {
  const fail = (code) => async () => { throw Object.assign(new Error("x"), { code }); };
  let k = await fresh({ identity: fail("permission_denied") });
  await assert.rejects(P.setupRun({ step: 0 }), (e) => /identidad/i.test(e.userMessage) && /Ajustes/.test(e.userMessage));
  k = await fresh({ identity: fail("not_available") });
  await assert.rejects(P.setupRun({ step: 0 }), (e) => /Telegram/.test(e.userMessage));
  k = await fresh({ identity: async () => ({ id: "p" }) });   // answered without the gate token
  await assert.rejects(P.setupRun({ step: 0 }), (e) => /Actualiza Kino/.test(e.userMessage));
  assert.equal(await api.currentBearer(), null);
  // the backend refuses (503 at the challenge): a retry-later message
  k = installKino({ storage: {}, routes: [(url) => (url.startsWith(BACKEND) ? res(503, "{}") : undefined)] });
  await api.clearBearer();
  k.kino.identity = { telegram: identityOk({ n: 0 }) };
  await assert.rejects(P.setupRun({ step: 0 }), (e) => /momento/.test(e.userMessage));
});

test("intro state: a failed setupRun leaves it unseen; the already-activated path does not touch it; success marks it", async () => {
  let k = await fresh({ identity: async () => { throw Object.assign(new Error("x"), { code: "permission_denied" }); } });
  await assert.rejects(P.setupRun({ step: 0 }));
  assert.equal(api.introSeen(), false, "failed: the next plain open still shows the intro");
  assert.ok(byKey(await screen({ state: {} }), "iEnter"), "introView shows");
  k = await fresh({ bearer: "b" });
  await P.setupRun({ step: 0 });
  assert.equal(api.introSeen(), false, "already activated: untouched");
  k = await fresh();
  await P.setupRun({ step: 0 });
  assert.equal(api.introSeen(), true, "a successful sign-in stands in for Ingresar");
});

test("setupStatus stays ready with a stored session while the reauth-needed flag is set (the Home bell asks for that)", async () => {
  const k = await fresh({ bearer: "b" });
  api.markReauthNeeded("consent");
  assert.equal((await P.setupStatus()).ready, true);
  assert.equal(k.calls.n, 0, "identity untouched");
  assert.equal(k.calls.vault, undefined, "vault untouched");
  api.clearReauthNeeded();
  assert.equal((await P.setupStatus()).ready, true);
});

test("setupRun frozen as a non-member with a stored session does a fresh sign-in, which lifts the freeze", async () => {
  const k = await fresh({ bearer: "old" });
  k.store.set("o2:notmember", "1");
  assert.equal((await P.setupStatus()).ready, false);
  assert.equal((await P.setupRun({ step: 0 })).done, true);
  assert.equal(k.calls.n, 1, "a fresh sign-in ran (no stored-session shortcut)");
  assert.equal(api.notMemberActive(), false);
  assert.equal((await P.setupStatus()).ready, true);
});

test("setupRun with the reauth flag set and a valid session does a real sign-in, clears the flag, then ready", async () => {
  const k = await fresh({ bearer: "old" });
  api.markReauthNeeded("consent");
  assert.equal((await P.setupRun({ step: 0 })).done, true);
  assert.equal(k.calls.n, 1, "a fresh sign-in ran");
  assert.equal(api.reauthNeeded(), false);
  assert.equal(k.store.get("o2:bearer"), "fresh-bearer");
  assert.equal((await P.setupStatus()).ready, true);
});

test("setupRun with the reauth flag set and the sign-in failing: step error, flag stays, session kept, intro untouched", async () => {
  const k = await fresh({ bearer: "old", identity: async () => { throw Object.assign(new Error("x"), { code: "permission_denied" }); } });
  api.markReauthNeeded("consent");
  await assert.rejects(P.setupRun({ step: 0 }), (e) => /identidad/i.test(e.userMessage));
  assert.equal(api.reauthNeeded(), true);
  assert.equal(k.store.get("o2:bearer"), "old");
  assert.equal(api.introSeen(), false);
  // The old session is kept, so Kino's setup reads ready (R20); the bell keeps asking for the re-authentication.
  assert.equal((await P.setupStatus()).ready, true);
});

// ── The setup route is Xuper's own screen (owner, 2026-11-22): no "Xuper está listo" / "Preparar todo" page ──
const SETUP_ROUTE = { name: "setup", params: {} };
const texts = (tree) => JSON.stringify(tree);

test("the setup route before any session: the welcome's Ingresar; after it, Xuper's own screen (its catalog)", async () => {
  await fresh();
  api.clearIntro && api.clearIntro();
  beginCall();
  const before = await screen({ state: {}, route: SETUP_ROUTE, device: "phone" });
  assert.match(texts(before), /"event":"enter"/, "the one-time welcome with Ingresar");

  beginCall();
  const out = await screenEvent({ name: "enter", state: {}, route: SETUP_ROUTE });
  assert.equal(out.state.actError, null, "signed in");

  beginCall();
  const after = await screen({ state: out.state, route: SETUP_ROUTE, device: "phone" });
  assert.doesNotMatch(texts(after), /Xuper está listo|Preparar todo|Prepare everything/);
  assert.match(texts(after), /"key":"tab"|TabBar|NavigationBar/, "Xuper's own screen, with its sections");
});

test("the setup route with a session already stored is Xuper's screen at once; Ajustes has no Preparar todo", async () => {
  await fresh({ bearer: "stored" });
  beginCall();
  const v = await screen({ state: {}, route: SETUP_ROUTE, device: "tv" });
  assert.doesNotMatch(texts(v), /Xuper está listo|Preparar todo/);
  beginCall();
  const cfg = await screen({ state: { nav: "config" }, device: "phone" });
  assert.doesNotMatch(texts(cfg), /Preparar todo|prepareAll|Movie+ y HDFull/);
});

// Kino's own screen rules (the kit's checkScreenTree) drop no node of Ajustes.
const KIT = process.env.KINO_SCREEN_KIT || "C:/dev/kino-app/plugins/sdk/screen.mjs";
test("Kino's screen rules drop no node of Ajustes (ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  const { configView } = await import("../src/screenView.js");
  for (const lang of ["es", "en"]) {
    for (const device of ["phone", "tv"]) {
      globalThis.kino.lang = lang;
      assert.deepEqual(checkScreenTree(configView({ version: "3.1.12", device }), lang, undefined, { apiVersion: 30 }).dropped, [], `${lang} ${device}`);
    }
  }
  globalThis.kino.lang = "es";
});
