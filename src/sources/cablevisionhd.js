// src/sources/cablevisionhd.js — conector EN VIVO de cablevisionhd.com (port de xuper-plugin/kino-plugin-cablevisionhd).
// parrilla-directo.php -> tarjetas <a class=channel-card href=<slug>-ver.php> (id = slug "<x>-ver").
// resolve(<slug>-ver): <slug>-ver.php -> opciones <a class=option> core.php?canal=<x> -> <iframe> player
//   firmado (…/stream.php?...&sig=…) -> la página del player nombra var src="…/playlist/<n>/index.m3u8?token=…"
//   (o playbackURL=atob(...)). HLS sin DRM. Categorías por nombre (listas hardcodeadas).
//
// 1.0.45 (spec §5.1):
// - Categories are code (0 requests): the six named groups plus "Otros" (every channel no group names). 1.0.43's
//   "Todos" (it duplicated every channel) and "24/7" (always empty) are gone.
// - ONE scrape of the grid (about 680 KB) fills all seven lists (`ctx.putList`); src/live.js keeps them 24 h fresh /
//   7 d max-stale, so the grid is fetched about once a day instead of once per cold runtime.
// - resolve goes straight to the root host (`https://cablevisionhd.com/stream*/core.php?canal=<key>`; the site's
//   `www.` links answer a 301 to it). The canal key is not the slug (extrema-tv-ver → extrematv), so it is learned
//   from the channel page (about 665 KB) the first time and kept in `o2:cvk`: 3 requests the first time (channel page,
//   core.php, player page), then 2. Only a re-resolve right after a cut (src/live.js `ctx.verify`) also checks the
//   manifest: a 404 means "off air", and the other skins are the same stream, so nothing else is tried. On a first open
//   the player's own request tells the same, and its 404 starts Kino's reopen.
// - The player pages are tvenvivo.org's (the same hosts, the same signed URLs) and answer only an embedding site
//   (src/sources/tvenvivo.js): measured 2026-11-17, the regionales host answers "Embedding domain not allowed" to
//   "https://cablevisionhd.com/" — the root host this connector asks — and serves the page to the site's own
//   "https://www.cablevisionhd.com/".

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { getJson, setJson } from "../store.js";
import { lang } from "../config.js";

const BASE = "https://cablevisionhd.com"; // www. responde 301 a esta raíz; vamos directo.
// How the site's iframe asks a player page (see the header): its www. origin, as an iframe.
const EMBED_HEADERS = { Referer: "https://www.cablevisionhd.com/", "Sec-Fetch-Dest": "iframe" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:101.0) Gecko/20100101 Firefox/101.0";
const HLS_MIME = "application/vnd.apple.mpegurl";
const SKINS = ["stream", "stream2", "stream3"];          // the player skins every channel page offers [M 2026-11-16]
export const CVK_KEY = "o2:cvk";                          // {"<slug>":"<canal key>"}
const CVK_TTL_MS = 30 * 24 * 3600 * 1000;                 // a map nobody updates for 30 d vanishes
const ALL = "all";                                        // 1.0.43's "Todos": no longer offered, still answered

const en = () => lang() === "en";
const fold = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// El sitio no tiene categorías: se agrupa por nombre, como hacía el provider de CloudStream.
const CATEGORIES = [
  { id: "sports", title: "Deportes", titleEn: "Sports", names: ["TUDN", "WWE", "Afizzionados", "Gol Peru", "Gol TV", "TNT SPORTS", "Fox Sports", "TYC Sports", "Movistar Deportes", "Movistar La Liga", "Movistar Liga De Campeones", "Dazn", "Bein", "Directv Sports", "Espn", "Fox Deportes", "Win Sports", "Claro Sports", "Sky Sports"] },
  { id: "entertainment", title: "Entretenimiento", titleEn: "Entertainment", names: ["Telefe", "El Trece", "Television Publica", "Telemundo", "Univision", "Pasiones", "Caracol", "RCN", "Latina", "America TV", "Willax", "ATV", "Las Estrellas", "Tl Novelas", "Galavision", "Azteca", "Canal 5", "Distrito Comedia", "Canal 13"] },
  { id: "news", title: "Noticias", titleEn: "News", names: ["Telemundo 51", "CNN", "Noticias", "NTN24", "DW", "Euronews", "France 24"] },
  { id: "movies", title: "Películas", titleEn: "Movies", names: ["Movistar Accion", "Movistar Drama", "Universal Channel", "TNT", "TNT Series", "Star Channel", "Star Action", "Star Series", "Cinemax", "Space", "Syfy", "Warner Channel", "Cinecanal", "FX", "AXN", "AMC", "Studio Universal", "Multipremier", "Golden", "Sony", "DHE", "NEXT HD", "HBO"] },
  { id: "kids", title: "Infantil", titleEn: "Kids", names: ["Cartoon Network", "Tooncast", "Cartoonito", "Disney", "Nick"] },
  { id: "education", title: "Educación", titleEn: "Education", names: ["Discovery", "History", "Animal Planet", "Nat Geo", "National Geographic"] },
];
// Every channel no group above names (TLNOVELAS and EXTREMA TV today).
const OTHER = { id: "other", title: "Otros", titleEn: "Other" };

