// Resolve (VOD): a ref to the CDN's url plus the headers it plays with (native-magis.md §5; native
// MagisResolve.kt + MagisPluginBridge.resolve). Two portal calls: `v10/startPlayVOD` (the track and
// its license, by title) and `v14/getSlbInfo` (the CDN and the free tier's Content-Auth, by SESSION:
// the same for every title, so it is cached in memory for as long as it keeps working).
// Unlike the native bridge, which kept the headers aside, the plugin RETURNS them in `Stream.headers`.
import { PortalError, mapPortalError, viewOpts, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { UA_CDN, FIXED_MAC } from "./config.js";
import { decode, isChannelRef } from "./refs.js";
import { findChapter } from "./episodes.js";
import { isObject, isKinoError, optStringStrict, objects, notBlank } from "./util.js";

const SLB_DEFAULT_TTL_S = 300; // when the portal does not declare invalidTime
// Time kept back for each portal call that still has to follow (play -> getSlbInfo; chapters -> play).
const FOLLOW_UP_RESERVE_MS = 3_000;
const AUTH_MARGIN_S = 300;
const EXPIRED = /expired=(\d+)/;
const MAX_SUBTITLES = 30; // SDK cap
const INT = /^[+-]?\d+$/;
const DIGITS = /^[0-9]+$/;


/** `sign_type=cfl` exactly (not `cflx`); `url` is a loose querystring, maybe with a `?` (MagisSlb.isCfl). */
export function isCfl(url) {
  return url.slice(url.lastIndexOf("?") + 1).split("&").some((p) => p.trim() === "sign_type=cfl");
}

/** `main_addr` as a base url: trailing slashes trimmed, `https://` added to a bare host, a path kept. */
export function withScheme(mainAddr) {
  const clean = mainAddr.replace(/\/+$/, "");
  return clean.startsWith("http://") || clean.startsWith("https://") ? clean : `https://${clean}`;
}

/** Milliseconds of what the portal sends: seconds (number or digits), `HH:MM:SS`, `MM:SS`; anything else 0. */
export function portalDurationMs(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw * 1000) : 0;
  if (typeof raw !== "string") return 0;
  const text = raw.trim();
  if (text === "") return 0;
  const parts = text.split(":");
  if (parts.length > 3 || parts.some((p) => !DIGITS.test(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 1000;
}

/** The track most likely to play anywhere: h264 first, then mp4; stable (the portal's first of equals wins). */
function bestMedia(play) {
  const episode = isObject(play) ? objects(play.episodeList)[0] : undefined;
  if (!episode) return null;
  const candidates = objects(episode.totalMovieList).flatMap((tm) => objects(tm.movieList));
  let best = null;
  let bestScore = Infinity;
  for (const m of candidates) {
    const score = (optStringStrict(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (optStringStrict(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);
    if (score < bestScore) { best = m; bestScore = score; }
  }
  return best;
}

/** `subtitleList[].file[0].url`: a language the portal lists but never uploaded is dropped. */
function readSubtitles(play) {
  const episode = objects(play.episodeList)[0];
  const out = [];
  for (const sub of objects(episode?.subtitleList)) {
    const file = objects(sub.file)[0];
    if (!file) continue;
    const url = optStringStrict(file.url);
    if (!notBlank(url)) continue;
    // The SDK keeps only vtt/srt and sniffs the rest.
    out.push({ lang: optStringStrict(sub.language), url, format: notBlank(optStringStrict(file.fileType)) ? optStringStrict(file.fileType) : "srt" });
  }
  return out.slice(0, MAX_SUBTITLES);
}

/** The VOD CDN and the free tier's Content-Auth, or null. */
function vodCdn(slb) {
  for (const cdn of objects(slb.cdn_list)) {
    if (optStringStrict(cdn.tag) !== "vod") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optStringStrict(u.url);
      if ((isCfl(url) || optStringStrict(u.sign_type) === "cfl") && optStringStrict(u.tag) === "free") {
        return { base: withScheme(optStringStrict(cdn.main_addr)), auth: url };
      }
    }
  }
  return null;
}

/**
 * Seconds this getSlbInfo can be kept: whichever expires first, the declared `invalidTime` or the
 * `expired=<unix>` in the Content-Auth itself (minus a margin). No usable cdn: 0 (not cached).
 */
export function slbLifetime(slb, nowMs) {
  const text = optStringStrict(slb.invalidTime);
  const declaredN = INT.test(text) ? Number(text) : NaN;
  const declared = declaredN > 0 ? declaredN : SLB_DEFAULT_TTL_S;
  const cdn = vodCdn(slb);
  if (!cdn) return 0;
  const m = EXPIRED.exec(cdn.auth);
  if (!m) return declared;
  return Math.min(declared, Number(m[1]) - Math.floor(nowMs / 1000) - AUTH_MARGIN_S);
}

// The real thing is `liveCodeList: ["masnew_live"]` as a JSON array (live: `[channelCode]`, the
// channel's code, see live.js); `reserve1` is overwritten by the portal's device dict.
export const slbBean = (apkVersion, liveCodes = ["masnew_live"]) => ({
  hasPay: "0", userIdentity: "1", type: "merge", appVer: apkVersion, lang: "es", encMediaSupported: 1,
  liveCodeList: [...liveCodes], appParams: "", reserve1: FIXED_MAC, pipFlag: "0",
});

// `live` (live.js) takes a bare channel code; without it every ref is VOD, as before.
export function makeResolve({ kino, portal, session, clock, config, portalChapters, live = null }) {
  const unavailable = (text) => kino.error("unavailable", text);
  let slbCache = null; // { slb, token, expiresMs }: memory only, never kino.storage

  // This session's getSlbInfo, asked once while it keeps working. The token is read inside the block, as
  // the portal calls are, so a retry after a re-authentication looks the cache up with the renewed one.
  // The cache is keyed by userToken: a seed's SLB never serves the account's calls, nor the reverse.
  const slbFor = async (v) => {
    if (slbCache && slbCache.token === v.userToken && clock.now() < slbCache.expiresMs) return slbCache.slb;
    // `v` carries the call's deadline (a seed view, or withValidSession's own view).
    const answer = await portal.call("v14/getSlbInfo", slbBean(config.apkVersion), viewOpts(v));
    const fresh = isObject(answer) ? answer : {};
    const ttl = slbLifetime(fresh, clock.now());
    // An slb that is no longer good is not saved (it would leave the session broken and silent): served anyway.
    slbCache = ttl > 0 ? { slb: fresh, token: v.userToken, expiresMs: clock.now() + ttl * 1000 } : null;
    return fresh;
  };
  // `seed`: the per-call seed view that played the title (its CDN auth must be its own: asked with
  // its credentials directly); null = the stored session, through withValidSession as before. The
  // stored session gets no seed fallback here: a license from one session with a CDN auth from another
  // would not play.
  const sessionSlb = (seed, deadline) => (seed ? slbFor({ ...seed, deadline }) : session.withValidSession(slbFor, { deadline }));

  // MagisPluginBridge.chapterFrom: the requested chapter, raw as the portal gives it.
  async function chapterFrom(magis, deadline) {
    const { items } = await portalChapters(magis.contentId, deadline);
    if (items.length === 0) throw unavailable(`la serie ${magis.contentId} vino sin capítulos`);
    const chapter = findChapter(items, magis.episode);
    if (!chapter) throw unavailable(`la serie no tiene el capítulo ${magis.episode}`);
    return chapter;
  }

  async function resolveVod(magis, chapter, deadline) {
    await session.ensure({ deadline: deadline - FOLLOW_UP_RESERVE_MS });
    const contentId = chapter && notBlank(chapter.contentId) ? chapter.contentId : magis.contentId;
    let played = null; // the view whose startPlayVOD answered: the SLB must be that same session's
    const play = await session.withValidSession((v) => {
      played = v;
      return portal.call(
        "v10/startPlayVOD",
        { contentId, seriesContentId: chapter ? magis.contentId : "", startTime: 0, type: "1", columnId: 0, authType: "" },
        viewOpts(v),
      );
      // getSlbInfo follows: the play (and its seed attempts) stop early enough to leave it time.
    }, { seedFallback: true, deadline: deadline - FOLLOW_UP_RESERVE_MS });
    const best = bestMedia(play);
    if (!best) throw unavailable("Xuper devolvió sin media reproducible");
    const license = optStringStrict(objects(best.licenseList)[0]?.license);
    if (!notBlank(license)) throw unavailable("Xuper devolvió sin licenseList");

    const cdn = vodCdn(await sessionSlb(played && played.sn ? played : null, deadline));
    if (!cdn) throw unavailable("Xuper no expuso CDN de vod con token libre");

    // `ts` iff the portal says so; asking for `.mp4` otherwise is all that can be done.
    const ext = optStringStrict(best.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
    return {
      url: `${cdn.base}/vod/${optStringStrict(best.contentId)}_media.${ext}`,
      mime: ext === "mp4" ? "video/mp4" : "video/mp2t",
      headers: {
        "Content-Auth": cdn.auth, // the querystring verbatim: VOD is not re-signed
        "Content-License": license,
        "User-Agent": UA_CDN,
        App: config.appId,
        "App-Version": config.apkVersion,
      },
      subtitles: readSubtitles(play),
      // A chapter's own declared duration wins (the portal sends it empty for most series).
      durationMs: chapter ? portalDurationMs(chapter.duration) : portalDurationMs(best.duration),
    };
  }

  async function resolve(ref, options) {
    // A live channel's ref is its bare code (liveCatalog.js): routed before the VOD path, untouched.
    if (live && isChannelRef(ref)) return live.resolveLive(ref, options);
    const deadline = callDeadline(clock, CALL_BUDGET_MS.resolve);
    try {
      const magis = decode(ref);
      if (!magis) throw unavailable("ese ref no es de Xuper: no se puede reproducir");
      // A series' contentId is not playable: its chapters are listed and one is played.
      // The chapter list leaves room for the play and the CDN calls that follow it.
      const chapter = magis.isSeries ? await chapterFrom(magis, deadline - 2 * FOLLOW_UP_RESERVE_MS) : null;
      return await resolveVod(magis, chapter, deadline);
    } catch (e) {
      if (e instanceof PortalError) throw mapPortalError(e.code, e.message, kino);
      if (isKinoError(e)) throw e;
      throw unavailable("Xuper no está disponible ahora");
    }
  }

  return { resolve };
}
