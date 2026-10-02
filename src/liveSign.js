// Per-request signing of a live channel (native-magis.md §6.5; native LiveHlsProxy.contentAuth and
// requestFromOrigin). Pure: no kino at all, only the request, the signContext `resolve` returned and
// the moment it is given. It runs in the signing lane, where storage, cookies, sleep and fetch are
// refused, and must answer well inside 1.5 s (a local MD5: microseconds).
//
// signContext (≤ 4096 chars), compact keys: { "l": <license>, "c": [{ "h": <cflHost>, "a": <authBase>, "t": <token> }, …] }
// in portal order, the first entry being the stream's own host. `t` is dropped first when the
// context would not fit: it is always re-read from `a`, where the portal put it.
import { signO3 } from "./tweakedMd5.js";
import { LIVE_USER_AGENT, LIVE_APP, LIVE_APP_VERSION, LIVE_X_BUFFER } from "./config.js";

export const MAX_CONTEXT_CHARS = 4096; // SDK cap on signContext
const TOKEN = /token=([0-9A-Fa-f]{32})/;
const HEX32 = /^[0-9A-Fa-f]{32}$/;
const AUTHORITY = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/([^/?#]*)/;

/** The `token=<32 hex>` inside an authBase (native ChannelCdn.token), or "". */
export function tokenOf(authBase) {
  const m = TOKEN.exec(typeof authBase === "string" ? authBase : "");
  return m ? m[1] : "";
}

// `host` or `host:port`, lower-cased; http's default port is dropped (the proxy's URL never carries it).
const normalize = (authority) => String(authority).toLowerCase().replace(/:80$/, "");

/** The authority of [url] as `normalize` writes it, or "" when it is not an absolute url. */
export function authorityOf(url) {
  const m = AUTHORITY.exec(typeof url === "string" ? url : "");
  if (!m) return "";
  const at = m[1].lastIndexOf("@");
  return normalize(at >= 0 ? m[1].slice(at + 1) : m[1]);
}

/**
 * The signContext for [license] and [cdns] ({cflHost, authBase}, primary first): every CDN with its
 * token when it fits; else without the token fields; else the trailing CDNs go. `kept` is the CDNs
 * the context carries (the stream may only offer those as alternates). Null when not even the
 * primary fits.
 */
export function buildSignContext(license, cdns) {
  const encode = (list, withToken) => JSON.stringify({
    l: license,
    c: list.map((d) => (withToken ? { h: d.cflHost, a: d.authBase, t: tokenOf(d.authBase) } : { h: d.cflHost, a: d.authBase })),
  });
  const full = encode(cdns, true);
  if (full.length <= MAX_CONTEXT_CHARS) return { context: full, kept: cdns };
  for (let n = cdns.length; n >= 1; n--) {
    const kept = cdns.slice(0, n);
    const context = encode(kept, false);
    if (context.length <= MAX_CONTEXT_CHARS) return { context, kept };
  }
  return null;
}

function readContext(context) {
  let ctx;
  try { ctx = JSON.parse(context); } catch (_) { ctx = null; }
  const ok = ctx && typeof ctx === "object" && typeof ctx.l === "string" && Array.isArray(ctx.c) && ctx.c.length > 0
    && ctx.c.every((d) => d && typeof d.h === "string" && typeof d.a === "string");
  if (!ok) throw new Error("live signContext is not readable");
  return ctx;
}

/**
 * Headers for one CDN request. The CDN is the context entry whose host is the request's own
 * (token and host must belong to the same entry: the crossed pair is what the CDN rejects with a
 * 401); a host in no entry (one the playlist itself named) gets the first entry, as native signs
 * everything with its active CDN. [nowMs] is the signing moment, sent in the clear next to the
 * signature computed over it.
 */
export function signRequest({ url, context }, nowMs) {
  const ctx = readContext(context);
  const want = authorityOf(url);
  const cdn = ctx.c.find((d) => normalize(d.h) === want) || ctx.c[0];
  const token = typeof cdn.t === "string" && HEX32.test(cdn.t) ? cdn.t : tokenOf(cdn.a);
  if (token === "") throw new Error("live CDN entry without a token");
  const moment = Math.trunc(nowMs);
  return {
    headers: {
      "Content-Auth": `${cdn.a}&sign2_method=sign_o3&instance=0&start_moment=${moment}&sign2=${signO3(token, moment)}`,
      "Content-License": ctx.l,
      "User-Agent": LIVE_USER_AGENT,
      App: LIVE_APP,
      "App-Version": LIVE_APP_VERSION,
      "X-Buffer": LIVE_X_BUFFER,
    },
  };
}
