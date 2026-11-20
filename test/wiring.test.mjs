import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Kino injects `kino` as a global; a minimal shim so importing the bundle does not blow up.
globalThis.kino = globalThis.kino || { error: (code, msg) => Object.assign(new Error(msg), { code }) };
const p = await import("../plugin.js");

test("the bundle exports every declared capability's functions", () => {
  for (const k of ["screen", "screenEvent", "home", "search", "episodes", "resolve", "liveCategories", "liveChannels", "browse",
    "migrate", "categories", "prepare"]) {
    assert.equal(typeof p[k], "function", `missing export: ${k}`);
  }
});

test("manifest: the update of Xuper 2.x (same id and entry), apiVersion 27, identity + relay + live", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  // Kino updates an installed plugin only to a manifest with the SAME id read at the same address: "xuper", from
  // xuper-plugin/kino-plugin-xuper (Kino refuses another id there: "esta dirección ahora publica otro plugin").
  assert.equal(m.id, "xuper");
  assert.equal(m.name, "Xuper");
  assert.equal(m.entry, "plugin.js");
  assert.equal(m.icon, "icon.png");
  // apiVersion 27 = Kino 0.9.88, the first Kino that gives kino.identity's token to the xuper-plugin author key
  // (PluginIdentityBridge TOKEN_AUTHORS): an older Kino keeps 2.x and asks to update Kino instead of installing a 3.0.0
  // that could never sign in.
  assert.equal(m.apiVersion, 27);
  for (const cap of ["identity", "screen", "home", "search", "episodes", "resolve", "channels", "browse", "migrate", "drm", "storageLarge"]) {
    assert.ok(m.capabilities.includes(cap), `missing capability: ${cap}`);
  }
  // Reachable as 2.x was: the menu entry, and a button on its settings page ("Abrir Xuper").
  assert.equal(m.screen.label, "Xuper");
  assert.deepEqual(m.screen.opensFrom, ["menu", "settings"]);
  assert.deepEqual(m.screen.settingsButton, { label: "Abrir Xuper", labelEn: "Open Xuper" });
  assert.equal(m.screen.menuOpens, "screen");
  // The relay posts to portal hosts that ROTATE → fetchHosts "any"; the player reads from the CDN → streamHosts "any"
  assert.equal(m.fetchHosts, "any");
  assert.equal(m.streamHosts, "any");
  assert.equal(m.liveStreamHosts, "any");
  // No `server` setting (an address typed there would receive the identity token); 2.x's contributeSeeds stays as it was
  // (same key, type and default: its value carries over).
  assert.deepEqual(m.settings.map((s) => [s.key, s.type, s.default]), [["contributeSeeds", "toggle", true]]);
  assert.ok(!m.settings.some((s) => s.type === "url"));
  assert.ok(!m.secrets, "no sealed secrets: the portal secret comes from the backend");
});

test("the backend is the manifest's first declared host, on the plugin's own domain", async () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  const { DEFAULT_SERVER } = await import("../src/config.js");
  // Declared, so the consent sheet names it and a later move would not ask everyone again for a host they never saw.
  assert.equal(DEFAULT_SERVER, "https://" + m.hosts[0].host);
  assert.equal(m.hosts[0].insecureHttp, undefined, "the backend is https");
  // Nothing in the published files may name the domain the backend used before 3.0.0 (it belongs to other services).
  // Built from parts so this test does not publish the name either.
  const oldDomain = ["comparador", "internet"].join("");
  for (const f of ["../kino-plugin.json", "../plugin.js", "../README.md"]) {
    assert.ok(!readFileSync(new URL(f, import.meta.url), "utf8").includes(oldDomain), f + " names the old backend domain");
  }
});

// ── 1.0.45 wiring ──
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
function srcFiles(dir = SRC) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (n.endsWith(".js")) out.push(p);
  }
  return out;
}

test("the manifest version equals PLUGIN_VERSION (bumped together)", async () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  const { PLUGIN_VERSION } = await import("../src/config.js");
  assert.equal(m.version, PLUGIN_VERSION);
  assert.equal(m.version, "3.0.5");
});

test("the manifest id equals PLUGIN_ID, the id the session request declares", async () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  const { PLUGIN_ID } = await import("../src/config.js");
  assert.equal(m.id, PLUGIN_ID);
  assert.equal(PLUGIN_ID, "xuper");
  // The bundle Kino runs sends it too (plugin.js is built from src).
  const bundle = readFileSync(new URL("../plugin.js", import.meta.url), "utf8");
  assert.match(bundle, /pluginId:\s*PLUGIN_ID/);
});

