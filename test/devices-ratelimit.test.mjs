// Ajustes ▸ "Dispositivos" (GET /devices, backend 71a1a3b) and the backend's rate limit (429, backend 5b4630e), against a
// fake backend. Date.now is driven by this file (the waits are minutes long): its own test file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { installKino, res } from "./helpers/fake-kino.mjs";

let now = 1_800_000_000_000;
Date.now = () => now;
const M = 60_000;

globalThis.kino = { lang: "es", config: {} };
const api = await import("../src/api.js");
const { screen, screenEvent } = await import("../src/screen.js");
const { configView } = await import("../src/screenView.js");
const { pluginNames, forgetDevices } = await import("../src/devices.js");
const catalog = await import("../src/catalog.js");
const { itemRef } = await import("../src/refs.js");
const { beginCall } = await import("../src/flight.js");

const BACKEND = "https://x.xkplugins.site";
const DEVICES = {
  used: 2, max: 6, devices: [
    { current: true, plugins: ["xuper", "ultra-hd"], lastSeen: now - 30_000 },
    { current: false, plugins: ["super-tv", "kino-nuevo"], lastSeen: now - 5 * M },
  ],
};

/** A device with a Bearer and a fake backend: `answer(path, init)` → a response (undefined: 404). */
async function device(answer, extra = {}) {
  const k = installKino({ storage: { "o2:bearer": "bearer-token", "o2:mig": "1", ...extra }, routes: [(url, init) => {
    if (!url.startsWith(BACKEND)) return undefined;
    return answer(url.slice(BACKEND.length), init);
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  api._resetRateLimit();
  catalog._resetResolveMemory();
  forgetDevices();
  beginCall();
  return k;
}
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });
const paths = (k) => k.requests.map((r) => r.url.slice(BACKEND.length));

function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, fn);
}
const byKey = (tree, key) => { let out = null; walk(tree, (n) => { if (!out && n.key === key) out = n; }); return out; };
const texts = (tree) => { const out = []; walk(tree, (n) => { if (typeof n.text === "string") out.push(n.text); if (typeof n.title === "string") out.push(n.title); }); return out; };
const timers = (tree) => (Array.isArray(tree.every) ? tree.every : tree.every ? [tree.every] : []).map((t) => t.event);
const inLang = async (lang, fn) => { const was = globalThis.kino.lang; globalThis.kino.lang = lang; try { return await fn(); } finally { globalThis.kino.lang = was; } };

async function draw(state) { beginCall(); return screen({ state, device: "phone" }); }
async function ev(name, state, value) { beginCall(); return screenEvent({ name, state, value }); }

// ── Dispositivos ──

test("pluginNames: the known ids read as the person knows them, each once, unknown ones raw", () => {
  assert.deepEqual(pluginNames(["xuper", "ultra-hd", "super-tv"]), ["Xuper", "Ultra HD", "SuperTV"]);
  assert.deepEqual(pluginNames(["xuper", "xuper"]), ["Xuper"]);
  assert.deepEqual(pluginNames(["kino-nuevo", " ultra-hd ", "", null, "ULTRA-HD"]), ["kino-nuevo", "Ultra HD"]);
  assert.deepEqual(pluginNames(undefined), []);
});

test("Ajustes asks GET /devices once per visit (a one-shot timer), draws the card from memory, never polls", async () => {
  const k = await device((p) => (p === "/devices" ? json(DEVICES) : undefined));
  let state = { nav: "config" };
  const first = await draw(state);
  assert.deepEqual(timers(first), ["devices"], "the view shows at once; the timer asks");
  assert.equal(byKey(first, "cfgDevices"), null, "no card before the answer");
  assert.equal(k.requests.length, 0, "screen() never fetches");
  const out = await ev("devices", state);
  assert.deepEqual(Object.keys(out), ["state"], "a timer's answer is state only");
  state = { ...state, ...out.state };
  assert.deepEqual(paths(k), ["/devices"]);
  assert.equal(k.requests[0].headers.Authorization, "Bearer bearer-token");
  assert.ok(k.requests[0].timeoutMs <= 4000, "inside the tick's own bound");
  for (let i = 0; i < 3; i++) {
    const v = await draw(state);
    assert.deepEqual(timers(v), [], "no timer once asked");
    assert.ok(byKey(v, "cfgDevices"), "the card");
  }
  assert.equal(k.requests.length, 1, "re-drawing (the Aportar switch, a seed change) asks nothing");
  // another visit: away and back
  state = { ...state, ...(await ev("nav", state, "home")).state };
  state = { ...state, ...(await ev("nav", state, "config")).state };
  const again = await draw(state);
  assert.deepEqual(timers(again), ["devices"], "a new visit asks again");
  await ev("devices", state);
  assert.equal(k.requests.length, 2);
});

