// Production wiring: builds crypto, portal, session and catalog once from the host's `kino`.
// This is the only place that owns the real clock; everything else gets it injected.
import { makeCrypto } from "./crypto.js";
import { makePortal } from "./portal.js";
import { makeSession } from "./session.js";
import { makeCatalog } from "./catalog.js";
import { makeTmdb } from "./tmdb.js";
import { makeResolve } from "./resolve.js";
import { makeLiveCatalog } from "./liveCatalog.js";
import { makeLive } from "./live.js";
import { makeSection } from "./section.js";
import { makeCategories } from "./categories.js";
import { makeCountryRow } from "./countryRow.js";
import * as constants from "./config.js";
import { isKinoError } from "./util.js";
import { trace, errCode } from "./trace.js";

let deps = null;

// The real clock. `sign()` reads it too: it runs in the signing lane, where only kino.crypto,
// kino.secret, kino.config, kino.html and kino.log exist, so `Date` is the only time it has.
export const clock = { now: () => Date.now() };

export function getDeps() {
  if (deps) return deps;
  const crypto = makeCrypto(kino);
  const config = { hosts: constants.hosts, appId: constants.APP_ID, apkVersion: constants.APK_VERSION };
  let session = null; // the portal needs the session's sn and the session needs the portal: wired lazily
  const portal = makePortal({ kino, crypto, config, clock, snProvider: () => session.current().sn });
  session = makeSession({ kino, portal, clock, shared: { email: constants.SHARED_EMAIL, password: constants.SHARED_PASSWORD } });
  const tmdb = makeTmdb({ kino, clock });
  const live = makeLiveCatalog({ kino, portal, session, clock });
  const catalog = makeCatalog({ kino, portal, session, clock, tmdb, countryRow: makeCountryRow({ kino, live }) });
  // A bare channel code resolves through liveStream; the rest stays VOD.
  const liveStream = makeLive({ kino, portal, session, clock, config });
  // resolve looks a series' chapter up in the catalog's cached chapter list (the one episodes fills).
  const resolve = makeResolve({ kino, portal, session, clock, config, portalChapters: catalog.portalChapters, live: liveStream });
  const section = makeSection({ kino, catalog, clock });
  const categories = makeCategories({ catalog });
  deps = { clock, crypto, portal, session, tmdb, catalog, resolve, live, liveStream, section, categories };
  return deps;
}


/** Runs an export's body: kino errors pass through, anything else becomes a plain `unavailable`. */
export async function guarded(body) {
  try {
    return await body(getDeps());
  } catch (e) {
    if (isKinoError(e)) throw e;
    trace(kino, "call", "bug", { code: errCode(e) });
    throw kino.error("unavailable", "Xuper no está disponible ahora");
  }
}
