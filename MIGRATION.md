# Migración Xuper: del nativo al plugin

**Worktree activo:** `feat/xuper-plain-plugin`  
**Ruta local del worktree:** `/Users/cristian/kino-light/.claude/worktrees/xuper-plain-plugin/`  
**Plugin (este repo):** `/Users/cristian/kino-upload/kino-plugin-xuper/`  
**SDK / docs de plugins:** `/Users/cristian/kino-upload/kino-plugins/`

---

## Fases de migración (resumen ejecutivo)

| Fase | Estado | Qué hace |
|------|--------|----------|
| 1 | ✅ Completa | Plugin hashea contraseña; nativo hace el HTTP de login vía `kino.xuper.login` |
| 2 | 🔴 Pendiente | Nativo expone primitivos de crypto + config; plugin hace el HTTP de login directamente |
| 3 | 🔴 Pendiente | Plugin maneja device minting (sesión anónima autónoma) |
| 4 | 🔴 Pendiente | Plugin maneja `backupSessions` y fallback account |
| 5 | 🔴 Pendiente | Limpieza: retirar todos los bridges de Fase 1 |

El catálogo y los streams (`kino.xuper.search/home/browse/episodes/resolve`) **no se migran** — dependen de código nativo complejo (`MagisCatalog`, `MagisPlayback`) que no tiene equivalente en JS.

---

## 1. Arquitectura del sistema de plugins

### 1.1 Pipeline JS ↔ Kotlin

```
plugin.js  (QuickJS sandbox)
  └── kino.*  ←→  __kinoNative (bridge)  ←→  PluginHost (Kotlin interface)
                                                ├── DefaultPluginHost
                                                │     todos los plugins: fetch, storage, config,
                                                │     cookies, crypto, secret, sleep
                                                └── DefaultPrivilegedXuperHost
                                                      DefaultPluginHost by delegation +
                                                      kino.xuper.* (solo Xuper oficial)
```

- **`PluginRuntime.kt`** — registra funciones en QuickJS con `function(...)` (síncrono) o `asyncFunction(...)` (coroutine suspending). Líneas 579–607.
- **`prelude.js`** — lee `__kinoNative` y construye el objeto `kino`. La sección de `kino.xuper` está en líneas 484–495.

### 1.2 Privilegio Xuper — quién puede usar `kino.xuper.*`

Archivo: `app/src/main/java/com/arkiv/player/data/plugin/XuperPrivilege.kt`

```kotlin
object XuperPrivilege {
    const val SOURCE_REPO   = "xuper-plugin/kino-plugin-xuper"   // repo actual (desde 2026-09-28)
    val LEGACY_SOURCE_REPOS = setOf("kinotvapp/kino-plugin-xuper") // repo anterior (instalaciones viejas)
    val OFFICIAL_REPOS      = setOf(SOURCE_REPO) + LEGACY_SOURCE_REPOS
    const val MANIFEST_ID   = "xuper"

    fun isOfficial(address: String?): Boolean = address in OFFICIAL_REPOS
    fun grants(record: InstalledRecord): Boolean = isOfficial(record.address)
}
```

`grants()` compara la **dirección de instalación** (`InstalledPlugin.record.address`), no el `id` del manifiesto (cualquiera podría poner `"id": "xuper"`). La comparación es exacta — `@branch` y `/subfolder` en la dirección la invalidan.

El gate se aplica en: `pluginHostFor()` (`DefaultPrivilegedXuperHost.kt:109`), `PluginContentSource`, `PluginRegistry.accessFor`.

### 1.3 Envelope estándar de `kino.xuper.*`

Cada función de `kino.xuper.*` devuelve un **objeto JS ya parseado** (el `prelude.js` aplica `parse()` al string JSON nativo):

```js
{ ok: true,  data: <payload> }   // éxito
{ ok: false, code: "auth_required"|"geo_blocked"|"not_found"|"rate_limited"|"unavailable",
             message: "..." }    // error
```

