import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createKino } from "../../sdk/kino-shim.mjs";

// Stand-in 24-byte 3DES key: the real one is sealed and only exists inside the app.
export const STAND_IN_KEY = "000102030405060708090a0b0c0d0e0f1011121314151617";

const manifest = {
  id: "xuper", name: "Xuper", version: "2.0.0", apiVersion: 6, entry: "plugin.js",
  hosts: ["api.themoviedb.org", "raw.githubusercontent.com"],
  capabilities: ["search", "home", "browse", "episodes", "resolve", "download"],
  streamHosts: "any",
  secrets: { magisKey: { seal: "kino-sealed:v1:stand-in", use: "cipher-key", encoding: "hex" } },
  settings: [
    { key: "email", label: "Correo electrónico", type: "text" },
    { key: "password", label: "Contraseña", type: "password" },
  ],
};

/**
 * The kit's own simulation (secret/crypto/storage/error/config), with only `fetch` (scripted by the
 * test) and `sleep` (no-op) replaced. `secrets` adds or overrides secret values.
 */
export function fakeKino({ secrets = {}, config = {}, fetch } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "fakekino-"));
  const secretsFile = join(dir, ".kino-secrets.json");
  writeFileSync(secretsFile, JSON.stringify({ magisKey: STAND_IN_KEY, ...secrets }));
  const { kino } = createKino(manifest, { secretsFile, config });
  return Object.freeze({
    ...kino,
    fetch: fetch ?? (async (url) => { throw new Error("unscripted fetch: " + url); }),
    sleep: async () => {},
  });
}