/** Los ids de categoría a los que pertenece un título (puede estar en más de una); "other" si ninguna. */
export function categoriesOf(title) {
  const f = fold(title);
  const ids = CATEGORIES.filter((c) => c.names.some((n) => f.includes(fold(n)))).map((c) => c.id);
  return ids.length ? ids : [OTHER.id];
}

const decode = (s) => String(s || "")
  .replace(/&amp;/g, "&").replace(/&#0?39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

/** Cada tarjeta de la parrilla: `{ id, title, logo }`. Las que no son página de canal ("-ver.php") quedan fuera. */
export function parseChannels(html) {
  const out = [];
  const seen = new Set();
  for (const m of String(html || "").matchAll(/<a\s+href="([^"]+)"[^>]*class="[^"]*\bchannel-card\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const slug = /\/?([a-z0-9-]+-ver)\.php(?:\?.*)?$/i.exec(m[1]);
    if (!slug || seen.has(slug[1])) continue;
    const title = decode((/<p[^>]*>([\s\S]*?)<\/p>/.exec(m[2]) || [])[1] || "").replace(/<[^>]+>/g, "").trim();
    if (!title) continue;
    const img = (/<img[^>]*\bsrc="([^"]+)"/.exec(m[2]) || [])[1];
    seen.add(slug[1]);
    out.push({ id: slug[1], title, logo: img ? new URL(decode(img), BASE + "/").href : undefined });
  }
  return out;
}

/** The grid split into the seven categories (a channel may sit in more than one): Map<categoryId, channels>. */
export function groupChannels(list) {
  const out = new Map([...CATEGORIES.map((c) => [c.id, []]), [OTHER.id, []]]);
  for (const ch of list) for (const id of categoriesOf(ch.title)) out.get(id).push(ch);
  return out;
}

/** The site's links point at `www.`, which answers a 301 to the root host: go to the root directly. */
export function rootHost(url) {
  return String(url || "").replace(/^https?:\/\/www\.cablevisionhd\.com\//i, BASE + "/");
}

/** Las opciones de una página de canal: el `href` de cada `a.option`, absoluto y en el host raíz. */
export function parseOptions(html) {
  const out = [];
  for (const m of String(html || "").matchAll(/<a\s[^>]*class="[^"]*\boption\b[^"]*"[^>]*>/g)) {
    const href = (/\bhref="([^"]+)"/.exec(m[0]) || [])[1];
    if (href) out.push(rootHost(new URL(decode(href), BASE + "/").href));
  }
  return [...new Set(out)];
}

