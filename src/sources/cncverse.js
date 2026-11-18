// src/sources/cncverse.js — live sports events from the CNCVerse bridge (https://cncverse.dpdns.org) as a Xuper live
// source connector. Port of kino-plugin-cncverse (xuper-plugin). The bridge is a Stremio addon; its profile lives at
// /u/<bridgeCode> (bridgeCode in clear in .kino-secrets.json). The catalogs come from the manifest, so a new provider
// shows up by itself. Sports events only: the Indian TV channels (cncverse-tv) were removed (owner, 2026-11-16).
//
// Spec §5.1: the manifest is read at most once per call (`stremio:manifest:cncverse`) and only for the categories (a
// list needs 1 request: the category id IS its catalog id); finished events (`isEnded`, about a third) and duplicate
// titles are left out; the channel id comes from a stable key (provider | title | start) because the bridge's raw
// id embeds the event's live/ended flags and changes when the event goes live. The ref keeps the raw id. Probes stay
// on the device (country-blocked copies).

import { makeStremio } from "./stremio.js";

const BASE = "https://cncverse.dpdns.org/u/p_48sfkwcafx1s"; // the plugin's shared profile (bridgeCode p_48sfkwcafx1s)

const ADULT = /adult|18\+|xxx|porn|erotic|sexy|hentai/i;
const EVENT_CATALOG = /^cnc_[A-Za-z0-9_]{1,100}$/;

// A readable catalog name: without "(tv)", without leading emoji/symbols, spaces collapsed.
function cleanCat(name) {
  return String(name || "")
    .replace(/\((?:other|tv)\)/gi, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim();
}

// The bridge marks a finished event in its card URLs (`isEnded=true`) and its name ("✅ …").
const ENDED = /[?&]isEnded=true(?:&|$)/;
export function isEnded(m) {
  return ENDED.test(String((m && m.poster) || "")) || ENDED.test(String((m && m.background) || "")) || /^\s*✅/u.test(String((m && m.name) || ""));
}

// A usable bridge meta: base64 id "cnc:…", with a name, not adult, not finished. (The bridge ignores `skip` in these
// catalogs: it answers the whole list, so one request lists it.)
const usable = (m) =>
  m && typeof m.id === "string" && m.id.startsWith("cnc:") && m.id.length <= 4000 && String(m.name || "").trim() &&
  !ADULT.test(String(m.name)) && !isEnded(m);

// Discovers the manifest's type:"tv" event catalogs (…LiveEvents…). Highlights (VOD clips, not live), adult catalogs
// and the TV channel catalogs are left out.
function discoverEvents() {
  return async ({ base, getJson }) => {
    const body = await getJson(base + "/manifest.json", 8000);
    const cats = Array.isArray(body && body.catalogs) ? body.catalogs : [];
    const out = [];
    const seen = new Set();
    for (const c of cats) {
      if (!c || c.type !== "tv" || typeof c.id !== "string" || !c.id.startsWith("cnc_")) continue;
      if (/Highlights/i.test(c.id) || ADULT.test(c.id) || ADULT.test(String(c.name || ""))) continue;
      if (seen.has(c.id)) continue;
      if (!/LiveEvents/i.test(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, catalog: c.id, title: cleanCat(c.name) || c.id });
    }
    return out;
  };
}

// ── the stable key ──

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const B64_VAL = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t[43] = 62; t[45] = 62;   // "+" and "-"
  t[47] = 63; t[95] = 63;   // "/" and "_"
  return t;
})();

/** base64 / base64url → text (UTF-8), or null. Pure JS: the engine has no Buffer. */
export function b64Text(s) {
  const str = String(s || "");
  const bytes = [];
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c === 61) break;                                   // "=" padding
    const v = c < 128 ? B64_VAL[c] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 255);
    }
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.slice(i, i + 4096));
  try { return decodeURIComponent(escape(bin)); } catch (_) { return bin; }
}

/** A bridge id "cnc:" + base64url("<Provider>::<event JSON>") → `{ provider, ev }`, or null. */
export function decodeEventId(rawId) {
  const s = String(rawId || "");
  if (!s.startsWith("cnc:")) return null;
  const text = b64Text(s.slice(4));
  if (!text) return null;
  const i = text.indexOf("::");
  if (i <= 0) return null;
  try {
    const ev = JSON.parse(text.slice(i + 2));
    return ev && typeof ev === "object" ? { provider: text.slice(0, i), ev } : null;
  } catch (_) { return null; }
}

/** The stable key of an event id: `ev:<provider>|<title>|<start>` (start missing: the provider's event id). */
export function eventKey(rawId) {
  const d = decodeEventId(rawId);
  if (!d) return null;
  const ev = d.ev;
  const title = String(ev.title || (ev.eventInfo && ev.eventInfo.eventName) || "").replace(/\s+/g, " ").trim();
  const start = String((ev.eventInfo && ev.eventInfo.startTime) || "").trim();
  const alt = ev.eventId != null ? ev.eventId : ev.channelId != null ? ev.channelId : "";
  if (!title && !start && alt === "") return null;
  return "ev:" + d.provider + "|" + title + "|" + (start || "#" + alt);
}

// "2026/11/17 04:30:36 +0000" (the bridge's eventInfo times) → epoch ms, or 0.
function bridgeTime(s) {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(?:([+-])(\d{2}):?(\d{2})|Z)?$/.exec(String(s || "").trim());
  if (!m) return 0;
  const off = m[7] ? (m[7] === "-" ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9])) * 60000 : 0;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - off;
}

/** An event's start and end (the descriptor's eventInfo) and its provider (SKTech, PlayFy…) from its bridge id, or null. */
function eventOf(meta) {
  const d = decodeEventId(meta && meta.id);
  if (!d) return null;
  const info = (d.ev && d.ev.eventInfo) || {};
  return { start: bridgeTime(info.startTime), end: bridgeTime(info.endTime), origin: d.provider.replace(/LiveEvents$/, "").slice(0, 24) };
}

// Sports events (LivXow, PlayZTV, PlayFy, SportzX, SKTech…): HLS with signed HDN tokens; the bridge converts DASH→HLS
// in its own proxy, so HLS plays directly (no separate DRM).
const cncverse = makeStremio({
  id: "cncverse",
  name: "CNCVerse Deportes",
  base: BASE,
  genre: "deportes",
  discover: discoverEvents(),
  catalogFor: (id) => (EVENT_CATALOG.test(id) && /LiveEvents/i.test(id) ? { id, catalog: id } : null),
  filterMeta: usable,
  keyOf: eventKey,
  eventOf,
  dedupeTitles: true,
  streamSort: "hls",
  probe: true, // every event carries several copies; many CDNs answer 403 by geo: return the one that answers on THEIR network
  probeMax: 6,
  listCap: 1000,
  listTimeoutMs: 18000,
  streamTimeoutMs: 18000,
});

export default cncverse;
