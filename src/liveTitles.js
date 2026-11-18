// liveTitles.js — the title a live channel is shown with, without the decorations IPTV panels write around a name
// (pure: no storage, no network). A decoration is
//   - a region or group tag wrapped in bars, anywhere ("┃ES┃ M+ DEPORTES", "|MX| ESPN", "│UK│ SKY SPORTS", "ESPN ┃MX┃");
//   - a tag before a bar at the start ("ES ▎DAZN 1 FHD", "MULTI  ▎ VIAPLAY", "BEIN ▎BEIN SPORTS 1", "4K ▎…") or a
//     region code after one at the end ("ESPN | MX");
//   - a region code before ":", "•" or " - " at the start ("UK: SKY SPORTS", "ES - DAZN 1", "CO • Caracol");
//   - a region code or a tag in brackets ("[ES] DAZN 1", "SBT (BR)", "ZIGGO SPORT HD [NL]", "UFC (EE.UU.)",
//     "RT Noticias (HD)", "Telemundo (Internacional)[1080p]").
// A real name is never touched: a code that is part of a name ("UK Gold", "MX Prime", "ESPN CO", "FOX HN"), a name
// with a number ("TV3", "A3", "Canal 13", "24 Horas"), a quality word inside the name ("DAZN 1 FHD"), a word in brackets
// that is no code or tag ("(Internacional)", "[No 24/7]", "[EN]", "(SUB)"), a country written out ("(México)"), a bar
// between two names ("DANIEL RICCIARDO | RB"). A plain "|" or "!" counts only around a known code or tag; the panels'
// own bars ("┃", "▎", "│"…) around any short upper-case tag. A title with nothing left keeps its stored form.
//
// Countries (`cc`: the list's single country, src/liveMap.js, or null for a mixed list): a tag of the list's own
// country, or a neutral one (LATAM, UEFA), simply goes. In a single-country list another country's tag stays: a lead
// tag as " · <country>", a bracketed one as written. In a mixed list every country tag goes, and only where that makes
// two titles of the list look the same (case, accents and spaces aside) do they come back, a step at a time and only
// for those: a lead tag as " · México" (" · Mexico" in English), then a bracketed one as written ("FOX Sports 2 (USA)";
// "[NL]" / "[FR]" on Belgian DAZN and "(ES)" on FIFA+ are languages, so they are never turned into a country name),
// then the copy markers the list had dropped (src/liveMerge.js), then the title as stored.
//
// Ids and refs never change here: Kino finds a saved channel by its id and (normalised) name, else by its ref (the same
// plugin and raw ref), else by its name, and plays a saved favourite from its own ref when no listing holds it.

const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// The panels' own bars (any short upper-case tag between or before them is a decoration) and the plain ones (only
// around a known code or tag: "ESPN | Fútbol" stays).
const STRONG = "┃│▎▍▌▏▐▕‖╎┆┊║❘❙❚";
const WEAK = "|¦｜";
const BARS = STRONG + WEAK;

