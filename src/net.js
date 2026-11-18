// net.js — conditional GETs and native body decoding.
//
// - `condGet` sends If-None-Match / If-Modified-Since only when it has a validator. Kino re-sends plugin
//   headers on every redirect hop, so the github.com 302 passes through and the release asset answers 304.
// - Kino reports a 304 as `ok: false`, so the status is tested BEFORE `ok`.
// - A body Kino does not consider text (application/octet-stream: the Release assets) crosses as base64;
//   `bodyText` re-encodes it natively with `kino.crypto.convert` (Kino 0.9.74+) instead of `r.text()`,
//   whose JS byte loop costs about 0.7 s per 600 KB on a phone.

/** Mirrors PluginHttp.isText: no content type, text/*, JSON, XML, JavaScript, form data, or a named charset. */
export function isText(r) {
  const h = (r && r.headers) || {};
  const ct = String(h["content-type"] || "").trim().toLowerCase();
  if (!ct) return true;
  if (/;\s*charset\s*=/.test(ct)) return true;
  const mime = ct.split(";")[0].trim();
  const slash = mime.indexOf("/");
  if (slash < 0) return true;
  const type = mime.slice(0, slash), sub = mime.slice(slash + 1);
  return type === "text" || sub === "json" || sub.endsWith("+json") || sub === "xml" || sub.endsWith("+xml") ||
    sub === "javascript" || sub === "x-javascript" || sub === "x-www-form-urlencoded";
}

/** The response body as text: native base64 → utf8 for a binary body when Kino has `crypto.convert`. */
export function bodyText(r) {
  const c = typeof kino !== "undefined" && kino && kino.crypto;
  if (!isText(r) && c && typeof c.convert === "function") {
    try { return c.convert(r.base64(), "base64", "utf8"); } catch (_) { /* fall back to Kino's own decode */ }
  }
  return r.text();
}

/**
 * GET `url` with the validators given.
 * → { status: 200, text, etag, lm } | { status: 304, etag, lm } | { status: "err", code }
 *   `code` is the HTTP status (404, 429, 500…) or Kino's error code ("timeout", "network"…).
 */
export async function condGet(url, opts) {
  const o = opts || {};
  const headers = {};
  if (o.etag) headers["If-None-Match"] = String(o.etag);
  if (o.lm) headers["If-Modified-Since"] = String(o.lm);
  let r;
  try {
    r = await kino.fetch(url, { method: "GET", headers, cookies: false, timeoutMs: o.timeoutMs || 8000 });
  } catch (e) {
    return { status: "err", code: (e && e.code) || "network" };
  }
  const h = (r && r.headers) || {};
  if (r.status === 304) return { status: 304, etag: h.etag || o.etag || "", lm: h["last-modified"] || o.lm || "" };
  if (!r.ok) return { status: "err", code: r.status };
  let text;
  try { text = bodyText(r); } catch (e) { return { status: "err", code: "decode" }; }
  return { status: 200, text, etag: h.etag || "", lm: h["last-modified"] || "" };
}
