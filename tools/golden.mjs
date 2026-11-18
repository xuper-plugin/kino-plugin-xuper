// golden.mjs — proves that the v2 path draws what 1.0.43 drew from the same published home.json.
//
//   npm run golden -- <home.json> (--legacy-src <dir with 1.0.43's src/> | --ref <git ref of 1.0.43>)
//
// It runs 1.0.43's own functions (taken from --legacy-src, or extracted read-only with `git archive <ref> src` from a
// checkout that holds that ref) and the 1.0.45 v2 converter in "legacy" poster mode, then compares every surface:
// Kino Home rows, "Ver más" (the whole list; 1.0.45 pages by 100 instead of 30), hero slides, rails, genre chips
// (raw tags) and the title used by the VOD fallback. Then it lists what "recommended" mode changes (only
// poster/backdrop are expected to differ). Exit code 1 on any unexpected difference.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const homePath = args.find((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
if (!homePath || (!opt("--legacy-src") && !opt("--ref"))) { console.error("usage: npm run golden -- <home.json> (--legacy-src <dir> | --ref <git ref>)"); process.exit(2); }

const ROOT = fileURLToPath(new URL("../", import.meta.url));
let legacySrc = opt("--legacy-src");
let tmp = null;
if (!legacySrc) {
  tmp = mkdtempSync(join(tmpdir(), "xuper-golden-"));
  const tar = execFileSync("git", ["-C", ROOT, "archive", opt("--ref"), "src"]);
  execFileSync("tar", ["-x", "-C", tmp], { input: tar });
  legacySrc = join(tmp, "src");
}

globalThis.kino = { lang: "es", config: {} };
const L = await import(resolve(legacySrc, "catalog.js"));
const LV = await import(resolve(legacySrc, "screenView.js"));
const LC = await import(resolve(legacySrc, "config.js"));
const V2 = await import(join(ROOT, "src/v2.js"));

const home = JSON.parse(readFileSync(homePath, "utf8"));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NAMES = V2.SECTION_NAMES;
let bad = 0;
const fail = (what, a, b) => { bad++; console.log("MISMATCH", what); if (process.env.GOLDEN_VERBOSE) console.log(JSON.stringify(a).slice(0, 400), "\n", JSON.stringify(b).slice(0, 400)); };

// 1.0.43, surface by surface
function legacySurfaces(name) {
  const s = home.sections[name];
  const adult = name === "adultos";
  const v = LV.catalogView({ tab: name, data: s });
  const sheet = v.body.children[1].children[0].children.find((n) => n.type === "BottomSheet");
  return {
    browse: L.toItems(L.sectionCards(s.rows), adult),
    slides: adult ? [] : LV.slidesOf(s.slider),
    rails: LV.railsOf(s.rows, adult).map((r) => ({ title: r.title || "", items: r.items })),
    genres: sheet ? sheet.children[0].items.slice(1).map((t) => t.title) : [],
  };
}
const legacyHome = LC.SECTIONS.filter((s) => !s.adult).map((sec) => {
  const items = L.toItems(L.sectionCards(home.sections[sec.name] && home.sections[sec.name].rows)).slice(0, 18);
  return items.length ? { id: `sec-${sec.name}`, title: sec.title, items, ref: `cat:${sec.name}`, genre: sec.genre } : null;
}).filter(Boolean);
function legacyTitle(id) {
  for (const name in home.sections) for (const c of L.sectionCards(home.sections[name] && home.sections[name].rows)) {
    if (c && String(c.contentId) === id) return String(c.name || c.title || "");
  }
  return "";
}

// 1.0.45, the same surfaces from the v2 object
function v2Surfaces(v2, name) {
  const v = V2.sectionView(v2, name);
  const pages = [];
  let cursor = null;
  do { const p = V2.browsePage(v2, name, cursor); pages.push(...p.items); cursor = p.next; } while (cursor);
  return {
    browse: pages,
    slides: v.slides.map((x) => ({ ...x, text: x.text || "" })),
    rails: v.rails.map((r) => ({ title: r.title || "", items: r.items })),
    genres: v.genres,
  };
}

const legacyV2 = V2.fromLegacyHome(home, { poster: "legacy" });
if (!eq(V2.homeRows(legacyV2), legacyHome)) fail("home rows", V2.homeRows(legacyV2), legacyHome);
for (const name of NAMES) {
  if (!home.sections[name]) continue;
  const a = legacySurfaces(name), b = v2Surfaces(legacyV2, name);
  for (const k of Object.keys(a)) if (!eq(a[k], b[k])) fail(`${name}.${k}`, a[k], b[k]);
}
let titles = 0;
for (const name in home.sections) for (const c of L.sectionCards(home.sections[name].rows)) {
  if (!c || !c.contentId) continue;
  titles++;
  const want = legacyTitle(String(c.contentId));
  const it = V2.itemById(legacyV2, String(c.contentId));
  const got = it && it.title !== "—" ? it.title : "";
  if (want !== got) fail("titleForContent " + c.contentId, want, got);
}
console.log(`legacy poster mode: ${bad ? bad + " unexpected difference(s)" : "identical"} on home rows, browse, slides, rails, genres and ${titles} titles`);

// What "recommended" mode changes (the mode the device stores): only poster/backdrop should differ.
const rec = V2.fromLegacyHome(home, { poster: "recommended" });
const strip = (it) => { const o = { ...it }; delete o.poster; delete o.backdrop; return o; };
let posterChanged = 0, withBackdrop = 0, other = 0;
for (const it of rec.items) {
  const old = V2.itemById(legacyV2, it.id);
  if (!eq(strip(it), strip(old))) { other++; if (process.env.GOLDEN_VERBOSE) console.log("OTHER", JSON.stringify(strip(old)), JSON.stringify(strip(it))); }
  if (it.poster !== old.poster) posterChanged++;
  if (it.backdrop) withBackdrop++;
}
if (!eq(rec.sections, legacyV2.sections)) {
  const diffs = NAMES.filter((n) => !eq((rec.sections[n] || {}).all, (legacyV2.sections[n] || {}).all) || !eq((rec.sections[n] || {}).rails, (legacyV2.sections[n] || {}).rails));
  if (diffs.length) { bad++; console.log("MISMATCH recommended-mode section indexes", diffs); }
}
console.log(`recommended mode: ${rec.items.length} items, poster changed on ${posterChanged}, backdrop on ${withBackdrop}, other field differences: ${other}`);
const errs = V2.validateCatalog(rec);
console.log(`validateCatalog(recommended): ${errs.length ? errs.join("; ") : "ok"}`);
if (tmp) rmSync(tmp, { recursive: true, force: true });
process.exit(bad || errs.length ? 1 : 0);
