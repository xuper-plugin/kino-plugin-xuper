// src/sources/index.js — REGISTRY del agregador de En vivo.
// Cada conector expone: id, name, genre, categories(), channels(catId), resolve(chId)→{url,mime,headers?,drm?}.
// Solo se registran acá las fuentes VERIFICADAS (corridas de verdad contra la fuente viva en Node con shim de
// kino.fetch). Agregar/sacar una fuente = import + entrada en SOURCES. El ref de canal "L:<id>:<canal>" despacha
// por `id`. NO verificadas y fuera: antena (serverKey sellado no disponible; supertv ya cubre esa familia Xtream),
// mubis/mubis-x (cuenta vseemax BANEADA), plaviohd/palaciohd/nauta (servers muertos), zapptv (sin capability).

import { makeM3U } from "./m3u.js";
import xuper from "./xuper.js";                 // portal Magis masnew (deviceless, ~1035 canales)
import supertv, { supertv2, supertv3 } from "./supertv.js";   // Xtream vía bootstrap VegetaTV (depende de xtream.js)
import caracol from "./caracol.js";             // API Ditu (Colombia, DASH+Widevine; usa kino.cookies)
import tvenvivo from "./tvenvivo.js";           // scraper CO/LatAm (HLS)
import cablevisionhd from "./cablevisionhd.js"; // scraper (HLS)
import futbollibre from "./futbollibre.js";     // deportes (multi-player)
import nuvioSports from "./nuvio-sports.js";    // deportes (Stremio; depende de stremio.js)
import deportv from "./deportv.js";             // deportes (scraper; fix siempreon.shop)
import cncverse from "./cncverse.js";               // eventos deportes (Stremio; depende de stremio.js)

// M3U pública (conector de referencia)
const premiumtv = makeM3U({
  id: "premiumtv",
  name: "Premium TV",
  url: "https://raw.githubusercontent.com/JMigue85/IPTV-SV/refs/heads/main/IPTVSV.m3u",
  genre: "otros",
});

// Order = the categories' order + DEFAULT (the first). tvenvivo/Colombia first; xuper last (its portal session,
// the device's own anonymous one or a seed, is slow to open → never the default category; it takes the rest of the
// 190 quota). cncverse-tv (India TV) was removed (owner, 2026-11-16): its favourites stop resolving.
// This order also names a merged channel (its first member's id, title and logo: favourites depend on them), so it never
// changes for speed. Which member PLAYS first is decided at resolve time on what the device measured (src/live.js
// `playCandidates`): tvenvivo is not fast (2026-11-17: 1–3.5 s, its player page is ~660 KB), and a copy that needs no
// request (supertv, premiumtv) known to play goes before a source measured slow.
// supertv2 / supertv3 (1.0.46): supertv's other panels, failover for its channels: always last, so none of their
// channels ever leads a merged one and no existing id, title or ref changes.
export const SOURCES = [
  tvenvivo,
  caracol,
  cablevisionhd,
  premiumtv,
  supertv,
  futbollibre,
  nuvioSports,
  deportv,
  cncverse,
  xuper,
  supertv2,
  supertv3,
];

export function sourceById(id) {
  for (const s of SOURCES) if (s.id === id) return s;
  return null;
}
