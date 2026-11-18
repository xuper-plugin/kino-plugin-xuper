// src/sources/deportv.js — conector de En vivo DEPORTES: DeporTV (El Canal Deportivo).
// Port of the plugin xuper-plugin/kino-plugin-deportv to the connector interface of Xuper's live aggregator.
// Agenda: elcanaldeportivo.org/partidos.json (hora, liga, equipos, canales).
// resolve: la página de un canal (/ver/<x>.php) abre una cadena de iframes que termina en una página
//   reproductora; esa página lista su stream en streamUrls=["...candyshop.st..."]. El sitio migró de
//   xstream.st a siempreon.shop (mismo shape), así que ambos hosts están en el allowlist de reproductores.
// Self-contained: solo JS puro + liveFetch (kino.fetch acotado, src/liveGate.js).
//
// Cache (spec §5.1): ONE request of about 2.6 KB feeds every list. It is conditional (`If-Modified-Since` with the
// stored `Last-Modified`, instead of the old `?v=<minute>` cache-buster): a 304 reuses the stored schedule (o2:dtv,
// parsed), and the lists are recomputed from it, because they depend on the time of day. From that one response
// the connector also stores its categories (`ctx.setCats`) and every other category's list (`ctx.putList`).
// Categories: "Hoy" plus the leagues with a match in [now − 3 h, now + 48 h], at most 6; a league lists only those
// matches. Lists and categories: fresh 30 min, stale up to 6 h (src/live.js POLICY). Nothing in module memory: one
// schedule per call (`ctx.once` / flight `dtv:schedule`). Channel ids and refs are 1.0.43's.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { once } from "../flight.js";
import { getJson, setJson } from "../store.js";

const HOST = "https://elcanaldeportivo.org";
// Hosts que SON la página reproductora (llevan streamUrls=[...]). siempreon.shop es el actual; xstream.st el histórico.
const PLAYER_HOSTS = new Set(["siempreon.shop", "xstream.st"]);
const MAX_FRAMES = 4; // páginas seguidas desde la del canal hasta la reproductora
const TODAY_ID = "today";
// Stored whole in the registry: src/live.js shows it in the visible language, also after a language switch.
const TODAY_TITLE = { es: "Hoy", en: "Today" };
const ON_AIR_MS = 3 * 60 * 60 * 1000; // un partido iniciado hace hasta 3 h sigue al aire
const DAY_MS = 24 * 60 * 60 * 1000;
export const LEAGUE_AHEAD_MS = 48 * 60 * 60 * 1000; // a league is listed while it has a match in [now − 3 h, now + 48 h]
export const MAX_CATS = 6;                           // "Hoy" + 5 leagues (spec §5.2)
const SCHEDULE_KEY = "o2:dtv";                       // {"lm": "<Last-Modified>", "m": [parsed matches]}
const SCHEDULE_TTL_MS = 7 * DAY_MS;
// Kino accepts category ids of at most 128 characters: "deportv." + hex(raw id), and the raw id is ASCII (×2).
const MAX_RAW_CAT = Math.floor((128 - "deportv.".length) / 2);   // 60

// Una página pedida como iframe, como la cargaría un navegador embebido.
function frameHeaders(referer) { return { Referer: referer, "Sec-Fetch-Dest": "iframe", Accept: "text/html" }; }

async function getText(url, referer) {
  const r = await liveFetch(url, { headers: frameHeaders(referer), timeoutMs: 12000 });
  if (!r.ok) throw new Error(url + " respondió " + r.status);
  return r.text();
}

function hostOf(url) { const m = /^https?:\/\/([^/]+)/i.exec(String(url)); return m ? m[1] : ""; }
function originOf(url) { const m = /^(https?:\/\/[^/]+)/i.exec(String(url)); return m ? m[1] : ""; }

function absolute(src, base) {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("//")) return "https:" + src;
  return base.replace(/^(https?:\/\/[^/]+).*$/i, "$1") + (src.startsWith("/") ? "" : "/") + src;
}

