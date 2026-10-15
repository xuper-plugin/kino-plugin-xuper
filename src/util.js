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

/** The first Kino that saves the form's unsaved edits before it runs an action button (0.9.63). */
const SAVES_BEFORE_ACTION = [0, 9, 63];

/**
 * Whether this Kino saves what is typed in the form before an action button runs, so the button acts on it. Older
 * ones run the button on what was SAVED: the person has to tap Guardar first, and the texts say so. A missing or
 * unreadable version counts as an old one. Never throws.
 */
export function savesBeforeAction(kino) {
  let version = "";
  try { version = kino && typeof kino.appVersion === "string" ? kino.appVersion.trim() : ""; } catch (_) { return false; }
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return false;
  for (let i = 0; i < 3; i++) {
    const n = Number(m[i + 1]);
    if (n !== SAVES_BEFORE_ACTION[i]) return n > SAVES_BEFORE_ACTION[i];
  }
  return true;
}

/**
 * The account the person's settings ask for. The sign-in fields ("Cuenta") win; when they are not both
 * filled, the pair typed in "Crear cuenta" is the account (a plugin cannot write its own settings, so the
 * account it creates has to live where it was typed). Pairs never mix: an email from one block and a
 * password from the other is not an account. Anything partial comes back as the sign-in fields hold it.
 */
export function configuredPair(config) {
  const t = (k) => asText(config.get(k)).trim();
  const own = { email: t("email"), password: t("password") };
  if (own.email !== "" && own.password !== "") return own;
  const created = { email: t("regEmail"), password: t("regPassword") };
  if (created.email !== "" && created.password !== "") return created;
  return own;
}

/** What the "Crear cuenta" steps read: the fields of that block, else the sign-in ones (older saved setups). */
export function creationFields(config) {
  const t = (k) => asText(config.get(k)).trim();
  return { email: t("regEmail") || t("email"), password: t("regPassword") || t("password") };
}
