// Turns the four Magis VOD roots into the home's rows, grouped by our own type x genre instead of
// the portal's sections. Port of the native MagisHomeClassifier (native-magis.md §4.1).
//
// Input:  { peliculas|series|anime|infantil: [{ name, items: [Item] }] }
// Item:   { id, title, poster, backdrop, durationS, type, genres[], score|null, description, shelvedAtMs }
// Output: [{ id, title, shown (first 20), all }]

export const KINDS = [
  { root: "peliculas", label: "Películas" },
  { root: "series", label: "Series" },
  { root: "anime", label: "Anime" },
  { root: "infantil", label: "Infantil" },
];
const byRoot = Object.fromEntries(KINDS.map((k) => [k.root, k]));

export const MIN_GENRE_SIZE = 6;
export const MAX_ROW_SIZE = 20;
const TRAILER = "trailer";

// When a title is in several roots, the most specific one wins.
const PRECEDENCE = ["anime", "infantil", "series", "peliculas"];
// Kinds that get "mejor valoradas" rows (and the recent/release rows from their year sections).
const FEATURED = ["peliculas", "series"];

// Portal tag -> [key for the row id, Spanish label]. Any tag not here is ignored.
const GENRES = new Map(Object.entries({
  "Action": ["action", "Acción"], "Adventure": ["adventure", "Aventura"], "Comedy": ["comedy", "Comedia"],
  "Drama": ["drama", "Drama"], "Thriller": ["thriller", "Suspenso"], "Crime": ["crime", "Crimen"],
  "Sci-Fi": ["scifi", "Ciencia ficción"], "Fantasy": ["fantasy", "Fantasía"], "Romance": ["romance", "Romance"],
  "Mystery": ["mystery", "Misterio"], "Horror": ["horror", "Terror"], "Family": ["family", "Familia"],
  "Biography": ["biography", "Biografía"], "History": ["history", "Historia"],
  "Documentary": ["documentary", "Documental"], "Western": ["western", "Western"], "War": ["war", "Guerra"],
  "Reality-TV": ["reality", "Reality"], "Sport": ["sport", "Deportes"], "Music": ["music", "Música"],
  "Musical": ["music", "Música"],
}));

// A section named after a year, optionally followed by more words ("2026 Peliculas teatrales").
const YEAR_SECTION = /^(\d{4})(.*)$/;
const FEATURED_PREFIXES = ["magis_recent_", "magis_new_", "magis_top_"];

export const isFeatured = (rowId) => FEATURED_PREFIXES.some((p) => rowId.startsWith(p));

