// src/sources/stremio.js — a GENERIC connector for Stremio-style addon bridges (factory `makeStremio`).
// A Stremio addon serves two JSON routes under one base:
//   /catalog/tv/<catalog>.json → { metas: [{ id, name, poster, logo, ... }] }
//   /stream/tv/<id>.json       → { streams: [{ url, name, title, language, score, behaviorHints: { proxyHeaders: { request } } }] }
// This maps that shape onto the live connector contract (S/impl/live-api.md). Two live bridges use it: nuvio-sports
// and cncverse.
//   categories(ctx)        → the fixed list (cfg.categories, 0 requests) or the manifest's (cfg.discover, once per call).
//   channels(rawCat, ctx)  → the catalog's metas (id = the bridge's meta id, EXACTLY what resolve() gets). One request:
//                            the catalog comes from the fixed list or from the category id (cfg.catalogFor), never from
//                            a manifest read. `key` (cfg.keyOf) is a stable identity when the bridge's ids churn.
//   resolve(rawId, ctx)    → /stream/tv/<id>.json, http(s) only, sorted, the first one (or the first that answers, with
//                            cfg.probe) with its proxyHeaders. With cfg.relistOnEmpty, "no streams" re-lists that
//                            channel's category once, re-matches it by stable key and retries once.
// No module-level memo: the framework stores the lists (src/live.js) and single-flights them per call; the manifest is
// read at most once per call (`stremio:manifest:<id>`). Pure JS + liveFetch (src/liveGate.js); no Node-only APIs.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { once } from "../flight.js";
import { localTitle, lang } from "../config.js";

const HLS = "application/vnd.apple.mpegurl";
const DASH = "application/dash+xml";
const TS = "video/mp2t";

