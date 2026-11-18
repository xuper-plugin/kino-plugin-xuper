// The update from Xuper 2.x (same plugin id, so the same storage, settings and library): what 2.x left in storage is
// swept on the first call of every runtime (src/upgrade.js), its `session` (2.x's portal session as JSON) is never read
// as the backend's Bearer nor sent anywhere, a device that ran 2.x signs in on its first opening with no tap, and an
// identity answer without the gate token says Kino must be updated instead of posting to /session.
// Written against the plugin's entry points (src/plugin.js), like test/regress-1045.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const P = await import("../src/plugin.js");
const { _resetUpgrade } = await import("../src/upgrade.js");
const { fromLegacyHome, fromLegacyMatches, seal } = await import("../src/v2.js");
const { BEARER_KEY, notActivatedText } = await import("../src/api.js");
const { DEFAULT_SERVER, serverUrl } = await import("../src/config.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const legacyHome = JSON.parse(readFileSync(new URL("./fixtures/home.reduced.json", import.meta.url), "utf8"));
const BACKEND = "https://x.xkplugins.site";

// 2.6.9's storage on a device that used it: its portal session (JSON, with the person's portal tokens) and its caches.
const SESSION_269 = JSON.stringify({ userId: "U-SECRET-1", userToken: "UT-SECRET-1", jwtToken: "JWT-SECRET-1", sn: "0123456789abcdef0123456789abcdef", acct: "" });
const STORAGE_269 = {
  session: SESSION_269,
  "rows:meta": '{"v":1}', "rows:0": "[]", "chapters:v1": "[]", "ids:v1": "{}", "titles:v1": "{}", "search:v1": "{}",
  "searchHist:v1": "[]", "recent:v1": "[]", meta1: "{}", "liveCats:v2": "[]", "liveLogos:v1": "{}", liveRotCarried: "{}",
  seeds: "[]", seedsAt: "1794844780749", deadSeeds: "{}", portalHost: '"osuhk.m3x8o50te.com"', refreshAt: "1",
  seedContribAt: "1", "kino-xuper-hex16": "x", browseTab: '"home"',
};

// ── tree helpers ──
function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const k of Object.keys(node)) if (node[k] && typeof node[k] === "object") walk(node[k], fn);
}
const byKey = (tree, key) => { let hit; walk(tree, (n) => { if (!hit && n.key === key) hit = n; }); return hit; };
const texts = (tree) => { const out = []; walk(tree, (n) => { for (const k of ["text", "textEn", "labelText", "title"]) if (typeof n[k] === "string") out.push(n[k]); }); return out.join("\n"); };

