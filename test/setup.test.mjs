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
const MOVIEPLUS = "xuper-plugin/kino-plugin-movieplus";
const HDFULL = "xuper-plugin/kino-plugin-hdfull";

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
test("manifest: enhancements 30 declares setup at the route `setup` (no inputs); 29 stays empty for relink; apiVersion stays", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.deepEqual(m.enhancements["29"], {});
  assert.deepEqual(m.enhancements["30"].setup, { route: "setup" });
  assert.equal(m.apiVersion, 27);
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

// ── Preparar todo ──
function withPlugins(impl) {
  globalThis.kino.plugins = impl;
  return impl;
}
const configState = (extra = {}) => ({ nav: "config", ...extra });

test("Preparar todo shows only on a Kino with kino.plugins.setup", async () => {
  await fresh({ bearer: "b" });
  api.markIntroSeen();
  delete globalThis.kino.plugins;
  assert.equal(byKey(await screen({ state: configState() }), "prepAll"), undefined);
  globalThis.kino.plugins = {};   // an older Kino's kino.plugins (call only)
  assert.equal(byKey(await screen({ state: configState() }), "prepAll"), undefined);
  withPlugins({ setup: async () => ({ state: "SETTING_UP" }), setupStatus: async () => ({ ready: false }) });
  const tree = await screen({ state: configState() });
  const btn = byKey(tree, "prepAll");
  assert.ok(btn, "the button is there");
  assert.equal(btn.onPressed.event, "prepareAll");
  // the setup route draws it too
  const setupTree = await screen({ state: {}, route: { name: "setup", params: {} } });
  assert.ok(byKey(setupTree, "prepAll"));
});

test("prepareAll: calls setup for Movie+ and HDFull, maps refused to a no-op and shows both as starting", async () => {
  await fresh({ bearer: "b" });
  const asked = [];
  withPlugins({ setup: async (repo) => { asked.push(repo); return { state: "SETTING_UP" }; }, setupStatus: async () => ({ ready: false }) });
  const out = await screenEvent({ name: "prepareAll", state: configState() });
  assert.deepEqual(asked, [MOVIEPLUS, HDFULL]);
  assert.equal(out.state.prep.movieplus.s, "SETTING_UP");
  assert.equal(out.state.prep.hdfull.s, "SETTING_UP");
  // refused: nothing to show, nothing offered
  withPlugins({ setup: async () => { throw Object.assign(new Error("no"), { code: "refused" }); } });
  const out2 = await screenEvent({ name: "prepareAll", state: configState() });
  assert.equal(out2.state.prep.movieplus, null);
  assert.equal(out2.state.prep.hdfull, null);
  assert.equal(out2.toast, undefined);
});

test("prepareAll: not_installed offers go.installPlugin for that repo; no_setup says it needs updating", async () => {
  await fresh({ bearer: "b" });
  withPlugins({
    setup: async (repo) => { throw Object.assign(new Error("x"), { code: repo === MOVIEPLUS ? "not_installed" : "no_setup" }); },
    setupStatus: async () => ({ ready: false }),
  });
  const out = await screenEvent({ name: "prepareAll", state: configState() });
  assert.equal(out.state.prep.movieplus.s, "not_installed");
  assert.equal(out.state.prep.hdfull.s, "no_setup");
  const tree = await screen({ state: configState({ prep: out.state.prep }) });
  const install = byKey(tree, "prepInstall-movieplus");
  assert.deepEqual(install.onPressed, { go: { installPlugin: { repo: MOVIEPLUS } } });
  assert.equal(byKey(tree, "prepInstall-hdfull"), undefined, "an old version is updated, not installed");
  assert.match(byKey(tree, "prepMsg-hdfull").text, /actualiz/i);
});

test("prepareAll: busy, rate_limited and timeout show a message and let the person retry", async () => {
  await fresh({ bearer: "b" });
  for (const code of ["busy", "rate_limited", "timeout"]) {
    withPlugins({ setup: async () => { throw Object.assign(new Error("x"), { code }); } });
    const out = await screenEvent({ name: "prepareAll", state: configState() });
    assert.equal(out.state.prep.movieplus.s, code);
    const tree = await screen({ state: configState({ prep: out.state.prep }) });
    assert.ok(byKey(tree, "prepMsg-movieplus").text.length > 5, code);
    assert.ok(byKey(tree, "prepAll"), "retry stays");
  }
});

test("progress: while a target sets up, a timer follows kino.plugins.setupStatus and shows progress, then ready", async () => {
  await fresh({ bearer: "b" });
  let ready = false;
  withPlugins({
    setup: async () => ({ state: "SETTING_UP" }),
    setupStatus: async (repo) => (repo === MOVIEPLUS
      ? { ready, progress: 0.4, label: "Descargando catálogo" } : { ready: true }),
  });
  const started = await screenEvent({ name: "prepareAll", state: configState() });
  let state = configState({ ...started.state });
  let tree = await screen({ state });
  const timer = all(tree, (n) => n.event === "prepPoll")[0];
  assert.ok(timer, "a poll timer while something sets up");
  const tick = await screenEvent({ name: "prepPoll", state });
  assert.equal(tick.state.prep.movieplus.s, "SETTING_UP");
  assert.equal(tick.state.prep.movieplus.p, 0.4);
  assert.equal(tick.state.prep.hdfull.s, "READY");
  state = { ...state, ...tick.state };
  tree = await screen({ state });
  const bar = byKey(tree, "prepBar-movieplus");
  assert.equal(bar.value, 0.4);
  assert.match(byKey(tree, "prepMsg-movieplus").text, /Descargando catálogo/);
  ready = true;
  const done = await screenEvent({ name: "prepPoll", state });
  assert.equal(done.state.prep.movieplus.s, "READY");
  state = { ...state, ...done.state };
  tree = await screen({ state });
  assert.equal(all(tree, (n) => n.event === "prepPoll").length, 0, "no timer once nothing sets up");
});

test("a failing status poll never throws and stops after a bounded number of ticks", async () => {
  await fresh({ bearer: "b" });
  withPlugins({ setup: async () => ({ state: "SETTING_UP" }), setupStatus: async () => { throw Object.assign(new Error("x"), { code: "rate_limited" }); } });
  const started = await screenEvent({ name: "prepareAll", state: configState() });
  let state = configState({ ...started.state });
  let ticks = 0;
  for (; ticks < 500; ticks++) {
    const tree = await screen({ state });
    if (!all(tree, (n) => n.event === "prepPoll").length) break;
    const t = await screenEvent({ name: "prepPoll", state });
    state = { ...state, ...t.state };
  }
  assert.ok(ticks > 0 && ticks < 500, "the timer ends by itself (" + ticks + ")");
});

// Kino's own screen rules (the kit's checkScreenTree) drop no node of the new views.
const KIT = process.env.KINO_SCREEN_KIT || "C:/dev/kino-app/.claude/worktrees/plugin-setup/plugins/sdk/screen.mjs";
test("Kino's screen rules drop no node of Preparar todo / the setup view (ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  const { configView, setupView } = await import("../src/screenView.js");
  withPlugins({ setup: async () => ({ state: "SETTING_UP" }) });
  const prep = { movieplus: { s: "SETTING_UP", p: 0.3, l: "Descargando" }, hdfull: { s: "not_installed" } };
  for (const lang of ["es", "en"]) {
    for (const device of ["phone", "tv"]) {
      globalThis.kino.lang = lang;
      for (const v of [configView({ version: "3.1.7", device, prep }), setupView({ prep, device }), setupView({ device })]) {
        assert.deepEqual(checkScreenTree(v, lang, undefined, { apiVersion: 27 }).dropped, [], `${lang} ${device}`);
      }
    }
  }
  globalThis.kino.lang = "es";
});

test("the setup view keeps the Apoyar (Ko-fi) ask, ES/EN x phone/TV", async () => {
  const { setupView } = await import("../src/screenView.js");
  for (const lang of ["es", "en"]) for (const device of ["phone", "tv"]) {
    globalThis.kino.lang = lang;
    assert.ok(byKey(setupView({ device }), "setupSupport"), `${lang} ${device}`);
  }
  globalThis.kino.lang = "es";
});
