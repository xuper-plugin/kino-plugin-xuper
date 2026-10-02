// src/crypto.js
var HEX = /^(?:[0-9a-f]{2})+$/;
var toHex = (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("");
function fromHex(h) {
  if (typeof h !== "string" || !HEX.test(h)) throw new Error("not hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return new TextDecoder("utf-8", { fatal: true }).decode(out);
}
function makeCrypto(kino2) {
  const fail = (what) => kino2.error("unavailable", "el portal no se pudo " + what);
  return {
    encryptBody(plain2) {
      try {
        const b64 = kino2.crypto.encrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: plain2,
          padding: "pkcs7"
        });
        if (typeof b64 !== "string" || b64 === "") throw new Error("empty");
        return toHex(b64);
      } catch (e) {
        throw fail("cifrar");
      }
    },
    decryptBlob(wire) {
      try {
        const text2 = kino2.crypto.decrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: fromHex(wire),
          padding: "pkcs7"
        });
        if (typeof text2 !== "string" || text2 === "") throw new Error("empty");
        return text2;
      } catch (e) {
        throw fail("descifrar");
      }
    }
  };
}

// src/config.js
var hosts = [];
var APP_ID = "";
var APK_VERSION = "";
var PORTAL_CODE = "masnew";
var SPKG_VER = "2025-08-07 05:40:11_36_16_";
var APK_VER_HEADER = "43404";
var USER_AGENT = "okhttp/3.12.12";
var UA_CDN = "Ranger/4.9.4-17294ac0";
var CONTENT_TYPE = "application/json;charset=utf-8";
var RATE_LIMIT_MS = 400;
var REQUEST_TIMEOUT_MS = 25e3;
var DEVICE_FIXED = Object.freeze({
  loginType: "2",
  appLanguage: "en",
  hardwareInfo: "ranchu",
  model: "sdk_gphone64_arm64",
  product: "sdk_gphone64_arm64",
  cpu: "arm64-v8a",
  B29: "",
  reserve1: "",
  deviceToken: "",
  drmId: "",
  sdkVer: 36
});
var SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
var PASSWORD_SALT = "cloudstream";
var FIXED_MAC = "02:00:00:00:00:00";
var FINGERPRINT_FIXED = Object.freeze({
  board: "goldfish_arm64",
  brand: "google",
  cpuAbi: "arm64-v8a",
  device: "emu64a",
  diskInfo: "8GB",
  display: "sdk_gphone64_arm64",
  fingerprint: "google/sdk_gphone64_arm64/emu64a:14/UE1A.230829.036/11228894:user/release-keys",
  hardware: "ranchu",
  host: "abfarm",
  manufacturer: "Google",
  ramSize: "4GB",
  romSize: "8GB",
  tags: "release-keys",
  verId: ""
});

// src/portal.js
var MAX_SLEEP_MS = 5e3;
var PortalError = class extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PortalError";
    this.code = code;
    this.message = message || "";
  }
};
function mapPortalError(code, message, kino2) {
  const msg = typeof message === "string" ? message : "";
  if (code === "portal100004" || msg.includes("\u4E0D\u5B58\u5728")) {
    return kino2.error("not_found", "No se encontr\xF3 en Xuper");
  }
  if (code === "portal100024") {
    return kino2.error("geo_blocked", "Este contenido no est\xE1 disponible en tu regi\xF3n");
  }
  if (code === "aaa100027" || code === "aaa100028") {
    return kino2.error("auth_required", "Configura Xuper en Ajustes \u25B8 Plugins");
  }
  return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
}
var isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function makePortal({ kino: kino2, crypto, config, clock, snProvider }) {
  let preferredHost = null;
  let lastCallMs = null;
  const hostOrder = () => {
    const hosts2 = config.hosts || [];
    if (preferredHost === null) return hosts2;
    return [preferredHost, ...hosts2.filter((h) => h !== preferredHost)];
  };
  let slotTail = Promise.resolve();
  function waitTurn() {
    const run = slotTail.then(async () => {
      const now = clock.now();
      if (lastCallMs !== null) {
        const wait = Math.min(MAX_SLEEP_MS, Math.ceil(RATE_LIMIT_MS - (now - lastCallMs)));
        if (wait > 0) await kino2.sleep(wait);
      }
      lastCallMs = clock.now();
    });
    slotTail = run.then(() => {
    }, () => {
    });
    return run;
  }
  function deviceDict(sn) {
    return {
      ...DEVICE_FIXED,
      apkVersion: config.apkVersion,
      sysVersion: SPKG_VER,
      appId: config.appId,
      sn: sn ?? snProvider()
    };
  }
  async function call(path, bean = {}, opts = {}) {
    const { baseFields = true, userId = "", userToken = "", sn = null } = opts;
    const body = {
      ...baseFields ? { portalCode: PORTAL_CODE, userId, userToken } : {},
      ...bean,
      ...deviceDict(sn)
    };
    const wire = crypto.encryptBody(JSON.stringify(body));
    const headers = {
      apk: config.appId,
      apkVer: APK_VER_HEADER,
      spkgVer: SPKG_VER,
      "User-Agent": USER_AGENT,
      "Content-Type": CONTENT_TYPE
    };
    await waitTurn();
    let lastError = null;
    for (const host of hostOrder()) {
      let answer;
      try {
        const res = await kino2.fetch(`https://${host}/api/portalCore/${path}`, {
          method: "POST",
          headers,
          body: wire,
          cookies: false,
          timeoutMs: REQUEST_TIMEOUT_MS
        });
        answer = JSON.parse(res.text());
        if (!isObject(answer)) throw new Error("respuesta del portal no es un objeto");
        preferredHost = host;
        const rc = answer.returnCode;
        const code = rc === void 0 || rc === null ? "" : String(rc);
        if (code !== "" && code !== "0") {
          const em = answer.errorMessage;
          answer = { portalFailure: new PortalError(code, typeof em === "string" && em.trim() ? em : "") };
        } else if (typeof answer.data === "string" && answer.data !== "") {
          const inner = JSON.parse(crypto.decryptBlob(answer.data));
          if (!isObject(inner)) throw new Error("datos del portal no son un objeto");
          answer = { ok: inner };
        } else {
          answer = { ok: answer };
        }
      } catch (e) {
        lastError = e;
        try {
          kino2.log("portal " + path + ": " + String(e && e.message).replace(/\s+/g, " ").slice(0, 200));
        } catch (_) {
        }
        continue;
      }
      if (answer.portalFailure) throw answer.portalFailure;
      return answer.ok;
    }
    const detail = lastError === null ? "sin hosts configurados" : "No se pudo contactar a Xuper; intenta de nuevo en un momento";
    throw kino2.error("unavailable", detail);
  }
  return { call };
}