Códigos de error definidos en `app/src/main/java/com/arkiv/player/data/plugin/PluginErrors.kt:9–13`.

### 1.4 Secretos sellados (apiVersion 4+)

`kino.secret("name")` devuelve un marcador opaco. El valor real está sellado con ECIES (X25519 + AES-256-GCM) en `kino-plugin.json` bajo `"secrets"`. La app lo descifra en runtime.

### 1.5 Secretos de tipo cipher-key (NUEVO, apiVersion 6)

Permite usar `kino.crypto.encrypt("des-ede3-ecb", { key: kino.secret("k"), ... })` con una llave sellada. El algoritmo no-AES está bloqueado para secretos normales; solo se permite con secretos tipados `"use": "cipher-key"`.

Formato en manifiesto:
```json
"secrets": {
  "portalKey": { "seal": "kino-sealed:v1:...", "use": "cipher-key", "encoding": "hex" }
}
```

CLI: `node sdk/seal.mjs --use cipher-key --encoding hex` (pide la llave en hex por stdin).

Archivos del worktree con la implementación:
- `plugins/sdk/seal.mjs:109` — `decodeCipherKey(value, encoding)`
- `plugins/sdk/seal.mjs:126` — `sealTyped(value, binding, name, encoding, publicKeyHex)`
- `plugins/sdk/kino-shim.mjs:144,148` — `cipherKeyEncoding()`, `containsCipherKeyMarker()`
- `plugins/sdk/kino-shim.mjs:626` — en `cipher()`: detecta typed keys, permite `des-ede3-*`
- `plugins/sdk/kino-shim.mjs:675` — guard en `hmac()` que rechaza cipher-key markers
- `plugins/sdk/contract.mjs:~194` — validación en `validateManifest()`
- `plugins/sdk/contract.mjs:231` — `hosts:[]` permitido si hay un setting `type:"url"`

---

## 2. El portal Magis: protocolo completo

### 2.1 RemoteCredentials — la fuente de verdad de config

Archivo: `app/src/main/java/com/arkiv/player/data/credentials/RemoteCredentials.kt`

```kotlin
data class RemoteCredentials(
    val activationBlob: String,          // base64 de credentials.enc; la 3DES key se re-resuelve nativamente de aquí
    val iptvHosts: String,               // hosts del portal (separados por coma o similar)
    val iptvAppId: String,               // header "apk:" de las peticiones
    val iptvApkVersion: String,          // header "apkVer:" de las peticiones
    val tmdbApiKey: String,
    val fallbackMagisEmail: String = "", // cuenta de respaldo ("Omitir por ahora")
    val fallbackMagisPassword: String = "",
    val activationCode: String = "",     // código con que se activó; para refresh periódico
    val backupSessions: List<BackupSession> = emptyList(), // sesiones anónimas pre-minteadas para Argentina
)
```

`RemoteCredentialsStore.read()` lo lee.  
`AppGraph.kt:137` — `val credentialsStore: RemoteCredentialsStore by lazy { EncryptedRemoteCredentialsStore(appContext) }`

### 2.2 Cifrado de body (bloqueador de Fase 2)

**Todas** las llamadas al portal usan:
```
body_wire = hex( base64( 3DES-EDE/ECB/PKCS5Padding( UTF-8(json_body) ) ) )
```
La respuesta viene también cifrada. La **llave 3DES nunca está en Java**:

```
credentials.enc (archive.org) → base64 → activationBlob (RemoteCredentials)
    ↓ pasado al constructor de MagisCrypto(activationBlobBase64)
NativeCredentialResolver.magisActivate(blob: ByteArray): Boolean   [JNI, línea 37]
    ↓ resuelve la llave en C++, ligada a la firma APK, la cachea en memoria nativa
NativeCredentialResolver.magisEncryptBody(plain: ByteArray): String [JNI, línea 44]
NativeCredentialResolver.magisDecryptBlob(wire: String): ByteArray  [JNI, línea 51]
```

