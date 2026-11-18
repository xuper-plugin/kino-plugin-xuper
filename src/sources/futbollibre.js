// src/sources/futbollibre.js — conector de En vivo DEPORTES: Fútbol Libre.
// Port of the plugin xuper-plugin/kino-plugin-futbol-libre to the connector interface of Xuper's live aggregator.
// Agenda primaria: api.wqxag.com/diaries.json (respaldos: verfutbol.pro, futbol-libre.app).
// Canales = ~20 MAIN hardcodeados (ESPN, Fox Sports, DSports...) + ~100 de respaldo (futbol-libre.app).
// resolve: el channelId lleva una lista de "tokens" (players) separados por ","; se prueba cada uno en
//   orden (tvf90.com/5.php, streamtp99a.sbs/global1.php, la18hd.su, streamxhd.st, direct-playback) hasta
//   extraer un m3u8 vivo (#EXTM3U). m3u8 final en *.ftlly.com / *.domhsd.com / *.fubo18.com.
// Self-contained: solo JS puro + liveFetch (kino.fetch acotado, src/liveGate.js) (+ kino.log opcional). atob disponible en Kino.
//
// Cache (spec §5.1): "main" is a code list (0 requests); "hoy" (the agenda, fresh 10 min / stale 2 h) and "más"
// (the 41 KB /channels scrape, fresh 24 h / stale 7 d) are fetched by the framework (src/live.js) and kept in its
// store. Nothing is kept in module memory; inside one call the agenda is single-flighted (`fl:agenda`). A failure
// throws (the framework serves the stored list), never an empty list over a good one.
// "hoy" channels keep 1.0.43's raw id (= their ref, so a saved event still plays) but get their own Kino id
// (`key` "hoy.<event id>"): they no longer collide with the "main" channel of the same player. Their titles carry no
// "EN VIVO" or clock, so a channel's name stays the same between refreshes and Kino's name matching holds.

import { liveFetch, remaining } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { once } from "../flight.js";

const PRIMARY = "https://futbollibregol.org";   // its /img paths answer 301 to futbollibretvgol.org (an image: Kino follows it)
// futbollibreliga.online moved here (2026-11-16): the old name answers 301 to https://verfutbol.pro/ (the home page,
// path dropped), so its agenda and its channel logos (blank tiles in Fútbol ▸ Canales) answered HTML. Same paths here.
const BACKUP1 = "https://verfutbol.pro";
const BACKUP2 = "https://futbol-libre.app";
const AGENDA_API = "https://api.wqxag.com/diaries.json";
const IMG = "https://img.wqxag.com";
const HOUR = 3600000;
export const AGENDA_BUDGET_MS = 10000;  // the fallback chain (primary → backup1 → backup2) stops here (was up to 25 s)
export const VERIFY_TIMEOUT_MS = 2500;  // the m3u8 liveness check of a resolved address

const log = (m) => { try { if (typeof kino !== "undefined" && kino.log) kino.log(m); } catch { /* noop */ } };

// ---- agenda ----

