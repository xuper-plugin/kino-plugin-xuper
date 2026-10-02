// Live channel open (native-magis.md §6.4; native MagisLive.resolveChannel and AppGraph.resolveLive /
// onLiveConflict). Two portal calls per open, never cached: `main_addr` rotates on every answer and
// an old host answers 403. The answer is a request-signed HLS stream: `sign()` (liveSign.js) builds
// the CDN headers per request from the signContext; the other CDNs of the same answer go out as
// `alternateHosts`, so the app's proxy fails over between them as the native proxy did.
import { PortalError, mapPortalError } from "./portal.js";
import { isCfl, slbBean } from "./resolve.js";
import { buildSignContext, tokenOf } from "./liveSign.js";
import { makeLiveRotation, MAX_ROTATIONS } from "./liveRotation.js";
import { isObject, isKinoError, optStringStrict, objects, notBlank } from "./util.js";

const DEFAULT_TTL_S = 300; // when the portal does not declare invalidTime (native CHANNEL_TTL_S)
const MIN_EXPIRES_S = 30; // SDK range of expiresInSeconds
const MAX_EXPIRES_S = 86400;
const MAX_ALTERNATE_HOSTS = 6; // SDK cap
const NOT_LOGGED_IN = "aaa100028"; // a channel that genuinely needs a real account
const INT = /^[+-]?\d+$/;
const ALTERNATE_HOST = /^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$/; // SDK alternateHosts pattern
const SERVED_MEMORY = 64;

// The person-facing texts of the native live failures (code in English, texts in Spanish).
const TEXT = {
  noAccount: "Este canal necesita una cuenta de Xuper (para películas y series no hace falta). Vincúlala en Ajustes ▸ Plugins ▸ Xuper.",
  noAddresses: "No se pudo abrir el canal: Xuper no dio la dirección de la señal", // live_no_addresses
  noCdn: "No se pudo abrir el canal: Xuper no dio un servidor de vivo", // live_no_cfl_cdn
  noLicense: "No se pudo abrir el canal: Xuper no dio la licencia de la señal", // live_no_license
  noToken: "No se pudo abrir el canal: el servidor de vivo no trae su token", // live_no_cfl_token
  badHost: "No se pudo abrir el canal: Xuper dio una dirección de servidor de vivo que no es válida",
  tooLong: "No se pudo abrir el canal: los datos de la señal son demasiado largos",
  unknownChannel: "No se encontró ese canal en Xuper",
  generic: "Xuper no está disponible ahora",
};


/** `main_addr` reduced to its host (and port): no scheme, no path (native MagisSlb.bareHost). */
export function bareHost(mainAddr) {
  let s = typeof mainAddr === "string" ? mainAddr : "";
  if (s.startsWith("https://")) s = s.slice(8);
  if (s.startsWith("http://")) s = s.slice(7);
  const slash = s.indexOf("/");
  return slash >= 0 ? s.slice(0, slash) : s;
}

/**
 * playCode and license from THE SAME entry, never crossed: the first entry with both; else the
 * first entry's license with no playCode (native MagisLive.signalFrom). Null without entries.
 */
function signalFrom(play) {
  let firstLicense = null;
  for (const a of objects(isObject(play) ? play.liveAddressList : null)) {
    const license = optStringStrict(a.license);
    const playCode = optStringStrict(a.playCode);
    if (firstLicense === null) firstLicense = license;
    if (notBlank(playCode) && notBlank(license)) return { playCode, license };
  }
  return firstLicense === null ? null : { playCode: "", license: firstLicense };
}

/** EVERY live CDN × every cfl url_list item, in portal order; no `free` check for live. */
function liveCdns(slb) {
  const out = [];
  for (const cdn of objects(isObject(slb) ? slb.cdn_list : null)) {
    if (optStringStrict(cdn.tag) !== "live") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optStringStrict(u.url);
      if (!isCfl(url) && optStringStrict(u.sign_type) !== "cfl") continue;
      const host = bareHost(optStringStrict(cdn.main_addr));
      if (notBlank(host)) out.push({ cflHost: host, authBase: url });
    }
  }
  return out;
}

// The portal's `invalidTime` (s; measured 14400), 300 without a positive one, in the SDK's range.
function expiresOf(slb) {
  const text = optStringStrict(isObject(slb) ? slb.invalidTime : "");
  const n = INT.test(text) ? Number(text) : NaN;
  const ttl = n > 0 ? n : DEFAULT_TTL_S;
  return Math.min(MAX_EXPIRES_S, Math.max(MIN_EXPIRES_S, ttl));
}

