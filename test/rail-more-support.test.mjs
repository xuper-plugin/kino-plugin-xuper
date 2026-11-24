// 3.0.1: every row of the own screen gets Kino's «Ver más» (its portal column, `col:<columnId>`, 18+ in Adultos), and
// «Apoyar» (Ko-fi, through Kino's go.url) sits below Activate and in Ajustes. A catalog 3.0.0 stored (no refs) is
// fetched again and rebuilt once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { installKino, res } from "./helpers/fake-kino.mjs";

globalThis.kino = { lang: "es", config: {} };
const { beginCall } = await import("../src/flight.js");
const api = await import("../src/api.js");
const data = await import("../src/data.js");
const catalog = await import("../src/catalog.js");
const { colRef, decodeRef } = await import("../src/refs.js");
const { fromLegacyHome, seal, sectionView, validateCatalog } = await import("../src/v2.js");
const { catalogView, welcomeView, configView } = await import("../src/screenView.js");
const { SUPPORT_URL, DATA_BASE, RELEASE_BASE } = await import("../src/config.js");

const sha256 = (t) => createHash("sha256").update(t, "utf8").digest("hex");
const BACKEND = "https://x.xkplugins.site";
const REL_HOME = RELEASE_BASE + "/home.json";
const KO_FI = "https://ko-fi.com/xuperplugins";
const json = (o, status = 200) => res(status, JSON.stringify(o), { "content-type": "application/json" });

const card = (id, name) => ({ contentId: id, name, type: "1", posterList: [] });
/** A Release home.json: Películas with a column row, a row without a column and one with an unusable id; Adultos. */
const LEGACY = { version: 1, generatedAt: 1794844780749, sections: {
  pelicula: { slider: [], rows: { recommendList: [
    { name: "Acción", columnId: 85205, assetList: [card("p1", "Uno"), card("p2", "Dos")] },
    { name: "Sin columna", assetList: [card("p3", "Tres")] },
    { name: "Columna rara", columnId: "x1", assetList: [card("p4", "Cuatro")] },
  ] } },
  adultos: { slider: [], rows: { recommendList: [
    { name: "Recentes", columnId: 85264, assetList: [card("a1", "A")] },
  ] } },
} };
const built = () => fromLegacyHome(LEGACY, { poster: "recommended" });

function walk(node, fn) {
  if (Array.isArray(node)) { node.forEach((n) => walk(n, fn)); return; }
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const v of Object.values(node)) if (v && typeof v === "object") walk(v, fn);
}
const all = (tree, pred) => { const out = []; walk(tree, (n) => { if (pred(n)) out.push(n); }); return out; };
const byKey = (tree, key) => all(tree, (n) => n.key === key)[0] || null;
const inLang = (lang, fn) => { const was = globalThis.kino.lang; globalThis.kino.lang = lang; try { return fn(); } finally { globalThis.kino.lang = was; } };

// ── the refs ──

test("colRef/decodeRef: col:<id> reads as before, col:<id>:a marks the column 18+", () => {
  assert.equal(colRef("85205"), "col:85205");
  assert.equal(colRef("85264", true), "col:85264:a");
  assert.deepEqual(decodeRef("col:85205"), { kind: "column", columnId: "85205" });
  assert.deepEqual(decodeRef("col:85264:a"), { kind: "column", columnId: "85264", adult: true });
});

// ── the stored catalog ──

test("the catalog's rails carry their portal column as «Ver más»: 18+ in Adultos, none without a usable column id, none in legacy mode", () => {
  const v2 = built();
  assert.deepEqual(v2.sections.pelicula.rails.map((r) => r.ref), ["col:85205", undefined, undefined]);
  assert.deepEqual(v2.sections.adultos.rails.map((r) => r.ref), ["col:85264:a"]);
  assert.ok(fromLegacyHome(LEGACY, { poster: "legacy" }).sections.pelicula.rails.every((r) => !("ref" in r)), "legacy mode keeps 1.0.43's shape");
  assert.deepEqual(validateCatalog(seal(v2, 1, sha256)), []);
});

test("validation refuses a rail ref that is not a column, or whose 18+ mark differs from its section's", () => {
  const errs = (mutate) => { const v = built(); mutate(v); return validateCatalog(seal(v, 1, sha256)).join("; "); };
  assert.match(errs((v) => { v.sections.pelicula.rails[0].ref = "cat:pelicula"; }), /sections\.pelicula\.rails\[0\]\.ref/);
  assert.match(errs((v) => { v.sections.pelicula.rails[0].ref = "col:85205:a"; }), /sections\.pelicula\.rails\[0\]\.ref/);
  assert.match(errs((v) => { v.sections.adultos.rails[0].ref = "col:85264"; }), /sections\.adultos\.rails\[0\]\.ref/, "an Adultos column must page 18+");
  assert.match(errs((v) => { v.sections.pelicula.rails[0].ref = "col:0"; }), /sections\.pelicula\.rails\[0\]\.ref/);
});

