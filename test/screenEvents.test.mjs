// The configuration screen's events with Kino's kit reading every answer as the app does (nothing dropped), over the
// real session, registration and settings logic and a scripted portal: each flow reaches the OLD function and shows its
// sentence (or the improved one), with fake portal answers for success, refusal, conflict and failure.
import test from "node:test";
import assert from "node:assert/strict";
import { accountWorld, goodRoutes, refuse, SHARED } from "./helpers/accountWorld.mjs";
import { screenHarness, allNodes, byKey, SETTINGS } from "./helpers/screenHarness.mjs";
import { STATES, EMAIL, PW, CODE, DEVICES, worldIn, assertNoSecrets, tabs } from "./helpers/screenWorlds.mjs";
import { maskEmail } from "../src/screenModel.js";
import { PRESS_MS } from "../src/screenView.js";
import { TOAST_PRESS_MS } from "../src/screenEvents.js";

// ---- opening: no network ---------------------------------------------------------------------------------------------

test("opening the screen, drawing every tab, a timer tick and Kino's onSaved never touch the network", async () => {
  for (const name of STATES) {
    const w = await worldIn(name);
    const before = [w.requests.length, w.seedDownloads.length];
    const h = screenHarness(w);
    await h.send("open");
    await tabs(h);
    await h.send("tick", { timer: true });
    await h.send("saved", { value: { kind: "save", ok: true, keys: ["autoRefreshSeeds"] } });
    await h.send("refresh");
    for (const page of ["signin", "register"]) { h.push(page); await h.send("open"); await h.render(); }
    assert.deepEqual([w.requests.length, w.seedDownloads.length], before, name);
  }
});

test("tabs: the TabBar's event and the help button pick the tab; anything else is ignored", async () => {
  const h = screenHarness(accountWorld());
  assert.equal((await h.send("tab", { value: "connection" })).raw.state.tab, "connection");
  assert.equal((await h.send("tab", { arg: "more" })).raw.state.tab, "more");
  assert.equal((await h.send("tab", { value: "../../etc" })).raw, null);
  const r = await h.render();
  assert.equal(r.raw.appBar.title.value, "more");
});

test("Kino's own settings items (auto-update, contribution, country) save as they change and tell the screen", async () => {
  const h = screenHarness(accountWorld());
  h.state.tab = "connection";
  const t = await h.render();
  const forms = allNodes(t.tree).filter((n) => n.type === "settings");
  assert.deepEqual(forms.map((f) => f.key).sort(), ["autoRefreshForm", "contribForm"]);
  for (const f of forms) {
    assert.equal(f.autoSave, true);
    assert.equal(f.onSaved.name ?? f.onSaved.event?.name ?? f.onSaved, "saved");
  }
  h.state.tab = "more";
  const more = await h.render();
  assert.ok(byKey(more.tree, "homeForm"));
  const r = await h.send("saved", { value: { kind: "save", ok: true, keys: ["homeCountry"] } });
  assert.equal(typeof r.raw.state.v, "number");
});

test("a sign-in still pending (credentials that arrived by sync) re-reads every 15 s; the tick answers only on a change", async () => {
  const w = await worldIn("ownPending");
  const h = screenHarness(w);
  await h.send("open");
  assert.deepEqual((await h.render()).every.map((t) => [t.ms, t.event?.name ?? t.event]), [[15000, "tick"]]);
  assert.equal((await h.send("tick", { timer: true })).raw, null, "nothing changed");
  await w.settings.action("login"); // the catalog's next call signs in, in the background
  const t = await h.send("tick", { timer: true });
  assert.equal(typeof t.raw.state.fp, "string");
  const r = await h.render();
  assert.deepEqual(r.every, [], "signed in: no timer");
  assert.equal(byKey(r.tree, "accountTile").subtitle, "Conectado");
  assert.deepEqual((await screenHarness(accountWorld()).render()).every, [], "anonymous: no timer");
});

// ---- sign in -------------------------------------------------------------------------------------------------------

