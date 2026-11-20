// screen.js — the plugin's own screen (capability "screen") and its state machine.
// Gate: no Bearer → welcomeView (Welcome + Activate). Identity (ensureBearer) runs from the Activate press, and from
// the reserved `open` event only when the backend refused a Bearer the person had activated (a 401 while the person
// never pressed "Desconectar": the backend moved or lost its sessions), or when this device updated from Xuper 2.x and
// never signed in (src/upgrade.js). Then the screen keeps showing the app and `open` signs in with no tap (Kino
// approved the identity at install or at the update; no consent sheet per call). An identity answer without the gate
// token (a Kino that gives it to other authors only) shows the welcome view saying Kino must be updated. After that sign-in,
// `open` also prepares the person's trial session from this device (src/api.js `trialAtOpen`: at most once every 6 h,
// never while the stored one is valid), alongside the revalidation. With a
// Bearer → the app, navigated by Kino's bottom bar: home (catalog) / deportes / vivo / config.
//
// `screen()` is a pure view: no kino.fetch, no pending work. The catalog and the matches come from src/data.js
// (L0, else one synchronous storage read), so a cold runtime paints full content in its first frame. The reserved
// `open` event migrates old storage once and revalidates when due, answering `{state: {rev}}` only when something
// changed. "Reintentar"/reload force a revalidation inside the event, under the busy bar.
// The live tabs (Vivo, Fútbol ▸ Canales) draw from src/live.js without the network: the exposed categories (virtual
// ones: Colombia, Deportes…), lists from storage and code. Vivo lands on Colombia, Canales on Deportes (both paint from
// code lists at once). A category picked with no list stored at all loads in that event (under the busy bar, 8 s); one
// that is partly stored answers at once. The `lvRefresh` tick loads the missing member lists a batch per tick (and
// refreshes a stale one, or goes on with a listing cut short: xuper's all-channels column, 250 a page, keeps its pages
// so far and the next tick fetches the next ones), and network sources never listed are fetched by the `lcFill` tick,
// one source per tick.
// Kino never preempts a running tick (a person's tap waits behind it), so every tick has its own short bounds:
// lvRefresh 3 s (6 s to load missing lists), lcFill 4 s per source, the Fútbol clock 4 s. lvRefresh goes on while a
// tick loaded or refreshed some member list and more are missing or stale, at most LV_MAX_TICKS per category
// (`state.lvN[cat]`), then marks it tried
// (`state.lvTried[cat]`); lcFill stops when nothing is left or after 8 ticks (`state.lcTried`, `state.lcN`). The
// channel grid shows `state.lvShown` channels (more on `lvMore`) of page `state.lvPage` (LV_PAGE each). The state holds only
// category ids, counters and revisions, never a channel list.
// Ajustes (1.0.46) draws the phones of the person's account ("Dispositivos", GET /devices once per visit through the
// one-shot `devices` timer, src/devices.js), the Xuper session (own, a backup seed and its time left, none) and the Aportar switch; its
// `seedChange` event is the person's "Cambiar semilla" (one GET /seed per tap, src/seeds.js) and `contrib` writes the
// `contributeSeeds` setting. Neither the screen nor its timers ever ask for a seed on their own.
import { ensureBearer, currentBearer, clearBearer, reloginPending, forgetRelogin, sessionExpiredText, trialAtOpen, isTokenMissing, reportActivate, activateBanner } from "./api.js";
import { screenCategories, screenList, loadList, fillScreenCategories, exposedIdOf, TICK_BOUNDS, TICK_LOAD_BOUNDS, PICK_BOUNDS } from "./live.js";
import { welcomeView, catalogView, deportesView, vivoView, configView, liveSignature, SEARCH_FIELD, LV_STEP, LV_PAGE } from "./screenView.js";
import { SECTIONS, PLUGIN_VERSION, lang } from "./config.js";
import { catalog, matches, revalidate, dataAges, loadFallbackSection, fallbackSectionView } from "./data.js";
import { sectionView } from "./v2.js";
import { sessionStatus } from "./sources/xuper.js";
import { manualChange } from "./seeds.js";
import { contribInfo } from "./seedContrib.js";
import { devicesNow, devicesAsked, forgetDevices, loadDevices } from "./devices.js";