// src/session.js
var DEFAULT_SEEDS_URL = "https://raw.githubusercontent.com/xuper-plugin/kino-plugin-xuper/main/seeds.json";
var INVALID_SN = /* @__PURE__ */ new Set(["aaa100080", "aaa100082"]);
var SESSION_DEAD = /* @__PURE__ */ new Set(["aaa100027", "aaa100028"]);
var GEO_BLOCKED = "portal100024";
var SEED_RESCUE_ROUNDS = 3;
var SEED_SWITCH_TRIES = 5;
var POOL_REFRESH_COOLDOWN_MS = 1e4;
var PERIODIC_REFRESH_MS = 3 * 36e5;
var MAX_SEEDS = 200;
var str = (v) => typeof v === "string" ? v : v === null || v === void 0 ? "" : String(v);
var blank = (v) => str(v).trim() === "";
function makeLock() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task);
    tail = run.then(() => {
    }, () => {
    });
    return run;
  };
}
function makeSession({ kino: kino2, portal, clock, seedsUrl = DEFAULT_SEEDS_URL, random }) {
  const rand = random || (() => parseInt(kino2.crypto.randomBytes(4, "hex"), 16) / 4294967296);
  const lock = makeLock();
  const poolLock = makeLock();
  let lastPoolRefreshMs = null;
  let exhausted = false;
  const readJson = (key) => {
    try {
      const raw = kino2.storage.get(key);
      return raw === null || raw === void 0 ? null : JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };
  const writeJson = (key, value) => kino2.storage.set(key, JSON.stringify(value));
  const readSession = () => {
    const s = readJson("session");
    const o = s && typeof s === "object" ? s : {};
    return { userId: str(o.userId), userToken: str(o.userToken), jwtToken: str(o.jwtToken), sn: str(o.sn) };
  };
  const writeSession = (s) => writeJson("session", {
    userId: str(s.userId),
    userToken: str(s.userToken),
    jwtToken: str(s.jwtToken),
    sn: str(s.sn)
  });
  const view = () => {
    const s = readSession();
    return { userId: s.userId, userToken: s.userToken };
  };
  const hasToken = () => !blank(readSession().userToken);
  const account = () => {
    const email = kino2.config.get("email"), password = kino2.config.get("password");
    return blank(email) || blank(password) ? null : { email: str(email), password: str(password) };
  };
  const regionBlocked = () => {
    const r = readJson("region");
    return !!(r && r.blocked === true);
  };
  const setRegion = (blocked) => {
    if (regionBlocked() !== blocked) writeJson("region", { blocked });
  };
  const seedPool = () => {
    const raw = readJson("seeds");
    if (!Array.isArray(raw)) return [];
    return raw.filter((e) => e && typeof e === "object" && !blank(e.sn) && !blank(e.userToken)).map((e) => ({ sn: str(e.sn), userId: str(e.userId), userToken: str(e.userToken) }));
  };
  const pick = (pool) => pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  const seedSession = (e) => ({ userId: e.userId, userToken: e.userToken, jwtToken: "", sn: e.sn });
  const surface = (e) => e instanceof PortalError ? mapPortalError(e.code, e.message, kino2) : e;
  const activateBean = (snToken) => ({
    snToken,
    authVersion: "",
    authCode: "",
    preCode: "",
    macAddr: FIXED_MAC,
    reserve1: "",
    openNum: 4,
    channel: "default",
    matadata: "",
    signdata: ""
  });
  const randomHex = (bytes) => kino2.crypto.randomBytes(bytes, "hex");
  const randomMac = () => randomHex(6).match(/../g).join(":");
  const fingerprint = () => ({
    ...FINGERPRINT_FIXED,
    androidId: randomHex(8),
    cpuId: randomHex(8),
    serialNumber: randomHex(8),
    etheMac: randomMac(),
    gatewayMac: randomMac(),
    wifiMac: randomMac()
  });
  function saveFromResponse(j) {
    writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: readSession().sn });
  }
  async function activate(snToken, sn) {
    const j = await portal.call("v8/active", activateBean(snToken), { baseFields: false, sn });
    if (blank(j && j.userToken)) throw new PortalError("active_sin_token", "activaci\xF3n sin userToken");
    saveFromResponse(j);
  }
  async function mintDevice() {
    const j = await portal.call("v3/snToken", fingerprint(), { baseFields: false });
    if (blank(j && j.snToken)) throw new PortalError("snToken_failed", "el portal no devolvi\xF3 snToken");
    const snToken = str(j.snToken);
    const sn = (blank(j.sn) ? kino2.crypto.hash("md5", snToken + SNTOKEN_SALT) : str(j.sn)).toLowerCase();
    writeSession({ userId: "", userToken: "", jwtToken: "", sn });
    await activate(snToken, sn);
  }
  async function directAnonymous() {
    const storedSn = readSession().sn;
    if (!blank(storedSn)) {
      try {
        return await activate("", storedSn);
      } catch (e) {
        if (!(e instanceof PortalError && INVALID_SN.has(e.code))) throw e;
      }
    }
    return mintDevice();
  }
  async function ensureAnonymousUnlocked() {
    if (hasToken()) return;
    let direct;
    try {
      await directAnonymous();
      setRegion(false);
      return;
    } catch (e) {
      direct = e;
    }
    const pool = seedPool();
    if (pool.length > 0) {
      writeSession(seedSession(pick(pool)));
      return;
    }
    throw direct;
  }
  async function loginUnlocked(email, password) {
    const bean = {
      accountType: "2",
      userName: email,
      password: kino2.crypto.hash("md5", password + PASSWORD_SALT),
      type: "1",
      macAddr: FIXED_MAC,
      areaCode: "",
      verificationCode: "",
      verificationToken: "",
      matadata: "",
      signdata: "",
      channel: "default"
    };
    const j = await portal.call("v8/login", bean, { baseFields: false, sn: readSession().sn || null });
    if (blank(j && j.userToken)) throw new PortalError("login_sin_token", "login sin userToken");
    saveFromResponse(j);
  }
  async function ensureUnlocked() {
    if (hasToken()) return;
    const acc = account();
    if (acc) {
      try {
        await loginUnlocked(acc.email, acc.password);
        return;
      } catch (_) {
      }
    }
    await ensureAnonymousUnlocked();
  }
  function forgetToken() {
    const prev = readSession();
    if (prev.sn === "" && prev.userToken === "") return;
    writeSession({ ...prev, userId: "", userToken: "", jwtToken: "" });
  }
  const reauthenticate = (stale) => lock(async () => {
    const current = readSession().userToken;
    if (!blank(current) && current !== stale) return true;
    forgetToken();
    try {
      const acc = account();
      if (acc) await loginUnlocked(acc.email, acc.password);
      else await ensureAnonymousUnlocked();
      return true;
    } catch (_) {
      return false;
    }
  });
  const switchToBackup = (stale) => lock(async () => {
    const pool = seedPool();
    if (pool.length === 0) return false;
    if (readSession().userToken !== stale) return true;
    writeSession(seedSession(pick(pool)));
    return true;
  });
  async function fetchSeeds() {
    let list;
    try {
      const res = await kino2.fetch(seedsUrl, { timeoutMs: 15e3 });
      list = JSON.parse(res.text());
    } catch (_) {
      return;
    }
    if (!Array.isArray(list)) return;
    const clean = list.filter((e) => e && typeof e === "object" && !blank(e.sn) && !blank(e.userToken)).slice(0, MAX_SEEDS).map((e) => ({ sn: str(e.sn), userId: str(e.userId), userToken: str(e.userToken) }));
    if (clean.length === 0) return;
    writeJson("seeds", clean);
    writeJson("seedsAt", clock.now());
  }
  function refreshSeeds({ periodic = false } = {}) {
    return poolLock(async () => {
      if (periodic) {
        if (!regionBlocked() || account()) return seedPool().length > 0;
        const at = readJson("seedsAt");
        if (typeof at === "number" && clock.now() - at < PERIODIC_REFRESH_MS) return seedPool().length > 0;
      }
      const now = clock.now();
      if (lastPoolRefreshMs !== null && now - lastPoolRefreshMs < POOL_REFRESH_COOLDOWN_MS) {
        return seedPool().length > 0;
      }
      await fetchSeeds();
      const ok = seedPool().length > 0;
      if (ok) lastPoolRefreshMs = now;
      return ok;
    });
  }
  async function ensure() {
    await null;
    try {
      await lock(ensureUnlocked);
    } catch (e) {
      throw surface(e);
    }
  }
  async function login(email, password) {
    await null;
    try {
      await lock(() => loginUnlocked(email, password));
    } catch (e) {
      if (e instanceof PortalError) throw kino2.error("auth_required", "Credenciales de Xuper inv\xE1lidas");
      throw e;
    }
  }
  async function logout() {
    await null;
    try {
      await lock(async () => {
        const prev = readSession();
        if (!blank(prev.userToken)) {
          try {
            await portal.call(
              "v5/loginOut",
              { userId: prev.userId, userToken: prev.userToken },
              { baseFields: false, sn: prev.sn || null }
            );
          } catch (_) {
          }
        }
        forgetToken();
        await ensureAnonymousUnlocked();
      });
    } catch (e) {
      throw surface(e);
    }
  }
  async function withValidSession(block) {
    await null;
    const settle = (r) => {
      if (r.err) throw mapPortalError(r.err.code, r.err.message, kino2);
      exhausted = false;
      return r.value;
    };
    const attempt = async () => {
      try {
        return { value: await block(view()) };
      } catch (e) {
        if (e instanceof PortalError) return { err: e };
        throw e;
      }
    };
    const tokenUsed = view().userToken;
    let result = await attempt();
    if (!result.err) return settle(result);
    if (result.err.code === GEO_BLOCKED) {
      setRegion(true);
      if (!account()) {
        if (await switchToBackup(tokenUsed)) result = await attempt();
        if (!result.err) return settle(result);
      }
    }
    if (await reauthenticate(tokenUsed)) {
      result = await attempt();
      if (!result.err) return settle(result);
    }
    if (SESSION_DEAD.has(result.err.code) && !account()) {
      setRegion(true);
      for (let round = 0; round < SEED_RESCUE_ROUNDS; round++) {
        if (await refreshSeeds() && await switchToBackup(view().userToken)) {
          const retry = await attempt();
          if (!retry.err || !SESSION_DEAD.has(retry.err.code)) return settle(retry);
        }
      }
      exhausted = true;
    }
    return settle(result);
  }
  async function switchSeed() {
    await null;
    return lock(async () => {
      if (account()) return { result: "account_linked", tries: 0 };
      const current = readSession().sn;
      const candidates = seedPool().filter((e) => e.sn !== current);
      for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.min(i, Math.floor(rand() * (i + 1)));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
      if (candidates.length === 0) return { result: "no_other_seed", tries: 0 };
      let tries = 0;
      for (const c of candidates.slice(0, SEED_SWITCH_TRIES)) {
        tries++;
        try {
          const j = await portal.call("v8/active", activateBean(""), { baseFields: false, sn: c.sn });
          if (blank(j && j.userToken)) continue;
          writeSession({ userId: j.userId, userToken: j.userToken, jwtToken: j.jwtToken, sn: c.sn });
          return { result: "ok", tries };
        } catch (_) {
        }
      }
      return { result: "all_failed", tries };
    });
  }
  function kind() {
    if (account()) return "account";
    const s = readSession();
    if (blank(s.sn)) return "none";
    return seedPool().some((e) => e.sn === s.sn) ? "seed" : "own";
  }
  return {
    ensure,
    withValidSession,
    current: readSession,
    kind,
    login,
    logout,
    regionBlocked,
    seedsExhausted: () => exhausted,
    switchSeed,
    refreshSeeds,
    seedPool
  };
}

