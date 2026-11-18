// to-v2.mjs — the publisher's v2 builder. It turns the legacy Release files (home.json, matches.json, as
// the generator's tools/gen_catalog.py writes them) into the phase-2 payloads of the `data` branch, with the SAME
// src/v2.js the device runs (poster mode "recommended"), so a payload built here and one converted on a device from
// the Release carry the same `hash`.
//
//   node tools/to-v2.mjs [--in <dir>] [--home <home.json>] [--matches <matches.json>] [--out <dir>]
//                        [--gen <epoch ms>] [--live-off <src,src>] [--min-plugin 3.0.0] [--probe-s 300]
//
// Defaults: --in = $XUPER_WORK or ~/.config/xuper-catalog/work (where `publish.sh` keeps the last-good legacy files),
// --home/--matches = <in>/home.json and <in>/matches.json, --out = <in>/out, --gen = now, --live-off =
// $XUPER_LIVE_OFF (comma list; the index's kill switch). Output (only when every check passes):
//   <out>/v2/c/<h12>.json   catalog payload  {schema, hash, gen?, items, sections}
//   <out>/v2/m/<h12>.json   matches payload  {schema, hash, gen?, matches}
//   <out>/index.json        candidate index  {schema, minPlugin, gen, probeS, catalog:{h,n}, matches:{h,n}, live:{off}}
// The payload `gen` is the legacy file's `generatedAt` (so the same input always gives the same bytes); `hash` is
// v2.canonicalHash (16 hex, without gen/hash) and `<h12>` its first 12 characters. stdout gets one JSON summary
// line; problems go to stderr with exit code 1 and nothing written.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  SCHEMA, fromLegacyHome, fromLegacyMatches, seal, canonicalHash, validateCatalog, validateMatches, homeRows,
  SECTION_NAMES,
} from "../src/v2.js";

export const MIN_PLUGIN = "3.0.0";    // the first Xuper that reads the data branch (2.x never does)
export const PROBE_S = 300;
/** Kino stores a value of at most 2 MiB (characters); keep every payload clearly under it. */
export const MAX_FILE_CHARS = 1_900_000;
/** Kino Home: at most 20 rows of at most 60 items per plugin. */
export const HOME_MAX_ROWS = 20;
export const HOME_MAX_ITEMS = 60;
const H12 = /^[0-9a-f]{12}$/;
const H16 = /^[0-9a-f]{16}$/;
const SRC_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Node's sha256 → hex; the device uses kino.crypto.hash("sha256", text) (UTF-8), which gives the same digest. */
export const sha256Hex = (text) => createHash("sha256").update(String(text), "utf8").digest("hex");

const genOf = (legacy) => {
  const g = Number(legacy && legacy.generatedAt);
  return Number.isFinite(g) && g > 0 ? Math.floor(g) : 0;
};

/** Legacy home.json object → sealed v2 catalog (poster "recommended", the device's mode). */
export function buildCatalog(legacyHome) {
  return seal(fromLegacyHome(legacyHome, { poster: "recommended" }), genOf(legacyHome), sha256Hex);
}

/** Legacy matches.json object → sealed v2 matches (`kickoff` is never written: the portal's time zone is unverified). */
export function buildMatches(legacyMatches) {
  return seal(fromLegacyMatches(legacyMatches), genOf(legacyMatches), sha256Hex);
}

/**
 * True when any string (key or value) holds a lone surrogate. Node's JSON.stringify escapes those as `\udXXX`, so the
 * published text looks fine, but an engine without well-formed stringify would hash a different text on the device.
 */
function hasLoneSurrogate(v) {
  if (typeof v === "string") return LONE_SURROGATE.test(v);
  if (Array.isArray(v)) return v.some(hasLoneSurrogate);
  if (v && typeof v === "object") return Object.keys(v).some((k) => LONE_SURROGATE.test(k) || hasLoneSurrogate(v[k]));
  return false;
}

