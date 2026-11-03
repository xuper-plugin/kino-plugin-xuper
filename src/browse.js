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
import { TAB_IDS, tabOf, recentOf } from "./browseModel.js";
import { browseView } from "./browseView.js";
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

  function view(ctx) {
    const st = ctx.state && typeof ctx.state === "object" ? ctx.state : {};
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
