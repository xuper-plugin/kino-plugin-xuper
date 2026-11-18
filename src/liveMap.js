// liveMap.js — the virtual live categories (pure: no storage, no network). Every raw category of every source
// (`{ src, cat }`) goes into one small set of exposed categories: by country, by theme or brand, live events merged,
// supertv's "┃CC┃" prefixes grouped by country, premiumtv's groups folded into the country and theme categories.
// A raw category the rules do not know passes through as its own category (its 1.0.45 id `<src>.<hex>` and raw title)
// while the per-source budget allows, else it goes into its source's "Más canales" bucket: no channel is ever dropped.
// Adult raw categories always go to `v.adult` (adult: true), so adult and non-adult never share a category.
//
//   mapCategories(raw, opts)        → { list (exposed, in order, ≤ MAX_EXPOSED), all (Map id → entry), byRaw }
// Each raw category is classified once per runtime (cached by source, id, title and adult flag): its virtual id
// ("v.co", "v.sports", … or null for an unknown title) and its country ("co", "latam", "world", … or null).
//
// An exposed entry: `{ id, title, kind, merge, cc, src, members: [{ src, rawCat, cc? }], adult?, genre?,
// country?, hidden? }`. `kind` is sports | events | othersp | country | theme | all | pass | bucket | adult; `merge`
// says whether duplicate channels merge in it (src/liveMerge.js); `cc` is its single ISO country (merge keys), if any.
//
// Secondary sources (`opts.secondaryOf(src)` → its primary's id: supertv's other panels, supertv2 / supertv3) never add
// a category: their raw categories are read with their primary's rules, and one is kept only as a member of a
// single-country sports category ("Deportes · España": `v.sp.<cc>`) that a primary member already feeds, at most
// SEC_PER_TARGET per source and category (`secondaryKept`). The rest are dropped (no id, no pass-through, no bucket).
// Whether a category is shown never depends on its secondary members.
import { isAdultTitle } from "./sources/adult.js";
import { lang } from "./config.js";

export const MAX_EXPOSED = 90;
const PASS_CAP = { xuper: 24 };
const PASS_CAP_DEFAULT = 6;
const ID = /^[A-Za-z0-9._~-]{1,128}$/;

const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── the virtual table, in exposed order ──

const LATAM = [
  ["co", "Colombia", "Colombia"], ["mx", "México", "Mexico"], ["ar", "Argentina", "Argentina"], ["pe", "Perú", "Peru"],
  ["cl", "Chile", "Chile"], ["ec", "Ecuador", "Ecuador"], ["ve", "Venezuela", "Venezuela"], ["bo", "Bolivia", "Bolivia"],
  ["py", "Paraguay", "Paraguay"], ["uy", "Uruguay", "Uruguay"], ["cr", "Costa Rica", "Costa Rica"], ["pa", "Panamá", "Panama"],
  ["ni", "Nicaragua", "Nicaragua"], ["hn", "Honduras", "Honduras"], ["gt", "Guatemala", "Guatemala"],
  ["sv", "El Salvador", "El Salvador"], ["do", "República Dominicana", "Dominican Republic"], ["pr", "Puerto Rico", "Puerto Rico"],
  ["cu", "Cuba", "Cuba"],
];
const WORLD = [
  ["us", "Estados Unidos", "United States"], ["ca", "Canadá", "Canada"], ["es", "España", "Spain"], ["br", "Brasil", "Brazil"],
  ["pt", "Portugal", "Portugal"], ["it", "Italia", "Italy"], ["fr", "Francia", "France"], ["de", "Alemania", "Germany"],
  ["gb", "Reino Unido", "United Kingdom"],
];
const SPORT_CCS = [["es", "España", "Spain"], ["gb", "Reino Unido", "United Kingdom"], ["de", "Alemania", "Germany"],
  ["it", "Italia", "Italy"], ["fr", "Francia", "France"], ["nl", "Países Bajos", "Netherlands"], ["pt", "Portugal", "Portugal"],
  ["us", "Estados Unidos", "United States"]];

