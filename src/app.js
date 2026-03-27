import net from "node:net";
import path from "node:path";
import fs from "node:fs";
import { Router } from "./router.js";
import { MemoryCache } from "./cache.js";
import { ThreadPool } from "./thread-pool.js";
import { createStaticServer } from "./static.js";
import { createNitroViteBridge } from "./vite.js";
import { parseHttpRequest, nativeReady, getMetrics } from "./native.js";
import { createLogger } from "./logger.js";
import { handleSSE, sendEvent } from "./dashboard.js";
import { incRequest, incError, incConn, decConn, getStats } from "./stats.js";

const STATUS_TEXT = {
  200: "OK",
  201: "Created",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  500: "Internal Server Error"
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizePathname(input = "/") {
  let p = String(input || "/");
  p = p.split("?")[0].split("#")[0];
  if (!p.startsWith("/")) p = `/${p}`;
  p = path.posix.normalize(p);
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/";
}

function renderDashboardPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="theme-color" content="#6750A4"/>
  <title>Nitro 5 Dashboard</title>
  <style>
    :root {
      --bg: #0f1115;
      --surface: rgba(28, 30, 38, 0.78);
      --surface-2: rgba(38, 40, 52, 0.92);
      --surface-3: #20222b;
      --border: rgba(255, 255, 255, 0.08);
      --text: #e8eaf0;
      --muted: #a8afc1;
      --primary: #8ab4ff;
      --primary-2: #6750A4;
      --success: #4ade80;
      --error: #fb7185;
      --warning: #fbbf24;
      --shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
      --radius-xl: 28px;
      --radius-lg: 20px;
      --radius-md: 16px;
      --radius-sm: 12px;
    }

    * {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(103, 80, 164, 0.28), transparent 30%),
        radial-gradient(circle at top right, rgba(138, 180, 255, 0.18), transparent 28%),
        linear-gradient(180deg, #0b0d12 0%, #10131a 100%);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    body {
      padding: 24px;
    }

    .app-shell {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      gap: 18px;
    }

    .hero {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      background: linear-gradient(135deg, rgba(103, 80, 164, 0.25), rgba(138, 180, 255, 0.10));
      backdrop-filter: blur(16px);
      border-radius: var(--radius-xl);
      padding: 24px;
      box-shadow: var(--shadow);
    }

    .hero::after {
      content: "";
      position: absolute;
      inset: 0;
      background: linear-gradient(120deg, rgba(255,255,255,0.06), transparent 40%);
      pointer-events: none;
    }

    .hero-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      position: relative;
      z-index: 1;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
    }

    .logo {
      width: 52px;
      height: 52px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      background: linear-gradient(135deg, var(--primary-2), var(--primary));
      color: white;
      font-weight: 800;
      box-shadow: 0 10px 24px rgba(103, 80, 164, 0.35);
      flex: 0 0 auto;
    }

    .title-wrap {
      min-width: 0;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.5rem, 3vw, 2.4rem);
      letter-spacing: -0.03em;
      line-height: 1.1;
    }

    .subtitle {
      margin-top: 6px;
      color: var(--muted);
      font-size: 0.98rem;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      position: relative;
      z-index: 1;
    }

    .btn {
      appearance: none;
      border: 0;
      cursor: pointer;
      border-radius: 999px;
      padding: 12px 18px;
      font-weight: 700;
      color: #111827;
      background: linear-gradient(135deg, #c6dafc, #8ab4ff);
      box-shadow: 0 10px 22px rgba(138, 180, 255, 0.20);
      transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
    }

    .btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 14px 28px rgba(138, 180, 255, 0.28);
      filter: brightness(1.03);
    }

    .btn:active {
      transform: translateY(0);
    }

    .btn.secondary {
      color: var(--text);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--border);
      box-shadow: none;
    }

    .status-strip {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 18px;
      position: relative;
      z-index: 1;
    }

    .chip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border-radius: 999px;
      padding: 10px 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 0.92rem;
      backdrop-filter: blur(8px);
    }

    .chip strong {
      font-variant-numeric: tabular-nums;
    }

    .grid {
      display: grid;
      grid-template-columns: 1.1fr 0.9fr;
      gap: 18px;
    }

    .card {
      border: 1px solid var(--border);
      background: var(--surface);
      backdrop-filter: blur(16px);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
      overflow: hidden;
    }

    .card-header {
      padding: 16px 18px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      background: linear-gradient(180deg, rgba(255,255,255,0.04), transparent);
    }

    .card-title {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .card-title h2 {
      margin: 0;
      font-size: 1rem;
      letter-spacing: 0.01em;
    }

    .card-title span {
      color: var(--muted);
      font-size: 0.88rem;
    }

    .card-body {
      padding: 18px;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .stat {
      border-radius: 18px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.06);
      padding: 16px;
      min-height: 92px;
    }

    .stat-label {
      color: var(--muted);
      font-size: 0.88rem;
      margin-bottom: 10px;
    }

    .stat-value {
      font-size: 1.35rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      font-variant-numeric: tabular-nums;
      word-break: break-word;
    }

    .stat-note {
      margin-top: 8px;
      color: var(--muted);
      font-size: 0.84rem;
    }

    .log {
      display: flex;
      flex-direction: column;
      gap: 10px;
      max-height: 68vh;
      overflow: auto;
      padding-right: 4px;
    }

    .log::-webkit-scrollbar {
      width: 10px;
    }

    .log::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.12);
      border-radius: 999px;
    }

    .log-item {
      border-radius: 16px;
      padding: 12px 14px;
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.06);
      color: var(--text);
      font-size: 0.92rem;
      line-height: 1.45;
      display: flex;
      gap: 10px;
      align-items: flex-start;
    }

    .log-badge {
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      margin-top: 6px;
      background: var(--primary);
      box-shadow: 0 0 0 4px rgba(138, 180, 255, 0.12);
    }

    .log-item.access .log-badge {
      background: var(--success);
      box-shadow: 0 0 0 4px rgba(74, 222, 128, 0.12);
    }

    .log-item.error .log-badge {
      background: var(--error);
      box-shadow: 0 0 0 4px rgba(251, 113, 133, 0.12);
    }

    .log-meta {
      color: var(--muted);
      font-size: 0.82rem;
      margin-top: 2px;
    }

    .empty-state {
      color: var(--muted);
      text-align: center;
      padding: 24px 10px;
    }

    @media (max-width: 960px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      body {
        padding: 14px;
      }

      .hero, .card {
        border-radius: 20px;
      }

      .stats-grid {
        grid-template-columns: 1fr;
      }

      .btn {
        width: 100%;
        justify-content: center;
      }

      .toolbar {
        width: 100%;
      }
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <section class="hero">
      <div class="hero-top">
        <div class="brand">
          <div class="logo">N5</div>
          <div class="title-wrap">
            <h1>🔥 Nitro 5 Dashboard</h1>
            <div class="subtitle">Realtime access log, stats, and worker control panel</div>
          </div>
        </div>

        <div class="toolbar">
          <button class="btn secondary" onclick="location.reload()">Refresh</button>
          <button class="btn" onclick="restart()">Restart Workers</button>
        </div>
      </div>

      <div class="status-strip">
        <div class="chip">Uptime <strong><span id="uptime">0</span>s</strong></div>
        <div class="chip">Live feed <strong>ON</strong></div>
        <div class="chip">Mode <strong>Dashboard</strong></div>
      </div>
    </section>

    <section class="grid">
      <article class="card">
        <div class="card-header">
          <div class="card-title">
            <h2>System Stats</h2>
            <span>Updated live from SSE</span>
          </div>
        </div>
        <div class="card-body">
          <div id="stats" class="stats-grid">
            <div class="stat">
              <div class="stat-label">Waiting for data</div>
              <div class="stat-value">—</div>
              <div class="stat-note">Stats will appear here once the stream connects.</div>
            </div>
          </div>
        </div>
      </article>

      <article class="card">
        <div class="card-header">
          <div class="card-title">
            <h2>Event Log</h2>
            <span>Latest events first</span>
          </div>
        </div>
        <div class="card-body">
          <div class="log" id="log">
            <div class="empty-state">No events yet.</div>
          </div>
        </div>
      </article>
    </section>
  </div>

  <script>
    const log = document.getElementById("log");
    const uptimeEl = document.getElementById("uptime");
    const statsEl = document.getElementById("stats");
    const start = Date.now();

    setInterval(() => {
      uptimeEl.textContent = Math.floor((Date.now() - start) / 1000);
    }, 1000);

    const es = new EventSource("/__nitro5/events");

    function restart() {
      fetch("/__nitro5/restart", { method: "POST" });
    }

    function formatValue(value) {
      if (value === null || value === undefined) return "0";
      if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "0";
      if (typeof value === "object") return JSON.stringify(value);
      return String(value);
    }

    function setStats(data) {
      statsEl.innerHTML = [
        {
          label: "Requests",
          value: data.stats?.totalRequests ?? 0,
          note: "Total HTTP requests handled"
        },
        {
          label: "Errors",
          value: data.stats?.totalErrors ?? 0,
          note: "Captured server errors"
        },
        {
          label: "Connections",
          value: data.stats?.activeConnections ?? 0,
          note: "Open socket connections"
        },
        {
          label: "RAM",
          value: (data.metrics?.memoryKB ?? 0) + " KB",
          note: "Approx memory usage"
        },
        {
          label: "CPU User",
          value: typeof data.metrics?.cpuUser === "number" ? data.metrics.cpuUser.toFixed(2) : "0",
          note: "User CPU time"
        },
        {
          label: "CPU Sys",
          value: typeof data.metrics?.cpuSystem === "number" ? data.metrics.cpuSystem.toFixed(2) : "0",
          note: "System CPU time"
        }
      ].map(item => \`
        <div class="stat">
          <div class="stat-label">\${item.label}</div>
          <div class="stat-value">\${formatValue(item.value)}</div>
          <div class="stat-note">\${item.note}</div>
        </div>
      \`).join("");
    }

    function appendLog(kind, text, meta = "") {
      if (log.querySelector(".empty-state")) {
        log.innerHTML = "";
      }

      const div = document.createElement("div");
      div.className = "log-item " + kind;
      div.innerHTML = \`
        <div class="log-badge"></div>
        <div>
          <div>\${text}</div>
          \${meta ? \`<div class="log-meta">\${meta}</div>\` : ""}
        </div>
      \`;
      log.prepend(div);
    }

    es.onmessage = (e) => {
      const data = JSON.parse(e.data);

      if (data.type === "access") {
        appendLog(
          "access",
          "[ACCESS] " + data.method + " " + data.path + " → " + data.status + " (" + data.time + "ms)",
          new Date(data.ts || Date.now()).toLocaleString()
        );
      }

      if (data.type === "error") {
        appendLog(
          "error",
          "[ERROR] " + data.message,
          new Date(data.ts || Date.now()).toLocaleString()
        );
      }

      if (data.type === "stats") {
        setStats(data);
      }
    };

    es.onerror = () => {
      appendLog("error", "[STREAM] Connection lost, retrying...");
    };
  </script>
</body>
</html>`;
}

function renderErrorPage(status, message, config) {
  if (config.errorPages?.[status]) {
    try {
      return fs.readFileSync(config.errorPages[status], "utf8");
    } catch {}
  }

  const safeMessage = escapeHtml(message);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="theme-color" content="#6750A4"/>
  <title>${status} Error</title>
  <style>
    :root {
      --bg: #0f1115;
      --surface: rgba(28, 30, 38, 0.78);
      --border: rgba(255, 255, 255, 0.08);
      --text: #e8eaf0;
      --muted: #a8afc1;
      --primary: #8ab4ff;
      --primary-2: #6750A4;
      --shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
      --radius-xl: 28px;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
      background:
        radial-gradient(circle at top left, rgba(103, 80, 164, 0.28), transparent 30%),
        radial-gradient(circle at top right, rgba(138, 180, 255, 0.18), transparent 28%),
        linear-gradient(180deg, #0b0d12 0%, #10131a 100%);
      color: var(--text);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }

    body {
      display: grid;
      place-items: center;
      padding: 24px;
    }

    .box {
      width: min(560px, 100%);
      border: 1px solid var(--border);
      background: var(--surface);
      backdrop-filter: blur(16px);
      border-radius: var(--radius-xl);
      box-shadow: var(--shadow);
      padding: 28px;
      text-align: center;
    }

    .badge {
      width: 64px;
      height: 64px;
      border-radius: 20px;
      margin: 0 auto 18px;
      display: grid;
      place-items: center;
      font-weight: 800;
      font-size: 1.5rem;
      color: white;
      background: linear-gradient(135deg, #cf6679, #6750A4);
      box-shadow: 0 14px 28px rgba(103, 80, 164, 0.28);
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 5vw, 3.4rem);
      letter-spacing: -0.04em;
      color: #f3f4f6;
    }

    p {
      margin: 12px 0 0;
      color: var(--muted);
      line-height: 1.6;
      font-size: 1rem;
      word-break: break-word;
    }

    .meta {
      margin-top: 18px;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      border-radius: 999px;
      padding: 10px 14px;
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--text);
      font-size: 0.92rem;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="badge">${status}</div>
    <h1>${status} Error</h1>
    <p>${safeMessage}</p>
    <div class="meta">Nitro 5 · Material-styled error page</div>
  </div>
</body>
</html>`;
}

function buildPacket(statusCode, headers, body, options = {}) {
  const { omitContentLength = false } = options;
  const statusText = STATUS_TEXT[statusCode] || "OK";
  const bodyBuffer = Buffer.isBuffer(body)
    ? body
    : Buffer.from(body ?? "", "utf8");

  const finalHeaders = {
    Connection: "close",
    ...headers
  };

  if (
    !omitContentLength &&
    !("Content-Length" in finalHeaders) &&
    !("content-length" in finalHeaders)
  ) {
    finalHeaders["Content-Length"] = bodyBuffer.length;
  }

  const headerLines = Object.entries(finalHeaders)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\r\n");

  const head = `HTTP/1.1 ${statusCode} ${statusText}\r\n${headerLines}\r\n\r\n`;

  return Buffer.concat([
    Buffer.from(head, "utf8"),
    bodyBuffer
  ]);
}

function scanContentLength(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  if (headerEnd === -1) return 0;

  const head = raw.slice(0, headerEnd);
  const lines = head.split("\r\n").slice(1);

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "content-length") {
      const n = Number(value);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }

  return 0;
}

function createResponse(socket, config) {
  return {
    socket,
    statusCode: 200,
    headers: {},
    ended: false,
    streaming: false,

    setHeader(key, value) {
      this.headers[key] = value;
      return this;
    },

    status(code) {
      this.statusCode = code;
      return this;
    },

    write(chunk = "") {
      if (this.ended) return this;
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(String(chunk), "utf8");
      socket.write(buffer);
      return this;
    },

    end(chunk = "") {
      if (this.ended) return this;
      if (chunk !== undefined && chunk !== null && chunk !== "") {
        this.write(chunk);
      }
      socket.end();
      this.ended = true;
      this.streaming = false;
      return this;
    },

    stream(statusCode = 200, extraHeaders = {}) {
      if (this.ended) return this;

      this.statusCode = statusCode;
      this.streaming = true;

      const headers = this.finalizeHeaders(Buffer.alloc(0), {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...extraHeaders
      }, { omitContentLength: true });

      socket.write(buildPacket(statusCode, headers, Buffer.alloc(0), { omitContentLength: true }));
      return this;
    },

    error(code = 500, message = "Internal Server Error") {
      if (this.ended) return;

      this.statusCode = code;

      const html = renderErrorPage(code, message, config);
      const bodyBuffer = Buffer.from(html, "utf8");

      const headers = this.finalizeHeaders(bodyBuffer, {
        "Content-Type": "text/html; charset=utf-8"
      });

      socket.write(buildPacket(code, headers, bodyBuffer));
      socket.end();
      this.ended = true;
    },

    applyCors(headers) {
      if (!config.cors?.enabled) return headers;

      return {
        ...headers,
        "Access-Control-Allow-Origin": config.cors.origin || "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        Vary: "Origin"
      };
    },

    finalizeHeaders(bodyBuffer, extraHeaders = {}, options = {}) {
      const headers = {
        ...this.headers,
        ...extraHeaders
      };

      if (
        !("Content-Type" in headers) &&
        !("content-type" in headers)
      ) {
        headers["Content-Type"] = "text/plain; charset=utf-8";
      }

      if (!options.omitContentLength) {
        if (
          !("Content-Length" in headers) &&
          !("content-length" in headers)
        ) {
          headers["Content-Length"] = bodyBuffer.length;
        }
      } else {
        delete headers["Content-Length"];
        delete headers["content-length"];
      }

      return this.applyCors(headers);
    },

    send(body = "", code = this.statusCode || 200, contentType = "text/plain; charset=utf-8") {
      if (this.ended) return;

      this.statusCode = code;

      let payload = body;

      if (payload !== null && typeof payload === "object" && !Buffer.isBuffer(payload)) {
        payload = JSON.stringify(payload);
        contentType = "application/json; charset=utf-8";
      }

      const bodyBuffer = Buffer.isBuffer(payload)
        ? payload
        : Buffer.from(String(payload), "utf8");

      const headers = this.finalizeHeaders(bodyBuffer, {
        "Content-Type": this.headers["Content-Type"] || contentType
      });

      socket.write(buildPacket(code, headers, bodyBuffer));
      socket.end();
      this.ended = true;
    },

    json(obj, code = this.statusCode || 200) {
      this.setHeader("Content-Type", "application/json; charset=utf-8");
      this.send(obj, code, "application/json; charset=utf-8");
    },

    binary(buffer, code = this.statusCode || 200, contentType = "application/octet-stream") {
      if (this.ended) return;

      this.statusCode = code;

      const bodyBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
      const headers = this.finalizeHeaders(bodyBuffer, {
        "Content-Type": contentType
      });

      socket.write(buildPacket(code, headers, bodyBuffer));
      socket.end();
      this.ended = true;
    }
  };
}

async function createViteIfEnabled(config) {
  if (!config.dev?.useVite) return null;
  return await createNitroViteBridge(true);
}

function emitAccess(req, res, timeMs) {
  try {
    sendEvent({
      type: "access",
      method: req.method,
      path: req.pathname,
      status: res.statusCode ?? 200,
      time: timeMs,
      ts: Date.now()
    });
  } catch {}
}

function emitError(error) {
  try {
    sendEvent({
      type: "error",
      message: error?.message || String(error),
      ts: Date.now()
    });
  } catch {}
}

function handleInternalNitroRoute(req, res, config) {
  const pathname = normalizePathname(req.pathname || "/");
  const method = String(req.method || "GET").toUpperCase();

  if (pathname === "/__nitro5/dashboard") {
    if (!config.dashboard) return false;
    res.send(renderDashboardPage(), 200, "text/html; charset=utf-8");
    return true;
  }

  if (pathname === "/__nitro5/events") {
    if (!config.dashboard) return false;
    handleSSE(req, res);
    return true;
  }

  if (pathname === "/__nitro5/json-message") {
    res.json({
      name: "Nitro 5 Web Server Messages",
      nativeParser: nativeReady,
      ok: true,
      status: 200,
      statusMessage: STATUS_TEXT[200],
      mode: config.dev?.useVite ? "vite" : "static",
      cache: config.cache,
      metrics: typeof getMetrics === "function" ? getMetrics() : null,
      stats: typeof getStats === "function" ? getStats() : null
    });
    return true;
  }

  if (pathname === "/__nitro5/restart" && method === "POST") {
    if (typeof process.send === "function") {
      process.send({ type: "restart", pid: process.pid, ts: Date.now() });
    }

    res.json({ ok: true, restartRequested: true });
    return true;
  }

  return false;
}

export async function createApp(config) {
  const router = new Router();
  const middlewares = [];
  const cache = new MemoryCache();
  const filePool = new ThreadPool(1);
  const publicDir = path.join(process.cwd(), "public");
  const vite = await createViteIfEnabled(config);
  const logger = createLogger(config);

  const serveStatic = createStaticServer({
    publicDir,
    cache,
    cacheConfig: config.cache,
    filePool,
    vite
  });

  const app = {
    use(fn) {
      middlewares.push(fn);
    },

    get: router.get.bind(router),
    post: router.post.bind(router),
    put: router.put.bind(router),
    patch: router.patch.bind(router),
    delete: router.delete.bind(router),

    async listen(port, callback) {
      const server = net.createServer((socket) => {
        incConn();
        socket.setNoDelay(true);
        socket.setKeepAlive(true);

        socket.on("close", () => {
          decConn();
        });

        let rawBuffer = Buffer.alloc(0);
        let handling = false;

        const processRequest = async (rawRequest) => {
          if (handling) return;
          handling = true;

          const start = Date.now();
          incRequest();

          try {
            const req = parseHttpRequest(rawRequest);

            req.pathname = normalizePathname(req.pathname || "/");
            req.fullPath = normalizePathname(req.fullPath || req.pathname);
            req.method = String(req.method || "GET").toUpperCase();

            const res = createResponse(socket, config);

            if (config.cors?.enabled && req.method === "OPTIONS") {
              res.status(204).send("", 204, "text/plain; charset=utf-8");
              emitAccess(req, res, Date.now() - start);
              return;
            }

            if (handleInternalNitroRoute(req, res, config)) {
              const timeMs = Date.now() - start;
              logger.access(req, res, timeMs);
              emitAccess(req, res, timeMs);
              return;
            }

            for (const mw of middlewares) {
              if (res.ended) break;

              if (mw.length >= 3) {
                await new Promise((resolve, reject) => {
                  try {
                    const next = (err) => {
                      if (err) reject(err);
                      else resolve();
                    };

                    const maybe = mw(req, res, next);
                    if (maybe && typeof maybe.then === "function") {
                      maybe.then(resolve).catch(reject);
                    }
                  } catch (error) {
                    reject(error);
                  }
                });
              } else {
                await Promise.resolve(mw(req, res));
              }
            }

            if (res.ended) {
              emitAccess(req, res, Date.now() - start);
              return;
            }

            const routeHandler = router.resolve(req.method, req.pathname);

            if (routeHandler) {
              await routeHandler(req, res);

              if (!res.ended) {
                res.send("");
              }

              const timeMs = Date.now() - start;
              logger.access(req, res, timeMs);
              emitAccess(req, res, timeMs);
              return;
            }

            const served = await serveStatic(req, res);
            if (served) {
              const timeMs = Date.now() - start;
              logger.access(req, res, timeMs);
              emitAccess(req, res, timeMs);
              return;
            }

            const timeMs = Date.now() - start;
            res.status(404).error(404, "Page Not Found");
            logger.access(req, res, timeMs);
            emitAccess(req, res, timeMs);
          } catch (err) {
            incError();
            logger.error(err, { method: "UNKNOWN", pathname: "UNKNOWN" });
            emitError(err);

            try {
              if (!socket.destroyed) {
                const res = createResponse(socket, config);
                res.error(500, "Internal Server Error");
              }
            } catch {
              socket.destroy();
            }
          } finally {
            handling = false;
          }
        };

        socket.on("data", async (chunk) => {
          rawBuffer = Buffer.concat([rawBuffer, chunk]);

          const raw = rawBuffer.toString("utf8");
          const headerEnd = raw.indexOf("\r\n\r\n");
          if (headerEnd === -1) return;

          const contentLength = scanContentLength(raw);
          const totalNeeded =
            Buffer.byteLength(raw.slice(0, headerEnd + 4), "utf8") + contentLength;

          if (rawBuffer.length < totalNeeded) return;

          const requestBuffer = rawBuffer.slice(0, totalNeeded);
          rawBuffer = rawBuffer.slice(totalNeeded);

          await processRequest(requestBuffer.toString("utf8"));
        });

        socket.on("error", () => {});
      });

      server.on("clientError", (err, socket) => {
        try {
          const html = renderErrorPage(400, "Bad Request", config);
          socket.end(
            `HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(html, "utf8")}\r\n\r\n${html}`
          );
        } catch {}
      });

      return new Promise((resolve) => {
        server.listen(port, () => {
          callback?.();
          resolve(server);
        });
      });
    }
  };

  return app;
}
