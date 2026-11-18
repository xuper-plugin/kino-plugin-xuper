// src/sources/m3u.js — conector GENÉRICO de lista M3U/M3U8 pública (factory `makeM3U`).
// Kino parsea nada: NOSOTROS bajamos la lista y la mapeamos a la interfaz de conector.
//   categories() → group-title únicos.   channels(cat) → canales de ese grupo (id = la línea de URL, como 1.0.43).
//   resolve(id)  → { url, mime, headers? } directo (HLS/TS). Sin login, sin server. Deviceless. 0 requests.
//
// 1.0.45 (spec §5.1, premiumtv):
// - ONE download answers everything: the categories and every group's list are stored from the same response
//   (`ctx.setCats` + `ctx.putList`), so src/live.js serves them for 6 h fresh / 3 d max-stale with no request.
// - A conditional GET (`If-None-Match` / `If-Modified-Since`, raw.githubusercontent.com answers 304 with no body):
//   the validators, the categories and the per-channel stream headers live in `o2:m3u:<id>`. The validators are sent
//   only when the answer can be used as "not modified" (the list asked for is stored).
// - Single flight per call (`ctx.once`): one call never downloads the list twice.
// - The parser keeps the stream headers the list names (`#EXTVLCOPT:http-user-agent|http-referrer|http-origin`,
//   `#KODIPROP:inputstream.adaptive.stream_headers`, `#EXTHTTP`, `url|Header=…`), as Kino's own M3uParser does, and
//   resolve sends them. 1.0.43 dropped them.
// - 18+: a group whose title says so (adultos, xxx, +18, porn…) is marked adult, and so is every channel in it.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { getJson, setJson } from "../store.js";
import { bodyText } from "../net.js";
import { callStartedAt, saneAt } from "../flight.js";
import { isAdultTitle } from "./adult.js";

const STATE_PREFIX = "o2:m3u:";
const STATE_TTL_MS = 7 * 24 * 3600 * 1000;
// The headers kept from a list (the same set as Kino's M3uParser), by lower-case name.
const KEPT_HEADERS = { "user-agent": "User-Agent", referer: "Referer", referrer: "Referer", origin: "Origin", cookie: "Cookie" };
const MAX_HEADER_VALUE = 1024;

function attr(line, key) {
  const m = line.match(new RegExp(key + '="([^"]*)"'));
  return m ? m[1] : "";
}

/** The `#EXTINF` title: after the first comma that is not inside a quoted value (Kino's M3uParser rule). */
function extinfTitle(line) {
  const body = line.slice(line.indexOf(":") + 1);
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"') quote = '"';
    else if (c === "'" && i > 0 && body[i - 1] === "=") quote = "'";
    else if (c === ",") return body.slice(i + 1).trim();
  }
  return "";
}

/** One kept header into `into` (a value with a control character or past 1,024 characters is dropped). */
function putHeader(into, rawName, value) {
  const name = KEPT_HEADERS[String(rawName || "").trim().toLowerCase()];
  const v = String(value == null ? "" : value).trim();
  if (!name || !v || v.length > MAX_HEADER_VALUE || /[\u0000-\u001f\u007f]/.test(v)) return;
  into[name] = v;
}

/** `Name=value&Name=value` (values URL-encoded or not), the KODIPROP and `url|…` form. */
function pairs(s, into) {
  for (const pair of String(s || "").split("&")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    let v = pair.slice(eq + 1).trim();
    try { v = decodeURIComponent(v.replace(/\+/g, "%2B")); } catch (_) { /* keep it raw */ }
    putHeader(into, pair.slice(0, eq), v);
  }
}

function vlcOpt(v, into) {
  const eq = v.indexOf("=");
  if (eq < 0) return;
  const k = v.slice(0, eq).trim().toLowerCase();
  const name = k === "http-user-agent" ? "user-agent" : k === "http-referrer" || k === "http-referer" ? "referer" : k === "http-origin" ? "origin" : "";
  if (name) putHeader(into, name, v.slice(eq + 1));
}

function kodiProp(v, into) {
  const eq = v.indexOf("=");
  if (eq < 0) return;
  const k = v.slice(0, eq).trim().toLowerCase();
  if (k === "inputstream.adaptive.stream_headers" || k === "inputstream.adaptive.common_headers") pairs(v.slice(eq + 1), into);
}

function extHttp(v, into) {
  let o = null;
  try { o = JSON.parse(v.trim()); } catch (_) { return; }
  if (!o || typeof o !== "object") return;
  for (const k of Object.keys(o)) if (typeof o[k] === "string") putHeader(into, k, o[k]);
}

/**
 * The list's channels in file order: `[{ name, logo, group, url, headers? }]`. `url` is the whole URL line, exactly
 * as 1.0.43 kept it (it is the raw channel id: favourites depend on it); `headers` = the stream headers named by the
 * lines between the previous entry and this one, plus a `|Header=…` suffix of the URL line.
 */
