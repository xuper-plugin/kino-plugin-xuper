// src/sources/tvenvivo.js — conector EN VIVO de tvenvivo.org (port del plugin xuper-plugin/kino-plugin-tvenvivo).
// Catálogo de 88 canales HARDCODEADO (CATALOG tal cual: [slug, canalId, nombre, grupo, logo]). Logos en /imge/<x>.webp.
// resolve: the channel's remembered player page (o2:tvp), else live[/2/3]/core.php?canal=<id> (Referer: the site) →
//          the signed player page (stream.php?canal=…&target=<skin>&sig=…, asked as the site's iframe) → the tokenized
//          HLS it names (/playlist/<n>/index.m3u8?token=…). HLS, no DRM, deviceless.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { lang } from "../config.js";

const BASE = "https://www.tvenvivo.org";
const HLS = "application/vnd.apple.mpegurl";

// [slug, canal id que toma el player, nombre, grupo, archivo de logo]. El canal id NO siempre es el slug sin guiones.
const CATALOG = [
  // bein-sports-xtra SACADO: defunto (logo placeholder + 404 constante en los 3 skins) → caía de PRIMERO y parecía todo roto.
  ["liga-1", "liga1", "Liga 1", "deportes", "liga1"],
  ["liga-1-max", "liga1max", "Liga 1 Max", "deportes", "liga1max"],
  ["tudn", "tudn", "TUDN", "deportes", "tudn"],
  ["sky-sports-la-liga", "skysportslaliga", "Sky Sports La Liga", "deportes", "skysportslaliga"],
  ["tyc-sports", "tycsports", "TyC Sports", "deportes", "tycsports"],
  ["directv-sports", "directvsports", "Directv Sports", "deportes", "directvsports"],
  ["directv-sports-2", "directvsports2", "Directv Sports 2", "deportes", "directvsports2"],
  ["directv-sports-plus", "directvsportsplus", "Directv Sports Plus", "deportes", "directvsportsplus"],
  ["espn-premium-latino-america", "espnpremiumlat", "ESPN Premium Usa", "deportes", "espnpremium"],
  ["espn-premium-argentina", "espnpremiumar", "ESPN Premium Argentina", "deportes", "espnpremium"],
  ["espn-colombia", "espn", "ESPN Colombia", "deportes", "espn"],
  ["espn-argentina", "espnar", "ESPN Argentina", "deportes", "espn"],
  ["espn-2", "espn2", "ESPN 2", "deportes", "espn2"],
  ["espn-3", "espn3", "ESPN 3", "deportes", "espn3"],
  ["espn-4", "espn4", "ESPN 4", "deportes", "espn4"],
  ["espn-5", "espn5", "ESPN 5", "deportes", "espn5"],
  ["espn-6", "espn6", "ESPN 6", "deportes", "espn6"],
  ["espn-7", "espn7", "ESPN 7", "deportes", "espn7"],
  ["espn-mexico", "espnmexico", "ESPN Mexico", "deportes", "espnmexico"],
  ["espn-2-mexico", "espn2mexico", "ESPN 2 Mexico", "deportes", "espn2mexico"],
  ["espn-3-mexico", "espn3mexico", "ESPN 3 Mexico", "deportes", "espn3mexico"],
  ["espn-4-mexico", "espn4mexico", "ESPN 4 Mexico", "deportes", "espn4mexico"],
  ["fox-sports", "foxsports", "Fox Sports", "deportes", "foxsports"],
  ["fox-sports-2", "foxsports2", "Fox Sports 2", "deportes", "foxsports2"],
  ["fox-sports-3", "foxsports3", "Fox Sports 3", "deportes", "foxsports3"],
  ["fox-sports-mexico", "foxsportsmexico", "Fox Sports Mexico", "deportes", "foxsportsmx"],
  ["fox-sports-2-mexico", "foxsports2mexico", "Fox Sports 2 Mexico", "deportes", "foxsports2mx"],
  ["fox-sports-3-mexico", "foxsports3mexico", "Fox Sports 3 Mexico", "deportes", "foxsports3mexico"],
  // Al FINAL de Deportes: estaban caídos en el probe (geo/sólo en partido) → no deben tapar a los que andan arriba.
  ["fox-sports-premium", "foxsportspremium", "Fox Sports Premium", "deportes", "foxsportspremium"],
  ["movistar-la-liga", "movistarlaliga", "Movistar La Liga", "deportes", "movistarlaliga"],
  ["movistar-liga-campeones", "movistarligadecampeones", "Movistar Liga de Campeones", "deportes", "movistarligadecampeones"],
  ["espn-5-mexico", "espn5mexico", "ESPN 5 Mexico", "deportes", "espn5mexico"],
  ["telefe", "telefe", "Telefe", "ar", "telefe"],
  ["el-trece", "eltrece", "El Trece", "ar", "eltrece"],
  ["telemundo-51", "telemundo51", "Telemundo 51", "us", "telemundo51"],
  ["telemundo-puerto-rico", "telemundopuertorico", "Telemundo Puerto Rico", "us", "telemundopuertorico"],
  ["univision", "univision", "Univision", "us", "univision"],
  ["pasiones", "pasiones", "Pasiones", "novelas", "pasiones"],
  ["tlnovelas", "tlnovelas", "Tlnovelas", "novelas", "tlnovelas"],
  ["las-estrellas", "lasestrellas", "Las Estrellas", "mx", "lasestrellas"],
  ["antena-3", "antena3", "Antena 3", "intl", "antena3"],
  ["dw-espanol", "dwespanol", "DW Español", "intl", "dwespanol"],
  ["caracol", "caracol", "Caracol", "co", "caracol"],
  ["rcn", "rcn", "RCN", "co", "rcn"],
  ["latina", "latina", "Latina", "pe", "latina"],
  ["america-tv", "americatv", "América TV", "pe", "americatv"],
  ["atv", "atv", "ATV", "pe", "atv"],
  ["unicable", "unicable", "Unicable", "mx", "unicable"],
  ["imagen-tv", "imagentv", "Imagen TV", "mx", "imagentv"],
  ["azteca-7", "azteca7", "Azteca 7", "mx", "azteca7"],
  ["azteca-uno", "aztecauno", "Azteca Uno", "mx", "aztecauno"],
  ["canal-5", "canal5", "Canal 5", "mx", "canal5"],
  ["tnt-novelas", "tntnovelas", "TNT Novelas", "novelas", "tntnovelas"],
  ["disney-channel", "disneychannel", "Disney Channel", "infantil", "disneychannel"],
  ["cartoon-network", "cartoonnetwork", "Cartoon Network", "infantil", "cartoonnetwork"],
  ["tooncast", "tooncast", "Tooncast", "infantil", "tooncast"],
  ["discovery-channel", "discoverychannel", "Discovery Channel", "docs", "discoverychannel"],
  ["id-investigation", "idinvestigation", "ID Investigation", "docs", "idinvestigation"],
  ["discovery-hh", "discoveryhyh", "Discovery H&H", "docs", "discoveryhyh"],
  ["history", "history", "History", "docs", "history"],
  ["history-2", "history2", "History 2", "docs", "history2"],
  ["animal-planet", "animalplanet", "Animal Planet", "docs", "animalplanet"],
  ["nat-geo", "natgeo", "Nat Geo", "docs", "natgeo"],
  ["universal-channel", "universaltv", "Universal Channel", "cine", "universalchannel"],
  ["tnt", "tnt", "TNT", "cine", "tnt"],
  ["tnt-series", "tntseries", "TNT Series", "cine", "tntseries"],
  ["star-channel", "starchannel", "Star Channel", "cine", "starchannel"],
  ["cinemax", "cinemax", "Cinemax", "cine", "cinemax"],
  ["space", "space", "Space", "cine", "space"],
  ["warner-channel", "warnerchannel", "Warner Channel", "cine", "warnerbrostv"],
  ["cinecanal", "cinecanal", "Cinecanal", "cine", "cinecanal"],
  ["fx", "fx", "FX", "cine", "fx"],
  ["axn", "axn", "AXN", "cine", "axn"],
  ["amc", "amc", "AMC", "cine", "amc"],
  ["studio-universal", "studiouniversal", "Studio Universal", "cine", "studiouniversal"],
  ["multipremier", "multipremier", "Multipremier", "cine", "multipremier"],
  ["golden", "golden", "Golden", "cine", "golden"],
  ["golden-plus", "goldenplus", "Golden Plus", "cine", "goldenplus"],
  ["golden-edge", "goldenedge", "Golden Edge", "cine", "goldenedge"],
  ["golden-premier", "goldenpremier", "Golden Premier", "cine", "goldenpremier"],
  ["canal-sony", "canalsony", "Canal Sony", "cine", "canalsony"],
  ["fm-hot-movies", "fmhotmovies", "FM Hot Movies", "cine", "fmhotmovies"],
  ["fm-hot-kids", "fmhotkids", "FM Hot Kids", "infantil", "fmhotkids"],
  ["extrema-tv", "extrematv", "Extrema TV", "cine", "extrematv"],
  ["distrito-comedia", "distritocomedia", "Distrito Comedia", "cine", "distritocomedia"],
  // grupo "adultos" (venus, play-boy) omitido a propósito: el agregador no tiene gate 18+.
];