/** The canal key of an option URL (`…/core.php?canal=<key>`), or "". */
export function canalOf(optionUrl) {
  const m = /[?&]canal=([^&#]+)/.exec(String(optionUrl || ""));
  if (!m) return "";
  try { return decodeURIComponent(m[1]); } catch (_) { return m[1]; }
}

const optionUrl = (skin, key) => `${BASE}/${skin}/core.php?canal=${encodeURIComponent(key)}`;

/** El iframe del player en el core.php de una opción. */
function parseIframe(html) {
  const src = (/<iframe[^>]*\bsrc="([^"]+)"/i.exec(String(html || "")) || [])[1];
  return src ? new URL(decode(src), BASE + "/").href : null;
}

/** La URL de playlist que nombra una página de player: `var src = "https:\/\/host\/playlist\/1\/index.m3u8?token=..."`. */
function parsePlaylist(html) {
  const s = String(html || "");
  const direct = (/\bvar\s+src\s*=\s*"([^"]+)"/.exec(s) || [])[1];
  if (direct) return direct.replace(/\\\//g, "/").replace(/\\:/g, ":");
  const b64 = (/\bvar\s+playbackURL\s*=\s*atob\("([^"]+)"\)/.exec(s) || [])[1];
  if (b64) {
    try { return atob(b64); } catch (_) { return null; }
  }
  return null;
}

async function fetchText(url, headers, timeoutMs) {
  const r = await liveFetch(url, { headers: { "User-Agent": UA, ...(headers || {}) }, timeoutMs: timeoutMs || 12000 });
  if (!r.ok) throw new Error("CablevisionHD " + r.status + " " + url);
  return r.text();
}

/** The whole grid (one request), once per call; throws on failure or on a grid with no channel. */
function grid(ctx) {
  const run = async () => {
    const list = parseChannels(await fetchText(BASE + "/parrilla-directo.php", { Referer: BASE + "/" }));
    if (!list.length) throw new Error("CablevisionHD: empty grid");
    return list;
  };
  return ctx && typeof ctx.once === "function" ? ctx.once("grid", run) : run();
}

const toItem = (c) => {
  const ch = { id: c.id, title: c.title };
  if (c.logo) ch.logo = c.logo;
  return ch;
};

// ── canal keys (o2:cvk) ──

function canalKeys() {
  const m = getJson(CVK_KEY);
  return m && typeof m === "object" && !Array.isArray(m) ? m : {};
}

function saveKey(slug, key) {
  const m = canalKeys();
  if (m[slug] === key) return;
  m[slug] = key;
  setJson(CVK_KEY, m, { ttlMs: CVK_TTL_MS });
}

// ── resolve ──

/** Whether the manifest answers 404 (off air). Anything else, a timeout included, is left to the player. */
async function offAir(url, headers) {
  try {
    return (await liveFetch(url, { headers, timeoutMs: 3500 })).status === 404;
  } catch (_) { return false; }
}

/**
 * One option (skin): core.php → its player iframe → the playlist (→ the off-air check, only with `verify`).
 * → `{ url, mime, headers }` | `{ offline: true }` | null (a page did not parse, or a request failed).
 * A `deadline` error is thrown: the call's time is up, no other option can start.
 */
async function tryOption(option, channelUrl, verify) {
  try {
    const iframe = parseIframe(await fetchText(option, { Referer: channelUrl }));
    if (!iframe) return null;
    const url = parsePlaylist(await fetchText(iframe, EMBED_HEADERS));
    if (!url || !/^https?:\/\//i.test(url)) return null;
    const origin = /^https?:\/\/[^/]+/.exec(iframe)[0];
    const headers = { "User-Agent": UA, Referer: origin + "/" };
    if (verify && await offAir(url, headers)) return { offline: true };
    return { url, mime: HLS_MIME, headers };
  } catch (e) {
    if (e && e.code === "deadline") throw e;
    return null;
  }
}

// A channel off the air carries code "offline": src/live.js never counts it against the source.
const offAirError = (slug) => Object.assign(new Error(en() ? "CablevisionHD: no signal right now for " + slug : "CablevisionHD: sin señal ahora para " + slug), { code: "offline" });

const cablevisionhd = {
  id: "cablevisionhd",
  name: "CablevisionHD",
  genre: "otros",
  codeCategories: true,   // categories() never makes a request (names are grouped in code)
  sharedFetch: true,      // one scrape stores every category's list: one fetch unit for src/live.js's plan

  async categories() {
    return [...CATEGORIES, OTHER].map((c) => ({ id: c.id, title: en() ? c.titleEn : c.title }));
  },

  // One scrape answers every category: the other six lists are stored from the same response.
  async channels(categoryId, ctx) {
    const list = await grid(ctx);
    const groups = groupChannels(list);
    const want = String(categoryId || "");
    if (ctx && typeof ctx.putList === "function") {
      for (const [id, items] of groups) if (id !== want) ctx.putList(id, items.map(toItem));
    }
    if (!want || want === ALL) return list.map(toItem);
    return (groups.get(want) || []).map(toItem);
  },

  async resolve(channelId, ctx) {
    const m = /^([a-z0-9-]+-ver)$/i.exec(String(channelId || ""));
    if (!m) throw new Error(en() ? "CablevisionHD: unknown ref " + channelId : "CablevisionHD: ref desconocida " + channelId);
    const slug = m[1];
    const channelUrl = `${BASE}/${slug}.php`;
    const verify = !!(ctx && ctx.verify);
    const tried = new Set();
    const known = canalKeys()[slug];
    if (known) {
      // The learned key: core.php + player page (2 requests; the off-air check too with `verify`).
      const opt = optionUrl(SKINS[0], known);
      tried.add(opt);
      const out = await tryOption(opt, channelUrl, verify);
      if (out && out.offline) throw offAirError(slug);
      if (out && out.url) return out;
      // It did not parse: the key may have changed. Learn it again from the channel page.
    }
    const options = parseOptions(await fetchText(channelUrl, { Referer: BASE + "/parrilla-directo.php" })).slice(0, 3);
    if (!options.length) throw new Error(en() ? "CablevisionHD: no options on " + channelUrl : "CablevisionHD: sin opciones en " + channelUrl);
    // Written at once, in the resolve (unlike the live health, src/liveStore.js `deferWrites`): once per channel, and
    // losing it costs the ~665 KB channel page on every later cold open.
    const key = canalOf(options[0]);
    if (key) saveKey(slug, key);
    for (const opt of options) {
      if (tried.has(opt)) continue;
      const out = await tryOption(opt, channelUrl, verify);
      if (out && out.offline) throw offAirError(slug);
      if (out && out.url) return out;
    }
    throw new Error(en() ? "CablevisionHD: no playable option for " + slug : "CablevisionHD: ninguna opción reproducible para " + slug);
  },
};

export default cablevisionhd;
