// screenView.js — the PURE trees of the Xuper screen (no kino calls, no network; testable). Modelled on the ultra
// plugin (`~/kino-plugin-ultrahd/src/screenView.js`): Scaffold + AppBar + hero (PageView) + titleRail + Skeleton.
// Palette: the theme's semantic colors (they adapt) + the xuper brand.
// No view carries a 1 s timer: data is drawn from what is stored (src/data.js) in the first frame, a skeleton
// appears only when nothing was ever stored, and slow events show the hidden `busy` bar through a local `ui` op.
import { SECTIONS, lang, httpImages, SUPPORT_URL } from "./config.js";
import { X_LOGO_DATA } from "./logo.js";
import { isLiveMatch, matchStart, visibleMatches, LIVE_BEFORE_MS } from "./v2.js";

const en = () => lang() === "en";
const HTTP = /^https?:\/\//;          // MagisPro serves http(s); both accepted for team crests
const PRESS_MS = 30_000;              // window for the identity consent (Activate)
const MIN = 60_000;

// The hidden progress bar every view carries: an action shows it at once (`ui: [{ show: "busy" }]`, no plugin
// call) and every answer to such an event hides it again (`ui: [{ hide: "busy" }]`).
const busyBar = () => ({ type: "LinearProgressIndicator", key: "busy", hidden: true });
/** An action that shows the busy bar, then sends `event`. */
export const busyEvent = (event, arg) => ({ ui: [{ show: "busy" }], event, ...(arg !== undefined ? { arg } : {}) });

// Fixed bottom bar (Kino's Scaffold.bottomNavigationBar, 2..5 items; onChanged → key).
const NAV = [
  { key: "home", icon: "home", es: "Inicio", en: "Home" },
  { key: "deportes", icon: "sports", es: "Fútbol", en: "Football" },
  { key: "vivo", icon: "tv", es: "En vivo", en: "Live" },
  { key: "config", icon: "settings", es: "Ajustes", en: "Settings" },
];
const navBar = (active) => ({
  type: "NavigationBar", value: active, onChanged: busyEvent("nav"),
  items: NAV.map((n) => ({ key: n.key, icon: n.icon, label: en() ? n.en : n.es, labelEn: n.en })),
});
// On TV the bottom bar is not drawn → navigation goes as a TabBar on top.
const navTabs = (active) => ({
  type: "TabBar", key: "navTabs", divider: false, value: active, onChanged: busyEvent("nav"),
  tabs: NAV.map((n) => ({ value: n.key, label: en() ? n.en : n.es, labelEn: n.en })),
});

// The brand: the square X (1:1, small) + "Xuper" in a Row, like the ultra plugin. `Image` takes no `h`: its height
// is bounded with maxHeight (a wide wordmark filled the title and came out huge).
const brand = () => ({
  type: "Row", key: "brand", crossAxisAlignment: "center", gap: 8,
  children: [
    { type: "Image", key: "brandLogo", url: X_LOGO_DATA, aspect: "1:1", fit: "contain", h: 32, maxHeight: 32, alt: "Xuper", altEn: "Xuper" },
    { type: "Text", key: "brandText", text: "Xuper", textEn: "Xuper", style: "h4" },
  ],
});
const navLabel = (nav) => { const n = NAV.find((x) => x.key === nav); return n ? (en() ? n.en : n.es) : "Xuper"; };
const navLabelEn = (nav) => { const n = NAV.find((x) => x.key === nav); return n ? n.en : "Xuper"; };
const titleText = (nav) => ({ type: "Text", key: "scTitle", text: navLabel(nav), textEn: navLabelEn(nav), style: "h4" });
// mergeWithKinoBar NEEDS a `leading` or Kino draws two bars. The header back arrow (the owner, 2026-11-18: a back icon, not
// an X): in a sub-section (Fútbol/En vivo/Ajustes) it goes back to the plugin's Home; only on Home (or with no nav, e.g.
// the welcome view) it closes the plugin, back to where the person came from.
const closeLeading = (nav) => ({ type: "IconButton", key: "navClose", icon: "arrow_back", labelText: en() ? "Back" : "Atrás", labelTextEn: "Back", onPressed: (nav && nav !== "home") ? { event: "nav", arg: "home" } : { go: { close: true } } });
const appBar = (actions, title, nav) => ({
  type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false,
  leading: closeLeading(nav), title: title || brand(),
  ...(actions && actions.length ? { actions } : {}),
});

// Responsive chrome: on a phone the nav is the bottom bar and the header shows the current section; on TV (no
// bottom bar) the nav goes as a TabBar on top, next to the brand.
function scaffoldChrome(device, nav, actions) {
  if (device === "tv" && nav) {
    return { appBar: {
      type: "AppBar", mergeWithKinoBar: true, dense: true, divider: false, leading: closeLeading(nav),
      title: { type: "Row", key: "tvTitle", gap: 16, crossAxisAlignment: "center", children: [brand(), navTabs(nav)] },
      ...(actions && actions.length ? { actions } : {}),
    } };
  }
  const phoneTitle = nav === "home" ? brand() : (nav ? titleText(nav) : undefined);
  return { appBar: appBar(actions, phoneTitle, nav), ...(nav ? { bottomNavigationBar: navBar(nav) } : {}) };
}

// A live tab's grid: `LV_STEP` channels first, the rest of a page of `LV_PAGE` when its end comes into view; past that, the
// «Anteriores / Siguientes» buttons. The grid is a lazy ListView (Kino composes only the tiles in view), and each tile is
// five of the 600 nodes Kino reads in one tree (ScreenLimits.MAX_NODES; past it the rest is dropped), so a page is 100
// tiles: 500 nodes plus the chrome (at most ~25 nodes on any live tab, phone or TV; 116 tiles would still fit).
export const LV_STEP = 50;
export const LV_PAGE = 100;
/** The live grid's tiles per row: two on a phone, six on a wide screen (the node count does not depend on it). */
export const LV_COLUMNS = Object.freeze({ compact: 2, expanded: 6 });

// A page body: the busy bar on top, then a scroll with the content column.
const scrollPage = (key, gap, children) => ({
  type: "Column", key: key + "-page", children: [
    busyBar(),
    { type: "SingleChildScrollView", key, flex: 1,
      children: [{ type: "Column", key: key + "-col", padding: { compact: 12, expanded: 24 }, gap, children }] },
  ],
});

/**
 * «Apoyar» (the welcome screen and Ajustes): Xuper's Ko-fi page. `go.url` opens nothing by itself: Kino first shows its
 * own sheet (the host, this title; a QR code on a TV), and only from the person's own press.
 */
export function supportButton(key, E, device) {
  // On a TV there is no browser to pay in and no keyboard: show a QR to scan with the phone instead of a click-through
  // link. Kino draws `QrImage` natively (it has no animated-GIF/anim cost); the Ko-fi URL is short, well under its cap.
  if (device === "tv") {
    return {
      type: "Column", key, crossAxisAlignment: "center",
      children: [
        { type: "Text", key: key + "Cap", color: "muted", textAlign: "center",
          text: E ? "Scan with your phone to support Xuper on Ko-fi" : "Escanea con tu celular para apoyar a Xuper en Ko-fi",
          textEn: "Scan with your phone to support Xuper on Ko-fi" },
        { type: "QrImage", key: key + "Qr", value: SUPPORT_URL, size: "large" },
      ],
    };
  }
  return {
    type: "Button", variant: "secondary", key, icon: "heart",
    labelText: E ? "If you want to support me, click here" : "Si me quieres apoyar, haz clic aquí",
    labelTextEn: "If you want to support me, click here",
    onPressed: { go: { url: { href: SUPPORT_URL, title: E ? "Support Xuper on Ko-fi" : "Apoya a Xuper en Ko-fi" } } },
  };
}