const country = ([cc, es, enT]) => ({ id: "v." + cc, es, en: enT, kind: "country", genre: "otros", cc, country: cc.toUpperCase(), merge: true });
const theme = (id, es, enT, genre) => ({ id, es, en: enT, kind: "theme", genre, merge: true });

/**
 * The virtual categories in the order they are exposed. Colombia first (the landing: code lists plus stored ones, the
 * fewest network members), then Sports (football-dominated: the own screen's Fútbol ▸ Canales lands on it), then the
 * rest of Latin America, live events, other sports, the rest of the world, the themes, and supertv's foreign sports.
 */
const VIRTUAL = [
  country(LATAM[0]),
  { id: "v.sports", es: "Deportes", en: "Sports", kind: "sports", genre: "deportes", merge: true },
  ...LATAM.slice(1).map(country),
  { id: "v.cam", es: "Centroamérica", en: "Central America", kind: "country", genre: "otros", merge: true },
  { id: "v.latam", es: "Latinoamérica", en: "Latin America", kind: "country", genre: "otros", merge: true },
  { id: "v.events", es: "Eventos en vivo", en: "Live events", kind: "events", genre: "deportes", merge: false },
  { id: "v.othersp", es: "Otros deportes", en: "Other sports", kind: "othersp", genre: "deportes", merge: true },
  ...WORLD.map(country),
  { id: "v.intl", es: "Internacional", en: "International", kind: "country", genre: "otros", merge: true },
  theme("v.news", "Noticias", "News", "noticias"),
  theme("v.ent", "Entretenimiento", "Entertainment", "entretenimiento"),
  theme("v.novelas", "Novelas", "Telenovelas", "entretenimiento"),
  theme("v.movies", "Cine y series", "Movies and series", "peliculas"),
  theme("v.247", "Series 24/7", "24/7 series", "series"),
  theme("v.kids", "Infantil", "Kids", "infantil"),
  theme("v.anime", "Anime", "Anime", "anime"),
  theme("v.asia", "Doramas y Asia", "Asian dramas", "series"),
  theme("v.docs", "Documentales y cultura", "Documentaries and culture", "documentales"),
  theme("v.music", "Música y radio", "Music and radio", "musica"),
  theme("v.faith", "Religión", "Faith", "otros"),
  ...SPORT_CCS.map(([cc, es, enT]) => ({ id: "v.sp." + cc, es: "Deportes · " + es, en: "Sports · " + enT, kind: "sports", genre: "deportes", cc, country: cc.toUpperCase(), merge: true })),
  { id: "v.sp.eu", es: "Fútbol europeo (UEFA)", en: "European football (UEFA)", kind: "sports", genre: "deportes", merge: true },
  { id: "v.sp.world", es: "Deportes internacionales", en: "International sports", kind: "sports", genre: "deportes", merge: true },
  { id: "v.all.xuper", es: "Todos los canales de Xuper", en: "All Xuper channels", kind: "all", genre: "otros", merge: false },
];
const ADULT_ENTRY = { id: "v.adult", es: "Adultos", en: "Adults", kind: "adult", genre: "otros", merge: true, adult: true };
const BY_ID = new Map([...VIRTUAL, ADULT_ENTRY].map((v) => [v.id, v]));
/** Whether `id` names a virtual category (`v.<…>`); buckets are `v.more.<src>`. */
export const isVirtualId = (id) => String(id || "").startsWith("v.");

// ── per-source overrides (exact raw ids) ──

const OVERRIDES = {
  tvenvivo: { deportes: "v.sports", co: "v.co", mx: "v.mx", pe: "v.pe", ar: "v.ar", us: "v.us", intl: "v.intl",
    novelas: "v.novelas", infantil: "v.kids", docs: "v.docs", cine: "v.movies" },
  caracol: { all: "v.co" },
  cablevisionhd: { sports: "v.sports", entertainment: "v.ent", news: "v.news", movies: "v.movies", kids: "v.kids",
    education: "v.docs", other: "v.ent" },
  premiumtv: { "TV Chichicasteca": "v.gt", "Canela TV": "v.movies", "FreeTV": "v.movies", "LG Channels": "v.movies" },
  futbollibre: { hoy: "v.events", main: "v.sports", mas: "v.sports" },
  // Its 24/7 networks are the US line-up (FOX, FS1, CBS Sports Network, ESPN with "ESPN Deportes" listed apart): their
  // "ESPN 2" or "Fox Sports 2" is not the Latin American channel of that name, so they never share its category.
  "nuvio-sports": { networks: "v.sp.us" },
};
// Sources whose every category is a live-event schedule (nuvio-sports except its 24/7 networks).
const EVENT_SOURCES = new Set(["nuvio-sports", "deportv", "cncverse"]);
// Sources with sports categories only.
const SPORT_SOURCES = new Set(["supertv", "futbollibre", "nuvio-sports", "deportv", "cncverse"]);

