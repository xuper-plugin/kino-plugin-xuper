// Seeds on the screen and the secrecy rule (seed design §7, §9 tests 20, 24, 25): the two Ajustes cards in every state,
// in ES and EN; "Cambiar semilla" only on a seed; its toasts; the Aportar switch; the manifest's telemetry and setting;
// and no seed or session secret in any log, report, error, screen tree or screen state — the live tabs' channel tiles
// and supertv's other panels (1.0.46) included: their logs name hosts and account hashes, never an Xtream user or password.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { world, poolSeed, portalError, T0, MIN, BEARER } from "./helpers/seed-world.mjs";
import { res } from "./helpers/fake-kino.mjs";
import { stvWorld, credsOf, hostOf, PLAYLIST } from "./helpers/stv-world.mjs";

globalThis.kino = { lang: "es", config: {} };
const xmod = await import("../src/sources/xuper.js");
const seeds = await import("../src/seeds.js");
const { beginCall, callFor } = await import("../src/flight.js");
const { clearBearer } = await import("../src/api.js");
const { configView } = await import("../src/screenView.js");
const plugin = await import("../src/plugin.js");
const live = await import("../src/live.js");
const ls = await import("../src/liveStore.js");
const C = await import("../src/seedContrib.js");
const xuper = xmod.default;

const realNow = Date.now;
test.afterEach(() => { Date.now = realNow; kino.lang = "es"; live._setSources(null); });

async function device(opts = {}) {
  const w = await world(opts);
  await clearBearer();
  if (opts.bearer !== false) w.kino.storage.set("o2:bearer", BEARER);
  const settings = opts.settings || {};
  w.kino.config = { get: (k) => settings[k] };
  xmod._resetSession();
  seeds._newRuntime();
  ls._resetMemory();
  return w;
}
const call = (name) => { beginCall(); callFor(name); };

