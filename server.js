/**
 * server.js — Servidor local para Academic Tareas Monitor
 * Sirve la app en localhost y la abre en Chrome como ventana standalone
 */
const http = require("http");
const fs   = require("fs");
const path = require("path");
const { exec } = require("child_process");

const PORT = 3737;
const ROOT = path.join(__dirname, "renderer");

// ── Tipos MIME ───────────────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".png":  "image/png",
  ".json": "application/json",
};

// ── Servidor HTTP simple ─────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let filePath = req.url === "/" ? "/index.html" : req.url;
  filePath = path.join(ROOT, filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("Not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
    res.end(data);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`Servidor listo en ${url}`);
  console.log("Abriendo Academic Tareas Monitor...");

  // Abrir en Chrome como app window (sin barra de direcciones)
  const chromeCmd = process.platform === "darwin"
    ? `open -a "Google Chrome" --args --app=${url} --window-size=400,750 --window-position=100,50`
    : `start chrome --app=${url} --window-size=400,750`;

  exec(chromeCmd, (err) => {
    if (err) {
      // Fallback: abrir en el navegador por defecto
      const openCmd = process.platform === "darwin" ? `open ${url}` : `start ${url}`;
      exec(openCmd);
    }
  });
});