function httpOk(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

// The bridge already serves HLS lists (and sometimes converts DASH→HLS in its own proxy). m3u8 → HLS, mpd → DASH,
// ts → mp2t, and live without a hint → HLS (the most common).
export function mimeFor(url) {
  const u = String(url || "");
  if (/\.m3u8(\?|$)/i.test(u)) return HLS;
  if (/\.mpd(\?|$)/i.test(u)) return DASH;
  if (/\.ts(\?|$)/i.test(u)) return TS;
  return HLS;
}

// Play order for streamSort "hls": HLS first, then a direct file, then plain http:// (the bridge's proxy) last.
function tierOf(url) {
  if (/^http:\/\//i.test(url)) return 3;
  if (/\.m3u8(\?|$)/i.test(url)) return 0;
  if (/\.(mkv|mp4|webm)(\?|$)/i.test(url)) return 1;
  return 2;
}

// Order for streamSort "lang": the wanted language first, then the bridge's score.
function langRank(s, wanted) {
  const l = String((s && s.language) || "").toLowerCase();
  const i = wanted.indexOf(l);
  return i < 0 ? wanted.length : i;
}

function headersOf(s) {
  const req = s && s.behaviorHints && s.behaviorHints.proxyHeaders && s.behaviorHints.proxyHeaders.request;
  const out = {};
  if (req && typeof req === "object") {
    for (const k of ["Referer", "Origin", "User-Agent"]) if (typeof req[k] === "string" && req[k]) out[k] = req[k];
  }
  return out;
}

export function cleanName(name) {
  return String(name || "").replace(/[⠀​]/g, "").replace(/^[^\p{L}\p{N}(\[]+/u, "").slice(0, 120) || "—";
}

async function getJson(url, timeoutMs) {
  const res = await liveFetch(url, { method: "GET", headers: { Accept: "application/json" }, cookies: false, timeoutMs: timeoutMs || 15000 });
  if (!res || !res.ok) {
    const e = new Error("stremio " + (res && res.status) + " " + url);
    e.status = res && res.status;
    throw e;
  }
  return res.json();
}

function noStreams(id) {
  const e = new Error("no streams for " + id);
  e.code = "no_streams";
  return e;
}

// Does this copy answer? The contract returns ONE stream (no alternatives), so with `probe` the connector tries the
// copies in order and returns the first that answers. It runs on the person's device, so it adapts to THEIR network
// (many South Asian CDNs answer 403 by geo; another copy of the list does open).
// → "ok" | "dead" (it answered and refused: a 4xx other than 408 / 425 / 429, or an m3u8 that is not a playlist: the
// player, with the same headers on the same network, gets the same) | "unknown" (no answer in time, a network error, a
// 5xx or a rate limit: it may still open in the player).
async function probeCopy(url, headers, timeoutMs) {
  try {
    const r = await liveFetch(url, { method: "GET", headers, cookies: false, timeoutMs: timeoutMs || 5000 });
    if (!r) return "unknown";
    if (r.ok) {
      if (/\.m3u8(\?|$)/i.test(url)) return /#EXTM3U/.test(r.text()) ? "ok" : "dead"; // a real HLS list carries #EXTM3U
      return "ok";
    }
    const st = Number(r.status) || 0;
    return st >= 400 && st < 500 && st !== 408 && st !== 425 && st !== 429 ? "dead" : "unknown";
  } catch (e) {
    return "unknown";
  }
}

/**
 * Every copy of the stream refused on this network: the event cannot be watched from here now. `userMessage` is the
 * sentence Kino shows the person (src/live.js resolveLive passes it on; Kino's own line says only "not available").
 */
function noCopy(id) {
  const en = lang() === "en";
  const e = new Error(en ? "no copy of this event opens from your network right now" : "ninguna copia de este evento abre desde tu red ahora mismo");
  e.code = "no_copy";
  e.id = id;
  e.userMessage = en ? "No copy of this event opens from your network right now." : "Ninguna copia de este evento abre desde tu red ahora mismo.";
  return e;
}

const usableMeta = (m) => m && typeof m.id === "string" && m.id && String((m.name || m.title) || "").trim();
const titleKey = (t) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * cfg: { id, name, base, genre?,
 *   categories? [{ id, catalog?|path?, title: string | {es, en} }]  (fixed: codeCategories, 0 requests)
 *   | discover? ({ base, getJson }) → [{ id, catalog?|path?, title }]  (from the manifest, once per call),
 *   catalogFor? (rawCat) → { catalog?|path? } | null   (discovered sources: the catalog of a category id; default = the id),
 *   filterMeta?, titleFor?, keyOf? (rawId) → stable key | null, dedupeTitles?, relistOnEmpty?,
 *   eventOf? (meta) → { start?, end?, origin? } | null   (a live event's times, epoch ms, and the upstream provider
 *                     that lists it: src/liveMerge.js tells sessions apart and one provider's repeats from two providers'),
 *   streamSort?, langs?, listCap?, listTimeoutMs?, streamTimeoutMs?, probe?, probeMax?, probeBudgetMs?, probeTimeoutMs? }
 */
export function makeStremio(cfg) {
  const base = String(cfg.base || "").replace(/\/+$/, "");
  const streamSort = cfg.streamSort || "hls";
  const langs = (cfg.langs || []).map((x) => String(x).toLowerCase());
  const listCap = cfg.listCap || 1500;
  const fixed = Array.isArray(cfg.categories) ? cfg.categories : null;
  const keyOf = typeof cfg.keyOf === "function" ? cfg.keyOf : () => null;
  const eventOf = typeof cfg.eventOf === "function" ? cfg.eventOf : () => null;

  // The catalog of one raw category without any request: the fixed list, else derived from the id.
  function descriptor(rawCat) {
    const id = String(rawCat == null ? "" : rawCat);
    if (!id) return null;
    if (fixed) return fixed.find((c) => c.id === id) || null;
    if (cfg.catalogFor) return cfg.catalogFor(id);
    return { id, catalog: id };
  }

  async function catalogMetas(cat) {
    const path = cat.path || "/catalog/tv/" + encodeURIComponent(cat.catalog || cat.id) + ".json";
    const body = await getJson(base + path, cfg.listTimeoutMs || 15000);
    let metas = Array.isArray(body && body.metas) ? body.metas : [];
    metas = metas.filter(usableMeta);
    if (cfg.filterMeta) metas = metas.filter(cfg.filterMeta);
    return metas;
  }

  // Metas → channels: one per raw id, one per stable key, one per title (dedupeTitles), at most listCap.
  function toChannels(metas) {
    const ids = new Set();
    const keys = new Set();
    const titles = new Set();
    const out = [];
    for (const m of metas) {
      if (out.length >= listCap) break;
      if (ids.has(m.id)) continue;
      const title = cfg.titleFor ? cfg.titleFor(m) : cleanName(m.name || m.title || m.id);
      const key = keyOf(m.id);
      if (key != null && keys.has(key)) continue;
      const tk = cfg.dedupeTitles ? titleKey(title) : "";
      if (tk && titles.has(tk)) continue;
      ids.add(m.id);
      if (key != null) keys.add(key);
      if (tk) titles.add(tk);
      const ch = { id: m.id, title };
      if (key != null) ch.key = key;
      const logo = [m.poster, m.logo].find((u) => typeof u === "string" && u.startsWith("https://"));
      if (logo) ch.logo = logo;
      const ev = eventOf(m);
      if (ev && ev.start > 0) ch.start = ev.start;
      if (ev && ev.end > 0) ch.end = ev.end;
      if (ev && ev.origin) ch.origin = ev.origin;
      out.push(ch);
    }
    return out;
  }

  async function streamsOf(id) {
    let body;
    try {
      body = await getJson(base + "/stream/tv/" + encodeURIComponent(id) + ".json", cfg.streamTimeoutMs || 15000);
    } catch (e) {
      if (e && e.status === 404) throw noStreams(id);
      throw e;
    }
    const streams = (Array.isArray(body && body.streams) ? body.streams : []).filter((s) => httpOk(s && s.url));
    if (!streams.length) throw noStreams(id);
    return streams;
  }

  async function play(id) {
    const streams = await streamsOf(id);
    const indexed = streams.map((s, i) => ({ s, i }));
    if (streamSort === "lang") {
      indexed.sort((a, b) => langRank(a.s, langs) - langRank(b.s, langs) || ((b.s.score || 0) - (a.s.score || 0)) || a.i - b.i);
    } else {
      indexed.sort((a, b) => tierOf(a.s.url) - tierOf(b.s.url) || a.i - b.i);
    }
    let pick = indexed[0].s;
    if (cfg.probe) {
      // The first copy that answers. None did: the first that could not be told (a timeout may still open in the
      // player), else the first copy never probed; when every copy refused (403 by geo, 404 gone), a clear error
      // instead of a URL the player would fail on four times.
      const max = cfg.probeMax || 5;
      const deadline = Date.now() + (cfg.probeBudgetMs || 11000); // Kino cuts a live resolve at 20 s
      let found = null, unsure = null, probed = 0;
      for (const x of indexed.slice(0, max)) {
        if (Date.now() > deadline) break;
        probed++;
        const v = await probeCopy(x.s.url, headersOf(x.s), cfg.probeTimeoutMs || 3500);
        if (v === "ok") { found = x.s; break; }
        if (v === "unknown" && !unsure) unsure = x.s;
      }
      if (found) pick = found;
      else if (unsure) pick = unsure;
      else if (probed < indexed.length) pick = indexed[probed].s;
      else throw noCopy(id);
    }
    const out = { url: pick.url, mime: mimeFor(pick.url) };
    const h = headersOf(pick);
    if (Object.keys(h).length) out.headers = h;
    return out;
  }

  /**
   * The current raw id of a channel whose `rawId` has no streams any more (the bridge renamed it), or null:
   * first a stored list that already holds it under its stable key, then ONE forced re-list of its category.
   * Without a stable key the channel is matched by its stored title.
   */
  async function rematch(rawId, ctx) {
    const key = keyOf(rawId);
    const hit = ctx.findChannel(rawId);                     // { ...stored item, cat } or null
    const title = hit ? titleKey(hit.title) : "";
    const other = (it) => {
      const rid = ctx.rawIdOf(it);
      if (!rid || rid === rawId) return null;
      if (key != null) return keyOf(rid) === key ? rid : null;
      return title && titleKey(it.title) === title ? rid : null;
    };
    if (key == null && !title) return null;
    const scan = hit ? [hit.cat] : fixed ? fixed.map((c) => c.id) : [];
    for (const c of scan) {
      for (const it of ctx.storedList(c) || []) { const rid = other(it); if (rid) return rid; }
    }
    if (!hit || hit.cat == null) return null;
    const items = await ctx.relist(hit.cat, { force: true });
    for (const it of items || []) { const rid = other(it); if (rid) return rid; }
    return null;
  }

  return {
    id: cfg.id,
    name: cfg.name,
    genre: cfg.genre || "otros",
    codeCategories: !cfg.discover,   // a fixed `categories` list never makes a request; a discovered one does
    async categories() {
      const list = fixed || (await once("stremio:manifest:" + cfg.id, () => cfg.discover({ base, getJson })));
      return (Array.isArray(list) ? list : []).map((c) => ({ id: c.id, title: localTitle(c.title) || c.id }));
    },
    async channels(rawCat) {
      const cat = descriptor(rawCat);
      if (!cat) return [];
      return toChannels(await catalogMetas(cat));
    },
    async resolve(rawId, ctx) {
      const id = String(rawId == null ? "" : rawId);
      try {
        return await play(id);
      } catch (e) {
        const canRelist = cfg.relistOnEmpty && ctx && typeof ctx.findChannel === "function" && typeof ctx.relist === "function";
        if (!canRelist || !e || e.code !== "no_streams") throw e;
        const next = await rematch(id, ctx);
        if (!next) throw e;
        if (ctx.log) ctx.log("no streams: re-matched to the channel's current id, retrying once");
        return play(next);
      }
    },
  };
}
