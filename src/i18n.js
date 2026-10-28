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

/** True when Kino runs in Spanish (`kino.lang` "es" or "es-XX"). Never throws. */
export function isSpanish(kino) {
  try {
    const lang = kino && typeof kino.lang === "string" ? kino.lang.trim().toLowerCase() : "";
    return lang.startsWith("es");
  } catch (_) { return false; }
}

// The portal's genre tags are IMDb's genre names, in English: their Spanish names for a Spanish Kino.
export const GENRES_ES = Object.freeze({
  "Action": "Acción", "Adventure": "Aventura", "Animation": "Animación", "Biography": "Biografía",
  "Comedy": "Comedia", "Crime": "Crimen", "Documentary": "Documental", "Drama": "Drama", "Family": "Familia",
  "Fantasy": "Fantasía", "History": "Historia", "Horror": "Terror", "Music": "Música", "Musical": "Musical",
  "Mystery": "Misterio", "Romance": "Romance", "Sci-Fi": "Ciencia ficción", "Sport": "Deportes",
  "Thriller": "Suspenso", "War": "Guerra", "Western": "Western", "Reality-TV": "Reality",
  "Talk-Show": "Programa de entrevistas", "Game-Show": "Concurso", "News": "Noticias", "Film-Noir": "Cine negro",
  "Short": "Cortometraje", "Adult": "Adultos",
});