test("sign in: the old pre-save check logs in for real, then the pair is written as Ajustes' Guardar would", async () => {
  const w = accountWorld();
  const h = screenHarness(w);
  await h.send("go", { arg: "signin" });
  assert.equal(h.route(), "signin");
  const r = await h.send("signin.submit", { value: { signinEmail: " " + EMAIL + " ", signinPw: PW + " " } });
  assert.deepEqual(r.raw.config, { email: EMAIL, password: PW });
  assert.deepEqual(r.raw.route, { pop: true });
  assert.equal(r.raw.toast.text, "Sesión iniciada");
  assert.deepEqual(w.paths(), ["v8/login"]);
  assert.equal(w.stored().acct, w.session.accountKey(EMAIL, PW), "the token is the account's");
  assert.equal(h.route(), "main");
  const t = await h.render();
  assert.equal(byKey(t.tree, "accountTile").title, maskEmail(EMAIL));
  assert.equal(byKey(t.tree, "accountTile").subtitle, "Conectado");
  assert.equal(byKey(t.tree, "connectNow"), null, "no pointless sign-in button once signed in");
  assertNoSecrets([...h.seen.trees, ...h.seen.toasts]);
});

test("sign in refused: the old field verdict under the password, nothing written", async () => {
  const w = accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) });
  const h = screenHarness(w);
  h.push("signin");
  const r = await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
  assert.equal(r.raw.config, undefined);
  const t = await h.render();
  assert.equal(byKey(t.tree, "signinPw").field.forceError, "Credenciales de Xuper inválidas");
  assert.equal(byKey(t.tree, "signinPw").secret, true);
  assert.equal(h.route(), "signin");
});

test("sign in while the portal is down: told as it is, and the person may save without checking, as in the old form", async () => {
  const w = accountWorld({ routes: goodRoutes({ "v8/login": new Error("timeout") }) });
  const h = screenHarness(w);
  h.push("signin");
  const r = await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
  assert.equal(r.raw.config, undefined);
  const t = await h.render();
  assert.equal(byKey(t.tree, "signinBanner").role, "warning");
  assert.ok(byKey(t.tree, "saveUnchecked"), "the unchecked save is offered");
  // Without the password typed again (it is never kept), nothing is saved.
  const empty = await h.send("signin.saveUnchecked");
  assert.equal(empty.raw.config, undefined);
  assert.equal(empty.raw.toast.text, "Escribe el correo y la contraseña, y vuelve a tocar el botón.");
  const saved = await h.send("signin.saveUnchecked", { inputs: { signinEmail: EMAIL, signinPw: PW } });
  assert.deepEqual(saved.raw.config, { email: EMAIL, password: PW });
  assert.equal(h.route(), "main");
  assert.equal(h.state.inputs.signinPw, undefined, "the secret text is gone after the call");
  await h.render();
  assertNoSecrets(h.seen.trees);
});

test("sign in with the shared account on: the old conflict verdict, with a button that turns the shared account off", async () => {
  const w = accountWorld({ saved: { useSharedAccount: true } });
  const h = screenHarness(w);
  h.push("signin");
  await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
  const t = await h.render();
  assert.equal(byKey(t.tree, "signinBanner").text, "Quita tu cuenta o apaga la cuenta compartida");
  assert.equal(w.requests.length, 0, "no login: the old check refuses first");
  const off = await h.send("shared.off");
  assert.deepEqual(off.raw.config, { useSharedAccount: false });
  assert.equal(w.saved.useSharedAccount, false);
});

test("sign in: a typed address that is not one, or a missing password, never costs a portal call", async () => {
  const w = accountWorld();
  const h = screenHarness(w);
  h.push("signin");
  const r = await h.send("signin.submit", { value: { signinEmail: "nope", signinPw: "" } });
  assert.equal(r.raw.state.signin.emailError, "Escribe un correo válido");
  assert.equal(r.raw.state.signin.pwError, "Escribe la contraseña");
  assert.equal(w.requests.length, 0);
});

// ---- the account in use: retry, sign out ----------------------------------------------------------------------------

