// The configuration screen's trees: a pure view of the screen state and the snapshot (screenModel.js). Every text comes from
// the plugin's catalog in both languages (i18n.js `twin`); no tree ever holds an email, a token, a device number or a
// password. Network work happens only in screenEvents.js, after the person's own press.
import { twin } from "./i18n.js";
import { RESEND_WAIT_MS } from "./screenModel.js";

/** The plugin's version, shown in the diagnostics (kept equal to kino-plugin.json by a test). */
export const PLUGIN_VERSION = "2.2.33";
/** Every network press may take Kino's longest press budget: the old buttons' own bounds (25 s) fit inside it. */
export const PRESS_MS = 30_000;
export const TABS = ["account", "connection", "more"];
export const EMAIL_PATTERN = "^\\s*[^@\\s]+@[^@\\s]+\\.[^@\\s]+\\s*$";
export const CODE_PATTERN = "^\\s*[0-9A-Za-z]{4,12}\\s*$";

const text = (key, extra = {}, vars) => ({ type: "Text", ...twin(key, "text", vars), ...extra });
const press = (event, arg) => ({ event, ...(arg !== undefined ? { arg } : {}), timeoutMs: PRESS_MS });
const errorOf = (msg) => (typeof msg === "string" && msg !== "" ? { forceErrorText: msg.slice(0, 200) } : {});
const banner = (b, key) => (b && typeof b.text === "string" && b.text !== ""
  ? [{ type: "MaterialBanner", key, role: ["info", "warning", "error", "success"].includes(b.role) ? b.role : "info", text: b.text.slice(0, 2000),
    ...(typeof b.textEn === "string" ? { textEn: b.textEn.slice(0, 2000) } : {}),
    ...(b.action ? { action: b.action } : {}) }]
  : []);
const caption = (key, extra = {}, vars) => text(key, { style: "caption", color: "muted", ...extra }, vars);
const section = (key) => text(key, { style: "h4" });

// ---- the main page: three tabs ------------------------------------------------------------------------------------

function accountTab(s, st) {
  const out = [];
  const conflict = st.sharedError ? { ...errorOf(st.sharedError) } : {};
  if (s.ownConfigured) {
    const stateKey = s.accountState === "held" ? "scrAccHeld" : s.accountState === "refused" ? "scrAccRefused" : "scrAccPending";
    out.push({ type: "Card", key: "accountCard", children: [
      { type: "ListTile", key: "accountTile", title: s.emailMasked || "•••", ...twin(stateKey, "subtitle"),
        leading: { type: "CircleAvatar", text: s.initial } },
      ...(s.accountState === "refused" ? [{ type: "MaterialBanner", key: "refusedBanner", role: "error", ...twin("scrRefusedBanner"),
        action: { ...twin("scrRetry", "label"), onTap: press("account.retry") } }] : []),
      { type: "Row", wrap: true, gap: 8, children: [
        ...(s.accountState !== "held" ? [{ type: "ElevatedButton", key: "connectNow", ...twin("scrConnectNow", "labelText"), icon: "sync", onPressed: press("account.retry"), autofocus: true }] : []),
        { type: "Button", variant: "secondary", key: "changeAccount", ...twin("scrChangeAccount", "labelText"), icon: "person", onPressed: { event: "go", arg: "signin" } },
        { type: "TextButton", key: "signOut", ...twin("scrSignOut", "labelText"), ...twin("scrSignOutConfirm", "confirm"), onPressed: press("account.logout") },
      ] },
    ] });
  } else {
    if (s.sharedConfigured) {
      const stateKey = s.accountState === "held" ? "scrAccHeld" : s.accountState === "refused" ? "statusSharedBroken" : "scrAccPending";
      out.push({ type: "Card", key: "sharedCard", children: [
        { type: "ListTile", key: "sharedTile", ...twin("statusShared", "title"), ...twin(stateKey, "subtitle"), leading: { type: "CircleAvatar", icon: "language" } },
      ] });
    } else {
      out.push({ type: "MaterialBanner", key: "anonBanner", role: "info", ...twin("scrAnonBanner") });
    }
    out.push({ type: "Card", key: "accountActions", children: [
      { type: "ListTile", key: "goSignIn", ...twin("scrSignIn", "title"), ...twin("scrSignInSub", "subtitle"),
        leading: { type: "CircleAvatar", icon: "person" }, trailing: { type: "Icon", name: "arrow_forward" }, onTap: { event: "go", arg: "signin" }, autofocus: true },
      { type: "ListTile", key: "goRegister", ...twin("scrCreate", "title"), ...twin("scrCreateSub", "subtitle"),
        leading: { type: "CircleAvatar", icon: "add" }, trailing: { type: "Icon", name: "arrow_forward" }, onTap: { event: "go", arg: "register" } },
    ] });
  }
  out.push({ type: "Card", key: "sharedSwitchCard", children: [
    { type: "Switch", key: "sharedSwitch", ...twin("scrSharedSwitch", "labelText"), value: s.sharedToggle, onChanged: "shared.change", ...conflict },
    caption("scrSharedHint"),
    ...(s.ownConfigured && !s.sharedToggle ? [caption("scrSharedOwnFirst")] : []),
  ] });
  return out;
}