const HIDE_BUSY = [{ hide: "busy" }];
// A timer's answer drops `ui`: it hides the busy bar through the state instead (Kino merges `ui.hidden` per key).
const TICK_HIDE_BUSY = { ui: { hidden: { busy: true } } };
const EMPTY_VIEW = { slides: [], rails: [], genres: [], all: [] };
const LC_FILL_MAX_TICKS = 8;     // lcFill: at most this many one-source steps per opening
const LV_MAX_TICKS = 5;          // lvRefresh: at most this many batches per category per opening
const CLOCK_BUDGET_MS = 4000;    // the Partidos clock tick's matches revalidation

function navName(v) {
  const s = String(v);
  return (s === "deportes" || s === "vivo" || s === "config") ? s : "home";
}
function tabName(v) {
  const n = String(v == null ? "" : v).toLowerCase();
  return SECTIONS.some((s) => s.name === n) ? n : SECTIONS[0].name;
}
function todayStr() {
  try { const d = new Date(Date.now()); const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }
  catch (_) { return ""; }
}
const matchList = () => { const m = matches(); return m ? m.matches : null; };

// Landing category: the last one chosen (in state; an old raw id lands on the category its raw category went into),
// else Colombia (Vivo) / Deportes (Canales): both paint from code lists with no request.
function landing(cats, prefer) {
  if (!Array.isArray(cats) || !cats.length) return "";
  const hit = cats.find((c) => c && c.id === prefer);
  return String((hit || cats[0]).id);
}
async function chosen(want, cats, prefer) {
  const w = String(want || "");
  if (w && cats.some((c) => c.id === w)) return w;
  const to = w ? await exposedIdOf(w) : "";
  return to && cats.some((c) => c.id === to) ? to : landing(cats, prefer);
}

/** The live tab on screen now: `{ kind: "vivo"|"football", stateKey }`, or null when no live tab is shown. */
function liveTab(state) {
  const nav = navName(state.nav);
  if (nav === "vivo") return { kind: "vivo", stateKey: "liveCat", prefer: "v.co" };
  if (nav === "deportes" && state.depTab === "canales") return { kind: "football", stateKey: "sportsCat", prefer: "v.sports" };
  return null;
}

/** Categories and the current category of a live tab, without the network. */
async function liveTabData(tab, state) {
  const { cats, missing } = await screenCategories(tab.kind);
  const cat = await chosen(state[tab.stateKey], cats, tab.prefer);
  return { cats, missing, cat };
}

const countOf = (map, cat) => (map && cat && Number(map[cat])) || 0;

/**
 * What a live tab draws: the list (no network), its one-shot timers and the part of the grid on screen. A merged
 * category's members are judged one by one: a source failing recently stops neither the refresh of the others nor
 * the drawing, and the offline note shows only when every stale list on screen is stale because its source failed
 * (never because a tick ran out of its own time).
 */
async function liveView(tab, state) {
  const { cats, missing, cat } = await liveTabData(tab, state);
  const tried = !!(state.lvTried && cat && state.lvTried[cat]);
  const st = cat ? await screenList(cat) : { items: [], stale: false, code: true, failed: false, partial: false, refreshable: 0 };
  const down = st.failed && !st.partial;   // nothing left to load: what is missing failed recently
  const timers = [];
  if (!st.code && !tried && !state.lvStop && (st.items === null || st.partial || st.refreshable > 0)) timers.push({ ms: 1000, event: "lvRefresh" });
  if (missing && !state.lcTried) timers.push({ ms: 1000, event: "lcFill" });
  return {
    cats, cat, timers,
    channels: st.items,
    shown: Math.min(LV_PAGE, Math.max(LV_STEP, Number(state.lvShown) || LV_STEP)),
    page: Math.max(0, Math.floor(Number(state.lvPage) || 0)),
    loading: st.items === null && !tried && !down,
    failed: st.items === null && (tried || down),
    offline: st.items !== null && st.stale && st.failed && !st.refreshable,
  };
}