test("a refused account: its banner retries the old login; pending shows 'Conectar ahora'; signed in does not", async () => {
  const w = await worldIn("ownRefused");
  const h = screenHarness(w);
  let t = await h.render();
  assert.equal(byKey(t.tree, "refusedBanner").role, "error");
  assert.equal(byKey(t.tree, "accountTile").subtitle, "No aceptada: usas la sesión anónima");
  const r = await h.send("account.retry");
  assert.equal(r.raw.toast.role, "error");
  assert.equal(r.raw.toast.text, "Xuper no aceptó esa cuenta. Revisa los datos en Ajustes ▸ Xuper.");
  const ok = await worldIn("ownPending");
  const h2 = screenHarness(ok);
  t = await h2.render();
  assert.ok(byKey(t.tree, "connectNow"));
  const done = await h2.send("account.retry");
  assert.equal(done.raw.toast.text, "Sesión iniciada");
  assert.equal(ok.session.accountState(), "held");
});

test("sign out: the old action (log out, anonymous again) and its clearSettings written as config", async () => {
  const w = await worldIn("ownHeld");
  w.saved.regEmail = "otra@ejemplo.test";
  const h = screenHarness(w);
  const t = await h.render();
  assert.equal(byKey(t.tree, "signOut").confirm, "¿Cerrar sesión de tu cuenta?");
  const r = await h.send("account.logout");
  assert.deepEqual(r.raw.config, { email: null, password: null, regEmail: null, regPassword: null, useSharedAccount: false });
  assert.equal(r.raw.toast.text, "Sesión cerrada");
  assert.deepEqual(w.saved, { useSharedAccount: false });
  assert.ok(w.paths().includes("v5/loginOut"));
  assert.equal(w.stored().acct, "");
});

test("sign out whose anonymous re-activation fails (the old form's half-done defect): the screen clears the settings anyway", async () => {
  const offline = goodRoutes({ "v8/active": new Error("offline"), "v3/snToken": new Error("offline") });
  // The old action throws on this path (kept as is: its fix is a separate, owner-approved version), so Kino's form
  // would apply no clearSettings and the saved account would sign in again on the next call.
  const old = accountWorld({ saved: { email: EMAIL, password: PW }, routes: offline });
  await old.settings.action("login");
  await assert.rejects(old.settings.action("logout"));
  const w = accountWorld({ saved: { email: EMAIL, password: PW }, routes: offline });
  await w.settings.action("login");
  const r = await screenHarness(w).send("account.logout");
  assert.deepEqual(r.raw.config, { email: null, password: null, regEmail: null, regPassword: null, useSharedAccount: false });
  assert.equal(r.raw.toast.role, "warning");
  assert.equal(r.raw.toast.text, "Cerraste sesión. La sesión anónima se activará al cargar el catálogo.");
  assert.deepEqual(w.saved, { useSharedAccount: false });
  assert.equal(w.session.accountState(), "none");
});

// ---- the shared account --------------------------------------------------------------------------------------------

test("shared account on: one bounded shared login, then written; refused: told under the switch, switch back off", async () => {
  const ok = accountWorld();
  const h = screenHarness(ok);
  const r = await h.send("shared.change", { value: true });
  assert.deepEqual(r.raw.config, { useSharedAccount: true });
  assert.equal(r.raw.toast.text, "Cuenta compartida activada");
  assert.deepEqual(ok.paths(), ["v8/login"]);
  assert.equal(ok.requests[0].bean.userName, SHARED.email, "the shared pair (never shown)");
  const t = await h.render();
  assert.equal(byKey(t.tree, "sharedTile").subtitle, "Conectado");
  assertNoSecrets(h.seen.trees);

  const bad = accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) });
  const hb = screenHarness(bad);
  const rb = await hb.send("shared.change", { value: true });
  assert.equal(rb.raw.config, undefined);
  assert.equal(rb.raw.state.inputs.sharedSwitch, false);
  const tb = await hb.render();
  assert.equal(byKey(tb.tree, "sharedSwitch").field.forceError, "No se pudo activar la cuenta compartida");
  assert.equal(byKey(tb.tree, "sharedSwitch").value, false);
});

test("shared account on together with an own account: the old conflict, told at the switch, no portal call", async () => {
  const w = await worldIn("ownHeld");
  const n = w.requests.length;
  const h = screenHarness(w);
  const r = await h.send("shared.change", { value: true });
  assert.equal(r.raw.state.sharedError, "Quita tu cuenta o apaga la cuenta compartida");
  assert.equal(r.raw.config, undefined);
  assert.equal(w.requests.length, n);
  const t = await h.render();
  assert.ok(allNodes(t.tree).some((x) => x.text === "Para usarla, primero cierra la sesión de tu cuenta."));
});