/** The root a classified row belongs to, read from its id (`magis_top_series`, `magis_g_anime_drama`); null for any other id. */
export function rootOfRow(rowId) {
  if (typeof rowId !== "string") return null;
  const prefix = [...FEATURED_PREFIXES, "magis_g_"].find((p) => rowId.startsWith(p));
  if (prefix === undefined) return null;
  const rest = rowId.slice(prefix.length);
  const root = prefix === "magis_g_" ? rest.slice(0, Math.max(0, rest.indexOf("_"))) : rest;
  return Object.hasOwn(byRoot, root) ? root : null;
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // UTF-16 order, as Kotlin's String.compareTo
// Best score first; ties by title, then id, so the order never depends on the portal's.
const byScore = (a, b) => cmp(b.score ?? -1, a.score ?? -1) || cmp(a.title, b.title) || cmp(a.id, b.id);

// Lowercase, no accents, trimmed: "PELÍCULAS TEATRALES" -> "peliculas teatrales".
const plain = (text) => text.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").trim();

function distinctBy(list, key) {
  const seen = new Set();
  return list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

const row = (id, title, items) => ({ id, title, shown: items.slice(0, MAX_ROW_SIZE), all: items });
const genresOf = (item) =>
  distinctBy(item.genres.map((g) => GENRES.get(g.trim())).filter((g) => g !== undefined), (g) => g[0]);

// Newest upload first by the item's own shelve time; undated items keep the portal order, after
// the dated ones; with no dates at all nothing moves. (Array.sort is stable.)
const newestFirst = (items) =>
  items.some((i) => i.shelvedAtMs > 0) ? [...items].sort((a, b) => b.shelvedAtMs - a.shelvedAtMs) : items;

const playable = (section) => distinctBy(section.items.filter((i) => i.type !== TRAILER), (i) => i.id);

// The year sections, newest year first. Found by name, never by columnId: the year rolls over.
function yearSections(sections) {
  const out = [];
  for (const s of sections) {
    const m = YEAR_SECTION.exec(s.name.trim());
    if (m) out.push({ year: Number(m[1]), suffix: plain(m[2]), section: s });
  }
  return out.sort((a, b) => b.year - a.year);
}

// The playable items of the newest year-only section that has any, in portal order.
function plainYearSection(sections) {
  for (const y of yearSections(sections)) {
    if (y.suffix !== "") continue;
    const items = playable(y.section);
    if (items.length > 0) return items;
  }
  return null;
}

function recentMoviesRow(sectionsOf) {
  const items = plainYearSection(sectionsOf.peliculas);
  return items && row("magis_recent_peliculas", "Recién agregadas · Películas", newestFirst(items));
}

// Id stays `magis_new_series` so refs from older versions still resolve.
function updatedSeriesRow(sectionsOf) {
  const items = plainYearSection(sectionsOf.series);
  return items && row("magis_new_series", "Series con capítulos nuevos", newestFirst(items));
}

// "<year> ... teatrales"; never falls back to the plain year section (that one is recentMoviesRow).
function cinemaRow(sectionsOf) {
  for (const y of yearSections(sectionsOf.peliculas)) {
    if (!y.suffix.includes("teatral")) continue;
    const items = playable(y.section);
    if (items.length > 0) return row("magis_new_peliculas", "Estrenos de cine", items);
  }
  return null;
}

function topRatedRows(byKind) {
  const out = [];
  for (const root of FEATURED) {
    const ranked = [...byKind[root]].sort(byScore);
    if (ranked.length === 0) continue;
    out.push({
      id: `magis_top_${root}`, title: `${byRoot[root].label} mejor valoradas`,
      shown: ranked.slice(0, MAX_ROW_SIZE), all: ranked,
    });
  }
  return out;
}

function genreRows(byKind) {
  const perKind = KINDS.map(({ root }) => {
    const members = new Map();
    const labels = new Map();
    for (const item of byKind[root]) {
      for (const [key, label] of genresOf(item)) {
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(item);
        labels.set(key, label);
      }
    }
    const groups = [];
    for (const [key, items] of members) {
      if (items.length >= MIN_GENRE_SIZE) groups.push({ root, key, label: labels.get(key), items });
    }
    return groups.sort((a, b) => b.items.length - a.items.length || cmp(a.label, b.label));
  });
  // Round-robin across kinds, so the home does not show every movie genre before any series.
  const ordered = [];
  const longest = Math.max(0, ...perKind.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const groups of perKind) if (groups[i]) ordered.push(groups[i]);
  // Titles already drawn by an earlier GENRE row (featured rows do not count) go after the unseen.
  const seen = new Set();
  return ordered.map((g) => {
    const shown = [...g.items]
      .sort((a, b) => (seen.has(a.id) ? 1 : 0) - (seen.has(b.id) ? 1 : 0) || byScore(a, b))
      .slice(0, MAX_ROW_SIZE);
    for (const i of shown) seen.add(i.id);
    return {
      id: `magis_g_${g.root}_${g.key}`, title: `${g.label} · ${byRoot[g.root].label}`,
      shown, all: [...g.items].sort(byScore),
    };
  });
}

export function classify(roots) {
  const sectionsOf = Object.fromEntries(KINDS.map((k) => [k.root, roots[k.root] || []]));
  const kindOf = new Map();
  for (const root of PRECEDENCE) {
    for (const section of sectionsOf[root]) {
      for (const item of section.items) {
        if (item.type !== TRAILER && !kindOf.has(item.id)) kindOf.set(item.id, [root, item]);
      }
    }
  }
  const byKind = Object.fromEntries(KINDS.map((k) => [k.root, []]));
  for (const [root, item] of kindOf.values()) byKind[root].push(item);
  // Featured block first (recent uploads, shows with new episodes, top rated, cinema), then the
  // genre round-robin: the 20-row cap only ever drops the tail of the genre rows.
  return [recentMoviesRow(sectionsOf), updatedSeriesRow(sectionsOf)].filter(Boolean)
    .concat(topRatedRows(byKind), [cinemaRow(sectionsOf)].filter(Boolean), genreRows(byKind));
}

// The featured rows in the order classify gives them.
const FEATURED_ORDER = ["magis_recent_peliculas", "magis_new_series", "magis_top_peliculas", "magis_top_series", "magis_new_peliculas"];

/**
 * Rows of several sources put in classify's order: the featured rows first, then each root's genre rows
 * round-robin across the kinds, every root's genre rows keeping the order they came in.
 */
export function orderRows(rows) {
  const featured = FEATURED_ORDER.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
  const genre = KINDS.map(({ root }) => rows.filter((r) => !isFeatured(r.id) && rootOfRow(r.id) === root));
  const out = [...featured];
  const longest = Math.max(0, ...genre.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const g of genre) if (g[i]) out.push(g[i]);
  return out;
}

/**
 * `rows` with the rows of `root` replaced by `rootRows` (classify of that root alone). Used while the
 * roots arrive one at a time: close to classify over all of them, but an item listed in two roots shows
 * in both, and a genre row's first items are ordered without the other roots' rows. Exact again once
 * every root is classified together.
 */
export function mergeRoot(rows, root, rootRows) {
  return orderRows([...rows.filter((r) => rootOfRow(r.id) !== root), ...rootRows]);
}