/** The checks every payload text gets, whatever its kind: size, well-formed UTF-16, and the device's own hash check. */
function checkText(kind, obj, text, maxChars, validate, objValid) {
  const bad = [];
  if (typeof text !== "string") return [kind + ": no text"];
  if (text.length > maxChars) bad.push(`${kind}: ${text.length} characters, over the ${maxChars} limit`);
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > maxChars) bad.push(`${kind}: ${bytes} bytes, over the ${maxChars} limit`);
  if (hasLoneSurrogate(obj)) bad.push(kind + ": a lone surrogate would hash differently on the device");
  if (!obj || !H16.test(String(obj.hash || ""))) bad.push(kind + ": hash is not 16 hex");
  // What data.js does with a downloaded part: parse, validate, recompute the hash, compare with the name.
  let back = null;
  try { back = JSON.parse(text); } catch (e) { bad.push(kind + ": the text does not parse back"); }
  if (back) {
    if (objValid) for (const p of validate(back)) bad.push(kind + " (as parsed): " + p);
    if (canonicalHash(back, sha256Hex) !== back.hash) bad.push(kind + ": hash does not survive a parse round trip");
    if (obj && back.hash !== obj.hash) bad.push(kind + ": the text is not the object that was checked");
  }
  return bad;
}

/**
 * Every rule a v2 catalog must pass before it is published: v2.validateCatalog (spec §2.4 plus Kino's item limits:
 * id pattern, title ≤ 200, overview ≤ 2,000, https images ≤ 2,048 characters, no "", every title of an adult section
 * `adult: true` — the same check the device runs), Kino Home (≤ 20 rows × ≤ 60 items), file size, and the device's
 * hash check.
 * → [] or a list of problems.
 */
export function checkCatalog(v2, text = JSON.stringify(v2), { maxChars = MAX_FILE_CHARS } = {}) {
  const bad = validateCatalog(v2).map((p) => "catalog: " + p);
  const objValid = !bad.length;
  if (objValid) {
    const rows = homeRows(v2);
    if (rows.length > HOME_MAX_ROWS) bad.push(`catalog: ${rows.length} Home rows, over ${HOME_MAX_ROWS}`);
    for (const r of rows) if (r.items.length > HOME_MAX_ITEMS) bad.push(`catalog: Home row ${r.id} has ${r.items.length} items, over ${HOME_MAX_ITEMS}`);
    if (!SECTION_NAMES.some((n) => v2.sections[n])) bad.push("catalog: no known section");
  }
  return bad.concat(checkText("catalog", v2, text, maxChars, validateCatalog, objValid));
}

/** Every rule a v2 matches payload must pass (v2.validateMatches, size, hash round trip). → [] or problems. */
export function checkMatches(m2, text = JSON.stringify(m2), { maxChars = MAX_FILE_CHARS } = {}) {
  const bad = validateMatches(m2).map((p) => "matches: " + p);
  return bad.concat(checkText("matches", m2, text, maxChars, validateMatches, !bad.length));
}

/** The candidate index's own rules (the device ignores an index that breaks them). → [] or problems. */
export function checkIndex(ix) {
  const bad = [];
  if (!ix || ix.schema !== SCHEMA) bad.push("index: schema is not 2");
  if (!VERSION.test(String(ix && ix.minPlugin))) bad.push("index: minPlugin is not x.y.z");
  if (!(Number.isInteger(ix && ix.probeS) && ix.probeS >= 60 && ix.probeS <= 3600)) bad.push("index: probeS is not 60–3600");
  for (const k of ["catalog", "matches"]) {
    const e = ix && ix[k];
    if (!e || !H12.test(String(e.h || ""))) bad.push(`index: ${k}.h is not 12 hex`);
    else if (!(Number.isInteger(e.n) && e.n > 0)) bad.push(`index: ${k}.n`);
  }
  const off = ix && ix.live && ix.live.off;
  if (!Array.isArray(off) || !off.every((s) => typeof s === "string" && SRC_ID.test(s))) bad.push("index: live.off");
  return bad;
}

/** "a, b" | ["a","b"] → ["a","b"] (trimmed, unique, kept in order). */
export function parseLiveOff(v) {
  const list = Array.isArray(v) ? v : String(v || "").split(",");
  return [...new Set(list.map((s) => String(s).trim()).filter(Boolean))];
}

/**
 * Pure build: legacy objects → `{ ok, problems, files: [{path, text}], index, indexText, summary }`.
 * Nothing is written; `files` is empty when `ok` is false.
 */