Una build re-firmada produce llave basura → el portal falla silenciosamente (vacío, sin crash).

Archivos:
- `app/src/main/java/com/arkiv/player/data/magis/MagisCrypto.kt:1–54` — wrapper Kotlin
- `app/src/main/java/com/arkiv/player/data/credentials/NativeCredentialResolver.kt:37,44,51` — JNI

> **⚠️ La llave 3DES NO se puede extraer ni sellar en el plugin.** El mecanismo de cipher-key secrets (§1.5) no aplica aquí. La única alternativa es exponer primitivos nativos: `kino.xuper.portalEncrypt(json)` y `kino.xuper.portalDecrypt(wire)` (ver §5).

### 2.3 Headers HTTP del portal

```
apk:        <iptvAppId>          ← RemoteCredentials.iptvAppId
apkVer:     <iptvApkVersion>     ← RemoteCredentials.iptvApkVersion
spkgVer:    "2025-08-07 05:40:11_36_16_"   ← constante en MagisPortalClient
User-Agent: okhttp/3.12.12
```

URL base: `https://<iptvHost>/api/portalCore/<endpoint>`  
`iptvHosts` puede tener múltiples hosts. `MagisPortalClient` itera sobre ellos con fallback.

Archivo: `app/src/main/java/com/arkiv/player/data/magis/MagisPortalClient.kt`

### 2.4 Device minting (sesión anónima)

```
POST v3/snToken  { <hardware fingerprint, ~20 campos> }
    → snToken (String)

sn = md5( snToken + SNTOKEN_SALT ).lowercase()
    SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"   ← MagisSession.kt:651

POST v8/active  {
    sn, loginType=2, macAddr="02:00:00:00:00:00",
    appLanguage=en, hardwareInfo=ranchu, model=sdk_gphone64_arm64,
    cpu=arm64-v8a, sdkVer=36, ...
}
    → userToken  (sesión anónima)
```

Constantes en `MagisSession.kt:648–655`:
- `SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"`
- `PASSWORD_SALT = "cloudstream"`
- `FIXED_MAC = "02:00:00:00:00:00"`

Hardware fingerprint (~20 campos): `androidId`, `board`, `brand`, `cpuAbi`, `cpuId`, `device`, `diskInfo`, `display`, `etheMac`, `fingerprint`, `gatewayMac`, `hardware`, `host`, `manufacturer`, `ramSize`, `romSize`, `serialNumber`, `tags`, `verId`, `wifiMac`. La mayoría están fijos/emulados con valores aleatorios por device. Ver `MagisSession.hardwareFingerprint()`.

Función principal: `MagisSession.ensureAnonymousWithoutLock()` (buscar por nombre; ~línea 180).

### 2.5 Login con cuenta

```
POST v8/login  {
    accountType: "2",
    userName:    <email>,
    password:    md5( rawPassword + "cloudstream" ),   // PASSWORD_SALT
    type:        "1",
    macAddr:     "02:00:00:00:00:00",                  // FIXED_MAC
    areaCode: "", verificationCode: "", verificationToken: "",
    matadata: "", signdata: "", channel: "default"
}
    → userToken, userId, jwtToken
```

La respuesta se persiste en `store.saveSession(...)` vía `saveFromResponse()` (~línea 568 de `MagisSession.kt`).

### 2.6 Reautenticación automática nativa

`MagisSession.reauthenticate(staleToken)` (~línea 547):
1. Si el token actual ya cambió (otro caller lo renovó) → no-op
2. `store.readAccount()` → si hay cuenta guardada → `loginWithoutLock(email, password)` (con md5)
3. Si no hay cuenta → `ensureAnonymousWithoutLock()` (sesión anónima)

**En Fase 1**, `loginAlreadyHashed` no llama `store.saveAccount()`, así que `reauthenticate` cae siempre al camino anónimo. El plugin detecta el `auth_required` resultante y re-loguea.