// grupo -> título visible y orden. "adultos" fuera a propósito.
const GROUP_TITLES = {
  deportes: "Deportes", co: "Colombia", mx: "México", pe: "Perú", ar: "Argentina",
  us: "Estados Unidos", intl: "Internacional", novelas: "Novelas", infantil: "Infantil",
  docs: "Documentales", cine: "Cine y series", mas: "Más canales",
};
// The same titles in English (the category ids never change with the language).
const GROUP_TITLES_EN = {
  deportes: "Sports", co: "Colombia", mx: "Mexico", pe: "Peru", ar: "Argentina",
  us: "United States", intl: "International", novelas: "Telenovelas", infantil: "Kids",
  docs: "Documentaries", cine: "Movies and series", mas: "More channels",
};
const en = () => lang() === "en";
const groupTitle = (g) => (en() ? GROUP_TITLES_EN[g] : GROUP_TITLES[g]) || GROUP_TITLES[g] || g;
const GROUP_ORDER = ["deportes", "co", "mx", "pe", "ar", "us", "intl", "novelas", "infantil", "docs", "cine", "mas"];

function catalogChannels() {
  return CATALOG
    .filter(([, , , group]) => group !== "adultos")
    .map(([slug, canal, name, group, logo]) => ({
      slug,
      canal,
      name,
      group: GROUP_TITLES[group] ? group : "mas",
      logo: `${BASE}/imge/${logo}.webp`,
    }));
}

