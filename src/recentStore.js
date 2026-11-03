// The titles the person played through Xuper, newest first: the browse screen's "Continuar viendo" row. Kino tells a
// plugin nothing about what is played, so the plugin notes it where it sees it: `resolve` (a play) hands it the ref. Only
// the title's contentId is kept (a series' chapters fold into their season), never a stream, a session or a time of day.
// One small kino.storage key; nothing here ever fails the caller.
import { decode } from "./refs.js";
import { isObject } from "./util.js";

const KEY = "recent:v1";
export const MAX_RECENT = 12;

export function makeRecentStore({ kino, clock }) {
  function read() {
    try {
      const raw = kino.storage.get(KEY);
      if (raw === null || raw === undefined) return [];
      const o = JSON.parse(raw);
      if (!isObject(o) || o.v !== 1 || !Array.isArray(o.e)) return [];
      return o.e.filter((x) => isObject(x) && typeof x.id === "string" && x.id !== "" && Number.isFinite(x.at)).slice(0, MAX_RECENT);
    } catch (_) { return []; }
  }

  /** Notes that the title behind [ref] was played now (a live channel or an unreadable ref is not noted). Never throws. */
  function note(ref) {
    try {
      const magis = decode(ref);
      if (!magis) return;
      const entries = read();
      if (entries[0] && entries[0].id === magis.contentId) return; // the same title again: nothing moves
      const next = [{ id: magis.contentId, at: clock.now() }, ...entries.filter((e) => e.id !== magis.contentId)].slice(0, MAX_RECENT);
      kino.storage.set(KEY, JSON.stringify({ v: 1, e: next }));
    } catch (_) { /* the row just misses a title */ }
  }

  /** The noted contentIds, newest first. */
  const ids = () => read().map((e) => e.id);

  return { note, ids };
}