/** A portal genre name as shown: in Spanish when `spanish` and it is a known IMDb genre, else unchanged. */
export function genreName(name, spanish) {
  if (!spanish || typeof name !== "string") return name;
  const key = name.trim();
  return Object.hasOwn(GENRES_ES, key) ? GENRES_ES[key] : name;
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
  regionBlocked: [
    "Xuper no permite esta acción desde tu región o tu red (a veces es una VPN). Prueba con otra conexi\u00f3n.",
    "Xuper does not allow this from your region or network (sometimes a VPN). Try another connection.",
  ],
  cryptoUnavailable: [
    "Este aparato no pudo abrir la conexión segura con Xuper. Actualiza la aplicación; si sigue igual, el aparato no es compatible.",
    "This device could not open the secure connection with Xuper. Update the app; if it stays the same, the device is not supported.",
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
  // Older Kino runs a button on what was saved, so the person is told to save first (see savesBeforeAction).
  fillEmailSave: ["Escribe tu correo en {place} y pulsa Guardar antes de tocar el botón.", "Enter your email in {place} and tap Save before pressing the button."],
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
  codeSentSave: ["Te enviamos un código a {email}. Si es otro correo, pulsa Guardar y vuelve a tocar el botón.", "We sent a code to {email}. If that is not the one, tap Save and press the button again."],
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
  // Categorías tiles of live channels, one per genre (liveTiles.js).
  liveTileSports: ["Deportes en vivo", "Live sports"],
  liveTileNews: ["Noticias en vivo", "Live news"],
  liveTileKids: ["Infantil en vivo", "Live kids"],
  liveTileMovies: ["Cine en vivo", "Live movies"],
  liveTileSeries: ["Series en vivo", "Live series"],
  liveTileMoviesSeries: ["Cine y series en vivo", "Live movies & series"],
  liveTileEntertainment: ["Entretenimiento en vivo", "Live entertainment"],
  liveTileMusic: ["Música en vivo", "Live music"],
  liveTileDocumentaries: ["Documentales en vivo", "Live documentaries"],
  liveTileAnime: ["Anime en vivo", "Live anime"],
  chapterN: ["Capítulo {n}", "Episode {n}"],
  seasonN: ["Temporada {n}", "Season {n}"],
  server: ["Servidor {n}", "Server {n}"],
  backup: ["respaldo", "backup"],
  retry: ["reintento {n}", "retry {n}"],
  versionN: ["Versión {n}", "Version {n}"],

  // The configuration screen (apiVersion 14 through the manifest's enhancements; src/screen*.js). Its nodes carry both
  // languages (`text` / `textEn`): Kino picks by the person's language.
  scrTitle: ["Configuración", "Settings"],
  scrTabAccount: ["Cuenta", "Account"],
  scrTabConnection: ["Conexión", "Connection"],
  scrTabMore: ["Inicio y ayuda", "Home & help"],
  scrRefresh: ["Actualizar estado", "Refresh status"],
  scrHelp: ["Ayuda", "Help"],
  scrClassicNote: ["Tu versión de Kino muestra aquí el formulario de siempre.", "Your Kino version shows the usual form here."],
  scrGenericError: ["No se pudo completar. Inténtalo de nuevo en un momento.", "It could not be done. Try again in a moment."],
  scrBack: ["Volver", "Back"],
  scrOn: ["Activado", "On"],
  scrOff: ["Desactivado", "Off"],
  // Account tab.
  scrAnonBanner: [
    "Sin cuenta: usas una sesión anónima. Películas y series funcionan; algunos canales en vivo piden cuenta.",
    "No account: you use an anonymous session. Movies and series work; some live channels need an account.",
  ],
  scrSignIn: ["Iniciar sesión", "Sign in"],
  scrSignInSub: ["Con tu correo y tu contraseña", "With your email and password"],
  scrCreate: ["Crear una cuenta", "Create an account"],
  scrCreateSub: ["Gratis, con tu correo", "Free, with your email"],
  scrAccHeld: ["Conectado", "Signed in"],
  scrAccPending: ["Conectando… (sesión anónima mientras tanto)", "Connecting… (anonymous session meanwhile)"],
  scrAccRefused: ["No aceptada: usas la sesión anónima", "Not accepted: you use the anonymous session"],
  scrRefusedBanner: [
    "El servicio no aceptó tu cuenta. Revisa el correo y la contraseña, o vuelve a intentarlo.",
    "The service did not accept your account. Check the email and the password, or try again.",
  ],
  scrRetry: ["Reintentar", "Try again"],
  scrConnectNow: ["Conectar ahora", "Connect now"],
  scrChangeAccount: ["Cambiar de cuenta", "Change account"],
  scrSignOut: ["Cerrar sesión", "Sign out"],
  scrSignOutConfirm: ["¿Cerrar sesión de tu cuenta?", "Sign out of your account?"],
  scrSignOutPartial: [
    "Cerraste sesión. La sesión anónima se activará al cargar el catálogo.",
    "You signed out. The anonymous session will start when the catalog loads.",
  ],
  scrSharedSwitch: ["Usar cuenta compartida", "Use the shared account"],
  scrSharedHint: ["Muchas personas la usan; puede cerrar la sesión de otra.", "Many people use it; it may sign someone else out."],
  scrSharedOn: ["Cuenta compartida activada", "Shared account turned on"],
  scrSharedOff: ["Cuenta compartida desactivada", "Shared account turned off"],
  scrSharedOwnFirst: ["Para usarla, primero cierra la sesión de tu cuenta.", "To use it, first sign out of your account."],
  scrSharedTurnOff: ["Apagar la cuenta compartida", "Turn off the shared account"],
  // Sign-in page.
  scrSignInTitle: ["Inicia sesión con tu cuenta", "Sign in with your account"],
  scrSignInCaption: [
    "Se comprueba con el servicio antes de guardarla, y se guarda como tus otros ajustes en tus aparatos vinculados.",
    "It is checked with the service before it is saved, and it is saved like your other settings on your linked devices.",
  ],
  scrEmailLabel: ["Correo electrónico", "Email"],
  scrEmailError: ["Revisa el correo", "Check the email"],
  scrPasswordLabel: ["Contraseña", "Password"],
  scrPasswordError: ["Escribe la contraseña", "Enter the password"],
  scrUncheckedTitle: ["No se pudo comprobar ahora", "It could not be checked now"],
  scrSaveUnchecked: ["Guardar sin comprobar", "Save without checking"],
  scrSavedUnchecked: [
    "Guardada sin comprobar: se comprobará al cargar el catálogo.",
    "Saved without checking: it will be checked when the catalog loads.",
  ],
  scrTypeBoth: ["Escribe el correo y la contraseña, y vuelve a tocar el botón.", "Enter the email and the password, and press the button again."],
  // Registration page.
  scrStepEmail: ["Tu correo", "Your email"],
  scrStepCode: ["Código y contraseña", "Code and password"],
  scrStepDone: ["Listo", "Done"],
  scrStepOf: ["Paso {n} de 3", "Step {n} of 3"],
  scrSendCode: ["Enviar código", "Send code"],
  scrRegTvNote: [
    "Es más cómodo en el teléfono: tus ajustes se sincronizan con este aparato.",
    "It is easier on the phone: your settings sync with this device.",
  ],
  scrCodeSentTo: ["Enviamos un código a {email}.", "We sent a code to {email}."],
  scrSentAt: ["Enviado", "Sent"],
  scrCodeRules: ["El código vale 30 minutos y solo en este aparato.", "The code works for 30 minutes and only on this device."],
  scrCodeLabel: ["Código", "Code"],
  scrCodeError: ["Escribe el código que llegó a tu correo", "Enter the code that came to your email"],
  scrNewPassword: ["Contraseña de tu cuenta nueva", "Password for your new account"],
  scrCreateButton: ["Crear cuenta", "Create account"],
  scrResend: ["Reenviar código", "Send the code again"],
  scrResendIn: ["en", "in"],
  scrResendConfirm: ["El código anterior deja de valer. ¿Enviar otro?", "The previous code stops working. Send another one?"],
  scrResent: ["Te enviamos otro código; el anterior ya no vale.", "We sent you another code; the previous one no longer works."],
  scrChangeEmail: ["Cambiar correo", "Change email"],
  scrCreatedPending: [
    "Cuenta creada. La sesión se inicia sola en un momento, o toca Conectar ahora.",
    "Account created. The session starts by itself in a moment, or tap Connect now.",
  ],
  scrAskAgain: ["Volver a pedir el código", "Ask for the code again"],
  // Connection tab.
  scrStatusCard: ["Estado", "Status"],
  scrRegion: ["Tu zona", "Your region"],
  scrRegionBlocked: ["Bloqueada", "Blocked"],
  scrRegionFree: ["Libre", "Open"],
  scrSession: ["Sesión", "Session"],
  scrSessionAccount: ["Tu cuenta", "Your account"],
  scrSessionAnon: ["Anónima propia", "Your own anonymous one"],
  scrSessionSeed: ["Semilla de respaldo", "Backup seed"],
  scrSessionNone: ["Todavía ninguna", "None yet"],
  scrSeedsRow: ["Semillas", "Seeds"],
  scrSeedsCount: ["{usable} utilizables de {pool}", "{usable} usable of {pool}"],
  scrSeedsUpdated: ["Descargadas", "Downloaded"],
  scrSeedsNever: ["Aún no se descargaron en este aparato", "Not downloaded on this device yet"],
  scrNoSeedsBanner: ["Por ahora no hay sesiones utilizables para tu zona.", "There are no usable sessions for your region right now."],
  scrSeedsTitle: ["Semillas de respaldo", "Backup seeds"],
  scrSeedsIntro: ["Sesiones anónimas de respaldo para cuando tu zona está bloqueada.", "Anonymous backup sessions for when your region is blocked."],
  scrAccountNoSeeds: ["Tu cuenta no usa semillas: estas opciones solo sirven sin cuenta.", "Your account does not use seeds: these options only work without an account."],
  scrAutoHelp: [
    "Activado, las semillas se descargan cada 3 horas mientras tu zona está bloqueada y no usas cuenta. Si no tienes ninguna, se descargan igual cuando hacen falta.",
    "When on, the seeds are downloaded every 3 hours while your region is blocked and you use no account. If you have none, they are downloaded anyway when needed.",
  ],
  scrChangeSeed: ["Cambiar semilla", "Change seed"],
  scrChangeSeedHint: ["Prueba otra sesión de respaldo si esta va mal", "Try another backup session if this one goes wrong"],
  scrUpdateSeeds: ["Actualizar semillas", "Update seeds"],
  scrUpdateSeedsHint: ["Vuelve a descargar las sesiones de respaldo", "Downloads the backup sessions again"],
  scrSeedsBadFile: ["El archivo de semillas no llegó bien; inténtalo más tarde.", "The seed file did not come through right; try again later."],
  scrSeedsLoadedUsable: ["{n} semillas cargadas, {usable} utilizables", "{n} seeds loaded, {usable} usable"],
  scrContribTitle: ["Aportar", "Contribute"],
  scrContribHelp: [
    "De vez en cuando comparte una sesión anónima nueva, creada solo para eso: nunca la tuya ni tus datos. Solo se envía si el diagnóstico de Kino está activado para este plugin.",
    "Now and then it shares a new anonymous session, created only for that: never yours, never your data. It is only sent while Kino's diagnostics are on for this plugin.",
  ],
  scrContribLast: ["Último aporte", "Last contribution"],
  scrContribNever: ["Este aparato aún no ha aportado.", "This device has not contributed yet."],
  scrContribWhatTitle: ["¿Qué se comparte?", "What is shared?"],
  scrContribWhat: [
    "Una sesión de invitado anónima recién creada (un número de aparato y su permiso de acceso), comprobada antes de enviarla. Nunca tu cuenta, tu historial ni datos de este aparato. Como mucho una cada 3 horas.",
    "A brand-new anonymous guest session (a device number and its access grant), checked before it is sent. Never your account, your history or data about this device. At most one every 3 hours.",
  ],
  // Home & help tab.
  scrHomeTitle: ["Inicio", "Home"],
  scrHomeHint: ["Una fila con los canales en vivo de tu país al final de Inicio.", "A row with your country's live channels at the end of Home."],
  scrFaqTitle: ["Preguntas frecuentes", "Frequently asked questions"],
  scrFaqAnonQ: ["¿Qué es la sesión anónima?", "What is the anonymous session?"],
  scrFaqAnonA: [
    "Una sesión de invitado que el servicio da a cualquiera, sin cuenta. Alcanza para películas y series; algunos canales en vivo piden cuenta.",
    "A guest session the service gives anyone, with no account. It is enough for movies and series; some live channels need an account.",
  ],
  scrFaqSeedsQ: ["¿Qué son las semillas?", "What are seeds?"],
  scrFaqSeedsA: [
    "Sesiones anónimas que comparten otros aparatos. Se usan solo cuando el servicio bloquea tu zona y no usas cuenta.",
    "Anonymous sessions other devices share. They are used only when the service blocks your region and you use no account.",
  ],
  scrFaqSharedQ: ["¿Qué es la cuenta compartida?", "What is the shared account?"],
  scrFaqSharedA: [
    "Una cuenta que usan muchas personas a la vez. Funciona sin registrarte, pero el servicio deja pocas sesiones abiertas: puede cerrar la de otra persona, y otra la tuya.",
    "An account many people use at once. It works without signing up, but the service keeps few sessions open: it may sign someone else out, and someone else may sign you out.",
  ],
  scrFaqSyncQ: ["¿Mi cuenta pasa a mis otros aparatos?", "Does my account reach my other devices?"],
  scrFaqSyncA: [
    "Sí: el correo y la contraseña se guardan como tus otros ajustes y se sincronizan con tus aparatos vinculados; la contraseña viaja cifrada.",
    "Yes: the email and the password are saved like your other settings and sync with your linked devices; the password travels encrypted.",
  ],
  scrDiagTitle: ["Diagnóstico", "Diagnostics"],
  scrDiagPlugin: ["Versión del plugin", "Plugin version"],
  scrDiagKino: ["Versión de Kino", "Kino version"],
  scrDiagDevice: ["Aparato", "Device"],
  scrDiagNoPersonal: ["Sin datos personales: ni tu correo ni tus sesiones.", "No personal data: neither your email nor your sessions."],
  scrCopyDiag: ["Copiar diagnóstico", "Copy diagnostics"],
});