// ── Screen 1: Welcome + Activate (the entry lock; identity runs only from this press) ──
/**
 * The gate: Welcome + Activate. `error`: the last sign-in failed — `true` (identity refused or switched off: grant it
 * and try again) or `"update"` (identity answered without the gate token: only a newer Kino gives it to Xuper).
 */
export function welcomeView({ error, device } = {}) {
  const E = en();
  const body = [
    { type: "Text", key: "wTitle", text: E ? "Welcome to Xuper" : "Bienvenido a Xuper", textEn: "Welcome to Xuper", style: "h3", textAlign: "center" },
    { type: "Text", key: "wHint", color: "muted", textAlign: "center",
      text: E ? "To get in, activate your access with your Kino identity." : "Para entrar, activa tu acceso con tu identidad de Kino.",
      textEn: "To get in, activate your access with your Kino identity." },
    { type: "ElevatedButton", key: "activate",
      labelText: E ? "Activate" : "Activar", labelTextEn: "Activate",
      onPressed: { event: "activate", timeoutMs: PRESS_MS } },
  ];
  if (error === "update") body.push({
    type: "MaterialBanner", key: "wErrUpd", role: "error",
    text: E ? "To activate Xuper you need the latest version of Kino. Update Kino and try again." : "Para activar Xuper necesitas la versión más reciente de Kino. Actualiza Kino y vuelve a intentarlo.",
    textEn: "To activate Xuper you need the latest version of Kino. Update Kino and try again.",
  });
  else if (error === "consent") body.push({
    // kino.identity rejects and never re-prompts when the identity permission is off: a retry does nothing, so point the
    // person at the toggle in Kino's settings instead of "grant the permission and try again".
    type: "MaterialBanner", key: "wErrId", role: "error",
    text: E ? "Xuper needs your Kino identity, and it is off. Turn it on in Kino ▸ Settings ▸ Plugins ▸ Xuper (the identity permission), then open Xuper again."
      : "Xuper necesita tu identidad de Kino y ahora está apagada. Actívala en Kino ▸ Ajustes ▸ Plugins ▸ Xuper (el permiso de identidad), y vuelve a abrir Xuper.",
    textEn: "Xuper needs your Kino identity, and it is off. Turn it on in Kino ▸ Settings ▸ Plugins ▸ Xuper (the identity permission), then open Xuper again.",
  });
  else if (error) body.push({
    type: "MaterialBanner", key: "wErr", role: "error",
    text: E ? "Could not reach Xuper's server. Try again in a moment." : "No se pudo conectar con el servidor de Xuper. Inténtalo de nuevo en un momento.",
    textEn: "Could not reach Xuper's server. Try again in a moment.",
  });
  // Below Activate (and below its error, which stays next to it); the TV's first focus stays on Activate.
  body.push(supportButton("wSupport", E, device));
  return {
    type: "Scaffold", appBar: appBar(),
    body: { type: "Column", key: "welcome", flex: 1, mainAxisAlignment: "center", crossAxisAlignment: "center",
      gap: 16, padding: { compact: 24, expanded: 48 }, children: body },
  };
}

// ── hero ──
const HERO_H = { compact: 200, expanded: 240 };   // Kino's size scale (180/260 were dropped)

const slideNode = (s) => ({
  type: "heroCard", key: "slide-" + s.id, h: HERO_H,
  title: s.title, ...(s.text ? { text: s.text } : {}), image: s.image,
  buttons: [{ type: "ElevatedButton", key: "play-" + s.id, icon: "play",
    labelText: en() ? "Play" : "Reproducir", labelTextEn: "Play",
    onPressed: { go: { play: { ref: s.ref, kind: s.kind, id: s.id, title: s.title } } } }],
});

const hero = (slides) => (slides.length === 1 ? slideNode(slides[0])
  : { type: "PageView", key: "hero" + slides.length, autoPlayMs: 6_000, children: slides.map(slideNode) });

const skeletonRail = (n) => ({
  type: "Column", key: "skel" + n, gap: 8, children: [
    { type: "Skeleton", key: "skl" + n, shape: "line", width: 160 },
    { type: "Row", key: "skr" + n, gap: 12, children: [1, 2, 3, 4].map((i) => ({ type: "Skeleton", shape: "card", key: `sk${n}-${i}`, flex: 1 })) },
  ],
});

// ── genre chips: the portal publishes English tags; the chips read in the person's language ──
const GENRES = {
  "Action": ["Acción", "Action"], "Adventure": ["Aventura", "Adventure"], "Animation": ["Animación", "Animation"],
  "Adult": ["Adultos", "Adult"], "Anime": ["Anime", "Anime"], "Biography": ["Biografía", "Biography"],
  "Cartoon": ["Dibujos animados", "Cartoon"], "Comedy": ["Comedia", "Comedy"], "Crime": ["Crimen", "Crime"],
  "Documentary": ["Documental", "Documentary"], "Drama": ["Drama", "Drama"], "Family": ["Familia", "Family"],
  "Fantasy": ["Fantasía", "Fantasy"], "History": ["Historia", "History"], "Horror": ["Terror", "Horror"],
  "Kids": ["Infantil", "Kids"], "Music": ["Música", "Music"], "Musical": ["Musical", "Musical"],
  "Mystery": ["Misterio", "Mystery"], "Nacional": ["Nacional", "National"], "News": ["Noticias", "News"],
  "Reality": ["Reality", "Reality"], "Romance": ["Romance", "Romance"], "Sci-Fi": ["Ciencia ficción", "Sci-Fi"],
  "Short": ["Cortometraje", "Short"], "Sport": ["Deporte", "Sport"], "Suspense": ["Suspenso", "Suspense"],
  "Thriller": ["Thriller", "Thriller"], "War": ["Bélica", "War"], "Western": ["Western", "Western"],
};
/** A raw genre tag → [es, en] labels (unknown tags pass through unchanged). */
export function genreLabels(g) {
  const hit = GENRES[g];
  return hit ? hit : [String(g), String(g)];
}

// Filter sheet (BottomSheet) with the genres, opened from the AppBar button. Filtering is client-side.
function filterSheet(genres, fTag) {
  const E = en();
  const tile = (key, es, enLabel, val, sel) => ({
    type: "ListTile", key, title: E ? enLabel : es, titleEn: enLabel, dense: true,
    ...(sel ? { selected: true, trailing: { type: "Icon", name: "check" } } : {}),
    onTap: { ui: [{ close: "filterSheet" }], event: "fTag", arg: val },
  });
  return {
    type: "BottomSheet", key: "filterSheet", title: E ? "Genre" : "Género", titleEn: "Genre",
    children: [{ type: "ListView", key: "filterList", items: [
      tile("f-all", "Todos", "All", "", !fTag),
      ...genres.map((g, i) => { const [es, enL] = genreLabels(g); return tile("f-" + i, es, enL, g, g === fTag); }),
    ] }],
  };
}

