// What the configuration screen shows, read without any network: the old status facts (settings.statusFacts, E2), the
// session's seed views (E4), the contribution stamp and the settings. Pure presentation helpers live here too.
import { configuredPair } from "./util.js";
import { AT_KEY as CONTRIB_AT_KEY } from "./seedContrib.js";

/** The registration's resend wait and the code's life, as the old buttons apply them (settings.js, registration.js). */
export const RESEND_WAIT_MS = 60_000;
export const CODE_LIFE_MS = 30 * 60_000;

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));

/**
 * An email as the screen may show it: its first character, then dots, the domain's first character, dots and its last
 * label ("a•••@g•••.com"). Never the whole address (a TV sits in a living room); "" for anything that is not one.
 */
export function maskEmail(email) {
  const e = str(email).trim();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return "";
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 && dot < domain.length - 1 ? domain.slice(dot) : "";
  return `${[...local][0]}•••@${[...domain][0]}•••${tld}`;
}

/** Initials for the account's avatar: the first letter of the email, upper-cased ("?" when there is none). */
export const initialOf = (email) => {
  const c = [...str(email).trim()][0];
  return c && /[A-Za-z0-9À-ɏ]/.test(c) ? c.toUpperCase() : "?";
};

const readJson = (kino, key) => {
  try { const raw = kino.storage.get(key); return raw === null || raw === undefined ? null : JSON.parse(raw); } catch (_) { return null; }
};

/**
 * The facts every tab draws from. `ok: false` when the session cannot be read (the screen then says only what it knows).
 * The email is masked here: nothing of the person's address leaves this function whole.
 */
export function snapshot({ kino, settings, session }) {
  let f = null;
  try { f = settings.statusFacts(); } catch (_) { f = null; }
  const pair = (() => { try { return configuredPair(kino.config); } catch (_) { return { email: "", password: "" }; } })();
  const toggle = (() => { try { return kino.config.get("useSharedAccount"); } catch (_) { return undefined; } })();
  const sharedToggle = toggle === true || (toggle === undefined && readJson(kino, "sharedAccount") === true);
  const num = (fn) => { try { const v = fn(); return typeof v === "number" && Number.isFinite(v) ? v : null; } catch (_) { return null; } };
  const contribAt = num(() => Number(kino.storage.get(CONTRIB_AT_KEY)));
  const usable = num(() => session.usableSeeds()) ?? 0;
  const pool = f ? f.pool : 0;
  const account = f ? f.account : false;
  const regionBlocked = f ? f.regionBlocked : false;
  return {
    ok: f !== null,
    accountState: f ? f.accountState : "none",
    account,
    usingShared: f ? f.usingShared : false,
    sharedConfigured: f ? f.sharedConfigured : false,
    // An own account is typed (both fields of either pair), whatever the portal said about it.
    ownConfigured: pair.email !== "" && pair.password !== "",
    sharedToggle,
    emailMasked: maskEmail(f ? f.email : pair.email),
    initial: initialOf(f ? f.email : pair.email),
    kind: f ? f.kind : "none",
    regionBlocked,
    pool,
    usable,
    seedsAt: num(() => session.seedsAt()),
    // Derived from what is stored, not from the session's in-memory flag (which a runtime restart forgets): blocked, no
    // account, and no seed a pick could use.
    exhausted: !account && regionBlocked && usable === 0,
    auto: f ? f.autoRefresh : true,
    contribOn: (() => { try { return kino.config.get("contributeSeeds") !== false; } catch (_) { return true; } })(),
    contribAt: contribAt !== null && contribAt > 0 ? contribAt : null,
  };
}

/** A short fingerprint of what the tabs show: a timer re-renders only when it changed. */
export function fingerprint(s) {
  return [s.ok, s.accountState, s.account, s.usingShared, s.sharedConfigured, s.ownConfigured, s.sharedToggle, s.emailMasked, s.kind,
    s.regionBlocked, s.pool, s.usable, s.seedsAt, s.exhausted, s.auto, s.contribOn, s.contribAt].join("|");
}
