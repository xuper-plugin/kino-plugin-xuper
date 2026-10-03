// Pieces of the device handshake shared by the session (the person's own device) and the
// registration (a separate, temporary one): the activation bean, the randomized hardware
// fingerprint and the sn rule. Port of the native MagisSession helpers.
import { SNTOKEN_SALT, FIXED_MAC, FINGERPRINT_FIXED } from "./config.js";

const str = (v) => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
export const blank = (v) => str(v).trim() === "";

export const activateBean = (snToken) => ({
  snToken, authVersion: "", authCode: "", preCode: "", macAddr: FIXED_MAC, reserve1: "",
  openNum: 4, channel: "default", matadata: "", signdata: "",
});

/** The `v3/snToken` body: the emulator's fixed values plus identifiers random per device. */
export function makeFingerprint(kino) {
  const randomHex = (bytes) => kino.crypto.randomBytes(bytes, "hex");
  const randomMac = () => randomHex(6).match(/../g).join(":");
  return () => ({
    ...FINGERPRINT_FIXED,
    androidId: randomHex(8), cpuId: randomHex(8), serialNumber: randomHex(8),
    etheMac: randomMac(), gatewayMac: randomMac(), wifiMac: randomMac(),
  });
}

/** The device's sn from a `v3/snToken` answer: the portal's own, else md5(snToken + salt). */
export const snFrom = (kino, j, snToken) =>
  (blank(j.sn) ? kino.crypto.hash("md5", snToken + SNTOKEN_SALT) : str(j.sn)).toLowerCase();
