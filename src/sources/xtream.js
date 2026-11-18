// src/sources/xtream.js — GENERIC Xtream Codes live connector (factory `makeXtream`), used by supertv and its secondary
// panels (supertv2, supertv3). Every Xtream server speaks the same player_api.php:
//   get_live_categories  -> categories        get_live_streams(category_id) -> channels
//   {server}/live/{user}/{pass}/{stream_id}.{m3u8|ts}  -> the playable stream.
//
// The channel id ENCODES the whole account (server·user·pass·stream_id) with a \u0001 separator, so resolve() is
// self-contained and deterministic: it plays EXACTLY the server the channel came from, with no network and no
// dependency on which account is remembered now. The <channel> is URL-encoded in the aggregator's ref, so the
// separator never collides. (Ids and refs are 1.0.43's.) `conn.accountOf(channelId)` names that account ("url|user"):
// a merged channel's resolve tells copies on one account from copies on another panel with it.
//
// Accounts (spec §5.1, supertv row):
//   - The working account is REMEMBERED across calls (`cfg.account.load/save`, supertv keeps it in o2:stv).
//     A list uses it directly while it was verified less than `accountFreshMs` (6 h) ago: 1 request.
//   - Picking an account: the remembered one first (1 request), else the candidates from `cfg.getAccounts` in
//     batches of 6 with timeoutMs 3,000; the first success IN PRIORITY ORDER wins (not the fastest), so the same
//     server keeps being chosen. `cfg.onPicked(acc, raw, shaped)` hears of every pick (supertv notes its panel).
//   - The probe IS `get_live_categories` (`probeShared`: one request per account and call, whoever asks — the
//     secondary panels' search reuses the primary's batch for free): its answer is reused as the categories (no second
//     request), and a list fetched right after a pick hands them to the framework (`ctx.setCats`). A server whose
//     categories all fail the connector's filter counts as a failed probe: it is never picked (nor kept) with nothing
//     to show.
//   - Each channel id encodes its account, and each server numbers its categories its own way: when the remembered
//     account changes, every stored list of the source is dropped (`ctx.dropLists`), so no list keeps serving a dead
//     account's URLs, or another server's channels under a colliding category id.
//   - A redirect off the server's host (an ISP block page such as coljuegos.gov.co) counts as a failure and is
//     never followed (`redirect: "manual"`); a redirect on the same host is followed once.
//   - Errors say whether the server REFUSED (`hardRefusal`: auth 0, a 4xx refusal or a 509, a redirect off its host, a
//     JSON answer that is not a category list) or could not be reached (a timeout, the network, a 5xx, an answer that is
//     not JSON such as a captive portal's page, this call's own limits).
// A secondary connector (`cfg.secondary`) keeps the shaping, lists and resolve but brings its own account flow
// (src/sources/supertv.js): `{ of, active(), categories(ctx, kit), channels(cat, ctx, kit) }`, kit = { shapeCats,
// listStreams(acc, cat) }.
// Single flight per call through src/flight.js (`<flight>:acct`, `xt:probe:<url|user>`); nothing is kept in module
// memory across calls.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { once } from "../flight.js";
import { isAdultTitle } from "./adult.js";

const SEP = "\u0001";
const MIME = { m3u8: "application/vnd.apple.mpegurl", ts: "video/mp2t" };
const H = 60 * 60 * 1000;

function qs(obj) {
  const out = [];
  for (const k of Object.keys(obj)) out.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(obj[k])));
  return out.join("&");
}

export function encodeChannel(acc, streamId) {
  return acc.url + SEP + acc.username + SEP + acc.password + SEP + String(streamId);
}

export function hostnameOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ""; } }

const accKey = (a) => (a ? a.url + "|" + a.username : "");
const why = (e) => String((e && (e.message || e.code)) || e).slice(0, 60);

/** The account a channel id encodes ("url|user"), or null. */
function accountOf(channelId) {
  const p = String(channelId || "").split(SEP);
  return p.length >= 4 && p[0] && p[1] ? p[0] + "|" + p[1] : null;
}

/** An error that means the server refused (not that it could not be reached). */
function refused(msg) { const e = new Error(msg); e.hard = true; return e; }

/** Whether an error is a server's refusal: auth 0, an HTTP refusal, a redirect off its host, not a category list. */
export const hardRefusal = (e) => !!e && e.hard === true;

