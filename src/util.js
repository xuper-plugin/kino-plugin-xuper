// Small helpers shared by the modules (one home, so a fix lands once and the bundle carries one copy).

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** The text of a value: null/undefined are "", a string is itself, anything else its `String()`. */
export const asText = (v) => (v === null || v === undefined ? "" : typeof v === "string" ? v : String(v));

/** org.json `optString` as the portal code reads it: only strings and numbers count, anything else is "". */
export const optStringStrict = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** Not a string at all counts as blank. */
export const isBlank = (s) => typeof s !== "string" || s.trim() === "";
export const notBlank = (s) => s.trim() !== "";

export const objects = (v) => (Array.isArray(v) ? v.filter(isObject) : []);

/** An error made by `kino.error(...)`: the host names it `KinoError_<code>`. */
export const isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");

const INT = /^[+-]?\d+$/;
/** Kotlin's `opt(k)?.toString()?.toIntOrNull()`: the value's text as an Int, or null. */
export function intOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  if (!INT.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