// src/homeClassifier.js
var KINDS = [
  { root: "peliculas", label: "Pel\xEDculas" },
  { root: "series", label: "Series" },
  { root: "anime", label: "Anime" },
  { root: "infantil", label: "Infantil" }
];
var byRoot = Object.fromEntries(KINDS.map((k) => [k.root, k]));
var MIN_GENRE_SIZE = 6;
var MAX_ROW_SIZE = 20;
var TRAILER = "trailer";
var PRECEDENCE = ["anime", "infantil", "series", "peliculas"];
var FEATURED = ["peliculas", "series"];
var GENRES = new Map(Object.entries({
  "Action": ["action", "Acci\xF3n"],
  "Adventure": ["adventure", "Aventura"],
  "Comedy": ["comedy", "Comedia"],
  "Drama": ["drama", "Drama"],
  "Thriller": ["thriller", "Suspenso"],
  "Crime": ["crime", "Crimen"],
  "Sci-Fi": ["scifi", "Ciencia ficci\xF3n"],
  "Fantasy": ["fantasy", "Fantas\xEDa"],
  "Romance": ["romance", "Romance"],
  "Mystery": ["mystery", "Misterio"],
  "Horror": ["horror", "Terror"],
  "Family": ["family", "Familia"],
  "Biography": ["biography", "Biograf\xEDa"],
  "History": ["history", "Historia"],
  "Documentary": ["documentary", "Documental"],
  "Western": ["western", "Western"],
  "War": ["war", "Guerra"],
  "Reality-TV": ["reality", "Reality"],
  "Sport": ["sport", "Deportes"],
  "Music": ["music", "M\xFAsica"],
  "Musical": ["music", "M\xFAsica"]
}));
var YEAR_SECTION = /^(\d{4})(.*)$/;
var cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
var byScore = (a, b) => cmp(b.score ?? -1, a.score ?? -1) || cmp(a.title, b.title) || cmp(a.id, b.id);
var plain = (text2) => text2.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").trim();
function distinctBy(list, key) {
  const seen = /* @__PURE__ */ new Set();
  return list.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
var row = (id, title, items) => ({ id, title, shown: items.slice(0, MAX_ROW_SIZE), all: items });
var genresOf = (item) => distinctBy(item.genres.map((g) => GENRES.get(g.trim())).filter((g) => g !== void 0), (g) => g[0]);
var newestFirst = (items) => items.some((i) => i.shelvedAtMs > 0) ? [...items].sort((a, b) => b.shelvedAtMs - a.shelvedAtMs) : items;
var playable = (section) => distinctBy(section.items.filter((i) => i.type !== TRAILER), (i) => i.id);
function yearSections(sections) {
  const out = [];
  for (const s of sections) {
    const m = YEAR_SECTION.exec(s.name.trim());
    if (m) out.push({ year: Number(m[1]), suffix: plain(m[2]), section: s });
  }
  return out.sort((a, b) => b.year - a.year);
}
function plainYearSection(sections) {
  for (const y of yearSections(sections)) {
    if (y.suffix !== "") continue;
    const items = playable(y.section);
    if (items.length > 0) return items;
  }
  return null;
}
function recentMoviesRow(sectionsOf) {
  const items = plainYearSection(sectionsOf.peliculas);
  return items && row("magis_recent_peliculas", "Reci\xE9n agregadas \xB7 Pel\xEDculas", newestFirst(items));
}
function updatedSeriesRow(sectionsOf) {
  const items = plainYearSection(sectionsOf.series);
  return items && row("magis_new_series", "Series con cap\xEDtulos nuevos", newestFirst(items));
}
function cinemaRow(sectionsOf) {
  for (const y of yearSections(sectionsOf.peliculas)) {
    if (!y.suffix.includes("teatral")) continue;
    const items = playable(y.section);
    if (items.length > 0) return row("magis_new_peliculas", "Estrenos de cine", items);
  }
  return null;
}
function topRatedRows(byKind) {
  const out = [];
  for (const root of FEATURED) {
    const ranked = [...byKind[root]].sort(byScore);
    if (ranked.length === 0) continue;
    out.push({
      id: `magis_top_${root}`,
      title: `${byRoot[root].label} mejor valoradas`,
      shown: ranked.slice(0, MAX_ROW_SIZE),
      all: ranked
    });
  }
  return out;
}
function genreRows(byKind) {
  const perKind = KINDS.map(({ root }) => {
    const members = /* @__PURE__ */ new Map();
    const labels = /* @__PURE__ */ new Map();
    for (const item of byKind[root]) {
      for (const [key, label] of genresOf(item)) {
        if (!members.has(key)) members.set(key, []);
        members.get(key).push(item);
        labels.set(key, label);
      }
    }
    const groups = [];
    for (const [key, items] of members) {
      if (items.length >= MIN_GENRE_SIZE) groups.push({ root, key, label: labels.get(key), items });
    }
    return groups.sort((a, b) => b.items.length - a.items.length || cmp(a.label, b.label));
  });
  const ordered = [];
  const longest = Math.max(0, ...perKind.map((g) => g.length));
  for (let i = 0; i < longest; i++) for (const groups of perKind) if (groups[i]) ordered.push(groups[i]);
  const seen = /* @__PURE__ */ new Set();
  return ordered.map((g) => {
    const shown = [...g.items].sort((a, b) => (seen.has(a.id) ? 1 : 0) - (seen.has(b.id) ? 1 : 0) || byScore(a, b)).slice(0, MAX_ROW_SIZE);
    for (const i of shown) seen.add(i.id);
    return {
      id: `magis_g_${g.root}_${g.key}`,
      title: `${g.label} \xB7 ${byRoot[g.root].label}`,
      shown,
      all: [...g.items].sort(byScore)
    };
  });
}
function classify(roots) {
  const sectionsOf = Object.fromEntries(KINDS.map((k) => [k.root, roots[k.root] || []]));
  const kindOf = /* @__PURE__ */ new Map();
  for (const root of PRECEDENCE) {
    for (const section of sectionsOf[root]) {
      for (const item of section.items) {
        if (item.type !== TRAILER && !kindOf.has(item.id)) kindOf.set(item.id, [root, item]);
      }
    }
  }
  const byKind = Object.fromEntries(KINDS.map((k) => [k.root, []]));
  for (const [root, item] of kindOf.values()) byKind[root].push(item);
  return [recentMoviesRow(sectionsOf), updatedSeriesRow(sectionsOf)].filter(Boolean).concat(topRatedRows(byKind), [cinemaRow(sectionsOf)].filter(Boolean), genreRows(byKind));
}

// src/refs.js
var PREFIX = "magis1";
var SERIES = /* @__PURE__ */ new Set(["teleplay", "series", "variety"]);
var isSeries = (programType) => SERIES.has(programType);
var blank2 = (s) => typeof s !== "string" || s.trim() === "";
var INT = /^[+-]?\d+$/;
function toIntOrNull(text2) {
  if (!INT.test(text2)) return null;
  const n = Number(text2);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
var make = (contentId, programType, episode) => ({ contentId, programType, episode, isSeries: isSeries(programType) });
function encode({ contentId, programType = "movie", episode = 0 }) {
  return `${PREFIX}:${programType || "movie"}:${episode}:${contentId}`;
}
function encodeChapter(seriesNumber, seasonContentId) {
  return encode({ contentId: seasonContentId, programType: "teleplay", episode: seriesNumber });
}
var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlToText(data) {
  const body = data.replace(/={1,2}$/, "");
  if (body.length % 4 === 1 || /[^A-Za-z0-9_-]/.test(body)) return null;
  const bytes = [];
  let acc = 0, bits = 0;
  for (const ch of body) {
    acc = acc << 6 | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push(acc >> bits & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return utf8(bytes);
}
function utf8(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 128) {
      out += String.fromCharCode(b);
      i++;
      continue;
    }
    const need = b >= 194 && b < 224 ? 1 : b >= 224 && b < 240 ? 2 : b >= 240 && b < 245 ? 3 : 0;
    if (need === 0 || i + need > bytes.length - 1) {
      out += "\uFFFD";
      i++;
      continue;
    }
    let cp = b & 255 >> need + 2;
    let ok = true;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if ((c & 192) !== 128) {
        ok = false;
        break;
      }
      cp = cp << 6 | c & 63;
    }
    if (!ok || cp > 1114111) {
      out += "\uFFFD";
      i++;
      continue;
    }
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
var optString = (v) => v === null || v === void 0 ? "" : typeof v === "string" ? v : String(v);
function optInt(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string") {
    const n = Number(v.trim());
    return v.trim() !== "" && Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  return 0;
}
function fromGatewayRef(ref) {
  const dot = ref.indexOf(".");
  if (dot < 0) return null;
  const data = ref.slice(0, dot);
  if (blank2(data)) return null;
  let json;
  try {
    const text2 = base64UrlToText(data);
    json = text2 === null ? null : JSON.parse(text2);
  } catch (_) {
    return null;
  }
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  if (optString(json.s) !== "magis") return null;
  const p = json.p;
  if (p === null || typeof p !== "object" || Array.isArray(p)) return null;
  const contentId = optString(p.content_id);
  if (blank2(contentId)) return null;
  return make(contentId, optString(p.program_type).trim() === "" ? "movie" : optString(p.program_type), optInt(p.episode));
}
function decode(ref) {
  if (typeof ref !== "string" || blank2(ref)) return null;
  if (ref.startsWith(PREFIX + ":")) {
    const parts = ref.split(":");
    if (parts.length < 4) return null;
    const contentId = parts.slice(3).join(":");
    if (blank2(contentId)) return null;
    const type = parts[1];
    return make(contentId, type.trim() === "" ? "movie" : type, toIntOrNull(parts[2]) ?? 0);
  }
  return fromGatewayRef(ref);
}

// src/homeTree.js
var PORTAL_OFFSET_MS = 8 * 36e5;
var isBlank = (s) => typeof s !== "string" || s.trim() === "";
var asText = (v) => v === null || v === void 0 ? "" : typeof v === "string" ? v : String(v);
var nonBlank = (v) => {
  const s = asText(v);
  return s.trim() === "" ? null : s;
};
var INT2 = /^[+-]?\d+$/;
var DEC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function intOrNull(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  if (!INT2.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
function numberOrNull(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  return DEC.test(s) ? Number(s) : null;
}
function parseShelveTime(text2) {
  const raw = typeof text2 === "string" ? text2.trim() : "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2}) (\d{1,2}):(\d{1,2}):(\d{1,2})$/.exec(raw);
  if (!m) return 0;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || back.getUTCHours() !== h || back.getUTCMinutes() !== mi || back.getUTCSeconds() !== s) return 0;
  return t - PORTAL_OFFSET_MS;
}
function imageOf(asset, fileType) {
  if (!Array.isArray(asset.posterList)) return null;
  for (const p of asset.posterList) {
    if (p && p.fileType === fileType && !isBlank(p.fileUrl)) return p.fileUrl;
  }
  return null;
}
var logoOf = (a) => imageOf(a, "icon") ?? nonBlank(a.posterUrl);
function itemFrom(a) {
  if (a === null || typeof a !== "object") return null;
  const id = nonBlank(a.contentId);
  if (id === null) return null;
  const type = nonBlank(a.programType) ?? "movie";
  const tags = asText(a.tags).split(",").map((t) => t.trim()).filter((t) => t !== "");
  return {
    id,
    title: asText(a.name),
    poster: imageOf(a, "icon") ?? nonBlank(a.posterUrl),
    backdrop: imageOf(a, "poster"),
    durationS: intOrNull(a.duration) ?? 0,
    type,
    genres: tags,
    score: numberOrNull(a.score),
    description: asText(a.description),
    shelvedAtMs: parseShelveTime(asText(a.shelveTime))
  };
}
function parseTree(response) {
  const columns = response && Array.isArray(response.recommendList) ? response.recommendList : [];
  const sections = [];
  for (const c of columns) {
    if (c === null || typeof c !== "object") continue;
    const name = nonBlank(c.name);
    if (name === null) continue;
    const items = [];
    if (Array.isArray(c.assetList)) for (const a of c.assetList) {
      const it = itemFrom(a);
      if (it) items.push(it);
    }
    sections.push({ name, items });
  }
  return sections;
}
var refOf = (item) => encode({ contentId: item.id, programType: item.type, episode: 0 });
function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) n += 1;
    else if (c < 2048) n += 2;
    else if (c >= 55296 && c < 56320 && i + 1 < s.length) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}
function commonPrefix(urls) {
  if (urls.length === 0) return "";
  let p = urls[0];
  for (const u of urls) {
    while (!u.startsWith(p)) p = p.slice(0, -1);
    if (p === "") break;
  }
  return p.length >= 12 ? p : "";
}
function cut(text2, max) {
  if (text2.length <= max) return text2;
  const end = text2.charCodeAt(max - 1) >= 55296 && text2.charCodeAt(max - 1) < 56320 ? max - 1 : max;
  return text2.slice(0, end);
}
var TREE_FORMAT = 1;
function encodeTree(sections, { descMax = Infinity, genres = true, backdrop = true, perSection = Infinity } = {}) {
  sections = sections.map((s2) => s2.items.length > perSection ? { ...s2, items: s2.items.slice(0, perSection) } : s2);
  const urls = [];
  for (const s2 of sections) for (const i of s2.items) {
    if (i.poster) urls.push(i.poster);
    if (backdrop && i.backdrop) urls.push(i.backdrop);
  }
  const p = commonPrefix(urls);
  const strip = (u) => u === null ? null : u.slice(p.length);
  const table = /* @__PURE__ */ new Map();
  const items = [];
  const s = sections.map((sec) => [sec.name, sec.items.map((i) => {
    const rec = [
      i.id,
      i.title,
      strip(i.poster),
      backdrop ? strip(i.backdrop) : null,
      i.durationS,
      i.type,
      genres ? i.genres : [],
      i.score,
      cut(i.description, descMax),
      i.shelvedAtMs
    ];
    const key = JSON.stringify(rec);
    if (!table.has(key)) {
      table.set(key, items.length);
      items.push(rec);
    }
    return table.get(key);
  })]);
  return JSON.stringify({ v: TREE_FORMAT, p, i: items, s });
}
function decodeTree(text2) {
  const o = JSON.parse(text2);
  if (o === null || typeof o !== "object" || o.v !== TREE_FORMAT || typeof o.p !== "string" || !Array.isArray(o.i) || !Array.isArray(o.s)) {
    throw new Error("stored tree is malformed");
  }
  const full = (u) => typeof u === "string" ? o.p + u : null;
  const items = o.i.map((r) => {
    if (!Array.isArray(r) || typeof r[0] !== "string" || typeof r[5] !== "string" || !Array.isArray(r[6])) {
      throw new Error("stored item is malformed");
    }
    return {
      id: r[0],
      title: asText(r[1]),
      poster: full(r[2]),
      backdrop: full(r[3]),
      durationS: Number(r[4]) || 0,
      type: r[5],
      genres: r[6].map(asText),
      score: typeof r[7] === "number" ? r[7] : null,
      description: asText(r[8]),
      shelvedAtMs: Number(r[9]) || 0
    };
  });
  return o.s.map((sec) => {
    if (!Array.isArray(sec) || typeof sec[0] !== "string" || !Array.isArray(sec[1])) throw new Error("stored section is malformed");
    return { name: sec[0], items: sec[1].map((n) => {
      if (!items[n]) throw new Error("stored index is malformed");
      return items[n];
    }) };
  });
}

// src/byteCache.js
var isObject2 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
function makeByteCache({ kino: kino2, key, budgetBytes, clock, ttlMs, valid = () => true }) {
  const decode2 = (raw) => {
    try {
      const o = JSON.parse(raw);
      if (!isObject2(o) || o.v !== 1 || !Array.isArray(o.e)) return [];
      return o.e.filter((x) => isObject2(x) && typeof x.k === "string" && Number.isFinite(x.s) && x.i !== void 0 && valid(x.i));
    } catch (_) {
      return [];
    }
  };
  const encode2 = (entries) => JSON.stringify({ v: 1, e: entries });
  function read() {
    try {
      const raw = kino2.storage.get(key);
      return raw === null || raw === void 0 ? [] : decode2(raw);
    } catch (_) {
      return [];
    }
  }
  const fresh = (entry, nowMs) => nowMs - entry.s < ttlMs;
  function get(k, entries = read(), nowMs = clock.now()) {
    const hit = entries.find((e) => e.k === k && fresh(e, nowMs));
    return hit === void 0 ? void 0 : hit.i;
  }
  function write(added, touched = []) {
    try {
      const now = clock.now();
      let entries = read().filter((e) => fresh(e, now));
      for (const k of touched) {
        const at = entries.findIndex((e) => e.k === k);
        if (at >= 0) entries.push(...entries.splice(at, 1));
      }
      for (const a of added) {
        const entry = { k: a.k, s: now, i: a.i };
        if (utf8Length(encode2([entry])) > budgetBytes) continue;
        entries = entries.filter((e) => e.k !== a.k);
        entries.push(entry);
      }
      let text2 = encode2(entries);
      while (utf8Length(text2) > budgetBytes && entries.length > 0) {
        entries.shift();
        text2 = encode2(entries);
      }
      if (entries.length === 0) return;
      kino2.storage.set(key, text2);
    } catch (_) {
    }
  }
  return { read, get, fresh, write };
}

// src/search.js
var ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
var MAX_OUTPUT_ITEMS = 100;
var MAX_ALT_TITLES = 5;
var MAX_SPANISH_FORMS = 3;
var MAX_FULL_TITLE_RETRIES = 4;
var PAGE_SIZE = 20;
var CACHE_KEY = "search:v1";
var CACHE_BUDGET_BYTES = 24e3;
var CACHE_FRESH_MS = 6 * 36e5;
var B = "(?<![\\p{L}\\p{N}_])";
var E = "(?![\\p{L}\\p{N}_])";
var SEASON_SOURCE = `(?:${B}T\\s?([0-9]{1,2})${E}|${B}Temp\\.?\\s?([0-9]{1,2})${E}|${B}Temporada\\s?([0-9]{1,2})${E}|${B}S([0-9]{1,2})${E})`;
function seasonFromName(name) {
  const m = new RegExp(SEASON_SOURCE, "iu").exec(typeof name === "string" ? name : "");
  if (!m) return 1;
  const digits = m.slice(1).find((g) => g !== void 0 && g.trim() !== "");
  return digits === void 0 ? 1 : Number(digits);
}
var withoutSeason = (name) => (typeof name === "string" ? name : "").replace(new RegExp(SEASON_SOURCE, "giu"), "").trim().toLowerCase();
function sortSeasons(items) {
  const slots = [];
  items.forEach((it, i) => {
    if (isSeries(it.p)) slots.push(i);
  });
  if (slots.length < 2) return items;
  const order = /* @__PURE__ */ new Map();
  for (const i of slots) {
    const key = withoutSeason(items[i].t);
    if (!order.has(key)) order.set(key, order.size);
  }
  const sorted = slots.map((i) => items[i]).sort((a, b) => order.get(withoutSeason(a.t)) - order.get(withoutSeason(b.t)) || seasonFromName(a.t) - seasonFromName(b.t));
  const out = items.slice();
  slots.forEach((i, pos) => {
    out[i] = sorted[pos];
  });
  return out;
}
var str2 = (v) => typeof v === "string" ? v : "";
var isObject3 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var INT3 = /^[+-]?\d+$/;
function intOrNull2(v) {
  if (typeof v === "number") return Number.isInteger(v) ? v : null;
  if (typeof v === "string" && INT3.test(v)) {
    const n = Number(v);
    return n >= -2147483648 && n <= 2147483647 ? n : null;
  }
  return null;
}
function slim(raw) {
  if (!isObject3(raw)) return null;
  const c = str2(raw.contentId);
  if (c.trim() === "") return null;
  const alias = str2(raw.alias);
  const t = [raw.name, raw.viewPoint, raw.alias].map(str2).find((s) => s.trim() !== "") ?? "";
  const out = { c, t };
  if (alias !== t && alias.trim() !== "") out.a = alias;
  const programType = str2(raw.programType).trim() === "" ? "movie" : str2(raw.programType);
  if (programType !== "movie") out.p = programType;
  const year = str2(raw.releaseTime).slice(0, 4);
  if (/^[0-9]{4}$/.test(year)) out.y = year;
  const n = intOrNull2(raw.volumnCount) ?? intOrNull2(raw.updateCount) ?? 0;
  if (n !== 0) out.n = n;
  if (Array.isArray(raw.posterList)) {
    for (const p of raw.posterList) {
      if (!isObject3(p)) continue;
      const key = p.fileType === "icon" ? "m" : p.fileType === "poster" ? "b" : null;
      const url = str2(p.fileUrl);
      if (key !== null && url.trim() !== "" && out[key] === void 0) out[key] = url;
    }
  }
  return out;
}
var eachObject = (list, f) => {
  if (Array.isArray(list)) {
    for (const x of list) if (isObject3(x)) f(x);
  }
};
function flatten(response) {
  const out = [];
  if (isObject3(response)) {
    eachObject(response.searchItemList, (group) => eachObject(group.itemList, (x) => out.push(x)));
    if (out.length === 0) eachObject(Array.isArray(response.assetList) ? response.assetList : response.list, (x) => out.push(x));
  }
  return out;
}
var validEntryItems = (items) => Array.isArray(items) && items.every((it) => isObject3(it) && typeof it.c === "string" && typeof it.t === "string");
var isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
var intOr0 = (v) => typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
var distinctBy2 = (list, keyOf) => {
  const seen = /* @__PURE__ */ new Set();
  return list.filter((x) => {
    const k = keyOf(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};
function makeSearch({ kino: kino2, portal, session, clock, tmdb = null }) {
  const surface = (e) => {
    if (e instanceof PortalError) return mapPortalError(e.code, e.message, kino2);
    if (isKinoError(e)) return e;
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  const log = (msg) => {
    try {
      kino2.log(msg);
    } catch (_) {
    }
  };
  const cache = makeByteCache({ kino: kino2, key: CACHE_KEY, budgetBytes: CACHE_BUDGET_BYTES, clock, ttlMs: CACHE_FRESH_MS, valid: validEntryItems });
  function contextOf(query) {
    const q = isObject3(query) ? query : {};
    const rawType = typeof q.type === "string" ? q.type.trim() : "";
    return {
      q: typeof q.q === "string" ? q.q.trim() : "",
      type: rawType === "" ? "movie" : rawType === "series" ? "tv" : rawType,
      season: intOr0(q.season),
      episode: intOr0(q.episode),
      tmdbId: intOr0(q.tmdbId),
      originalTitle: typeof q.originalTitle === "string" ? q.originalTitle : "",
      altTitles: Array.isArray(q.altTitles) ? q.altTitles.filter((s) => typeof s === "string").slice(0, MAX_ALT_TITLES) : []
    };
  }
  async function titleForms(ctx) {
    const forms = [ctx.q];
    if (ctx.tmdbId > 0 && tmdb) {
      let detail = null;
      try {
        detail = await tmdb.titleForms(ctx.type === "movie" ? "movie" : "tv", ctx.tmdbId);
      } catch (_) {
        detail = null;
      }
      if (detail) {
        for (const t of [detail.title, detail.originalTitle, detail.englishTitle]) if (typeof t === "string" && t.trim() !== "") forms.push(t);
        for (const t of (Array.isArray(detail.spanishTitles) ? detail.spanishTitles : []).slice(0, MAX_SPANISH_FORMS)) forms.push(t);
      }
    }
    for (const t of [ctx.originalTitle, ...ctx.altTitles]) if (t.trim() !== "") forms.push(t);
    return distinctBy2(forms, (f) => f.trim().toLowerCase());
  }
  async function search2(query) {
    const ctx = contextOf(query);
    if (ctx.q === "") return [];
    const forms = await titleForms(ctx);
    const queries = distinctBy2(forms.map((f) => kino2.rank.shortQuery(f)), (f) => f.toLowerCase());
    const entries = cache.read();
    const nowMs = clock.now();
    const touched = [];
    const added = [];
    const seen = /* @__PURE__ */ new Set();
    const pool = [];
    let lastError = null;
    let ensuring = null;
    async function portalItems(q) {
      ensuring ?? (ensuring = session.ensure());
      await ensuring;
      const response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "v3/searchByName",
        { value: q, type: "0", columnId: "", filter: "", pageNum: 1, pageSize: PAGE_SIZE },
        { baseFields: true, userId, userToken }
      ));
      return flatten(response).map(slim).filter((x) => x !== null);
    }
    async function fetchInto(qs) {
      for (const q of qs) {
        const key = q.toLowerCase();
        let part = null;
        const hit = cache.get(key, entries, nowMs);
        if (hit !== void 0) {
          part = hit;
          touched.push(key);
        } else {
          try {
            part = await portalItems(q);
            if (part.length > 0) added.push({ k: key, i: part });
          } catch (e) {
            lastError = e;
            part = null;
          }
        }
        if (part) {
          for (const item of part) if (!seen.has(item.c)) {
            seen.add(item.c);
            pool.push(item);
          }
        }
      }
    }
    const titlesOf = (item) => [item.t, item.a ?? ""];
    const ranked = () => kino2.rank.filterRelevant(kino2.rank.sortBySimilarity(pool, forms, titlesOf), forms, titlesOf);
    let items;
    try {
      await fetchInto(queries);
      if (pool.length === 0 && lastError !== null) throw surface(lastError);
      items = ranked();
      if (items.length === 0) {
        const asked = new Set(queries.map((s) => s.trim().toLowerCase()));
        const full = distinctBy2(
          forms.map((f) => f.trim()).filter((f) => f !== "" && !asked.has(f.toLowerCase())),
          (f) => f.toLowerCase()
        ).slice(0, MAX_FULL_TITLE_RETRIES);
        if (full.length > 0) {
          await fetchInto(full);
          items = ranked();
        }
      }
    } finally {
      if (added.length > 0 || touched.length > 0) cache.write(added, touched);
    }
    if ((ctx.type === "tv" || ctx.type === "anime") && ctx.season > 0) {
      const matching = items.filter((it) => !isSeries(it.p ?? "movie") || seasonFromName(it.t) === ctx.season);
      if (matching.length > 0) items = matching;
    }
    if (items.length === 0 && ctx.tmdbId > 0) log(`xuper search: 0 results tmdb=${ctx.tmdbId} type=${ctx.type} pool=${pool.length}`);
    const out = [];
    for (const it of sortSeasons(items)) {
      if (!ITEM_ID.test(it.c)) continue;
      const programType = it.p ?? "movie";
      const series = isSeries(programType);
      const item = {
        id: it.c,
        ref: encode({ contentId: it.c, programType, episode: ctx.episode }),
        title: it.t.trim() === "" ? it.c : it.t,
        kind: series ? "series" : "movie",
        year: it.y ?? "",
        season: series ? seasonFromName(it.t) : ctx.season,
        episodeCount: it.n ?? 0
      };
      if (it.m) item.poster = it.m;
      if (it.b) item.backdrop = it.b;
      out.push(item);
      if (out.length >= MAX_OUTPUT_ITEMS) break;
    }
    return out;
  }
  return { search: search2 };
}

// src/episodes.js
var CACHE_KEY2 = "chapters:v1";
var CACHE_BUDGET_BYTES2 = 32e3;
var CACHE_FRESH_MS2 = 6 * 36e5;
var IMDB = /^tt\d{7,}$/;
var MAX_EPISODES = 5e3;
var MAX_SEASONS = 50;
var isObject4 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var INT4 = /^[+-]?\d+$/;
function toIntOrNull2(v) {
  const text2 = typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
  if (text2 === null || !INT4.test(text2)) return null;
  const n = Number(text2);
  return n >= -2147483648 && n <= 2147483647 ? n || 0 : null;
}
var optString2 = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
function parseSeasonList(list, ownId) {
  let own = null;
  const all = [];
  const entries = Array.isArray(list) ? list : [];
  for (const entry of entries) {
    if (!isObject4(entry)) continue;
    const id = optString2(entry.contentId);
    const number = toIntOrNull2(entry.seasonNumber);
    if (id === ownId) own = number;
    if (id.trim() !== "" && number !== null) all.push({ id, number });
  }
  if (own === null && entries.length === 0) own = 1;
  all.sort((a, b) => a.number - b.number);
  return { own, all };
}
function findChapter(items, episode) {
  if (episode <= 0) return items[0];
  return items.find((it) => typeof it.seriesNumber === "string" && it.seriesNumber.trim() === String(episode));
}
var validPayload = (p) => isObject4(p) && typeof p.i === "string" && Array.isArray(p.a) && Array.isArray(p.e) && p.e.every((x) => Array.isArray(x) && typeof x[1] === "string" && typeof x[2] === "string") && p.a.every((x) => Array.isArray(x) && typeof x[0] === "string" && Number.isInteger(x[1])) && (p.s === null || Number.isInteger(p.s)) && (p.d === null || Number.isInteger(p.d));
function pack(raw) {
  return {
    i: raw.imdb,
    s: raw.season,
    d: raw.declared,
    a: raw.seasons.map((x) => [x.id, x.number]),
    e: raw.items.map((it) => it.duration === void 0 ? [it.seriesNumber, it.contentId, it.name] : [it.seriesNumber, it.contentId, it.name, it.duration])
  };
}
var unpack = (p) => ({
  items: p.e.map((x) => ({ seriesNumber: x[0], contentId: x[1], name: x[2], duration: x[3] })),
  imdb: p.i,
  season: p.s,
  declared: p.d,
  seasons: p.a.map((x) => ({ id: x[0], number: x[1] }))
});
function makePortalChapters({ kino: kino2, portal, session, clock }) {
  const cache = makeByteCache({ kino: kino2, key: CACHE_KEY2, budgetBytes: CACHE_BUDGET_BYTES2, clock, ttlMs: CACHE_FRESH_MS2, valid: validPayload });
  const isKinoError5 = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
  async function fetchDetail(seriesId) {
    let response;
    try {
      await session.ensure();
      response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "v4/getItemData",
        { contentId: seriesId, type: "0", sortType: "0", language: "en", macAddr: FIXED_MAC },
        { baseFields: true, userId, userToken }
      ));
    } catch (e) {
      if (e instanceof PortalError) throw mapPortalError(e.code, e.message, kino2);
      if (isKinoError5(e)) throw e;
      throw kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
    }
    const data = isObject4(response) ? response.assetData : void 0;
    if (!isObject4(data)) throw kino2.error("unavailable", "Xuper devolvi\xF3 una cap\xEDtulos sin datos");
    return data;
  }
  return async function portalChapters(seriesId) {
    const cached = cache.get(seriesId);
    if (cached !== void 0) return unpack(cached);
    const data = await fetchDetail(seriesId);
    const items = (Array.isArray(data.simpleProgramList) ? data.simpleProgramList : []).filter(isObject4).map((it) => {
      const seriesNumber = typeof it.seriesNumber === "string" ? it.seriesNumber : typeof it.seriesNumber === "number" ? String(it.seriesNumber) : null;
      const item = { seriesNumber, contentId: optString2(it.contentId), name: optString2(it.name), duration: void 0 };
      if (typeof it.duration === "string" || typeof it.duration === "number" && Number.isFinite(it.duration)) item.duration = it.duration;
      return item;
    });
    const seasonList = parseSeasonList(data.sameSeasonSeriesList, seriesId);
    const raw = { items, imdb: optString2(data.keyWords), season: seasonList.own, declared: toIntOrNull2(data.volumnCount), seasons: seasonList.all };
    if (items.length > 0) cache.write([{ k: seriesId, i: pack(raw) }]);
    return raw;
  };
}
function makeEpisodes({ kino: kino2, tmdb = null, portalChapters }) {
  async function enrich(raw) {
    const none = { extra: /* @__PURE__ */ new Map(), series: null };
    if (!tmdb || !IMDB.test(raw.imdb) || raw.season === null) return none;
    try {
      const series = await tmdb.seriesByImdb(raw.imdb);
      if (!series) return none;
      const fromTmdb = await tmdb.seasonEpisodes(series.tmdbId, raw.season);
      if (!fromTmdb) return { extra: /* @__PURE__ */ new Map(), series };
      const expected = raw.declared !== null && raw.declared > 0 ? raw.declared : raw.items.length;
      if (expected !== fromTmdb.length) return { extra: /* @__PURE__ */ new Map(), series };
      const rows = /* @__PURE__ */ new Map();
      for (const c of fromTmdb) {
        const row2 = { still: c.still.trim() !== "" ? c.still : null, title: c.name.trim() !== "" ? c.name : null, overview: c.overview.trim() !== "" ? c.overview : null };
        if (row2.still !== null || row2.title !== null || row2.overview !== null) rows.set(c.episode, row2);
        else rows.delete(c.episode);
      }
      const missing = new Set([...rows].filter(([, r]) => r.overview === null).map(([n]) => n));
      if (missing.size === 0) return { extra: rows, series };
      let inEnglish = [];
      try {
        inEnglish = await tmdb.seasonEpisodes(series.tmdbId, raw.season, "en-US") ?? [];
      } catch (_) {
        inEnglish = [];
      }
      for (const c of inEnglish) {
        if (missing.has(c.episode) && c.overview.trim() !== "") rows.set(c.episode, { ...rows.get(c.episode), overview: c.overview });
      }
      return { extra: rows, series };
    } catch (_) {
      return none;
    }
  }
  return async function episodes2(ref) {
    const magis = decode(ref);
    if (!magis) throw kino2.error("unavailable", "ese ref no es de Xuper: no se pueden listar cap\xEDtulos");
    const raw = await portalChapters(magis.contentId);
    const { extra, series } = await enrich(raw);
    const list = raw.items.slice(0, MAX_EPISODES).map((it) => {
      const number = toIntOrNull2(it.seriesNumber) ?? 0;
      const ep = {
        number,
        title: it.name.trim() !== "" ? it.name : `Cap\xEDtulo ${number}`,
        // The series plus the number: whoever plays it looks the chapter back up in the list.
        ref: encodeChapter(number, magis.contentId)
      };
      const t = extra.get(number);
      if (t?.still) ep.still = t.still;
      if (t?.title) ep.tmdbTitle = t.title;
      if (t?.overview) ep.overview = t.overview;
      if (raw.season !== null) ep.season = raw.season;
      return ep;
    });
    const out = { episodes: list };
    if (IMDB.test(raw.imdb)) {
      out.series = {
        ids: { imdb: raw.imdb, tmdb: series?.tmdbId ?? 0 },
        seasonNumber: raw.season ?? 0,
        title: series?.title ?? "",
        poster: series?.poster ?? "",
        backdrop: series?.backdrop ?? ""
      };
    }
    if (raw.seasons.length > 0) {
      out.seasons = raw.seasons.slice(0, MAX_SEASONS).map((s) => ({
        id: s.id,
        // A season IS a portal title of the same kind: its ref is what a search would give it.
        ref: encode({ contentId: s.id, programType: magis.programType, episode: 0 }),
        title: `Temporada ${s.number}`,
        number: s.number,
        current: s.id === magis.contentId
      }));
    }
    return out;
  };
}

// src/catalog.js
var ROOT_CODES = { peliculas: "masnew_movies", series: "masnew_series", anime: "masnew_anime", infantil: "masnew_kids" };
var TREE_TTL_MS = 2 * 36e5;
var TREE_PAGE_SIZE = 60;
var TREE_BUDGET_BYTES = 2e4;
var SHED_STEPS = [
  {},
  { descMax: 120 },
  { descMax: 0 },
  { descMax: 0, genres: false },
  { descMax: 0, genres: false, backdrop: false },
  { descMax: 0, genres: false, backdrop: false, perSection: 100 },
  { descMax: 0, genres: false, backdrop: false, perSection: 50 }
];
var BROWSE_PAGE = 50;
var MAX_HOME_ROWS = 20;
var MAX_ROW_ITEMS = 60;
var MAX_GENRES = 5;
var NEW_WINDOW_MS = 48 * 36e5;
var ITEM_ID2 = /^[A-Za-z0-9._~-]{1,128}$/;
function projectItem(item, nowMs) {
  if (!ITEM_ID2.test(item.id)) return null;
  const out = {
    id: item.id,
    ref: refOf(item),
    title: item.title.trim() === "" ? item.id : item.title,
    kind: isSeries(item.type) ? "series" : "movie"
  };
  if (item.poster) out.poster = item.poster;
  if (item.backdrop) out.backdrop = item.backdrop;
  if (item.description.trim() !== "") out.overview = item.description;
  if (item.genres.length > 0) out.genres = item.genres.slice(0, MAX_GENRES);
  if (item.score !== null && Number.isFinite(item.score) && item.score >= 0 && item.score <= 10) out.rating = item.score;
  const minutes = Math.trunc(item.durationS / 60);
  if (minutes >= 1 && minutes <= 1e3) out.runtimeMinutes = minutes;
  if (item.shelvedAtMs > 0 && nowMs - item.shelvedAtMs <= NEW_WINDOW_MS) out.badges = ["NUEVO"];
  return out;
}
function projectRows(rows, nowMs) {
  const out = [];
  for (const r of rows) {
    const items = r.shown.map((i) => projectItem(i, nowMs)).filter((i) => i !== null).slice(0, MAX_ROW_ITEMS);
    if (items.length > 0) out.push({ id: r.id, title: r.title, ref: r.id, items });
  }
  return out.slice(0, MAX_HOME_ROWS);
}
var hasItems = (sections) => sections.some((s) => s.items.length > 0);
var INT5 = /^[+-]?\d+$/;
function offsetOf(cursor) {
  if (typeof cursor !== "string" || !INT5.test(cursor)) return 0;
  const n = Number(cursor);
  return n > 0 && n <= 2147483647 ? n : 0;
}
function makeCatalog({ kino: kino2, portal, session, clock, tmdb = null }) {
  const key = (root) => `tree:${root}`;
  function readTree(root) {
    try {
      const raw = kino2.storage.get(key(root));
      if (raw === null || raw === void 0) return null;
      const sections = decodeTree(raw);
      return hasItems(sections) ? sections : null;
    } catch (_) {
      return null;
    }
  }
  function writeTree(root, sections) {
    for (const shed of SHED_STEPS) {
      const text2 = encodeTree(sections, shed);
      if (utf8Length(text2) > TREE_BUDGET_BYTES) continue;
      try {
        kino2.storage.set(key(root), text2, { ttlMs: TREE_TTL_MS });
      } catch (_) {
      }
      return;
    }
  }
  async function fetchRoot(root) {
    try {
      const response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "getNextColumns",
        { columnCode: ROOT_CODES[root], pageNum: 1, pageSize: TREE_PAGE_SIZE, version: "" },
        { baseFields: true, userId, userToken }
      ));
      const sections = parseTree(response);
      if (!hasItems(sections)) return [];
      writeTree(root, sections);
      return sections;
    } catch (e) {
      try {
        kino2.log(`xuper home ${root}: ${e && (e.code || e.name) || "error"}`);
      } catch (_) {
      }
      return [];
    }
  }
  async function buildRows() {
    const roots = {};
    const missing = [];
    for (const { root } of KINDS) {
      const cached = readTree(root);
      if (cached) roots[root] = cached;
      else missing.push(root);
    }
    if (missing.length > 0) {
      await session.ensure();
      const fetched = await Promise.all(missing.map(fetchRoot));
      missing.forEach((root, i) => {
        roots[root] = fetched[i];
      });
    }
    return classify(roots);
  }
  async function home2() {
    return projectRows(await buildRows(), clock.now());
  }
  async function browse2(ref, cursor) {
    const row2 = typeof ref === "string" ? (await buildRows()).find((r) => r.id === ref) : void 0;
    if (!row2) throw kino2.error("not_found", "No se encontr\xF3 esa lista");
    const offset = offsetOf(cursor);
    const nowMs = clock.now();
    const items = row2.all.slice(offset, offset + BROWSE_PAGE).map((i) => projectItem(i, nowMs)).filter((i) => i !== null);
    const next = offset + BROWSE_PAGE;
    return next < row2.all.length ? { items, next: String(next) } : { items };
  }
  const { search: search2 } = makeSearch({ kino: kino2, portal, session, clock, tmdb });
  const portalChapters = makePortalChapters({ kino: kino2, portal, session, clock });
  const episodes2 = makeEpisodes({ kino: kino2, tmdb, portalChapters });
  return { home: home2, browse: browse2, search: search2, episodes: episodes2, portalChapters };
}