// Region codes as written in a tag (upper case: "(It)" or "(Do)" are words), each with its ISO country. "latam" and
// "eu" are neutral (never named). "ar" is Arabic on supertv's panels and "ca" Central America on Latin American lists:
// they go, but are never named.
const CODES = {
  co: "co", col: "co", mx: "mx", mex: "mx", pe: "pe", cl: "cl", ec: "ec", ecu: "ec", ve: "ve", ven: "ve", bo: "bo", bol: "bo",
  py: "py", uy: "uy", uru: "uy", cr: "cr", pa: "pa", pan: "pa", ni: "ni", nic: "ni", hn: "hn", gt: "gt", gua: "gt", sv: "sv",
  do: "do", rd: "do", pr: "pr", cu: "cu", us: "us", usa: "us", eeuu: "us", es: "es", esp: "es", br: "br", bra: "br", pt: "pt",
  it: "it", ita: "it", fr: "fr", fra: "fr", de: "de", ger: "de", nl: "nl", uk: "gb", gb: "gb", ar: "ar", arg: "ar", ca: "ca",
  can: "ca", be: "be", ch: "ch", at: "at", pl: "pl", tr: "tr", gr: "gr", ru: "ru", se: "se", dk: "dk", no: "no", fi: "fi",
  ie: "ie", au: "au", hr: "hr", rs: "rs", sr: "rs", srb: "rs", si: "si", sl: "si", ba: "ba", bih: "ba", bg: "bg", al: "al", mk: "mk", ro: "ro",
  hu: "hu", cz: "cz", sk: "sk",
  lat: "latam", latam: "latam", latino: "latam", latin: "latam", ucl: "eu", uefa: "eu", eu: "eu",
};
const NEUTRAL = new Set(["latam", "eu"]);
const UNNAMED = new Set(["ar", "ca"]);
// Tags that say nothing about the channel: quality in brackets (any case: "(Auto)", "[1080p]") and the panels' groups.
const QUALITY = new Set(["hd", "sd", "fhd", "uhd", "4k", "8k", "hq", "lq", "2160p", "1080p", "720p", "480p", "auto", "hevc", "h265"]);
const GROUPS = new Set(["multi", "vip", "ppv", "f1"]);
// Upper-case words a panel bar may follow that name a channel, not a group.
const NOT_TAGS = new Set(["tv"]);

const COUNTRY_NAMES = {
  co: ["Colombia", "Colombia"], mx: ["México", "Mexico"], pe: ["Perú", "Peru"], cl: ["Chile", "Chile"], ec: ["Ecuador", "Ecuador"],
  ve: ["Venezuela", "Venezuela"], bo: ["Bolivia", "Bolivia"], py: ["Paraguay", "Paraguay"], uy: ["Uruguay", "Uruguay"],
  cr: ["Costa Rica", "Costa Rica"], pa: ["Panamá", "Panama"], ni: ["Nicaragua", "Nicaragua"], hn: ["Honduras", "Honduras"],
  gt: ["Guatemala", "Guatemala"], sv: ["El Salvador", "El Salvador"], do: ["República Dominicana", "Dominican Republic"],
  pr: ["Puerto Rico", "Puerto Rico"], cu: ["Cuba", "Cuba"], us: ["Estados Unidos", "United States"], es: ["España", "Spain"],
  br: ["Brasil", "Brazil"], pt: ["Portugal", "Portugal"], it: ["Italia", "Italy"], fr: ["Francia", "France"],
  de: ["Alemania", "Germany"], nl: ["Países Bajos", "Netherlands"], gb: ["Reino Unido", "United Kingdom"],
  be: ["Bélgica", "Belgium"], ch: ["Suiza", "Switzerland"], at: ["Austria", "Austria"], pl: ["Polonia", "Poland"],
  tr: ["Turquía", "Turkey"], gr: ["Grecia", "Greece"], ru: ["Rusia", "Russia"], se: ["Suecia", "Sweden"],
  dk: ["Dinamarca", "Denmark"], no: ["Noruega", "Norway"], fi: ["Finlandia", "Finland"], ie: ["Irlanda", "Ireland"],
  au: ["Australia", "Australia"], hr: ["Croacia", "Croatia"], rs: ["Serbia", "Serbia"], si: ["Eslovenia", "Slovenia"],
  ba: ["Bosnia", "Bosnia"], bg: ["Bulgaria", "Bulgaria"], al: ["Albania", "Albania"], mk: ["Macedonia del Norte", "North Macedonia"],
  ro: ["Rumania", "Romania"], hu: ["Hungría", "Hungary"], cz: ["Chequia", "Czechia"], sk: ["Eslovaquia", "Slovakia"],
};

