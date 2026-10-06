// Every sentence and label the plugin itself writes for the person, in Spanish (neutral, tuteo) and
// English, picked by `kino.lang` ("es-CO", "en-US"...): English for an `en` language, Spanish for anything
// else (and when Kino gives no language). Names the portal sends (a title, a category) are never
// translated. Log lines and error `message`s are for developers and stay as they are.
// The manifest's settings form has no per-language text in the contract: it stays in Spanish.

/** True when Kino runs in English (`kino.lang` "en" or "en-XX"). Never throws. */
export function isEnglish(kino) {
  try {
    const lang = kino && typeof kino.lang === "string" ? kino.lang.trim().toLowerCase() : "";
    return lang === "en" || lang.startsWith("en-") || lang.startsWith("en_");
  } catch (_) { return false; }
}

// key -> [Spanish, English]. `{name}` is filled by `say`'s `vars`.
export const TEXTS = Object.freeze({
  // Where the plugin's own settings live in Kino.
  settingsPlace: ["Ajustes ▸ Xuper", "Settings ▸ Xuper"],

  // Errors the person reads (`userMessage`).
  accountSessionLost: [
    "Tu sesión de Xuper se cerró y no pudimos volver a entrar con tu cuenta. Vuelve a vincularla en {place}.",
    "Your Xuper session ended and we could not sign back in with your account. Link it again in {place}.",
  ],
  accountInUseElsewhere: [
    "Tu cuenta de Xuper se abrió en otro dispositivo, y solo puede usarse en uno a la vez. Vuelve a intentarlo, o vincúlala de nuevo en {place}.",
    "Your Xuper account was opened on another device, and it can only be used on one at a time. Try again, or link it again in {place}.",
  ],
  episodeGone: ["Este capítulo ya no está disponible.", "This episode is no longer available."],
  seriesGone: ["Esta serie ya no está disponible.", "This series is no longer available."],
  portalSlow: [
    "Xuper no responde en este momento; intenta de nuevo en unos minutos.",
    "Xuper is not responding right now; try again in a few minutes.",
  ],
  liveNeedsAccount: [
    "Este canal necesita una cuenta de Xuper (para películas y series no hace falta). Vincúlala en {place}.",
    "This channel needs a Xuper account (movies and series do not). Link it in {place}.",
  ],
  sendCodeFailed: [
    "Xuper no pudo enviar el código a ese correo. Revisa que esté bien escrito en {place}.",
    "Xuper could not send the code to that email. Check that it is spelled right in {place}.",
  ],
  requestNotSaved: [
    "No pudimos guardar tu pedido. Vuelve a tocar Crear cuenta.",
    "We could not save your request. Tap Create account again.",
  ],
  codeRefused: [
    "Xuper no aceptó el código, o ese correo ya tiene cuenta. Pide otro código o toca Iniciar sesión.",
    "Xuper did not accept the code, or that email already has an account. Ask for another code or tap Sign in.",
  ],
  fillAccount: ["Faltan los datos de tu cuenta: complétalos en {place}.", "Your account details are missing: fill them in {place}."],
  accountRefused: ["Xuper no aceptó esa cuenta. Revisa los datos en {place}.", "Xuper did not accept that account. Check the details in {place}."],
  fillEmail: ["Escribe tu correo en {place}.", "Enter your email in {place}."],
  badEmail: ["Escribe un correo válido en {place}.", "Enter a valid email in {place}."],
  fillCode: ["Escribe el código que te enviamos en {place}.", "Enter the code we sent you in {place}."],
  askCodeAgain: ["Pide el código otra vez.", "Ask for the code again."],

  // The settings form: status line, action results, field errors.
  statusConnecting: ["Conectando con {who}… Mientras tanto, sesión anónima", "Connecting to {who}… Anonymous session meanwhile"],
  whoShared: ["la cuenta compartida", "the shared account"],
  whoOwn: ["tu cuenta", "your account"],
  statusSharedBroken: ["La cuenta compartida ya no funciona: sesión anónima", "The shared account no longer works: anonymous session"],
  statusOwnRefused: [
    "No se pudo iniciar sesión con tu cuenta: sesión anónima. Revisa tu correo y contraseña",
    "Could not sign in with your account: anonymous session. Check your email and password",
  ],
  statusAnonymous: ["Sin cuenta: sesión anónima", "No account: anonymous session"],
  statusShared: ["Cuenta compartida", "Shared account"],
  statusConnectedAs: ["Conectado como {email}", "Signed in as {email}"],
  statusBlockedSeeds: ["Zona bloqueada: {n} semillas cargadas", "Blocked region: {n} seeds loaded"],
  statusBlockedNoSeeds: ["Zona bloqueada: sin semillas cargadas", "Blocked region: no seeds loaded"],
  seedsBanner: [
    "Por ahora no hay sesiones disponibles para tu zona; vuelve a intentar en un rato o toca Actualizar semillas",
    "There are no sessions for your region right now; try again in a while or tap Update seeds",
  ],
  statusAutoRefreshOff: ["Actualización automática desactivada", "Automatic update turned off"],
  statusUnknown: ["No se pudo consultar el estado", "Could not check the status"],
  signedIn: ["Sesión iniciada", "Signed in"],
  signedOut: ["Sesión cerrada", "Signed out"],
  seedSwitched: ["Semilla cambiada (intento {n})", "Seed changed (attempt {n})"],
  offlineRetry: ["Sin conexión, reintenta", "No connection, try again"],
  accountNoSeeds: ["Tu cuenta no usa semillas", "Your account does not use seeds"],
  noOtherSeed: ["No hay otra semilla para probar", "There is no other seed to try"],
  seedsAllFailed: ["Probé {n} semillas y ninguna funcionó", "I tried {n} seeds and none worked"],
  seedsLoaded: ["{n} semillas cargadas", "{n} seeds loaded"],
  codeAlreadySent: ["Ya te enviamos un código; espera un minuto antes de pedir otro", "We already sent you a code; wait a minute before asking for another"],
  codeSent: ["Te enviamos un código a {email}", "We sent a code to {email}"],
  accountCreatedSignIn: ["Cuenta creada. Toca Iniciar sesión para entrar.", "Account created. Tap Sign in to enter."],
  accountCreatedSignedIn: ["Cuenta creada y sesión iniciada", "Account created and signed in"],
  sharedActivationFailed: ["No se pudo activar la cuenta compartida", "Could not turn on the shared account"],
  removeAccountOrShared: ["Quita tu cuenta o apaga la cuenta compartida", "Remove your account or turn off the shared account"],
  enterEmail: ["Escribe tu correo", "Enter your email"],
  enterValidEmail: ["Escribe un correo válido", "Enter a valid email"],
  credentialsRefused: ["Credenciales de Xuper inválidas", "Xuper did not accept these sign-in details"],

  // Labels and titles the plugin makes (rows, tabs, chapters, copies).
  newBadge: ["NUEVO", "NEW"],
  liveChannelsRow: ["Canales en vivo", "Live channels"],
  allChannels: ["Todos", "All"],
  chapterN: ["Capítulo {n}", "Episode {n}"],
  seasonN: ["Temporada {n}", "Season {n}"],
  server: ["Servidor {n}", "Server {n}"],
  backup: ["respaldo", "backup"],
  retry: ["reintento {n}", "retry {n}"],
  versionN: ["Versión {n}", "Version {n}"],
});

/** The text for `key` in Kino's language, `{name}`s filled from `vars` (and `{place}` always). */
export function say(kino, key, vars = {}) {
  const pair = TEXTS[key];
  if (!pair) return key;
  const en = isEnglish(kino);
  const all = { place: TEXTS.settingsPlace[en ? 1 : 0], ...vars };
  return pair[en ? 1 : 0].replace(/\{(\w+)\}/g, (m, name) => (Object.hasOwn(all, name) ? String(all[name]) : m));
}

/** Both languages' text for `key` (no vars besides `{place}`): to recognize a sentence whichever it was said in. */
export function sayAll(key) {
  const pair = TEXTS[key];
  if (!pair) return [];
  return pair.map((text, i) => text.replace(/\{place\}/g, TEXTS.settingsPlace[i]));
}