// With its `ref` (the row's portal column), Kino adds the row's «Ver más», which pages it through `browse`.
const railNode = (r, i) => ({ type: "titleRail", key: "rail-" + i, ...(r.title ? { title: r.title, titleEn: r.title } : {}), ...(r.ref ? { ref: r.ref } : {}), items: r.items, size: "medium" });

/** The search sheet's field key: its text reaches `screenEvent("search")` as `value` (and in `state.inputs`). */
export const SEARCH_FIELD = "sq";

// The AppBar's search button opens this sheet: Kino's `go.search` needs a query of 1 to 200 characters (an empty
// one is dropped), so the person types it here first; the `search` event answers the `go` (src/screen.js).
function searchSheet() {
  const E = en();
  return {
    type: "BottomSheet", key: "searchSheet", title: E ? "Search" : "Buscar", titleEn: "Search",
    children: [{
      type: "TextField", key: SEARCH_FIELD, kind: "search", maxLength: 200,
      labelText: E ? "Movies and series" : "Películas y series", labelTextEn: "Movies and series",
      trailingIcon: "search", trailingLabel: E ? "Search" : "Buscar", trailingLabelEn: "Search",
      onSubmitted: { event: "search" }, onTrailingTap: { event: "search" },
    }],
  };
}

/**
 * The catalog (with a Bearer). `view` = `sectionView(v2, tab)` (src/v2.js), or null while nothing was ever stored
 * (skeleton, no timer: the screen's `open` is loading it), `failed` = nothing stored and the load failed.
 * The body is a lazy `ListView`: Kino composes only the hero and the rails in view. A `SingleChildScrollView` drew the
 * hero and every rail (10 to 12 on Películas / Series) in the first frame of each tab, which held Kino's main thread
 * 0.5–0.75 s on a Redmi Note 9 Pro (Choreographer: 32–45 skipped frames). The sheets stay outside the list, so they
 * open wherever the list is scrolled to.
 */
export function catalogView({ tab, view, fTag = "", device = "phone", failed = false }) {
  const E = en();
  const tabs = SECTIONS.map((s) => ({ value: s.name, label: E ? s.titleEn : s.title, labelEn: s.titleEn }));
  const body = [];
  let genres = [];
  if (!view && failed) {
    body.push({ type: "MaterialBanner", key: "failed", role: "error",
      text: E ? "Could not load. Check your connection." : "No se pudo cargar. Revisa la conexión.",
      textEn: "Could not load. Check your connection.",
      action: { label: E ? "Retry" : "Reintentar", labelEn: "Retry", onTap: busyEvent("reload") } });
  } else if (!view) {
    body.push({ type: "Skeleton", key: "heroSkel", shape: "block", height: HERO_H },
      skeletonRail(1), skeletonRail(2), skeletonRail(3));
  } else {
    const adult = tab === "adultos";
    genres = view.genres || [];
    if (fTag) {
      const [es, enL] = genreLabels(fTag);
      body.push({ type: "Row", key: "fChip", gap: 8, crossAxisAlignment: "center", children: [
        { type: "Text", key: "fLabel", text: E ? `Genre: ${enL}` : `Género: ${es}`, textEn: `Genre: ${enL}`, style: "caption", color: "primary", flex: 1, maxLines: 1 },
        { type: "TextButton", key: "fClear", labelText: E ? "Clear" : "Quitar", labelTextEn: "Clear", onPressed: { event: "fTag", arg: "" } },
      ] });
      const filtered = (view.all || []).filter((it) => (it.genres || []).includes(fTag));
      body.push(filtered.length
        ? { type: "titleGrid", key: "fGrid", columns: { compact: 3, expanded: 6 }, items: filtered.slice(0, 60) }
        : { type: "Text", key: "fEmpty", color: "muted", text: E ? "No results" : "Sin resultados", textEn: "No results" });
    } else {
      // No hero on the adult tab (Kino does not gate a heroCard by 18+); its rail items carry adult:true.
      if (!adult && view.slides && view.slides.length) body.push(hero(view.slides));
      const rails = (view.rails || []).map(railNode);
      if (rails.length) body.push(...rails);
      else body.push({ type: "Text", key: "empty", color: "muted", text: E ? "No content" : "Sin contenido", textEn: "No content" });
    }
  }
  const searchBtn = { type: "IconButton", key: "search", icon: "search", labelText: E ? "Search" : "Buscar", labelTextEn: "Search", tooltip: E ? "Search" : "Buscar", tooltipEn: "Search", onPressed: { ui: [{ open: "searchSheet" }] } };
  const actions = [searchBtn];
  const sheets = [searchSheet()];   // hidden until opened
  if (genres.length) {
    actions.push({ type: "IconButton", key: "filter", icon: "tune", labelText: E ? "Filter" : "Filtros", labelTextEn: "Filter", tooltip: E ? "Filter" : "Filtros", tooltipEn: "Filter", onPressed: { ui: [{ open: "filterSheet" }] } });
    sheets.push(filterSheet(genres, fTag));
  }
  return {
    type: "Scaffold", ...scaffoldChrome(device, "home", actions),
    body: { type: "Column", key: "page", children: [
      busyBar(),
      // Room above and below the section menu (the owner, 2026-11-18: it looked squeezed between the bar and the list). A
      // margin, not a padding: Kino before its fix draws a TV TabBar without its padding.
      { type: "TabBar", key: "tabs", divider: false, margin: { top: 8, bottom: 8 }, value: tab, onChanged: "tab", tabs },
      { type: "ListView", key: "list-" + tab + (fTag ? "-f" : ""), flex: 1, padding: { compact: 12, expanded: 24 }, gap: 16, items: body },
      ...sheets,
    ] },
  };
}

// ── Fútbol (bottom bar → "deportes"): the v2 matches, grouped by league ──

function groupByLeague(matches) {
  const order = [], byKey = new Map();
  for (const m of matches || []) {
    if (!m) continue;
    const league = String(m.league || (en() ? "Other" : "Otros"));
    if (!byKey.has(league)) { byKey.set(league, { league, matches: [] }); order.push(league); }
    byKey.get(league).matches.push(m);
  }
  return order.map((k) => byKey.get(k));
}

// A match's kickoff in the device's own time: the published `time` is UTC (src/v2.js parseUtcTime), so the card's
// hour, the date strip and "Hoy" (src/screen.js todayStr, device-local) all agree. Unparseable → the raw text.
const pad2 = (n) => String(n).padStart(2, "0");
function localStart(m) {
  const t = matchStart(m);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return { date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, hm: `${pad2(d.getHours())}:${pad2(d.getMinutes())}` };
}
const hhmm = (m) => {
  const l = localStart(m);
  if (l) return l.hm;
  const s = String((m && m.time) || ""); const i = s.indexOf(" "); return i >= 0 ? s.slice(i + 1, i + 6) : s.slice(0, 5);
};
const teamName = (t) => String((t && t.n) || "?");