const MANIFEST = /https?:\/\/[^"'\s<]+?\/playlist\/\d+\/index\.m3u8\?token=[0-9a-f]{40}-[0-9a-f]{32}-\d+-\d+/;
const PLAYER = /src="(https:\/\/[^"]+\/stream\.php[^"]+)"/;
const TOKEN_MARK = "index.m3u8?token=";

// The three player skins (live, live2, live3: `target` 1–3 in the player page's URL) play the SAME stream [M 2026-11-16,
// again 2026-11-17: the same /playlist/<n>/ from every skin, a fresh token each time].
const SKINS = ["1", "2", "3"];

// The player pages (stream.php on two hosts: deportes.* for the sports channels, regionales.* for every other one) answer
// only their embedding page. Measured 2026-11-17: without a Referer — what Kino's fetch sends — the regionales host
// answers 200 "Embedding domain not allowed / REFERER: VACIO", so 53 of the 85 channels (Imagen TV, Azteca 7…) failed
// after six requests that all answered 200; so does "https://tvenvivo.org/" or any other site, and both hosts answer 403
// "Player must be loaded through an embed" to Sec-Fetch-Dest "document" or "empty". The core page embeds the player in
// an iframe with referrerpolicy="origin": a browser sends exactly these two.
const PLAYER_HEADERS = { Referer: BASE + "/", "Sec-Fetch-Dest": "iframe" };

// The player page that last named a stream, per channel: {"<slug>": "<stream.php URL>"}. Its signature depends only on
// the channel and the skin (measured 2026-11-17: the same sig for 20 min, and the same one in cablevisionhd.com's pages),
// so a resolve asks that page first: one request instead of two (core.php is another host: its TLS too), and the skin
// that works first. A remembered page that names no stream is forgotten and the core pages are asked again. Kept through
// `ctx.memo` and written behind (`ctx.saveMemo`): never inside a resolve's answer.
export const TVP_KEY = "o2:tvp";
const TVP_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * The tokenized playlist a player page names (`var src = "https:\/\/…\/playlist\/<n>\/index.m3u8?token=…"`, near the end
 * of ~660 KB of obfuscated script), or null. Only a window around each mention is unescaped and matched: never a copy
 * and a regex scan of the whole page on the runtime's only thread.
 */
export function manifestIn(text) {
  const s = String(text || "");
  for (let i = s.indexOf(TOKEN_MARK); i >= 0; i = s.indexOf(TOKEN_MARK, i + TOKEN_MARK.length)) {
    const m = MANIFEST.exec(s.slice(Math.max(0, i - 400), i + TOKEN_MARK.length + 160).replace(/\\\//g, "/"));
    if (m) return m[0];
  }
  return null;
}

/** The skin a player page URL plays (its `target`), "1" when it names none. */
const skinOf = (url) => ((/[?&]target=([123])\b/.exec(String(url || "")) || [])[1] || "1");

/** One skin's core page → its signed player page URL, or null (the page names none). */
async function playerOf(canal, skin) {
  const dir = skin === "1" ? "live" : "live" + skin;
  const core = await liveFetch(`${BASE}/${dir}/core.php?canal=${encodeURIComponent(canal)}`, {
    headers: { Referer: BASE + "/" },
    timeoutMs: 8000,
  });
  const player = core.ok && PLAYER.exec(core.text());
  return player ? player[1].replace(/&amp;/g, "&") : null;
}

/**
 * One player page → `{ url, mime }` | `{ offline: true }` | null (it named no stream: worth another skin). The off-air
 * check (a GET of the playlist: only a 404 means "no signal now"; anything else, a timeout or a 403 from here, is left
 * to the player) only with `verify` (src/live.js `ctx.verify`: a re-resolve right after a cut). On a first open the
 * player's own request of the same playlist tells the same, and its 404 starts Kino's reopen.
 */
async function fromPlayer(playerUrl, verify) {
  const page = await liveFetch(playerUrl, { headers: PLAYER_HEADERS, timeoutMs: 12000 });
  const url = page.ok ? manifestIn(page.text()) : null;
  if (!url) return null;
  if (verify) {
    let status = 200;
    try {
      status = (await liveFetch(url, { timeoutMs: 3500 })).status;
    } catch (_) { /* not reachable from here: trust it */ }
    if (status === 404) return { offline: true };
  }
  return { url, mime: HLS };
}

const tvenvivo = {
  id: "tvenvivo",
  name: "TV en Vivo",
  genre: "otros",
  codeCategories: true,   // categories() never makes a request (src/live.js serves them with 0 requests)
  codeList: true,         // every channels() list is code too: never stored, never refreshed

  async categories() {
    const have = new Set(catalogChannels().map((c) => c.group));
    return GROUP_ORDER.filter((g) => have.has(g)).map((g) => ({ id: g, title: groupTitle(g) }));
  },

  async channels(categoryId) {
    return catalogChannels()
      .filter((c) => c.group === categoryId)
      .map((c) => ({ id: c.slug, title: c.name, logo: c.logo }));
  },

  // The remembered player page first (1 request); else each skin's core page and its player page (2), the remembered
  // skin first. The next skin is tried only when a page named no stream or its request failed. Off air (only with
  // `ctx.verify`): stops at the first 404 instead of trying every skin (each would say the same).
  async resolve(channelId, ctx) {
    const row = CATALOG.find((r) => r[0] === channelId);
    if (!row) throw new Error(en() ? "tvenvivo: unknown channel " + channelId : "tvenvivo: canal desconocido " + channelId);
    const canal = row[1];
    const verify = !!(ctx && ctx.verify);
    // A channel off the air carries code "offline": src/live.js never counts it against the source.
    const offAir = () => Object.assign(new Error(en() ? "tvenvivo: no signal right now for " + channelId : "tvenvivo: sin señal ahora para " + channelId), { code: "offline" });
    const couldNot = () => new Error(en() ? "tvenvivo: could not open " + channelId : "tvenvivo: no se pudo resolver " + channelId);
    const pages = ctx && typeof ctx.memo === "function" ? ctx.memo(TVP_KEY) || {} : {};
    const save = () => { if (ctx && typeof ctx.saveMemo === "function") ctx.saveMemo(TVP_KEY, TVP_TTL_MS); };
    const known = typeof pages[channelId] === "string" ? pages[channelId] : "";
    let stale = "";   // the remembered page, when it just named no stream: never asked twice in one resolve
    if (known) {
      let out = null, failed = null;
      try { out = await fromPlayer(known, verify); } catch (e) { failed = e || new Error("fetch failed"); }
      if (out && out.offline) throw offAir();
      if (out) return out;
      if (failed && failed.code === "deadline") throw couldNot();
      // it named no stream (a new signature, a page that changed): forgotten; a request that failed keeps it
      if (!failed) { stale = known; delete pages[channelId]; save(); }
    }
    const first = skinOf(known);
    for (const skin of [first, ...SKINS.filter((s) => s !== first)]) {
      let out = null, player = null;
      try {
        player = await playerOf(canal, skin);
        if (player && player !== stale) out = await fromPlayer(player, verify);
      } catch (e) {
        if (e && e.code === "deadline") break;   // the call's time is up: no other skin can start
        out = null;
      }
      if (out && out.offline) throw offAir();
      if (out) {
        if (pages[channelId] !== player) { pages[channelId] = player; save(); }
        return out;
      }
    }
    throw couldNot();
  },
};

export default tvenvivo;