export function toV2({ home, matches, gen = Date.now(), liveOff = [], minPlugin = MIN_PLUGIN, probeS = PROBE_S, maxChars } = {}) {
  const problems = [];
  let cat = null, mat = null, catText = "", matText = "";
  try { cat = buildCatalog(home); catText = JSON.stringify(cat); } catch (e) { problems.push("catalog: build failed: " + ((e && e.message) || e)); }
  try { mat = buildMatches(matches); matText = JSON.stringify(mat); } catch (e) { problems.push("matches: build failed: " + ((e && e.message) || e)); }
  if (cat) problems.push(...checkCatalog(cat, catText, { maxChars }));
  if (mat) problems.push(...checkMatches(mat, matText, { maxChars }));
  const index = {
    schema: SCHEMA,
    minPlugin: String(minPlugin),
    gen: Math.floor(Number(gen)) || Date.now(),
    probeS: Number(probeS),
    catalog: cat ? { h: String(cat.hash).slice(0, 12), n: Buffer.byteLength(catText, "utf8") } : null,
    matches: mat ? { h: String(mat.hash).slice(0, 12), n: Buffer.byteLength(matText, "utf8") } : null,
    live: { off: parseLiveOff(liveOff) },
  };
  if (cat && mat) problems.push(...checkIndex(index));
  const ok = problems.length === 0;
  const files = ok ? [
    { path: `v2/c/${index.catalog.h}.json`, text: catText },
    { path: `v2/m/${index.matches.h}.json`, text: matText },
  ] : [];
  const indexText = JSON.stringify(index, null, 2) + "\n";
  const summary = ok ? {
    catalog: { h: index.catalog.h, n: index.catalog.n, items: cat.items.length, gen: cat.gen || 0 },
    matches: { h: index.matches.h, n: index.matches.n, count: mat.matches.length, gen: mat.gen || 0 },
    index: { n: Buffer.byteLength(indexText, "utf8"), gen: index.gen, liveOff: index.live.off },
  } : null;
  return { ok, problems, files, index, indexText, summary };
}

/** Writes a successful build under `outDir` (each file through a temporary name, then renamed into place). */
export function writeOut(outDir, built) {
  if (!built.ok) throw new Error("refusing to write a build with problems");
  const put = (rel, text) => {
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    const tmp = dest + ".tmp-" + process.pid;
    writeFileSync(tmp, text);
    renameSync(tmp, dest);
  };
  for (const f of built.files) put(f.path, f.text);
  put("index.json", built.indexText);   // last: the index never names a file that is not there yet
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error("unexpected argument " + a);
    const k = a.slice(2);
    if (i + 1 >= argv.length) throw new Error("missing value for " + a);
    o[k] = argv[++i];
  }
  return o;
}

function readJson(path, what) {
  let text;
  try { text = readFileSync(path, "utf8"); } catch (e) { throw new Error(`cannot read ${what} ${path}: ${e.code || e.message}`); }
  try { return JSON.parse(text); } catch (e) { throw new Error(`${what} ${path} is not JSON: ${e.message}`); }
}

export function main(argv = process.argv.slice(2), env = process.env) {
  let a;
  try { a = parseArgs(argv); } catch (e) {
    console.error("to-v2: " + e.message);
    console.error("usage: node tools/to-v2.mjs [--in dir] [--home f] [--matches f] [--out dir] [--gen ms] [--live-off a,b] [--min-plugin x.y.z] [--probe-s n]");
    return 2;
  }
  const inDir = resolve(a.in || env.XUPER_WORK || join(homedir(), ".config/xuper-catalog/work"));
  const out = resolve(a.out || join(inDir, "out"));
  let home, matches;
  try {
    home = readJson(resolve(a.home || join(inDir, "home.json")), "home");
    matches = readJson(resolve(a.matches || join(inDir, "matches.json")), "matches");
  } catch (e) { console.error("to-v2: " + e.message); return 1; }
  const t0 = Date.now();
  const built = toV2({
    home, matches,
    gen: a.gen !== undefined ? Number(a.gen) : Date.now(),
    liveOff: parseLiveOff(a["live-off"] !== undefined ? a["live-off"] : env.XUPER_LIVE_OFF),
    minPlugin: a["min-plugin"] || MIN_PLUGIN,
    probeS: a["probe-s"] !== undefined ? Number(a["probe-s"]) : PROBE_S,
  });
  if (!built.ok) {
    console.error("to-v2: refused, nothing written:");
    for (const p of built.problems) console.error("  - " + p);
    return 1;
  }
  writeOut(out, built);
  console.log(JSON.stringify({ out, ms: Date.now() - t0, ...built.summary }));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