// src/tmdb.js
var TMDB_BASE = "https://api.themoviedb.org/3";
var TMDB_LANGUAGE = "es-MX";
var TIMEOUT_MS = 8e3;
var IMG = "https://image.tmdb.org/t/p";
var IMDB_ID = /^tt\d{7,}$/;
var text = (v) => typeof v === "string" ? v : "";
var blank3 = (s) => s.trim() === "";
function parseTitleForms(type, body) {
  let o;
  try {
    o = JSON.parse(body);
  } catch (_) {
    return null;
  }
  if (o === null || typeof o !== "object" || Array.isArray(o)) return null;
  const isTv = type === "tv";
  const localized = text(isTv ? o.name : o.title);
  const original = text(isTv ? o.original_name : o.original_title);
  const list = o.translations && Array.isArray(o.translations.translations) ? o.translations.translations : [];
  const entries = list.filter((t) => t !== null && typeof t === "object");
  const titleOf = (t) => t.data !== null && typeof t.data === "object" ? text(isTv ? t.data.name : t.data.title) : "";
  const englishEntry = entries.find((t) => t.iso_639_1 === "en");
  const spanish = [];
  const seen = /* @__PURE__ */ new Set();
  for (const t of entries) {
    if (t.iso_639_1 !== "es") continue;
    const title = titleOf(t);
    const key = title.trim().toLowerCase();
    if (blank3(title) || key === localized.toLowerCase() || seen.has(key)) continue;
    seen.add(key);
    spanish.push(title);
  }
  return {
    title: localized,
    originalTitle: original,
    englishTitle: englishEntry ? titleOf(englishEntry) : "",
    spanishTitles: spanish
  };
}
var isObject5 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var INT6 = /^[+-]?\d+$/;
function optInt2(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && INT6.test(v.trim())) return Number(v.trim());
  return 0;
}
var imageUrl = (path, size) => typeof path !== "string" || blank3(path) || path === "null" ? "" : `${IMG}/${size}${path}`;
function parseSeriesByImdb(body) {
  let o;
  try {
    o = JSON.parse(body);
  } catch (_) {
    return null;
  }
  const tv = isObject5(o) && Array.isArray(o.tv_results) && isObject5(o.tv_results[0]) ? o.tv_results[0] : null;
  if (tv === null) return null;
  const tmdbId = optInt2(tv.id);
  if (tmdbId <= 0) return null;
  return { tmdbId, title: text(tv.name), poster: imageUrl(tv.poster_path, "w500"), backdrop: imageUrl(tv.backdrop_path, "w1280") };
}
function parseSeasonEpisodes(body) {
  let o;
  try {
    o = JSON.parse(body);
  } catch (_) {
    return null;
  }
  if (!isObject5(o)) return null;
  const list = Array.isArray(o.episodes) ? o.episodes : [];
  return list.filter(isObject5).map((e) => {
    const episode = optInt2(e.episode_number);
    const name = text(e.name);
    return { episode, name: blank3(name) ? `Episodio ${episode}` : name, overview: text(e.overview), still: imageUrl(e.still_path, "w300") };
  });
}
function makeTmdb({ kino: kino2 }) {
  function keyMarker() {
    try {
      return kino2.secret("tmdbKey");
    } catch (_) {
      return null;
    }
  }
  async function titleForms(type, id) {
    try {
      if (!Number.isInteger(id) || id <= 0) return null;
      const key = keyMarker();
      if (!key) return null;
      const kind = type === "movie" ? "movie" : "tv";
      const url = `${TMDB_BASE}/${kind}/${id}?api_key=${key}&language=${TMDB_LANGUAGE}&append_to_response=translations`;
      const res = await kino2.fetch(url, { cookies: false, timeoutMs: TIMEOUT_MS });
      if (!res || !res.ok) return null;
      return parseTitleForms(kind, res.text());
    } catch (_) {
      return null;
    }
  }
  async function read(path, language) {
    try {
      const key = keyMarker();
      if (!key) return null;
      const sep = path.includes("?") ? "&" : "?";
      const res = await kino2.fetch(`${TMDB_BASE}${path}${sep}api_key=${key}&language=${language}`, { cookies: false, timeoutMs: TIMEOUT_MS });
      if (!res || !res.ok) return null;
      return res.text();
    } catch (_) {
      return null;
    }
  }
  async function seriesByImdb(imdbId) {
    if (typeof imdbId !== "string" || !IMDB_ID.test(imdbId)) return null;
    const body = await read(`/find/${imdbId}?external_source=imdb_id`, TMDB_LANGUAGE);
    return body === null ? null : parseSeriesByImdb(body);
  }
  async function seasonEpisodes(tvId, season, language = TMDB_LANGUAGE) {
    if (!Number.isInteger(tvId) || tvId <= 0 || !Number.isInteger(season)) return null;
    const body = await read(`/tv/${tvId}/season/${season}`, language);
    return body === null ? null : parseSeasonEpisodes(body);
  }
  return { titleForms, seriesByImdb, seasonEpisodes };
}