test("shared account off: written at once, with no check (as the old form saves it)", async () => {
  const w = await worldIn("shared");
  const n = w.requests.length;
  const r = await screenHarness(w).send("shared.change", { value: false });
  assert.deepEqual(r.raw.config, { useSharedAccount: false });
  assert.equal(w.requests.length, n);
});

test("shared account while the portal is down: told under the switch, never written", async () => {
  const w = accountWorld({ routes: goodRoutes({ "v8/login": new Error("timeout") }) });
  const r = await screenHarness(w).send("shared.change", { value: true });
  assert.equal(r.raw.config, undefined);
  assert.equal(r.raw.state.inputs.sharedSwitch, false);
  assert.equal(typeof r.raw.state.sharedError, "string");
});

// ---- seeds ----------------------------------------------------------------------------------------------------------

const POOL = [
  { sn: "seed-1", userId: "s1", userToken: "st1" },
  { sn: "seed-2", userId: "s2", userToken: "st2" },
  { sn: "seed-3", userId: "s3", userToken: "st3" },
];

test("Cambiar semilla: the old probe and its sentences; a switch is a success, a failure offers a retry on the toast", async () => {
  const ok = accountWorld({ seeds: POOL, storageExtra: { region: { blocked: true } } });
  const r = await screenHarness(ok).send("seeds.switch");
  assert.equal(r.raw.toast.text, "Semilla cambiada (intento 1)");
  assert.equal(r.raw.toast.role, "success");

  const none = accountWorld({ seeds: [], storageExtra: { region: { blocked: true } } });
  const rn = await screenHarness(none).send("seeds.switch");
  assert.equal(rn.raw.toast.text, "No hay otra semilla para probar");
  assert.equal(rn.raw.toast.action, undefined);

  const dead = accountWorld({ seeds: POOL, routes: goodRoutes({ "v8/active": refuse() }), storageExtra: { region: { blocked: true } } });
  const rd = await screenHarness(dead).send("seeds.switch");
  assert.equal(rd.raw.toast.text, "Probé 3 semillas y ninguna funcionó");
  assert.equal(rd.raw.toast.role, "error");
  assert.deepEqual(rd.raw.toast.action, { label: "Reintentar", labelEn: "Try again", event: "seeds.switch", arg: "toast" });

  const off = accountWorld({ seeds: POOL, routes: goodRoutes({ "v8/active": new Error("offline") }), storageExtra: { region: { blocked: true } } });
  assert.equal((await screenHarness(off).send("seeds.switch")).raw.toast.text, "Sin conexión, reintenta");

  const acct = await worldIn("ownHeld");
  const ha = screenHarness(acct);
  ha.state.tab = "connection";
  const t = await ha.render();
  assert.equal(byKey(t.tree, "switchSeed").enabled, false, "an account does not use seeds: the buttons say so");
  assert.equal(byKey(t.tree, "refreshSeeds").enabled, false);
  assert.ok(byKey(t.tree, "accountNoSeeds"));
  assert.equal((await ha.send("seeds.switch")).raw.toast.text, "Tu cuenta no usa semillas");
});

test("a toast's retry has no press budget: the old handler is capped at 17 s (E1); a press keeps the old 22-25 s", async () => {
  const calls = [];
  const w = accountWorld();
  const fake = { ...w.settings, action: async (key, opts) => { calls.push([key, opts && opts.totalMs]); return { message: "x", refresh: true }; } };
  const h = screenHarness(w, { deps: () => ({ settings: fake, session: w.session, registration: w.registration }) });
  await h.send("seeds.switch");
  await h.send("seeds.switch", { arg: "toast" });
  await h.send("account.retry");
  await h.send("account.retry", { arg: "toast" });
  assert.deepEqual(calls, [["switchSeed", undefined], ["switchSeed", TOAST_PRESS_MS], ["login", undefined], ["login", TOAST_PRESS_MS]]);
});

