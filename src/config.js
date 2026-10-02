// Protocol constants of the Magis portal, ported from the native client. `appId`, `apkVersion` and
// the host list are NOT here: they are credentials-grade values injected at runtime.
export const hosts = [];

// The owner supplies the real values (not secrets per the spec, but not known here): left empty.
export const APP_ID = "";
export const APK_VERSION = "";

export const PORTAL_CODE = "masnew";
export const SPKG_VER = "2025-08-07 05:40:11_36_16_";
// Fixed literal of the `apkVer` header: a different field from the device dict's `apkVersion`.
export const APK_VER_HEADER = "43404";
export const USER_AGENT = "okhttp/3.12.12";
// The `User-Agent` the CDN expects on VOD media requests (not the portal's okhttp one).
export const UA_CDN = "Ranger/4.9.4-17294ac0";
// Every live CDN request (playlist, segment, key) carries these literals (native LiveHlsProxy UA, APP,
// APP_VERSION and the X-Buffer header): a fixed app id and version, NOT the credentials' ones VOD sends.
export const LIVE_USER_AGENT = "Ranger/4.9.4-17294ac0";
export const LIVE_APP = "com.android.msandroid";
export const LIVE_APP_VERSION = "49902";
export const LIVE_X_BUFFER = "0";
export const CONTENT_TYPE ="application/json;charset=utf-8";
export const RATE_LIMIT_MS = 400;
export const REQUEST_TIMEOUT_MS = 25000;

// The emulator the protocol was captured with; the portal validates some of these.
export const DEVICE_FIXED = Object.freeze({
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
  sdkVer: 36,
});

// Salts and the fixed MAC the native client sends: protocol constants, not credentials.
export const SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28";
export const PASSWORD_SALT = "cloudstream";
export const FIXED_MAC = "02:00:00:00:00:00";

// `v3/snToken` hardware fingerprint: the emulator's values; the identifying fields (androidId,
// cpuId, MACs, serialNumber) are randomized per minted device by the session, not listed here.
export const FINGERPRINT_FIXED = Object.freeze({
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
  verId: "",
});