export function makeLive({ kino, portal, session, clock, config, random }) {
  const rand = random || (() => parseInt(kino.crypto.randomBytes(4, "hex"), 16) / 0x100000000);
  const rotation = makeLiveRotation({ kino, clock, random: rand });
  // What each channel's last open served (the refused key of a later conflict). Memory only: a
  // conflict comes seconds after its open; a runtime discarded meanwhile just counts it as new.
  const served = new Map();
  const unavailable = (text) => kino.error("unavailable", text);
  const log = (line) => { try { kino.log("xuper live: " + line); } catch (_) { /* never fails a call */ } };

  // A refused "not found" is about THIS channel (a junk ref that looks like a channel code lands
  // here too), so it says so. An answer with no addresses stays `unavailable`: the portal gives no
  // way to tell a code that never existed from a known channel that has no signal right now.
  const channelNotFound = (e) => (e.code === "not_found" ? kino.error("not_found", TEXT.unknownChannel) : e);
  const surface = (e) => {
    if (e instanceof PortalError) return channelNotFound(mapPortalError(e.code, e.message, kino));
    if (isKinoError(e)) return channelNotFound(e);
    return unavailable(TEXT.generic);
  };

  function noteServed(code, license) {
    served.delete(code);
    served.set(code, license);
    while (served.size > SERVED_MEMORY) served.delete(served.keys().next().value);
  }

  /** One open: with no [seed] the device's own session (ensure + withValidSession); with one, only its credentials. */
  async function open(code, seed) {
    let lastCode = null;
    let call;
    if (seed) {
      // No re-login, no rescue, store untouched: a seed the portal refuses is just an error.
      call = (path, bean) => portal.call(path, bean, { baseFields: true, userId: seed.userId, userToken: seed.userToken, sn: seed.sn });
    } else {
      await session.ensure();
      call = (path, bean) => session.withValidSession(async ({ userId, userToken }) => {
        try { return await portal.call(path, bean, { baseFields: true, userId, userToken }); }
        catch (e) { lastCode = e instanceof PortalError ? e.code : null; throw e; }
      });
    }

    let play;
    try {
      play = await call("v4/startPlayLive", { channelCode: code, columnId: 0, type: "1" });
    } catch (e) {
      // aaa100028 after withValidSession's retries: THIS channel needs a (re)linked account.
      const notLoggedIn = (e instanceof PortalError && e.code === NOT_LOGGED_IN)
        || (isKinoError(e) && e.code === "auth_required" && lastCode === NOT_LOGGED_IN);
      if (notLoggedIn) throw kino.error("auth_required", TEXT.noAccount);
      throw e;
    }
    const signal = signalFrom(play);
    if (!signal) throw unavailable(TEXT.noAddresses);

    // The CHANNEL's code, not the playCode: the portal returns that signal's hosts.
    const slb = await call("v14/getSlbInfo", slbBean(config.apkVersion, [code]));
    const all = liveCdns(slb);
    if (all.length === 0) throw unavailable(TEXT.noCdn);
    if (!notBlank(signal.license)) throw unavailable(TEXT.noLicense);
    // A CDN whose authBase has no token cannot be signed for: it is dropped (native refused the
    // channel when the FIRST one had none, see the report).
    const withToken = all.filter((d) => tokenOf(d.authBase) !== "");
    if (withToken.length === 0) throw unavailable(TEXT.noToken);
    // A host that is not a plain host[:port] cannot go out as an alternate host: it is dropped too,
    // and if that leaves nothing the reason is the address, not the token.
    const cdns = withToken.filter((d) => ALTERNATE_HOST.test(d.cflHost));
    if (cdns.length === 0) throw unavailable(TEXT.badHost);

    const built = buildSignContext(signal.license, cdns);
    if (!built) throw unavailable(TEXT.tooLong);
    const primary = built.kept[0].cflHost;
    const alternates = [];
    for (const d of built.kept.slice(1)) {
      if (d.cflHost.toLowerCase() === primary.toLowerCase() || alternates.some((h) => h.toLowerCase() === d.cflHost.toLowerCase())) continue;
      if (alternates.length < MAX_ALTERNATE_HOSTS) alternates.push(d.cflHost);
    }
    // What the signal is called ON THE CDN (not always the channel's code; asking for the channel's
    // code with this license is a 401).
    const playCode = notBlank(signal.playCode) ? signal.playCode : code;
    noteServed(code, signal.license);
    return {
      url: `http://${primary}/live/${playCode}.m3u8`,
      mime: "application/x-mpegurl",
      signing: "request",
      signContext: built.context,
      alternateHosts: alternates,
      expiresInSeconds: expiresOf(slb),
    };
  }

  const seedBySn = (sn) => (sn === null ? null : session.seedPool().find((e) => e.sn === sn) || null);

  // AppGraph.onLiveConflict: only a shared seed can be in use twice, so only a device on a seed (or a
  // channel already moved to one) rotates; an account or a minted own session never does.
  function onConflict(code, attempt) {
    const activeSn = rotation.activeSn(code);
    if (session.kind() !== "seed" && activeSn === null) return;
    const current = activeSn ?? session.current().sn;
    const refusedKey = served.has(code) ? served.get(code) : `retry:${attempt}`;
    const moved = rotation.onRefused(code, current, session.seedPool(), refusedKey);
    log(`409 on a channel: ${moved ? "next open uses another seed" : "no seed left, back to the own session"} (tried ${rotation.triedCount(code)}/${MAX_ROTATIONS + 1})`);
  }

  // AppGraph.resolveLive: the channel's rotated seed first; a seed that cannot even open is marked
  // refused and the next one is tried, up to MAX_ROTATIONS + 1; then the device's own session.
  async function openWithRotation(code) {
    let seed = seedBySn(rotation.activeSn(code));
    if (!seed) return open(code, null);
    for (let i = 0; i < MAX_ROTATIONS + 1; i++) {
      try {
        return await open(code, seed);
      } catch (_) {
        log("a rotated seed could not open the channel: next");
        const moved = rotation.onRefused(code, seed.sn, session.seedPool(), `resolve:${seed.sn}`);
        const next = seedBySn(rotation.activeSn(code));
        if (!next || !moved) return open(code, null);
        seed = next;
      }
    }
    return open(code, null);
  }

  /** `resolve(ref, options)` for a bare channel code. `expired` needs nothing: nothing is cached. */
  async function resolveLive(code, options) {
    await null;
    try {
      const retry = isObject(options) && isObject(options.retry) ? options.retry : null;
      if (retry && retry.reason === "conflict") onConflict(code, retry.attempt);
      return await openWithRotation(code);
    } catch (e) {
      throw surface(e);
    }
  }

  return { resolveLive };
}