test("Actualizar semillas: tells a dead network from a bad file, and counts the usable seeds", async () => {
  const fresh = JSON.stringify(POOL);
  const ok = accountWorld({ seedsAnswer: () => ({ ok: true, status: 200, text: () => fresh }), storageExtra: { region: { blocked: true } } });
  const h = screenHarness(ok);
  const r = await h.send("seeds.refresh");
  assert.equal(r.raw.toast.text, "3 semillas cargadas, 3 utilizables");
  h.state.tab = "connection";
  const t = await h.render();
  assert.equal(byKey(t.tree, "seedsRow").subtitle, "3 utilizables de 3");
  assert.equal(typeof byKey(t.tree, "seedsAt").time, "number");
  // Pressed again within 10 s: no second download, the old answer.
  const again = await h.send("seeds.refresh");
  assert.equal(again.raw.toast.text, "3 semillas cargadas");
  assert.equal(ok.seedDownloads.length, 1);

  const offline = accountWorld({ seedsAnswer: () => { throw new Error("offline"); } });
  assert.equal((await screenHarness(offline).send("seeds.refresh")).raw.toast.text, "Sin conexión, reintenta");
  const http = accountWorld({ seeds: POOL, seedsAnswer: () => ({ ok: false, status: 404, text: () => "" }) });
  const rh = await screenHarness(http).send("seeds.refresh");
  assert.equal(rh.raw.toast.text, "El archivo de semillas no llegó bien; inténtalo más tarde.", "never '3 semillas cargadas' after a failed download");
  assert.equal(rh.raw.toast.role, "error");
});

test("a blocked region with no usable seed: the warning is derived from storage (it survives a restart) and offers the download", async () => {
  const nowS = Math.floor(5_000_000 / 1000);
  const expiring = POOL.map((s) => ({ ...s, exp: nowS + 30 }));
  const h = screenHarness(accountWorld({ seeds: expiring, storageExtra: { region: { blocked: true } } }));
  h.state.tab = "connection";
  const t = await h.render();
  const b = byKey(t.tree, "noSeedsBanner");
  assert.equal(b.role, "warning");
  assert.equal(b.action.onTap.event.name, "seeds.refresh");
  assert.equal(byKey(t.tree, "seedsRow").subtitle, "0 utilizables de 3", "never '3 semillas cargadas' when none works");
  assert.equal(byKey(t.tree, "regionRow").trailing.text, "Bloqueada");
});

test("the contribution: Kino's own toggle, the last contribution's time, what is shared; a line when it never ran", async () => {
  const h = screenHarness(accountWorld({ storageExtra: { seedContribAt: "4990000" } }));
  h.state.tab = "connection";
  let t = await h.render();
  assert.ok(byKey(t.tree, "contribForm"));
  assert.equal(byKey(t.tree, "contribAt").time, 4_990_000);
  assert.ok(byKey(t.tree, "contribWhat"));
  const n = screenHarness(accountWorld());
  n.state.tab = "connection";
  t = await n.render();
  assert.equal(byKey(t.tree, "contribAt").text, "Este aparato aún no ha aportado.");
});

// ---- create an account ----------------------------------------------------------------------------------------------

test("create an account: Kino's steps, the code sent to what was typed, confirmed on this device; it becomes THE account", async () => {
  const w = accountWorld();
  const h = screenHarness(w);
  await h.send("go", { arg: "register" });
  let t = await h.render();
  let steps = byKey(t.tree, "regSteps");
  assert.deepEqual(steps.items.map((i) => i.state), ["current", "pending", "pending"]);
  assert.equal(byKey(t.tree, "regEmailForm").onSubmit.timeoutMs, PRESS_MS);
  const sent = await h.send("reg.send", { value: { regEmailInput: " " + EMAIL } });
  assert.deepEqual(sent.raw.config, { regEmail: EMAIL });
  assert.equal(sent.raw.toast.text, "Enviamos un código a " + maskEmail(EMAIL) + ".");
  assert.deepEqual(w.paths(), ["v3/snToken", "v8/active", "v2/sendEmailVerifyCode"]);
  t = await h.render();
  steps = byKey(t.tree, "regSteps");
  assert.deepEqual(steps.items.map((i) => i.state), ["done", "current", "pending"]);
  assert.equal(steps.items[0].summary, maskEmail(EMAIL));
  assert.equal(byKey(t.tree, "resendIn").timeFormat, "countdown");
  assert.equal(byKey(t.tree, "regPw").secret, true);
  const done = await h.send("reg.confirm", { value: { regCode: " " + CODE + " ", regPw: PW } });
  assert.deepEqual(done.raw.config, { email: EMAIL, password: PW, regEmail: null, regPassword: null, verifyCode: null });
  assert.equal(done.raw.toast.text, "Cuenta creada y sesión iniciada");
  assert.equal(w.requests.find((r) => r.path === "v2/validateVerifyCode").bean.verifyCode, CODE);
  assert.equal(w.session.accountState(), "held", "signed in with the new account, read from the sign-in pair");
  t = await h.render();
  assert.equal(byKey(t.tree, "regDone").role, "success");
  await h.send("reg.finish");
  assert.equal(h.route(), "main");
  assert.equal(byKey((await h.render()).tree, "accountTile").subtitle, "Conectado");
  assertNoSecrets([...h.seen.trees, ...h.seen.toasts]);
});