function connectionTab(s, st) {
  const sessionKey = s.account ? (s.usingShared ? "statusShared" : "scrSessionAccount")
    : s.kind === "seed" ? "scrSessionSeed" : s.kind === "own" ? "scrSessionAnon" : "scrSessionNone";
  const statusCard = { type: "Card", key: "statusCard", children: [
    section("scrStatusCard"),
    { type: "ListTile", key: "regionRow", ...twin("scrRegion", "title"), leading: { type: "Icon", name: "language" },
      trailing: { type: "Badge", ...twin(s.regionBlocked ? "scrRegionBlocked" : "scrRegionFree") } },
    { type: "ListTile", key: "sessionRow", ...twin("scrSession", "title"), ...twin(sessionKey, "subtitle"), leading: { type: "Icon", name: "sync" } },
    { type: "ListTile", key: "seedsRow", ...twin("scrSeedsRow", "title"), ...twin("scrSeedsCount", "subtitle", { usable: s.usable, pool: s.pool }),
      leading: { type: "Icon", name: "list" } },
    s.seedsAt ? caption("scrSeedsUpdated", { key: "seedsAt", time: s.seedsAt }) : caption("scrSeedsNever", { key: "seedsAt" }),
  ] };
  const out = [statusCard];
  if (s.exhausted) {
    out.push({ type: "MaterialBanner", key: "noSeedsBanner", role: "warning", ...twin("scrNoSeedsBanner"),
      action: { ...twin("scrUpdateSeeds", "label"), onTap: press("seeds.refresh") } });
  }
  out.push(...banner(st.seedsBanner, "seedsResult"));
  const noSeeds = s.account;
  out.push({ type: "Card", key: "seedsCard", children: [
    section("scrSeedsTitle"),
    caption("scrSeedsIntro"),
    ...(noSeeds ? [{ type: "MaterialBanner", key: "accountNoSeeds", role: "info", ...twin("scrAccountNoSeeds") }] : []),
    // Kino's own item for the toggle (its label and hint in both languages from the manifest), saved as it changes.
    { type: "settings", key: "autoRefreshForm", keys: ["autoRefreshSeeds"], autoSave: true, onSaved: "saved" },
    caption("scrAutoHelp"),
    { type: "Row", wrap: true, gap: 8, children: [
      { type: "ElevatedButton", key: "switchSeed", ...twin("scrChangeSeed", "labelText"), icon: "refresh", enabled: !noSeeds,
        ...twin("scrChangeSeedHint", "tooltip"), onPressed: press("seeds.switch") },
      { type: "Button", variant: "secondary", key: "refreshSeeds", ...twin("scrUpdateSeeds", "labelText"), icon: "download", enabled: !noSeeds,
        ...twin("scrUpdateSeedsHint", "tooltip"), onPressed: press("seeds.refresh") },
    ] },
    caption("scrChangeSeedHint"),
    caption("scrUpdateSeedsHint"),
  ] });
  out.push({ type: "Card", key: "contribCard", children: [
    section("scrContribTitle"),
    { type: "settings", key: "contribForm", keys: ["contributeSeeds"], autoSave: true, onSaved: "saved" },
    caption("scrContribHelp"),
    s.contribAt ? caption("scrContribLast", { key: "contribAt", time: s.contribAt }) : caption("scrContribNever", { key: "contribAt" }),
    { type: "ExpansionTile", key: "contribWhat", items: [{ key: "what", ...twin("scrContribWhatTitle", "title"), children: [text("scrContribWhat")] }] },
  ] });
  return out;
}

