// The author signature Kino checks on every install and update (app: SignedEntry; kit: sdk/seal.mjs). It covers
// plugin.js's exact bytes as raw.githubusercontent.com serves them, for this repository, this id and this version, and
// Kino pins its key at the first signed install: every later version must carry the same one, or Kino refuses it until
// the person uninstalls. Sign again after the last change to plugin.js or the version:
//   node <kit>/seal.mjs --sign --repo xuper-plugin/kino-plugin-xuper --manifest kino-plugin.json --key <the xuper-plugin author key>
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createPublicKey, verify } from "node:crypto";

const BINDING = "xuper-plugin/kino-plugin-xuper";
/**
 * The xuper-plugin author key (fingerprint E04E-EA25-1A34-290E): the one Kino 0.9.88+ gives kino.identity's gate token
 * to besides its own (PluginIdentityBridge TOKEN_AUTHORS), so the backend's sign-in works. Never another key: Kino pins
 * the first one it sees for good.
 */
const XUPER_AUTHOR_KEY = "6693946bd5c56196960959c4b9665fad5094374bcb85ddb282f8bf762c835263";
const DOMAIN = "kino-signed-entry:v1";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const manifest = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8"));
const entry = readFileSync(new URL("../" + manifest.entry, import.meta.url));
const fingerprint = (hex) => createHash("sha256").update(Buffer.from(hex, "hex")).digest().subarray(0, 8).toString("hex").toUpperCase().match(/.{4}/g).join("-");

test("the manifest's signature covers plugin.js's exact bytes, for this repository, id and version", () => {
  const sig = manifest.signature;
  assert.ok(sig && /^[0-9a-f]{64}$/.test(sig.authorKey) && /^[0-9a-f]{128}$/.test(sig.value), "signed (node <kit>/seal.mjs --sign)");
  const digest = createHash("sha256").update(entry).digest("hex");
  const message = Buffer.from(`${DOMAIN}\n${BINDING}\n${manifest.id}\n${manifest.version}\n${digest}`, "utf8");
  const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(sig.authorKey, "hex")]), format: "der", type: "spki" });
  assert.ok(verify(null, message, key, Buffer.from(sig.value, "hex")), "the signature does not match plugin.js (sign again after the last change)");
});

test("plugin.js and the manifest are stored byte for byte (LF only, `* -text`), as they were signed", () => {
  assert.ok(!entry.includes(0x0d), "plugin.js holds a CR: raw would serve other bytes than the signed ones");
  assert.match(readFileSync(new URL("../.gitattributes", import.meta.url), "utf8"), /^\* -text$/m);
});

test("signed with the xuper-plugin author key (E04E-EA25-1A34-290E), the one Kino gives the identity token to", () => {
  assert.equal(fingerprint(XUPER_AUTHOR_KEY), "E04E-EA25-1A34-290E");
  const got = manifest.signature ? manifest.signature.authorKey : "";
  assert.equal(got, XUPER_AUTHOR_KEY,
    `signed with ${got ? fingerprint(got) : "no key"}: Kino would pin that key on every device that updates, and without ` +
    "the token the backend's sign-in fails there. Sign again with the xuper-plugin author key before publishing.");
});