test("the card: used of max, newest first as listed, this phone marked, plugins and 'visto hace', the rule and how they count (ES/EN, tuteo)", async () => {
  for (const lang of ["es", "en"]) {
    await inLang(lang, async () => {
      const E = lang === "en";
      const d = { used: 2, max: 6, list: [
        { current: true, names: ["Xuper", "Ultra HD"], lastSeen: now - 30_000 },
        { current: false, names: ["SuperTV", "kino-nuevo"], lastSeen: now - 5 * M },
      ] };
      const v = configView({ version: "1.0.46", devices: d, now });
      const card = byKey(v, "cfgDevices");
      assert.equal(byKey(card, "cfgDevTitle").text, E ? "Devices: 2 of 6" : "Dispositivos: 2 de 6");
      assert.equal(byKey(card, "cfgDevTitle").textEn, "Devices: 2 of 6");
      assert.equal(byKey(card, "cfgDevN0").text, "Xuper · Ultra HD");
      assert.equal(byKey(card, "cfgDevN1").text, "SuperTV · kino-nuevo");
      assert.equal(byKey(card, "cfgDevS0").text, E ? "Seen just now" : "Visto hace un momento");
      assert.equal(byKey(card, "cfgDevS1").text, E ? "Seen 5 min ago" : "Visto hace 5 min");
      assert.equal(byKey(card, "cfgDevMe0").text, E ? "This phone" : "Este teléfono");
      assert.equal(byKey(card, "cfgDevMe0").textEn, "This phone");
      assert.equal(byKey(card, "cfgDevMe1"), null, "only this phone is marked");
      assert.equal(byKey(card, "cfgDevNote").text, E ? "If you activate a 7th phone, the one you used longest ago is signed out."
        : "Si activas un 7.º teléfono, se cierra la sesión del que usaste hace más tiempo.");
      const all = texts(card).join(" \n ");
      for (const want of E ? ["not a plugin", "30 days", "not refused", "per Telegram account"]
        : ["no un plugin", "30 días", "no se rechaza", "por cuenta de Telegram"]) assert.ok(all.includes(want), want);
      if (!E) for (const voseo of ["activás", "usás", "podés", "tenés", "probá", "intentá", "querés"]) assert.ok(!all.includes(voseo), voseo);
      // order: the card sits right after the account card
      const keys = byKey(v, "cfg-scroll-col").children.map((c) => c.key);
      assert.deepEqual(keys.slice(0, 2), ["cfgAccount", "cfgDevices"]);
    });
  }
  // on a TV the mark says "this device"
  const tv = configView({ version: "1.0.46", device: "tv", devices: { used: 1, max: 6, list: [{ current: true, names: ["Xuper"], lastSeen: now }] }, now });
  assert.equal(byKey(tv, "cfgDevMe0").text, "Este aparato");
  // without an answer, no card
  assert.equal(byKey(configView({ version: "1.0.46", now }), "cfgDevices"), null);
});