// ── countries ──

// Codes read only in a delimited prefix ("┃MX┃", "CO |", "[PE]", "MX:") or in brackets ("(MX)"); a bare word is never a
// code ("de", "es", "pa" inside a title stay words). "ar" is Arabic on supertv's panels and nothing elsewhere ("AR |" on
// an IPTV list is too ambiguous); Argentina is "arg", a flag or its name. "ca" is Canada on supertv only: on Latin
// American lists it usually means Centroamérica.
const CODES = {
  co: "co", col: "co", mx: "mx", mex: "mx", pe: "pe", cl: "cl", ec: "ec", ecu: "ec", ve: "ve", ven: "ve", bo: "bo", bol: "bo",
  py: "py", uy: "uy", uru: "uy", cr: "cr", pa: "pa", pan: "pa", ni: "ni", nic: "ni", hn: "hn", gt: "gt", gua: "gt", sv: "sv",
  do: "do", rd: "do", pr: "pr", cu: "cu", us: "us", usa: "us", eeuu: "us", es: "es", esp: "es", br: "br", bra: "br", pt: "pt",
  it: "it", ita: "it", fr: "fr", fra: "fr", de: "de", ger: "de", nl: "nl", uk: "gb", gb: "gb", arg: "ar",
  lat: "latam", latam: "latam", latino: "latam", latin: "latam", ucl: "eu", uefa: "eu", eu: "eu",
};
function codeOf(code, srcId) {
  if (code === "ar") return srcId === "supertv" ? "world" : null;
  if (code === "ca" || code === "can") return srcId === "supertv" ? "ca" : null;
  return CODES[code] || null;
}
const NAMES = [
  ["co", /\bcolombia(?:n[oa]s?)?\b/], ["mx", /\bmexic(?:o|an[oa]s?)\b/], ["ar", /\bargentin(?:a|[oa]s?)\b/],
  ["pe", /\bperu(?:an[oa]s?)?\b/], ["cl", /\bchile(?:n[oa]s?)?\b/], ["ec", /\becuador\b|\becuatorian[oa]s?\b/],
  ["ve", /\bvenezol\w*|\bvenezuela\b/], ["bo", /\bbolivi(?:a|an[oa]s?)\b/], ["py", /\bparaguay\w*/], ["uy", /\buruguay\w*/],
  ["cr", /\bcosta ?rica\b|\bcostarricense\w*/], ["pa", /\bpanam(?:a|en[oa]s?)\b/], ["ni", /\bnicaragu\w*/],
  ["hn", /\bhonduras\b|\bhondure\w*/], ["gt", /\bguatemal\w*/], ["sv", /\bel salvador\b|\bsalvadore\w*/],
  ["do", /\brepublica dominicana\b|\bdominican\w*/], ["pr", /\bpuerto rico\b|\bpuertorrique\w*|\bboricua\w*/],
  ["cu", /\bcuba(?:n[oa]s?)?\b/], ["us", /\bestados unidos\b|\bunited states\b|\busa\b|\bee ?uu\b/],
  ["es", /\bespana\b|\bspain\b/], ["br", /\bbrasil\w*|\bbrazil\b/], ["pt", /\bportugal\b/], ["it", /\bitalia\b|\bitaly\b/],
  ["fr", /\bfrancia\b|\bfrance\b/], ["de", /\balemania\b|\bgermany\b|\bdeutschland\b/],
  ["gb", /\breino unido\b|\bunited kingdom\b|\binglaterra\b|\bengland\b/], ["ca", /\bcanada\b/],
  ["cam", /\bcentro ?america\b|\bcentral america\b/],
  ["latam", /\blatin[oa]s?\b|\blatam\b|\blatinoamerica\b|\blatin america\b|\bhispan[oa]s?\b/],
  ["world", /\binternacional(?:es)?\b|\binternational\b|\bmundo\b|\bworld\b|\beuropa\b|\beurope\b|\bturqu\w*|\bturkey\b|\barabe?s?\b|\bindia\b|\brusia\b|\brussia\b|\bafrica\b/],
];
const LATAM_CC = new Set([...LATAM.map((c) => c[0]), "cam", "latam"]);
const SPORT_CC = new Set(SPORT_CCS.map((c) => c[0]));
const COUNTRY_IDS = new Set([...LATAM.map((c) => c[0]), ...WORLD.map((c) => c[0]), "cam", "latam"]);

