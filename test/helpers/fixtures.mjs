// Parity fixtures: real captured payloads, kept OUTSIDE every repo (real titles and hosts).
// Override the location with KINO_FIXTURES. A missing directory fails loudly: tests never skip.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const fixturesDir = process.env.KINO_FIXTURES ?? path.join(os.homedir(), "kino-upload/fixtures/xuper-parity");

if (!existsSync(fixturesDir)) {
  throw new Error(`parity fixtures directory not found: ${fixturesDir} (set KINO_FIXTURES or restore ~/kino-upload/fixtures/xuper-parity)`);
}

export const fixturePath = (name) => path.join(fixturesDir, name);

export function readFixture(name) {
  const file = fixturePath(name);
  if (!existsSync(file)) throw new Error(`parity fixture not found: ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}