// Team cell (scoreboard): crest on top, name below, centered. One on the LEFT and one on the RIGHT.
const teamCell = (t, n, side) => {
  const logo = t && HTTP.test(t.l || "") ? t.l : null;
  return {
    type: "Column", key: `tc-${n}-${side}`, gap: 8, flex: 1, crossAxisAlignment: "center", children: [
      logo ? { type: "Image", key: `fl-${n}-${side}`, url: logo, h: 32, aspect: "3:2", fit: "contain" }
           : { type: "Icon", key: `fi-${n}-${side}`, name: "sports", size: 30 },
      { type: "Text", key: `fn-${n}-${side}`, text: teamName(t).slice(0, 18), textEn: teamName(t).slice(0, 18), style: "caption", textAlign: "center", maxLines: 2 },
    ],
  };
};

function matchCard(m, n, now) {
  const E = en();
  const live = isLiveMatch(m, now);
  const hasTeams = !!(m.a && m.b);
  const titleFull = hasTeams ? `${teamName(m.a)} vs ${teamName(m.b)}` : String(m.title || "?").slice(0, 80);
  // Center: the LIVE badge (from the kickoff time window; the data carries no live state and no score),
  // or the kickoff time. "VS" separates the two teams.
  const centerKids = live
    ? [{ type: "Badge", key: "lb-" + n, text: E ? "LIVE" : "EN VIVO", textEn: "LIVE", color: "error" },
       { type: "Icon", key: "pl-" + n, name: "play" }]
    : [{ type: "Text", key: "tm-" + n, text: hhmm(m), textEn: hhmm(m), style: "h4", color: "primary" },
       { type: "Text", key: "vs-" + n, text: "VS", textEn: "VS", style: "caption", color: "muted" }];
  const center = { type: "Column", key: "ct-" + n, crossAxisAlignment: "center", mainAxisAlignment: "center", gap: 4, children: centerKids };
  const top = hasTeams
    ? { type: "Row", key: "tr-" + n, gap: 8, crossAxisAlignment: "center", children: [teamCell(m.a, n, "a"), center, teamCell(m.b, n, "b")] }
    : { type: "Row", key: "tr-" + n, gap: 8, crossAxisAlignment: "center", children: [
        { type: "Text", key: "gn-" + n, text: titleFull, textEn: titleFull, flex: 1, maxLines: 2 }, center] };
  const ch = m.ch ? String(m.ch) : "";
  const foot = live
    ? (ch ? `▶ ${ch.slice(0, 34)}` : (E ? "Watch now" : "Mira ahora"))
    : `${E ? "Upcoming" : "Próximamente"}${ch ? ` · ${ch.slice(0, 26)}` : ""}`;
  const footEn = live ? (ch ? `▶ ${ch.slice(0, 34)}` : "Watch now") : `Upcoming${ch ? ` · ${ch.slice(0, 26)}` : ""}`;
  return {
    type: "Card", key: "match-" + n,
    // Informative agenda: the old MagisPro live play is retired, so a match is not tappable.
    children: [{ type: "Column", key: "mc-" + n, gap: 8, crossAxisAlignment: "center", children: [
      top,
      { type: "Text", key: "ft-" + n, text: foot, textEn: footEn, style: "caption", color: live ? "primary" : "muted", textAlign: "center", maxLines: 1 },
    ] }],
  };
}