/** The text for `key` in Kino's language, `{name}`s filled from `vars` (and `{place}` always). */
export function say(kino, key, vars = {}) {
  const pair = TEXTS[key];
  if (!pair) return key;
  const en = isEnglish(kino);
  const all = { place: TEXTS.settingsPlace[en ? 1 : 0], ...vars };
  return pair[en ? 1 : 0].replace(/\{(\w+)\}/g, (m, name) => (Object.hasOwn(all, name) ? String(all[name]) : m));
}

/**
 * `key` in both languages as a screen node's twin texts: `{ [field]: Spanish, [field + "En"]: English }` (`field` "text",
 * "labelText", "title"...), `{name}`s filled from `vars` (a var may itself be a `[es, en]` pair). Kino picks by language.
 */
export function twin(key, field = "text", vars = {}) {
  const pair = TEXTS[key] || [key, key];
  const fill = (text, i) => {
    const all = { place: TEXTS.settingsPlace[i], ...vars };
    return text.replace(/\{(\w+)\}/g, (m, name) => {
      if (!Object.hasOwn(all, name)) return m;
      const v = all[name];
      return Array.isArray(v) ? String(v[i]) : String(v);
    });
  };
  return { [field]: fill(pair[0], 0), [field + "En"]: fill(pair[1], 1) };
}

/** Both languages' text for `key` (no vars besides `{place}`): to recognize a sentence whichever it was said in. */
export function sayAll(key) {
  const pair = TEXTS[key];
  if (!pair) return [];
  return pair.map((text, i) => text.replace(/\{place\}/g, TEXTS.settingsPlace[i]));
}
