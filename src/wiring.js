// Production wiring: builds crypto, portal, session and catalog once from the host's `kino`.
// This is the only place that owns the real clock; everything else gets it injected.
import { makeCrypto } from "./crypto.js";
import { makePortal } from "./portal.js";
import { makeSession } from "./session.js";
import { makeCatalog } from "./catalog.js";
import { makeTmdb } from "./tmdb.js";
import { makeResolve } from "./resolve.js";
import * as constants from "./config.js";

let deps = null;

export function getDeps() {
  if (deps) return deps;
  const clock = { now: () => Date.now() };
  const crypto = makeCrypto(kino);
  const config = { hosts: constants.hosts, appId: constants.APP_ID, apkVersion: constants.APK_VERSION };
  let session = null; // the portal needs the session's sn and the session needs the portal: wired lazily
  const portal = makePortal({ kino, crypto, config, clock, snProvider: () => session.current().sn });
  session = makeSession({ kino, portal, clock });
  const tmdb = makeTmdb({ kino });
  const catalog = makeCatalog({ kino, portal, session, clock, tmdb });
  // resolve looks a series' chapter up in the catalog's cached chapter list (the one episodes fills).
  const resolve = makeResolve({ kino, portal, session, clock, config, portalChapters: catalog.portalChapters });
  deps = { clock, crypto, portal, session, tmdb, catalog, resolve };
  return deps;
}

const isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");

/** Runs an export's body: kino errors pass through, anything else becomes a plain `unavailable`. */
export async function guarded(body) {
  try {
    return await body(getDeps());
  } catch (e) {
    if (isKinoError(e)) throw e;
    try { kino.log("xuper: " + String((e && e.name) || "error")); } catch (_) {}
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
