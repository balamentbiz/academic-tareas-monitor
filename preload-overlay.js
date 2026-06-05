const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("overlayAPI", {
  resume: (reason) => ipcRenderer.send("idle-overlay-resume", reason),
});