/** The diagnostics, the same lines on the screen and in the copied text: no email, session, token or device number. */
export function diagnosticRows(s, { device, appVersion }) {
  const on = (b) => (b ? ["Activado", "On"] : ["Desactivado", "Off"]);
  const accountWord = s.ownConfigured ? (s.accountState === "held" ? ["propia, conectada", "own, signed in"]
    : s.accountState === "refused" ? ["propia, no aceptada", "own, not accepted"] : ["propia, conectando", "own, connecting"])
    : s.sharedConfigured ? (s.accountState === "held" ? ["compartida, conectada", "shared, signed in"] : ["compartida, sin conexión", "shared, not signed in"])
      : ["ninguna", "none"];
  const sessionWord = { account: ["cuenta", "account"], seed: ["semilla", "seed"], own: ["anónima", "anonymous"], none: ["ninguna", "none"] }[s.kind] || ["?", "?"];
  return [
    ["scrDiagPlugin", [PLUGIN_VERSION, PLUGIN_VERSION]],
    ["scrDiagKino", [appVersion || "?", appVersion || "?"]],
    ["scrDiagDevice", [device === "tv" ? "televisor" : device === "desktop" ? "computador" : "teléfono", device === "tv" ? "TV" : device === "desktop" ? "desktop" : "phone"]],
    ["scrTabAccount", accountWord],
    ["scrSession", sessionWord],
    ["scrRegion", s.regionBlocked ? ["bloqueada", "blocked"] : ["libre", "open"]],
    ["scrSeedsRow", [`${s.usable}/${s.pool}`, `${s.usable}/${s.pool}`]],
    ["seedsAuto", on(s.auto)],
    ["scrContribTitle", on(s.contribOn)],
  ];
}

const DIAG_LABELS = { seedsAuto: ["Actualización automática", "Automatic update"] };
const labelOf = (key, i) => (DIAG_LABELS[key] ? DIAG_LABELS[key][i] : twin(key, "t")[i === 0 ? "t" : "tEn"]);

/** The copied diagnostics, in the person's language (6 lines at most: Kino's copy limit). */
export function diagnosticText(s, ctx, lang) {
  const i = lang === "en" ? 1 : 0;
  const rows = diagnosticRows(s, ctx);
  const pairs = rows.map(([k, v]) => `${labelOf(k, i)}: ${v[i]}`);
  // Kino copies at most 6 lines: the rows go two by two.
  const lines = [];
  for (let n = 0; n < pairs.length; n += 2) lines.push(pairs.slice(n, n + 2).join(" · "));
  return lines.slice(0, 6).join("\n").slice(0, 500);
}

function moreTab(s, ctx) {
  const { device, appVersion, lang } = ctx;
  const faq = [["anon", "scrFaqAnonQ", "scrFaqAnonA"], ["seeds", "scrFaqSeedsQ", "scrFaqSeedsA"], ["shared", "scrFaqSharedQ", "scrFaqSharedA"],
    ["contrib", "scrContribWhatTitle", "scrContribWhat"], ["sync", "scrFaqSyncQ", "scrFaqSyncA"]];
  const rows = diagnosticRows(s, ctx).map(([k, v], n) => ({ type: "TableRow", key: "diag" + n, children: [
    { type: "TableCell", ...(DIAG_LABELS[k] ? { text: DIAG_LABELS[k][0], textEn: DIAG_LABELS[k][1] } : twin(k)) },
    { type: "TableCell", text: v[0], textEn: v[1] },
  ] }));
  return [
    { type: "Card", key: "homeCard", children: [
      section("scrHomeTitle"),
      caption("scrHomeHint"),
      // Kino's own select (the same 19 options, their English names from the manifest), saved as it changes.
      { type: "settings", key: "homeForm", keys: ["homeCountry"], autoSave: true, onSaved: "saved" },
    ] },
    { type: "Card", key: "faqCard", children: [
      section("scrFaqTitle"),
      { type: "ExpansionTile", key: "faq", items: faq.map(([key, q, a]) => ({ key, ...twin(q, "title"), children: [text(a)] })) },
    ] },
    { type: "Card", key: "diagCard", children: [
      section("scrDiagTitle"),
      { type: "DataTable", key: "diagTable", columns: [{ flex: 2 }, { flex: 3 }], wrap: true, zebra: true, children: rows },
      caption("scrDiagNoPersonal"),
      { type: "Button", variant: "secondary", key: "copyDiag", icon: "copy", ...twin("scrCopyDiag", "labelText"), devices: ["phone", "desktop"],
        onPressed: { go: { copy: { text: diagnosticText(s, { device, appVersion }, lang), label: twin("scrDiagTitle", "t")[lang === "en" ? "tEn" : "t"] } } } },
    ] },
  ];
}

