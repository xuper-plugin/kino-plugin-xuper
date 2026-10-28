// The configuration screen drawn with Kino's kit (sdk/screen.mjs reads every tree as the app does), over the real
// session, registration and settings logic and a scripted portal (test/helpers/accountWorld.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { accountWorld } from "./helpers/accountWorld.mjs";
import { screenHarness, allNodes, byKey } from "./helpers/screenHarness.mjs";
import { DEVICES, STATES, EMAIL, worldIn, assertNoSecrets, tabs } from "./helpers/screenWorlds.mjs";
import { maskEmail, initialOf } from "../src/screenModel.js";
import { TABS, PLUGIN_VERSION } from "../src/screenView.js";
import { modernKit } from "../src/screen.js";
import { createKino } from "../sdk/kino-shim.mjs";
import { loadPlugin } from "../sdk/sandbox.mjs";
import { validate } from "../sdk/validate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "kino-plugin.json"), "utf8"));
const quiet = { log() {}, info() {}, warn() {}, error() {} };

test("every tab and every page draws with nothing dropped, on the phone and on the TV, in each account state", async () => {
  for (const device of DEVICES) {
    for (const name of STATES) {
      const w = await worldIn(name);
      const h = screenHarness(w, { device });
      for (const [tab, r] of Object.entries(await tabs(h))) assert.deepEqual(r.dropped, [], `${device} ${name} ${tab}`);
      for (const page of ["signin", "register"]) {
        h.push(page);
        for (const step of page === "register" ? ["email", "code", "done"] : [null]) {
          if (step) h.state.reg = { step, email: EMAIL, emailMasked: maskEmail(EMAIL), sentAt: w.clock.now(), loggedIn: step === "done" ? false : undefined };
          const r = await h.render();
          assert.deepEqual(r.dropped, [], `${device} ${name} ${page} ${step}`);
        }
      }
      assertNoSecrets(h.seen.trees);
    }
  }
});

test("the main page: Kino's Scaffold, an app bar with refresh and help, three tabs; the TV has no copy button", async () => {
  for (const device of DEVICES) {
    const h = screenHarness(accountWorld(), { device });
    const r = await h.render();
    assert.equal(r.raw.type, "Scaffold");
    assert.deepEqual(r.raw.appBar.bottom.tabs.map((t) => t.value), TABS);
    assert.deepEqual(r.raw.appBar.actions.map((a) => a.icon), ["refresh", "help"]);
    h.state.tab = "more";
    const more = await h.render();
    assert.deepEqual(byKey(more.tree, "copyDiag").devices, ["phone", "desktop"], device);
  }
});

test("the TV gets the same pages; the registration tells it is easier on the phone", async () => {
  const h = screenHarness(accountWorld(), { device: "tv" });
  h.push("register");
  h.state.reg = { step: "email" };
  const r = await h.render();
  const note = allNodes(r.tree).find((n) => n.text === "Es más cómodo en el teléfono: tus ajustes se sincronizan con este aparato.");
  assert.deepEqual(note.devices, ["tv"]);
  assert.equal(byKey(r.tree, "regEmailInput").autofocus, true, "the remote lands on the field");
});

test("masking: an email shows its first letter, the domain's first letter and the last label only", () => {
  assert.equal(maskEmail("persona@ejemplo.test"), "p•••@e•••.test");
  assert.equal(maskEmail(" Ana.Maria@gmail.com "), "A•••@g•••.com");
  assert.equal(maskEmail("x@localhost"), "x•••@l•••");
  for (const bad of ["", "nope", "@x.com", "a@", null, undefined, 5]) assert.equal(maskEmail(bad), "", String(bad));
  assert.equal(initialOf("ana@x.test"), "A");
  assert.equal(initialOf("_x@y.z"), "?");
});

test("the plugin's version in the diagnostics is the manifest's", () => {
  assert.equal(PLUGIN_VERSION, MANIFEST.version);
});

test("the kit run of the built plugin draws the screen with nothing dropped (phone and TV)", () => {
  for (const device of DEVICES) {
    const out = spawnSync(process.execPath, [join(ROOT, "sdk", "run.mjs"), "--device", device, ROOT, "screen"], { encoding: "utf8", cwd: ROOT });
    assert.equal(out.status, 0, out.stderr);
    assert.doesNotMatch(out.stderr, /dropped|refused/i);
  }
});

test("the built plugin exports screen and screenEvent next to the old exports, and Kino would accept it with the block merged", async () => {
  const v = await validate(ROOT);
  assert.equal(v.ok, true, JSON.stringify(v));
  const { kino } = createKino(MANIFEST, { lang: "es-CO" });
  const { plugin } = await loadPlugin(join(ROOT, "plugin.js"), kino, { console: quiet });
  for (const f of ["screen", "screenEvent", "settingsStatus", "action", "validateSettings"]) assert.equal(typeof plugin[f], "function", f);
  const tree = await plugin.screen({ state: { inputs: {}, ui: { hidden: {}, enabled: {}, open: {} } }, route: { name: "main", params: {} }, device: "phone", lang: "es" });
  assert.equal(tree.type, "Scaffold");
  assert.equal(await plugin.screenEvent({ name: "nope", state: {} }), null);
});

test("an older screen kit (no steps, secret fields or press budgets) gets Kino's own form, exactly the old one", async () => {
  const w = accountWorld();
  const kino = Object.freeze({ ...w.kino, screen: Object.freeze({ names: Object.freeze(["Column", "settings", "Text"]), widgets: [], version: 1 }) });
  assert.equal(modernKit(kino), false);
  assert.equal(modernKit(w.kino), true);
  assert.equal(modernKit({}), false);
  assert.equal(modernKit(null), false);
  const h = screenHarness({ ...w, kino });
  for (const page of ["main", "signin", "register"]) {
    if (page !== "main") h.push(page);
    const r = await h.render();
    assert.deepEqual(r.dropped, []);
    assert.ok(allNodes(r.tree).some((n) => n.type === "settings"), "Kino's settings form");
    assert.equal(allNodes(r.tree).some((n) => n.secret === true || n.type === "steps"), false);
  }
});