// ── the own screen ──

test("the own screen's rows draw Kino's «Ver más» (titleRail.ref); the Adultos ones page 18+", () => {
  const v2 = seal(built(), 1, sha256);
  const view = sectionView(v2, "pelicula");
  assert.equal(view.rails[0].ref, "col:85205");
  const rails = all(catalogView({ tab: "pelicula", view, device: "tv" }), (n) => n.type === "titleRail");
  assert.deepEqual(rails.map((r) => r.ref), ["col:85205", undefined, undefined]);
  const adult = all(catalogView({ tab: "adultos", view: sectionView(v2, "adultos"), device: "phone" }), (n) => n.type === "titleRail");
  assert.equal(adult[0].ref, "col:85264:a");
  assert.ok(adult[0].items.every((it) => it.adult === true));
});

// ── «Ver más»: browse pages the column through the backend ──

const COLUMN = { items: [card("a1", "A"), card("p7", "Siete"), { contentId: "bad id!", name: "X", type: "1", posterList: [] }], total: 3, page: 1, size: 30 };

/** A signed-in device whose backend answers the column; `storage` adds keys (a stored catalog). */
async function device(storage = {}) {
  const k = installKino({ storage: { "o2:bearer": "bearer-token", "o2:mig": "1", ...storage }, routes: [(url, init) => {
    if (url.startsWith(BACKEND + "/column/egress") && (init || {}).method === "POST") return json({ results: COLUMN });
    return undefined;
  }] });
  await api.clearBearer();
  k.kino.storage.set("o2:bearer", "bearer-token");
  for (const [key, v] of Object.entries(storage)) k.kino.storage.set(key, v);
  api._resetRateLimit();
  api._resetEgress();
  data._resetMemory();
  beginCall();
  return k;
}
const storedCatalog = () => {
  const v2 = seal(built(), LEGACY.generatedAt, sha256);
  return { "o2:cat": JSON.stringify(v2), "o2:catm": JSON.stringify({ h: v2.hash, gen: LEGACY.generatedAt, etag: '"e1"', lm: "", src: "rel", b: 3, checkedAt: Date.now(), writtenAt: Date.now() - 60_000, failAt: 0, failN: 0 }) };
};

test("browse(col:<id>:a): every title of an Adultos row's «Ver más» is 18+", async () => {
  await device();
  const page = await catalog.browse(colRef("85264", true));
  assert.deepEqual(page.items.map((it) => it.id), ["a1", "p7"], "a card Kino would refuse is left out, as on the rows");
  assert.ok(page.items.every((it) => it.adult === true));
  assert.equal(page.next, null);
});

test("browse(col:<id>): a title the stored catalog holds as 18+ stays 18+ in any row's «Ver más»", async () => {
  await device(storedCatalog());
  const page = await catalog.browse(colRef("85205"));
  const byId = Object.fromEntries(page.items.map((it) => [it.id, it]));
  assert.equal(byId.a1.adult, true, "a1 is in Adultos");
  assert.equal(byId.p7.adult, undefined);
});

// ── «Apoyar» ──

test("«Apoyar» sits below Activate (and below its error) and in Ajustes: Kino's go.url to Ko-fi, in ES and EN", () => {
  assert.equal(SUPPORT_URL, KO_FI);
  for (const lang of ["es", "en"]) inLang(lang, () => {
    for (const error of [undefined, true, "update"]) {
      const keys = all(welcomeView({ error }), (n) => typeof n.key === "string").map((n) => n.key);
      assert.equal(keys[keys.length - 1], "wSupport", `${lang} ${error}: «Apoyar» last, Activate keeps the first focus`);
      assert.ok(keys.indexOf("activate") < keys.indexOf("wSupport"));
    }
    for (const b of [byKey(welcomeView(), "wSupport"), byKey(configView({ version: "3.0.1" }), "cfgSupportBtn")]) {
      assert.equal(b.type, "Button");
      assert.equal(b.variant, "secondary");
      assert.equal(b.icon, "heart");
      assert.equal(b.labelText, lang === "en" ? "If you want to support me, you can do it here" : "Si quieres apoyarme, puedes hacerlo aquí");
      assert.equal(b.labelTextEn, "If you want to support me, you can do it here");
      assert.equal(b.onPressed.go.url.href, KO_FI);
      assert.equal(b.onPressed.go.url.title, lang === "en" ? "Support me on Ko-fi" : "Apóyame en Ko-fi");
      assert.equal(b.onPressed.event, undefined, "Kino opens it itself: no plugin call");
    }
    const card = byKey(configView({ version: "3.0.1" }), "cfgSupport");
    assert.equal(card.type, "Card");
  });
});

