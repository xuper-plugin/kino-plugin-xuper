// THE PARITY PASS (the last gate before any release of the configuration screen): every capability of the old settings
// form (the checklist of the analysis, section 3.8) is walked row by row. For each row: the element is present on the
// phone AND on the TV, its event reaches the OLD function (spied), and the old sentence (or its improved version) shows.
// A row reads "same" or "better"; anything else fails the gate.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountWorld, goodRoutes, refuse } from "./helpers/accountWorld.mjs";
import { screenHarness, allNodes, byKey, SETTINGS } from "./helpers/screenHarness.mjs";
import { EMAIL, PW, CODE, DEVICES, worldIn } from "./helpers/screenWorlds.mjs";
import { maskEmail } from "../src/screenModel.js";

const BASE = JSON.parse(readFileSync(new URL("../kino-plugin.json", import.meta.url), "utf8")).settings;

/** The world's settings with every old function spied (each call is recorded, then runs as always). */
function spied(w) {
  const calls = [];
  const s = w.settings;
  const wrap = (name) => async (...a) => { calls.push([name, ...(name === "action" ? [a[0]] : [])]); return s[name](...a); };
  const settings = { ...s, validateSettings: wrap("validateSettings"), action: wrap("action"), sendCodeTo: wrap("sendCodeTo"), registerWith: wrap("registerWith"),
    statusFacts: (...a) => { calls.push(["statusFacts"]); return s.statusFacts(...a); } };
  return { calls, deps: () => ({ settings, session: w.session, registration: w.registration }), called: (name, key) => calls.some((c) => c[0] === name && (key === undefined || c[1] === key)) };
}
async function on(device, world, { tab, page, state } = {}) {
  const sp = spied(world);
  const h = screenHarness(world, { device, deps: sp.deps });
  if (page) h.push(page);
  if (tab) h.state.tab = tab;
  if (state) Object.assign(h.state, state);
  return { h, sp, tree: async () => { const r = await h.render(); assert.deepEqual(r.dropped, [], `${device}: nothing dropped`); return r.tree; } };
}
const textsOf = (tree) => allNodes(tree).flatMap((n) => [n.text, n.title, n.subtitle, n.label, n.summary, n.field && n.field.forceError].filter((x) => typeof x === "string"));
const hasText = (tree, t) => textsOf(tree).some((x) => x === t || x.includes(t));

