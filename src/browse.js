// The browse screen (route "categories"): it paints at once from what is kept, then fills each tab as the portal answers.
//
// - `open` reads no network: the active tab is drawn from the kept rows (skeletons if none), and the tabs that still need
//   their rows become `pending` in the state.
// - A timer (`every`, only while something is pending) fetches ONE tab per tick, the active one first. Each tab is stored
//   by the catalog as soon as it arrives (rowsStore), so a slow root never holds the others back, and an interrupted
//   session loses nothing.
// - The tabs other than the active one are prefetched except on a TV (a weak box pays for every root it decodes): there they
//   load when selected.
// The state holds only `tab`, `pending` and `failed` (a few bytes); the trees live here, in memory, rebuilt from the kept rows.
import { isEnglish, isSpanish } from "./i18n.js";
import { TAB_IDS, tabOf, recentOf, cardOf } from "./browseModel.js";
import { browseView, searchView, liveView, detailPage } from "./browseView.js";
import { loadDetail, pushOf } from "./detailView.js";
import { trace, errCode } from "./trace.js";
import { makeMetaCache } from "./metaCache.js";

const TAB_KEY = "browseTab";

export function makeBrowse({ kino, catalog, recent, clock, liveTiles = null, countryRow = null, live = null }) {
  const meta = makeMetaCache({ kino, clock });
  /** [data] with what the meta cache knows: the cards' TMDB ids and the slides' title logos. */
  const enrich = (data) => (data ? {
    slides: data.slides.map((s) => { const k = meta.known(s.id); return k.logo ? { ...s, logo: k.logo } : s; }),
    rails: data.rails.map((r) => ({ ...r, items: meta.dress(r.items) })),
  } : data);
  const memo = new Map(); // tab -> { data, whole: the root's rows were fetched whole in this sandbox }
  let recentCards = [];
  let seen = null; // the kept rows the memo was built from (identity): a different set means rebuild

  const lang = () => ({ english: isEnglish(kino), spanish: isSpanish(kino) });
  const stored = () => { try { const t = kino.storage.get(TAB_KEY); return TAB_IDS.includes(t) ? t : null; } catch (_) { return null; } };
  const remember = (tab) => { try { kino.storage.set(TAB_KEY, tab); } catch (_) { /* the next start opens the first tab */ } };
  const idsOf = () => (typeof catalog.idsLookup === "function" ? catalog.idsLookup() : undefined);

  /** Draws [tab] from the rows the catalog keeps now (no network). */
  function paint(tab) {
    const kept = catalog.peek();
    if (!kept) return;
    if (seen !== kept.rows) { seen = kept.rows; for (const [t, m] of memo) if (!m.whole) memo.delete(t); }
    if (!memo.has(tab)) {
      const { english, spanish } = lang();
      const data = tabOf(kept.rows, tab, clock.now(), idsOf(), english, spanish);
      if (data) memo.set(tab, { data, whole: false });
    }
    const { english, spanish } = lang();
    recentCards = recentOf(kept.rows, recent.ids(), clock.now(), idsOf(), english, spanish);
  }

  const tabFromArgs = (route) => {
    const a = route && route.args && typeof route.args === "object" ? route.args : {};
    return TAB_IDS.includes(a.tab) ? a.tab : null;
  };

  /** The tabs to fetch: the active one if it is not whole yet, then the rest (not on a TV). */
  function needed(tab, device) {
    const order = [tab, ...TAB_IDS.filter((t) => t !== tab)];
    return order.filter((t, i) => (i === 0 || device !== "tv") && !(memo.get(t) && memo.get(t).whole));
  }

  // What searches found before (kino.storage, 24 cards, newest first, never an 18+ title): painted on the empty search page.
  const HIST_KEY = "searchHist:v1";
  const HIST_MAX = 24;
  const slim = (c) => ({ id: c.id, ref: c.ref, title: c.title, kind: c.kind, ...(c.poster ? { poster: c.poster } : {}) });
  function readHistory() {
    try {
      const raw = kino.storage.get(HIST_KEY);
      const o = raw ? JSON.parse(raw) : null;
      return o && o.v === 1 && Array.isArray(o.e) ? o.e.filter((c) => c && typeof c.id === "string" && typeof c.ref === "string" && typeof c.title === "string").slice(0, HIST_MAX) : [];
    } catch (_) { return []; }
  }
  function rememberFound(cards) {
    try {
      const fresh = cards.filter((c) => c.adult !== true).slice(0, 12).map(slim);
      const ids = new Set(fresh.map((c) => c.id));
      const next = [...fresh, ...readHistory().filter((c) => !ids.has(c.id))].slice(0, HIST_MAX);
      kino.storage.set(HIST_KEY, JSON.stringify({ v: 1, e: next }));
    } catch (_) { /* the page just has no history */ }
  }

  // Live: the home row (the person's country channels, else the first genre's) and the live page's genres and channels.
  const CHANNELS_CAP = 60;
  let liveRow = null; // null: not asked yet; []: asked, nothing
  let liveTilesList = null;
  let liveFound = null; // { q, items }: the last live search
  const liveChannels = new Map(); // tile ref -> cards
  const liveCards = (items) => (Array.isArray(items) ? items : []).filter((i) => i && typeof i.id === "string" && typeof i.ref === "string").slice(0, CHANNELS_CAP).map(cardOf);
  async function loadLiveRow() {
    let items = [];
    try {
      const row = countryRow ? await countryRow(clock.now() + 6_000) : null;
      items = row && Array.isArray(row.items) ? row.items : [];
      if (items.length === 0 && liveTiles) {
        const tiles = await liveTiles.tiles();
        if (tiles.length > 0) { const page = await liveTiles.browse(tiles[0].ref); items = page && page.items ? page.items : []; }
      }
    } catch (e) { trace(kino, "browse", "live_fail", { code: errCode(e) }); }
    liveRow = liveCards(items).slice(0, 20);
  }
  async function loadLiveTiles() {
    let tiles = [];
    try { tiles = liveTiles ? await liveTiles.tiles() : []; } catch (_) { tiles = []; }
    liveTilesList = tiles.filter((t) => t && typeof t.ref === "string" && typeof t.title === "string" && !t.adult).map((t) => ({ ref: t.ref, title: t.title }));
  }

  // The last search: its words and the cards it found (memory only; the state holds the words and the status).
  let found = null;
  const details = new Map(); // ref -> { d } | { d: null } (failed): the title pages loaded in this sandbox
  const paramsOf = (route) => (route && route.params && typeof route.params === "object" ? route.params : {});

  function view(ctx) {
    const st = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
    if (ctx.route && ctx.route.name === "detail") {
      const p = paramsOf(ctx.route);
      if (typeof p.open === "string" && typeof p.i === "string") {
        return detailPage({ r: { ref: p.open, id: p.i, kind: p.k === "movie" ? "movie" : "series", title: typeof p.t === "string" ? p.t : "" }, entry: details.get(p.open) || null, season: Number(st.season) || 0 });
      }
    }
    if (ctx.route && ctx.route.name === "search") {
      const query = typeof st.sq === "string" ? st.sq : "";
      const items = found && found.q === query ? found.items : null;
      const status = query === "" ? "idle" : st.sstate === "fail" ? "fail" : items ? "done" : "loading";
      return searchView({ query, status, items, history: query === "" ? readHistory() : [], device: ctx.device });
    }
    if (ctx.route && ctx.route.name === "live") {
      const cat = typeof st.lcat === "string" ? st.lcat : liveTilesList && liveTilesList[0] ? liveTilesList[0].ref : null;
      const lq = typeof st.lq === "string" ? st.lq : "";
      if (lq !== "") {
        const done = liveFound && liveFound.q === lq;
        return liveView({ tiles: liveTilesList, cat, items: done ? liveFound.items : null, query: lq, searching: !done, device: ctx.device });
      }
      return liveView({ tiles: liveTilesList, cat, items: cat && liveChannels.has(cat) ? liveChannels.get(cat) : null, device: ctx.device });
    }
    const tab = TAB_IDS.includes(st.tab) ? st.tab : (tabFromArgs(ctx.route) ?? stored() ?? TAB_IDS[0]);
    paint(tab);
    const m = memo.get(tab);
    const pending = Array.isArray(st.pending) && st.pending.length > 0;
    return browseView({ tab, data: m ? enrich(m.data) : null, recent: meta.dress(recentCards), live: liveRow || [], pending, failed: !!(st.failed && st.failed[tab]), device: ctx.device });
  }

  async function load(tab) {
    const rows = await catalog.rows("section", tab);
    const { english, spanish } = lang();
    const data = tabOf(rows, tab, clock.now(), idsOf(), english, spanish);
    if (data) memo.set(tab, { data, whole: true });
    seen = null;
    return data !== null;
  }

  const events = {
    open({ route, state, device }) {
      const tab = tabFromArgs(route) ?? (TAB_IDS.includes(state.tab) ? state.tab : stored() ?? TAB_IDS[0]);
      paint(tab);
      const list = needed(tab, device);
      const out = { state: { tab, pending: liveRow === null ? [...list.slice(0, 1), "live", ...list.slice(1)] : list, failed: null } };
      // A card, a slide or a result asked for a title: its page goes over the list, so Back returns to it.
      const a = route && route.args && typeof route.args === "object" ? route.args : {};
      if (typeof a.open === "string" && typeof a.i === "string" && (a.k === "movie" || a.k === "series")) {
        out.route = { push: "detail", params: { open: a.open, t: typeof a.t === "string" ? a.t.slice(0, 100) : "", k: a.k, y: Number(a.y) || 0, i: a.i } };
        out.state.season = null;
      }
      return out;
    },
    // A card of the list was tapped: its page goes over the list.
    openTitle({ arg }) {
      const route = pushOf(arg);
      return route ? { route, state: { season: null } } : null;
    },
    // The page's timer: loads the title once, then no timer.
    async dtick({ route }) {
      const p = paramsOf(route);
      if (typeof p.open !== "string" || details.has(p.open)) return { state: { dv: Date.now() } };
      try {
        details.set(p.open, { d: await loadDetail({ t: p.t, k: p.k, y: p.y }) });
      } catch (e) {
        trace(kino, "browse", "detail_fail", { code: errCode(e) });
        details.set(p.open, { d: null });
      }
      return { state: { dv: Date.now() } };
    },
    dretry({ route }) {
      details.delete(paramsOf(route).open);
      return { state: { dv: Date.now() } };
    },
    season({ value, arg }) {
      const n = parseInt(value != null ? value : arg, 10);
      return n > 0 ? { state: { season: n } } : null;
    },
    tab({ value, arg, state, device }) {
      const tab = TAB_IDS.includes(value) ? value : TAB_IDS.includes(arg) ? arg : null;
      if (!tab) return null;
      remember(tab);
      paint(tab);
      const failed = { ...(state.failed || {}) };
      delete failed[tab];
      const pending = [tab, ...(Array.isArray(state.pending) ? state.pending.filter((t) => t !== tab) : [])];
      return { state: { tab, pending: memo.get(tab) && memo.get(tab).whole ? pending.slice(1) : pending, failed } };
    },
    // The floating button: straight to the search page, empty and ready for the words.
    openSearch() { return { route: { push: "search" }, state: { sq: "", sstate: null } }; },
    // The search page's submit: the search page opens in this very plugin (skeletons first, results as they come).
    search({ value, route }) {
      const q = value && typeof value.q === "string" ? value.q.trim().slice(0, 100) : "";
      if (q === "") return null;
      const state = { sq: q, sstate: "loading" };
      return route && route.name === "search" ? { state } : { route: { push: "search" }, state };
    },
    // The search page's timer: one portal search per press, then no timer.
    async stick({ state }) {
      const q = typeof state.sq === "string" ? state.sq : "";
      if (q === "" || state.sstate !== "loading") return null;
      try {
        const out = await catalog.search({ q });
        found = { q, items: (Array.isArray(out) ? out : []).slice(0, 60).map(cardOf) };
        rememberFound(found.items);
        return { state: { sstate: "done" } };
      } catch (e) {
        trace(kino, "browse", "search_fail", { code: errCode(e) });
        return { state: { sstate: "fail" } };
      }
    },
    sretry({ state }) { return typeof state.sq === "string" && state.sq !== "" ? { state: { sstate: "loading" } } : null; },
    back() { return { route: { pop: true }, state: { sq: null, sstate: null } }; },
    // The live page's timer: the genres, then the picked genre's channels, one load per tick.
    async ltick({ state }) {
      const lq = typeof state.lq === "string" ? state.lq : "";
      if (lq !== "") {
        if (!(liveFound && liveFound.q === lq)) {
          let out = null;
          try { out = live ? await live.liveSearch({ q: lq }) : null; } catch (e) { trace(kino, "browse", "live_search_fail", { code: errCode(e) }); }
          liveFound = { q: lq, items: liveCards(out && out.items) };
        }
        return { state: { lq } };
      }
      if (!liveTilesList) { await loadLiveTiles(); return { state: { lcat: typeof state.lcat === "string" ? state.lcat : null } }; }
      const cat = typeof state.lcat === "string" ? state.lcat : liveTilesList[0] ? liveTilesList[0].ref : null;
      if (cat === null) { liveChannels.set("", []); return { state: { lcat: null } }; }
      if (!liveChannels.has(cat)) {
        let page = null;
        try { page = await liveTiles.browse(cat); } catch (e) { trace(kino, "browse", "live_page_fail", { code: errCode(e) }); }
        liveChannels.set(cat, liveCards(page && page.items));
      }
      return { state: { lcat: cat } };
    },
    // The live page's search box: its words show the matching channels; empty words go back to the genres.
    lsearch({ value }) {
      const q = value && typeof value.lq === "string" ? value.lq.trim().slice(0, 100) : "";
      return { state: { lq: q === "" ? null : q } };
    },
    lcat({ value }) { return typeof value === "string" && value !== "" ? { state: { lcat: value } } : null; },
    // The gear: the configuration (account, seeds, help) is its own page, one Back away.
    go({ arg }) {
      if (arg === "live") return { route: { push: "live" }, state: { lcat: null } };
      return arg === "settings" ? { route: { push: "settings" }, state: { fromBrowse: true } } : null;
    },
    retry({ state, device }) {
      const tab = TAB_IDS.includes(state.tab) ? state.tab : TAB_IDS[0];
      return { state: { failed: null, pending: [tab, ...needed(tab, device).filter((t) => t !== tab)] } };
    },
    async tick({ state }) {
      const pending = Array.isArray(state.pending) ? state.pending : [];
      if (pending.length === 0) return null;
      const [next, ...rest] = pending;
      const failed = { ...(state.failed || {}) };
      // The TMDB ids and title logos of a tab's first titles (slides first), a few lookups per tick; it asks again until all are known.
      if (typeof next === "string" && next.startsWith("meta:")) {
        const m = memo.get(next.slice(5));
        if (m) await meta.fill([...m.data.slides.map((s) => ({ id: s.id, title: s.title, kind: s.kind })), ...m.data.rails.flatMap((r) => r.items.slice(0, 6).map((c) => ({ id: c.id, title: c.title, kind: c.kind })))], 12_000);
        return { state: { pending: rest } };
      }
      if (next === "live") { await loadLiveRow(); return { state: { pending: rest } }; }
      try {
        const ok = await load(next);
        if (!ok) failed[next] = true; else delete failed[next];
        if (ok && meta.usable()) rest.unshift("meta:" + next);
      } catch (e) {
        trace(kino, "browse", "tab_fail", { code: errCode(e) });
        failed[next] = true;
      }
      return { state: { pending: rest, failed } };
    },
  };

  async function event(ev) {
    const handler = Object.hasOwn(events, ev.name) ? events[ev.name] : null;
    return handler ? (await handler({ ...ev, state: ev.state || {} })) ?? null : null;
  }

  return { view, event };
}