const matchDate = (m) => { const l = localStart(m); return l ? l.date : String((m && m.time) || "").slice(0, 10); };   // "YYYY-MM-DD", device-local
const DAYS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const DAYS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function dateLabel(d, today, E) {
  if (d === today) return E ? "Today" : "Hoy";
  const [y, m, day] = d.split("-").map(Number);
  let dow = "";
  try { const g = new Date(y, m - 1, day).getDay(); if (g >= 0 && g <= 6) dow = (E ? DAYS_EN : DAYS_ES)[g] + " "; } catch (_) { /* no weekday */ }
  return `${dow}${String(day).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
const leagueHeader = (g, n) => ({
  type: "Row", key: "lg-" + n, gap: 8, crossAxisAlignment: "center", children: [
    // No matchLogo: its URLs are often broken and Kino draws a huge placeholder. A reliable icon instead.
    { type: "Icon", key: "lgic-" + n, name: "sports", size: 20, color: "primary" },
    { type: "Text", key: "lgname-" + n, text: g.league, textEn: g.league, style: "h4", flex: 1, maxLines: 1 },
  ],
});

/** A signature of which matches are live now: the clock re-renders only when it changes. */
export function liveSignature(matches, now) {
  const out = [];
  visibleMatches(matches, now).forEach((m, i) => { if (isLiveMatch(m, now)) out.push(i); });
  return out.join(",");
}

/**
 * The `clock` timer of the Partidos tab: every 60 s while a match is in its live window; otherwise it wakes when
 * the next window opens, and at least every 30 min (it also revalidates the matches when they are due).
 */
export function clockMs(matches, now) {
  const list = visibleMatches(matches, now);
  if (list.some((m) => isLiveMatch(m, now))) return 60_000;
  let next = Infinity;
  for (const m of list) {
    const t = matchStart(m);
    if (Number.isFinite(t) && t - LIVE_BEFORE_MS > now) next = Math.min(next, t - LIVE_BEFORE_MS - now);
  }
  return Math.max(60_000, Math.min(30 * MIN, Number.isFinite(next) ? next + 1000 : 30 * MIN));
}

/**
 * Fútbol: tabs Partidos | Canales. `matches` = the v2 list (or null while nothing was ever stored), `failed` =
 * nothing stored and the load failed. Canales (src/live.js, no network while drawing): `cats` (no adult ones),
 * `channels` (null = no stored list), `chLoading` = its one-shot load is about to run, `chFailed` = it failed,
 * `chOffline` = a stale list whose refresh failed, `timers` = the live tab's one-shot timers.
 */
export function deportesView({ matches, depDate, depView = "ligas", today = "", now = Date.now(), device = "phone", failed = false,
  depTab = "partidos", cats, cat, channels, chLoading = false, chFailed = false, chOffline = false, timers = [], shown = LV_STEP, page = 0 }) {
  const E = en();
  const tab = depTab === "canales" ? "canales" : "partidos";
  const body = [];
  body.push({ type: "TabBar", key: "depTopTabs", divider: false, margin: { top: 8, bottom: 8 }, value: tab, onChanged: busyEvent("depTab"),
    tabs: [{ value: "partidos", label: E ? "Matches" : "Partidos", labelEn: "Matches" }, { value: "canales", label: E ? "Channels" : "Canales", labelEn: "Channels" }] });
  let every = null;

  if (tab === "canales") {
    // A live tab: no scroll around the grid (a list inside a scroll is drawn whole).
    const head = [];
    if (Array.isArray(cats) && cats.length > 1) head.push(categoryPicker("sportsCat", cats, cat));
    return {
      type: "Scaffold", ...scaffoldChrome(device, "deportes", []),
      body: livePage("sp", [body[0], ...head], { channels, loading: chLoading, failed: chFailed, offline: chOffline, shown, page, cat, device }),
      ...(timers && timers.length ? { every: timers } : {}),
    };
  } else if (!matches && failed) {
    body.push({ type: "MaterialBanner", key: "depFail", role: "error",
      text: E ? "Could not load matches." : "No se pudieron cargar los partidos.", textEn: "Could not load matches.",
      action: { label: E ? "Retry" : "Reintentar", labelEn: "Retry", onTap: busyEvent("reloadDep") } });
  } else if (!matches) {
    body.push(skeletonRail(1), skeletonRail(2));
  } else {
    const list = visibleMatches(matches, now);
    every = { ms: clockMs(matches, now), event: "clock" };
    if (!list.length) {
      body.push({ type: "Text", key: "depEmpty", color: "muted", text: E ? "No matches" : "Sin partidos", textEn: "No matches" });
    } else {
      const view = depView === "todos" ? "todos" : "ligas";
      body.push({ type: "TabBar", key: "depTabs", divider: false, value: view, onChanged: "depView",
        tabs: [{ value: "ligas", label: E ? "Leagues" : "Ligas", labelEn: "Leagues" }, { value: "todos", label: E ? "All" : "Todos", labelEn: "All" }] });
      const dates = Array.from(new Set(list.map(matchDate).filter(Boolean))).sort();
      const sel = (depDate && dates.includes(depDate)) ? depDate : (dates.includes(today) ? today : (dates[0] || ""));
      if (dates.length > 1) {
        body.push({ type: "SingleChildScrollView", key: "dateStrip", direction: "horizontal", children: [
          { type: "Row", key: "dateRow", gap: 8, children: dates.map((d, i) => ({
            type: d === sel ? "ElevatedButton" : "TextButton", key: "date-" + i, radius: "full",
            labelText: dateLabel(d, today, E), labelTextEn: dateLabel(d, today, true), onPressed: { event: "depDate", arg: d } })) }] });
      }
      const day = sel ? list.filter((m) => matchDate(m) === sel) : list;
      if (!day.length) {
        body.push({ type: "Text", key: "depDayEmpty", color: "muted", text: E ? "No matches this day" : "Sin partidos ese día", textEn: "No matches this day" });
      } else if (view === "todos") {
        let n = 0; for (const m of day) body.push(matchCard(m, n++, now));
      } else {
        let n = 0;
        for (const g of groupByLeague(day)) { body.push(leagueHeader(g, n)); for (const m of g.matches) body.push(matchCard(m, n++, now)); }
      }
    }
  }
  return {
    type: "Scaffold", ...scaffoldChrome(device, "deportes", []),
    body: scrollPage("dep-scroll", 12, body),
    ...(every ? { every } : {}),
  };
}

// ── live tabs (Vivo, Fútbol ▸ Canales): drawn from what src/live.js has stored, never a 1 s timer ──

/** The category dropdown (adult categories never reach it); a change shows the busy bar at once. */
function categoryPicker(key, cats, cat) {
  const E = en();
  return {
    type: "DropdownButton", key, value: cat || (cats[0] && cats[0].id),
    labelText: E ? "Category" : "Categoría", labelTextEn: "Category", onChanged: busyEvent(key),
    // Kino's DropdownButton takes 1 to 500 options (src/live.js screenCategories already stops there).
    options: cats.slice(0, 500).map((c) => ({ value: String(c.id), label: String(c.title), labelEn: String(c.title) })),
  };
}

/**
 * The page buttons of a category with more than LV_PAGE channels: «Anteriores 100» / «Siguientes 100», and where the
 * person is ("101–200 de 1234").
 */
function pageRow(p, page, pages, total) {
  const E = en();
  const from = page * LV_PAGE + 1, to = Math.min(total, (page + 1) * LV_PAGE);
  const where = (enL) => (enL ? `${from}–${to} of ${total}` : `${from}–${to} de ${total}`);
  const kids = [];
  if (page > 0) kids.push({ type: "TextButton", key: p + "Prev", icon: "arrow_back", labelText: E ? `Previous ${LV_PAGE}` : `Anteriores ${LV_PAGE}`, labelTextEn: `Previous ${LV_PAGE}`, onPressed: busyEvent("lvPage", String(page - 1)) });
  kids.push({ type: "Text", key: p + "Where", text: where(E), textEn: where(true), style: "caption", color: "muted", flex: 1, textAlign: "center", maxLines: 1 });
  if (page + 1 < pages) kids.push({ type: "TextButton", key: p + "Next", icon: "arrow_forward", labelText: E ? `Next ${LV_PAGE}` : `Siguientes ${LV_PAGE}`, labelTextEn: `Next ${LV_PAGE}`, onPressed: busyEvent("lvPage", String(page + 1)) });
  return { type: "Row", key: p + "Pages", gap: 8, crossAxisAlignment: "center", children: kids };
}

// ── channel tiles: the plugin's own, so a logo is shown whole (Kino's titleCard is a 2:3 poster that crops it) ──

const KINO_ID = /^[A-Za-z0-9._~-]{1,128}$/;   // Kino's rule for an item id and a node key (PluginOutput.ID)
const HTTPS = /^https:\/\//i;                  // an Image takes https, and http only where Kino says so (httpImages)
const MAX_TITLE = 200;                         // Kino's title cap: a longer go.play title drops the go (PluginOutput)
const NAME_STOP = new Set(["de", "del", "la", "las", "el", "los", "y", "e", "en", "the", "of", "and"]);

/** "Canal RCN" → "CR", "Fox Sports 3" → "FS3", "ESPN" → "ESPN", "Telefe" → "TE": what a tile shows without a logo. */
export function channelInitials(title) {
  const words = String(title == null ? "" : title).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const kept = words.length > 1 ? words.filter((w) => !NAME_STOP.has(w.toLowerCase())) : words;
  const ws = kept.length ? kept : words;
  if (!ws.length) return "TV";
  if (ws.length === 1) {
    const w = ws[0];
    const acronym = Array.from(w).length <= 4 && w === w.toUpperCase();
    return (acronym ? w : Array.from(w).slice(0, 2).join("")).toUpperCase();
  }
  const part = (w) => (/^\p{N}+$/u.test(w) ? w.slice(0, 3) : Array.from(w)[0]);
  return Array.from(ws.slice(0, 3).map(part).join("").toUpperCase()).slice(0, 4).join("");
}

/** A short, key-safe stand-in for a category id in the grid's key (the grid starts at its top on another category). */
function catTag(cat) {
  const s = String(cat == null ? "" : cat);
  if (/^[A-Za-z0-9._~-]{1,40}$/.test(s)) return s;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return "h" + h.toString(36);
}

/**
 * The grid's key: one per category and page, so another category or page opens at its top (Kino keeps a list's scroll by
 * its key), while the ticks that load more members of the same category keep the person's place.
 */
function channelGridKey(p, cat, page = 0) {
  return p + "Grid" + (cat ? "-" + catTag(cat) : "") + (page > 0 ? "-p" + page : "");
}

/**
 * One channel's tile (five nodes): a card on Kino's neutral raised surface (the colour Kino paints behind
 * every picture, so the logo's box and the card are one panel), the logo whole (`fit: contain`) in a 4:3 box inset from
 * the edges, Kino's «EN VIVO» badge on its corner, the name under it (2 lines at most, every tile as tall), and the
 * channel's initials when there is no logo Kino draws (https; http too where Kino says `screen.httpImages`) or it fails
 * (never Kino's generic mark). A tap plays the channel; the
 * page's hidden title grid holds the same item with its logo, so Kino plays it with that very item (src: channelBody).
 */
function channelTile(it, key, device, httpOk) {
  const E = en();
  const initials = channelInitials(it.title);
  const logo = it.poster && (HTTPS.test(it.poster) || (httpOk && HTTP.test(it.poster))) ? it.poster : null;
  return {
    type: "Card", key, flush: true, background: "surfaceVariant", gap: 4,
    badge: { text: E ? "LIVE" : "EN VIVO", textEn: "LIVE", color: "error" },
    onTap: { go: { play: { ref: it.ref, kind: "live", id: it.id, title: it.title } } },
    children: [
      { type: "Image", key: key + "~l", ...(logo ? { url: logo } : {}), aspect: "4:3", fit: "contain",
        margin: { x: 12, top: 12, bottom: 4 },
        fallback: { type: "Column", key: key + "~f", mainAxisAlignment: "center", crossAxisAlignment: "center", children: [
          { type: "Text", key: key + "~i", text: initials, textEn: initials, style: "h3", maxLines: 1 },
        ] } },
      // Two lines of Kino's body text are 40 dp on a phone and 50 on a TV (its text is 1.25 larger), times the system's
      // font size and the theme's text scale; Kino puts minHeight outside the 8 dp padding. 64 holds two lines up to a
      // font scale of 1.4 on a phone, 80 up to 1.44 on a TV (and desktop, whose text size is not the phone's for sure),
      // so a one-line name and a two-line one make tiles of the same height, also with "Large" text.
      { type: "Text", key: key + "~n", text: it.title, textEn: it.title, maxLines: 2, textAlign: "center", fill: true,
        padding: { x: 8, bottom: 8 }, minHeight: device === "phone" ? 64 : 80 },
    ],
  };
}

/**
 * The tiles of the channels drawn now: Kino's own `titleCard` for an 18+ channel (Kino hides it while the person's 18+
 * code is locked; the plugin cannot tell, so it never draws one itself), the plugin's tile for every other. Keys:
 * `<p>c-<id>` (no other key of the screen starts so), or `<p>c~<place>` for an id met twice on the page, too long for a
 * key or holding "~" (the separator of the tile's parts' keys, so no two keys meet).
 */
function channelTiles(p, items, from, device) {
  const used = new Set();
  const httpOk = httpImages();
  return items.map((it, i) => {
    const byId = p + "c-" + it.id;
    const key = byId.length <= 120 && !it.id.includes("~") && !used.has(byId) ? byId : `${p}c~${from + i}`;
    used.add(key);
    return it.adult ? { type: "titleCard", key, size: "small", item: it } : channelTile(it, key, device, httpOk);
  });
}

/**
 * The channel area of a live tab: a skeleton while its load is due, a banner when it failed, else the grid of the
 * current page (`page`, LV_PAGE each), `shown` of its channels so far (more on `lvMore`). The grid is a lazy ListView
 * of tiles; beside it, a hidden `titleGrid` with the same channels (no 18+ ones: those are titleCards already) puts each
 * one on the canvas with its logo: Kino plays a tapped title with the canvas's own item (ScreenGoHandler.findTitle), so
 * the player and Cast get the channel's logo as with a Home card. Hidden, it is never drawn and costs one node.
 */
function channelBody(p, { channels, loading, failed, offline, shown = LV_STEP, page = 0, cat = "", device = "phone" }) {
  const E = en();
  const out = [];
  if (Array.isArray(channels)) {
    if (offline) {
      out.push({ type: "Text", key: p + "Offline", color: "muted", style: "caption", maxLines: 2,
        text: E ? "No connection to the source: showing the last list." : "Sin conexión con la fuente: se muestra la última lista.",
        textEn: "No connection to the source: showing the last list." });
    }
    const items = channelItems(channels);
    if (!items.length) {
      out.push({ type: "Text", key: p + "Empty", color: "muted", text: E ? "No channels" : "Sin canales", textEn: "No channels" });
      return out;
    }
    const pages = Math.ceil(items.length / LV_PAGE);
    const pg = Math.min(Math.max(0, page), pages - 1);
    const onPage = items.slice(pg * LV_PAGE, (pg + 1) * LV_PAGE);
    const n = Math.min(onPage.length, Math.max(LV_STEP, shown));
    const drawn = onPage.slice(0, n);
    if (pages > 1) out.push(pageRow(p, pg, pages, items.length));
    // Not inside a scroll: a list there is drawn whole (Kino's lazy grid needs the column's room).
    // Two tiles a row on a phone (the logo and its name read at a glance); six on a wide screen (TV, desktop).
    out.push({ type: "ListView", key: channelGridKey(p, cat, pg), flex: 1, columns: LV_COLUMNS,
      gap: { compact: 12, expanded: 16 },
      // Room for the badge, which sits 4 dp outside each tile's top end corner (a list clips at its edges).
      padding: { x: 4, top: 8, bottom: 8 },
      items: channelTiles(p, drawn, pg * LV_PAGE, device),
      onEndReached: { event: "lvMore" }, done: n >= onPage.length });
    const canvas = drawn.filter((it) => !it.adult);
    if (canvas.length) out.push({ type: "titleGrid", key: p + "Titles", hidden: true, items: canvas });
  } else if (failed) {
    out.push({ type: "MaterialBanner", key: p + "Fail", role: "error",
      text: E ? "Could not load the channels." : "No se pudieron cargar los canales.", textEn: "Could not load the channels.",
      action: { label: E ? "Retry" : "Reintentar", labelEn: "Retry", onTap: busyEvent("reloadVivo") } });
  } else if (loading) {
    out.push({ type: "Text", key: p + "Loading", color: "muted", style: "caption",
      text: E ? "Loading channels…" : "Cargando canales…", textEn: "Loading channels…" },
      { type: "Row", key: p + "Skel", gap: 12, children: [1, 2, 3].map((i) => ({ type: "Skeleton", shape: "card", key: `${p}sk${i}`, flex: 1 })) });
  } else {
    out.push({ type: "Text", key: p + "Empty", color: "muted", text: E ? "No channels" : "Sin canales", textEn: "No channels" });
  }
  return out;
}

// ── En vivo (bottom bar → "vivo"): categories + channels (src/live.js) ──
/**
 * Channels → title items; a channel carries `adult` when it or its category is 18+ (Kino hides them while locked). One
 * Kino would refuse is left out, as Kino left it out of a title grid: no ref, a ref over 4,096 characters or an id off
 * Kino's rule (a tile's play needs both). A title is cut at Kino's 200 characters.
 */
export function channelItems(channels) {
  const out = [];
  for (const c of channels || []) {
    if (!c || !c.ref || String(c.ref).length > 4096) continue;
    const id = String(c.id || c.ref);
    if (!KINO_ID.test(id)) continue;
    const it = { id, ref: String(c.ref), title: (String(c.title || "").trim() || "—").slice(0, MAX_TITLE), kind: "live" };
    if (c.logo && HTTP.test(c.logo)) it.poster = c.logo;
    if (c.adult === true) it.adult = true;
    out.push(it);
  }
  return out;
}

/**
 * En vivo: `cats` (no adult ones), `channels` (null = no stored list), `loading` / `failed` / `offline` as in
 * deportesView's Canales, `timers` = the one-shot `lvRefresh` / `lcFill` timers (src/screen.js).
 */
export function vivoView({ cats, cat, channels = null, device = "phone", loading = false, failed = false, offline = false, timers = [],
  shown = LV_STEP, page = 0 }) {
  const head = [];
  if (Array.isArray(cats) && cats.length > 1) head.push(categoryPicker("liveCat", cats, cat));
  return {
    type: "Scaffold", ...scaffoldChrome(device, "vivo", []),
    body: livePage("vivo", head, { channels, loading, failed, offline, shown, page, cat, device }),
    ...(timers && timers.length ? { every: timers } : {}),
  };
}

/**
 * A live tab's body: the busy bar, the header nodes (tabs, the category picker), then the channel area. No scroll
 * around it: the grid scrolls itself (lazy); a list inside a scroll is drawn whole.
 */
function livePage(p, head, opts) {
  return {
    type: "Column", key: p + "-page", gap: 12, padding: { compact: 12, expanded: 24 }, flex: 1, children: [
      busyBar(),
      ...head,
      ...channelBody(p, opts),
    ],
  };
}

// ── Ajustes (bottom bar → "config"): data ages, Disconnect, About ──

/** "hace 5 min" / "5 min ago". */
export function agoText(ms, E) {
  if (!(ms >= 0)) return E ? "just now" : "hace un momento";
  const m = Math.floor(ms / MIN);
  if (m < 1) return E ? "just now" : "hace un momento";
  if (m < 60) return E ? `${m} min ago` : `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return E ? `${h} h ago` : `hace ${h} h`;
  return E ? `${Math.floor(h / 24)} d ago` : `hace ${Math.floor(h / 24)} d`;
}