/**
 * An HTTP status that refuses: a 4xx other than 408, 425 and 429 (a busy server), and 509 (the account over its
 * bandwidth or connections, as these shared accounts answer). Any other 5xx is the server failing for now, not a verdict
 * on the account: it counts as unreachable.
 */
const refusal = (st) => (st >= 400 && st < 500 && st !== 408 && st !== 425 && st !== 429) || st === 509;

function headersFor(ua) {
  const h = { "Accept": "application/json,text/plain,*/*", "Cache-Control": "no-cache", "Pragma": "no-cache" };
  if (ua) h["User-Agent"] = ua;
  return h;
}

function locationOf(r, base) {
  const h = (r && r.headers) || {};
  const loc = h.location || h.Location || "";
  if (!loc) return "";
  try { return new URL(String(loc), base).toString(); } catch (_) { return ""; }
}

async function get(url, ua, timeoutMs) {
  try {
    return await liveFetch(url, { method: "GET", headers: headersFor(ua), cookies: false, timeoutMs: timeoutMs || 15000, redirect: "manual" });
  } catch (e) {
    // OkHttp refuses to read some answers and reports them as a "network" error that still names the status
    // ("Received HTTP_PROXY_AUTH (407) …"): that is the server refusing.
    const m = e && e.code === "network" ? /\((\d{3})\)/.exec(String(e.message || "")) : null;
    if (m && refusal(Number(m[1]))) throw Object.assign(new Error(String(e.message || "network")), { code: "network", hard: true });
    throw e;
  }
}

async function call(acc, action, extra, timeoutMs, ua) {
  const url = acc.url + "/player_api.php?" + qs({ username: acc.username, password: acc.password, ...(action ? { action } : {}), ...(extra || {}) });
  let r = await get(url, ua, timeoutMs);
  if (r && r.status >= 300 && r.status < 400) {
    const next = locationOf(r, url);
    const host = hostnameOf(next);
    if (!next || host !== hostnameOf(acc.url)) throw refused("redirect off the server's host (" + (host || "?") + ")");
    r = await get(next, ua, timeoutMs);
    if (r && r.status >= 300 && r.status < 400) throw refused("too many redirects");
  }
  if (!r || !r.ok) {
    const e = new Error("api " + (r && r.status));
    if (r && refusal(Number(r.status))) e.hard = true;
    throw e;
  }
  // An answer that is not JSON (a captive portal's or a proxy's HTML page) says nothing about the account: unreachable.
  let data;
  try { data = r.json(); } catch (_) { throw new Error("respuesta no-JSON"); }
  if (data && !Array.isArray(data) && data.user_info && String(data.user_info.auth) === "0") throw refused("auth 0");
  return data;
}

/**
 * One account's raw get_live_categories, fetched at most once per call whoever asks (the first caller's User-Agent and
 * timeout). Throws a refusal for an answer that is not a non-empty category list.
 */
export function probeShared(acc, ua, timeoutMs) {
  return once("xt:probe:" + accKey(acc), async () => {
    const cats = await call(acc, "get_live_categories", {}, timeoutMs, ua);
    if (!Array.isArray(cats) || !cats.length) throw refused("sin categorías");
    return cats;
  });
}

/** The flight key `probeShared` uses for an account (whether this call already probed it: `inFlight(key)`). */
export const probeKey = (acc) => "xt:probe:" + accKey(acc);

