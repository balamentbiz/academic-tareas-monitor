const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("AT", {
  // ── Sesión (asesor) ───────────────────────────────────────────────────────
  getStatus:        ()     => ipcRenderer.invoke("get-status"),
  startDay:         (d)    => ipcRenderer.invoke("start-day", d),
  pauseSession:     (d)    => ipcRenderer.invoke("pause-session", d),
  resumeSession:    ()     => ipcRenderer.invoke("resume-session"),
  endDay:           (d)    => ipcRenderer.invoke("end-day", d),
  reportDownloaded: ()     => ipcRenderer.invoke("report-downloaded"),
  startActivity:    (d)    => ipcRenderer.invoke("start-activity", d),
  endActivity:      ()     => ipcRenderer.invoke("end-activity"),
  idleEnded:        (d)    => ipcRenderer.invoke("idle-ended", d),
  openBlackboard:   ()     => ipcRenderer.invoke("open-blackboard"),
  openDrive:        ()     => ipcRenderer.invoke("open-drive"),
  saveReportFile:   (d)    => ipcRenderer.invoke("save-report-file", d),
  saveReportImage:  (d)    => ipcRenderer.invoke("save-report-image", d),
  getTracking:      ()     => ipcRenderer.invoke("get-tracking"),
  onShowIdle:       (cb)   => ipcRenderer.on("show-idle", cb),
  onSessionTick:      (cb) => ipcRenderer.on("session-tick",    (_, data) => cb(data)),
  onUpdateProgress:   (cb) => ipcRenderer.on("update-progress", (_, data) => cb(data)),
  onUpdateLog:        (cb) => ipcRenderer.on("update-log",      (_, data) => cb(data)),
  onGlobalEvent:    (cb)   => ipcRenderer.on("global-event", (_, data) => cb(data)),
  getVersion:       ()     => ipcRenderer.invoke("get-version"),
  checkForUpdates:  ()     => ipcRenderer.invoke("check-for-updates"),
  openUrl:          (url)  => ipcRenderer.invoke("open-url", url),
  quitApp:          ()     => ipcRenderer.send("quit-app"),
  uninstallApp:     ()     => ipcRenderer.invoke("uninstall-app"),
  sendInputEvents:  (d)    => ipcRenderer.send("input-events", d),

  // ── Auth ──────────────────────────────────────────────────────────────────
  // El renderer (login.html) llama esto tras hacer signIn en Firebase
  authSuccess:      (user) => ipcRenderer.invoke("auth-success", user),
  authLogout:       ()     => ipcRenderer.invoke("auth-logout"),
  getLoggedUser:    ()     => ipcRenderer.invoke("get-logged-user"),

  // ── Google Sheets sync ────────────────────────────────────────────────────
  // url: webhook URL de Apps Script; payload: datos del pedido
  syncPedido:       (d)    => ipcRenderer.invoke("sync-pedido", d),
});
