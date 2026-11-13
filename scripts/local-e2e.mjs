// Prueba local, end-to-end, del plugin en el Mac: Home (feed), BÚSQUEDA y REPRODUCCIÓN (incluye que el stream bote bytes).
// Corre el plugin real a través del kit; para hablar con el portal necesita:
//   - .kino-secrets.json junto al manifest, con al menos { "magisKey": "<hex>" } (y "feedKey" para probar el feed cifrado).
//   - un pool de seeds frescas; por defecto ~/kino-seed-minter/minted_seeds.json (se puede cambiar con --seeds <ruta>).
// La sesión se siembra inyectando esas seeds directo en storage (no necesita abrir seeds.enc.json ni seedKey).
//
//   node scripts/local-e2e.mjs [--seeds <ruta>] [--q "dragon,amor,batman"] [--no-bytes]
import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; };
const flag = (name) => process.argv.includes("--" + name);
const seedsPath = (arg("seeds", join(process.env.HOME || "", "kino-seed-minter", "minted_seeds.json"))).replace(/^~/, process.env.HOME || "~");
const queries = arg("q", "dragon,amor,batman").split(",").map((s) => s.trim()).filter(Boolean);
const secretsFile = join(root, ".kino-secrets.json");

if (!existsSync(secretsFile)) { console.error("Falta .kino-secrets.json (necesita magisKey) junto al manifest."); process.exit(2); }
if (!existsSync(seedsPath)) { console.error("No encuentro el pool de seeds:", seedsPath, "(usa --seeds <ruta>)"); process.exit(2); }

const { createKino } = await import(pathToFileURL(join(root, "sdk", "kino-shim.mjs")).href);
const { validateManifest } = await import(pathToFileURL(join(root, "sdk", "contract.mjs")).href);
const manifest = validateManifest(readFileSync(join(root, "kino-plugin.json"), "utf8")).manifest;
const tmp = mkdtempSync(join(tmpdir(), "xuper-e2e-"));
const { kino } = createKino(manifest, { storageFile: join(tmp, "s.json"), cookiesFile: join(tmp, "c.json"), secretsFile, config: {}, env: process.env });
globalThis.kino = kino;

// Sembrar la sesión con seeds frescas (sn + userToken) directo al pool en storage.
const rawSeeds = JSON.parse(readFileSync(seedsPath, "utf8"));
const pool = (Array.isArray(rawSeeds) ? rawSeeds : rawSeeds.seeds || [])
  .map((s) => ({ sn: String(s.sn || ""), userId: String(s.userId || ""), userToken: String(s.userToken || ""), jwtToken: String(s.jwtToken || "") }))
  .filter((s) => s.sn && s.userToken)
  .slice(0, 50);
kino.storage.set("seeds", JSON.stringify(pool));
kino.storage.set("seedsAt", String(Date.now()));

const plugin = await import(pathToFileURL(join(root, "src", "plugin.js")).href);
const ms = (t0) => Math.round(performance.now() - t0);
let fails = 0;
const ok = (cond, label) => { console.log((cond ? "✓" : "✗") + " " + label); if (!cond) fails++; };

console.log(`== Prueba local del plugin (seeds: ${pool.length}) ==\n`);

// 1) HOME (feed cifrado)
try {
  const t0 = performance.now();
  const rows = await plugin.home();
  ok(Array.isArray(rows) && rows.length > 0, `HOME: ${Array.isArray(rows) ? rows.length : 0} filas (${ms(t0)} ms)`);
} catch (e) { ok(false, "HOME falló: " + (e && (e.code || e.message))); }

// 2) BÚSQUEDA
let playRef = null;
for (const q of queries) {
  try {
    const t0 = performance.now();
    const r = await plugin.search({ q });
    const items = Array.isArray(r) ? r : (r && r.items) || [];
    ok(items.length > 0, `BÚSQUEDA '${q}': ${items.length} resultados (${ms(t0)} ms)` + (items[0] ? ` — 1ro: ${items[0].title} [${items[0].kind}]` : ""));
    if (!playRef && items[0]) playRef = items[0].ref;
  } catch (e) { ok(false, `BÚSQUEDA '${q}' falló: ` + (e && (e.code || e.message))); }
}

// 3) REPRODUCCIÓN (resolve -> URL -> bytes)
try {
  const t0 = performance.now();
  const res = await plugin.resolve(playRef || "magis1:movie:0:16B8F31243CF4F4898E5051C77290ADA");
  const url = res && (res.url || (res.sources && res.sources[0] && res.sources[0].url));
  ok(!!url, `REPRODUCCIÓN: resolve dio URL (${ms(t0)} ms)` + (url ? ` — ${String(url).slice(0, 70)}…` : ` — claves: ${Object.keys(res || {}).join(",")}`));
  if (url && !flag("no-bytes")) {
    const ua = "Ranger/4.9.4-17294ac0";
    const r = await fetch(url, { headers: { Range: "bytes=0-131071", "User-Agent": ua } });
    const buf = Buffer.from(await r.arrayBuffer());
    ok(r.status === 206 || r.status === 200, `BYTES: HTTP ${r.status}, ${buf.length} bytes, ${r.headers.get("content-type") || "?"}`);
  }
} catch (e) { ok(false, "REPRODUCCIÓN falló: " + (e && (e.code || e.message))); }

console.log(fails === 0 ? "\n✓ TODO OK" : `\n✗ ${fails} fallo(s)`);
process.exit(fails === 0 ? 0 : 1);
