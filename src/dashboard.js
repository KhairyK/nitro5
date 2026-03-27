import { getStats } from "./stats.js";
import { getMetrics } from "./native.js";

/* =========================
   EVENT BUS (Redis-like)
========================= */
class EventBus {
  constructor() {
    this.channels = new Map();
  }

  subscribe(event, fn) {
    if (!this.channels.has(event)) {
      this.channels.set(event, new Set());
    }

    this.channels.get(event).add(fn);

    return () => this.channels.get(event)?.delete(fn);
  }

  publish(event, data) {
    const subs = this.channels.get(event);
    if (!subs) return;

    for (const fn of subs) {
      try {
        fn(data);
      } catch (e) {
        console.error("EventBus error:", e);
      }
    }
  }
}

export const bus = new EventBus();

/* =========================
   SSE CLIENT STORE
========================= */
const clients = new Set();
const PING_INTERVAL_MS = 15000;

/* =========================
   SAFE WRITE
========================= */
function safeWrite(res, data) {
  if (!res || res.ended) return false;

  try {
    if (typeof data === "string" || Buffer.isBuffer(data)) {
      res.write(data);
    } else {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
    return true;
  } catch {
    return false;
  }
}

/* =========================
   REMOVE CLIENT
========================= */
function removeClient(res) {
  clients.delete(res);
}

/* =========================
   EVENT BROADCAST
========================= */
export function sendEvent(data) {
  bus.publish(data.type || "message", data);
}

/* =========================
   ADAPTIVE INTERVAL ENGINE
========================= */
function getLoadScore() {
  const cpu = process.cpuUsage();
  const mem = process.memoryUsage().heapUsed;

  return {
    clients: clients.size,
    cpu: cpu.user + cpu.system,
    mem,
  };
}

function calculateInterval() {
  const load = getLoadScore();

  let ms = 1000;

  if (load.clients > 50) ms = 3000;
  else if (load.clients > 20) ms = 2000;
  else if (load.clients > 5) ms = 1000;

  if (load.mem > 200 * 1024 * 1024) ms += 2000;

  return ms;
}

/* =========================
   SSE HANDLER
========================= */
export function handleSSE(req, res) {
  if (!req || !res) return;

  const socket = req.socket;

  // header support fallback
  if (typeof res.stream === "function") {
    res.stream(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  } else {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
  }

  clients.add(res);

  /* INIT MESSAGE */
  safeWrite(res, "retry: 1000\n\n");

  safeWrite(res, {
    type: "stats",
    stats: getStats(),
    metrics: getMetrics(),
    ts: Date.now(),
  });

  /* =========================
     SUBSCRIBE CLIENT TO BUS
  ========================= */
  const unsubscribe = bus.subscribe("stats", (data) => {
    safeWrite(res, data);
  });

  /* =========================
     PING KEEP ALIVE
  ========================= */
  const pingTimer = setInterval(() => {
    if (res.ended) {
      cleanup();
      return;
    }

    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, PING_INTERVAL_MS);

  pingTimer.unref?.();

  /* =========================
     CLEANUP
  ========================= */
  const cleanup = () => {
    clearInterval(pingTimer);
    unsubscribe?.();
    removeClient(res);

    try {
      res.end?.();
    } catch {}
  };

  /* SAFE SOCKET HOOK */
  if (socket?.once) {
    socket.once("close", cleanup);
    socket.once("end", cleanup);
    socket.once("error", cleanup);
  } else {
    req?.on?.("close", cleanup);
  }
}

/* =========================
   ADAPTIVE BROADCAST LOOP
========================= */
let lastPayload = null;
let intervalMs = 1000;

setInterval(() => {
  intervalMs = calculateInterval();
}, 5000);

setInterval(() => {
  if (clients.size === 0) return;

  const payload = {
    type: "stats",
    stats: getStats(),
    metrics: getMetrics(),
    ts: Date.now(),
  };

  const serialized = JSON.stringify(payload);

  if (serialized === lastPayload) return;
  lastPayload = serialized;

  sendEvent(payload);
}, intervalMs).unref?.();
