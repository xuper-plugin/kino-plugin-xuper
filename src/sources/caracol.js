// src/sources/caracol.js — conector EN VIVO de Caracol (API oficial Ditu). Port de xuper-plugin/kino-plugin-caracol-tv.
// Base middleware.ditu.caracoltv.com, headers restful:yes / Accept / User-Agent okhttp/4.12.0.
// TRAY/LIVECHANNELS -> lista de canales. resolve: CONTENT/USERDATA/LIVE/{id} (entitlement/geo) +
//   CONTENT/VIDEOURL/LIVE/{id}/{assetId} -> DASH (dai.google.com) con Widevine DRM (licenseUrl .../CONTENT/LICENSE
//   + cookie playback_token que viaja en licenseHeaders y en headers del stream). SOLO COLOMBIA (geo-bloqueo).
//
// 1.0.45: the channel list is stored by src/live.js (24 h fresh / 7 d max-stale), each channel carrying its `assetId`
// in the private `x`, so a resolve from a cold runtime is 2 requests (USERDATA + VIDEOURL) instead of 3. Nothing is
// kept in module memory.

import { liveFetch } from "../liveGate.js";  // kino.fetch under the call's bounds (≤5 in flight, deadline)
import { lang } from "../config.js";

const en = () => lang() === "en";

const BASE = "https://middleware.ditu.caracoltv.com/AGL/1.6/A/ENG/ANDROID/ALL";
const LICENSE = BASE + "/CONTENT/LICENSE";
const COOKIE_TOKEN = "playback_token";

// User-Agent de okhttp/4.12.0: sin él el CDN responde 403. restful/Accept son lo que el backend exige.
const REQUEST_HEADERS = {
  "restful": "yes",
  "Accept": "application/json, text/plain, */*",
  "User-Agent": "okhttp/4.12.0",
};

/** path + query params sobre BASE. */
function api(path, params = {}) {
  const u = new URL(BASE + "/" + path);
  for (const [k, v] of Object.entries(params)) if (v !== "" && v !== undefined && v !== null) u.searchParams.set(k, String(v));
  return u.toString();
}

/** The error of a non-2xx answer; a 403 is the geo-block (outside Colombia), not a bug. */
function httpError(status, path) {
  const geo = status === 403;
  const err = new Error(geo
    ? (en() ? "Caracol: only available in Colombia" : "Caracol: solo disponible en Colombia")
    : (en() ? "Caracol answered " + status + " on " + path : "Caracol respondió " + status + " en " + path));
  err.outsideColombia = geo;
  err.status = status;
  return err;
}

/** GET a BASE; lanza Error legible si algo falla (marca outsideColombia en 403: geo-bloqueo, no bug). */
async function get(path, params = {}) {
  const r = await liveFetch(api(path, params), { headers: { ...REQUEST_HEADERS } });
  if (!r.ok) throw httpError(r.status, path);
  return r.json();
}

/** GET a BASE; devuelve también la cookie `playback_token` (via Set-Cookie, no viene en el JSON). */
async function getWithToken(path) {
  const url = api(path);
  const r = await liveFetch(url, { headers: { ...REQUEST_HEADERS } });
  if (!r.ok) throw httpError(r.status, path);
  const token = kino.cookies.get(url, COOKIE_TOKEN) || "";
  return { json: r.json(), token };
}

/** resultObj.containers, o [] si la respuesta no tiene la forma esperada. */
function containers(json) {
  const arr = json && json.resultObj && Array.isArray(json.resultObj.containers) ? json.resultObj.containers : [];
  return arr.filter((c) => c && typeof c === "object");
}

/** El assetId del primer MASTER con assetId != 0; si no, el primer asset con assetId != 0. */
function assetMaster(c) {
  const list = Array.isArray(c && c.assets) ? c.assets : [];
  const master = list.find((a) => a && a.assetType === "MASTER" && a.assetId);
  if (master) return master.assetId;
  const any = list.find((a) => a && a.assetId);
  return any ? any.assetId : null;
}

/** Logo del canal: logoMedium, sino Big, sino Small. */
function channelLogo(assets) {
  const list = Array.isArray(assets) ? assets : [];
  return list.find((a) => a && a.logoMedium) ? String(list.find((a) => a.logoMedium).logoMedium)
    : list.find((a) => a && a.logoBig) ? String(list.find((a) => a.logoBig).logoBig)
    : list.find((a) => a && a.logoSmall) ? String(list.find((a) => a.logoSmall).logoSmall)
    : "";
}

function channelOf(c) {
  const m = (c.metadata || {});
  if (m.isActive !== true) return null;
  const id = m.channelId && m.channelId !== 0 ? m.channelId : null;
  const name = String(m.channelName || "").trim();
  const assetId = assetMaster(c);
  if (!id || !name || !assetId) return null;
  return { channelId: id, name, assetId, logo: channelLogo(c.assets), adult: m.isAdult === true };
}