test("create an account: the resend waits a minute (Kino turns the button on by itself) and says the old code stops working", async () => {
  const w = accountWorld();
  const h = screenHarness(w);
  h.push("register");
  await h.send("reg.send", { value: { regEmailInput: EMAIL } });
  const t = await h.render();
  const resend = byKey(t.tree, "regResend");
  assert.equal(resend.enabledAt, h.state.reg.sentAt + 60_000);
  assert.equal(resend.confirm, "El código anterior deja de valer. ¿Enviar otro?");
  assert.equal(resend.onTap.timeoutMs, PRESS_MS);
  assert.equal(byKey(t.tree, "resendIn").time, h.state.reg.sentAt + 60_000);
  // Pressed early anyway (a device clock behind): the old guard answers and mints nothing.
  const early = await h.send("reg.resend");
  assert.equal(early.raw.toast.text, "Ya te enviamos un código; espera un minuto antes de pedir otro");
  assert.equal(w.requests.length, 3);
  w.clock.t += 61_000;
  const again = await h.send("reg.resend");
  assert.equal(again.raw.toast.text, "Te enviamos otro código; el anterior ya no vale.");
  assert.equal(w.requests.length, 6, "a new temporary device, as the old button");
});

test("create an account: bound but not signed in, a refused code, a code from another device, a send that fails", async () => {
  const bound = accountWorld({ routes: goodRoutes({ "v8/login": refuse() }) });
  const hb = screenHarness(bound);
  hb.push("register");
  await hb.send("reg.send", { value: { regEmailInput: EMAIL } });
  const rb = await hb.send("reg.confirm", { value: { regCode: CODE, regPw: PW } });
  assert.deepEqual(rb.raw.config, { email: EMAIL, password: PW, regEmail: null, regPassword: null, verifyCode: null });
  assert.equal(rb.raw.toast.text, "Cuenta creada. La sesión se inicia sola en un momento, o toca Conectar ahora.");
  const tb = await hb.render();
  assert.equal(byKey(tb.tree, "regDone").role, "info");
  assert.ok(byKey(tb.tree, "regConnect"));

  const refused = accountWorld({ routes: goodRoutes({ "v2/validateVerifyCode": refuse() }) });
  const hr = screenHarness(refused);
  hr.push("register");
  await hr.send("reg.send", { value: { regEmailInput: EMAIL } });
  const rr = await hr.send("reg.confirm", { value: { regCode: "000000", regPw: PW } });
  assert.equal(rr.raw.config, undefined);
  const tr = await hr.render();
  assert.match(byKey(tr.tree, "regCode").field.forceError, /no aceptó el código/);
  assert.equal(hr.state.reg.step, "code");

  // The state says a code was sent, but this device holds no pending registration (asked on another device, or expired).
  const other = accountWorld();
  const ho = screenHarness(other);
  ho.push("register");
  ho.state.reg = { step: "code", email: EMAIL, emailMasked: maskEmail(EMAIL), sentAt: other.clock.now() };
  await ho.send("reg.confirm", { value: { regCode: CODE, regPw: PW } });
  const to = await ho.render();
  assert.equal(byKey(to.tree, "regBanner").text, "Pide el código otra vez.");
  assert.equal(byKey(to.tree, "regBanner").action.onTap.event.name, "reg.resend");
  assert.equal(other.requests.length, 0);

  const failing = accountWorld({ routes: goodRoutes({ "v2/sendEmailVerifyCode": refuse() }) });
  const hf = screenHarness(failing);
  hf.push("register");
  const rf = await hf.send("reg.send", { value: { regEmailInput: EMAIL } });
  assert.equal(rf.raw.config, undefined);
  const tf = await hf.render();
  assert.match(byKey(tf.tree, "regEmailInput").field.forceError, /no pudo enviar el código/);
});

