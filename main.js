const { app, BrowserWindow, ipcMain, powerMonitor, shell, dialog } = require("electron");
const path  = require("path");
const fs    = require("fs");
const { exec } = require("child_process");

// Capturar errores globales sin tumbar la app, pero dejando rastro completo:
// con solo el mensaje era imposible diagnosticar fallos del tracking en las
// máquinas de los usuarios. El stack se guarda junto a los datos de sesión.
function registrarError(etiqueta, e) {
  const linea = `[${new Date().toISOString()}] ${etiqueta}: ${e?.stack || e?.message || e}\n`;
  console.error(etiqueta, e?.message || e);
  try {
    const dir = path.join(app.getPath("userData"), "sessions");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, "errores.log"), linea);
  } catch (_) {}
}
process.on("uncaughtException",  (e) => registrarError("[uncaughtException]", e));
process.on("unhandledRejection", (e) => registrarError("[unhandledRejection]", e));


// ── Persistencia ─────────────────────────────────────────────────────────────
const DATA_DIR = path.join(app.getPath("userData"), "sessions");
const ensureDir = () => { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); };
const f = name => path.join(DATA_DIR, name);

// save() asíncrono con debounce — no bloquea el hilo principal
const _saveDebounce = {};
function save(filename, data) {
  clearTimeout(_saveDebounce[filename]);
  _saveDebounce[filename] = setTimeout(() => {
    ensureDir();
    fs.writeFile(f(filename), JSON.stringify(data), () => {}); // async, no-blocking
  }, 2000); // espera 2s antes de escribir
}
function saveNow(filename, data) { // para operaciones críticas (fin de sesión)
  ensureDir();
  fs.writeFileSync(f(filename), JSON.stringify(data, null, 2));
}
function load(filename) {
  try { return fs.existsSync(f(filename)) ? JSON.parse(fs.readFileSync(f(filename))) : null; } catch { return null; }
}
function remove(filename) { try { if (fs.existsSync(f(filename))) fs.unlinkSync(f(filename)); } catch {} }

// ── Estado ────────────────────────────────────────────────────────────────────
let session     = load("current.json");

// Si la app se cerró con un tiempo muerto abierto y se reabre horas (o días)
// después, ese idle "huérfano" incluiría todo el tiempo con la app apagada y
// falsearía el porcentaje de productividad. Se descarta al arrancar.
if (session && session.currentIdleStart) {
  const abierto = Date.now() - session.currentIdleStart;
  if (abierto > 30 * 60 * 1000) { // más de media hora: la app no estuvo corriendo
    console.log("[sesión] descartando tiempo muerto huérfano de", Math.round(abierto / 60000), "min");
    session.currentIdleStart = null;
    session._lastActivityTs = Date.now();
  }
}

// Red de seguridad para cierres que no pasan por before-quit (forzar salida,
// caída de la app, corte de luz): si la sesión quedó "activa" pero la última
// señal de vida es vieja, ese hueco NO fue trabajo. Se convierte en pausa
// abierta desde el último momento con actividad real.
if (session && session.status === "active") {
  const ultimaSenal = session._lastActivityTs || session.startTime;
  const hueco = Date.now() - ultimaSenal;
  if (hueco > 3 * 60 * 1000) { // 3 min: el tracking late cada 10 s, así que es un cierre
    console.log("[sesión] recuperando cierre inesperado — hueco de", Math.round(hueco / 60000), "min");
    if (!session.pauses) session.pauses = [];
    session.pauses.push({
      id: `p_${ultimaSenal}`,
      reason: "Aplicación cerrada inesperadamente",
      startTime: ultimaSenal,
      endTime: null,
    });
    session.status = "paused";
    saveNow("current.json", session);
  }
}
let win         = null;
let idleTimer   = null;
let loggedUser  = null;  // { uid, email, nombre, rol }

// Envío seguro — nunca crashea si la ventana fue destruida
function safeSend(channel, data) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed())
      win.webContents.send(channel, data);
  } catch (_) {}
}

// ── UI remota (Firebase Hosting) ─────────────────────────────────────────────
// Las vistas se cargan desde Hosting para que las actualizaciones lleguen al
// instante a todos los usuarios sin reinstalar. Si no hay internet o el sitio
// falla, cae automáticamente a los archivos locales incluidos en la app.
// Poner "" para desactivar y usar siempre archivos locales.
const REMOTE_UI = "https://academic-tareas-monitor.web.app";
let _uiRemota  = !!REMOTE_UI;
let _vistaActual = "login.html";

function loadView(file) {
  _vistaActual = file;
  if (_uiRemota) {
    win.loadURL(`${REMOTE_UI}/${file}`);
  } else {
    win.loadFile(path.join(__dirname, "renderer", file));
  }
}

// ── Ventana ────────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 420, height: 720,
    minWidth: 380, minHeight: 560,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#eef2fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // el renderer no puede tocar Node aunque lo comprometan
    },
  });

  // ── Blindaje de navegación ──────────────────────────────────────────────
  // El renderer solo puede navegar a nuestra UI (remota o local). Cualquier
  // otro enlace se abre en el navegador del sistema, nunca dentro de la app.
  //
  // Se compara el ORIGEN EXACTO, no un startsWith: "https://mi-app.web.app"
  // también es prefijo de "https://mi-app.web.app.sitio-atacante.com", que se
  // cargaría con nuestro preload y quedaría con acceso completo a window.AT.
  const esOrigenPermitido = (url) => {
    try {
      if (url.startsWith("file://")) return true;
      return !!REMOTE_UI && new URL(url).origin === new URL(REMOTE_UI).origin;
    } catch { return false; }
  };
  win.webContents.on("will-navigate", (e, url) => {
    if (!esOrigenPermitido(url)) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: "deny" }; // jamás ventanas nuevas dentro de la app
  });

  // Fallback: si la UI remota no carga (sin internet, hosting caído),
  // usar los archivos locales por el resto de la sesión
  const caerALocal = (motivo) => {
    if (!_uiRemota) return;
    console.log("[UI] Hosting no disponible (" + motivo + ") → usando archivos locales");
    _uiRemota = false;
    win.loadFile(path.join(__dirname, "renderer", _vistaActual));
  };
  const esNuestroHosting = (url) => {
    try { return !!REMOTE_UI && new URL(url).origin === new URL(REMOTE_UI).origin; }
    catch { return false; }
  };
  win.webContents.on("did-fail-load", (_e, code, desc, url) => {
    if (url && esNuestroHosting(url) && code !== -3 /* ERR_ABORTED */) caerALocal(desc);
  });
  // 404/500 del hosting (p. ej. antes del primer deploy) no disparan did-fail-load
  win.webContents.on("did-navigate", (_e, url, httpResponseCode) => {
    if (url && esNuestroHosting(url) && httpResponseCode >= 400) caerALocal("HTTP " + httpResponseCode);
  });

  // Siempre arranca en el login
  loadView("login.html");
}