function mainPage(s, st, ctx) {
  const tab = TABS.includes(st.tab) ? st.tab : "account";
  const body = tab === "connection" ? connectionTab(s, st) : tab === "more" ? moreTab(s, ctx) : accountTab(s, st);
  return {
    type: "Scaffold",
    appBar: {
      type: "AppBar", ...twin("scrTitle", "title"),
      actions: [
        { type: "IconButton", key: "refreshStatus", icon: "refresh", ...twin("scrRefresh", "labelText"), ...twin("scrRefresh", "tooltip"), onPressed: "refresh" },
        { type: "IconButton", key: "helpButton", icon: "help", ...twin("scrHelp", "labelText"), ...twin("scrHelp", "tooltip"), onPressed: { event: "tab", arg: "more" } },
      ],
      bottom: { type: "TabBar", key: "tabs", value: tab, onChanged: "tab", tabs: [
        { value: "account", ...twin("scrTabAccount", "label") },
        { value: "connection", ...twin("scrTabConnection", "label") },
        { value: "more", ...twin("scrTabMore", "label") },
      ] },
    },
    body: { type: "SingleChildScrollView", key: tab + "Body", children: [
      { type: "Column", padding: { compact: 16, expanded: 24 }, gap: 12, children: [...banner(st.notice, "notice"), ...body] },
    ] },
    // A sign-in that has not happened yet (credentials that arrived by sync, a background login): re-read every 15 s, no
    // network, until it settles.
    ...(s.accountState === "pending" ? { every: { ms: 15_000, event: "tick" } } : {}),
  };
}

// ---- the sign-in page ---------------------------------------------------------------------------------------------

function signInPage(s, st) {
  const si = st.signin || {};
  return { type: "SingleChildScrollView", key: "signinBody", children: [{ type: "Column", padding: { compact: 16, expanded: 32 }, gap: 12, children: [
    text("scrSignInTitle", { style: "h3" }),
    caption("scrSignInCaption"),
    ...banner(si.banner, "signinBanner"),
    { type: "Form", key: "signinForm", onSubmitted: press("signin.submit"), gap: 12, children: [
      { type: "TextField", key: "signinEmail", kind: "email", ...twin("scrEmailLabel", "labelText"), required: true, maxLength: 200,
        pattern: EMAIL_PATTERN, ...twin("scrEmailError", "errorText"), ...errorOf(si.emailError), autofocus: true },
      { type: "TextField", key: "signinPw", obscureText: true, ...twin("scrPasswordLabel", "labelText"), required: true, maxLength: 500,
        ...twin("scrPasswordError", "errorText"), ...errorOf(si.pwError) },
      { type: "ElevatedButton", key: "signinSubmit", ...twin("scrSignIn", "labelText"), icon: "person", submit: true },
    ] },
    ...(si.unchecked ? [{ type: "TextButton", key: "saveUnchecked", ...twin("scrSaveUnchecked", "labelText"), onPressed: { event: "signin.saveUnchecked" } }] : []),
    ...(s.sharedToggle ? [caption("scrSharedOwnFirst")] : []),
  ] }] };
}

// ---- the registration page: Kino's steps --------------------------------------------------------------------------

export const REG_STEPS = ["email", "code", "done"];

