import { test } from "node:test";
import assert from "node:assert/strict";
import { installKino, res } from "./helpers/fake-kino.mjs";
import { condGet, bodyText, isText } from "../src/net.js";

test("If-None-Match / If-Modified-Since are sent only with a validator", async () => {
  const { requests } = installKino({ routes: [() => res(200, "{}", { "content-type": "application/json" })] });
  await condGet("https://x/a.json", {});
  await condGet("https://x/a.json", { etag: 'W/"abc"', lm: "Mon, 16 Nov 2026 10:00:00 GMT" });
  assert.deepEqual(requests[0].headers, {});
  assert.deepEqual(requests[1].headers, { "If-None-Match": 'W/"abc"', "If-Modified-Since": "Mon, 16 Nov 2026 10:00:00 GMT" });
});

test("a 304 (ok:false in Kino) is reported as 304, not as an error, and keeps the validator", async () => {
  installKino({ routes: [() => res(304, "")] });
  const r = await condGet("https://x/a.json", { etag: '"e1"' });
  assert.equal(r.status, 304);
  assert.equal(r.etag, '"e1"');
});

test("a 200 returns the text and the new validators", async () => {
  installKino({ routes: [() => res(200, '{"a":1}', { "content-type": "text/plain; charset=utf-8", ETag: '"e2"', "Last-Modified": "LM" })] });
  const r = await condGet("https://x/a.json", {});
  assert.deepEqual(r, { status: 200, text: '{"a":1}', etag: '"e2"', lm: "LM" });
});

test("errors: HTTP status or Kino's error code", async () => {
  installKino({ routes: [(u) => (u.endsWith("/404") ? res(404, "") : new (class extends Error { code = "timeout"; })("t"))] });
  assert.deepEqual(await condGet("https://x/404", {}), { status: "err", code: 404 });
  assert.deepEqual(await condGet("https://x/slow", {}), { status: "err", code: "timeout" });
});

test("an octet-stream body is decoded natively through kino.crypto.convert", async () => {
  const { kino } = installKino({ routes: [() => res(200, '{"ñ":"ü"}', {}, { binary: true })] });
  const r = await condGet("https://x/home.json", {});
  assert.equal(r.text, '{"ñ":"ü"}');
  assert.equal(kino.crypto.convertCalls, 1);
});

test("without crypto.convert (older Kino) the body falls back to r.text()", async () => {
  const { kino } = installKino({ convert: false, routes: [() => res(200, '{"a":2}', {}, { binary: true })] });
  const r = await condGet("https://x/home.json", {});
  assert.equal(r.text, '{"a":2}');
  assert.equal(typeof kino.crypto.convert, "undefined");
});

test("a text body never goes through convert", () => {
  const { kino } = installKino();
  const r = res(200, "hola", { "content-type": "application/json" });
  assert.equal(bodyText(r), "hola");
  assert.equal(kino.crypto.convertCalls, undefined);
});

test("isText mirrors PluginHttp.isText", () => {
  const t = (ct) => isText({ headers: ct === null ? {} : { "content-type": ct } });
  assert.equal(t(null), true);
  assert.equal(t("text/plain"), true);
  assert.equal(t("application/json"), true);
  assert.equal(t("application/vnd.api+json"), true);
  assert.equal(t("application/xml"), true);
  assert.equal(t("application/octet-stream; charset=utf-8"), true);
  assert.equal(t("application/octet-stream"), false);
  assert.equal(t("image/png"), false);
});