// A delimited prefix: "┃MX┃ …", "MX ▎ …", "[MX] …", "MX: …", "MX | …", "MX - …".
const PREFIX = /^\s*[[(┃|]?\s*([a-z]{2,6})\s*(?:[┃▎|:\])]|-\s)/;
const BRACKET = /[[(]\s*([a-z]{2,4})\s*[)\]]/;

/** The country of a regional-indicator flag in the text ("🇨🇴" → "co"), or null. */
export function flagCountry(text) {
  const cps = Array.from(String(text == null ? "" : text));
  for (let i = 0; i + 1 < cps.length; i++) {
    const a = cps[i].codePointAt(0), b = cps[i + 1].codePointAt(0);
    if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
      const cc = String.fromCharCode(a - 0x1f1e6 + 97) + String.fromCharCode(b - 0x1f1e6 + 97);
      return cc === "uk" ? "gb" : cc;
    }
  }
  return null;
}

/** A title's country: a flag, a delimited code prefix, a bracketed code, then a name. "world" = no single country. */
function countryOf(srcId, raw, n0) {
  const f = flagCountry(raw);
  if (f) return f;
  const p = PREFIX.exec(n0);
  if (p) {
    const cc = codeOf(p[1], srcId);
    if (cc) return cc;
    // supertv's panels prefix every category with its region: an unknown one is a foreign feed.
    if (srcId === "supertv" && p[1].length <= 4) return "world";
  }
  const b = BRACKET.exec(n0);
  if (b) {
    const cc = codeOf(b[1], srcId);
    if (cc && cc !== "world") return cc;
  }
  const n = n0.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ");
  for (const [cc, re] of NAMES) if (re.test(n)) return cc;
  return null;
}

// ── themes, sports, events (whole words on the accent-free title: never a substring like "Influencers" → "nfl") ──

const EVENTS = /\beventos?\b|\bevents?\b|\bppv\b|\bpay per view\b|\ben vivo ahora\b|\blive now\b|\bpartidos de hoy\b|\btoday ?s matches\b|\bagenda\b|\bmatch ?day\b/;
const REPLAY = /\breplay\b|\brepeticion\w*/;
const FOOTBALL = /\bfutbol\w*|\bfootball\b|\bsoccer\b|\bfutebol\b|\bcalcio\b|\bfussball\b|\bvoetbal\b|\bliga\b|\blaliga\b|\bligue ?1\b|\bpremier league\b|\bserie a\b|\bbundesliga\b|\bchampions\b|\buefa\b|\bucl\b|\bfifa\b|\bcopa\b|\bsuper ?copa\b|\bcopa mundial\b|\bmundial de clubes\b|\blibertadores\b|\bsudamericana\b|\bconmebol\b|\beliminatorias\b|\beredivisie\b|\bbrasileirao\b|\bmls\b|\bliga ?mx\b|\bliga ?1\b|\bprimera division\b|\bprimera [ab]\b|\bfutsal\b/;
const SPORT_BRANDS = /\bespn\w*|\bfox sports?\b|\bfox deportes\b|\bdazn\b|\bbein\b|\btnt sports?\b|\bsky sports?\b|\bdirec ?tv sports?\b|\bwin sports?\b|\bwin ?\+|\btudn\b|\bgol ?tv\b|\bd ?sports?\b|\btyc sports?\b|\beurosport\w*|\btigo sports?\b|\bclaro sports?\b|\bmovistar deportes\b|\bm\+ deportes\b|\bviaplay\b|\bsportv\b/;
const SPORT_GENERIC = /\bdeportes?\b|\bdeportiv\w*|\bsports?\b|\bsport\b/;
const OTHER_SPORT = /\bnba\b|\bnfl\b|\bmlb\b|\bnhl\b|\bufc\b|\bwwe\b|\baew\b|\bf1\b|\bformula ?(?:1|uno|one)\b|\bmotor\w*|\bmoto ?gp\b|\bnascar\b|\bindy ?car\b|\btenis\b|\btennis\b|\bgolf\b|\bpga\b|\bboxeo\b|\bboxing\b|\bmma\b|\blucha libre\b|\bbaloncesto\b|\bbasket\w*|\bbeisbol\b|\bbaseball\b|\bhockey\b|\brugby\b|\bcricket\b|\bvoley\w*|\bvolley\w*|\bhandball\b|\bbalonmano\b|\bciclismo\b|\bcycling\b|\batletismo\b|\bwimbledon\b|\bjuegos olimpicos\b|\bolimpiadas?\b|\bolympics?\b/;

