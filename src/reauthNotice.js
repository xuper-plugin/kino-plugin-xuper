// reauthNotice.js — the Home-bell reminder to reautenticate (kino.notifications, capability "notifications").
// Mirrors the stored REAUTH flag (src/api.js): a notice while a re-activation failed for a reason the person must act on,
// cleared once they sign in again. Posted from the scheduled job (so it reaches the person without opening Xuper) and,
// for immediacy, from the screen right after an activation attempt.

import { reauthNeeded } from "./api.js";

const NOTICE_ID = "reauth";

function hasNotifications() {
  return typeof kino !== "undefined" && kino && kino.notifications
    && typeof kino.notifications.post === "function" && typeof kino.notifications.clear === "function";
}

/**
 * Posts or clears the Home-bell reminder from the stored flag. Feature-detected and never throws: an older Kino, the
 * notice permission turned off (permission_denied), or the hourly cap (rate_limited) all make it a quiet no-op. The notice
 * opens Xuper's screen on a tap (`go.screen`), where "Reautenticar" is.
 */
export async function syncReauthNotice() {
  if (!hasNotifications()) return;
  try {
    if (reauthNeeded()) {
      await kino.notifications.post({
        id: NOTICE_ID,
        title: "Reautentícate en Xuper",
        titleEn: "Re-authenticate in Xuper",
        text: "Xuper dejó de reconocer tu acceso. Ábrelo y toca «Reautenticar».",
        textEn: "Xuper lost your access. Open it and tap \"Re-authenticate\".",
        go: { screen: {} },
      });
    } else {
      await kino.notifications.clear(NOTICE_ID);
    }
  } catch (_) {
    // Best-effort: notice permission off, rate-limited, or an older Kino.
  }
}