/**
 * The lvRefresh tick's progress on the category on screen: how many member lists it has, whether more are missing,
 * how many stale ones a tick could refresh, how many channels it shows and how many lists are a listing cut short
 * (their channels so far are stored: the tick goes on with the next pages).
 */
async function listProgress(cat) {
  const st = await screenList(cat);
  return { have: st.have || 0, partial: !!st.partial, refreshable: st.refreshable || 0,
    n: Array.isArray(st.items) ? st.items.length : 0, resume: st.resume || 0 };
}

export async function screen(arg) {
  const state = (arg && arg.state) || {};
  const device = (arg && arg.device) || "phone";   // "phone" | "tv" | "desktop" (on TV the bottom bar is a TabBar)
  // Never mints; only reads. A Bearer the backend refused keeps the app on screen while `open` signs in again.
  if (!(await currentBearer()) && (state.actError || !reloginPending())) return welcomeView({ error: state.actError, device });
  const nav = navName(state.nav);

  if (nav === "config") {
    const view = configView({ version: PLUGIN_VERSION, device, ages: dataAges(), now: Date.now(), seeds: sessionStatus(), contrib: contribInfo(),
      devices: devicesNow() });
    // "Dispositivos": asked once per visit by a one-shot timer (the view shows at once; the card appears when it answers).
    return !devicesAsked() && !state.devTried ? { ...view, every: [{ ms: 1000, event: "devices" }] } : view;
  }

  if (nav === "deportes") {
    const depTab = state.depTab === "canales" ? "canales" : "partidos";
    if (depTab === "canales") {
      const lv = await liveView(liveTab(state), state);
      return deportesView({ depTab, cats: lv.cats, cat: lv.cat, channels: lv.channels, chLoading: lv.loading,
        chFailed: lv.failed, chOffline: lv.offline, timers: lv.timers, shown: lv.shown, page: lv.page, device });
    }
    return deportesView({ depTab, matches: matchList(), failed: !!state.matFail, depDate: state.depDate,
      depView: state.depView, today: todayStr(), now: Date.now(), device });
  }

  if (nav === "vivo") {
    const lv = await liveView(liveTab(state), state);
    return vivoView({ cats: lv.cats, cat: lv.cat, channels: lv.channels, loading: lv.loading, failed: lv.failed,
      offline: lv.offline, timers: lv.timers, shown: lv.shown, page: lv.page, device });
  }

  const tab = tabName(state.tab);
  const v2 = catalog();
  const view = v2 ? (sectionView(v2, tab) || EMPTY_VIEW) : fallbackSectionView(tab);
  return catalogView({ tab, view, fTag: state.fTag, device, failed: !!state.catFail });
}

// With nothing stored and GitHub failing, the screen still shows the section from the backend (Bearer), never stored.
async function tryFallback(tab) {
  if (catalog() || fallbackSectionView(tab)) return;
  if (!(await currentBearer())) return;
  try { await loadFallbackSection(tab); } catch (_) { /* still nothing: the error banner shows */ }
}

/** State flags after a load: `catFail`/`matFail` only while nothing is stored (or in memory) for that part. */
function failFlags(tab) {
  return { catFail: !catalog() && !fallbackSectionView(tab), matFail: !matches() };
}

/**
 * The `open` event's sign-in after the backend refused the stored Bearer (`reloginPending`): identity again, no tap.
 * → a state patch: `{ auth }` (re-render with the new Bearer) | `{ actError: true }` when the person's identity said no
 * (switched off, or this device holds no token: the welcome view asks) | `{ actError: "update" }` when identity answered
 * without the gate token (the welcome view says to update Kino) | `{}` (nothing to do, or the backend is down: the app
 * stays, a later opening tries again).
 */