// Tamaño ideal de ventana por rol — se abre ya al tamaño correcto (sin estirar)
const WINDOW_SIZES = {
  director: { width: 1240, height: 860, minWidth: 900,  minHeight: 640 },
  // ATC tiene 8 pestañas — abre más ancha que las demás para que quepan todas
  atc:      { width: 1360, height: 880, minWidth: 1080, minHeight: 640 },
  gerencia: { width: 470,  height: 860, minWidth: 390, minHeight: 600 },
  asesor:   { width: 470,  height: 860, minWidth: 390, minHeight: 600 },
  login:    { width: 420,  height: 720, minWidth: 380, minHeight: 560 },
};

function applyWindowSize(key) {
  const s = WINDOW_SIZES[key] || WINDOW_SIZES.asesor;
  if (!win || win.isDestroyed()) return;
  try {
    const { screen } = require("electron");
    const wa = screen.getPrimaryDisplay().workAreaSize;
    // No exceder el área visible del monitor
    const w = Math.min(s.width, wa.width), h = Math.min(s.height, wa.height);
    win.setMinimumSize(s.minWidth, s.minHeight);
    win.setSize(w, h);
    win.center();
  } catch (_) {}
}

// Carga el dashboard según el rol
function loadDashboard(rol) {
  const rolNorm = (rol || "").toLowerCase().trim();
  console.log("[AUTH] Rol recibido:", rol, "→ normalizado:", rolNorm);
  const map = {
    director: "director.html",
    gerencia: "index.html",   // gerencia usa interfaz de asesor (con tracking completo)
    atc:      "atc.html",
    asesor:   "index.html",
  };
  const file = map[rolNorm] || "index.html";
  console.log("[AUTH] Cargando dashboard:", file);
  applyWindowSize(rolNorm);
  loadView(file);
  // Reaplicar al terminar de cargar (por si algo movió la ventana en el interín)
  win.webContents.once("did-finish-load", () => applyWindowSize(rolNorm));

  // El tracking arranca para CUALQUIER rol. El proceso principal recibe el rol
  // desde el renderer y no puede verificarlo, así que si solo se rastreara a
  // ciertos roles bastaría con declararse "director" desde la consola para
  // apagarse el monitoreo. El tracking solo registra mientras hay sesión
  // iniciada (start-day), de modo que en director —que no inicia jornada— no
  // recoge nada, pero tampoco se puede desactivar mintiendo sobre el rol.
  startIdleCheck();
  startAppTracking();
  startActivityPolling();
}

// ── Idle check → lanza ventana overlay del sistema ───────────────────────────
function startIdleCheck() {
  clearInterval(idleTimer);
  idleTimer = setInterval(() => {
    if (!session || session.status !== "active") return;
    const idle = powerMonitor.getSystemIdleTime();
    if (idle >= 60) {
      if (!session.currentIdleStart) {
        session.currentIdleStart = Date.now() - (idle * 1000);
      }
      showIdleOverlay(); // ventana flotante encima de todo
    }
  }, 10000);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = ms => {
  if (!ms || ms < 0) return "0s";
  const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), sec=s%60;
  return [h>0?`${h}h`:null,m>0?`${m}m`:null,`${sec}s`].filter(Boolean).join(" ");
};

function generateReport(s) {
  const totalMs = (s.endTime||Date.now()) - s.startTime;
  const workMs  = totalMs - (s.totalPausedMs||0);
  return {
    meta: { sessionId:s.id, collaborator:s.collaborator, date:s.date, generatedAt:new Date().toISOString() },
    summary: {
      startTime:       new Date(s.startTime).toLocaleTimeString("es-MX"),
      endTime:         s.endTime ? new Date(s.endTime).toLocaleTimeString("es-MX") : "—",
      totalDuration:   fmt(totalMs),
      activeTime:      fmt(s.totalActiveMs||0),
      idleTime:        fmt(s.totalIdleMs||0),
      pausedTime:      fmt(s.totalPausedMs||0),
      totalClicks:     s.totalClicks||0,
      totalPagesVisited:(s.pages||[]).length,
      totalActivities: (s.activities||[]).length,
      totalIdlePeriods:(s.idlePeriods||[]).length,
      productivityPct: workMs>0?Math.round(((s.totalActiveMs||0)/workMs)*100):0,
      clicks:          s.clicks         || 0,
      keyPresses:      s.keyPresses     || 0,
      scrolls:         s.scrolls        || 0,
      activityEvents:  s.activityEvents || 0,
    },
    activities: (s.activities||[]).map((a,i)=>({
      number:i+1, name:a.name,
      startTime:new Date(a.startTime).toLocaleTimeString("es-MX"),
      endTime:a.endTime?new Date(a.endTime).toLocaleTimeString("es-MX"):"en curso",
      duration:a.durationMs?fmt(a.durationMs):"en curso",
    })),
    pauses: (s.pauses||[]).map(p=>({
      reason:p.reason,
      start:new Date(p.startTime).toLocaleTimeString("es-MX"),
      end:p.endTime?new Date(p.endTime).toLocaleTimeString("es-MX"):"—",
      duration:p.endTime?fmt(p.endTime-p.startTime):"—",
    })),
    idlePeriods: (s.idlePeriods||[]).map((ip,i)=>({
      number:i+1,
      start:new Date(ip.startTime).toLocaleTimeString("es-MX"),
      end:ip.endTime?new Date(ip.endTime).toLocaleTimeString("es-MX"):"—",
      duration:ip.durationMs?fmt(ip.durationMs):"—",
      reason:ip.reason||"(sin motivo)",
    })),
    pages: (s.pages||[]).map((p,i)=>({
      number:i+1, title:p.title||"(sin título)", url:p.url||"",
      openedAt:new Date(p.openedAt).toLocaleTimeString("es-MX"),
      closedAt:p.closedAt?new Date(p.closedAt).toLocaleTimeString("es-MX"):"abierta",
      duration:p.durationMs?fmt(p.durationMs):"—",
      clicks:p.clicks||0,
    })),
    appsOpened:   s.appLog      || [],
    chromePages: (s.chromePages || []).map(p => ({
      title:     p.title,
      url:       p.url,
      firstSeen: p.firstSeen,
      duration:  p.duration,
      totalMs:   p.totalMs || 0,
    })),
    comments: s.comments||"",
  };
}