function ageLine(label, a, now, E) {
  if (!a) return E ? `${label[1]}: no data yet` : `${label[0]}: sin datos todavía`;
  const parts = [E ? `${label[1]}: checked ${agoText(now - a.checkedAt, true)}` : `${label[0]}: revisado ${agoText(now - a.checkedAt, false)}`];
  if (a.gen) parts.push(E ? `published ${agoText(now - a.gen, true)}` : `publicado ${agoText(now - a.gen, false)}`);
  return parts.join(" · ");
}

/** "3 h 12 min" / "45 min": a seed's time left. */
function leftText(min) {
  const m = Math.max(0, Math.floor(Number(min) || 0));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 60)} h`;
}

/** A text node in both languages: `[es, en]`. */
const both = (key, [es, enText], extra = {}) => ({ type: "Text", key, text: en() ? enText : es, textEn: enText, ...extra });

/**
 * The "Sesión de Xuper" card (seed design §7): which session the device uses (its own anonymous one — "bloqueada" while
 * Xuper blocks the region —, a backup seed and its time left, or none yet), the region when Xuper blocks it, a wait with
 * its minutes, and "Cambiar semilla" only while on a seed and never under the hour's used-up line (the card and the
 * button agree). `s`: src/seeds.js status() — { kind, leftMin, geo, wait }.
 */
function xuperSessionCard(s) {
  const st = s || { kind: "none", leftMin: 0, geo: false, wait: null };
  const line = st.kind === "seed"
    ? (st.leftMin === null ? ["Sesión: de respaldo (semilla)", "Session: backup (seed)"]
      : [`Sesión: de respaldo (semilla) · le quedan ${leftText(st.leftMin)}`, `Session: backup (seed) · ${leftText(st.leftMin)} left`])
    : st.kind === "own" ? (st.geo ? ["Sesión: propia (anónima) · bloqueada", "Session: your own (anonymous) · blocked"]
      : ["Sesión: propia (anónima)", "Session: your own (anonymous)"])
      : ["Sesión: todavía ninguna", "Session: none yet"];
  const children = [
    both("cfgXuperTitle", ["Sesión de Xuper", "Xuper session"], { style: "h4" }),
    both("cfgXuperKind", line, { color: "muted" }),
  ];
  if (st.geo) children.push(both("cfgXuperGeo", ["Tu zona: bloqueada por Xuper", "Your region: blocked by Xuper"], { color: "muted" }));
  const w = st.wait;
  const n = Math.max(1, Number(w && w.min) || 1);
  const usedUp = !!w && (w.why === "429" || w.why === "cap");
  if (w && w.why === "503") {
    children.push(both("cfgXuperWait", [`Ahora no hay sesiones de respaldo libres. Se puede pedir otra en ${n} min.`,
      `No backup sessions are free right now. Another one can be requested in ${n} min.`], { color: "muted", style: "caption" }));
  } else if (usedUp) {
    children.push(both("cfgXuperWait", [`Ya se usaron las sesiones de respaldo de esta hora. Podrás pedir otra en ${n} min.`,
      `This hour's backup sessions are used up. You can ask for another in ${n} min.`], { color: "muted", style: "caption" }));
  }
  if (st.kind === "seed" && !usedUp) {
    children.push(
      { type: "ElevatedButton", key: "seedChange", icon: "refresh",
        labelText: en() ? "Change seed" : "Cambiar semilla", labelTextEn: "Change seed", onPressed: busyEvent("seedChange") },
      both("cfgSeedChangeHint", ["Pide otra sesión de respaldo si esta va mal", "Asks for another backup session if this one goes wrong"],
        { color: "muted", style: "caption" }),
    );
  }
  children.push({ type: "ExpansionTile", key: "cfgSeedsWhat", items: [{
    key: "what", title: en() ? "What are seeds?" : "¿Qué son las semillas?", titleEn: "What are seeds?",
    children: [both("cfgSeedsWhatText", ["Sesiones anónimas que comparten otros aparatos. Se usan solo cuando Xuper bloquea tu zona o tu aparato no logra abrir su propia sesión.",
      "Anonymous sessions other devices share. They are used only when Xuper blocks your region or your device cannot open its own session."])],
  }] });
  return { type: "Card", key: "cfgXuper", children };
}