### 2.7 Backup sessions (Argentina)

`RemoteCredentials.backupSessions` — lista de sesiones anónimas pre-minteadas para regiones geo-bloqueadas. El nativo las usa como fallback si `ensureAnonymousWithoutLock()` falla por geo-bloqueo. Definido en `BackupSession` (buscar en `credentials/`). En Fase 3, el plugin necesitaría acceder a estas sesiones vía un nuevo primitivo `kino.xuper.portalConfig()`.

### 2.8 Fallback account

`RemoteCredentials.fallbackMagisEmail` / `fallbackMagisPassword` — cuenta de respaldo ("Omitir por ahora" en la pantalla de activación). Gestionada por `MagisAccount.linkFallbackAccount()`. El plugin no la usa directamente — es un mecanismo nativo independiente. En Fase 4 hay que decidir si se expone o se mantiene completamente nativo.

### 2.9 TweakedMd5 (streams en vivo, no afecta migración)

MD5 con constantes K modificadas en índices 42, 45, 54, 62 y schedule distinto en ronda 1. Firma segmentos HLS en vivo. Archivo: `MagisSession.TweakedMd5.kt`. No es necesario para login ni catálogo.

---

## 3. Fase 1 — Implementada

### 3.1 Qué cambia

| Responsabilidad | Antes | Después (Fase 1) |
|---|---|---|
| Hash de contraseña | `MagisSession` con `md5Hex(pw + "cloudstream")` | `plugin.js` con `kino.crypto.hash("md5", pw + "cloudstream")` |
| Login HTTP | `MagisSession.login()` | `kino.xuper.login(email, hashed)` → `loginAlreadyHashed()` |
| Almacenamiento de cuenta | `store.saveAccount(email, password)` | Plugin guarda estado en `kino.storage.set("session","active")` |
| Catálogo / streams | `kino.xuper.*` nativo | Sin cambio |

### 3.2 `plugin.js` — estructura

```js
// kino.crypto.hash es SÍNCRONO (no necesita await)
const hashed = kino.crypto.hash("md5", password + "cloudstream");

// kino.xuper.* devuelven objetos JS ya parseados (prelude.js aplica JSON.parse)
const envelope = await kino.xuper.login(email, hashed);
// → { ok: true, data: null }  o  { ok: false, code: "...", message: "..." }

// withSession: reintenta UNA VEZ si auth_required
async function withSession(fn) {
    try { return await fn(); }
    catch (e) {
        if (e && e.code === "auth_required") { await tryLogin(); return await fn(); }
        throw e;
    }
}
```

Exports implementados: `search`, `home`, `browse`, `episodes`, `resolve`, `settingsStatus`, `action`, `validateSettings`.

`kino-plugin.json` — `hosts:[]` es válido gracias al setting `"type":"url"` (key `portalUrl`). Ver `contract.mjs:231`.

### 3.3 Cambios en Kotlin (worktree)

**`MagisSession.kt:206`** — `loginAlreadyHashed(email, hashedPassword)`
- Igual que `loginWithoutLock` pero usa `hashedPassword` sin aplicar md5
- **No llama `store.saveAccount()`** — el plugin retiene las credenciales

**`PrivilegedXuperHost.kt:23`** — nueva función en la interfaz:
```kotlin
suspend fun xuperLogin(email: String, hashedPassword: String): String
```

**`DefaultPrivilegedXuperHost.kt`**
- Línea 28: `private val session: Lazy<MagisSession>` — nuevo parámetro del constructor
- Línea 98–117: implementación de `xuperLogin` — envelope JSON estándar
- Línea 133: `pluginHostFor()` acepta `session: Lazy<MagisSession>? = null`; hace `checkNotNull(session)` para el host privilegiado

**`PluginRuntime.kt:607`**
```kotlin
asyncFunction("xuperLogin") { args -> host.xuperLogin(args[0] as String, args[1] as String) }
```

