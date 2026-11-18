// src/sources/nuvio-sports.js — live sports from the Nuvio Live Sports addon (https://nuviosports.xyz) as a Xuper live
// connector. Port of kino-plugin-nuvio-sports (xuper-plugin). The addon builds its answer from a base64url JSON
// "configuration" segment inside the base URL; the default profile is fixed here (UTC, Spanish, no replays, no web).
// Catalogs: live events per sport (subsets of "live") + "networks" (24/7 sports TV). All of genre "deportes".
//
// Identity (spec §5.1): the addon renames the same channel between providers within minutes
// (`nuvio_sport_cdn_ch_xx_<slug>` ↔ `nuvio_sport_dlv_ch_<n>_<slug>`), so those channels get a stable key = the slug
// without the provider prefix: Kino's channel id stays the same across the churn, while the ref keeps the raw id
// (`L:nuvio-sports:<raw>`, so old favourites still match by ref). On "no streams" resolve re-lists the channel's
// category once, re-matches it by that key and retries once (makeStremio `relistOnEmpty`).

import { makeStremio } from "./stremio.js";

const HOST = "https://nuviosports.xyz";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// UTF-8 bytes of [s] as unpadded base64url (pure JS; Kino's engine has no Buffer).
function base64url(s) {
  const bytes = [];
  for (const ch of unescape(encodeURIComponent(s))) bytes.push(ch.charCodeAt(0));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

// The addon's default profile (the original plugin's): replays and web streams off, they do not play in the player.
const PROFILE = { timezone: "UTC", languages: "Spanish", replayFilter: "disabled", webStreams: "disabled", sports: "all" };
const BASE = HOST + "/" + base64url(JSON.stringify(PROFILE));

// One entry per addon catalog: "live" (events on air), one per sport (on air and coming up: NOT subsets of "live", a
// kit run of 2026-11-17 found 84 of football's 100 events missing from "live"), "networks" (24/7 sports TV).
// "upcoming" (events that have not started: no signal yet) is left out. Titles in ES and EN.
const CATEGORIES = [
  { id: "live", catalog: "nuvio_sports_live", title: { es: "En vivo ahora", en: "Live now" } },
  { id: "networks", catalog: "nuvio_sports_networks", title: { es: "TV deportiva 24/7", en: "24/7 sports TV" } },
  { id: "football", catalog: "nuvio_sports_football", title: { es: "Fútbol", en: "Football" } },
  { id: "basketball", catalog: "nuvio_sports_basketball", title: { es: "Baloncesto", en: "Basketball" } },
  { id: "tennis", catalog: "nuvio_sports_tennis", title: { es: "Tenis", en: "Tennis" } },
  { id: "motorsport", catalog: "nuvio_sports_motorsport", title: { es: "Motor", en: "Motorsport" } },
  { id: "mma", catalog: "nuvio_sports_mma", title: { es: "MMA", en: "MMA" } },
  { id: "baseball", catalog: "nuvio_sports_baseball", title: { es: "Béisbol", en: "Baseball" } },
  { id: "hockey", catalog: "nuvio_sports_hockey", title: { es: "Hockey", en: "Hockey" } },
  { id: "rugby", catalog: "nuvio_sports_rugby", title: { es: "Rugby", en: "Rugby" } },
  { id: "americanfootball", catalog: "nuvio_sports_american_football", title: { es: "Fútbol americano", en: "American football" } },
  { id: "golf", catalog: "nuvio_sports_golf", title: { es: "Golf", en: "Golf" } },
  { id: "cricket", catalog: "nuvio_sports_cricket", title: { es: "Críquet", en: "Cricket" } },
  { id: "college", catalog: "nuvio_sports_college", title: { es: "Deporte universitario", en: "College sports" } },
  { id: "other", catalog: "nuvio_sports_other", title: { es: "Otros deportes", en: "Other sports" } },
];

// `nuvio_sport_cdn_ch_xx_<slug>` / `nuvio_sport_dlv_ch_<n>_<slug>`: the same channel under two providers.
const CHURNING = /^nuvio_sport_(?:cdn_ch_[a-z]{2}|dlv_ch_\d+)_([a-z0-9][a-z0-9._-]*)$/i;

/** The stable key of a raw channel id (`ch:<slug>` for the provider-renamed channels), else null (the raw id is it). */
export function channelKey(rawId) {
  const m = CHURNING.exec(String(rawId || ""));
  return m ? "ch:" + m[1].toLowerCase() : null;
}

/** The addon's "⚠️ Subscription Expired" placeholder row is not a channel. */
export function isPlaceholder(m) {
  return /(^|_)leaf_expired[:_]|expired:notice/i.test(String((m && m.id) || "")) || /subscription expired/i.test(String((m && m.name) || ""));
}

/**
 * An event's kick-off from its meta's `released` (ISO time; the 24/7 networks carry none), and the addon's provider
 * that lists it (`nuvio_sport_<provider>_…`: dlv, ak47, ts, vavoo…; the same match comes from several of them).
 */
function eventOf(m) {
  const t = Date.parse(String((m && m.released) || ""));
  const p = /^nuvio_sport_([a-z0-9]{1,12})_/.exec(String((m && m.id) || ""));
  return { start: t > 0 ? t : 0, origin: p ? p[1] : "" };
}

export default makeStremio({
  id: "nuvio-sports",
  name: "Nuvio Sports",
  base: BASE,
  genre: "deportes",
  categories: CATEGORIES,
  filterMeta: (m) => !isPlaceholder(m),
  keyOf: channelKey,
  eventOf,
  relistOnEmpty: true,
  streamSort: "lang",
  langs: ["spanish"],
});
