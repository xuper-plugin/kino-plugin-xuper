// The Home "Canales en vivo" row (D4): the channels of the country the person picks, as a Home row
// of `kind: "live"` cards (apiVersion 6). Port of the native ui/live/CountryChannels.kt
// (CATEGORIES_BY_COUNTRY and the country part of homeChannelsRow). The plugin cannot read the SIM or
// the time zone, so the country is the `homeCountry` select setting (synced like every setting);
// "none" (the default) is no row. One categories read and one channels page per call, inside the
// caller's deadline; nothing is stored (R19: Kino caches the Home rows). Never throws: a failure is
// simply no row.

/**
 * Portal categories that represent a country, by ISO-3166 alpha-2 code, matched by NAME as the
 * portal returns it (accents included): the ids are the portal's own and could change. Guatemala,
 * Nicaragua and Belize have no category of their own: they fall to "Centroamérica".
 */
export const CATEGORIES_BY_COUNTRY = Object.freeze({
  CO: "Colombia",
  VE: "Venezuela",
  EC: "Ecuador",
  CL: "Chile",
  MX: "México",
  PE: "Perú",
  BO: "Bolivia",
  UY: "Uruguay",
  PY: "Paraguay",
  PA: "Panamá",
  PR: "Puerto Rico",
  ES: "España",
  CR: "Costa Rica",
  US: "Estados Unidos",
  HN: "Honduras",
  SV: "El Salvador",
  DO: "República Dominicana",
  GT: "Centroamérica",
  NI: "Centroamérica",
  BZ: "Centroamérica",
});

/**
 * The `homeCountry` select's options, exactly as kino-plugin.json declares them. A select takes at
 * most 20 options, so the three countries that share "Centroamérica" are one option (value GT).
 */
export const COUNTRY_OPTIONS = Object.freeze([
  { value: "none", label: "Ninguno" },
  { value: "BO", label: "Bolivia" },
  { value: "CL", label: "Chile" },
  { value: "CO", label: "Colombia" },
  { value: "CR", label: "Costa Rica" },
  { value: "EC", label: "Ecuador" },
  { value: "SV", label: "El Salvador" },
  { value: "ES", label: "España" },
  { value: "US", label: "Estados Unidos" },
  { value: "GT", label: "Guatemala, Nicaragua o Belice" },
  { value: "HN", label: "Honduras" },
  { value: "MX", label: "México" },
  { value: "PA", label: "Panamá" },
  { value: "PY", label: "Paraguay" },
  { value: "PE", label: "Perú" },
  { value: "PR", label: "Puerto Rico" },
  { value: "DO", label: "República Dominicana" },
  { value: "UY", label: "Uruguay" },
  { value: "VE", label: "Venezuela" },
]);

export const HOME_COUNTRY_SETTING = "homeCountry";
export const COUNTRY_ROW_ID = "live-country";
export const COUNTRY_ROW_TITLE = "Canales en vivo";
/** Cards in the row: a shortcut, the full grid is one tap away in En vivo. */
export const COUNTRY_ROW_LIMIT = 20;

/**
 * `live`: the live catalog's `categoriesWithin(deadline)` / `channelsWithin(id, deadline)`.
 * Answers `async (deadline) => row | null`.
 */
export function makeCountryRow({ kino, live }) {
  return async function countryRow(deadline) {
    try {
      const iso = kino.config.get(HOME_COUNTRY_SETTING);
      if (typeof iso !== "string" || !Object.hasOwn(CATEGORIES_BY_COUNTRY, iso)) return null;
      const name = CATEGORIES_BY_COUNTRY[iso];
      const category = (await live.categoriesWithin(deadline)).find((c) => c.name === name);
      if (!category) return null;
      const channels = await live.channelsWithin(category.id, deadline);
      const items = channels.slice(0, COUNTRY_ROW_LIMIT).map((c) => {
        const item = { kind: "live", id: c.id, title: c.title, ref: c.ref };
        if (c.logo) item.poster = c.logo;
        if (c.adult === true) item.adult = true;
        return item;
      });
      return items.length > 0 ? { id: COUNTRY_ROW_ID, title: COUNTRY_ROW_TITLE, items } : null;
    } catch (e) {
      try { kino.log(`xuper home live row: ${(e && (e.code || e.name)) || "error"}`); } catch (_) { /* never fails home */ }
      return null;
    }
  };
}
