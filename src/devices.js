// devices.js — Ajustes ▸ "Dispositivos": the phones that hold a session of this person's Telegram account (GET /devices,
// backend 71a1a3b). Asked once per visit to Ajustes (the screen's one-shot `devices` timer, src/screen.js), never
// polled; the answer stays in this runtime's memory for the visit, never in storage nor in the screen state. A 401 takes
// the path every endpoint takes (the Bearer is dropped and the screen signs in again, src/api.js); a 404 (an older
// backend), a 429 or any failure hides the card with no error text.
import { fetchDevices } from "./api.js";

const TIMEOUT_MS = 4000;    // the timer's own bound (Kino never preempts a tick: a tap waits behind it)
const MAX_ROWS = 12;        // the backend counts 6; a few more while one is being signed out
const MAX_NAME = 40;

// Each plugin id as the person knows it (deduplicated after mapping). An id not known here is shown as it comes, so what
// a phone holds always adds up. The backend already reads a phone's older registrations of this plugin as xuper.
const PLUGIN_NAMES = { xuper: "Xuper", "ultra-hd": "Ultra HD", "super-tv": "SuperTV" };

/** Plugin ids → readable names, in order, without repeats; unknown ids raw (trimmed). */
export function pluginNames(ids) {
  const out = [];
  for (const raw of Array.isArray(ids) ? ids : []) {
    const id = String(raw == null ? "" : raw).trim();
    if (!id) continue;
    const name = PLUGIN_NAMES[id.toLowerCase()] || id.slice(0, MAX_NAME);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

let card = null;   // null = not asked in this visit | { hidden: true } | { used, max, list: [{ current, names, lastSeen }] }

/** What the card draws: `{ used, max, list }`, or null (not loaded, or hidden). */
export function devicesNow() { return card && !card.hidden ? card : null; }

/** Whether this visit already asked (answered or hidden). */
export function devicesAsked() { return card !== null; }

/** A new visit to Ajustes: the next draw asks again. */
export function forgetDevices() { card = null; }

/** Asks the backend once (4 s at most). → whether the card has something to show. Never throws. */
export async function loadDevices() {
  let r;
  try { r = await fetchDevices(TIMEOUT_MS); } catch (_) { r = { ok: false, status: "network" }; }
  if (!r || !r.ok) {
    try { kino.log("devices: hidden (" + String(r && r.status) + ")"); } catch (_) { /* no log */ }
    card = { hidden: true };
    return false;
  }
  const list = r.devices
    .filter((d) => d && typeof d === "object" && !Array.isArray(d))
    .slice(0, MAX_ROWS)
    .map((d) => ({ current: d.current === true, names: pluginNames(d.plugins), lastSeen: Math.max(0, Number(d.lastSeen) || 0) }));
  card = { used: r.used, max: r.max, list };
  return true;
}