const THEMES = [
  ["v.kids", /\binfantil\w*|\bkids?\b|\bninos\b|\bchildren\b|\bcaricaturas?\b|\bcartoons?\b|\bdibujos\b|\bdisney\b|\bnick\w*|\bcartoon network\b/],
  ["v.news", /\bnoticias?\b|\bnews\b|\binformativ\w*|\bnoticiero\w*|\bcnn\b|\bbbc\b|\bntn ?24\b|\beuronews\b|\bfrance ?24\b|\btelesur\b/],
  ["v.music", /\bmusica\w*|\bmusic\b|\bradios?\b|\bconciertos?\b|\bconcerts?\b|\bkaraoke\b|\breggaeton\b|\bsalsa\b|\bvallenato\w*|\bcumbia\w*|\bbachata\b|\brock\b|\bhits\b/],
  ["v.docs", /\bdocumental\w*|\bdocumentar\w*|\bdocs?\b|\bcultur\w*|\beducaci\w*|\beducation\b|\bciencia\b|\bscience\b|\btecnolog\w*|\btechnology\b|\bnaturaleza\b|\bnature\b|\bhistoria\b|\bdiscovery\b|\bnat ?geo\b|\bnational geographic\b|\bhistory\b|\banimal planet\b/],
  ["v.faith", /\breligi\w*|\bcristian\w*|\bcatolic\w*|\bevangel\w*|\bfaith\b|\biglesia\w*/],
  ["v.anime", /\banime\b/],
  ["v.asia", /\bdoramas?\b|\bk ?dramas?\b|\bk ?pop\b|\basia\w*|\bcorea\w*|\bkorea\w*|\bjapon\w*|\bjapan\w*|\bchin[ao]s?\b/],
  ["v.247", /\b24 ?\/ ?7\b|\b24 7\b|\b24h\b/],
  ["v.novelas", /\btelenovelas?\b|\bnovelas?\b/],
  ["v.ent", /\bentretenimiento\b|\bentertainment\b|\bvariedad\w*|\brealit\w*|\bfashion\b|\bmoda\b|\blifestyle\b|\bestilo de vida\b|\bcocina\b|\bfood\b|\bviajes?\b|\btravel\b|\bcomedia\b|\bhumor\b/],
  ["v.movies", /\bcine\w*|\bpeliculas?\b|\bmovies?\b|\bfilms?\b|\bseries\b|\bcinema\b|\bestrenos?\b|\bhbo\b|\bcinemax\b|\bstar channel\b|\bwarner\b|\buniversal\b|\bparamount\b|\bsony\b|\brakuten\b|\brun ?time\b|\bamc\b|\baxn\b|\btcm\b|\bmgm\b|\bgolden\b|\bcinecanal\b|\bterror\b|\bhorror\b|\baccion\b|\baction\b|\bsuspenso\b|\bthrillers?\b|\bwestern\b|\bsitcoms?\b/],
];