test("every storage key in the sources starts with o2: (src/store.js sweepOld removes any other: Xuper 2.x's)", async () => {
  const { KEY_PREFIX } = await import("../src/store.js");
  const found = [];
  for (const f of srcFiles()) {
    const code = readFileSync(f, "utf8");
    for (const m of code.matchAll(/\b(?:getText|getJson|setText|setJson|remove)\(\s*"([^"\s]+)"\s*[,)]/g)) found.push([f, m[1]]);
    for (const m of code.matchAll(/\b[A-Z][A-Z0-9_]*KEYS?\s*=\s*"([^"]+)"/g)) found.push([f, m[1]]);
    for (const m of code.matchAll(/\bKEYS\s*=\s*\{([^}]*)\}/g)) for (const v of m[1].matchAll(/"([^"]+)"/g)) found.push([f, v[1]]);
  }
  assert.ok(found.length > 20, "the scan finds the keys");
  const bad = found.filter(([, k]) => !k.startsWith(KEY_PREFIX)).map(([f, k]) => f + ": " + k);
  assert.deepEqual(bad, []);
});

test("the published data, the Release and the publisher all name this repository", async () => {
  const { DATA_BASE, RELEASE_BASE } = await import("../src/config.js");
  assert.equal(DATA_BASE, "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/data/");
  assert.equal(RELEASE_BASE, "https://github.com/xuper-plugin/kino-plugin-xuper/releases/download/catalog");
  const { REPO } = await import("../tools/publish-data.mjs");
  assert.equal(REPO, "xuper-plugin/kino-plugin-xuper");
  assert.match(readFileSync(new URL("../tools/publish.sh", import.meta.url), "utf8"), /^REPO="xuper-plugin\/kino-plugin-xuper"$/m);
});