function entities(s) {
  return String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function splitTitle(raw) {
  const text = entities(raw);
  const m = /^([^:]{2,80}):\s*(.+)$/.exec(text);
  return m ? { league: m[1].trim(), title: m[2].trim() } : { league: "", title: text };
}
function b64(s) {
  let x = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (x.length % 4) x += "=";
  try { return atob(x); } catch { return ""; }
}

// Los tokens de player que representa una URL de stream; "" si el host no se sabe abrir.
function tokenOf(url) {
  const u = String(url || "");
  const id = (/[?&](?:stream|canal)=([A-Za-z0-9_-]{1,40})/.exec(u) || [])[1];
  if (!id) return "";
  if (/^https:\/\/(?:www\.)?tvf90\.com\//.test(u)) return "tvf90." + id;
  if (/^https:\/\/(?:www\.)?la18hd\.su\/vivo\/canales\.php/.test(u)) return "la18c." + id;
  if (/^https:\/\/(?:www\.)?la18hd\.su\//.test(u)) return "la18." + id;
  if (/^https:\/\/streamxhd\.st\//.test(u)) return "sxhd." + id;
  if (/^https:\/\/(?:futbollibretv\.sx|streamtp[a-z0-9.-]*)\//.test(u)) return "tp." + id;
  return "";
}

// Sister players del mismo stream id, para que un server caído caiga al de otro sitio.
function withSisters(tokens) {
  const out = [];
  const add = (x) => { if (x && !out.includes(x)) out.push(x); };
  tokens.forEach(add);
  for (const x of tokens) {
    const [kind, id] = x.split(".");
    if (kind === "tvf90") add("la18." + id);
    if (kind === "la18" || kind === "la18c") add("tvf90." + id);
  }
  return out.slice(0, 7);
}

function makeEvent(source, startMs, league, title, flag, tokens) {
  const clean = withSisters(tokens);
  if (!clean.length || !title || !(startMs > 0)) return null;
  return { id: "e" + hash(source === "backup2" ? title + startMs : title + "|" + startMs), start: startMs, league, title, flag, tokens: clean };
}
function limaMs(date, hour) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(date));
  const h = /^(\d{1,2}):(\d{2})/.exec(String(hour));
  if (!d || !h) return 0;
  return Date.UTC(+d[1], +d[2] - 1, +d[3], +h[1], +h[2]) + 5 * HOUR;
}

async function agendaPrimary(ms) {
  const r = await liveFetch(AGENDA_API, { timeoutMs: Math.min(8000, ms) });
  if (!r.ok) throw new Error("agenda " + r.status);
  const data = r.json().data;
  if (!Array.isArray(data)) throw new Error("agenda shape");
  const out = [];
  for (const row of data) {
    const a = (row && row.attributes) || {};
    const { league, title } = splitTitle(a.diary_description);
    const c = a.country && a.country.data && a.country.data.attributes;
    const img = c && c.image && c.image.data && c.image.data.attributes && c.image.data.attributes.url;
    const tokens = [];
    for (const em of ((a.embeds && a.embeds.data) || [])) {
      const frame = (em.attributes && em.attributes.embed_iframe) || "";
      const m = /[?&]r=([^&]+)/.exec(frame);
      const tok = tokenOf(m ? b64(decodeURIComponent(m[1])) : frame);
      if (tok && !tokens.includes(tok)) tokens.push(tok);
    }
    const ev = makeEvent("primary", limaMs(a.date_diary, a.diary_hour), league || (c && c.name) || "", title, img ? IMG + img : undefined, tokens);
    if (ev) out.push(ev);
  }
  return out;
}

async function agendaBackup1(ms) {
  const r = await liveFetch(BACKUP1 + "/api/agenda", { timeoutMs: Math.min(8000, ms) });
  if (!r.ok) throw new Error("agenda " + r.status);
  const events = r.json().events;
  if (!Array.isArray(events)) throw new Error("agenda shape");
  const out = [];
  for (const e of events) {
    const { league, title } = splitTitle(e.title);
    const tokens = [];
    for (const em of e.embeds || []) {
      const tok = tokenOf(em.iframe);
      if (tok && !tokens.includes(tok)) tokens.push(tok);
    }
    const ev = makeEvent("backup1", limaMs(e.date, e.time), league, title, typeof e.flag === "string" && /^https:/.test(e.flag) ? e.flag : undefined, tokens);
    if (ev) out.push(ev);
  }
  return out;
}

async function agendaBackup2(ms) {
  const r = await liveFetch(BACKUP2 + "/agenda", { timeoutMs: Math.min(9000, ms) });
  if (!r.ok) throw new Error("agenda " + r.status);
  const out = [];
  for (const chunk of r.text().split('<div class="source-agenda-event"').slice(1)) {
    const instant = Date.parse((/data-source-instant="([^"]+)"/.exec(chunk) || [])[1] || "");
    const comp = entities((/source-agenda-competition">([^<]*)</.exec(chunk) || [])[1] || "").replace(/:$/, "");
    const strong = entities(((/<strong>([\s\S]*?)<\/strong>/.exec(chunk) || [])[1] || "").replace(/<[^>]+>/g, " "));
    const title = comp && strong.startsWith(comp) ? strong.slice(comp.length).replace(/^[:\s]+/, "") : strong;
    const flagPath = (/source-agenda-flag" src="([^"]+)"/.exec(chunk) || [])[1];
    const tokens = [];
    const re = /href="\/match\/([a-z0-9-]{1,100})#source=(\d{1,8})"/g;
    let m;
    while ((m = re.exec(chunk))) tokens.push(`b2e.${m[1]}.${m[2]}`);
    const ev = makeEvent("backup2", instant, comp, title, flagPath ? BACKUP2 + flagPath : undefined, tokens.slice(0, 7));
    if (ev) out.push(ev);
  }
  return out;
}

function upcoming(list) {
  const now = Date.now();
  return list.filter((e) => e.start + 3 * HOUR > now).sort((a, b) => a.start - b.start);
}

// Sequential with fallbacks: the primary, then each backup; the first one with matches wins. The whole chain stops
// at AGENDA_BUDGET_MS (and at the call's deadline): no fallback starts with less than a second left. Every source
// failing (or never tried) throws, so the stored "hoy" list is kept; a source that answered with no match is a real [].
async function loadAgenda() {
  const until = Date.now() + AGENDA_BUDGET_MS;
  let answered = false;
  let last = "";
  for (const fn of [agendaPrimary, agendaBackup1, agendaBackup2]) {
    const left = Math.min(until - Date.now(), remaining());
    if (left < 1000) { last = last || "no time left"; break; }
    try {
      const kept = upcoming(await fn(left));
      answered = true;
      if (kept.length) return kept;
    } catch (e) { last = String((e && (e.code || e.message)) || e); log("agenda failed: " + last); }
  }
  if (answered) return [];
  throw new Error("agenda: " + (last || "no source answered"));
}
function agenda() { return once("fl:agenda", loadAgenda); }

// ---- channels ----

const P_LOGO = PRIMARY + "/img/logo-canal/";
const B1_LOGO = BACKUP1 + "/img/channels/";
const B2_LOGO = BACKUP2 + "/assets/channel-logos/manual/";

const MAIN = [
  ["espn", "ESPN", "espn", B1_LOGO + "espn-1.webp"],
  ["espn2", "ESPN 2", "espn2", B1_LOGO + "espn-2.webp"],
  ["espn3", "ESPN 3", "espn3", P_LOGO + "espn_3.webp"],     // backup1's espn-3.webp draws "ESPN2"
  ["foxsports", "Fox Sports", "foxsports", B1_LOGO + "fox-sports-1.webp"],
  ["foxsports2", "Fox Sports 2", "foxsports2", B1_LOGO + "fox-sports-2.webp"],
  ["foxsports3", "Fox Sports 3", "foxsports3", B1_LOGO + "fox-sports-3.webp"],
  ["dsports", "DSports", "dsports", B2_LOGO + "channel-8.jpg"],
  ["dsports2", "DSports 2", "dsports2", B2_LOGO + "channel-8.jpg"],
  ["dsportsplus", "DSports Plus", "dsportsplus", B2_LOGO + "channel-8.jpg"],
  ["liga1max", "Liga 1 MAX", "liga1max", P_LOGO + "liga_1_max.webp"],
  ["telemundo", "Telemundo", "telemundo", B2_LOGO + "channel-50.png"],
  ["espnmx", "ESPN México", "espnmx", B1_LOGO + "espn-1.webp"],
  ["espn2mx", "ESPN 2 México", "espn2mx", B1_LOGO + "espn-2.webp"],
  ["espn3mx", "ESPN 3 México", "espn3mx", P_LOGO + "espn_3.webp"],
  ["foxsportsmx", "Fox Sports México", "foxsportsmx", B1_LOGO + "fox-sports-1.webp"],
  ["foxsports2mx", "Fox Sports 2 México", "foxsports2mx", B1_LOGO + "fox-sports-2.webp"],
  ["foxsports3mx", "Fox Sports 3 México", "foxsports3mx", B1_LOGO + "fox-sports-3.webp"],
  ["foxsportspremium", "Fox Sports Premium", "foxsportspremium", B1_LOGO + "fox-sports-premium.webp"],
  ["tudnmx", "TUDN México", "tudn_mx", B1_LOGO + "tudn-mx.webp"],
].map(([id, name, stream, logo]) => ({ id: "c-" + id, name, stream, logo, tokens: withSisters(["tvf90." + stream, "la18." + stream]) }));

// Directorio de ~100 canales de backup2, cada uno con hasta 4 servers (1 tvf90, 2 streamxhd, 3 streamtp, 4 la18hd).
// Fetched only when the framework refreshes "más" (once a day); a failure or an empty scrape throws (stale kept).
async function moreChannels() {
  const r = await liveFetch(BACKUP2 + "/channels", { timeoutMs: 12000 });
  if (!r.ok) throw new Error("channels " + r.status);
  const out = [];
  const re = /<a class="channel-card" href="\/channel\/([a-z0-9-]{1,80})"><div class="channel-logo"><img src="([^"]+)" alt="([^"]*)"/g;
  const html = r.text();
  let m;
  while ((m = re.exec(html))) {
    out.push({ id: "b2-" + m[1], name: entities(m[3]) || m[1], logo: /\.svg$/i.test(m[2]) ? undefined : BACKUP2 + m[2], tokens: [1, 4, 2, 3].map((s) => `b2c.${m[1]}.${s}`) });
  }
  if (!out.length) throw new Error("channels empty");
  return out;
}

// ---- resolve ----

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const SLUG = /^[a-z0-9-]{1,100}$/;
const PLAYBACK = /playbackURL\s*=\s*"([^"]+)"/;
const CDNPEER_SRC = /cdnpeer\.clappr\([^,]+,\s*\{[^}]*?"src"\s*:\s*"([^"]+)"/;

function unslash(s) { return String(s).replace(/\\\//g, "/"); }
function playbackFrom(html) { const m = CDNPEER_SRC.exec(html) || PLAYBACK.exec(html); return m ? unslash(m[1]) : ""; }
function get(url, headers, ms) { return liveFetch(url, { headers, timeoutMs: ms }); }

async function viaTvf90(id, ms) {
  const r = await get(`https://tvf90.com/5.php?stream=${id}`, { Referer: "https://tvf90.com/" }, ms);
  return r.ok ? playbackFrom(r.text()) : "";
}
async function viaLa18(id, plural, ms) {
  const r = await get(`https://la18hd.su/vivo/${plural ? "canales" : "canal"}.php?stream=${id}`, { "Sec-Fetch-Dest": "iframe" }, ms);
  const m = r.ok && /"src":"([^"]+)"/.exec(r.text());
  return m ? unslash(m[1]) : "";
}
// streamxhd esconde la dirección en pares [index, base64]: cada char es un código menos una clave de dos funciones.
async function viaStreamxhd(id, ms) {
  const r = await get(`https://streamxhd.st/live1.php?stream=${id}`, { "Sec-Fetch-Dest": "iframe" }, ms);
  if (!r.ok) return "";
  const html = r.text();
  const arr = /var playbackURL="",(\w+)=\[\][^;]*;\s*\1=(\[\[[\s\S]*?\]\]);/.exec(html);
  const keyFns = /var k=(\w+)\(\)\+(\w+)\(\);/.exec(html);
  if (!arr || !keyFns) return "";
  const fn = (name) => { const f = new RegExp("function " + name + "\\(\\)\\{return (\\d+);\\}").exec(html); return f ? parseInt(f[1], 10) : NaN; };
  const k = fn(keyFns[1]) + fn(keyFns[2]);
  const pairs = [];
  const re = /\[(\d+),"([A-Za-z0-9+/=]+)"\]/g;
  let m;
  while ((m = re.exec(arr[2]))) pairs.push([parseInt(m[1], 10), m[2]]);
  if (!pairs.length || !Number.isFinite(k)) return "";
  pairs.sort((a, b) => a[0] - b[0]);
  let out = "";
  for (const [, b] of pairs) out += String.fromCharCode(parseInt(atob(b).replace(/\D/g, ""), 10) - k);
  return /^https:\/\//.test(out) ? out : "";
}
async function viaStreamtp(id, ms) {
  const r = await get(`https://streamtp99a.sbs/global1.php?stream=${id}`, {}, ms);
  return r.ok ? playbackFrom(r.text()) : "";
}
// La API de backup2 nombra el player que usa; esa dirección vuelve por las mismas recetas.
async function viaBackup2(query, ms) {
  const r = await get(`${BACKUP2}/api/direct-playback.php?${query}`, {}, ms);
  if (!r.ok) return "";
  const data = r.json();
  const tok = data && data.success ? tokenOf(data.url) : "";
  return tok && !tok.startsWith("b2") ? runToken(tok, ms) : "";
}

async function runToken(token, ms) {
  const [kind, a, b] = token.split(".");
  if (kind === "b2e" && SLUG.test(a) && /^\d{1,8}$/.test(b)) return viaBackup2(`type=event&slug=${a}&source=${b}`, ms);
  if (kind === "b2c" && SLUG.test(a) && /^[1-4]$/.test(b)) return viaBackup2(`type=channel&slug=${a}&server=${b}`, ms);
  if (!ID.test(a || "")) return "";
  if (kind === "tvf90") return viaTvf90(a, ms);
  if (kind === "la18") return viaLa18(a, false, ms);
  if (kind === "la18c") return viaLa18(a, true, ms);
  if (kind === "sxhd") return viaStreamxhd(a, ms);
  if (kind === "tp") return viaStreamtp(a, ms);
  return "";
}

// Confirma un m3u8 vivo en los hosts finales; otros hosts se confían tal cual.
async function verify(url) {
  if (!/^https:\/\/[^/]*\.(?:ftlly|fubo18|domhsd)\.com[:/]/.test(url)) return "ok";
  try {
    const r = await liveFetch(url, { timeoutMs: VERIFY_TIMEOUT_MS });
    if (r.ok) return /^#EXTM3U/.test(r.text().trimStart()) ? "ok" : "offline";
    return r.status >= 400 ? "offline" : "ok";
  } catch { return "slow"; }
}

// ---- interfaz del conector ----

// A "hoy" event: raw id (and so the ref) = its players, as in 1.0.43; Kino id from `key` "hoy.<event id>"; a title
// without status or clock (stable between refreshes); its kick-off as `start` (src/liveMerge.js tells sessions apart).
export function eventChannel(e) {
  const title = [e.title, e.league].filter(Boolean).join(" — ");
  const ch = { id: e.tokens.join(","), key: "hoy." + e.id, title, start: e.start };
  if (e.flag) ch.logo = e.flag;
  return ch;
}
function tokenChannel(c) {
  const ch = { id: c.tokens.join(","), title: c.name };
  if (c.logo) ch.logo = c.logo;
  return ch;
}

const conn = {
  id: "futbollibre",
  name: "Fútbol Libre",
  genre: "deportes",
  codeCategories: true,                  // categories() never makes a request
  codeList: (cat) => cat === "main",     // "main" is a code list; "hoy" and "mas" are fetched and stored

  // Always the three: the 41 KB /channels probe that decided whether to list "más" is gone (spec §5.1); an empty
  // "más" just shows no channels.
  async categories() {
    return [
      { id: "hoy", title: { es: "Partidos de hoy", en: "Today's matches" } },
      { id: "main", title: { es: "Canales deportivos", en: "Sports channels" } },
      { id: "mas", title: { es: "Más canales", en: "More channels" } },
    ];
  },

  async channels(categoryId) {
    if (categoryId === "hoy") return (await agenda()).map(eventChannel);
    if (categoryId === "main") return MAIN.map(tokenChannel);
    if (categoryId === "mas") return (await moreChannels()).map(tokenChannel);
    return [];
  },

  async resolve(channelId) {
    const tokens = String(channelId || "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (!tokens.length) throw new Error("ref inválido");
    const started = Date.now();
    let sawOffline = false;
    let slow = "";
    for (const token of tokens) {
      const left = Math.min(18000 - (Date.now() - started), remaining());   // remaining(): the call's deadline
      if (left < 2500) break;
      try {
        const url = await runToken(token, Math.min(8000, left - 1500));
        if (!url) { log("player " + token.split(".")[0] + ": sin dirección"); continue; }
        const verdict = await verify(url);
        if (verdict === "offline") { sawOffline = true; continue; }
        if (verdict === "slow") { slow = slow || url; continue; }
        return { url, mime: "application/vnd.apple.mpegurl" };
      } catch (e) { log("player " + token.split(".")[0] + " falló: " + (e && e.message)); }
    }
    if (slow) return { url: slow, mime: "application/vnd.apple.mpegurl" };
    throw new Error(sawOffline ? "sin señal por ahora" : "ningún servidor responde");
  },
};

export default conn;