// src/resolve.js
var SLB_DEFAULT_TTL_S = 300;
var AUTH_MARGIN_S = 300;
var EXPIRED = /expired=(\d+)/;
var MAX_SUBTITLES = 30;
var INT7 = /^[+-]?\d+$/;
var DIGITS = /^[0-9]+$/;
var isObject6 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var isKinoError2 = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
var optString3 = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
var objects = (v) => Array.isArray(v) ? v.filter(isObject6) : [];
var notBlank = (s) => s.trim() !== "";
function isCfl(url) {
  return url.slice(url.lastIndexOf("?") + 1).split("&").some((p) => p.trim() === "sign_type=cfl");
}
function withScheme(mainAddr) {
  const clean = mainAddr.replace(/\/+$/, "");
  return clean.startsWith("http://") || clean.startsWith("https://") ? clean : `https://${clean}`;
}
function portalDurationMs(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw * 1e3) : 0;
  if (typeof raw !== "string") return 0;
  const text2 = raw.trim();
  if (text2 === "") return 0;
  const parts = text2.split(":");
  if (parts.length > 3 || parts.some((p) => !DIGITS.test(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0) * 1e3;
}
function bestMedia(play) {
  const episode = isObject6(play) ? objects(play.episodeList)[0] : void 0;
  if (!episode) return null;
  const candidates = objects(episode.totalMovieList).flatMap((tm) => objects(tm.movieList));
  let best = null;
  let bestScore = Infinity;
  for (const m of candidates) {
    const score = (optString3(m.encodeFormat).toLowerCase() === "h264" ? 0 : 2) + (optString3(m.videoFormat).toLowerCase() === "mp4" ? 0 : 1);
    if (score < bestScore) {
      best = m;
      bestScore = score;
    }
  }
  return best;
}
function readSubtitles(play) {
  const episode = objects(play.episodeList)[0];
  const out = [];
  for (const sub of objects(episode?.subtitleList)) {
    const file = objects(sub.file)[0];
    if (!file) continue;
    const url = optString3(file.url);
    if (!notBlank(url)) continue;
    out.push({ lang: optString3(sub.language), url, format: notBlank(optString3(file.fileType)) ? optString3(file.fileType) : "srt" });
  }
  return out.slice(0, MAX_SUBTITLES);
}
function vodCdn(slb) {
  for (const cdn of objects(slb.cdn_list)) {
    if (optString3(cdn.tag) !== "vod") continue;
    for (const u of objects(cdn.url_list)) {
      const url = optString3(u.url);
      if ((isCfl(url) || optString3(u.sign_type) === "cfl") && optString3(u.tag) === "free") {
        return { base: withScheme(optString3(cdn.main_addr)), auth: url };
      }
    }
  }
  return null;
}
function slbLifetime(slb, nowMs) {
  const text2 = optString3(slb.invalidTime);
  const declaredN = INT7.test(text2) ? Number(text2) : NaN;
  const declared = declaredN > 0 ? declaredN : SLB_DEFAULT_TTL_S;
  const cdn = vodCdn(slb);
  if (!cdn) return 0;
  const m = EXPIRED.exec(cdn.auth);
  if (!m) return declared;
  return Math.min(declared, Number(m[1]) - Math.floor(nowMs / 1e3) - AUTH_MARGIN_S);
}
var slbBean = (apkVersion) => ({
  hasPay: "0",
  userIdentity: "1",
  type: "merge",
  appVer: apkVersion,
  lang: "es",
  encMediaSupported: 1,
  liveCodeList: ["masnew_live"],
  appParams: "",
  reserve1: FIXED_MAC,
  pipFlag: "0"
});
function makeResolve({ kino: kino2, portal, session, clock, config, portalChapters }) {
  const unavailable = (text2) => kino2.error("unavailable", text2);
  let slbCache = null;
  const sessionSlb = () => session.withValidSession(async ({ userId, userToken }) => {
    if (slbCache && slbCache.token === userToken && clock.now() < slbCache.expiresMs) return slbCache.slb;
    const answer = await portal.call("v14/getSlbInfo", slbBean(config.apkVersion), { baseFields: true, userId, userToken });
    const fresh = isObject6(answer) ? answer : {};
    const ttl = slbLifetime(fresh, clock.now());
    slbCache = ttl > 0 ? { slb: fresh, token: userToken, expiresMs: clock.now() + ttl * 1e3 } : null;
    return fresh;
  });
  async function chapterFrom(magis) {
    const { items } = await portalChapters(magis.contentId);
    if (items.length === 0) throw unavailable(`la serie ${magis.contentId} vino sin cap\xEDtulos`);
    const chapter = findChapter(items, magis.episode);
    if (!chapter) throw unavailable(`la serie no tiene el cap\xEDtulo ${magis.episode}`);
    return chapter;
  }
  async function resolveVod(magis, chapter) {
    await session.ensure();
    const contentId = chapter && notBlank(chapter.contentId) ? chapter.contentId : magis.contentId;
    const play = await session.withValidSession(({ userId, userToken }) => portal.call(
      "v10/startPlayVOD",
      { contentId, seriesContentId: chapter ? magis.contentId : "", startTime: 0, type: "1", columnId: 0, authType: "" },
      { baseFields: true, userId, userToken }
    ));
    const best = bestMedia(play);
    if (!best) throw unavailable("Xuper devolvi\xF3 sin media reproducible");
    const license = optString3(objects(best.licenseList)[0]?.license);
    if (!notBlank(license)) throw unavailable("Xuper devolvi\xF3 sin licenseList");
    const cdn = vodCdn(await sessionSlb());
    if (!cdn) throw unavailable("Xuper no expuso CDN de vod con token libre");
    const ext = optString3(best.videoFormat).toLowerCase() === "ts" ? "ts" : "mp4";
    return {
      url: `${cdn.base}/vod/${optString3(best.contentId)}_media.${ext}`,
      mime: ext === "mp4" ? "video/mp4" : "video/mp2t",
      headers: {
        "Content-Auth": cdn.auth,
        // the querystring verbatim: VOD is not re-signed
        "Content-License": license,
        "User-Agent": UA_CDN,
        App: config.appId,
        "App-Version": config.apkVersion
      },
      subtitles: readSubtitles(play),
      // A chapter's own declared duration wins (the portal sends it empty for most series).
      durationMs: chapter ? portalDurationMs(chapter.duration) : portalDurationMs(best.duration)
    };
  }
  async function resolve2(ref) {
    try {
      const magis = decode(ref);
      if (!magis) throw unavailable("ese ref no es de Xuper: no se puede reproducir");
      const chapter = magis.isSeries ? await chapterFrom(magis) : null;
      return await resolveVod(magis, chapter);
    } catch (e) {
      if (e instanceof PortalError) throw mapPortalError(e.code, e.message, kino2);
      if (isKinoError2(e)) throw e;
      throw unavailable("Xuper no est\xE1 disponible ahora");
    }
  }
  return { resolve: resolve2 };
}

// src/liveCatalog.js
var LIVE_ROOT = "masnew_live";
var CATEGORIES_PAGE_SIZE = 200;
var CHANNELS_PAGE_SIZE = 500;
var MAX_PAGES = 10;
var MAX_CATEGORIES = 200;
var ID = /^[A-Za-z0-9._~-]{1,128}$/;
var INT8 = /^[+-]?\d+$/;
var POSITIVE = /^\d{1,9}$/;
var NAMES = { ChannelList: "Todos" };
var ADULT_NAMES = /* @__PURE__ */ new Set(["18+", "adultos", "adulto", "xxx", "+18"]);
var isObject7 = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
var asText2 = (v) => v === null || v === void 0 ? "" : typeof v === "string" ? v : String(v);
var isBlank2 = (s) => s.trim() === "";
var isKinoError3 = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
function intOrNull3(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  if (!INT8.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
function makeLiveCatalog({ kino: kino2, portal, session }) {
  let adultIds = null;
  const surface = (e) => {
    if (e instanceof PortalError) return mapPortalError(e.code, e.message, kino2);
    if (isKinoError3(e)) return e;
    return kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
  };
  async function readCategories() {
    let response;
    try {
      await session.ensure();
      response = await session.withValidSession(({ userId, userToken }) => portal.call(
        "getNextColumns",
        { columnCode: LIVE_ROOT, pageNum: 1, pageSize: CATEGORIES_PAGE_SIZE, version: "" },
        { baseFields: true, userId, userToken }
      ));
    } catch (e) {
      throw surface(e);
    }
    const columns = isObject7(response) && Array.isArray(response.recommendList) ? response.recommendList : [];
    const out = [];
    for (const c of columns) {
      if (!isObject7(c)) continue;
      const id = intOrNull3(c.columnId);
      if (id === null || id <= 0) continue;
      const raw = asText2(c.name);
      const name = Object.hasOwn(NAMES, raw) ? NAMES[raw] : raw;
      if (isBlank2(name)) continue;
      out.push({ id: String(id), name, adult: ADULT_NAMES.has(name.trim().toLowerCase()) });
    }
    if (out.length > 0) adultIds = new Set(out.filter((c) => c.adult).map((c) => c.id));
    return out;
  }
  async function liveCategories2() {
    const all = await readCategories();
    return all.filter((c) => !c.adult && ID.test(c.id)).slice(0, MAX_CATEGORIES).map((c) => ({ id: c.id, title: c.name }));
  }
  async function isAdultCategory(id) {
    if (adultIds === null) {
      await readCategories();
      if (adultIds === null) throw kino2.error("unavailable", "Xuper no est\xE1 disponible ahora");
    }
    return adultIds.has(id);
  }
  async function fetchPage(columnId, page) {
    await session.ensure();
    const response = await session.withValidSession(({ userId, userToken }) => portal.call(
      "v6/getLiveData",
      { columnId: Number(columnId), pageNum: page, pageSize: CHANNELS_PAGE_SIZE, dataVersion: "", expireTimeStr: "" },
      { baseFields: true, userId, userToken }
    ));
    return isObject7(response) && Array.isArray(response.channelList) ? response.channelList : [];
  }
  function project(list, categoryId) {
    const seen = /* @__PURE__ */ new Set();
    const items = [];
    for (const c of list) {
      if (!isObject7(c)) continue;
      const code = asText2(c.channelCode);
      const title = asText2(c.name);
      if (isBlank2(code) || isBlank2(title) || !ID.test(code) || code.startsWith("~") || seen.has(code)) continue;
      seen.add(code);
      const n = intOrNull3(c.channelNumber);
      const item = { id: code, title, ref: code, categoryId, number: n !== null && n >= 1 && n <= 9999 ? n : 0 };
      const logo = logoOf(c);
      if (logo) item.logo = logo;
      items.push(item);
    }
    return items;
  }
  async function liveChannels2({ categoryId, cursor } = {}) {
    if (typeof categoryId !== "string" || !POSITIVE.test(categoryId) || Number(categoryId) <= 0) {
      throw kino2.error("not_found", "No se encontr\xF3 esa categor\xEDa");
    }
    const id = String(Number(categoryId));
    const page = typeof cursor === "string" && POSITIVE.test(cursor) && Number(cursor) >= 1 ? Number(cursor) : 1;
    if (page > MAX_PAGES) return { items: [] };
    try {
      if (await isAdultCategory(id)) return { items: [] };
      const list = await fetchPage(id, page);
      const items = project(list, id);
      return list.length >= CHANNELS_PAGE_SIZE && page < MAX_PAGES ? { items, next: String(page + 1) } : { items };
    } catch (e) {
      if (page > 1) return { items: [] };
      throw surface(e);
    }
  }
  return { liveCategories: liveCategories2, liveChannels: liveChannels2 };
}

// src/wiring.js
var deps = null;
function getDeps() {
  if (deps) return deps;
  const clock = { now: () => Date.now() };
  const crypto = makeCrypto(kino);
  const config = { hosts, appId: APP_ID, apkVersion: APK_VERSION };
  let session = null;
  const portal = makePortal({ kino, crypto, config, clock, snProvider: () => session.current().sn });
  session = makeSession({ kino, portal, clock });
  const tmdb = makeTmdb({ kino });
  const catalog = makeCatalog({ kino, portal, session, clock, tmdb });
  const resolve2 = makeResolve({ kino, portal, session, clock, config, portalChapters: catalog.portalChapters });
  const live = makeLiveCatalog({ kino, portal, session, clock });
  deps = { clock, crypto, portal, session, tmdb, catalog, resolve: resolve2, live };
  return deps;
}
var isKinoError4 = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
async function guarded(body) {
  try {
    return await body(getDeps());
  } catch (e) {
    if (isKinoError4(e)) throw e;
    try {
      kino.log("xuper: " + String(e && e.name || "error"));
    } catch (_) {
    }
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}

// src/plugin.js
async function search(query) {
  await null;
  return guarded(({ catalog }) => catalog.search(query));
}
async function home() {
  await null;
  return guarded(({ catalog }) => catalog.home());
}
async function browse(ref, cursor) {
  await null;
  return guarded(({ catalog }) => catalog.browse(ref, cursor));
}
async function episodes(ref) {
  await null;
  return guarded(({ catalog }) => catalog.episodes(ref));
}
async function resolve(ref, options) {
  await null;
  return guarded(({ resolve: resolveRef }) => resolveRef.resolve(ref, options));
}
async function liveCategories() {
  await null;
  return guarded(({ live }) => live.liveCategories());
}
async function liveChannels(args) {
  await null;
  return guarded(({ live }) => live.liveChannels(args));
}
async function settingsStatus() {
  await null;
  return { text: "todav\xEDa no" };
}
async function action() {
  await null;
  throw kino.error("unavailable", "todav\xEDa no");
}
export {
  action,
  browse,
  episodes,
  home,
  liveCategories,
  liveChannels,
  resolve,
  search,
  settingsStatus
};