/**
 * What a tag is: `{ iso }` (a region code: ISO country, "latam" or "eu"), `{ tag: true }` (quality or group), or null
 * (no decoration). `strong`: it sits at a panel bar, where any upper-case word of 2–6 letters is a group ("BEIN",
 * "UEFA", "EXYU", "MGP").
 */
function tagOf(token, strong) {
  const raw = String(token || "").trim();
  const k = raw.toLowerCase().replace(/[.\s]/g, "");
  if (!k) return null;
  if (QUALITY.has(k)) return { tag: true };
  if (/[a-z]/.test(raw)) return null;   // codes and groups are written in upper case
  if (CODES[k]) return { iso: CODES[k] };
  if (GROUPS.has(k)) return { tag: true };
  if (strong && /^[A-Z]{2,6}$/.test(raw) && !NOT_TAGS.has(k)) return { tag: true };
  return null;
}

// For a class of a "u" pattern. It turns a "-" into "\-", which Kino's QuickJS refuses (see MAYBE): BARS never holds one.
const esc = (s) => s.replace(/[\\\]^-]/g, "\\$&");
const B = "[" + esc(BARS) + "]";
const TOK = "([A-Za-z0-9][A-Za-z0-9.+&]{0,7})";
// "┃ES┃", "|MX|", "!ES!" anywhere (a plain or "!" bar only around a known code or tag).
const WRAPPED = new RegExp("(" + B + "|!)\\s*" + TOK + "\\s*(" + B + "|!)", "gu");
// A tag before a bar at the start: "ES ▎…", "[ES] ▎…", "MULTI  ▎ …".
const LEAD_BAR = new RegExp("^\\s*[[(]?\\s*" + TOK + "\\s*[\\])]?\\s*(" + B + ")\\s*(?=\\S)", "u");
// A tag wrapped in bars at the start ("┃ES┃ ES: M+ DEPORTES", "┃ES┃ MULTI ▎ VIAPLAY"): taken inside the lead loop, so a
// lead tag after it goes too.
const LEAD_WRAPPED = new RegExp("^\\s*(" + B + "|!)\\s*" + TOK + "\\s*(" + B + "|!)\\s*(?=\\S)", "u");
// What follows a bar that opens a wrapped tag ("ESPN ┃MX┃": "MX┃"): that bar is no lead separator for a word that is not
// a known code or tag.
const OPENS_WRAP = new RegExp("^[A-Za-z0-9][A-Za-z0-9.+&]{0,7}\\s*(?:" + B + "|!)", "u");
// A code before ":", "•", "·" or a spaced dash at the start: "UK: …", "CO • …", "ES - …".
const LEAD_MARK = /^\s*([A-Z][A-Z.]{1,5})\s*(?:[:•·]\s*|\s[-–—]\s+)(?=\S)/u;
// A bracketed tag at the start: "[ES] …", "(MX) - …".
const LEAD_BRACKET = new RegExp("^\\s*[[(]\\s*([A-Za-z][A-Za-z. ]{1,6}?)\\s*[\\])]\\s*(?:(?:" + B + "|[:•·]|[-–—](?=\\s))\\s*)?(?=\\S)", "u");
// A code after a bar at the end: "ESPN | MX", "ESPN ▎MX".
const TRAIL_BAR = new RegExp("\\s*(" + B + ")\\s*([A-Z][A-Z.]{1,5})\\s*(?:" + B + ")?\\s*$", "u");
// A bracketed code or tag anywhere: "(BR)", "[NL]", "(EE.UU.)", "(HD)", "[1080p]".
const BRACKETED = /\s*[[(]\s*([A-Za-z0-9][A-Za-z0-9. ]{0,6}?)\s*[\])]/gu;
// What a removed tag leaves at an edge: a bar, or a dash, dot or colon standing apart ("ESPN - (MX)" → "ESPN"; never
// the "-" of "-Clasicos-" or the ":" of an empty slot "PREMIER LEAGUE 03:").
const EDGE_START = new RegExp("^\\s*(?:" + B + "\\s*|[-–—•·:]\\s+)+", "u");
const EDGE_END = new RegExp("(?:\\s*" + B + "|\\s+[-–—•·])+\\s*$", "u");

