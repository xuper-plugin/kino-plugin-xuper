// Kino's side of the configuration screen, in Node: the trees and answers go through the kit's own readers
// (sdk/screen.mjs: the app's PluginScreenOutput rules), and the harness keeps what Kino keeps between calls: the state
// (patches merged key by key, `null` removes), the route stack, the settings an answer's `config` writes, and the
// secret fields' text (only for the call of the person's press, then gone).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateManifest } from "../../sdk/contract.mjs";
import { checkScreenAnswer, checkScreenTree, childNodes, fakeScreenContext, fakeScreenEvent } from "../../sdk/screen.mjs";
import { makeScreen } from "../../src/screen.js";

const TEXT = readFileSync(new URL("../../kino-plugin.json", import.meta.url), "utf8");
/** The settings list a Kino of apiVersion 14 reads (the enhanced one). */
export const SETTINGS = validateManifest(TEXT).manifest.settings;
export const SECRET_INPUTS = ["signinPw", "regPw"];
const plain = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/** Every node of a checked tree, depth first. */
export function allNodes(n, out = []) {
  if (!n || typeof n !== "object") return out;
  out.push(n);
  for (const c of childNodes(n)) allNodes(c, out);
  for (const k of ["leading", "trailing"]) if (n[k] && typeof n[k] === "object") allNodes(n[k], out);
  return out;
}
export const byKey = (tree, key) => allNodes(tree).find((n) => n.key === key) ?? null;

export function screenHarness(world, { device = "phone", lang = "es", deps } = {}) {
  const ui = makeScreen({
    kino: world.kino, clock: world.clock,
    deps: deps ?? (() => ({ settings: world.settings, session: world.session, registration: world.registration })),
  });
  let state = { inputs: {}, ui: { hidden: {}, enabled: {}, open: {} } };
  const routes = [{ name: "main", params: {} }];
  const seen = { trees: [], answers: [], toasts: [], configs: [] };
  const route = () => routes[routes.length - 1];

  async function render() {
    const raw = await ui.screen(fakeScreenContext({ state: plain(state), route: route(), device, lang }));
    const r = checkScreenTree(plain(raw), lang, undefined, { settings: SETTINGS });
    seen.trees.push(JSON.stringify(raw));
    return { raw, tree: r.tree, dropped: r.dropped, every: r.every };
  }

  function apply(a) {
    if (!a) return;
    if (a.state) {
      for (const [k, v] of Object.entries(a.state)) {
        if (k === "inputs" && v && typeof v === "object") state.inputs = { ...state.inputs, ...v };
        else if (v === null) delete state[k];
        else state[k] = v;
      }
    }
    if (a.route) { if (a.route.pop) { if (routes.length > 1) routes.pop(); } else routes.push({ name: a.route.push, params: a.route.params ?? {} }); }
    if (a.config) {
      seen.configs.push(Object.keys(a.config).sort());
      for (const [k, v] of Object.entries(a.config)) { if (v === null || v === "") delete world.saved[k]; else world.saved[k] = v; }
    }
  }

  /** Sends event `name` as Kino would; `inputs` are what the person typed (secret ones only for this call). */
  async function send(name, { arg, value, inputs, timer = false } = {}) {
    if (inputs) state.inputs = { ...state.inputs, ...inputs };
    const raw = await ui.screenEvent(fakeScreenEvent(name, { arg, value, state: plain(state), route: route(), device, lang }));
    // A secret field's text lives only for the call of the press that carried it.
    for (const k of SECRET_INPUTS) delete state.inputs[k];
    const r = checkScreenAnswer(plain(raw), lang, { settings: SETTINGS, timer });
    assert.deepEqual(r.dropped, [], `${name}: Kino dropped nothing of the answer`);
    seen.answers.push(JSON.stringify(raw));
    if (raw && raw.toast) seen.toasts.push(JSON.stringify(raw.toast));
    apply(raw);
    return { raw, answer: r.answer };
  }

  return {
    ui, render, send, seen,
    get state() { return state; },
    set state(s) { state = s; },
    route: () => route().name,
    push: (name) => routes.push({ name, params: {} }),
  };
}