test("create an account: a registration under way on this device is picked up again when the page opens", async () => {
  const w = accountWorld({ saved: { regEmail: EMAIL } });
  await w.settings.sendCodeTo(EMAIL);
  const h = screenHarness(w);
  await h.send("go", { arg: "register" });
  assert.equal(h.state.reg.step, "code");
  assert.equal(byKey((await h.render()).tree, "regSteps").items[1].state, "current");
  const fresh = screenHarness(accountWorld({ saved: { regEmail: EMAIL } }));
  await fresh.send("go", { arg: "register" });
  assert.equal(fresh.state.reg.step, "email", "nothing pending on that device: start at the email");
});

test("create an account: a done step pressed goes back to change the email; the last page cannot go back", async () => {
  const h = screenHarness(accountWorld());
  h.push("register");
  await h.send("reg.send", { value: { regEmailInput: EMAIL } });
  assert.equal((await h.send("reg.back", { arg: "email" })).raw.state.reg.step, "email");
  h.state.reg = { step: "done", loggedIn: true };
  assert.equal((await h.send("reg.back", { arg: "email" })).raw, null);
});

// ---- press budgets, config, hostile inputs, privacy ---------------------------------------------------------------------

test("every press that reaches the network carries Kino's 30 s press budget (the old 25 s bounds fit inside it)", async () => {
  const network = new Set(["account.retry", "account.logout", "seeds.switch", "seeds.refresh", "signin.submit", "reg.send", "reg.resend", "reg.confirm"]);
  const found = new Set();
  const check = (tree) => {
    for (const n of allNodes(tree)) {
      for (const a of [n.onTap, n.onSubmit, n.action && n.action.onTap].filter(Boolean)) {
        if (a.event && network.has(a.event.name)) { assert.equal(a.timeoutMs, PRESS_MS, `${n.key} ${a.event.name}`); found.add(a.event.name); }
      }
    }
  };
  for (const name of STATES) {
    const w = await worldIn(name);
    const h = screenHarness(w);
    for (const r of Object.values(await tabs(h))) check(r.tree);
    h.push("signin"); check((await h.render()).tree);
    h.push("register");
    for (const step of ["email", "code", "done"]) { h.state.reg = { step, email: EMAIL, emailMasked: "x", sentAt: 1, loggedIn: false }; check((await h.render()).tree); }
  }
  for (const e of network) assert.ok(found.has(e), `${e} is reached from a press`);
});

test("config only ever names declared settings, with values of their type; the screen never writes a code", async () => {
  const types = Object.fromEntries(SETTINGS.map((s) => [s.key, s.type]));
  const flows = [];
  const w = accountWorld();
  const h = screenHarness(w);
  flows.push(await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } }));
  flows.push(await h.send("shared.change", { value: false }));
  flows.push(await h.send("account.logout"));
  h.push("register");
  flows.push(await h.send("reg.send", { value: { regEmailInput: EMAIL } }));
  flows.push(await h.send("reg.confirm", { value: { regCode: CODE, regPw: PW } }));
  flows.push(await h.send("shared.off"));
  let n = 0;
  for (const f of flows) {
    for (const [k, v] of Object.entries(f.raw.config || {})) {
      n++;
      assert.ok(["text", "password", "toggle", "select"].includes(types[k]), k);
      if (types[k] === "toggle") assert.equal(typeof v, "boolean", k);
      else assert.ok(v === null || typeof v === "string", k);
      if (k === "verifyCode") assert.equal(v, null, "a code is never written, only emptied");
    }
  }
  assert.ok(n >= 12, String(n));
});