// ── IPC ───────────────────────────────────────────────────────────────────────
ipcMain.handle("get-status", () => ({ session, pendingReport: load("pending_report.json") }));

ipcMain.handle("start-day", (_, { collaborator }) => {
  const now = Date.now();
  resetAcumuladores(); // el turno nuevo no hereda apps/páginas del anterior
  session = {
    id:`session_${now}`, collaborator, date:new Date(now).toISOString().split("T")[0],
    startTime:now, endTime:null, status:"active",
    pauses:[], pages:[], activities:[], idlePeriods:[],
    currentActivityId:null, currentIdleStart:null,
    totalActiveMs:0, totalIdleMs:0, totalPausedMs:0, totalClicks:0, comments:"",
    _lastActivityTs:now,
  };
  save("current.json", session);
  return { ok:true };
});

ipcMain.handle("pause-session", (_, { reason }) => {
  if (!session || session.status !== "active") return { ok:false };
  const now = Date.now();
  closeIdleOverlay(); // si el aviso estaba abierto, no dejarlo tapando pantallas
  session.status = "paused";
  session.pauses.push({ id:`p_${now}`, reason:reason||"pausa", startTime:now, endTime:null });
  save("current.json", session);
  return { ok:true };
});

ipcMain.handle("resume-session", () => {
  if (!session || session.status !== "paused") return { ok:false };
  const now = Date.now();
  const last = session.pauses[session.pauses.length-1];
  if (last && !last.endTime) { last.endTime=now; session.totalPausedMs=(session.totalPausedMs||0)+(now-last.startTime); }
  session.status = "active";
  session._lastActivityTs = now;
  save("current.json", session);
  return { ok:true };
});

ipcMain.handle("end-day", (_, { comments }) => {
  if (!session) return { ok:false };
  const now = Date.now();
  // Si el overlay de tiempo muerto seguía abierto en otro monitor quedaría
  // tapando la pantalla sin forma de cerrarlo (su botón depende de session).
  closeIdleOverlay();
  stopActivityTracking();
  // Cerrar la pausa abierta (si la jornada termina estando en pausa, ese tiempo
  // debe contabilizarse como pausa y no como trabajo en el reporte).
  const pausaAbierta = (session.pauses || []).slice().reverse().find(p => !p.endTime);
  if (pausaAbierta) {
    pausaAbierta.endTime = now;
    session.totalPausedMs = (session.totalPausedMs || 0) + (now - pausaAbierta.startTime);
  }
  session.endTime = now; session.status = "finished"; session.comments = comments||"";
  const report = generateReport(session);
  // Archivar en historial — usar saveNow para operaciones críticas de fin de sesión
  let hist = load("history.json") || [];
  hist.push(session);
  saveNow("history.json", hist);
  remove("current.json");
  saveNow("pending_report.json", report);
  session = null;
  return { ok:true, report };
});

ipcMain.handle("report-downloaded", () => { remove("pending_report.json"); return { ok:true }; });

ipcMain.handle("start-activity", (_, { name }) => {
  if (!session) return { ok:false };
  const now = Date.now();
  if (session.currentActivityId) {
    const prev = session.activities.find(a=>a.id===session.currentActivityId);
    if (prev && !prev.endTime) { prev.endTime=now; prev.durationMs=now-prev.startTime; }
  }
  const id = `act_${now}`;
  session.activities.push({ id, name, startTime:now, endTime:null, durationMs:null });
  session.currentActivityId = id;
  save("current.json", session);
  return { ok:true, activityId:id, startTime:now };
});

ipcMain.handle("end-activity", () => {
  if (!session||!session.currentActivityId) return { ok:false };
  const now = Date.now();
  const act = session.activities.find(a=>a.id===session.currentActivityId);
  if (act&&!act.endTime) { act.endTime=now; act.durationMs=now-act.startTime; }
  session.currentActivityId = null;
  save("current.json", session);
  return { ok:true, activity:act };
});

ipcMain.handle("idle-ended", (_, { reason }) => {
  if (!session) return { ok:false };
  const now = Date.now();
  if (session.currentIdleStart) {
    const dur = now - session.currentIdleStart;
    session.idlePeriods.push({ startTime:session.currentIdleStart, endTime:now, durationMs:dur, reason:reason||"(sin motivo)" });
    session.totalIdleMs = (session.totalIdleMs||0) + dur;
    session.currentIdleStart = null;
  }
  session._lastActivityTs = now;
  save("current.json", session);
  return { ok:true };
});

