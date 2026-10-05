// Resolve (VOD): a ref to the CDN's url plus the headers it plays with (native-magis.md §5; native
// MagisResolve.kt + MagisPluginBridge.resolve). Two portal calls: `v10/startPlayVOD` (the track and
// its license, by title) and `v14/getSlbInfo` (the CDN and the free tier's Content-Auth, by SESSION:
// the same for every title, so it is cached in memory for as long as it keeps working).
// Unlike the native bridge, which kept the headers aside, the plugin RETURNS them in `Stream.headers`.
// The other copies the same two answers name (other tracks of the title, the CDN's spared_addr, other
// free cfl vod CDNs) travel as `Stream.alternatives`, best first, for the app to try when one cannot play.
import { PortalError, mapPortalError, viewOpts, callDeadline, CALL_BUDGET_MS } from "./portal.js";
import { UA_CDN, FIXED_MAC } from "./config.js";
import { decode, isChannelRef } from "./refs.js";
import { codeOfRef } from "./channelId.js";
import { findChapter } from "./episodes.js";
import { isObject, isKinoError, optStringStrict, objects, notBlank } from "./util.js";
import { trace } from "./trace.js";

const SLB_DEFAULT_TTL_S = 300; // when the portal does not declare invalidTime
// Time kept back for each portal call that still has to follow (play -> getSlbInfo; chapters -> play).
const FOLLOW_UP_RESERVE_MS = 3_000;
const AUTH_MARGIN_S = 300;
const EXPIRED = /expired=(\d+)/;
const MAX_SUBTITLES = 30; // SDK cap
const MAX_ALTERNATIVES = 8; // SDK cap (contract.json output.maxAlternatives)
const RETRY_COPIES = 3; // the connect attempts ExoPlayer used to make on its own
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

// h264 first, then mp4 (MagisResolve.bestMedia): lower plays on more devices.
const mediaScore = (m) => (optStringStrict(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (optStringStrict(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);

/** Every track of the title, the one most likely to play anywhere first; stable (the portal's first of equals wins). */
function rankedMedia(play) {
  const episode = isObject(play) ? objects(play.episodeList)[0] : undefined;
  if (!episode) return [];
  // A track with no contentId has no media path (`/vod/_media.mp4`): it is not a track at all.
  const candidates = objects(episode.totalMovieList).flatMap((tm) => objects(tm.movieList)).filter((m) => notBlank(optStringStrict(m.contentId)));
  return candidates.map((m, i) => ({ m, i, s: mediaScore(m) })).sort((a, b) => a.s - b.s || a.i - b.i).map((x) => x.m);
}

/** A track's own license, or "" (MagisResolve: `licenseList[0].license`). */
const licenseOf = (m) => optStringStrict(objects(m.licenseList)[0]?.license);

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

/**
 * Every VOD CDN with a free cfl Content-Auth, in portal order: `{ bases, auth }`, `bases` its main_addr then its
 * spared_addr (the portal's spare for the same CDN; its Content-Auth names both), blank or repeated ones left out.
 */
function vodCdns(slb) {
  const out = [];
  for (const cdn of objects(slb.cdn_list)) {
    if (optStringStrict(cdn.tag) !== "vod") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optStringStrict(u.url);
      if ((isCfl(url) || optStringStrict(u.sign_type) === "cfl") && optStringStrict(u.tag) === "free") {
        const bases = [withScheme(optStringStrict(cdn.main_addr))];
        const spare = optStringStrict(cdn.spared_addr);
        if (notBlank(spare) && !bases.includes(withScheme(spare.trim()))) bases.push(withScheme(spare.trim()));
        out.push({ bases, auth: url });
        break;
      }
    }
  }
  return out;
}

/** The VOD CDN and the free tier's Content-Auth (the first of vodCdns), or null. */
function vodCdn(slb) {
  const first = vodCdns(slb)[0];
  return first ? { base: first.bases[0], auth: first.auth } : null;
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
    const tracks = rankedMedia(play);
    const best = tracks[0];
    if (!best) throw unavailable("Xuper devolvió sin media reproducible");
    const license = licenseOf(best);
    if (!notBlank(license)) throw unavailable("Xuper devolvió sin licenseList");

    const cdns = vodCdns(await sessionSlb(played && played.sn ? played : null, deadline));
    if (cdns.length === 0) throw unavailable("Xuper no expuso CDN de vod con token libre");

    // Every copy the portal offers, best first: the best track on each server (main_addr, spared_addr,
    // the next free cfl vod CDN), then the next track the same way. The first is `url`, the rest the
    // app's alternatives. Each server keeps its own Content-Auth, each track its own license.
    const copies = [];
    const seen = new Set();
    const seenTracks = new Set();
    for (const track of tracks) {
      const id = optStringStrict(track.contentId);
      const trackLicense = track === best ? license : licenseOf(track);
      if (track !== best && (!notBlank(id) || !notBlank(trackLicense) || seenTracks.has(id))) continue;
      seenTracks.add(id);
      // `ts` iff the portal says so; asking for `.mp4` otherwise is all that can be done.
      const ext = optStringStrict(track.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
      for (const cdn of cdns) {
        for (const base of cdn.bases) {
          const url = `${base}/vod/${id}_media.${ext}`;
          if (seen.has(url)) continue;
          seen.add(url);
          copies.push({
            url,
            mime: ext === "mp4" ? "video/mp4" : "video/mp2t",
            headers: {
              "Content-Auth": cdn.auth, // the querystring verbatim: VOD is not re-signed
              "Content-License": trackLicense,
              "User-Agent": UA_CDN,
              App: config.appId,
              "App-Version": config.apkVersion,
            },
          });
        }
      }
    }
    // The vod server drops a share of its TCP connects at random (CacheFly, measured 2026-10-05: 8 of 17 opens
    // timed out on one phone). The native code survived it because ExoPlayer retried a failed connect 3-4 times;
    // Kino 0.9.50-0.9.52 gives up on an unreachable copy without retrying it. The best copy again, last and under
    // retry=1..3, is those retries: a new connection each, the same file and headers. Only free slots take one,
    // so a real copy is never pushed out for a retry.
    const bestCopy = copies[0];
    for (let n = 1; bestCopy && n <= RETRY_COPIES && copies.length <= MAX_ALTERNATIVES; n++) {
      copies.push({ ...bestCopy, url: `${bestCopy.url}${bestCopy.url.includes("?") ? "&" : "?"}retry=${n}` });
    }
    const [first, ...others] = copies;
    const alternatives = others.slice(0, MAX_ALTERNATIVES);
    if (alternatives.length > 0) trace(kino, "resolve", "alts", { n: alternatives.length, tracks: seenTracks.size, cdns: cdns.length });
    return {
      ...first,
      subtitles: readSubtitles(play),
      // A chapter's own declared duration wins (the portal sends it empty for most series).
      durationMs: chapter ? portalDurationMs(chapter.duration) : portalDurationMs(best.duration),
      ...(alternatives.length > 0 ? { alternatives } : {}),
    };
  }

  async function resolve(ref, options) {
    // A live channel's ref is its bare code (liveCatalog.js): routed before the VOD path, untouched.
    if (live && isChannelRef(ref)) return live.resolveLive(codeOfRef(ref), options);
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