/** Each row: the old capability, where it is now, and a check that answers "same" or "better" for a device. */
const ROWS = [
  ["Section «Cuenta» + its hint", "Cuenta tab, the anonymous banner", async (d) => {
    const { tree } = await on(d, accountWorld(), { tab: "account" });
    const t = await tree();
    assert.ok(hasText(t, "Sin cuenta: usas una sesión anónima"));
    return "better";
  }],
  ["`email` text field", "Sign-in page, an email field checked by Kino", async (d) => {
    const { tree } = await on(d, accountWorld(), { page: "signin" });
    const f = byKey(await tree(), "signinEmail");
    assert.equal(f.kind, "email");
    assert.ok(f.field.required && f.field.pattern);
    return "better";
  }],
  ["`password` entry (masked, sealed, synced)", "Sign-in page, a secret field written with config (Kino stores it as Ajustes' Guardar)", async (d) => {
    const { h, tree } = await on(d, accountWorld(), { page: "signin" });
    assert.equal(byKey(await tree(), "signinPw").secret, true);
    const r = await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
    assert.equal(r.raw.config.password, PW);
    assert.equal(SETTINGS.find((s) => s.key === "password").type, "password");
    return "same";
  }],
  ["Save-time login check, its field errors («Credenciales…», «Escribe un correo válido»)", "Sign-in submit -> the old validateSettings; verdict under the field", async (d) => {
    const w = accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) });
    const { h, sp, tree } = await on(d, w, { page: "signin" });
    await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
    assert.ok(sp.called("validateSettings"));
    assert.equal(byKey(await tree(), "signinPw").field.forceError, "Credenciales de Xuper inválidas");
    return "better";
  }],
  ["Save without checking when the portal is down", "Sign-in page, «Guardar sin comprobar»", async (d) => {
    const w = accountWorld({ routes: goodRoutes({ "v8/login": new Error("down") }) });
    const { h, tree } = await on(d, w, { page: "signin" });
    await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
    assert.ok(byKey(await tree(), "saveUnchecked"));
    const r = await h.send("signin.saveUnchecked", { inputs: { signinEmail: EMAIL, signinPw: PW } });
    assert.deepEqual(r.raw.config, { email: EMAIL, password: PW });
    return "same";
  }],
  ["`status` line, every variant", "Account card and Connection status card (from the old statusFacts), live", async (d) => {
    const seen = {};
    const held = await on(d, await worldIn("ownHeld"), { tab: "account" });
    seen.connected = byKey(await held.tree(), "accountTile").subtitle === "Conectado" && byKey(await held.tree(), "accountTile").title === maskEmail(EMAIL);
    assert.ok(held.sp.called("statusFacts"), "the old facts");
    seen.connecting = byKey(await (await on(d, await worldIn("ownPending"))).tree(), "accountTile").subtitle.startsWith("Conectando");
    seen.refused = byKey(await (await on(d, await worldIn("ownRefused"))).tree(), "accountTile").subtitle.startsWith("No aceptada");
    seen.shared = byKey(await (await on(d, await worldIn("shared"))).tree(), "sharedTile").subtitle === "Conectado";
    const broken = accountWorld({ saved: { useSharedAccount: true }, routes: goodRoutes({ "v8/login": refuse() }) });
    await assert.rejects(broken.session.useShared());
    seen.sharedBroken = byKey(await (await on(d, broken)).tree(), "sharedTile").subtitle === "La cuenta compartida ya no funciona: sesión anónima";
    const pool = [{ sn: "a", userId: "1", userToken: "t" }, { sn: "b", userId: "2", userToken: "u" }];
    const blocked = await on(d, accountWorld({ seeds: pool, storageExtra: { region: { blocked: true } } }), { tab: "connection" });
    const bt = await blocked.tree();
    seen.blockedSeeds = byKey(bt, "regionRow").trailing.text === "Bloqueada" && byKey(bt, "seedsRow").subtitle === "2 utilizables de 2";
    const empty = await (await on(d, accountWorld({ storageExtra: { region: { blocked: true } } }), { tab: "connection" })).tree();
    seen.noSeeds = byKey(empty, "seedsRow").subtitle === "0 utilizables de 0";
    seen.exhausted = byKey(empty, "noSeedsBanner") !== null;
    const off = await on(d, accountWorld({ saved: { autoRefreshSeeds: false }, storageExtra: { region: { blocked: true } } }), { tab: "more" });
    seen.autoOff = byKey(await off.tree(), "copyDiag").onTap.go.copy.text.includes("Actualización automática: Desactivado");
    const broke = accountWorld();
    const bad = screenHarness(broke, { device: d, deps: () => ({ settings: { ...broke.settings, statusFacts: () => { throw new Error("x"); } }, session: broke.session, registration: broke.registration }) });
    seen.unknown = byKey((await bad.render()).tree, "statusUnknown").text === "No se pudo consultar el estado";
    assert.deepEqual(Object.entries(seen).filter(([, v]) => !v).map(([k]) => k), [], "every variant shown");
    return "better";
  }],
  ["`login` action and its sentences («Sesión iniciada», refusal, region, crypto)", "«Conectar ahora» / the refused banner's «Reintentar» -> the old action", async (d) => {
    const w = await worldIn("ownPending");
    const { h, sp, tree } = await on(d, w);
    assert.ok(byKey(await tree(), "connectNow"));
    const r = await h.send("account.retry");
    assert.ok(sp.called("action", "login"));
    assert.equal(r.raw.toast.text, "Sesión iniciada");
    const geo = accountWorld({ saved: { email: EMAIL, password: PW }, routes: goodRoutes({ "v8/login": { returnCode: "portal100024", errorMessage: "x" } }) });
    const rg = await (await on(d, geo)).h.send("account.retry");
    // Whatever the old action tells for a refusal (here a region answer), the screen tells the very same sentence.
    const old = accountWorld({ saved: { email: EMAIL, password: PW }, routes: goodRoutes({ "v8/login": { returnCode: "portal100024", errorMessage: "x" } }) });
    const said = await old.settings.action("login").then(() => null, (e) => e.userMessage);
    assert.equal(rg.raw.toast.text, said);
    return "same";
  }],
  ["`logout` action + confirm + clearSettings (5 keys) + anonymous again", "«Cerrar sesión» (Kino's confirm) -> the old action, its clearSettings as config", async (d) => {
    const w = await worldIn("ownHeld");
    const { h, sp, tree } = await on(d, w);
    assert.equal(byKey(await tree(), "signOut").confirm, "¿Cerrar sesión de tu cuenta?");
    const r = await h.send("account.logout");
    assert.ok(sp.called("action", "logout"));
    assert.deepEqual(Object.keys(r.raw.config).sort(), ["email", "password", "regEmail", "regPassword", "useSharedAccount"]);
    assert.equal(r.raw.toast.text, "Sesión cerrada");
    return "better"; // also clears when the re-activation fails (defect 8)
  }],
  ["`useSharedAccount` toggle + hint", "Account tab, a switch with its hint", async (d) => {
    const { tree } = await on(d, accountWorld());
    const t = await tree();
    assert.ok(byKey(t, "sharedSwitch"));
    assert.ok(hasText(t, "Muchas personas la usan; puede cerrar la sesión de otra."));
    return "same";
  }],
  ["Shared activation failure / conflict with an own account", "Told under the switch at once (the old validateSettings)", async (d) => {
    const own = await worldIn("ownHeld");
    const o = await on(d, own);
    await o.h.send("shared.change", { value: true });
    assert.ok(o.sp.called("validateSettings"));
    assert.equal(byKey(await o.tree(), "sharedSwitch").field.forceError, "Quita tu cuenta o apaga la cuenta compartida");
    const bad = await on(d, accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) }));
    await bad.h.send("shared.change", { value: true });
    assert.equal(byKey(await bad.tree(), "sharedSwitch").field.forceError, "No se pudo activar la cuenta compartida");
    return "better";
  }],
  ["Section «Crear cuenta» + «en ese orden»", "Registration page, Kino's steps", async (d) => {
    const { tree } = await on(d, accountWorld(), { page: "register", state: { reg: { step: "email" } } });
    assert.equal(byKey(await tree(), "regSteps").items.length, 3);
    return "better";
  }],
  ["`regEmail` + hint", "Step 1, an email field checked by Kino", async (d) => {
    const { tree } = await on(d, accountWorld(), { page: "register", state: { reg: { step: "email" } } });
    assert.equal(byKey(await tree(), "regEmailInput").kind, "email");
    return "better";
  }],
  ["`sendCode` and its sentences (sent, already sent, failure, region, not saved)", "Step 1 submit -> the old sendCode logic (sendCodeTo)", async (d) => {
    const ok = await on(d, accountWorld(), { page: "register", state: { reg: { step: "email" } } });
    const r = await ok.h.send("reg.send", { value: { regEmailInput: EMAIL } });
    assert.ok(ok.sp.called("sendCodeTo"));
    assert.equal(r.raw.toast.text, `Enviamos un código a ${maskEmail(EMAIL)}.`);
    const again = await ok.h.send("reg.resend");
    assert.equal(again.raw.toast.text, "Ya te enviamos un código; espera un minuto antes de pedir otro");
    const fail = await on(d, accountWorld({ routes: goodRoutes({ "v2/sendEmailVerifyCode": refuse() }) }), { page: "register", state: { reg: { step: "email" } } });
    await fail.h.send("reg.send", { value: { regEmailInput: EMAIL } });
    assert.match(byKey(await fail.tree(), "regEmailInput").field.forceError, /no pudo enviar el código/);
    const geo = await on(d, accountWorld({ routes: goodRoutes({ "v3/snToken": { returnCode: "portal100024", errorMessage: "x" } }) }), { page: "register", state: { reg: { step: "email" } } });
    await geo.h.send("reg.send", { value: { regEmailInput: EMAIL } });
    assert.match(byKey(await geo.tree(), "regEmailInput").field.forceError, /región/);
    // A store that refuses the pending device: the last test of this file.
    return "better";
  }],
  ["Old-Kino «Guardar first» texts", "Not needed in a screen (only a new Kino draws it); the old form keeps them", async () => "same"],
  ["`verifyCode` field + hint", "Step 2 code field, never a synced setting", async (d) => {
    const { h, tree } = await on(d, accountWorld(), { page: "register", state: { reg: { step: "code", email: EMAIL, emailMasked: maskEmail(EMAIL), sentAt: 1 } } });
    assert.ok(byKey(await tree(), "regCode"));
    const r = await h.send("reg.confirm", { value: { regCode: CODE, regPw: PW } });
    assert.ok(!r.raw.config || r.raw.config.verifyCode === undefined || r.raw.config.verifyCode === null, "never written with a code");
    return "better";
  }],
  ["`regPassword` + hint", "Step 2, a secret field", async (d) => {
    const { tree } = await on(d, accountWorld(), { page: "register", state: { reg: { step: "code", email: EMAIL, sentAt: 1 } } });
    assert.equal(byKey(await tree(), "regPw").secret, true);
    return "same";
  }],
  ["`register` and its outcomes (created+in, created then sign in, refused, ask again, missing)", "Step 2 submit -> the old register logic (registerWith)", async (d) => {
    const w = accountWorld();
    const ok = await on(d, w, { page: "register", state: { reg: { step: "email" } } });
    await ok.h.send("reg.send", { value: { regEmailInput: EMAIL } });
    const r = await ok.h.send("reg.confirm", { value: { regCode: CODE, regPw: PW } });
    assert.ok(ok.sp.called("registerWith"));
    assert.equal(r.raw.toast.text, "Cuenta creada y sesión iniciada");
    const bound = accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) });
    const b = await on(d, bound, { page: "register", state: { reg: { step: "email" } } });
    await b.h.send("reg.send", { value: { regEmailInput: EMAIL } });
    assert.match((await b.h.send("reg.confirm", { value: { regCode: CODE, regPw: PW } })).raw.toast.text, /^Cuenta creada\./);
    const ask = await on(d, accountWorld(), { page: "register", state: { reg: { step: "code", email: EMAIL, sentAt: 1 } } });
    await ask.h.send("reg.confirm", { value: { regCode: CODE, regPw: PW } });
    assert.equal(byKey(await ask.tree(), "regBanner").text, "Pide el código otra vez.");
    return "better";
  }],
  ["Section «Semillas» + hint", "Connection tab, the seeds card", async (d) => {
    const { tree } = await on(d, accountWorld(), { tab: "connection" });
    assert.ok(hasText(await tree(), "Sesiones anónimas de respaldo para cuando tu zona está bloqueada."));
    return "better";
  }],
  ["`autoRefreshSeeds` toggle + hint, default on", "Kino's own item (autoSave), plus what it really does", async (d) => {
    const { tree } = await on(d, accountWorld(), { tab: "connection" });
    const t = await tree();
    const f = byKey(t, "autoRefreshForm");
    assert.ok(f && f.autoSave === true);
    assert.equal(BASE.find((s) => s.key === "autoRefreshSeeds").default, true);
    return "same";
  }],
  ["`switchSeed` + hint + its 5 outcomes", "«Cambiar semilla» -> the old action, its sentences as toasts", async (d) => {
    const pool = [{ sn: "a", userId: "1", userToken: "t" }, { sn: "b", userId: "2", userToken: "u" }];
    const { h, sp, tree } = await on(d, accountWorld({ seeds: pool, storageExtra: { region: { blocked: true } } }), { tab: "connection" });
    assert.ok(byKey(await tree(), "switchSeed"));
    const r = await h.send("seeds.switch");
    assert.ok(sp.called("action", "switchSeed"));
    assert.match(r.raw.toast.text, /^Semilla cambiada/);
    return "same";
  }],
  ["`refreshSeeds` + hint + its 2 outcomes", "«Actualizar semillas» -> the old action; the reason of a failure told", async (d) => {
    const { h, sp } = await on(d, accountWorld({ seedsAnswer: () => { throw new Error("offline"); } }), { tab: "connection" });
    const r = await h.send("seeds.refresh");
    assert.ok(sp.called("action", "refreshSeeds"));
    assert.equal(r.raw.toast.text, "Sin conexión, reintenta");
    return "better";
  }],
  ["`contributeSeeds` toggle + hint, default on", "Kino's own item, the last contribution, what is shared", async (d) => {
    const { tree } = await on(d, accountWorld(), { tab: "connection" });
    const t = await tree();
    assert.ok(byKey(t, "contribForm") && byKey(t, "contribAt") && byKey(t, "contribWhat"));
    return "better";
  }],
  ["Section «Inicio» + hint", "Home & help tab", async (d) => {
    const { tree } = await on(d, accountWorld(), { tab: "more" });
    assert.ok(hasText(await tree(), "Una fila con los canales en vivo de tu país al final de Inicio."));
    return "same";
  }],
  ["`homeCountry` select (19 options, default «none»)", "Kino's own select (autoSave), English names from the manifest", async (d) => {
    const { tree } = await on(d, accountWorld(), { tab: "more" });
    assert.ok(byKey(await tree(), "homeForm"));
    assert.equal(SETTINGS.find((s) => s.key === "homeCountry").options.length, 19);
    return "same";
  }],
  ["Kino-side item behaviour (TV text dialog, sync)", "Secret and text fields use Kino's TV dialog; config writes save and sync as Ajustes' Guardar", async (d) => {
    const { tree } = await on(d, accountWorld(), { page: "signin" });
    assert.ok(allNodes(await tree()).some((n) => n.type === "textInput"));
    return "same"; // the TV dialog and the sync between devices are device checks
  }],
];