/** The "Aportar" card (the old plugin's, seed design §7): the `contributeSeeds` switch, its help and the last one. */
function contribCard(c, now) {
  const on = !(c && c.on === false);
  const at = c && Number(c.at) > 0 ? Number(c.at) : 0;
  return { type: "Card", key: "cfgContrib", children: [
    both("cfgContribTitle", ["Aportar", "Contribute"], { style: "h4" }),
    { type: "Switch", key: "contribSwitch", value: on,
      labelText: en() ? "Share an anonymous session" : "Aportar una sesión anónima", labelTextEn: "Share an anonymous session",
      onChanged: { event: "contrib" } },
    both("cfgContribHelp", ["De vez en cuando comparte una sesión anónima nueva, creada solo para eso: nunca la tuya ni tus datos. Se envía al servidor de Xuper con tu acceso.",
      "Now and then it shares a new anonymous session, created only for that: never yours, never your data. It is sent to Xuper's server with your access."],
    { color: "muted", style: "caption" }),
    at ? both("cfgContribAt", [`Último aporte ${agoText(now - at, false)}`, `Last contribution ${agoText(now - at, true)}`], { color: "muted", style: "caption" })
      : both("cfgContribAt", ["Este aparato aún no ha aportado.", "This device has not contributed yet."], { color: "muted", style: "caption" }),
    { type: "ExpansionTile", key: "cfgContribWhat", items: [{
      key: "what", title: en() ? "What is shared?" : "¿Qué se comparte?", titleEn: "What is shared?",
      children: [both("cfgContribWhatText", ["Una sesión de invitado anónima recién creada (un número de aparato y su permiso de acceso), comprobada antes de enviarla. Nunca tu cuenta, tu historial ni datos de este aparato. Como mucho una cada 3 horas.",
        "A brand-new anonymous guest session (a device number and its access grant), checked before it is sent. Never your account, your history or data about this device. At most one every 3 hours."])],
    }] },
  ] };
}