test("hostile inputs: odd values, arguments and states never crash a call and never reach the portal", async () => {
  const w = accountWorld();
  const h = screenHarness(w);
  const odd = [null, 42, "x".repeat(5000), { regEmailInput: { a: 1 } }, ["a"], { signinEmail: "‮evil@x.test", signinPw: "" }, { regCode: "1", regPw: "" }];
  for (const name of ["signin.submit", "reg.send", "reg.confirm", "tab", "go", "reg.back", "saved", "dismiss", "nope", "__proto__", "constructor", "hasOwnProperty"]) {
    for (const value of odd) {
      const r = await h.send(name, { value, arg: typeof value === "string" ? value : undefined });
      assert.ok(r.raw === null || typeof r.raw === "object", name);
    }
  }
  const saved = { ...h.state };
  h.state = { ...saved, reg: "garbage", signin: 7, tab: { x: 1 }, sharedError: 5, notice: [1], seedsBanner: "z" };
  for (const page of ["main", "signin", "register"]) {
    if (page !== "main") h.push(page);
    assert.deepEqual((await h.render()).dropped, [], page);
  }
  assert.equal(w.requests.length, 0);
  assert.equal(await h.ui.screenEvent(null), null);
  assert.equal(await h.ui.screenEvent({ name: "toString" }), null);
});

test("the diagnostics carry no email, session, token or device number; copying is offered only where a clipboard works", async () => {
  for (const device of DEVICES) {
    const w = await worldIn("ownHeld");
    const h = screenHarness(w, { device });
    h.state.tab = "more";
    const t = await h.render();
    const copy = byKey(t.tree, "copyDiag");
    assert.deepEqual(copy.devices, ["phone", "desktop"]);
    const text = copy.onTap.go.copy.text;
    assert.ok(text.split("\n").length <= 6 && text.length <= 500);
    assert.match(text, /Versión del plugin/);
    assertNoSecrets([text, ...h.seen.trees]);
    assert.ok(byKey(t.tree, "diagTable"));
  }
});

test("no log line written while the screen runs carries the email, the password or a token", async () => {
  const w = accountWorld();
  const h = screenHarness(w);
  await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
  h.push("register");
  await h.send("reg.send", { value: { regEmailInput: "otra@ejemplo.test" } });
  await h.send("reg.confirm", { value: { regCode: CODE, regPw: PW } });
  await h.send("account.logout");
  assertNoSecrets([...w.logs, ...h.seen.toasts], ["otra@ejemplo.test"]);
});

test("in English the screen's own texts and the old sentences come in English", async () => {
  const w = accountWorld({ lang: "en-US", routes: goodRoutes({ "v8/login": refuse() }) });
  const h = screenHarness(w, { lang: "en" });
  const r = await h.render();
  assert.equal(byKey(r.tree, "anonBanner").text, "No account: you use an anonymous session. Movies and series work; some live channels need an account.");
  h.push("signin");
  await h.send("signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } });
  const t = await h.render();
  assert.equal(byKey(t.tree, "signinPw").field.forceError, "Xuper did not accept these sign-in details");
});

test("a portal that never answers: each flow ends inside the old bounds (25 s, well inside the 30 s press) and says so", async () => {
  // A black hole: every request spends its whole timeout on the injected clock, then fails.
  const hole = (bean, req, clock) => { clock.t += req.timeoutMs; return new Error("timeout"); };
  const routes = goodRoutes(Object.fromEntries(["v3/snToken", "v8/active", "v8/login", "v2/sendEmailVerifyCode", "v2/validateVerifyCode", "v5/loginOut"].map((p) => [p, hole])));
  const cases = [
    ["reg.send", { value: { regEmailInput: EMAIL } }, "register"],
    ["signin.submit", { value: { signinEmail: EMAIL, signinPw: PW } }, "signin"],
    ["account.retry", {}, "main"],
    ["account.logout", {}, "main"],
  ];
  for (const [name, args, page] of cases) {
    const w = accountWorld({ routes, saved: { email: EMAIL, password: PW } });
    const h = screenHarness(w);
    if (page !== "main") h.push(page);
    const t0 = w.clock.now();
    const r = await h.send(name, args);
    assert.ok(w.clock.now() - t0 <= 25_000, `${name}: ${w.clock.now() - t0} ms`);
    assert.ok(r.raw !== null, name);
    const told = r.raw.toast || (r.raw.state && (r.raw.state.signin || r.raw.state.reg));
    assert.ok(told, `${name} tells the person`);
  }
});
