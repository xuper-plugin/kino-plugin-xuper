// The title page of the browse screen (route "detail"): a banner with the title's logo, the facts, the synopsis, the cast and the
// seasons with their episodes. A card, a slide or a result opens it through the item's `open` (the screen starts again with
// `args.open` and `open` answers `route.push`, so Back returns to the list). Kino's own page stays one press away ("Ver episodios"
// for a series, "Más opciones" for a movie): favourites, lists, downloads and the player's sources live there, and an episode opens
// it too, because a plugin screen cannot play a single episode by itself. Xuper's refs carry no TMDB id, so the page asks Kino for
// the title by its name (and year); a title Kino cannot match shows a retry and "Ver en Kino". Pure view of what browse.js keeps.
import { twin } from "./i18n.js";

const HTTPS = /^https:\/\//;
const MAX_EPISODES = 80;
const MAX_CAST = 12;
const LEAD_MAX = 140;

const same = (text) => ({ text, textEn: text });
const num = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
const https = (v) => (typeof v === "string" && HTTPS.test(v) && v.length <= 2048 ? v : undefined);

const opensPage = (card) => !!card && (card.kind === "movie" || card.kind === "series") && typeof card.ref === "string" && card.ref.length < 600 && typeof card.id === "string";

/** What the page needs of a card: its ref and id (Kino's page and the play go carry them back), its name, kind and year. */
export function openArgs(card) {
  const year = card.year ? num(card.year) : 0;
  return { open: card.ref, i: card.id, t: String(card.title || "").slice(0, 100), k: card.kind, ...(year ? { y: year } : {}) };
}

/** One poster card; a movie or a series opens its page through the screen's own `openTitle` event (the card's tap), anything else keeps Kino's page. */
export const cardNode = (card, size, scope) => ({
  type: "titleCard", key: `${scope}-${card.id}`, size, item: card,
  ...(opensPage(card) ? { onTap: { event: "openTitle", arg: JSON.stringify(openArgs(card)) } } : {}),
});

/** A horizontal row of poster cards under [key]. */
export const cardRow = (items, key, size) => ({ type: "SingleChildScrollView", key: key + "-s", direction: "horizontal", children: [{ type: "Row", key: key + "-r", gap: 12, children: items.map((c) => cardNode(c, size, key)) }] });

/** A grid of poster cards. */
export const cardGrid = (items, key) => ({ type: "GridView", key, columns: { compact: 3, expanded: 6 }, children: items.map((c) => cardNode(c, "medium", key)) });

/** The route push an `openTitle` event's arg asks for, or null. */
export function pushOf(arg) {
  let a = null;
  try { a = JSON.parse(String(arg)); } catch (_) { a = null; }
  if (!a || typeof a.open !== "string" || typeof a.i !== "string" || (a.k !== "movie" && a.k !== "series")) return null;
  return { push: "detail", params: { open: a.open, i: a.i, t: typeof a.t === "string" ? a.t.slice(0, 100) : "", k: a.k, y: Number(a.y) || 0 } };
}