test("the support link meets go.url's rules: https, a public name with a dot, port 443, no user, printable ASCII", () => {
  const u = new URL(SUPPORT_URL);
  assert.equal(u.protocol, "https:");
  assert.equal(u.port, "");
  assert.equal(u.username + u.password, "");
  assert.ok(u.hostname.includes(".") && !/^\d+(\.\d+){3}$/.test(u.hostname));
  assert.ok(SUPPORT_URL.length <= 2048 && /^[\x21-\x7e]+$/.test(SUPPORT_URL));
});

// ── a 3.0.0 catalog is rebuilt once ──

function releaseRoutes() {
  return [
    (url) => (url === DATA_BASE + "index.json" ? res(404, "") : undefined),
    (url, init) => {
      if (url !== REL_HOME) return undefined;
      if (init && init.headers && init.headers["If-None-Match"] === '"e1"') return res(304, "");
      return res(200, JSON.stringify(LEGACY), { ETag: '"e1"' }, { binary: true });
    },
  ];
}

test("a catalog an older conversion stored (3.0.0: rails without «Ver más», no meta `b`) is fetched again without its ETag and rebuilt, once", async () => {
  const old = built();
  for (const s of Object.values(old.sections)) for (const r of s.rails) delete r.ref;
  const oldV2 = seal(old, LEGACY.generatedAt, sha256);
  const storage = {
    "o2:cat": JSON.stringify(oldV2),
    "o2:catm": JSON.stringify({ h: oldV2.hash, gen: LEGACY.generatedAt, etag: '"e1"', lm: "", src: "rel", checkedAt: Date.now() - 60_000, writtenAt: Date.now() - 60_000, failAt: 0, failN: 0 }),
  };
  const k = installKino({ storage, routes: releaseRoutes() });
  data._resetMemory();
  beginCall();
  assert.equal(data.catalog().sections.pelicula.rails[0].ref, undefined, "what 3.0.0 stored");
  const r = await data.revalidate({ catalog: true });
  assert.equal(r.changed, true);
  const asked = k.requests.filter((x) => x.url === REL_HOME);
  assert.equal(asked.length, 1);
  assert.equal((asked[0].headers || {})["If-None-Match"], undefined, "no ETag: a 304 would keep the old conversion");
  assert.equal(JSON.parse(k.store.get("o2:catm")).b, 3);
  assert.equal(data.catalog().sections.pelicula.rails[0].ref, "col:85205");
  beginCall();
  await data.revalidate({ catalog: true });
  assert.equal(k.requests.filter((x) => x.url === REL_HOME).length, 1, "rebuilt once: within the TTL nothing more is asked");
});

test("a catalog this conversion stored (meta b: 3) keeps its conditional request", async () => {
  const k = installKino({ storage: storedCatalog(), routes: releaseRoutes() });
  data._resetMemory();
  beginCall();
  const m = JSON.parse(k.store.get("o2:catm"));
  m.checkedAt = Date.now() - 2 * 3600_000;
  k.kino.storage.set("o2:catm", JSON.stringify(m));
  data._resetMemory();
  beginCall();
  await data.revalidate({ catalog: true });
  const asked = k.requests.filter((x) => x.url === REL_HOME);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].headers["If-None-Match"], '"e1"');
});

// ── Kino's own screen rules ──

const KIT = process.env.KINO_SCREEN_KIT || homedir() + "/kino-app/plugins/sdk/screen.mjs";
const MANIFEST_API = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8")).apiVersion;
test("Kino's screen rules drop no node of the rows with «Ver más», the welcome view and Ajustes with «Apoyar» (ES/EN × phone/TV)", { skip: !existsSync(KIT) && "Kino's kit is not on this machine" }, async () => {
  const { checkScreenTree } = await import(pathToFileURL(KIT).href);
  const v2 = seal(built(), 1, sha256);
  for (const lang of ["es", "en"]) {
    for (const device of ["phone", "tv"]) {
      const trees = inLang(lang, () => [
        catalogView({ tab: "pelicula", view: sectionView(v2, "pelicula"), device }),
        catalogView({ tab: "adultos", view: sectionView(v2, "adultos"), device }),
        welcomeView(), welcomeView({ error: true }), welcomeView({ error: "update" }),
        configView({ version: "3.0.1", device }),
      ]);
      for (const t of trees) assert.deepEqual(checkScreenTree(t, lang, undefined, { apiVersion: MANIFEST_API }).dropped, [], `${lang} ${device}`);
    }
  }
});
