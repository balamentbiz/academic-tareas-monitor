# Blindaje de seguridad — Academic Tareas Monitor

Estado tras dos auditorías (2026-07-31): una interna y una segunda auditoría
adversarial que encontró tres fallas críticas que la primera pasó por alto.
Este documento es el estado real y la lista de verificación para mantenerlo.

---

## 🔴 Los 3 hallazgos críticos (corregidos)

### 1. "Autenticado" no era lo mismo que "del equipo"
**Era:** el alta de usuarios usa el registro de Firebase, que es un endpoint
**público**. Las reglas solo exigían `request.auth != null`, así que cualquier
persona en internet podía auto-registrarse, obtener un token válido y con una
sola consulta llevarse **las contraseñas en texto plano de las plataformas de
todos los clientes**, además de borrar o falsificar pedidos.

**Ahora:** todas las reglas parten de `esMiembro()`, que exige tener un
documento en `usuarios/{uid}` — y ese documento **solo lo puede crear la
dirección**. Un auto-registro externo obtiene un token que no sirve para nada:
no puede leer ni escribir absolutamente ninguna colección.

### 2. Un asesor podía ejecutar código en la pantalla del director (XSS)
**Era:** los paneles pintaban los campos de los pedidos (cliente, materia,
anotaciones, títulos de páginas…) directamente con `innerHTML` sin escapar.
Un asesor guardaba un pedido con `<img src=x onerror="...">` y ese código se
ejecutaba **en la sesión del director** al abrir su panel, con sus privilegios.
Escalada de privilegios real.

**Ahora:** función `esc()` en las cuatro vistas y en el reporte; **229
interpolaciones** de datos dinámicos escapadas. Los helpers que sí devuelven
HTML (`row`, `rowFull`) escapan su valor por dentro. Regla del proyecto: ningún
dato de Firestore entra a `innerHTML` sin pasar por `esc()`.

### 3. Actualización automática de Windows sin firma = riesgo de toda la flota
**Era:** el `.exe` se publica sin firma Authenticode y `electron-updater` solo
comparaba el hash contra el mismo release. Quien lograra publicar un release
instalaba código arbitrario y en silencio en todos los equipos Windows cada 4 h.

**Ahora:** en Windows el auto-instalador está **desactivado** — la app avisa que
hay versión nueva y abre la página de descarga para instalación manual (donde
el usuario ve el publicador). En Mac se mantiene automático porque el sistema
verifica la firma Developer ID y la notarización de Apple. Se reactivará en
Windows cuando haya certificado Authenticode.

---

## ✅ Checklist completo aplicado

### Autorización (Firestore)
- [x] `esMiembro()` como base de todas las reglas (no basta con autenticarse)
- [x] `usuarios` y `configuracion`: escritura solo dirección (sin auto-promoción)
- [x] `configuracion` (webhook de Sheets): lectura solo mandos
- [x] `cuota_diaria` y `checklist_atc`: cada quien escribe **lo suyo**; los mandos
      pueden ajustar ajenos → un empleado ya no puede ponerse la cuota en cero
- [x] `actividades_asignadas`: solo los mandos asignan; el asignado solo actualiza la suya
- [x] `tareas`: borrar solo mandos; tope de campos por documento
- [x] `rechazos`: histórico de solo lectura
- [x] Colecciones no listadas: denegadas por defecto

### Interfaz (XSS)
- [x] `esc()` en atc, index, director, gerencia, app.js; `safe()` en el reporte
- [x] 229 interpolaciones escapadas + helpers de HTML corregidos
- [x] CSP endurecida: **sin `unsafe-eval`**, `connect-src` acotado a Firebase/Google,
      `object-src`/`frame-src`/`base-uri`/`form-action` en `none`

### Aplicación de escritorio (Electron)
- [x] `contextIsolation`, `nodeIntegration:false`, `sandbox:true` en todas las ventanas
- [x] Navegación restringida por **origen exacto** (`new URL().origin`), no por
      prefijo: `mi-app.web.app.atacante.com` ya no pasa el filtro
- [x] `setWindowOpenHandler → deny` en todas las ventanas
- [x] `open-url` solo acepta `http(s)` (nada de `file:`, `smb:` ni protocolos del SO)
- [x] `sync-pedido` solo puede enviar a `script.google.com` — y se revalida en
      **cada redirect** (cierra la exfiltración fuera de la CSP y el SSRF)