**`prelude.js:495`** — dentro del bloque `if (typeof n.xuperSearch === 'function')`:
```js
login: freeze(async function login(email, hashedPassword) {
    await null;
    return parse(await n.xuperLogin(toStr(email), toStr(hashedPassword)));
}),
```

**`AppGraph.kt:990`**
```kotlin
val host = pluginHostFor(plugin, http, storage, config, cookies,
                         magisPluginBridge, secrets, lazy { magisSession })
```

---

## 4. Bloqueadores transversales a Fases 2–4

### 4.1 La llave 3DES no es accesible desde Java (detalle completo)

```
archive.org → credentials.enc
    ↓ base64
RemoteCredentials.activationBlob
    ↓ MagisCrypto(activationBlobBase64) constructor
NativeCredentialResolver.magisActivate(blob)  [JNI]
    ↓ key = f(blob, APK_signature)  — en C++, nunca en Java
    ↓ cachea en native-only memory
magisEncryptBody(plain) / magisDecryptBlob(wire)  [JNI]
```

El blob no ES la llave — es la mitad cifrada. La otra mitad la aporta la firma del APK. Una build re-firmada → llave basura → catálogo vacío silencioso. Diseñado así para anti-piratería.

**Solución para Fase 2:** primitivos nativos `kino.xuper.portalEncrypt/Decrypt` (ver §5.2).

### 4.2 Hosts dinámicos

`RemoteCredentials.iptvHosts` — viene de archive.org, no es constante. El plugin no puede declararlos en `hosts[]` del manifiesto porque no los conoce en tiempo de desarrollo.

**Solución para Fase 2:** primitivo nativo `kino.xuper.portalConfig()` que expone `{host, appId, apkVersion, spkgVer}`.  
El host devuelto por `portalConfig` necesita una excepción en `PluginHttp` para que `kino.fetch` lo pueda usar sin estar en `hosts[]` — o se puede declarar `"masnew.xyz"` (o el dominio base) directamente en `hosts[]` si es estable. Verificar en `MagisPortalClient.kt`.

### 4.3 `appId` y `apkVersion` dinámicos

Misma fuente que §4.2: `RemoteCredentials.iptvAppId` y `iptvApkVersion`. Se resuelven junto con el host en `kino.xuper.portalConfig()`.

---

## 5. Fases pendientes (detalle técnico)

### 5.1 Fase 2 — Primitivos de crypto y config en nativo

Agregar a `PrivilegedXuperHost.kt`:
```kotlin
suspend fun xuperPortalEncrypt(plainJson: String): String  // hex(base64(3DES(plain)))
suspend fun xuperPortalDecrypt(wireHex: String): String    // inverso
suspend fun xuperPortalConfig(): String                    // { host, appId, apkVersion, spkgVer }
```

Implementar en `DefaultPrivilegedXuperHost.kt`:
```kotlin
override suspend fun xuperPortalEncrypt(plainJson: String): String =
    withContext(Dispatchers.IO) { magisCrypto.encryptBody(plainJson) }
    // magisCrypto: nueva dependencia Lazy<MagisCrypto> en el constructor

override suspend fun xuperPortalDecrypt(wireHex: String): String =
    withContext(Dispatchers.IO) { magisCrypto.decryptBlob(wireHex) }

override suspend fun xuperPortalConfig(): String = withContext(Dispatchers.IO) {
    val creds = credentialsStore.read()
    JSONObject()
        .put("host",       creds?.iptvHosts?.split(",")?.firstOrNull().orEmpty())
        .put("appId",      creds?.iptvAppId.orEmpty())
        .put("apkVersion", creds?.iptvApkVersion.orEmpty())
        .put("spkgVer",    "2025-08-07 05:40:11_36_16_")  // o leer de MagisPortalClient
        .toString()
}
```