ipcMain.handle("save-report-image", async (_, { report, filename }) => {
  return new Promise((resolve) => {
    const imgWin = new BrowserWindow({
      width: 900, height: 1200,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    imgWin.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    imgWin.loadFile(path.join(__dirname, "renderer", "report-image.html"));

    imgWin.webContents.once("did-finish-load", () => {
      // Inyectar los datos del reporte
      imgWin.webContents.executeJavaScript(
        `window.postMessage(${JSON.stringify({ type: "render-report", report })}, "*")`
      );

      // Esperar a que renderice, luego capturar
      setTimeout(async () => {
        try {
          // Ajustar altura al contenido real
          const height = await imgWin.webContents.executeJavaScript(
            "document.body.scrollHeight"
          );
          imgWin.setSize(900, Math.min(height + 20, 4000));

          await new Promise(r => setTimeout(r, 300));

          const image = await imgWin.webContents.capturePage();
          const pngBuffer = image.toPNG();

          const result = await dialog.showSaveDialog(win, {
            defaultPath: filename,
            filters: [{ name: "Imagen PNG", extensions: ["png"] }],
          });

          imgWin.close();

          if (result.canceled || !result.filePath) { resolve({ ok: false }); return; }
          fs.writeFileSync(result.filePath, pngBuffer);
          resolve({ ok: true });
        } catch (e) {
          imgWin.close();
          resolve({ ok: false, error: e.message });
        }
      }, 1500); // tiempo para que Google Fonts cargue
    });
  });
});

ipcMain.handle("get-version", () => app.getVersion());

ipcMain.handle("check-for-updates", async () => {
  const current = app.getVersion();
  try {
    const https = require("https");
    const data = await new Promise((resolve, reject) => {
      https.get({
        hostname: "api.github.com",
        path: "/repos/balamentbiz/academic-tareas-monitor/releases/latest",
        headers: { "User-Agent": "AcademicTareasMonitor/" + current }
      }, (res) => {
        let body = "";
        res.on("data", d => body += d);
        res.on("end", () => { try { resolve(JSON.parse(body)); } catch { reject(new Error("parse")); } });
      }).on("error", reject);
    });

    const latest = (data.tag_name || "").replace(/^v/, "");
    if (!latest || latest === current) return { status: "up-to-date", current };

    // Hay actualización — abrir página de descarga en GitHub
    const releasesUrl = `https://github.com/balamentbiz/academic-tareas-monitor/releases/latest`;
    shell.openExternal(releasesUrl);

    return { status: "update-available", current, latest, url: releasesUrl };
  } catch (e) {
    return { status: "error", message: e.message };
  }
});
// ── Cierre de la aplicación ───────────────────────────────────────────────────
// Al salir, el cronómetro debe DETENERSE. Antes la sesión quedaba "activa" y al
// reabrir al día siguiente la jornada aparecía con las horas que la app estuvo
// cerrada. Ahora se registra una pausa automática: el tiempo cerrado queda
// contabilizado como pausa (no como trabajo) y el colaborador reanuda cuando
// vuelve. Se guarda de forma síncrona porque el proceso está por terminar.
let _cerrando = false;
function pausarSesionPorCierre(motivo) {
  if (_cerrando) return;
  _cerrando = true;
  try {
    stopActivityTracking();
    _permitirCierreOverlay = true;
    closeIdleOverlay();
    if (session && session.status === "active") {
      const now = Date.now();
      if (!session.pauses) session.pauses = [];
      session.pauses.push({ id: `p_${now}`, reason: motivo, startTime: now, endTime: null });
      session.status = "paused";
      session._lastActivityTs = now;
    }
    if (session) saveNow("current.json", session);
  } catch (e) { console.error("[cierre]", e?.message || e); }
}

// Salida garantizada: uiohook-napi (el módulo que cuenta clics y teclas a nivel
// de sistema) mantiene un hilo nativo vivo que a veces impide que el proceso
// termine — la app quedaba corriendo en segundo plano y solo se podía matar
// desde el Monitor de Actividad. Este plan B fuerza la salida si en 1.5 s el
// proceso no terminó por sí solo.
let _salidaForzada = false;
function salirDefinitivamente() {
  if (_salidaForzada) return;
  _salidaForzada = true;
  setTimeout(() => {
    try { app.exit(0); } catch (_) { process.exit(0); }
  }, 1500).unref?.();
}

ipcMain.on("quit-app", () => {
  pausarSesionPorCierre("Aplicación cerrada");
  salirDefinitivamente();
  app.quit();
});
app.on("before-quit", () => {
  pausarSesionPorCierre("Aplicación cerrada");
  salirDefinitivamente();
});
app.on("will-quit", () => {
  // Último intento de soltar el hook nativo antes de cerrar
  try { stopActivityTracking(); } catch (_) {}
});
// Cierre del sistema operativo (apagado / reinicio)
powerMonitor.on("shutdown", () => { pausarSesionPorCierre("Equipo apagado"); salirDefinitivamente(); });

ipcMain.handle("uninstall-app", async () => {
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Desinstalar Academic Tareas Monitor",
    message: "¿Seguro que quieres desinstalar la aplicación?",
    detail: "Se eliminarán la app y todos sus datos guardados.\nEsta acción no se puede deshacer.",
    buttons: ["Cancelar", "Sí, desinstalar"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return { ok: false };

  // Antes se ejecutaba `rm -rf` también en Windows (comando inexistente): el
  // borrado fallaba en silencio pero se avisaba "desinstalado" y el empleado
  // se quedaba con la app instalada. Ahora se usa la API de Node, que funciona
  // en ambos sistemas, y solo se declara éxito si de verdad se borró algo.
  const dataDir = app.getPath("userData");
  let errores = [];

  const borrar = (ruta) => {
    try { fs.rmSync(ruta, { recursive: true, force: true }); }
    catch (e) { errores.push(`${ruta}: ${e.message}`); }
  };

  borrar(dataDir);
  if (process.platform === "darwin") {
    borrar("/Applications/Academic Tareas Monitor.app");
    borrar(path.join(app.getPath("home"), "Library/Preferences/com.academictareas.monitor.plist"));
  } else if (process.platform === "win32") {
    // Instalación por usuario de NSIS + acceso directo del menú inicio
    borrar(path.join(app.getPath("appData"), "..", "Local", "Programs", "academic-tareas-monitor"));
    borrar(path.join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs", "Academic Tareas Monitor.lnk"));
  }

  const ok = errores.length === 0;
  await dialog.showMessageBox(win, {
    type: ok ? "info" : "warning",
    title: ok ? "Desinstalación completada" : "Desinstalación parcial",
    message: ok
      ? "Academic Tareas Monitor ha sido desinstalado."
      : "Se borraron los datos, pero quedaron archivos sin eliminar.",
    detail: ok
      ? "Puedes eliminar la carpeta del proyecto manualmente si lo deseas."
      : "Desinstala la aplicación desde el sistema (Aplicaciones en Mac, o Agregar o quitar programas en Windows).\n\n" + errores.join("\n"),
    buttons: ["OK"],
  });

  app.quit();
  return { ok: true };
});

// Solo http/https: sin este filtro, un renderer comprometido podría abrir
// file:, smb: o manejadores de protocolo del sistema operativo.
ipcMain.handle("open-url", (_, url) => {
  if (typeof url === "string" && /^https?:\/\//i.test(url)) return shell.openExternal(url);
  console.warn("[open-url] esquema no permitido:", String(url).slice(0, 60));
  return false;
});
ipcMain.handle("open-blackboard", () => {
  const { spawn } = require("child_process");
  const url = "https://uvmonline.blackboard.com/webapps/login/?action=default_login";
  if (process.platform === "darwin") {
    spawn("open", ["-na", "Google Chrome", "--args", "--incognito", url]);
  } else if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "chrome", "--incognito", url], { shell: true });
  }
});
ipcMain.handle("open-drive",       () => shell.openExternal("https://drive.google.com/drive/folders/1lL0EXrghttyvTjTR8PEevsRu09R6qk3U?usp=drive_link"));

ipcMain.handle("save-report-file", async (_, { content, filename, ext }) => {
  const result = await dialog.showSaveDialog(win, {
    defaultPath: filename,
    filters: ext==="json"?[{name:"JSON",extensions:["json"]}]:[{name:"Texto",extensions:["txt"]}],
  });
  if (result.canceled || !result.filePath) return { ok:false };
  fs.writeFileSync(result.filePath, content, "utf8");
  return { ok:true };
});

// ── Seguimiento de aplicaciones + páginas Chrome ─────────────────────────────
let overlayWins = [];              // una ventana por monitor
let _permitirCierreOverlay = false; // solo la app puede cerrarlos, no el usuario

function showIdleOverlay() {
  if (overlayWins.length > 0) return; // ya están abiertas
  const { screen } = require("electron");
  const displays = screen.getAllDisplays();

  displays.forEach(display => {
    // display.bounds cubre TODA la pantalla física (incluye la franja de la
    // barra de menús de macOS y la del Dock). workAreaSize, en cambio, deja
    // esas zonas fuera — por eso antes el aviso no tapaba la pantalla completa.
    const { x, y, width, height } = display.bounds;
    const w = new BrowserWindow({
      x, y, width, height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      roundedCorners: false,    // sin esquinas redondeadas: cubre hasta el borde
      enableLargerThanScreen: true, // evita que macOS recorte la ventana al área útil
      focusable: true,
      show: false,              // mostrar solo después de posicionar correctamente
      webPreferences: {
        preload: path.join(__dirname, "preload-overlay.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

    // El overlay no se puede cerrar con Cmd+W: hay que escribir el motivo.
    // Se bloquea con un guard y NO con closable:false, porque una ventana no
    // cerrable impide que app.quit() termine el proceso (la app se quedaría
    // corriendo en segundo plano).
    w.on("close", (e) => {
      if (!_permitirCierreOverlay) e.preventDefault();
    });

    if (process.platform === "darwin") {
      // "screen-saver" es el nivel más alto: queda por encima de la barra de
      // menús, del Dock y de cualquier app en pantalla completa.
      w.setAlwaysOnTop(true, "screen-saver", 1);
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    } else {
      w.setAlwaysOnTop(true, "screen-saver");
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    w.loadFile(path.join(__dirname, "renderer", "overlay.html"));

    const cubrirPantalla = () => {
      if (w.isDestroyed()) return;
      w.setBounds({ x, y, width, height });
      w.moveTop();
    };

    w.once("ready-to-show", () => {
      cubrirPantalla();
      w.showInactive();
      cubrirPantalla();
      // macOS a veces reajusta la geometría justo después de mostrar la
      // ventana; se reafirma un par de veces para que quede a pantalla completa.
      setTimeout(cubrirPantalla, 60);
      setTimeout(cubrirPantalla, 300);
      // Solo el overlay del monitor principal toma el foco (para escribir el motivo)
      if (display.id === screen.getPrimaryDisplay().id) {
        w.focus();
        if (process.platform === "darwin") app.focus({ steal: true });
      }
    });

    w.on("closed", () => {
      overlayWins = overlayWins.filter(ow => ow !== w);
    });

    overlayWins.push(w);
  });
}

function closeIdleOverlay() {
  const wins = [...overlayWins];
  overlayWins = [];
  _permitirCierreOverlay = true; // levanta el guard: ahora sí pueden cerrarse
  wins.forEach(w => {
    try { if (!w.isDestroyed()) { w.destroy(); } } catch (_) {}
  });
  _permitirCierreOverlay = false;
}

// Cuando el asesor hace clic en "Reanudar trabajo" desde el overlay
ipcMain.on("idle-overlay-resume", (_, reason) => {
  if (!session) return;
  const now = Date.now();
  if (session.currentIdleStart) {
    const dur = now - session.currentIdleStart;
    if (!session.idlePeriods) session.idlePeriods = [];
    session.idlePeriods.push({
      startTime: session.currentIdleStart, endTime: now, durationMs: dur,
      reason: reason || "(sin motivo)"
    });
    session.totalIdleMs = (session.totalIdleMs || 0) + dur;
    session.currentIdleStart = null;
  }
  session._lastActivityTs = Date.now();
  save("current.json", session);
  closeIdleOverlay();
  // Notificar al renderer principal
  safeSend("idle-resumed", {});
});

let trackInterval    = null;
let activeApps       = {};
let currentChromeUrl = "";
let chromePages      = {};

// ── Contadores globales de interacción ────────────────────────────────────────
let _activityEvents = 0;
let _uiohookActive  = false;

// Se llama en CADA login. Sin la guarda de idempotencia se registraban
// listeners duplicados: tras dos re-logins, un clic físico contaba dos o tres
// veces y el reporte de productividad quedaba inflado. Los listeners y el
// intervalo se crean UNA sola vez por proceso.
let _pendingClicks = 0, _pendingKeys = 0;
let _flushInterval = null, _fallbackInterval = null;

function startActivityPolling() {
  if (_uiohookActive || _fallbackInterval) return; // ya inicializado

  try {
    const { uIOhook } = require("uiohook-napi");

    const flushEvents = () => {
      if (!session || session.status !== "active") { _pendingClicks = 0; _pendingKeys = 0; return; }
      if (_pendingClicks > 0) {
        session.clicks = (session.clicks || 0) + _pendingClicks;
        _pendingClicks = 0;
        safeSend("global-event", { type: "click", clicks: session.clicks });
      }
      if (_pendingKeys > 0) {
        session.keyPresses = (session.keyPresses || 0) + _pendingKeys;
        _pendingKeys = 0;
        safeSend("global-event", { type: "key", keyPresses: session.keyPresses });
      }
    };
    clearInterval(_flushInterval);
    _flushInterval = setInterval(flushEvents, 800);

    uIOhook.removeAllListeners("mousedown");
    uIOhook.removeAllListeners("keydown");
    uIOhook.removeAllListeners("wheel");

    uIOhook.on("mousedown", () => {
      if (!session || session.status !== "active") return;
      _pendingClicks++; _activityEvents++;
    });

    uIOhook.on("keydown", () => {
      if (!session || session.status !== "active") return;
      _pendingKeys++; _activityEvents++;
    });

    uIOhook.on("wheel", () => {
      if (!session || session.status !== "active") return;
      session.scrolls = (session.scrolls || 0) + 1; _activityEvents++;
    });

    uIOhook.start();
    _uiohookActive = true;
    console.log("✅ uiohook-napi activo — contando eventos globales");

  } catch (e) {
    // Fallback: polling de idle para detectar actividad aproximada
    console.log("⚠️  uiohook no disponible, usando polling:", e.message);
    let _lastIdleMs = 0;
    _fallbackInterval = setInterval(() => {
      if (!session || session.status !== "active") return;
      const idleMs = powerMonitor.getSystemIdleTime() * 1000;
      if (idleMs < _lastIdleMs - 300) _activityEvents++;
      _lastIdleMs = idleMs;
    }, 300);
  }
}

// Detiene el hook global y todos los temporizadores de tracking. Se llama al
// cerrar sesión y al terminar el día: sin esto, el hook de bajo nivel sigue
// procesando cada evento del sistema toda la noche con la app en el login.
function stopActivityTracking() {
  clearInterval(trackInterval);   trackInterval = null;
  clearInterval(_flushInterval);  _flushInterval = null;
  clearInterval(_fallbackInterval); _fallbackInterval = null;
  _pendingClicks = 0; _pendingKeys = 0;
  if (_uiohookActive) {
    try {
      const { uIOhook } = require("uiohook-napi");
      uIOhook.removeAllListeners("mousedown");
      uIOhook.removeAllListeners("keydown");
      uIOhook.removeAllListeners("wheel");
      uIOhook.stop();
    } catch (_) {}
    _uiohookActive = false;
  }
}

// Los acumuladores viven en el proceso, no en la sesión: sin reiniciarlos, el
// reporte del segundo turno heredaba apps y páginas del turno anterior.
function resetAcumuladores() {
  activeApps = {};
  chromePages = {};
  currentChromeUrl = "";
  _activityEvents = 0;
}

const TRACK_INTERVAL_MS = 10000; // 10 segundos
let _tickCount = 0;              // para espaciar las consultas a osascript

function startAppTracking() {
  clearInterval(trackInterval);
  trackInterval = setInterval(() => {
    if (!session || session.status !== "active") return;

    // Latido: marca que la app sigue viva. Si al arrancar este dato es viejo,
    // sabemos que hubo un cierre inesperado y ese hueco no cuenta como trabajo.
    session._lastActivityTs = Date.now();

    // ── Acumular tiempo activo / inactivo ────────────────────────────────────
    const idleSecs = powerMonitor.getSystemIdleTime();
    if (idleSecs < 60) {
      session.totalActiveMs = (session.totalActiveMs || 0) + TRACK_INTERVAL_MS;
    } else {
      session.totalIdleMs = (session.totalIdleMs || 0) + TRACK_INTERVAL_MS;
    }

    // Consultar apps y Chrome lanza dos procesos osascript. Hacerlo cada tick
    // son ~5.700 procesos por jornada sin necesidad: basta cada 30 s.
    _tickCount++;
    const toca = _tickCount % 3 === 0;

    // Red de seguridad: aunque una promesa se quedara colgada, el timeout
    // garantiza que el guardado de la sesión ocurra igual.
    const conTimeout = (p) => Promise.race([p, new Promise(r => setTimeout(r, 5000))]);
    (toca
      ? Promise.all([conTimeout(trackApps()), conTimeout(trackChrome())]).catch(() => {})
      : Promise.resolve()
    ).then(() => { if (session) save("current.json", session); });

    // Guardar contadores en sesión
    session.activityEvents = _activityEvents;
    session.clicks    = session.clicks    || 0;
    session.keyPresses= session.keyPresses|| 0;
    session.scrolls   = session.scrolls   || 0;

    // Notificar al renderer para actualizar los tiles
    safeSend("session-tick", {
      totalActiveMs:    session.totalActiveMs  || 0,
      totalIdleMs:      session.totalIdleMs    || 0,
      elapsed:          Date.now() - session.startTime,
      clicks:           session.clicks         || 0,
      keyPresses:       session.keyPresses     || 0,
      idleCount:        (session.idlePeriods    || []).length,
      activitiesCount:  (session.activities    || []).length,
      activityEvents:   _activityEvents,
    });
  }, TRACK_INTERVAL_MS);
}

// ── Rastrear aplicaciones abiertas con tiempo ─────────────────────────────────
// IMPORTANTE: esta promesa debe resolverse SIEMPRE, incluso en error. El
// intervalo de tracking hace Promise.all([trackApps(), trackChrome()]).then(save):
// si una se queda pendiente, el guardado periódico de la sesión deja de
// ejecutarse en silencio y se pierde la jornada si el equipo se apaga.
// osascript solo existe en macOS, así que en Windows/Linux resolvemos de una.
function trackApps() { return new Promise(resolve => {
  if (process.platform !== "darwin" || !session) return resolve();
  exec(
    `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
    (err, stdout) => {
      if (err || !stdout) return resolve();
      const now  = Date.now();
      const apps = stdout.trim().split(", ").filter(a => a && a !== "Electron" && a !== "Academic Tareas Monitor");

      // Nuevas apps abiertas
      apps.forEach(name => {
        if (!activeApps[name]) {
          activeApps[name] = { startTime: now, totalMs: 0 };
        }
      });

      // Apps cerradas — acumular tiempo
      Object.keys(activeApps).forEach(name => {
        if (!apps.includes(name)) {
          activeApps[name].totalMs += now - activeApps[name].startTime;
          activeApps[name].closed = true;
          activeApps[name].closedAt = now;
        }
      });

      // Guardar en sesión
      if (!session.appLog) session.appLog = [];
      session.appLog = Object.entries(activeApps).map(([name, d]) => ({
        name,
        openedAt:  new Date(d.startTime).toLocaleTimeString("es-MX"),
        closedAt:  d.closedAt ? new Date(d.closedAt).toLocaleTimeString("es-MX") : "abierta",
        totalMs:   d.closed ? d.totalMs : (now - d.startTime + d.totalMs),
        duration:  fmt(d.closed ? d.totalMs : (now - d.startTime + d.totalMs)),
      }));
      resolve();
    }
  );
}); }

// ── Rastrear páginas en Chrome ────────────────────────────────────────────────
function trackChrome() { return new Promise(resolve => {
  if (process.platform !== "darwin" || !session) return resolve();
  exec(
    `osascript -e 'tell application "Google Chrome" to return {URL of active tab of front window, title of active tab of front window}'`,
    (err, stdout) => {
      if (err || !stdout) return resolve();
      const parts = stdout.trim().split(", ");
      const url   = parts[0] || "";
      const title = parts.slice(1).join(", ") || url;
      if (!url || url === "about:blank") return resolve();

      const now = Date.now();

      // Cambio de página: cerrar la anterior
      if (currentChromeUrl && currentChromeUrl !== url) {
        if (chromePages[currentChromeUrl]) {
          chromePages[currentChromeUrl].totalMs += now - chromePages[currentChromeUrl].lastSeen;
        }
      }

      // Abrir / actualizar la página actual
      if (!chromePages[url]) {
        chromePages[url] = { title, url, firstSeen: now, lastSeen: now, totalMs: 0 };
      } else {
        chromePages[url].lastSeen = now;
      }

      currentChromeUrl = url;

      // Tope de memoria en el objeto FUENTE (no solo en lo serializado):
      // sin esto, chromePages crece una entrada por cada URL única durante
      // toda la vida del proceso. Conservamos las 200 de mayor tiempo.
      const claves = Object.keys(chromePages);
      if (claves.length > 200) {
        claves.sort((a, b) => (chromePages[b].totalMs || 0) - (chromePages[a].totalMs || 0))
          .slice(200)
          .forEach(k => { if (k !== currentChromeUrl) delete chromePages[k]; });
      }

      // Guardar en sesión
      // Limitar a 50 páginas más visitadas para evitar fuga de memoria
      session.chromePages = Object.values(chromePages)
        .sort((a,b) => b.totalMs - a.totalMs).slice(0, 50)
        .map(p => ({
        title:    p.title,
        url:      p.url,
        firstSeen: new Date(p.firstSeen).toLocaleTimeString("es-MX"),
        totalMs:   p.totalMs + (p.url === currentChromeUrl ? now - p.lastSeen : 0),
        duration:  fmt(p.totalMs + (p.url === currentChromeUrl ? now - p.lastSeen : 0)),
      }));
      resolve();
    }
  );
}); }

ipcMain.on("input-events", (_, data) => {
  if (!session || session.status !== "active") return;
  session.clicks     = (session.clicks     || 0) + (data.clicks     || 0);
  session.keyPresses = (session.keyPresses || 0) + (data.keyPresses || 0);
  session.scrolls    = (session.scrolls    || 0) + (data.scrolls    || 0);
});

ipcMain.handle("get-tracking", () => ({
  apps:        session?.appLog     || [],
  chromePages: session?.chromePages || [],
}));

// ── Auth IPC ──────────────────────────────────────────────────────────────────
ipcMain.handle("auth-success", (_, usuario) => {
  loggedUser = usuario;
  save("logged_user.json", usuario);
  loadDashboard(usuario.rol);
  return { ok: true };
});

ipcMain.handle("auth-logout", () => {
  loggedUser = null;
  remove("logged_user.json");
  // Detener TODO el tracking: hook global, flush, intervalo de apps y overlays.
  // Sin esto los listeners se acumulaban en cada re-login (clics contados por
  // duplicado) y el hook seguía activo con la app en el login.
  clearInterval(idleTimer);
  idleTimer = null;
  stopActivityTracking();
  closeIdleOverlay();
  applyWindowSize("login");
  loadView("login.html");
  return { ok: true };
});

ipcMain.handle("get-logged-user", () => loggedUser);

// ── Google Sheets sync ────────────────────────────────────────────────────────
// Usa https nativo para manejar los redirects de Google Apps Script manualmente
// El destino se restringe a Google Apps Script. Este canal envía datos del
// pedido (incluidas contraseñas) desde el proceso principal con el módulo
// https de Node, o sea FUERA del alcance de la CSP: sin allowlist, cualquier
// XSS podría usarlo para exfiltrar, y un redirect malicioso del webhook
// reenviaría el mismo POST a un host arbitrario (SSRF).
const HOSTS_WEBHOOK = ["script.google.com", "script.googleusercontent.com"];
function destinoPermitido(u) {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === "https:" && HOSTS_WEBHOOK.some(h => hostname === h || hostname.endsWith("." + h));
  } catch { return false; }
}

ipcMain.handle("sync-pedido", async (_, { url, payload }) => {
  if (!url) return { ok: false, reason: "no_url" };
  if (!destinoPermitido(url)) {
    console.warn("[sheets-sync] destino no permitido:", String(url).slice(0, 80));
    return { ok: false, reason: "destino_no_permitido" };
  }
  const https = require("https");
  const body  = JSON.stringify(payload);

  function doPost(targetUrl, redirectsLeft) {
    return new Promise((resolve) => {
      try {
        if (!destinoPermitido(targetUrl)) {
          return resolve({ ok: false, reason: "redirect_no_permitido" });
        }
        const u = new URL(targetUrl);
        const opts = {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type":   "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        };
        const req = https.request(opts, (res) => {
          // Google Apps Script redirige: seguir el redirect con POST
          if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) && res.headers.location && redirectsLeft > 0) {
            res.resume();
            resolve(doPost(res.headers.location, redirectsLeft - 1));
            return;
          }
          let data = "";
          res.on("data", (c) => { data += c; });
          res.on("end", () => {
            try { resolve(JSON.parse(data)); }
            catch { resolve({ ok: true }); }
          });
        });
        req.on("error", (e) => {
          console.error("[sheets-sync]", e.message);
          resolve({ ok: false, error: e.message });
        });
        req.write(body);
        req.end();
      } catch(e) {
        console.error("[sheets-sync]", e.message);
        resolve({ ok: false, error: e.message });
      }
    });
  }

  return doPost(url, 5);
});

// ── Ciclo de vida ─────────────────────────────────────────────────────────────
// ── Auto-actualización del cascarón (electron-updater) ───────────────────────
// Windows: descarga e instala solo. Mac: igual de automático cuando la app
// está firmada/notarizada (Apple Developer); si no está firmada, el updater
// falla sin romper nada y queda el botón "Buscar actualizaciones" manual.
function initAutoUpdater() {
  if (process.platform !== "win32" && process.platform !== "darwin") return;

  // El instalador de macOS va firmado con Developer ID y notarizado: el propio
  // sistema verifica la autenticidad del publicador, así que la instalación
  // automática es segura.
  //
  // El instalador de Windows AÚN NO está firmado con Authenticode.
  // electron-updater solo compara el hash contra latest.yml, que viaja en el
  // mismo release: quien lograra publicar un release podría instalar código
  // arbitrario y en silencio en todos los equipos Windows. Hasta contar con
  // certificado de firma, en Windows solo se AVISA y se abre la página de
  // descarga; el usuario instala a mano y ve el nombre del publicador.
  const firmaVerificable = process.platform === "darwin";

  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = firmaVerificable;
    autoUpdater.autoInstallOnAppQuit = firmaVerificable;

    if (!firmaVerificable) {
      autoUpdater.on("update-available", (info) => {
        dialog.showMessageBox(win, {
          type: "info",
          title: "Hay una versión nueva",
          message: `Está disponible la versión ${info.version}.`,
          detail: "Descárgala e instálala cuando puedas. La instalación es manual mientras el instalador de Windows no esté firmado.",
          buttons: ["Después", "Ir a la descarga"],
          defaultId: 1,
        }).then(({ response }) => {
          if (response === 1) {
            shell.openExternal("https://github.com/balamentbiz/academic-tareas-monitor/releases/latest");
          }
        });
      });
    } else {
      autoUpdater.on("update-downloaded", (info) => {
        dialog.showMessageBox(win, {
          type: "info",
          title: "Actualización lista",
          message: `Nueva versión ${info.version} descargada.`,
          detail: "Se instalará al cerrar la aplicación, o puedes reiniciar ahora.",
          buttons: ["Al cerrar", "Reiniciar ahora"],
          defaultId: 0,
        }).then(({ response }) => {
          if (response === 1) autoUpdater.quitAndInstall();
        });
      });
    }

    autoUpdater.on("error", (e) => console.log("[updater]", e?.message || e));
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000); // cada 4 h
  } catch (e) { console.log("[updater no disponible]", e.message); }
}

app.whenReady().then(() => { createWindow(); initAutoUpdater(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length===0) createWindow(); else win?.show(); });

// Cerrar la ventana = cerrar la aplicación, TAMBIÉN en macOS.
// El comportamiento normal de macOS (dejar la app viva en el Dock) hacía que
// la sesión siguiera "activa" durante horas después de que el colaborador creía
// haberla cerrado, inflando la duración de la jornada.
app.on("window-all-closed", () => app.quit());