// A title with none of these has no decoration (most lists): it is never parsed. The "-" goes last and unescaped: Kino's
// QuickJS (bellard 2024-02-14) refuses "\-" inside a class of a "u" pattern ("invalid escape sequence in regular
// expression") although Node accepts it, and the whole plugin would then fail to load (test/liveTitles.test.mjs checks it).
const MAYBE = new RegExp("[" + esc(BARS) + "!\\[(:•·–—-]", "u");

const CACHE_MAX = 20000;
const cache = new Map();

/**
 * One title without its decorations → `{ text, lead }`: `lead` = the country of a lead or bar tag that went and may
 * come back as a suffix (null: none, the list's own, neutral or unnamed). `brackets` false: bracketed codes and tags
 * stay as written. In a single-country list (`cc`) another country's bracketed code always stays. `text` is the title
 * as given when nothing usable would be left.
 */
function strip(title, cc, brackets) {
  if (!MAYBE.test(title)) return { text: title, lead: null };
  const ck = (cc || "") + (brackets ? "\u0001" : "\u0002") + title;
  const hit = cache.get(ck);
  if (hit) return hit;
  if (cache.size >= CACHE_MAX) cache.clear();
  const out = parse(title, cc, brackets);
  cache.set(ck, out);
  return out;
}

function parse(title, cc, brackets) {
  let s = String(title);
  let lead = null, changed = false;
  // A lead or bar tag goes; another country than the list's own (not neutral, not unnamed) may come back as a suffix.
  const went = (t) => {
    if (t.iso && t.iso !== cc && !NEUTRAL.has(t.iso) && !UNNAMED.has(t.iso) && !lead) lead = t.iso;
    changed = true;
  };
  const strongBar = (b) => STRONG.includes(b);
  for (let i = 0; i < 4; i++) {
    const before = s;
    let m = LEAD_WRAPPED.exec(s);
    let t = m && tagOf(m[2], strongBar(m[1]) && strongBar(m[3]));
    if (t) { went(t); s = s.slice(m[0].length); }
    m = LEAD_BAR.exec(s);
    const rest = m ? s.slice(m[0].length) : "";
    // An unknown word before a panel bar is a group only when a name follows it: in "ESPN ▎MX", "TUDN ▎MX" or
    // "DAZN ▎ 2" the word is the name and what follows is a code or a number.
    t = m && (tagOf(m[1], false) ||
      (!OPENS_WRAP.test(rest) && /\p{L}{2}/u.test(rest) && !tagOf(rest, false) && tagOf(m[1], strongBar(m[2]))));
    if (t) { went(t); s = rest; }
    m = LEAD_BRACKET.exec(s);
    t = m && tagOf(m[1], false);
    if (t) { went(t); s = s.slice(m[0].length); }
    m = LEAD_MARK.exec(s);
    t = m && tagOf(m[1], false);
    if (t && t.iso) { went(t); s = s.slice(m[0].length); }
    if (s === before) break;
  }
  s = s.replace(WRAPPED, (all, b1, tok, b2) => {
    const t = tagOf(tok, strongBar(b1) && strongBar(b2));
    if (!t) return all;
    went(t);
    return " ";
  });
  const tm = TRAIL_BAR.exec(s);
  const tt = tm && tm.index > 0 && tagOf(tm[2], false);
  if (tt && tt.iso) { went(tt); s = s.slice(0, tm.index); }
  if (brackets) {
    s = s.replace(BRACKETED, (all, tok) => {
      const t = tagOf(tok, false);
      // another country's code in a single-country list says something: it stays
      if (!t || (t.iso && cc && t.iso !== cc && !NEUTRAL.has(t.iso))) return all;
      changed = true;
      return " ";
    });
  }
  if (!changed) return { text: String(title), lead: null };
  s = s.replace(/\s+/g, " ").replace(EDGE_START, "").replace(EDGE_END, "").trim();
  if (!/[\p{L}\p{N}]/u.test(s)) return { text: String(title), lead: null };
  return { text: s, lead };
}

