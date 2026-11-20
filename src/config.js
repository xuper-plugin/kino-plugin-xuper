// Config of the Xuper plugin. No crypto and no secrets here: sign-in, cookies, crypto and resolution live in the
// backend. The plugin is a client of the backend plus an egress relay.
// Here only: the backend's address, the published catalog's addresses and the sections of the menu.

// Must match the manifest's first `hosts` entry (test/wiring.test.mjs): a host the manifest does not declare would
// reach the backend only through `fetchHosts: "any"`, and moving it later would ask every person to approve again.
export const DEFAULT_SERVER = "https://x.xkplugins.site";

/** Must equal kino-plugin.json `version` (test/wiring.test.mjs checks it). */
export const PLUGIN_VERSION = "3.0.9";

/**
 * «Apoyar» (the welcome screen and Ajustes): Kino opens it with `go.url`, after its own sheet (a QR code on a TV), and
 * only from the person's own press. Not a fetch: it needs no `hosts` entry.
 */
export const SUPPORT_URL = "https://ko-fi.com/xuperplugins";

/**
 * Must equal kino-plugin.json `id` (test/wiring.test.mjs checks it). Kino signs this id into the identity answer, and the
 * backend's POST /session verifies the device signature over the id the body declares; a body without one is checked as
 * the test plugin's old id, so every sign-in of this plugin would fail.
 */
export const PLUGIN_ID = "xuper";

/**
 * Whether kino-plugin.json declares the `drm` capability (test/wiring.test.mjs pins it). Without it Kino refuses any
 * stream with a `drm` block, so a merged live channel skips its DRM members (caracol: Widevine) and plays another source.
 */
export const DRM_DECLARED = true;

// Published catalog data (no Bearer, no login: the publisher generates it, the plugin only reads it).
// - DATA_BASE (phase 2, primary): `index.json` + content-hashed immutable `v2/**` files on the `data` branch.
// - RELEASE_BASE (phase 1 and fallback): the legacy `home.json` / `matches.json` assets of the `catalog` Release.
// Test builds swap them with esbuild: --define:XUPER_DATA_BASE='"https://…/"' --define:XUPER_RELEASE_BASE='"https://…"'.
/* global XUPER_DATA_BASE, XUPER_RELEASE_BASE */
export const DATA_BASE = typeof XUPER_DATA_BASE === "string" ? XUPER_DATA_BASE
  : "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/data/";
export const RELEASE_BASE = typeof XUPER_RELEASE_BASE === "string" ? XUPER_RELEASE_BASE
  : "https://github.com/xuper-plugin/kino-plugin-xuper/releases/download/catalog";

/**
 * The backend's address. Fixed: 3.0.0 has no `server` setting (an address the person typed would receive the
 * identity token at /session), so nothing a setting holds is ever read here.
 */
export function serverUrl() {
  return DEFAULT_SERVER;
}

/** The visible language (es/en), the host's when it has one. */
export function lang() {
  try { return (typeof kino !== "undefined" && kino.lang) === "en" ? "en" : "es"; } catch (_) { return "es"; }
}

/**
 * Whether Kino draws an http picture on the screen (feature detection: `kino.screen.httpImages === true`, a Kino that
 * allows http pictures from public hosts). Without it an Image takes https only.
 */
export function httpImages() {
  try { return typeof kino !== "undefined" && !!kino && !!kino.screen && kino.screen.httpImages === true; } catch (_) { return false; }
}

/** A title that is either a plain string or `{ es, en }`, in the visible language (live category titles). */
export function localTitle(t) {
  if (t && typeof t === "object") return String((lang() === "en" ? t.en : t.es) || t.es || t.en || "");
  return String(t == null ? "" : t);
}

// The menu's sections (the "tabs") → the `name` the catalog (GitHub) and /section/{name} understand.
// `populares` = featured/recommended (its native shape is a carousel). `adultos` is 18+ and handled apart (gated by
// Kino's 18+ lock).
export const SECTIONS = [
  { name: "populares", title: "Populares", titleEn: "Popular", genre: "otros" },
  { name: "pelicula", title: "Películas", titleEn: "Movies", genre: "peliculas" },
  { name: "series", title: "Series", titleEn: "Series", genre: "series" },
  { name: "anime", title: "Anime", titleEn: "Anime", genre: "anime" },
  { name: "ninos", title: "Niños", titleEn: "Kids", genre: "infantil" },
  { name: "adultos", title: "Adultos", titleEn: "Adults", genre: "otros", adult: true },
];