/** "7th", "22nd": an English ordinal. */
const ordinalEn = (n) => {
  const t = n % 100, u = n % 10;
  return n + (t >= 11 && t <= 13 ? "th" : u === 1 ? "st" : u === 2 ? "nd" : u === 3 ? "rd" : "th");
};

/**
 * The "Dispositivos" card (GET /devices, src/devices.js): how many phones of the person's `max` hold a session, each one
 * (newest first, as the backend lists them) with its plugins and when it was last seen, this one marked, the rule for
 * one more and how phones are counted. `d`: `{ used, max, list: [{ current, names, lastSeen }] }`.
 */
function devicesCard(d, now, device) {
  const used = Math.max(0, Math.floor(Number(d.used) || 0)), max = Math.max(1, Math.floor(Number(d.max) || 0));
  const next = max + 1;
  const me = device === "phone" ? ["Este teléfono", "This phone"] : ["Este aparato", "This device"];
  const rows = (d.list || []).map((x, i) => {
    const names = x.names && x.names.length ? x.names.join(" · ") : "—";
    const lines = [both("cfgDevN" + i, [names, names], { maxLines: 2, ...(x.current ? { color: "primary" } : {}) })];
    if (x.lastSeen > 0) {
      lines.push(both("cfgDevS" + i, [`Visto ${agoText(now - x.lastSeen, false)}`, `Seen ${agoText(now - x.lastSeen, true)}`],
        { color: "muted", style: "caption", maxLines: 1 }));
    }
    return { type: "Row", key: "cfgDev" + i, gap: 8, crossAxisAlignment: "center", children: [
      { type: "Column", key: "cfgDevC" + i, flex: 1, gap: 4, children: lines },
      ...(x.current ? [{ type: "Badge", key: "cfgDevMe" + i, text: en() ? me[1] : me[0], textEn: me[1], color: "primary" }] : []),
    ] };
  });
  return { type: "Card", key: "cfgDevices", children: [
    both("cfgDevTitle", [`Dispositivos: ${used} de ${max}`, `Devices: ${used} of ${max}`], { style: "h4" }),
    ...rows,
    both("cfgDevNote", [`Si activas un ${next}.º teléfono, se cierra la sesión del que usaste hace más tiempo.`,
      `If you activate a ${ordinalEn(next)} phone, the one you used longest ago is signed out.`], { color: "muted", style: "caption" }),
    { type: "ExpansionTile", key: "cfgDevWhat", items: [{
      key: "what", title: en() ? "How are they counted?" : "¿Cómo se cuentan?", titleEn: "How are they counted?",
      children: [
        both("cfgDevRule1", ["Un dispositivo es un teléfono, no un plugin: Xuper y Ultra HD en el mismo teléfono cuentan como uno.",
          "A device is a phone, not a plugin: Xuper and Ultra HD on the same phone count as one."], { style: "caption" }),
        both("cfgDevRule2", ["Un teléfono deja de contar si no lo usas durante unos 30 días: su sesión vence.",
          "A phone stops counting after about 30 days without use: its session expires."], { style: "caption" }),
        both("cfgDevRule3", [`Activar un ${next}.º teléfono no se rechaza: se cierra la sesión del que usaste hace más tiempo, y ese teléfono te pedirá activarlo de nuevo.`,
          `Activating a ${ordinalEn(next)} phone is not refused: the one you used longest ago is signed out, and that phone will ask you to activate it again.`], { style: "caption" }),
        both("cfgDevRule4", ["El límite es por cuenta de Telegram, no por red ni por IP.",
          "The limit is per Telegram account, not per network or IP."], { style: "caption" }),
      ],
    }] },
  ] };
}

export function configView({ version, device = "phone", ages = null, now = Date.now(), seeds = null, contrib = null, devices = null } = {}) {
  const E = en();
  const a = ages || {};
  const lines = [[["Catálogo", "Catalog"], a.catalog], [["Partidos", "Matches"], a.matches]];
  return {
    type: "Scaffold", ...scaffoldChrome(device, "config", []),
    body: scrollPage("cfg-scroll", 16, [
      { type: "Card", key: "cfgAccount", children: [
        { type: "Text", key: "cfgAccTitle", style: "h4", text: E ? "Account" : "Cuenta", textEn: "Account" },
        { type: "Text", key: "cfgAccHint", color: "muted",
          text: E ? "If Xuper stopped recognizing your identity, re-authenticate (no need to disconnect). Disconnecting takes you back to Activate."
            : "Si Xuper dejó de reconocer tu identidad, reautentícate (sin desconectar). Desconectarte te lleva de vuelta a «Activar».",
          textEn: "If Xuper stopped recognizing your identity, re-authenticate (no need to disconnect). Disconnecting takes you back to Activate." },
        { type: "ElevatedButton", key: "reauth", icon: "refresh",
          labelText: E ? "Re-authenticate" : "Reautenticar", labelTextEn: "Re-authenticate",
          onPressed: { event: "reauth", timeoutMs: PRESS_MS } },
        { type: "TextButton", key: "disconnect", icon: "lock",
          labelText: E ? "Disconnect" : "Desconectar", labelTextEn: "Disconnect",
          confirm: E ? "Disconnect Xuper?" : "¿Desconectar Xuper?", confirmEn: "Disconnect Xuper?",
          onPressed: { event: "disconnect", timeoutMs: PRESS_MS } },
      ] },
      { type: "Card", key: "cfgSupport", children: [
        { type: "Text", key: "cfgSupTitle", style: "h4", text: E ? "Support" : "Apoyar", textEn: "Support" },
        { type: "Text", key: "cfgSupHint", color: "muted",
          text: E ? "If you like Xuper, you can support it on Ko-fi." : "Si te gusta Xuper, puedes apoyarlo en Ko-fi.",
          textEn: "If you like Xuper, you can support it on Ko-fi." },
        supportButton("cfgSupportBtn", E, device),
      ] },
      ...(devices ? [devicesCard(devices, now, device)] : []),
      xuperSessionCard(seeds),
      contribCard(contrib, now),
      { type: "Card", key: "cfgData", children: [
        { type: "Text", key: "cfgDataTitle", style: "h4", text: E ? "Data" : "Datos", textEn: "Data" },
        ...lines.map(([label, age], i) => ({ type: "Text", key: "cfgAge" + i, color: "muted", style: "caption",
          text: ageLine(label, age, now, E), textEn: ageLine(label, age, now, true) })),
      ] },
      { type: "Card", key: "cfgAbout", children: [
        { type: "Text", key: "cfgAboutTitle", style: "h4", text: E ? "About" : "Acerca de", textEn: "About" },
        { type: "Text", key: "cfgVer", color: "muted", text: `Xuper ${version || ""}`.trim(), textEn: `Xuper ${version || ""}`.trim() },
      ] },
    ]),
  };
}
