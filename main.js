const { app, BrowserWindow, ipcMain, powerMonitor, shell, dialog } = require("electron");
const path  = require("path");
const fs    = require("fs");
const { exec } = require("child_process");

// Capturar errores globales silenciosamente
process.on("uncaughtException",  (e) => console.error("[error silenciado]", e.message));
process.on("unhandledRejection", (e) => console.error("[promesa sin catch]", e?.message || e));

// ── Auto-actualizador ─────────────────────────────────────────────────────────
let autoUpdater = null;
try {
  autoUpdater = require("electron-updater").autoUpdater;
  autoUpdater.logger = null; // silencioso
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("download-progress", (p) => {
    safeSend("update-progress", { percent: Math.round(p.percent) });
  });

  autoUpdater.on("update-downloaded", () => {
    safeSend("update-progress", { percent: 100, done: true });
    dialog.showMessageBox(win, {
      type: "info",
      title: "✓ Actualización lista",
      message: "Hay una nueva versión de Academic Tareas Monitor.",
      detail: "La actualización se instalará al cerrar la aplicación.",
      buttons: ["Instalar ahora", "Más tarde"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on("error", (e) => {
    console.error("AutoUpdater error:", e.message);
    safeSend("update-progress", { error: true, message: e.message });
  });
} catch (_) {
  // electron-updater no disponible en desarrollo
}

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
let session = load("current.json");
let win     = null;
let idleTimer = null;

// Envío seguro — nunca crashea si la ventana fue destruida
function safeSend(channel, data) {
  try {
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed())
      win.webContents.send(channel, data);
  } catch (_) {}
}

// ── Ventana ────────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width: 400, height: 750,
    minWidth: 360, minHeight: 550,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Revisar actualizaciones 5s después de abrir (sin molestar al arranque)
  if (autoUpdater) setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(()=>{}), 5000);

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
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });

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
  if (!autoUpdater) return { status: "no-updater" };
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result && result.updateInfo) {
      const current = app.getVersion();
      const latest  = result.updateInfo.version;
      if (latest !== current) {
        return { status: "available", current, latest };
      } else {
        return { status: "up-to-date", current };
      }
    }
    return { status: "up-to-date", current: app.getVersion() };
  } catch (e) {
    return { status: "error", message: e.message };
  }
});
ipcMain.on("quit-app", () => app.quit());

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

  const { execSync } = require("child_process");
  const dataDir = app.getPath("userData");

  // Eliminar datos de usuario
  try { execSync(`rm -rf "${dataDir}"`); } catch (_) {}

  // Eliminar la app de /Applications/
  try { execSync(`rm -rf "/Applications/Academic Tareas Monitor.app"`); } catch (_) {}

  // Eliminar preferencias
  try { execSync(`rm -f "$HOME/Library/Preferences/com.academictareas.monitor.plist"`); } catch (_) {}

  await dialog.showMessageBox(win, {
    type: "info",
    title: "Desinstalación completada",
    message: "Academic Tareas Monitor ha sido desinstalado.",
    detail: "Puedes eliminar la carpeta MONITOREO APP de tu Escritorio manualmente si lo deseas.",
    buttons: ["OK"],
  });

  app.quit();
  return { ok: true };
});

ipcMain.handle("open-blackboard", () => shell.openExternal("https://uvmonline.blackboard.com/webapps/login/?action=default_login"));
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
let overlayWin       = null;

function showIdleOverlay() {
  if (overlayWin) return; // ya está abierta
  const { screen } = require("electron");
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  overlayWin = new BrowserWindow({
    width, height,
    x: 0, y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, "preload-overlay.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  overlayWin.loadFile(path.join(__dirname, "renderer", "overlay.html"));
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.focus();

  overlayWin.on("closed", () => { overlayWin = null; });
}

function closeIdleOverlay() {
  if (overlayWin) { overlayWin.close(); overlayWin = null; }
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

function startActivityPolling() {
  // Intentar usar uiohook-napi para eventos globales del sistema
  try {
    const { uIOhook } = require("uiohook-napi");

    // Acumuladores locales — flush cada 800ms para no saturar IPC
    let _pendingClicks = 0, _pendingKeys = 0;

    const flushEvents = () => {
      if (!session || session.status !== "active") return;
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
    setInterval(flushEvents, 800);

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
    setInterval(() => {
      if (!session || session.status !== "active") return;
      const idleMs = powerMonitor.getSystemIdleTime() * 1000;
      if (idleMs < _lastIdleMs - 300) _activityEvents++;
      _lastIdleMs = idleMs;
    }, 300);
  }
}

const TRACK_INTERVAL_MS = 10000; // 10 segundos

function startAppTracking() {
  clearInterval(trackInterval);
  trackInterval = setInterval(() => {
    if (!session || session.status !== "active") return;

    // ── Acumular tiempo activo / inactivo ────────────────────────────────────
    const idleSecs = powerMonitor.getSystemIdleTime();
    if (idleSecs < 60) {
      session.totalActiveMs = (session.totalActiveMs || 0) + TRACK_INTERVAL_MS;
    } else {
      session.totalIdleMs = (session.totalIdleMs || 0) + TRACK_INTERVAL_MS;
    }

    // Ejecutar en paralelo — no bloquear uno por el otro
    Promise.all([trackApps(), trackChrome()]).then(() => {
      save("current.json", session);
    });

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
function trackApps() { return new Promise(resolve => {
  exec(
    `osascript -e 'tell application "System Events" to get name of every process whose background only is false'`,
    (err, stdout) => {
      if (err || !stdout) return;
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
  exec(
    `osascript -e 'tell application "Google Chrome" to return {URL of active tab of front window, title of active tab of front window}'`,
    (err, stdout) => {
      if (err || !stdout) return;
      const parts = stdout.trim().split(", ");
      const url   = parts[0] || "";
      const title = parts.slice(1).join(", ") || url;
      if (!url || url === "about:blank") return;

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

// ── Ciclo de vida ─────────────────────────────────────────────────────────────
app.whenReady().then(createWindow);
app.on("activate", () => { if (BrowserWindow.getAllWindows().length===0) createWindow(); else win?.show(); });
app.on("window-all-closed", () => { if (process.platform!=="darwin") app.quit(); });