/** The text a title is matched on: a `{ es, en }` title reads both. */
function titleText(t) {
  if (t && typeof t === "object") return [t.es, t.en].filter(Boolean).join(" ");
  return String(t == null ? "" : t);
}

const CACHE_MAX = 4000;
const cache = new Map();   // "src␁rawId␁title␁adult" → { v, cc }

/** The virtual category one raw category of `srcId` goes to by the rules (null: an unknown title). */
export function targetOf(srcId, cat) { return analyse(srcId, cat).v; }

/** At most this many raw categories of one secondary source in one category. */
const SEC_PER_TARGET = 6;
const singleCountrySports = (v) => { const e = BY_ID.get(v); return !!e && e.kind === "sports" && !!e.cc; };

/**
 * The raw categories of a secondary source that are kept (`cats` in its own order, read with its primary `primaryId`'s
 * rules), given the categories its primary feeds (`served`, a Set of virtual ids): those landing in a single-country
 * sports category the primary feeds, at most SEC_PER_TARGET per category. → `[{ cat, v, cc }]`.
 */
export function secondaryKept(primaryId, cats, served) {
  const per = new Map();
  const out = [];
  for (const cat of Array.isArray(cats) ? cats : []) {
    if (!cat || cat.id == null) continue;
    const { v, cc } = analyse(primaryId, cat);
    if (!singleCountrySports(v) || !served.has(v)) continue;
    const n = per.get(v) || 0;
    if (n >= SEC_PER_TARGET) continue;
    per.set(v, n + 1);
    out.push({ cat, v, cc });
  }
  return out;
}

function analyse(srcId, cat) {
  const raw = titleText(cat && cat.title);
  const key = srcId + "\u0001" + String(cat && cat.id) + "\u0001" + raw + "\u0001" + (cat && cat.adult ? 1 : 0);
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= CACHE_MAX) cache.clear();
  const out = rules(srcId, cat || {}, raw);
  cache.set(key, out);
  return out;
}