function registerPage(s, st, ctx) {
  const r = st.reg || {};
  const step = REG_STEPS.includes(r.step) ? r.step : "email";
  const at = REG_STEPS.indexOf(step);
  const errors = r.errors || {};
  const masked = r.emailMasked || "";
  const stateOf = (k) => { const i = REG_STEPS.indexOf(k); return i < at ? "done" : i === at ? "current" : "pending"; };
  const emailStep = [
    caption("scrRegTvNote", { devices: ["tv"] }),
    ...banner(r.banner, "regBanner"),
    { type: "Form", key: "regEmailForm", onSubmitted: press("reg.send"), gap: 12, children: [
      { type: "TextField", key: "regEmailInput", kind: "email", ...twin("scrEmailLabel", "labelText"), required: true, maxLength: 200,
        pattern: EMAIL_PATTERN, ...twin("scrEmailError", "errorText"), ...errorOf(errors.email), autofocus: true },
      { type: "ElevatedButton", key: "regSend", ...twin("scrSendCode", "labelText"), icon: "send", submit: true },
    ] },
  ];
  const resendAt = typeof r.sentAt === "number" ? r.sentAt + RESEND_WAIT_MS : 0;
  const codeStep = [
    text("scrCodeSentTo", {}, { email: masked }),
    ...(typeof r.sentAt === "number" ? [caption("scrSentAt", { key: "sentAt", time: r.sentAt })] : []),
    caption("scrCodeRules"),
    ...banner(r.banner, "regBanner"),
    { type: "Form", key: "regCodeForm", onSubmitted: press("reg.confirm"), gap: 12, children: [
      { type: "TextField", key: "regCode", kind: "text", ...twin("scrCodeLabel", "labelText"), required: true, maxLength: 40,
        pattern: CODE_PATTERN, ...twin("scrCodeError", "errorText"), ...errorOf(errors.code), autofocus: true },
      { type: "TextField", key: "regPw", obscureText: true, ...twin("scrNewPassword", "labelText"), required: true, maxLength: 500,
        ...twin("scrPasswordError", "errorText"), ...errorOf(errors.pw) },
      { type: "ElevatedButton", key: "regConfirm", ...twin("scrCreateButton", "labelText"), icon: "check", submit: true },
    ] },
    { type: "Row", wrap: true, gap: 8, crossAxisAlignment: "center", children: [
      { type: "TextButton", key: "regResend", ...twin("scrResend", "labelText"), ...twin("scrResendConfirm", "confirm"),
        ...(resendAt > 0 ? { enabledAt: resendAt } : {}), onPressed: press("reg.resend") },
      ...(resendAt > ctx.now ? [caption("scrResendIn", { key: "resendIn", time: resendAt, timeFormat: "countdown" })] : []),
      { type: "TextButton", key: "regChangeEmail", ...twin("scrChangeEmail", "labelText"), onPressed: { event: "reg.back", arg: "email" } },
    ] },
  ];
  const doneStep = [
    r.loggedIn === false
      ? { type: "MaterialBanner", key: "regDone", role: "info", ...twin("scrCreatedPending") }
      : { type: "MaterialBanner", key: "regDone", role: "success", ...twin("accountCreatedSignedIn") },
    { type: "Row", wrap: true, gap: 8, children: [
      ...(r.loggedIn === false ? [{ type: "ElevatedButton", key: "regConnect", ...twin("scrConnectNow", "labelText"), icon: "sync", onPressed: press("account.retry") }] : []),
      { type: "Button", variant: r.loggedIn === false ? "secondary" : "primary", key: "regFinish", ...twin("scrBack", "labelText"), onPressed: "reg.finish", autofocus: true },
    ] },
  ];
  const children = { email: emailStep, code: codeStep, done: doneStep };
  const titles = { email: "scrStepEmail", code: "scrStepCode", done: "scrStepDone" };
  return { type: "SingleChildScrollView", key: "registerBody", children: [{ type: "Column", padding: { compact: 16, expanded: 32 }, gap: 12, children: [
    text("scrCreate", { style: "h3" }),
    { type: "steps", key: "regSteps", onStepTap: "reg.back", items: REG_STEPS.map((k) => ({
      key: k, ...twin(titles[k], "title"), state: stateOf(k),
      ...(k === "email" && at > 0 && masked ? { subtitle: masked, subtitleEn: masked } : {}),
      ...(k === step ? { children: children[k] } : {}),
    })) },
  ] }] };
}

// ---- an older screen kit: Kino's own form, nothing else -----------------------------------------------------------

function classicPage() {
  return { type: "SingleChildScrollView", key: "classicBody", children: [{ type: "Column", padding: 16, gap: 12, children: [
    caption("scrClassicNote"),
    { type: "settings", key: "classicForm" },
  ] }] };
}

/**
 * The tree for `route` and the screen state. `modern` is false on a Kino whose screen kit lacks what this screen needs
 * (secret fields, steps, press budgets): there the screen is Kino's own settings form, exactly the old one.
 */
export function view({ s, state, route, modern, device, appVersion, lang, now }) {
  const st = state && typeof state === "object" ? state : {};
  if (!modern) return classicPage();
  const name = route && typeof route.name === "string" ? route.name : "main";
  const ctx = { device, appVersion, lang, now };
  if (name === "signin") return signInPage(s, st);
  if (name === "register") return registerPage(s, st, ctx);
  return mainPage(s, st, ctx);
}