- [x] El tracking arranca para todos los roles: declararse "director" desde la
      consola ya no apaga el monitoreo
- [x] Entitlements sin `allow-dyld-environment-variables` (no se puede inyectar
      una dylib bajo nuestra firma)

### Secretos y distribución
- [x] `.env` fuera de git (verificado en todo el historial), fuera del instalador
      y ahora con permisos `600` (solo tu usuario lo lee)
- [x] Los scripts cargan el `.env` con `source`, no con `xargs` (el token ya no
      aparece en la tabla de procesos)
- [x] `git push` sin `--force` y con el token fuera de la línea de comandos
- [x] App de macOS firmada con Developer ID y notarizada
- [x] Hosting con headers: `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`,
      HSTS y permisos de cámara/micrófono/GPS negados

### Bugs que afectaban los datos
- [x] **Guardado colgado**: `trackApps`/`trackChrome` no resolvían su promesa en
      error → en Windows (donde `osascript` no existe) el guardado periódico
      **nunca corría** y se perdía la jornada si el equipo se apagaba. Ahora
      resuelven siempre, se saltan en plataformas no-Mac y hay timeout
- [x] **Clics inflados**: el polling registraba listeners duplicados en cada
      login (tras 3 re-logins, 1 clic contaba 3). Ahora es idempotente
- [x] Acumuladores de apps/páginas se reinician en cada turno y tienen tope
- [x] `uIOhook` se detiene al cerrar sesión (ya no procesa eventos toda la noche)
- [x] Overlay de tiempo muerto se cierra al terminar sesión, pausar o salir
- [x] Desinstalación real en Windows (antes decía "listo" sin borrar nada)
- [x] Tiempo muerto huérfano tras reinicio: se descarta (ya no falsea la productividad)
- [x] Flush a disco al salir (no se pierde el último cambio)
- [x] Cronómetro de pausa se recupera al reabrir la app en pausa
- [x] Errores globales con stack completo en `sessions/errores.log`

---

## 📋 Acciones tuyas

1. **Publicar las reglas nuevas** — doble clic a `PUBLICAR UI.command` (despliega
   interfaz + reglas). **Es lo más importante de esta lista.**
2. **Verifica que tú tienes documento en `usuarios`** antes de publicar: si tu
   propio usuario director no tuviera su documento, quedarías fuera. (Si pasara:
   Firebase Console → Firestore → crear el documento a mano con tu uid y
   `rol: "director"`.)
3. **Rotar el token de GitHub** a uno *fine-grained* limitado a `Contents:write`
   solo en `academic-tareas-monitor`, con caducidad. El actual es clásico con
   permiso sobre **todos** tus repos.
4. Firebase Console → Authentication → Configuración → activar **protección de
   enumeración de correos**.

## ⚠️ Riesgos aceptados (documentados, con su condición)

1. **Contraseñas de clientes en texto plano** en Firestore: decisión de negocio,
   aceptable **ahora que** el acceso está limitado al equipo real. Si algún día
   se cifran, la clave debe vivir fuera del cliente.
2. **Registro público de Firebase sigue abierto** (lo necesita el alta de
   usuarios desde la app; cerrarlo exige Cloud Functions = plan de pago). Ya no
   tiene impacto: un auto-registro no puede leer nada. Sí puede crear cuentas
   basura en la lista de Authentication.
3. **EXE de Windows sin firma**: por eso el auto-instalador está desactivado ahí.
4. **`unsafe-inline` en la CSP**: los scripts van embebidos en el HTML. Con el
   escapado universal aplicado, el vector queda cerrado; quitarlo requiere mover
   todo el JS a archivos externos con nonces.

## 🔁 Reglas permanentes

- Los secretos solo viven en `.env` (nunca en código ni en el repo)
- Ningún dato de Firestore entra a `innerHTML` sin `esc()`
- Las reglas de Firestore se editan en `firestore.rules` del repo, no en la consola
- Cliente nuevo = repo nuevo + Firebase nuevo + `.env` nuevo
- Si un token se filtra: revocarlo el mismo día y regenerar