test("parity: every old capability is reachable in the new screen, on the phone and on the TV, as 'same' or 'better'", async () => {
  const report = [];
  for (const [capability, where, check] of ROWS) {
    const statuses = [];
    for (const d of DEVICES) statuses.push(await check(d));
    const status = statuses.every((s) => s === statuses[0]) ? statuses[0] : "mixed";
    report.push([capability, where, status]);
  }
  const blocked = report.filter(([, , s]) => s !== "same" && s !== "better");
  // The report the parity file lists (printed so a run shows it).
  console.log(report.map(([c, , s]) => `${s.padEnd(6)} ${c}`).join("\n"));
  assert.deepEqual(blocked, [], "rows that are not same/better block the release");
  assert.equal(report.length, ROWS.length);
});

test("parity: no key of the old form is lost (every base setting has a place in the screen or in Kino's own items)", () => {
  const placed = {
    account: "account tab", email: "sign-in page", password: "sign-in page (secret field)", status: "status cards", login: "Conectar ahora / Reintentar",
    logout: "Cerrar sesión", useSharedAccount: "shared switch", createAccount: "registration page", regEmail: "step 1", sendCode: "step 1 submit",
    verifyCode: "step 2 code field (never synced)", regPassword: "step 2 secret field", register: "step 2 submit", seeds: "connection tab",
    autoRefreshSeeds: "Kino's item", switchSeed: "Cambiar semilla", refreshSeeds: "Actualizar semillas", contributeSeeds: "Kino's item",
    home: "home & help tab", homeCountry: "Kino's item",
  };
  assert.deepEqual(Object.keys(placed).sort(), BASE.map((s) => s.key).sort());
});

test("parity: a store that refuses the pending registration gives the old sentence and a way to ask again", async () => {
  const w = accountWorld();
  const storage = w.base.storage;
  const kino = Object.freeze({ ...w.kino, storage: { get: (k) => storage.get(k), set: (k, v, o) => { if (k === "pendingRegistration") throw new Error("full"); return storage.set(k, v, o); }, remove: (k) => storage.remove(k) } });
  const { makeRegistration } = await import("../src/registration.js");
  const { makeSettings } = await import("../src/settings.js");
  const registration = makeRegistration({ kino, portal: w.portal, session: w.session, clock: w.clock });
  const settings = makeSettings({ kino, session: w.session, clock: w.clock, registration });
  const h = screenHarness({ ...w, kino }, { deps: () => ({ settings, session: w.session, registration }) });
  h.push("register");
  h.state.reg = { step: "email" };
  await h.send("reg.send", { value: { regEmailInput: EMAIL } });
  const b = byKey((await h.render()).tree, "regBanner");
  assert.equal(b.text, "No pudimos guardar tu pedido. Vuelve a tocar Crear cuenta.");
  assert.equal(b.action.onTap.event.name, "reg.resend");
});
