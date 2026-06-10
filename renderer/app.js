/* app.js — Academic Tareas Monitor */
"use strict";

// ── Utilidades ────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function fmt(ms) {
  if (!ms || ms < 0) return "0s";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts = [];
  if (h > 0) parts.push(h + "h");
  if (m > 0) parts.push(m + "m");
  parts.push(sec + "s");
  return parts.join(" ");
}

function buildFileName(r, ext) {
  const name = (r.meta.collaborator || "colaborador")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "_").replace(/[^a-zA-Z0-9_]/g, "");
  const now = new Date();
  const dd  = String(now.getDate()).padStart(2, "0");
  const mm  = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return "Reporte_" + name + "_" + dd + "-" + mm + "-" + yyyy + "." + ext;
}

// ── Bridge Electron / Navegador ───────────────────────────────────────────────
// Si window.AT no existe (modo navegador), lo creamos con localStorage
var _browserMode = (typeof window.AT === "undefined");
if (_browserMode) {
  window.AT = makeBrowserAT();
}

function makeBrowserAT() {
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function save(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
  function del(k)  { localStorage.removeItem(k); }

  return {
    getStatus: function() {
      return Promise.resolve({ session: load("currentSession"), pendingReport: load("pendingReport") });
    },
    startDay: function(d) {
      const now = Date.now();
      const s = { id: "s_" + now, collaborator: d.collaborator,
        date: new Date(now).toISOString().split("T")[0],
        startTime: now, endTime: null, status: "active",
        pauses: [], pages: [], activities: [], idlePeriods: [],
        currentActivityId: null, currentIdleStart: null,
        totalActiveMs: 0, totalIdleMs: 0, totalPausedMs: 0, totalClicks: 0,
        comments: "", _lastActivityTs: now };
      save("currentSession", s);
      return Promise.resolve({ ok: true });
    },
    pauseSession: function(d) {
      const s = load("currentSession");
      if (!s) return Promise.resolve({ ok: false });
      const now = Date.now();
      s.status = "paused";
      s.pauses.push({ id: "p_" + now, reason: d.reason || "pausa", startTime: now, endTime: null });
      save("currentSession", s);
      return Promise.resolve({ ok: true });
    },
    resumeSession: function() {
      const s = load("currentSession");
      if (!s) return Promise.resolve({ ok: false });
      const now = Date.now();
      const last = s.pauses[s.pauses.length - 1];
      if (last && !last.endTime) { last.endTime = now; s.totalPausedMs = (s.totalPausedMs || 0) + (now - last.startTime); }
      s.status = "active"; s._lastActivityTs = now;
      save("currentSession", s);
      return Promise.resolve({ ok: true });
    },
    endDay: function(d) {
      const s = load("currentSession");
      if (!s) return Promise.resolve({ ok: false });
      const now = Date.now();
      s.endTime = now; s.status = "finished"; s.comments = d.comments || "";
      const report = buildReport(s);
      const hist = load("history") || []; hist.push(s); save("history", hist);
      del("currentSession"); save("pendingReport", report);
      return Promise.resolve({ ok: true, report: report });
    },
    reportDownloaded: function() { del("pendingReport"); return Promise.resolve({ ok: true }); },
    startActivity: function(d) {
      const s = load("currentSession"); if (!s) return Promise.resolve({ ok: false });
      const now = Date.now();
      if (s.currentActivityId) {
        const prev = s.activities.find(function(a) { return a.id === s.currentActivityId; });
        if (prev && !prev.endTime) { prev.endTime = now; prev.durationMs = now - prev.startTime; }
      }
      const id = "act_" + now;
      s.activities.push({ id: id, name: d.name, startTime: now, endTime: null, durationMs: null });
      s.currentActivityId = id; save("currentSession", s);
      return Promise.resolve({ ok: true, activityId: id, startTime: now });
    },
    endActivity: function() {
      const s = load("currentSession");
      if (!s || !s.currentActivityId) return Promise.resolve({ ok: false });
      const now = Date.now();
      const act = s.activities.find(function(a) { return a.id === s.currentActivityId; });
      if (act && !act.endTime) { act.endTime = now; act.durationMs = now - act.startTime; }
      s.currentActivityId = null; save("currentSession", s);
      return Promise.resolve({ ok: true, activity: act });
    },
    idleEnded: function(d) {
      const s = load("currentSession"); if (!s) return Promise.resolve({ ok: false });
      const now = Date.now();
      if (s.currentIdleStart) {
        const dur = now - s.currentIdleStart;
        s.idlePeriods.push({ startTime: s.currentIdleStart, endTime: now, durationMs: dur, reason: d.reason || "(sin motivo)" });
        s.totalIdleMs = (s.totalIdleMs || 0) + dur; s.currentIdleStart = null;
      }
      s._lastActivityTs = now; save("currentSession", s);
      return Promise.resolve({ ok: true });
    },
    openBlackboard: function() { window.open("https://uvmonline.blackboard.com/webapps/login/?action=default_login", "_blank"); return Promise.resolve(); },
    openDrive:      function() { window.open("https://drive.google.com/drive/folders/1lL0EXrghttyvTjTR8PEevsRu09R6qk3U?usp=drive_link", "_blank"); return Promise.resolve(); },
    saveReportFile: function(d) {
      const blob = new Blob([d.content], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = d.filename; a.click();
      return Promise.resolve({ ok: true });
    },
    onShowIdle: function(cb) { window._atIdleCb = cb; }
  };
}

// ── Idle local (solo navegador) ───────────────────────────────────────────────
if (_browserMode) {
  var _lastAct = Date.now();
  document.addEventListener("click",     function() { _lastAct = Date.now(); }, { passive: true });
  document.addEventListener("mousemove", function() { _lastAct = Date.now(); }, { passive: true });
  document.addEventListener("keydown",   function() { _lastAct = Date.now(); }, { passive: true });
  setInterval(function() {
    if (Date.now() - _lastAct >= 60000 && window._atIdleCb) {
      var s = (function() { try { return JSON.parse(localStorage.getItem("currentSession")); } catch(e) { return null; } })();
      if (s && s.status === "active") window._atIdleCb();
    }
  }, 10000);
}

// ── Generador de reporte ──────────────────────────────────────────────────────
function buildReport(s) {
  var totalMs = ((s.endTime || Date.now()) - s.startTime);
  var workMs  = totalMs - (s.totalPausedMs || 0);
  return {
    meta: { sessionId: s.id, collaborator: s.collaborator, date: s.date, generatedAt: new Date().toISOString() },
    summary: {
      startTime:        new Date(s.startTime).toLocaleTimeString("es-MX"),
      endTime:          s.endTime ? new Date(s.endTime).toLocaleTimeString("es-MX") : "—",
      totalDuration:    fmt(totalMs),
      activeTime:       fmt(s.totalActiveMs || 0),
      idleTime:         fmt(s.totalIdleMs   || 0),
      pausedTime:       fmt(s.totalPausedMs || 0),
      totalClicks:      s.totalClicks || 0,
      totalActivities:  (s.activities  || []).length,
      totalIdlePeriods: (s.idlePeriods || []).length,
      productivityPct:  workMs > 0 ? Math.round(((s.totalActiveMs || 0) / workMs) * 100) : 0
    },
    activities:  (s.activities  || []).map(function(a, i) { return { number: i+1, name: a.name, startTime: new Date(a.startTime).toLocaleTimeString("es-MX"), endTime: a.endTime ? new Date(a.endTime).toLocaleTimeString("es-MX") : "en curso", duration: a.durationMs ? fmt(a.durationMs) : "en curso" }; }),
    pauses:      (s.pauses      || []).map(function(p)    { return { reason: p.reason, start: new Date(p.startTime).toLocaleTimeString("es-MX"), end: p.endTime ? new Date(p.endTime).toLocaleTimeString("es-MX") : "—", duration: p.endTime ? fmt(p.endTime - p.startTime) : "—" }; }),
    idlePeriods: (s.idlePeriods || []).map(function(ip,i) { return { number: i+1, start: new Date(ip.startTime).toLocaleTimeString("es-MX"), end: ip.endTime ? new Date(ip.endTime).toLocaleTimeString("es-MX") : "—", duration: ip.durationMs ? fmt(ip.durationMs) : "—", reason: ip.reason || "(sin motivo)" }; }),
    pages:       (s.pages       || []).map(function(p, i) { return { number: i+1, title: p.title || "(sin título)", url: p.url || "", openedAt: new Date(p.openedAt).toLocaleTimeString("es-MX"), closedAt: p.closedAt ? new Date(p.closedAt).toLocaleTimeString("es-MX") : "—", duration: p.durationMs ? fmt(p.durationMs) : "—", clicks: p.clicks || 0 }; }),
    appsOpened:  (s.appLog      || []).map(function(a)    { return { name: a.name, openedAt: a.ts }; }),
    comments:    s.comments || ""
  };
}

// ── Estado UI ─────────────────────────────────────────────────────────────────
var tickInt = null, pauseTickInt = null, actTickInt = null, idleCounterInt = null;
var currentReport = null, pauseStartTs = null, actStartTs = null;
var selectedReason = "", canResumeIdle = false, idleShown = false;

var views = { idle: el("view-idle"), active: el("view-active"), paused: el("view-paused"), report: el("view-report") };

function showView(name) {
  Object.keys(views).forEach(function(k) { views[k].classList.add("hidden"); });
  if (views[name]) views[name].classList.remove("hidden");
}

// ── Init ──────────────────────────────────────────────────────────────────────
window.AT.getStatus().then(function(data) {
  var session = data.session;
  var pendingReport = data.pendingReport;

  if (pendingReport) {
    currentReport = pendingReport;
    renderReport(pendingReport);
    showView("report");
    lockNewSession(true);
    return;
  }
  if (!session) {
    showView("idle");
    var saved = localStorage.getItem("collaboratorName");
    if (saved) el("collaborator-name").value = saved;
    return;
  }
  if (session.status === "active")  { showView("active");  startTick(session); }
  if (session.status === "paused")  { showView("paused");  showPauseInfo(session); startPauseTick(); }
}).catch(function(e) { console.error("init error", e); showView("idle"); });

window.AT.onShowIdle(function() { showIdleOverlay(); });

// Log de instalación para diagnóstico
if (window.AT.onUpdateLog) {
  window.AT.onUpdateLog(function(data) {
    console.log("Update install log:", data.log);
  });
}

// Progreso de descarga de actualización
if (window.AT.onUpdateProgress) {
  window.AT.onUpdateProgress(function(data) {
    var btn = el("btn-check-update");
    if (!btn) return;
    if (data.error) {
      btn.textContent = "⚠ " + (data.message || "Error al descargar");
      btn.style.color = "#ff9f0a";
      btn.disabled = false;
      console.error("Update error:", data.message);
      setTimeout(function() { btn.textContent = "🔄 Buscar actualizaciones"; btn.style.color = ""; }, 6000);
    } else if (data.done) {
      btn.textContent = "✓ Lista — reinicia para instalar";
      btn.style.color = "#32d74b";
      btn.disabled = false;
    } else {
      btn.textContent = "⬇ Descargando " + data.percent + "%...";
      btn.style.color = "#09a3ef";
    }
  });
}

// Mostrar versión en el título
if (window.AT.getVersion) {
  window.AT.getVersion().then(function(v) {
    var el = document.getElementById("app-version");
    if (el) el.textContent = "v" + v;
  }).catch(function(){});
}

// ── Animación de bump en contadores ──────────────────────────────────────────
function bumpCounter(elId) {
  var e = el(elId); if (!e) return;
  e.classList.remove("bump");
  void e.offsetWidth;
  e.classList.add("bump");
  setTimeout(function() { e.classList.remove("bump"); }, 180);
}

// ── Eventos globales del sistema → actualizar clics y teclas ─────────────────
if (window.AT.onGlobalEvent) {
  window.AT.onGlobalEvent(function(data) {
    if (data.type === "click") {
      if (el("cnt-clicks")) { el("cnt-clicks").textContent = data.clicks; bumpCounter("cnt-clicks"); }
    } else if (data.type === "key") {
      if (el("cnt-keys")) { el("cnt-keys").textContent = data.keyPresses; bumpCounter("cnt-keys"); }
    }
  });
}

// ── Tick del main → actualizar contadores de pausas y actividades ─────────────
var _lastIdle = 0, _lastActivities = 0, _lastActiveMs = 0, _lastIdleMs = 0;

if (window.AT.onSessionTick) {
  window.AT.onSessionTick(function(data) {
    _lastActiveMs = data.totalActiveMs || 0;
    _lastIdleMs   = data.totalIdleMs   || 0;
    var i = data.idleCount       || 0;
    var a = data.activitiesCount || 0;
    if (i !== _lastIdle)        { if (el("cnt-idle"))       { el("cnt-idle").textContent       = i; bumpCounter("cnt-idle"); }       _lastIdle = i; }
    if (a !== _lastActivities)  { if (el("cnt-activities")) { el("cnt-activities").textContent = a; bumpCounter("cnt-activities"); } _lastActivities = a; }
  });
}

// ── Tick del main process → actualizar activo/inactivo/eventos ────────────────
var _lastActiveMs = 0, _lastIdleMs = 0;

if (window.AT.onSessionTick) {
  window.AT.onSessionTick(function(data) {
    _lastActiveMs = data.totalActiveMs || 0;
    _lastIdleMs   = data.totalIdleMs   || 0;
    if (el("cnt-events")) el("cnt-events").textContent = data.activityEvents || 0;
  });
}

// ── Timer de 1 segundo — corre completamente en el renderer ──────────────────
var _sessionStartTime = null;

// Cache de refs DOM — evita querySelector en cada tick
var _elElapsed = null, _elActive = null, _elIdle = null;

function startSecondTick() {
  if (_secTickInt) clearInterval(_secTickInt);
  // Cachear referencias DOM una sola vez
  _elElapsed = el("stat-elapsed");
  _elActive  = el("stat-active");
  _elIdle    = el("stat-idle");

  _secTickInt = setInterval(function() {
    if (!_sessionStartTime) return;
    var elapsed = Date.now() - _sessionStartTime;
    if (_elElapsed) _elElapsed.textContent = fmt(elapsed);
    if (_elActive)  _elActive.textContent  = fmt(_lastActiveMs);
    if (_elIdle)    _elIdle.textContent    = fmt(_lastIdleMs);
  }, 1000);
}
var _secTickInt = null;

// ── Chips de pausa ────────────────────────────────────────────────────────────
var reasonChips = document.querySelectorAll("#reason-chips .chip");
reasonChips.forEach(function(c) {
  c.addEventListener("click", function() {
    reasonChips.forEach(function(x) { x.classList.remove("selected"); });
    c.classList.add("selected");
    selectedReason = c.dataset.val;
    el("pause-reason-input").value = "";
  });
});
el("pause-reason-input").addEventListener("input", function() {
  reasonChips.forEach(function(c) { c.classList.remove("selected"); });
  selectedReason = el("pause-reason-input").value.trim();
});

// ── Chips de idle ─────────────────────────────────────────────────────────────
var idleChips = document.querySelectorAll("#idle-chips .chip");
idleChips.forEach(function(c) {
  c.addEventListener("click", function() {
    idleChips.forEach(function(x) { x.classList.remove("selected"); });
    c.classList.add("selected");
    var v = c.dataset.val;
    var cur = el("idle-reason").value;
    if (cur.indexOf(v) === -1) el("idle-reason").value = v + (cur ? " — " + cur : "");
    validateIdle();
  });
});
el("idle-reason").addEventListener("input", validateIdle);

// ── Botones principales ───────────────────────────────────────────────────────
el("btn-start").addEventListener("click", function() {
  var name = el("collaborator-name").value.trim();
  if (!name) { el("collaborator-name").focus(); return; }
  localStorage.setItem("collaboratorName", name);
  window.AT.startDay({ collaborator: name }).then(function() {
    return window.AT.getStatus();
  }).then(function(d) {
    showView("active");
    startTick(d.session);
  }).catch(function(e) { console.error(e); });
});

el("btn-pause").addEventListener("click", function() {
  var reason = selectedReason || el("pause-reason-input").value.trim() || "Pausa";
  window.AT.pauseSession({ reason: reason }).then(function() {
    stopTick();
    pauseStartTs = Date.now();
    window.AT.getStatus().then(function(d) {
      if (d.session) showPauseInfo(d.session);
      showView("paused");
      startPauseTick();
    });
  });
});

el("btn-resume").addEventListener("click", function() {
  window.AT.resumeSession().then(function() {
    return window.AT.getStatus();
  }).then(function(d) {
    stopPauseTick();
    showView("active");
    startTick(d.session);
  });
});

el("btn-end").addEventListener("click", function() {
  if (!confirm("¿Terminar la sesión y generar el reporte del día?")) return;
  stopTick();
  window.AT.endDay({ comments: "" }).then(function(d) {
    if (!d || !d.report) return;
    currentReport = d.report;
    renderReport(d.report);
    showView("report");
    lockNewSession(true);
  });
});

el("btn-activity-start").addEventListener("click", function() {
  var name = el("activity-name").value.trim();
  if (!name) { el("activity-name").focus(); return; }
  window.AT.startActivity({ name: name }).then(function(d) {
    actStartTs = d.startTime;
    el("activity-name").value = "";
    el("activity-idle-state").classList.add("hidden");
    el("activity-running-state").classList.remove("hidden");
    el("activity-current-name").textContent = name;
    startActTick();
  });
});

el("btn-activity-end").addEventListener("click", function() {
  window.AT.endActivity().then(function() {
    stopActTick();
    el("activity-running-state").classList.add("hidden");
    el("activity-idle-state").classList.remove("hidden");
    window.AT.getStatus().then(function(d) {
      el("activity-count").textContent = d.session && d.session.activities ? d.session.activities.length : 0;
    });
  });
});

el("btn-blackboard").addEventListener("click", function() { window.AT.openBlackboard(); });
el("btn-drive").addEventListener("click", function()      { window.AT.openDrive(); });

el("btn-dl-img").addEventListener("click", function() {
  if (!currentReport) return;
  currentReport.comments = el("report-comments").value;
  var filename = buildFileName(currentReport, "png");
  el("btn-dl-img").textContent = "⏳ Generando...";
  el("btn-dl-img").disabled = true;
  window.AT.saveReportImage({ report: currentReport, filename: filename }).then(function(r) {
    el("btn-dl-img").textContent = r.ok ? "✓ Guardada" : "🖼 Imagen";
    el("btn-dl-img").disabled = false;
    // Desbloquear siempre — imagen generada, con o sin guardar
    lockNewSession(false);
    if (r.ok) window.AT.reportDownloaded();
    setTimeout(function() { el("btn-dl-img").textContent = "🖼 Imagen"; }, 2000);
  }).catch(function() {
    el("btn-dl-img").textContent = "🖼 Imagen";
    el("btn-dl-img").disabled = false;
    lockNewSession(false);
  });
});

// btn-dl-json, btn-dl-txt, btn-copy eliminados del HTML

el("btn-new-session").addEventListener("click", function() {

  // Si aún no se descargó la imagen, disparar la descarga en lugar de nueva sesión
  if (el("btn-new-session").dataset.locked === "true") {
    el("btn-dl-img") && el("btn-dl-img").click();
    return;
  }

  // Limpiar estado de sesión anterior
  currentReport     = null;
  pauseStartTs      = null;
  actStartTs        = null;
  selectedReason    = "";
  _sessionStartTime = null;
  _lastActiveMs     = 0;
  _lastIdleMs       = 0;

  stopTick();
  stopPauseTick();
  stopActTick();

  _lastIdle = 0; _lastActivities = 0;
  // Limpiar contadores en pantalla
  ["cnt-clicks","cnt-keys","cnt-idle","cnt-activities"].forEach(function(id) {
    if (el(id)) el(id).textContent = "0";
  });
  if (el("stat-elapsed")) el("stat-elapsed").textContent = "0s";
  if (el("stat-active"))  el("stat-active").textContent  = "0s";
  if (el("stat-idle"))    el("stat-idle").textContent    = "0s";

  // Limpiar actividad corriendo
  el("activity-running-state").classList.add("hidden");
  el("activity-idle-state").classList.remove("hidden");
  el("activity-name").value = "";

  // Limpiar chips seleccionados
  document.querySelectorAll(".chip").forEach(function(c) { c.classList.remove("selected"); });
  if (el("pause-reason-input")) el("pause-reason-input").value = "";

  // Asegurarse de limpiar el reporte pendiente
  window.AT.reportDownloaded();

  showView("idle");
  var saved = localStorage.getItem("collaboratorName");
  if (saved && el("collaborator-name")) el("collaborator-name").value = saved;
});

el("btn-quit").addEventListener("click", function() {
  window.AT.quitApp();
});

el("btn-quit-idle").addEventListener("click", function() {
  window.AT.quitApp();
});

el("btn-check-update").addEventListener("click", function() {
  var btn = el("btn-check-update");
  btn.textContent = "🔄 Buscando...";
  btn.disabled = true;
  btn.style.opacity = "0.6";

  window.AT.checkForUpdates().then(function(res) {
    btn.disabled = false;
    btn.style.opacity = "";

    if (res.status === "installing") {
      btn.textContent = "⚙ Instalando... la app se reiniciará sola";
      btn.style.color = "#09a3ef";
      btn.disabled = true;
    } else if (res.status === "up-to-date") {
      btn.textContent = "✓ Ya tienes la versión más reciente";
      btn.style.color = "#32d74b";
      setTimeout(function() {
        btn.textContent = "🔄 Buscar actualizaciones";
        btn.style.color = "";
      }, 3000);
    } else {
      btn.textContent = "⚠ Sin conexión — intenta más tarde";
      btn.style.color = "#ff9f0a";
      setTimeout(function() {
        btn.textContent = "🔄 Buscar actualizaciones";
        btn.style.color = "";
      }, 3000);
    }
  }).catch(function() {
    btn.disabled = false;
    btn.style.opacity = "";
    btn.textContent = "🔄 Buscar actualizaciones";
  });
});

el("btn-uninstall").addEventListener("click", function() {
  window.AT.uninstallApp();
});

el("btn-resume-idle").addEventListener("click", function() {
  if (!canResumeIdle) return;
  clearInterval(idleCounterInt);
  window.AT.idleEnded({ reason: el("idle-reason").value.trim() }).then(function() {
    hideIdleOverlay();
  });
});

// ── Idle overlay ──────────────────────────────────────────────────────────────
function showIdleOverlay() {
  if (idleShown) return;
  idleShown = true;
  el("idle-overlay").classList.remove("hidden");
  el("idle-reason").value = "";
  idleChips.forEach(function(c) { c.classList.remove("selected"); });
  canResumeIdle = false;
  el("btn-resume-idle").classList.remove("ready");
  var t0 = Date.now();
  idleCounterInt = setInterval(function() {
    var s = Math.floor((Date.now() - t0) / 1000);
    var counter = el("idle-counter");
    if (counter) counter.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }, 1000);
}

function hideIdleOverlay() {
  clearInterval(idleCounterInt);
  el("idle-overlay").classList.add("hidden");
  idleShown = false;
}

function validateIdle() {
  var val = el("idle-reason").value.trim();
  var ok  = val.length >= 10;
  canResumeIdle = ok;
  el("btn-resume-idle").classList.toggle("ready", ok);
  el("idle-hint").textContent  = ok ? "✓ Listo — puedes reanudar" : ("Faltan " + Math.max(0, 10 - val.length) + " caracteres");
  el("idle-hint").style.color  = ok ? "#32d74b" : "";
}

// ── Ticks ─────────────────────────────────────────────────────────────────────
function startTick(session) {
  if (session) {
    _sessionStartTime = session.startTime;
    _lastActiveMs = session.totalActiveMs || 0;
    _lastIdleMs   = session.totalIdleMs   || 0;
    if (el("stat-start")) el("stat-start").textContent = new Date(session.startTime).toLocaleTimeString("es-MX");
    el("activity-count") && (el("activity-count").textContent = (session.activities || []).length);
  }
  startSecondTick();
  // El tick pesado (IPC getStatus) ya no es necesario — los datos llegan por onSessionTick
  // Solo actualizamos el contador de actividades cuando el usuario añade una
}
function stopTick() { clearInterval(tickInt); clearInterval(_secTickInt); _secTickInt = null; }

function updateActive(s) {
  if (!s) return;
  _sessionStartTime = s.startTime;
  _lastActiveMs = s.totalActiveMs || 0;
  _lastIdleMs   = s.totalIdleMs   || 0;
  if (el("stat-start")) el("stat-start").textContent = new Date(s.startTime).toLocaleTimeString("es-MX");
  if (el("activity-count")) el("activity-count").textContent = s.activities ? s.activities.length : 0;
}

function startPauseTick() {
  pauseTickInt = setInterval(function() {
    if (!pauseStartTs) return;
    el("pause-elapsed").textContent = fmt(Date.now() - pauseStartTs);
  }, 1000);
}
function stopPauseTick() { clearInterval(pauseTickInt); }

function startActTick() {
  stopActTick();
  actTickInt = setInterval(function() {
    if (!actStartTs) return;
    el("activity-timer").textContent = fmt(Date.now() - actStartTs);
  }, 1000);
}
function stopActTick() { clearInterval(actTickInt); }

function showPauseInfo(s) {
  var last = s.pauses && s.pauses[s.pauses.length - 1];
  el("pause-reason-display").textContent = last ? last.reason : "—";
  el("stat-active-p").textContent        = fmt(s.totalActiveMs || 0);
  el("stat-paused-total").textContent    = fmt(s.totalPausedMs || 0);
}

function lockNewSession(locked) {
  var btn = el("btn-new-session");
  btn.dataset.locked   = locked ? "true" : "false";
  btn.textContent      = locked ? "⬇ Descarga la imagen primero" : "+ Nueva sesión";
  btn.style.color      = locked ? "#ff9f0a" : "";
  btn.style.fontWeight = locked ? "700" : "";
}

// ── Render reporte ─────────────────────────────────────────────────────────────
function renderReport(r) {
  var html = "";
  var summary     = r.summary     || {};
  var activities  = r.activities  || [];
  var pauses      = r.pauses      || [];
  var idlePeriods = r.idlePeriods || [];
  var pages       = r.pages       || [];
  var appsOpened  = r.appsOpened  || [];
  var chromePages = r.chromePages || [];

  // Actividades
  if (activities.length > 0) {
    html += '<span class="rsec">📋 Actividades (' + activities.length + ')</span>';
    activities.forEach(function(a) {
      html += '<div style="background:rgba(50,215,75,.06);border-left:3px solid #32d74b;padding:5px 8px;margin:3px 0;border-radius:0 6px 6px 0;font-size:11px">';
      html += '<strong style="color:#32d74b">' + a.number + '. ' + a.name + '</strong><br>';
      html += '<span style="color:#87b1ea">▶ ' + a.startTime + ' → ■ ' + a.endTime + ' · ' + a.duration + '</span></div>';
    });
  } else {
    html += '<span style="color:rgba(135,177,234,.4);font-size:12px">Sin actividades</span>';
  }

  // Resumen
  html += '<span class="rsec">Resumen</span>';
  html += '<strong>Colaborador:</strong> ' + r.meta.collaborator + '<br>';
  html += '<strong>Fecha:</strong> ' + r.meta.date + '<br>';
  html += '<strong>Entrada:</strong> ' + summary.startTime + ' &nbsp;|&nbsp; <strong>Salida:</strong> ' + summary.endTime + '<br>';
  html += '<strong>Activo:</strong> ' + summary.activeTime + ' &nbsp;|&nbsp; <strong>Inactivo:</strong> ' + summary.idleTime + '<br>';
  html += '<strong>Clics:</strong> ' + (summary.clicks || 0) + ' &nbsp;|&nbsp; <strong>Teclas:</strong> ' + (summary.keyPresses || 0) + '<br>';
  html += '<strong>T. muertos:</strong> ' + (summary.totalIdlePeriods || 0) + ' &nbsp;|&nbsp; <strong>Actividades:</strong> ' + (summary.totalActivities || 0) + ' &nbsp;|&nbsp; <strong>Productividad:</strong> ' + summary.productivityPct + '%';

  // Pausas
  if (pauses.length > 0) {
    html += '<span class="rsec">Pausas</span>';
    pauses.forEach(function(p) {
      html += '<strong>' + p.reason + '</strong> ' + p.start + '→' + p.end + ' (' + p.duration + ')<br>';
    });
  }

  // Tiempos muertos
  if (idlePeriods.length > 0) {
    html += '<span class="rsec" style="color:#ff453a">😴 Tiempos muertos (' + idlePeriods.length + ')</span>';
    idlePeriods.forEach(function(ip) {
      html += '<div style="background:rgba(255,69,58,.07);border-left:3px solid #ff453a;padding:4px 8px;margin:2px 0;border-radius:0 4px 4px 0;font-size:11px">';
      html += ip.start + '→' + ip.end + ' · <strong style="color:#ff453a">' + ip.duration + '</strong><br>';
      html += '<span style="color:#87b1ea">Motivo: ' + ip.reason + '</span></div>';
    });
  }

  // Aplicaciones abiertas con tiempo
  if (appsOpened.length > 0) {
    html += '<span class="rsec">💻 Aplicaciones usadas (' + appsOpened.length + ')</span>';
    appsOpened.forEach(function(a) {
      html += '<div style="display:flex;justify-content:space-between;font-size:11px;padding:2px 0">';
      html += '<span style="color:#87b1ea">• ' + a.name + '</span>';
      html += '<span style="color:#09a3ef;font-weight:700">' + (a.duration || "—") + '</span></div>';
    });
  }

  // Páginas Chrome
  if (chromePages.length > 0) {
    html += '<span class="rsec">🌐 Páginas visitadas en Chrome (' + chromePages.length + ')</span>';
    chromePages.slice(0, 10).forEach(function(p) {
      html += '<div style="margin:3px 0;font-size:11px">';
      html += '<div style="display:flex;justify-content:space-between">';
      html += '<strong style="color:#f6f6f6;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + p.title + '</strong>';
      html += '<span style="color:#09a3ef;font-weight:700;flex-shrink:0;margin-left:8px">' + p.duration + '</span></div>';
      html += '<span style="color:rgba(135,177,234,.5);font-size:10px;word-break:break-all">' + p.url + '</span></div>';
    });
  }

  // Páginas (extensión)
  html += '<span class="rsec">Páginas registradas por extensión (' + pages.length + ')</span>';
  var shown = pages.slice(0, 8);
  shown.forEach(function(p, i) {
    if (i > 0) html += '<hr style="border:none;border-top:1px solid rgba(135,177,234,.1);margin:3px 0">';
    html += '<strong>' + p.number + '. ' + p.title + '</strong><br>';
    html += '<span style="color:rgba(135,177,234,.5);font-size:10px;word-break:break-all">' + p.url + '</span><br>';
    html += '<span style="font-size:11px">🕐 ' + p.openedAt + '→' + p.closedAt + ' · ⏱ ' + p.duration + ' · 🖱 ' + p.clicks + ' clics</span>';
  });

  el("report-summary").innerHTML = html;
}

function reportToText(r) {
  var D = "────────────────────────────────────────";
  var lines = ["REPORTE — ACADEMIC TAREAS", D,
    "Colaborador : " + r.meta.collaborator, "Fecha : " + r.meta.date, D];

  lines.push("ACTIVIDADES (" + r.activities.length + ")");
  if (r.activities.length === 0) { lines.push("  Sin actividades"); }
  else { r.activities.forEach(function(a) { lines.push("  " + a.number + ". " + a.name + "\n     ▶ " + a.startTime + " → ■ " + a.endTime + " · " + a.duration); }); }

  lines.push(D, "RESUMEN",
    "  Entrada     : " + r.summary.startTime,
    "  Salida      : " + r.summary.endTime,
    "  Activo      : " + r.summary.activeTime,
    "  Inactivo    : " + r.summary.idleTime,
    "  Productividad: " + r.summary.productivityPct + "%",
    "  Clics        : " + (r.summary.clicks         || 0),
    "  Teclas       : " + (r.summary.keyPresses      || 0),
    "  Scrolls      : " + (r.summary.scrolls         || 0),
    "  Eventos sist.: " + (r.summary.activityEvents  || 0),
    D);

  lines.push("PAUSAS");
  if (r.pauses.length === 0) { lines.push("  Sin pausas"); }
  else { r.pauses.forEach(function(p) { lines.push("  [" + p.reason + "] " + p.start + "→" + p.end + " (" + p.duration + ")"); }); }

  lines.push(D, "TIEMPOS MUERTOS (" + (r.idlePeriods || []).length + ")");
  if (!r.idlePeriods || r.idlePeriods.length === 0) { lines.push("  Sin tiempos muertos"); }
  else { r.idlePeriods.forEach(function(ip) { lines.push("  " + ip.number + ". " + ip.start + "→" + ip.end + " · " + ip.duration + "\n     Motivo: " + ip.reason); }); }

  lines.push(D, "APLICACIONES USADAS (" + (r.appsOpened || []).length + ")");
  if (!r.appsOpened || r.appsOpened.length === 0) {
    lines.push("  Sin aplicaciones registradas");
  } else {
    r.appsOpened.forEach(function(a) {
      lines.push("  • " + a.name + "   |   Duración: " + (a.duration || "—") + "   |   Apertura: " + (a.openedAt || "—"));
    });
  }

  lines.push(D, "PÁGINAS VISITADAS EN CHROME (" + (r.chromePages || []).length + ")");
  if (!r.chromePages || r.chromePages.length === 0) {
    lines.push("  Sin páginas registradas");
  } else {
    r.chromePages.forEach(function(p, i) {
      lines.push("  " + (i + 1) + ". " + p.title);
      lines.push("     URL      : " + p.url);
      lines.push("     Tiempo   : " + p.duration);
      lines.push("     Primera vez: " + (p.firstSeen || "—"));
    });
  }

  lines.push(D, "COMENTARIOS", r.comments || "(sin comentarios)", D);
  return lines.join("\n");
}