export function parseM3U(text) {
  const lines = String(text || "").split(/\r?\n/);
  const chans = [];
  let cur = null;
  let pending = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^#EXTINF/i.test(line)) {
      const name = extinfTitle(line);
      cur = { name: name || attr(line, "tvg-name") || "—", logo: attr(line, "tvg-logo"), group: attr(line, "group-title") || "General" };
    } else if (/^#EXTVLCOPT:/i.test(line)) {
      vlcOpt(line.slice(line.indexOf(":") + 1), pending);
    } else if (/^#KODIPROP:/i.test(line)) {
      kodiProp(line.slice(line.indexOf(":") + 1), pending);
    } else if (/^#EXTHTTP:/i.test(line)) {
      extHttp(line.slice(line.indexOf(":") + 1), pending);
    } else if (line.startsWith("#")) {
      continue; // #EXTM3U / #EXTGRP / etc.
    } else {
      if (cur) {
        cur.url = line;
        const pipe = line.indexOf("|");
        if (pipe >= 0) pairs(line.slice(pipe + 1), pending);
        if (Object.keys(pending).length) cur.headers = pending;
        chans.push(cur);
      }
      cur = null;
      pending = {};
    }
  }
  return chans;
}

const HLS = "application/vnd.apple.mpegurl";
const DASH = "application/dash+xml";
const TS = "video/mp2t";

