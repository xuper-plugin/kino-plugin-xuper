// Xuper only on the latest Kino (owner rule, 2026-11-22). The minimum is the higher of the floor shipped here
// (MIN_KINO_FLOOR) and the one the backend last answered: while the backend enforces it, a request from an older Kino gets
// 426 `update_kino` with the minimum in `X-Min-Kino` (oleada-py kino_version.py), which raises the stored minimum, so a
// newer requirement reaches every device without a new Xuper. Below the minimum Xuper is not usable: its screen is the
// "Actualiza Kino" page and every content call fails with the same sentence.
import { MIN_KINO_FLOOR } from "./config.js";
import { getText, setText } from "./store.js";

const MIN_KEY = "o2:minKino";
const VER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})/;

/** "0.9.91" (or "0.9.91-debug", "0.9.91+1289") → [0, 9, 91]; null for anything else. */
export function parseVersion(v) {
  const m = typeof v === "string" ? VER.exec(v.trim()) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** <0, 0 or >0 as `a` is older, equal or newer than `b` (both parsed). */
function cmp(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** The Kino this runs on, as Kino names it ("" when it does not: the Node kit, an unknown host). */
export function kinoVersion() {
  try { return typeof kino.appVersion === "string" ? kino.appVersion : ""; } catch (_) { return ""; }
}

/** The minimum Kino Xuper needs now: the shipped floor, or the backend's last answer when higher. */
export function minKino() {
  const floor = parseVersion(MIN_KINO_FLOOR);
  const told = parseVersion(getText(MIN_KEY) || "");
  return told && cmp(told, floor) > 0 ? told.join(".") : floor.join(".");
}

/** Keeps the backend's minimum (its `X-Min-Kino`), when it is a version. */
export function learnMinKino(v) {
  const p = parseVersion(v || "");
  if (p) setText(MIN_KEY, p.join("."));
}

/** Whether this Kino is older than the minimum. A Kino that names no version is never blocked here (the backend still is). */
export function kinoTooOld() {
  const have = parseVersion(kinoVersion());
  return !!have && cmp(have, parseVersion(minKino())) < 0;
}

/** The sentence: which Kino is needed and where to get it. */
export function updateKinoText() {
  let en = false;
  try { en = String(kino.lang || "es").startsWith("en"); } catch (_) { /* es */ }
  return updateKinoTextIn(en ? "en" : "es");
}

/** The error every content call throws below the minimum: Kino shows its userMessage. */
export function updateKinoError() {
  const e = kino.error("unavailable", "Xuper: Kino " + (kinoVersion() || "?") + " is older than " + minKino(), { userMessage: updateKinoText() });
  try { e.updateKino = true; } catch (_) { /* frozen: the message says it */ }
  return e;
}

/** Whether `e` is the update-Kino error (thrown here, or built from a backend 426). */
export function isUpdateKino(e) {
  return !!e && (e.updateKino === true || /is older than \d/.test(String(e.message || "")));
}

/** Xuper's whole screen below the minimum: what to do, and nothing else to tap. */
export function updateKinoView() {
  return {
    type: "Scaffold",
    body: {
      type: "Column", mainAxisAlignment: "center", crossAxisAlignment: "center", padding: 24, gap: 16,
      children: [
        { type: "Icon", name: "download" },
        { type: "Text", style: "h3", text: "Actualiza Kino", textEn: "Update Kino" },
        { type: "Text", style: "p", text: updateKinoTextIn("es"), textEn: updateKinoTextIn("en") },
      ],
    },
  };
}

function updateKinoTextIn(lng) {
  const need = minKino();
  return lng === "en"
    ? `Xuper needs Kino ${need} or newer. Open Settings ▸ App ▸ Settings for all profiles ▸ Updates and tap "Check for updates".`
    : `Para usar Xuper necesitas Kino ${need} o más reciente. Abre Ajustes ▸ App ▸ Ajustes de todos los perfiles ▸ Actualizaciones y toca «Buscar actualizaciones».`;
}
