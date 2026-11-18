// upgrade.js — the first call of each runtime after an update from Xuper 2.x.
//
// The update keeps the plugin id, so this code inherits 2.x's storage. Nothing of it is of use here and some of it is
// risky (`session` held 2.x's portal session as JSON), so the first call of every runtime removes every key outside
// this version's prefix (src/store.js sweepOld): also what a restored 2.x backup brings back. When it found any, the
// device ran 2.x: with no Bearer stored, the screen's next `open` signs in with no tap (src/api.js markRelogin), since
// the person approved the identity on the update's consent sheet. Never throws: an update must not fail a call.
import { sweepOld } from "./store.js";
import { markRelogin } from "./api.js";

let _done = false;

/** Test helper: the next call runs as a new runtime's first. */
export function _resetUpgrade() { _done = false; }

/** Once per runtime (src/plugin.js, at every export's start). → how many keys it removed (0 after the first call). */
export async function upgradeOnce() {
  if (_done) return 0;
  _done = true;
  try {
    const n = sweepOld();
    if (n > 0 && (await markRelogin())) {
      try { kino.log("upgrade: data of an older version removed; the screen signs in on its next opening"); } catch (_) { /* no log */ }
    }
    return n;
  } catch (_) {
    return 0;
  }
}