const hoursOf = (min) => {
  const m = num(min);
  return m > 0 ? (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`) : "";
};

const MONTHS = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};
const dateText = (iso) => {
  const [y, m, d] = String(iso).split("-").map(Number);
  return m >= 1 && m <= 12 ? { es: `${d} ${MONTHS.es[m - 1]} ${y}`, en: `${MONTHS.en[m - 1]} ${d}, ${y}` } : { es: iso, en: iso };
};

/** What the page shows for [args] (`{ t: title, k: kind, y: year }`): Kino's own answer for the title by its name. Throws when Kino knows nothing about it. */
export async function loadDetail(args) {
  const kind = args.k === "movie" ? "movie" : "series";
  const year = Number(args.y) || 0;
  let meta = null;
  if (typeof kino.meta === "function" && kino.meta.byTitle === true && args.t) {
    meta = await kino.meta({ type: kind, title: String(args.t), ...(year >= 1870 && year <= 2100 ? { year } : {}) }).catch(() => null);
  }
  if (!meta) throw Object.assign(new Error("no meta"), { code: "not_found" });
  const d = {
    kind,
    title: String(meta.title || args.t || "").slice(0, 200),
    overview: String(meta.overview || ""),
    year: num(meta.year),
    backdrop: https(meta.backdrop) || https(meta.poster),
    logo: https(meta.logo),
    genres: (meta.genres || []).filter((g) => typeof g === "string").slice(0, 4),
    runtime: num(meta.runtimeMinutes),
    tagline: String(meta.tagline || ""),
    certification: String(meta.certification || ""),
    directors: (meta.directors || []).slice(0, 3),
    ratings: (meta.ratings || []).slice(0, 3),
    cast: (meta.cast || []).slice(0, MAX_CAST),
    episodes: [],
  };
  if (kind === "series") {
    d.episodes = (Array.isArray(meta.episodes) ? meta.episodes : [])
      .filter((e) => num(e.season) >= 1 && num(e.number) >= 1)
      .slice(0, 600)
      .map((e) => ({ s: num(e.season), n: num(e.number), title: String(e.title || "").slice(0, 120), overview: String(e.overview || "").slice(0, 110), still: https(e.still), air: /^\d{4}-\d{2}-\d{2}/.test(String(e.airDate || "")) ? String(e.airDate).slice(0, 10) : "" }));
  }
  return d;
}

const heroSkeleton = () => ({ type: "Skeleton", key: "heroSkeleton", shape: "block", height: { compact: 200, expanded: 320 } });
const railSkeleton = () => ({
  type: "Column", key: "dskel1", gap: 8, children: [
    { type: "Skeleton", shape: "line", width: 120 },
    { type: "Row", gap: 12, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `dsk${i}`, flex: 1 })) },
  ],
});

const sectionTitle = (key) => ({ type: "Text", ...twin(key), style: "h4" });

/** The tap on an episode: Kino's page of the series (this plugin's own, with its sources). */
const episodeGo = (d, r) => ({ go: { title: { ref: r.ref, kind: "series", id: r.id, title: d.title } } });

function episodeRow(d, r, ep) {
  const facts = ep.air ? dateText(ep.air) : null;
  const heading = ep.title ? { text: `${ep.n}. ${ep.title}`, textEn: `${ep.n}. ${ep.title}` } : twin("dEpisodeN", "text", { n: ep.n });
  return {
    type: "Row", key: `ep-${ep.s}-${ep.n}`, gap: 12, crossAxisAlignment: "center", onTap: episodeGo(d, r), canRequestFocus: true,
    children: [
      { type: "Image", key: `epi-${ep.s}-${ep.n}`, width: 120, aspect: "16:9", fit: "cover", ...(ep.still ? { url: ep.still } : {}), fallback: { type: "Skeleton", shape: "block", height: 64 } },
      { type: "Column", flex: 1, gap: 4, children: [
        { type: "Text", bold: true, maxLines: 2, ...heading },
        ...(facts ? [{ type: "Text", style: "caption", color: "muted", text: facts.es, textEn: facts.en }] : []),
        ...(ep.overview ? [{ type: "Text", style: "caption", color: "muted", maxLines: 2, ...same(ep.overview) }] : []),
      ] },
    ],
  };
}

function castItem(c) {
  const name = String(c.name || "").slice(0, 60);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return {
    type: "Column", key: "cast-" + name.replace(/[^A-Za-z0-9]/g, "").slice(0, 24) + "-" + String(c.character || "").length, width: 96, gap: 4, crossAxisAlignment: "center", canRequestFocus: true, children: [
      { type: "CircleAvatar", radius: 32, ...(https(c.photo) ? { image: https(c.photo) } : {}), text: initials, textEn: initials },
      { type: "Text", ...same(name), style: "caption", maxLines: 2 },
      ...(c.character ? [{ type: "Text", ...same(String(c.character).slice(0, 40)), style: "caption", color: "muted", maxLines: 1 }] : []),
    ],
  };
}

/**
 * The tree of the title route. `r`: `{ ref, id }` of the page's title; `entry`: `{ d }` loaded (d null: it failed) or null while it
 * loads; `season`: the chosen season (0 = the first); `back`/`logo`: the screen's own back button and logo nodes.
 */
export function detailView({ r, entry, season, logo, back }) {
  const d = entry && entry.d;
  const appBar = { type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false, leading: back, title: logo };
  const body = [];
  let hero = null; // the banner goes edge to edge: outside the padded column
  if (!entry) {
    hero = heroSkeleton();
    body.push(railSkeleton());
  } else if (!d) {
    body.push({ type: "MaterialBanner", key: "detailFailed", role: "error", ...twin("dFailed"), action: { ...twin("brRetry", "label"), onTap: "dretry" } });
    body.push({ type: "ElevatedButton", key: "dkino", icon: "play", ...twin("dSeeInKino", "labelText"), onPressed: { go: { title: { ref: r.ref, kind: r.kind, id: r.id, title: r.title } } } });
  } else {
    const series = d.kind === "series";
    const seasons = [...new Set(d.episodes.map((e) => e.s))].sort((a, b) => a - b);
    const shown = seasons.includes(season) ? season : seasons[0];
    const toKino = { go: { title: { ref: r.ref, kind: d.kind, id: r.id, title: r.title || d.title } } };
    const buttons = series
      ? [{ type: "ElevatedButton", key: "dplay", ...twin("dSeriesGo", "labelText"), icon: "play", autofocus: true, onPressed: toKino }]
      : [
        { type: "ElevatedButton", key: "dplay", ...twin("brWatch", "labelText"), icon: "play", autofocus: true, onPressed: { go: { play: { ref: r.ref, kind: "movie", id: r.id, title: d.title } } } },
        { type: "TextButton", key: "dmore", ...twin("dMore", "labelText"), onPressed: toKino },
      ];
    const lead = d.tagline || (d.overview.length <= LEAD_MAX ? d.overview : d.overview.slice(0, LEAD_MAX - 1).trimEnd() + "…");
    hero = ({
      type: "heroCard", key: "dhero", h: { compact: 240, expanded: 320 }, title: d.title, titleEn: d.title, ...(lead ? same(lead) : {}),
      ...(d.backdrop ? { image: d.backdrop } : {}), ...(d.logo ? { logo: d.logo } : {}), buttons,
    });
    const rating = d.ratings.find((x) => x.source === "imdb") || d.ratings.find((x) => x.source === "tmdb");
    const facts = [];
    if (rating) facts.push("★ " + rating.value);
    if (d.year) facts.push(String(d.year));
    if (d.certification) facts.push(d.certification);
    if (d.runtime) facts.push(hoursOf(d.runtime));
    const seasonsText = series && seasons.length ? twin("dSeasonsN", "t", { n: seasons.length }) : null;
    const es = facts.concat(seasonsText ? [seasonsText.t] : []);
    const en = facts.concat(seasonsText ? [seasonsText.tEn] : []);
    if (es.length) body.push({ type: "Text", key: "dfacts", style: "h4", text: es.join("  ·  "), textEn: en.join("  ·  ") });
    if (d.genres.length) body.push({ type: "Row", key: "dgenres", gap: 8, children: d.genres.map((g, i) => ({ type: "Badge", key: "dg-" + i, ...same(g) })) });
    if (d.overview) body.push({ type: "Text", key: "dsynopsis", canRequestFocus: true, ...same(d.overview) });
    if (d.directors.length) body.push({ type: "Text", ...twin(series ? "dCreators" : "dDirector", "text", { v: d.directors.join(", ") }), color: "muted" });
    if (d.cast.length) {
      body.push(sectionTitle("dCast"));
      body.push({ type: "SingleChildScrollView", key: "dcast", direction: "horizontal", children: [{ type: "Row", gap: 12, children: d.cast.map(castItem) }] });
    }
    if (series && seasons.length) {
      body.push(seasons.length > 1
        ? { type: "DropdownButton", key: "dseason", value: String(shown), onChanged: "season", options: seasons.map((s) => ({ value: String(s), ...twin("dSeasonN", "label", { n: s }) })) }
        : sectionTitle("dEpisodes"));
      for (const ep of d.episodes.filter((e) => e.s === shown).slice(0, MAX_EPISODES)) body.push(episodeRow(d, r, ep));
    }
  }
  return {
    type: "Scaffold", appBar,
    body: { type: "SingleChildScrollView", key: "detail-page", children: [...(hero ? [hero] : []), { type: "Column", padding: { compact: 12, expanded: 24 }, gap: 16, children: body }] },
    ...(!entry ? { every: { ms: 1000, event: "dtick" } } : {}),
  };
}
