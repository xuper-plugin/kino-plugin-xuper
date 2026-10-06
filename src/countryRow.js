// The Home "Canales en vivo" row (D4): the channels of the country the person picks, as a Home row
// of `kind: "live"` cards (apiVersion 6). Port of the native ui/live/CountryChannels.kt
// (CATEGORIES_BY_COUNTRY and the country part of homeChannelsRow). The plugin cannot read the SIM or
// the time zone, so the country is the `homeCountry` select setting (synced like every setting);
// "none" (the default) is no row. One categories read and one channels page per call, inside the
// caller's deadline; nothing is stored (R19: Kino caches the Home rows). Never throws: a failure is
// simply no row.
import { trace, errCode } from "./trace.js";
import { say } from "./i18n.js";

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
 * most 20 options, so Guatemala, Nicaragua and Belize are ONE option that stands for all three
 * ([OPTION_GROUPS]): the row reads each of their categories (today all "Centroamérica").
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
  { value: "GT-NI-BZ", label: "Guatemala, Nicaragua o Belice" },
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

/** Options that stand for several countries. */
const OPTION_GROUPS = Object.freeze({ "GT-NI-BZ": Object.freeze(["GT", "NI", "BZ"]) });

/** The countries a `homeCountry` value stands for: a group, one country of the map, or none. */
export function countriesOf(value) {
  if (typeof value !== "string") return [];
  if (Object.hasOwn(OPTION_GROUPS, value)) return [...OPTION_GROUPS[value]];
  return Object.hasOwn(CATEGORIES_BY_COUNTRY, value) ? [value] : [];
}

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
      // Each distinct category of the chosen countries, in order (a group may share one).
      const names = [...new Set(countriesOf(kino.config.get(HOME_COUNTRY_SETTING)).map((cc) => CATEGORIES_BY_COUNTRY[cc]))];
      if (names.length === 0) return null;
      const all = await live.categoriesWithin(deadline);
      const categories = names.map((n) => all.find((c) => c.name === n)).filter(Boolean);
      const channels = [];
      const seen = new Set();
      for (const category of categories) {
        if (channels.length >= COUNTRY_ROW_LIMIT) break;
        for (const c of await live.channelsWithin(category.id, deadline)) if (!seen.has(c.id) && seen.add(c.id)) channels.push(c);
      }
      const items = channels.slice(0, COUNTRY_ROW_LIMIT).map((c) => {
        const item = { kind: "live", id: c.id, title: c.title, ref: c.ref };
        if (c.logo) item.poster = c.logo;
        if (c.adult === true) item.adult = true;
        return item;
      });
      return items.length > 0 ? { id: COUNTRY_ROW_ID, title: say(kino, "liveChannelsRow"), items } : null;
    } catch (e) {
      trace(kino, "home", "live_row_fail", { code: errCode(e) }); // never fails home
      return null;
    }
  };
}