function rules(srcId, cat, raw) {
  const n0 = fold(raw).replace(/\s+/g, " ").trim();
  const cc = countryOf(srcId, raw, n0);
  const at = (v) => ({ v, cc });
  if (cat.adult === true || isAdultTitle(raw)) return at("v.adult");
  const o = OVERRIDES[srcId] && OVERRIDES[srcId][String(cat.id)];
  if (o) return at(o);
  if (srcId === "xuper" && cat.title && typeof cat.title === "object" && cat.title.en === "All channels") return at("v.all.xuper");
  if (EVENT_SOURCES.has(srcId)) return at("v.events");
  const n = n0.replace(/[^a-z0-9+&/ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (EVENTS.test(n) && !REPLAY.test(n)) return at("v.events");
  const football = FOOTBALL.test(n) || SPORT_BRANDS.test(n);
  const other = OTHER_SPORT.test(n);
  if (SPORT_SOURCES.has(srcId) || football || other || SPORT_GENERIC.test(n)) {
    if (cc && SPORT_CC.has(cc)) return at("v.sp." + cc);
    if (cc === "eu") return at("v.sp.eu");
    if (!cc && srcId === "supertv") return at("v.sp.world");
    if (!cc || LATAM_CC.has(cc)) return at(other && !football && !SPORT_GENERIC.test(n) ? "v.othersp" : "v.sports");
    return at("v.sp.world");
  }
  for (const [vid, re] of THEMES) if (re.test(n)) return at(vid);
  if (cc === "world" || cc === "eu") return at("v.intl");
  if (cc && COUNTRY_IDS.has(cc)) return at("v." + cc);
  return at(null);
}

// ── the mapping, the budget, the buckets ──

const localOf = (v) => (lang() === "en" ? v.en : v.es);

function rawTitle(t) {
  if (t && typeof t === "object") return String((lang() === "en" ? t.en : t.es) || t.es || t.en || "");
  return String(t == null ? "" : t);
}

/**
 * The hex of a raw category id: `<src>.<hex>` is its 1.0.45 id and its stored list's key (src/live.js `listKey`).
 * encodeURIComponent first, so a non-ASCII id needs neither btoa nor TextEncoder; only [0-9a-f] comes out, which Kino's
 * id pattern (no ":" or "%") accepts.
 */
export function hexEnc(s) {
  const a = encodeURIComponent(String(s == null ? "" : s));
  let h = "";
  for (let i = 0; i < a.length; i++) h += a.charCodeAt(i).toString(16).padStart(2, "0");
  return h;
}

/** Stable order of raw ids: numbers by value (xuper's columns grow), else text. */
function rawIdOrder(a, b) {
  const na = /^\d{1,15}$/.test(a), nb = /^\d{1,15}$/.test(b);
  if (na && nb) return Number(a) - Number(b);
  if (na !== nb) return na ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

const memberOf = (src, cat, cc) => {
  const m = { src, rawCat: String(cat.id) };
  if (cc) m.cc = cc;
  return m;
};

/**
 * `raw` = `[{ src, cat: {id, title, adult?, genre?} }]` in SOURCES order, then each source's own order.
 * `opts`: `srcName(id)` (a source's proper name, for buckets and title clashes), `knownEmpty(src, rawId)` (its stored
 * list is known to be empty, and that answer is still fresh: hidden while no member is code; ranked last),
 * `codeBacked(src, rawId)` (its list is code), `secondaryOf(src)` (a secondary source's primary id, else null).
 * → `{ list, all, byRaw, stats }`: `list` = the exposed entries in order (≤ MAX_EXPOSED, hidden ones left out), `all` =
 * every entry by id (hidden ones too: their ids still answer), `byRaw` = "src␁rawId" → exposed id.
 */
export function mapCategories(raw, opts) {
  const o = opts || {};
  const srcName = typeof o.srcName === "function" ? o.srcName : (s) => s;
  const knownEmpty = typeof o.knownEmpty === "function" ? o.knownEmpty : () => false;
  const codeBacked = typeof o.codeBacked === "function" ? o.codeBacked : () => false;
  const secondaryOf = typeof o.secondaryOf === "function" ? o.secondaryOf : () => null;
  const virt = new Map();          // virtual id → members
  const cands = [];                 // unmapped raw categories
  const srcOrder = [];
  const secondary = new Map();      // secondary source → [its raw categories], mapped once every primary member is known
  const seen = new Set();
  for (const r of Array.isArray(raw) ? raw : []) {
    if (!r || !r.cat || r.cat.id == null) continue;
    const rk = r.src + "\u0001" + String(r.cat.id);
    if (seen.has(rk)) continue;
    seen.add(rk);
    if (secondaryOf(r.src)) {
      if (!secondary.has(r.src)) secondary.set(r.src, []);
      secondary.get(r.src).push(r.cat);
      continue;
    }
    if (!srcOrder.includes(r.src)) srcOrder.push(r.src);
    const { v, cc } = analyse(r.src, r.cat);
    if (v) {
      if (!virt.has(v)) virt.set(v, []);
      virt.get(v).push(memberOf(r.src, r.cat, cc));
    } else {
      cands.push({ src: r.src, cat: r.cat, cc, i: cands.length });
    }
  }
  const sec = { kept: 0, dropped: 0 };
  for (const [src, cats] of secondary) {
    const primary = secondaryOf(src);
    const served = new Set([...virt].filter(([, ms]) => ms.some((m) => m.src === primary)).map(([v]) => v));
    const kept = secondaryKept(primary, cats, served);
    for (const k of kept) virt.get(k.v).push(memberOf(src, k.cat, k.cc));
    sec.kept += kept.length;
    sec.dropped += cats.length - kept.length;
  }
  // Whether a category is shown follows its own (non-secondary) members only: a secondary member is always beside one.
  const emptyAll = (members) => {
    const own = members.filter((m) => !secondaryOf(m.src));
    return (own.length ? own : members).every((m) => knownEmpty(m.src, m.rawCat)) && !members.some((m) => codeBacked(m.src, m.rawCat));
  };

  // Pass-through candidates: valid ids, ranked (known-empty last, then SOURCES order, then raw id), capped per source.
  const ranked = cands.slice().sort((a, b) => {
    const ea = knownEmpty(a.src, String(a.cat.id)) ? 1 : 0, eb = knownEmpty(b.src, String(b.cat.id)) ? 1 : 0;
    return ea - eb || srcOrder.indexOf(a.src) - srcOrder.indexOf(b.src) || rawIdOrder(String(a.cat.id), String(b.cat.id));
  });
  const passing = new Set();
  const perSrc = new Map();
  for (const c of ranked) {
    const id = c.src + "." + hexEnc(String(c.cat.id));
    const cap = PASS_CAP[c.src] != null ? PASS_CAP[c.src] : PASS_CAP_DEFAULT;
    const n = perSrc.get(c.src) || 0;
    if (!ID.test(id) || n >= cap) continue;
    perSrc.set(c.src, n + 1);
    passing.add(c);
  }
  const bucketSrcs = () => new Set(cands.filter((c) => !passing.has(c)).map((c) => c.src));
  const visibleVirt = () => [...virt.entries()].filter(([, ms]) => !emptyAll(ms)).length;
  const visiblePass = () => [...passing].filter((c) => !emptyAll([{ src: c.src, rawCat: String(c.cat.id) }])).length;
  // Fit: drop the last-ranked pass-through entries into their buckets while the total is over the ceiling.
  while (visibleVirt() + visiblePass() + bucketSrcs().size > MAX_EXPOSED && passing.size) {
    let last = null;
    for (const c of ranked) if (passing.has(c)) last = c;
    passing.delete(last);
  }

  const all = new Map();
  const byRaw = new Map();
  const entries = [];
  const add = (e) => { all.set(e.id, e); for (const m of e.members) byRaw.set(m.src + "\u0001" + m.rawCat, e.id); entries.push(e); };
  const virtualEntry = (v, members) => {
    const e = { id: v.id, title: localOf(v), kind: v.kind, merge: v.merge, cc: v.kind === "country" || v.kind === "sports" ? (v.cc || null) : null, src: "v", members, genre: v.genre };
    if (v.country) e.country = v.country;
    if (v.adult) e.adult = true;
    if (emptyAll(members)) e.hidden = true;
    return e;
  };
  for (const v of VIRTUAL) if (virt.has(v.id)) add(virtualEntry(v, virt.get(v.id)));
  // pass-through, in the sources' own order
  const titles = new Set(entries.filter((e) => !e.hidden).map((e) => fold(e.title)));
  for (const c of cands) {
    if (!passing.has(c)) continue;
    const id = c.src + "." + hexEnc(String(c.cat.id));
    let title = rawTitle(c.cat.title) || String(c.cat.id);
    if (titles.has(fold(title))) title = title + " · " + srcName(c.src);
    const e = { id, title, kind: "pass", merge: true, cc: null, src: c.src, members: [memberOf(c.src, c.cat, c.cc)] };
    if (typeof c.cat.genre === "string" && c.cat.genre) e.genre = c.cat.genre;
    if (emptyAll(e.members)) e.hidden = true;
    titles.add(fold(title));
    add(e);
  }
  for (const s of srcOrder) {
    const members = cands.filter((c) => c.src === s && !passing.has(c)).map((c) => memberOf(c.src, c.cat, c.cc));
    if (!members.length) continue;
    const name = srcName(s);
    const e = { id: "v.more." + s, title: lang() === "en" ? "More channels · " + name : "Más canales · " + name, kind: "bucket", merge: false, cc: null, src: s, members, genre: "otros" };
    if (emptyAll(members)) e.hidden = true;
    add(e);
  }
  if (virt.has("v.adult")) add(virtualEntry(ADULT_ENTRY, virt.get("v.adult")));
  const list = entries.filter((e) => !e.hidden);
  const stats = { exposed: list.length, virtual: list.filter((e) => BY_ID.has(e.id)).length, passed: list.filter((e) => e.kind === "pass").length,
    buckets: list.filter((e) => e.kind === "bucket").map((e) => e.src + " " + e.members.length), secondary: sec };
  return { list, all, byRaw, stats };
}