/** The catalog stored as the plugin stores it (the screen draws with no request). */
function storedCatalog() {
  const cat = seal(fromLegacyHome(legacyHome), 1794844780749, sha256);
  const mat = seal(fromLegacyMatches({ matches: [] }), 1794838230926, sha256);
  const now = Date.now();
  return {
    "o2:cat": JSON.stringify(cat),
    "o2:catm": JSON.stringify({ h: cat.hash, gen: cat.gen, etag: '"e1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:mat": JSON.stringify(mat),
    "o2:matm": JSON.stringify({ h: mat.hash, gen: mat.gen, etag: '"m1"', lm: "", src: "rel", checkedAt: now, failAt: 0, failN: 0 }),
    "o2:ixm": JSON.stringify({ checkedAt: now, missingUntil: now + 3600000 }),
  };
}

/**
 * A device as Kino hands it to 3.0.0 right after the update: `storage` as it is, this runtime's Bearer memo cleared,
 * and a NEW runtime (its first call sweeps). `identity`: kino.identity.telegram's stand-in.
 */
async function updatedDevice({ storage = {}, routes = [], identity, noFetch = false, lang = "es" } = {}) {
  const k = installKino({ storage: {}, routes, noFetch, lang });
  await P.screenEvent({ name: "disconnect", state: {} });   // forget the Bearer memo of the previous test's device
  for (const key of [...k.store.keys()]) k.store.delete(key);
  for (const [key, v] of Object.entries(storage)) k.store.set(key, v);
  if (identity) k.kino.identity = { telegram: identity };
  _resetUpgrade();
  k.requests.length = 0;
  k.writes.length = 0;
  k.logs.length = 0;
  return k;
}

/** The backend: a challenge, then /session answers `bearer` (and records what it got). */
function backend(bearer = "new-bearer") {
  const seen = [];
  const route = (url, init) => {
    if (!url.startsWith(BACKEND)) return undefined;
    const path = url.slice(BACKEND.length);
    seen.push({ path, auth: (init && init.headers && init.headers.Authorization) || "", body: init && init.body });
    if (path === "/session/challenge") return res(200, JSON.stringify({ challenge: "c".repeat(32) }));
    if (path === "/session") return res(200, JSON.stringify({ session: bearer }));
    return res(404, "");
  };
  return { route, seen };
}

const identityWith = (calls, answer) => async (opts) => { calls.push(opts); return answer; };
const SIGNED = { id: "p".repeat(32), token: "gate.token", deviceKey: "dk", signature: "sig", author: "E04E-EA25-1A34-290E", codeHash: "c0de" };

// ═════════════ storage ═════════════

test("the first call after the update removes 2.x's storage, `session` included, and keeps 3.x's own keys", async () => {
  const k = await updatedDevice({ storage: { ...STORAGE_269, ...storedCatalog() }, noFetch: true });
  const rows = await P.home();
  assert.ok(rows.length > 0, "Home draws from the stored catalog");
  for (const key of Object.keys(STORAGE_269)) assert.equal(k.store.has(key), false, key + " is gone");
  for (const key of Object.keys(storedCatalog())) assert.ok(k.store.has(key), key + " stays");
  assert.equal(k.requests.length, 0);
});

test("2.x's `session` is never read as the Bearer: no request carries it, and a play asks to activate (auth_required, ES and EN)", async () => {
  for (const lang of ["es", "en"]) {
    const k = await updatedDevice({ storage: { ...STORAGE_269 }, noFetch: true, lang });
    await assert.rejects(P.resolve("v:ABC123:1"), (e) => e.code === "auth_required" && e.userMessage === notActivatedText(lang));
    assert.equal(k.requests.length, 0, "nothing is sent to the backend");
    assert.equal(k.store.has("session"), false);
    assert.equal(k.store.has(BEARER_KEY), false);
  }
  assert.equal(notActivatedText("es"), "Abre Xuper desde el menú para activarlo y vuelve a intentarlo.");
  assert.equal(notActivatedText("en"), "Open Xuper from the menu to activate it, then try again.");
});

test("a 2.x `session` that comes back (a restored backup) is swept by the next runtime and never sent", async () => {
  const be = backend();
  const k = await updatedDevice({ storage: { ...storedCatalog(), [BEARER_KEY]: "bearer-3x" }, routes: [be.route] });
  await P.search({ q: "Matrix" });
  k.store.set("session", SESSION_269);   // restored behind the runtime's back
  _resetUpgrade();                        // a new runtime
  await P.search({ q: "Dune" });
  assert.equal(k.store.has("session"), false);
  for (const r of be.seen) assert.ok(!/SECRET/.test(r.auth + String(r.body)), "2.x's tokens never leave the device: " + r.path);
  assert.ok(be.seen.every((r) => r.auth === "Bearer bearer-3x"), "every backend call carries 3.x's own Bearer");
});

test("the sweep runs once per runtime (one keys() read), and finds nothing on a device that never ran 2.x", async () => {
  const k = await updatedDevice({ storage: storedCatalog(), noFetch: true });
  let reads = 0;
  const keys = k.kino.storage.keys;
  k.kino.storage.keys = () => { reads++; return keys(); };
  await P.home();
  await P.home();
  await P.browse("cat:pelicula", null);
  assert.equal(reads, 1);
  assert.equal(k.store.has("o2:relogin"), false, "nothing of 2.x: no sign-in is marked");
});

// ═════════════ the first opening ═════════════

test("a device that ran 2.x: the screen shows the app (not Activar) and its `open` signs in with no tap", async () => {
  const be = backend("new-bearer");
  const ids = [];
  const k = await updatedDevice({ storage: { ...STORAGE_269, ...storedCatalog() }, routes: [be.route], identity: identityWith(ids, SIGNED) });
  const first = await P.screen({ state: {}, device: "tv" });
  assert.equal(byKey(first, "activate"), undefined, "no welcome view for a person who updated");
  const out = await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 1, "one identity call, no press");
  assert.equal(k.store.get(BEARER_KEY), "new-bearer");
  assert.equal(k.store.has("session"), false, "never written back under 2.x's key");
  assert.ok(out.state && out.state.auth > 0);
  const posted = be.seen.find((r) => r.path === "/session");
  assert.equal(posted.body.json.token, "gate.token");
  assert.equal(posted.body.json.author, "E04E-EA25-1A34-290E");
  assert.equal(posted.body.json.pluginId, "xuper", "the backend checks Kino's signature over the id the body declares");
  await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 1, "signed in: nothing more on the next opening");
});