/** " · <country>" in the visible language. */
const suffix = (iso, en) => " · " + COUNTRY_NAMES[iso][en ? 1 : 0];

/** A stripped title and, when its lead country can be named, the same with " · <country>". */
function forms(b, o, brackets) {
  const r = strip(b, o.cc, brackets);
  return { text: r.text, named: r.lead && COUNTRY_NAMES[r.lead] ? r.text + suffix(r.lead, o.en) : "" };
}

/** The title an item is shown with while no other item of its list looks the same (`candidates`' first). */
function head(title, o) {
  const f = forms(o.copies ? o.copies(title) : title, o, true);
  return o.cc && f.named ? f.named : f.text;
}

/**
 * The titles one title may be shown with, best first: decorations off (and copy markers off, `o.copies`), a lead
 * country back as " · <country>", bracketed tags as written, then the same with the copy markers, then the stored
 * title. In a single-country list another country's lead tag always shows.
 */
function candidates(title, o) {
  const out = [];
  const add = (t) => { if (t && !out.includes(t)) out.push(t); };
  for (const b of o.copies ? [o.copies(title), title] : [title]) {
    for (const brackets of [true, false]) {
      const f = forms(b, o, brackets);
      if (!(o.cc && f.named)) add(f.text);
      add(f.named);
    }
  }
  add(title);
  return out;
}

/** How two shown titles compare: case, accents and spaces aside. */
const sameKey = (t) => (/^[\x20-\x7e]*$/.test(t) ? t.toLowerCase() : fold(t)).replace(/\s+/g, " ").trim();

/**
 * One list's items (one category's whole composed list) with the titles they are shown with (see the header): an item
 * whose shown title differs from its stored one is a copy with only `title` changed (id, ref and the rest as they are).
 * `opts`: `cc` (the list's single country or null), `en` (English country names), `copies` (a function: the title
 * without copy markers, for a list that drops them while no two channels would then look the same).
 */
export function shownTitles(items, opts) {
  const o = { cc: (opts && opts.cc) || null, en: !!(opts && opts.en), copies: opts && typeof opts.copies === "function" ? opts.copies : null };
  const list = Array.isArray(items) ? items : [];
  const titles = list.map((c) => String(c && c.title != null ? c.title : ""));
  const first = titles.map((t) => head(t, o));
  const cands = list.map(() => null);
  const level = list.map(() => 0);
  const shownOf = (i) => (cands[i] ? cands[i][level[i]] : first[i]);
  const keys = first.map(sameKey);
  const stored = titles.map(sameKey);
  // Each round moves every item that still looks like another one step back (see the header); an item at its stored
  // title stays. Items stored alike ("AL ▎SUPER SPORT 7 HD" twice) are told apart by no step: they only move while an
  // item stored otherwise looks the same, else every copy would end with its decorations back. A few rounds at most:
  // an item has at most nine forms.
  for (let round = 0; round < 10; round++) {
    const n = new Map();   // shown key → the stored keys shown with it
    for (let i = 0; i < keys.length; i++) {
      let g = n.get(keys[i]);
      if (!g) n.set(keys[i], (g = new Set()));
      g.add(stored[i]);
    }
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      if (n.get(keys[i]).size < 2) continue;
      if (!cands[i]) cands[i] = candidates(titles[i], o);
      if (level[i] < cands[i].length - 1) { level[i]++; keys[i] = sameKey(shownOf(i)); moved = true; }
    }
    if (!moved) break;
  }
  return list.map((c, i) => {
    const t = shownOf(i);
    return t === titles[i] ? c : { ...c, title: t };
  });
}