`magisCrypto` y `credentialsStore` deben pasarse como nuevos parámetros `Lazy<>` al constructor de `DefaultPrivilegedXuperHost` y propagarse desde `pluginHostFor()` en `AppGraph.kt`.

Exponer en `PluginRuntime.kt` (bloque `if (host is PrivilegedXuperHost)`):
```kotlin
asyncFunction("xuperPortalEncrypt") { args -> host.xuperPortalEncrypt(args[0] as String) }
asyncFunction("xuperPortalDecrypt") { args -> host.xuperPortalDecrypt(args[0] as String) }
asyncFunction("xuperPortalConfig")  { _ -> host.xuperPortalConfig() }
```

Exponer en `prelude.js` (dentro de `kino.xuper`):
```js
portalEncrypt: freeze(async function(plain) { await null; return parse(await n.xuperPortalEncrypt(toStr(plain))); }),
portalDecrypt: freeze(async function(wire)  { await null; return parse(await n.xuperPortalDecrypt(toStr(wire)));  }),
portalConfig:  freeze(async function()      { await null; return parse(await n.xuperPortalConfig()); }),
```

**Nota:** `portalEncrypt/Decrypt` devuelven strings (no envelopes), pero para uniformidad pueden devolverse como envelopes `{ok, data}`. Hay que decidir el contrato y ser consistente entre nativo y prelude.

### 5.2 Fase 3 — Login HTTP en el plugin

Con los primitivos de Fase 2, `plugin.js` puede hacer el login directamente:

```js
async function tryLogin() {
    const cfg = await kino.xuper.portalConfig();
    const url = `https://${cfg.host}/api/portalCore/v8/login`;
    const email    = kino.config.get("email");
    const password = kino.config.get("password");
    if (!email || !password) throw kino.error("auth_required", "Configura tu cuenta");

    const bean = JSON.stringify({
        accountType: "2", userName: email,
        password: kino.crypto.hash("md5", password + "cloudstream"),
        type: "1", macAddr: "02:00:00:00:00:00",
        areaCode: "", verificationCode: "", verificationToken: "",
        matadata: "", signdata: "", channel: "default",
    });
    const bodyWire = await kino.xuper.portalEncrypt(bean);
    const resp = await kino.fetch(url, {
        method: "POST",
        headers: {
            "apk": cfg.appId, "apkVer": cfg.apkVersion,
            "spkgVer": cfg.spkgVer, "User-Agent": "okhttp/3.12.12",
            "Content-Type": "text/plain",
        },
        body: bodyWire,
    });
    const plain = await kino.xuper.portalDecrypt(resp.body);
    const j = JSON.parse(plain);
    if (!j.userToken) throw kino.error("auth_failed", "Login sin token");
    await kino.storage.set("userToken", j.userToken);
    await kino.storage.set("session", "active");
}
```

**Pendiente de resolver:** El host devuelto por `portalConfig` debe estar en `hosts[]` del manifiesto o ser el valor del setting `portalUrl`. Si el dominio base de `iptvHosts` es estable, se puede hardcodear en `hosts[]`. Si es variable, hay que introducir una excepción en `PluginHttp` para hosts aprobados por `portalConfig`. Verificar en `MagisPortalClient.kt` cuál es el dominio real.

### 5.3 Fase 4 — Device minting en el plugin

El plugin necesita gestionar también la sesión anónima, para no depender del nativo en absoluto para auth:

```js
async function ensureDevice() {
    const sn = await kino.storage.get("device_sn");
    if (sn) return sn;   // ya minteado, reusar

    const cfg = await kino.xuper.portalConfig();
    // 1. v3/snToken con fingerprint
    const snTokenResp = await portalCall(cfg, "v3/snToken", hardwareFingerprint());
    const snToken = JSON.parse(await kino.xuper.portalDecrypt(snTokenResp.body)).snToken;
    const newSn = kino.crypto.hash("md5", snToken + SNTOKEN_SALT);

    // 2. v8/active
    await portalCall(cfg, "v8/active", { sn: newSn, loginType: 2, macAddr: FIXED_MAC, ... });
    await kino.storage.set("device_sn", newSn);
    return newSn;
}
```

`SNTOKEN_SALT = "ntFT65w6itH!lHCPw7D=@qnsFC5adD28"` (constante del protocolo, va en `plugin.js`).

Hardware fingerprint: los ~20 campos de `MagisSession.hardwareFingerprint()` — valores fijos/emulados, algunos aleatorios por device. Copiar la estructura de `MagisSession.kt` (~línea 585).

**Backup sessions (Argentina):** `RemoteCredentials.backupSessions` son sesiones pre-minteadas para regiones geo-bloqueadas. En Fase 4, si el device minting falla por geo-bloqueo, el nativo usa una de estas sesiones. El plugin necesitará que `kino.xuper.portalConfig()` también devuelva las `backupSessions`, o un nuevo primitivo `kino.xuper.portalBackupSession()`.

### 5.4 Fase 5 — Limpieza

Una vez que Fases 3 y 4 funcionen end-to-end, retirar:

| Qué | Dónde |
|---|---|
| `MagisSession.loginAlreadyHashed()` | `MagisSession.kt:206` |
| `PrivilegedXuperHost.xuperLogin` | `PrivilegedXuperHost.kt:23` |
| `DefaultPrivilegedXuperHost.session: Lazy<MagisSession>` + `xuperLogin` | `DefaultPrivilegedXuperHost.kt:28,98–117` |
| `asyncFunction("xuperLogin")` | `PluginRuntime.kt:607` |
| `kino.xuper.login` en prelude | `prelude.js:495` |
| Parámetro `lazy { magisSession }` | `AppGraph.kt:990` |

---

## 6. Tests existentes que deben pasar

Directorio: `app/src/test/java/com/arkiv/player/data/plugin/`

| Archivo | Qué cubre |
|---|---|
| `XuperPrivilegeGateTest.kt` | `XuperPrivilege.grants()` — el gate de acceso |
| `XuperPrivilegeTest.kt` | `isOfficial()`, `OFFICIAL_REPOS` |
| `PrivilegedXuperHostTest.kt` | Contrato del host privilegiado |
| `XuperSearchParityTest.kt` | Parity nativo ↔ plugin para search |
| `XuperHomeParityTest.kt` | Parity para home |
| `XuperBrowseParityTest.kt` | Parity para browse |
| `XuperEpisodesParityTest.kt` | Parity para episodes |
| `XuperResolveParityTest.kt` | Parity para resolve |
| `XuperErrorMappingTest.kt` | Mapeo de errores del portal a `PluginErrors` |
| `XuperPlaybackGateTest.kt` | Gate de acceso para playback |
| `XuperLiveGateTest.kt` | Gate para streams en vivo |
| `XuperStreamSecurityTest.kt` | Seguridad en streams |
| `LegacyXuperRefSourceTest.kt` | Compatibilidad con refs de versiones anteriores |
| `PluginInstallerTest.kt` | (menciona Xuper) Instalación y validación |

Cualquier cambio en `PrivilegedXuperHost`, `DefaultPrivilegedXuperHost`, `XuperPrivilege` o `pluginHostFor` debe verificarse corriendo estos tests antes de commit.

---

## 7. Mapa completo de archivos

### Plugin (`/Users/cristian/kino-upload/kino-plugin-xuper/`)
```
kino-plugin.json      apiVersion 6; hosts:[]; setting portalUrl type:url; Fase 1 completo
plugin.js             Fase 1 completo; reemplazar tryLogin() en Fase 3
MIGRATION.md          este documento
icon.png
```

### Worktree (`/Users/cristian/kino-light/.claude/worktrees/xuper-plain-plugin/`)

```
app/src/main/java/com/arkiv/player/
│
├── AppGraph.kt
│     :137  credentialsStore: RemoteCredentialsStore
│     :990  pluginHostFor(..., secrets, lazy { magisSession })   ← Fase 1
│
├── data/credentials/
│   ├── RemoteCredentials.kt          data class con activationBlob, iptvHosts, iptvAppId, iptvApkVersion...
│   ├── RemoteCredentialsStore.kt     interfaz + EncryptedRemoteCredentialsStore
│   └── NativeCredentialResolver.kt
│         :37   external fun magisActivate(blob: ByteArray): Boolean
│         :44   external fun magisEncryptBody(plain: ByteArray): String
│         :51   external fun magisDecryptBlob(wire: String): ByteArray
│
├── data/magis/
│   ├── MagisSession.kt
│   │     :198  fun login(email, password)                         ← original con md5
│   │     :206  fun loginAlreadyHashed(email, hashedPassword)      ← NUEVO Fase 1 (sin md5, sin saveAccount)
│   │     :547  reauthenticate(staleToken)                         ← cae a anónimo si no hay cuenta guardada
│   │     :568  saveFromResponse(j)
│   │     :585  hardwareFingerprint()                              ← campos para device minting
│   │     :648  companion object: SNTOKEN_SALT, PASSWORD_SALT, FIXED_MAC
│   ├── MagisCrypto.kt:1–54          encryptBody/decryptBlob; llave NUNCA en Java
│   └── MagisPortalClient.kt         headers, device dict, PORTAL_CODE="masnew", multi-host fallback
│
├── data/plugin/
│   ├── XuperPrivilege.kt
│   │     :12   SOURCE_REPO = "xuper-plugin/kino-plugin-xuper"
│   │     :18   LEGACY_SOURCE_REPOS = setOf("kinotvapp/kino-plugin-xuper")
│   │     :34   isOfficial(address): Boolean  — exacto, no prefix
│   │     :42   grants(record): Boolean        — production gate
│   ├── PrivilegedXuperHost.kt:16–23
│   │     interfaz: xuperSearch/Home/Browse/Episodes/Resolve/Login
│   ├── DefaultPrivilegedXuperHost.kt
│   │     :18   class DefaultPrivilegedXuperHost
│   │     :26   private val magis: Lazy<MagisPluginBridge>
│   │     :28   private val session: Lazy<MagisSession>              ← NUEVO Fase 1
│   │     :98   override suspend fun xuperLogin(...)                  ← NUEVO Fase 1
│   │     :125  internal fun pluginHostFor(...)                       ← pasa session
│   ├── PluginErrors.kt:9–13
│   │     AUTH_REQUIRED, NOT_FOUND, GEO_BLOCKED, RATE_LIMITED, UNAVAILABLE
│   └── PluginRuntime.kt
│         :601–607  asyncFunction("xuperSearch/Home/Browse/Episodes/Resolve/Login")
│
└── data/magis/
    └── MagisPluginBridge.kt:29      bridge entre el host privilegiado y MagisCatalog/MagisPlayback

app/src/main/resources/plugin/
└── prelude.js
      :484  if (typeof n.xuperSearch === 'function') { kino.xuper = freeze({...})
      :490  search, home, browse, episodes, resolve
      :495  login   ← NUEVO Fase 1

app/src/test/java/com/arkiv/player/data/plugin/
      (13 archivos de test — ver §6)

plugins/sdk/
├── seal.mjs:109,126      decodeCipherKey(), sealTyped()
├── kino-shim.mjs:144,148,626,675   cipher-key support
└── contract.mjs:~194,231 validación typed secrets; hosts vacíos con url setting
```

### Documentación SDK (`/Users/cristian/kino-upload/kino-plugins/docs/`)
```
manifest.md     spec del manifiesto completo
secrets.md      secretos sellados, cipher-key (apiVersion 6)
settings.md     tipos de settings: section, text, password, url, status, action
test-locally.md kino-shim.mjs, cómo testear sin la app
signed.md       firma de plugin con clave privada (opcional, apiVersion 5+)
```