/** Every text of a tree, as the person reads it in Spanish and in English. */
function texts(node, out = []) {
  if (Array.isArray(node)) { for (const n of node) texts(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  for (const k of ["text", "textEn", "labelText", "labelTextEn", "title", "titleEn"]) if (typeof node[k] === "string") out.push(node[k]);
  for (const v of Object.values(node)) if (v && typeof v === "object") texts(v, out);
  return out;
}
const keysOf = (node, out = new Set()) => {
  if (Array.isArray(node)) { for (const n of node) keysOf(n, out); return out; }
  if (!node || typeof node !== "object") return out;
  if (typeof node.key === "string") out.add(node.key);
  for (const v of Object.values(node)) if (v && typeof v === "object") keysOf(v, out);
  return out;
};

// ── 25: the Ajustes cards in every state ──

test("25. Ajustes ▸ Sesión de Xuper in every state (own, seed with time left, none, blocked, 429, 503), in ES and EN; Cambiar semilla only on a seed", () => {
  const states = {
    own: { kind: "own", leftMin: 0, geo: false, wait: null },
    seed: { kind: "seed", leftMin: 212, geo: true, wait: null },
    seedUnknown: { kind: "seed", leftMin: null, geo: false, wait: null },
    none: { kind: "none", leftMin: 0, geo: false, wait: null },
    blocked: { kind: "none", leftMin: 0, geo: true, wait: null },
    ownBlocked: { kind: "own", leftMin: 0, geo: true, wait: null },
    r429: { kind: "own", leftMin: 0, geo: true, wait: { why: "429", min: 41 } },
    cap: { kind: "seed", leftMin: 45, geo: true, wait: { why: "cap", min: 7 } },
    r503: { kind: "none", leftMin: 0, geo: true, wait: { why: "503", min: 4 } },
  };
  const expect = {
    own: ["Sesión: propia (anónima)", "Session: your own (anonymous)"],
    seed: ["Sesión: de respaldo (semilla) · le quedan 3 h 32 min", "Session: backup (seed) · 3 h 32 min left"],
    seedUnknown: ["Sesión: de respaldo (semilla)", "Session: backup (seed)"],
    none: ["Sesión: todavía ninguna", "Session: none yet"],
    blocked: ["Tu zona: bloqueada por Xuper", "Your region: blocked by Xuper"],
    // contract-ux-F3: an own session Xuper blocks is not shown as plainly working
    ownBlocked: ["Sesión: propia (anónima) · bloqueada", "Session: your own (anonymous) · blocked"],
    r429: ["Ya se usaron las sesiones de respaldo de esta hora. Podrás pedir otra en 41 min.", "This hour's backup sessions are used up. You can ask for another in 41 min."],
    cap: ["Ya se usaron las sesiones de respaldo de esta hora. Podrás pedir otra en 7 min.", "This hour's backup sessions are used up. You can ask for another in 7 min."],
    // contract-ux-F3: the 503 wait says when, not a promise the backoff breaks
    r503: ["Ahora no hay sesiones de respaldo libres. Se puede pedir otra en 4 min.", "No backup sessions are free right now. Another one can be requested in 4 min."],
  };
  for (const lang of ["es", "en"]) {
    kino.lang = lang;
    for (const [name, s] of Object.entries(states)) {
      const tree = configView({ version: "1.0.46", seeds: s, contrib: { on: true, at: null }, now: T0 });
      const all = texts(tree);
      const [es, en] = expect[name];
      assert.ok(all.includes(lang === "en" ? en : es), name + " " + lang + ": " + JSON.stringify(all.filter((t) => /Ses|zona|region|hora|hour|libres|free/.test(t))));
      assert.ok(all.includes(en), name + ": the English text rides along (textEn)");
      const button = keysOf(tree).has("seedChange");
      const usedUp = !!s.wait && (s.wait.why === "429" || s.wait.why === "cap");
      assert.equal(button, s.kind === "seed" && !usedUp, name + ": Cambiar semilla only on a seed, never under the used-up line");
      if (s.kind === "own") assert.equal(all.includes(lang === "en" ? "Session: your own (anonymous)" : "Sesión: propia (anónima)"), !s.geo, name + ": plainly own only when not blocked");
      assert.equal(all.includes(lang === "en" ? "Your region: blocked by Xuper" : "Tu zona: bloqueada por Xuper"), s.geo, name + ": the region line only when blocked");
      const cards = tree.body.children[1].children[0].children.map((c) => c.key);
      assert.deepEqual(cards, ["cfgAccount", "cfgSupport", "cfgXuper", "cfgContrib", "cfgData", "cfgAbout"], "the two cards between Apoyar and Datos");
    }
    const seedTree = configView({ seeds: states.seed, contrib: { on: true, at: null } });
    assert.ok(texts(seedTree).includes(lang === "en" ? "Change seed" : "Cambiar semilla"));
    assert.ok(texts(seedTree).includes(lang === "en" ? "Asks for another backup session if this one goes wrong" : "Pide otra sesión de respaldo si esta va mal"));
    assert.ok(texts(seedTree).includes(lang === "en" ? "What are seeds?" : "¿Qué son las semillas?"));
  }
});

test("25b. Ajustes ▸ Aportar: the switch on the setting, the help, the last contribution or none, what is shared (ES and EN)", () => {
  for (const lang of ["es", "en"]) {
    kino.lang = lang;
    const E = lang === "en";
    const never = configView({ seeds: null, contrib: { on: true, at: null }, now: T0 });
    const sw = JSON.parse(JSON.stringify(never)).body.children[1].children[0].children.find((c) => c.key === "cfgContrib").children[1];
    assert.equal(sw.type, "Switch");
    assert.equal(sw.value, true);
    assert.deepEqual(sw.onChanged, { event: "contrib" });
    assert.equal(sw.labelText, E ? "Share an anonymous session" : "Aportar una sesión anónima");
    assert.ok(texts(never).includes(E ? "This device has not contributed yet." : "Este aparato aún no ha aportado."));
    assert.ok(texts(never).includes(E ? "What is shared?" : "¿Qué se comparte?"));
    assert.ok(texts(never).some((t) => t.startsWith(E ? "Now and then it shares a new anonymous session" : "De vez en cuando comparte una sesión anónima nueva")));
    const off = configView({ seeds: null, contrib: { on: false, at: T0 - 125 * MIN }, now: T0 });
    assert.equal(off.body.children[1].children[0].children.find((c) => c.key === "cfgContrib").children[1].value, false);
    assert.ok(texts(off).includes(E ? "Last contribution 2 h ago" : "Último aporte hace 2 h"));
  }
});

test("the screen draws the real state: own, then a seed after a geo-block, the 503 line, and the contribution stamp", async () => {
  const w = await device({ pool: [poolSeed(1, 3 * 3600)] });
  call("liveCategories"); await xuper.categories({});
  call("screen");
  let tree = await plugin.screen({ state: { nav: "config" } });
  assert.ok(texts(tree).includes("Sesión: propia (anónima)"));
  assert.ok(!keysOf(tree).has("seedChange"));
  w.handlers.getNextColumns = (b) => (String(b.userToken).startsWith("SEEDTOK") ? undefined : portalError("portal100024"));
  call("liveCategories"); await xuper.categories({});
  w.kino.storage.set(C.AT_KEY, String(Date.now() - 30 * MIN));
  call("screen");
  tree = await plugin.screen({ state: { nav: "config" } });
  assert.ok(texts(tree).some((t) => /^Sesión: de respaldo \(semilla\) · le quedan (3 h|2 h 59 min)$/.test(t)), JSON.stringify(texts(tree).filter((t) => t.startsWith("Ses"))));
  assert.ok(texts(tree).includes("Tu zona: bloqueada por Xuper"));
  assert.ok(texts(tree).includes("Último aporte hace 30 min"));
  assert.ok(keysOf(tree).has("seedChange"));
  // 503 on the next need
  seeds.drop(seeds.held(), "dead");
  call("liveCategories"); await xuper.categories({}).catch(() => {});
  call("screen");
  tree = await plugin.screen({ state: { nav: "config" } });
  assert.ok(texts(tree).includes("Ahora no hay sesiones de respaldo libres. Se puede pedir otra en 2 min."));
  assert.ok(texts(tree).includes("Sesión: propia (anónima) · bloqueada"), "the own session is still held, and geo-blocked on content");
  assert.ok(!texts(tree).includes("Sesión: propia (anónima)"));
  // 30 s later the live list opens again: no GET (the 503 backoff), and the card still says when
  w.advance(30_000);
  const gets = w.gets;
  call("liveCategories"); await xuper.categories({}).catch(() => {});
  assert.equal(w.gets, gets);
  call("screen");
  assert.ok(texts(await plugin.screen({ state: { nav: "config" } })).includes("Ahora no hay sesiones de respaldo libres. Se puede pedir otra en 2 min."));
});

test("screen events: Cambiar semilla's toasts (changed, 503, this hour, offline, 401) in ES and EN; the Aportar switch writes the setting", async () => {
  const held = (w) => w.kino.storage.set("o2:xseed", JSON.stringify({ v: 1, sn: "5eedx", userId: "SEEDUID-SECRET-x", userToken: "SEEDTOK-SECRET-x", gotAt: Date.now(), lifeMs: 3600_000 }));
  const cases = [
    [{ pool: [poolSeed(2)] }, "Semilla cambiada", "Seed changed", "success"],
    [{ seedAnswer: () => res(503, "{}") }, "Ahora no hay sesiones de respaldo libres; inténtalo en unos minutos.", "No backup sessions are free right now; try again in a few minutes.", "warning"],
    [{ seedAnswer: () => res(429, "{}") }, /^Ya pediste muchas sesiones de respaldo esta hora; podrás pedir otra en 5[5-7] min\.$/, /^You asked for many backup sessions this hour; you can ask for another in 5[5-7] min\.$/, "warning"],
    [{ seedAnswer: () => new Error("offline") }, "Sin conexión, reintenta", "No connection, try again", "error"],
    [{ seedAnswer: () => res(401, "{}") }, "La sesión venció. Abre la pantalla de Xuper para reconectarte.", "The session expired. Open the Xuper screen to reconnect.", "warning"],
  ];
  for (const lang of ["es", "en"]) {
    for (const [opts, es, en, role] of cases) {
      const w = await device({ ...opts, lang });
      held(w);
      kino.lang = lang;
      call("screenEvent");
      const out = await plugin.screenEvent({ name: "seedChange", state: { nav: "config" } });
      const want = lang === "en" ? en : es;
      if (want instanceof RegExp) assert.match(out.toast.text, want); else assert.equal(out.toast.text, want);
      if (en instanceof RegExp) assert.match(out.toast.textEn, en); else assert.equal(out.toast.textEn, en);
      assert.equal(out.toast.role, role);
      assert.equal(w.gets, 1, "one GET per tap");
      assert.deepEqual(out.ui, [{ hide: "busy" }]);
    }
  }
  const w = await device();
  call("screenEvent");
  assert.deepEqual((await plugin.screenEvent({ name: "contrib", value: false, state: {} })).config, { contributeSeeds: false });
  call("screenEvent");
  assert.deepEqual((await plugin.screenEvent({ name: "contrib", value: true, state: {} })).config, { contributeSeeds: true });
  assert.equal(w.gets, 0);
});

// ── 24: the manifest ──

test("24. manifest: telemetry true, the contributeSeeds toggle (default on) with its ES and EN texts, version 3.0.9", () => {
  const m = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
  assert.equal(m.version, "3.1.12");
  assert.equal(m.telemetry, true, "the error board reports (kino.log.report) need telemetry declared");
  const s = m.settings.find((x) => x.key === "contributeSeeds");
  assert.deepEqual(s, {
    key: "contributeSeeds", label: "Aportar una sesión anónima", labelEn: "Share an anonymous session", type: "toggle", default: true,
    hint: "Comparte una sesión anónima para zonas bloqueadas. Puedes apagarlo.", hintEn: "Shares an anonymous session for blocked regions. You can turn it off.",
  });
  assert.ok(!m.settings.some((x) => x.key === "autoRefreshSeeds" || x.key === "switchSeed" || x.key === "refreshSeeds"), "no pool settings: there is no pool");
});

// ── 20: secrecy ──

test("20. secrecy: no sn, userId, userToken or jwtToken value (seed's, own or shared), Bearer or key in any log, report, error, screen tree or screen state", async () => {
  const seen = [];             // everything the plugin let out, as text
  const keep = (x) => { if (x !== undefined) seen.push(typeof x === "string" ? x : JSON.stringify(x)); };
  const keepError = (e) => { keep(e && e.message); keep(e && e.userMessage); keep(e && e.code); keep(String(e)); };
  const worlds = [];
  const run = async (opts, body) => {
    const w = await device(opts);
    worlds.push(w);
    try { await body(w); } catch (e) { keepError(e); }
    for (const l of w.logs) keep(l);
    for (const r of w.reports) keep(r);
  };
  // Ajustes, and with `liveTabs` the two live tabs (src/screenView.js channel tiles), each on a phone and a TV
  const LIVE_TABS = [{ nav: "vivo", lcTried: true }, { nav: "deportes", depTab: "canales", lcTried: true }];
  const screens = async ({ liveTabs = false, onTree = keep, cat } = {}) => {
    for (const lang of ["es", "en"]) {
      kino.lang = lang;
      call("screen"); onTree(await plugin.screen({ state: { nav: "config" } }));
      if (liveTabs) {
        for (const state of LIVE_TABS) {
          const at = cat ? { liveCat: cat, sportsCat: cat } : {};
          for (const device of ["phone", "tv"]) { call("screen"); onTree(await plugin.screen({ state: { ...state, ...at }, device })); }
        }
      }
    }
    kino.lang = "es";
  };
  const tryAll = async (name, fn) => { call(name); try { keep(await fn()); } catch (e) { keepError(e); } };

  // own session, then geo → seed, DOA → replacement, needs-account → probe + shared retry, VOD, the screen
  await run({ geo: "own", pool: [poolSeed(1), poolSeed(2), poolSeed(3)], handlers: {
    "v6/getLiveData": (b) => (b.userToken === "SEEDTOK-SECRET-1" ? portalError("aaa100027") : undefined),
    "v4/startPlayLive": (b) => (b.userToken === "SEEDTOK-SECRET-2" ? portalError("aaa100028") : undefined),
  } }, async (w) => {
    live._setSources([xuper]);
    await tryAll("liveCategories", () => plugin.liveCategories());
    await tryAll("liveCategories", () => xuper.categories({}));
    await tryAll("liveChannels", () => xuper.channels("31", {}));
    // xuper's channels stored by the framework, so the live tabs draw them as tiles
    for (const c of (await live.categoryList()).filter((x) => x.members.some((m) => m.src === "xuper"))) {
      await tryAll("liveChannels", () => plugin.liveChannels({ categoryId: c.id, cursor: null }));
    }
    await tryAll("resolve", () => plugin.resolve("L:xuper:ch9"));
    await tryAll("resolve", () => xuper.resolve("ch9"));
    await tryAll("resolve", () => xmod.searchVod("Pelicula Uno"));
    let tiles = 0;
    await screens({ liveTabs: true, onTree: (t) => { keep(t); if (/"type":"Card"[^]*"go":\{"play"/.test(JSON.stringify(t))) tiles++; } });
    assert.ok(tiles > 0, "the live tabs drew xuper's channels as the plugin's tiles");
    await tryAll("screenEvent", () => plugin.screenEvent({ name: "seedChange", state: { nav: "config" } }));
    await screens({ liveTabs: true });
    w.advance(20 * MIN);
    await tryAll("liveChannels", () => xuper.channels("40", {}));
  });
  // every failure path with its sentence: 503, 429, 401, network, bad, portal200001, cap, lease
  for (const seedAnswer of [() => res(503, "{}"), () => res(429, "{}"), () => res(401, "{}"), () => new Error("net"), () => res(200, '{"seed":{"sn":"x"}}')]) {
    await run({ geo: "own", seedAnswer }, async () => {
      await tryAll("liveCategories", () => xuper.categories({}));
      await tryAll("resolve", () => xuper.resolve("ch1"));
      await screens();
    });
  }
  await run({ handlers: { "v3/snToken": () => portalError("portal200001") } }, async () => { await tryAll("resolve", () => xuper.resolve("ch1")); });
  await run({ sn: "0f1e2d3c4b5a69788796a5b4c3d2e1f0", own: "OWNTOK-SECRET-old", handlers: { "v4/startPlayLive": () => portalError("aaa100028") } },
    async () => { await tryAll("resolve", () => xuper.resolve("ch1")); });
  // the contribution: its seed goes ONLY to POST /seed
  await run({}, async (w) => {
    call("home");
    await C.maybeContribute();
    assert.equal(w.seeds.length, 1);
    await screens();
  });

  // supertv's three panels (1.0.46) beside xuper, their made-up Xtream accounts marked: the first install's panel search
  // (slots), the slots' lists, a hop to another panel, a refused slot released, every copy refused, the live tabs' tiles.
  // The logs, reports, errors, screen states and every visible text name hosts and account hashes only. A channel's ref
  // carries its account by design (1.0.45's: Kino plays and saves it), so a screen tree is scanned without its refs, and
  // a resolve's answer (the stream URL Kino plays) is not output.
  const XT = (i) => ({ username: "xtuser-HIDDEN-" + i, password: "xtpass-HIDDEN-" + i });
  const xtSecrets = credsOf({ cred: XT }).flatMap((c) => [c.username, c.password]);
  const stvSeen = [];
  const keepStv = (x) => { if (x !== undefined) { const t = typeof x === "string" ? x : JSON.stringify(x); stvSeen.push(t); seen.push(t); } };
  const noRefs = (tree) => JSON.parse(JSON.stringify(tree, (key, v) => (key === "ref" ? undefined : v)));
  const refused = new Set();
  const stream = (url) => (refused.has(hostOf(url)) ? Object.assign(new Error("network error: Received HTTP_PROXY_AUTH (407) code while not using proxy"), { code: "network" }) : res(200, PLAYLIST));
  const stvModes = {};
  {
    const { default: supertv, supertv2, supertv3 } = await import("../src/sources/supertv.js");
    const w = await device({ geo: "own", pool: [poolSeed(7)], routes: [stvWorld({ cred: XT, stream, modes: stvModes })] });
    worlds.push(w);
    live._setSources([supertv, supertv2, supertv3, xuper]);
    const tryStv = async (name, fn, { output = true } = {}) => {
      call(name);
      try { const out = await fn(); if (output) keepStv(out); return out; } catch (e) { keepStv(e && e.message); keepStv(e && e.userMessage); keepStv(e && e.code); keepStv(String(e)); return null; }
    };
    await tryStv("liveCategories", () => plugin.liveCategories());
    assert.ok(JSON.parse(w.store.get("o2:stvs")).s2, "the slots were filled");
    const es = await tryStv("liveChannels", () => plugin.liveChannels({ categoryId: "v.sp.es", cursor: null }), { output: false });
    const dazn = es.items.find((c) => c.title === "DAZN 1 FHD");
    refused.add("line.zee-ott.xyz");
    const hop = await tryStv("resolve", () => plugin.resolve(dazn.ref), { output: false });
    assert.equal(hostOf(hop.url), "pp.tresinl.xyz", "the hop to another panel ran");
    refused.add("pp.tresinl.xyz");
    refused.add("fv99.nesewvp.top");
    await tryStv("resolve", () => plugin.resolve(dazn.ref), { output: false });
    // a slot whose lists are refused: one probe of its account, then released (logged)
    stvModes["fv99.nesewvp.top"] = "list403";
    stvModes["pp.tresinl.xyz"] = (u) => (u.searchParams.get("action") === "get_live_streams" ? res(403, "") : res(200, JSON.stringify({ user_info: { auth: 0 } })));
    w.advance(7 * 3600_000);
    await tryStv("liveChannels", () => plugin.liveChannels({ categoryId: "v.sp.es", cursor: null }), { output: false });
    await tryStv("liveCategories", () => plugin.liveCategories());
    let stvTiles = 0;
    await screens({ liveTabs: true, cat: "v.sp.es", onTree: (t) => {
      const full = JSON.stringify(t);
      if (/"type":"Card"[^]*"go":\{"play":\{"ref":"M:supertv:/.test(full)) stvTiles++;
      seen.push(full);
      keepStv(noRefs(t));
    } });
    assert.equal(stvTiles, 8, "both live tabs drew supertv's merged channels as tiles (ES/EN × phone/TV)");
    call("screenEvent");
    try { const out = await plugin.screenEvent({ name: "liveCat", value: "v.sp.es", state: { nav: "vivo", lcTried: true } }); keepStv(out && out.state); keepStv(out && out.toast); } catch (e) { keepStv(String(e)); }
    for (const l of w.logs) keepStv(l);
    for (const r of w.reports) keepStv(r);
    assert.ok(w.logs.some((l) => /^supertv: s[23]: [a-z0-9.]+ \(another panel/.test(l)), "the slot search logged its hosts");
    assert.ok(w.logs.some((l) => /released/.test(l)), "a slot release was logged: " + w.logs.filter((l) => /supertv/.test(l)).join(" | "));
    assert.ok(w.logs.some((l) => /^live: resolve .*supertv3 ok/.test(l)), "the hop was logged");
    // o2:stvs names accounts by their hash (src/sources/panels.js accountKey: server and user, hashed; no password)
    const st = JSON.parse(w.store.get("o2:stvs"));
    const names = [...Object.keys(st.bad || {}), ...Object.keys(st.slow || {}), st.prim && st.prim.a].filter(Boolean);
    assert.ok(names.length >= 3);
    for (const n of names) assert.ok(!xtSecrets.some((x) => String(n).includes(x)) && !/HIDDEN/.test(n), "an account named by its hash: " + String(n).slice(0, 6));
  }
  const stvText = stvSeen.join("\n");
  assert.ok(stvText.length > 1000, "the scan saw supertv's output");
  for (const secret of xtSecrets) assert.ok(!stvText.includes(secret) && !stvText.includes(encodeURIComponent(secret)), "an Xtream credential reached a log, report, error, state or visible text: " + secret.slice(0, 6) + "…");
  assert.ok(!/HIDDEN/.test(stvText), "no Xtream user or password anywhere but a ref");

  const text = seen.join("\n");
  assert.ok(text.length > 1000, "the scan saw the plugin's output");
  for (const w of worlds) {
    for (const secret of w.secrets()) {
      assert.ok(!text.includes(secret), "a secret value reached a log, report, error or screen: " + secret.slice(0, 4) + "…");
    }
  }
  assert.ok(!/SECRET/.test(text), "nothing secret-marked anywhere");
  assert.ok(worlds.some((w) => w.reports.some((r) => r.startsWith("seed:get"))), "seed:get lines reach the board as reports");
});