test("401 on /devices: the Bearer is dropped and the screen signs in again on its next opening (o2:relogin); the card stays hidden", async () => {
  const k = await device((p) => (p === "/devices" ? res(401, "") : undefined));
  const state = { nav: "config" };
  const out = await ev("devices", state);
  assert.equal(k.kino.storage.get("o2:bearer"), null, "the refused Bearer is gone");
  assert.equal(k.kino.storage.get("o2:relogin"), "1", "marked for the screen's sign-in again");
  const v = await draw({ ...state, ...out.state });
  assert.equal(byKey(v, "cfgDevices"), null);
  assert.ok(byKey(v, "cfgAccount"), "the app stays on screen (not the welcome view)");
  assert.deepEqual(timers(v), [], "and does not ask again in this visit");
});

test("404 (an older backend), 500, a network error, an odd answer or a 429: the card is hidden with no error text", async () => {
  const answers = [
    () => res(404, "not found"),
    () => res(500, ""),
    () => Object.assign(new Error("network"), { code: "network" }),
    () => json({ used: "x", devices: null }),
    () => res(429, "<html>Cloudflare</html>", { "content-type": "text/html" }),
  ];
  for (const a of answers) {
    const k = await device((p) => (p === "/devices" ? a() : undefined));
    const state = { nav: "config" };
    const out = await ev("devices", state);
    assert.equal(out.state.devTried, true);
    const v = await draw({ ...state, ...out.state });
    assert.equal(byKey(v, "cfgDevices"), null);
    assert.ok(!texts(v).some((t) => /error|No se pudo/i.test(t)), "no error text");
    assert.equal(k.requests.length, 1, "asked once, never retried");
    assert.equal(k.kino.storage.get("o2:bearer"), "bearer-token", "the Bearer stays");
  }
});

const KIT = process.env.KINO_SCREEN_KIT || homedir() + "/kino-app/plugins/sdk/screen.mjs";
const MANIFEST_API = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8")).apiVersion;
test("Kino's screen rules drop no node of Ajustes with the devices card (ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  const list = Array.from({ length: 8 }, (_, i) => ({ current: i === 0, names: i % 2 ? ["SuperTV"] : ["Xuper", "Ultra HD"], lastSeen: now - i * 3600_000 }));
  for (const lang of ["es", "en"]) {
    for (const device of ["phone", "tv"]) {
      const v = await inLang(lang, () => configView({ version: "1.0.46", device, devices: { used: 8, max: 6, list }, now }));
      const r = checkScreenTree(v, lang, undefined, { apiVersion: MANIFEST_API });
      assert.deepEqual(r.dropped, [], `${lang} ${device}`);
    }
  }
});

// ── rate limit (429) ──

const searchHit = (title) => json({ programResult: { list: [{ contentId: "9", name: title, type: "1", posterList: [] }] } });

test("search: a 429 is never retried; that family waits 60 s (no request), with the last answer for the query or []", async () => {
  let status = 200;
  const k = await device((p) => (p.startsWith("/search") ? (status === 200 ? searchHit("Matrix") : res(429, JSON.stringify({ detail: "rate_limited" }), { "content-type": "application/json" })) : undefined));
  const first = await catalog.search({ q: "matrix" });
  assert.equal(first.length, 1);
  now += 4 * M;   // past the 3 min client cache
  status = 429;
  const limited = await catalog.search({ q: "matrix" });
  assert.deepEqual(limited, first, "the cached answer, however old");
  assert.equal(paths(k).filter((p) => p.startsWith("/search")).length, 2, "one request, no immediate retry");
  assert.deepEqual(await catalog.search({ q: "otra cosa" }), [], "nothing cached: []");
  assert.deepEqual(await catalog.search({ q: "matrix" }), first);
  assert.equal(paths(k).filter((p) => p.startsWith("/search")).length, 2, "inside the wait: no request at all");
  now += 30_000;
  await catalog.search({ q: "otra" });
  assert.equal(k.requests.length, 2, "still waiting at 30 s");
  now += 31_000;
  status = 200;
  assert.equal((await catalog.search({ q: "otra" })).length, 1, "after 60 s the family asks again");
  assert.equal(k.requests.length, 3);
});