/** A stream URL's path, lower case, without scheme, host, query or fragment. */
function pathOf(url) {
  return String(url || "").replace(/[?#].*$/, "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, "").toLowerCase();
}

/**
 * The MIME a list entry plays with. The path's extension decides when it has one; a Cesbo Astra address
 * `/play/<id>` (no extension: about 85 of premiumtv's entries, `http://<ip>:8000/play/a03r`) is MPEG-TS over HTTP —
 * Astra's HLS is `/play/<id>/index.m3u8` — so it goes as `video/mp2t`: declared HLS, media3 read the TS bytes as a
 * playlist and failed ("Input does not start with the #EXTM3U header", `parsing_manifest_malformed`) on every retry.
 * Anything else without a known extension stays HLS (most IPTV entries; the https ones are HLS redirects).
 */
export function mimeFor(url) {
  const path = pathOf(url);
  if (/\.mpd$/.test(path)) return DASH;
  if (/\.m3u8?$/.test(path)) return HLS;
  if (/\.(?:ts|mts|m2ts)$/.test(path)) return TS;
  if (/\/play\/[^/.]+$/.test(path)) return TS;
  const u = String(url || "").toLowerCase();   // 1.0.43's loose rules for the rest (an extension in the query…)
  if (u.indexOf(".mpd") >= 0) return DASH;
  if (u.indexOf(".ts") >= 0 && u.indexOf(".m3u8") < 0) return TS;
  return HLS; // HLS por default (la mayoría de IPTV)
}

/** Whether a group title says 18+ (the rule every live connector shares, src/sources/adult.js). */
export function isAdultGroup(title) { return isAdultTitle(title); }

/**
 * The parsed list as the connector stores it: `{ cats, groups: Map<group, channels>, hdr }`.
 * `cats` in first-seen order (as 1.0.43), `channels` = `[{ id: url line, title, logo?, adult? }]`,
 * `hdr` = `{ "<url line>": { <header>: value } }` for the entries that name stream headers.
 */
export function shape(chans) {
  const cats = [];
  const groups = new Map();
  const adult = new Set();
  const hdr = {};
  for (const c of chans) {
    if (!c.url) continue;
    let list = groups.get(c.group);
    if (!list) {
      list = [];
      groups.set(c.group, list);
      const cat = { id: c.group, title: c.group };
      if (isAdultGroup(c.group)) { cat.adult = true; adult.add(c.group); }
      cats.push(cat);
    }
    const ch = { id: c.url, title: c.name };
    if (c.logo) ch.logo = c.logo;
    if (adult.has(c.group)) ch.adult = true;
    list.push(ch);
    if (c.headers && !hdr[c.url]) hdr[c.url] = c.headers;
  }
  return { cats, groups, hdr };
}

// cfg: { id, name, url, ua?, genre? }
export function makeM3U(cfg) {
  const stateKey = STATE_PREFIX + cfg.id;

  /** `{ v, etag, lm, at, cats, hdr }` from the last full download, or null. */
  function readState() {
    const s = getJson(stateKey);
    return s && typeof s === "object" && Array.isArray(s.cats) ? s : null;
  }

  /**
   * Stores the validators, categories and headers when they changed (never over a newer runtime's write). An
   * unchanged copy is rewritten only past half its storage TTL, so a list that stays the same upstream (304 after
   * 304) never loses its validators and stream headers to the TTL.
   */
  function writeState(next) {
    const cur = readState();
    // A later runtime stored a newer copy meanwhile (a stamp in the future, from a clock set back, is not newer).
    if (cur && saneAt(cur.at) > callStartedAt()) return;
    const strip = (s) => JSON.stringify({ etag: s.etag || "", lm: s.lm || "", cats: s.cats, hdr: s.hdr || {} });
    if (cur && strip(cur) === strip(next) && Date.now() - saneAt(cur.at) < STATE_TTL_MS / 2) return;
    setJson(stateKey, { v: 1, etag: next.etag || "", lm: next.lm || "", at: Date.now(), cats: next.cats, hdr: next.hdr || {} }, { ttlMs: STATE_TTL_MS });
  }

  /** A 304: the stored state is still the upstream's; renew its TTL when due (once per response). */
  function keepState(res) {
    if (res.kept) return;
    res.kept = true;
    writeState(res.state);
  }

  /**
   * One GET of the list. `conditional`: send the stored validators (only when the caller can use a 304).
   * → `{ unchanged: true, state }` | `{ unchanged: false, shaped, etag, lm }`. Throws on failure.
   */
  async function download(conditional) {
    const st = conditional ? readState() : null;
    const headers = cfg.ua ? { "User-Agent": cfg.ua } : {};
    if (st) {
      if (st.etag) headers["If-None-Match"] = st.etag;
      if (st.lm) headers["If-Modified-Since"] = st.lm;
    }
    const r = await liveFetch(cfg.url, { method: "GET", headers, cookies: false, timeoutMs: 15000 });
    if (r && r.status === 304) {                              // Kino reports a 304 as ok:false: test it first
      if (!st) throw new Error("m3u " + cfg.id + ": 304 without a stored copy");
      return { unchanged: true, state: st };
    }
    if (!r || !r.ok) throw new Error("m3u " + cfg.id + " " + (r && r.status));
    const shaped = shape(parseM3U(bodyText(r)));
    if (!shaped.cats.length) throw new Error("m3u " + cfg.id + ": no channel in the list");
    const h = r.headers || {};
    return { unchanged: false, shaped, etag: h.etag || "", lm: h["last-modified"] || "" };
  }

  // Once per call: the first caller decides whether the GET is conditional; a caller that needs the body after a
  // shared 304 gets one unconditional GET (also once per call).
  const once = (ctx, key, fn) => (ctx && typeof ctx.once === "function" ? ctx.once(key, fn) : fn());
  const get = (ctx, conditional) => once(ctx, "m3u", () => download(conditional));
  const getFull = (ctx) => once(ctx, "m3u!full", () => download(false));

  /** Stores everything a full download carries, once per response: categories, every group's list, the state. */
  function ingest(ctx, res, skipGroup) {
    if (res.ingested) return;
    res.ingested = true;
    const { cats, groups, hdr } = res.shaped;
    if (ctx && typeof ctx.setCats === "function") ctx.setCats(cats);
    if (ctx && typeof ctx.putList === "function") {
      for (const [g, items] of groups) if (g !== skipGroup) ctx.putList(g, items);
    }
    writeState({ etag: res.etag, lm: res.lm, cats, hdr });
  }

  return {
    id: cfg.id,
    name: cfg.name,
    genre: cfg.genre || "otros",
    sharedFetch: true,    // one download stores every group's list: one fetch unit for src/live.js's plan
    blind: true,          // resolve answers with no request (the URL is the raw id): a merged channel probes it

    async categories(ctx) {
      const res = await get(ctx, true);
      if (res.unchanged) {
        if (ctx && typeof ctx.touchAll === "function") ctx.touchAll();
        keepState(res);
        return res.state.cats;
      }
      ingest(ctx, res, null);
      return res.shaped.cats;
    },

    async channels(categoryId, ctx) {
      const want = String(categoryId == null ? "" : categoryId);
      const stored = ctx && typeof ctx.storedList === "function" ? ctx.storedList(want) : null;
      let res = await get(ctx, !!stored);
      if (res.unchanged) {
        // Not modified: every stored list of this source is still the upstream's.
        if (ctx && typeof ctx.touchAll === "function") ctx.touchAll();
        if (ctx && typeof ctx.setCats === "function") ctx.setCats(res.state.cats);
        keepState(res);
        if (stored && ctx.UNCHANGED) return ctx.UNCHANGED;
        res = await getFull(ctx);
      }
      ingest(ctx, res, want);
      return res.shaped.groups.get(want) || [];
    },

    async resolve(channelId) {
      const raw = String(channelId == null ? "" : channelId);
      const pipe = raw.indexOf("|");
      const url = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
      const headers = {};
      if (cfg.ua) headers["User-Agent"] = cfg.ua;
      const st = readState();
      const named = st && st.hdr && st.hdr[raw];
      if (named && typeof named === "object") for (const k of Object.keys(named)) putHeader(headers, k, named[k]);
      if (pipe >= 0) pairs(raw.slice(pipe + 1), headers);
      const out = { url, mime: mimeFor(url) };
      if (Object.keys(headers).length) out.headers = headers;
      return out;
    },
  };
}
