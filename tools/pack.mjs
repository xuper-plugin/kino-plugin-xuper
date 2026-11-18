// Packs the plugin into an installable `.kinoplugin` file (a ZIP + kino-export.json), per Kino's
// PluginFileFormat (format 1). Import via Kino ▸ Ajustes ▸ Plugins ▸ Agregar ▸ "Importar plugin desde un archivo".
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ROOT = new URL("../", import.meta.url);
const KINO_VERSION = "0.0.0-local";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export async function pack() {
  const manifestBytes = readFileSync(new URL("kino-plugin.json", ROOT));
  const m = JSON.parse(manifestBytes);

  // The only files Kino's reader accepts for this manifest: the manifest, its entry, its icon.
  const files = [
    ["kino-plugin.json", manifestBytes],
    [m.entry, readFileSync(new URL(m.entry, ROOT))],
  ];
  if (m.icon) files.push([m.icon, readFileSync(new URL(m.icon, ROOT))]);

  const hashes = {};
  for (const [name, data] of files) hashes[name] = sha256(data);
  const sortedFiles = Object.fromEntries(Object.keys(hashes).sort().map((k) => [k, hashes[k]]));

  const info = {
    format: 1,
    exportedAt: new Date().toISOString(),
    pluginId: m.id,
    name: String(m.name).slice(0, 200),
    version: m.version,
    originalAddress: null,
    kinoVersion: KINO_VERSION,
    files: sortedFiles,
  };

  const zip = new JSZip();
  for (const [name, data] of files) zip.file(name, data);
  zip.file("kino-export.json", Buffer.from(JSON.stringify(info, null, 2), "utf8")); // last entry
  const bytes = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  return { fileName: `${m.id}-${m.version}.kinoplugin`, bytes };
}

// Run directly (`node tools/pack.mjs`): write dist/<fileName>.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { fileName, bytes } = await pack();
  mkdirSync(new URL("dist/", ROOT), { recursive: true });
  writeFileSync(new URL(`dist/${fileName}`, ROOT), bytes);
  console.log(`wrote dist/${fileName} (${bytes.length} bytes)`);
}