// El primer iframe src de [html], resuelto contra [base], o null.
function firstIframe(html, base) {
  const m = /<iframe\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i.exec(html);
  return m ? absolute(m[1], base) : null;
}

// El primer stream de la lista streamUrls = ["…"] del reproductor, desescapado, o null.
function streamUrlOf(script) {
  const m = /streamUrls\s*=\s*\[\s*"([^"]+)"/.exec(script);
  if (!m) return null;
  const url = m[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  return /^https:\/\//.test(url) ? url : null;
}

// Partidos de la agenda como { league, title, utc, logo, channels:[{name,path,quality}] }.
function parseSchedule(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m.equipos !== "string") continue;
    const channels = (Array.isArray(m.canales) ? m.canales : [])
      .filter((c) => c && typeof c.url === "string" && /^\/ver\/[\w.-]+\.php$/.test(c.url))
      .map((c) => ({ name: String(c.nombre || "").slice(0, 60), path: c.url, quality: String(c.calidad || "") }));
    if (!channels.length) continue;
    out.push({
      league: String(m.liga || "").replace(/:\s*$/, "").trim() || "Otros",
      title: m.equipos.replace(/\s+/g, " ").trim().slice(0, 120),
      utc: Date.parse(m.hora_utc) || 0,
      logo: /^img\/[\w.-]+$/.test(m.logo || "") ? HOST + "/" + m.logo : "",
      channels,
    });
  }
  return out.sort((a, b) => a.utc - b.utc);
}

// The stored schedule (o2:dtv) when it is usable: { lm, m } or null.
function storedSchedule() {
  const v = getJson(SCHEDULE_KEY);
  return v && typeof v.lm === "string" && v.lm && Array.isArray(v.m) ? v : null;
}

// The schedule: one conditional GET per call. 304 → the stored one; 200 → parsed and stored (only when it changed).
async function fetchSchedule() {
  const stored = storedSchedule();
  const headers = { Accept: "application/json", Referer: HOST + "/" };
  if (stored) headers["If-Modified-Since"] = stored.lm;
  const r = await liveFetch(HOST + "/partidos.json", { headers, timeoutMs: 10000 });
  if (r.status === 304 && stored) return stored.m;          // Kino reports a 304 as ok:false: test it first
  if (!r.ok) throw new Error("agenda respondió " + r.status);
  const m = parseSchedule(r.json());
  const lm = String((r.headers && (r.headers["last-modified"] || r.headers["Last-Modified"])) || "");
  if (lm) {
    if (!stored || stored.lm !== lm || JSON.stringify(stored.m) !== JSON.stringify(m)) setJson(SCHEDULE_KEY, { lm, m }, { ttlMs: SCHEDULE_TTL_MS });
  }
  return m;
}
function schedule(ctx) {
  return ctx && typeof ctx.once === "function" ? ctx.once("schedule", fetchSchedule) : once("dtv:schedule", fetchSchedule);
}

