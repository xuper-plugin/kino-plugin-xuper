// A copy of the app's rules for a failed call's log lines (kino-light PluginTelemetry.cleanLog:
// SentryScrubber.redactSensitiveText, PrivateText.scrubAddresses, then BLOB). A breadcrumb these
// rules change reaches the error board blanked ([id], [host], [REDACTED]...), so it says nothing.
const SENSITIVE_VALUE = /\b(password|token|secret|credential|authorization|auth|bearer|cookie|api[_-]?key|session)\s*[=:]\s*(?:(bearer|basic)\s+)?\S+|\b(bearer)\s+\S+/gi;
const URL = /\b([A-Za-z][A-Za-z0-9+.-]{1,15}):\/\/\S+/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const HOSTNAME = /\b(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}(?::\d+)?\b/g;
const LONG_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g;
const BLOB = /[A-Za-z0-9+/_=-]{24,}/g;

export function appScrub(line) {
  return line
    .replace(SENSITIVE_VALUE, (m, key) => (key ? key + "=[REDACTED]" : "bearer [REDACTED]"))
    .replace(URL, (m, s) => s + "://[url]")
    .replace(EMAIL, "[email]")
    .replace(IPV4, "[ip]")
    .replace(HOSTNAME, "[host]")
    .replace(LONG_TOKEN, "[id]")
    .replace(BLOB, "[id]");
}
