// publish-state.mjs — the small stateful helpers `publish.sh` needs, kept in node so the shell script stays simple.
// State lives in $XUPER_STATE_DIR (default ~/.config/xuper-catalog/state); nothing here talks to the network.
//
//   node tools/publish-state.mjs legacy-hash <file>        prints the canonical hash of a legacy Release file
//   node tools/publish-state.mjs changed <asset> <file>    exit 0 = differs from the last upload (or none), 1 = same
//   node tools/publish-state.mjs mark <asset> <file>       records <file>'s hash as <asset>'s last upload
//   node tools/publish-state.mjs catalog-due               exit 0 = the 06:00/18:00 catalog slot is due, 1 = not yet
//   node tools/publish-state.mjs catalog-done              records that the catalog was generated now
//   node tools/publish-state.mjs status --file <f> --mode <m> --started <ms> --exit <n>
//        [--to-v2 <json file>] [--data <json file>] [--release <asset=result>]…   writes publish-status.json
//
// Release hash-skip (replaces spec P0's Python part): an asset is uploaded again only when its canonical hash
// changed. The canonical form is the parsed JSON without the top-level `generatedAt`, with object keys sorted, so a
// regenerated but identical file keeps the asset (and its ETag: devices then get a 304 with 0 bytes).
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export const SLOT_HOURS = [6, 18];
const ASSET = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Deep copy with object keys sorted (arrays keep their order). */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}

/** The canonical text of a legacy file: no top-level `generatedAt`, keys sorted. */
export function legacyCanonical(obj) {
  const rest = {};
  for (const k of Object.keys(obj || {})) if (k !== "generatedAt") rest[k] = obj[k];
  return JSON.stringify(sortKeys(rest));
}

/** First 16 hex characters of sha256 over `legacyCanonical`. */
export function legacyHash(obj) {
  return createHash("sha256").update(legacyCanonical(obj), "utf8").digest("hex").slice(0, 16);
}

export function legacyHashOfFile(path) {
  return legacyHash(JSON.parse(readFileSync(path, "utf8")));
}

/** The latest catalog slot (06:00 or 18:00, the Mac's local time) at or before `now`, as epoch ms. */
export function lastSlot(now = Date.now(), hours = SLOT_HOURS) {
  const d = new Date(now);
  const hs = [...hours].sort((a, b) => b - a);
  for (let back = 0; back < 2; back++) {
    for (const h of hs) {
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, h, 0, 0, 0).getTime();
      if (t <= now) return t;
    }
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, hs[0]).getTime();
}

/** Due when the catalog was not generated since the latest slot. */
export function catalogDue(slots, now = Date.now()) {
  const at = Number(slots && slots.catalogAt) || 0;
  return at < lastSlot(now);
}

export function stateDir(env = process.env) {
  return resolve(env.XUPER_STATE_DIR || join(homedir(), ".config/xuper-catalog/state"));
}

function readJsonOr(path, fallback) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch (_) { return fallback; }
}

function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function readStoredHash(dir, asset) {
  try { return readFileSync(join(dir, asset + ".hash"), "utf8").trim(); } catch (_) { return ""; }
}

function parseFlags(argv) {
  const o = { release: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const k = String(argv[i] || "").replace(/^--/, "");
    if (k === "release") o.release.push(argv[i + 1]); else o[k] = argv[i + 1];
  }
  return o;
}

/** Runs one subcommand; returns the exit code. `out`/`err` are injectable for tests. */
export function main(argv = process.argv.slice(2), env = process.env, out = console.log, err = console.error) {
  const [cmd, ...rest] = argv;
  const dir = stateDir(env);
  try {
    switch (cmd) {
      case "legacy-hash": {
        out(legacyHashOfFile(rest[0]));
        return 0;
      }
      case "changed":
      case "mark": {
        const [asset, file] = rest;
        if (!ASSET.test(String(asset || "")) || !file) { err("publish-state: " + cmd + " <asset> <file>"); return 2; }
        const h = legacyHashOfFile(file);
        if (cmd === "mark") { writeAtomic(join(dir, asset + ".hash"), h + "\n"); out(h); return 0; }
        const before = readStoredHash(dir, asset);
        out(h);
        return before === h ? 1 : 0;
      }
      case "catalog-due": {
        return catalogDue(readJsonOr(join(dir, "slots.json"), {}), Date.now()) ? 0 : 1;
      }
      case "catalog-done": {
        const p = join(dir, "slots.json");
        writeAtomic(p, JSON.stringify({ ...readJsonOr(p, {}), catalogAt: Date.now() }) + "\n");
        return 0;
      }
      case "status": {
        const f = parseFlags(rest);
        if (!f.file) { err("publish-state: status --file <path> …"); return 2; }
        const now = Date.now();
        const status = {
          mode: f.mode || "",
          startedAt: Number(f.started) || 0,
          finishedAt: now,
          ms: Number(f.started) ? now - Number(f.started) : null,
          exit: Number(f.exit) || 0,
          toV2: f["to-v2"] ? readJsonOr(f["to-v2"], null) : null,
          data: f.data ? readJsonOr(f.data, null) : null,
          release: Object.fromEntries(f.release.filter(Boolean).map((s) => { const i = s.indexOf("="); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; })),
        };
        writeAtomic(resolve(f.file), JSON.stringify(status, null, 2) + "\n");
        return 0;
      }
      default:
        err("usage: node tools/publish-state.mjs legacy-hash|changed|mark|catalog-due|catalog-done|status …");
        return 2;
    }
  } catch (e) {
    err("publish-state " + cmd + ": " + ((e && e.message) || e));
    return 3;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