function slug(s) { return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
// "l_" + the slug, cut so that Kino's id ("deportv." + hex) fits 128 characters: ids up to 58 slug characters are
// 1.0.43's; longer ones were over 128 (Kino dropped them) and are now cut to fit.
export function leagueId(league) { return ("l_" + slug(league).slice(0, 60)).slice(0, MAX_RAW_CAT); }
function clock(utc) { const d = new Date(utc); const p = (n) => String(n).padStart(2, "0"); return p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + " UTC"; }

// path /ver/<base>.php → base (para codificarlo en el channelId y reconstruirlo en resolve).
function baseOfPath(path) { const m = /^\/ver\/([\w.-]+)\.php$/.exec(String(path)); return m ? m[1] : ""; }

function channelsOf(match, categoryId) {
  const out = [];
  for (const c of match.channels) {
    const base = baseOfPath(c.path);
    if (!base) continue;
    // id = base~<disc>: base lleva el /ver/<base>.php para resolve; el sufijo lo hace único por partido/canal.
    const disc = (slug(match.title).slice(0, 40) + "-" + slug(c.name).slice(0, 20)).replace(/^-|-$/g, "") || "x";
    const ch = {
      id: (base + "~" + disc).slice(0, 110),
      title: match.title + " · " + c.name + (c.quality ? " (" + c.quality + ")" : "") + " · " + clock(match.utc),
      start: match.utc,
    };
    if (match.logo) ch.logo = match.logo;
    out.push(ch);
  }
  return out;
}

// The categories of a schedule at `now`: "Hoy", then the leagues with a match in the window (in kickoff order), ≤ 6.
export function categoriesOf(matches, now) {
  const leagues = [];
  for (const m of matches) {
    if (!(m.utc > now - ON_AIR_MS && m.utc < now + LEAGUE_AHEAD_MS)) continue;
    const id = leagueId(m.league);
    if (!leagues.some((l) => l.id === id)) leagues.push({ id, title: m.league });
  }
  return [{ id: TODAY_ID, title: TODAY_TITLE }, ...leagues].slice(0, MAX_CATS);
}

// One category's channels from a schedule at `now`: "Hoy" = [now − 3 h, now + 24 h]; a league = its matches in
// [now − 3 h, now + 48 h] (old matches are no longer listed).
export function listOf(matches, categoryId, now) {
  const picked = categoryId === TODAY_ID
    ? matches.filter((m) => m.utc > now - ON_AIR_MS && m.utc < now + DAY_MS)
    : matches.filter((m) => leagueId(m.league) === categoryId && m.utc > now - ON_AIR_MS && m.utc < now + LEAGUE_AHEAD_MS);
  const out = [];
  for (const m of picked) for (const ch of channelsOf(m, categoryId)) out.push(ch);
  return out.slice(0, 200);
}

// From one schedule: store the categories and every OTHER category's list (one request serves them all).
function storeAll(ctx, matches, now, except) {
  const cats = categoriesOf(matches, now);
  if (ctx && typeof ctx.setCats === "function") ctx.setCats(cats);
  if (ctx && typeof ctx.putList === "function") {
    for (const c of cats) if (c.id !== except) ctx.putList(c.id, listOf(matches, c.id, now));
  }
  return cats;
}

const conn = {
  id: "deportv",
  name: "DeporTV",
  genre: "deportes",
  sharedFetch: true,      // one schedule stores every category's list: one fetch unit for src/live.js's plan

  async categories(ctx) {
    const matches = await schedule(ctx);
    const now = Date.now();
    const cats = categoriesOf(matches, now);
    if (ctx && typeof ctx.putList === "function") for (const c of cats) ctx.putList(c.id, listOf(matches, c.id, now));
    return cats;
  },

  async channels(categoryId, ctx) {
    const matches = await schedule(ctx);
    const now = Date.now();
    const cat = String(categoryId);
    storeAll(ctx, matches, now, cat);
    return listOf(matches, cat, now);
  },

  async resolve(channelId) {
    const base = String(channelId || "").split("~")[0];
    if (!/^[\w.-]+$/.test(base)) throw new Error("ref inválido");
    // Página del canal -> iframes -> la reproductora que lista el stream.
    let page = HOST + "/ver/" + base + ".php";
    let referer = HOST + "/";
    for (let i = 0; i < MAX_FRAMES; i++) {
      const html = await getText(page, referer);
      if (PLAYER_HOSTS.has(hostOf(page))) {
        const url = streamUrlOf(html);
        if (!url) throw new Error("sin stream en el reproductor");
        return { url, mime: "application/vnd.apple.mpegurl", headers: { Referer: page, Origin: originOf(page) } };
      }
      const next = firstIframe(html, page);
      if (!next) throw new Error("sin iframe");
      const host = hostOf(next);
      if (host !== hostOf(HOST) && !PLAYER_HOSTS.has(host)) throw new Error("reproductor no soportado: " + host);
      referer = page;
      page = next;
    }
    throw new Error("demasiados iframes");
  },
};

export default conn;