test("Cloudflare's own 429 (an HTML page, not JSON) is the same: no retry, the family waits, the stamp is stored for a new runtime", async () => {
  const k = await device((p) => (p.startsWith("/search") ? res(429, "<!DOCTYPE html><title>Too Many Requests</title>", { "content-type": "text/html" }) : undefined));
  assert.deepEqual(await catalog.search({ q: "nueva" }), []);
  const stamp = JSON.parse(k.kino.storage.get(api.RL_KEY));
  assert.ok(stamp.search >= now + 60_000, "a small stored stamp: the family and until when");
  api._resetRateLimit();   // a new runtime
  assert.deepEqual(await catalog.search({ q: "nueva2" }), []);
  assert.equal(k.requests.length, 1, "a new runtime respects the stored wait");
});

test("a 429 on /search leaves the other families alone; Retry-After longer than 60 s is honoured (10 min at most)", async () => {
  const k = await device((p) => {
    if (p.startsWith("/search")) return res(429, "", { "Retry-After": "120" });
    if (p === "/item/5") return json({ detail: { name: "X", simpleProgramList: [] } });   // an older backend: no /item/egress
    return undefined;
  });
  await catalog.search({ q: "a" });
  const ep = await catalog.episodes(itemRef("5", "0"));
  assert.ok(ep && Array.isArray(ep.episodes), "/item still answers");
  assert.ok(api.limitedUntil("search") >= now + 120_000);
  assert.equal(api.limitedUntil("item"), 0);
  now += 90_000;
  await catalog.search({ q: "b" });
  assert.equal(paths(k).filter((p) => p.startsWith("/search")).length, 1, "still waiting at 90 s (Retry-After 120)");
  now += 31_000;
  await catalog.search({ q: "c" });
  assert.equal(paths(k).filter((p) => p.startsWith("/search")).length, 2);
});

test("resolve: a 429 throws 'too many requests' (ES/EN) with no retry and no backend call; the portal fallback only uses the stored catalog's title; inside the wait it throws with no request", async () => {
  for (const lang of ["es", "en"]) {
    {
      const k = await device((p) => (p.startsWith("/resolve/") ? res(429, JSON.stringify({ detail: "rate_limited" })) : undefined));
      k.kino.lang = lang;
      const ref = itemRef("123", "1");
      await assert.rejects(catalog.resolve(ref), (e) => {
        assert.equal(e.userMessage, lang === "en" ? "Too many requests. Try again in a minute." : "Demasiadas solicitudes. Prueba en un minuto.");
        assert.ok(api.isRateLimited(e));
        return true;
      });
      assert.deepEqual(paths(k), ["/resolve/123?batch=1"], "one request: no retry, no /item lookup (no stored title here, so no portal fallback either)");
      assert.equal(k.requests.length, 1);
      await assert.rejects(catalog.resolve(ref), (e) => api.isRateLimited(e));
      assert.equal(k.requests.length, 1, "inside the wait: no request");
    }
  }
});

test("resolve: a 429 on the relay's /resolve/step ends the chain at once (never a loop)", async () => {
  let steps = 0;
  const k = await device((p) => {
    if (p.split("?")[0] === "/resolve/77") return json({ egress: { url: "https://portal.example/x", method: "POST", body: "c1" }, step: "s1" });
    if (p === "/resolve/step") { steps++; return res(429, "{\"detail\":\"rate_limited\"}"); }
    return undefined;
  });
  k.kino.fetch = ((orig) => async (url, init) => (url.startsWith("https://portal.example/") ? res(200, "cipher") : orig(url, init)))(k.kino.fetch);
  await assert.rejects(catalog.resolve(itemRef("77", "1")), (e) => api.isRateLimited(e));
  assert.equal(steps, 1);
});

test("familyOf: the path's first segment", () => {
  assert.equal(api.familyOf("/resolve/step"), "resolve");
  assert.equal(api.familyOf("/search?q=x"), "search");
  assert.equal(api.familyOf("/item/5"), "item");
  assert.equal(api.familyOf("/live/categories"), "live");
  assert.equal(api.familyOf("/devices"), "devices");
});