test("no kino.storage call outside src/store.js (every value goes through the text-only helpers)", () => {
  for (const f of srcFiles()) {
    if (f.endsWith("/src/store.js")) continue;
    const code = readFileSync(f, "utf8");
    assert.ok(!/kino\.storage\.(set|get|remove|keys)\s*\(/.test(code), "kino.storage call in " + f);
  }
});

test("no 1 s skeleton tick and no catalog fetch inside the views", () => {
  for (const f of srcFiles()) {
    const code = readFileSync(f, "utf8");
    assert.ok(!/event:\s*"tick"/.test(code), "tick timer in " + f);
  }
  const view = readFileSync(join(SRC, "screenView.js"), "utf8");
  assert.ok(!/kino\.fetch/.test(view));
});

test("every export starts a call (beginCall) before doing anything", async () => {
  const { installKino } = await import("./helpers/fake-kino.mjs");
  installKino({ noFetch: true });
  const plugin = await import("../src/plugin.js");
  const { callSeq } = await import("../src/flight.js");
  const calls = {
    screen: [{ state: {} }], screenEvent: [{ name: "other", state: {} }], home: [], search: ["x"],
    episodes: ["v:1:0"], resolve: ["v:1:1"], browse: ["cat:pelicula", null], liveCategories: [], liveChannels: [{ categoryId: "x.00" }],
  };
  for (const [name, args] of Object.entries(calls)) {
    const before = callSeq();
    try { await plugin[name](...args); } catch (_) { /* no network / no Bearer: only the call start matters */ }
    assert.ok(callSeq() >= before + 1, name + " does not call beginCall()");
  }
});

// ── 1.0.45 live framework wiring ──

test("live connectors fetch only through liveFetch (≤ 5 in flight, the call's deadline); no fire-and-forget left", () => {
  for (const f of srcFiles(join(SRC, "sources"))) {
    const code = readFileSync(f, "utf8");
    assert.ok(!/kino\.fetch\s*\(/.test(code), "kino.fetch in " + f + " (use liveFetch from ../liveGate.js)");
  }
  for (const f of srcFiles()) {
    const code = readFileSync(f, "utf8");
    assert.ok(!/refreshSrcCatsBg|liveCategoriesFast|function bg\(/.test(code), "background refresh left in " + f);
  }
});

test("connectors reach the framework's data only through ctx: no import of liveStore.js / live.js, one 18+ rule", () => {
  for (const f of srcFiles(join(SRC, "sources"))) {
    const code = readFileSync(f, "utf8");
    assert.ok(!/from\s+["']\.\.\/(liveStore|live)\.js["']/.test(code), "framework store imported in " + f + " (use ctx.storedList / ctx.listMeta / listTtl's category)");
    if (!f.endsWith("adult.js")) assert.ok(!/\b(ADULT_RE|ADULT_COLUMN)\s*=/.test(code), "own 18+ regex in " + f + " (use isAdultTitle from ./adult.js)");
  }
});

test("SOURCES: every connector has the contract; cncverse-tv is gone; code-only flags make no request", async () => {
  const { installKino } = await import("./helpers/fake-kino.mjs");
  const { beginCall } = await import("../src/flight.js");
  const { SOURCES } = await import("../src/sources/index.js");
  installKino({ noFetch: true });
  beginCall();
  const ids = SOURCES.map((s) => s.id);
  // supertv2 / supertv3 (1.0.46): supertv's other panels, always last (none of their channels ever leads a merged one)
  assert.deepEqual(ids, ["tvenvivo", "caracol", "cablevisionhd", "premiumtv", "supertv", "futbollibre", "nuvio-sports", "deportv", "cncverse", "xuper", "supertv2", "supertv3"]);
  assert.deepEqual(SOURCES.filter((s) => s.secondaryOf).map((s) => s.id + "→" + s.secondaryOf), ["supertv2→supertv", "supertv3→supertv"]);
  assert.deepEqual(SOURCES.filter((s) => typeof s.accountOf === "function").map((s) => s.id), ["supertv", "supertv2", "supertv3"]);
  for (const s of SOURCES.filter((x) => x.secondaryOf)) assert.equal(typeof s.active, "function", s.id + ".active");
  for (const s of SOURCES) {
    for (const fn of ["categories", "channels", "resolve"]) assert.equal(typeof s[fn], "function", s.id + "." + fn);
    if (s.codeCategories === true) {
      const cats = await s.categories({});
      assert.ok(Array.isArray(cats) && cats.length > 0, s.id + " code categories");
      for (const c of cats) {
        const isCodeList = typeof s.codeList === "function" ? s.codeList(c.id) : s.codeList === true;
        if (isCodeList) assert.ok(Array.isArray(await s.channels(c.id, {})), s.id + " code list " + c.id);
      }
    }
  }
  assert.deepEqual(SOURCES.filter((s) => s.codeCategories === true).map((s) => s.id),
    ["tvenvivo", "caracol", "cablevisionhd", "futbollibre", "nuvio-sports"]);
});

test("no dead code from the cache pass: every export of its modules has a caller in src/ or tools/, and no re-export kept for tests", () => {
  const read = (f) => readFileSync(new URL("../" + f, import.meta.url), "utf8");
  const NEW = ["src/flight.js", "src/liveGate.js", "src/liveStore.js", "src/store.js", "src/net.js", "src/data.js", "src/v2.js",
    "src/items.js", "src/live.js", "src/liveMap.js", "src/liveMerge.js", "src/liveTitles.js", "src/sources/adult.js", "src/sources/panels.js", "src/seeds.js", "src/seedContrib.js",
    "src/legacy.js", "src/upgrade.js"];
  const ALL = [...NEW, "src/api.js", "src/catalog.js", "src/config.js", "src/plugin.js", "src/refs.js", "src/screen.js", "src/screenView.js",
    ...["cablevisionhd", "caracol", "cncverse", "deportv", "futbollibre", "index", "m3u", "nuvio-sports", "panels", "sports", "stremio", "supertv",
      "tvenvivo", "xtream", "xuper"].map((s) => "src/sources/" + s + ".js"),
    "tools/to-v2.mjs", "tools/publish-data.mjs", "tools/golden.mjs", "tools/publish-state.mjs"];
  const text = Object.fromEntries(ALL.map((f) => [f, read(f)]));
  const dead = [];
  for (const f of NEW) {
    for (const m of text[f].matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) {
      const name = m[1];
      if (name.startsWith("_")) continue;   // test helpers (_resetMemory, _setSources, …)
      const re = new RegExp("\\b" + name + "\\b", "g");
      const own = (text[f].match(re) || []).length;
      const elsewhere = ALL.some((o) => o !== f && re.test(text[o]));
      if (own < 2 && !elsewhere) dead.push(f + ": " + name);
    }
  }
  assert.deepEqual(dead, [], "exports nothing calls (delete them; tests use the real function)");
  for (const f of ALL.filter((x) => x.startsWith("src/"))) {
    assert.ok(!/export\s*\{/.test(text[f]), f + " re-exports names: import them from the module that defines them");
  }
});

// ── virtual categories and merged channels (src/liveMap.js, src/liveMerge.js) ──

test("DRM_DECLARED says whether the manifest declares `drm`; no source is named `v` (virtual ids are `v.<…>`)", async () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url)));
  const { DRM_DECLARED } = await import("../src/config.js");
  assert.equal(DRM_DECLARED, m.capabilities.includes("drm"));
  const { SOURCES } = await import("../src/sources/index.js");
  assert.ok(!SOURCES.some((s) => s.id === "v" || s.id.includes(",") || s.id.includes(":") || s.id.includes("|")), "source ids split merged refs");
  assert.ok(SOURCES.every((s) => /^[a-z0-9-]{1,40}$/.test(s.id)), "a merged ref's member written by its Kino id `<source>_<hash>` splits at the last \"_\"");
  assert.deepEqual(SOURCES.filter((s) => s.drm).map((s) => s.id), ["caracol"]);
  assert.deepEqual(SOURCES.filter((s) => s.blind).map((s) => s.id), ["premiumtv", "supertv", "supertv2", "supertv3"]);
  assert.deepEqual(SOURCES.filter((s) => s.sharedFetch).map((s) => s.id), ["cablevisionhd", "premiumtv", "deportv"]);
});

test("the mapping and the merge are pure: no storage, no fetch, no flight", () => {
  for (const f of ["liveMap.js", "liveMerge.js", "liveTitles.js"]) {
    const code = readFileSync(join(SRC, f), "utf8");
    assert.ok(!/kino\.(storage|fetch)|liveFetch|from\s+["']\.\/(store|liveStore|liveGate|flight|live)\.js["']/.test(code), f);
  }
});