async function relogin() {
  if ((await currentBearer()) || !reloginPending()) return {};
  try {
    await ensureBearer();
    return { auth: Date.now(), actError: null };
  } catch (e) {
    const code = e && e.code;
    try { kino.log("screen: sign-in again failed: " + (code || (e && e.message) || e)); } catch (_) { /* no log */ }
    if (isTokenMissing(e)) {
      forgetRelogin();
      reportActivate(e);
      return { actError: "update" };
    }
    if (code === "permission_denied" || code === "not_available" || code === "bad_request") {
      forgetRelogin();
      reportActivate(e);
      return { actError: activateBanner(e) };   // "consent" (identity off) or "server"
    }
    return {};
  }
}

async function onEvent(e, val, state) {
  switch (e) {
    case "open": {
      forgetDevices();   // a new opening: Ajustes asks for its devices again
      const auth = await relogin();
      const [r] = await Promise.all([revalidate({ catalog: true, matches: true }), trialAtOpen()]);   // trialAtOpen never throws
      const tab = tabName(state.tab);
      const hadFallback = !!fallbackSectionView(tab);
      await tryFallback(tab);
      const flags = failFlags(tab);
      const patch = { ...auth };
      if (navName(state.nav) === "config" && state.devTried) patch.devTried = null;
      if (r.changed || (!hadFallback && fallbackSectionView(tab))) patch.rev = r.rev;
      if (flags.catFail) patch.catFail = true;
      if (flags.matFail) patch.matFail = true;
      return Object.keys(patch).length ? { state: patch } : {};
    }
    case "activate":
      try { await ensureBearer(); return { state: { actError: null } }; }   // identity HERE (a press)
      catch (e) { reportActivate(e); return { state: { actError: activateBanner(e) } }; }   // "update" | "consent" | "server"
    case "disconnect":
      try { await clearBearer(); } catch (_) { /* best-effort */ }
      return { state: {} };
    case "seedChange": {
      // Ajustes ▸ "Cambiar semilla" (only drawn while on a seed): at most ONE GET /seed per tap, within the taps' own
      // budget (src/seeds.js: one per 10 min, two per UTC hour, never the hour's last).
      const r = await manualChange();
      return { toast: seedChangeToast(r), state: { sRev: Date.now() }, ui: HIDE_BUSY };
    }
    case "devices":
      // Timer (Ajustes ▸ Dispositivos): GET /devices once per visit, 4 s at most; the card shows the answer or stays
      // hidden (src/devices.js). A timer's answer keeps only `state`.
      if (navName(state.nav) === "config") await loadDevices();
      return { state: { devTried: true, devRev: Date.now() } };
    case "contrib":
      // Ajustes ▸ Aportar: the person's switch, written to the `contributeSeeds` setting by Kino.
      return { config: { contributeSeeds: val === true || val === "true" }, state: { cRev: Date.now() } };
    case "nav": {
      // No network: the live tabs land on a code-only category, or on a stored one (a missing list is the tick's).
      const nav = navName(val);
      const patch = { nav };
      if (nav === "deportes" && state.depTab !== "canales") patch.liveSig = liveSignature(matchList(), Date.now());
      if (nav === "config" && navName(state.nav) !== "config") {   // a new visit to Ajustes asks for its devices again
        forgetDevices();
        if (state.devTried) patch.devTried = null;
      }
      return { state: patch, ui: HIDE_BUSY };
    }
    case "tab": {
      const tab = tabName(val);
      await tryFallback(tab);
      return { state: { tab, fTag: "" } };   // switching section clears the filter
    }
    case "fTag": return { state: { fTag: String(val || "") } };
    case "search": {
      // The search sheet's field (its submit or its icon): Kino's search with this plugin as the source. Kino refuses
      // an empty `q` (1 to 200 characters), so an empty field does nothing.
      // The text comes as the event's value (a submit) or in `state.inputs` (the icon's tap): the first one not blank.
      const typed = [val, state.inputs && state.inputs[SEARCH_FIELD]].find((x) => (typeof x === "string" || typeof x === "number") && String(x).trim());
      const q = String(typed == null ? "" : typed).trim().slice(0, 200);
      return q ? { go: { search: { q } }, ui: [{ close: "searchSheet" }] } : {};
    }
    case "liveCat":
    case "sportsCat": {
      // The picker showed the busy bar locally. A category with some list stored (or code) answers at once (the
      // lvRefresh tick loads its missing members); one with nothing stored is loaded here (8 s at most). The grid
      // starts again at its top.
      const cat = String(val == null ? "" : val);
      const patch = { [e]: cat, lvShown: null, lvPage: null };
      const st = await screenList(cat);
      if (st.items === null) {
        let ok = false;
        try { ok = await loadList(cat, { bounds: PICK_BOUNDS }); } catch (_) { ok = false; }
        if (!ok) patch.lvTried = { ...(state.lvTried || {}), [cat]: true };
      }
      return { state: patch, ui: HIDE_BUSY };
    }
    case "lvRefresh": {
      // Timer: loads the next batch of the category's missing member lists (or refreshes its stale ones) under the
      // tick's own short bounds. It goes on while lists are still missing or stale and this tick loaded or refreshed
      // some, at most LV_MAX_TICKS times; then it marks the category tried so the redraw drops the timer, whatever
      // happened (a failed or skipped refresh must not tick every second). A refresh that misses its deadline keeps the
      // stored list.
      const tab = liveTab(state);
      if (!tab) return { state: { ...TICK_HIDE_BUSY } };
      const { cat } = await liveTabData(tab, state);
      if (!cat) return { state: { ...TICK_HIDE_BUSY } };
      const before = await listProgress(cat);
      const bounds = before.have === 0 || before.partial || before.resume > 0 ? TICK_LOAD_BOUNDS : TICK_BOUNDS;
      try { await loadList(cat, { bounds }); } catch (_) { /* the view shows the stale list or the failure */ }
      const after = await listProgress(cat);
      const n = countOf(state.lvN, cat) + 1;
      const progressed = after.have > before.have || after.refreshable < before.refreshable || after.n > before.n;
      const done = !(after.partial || after.refreshable > 0) || !progressed || n >= LV_MAX_TICKS;
      const patch = done ? { lvTried: { ...(state.lvTried || {}), [cat]: true } } : { lvN: { ...(state.lvN || {}), [cat]: n } };
      return { state: { ...patch, lvRev: Date.now(), ...TICK_HIDE_BUSY } };
    }
    case "lvMore": {
      // The grid reached its last channel: show the rest of this page (src/screenView.js LV_STEP, LV_PAGE).
      const shown = Math.min(LV_PAGE, (Number(state.lvShown) || LV_STEP) + LV_STEP);
      return shown === Number(state.lvShown) ? {} : { state: { lvShown: shown } };
    }
    case "lvPage": {
      // "Siguientes" / "Anteriores": another page of a category with more than LV_PAGE channels.
      const page = Math.max(0, Math.floor(Number(val) || 0));
      return { state: { lvPage: page, lvShown: null }, ui: HIDE_BUSY };
    }
    case "lcFill": {
      // Timer: one network source never listed gets its categories per tick (≤ 4 s). The timer stays in the tree
      // while sources are missing; it stops when none is left (or each left one is in its backoff) or after
      // LC_FILL_MAX_TICKS steps in this opening.
      const { n, left } = await fillScreenCategories();
      const ticks = (Number(state.lcN) || 0) + 1;
      const done = left === 0 || ticks >= LC_FILL_MAX_TICKS;
      return { state: { lcN: ticks, ...(n ? { lcRev: Date.now() } : {}), ...(done ? { lcTried: true } : {}), ...TICK_HIDE_BUSY } };
    }
    case "depDate": return { state: { depDate: String(val) } };
    case "depView": return { state: { depView: val === "todos" ? "todos" : "ligas" } };
    case "depTab": {
      const depTab = val === "canales" ? "canales" : "partidos";
      const patch = { depTab };
      if (depTab !== "canales") patch.liveSig = liveSignature(matchList(), Date.now());
      return { state: patch, ui: HIDE_BUSY };
    }
    case "clock": {
      // Partidos timer: revalidates the matches when due (long-open screens on TV), re-renders only when the
      // data changed or a LIVE badge flipped. A timer answer keeps only `state`.
      const r = await revalidate({ matches: true, budgetMs: CLOCK_BUDGET_MS });
      const sig = liveSignature(matchList(), Date.now());
      if (!r.changed && sig === state.liveSig) return {};
      return { state: { liveSig: sig, ...(r.changed ? { rev: r.rev } : {}) } };
    }
    case "reload": {
      const r = await revalidate({ catalog: true, force: true });
      const tab = tabName(state.tab);
      await tryFallback(tab);
      return { state: { rev: r.rev, catFail: failFlags(tab).catFail }, ui: HIDE_BUSY };
    }
    case "reloadDep": {
      const r = await revalidate({ matches: true, force: true });
      return { state: { rev: r.rev, matFail: !matches(), liveSig: liveSignature(matchList(), Date.now()) }, ui: HIDE_BUSY };
    }
    case "reloadVivo": {
      // "Recargar"/"Reintentar" on a live tab: the list on screen is fetched again now, and the lcFill tick may
      // run once more for sources still without categories.
      const tab = liveTab(state);
      const patch = { lvRev: Date.now(), lcTried: null, lcN: null, lvStop: null };
      if (tab) {
        const { cat } = await liveTabData(tab, state);
        if (cat) {
          try { await loadList(cat, { force: true, bounds: PICK_BOUNDS }); } catch (_) { /* the view shows the failure */ }
          patch.lvTried = { ...(state.lvTried || {}), [cat]: true };
          patch.lvN = { ...(state.lvN || {}), [cat]: 0 };
        }
      }
      return { state: patch, ui: HIDE_BUSY };
    }
    default: return {};
  }
}