// cfg:
//   id, name, genre?          — connector identity ("otros" by default)
//   ua?                       — User-Agent for EVERY request (some hosts block generic UAs)
//   ext?: "m3u8" | "ts"       — live stream format (default "m3u8" = HLS)
//   adultOnly?: bool          — only 18+ categories (flagged adult)
//   skipAdult?: bool          — drop 18+ categories
//   rankCat?: (name) => number — < 0 drops the category; lower ranks are listed first (stable within a rank)
//   catFilter?: (name)=>bool  — keep only the categories whose name passes (when there is no rankCat)
//   keepCat?: (name)=>bool    — besides the ranking, drop the categories whose name fails it
//   maxCats?: number          — at most this many categories, after the ranking
//   maxProbe?: number         — at most this many candidate accounts probed (default 20)
//   probeBatch?: number       — candidates probed at once (default 6)
//   probeTimeoutMs?: number   — timeoutMs of each probe (default 3,000)
//   accountFreshMs?: number   — a remembered account is used without a probe while verified this recently (6 h)
//   account?: { load() → {url, username, password, at}|null, save(acc) }   — the remembered account
//   onPicked?: (acc, raw, shaped) => void   — every account a pick keeps (the probe's raw and shaped categories)
//   flight?: string           — single-flight key prefix (default the id)
//   catTtl?, listTtl?         — passed through to the framework (src/live.js)
//   getAccounts: async (ctx) => [{ url, username, password, name? }]   — candidates, in priority order
//   secondary?: { of, active(), categories(ctx, kit), channels(cat, ctx, kit) }   — another account flow (see the header)
export function makeXtream(cfg) {
  const ext = cfg.ext === "ts" ? "ts" : "m3u8";
  const ua = cfg.ua || "";
  const maxProbe = cfg.maxProbe || 20;
  const batch = Math.max(1, cfg.probeBatch || 6);
  const probeMs = cfg.probeTimeoutMs || 3000;
  const freshMs = cfg.accountFreshMs || 6 * H;
  const memory = cfg.account || { load: () => null, save: () => {} };
  const flight = cfg.flight || cfg.id;

  /** One account's raw categories (the probe), or throws (also when none of them passes the filter). */
  async function probe(acc) {
    const cats = await probeShared(acc, ua, probeMs);
    if (!shapeCats(cats).length) throw refused("sin categorías útiles");
    return cats;
  }

  /**
   * Picks a working account: the remembered one first (unless it is `exclude`), then the candidates in batches,
   * the first success in priority order. Saves it; when it is another account than the remembered one, the
   * source's stored lists are dropped (`ctx.dropLists`). → { acc, cats (raw get_live_categories) }.
   */
  async function pick(ctx, exclude) {
    const c = ctx || {};
    const tried = new Set();
    if (exclude) tried.add(accKey(exclude));
    let last = "sin cuentas";
    const remembered = memory.load();
    const keep = (acc, cats) => {
      memory.save(acc);
      if (remembered && accKey(acc) !== accKey(remembered) && typeof c.dropLists === "function") c.dropLists();
      if (typeof cfg.onPicked === "function") cfg.onPicked(acc, cats, shapeCats(cats));
    };
    if (remembered && !tried.has(accKey(remembered))) {
      tried.add(accKey(remembered));
      try {
        const cats = await probe(remembered);
        keep(remembered, cats);
        return { acc: remembered, cats };
      } catch (e) { last = why(e); }
    }
    const got = await cfg.getAccounts(c);
    const accounts = (Array.isArray(got) ? got : []).filter((a) => a && !tried.has(accKey(a))).slice(0, maxProbe);
    for (let i = 0; i < accounts.length; i += batch) {
      const slice = accounts.slice(i, i + batch);
      const results = await Promise.all(slice.map((acc) => probe(acc).then((cats) => ({ acc, cats }), (e) => ({ err: why(e) }))));
      for (const res of results) {
        if (res.acc) { keep(res.acc, res.cats); return res; }
        last = res.err;
      }
    }
    throw new Error("ninguna cuenta Xtream respondió (" + last + ")");
  }

  /** The remembered account when it was verified less than `freshMs` ago (used without a probe), else null. */
  function freshAccount() {
    const a = memory.load();
    return a && Date.now() - (Number(a.at) || 0) < freshMs ? a : null;
  }

  function rankOf(name) {
    const s = String(name || "");
    const adult = isAdultTitle(s);
    if (cfg.adultOnly) return adult ? 0 : -1;
    if (adult && cfg.skipAdult) return -1;
    if (typeof cfg.keepCat === "function" && !cfg.keepCat(s)) return -1;
    if (typeof cfg.rankCat === "function") {
      const r = cfg.rankCat(s);
      return typeof r === "number" && r >= 0 ? r : -1;
    }
    if (typeof cfg.catFilter === "function" && !cfg.catFilter(s)) return -1;
    return 0;
  }

  /** Raw get_live_categories → `[{ id, title, adult? }]`: filtered, deduped, ranked, capped. */
  function shapeCats(raw) {
    const out = [];
    const seen = new Set();
    for (const c of (Array.isArray(raw) ? raw : [])) {
      const cid = c && c.category_id != null ? String(c.category_id) : "";
      if (!cid || seen.has(cid)) continue;
      const rank = rankOf(c.category_name);
      if (rank < 0) continue;
      seen.add(cid);
      const e = { id: cid, title: String(c.category_name || "").trim() || cid, rank, i: out.length };
      if (isAdultTitle(c.category_name)) e.adult = true;
      out.push(e);
    }
    out.sort((a, b) => a.rank - b.rank || a.i - b.i);
    return out.slice(0, cfg.maxCats > 0 ? cfg.maxCats : out.length).map((e) => (e.adult ? { id: e.id, title: e.title, adult: true } : { id: e.id, title: e.title }));
  }

  const hasCat = (raw, id) => (Array.isArray(raw) ? raw : []).some((c) => c && String(c.category_id) === id);

  function toChannels(acc, list) {
    const out = [];
    const seen = new Set();
    for (const s of (Array.isArray(list) ? list : [])) {
      const sid = s && (s.stream_id != null ? s.stream_id : s.id);
      if (sid == null) continue;
      const title = String((s && s.name) || "").trim();
      if (!title) continue;
      const id = encodeChannel(acc, sid);
      if (seen.has(id)) continue;
      seen.add(id);
      const ch = { id, title };
      const logo = s && s.stream_icon;
      if (typeof logo === "string" && /^https?:\/\//i.test(logo)) ch.logo = logo;
      out.push(ch);
    }
    return out;
  }

  /** One category's channels on one account (1 request). */
  async function listStreams(acc, cat) {
    return toChannels(acc, await call(acc, "get_live_streams", { category_id: String(cat) }, undefined, ua));
  }

  const conn = {
    id: cfg.id,
    name: cfg.name,
    genre: cfg.genre || "otros",
    blind: true,          // resolve builds the URL with no request: a merged channel probes it
    accountOf,
    /** Raw categories → this connector's categories (the same filter its lists use). */
    shapeCats,

    async categories(ctx) {
      const p = await once(flight + ":acct", () => pick(ctx || {}));
      return shapeCats(p.cats);
    },

    async channels(categoryId, ctx) {
      const c = ctx || {};
      const cat = String(categoryId);
      let picked = null;
      // A pick in this call: its categories go to the framework now, and the category must exist on that server
      // (each server numbers its categories; another server's list would be the wrong channels).
      const adopt = (p) => {
        if (typeof c.setCats === "function") c.setCats(shapeCats(p.cats));
        if (!hasCat(p.cats, cat)) throw new Error("category not on the current server");
        return p.acc;
      };
      let acc = freshAccount();
      if (!acc) { picked = await once(flight + ":acct", () => pick(c)); acc = adopt(picked); }
      try {
        return await listStreams(acc, cat);
      } catch (e) {
        if (picked) throw e;                               // a just-verified account failed: a real failure
        const dead = acc;                                  // the remembered account died: pick another one
        picked = await once(flight + ":acct!" + accKey(dead), () => pick(c, dead));
        acc = adopt(picked);
        return listStreams(acc, cat);
      }
    },

    async resolve(channelId) {
      const parts = String(channelId || "").split(SEP);
      if (parts.length < 4) throw new Error("canal inválido");
      const url = parts[0];
      const username = parts[1];
      const password = parts[2];
      const sid = parts[3];
      if (!url || !/^\d+$/.test(sid)) throw new Error("canal inválido");
      const out = {
        url: `${url}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${sid}.${ext}`,
        mime: MIME[ext],
      };
      if (ua) out.headers = { "User-Agent": ua };
      return out;
    },
  };
  if (cfg.catTtl) conn.catTtl = cfg.catTtl;
  if (typeof cfg.listTtl === "function") conn.listTtl = cfg.listTtl;
  if (cfg.secondary) {
    const kit = { shapeCats, listStreams };
    conn.secondaryOf = cfg.secondary.of;
    conn.active = cfg.secondary.active;
    conn.categories = (ctx) => cfg.secondary.categories(ctx || {}, kit);
    conn.channels = (categoryId, ctx) => cfg.secondary.channels(String(categoryId), ctx || {}, kit);
  }
  return conn;
}
