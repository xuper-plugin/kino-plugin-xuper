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
import { browseView, searchView } from "./browseView.js";
import { trace, errCode } from "./trace.js";

const TAB_KEY = "browseTab";

export function makeBrowse({ kino, catalog, recent, clock }) {
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

  // The last search: its words and the cards it found (memory only; the state holds the words and the status).
  let found = null;

  function view(ctx) {
    const st = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
    if (ctx.route && ctx.route.name === "search") {
      const query = typeof st.sq === "string" ? st.sq : "";
      const items = found && found.q === query ? found.items : null;
      const status = query === "" ? "idle" : st.sstate === "fail" ? "fail" : items ? "done" : "loading";
      return searchView({ query, status, items, history: query === "" ? readHistory() : [] });
    }
    const tab = TAB_IDS.includes(st.tab) ? st.tab : (tabFromArgs(ctx.route) ?? stored() ?? TAB_IDS[0]);
    paint(tab);
    const m = memo.get(tab);
    const pending = Array.isArray(st.pending) && st.pending.length > 0;
    return browseView({ tab, data: m ? m.data : null, recent: recentCards, pending, failed: !!(st.failed && st.failed[tab]) });
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
      return { state: { tab, pending: needed(tab, device), failed: null } };
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
    // The gear: the configuration (account, seeds, help) is its own page, one Back away.
    go({ arg }) { return arg === "settings" ? { route: { push: "settings" } } : null; },
    retry({ state, device }) {
      const tab = TAB_IDS.includes(state.tab) ? state.tab : TAB_IDS[0];
      return { state: { failed: null, pending: [tab, ...needed(tab, device).filter((t) => t !== tab)] } };
    },
    async tick({ state }) {
      const pending = Array.isArray(state.pending) ? state.pending : [];
      if (pending.length === 0) return null;
      const [next, ...rest] = pending;
      const failed = { ...(state.failed || {}) };
      try {
        const ok = await load(next);
        if (!ok) failed[next] = true; else delete failed[next];
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