/** The toast after "Cambiar semilla" (ES + EN). */
function seedChangeToast(r) {
  const result = r && r.result;
  const n = Math.max(1, Number(r && r.min) || 1);
  const [text, textEn, role] =
    result === "ok" ? ["Semilla cambiada", "Seed changed", "success"]
      : result === "hour" ? [`Ya pediste muchas sesiones de respaldo esta hora; podrás pedir otra en ${n} min.`,
        `You asked for many backup sessions this hour; you can ask for another in ${n} min.`, "warning"]
      : result === "used" ? [`Ya se usaron las sesiones de respaldo de esta hora; podrás pedir otra en ${n} min.`,
        `This hour's backup sessions are used up; you can ask for another in ${n} min.`, "warning"]
      : result === "soon" ? [`Acabas de pedir una sesión de respaldo; podrás pedir otra en ${n} min.`,
        `You just asked for a backup session; you can ask for another in ${n} min.`, "warning"]
        : result === "offline" ? ["Sin conexión, reintenta", "No connection, try again", "error"]
          : result === "nobearer" ? [sessionExpiredText("es"), sessionExpiredText("en"), "warning"]
            : ["Ahora no hay sesiones de respaldo libres; inténtalo en unos minutos.", "No backup sessions are free right now; try again in a few minutes.", "warning"];
  return { text: lang() === "en" ? textEn : text, textEn, role };
}

export async function screenEvent(ev) {
  const e = ev && (ev.name != null ? ev.name : ev.event);
  const val = ev && (ev.value != null ? ev.value : ev.arg);
  const state = (ev && ev.state) || {};
  try {
    return await onEvent(e, val, state);
  } catch (err) {
    try { kino.log("screenEvent " + e + " failed: " + ((err && (err.code || err.message)) || err)); } catch (_) { /* no log */ }
    // A timer's answer keeps only `state`: a one-shot tick that failed must still switch itself off.
    if (e === "lvRefresh") return { state: { lvStop: true, ...TICK_HIDE_BUSY } };
    if (e === "lcFill") return { state: { lcTried: true, ...TICK_HIDE_BUSY } };
    if (e === "devices") return { state: { devTried: true } };
    return { ui: HIDE_BUSY };   // never leave the busy bar spinning
  }
}