// Primer flag de bloqueo de entitlement, en el orden de la nativa. [flag, ES, EN]
const BLOCKS = [
  ["isGeoBlocked", "solo disponible en Colombia", "only available in Colombia"],
  ["isChannelNotSubscribed", "requiere suscripción", "needs a subscription"],
  ["isPCBlocked", "control parental activo", "parental control is on"],
  ["isContentOOHBlocked", "contenido OOH bloqueado", "blocked out of home"],
  ["isGeofencedBlocked", "geofence bloqueado", "blocked by geofence"],
  ["isSportBlackoutBlocked", "deportes en blackout", "sports blackout"],
  ["isPlatformBlacklisted", "plataforma no permitida", "platform not allowed"],
];

function entitlementBlock(userData) {
  const list = userData && userData.resultObj && Array.isArray(userData.resultObj.containers) ? userData.resultObj.containers : [];
  const ent = list[0] && list[0].entitlement;
  if (!ent) return null;
  for (const [flag, es, enText] of BLOCKS) {
    if (ent[flag] === true) return en() ? enText : es;
  }
  return null;
}

async function checkEntitlement(path) {
  const data = await get(path);
  const reason = entitlementBlock(data);
  if (reason) {
    const err = new Error("Caracol: " + reason);
    err.blocked = true;
    throw err;
  }
}

/** Resuelve un canal a su stream DASH (2 pasos: USERDATA + VIDEOURL). Forma del DRM idéntica a la del plugin nativo. */
async function livePlayable(channelId, assetId, name) {
  await checkEntitlement("CONTENT/USERDATA/LIVE/" + channelId);
  const r = await getWithToken("CONTENT/VIDEOURL/LIVE/" + channelId + "/" + assetId);
  const src = r.json && r.json.resultObj ? String(r.json.resultObj.src || "").trim() : "";
  if (!src) throw new Error(en() ? "Caracol gave no video URL for " + name : "Caracol no devolvió una URL de video para " + name);
  const drm = { type: "widevine", licenseUrl: LICENSE, licenseHeaders: {} };
  if (r.token) drm.licenseHeaders.Cookie = COOKIE_TOKEN + "=" + r.token;
  // El CDN exige restful/User-Agent y la cookie playback_token en CADA request (manifest, segmentos y licencia).
  const streamHeaders = { ...REQUEST_HEADERS };
  if (r.token) streamHeaders.Cookie = COOKIE_TOKEN + "=" + r.token;
  return { url: src, mime: "application/dash+xml", drm, headers: streamHeaders };
}

/** The live channel list (1 request of about 40 KB). Throws on failure or on an empty answer (keeps the stored one). */
async function fetchChannels() {
  const json = await get("TRAY/LIVECHANNELS", { orderBy: "orderId", sortOrder: "asc" });
  const list = containers(json).map(channelOf).filter(Boolean);
  if (!list.length) throw new Error(en() ? "Caracol: empty channel list" : "Caracol: lista de canales vacía");
  return list;
}

/** The assetId of a stored channel (its private `x`), or null. */
function storedAsset(hit) {
  const a = hit && hit.x && hit.x.assetId;
  return a != null && a !== "" ? a : null;
}

const caracol = {
  id: "caracol",
  name: "Caracol",
  genre: "otros",
  codeCategories: true,   // categories() never makes a request
  drm: true,              // its streams are Widevine: a merged channel plays another source while DRM is not declared

  async categories() {
    return [{ id: "all", title: en() ? "Live channels" : "Canales en vivo" }];
  },

  // One list for the only category. `x.assetId` is private (never returned to Kino): resolve reads it back.
  async channels(_categoryId) {
    return (await fetchChannels()).map((ch) => {
      const out = { id: String(ch.channelId), title: ch.name, x: { assetId: ch.assetId } };
      if (ch.logo) out.logo = ch.logo;
      if (ch.adult) out.adult = true;
      return out;
    });
  },

  // Cold runtime with the list stored: USERDATA + VIDEOURL (2 requests). Nothing stored (never listed on this device,
  // or the list expired): the list is fetched once and stored for next time (3 requests). A stored assetId that no
  // longer plays is re-listed once (forced) and retried when the assetId changed.
  async resolve(channelId, ctx) {
    const want = String(channelId || "");
    const unknown = () => new Error(en() ? "Caracol: unknown channel " + want : "Caracol: canal desconocido " + want);
    const relist = async () => {
      const items = await ctx.relist("all", { force: true });
      return (items || []).find((c) => ctx.rawIdOf(c) === want) || null;
    };
    let hit = ctx.findChannel(want);
    let fresh = false;
    if (!storedAsset(hit)) {
      hit = await relist();
      fresh = true;
    }
    const assetId = storedAsset(hit);
    if (!assetId) throw unknown();
    try {
      return await livePlayable(want, assetId, hit.title || want);
    } catch (e) {
      if (fresh || (e && (e.outsideColombia || e.blocked || e.code === "deadline"))) throw e;
      const again = await relist().catch(() => null);
      const next = storedAsset(again);
      if (!next || String(next) === String(assetId)) throw e;
      return await livePlayable(want, next, again.title || want);
    }
  },
};

export default caracol;
