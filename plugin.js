// kino.xuper.* already returns parsed JS objects — the prelude unwraps the JSON string from native.

function unwrap(envelope) {
  if (!envelope.ok) throw kino.error(envelope.code || "unavailable", envelope.message || "Error desconocido");
  return envelope.data;
}

async function tryLogin() {
  const email = kino.config.get("email");
  const password = kino.config.get("password");
  if (!email || !password) throw kino.error("auth_required", "Configura tu cuenta en los ajustes del plugin");
  const hashed = kino.crypto.hash("md5", password + "cloudstream");
  const envelope = await kino.xuper.login(email, hashed);
  if (!envelope.ok) throw kino.error(envelope.code || "auth_failed", envelope.message || "Error de autenticación");
}

async function withSession(fn) {
  try {
    return await fn();
  } catch (e) {
    if (e && e.code === "auth_required") {
      await tryLogin();
      return await fn();
    }
    throw e;
  }
}

export async function search(query) {
  return withSession(async () => unwrap(await kino.xuper.search({ q: query })));
}

export async function home() {
  return withSession(async () => unwrap(await kino.xuper.home()));
}

export async function browse(ref, cursor) {
  return withSession(async () => unwrap(await kino.xuper.browse(ref, cursor ?? null)));
}

export async function episodes(ref) {
  return withSession(async () => unwrap(await kino.xuper.episodes(ref)));
}

export async function resolve(ref) {
  return withSession(async () => unwrap(await kino.xuper.resolve(ref)));
}

export async function settingsStatus() {
  const email = kino.config.get("email");
  const loggedIn = (await kino.storage.get("session")) === "active";
  return {
    status: loggedIn && email ? `Conectado como ${email}` : "Sin cuenta: sesión anónima",
  };
}

export async function action(key) {
  if (key === "login") {
    await tryLogin();
    await kino.storage.set("session", "active");
    return { message: "Sesión iniciada correctamente", refresh: true };
  }
  if (key === "logout") {
    await kino.storage.remove("session");
    return { message: "Sesión cerrada", refresh: true };
  }
  return null;
}

export async function validateSettings(values) {
  if (values.email && !values.email.includes("@")) return { email: "Escribe un correo válido" };
  return null;
}