test("a device that ran 2.x and already signed in to 3.x keeps its Bearer: no sign-in is marked", async () => {
  const ids = [];
  const k = await updatedDevice({ storage: { ...STORAGE_269, ...storedCatalog(), [BEARER_KEY]: "bearer-3x" }, identity: identityWith(ids, SIGNED), noFetch: true });
  await P.home();
  assert.equal(k.store.has("o2:relogin"), false);
  assert.equal(k.store.get(BEARER_KEY), "bearer-3x");
});

test("a new install (no 2.x data) still shows Activar, and `open` never signs in by itself", async () => {
  const ids = [];
  await updatedDevice({ storage: storedCatalog(), identity: identityWith(ids, SIGNED), noFetch: true });
  assert.ok(byKey(await P.screen({ state: {} }), "activate"));
  await P.screenEvent({ name: "open", state: {} });
  assert.equal(ids.length, 0);
});

test("identity without the gate token: nothing is posted to /session and the welcome view says to update Kino (ES and EN)", async () => {
  for (const lang of ["es", "en"]) {
    const be = backend();
    const ids = [];
    const noToken = { id: "p".repeat(32), deviceKey: "dk", signature: "sig", author: "2DFB-6AAE-F663-36F5", codeHash: "c0de" };
    const k = await updatedDevice({ storage: { ...STORAGE_269, ...storedCatalog() }, routes: [be.route], identity: identityWith(ids, noToken), lang });
    await P.screen({ state: {} });
    const out = await P.screenEvent({ name: "open", state: {} });
    assert.equal(out.state.actError, "update");
    assert.ok(!be.seen.some((r) => r.path === "/session"), "no sign-in without the token");
    assert.equal(k.store.has(BEARER_KEY), false);
    const v = await P.screen({ state: out.state });
    assert.ok(byKey(v, "activate") && byKey(v, "wErrUpd"), "welcome with the update banner");
    assert.match(texts(v), lang === "en" ? /latest version of Kino/ : /versión más reciente de Kino/);
    await P.screenEvent({ name: "open", state: {} });
    assert.equal(ids.length, 1, "not asked again by itself");
    // the person's own press says the same
    const pressed = await P.screenEvent({ name: "activate", state: {} });
    assert.equal(pressed.state.actError, "update");
  }
});

// ═════════════ the backend's address ═════════════

test("no `server` setting: whatever kino.config holds under that key, the backend is the fixed one", async () => {
  const be = backend();
  const k = await updatedDevice({ storage: { ...storedCatalog(), [BEARER_KEY]: "bearer-3x" }, routes: [be.route] });
  k.kino.config = { get: (key) => (key === "server" ? "https://evil.example" : undefined), server: "https://evil.example" };
  assert.equal(serverUrl(), DEFAULT_SERVER);
  await P.search({ q: "Matrix" });
  assert.ok(k.requests.length > 0);
  assert.ok(k.requests.every((r) => !r.url.startsWith("https://evil.example")));
});

// ═════════════ Kino's screen rules ═════════════

const KIT = process.env.KINO_SCREEN_KIT || homedir() + "/kino-app/plugins/sdk/screen.mjs";
const MANIFEST_API = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8")).apiVersion;
test("Kino's screen rules drop no node of the welcome view (no error, refused, update Kino; ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  for (const lang of ["es", "en"]) {
    for (const device of ["phone", "tv"]) {
      for (const actError of [undefined, true, "update"]) {
        await updatedDevice({ storage: storedCatalog(), noFetch: true, lang });
        const v = await P.screen({ state: actError === undefined ? {} : { actError }, device });
        const r = checkScreenTree(v, lang, undefined, { apiVersion: MANIFEST_API });
        assert.deepEqual(r.dropped, [], `${lang} ${device} ${actError}`);
      }
    }
  }
});
