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
        const text = kino2.crypto.decrypt("des-ede3-ecb", {
          key: kino2.secret("magisKey"),
          data: fromHex(wire),
          padding: "pkcs7"
        });
        if (typeof text !== "string" || text === "") throw new Error("empty");
        return text;
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
var plain = (text) => text.toLowerCase().normalize("NFD").replace(/\p{Mn}+/gu, "").trim();
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
function encode({ contentId, programType = "movie", episode = 0 }) {
  return `${PREFIX}:${programType || "movie"}:${episode}:${contentId}`;
}

// src/homeTree.js
var PORTAL_OFFSET_MS = 8 * 36e5;
var isBlank = (s) => typeof s !== "string" || s.trim() === "";
var asText = (v) => v === null || v === void 0 ? "" : typeof v === "string" ? v : String(v);
var nonBlank = (v) => {
  const s = asText(v);
  return s.trim() === "" ? null : s;
};
var INT = /^[+-]?\d+$/;
var DEC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
function intOrNull(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  if (!INT.test(s)) return null;
  const n = Number(s);
  return n >= -2147483648 && n <= 2147483647 ? n : null;
}
function numberOrNull(v) {
  if (v === null || v === void 0) return null;
  const s = String(v);
  return DEC.test(s) ? Number(s) : null;
}
function parseShelveTime(text) {
  const raw = typeof text === "string" ? text.trim() : "";
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
function cut(text, max) {
  if (text.length <= max) return text;
  const end = text.charCodeAt(max - 1) >= 55296 && text.charCodeAt(max - 1) < 56320 ? max - 1 : max;
  return text.slice(0, end);
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
function decodeTree(text) {
  const o = JSON.parse(text);
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
var ITEM_ID = /^[A-Za-z0-9._~-]{1,128}$/;
function projectItem(item, nowMs) {
  if (!ITEM_ID.test(item.id)) return null;
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
var INT2 = /^[+-]?\d+$/;
function offsetOf(cursor) {
  if (typeof cursor !== "string" || !INT2.test(cursor)) return 0;
  const n = Number(cursor);
  return n > 0 && n <= 2147483647 ? n : 0;
}
function makeCatalog({ kino: kino2, portal, session, clock }) {
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
      const text = encodeTree(sections, shed);
      if (utf8Length(text) > TREE_BUDGET_BYTES) continue;
      try {
        kino2.storage.set(key(root), text, { ttlMs: TREE_TTL_MS });
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
  return { home: home2, browse: browse2 };
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
  const catalog = makeCatalog({ kino, portal, session, clock });
  deps = { clock, crypto, portal, session, catalog };
  return deps;
}
var isKinoError = (e) => e !== null && typeof e === "object" && typeof e.name === "string" && e.name.startsWith("KinoError_");
async function guarded(body) {
  try {
    return await body(getDeps());
  } catch (e) {
    if (isKinoError(e)) throw e;
    try {
      kino.log("xuper: " + String(e && e.name || "error"));
    } catch (_) {
    }
    throw kino.error("unavailable", "Xuper no est\xE1 disponible ahora");
  }
}

// src/plugin.js
async function search() {
  await null;
  return [];
}
async function home() {
  await null;
  return guarded(({ catalog }) => catalog.home());
}
async function browse(ref, cursor) {
  await null;
  return guarded(({ catalog }) => catalog.browse(ref, cursor));
}
async function episodes() {
  await null;
  throw kino.error("not_found", "todav\xEDa no");
}
async function resolve() {
  await null;
  throw kino.error("unavailable", "todav\xEDa no");
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
  resolve,
  search,
  settingsStatus
};
