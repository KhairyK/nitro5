import fs from "node:fs";
import path from "node:path";
import { sendEvent } from "./dashboard.js";

export function createLogger(config) {
  const logDir = config.logging?.dir || "logs";

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const accessLog = path.join(logDir, "access.log");
  const errorLog = path.join(logDir, "error.log");

  function write(file, message) {
    fs.appendFile(file, message + "\n", () => {});
  }

  function formatAccess(req, res, timeMs) {
    return `${new Date().toISOString()} | ${req.method} ${req.pathname} | ${res.statusCode} | ${timeMs}ms | ${req.headers["host"] || "-"}`
  }

  return {
    access(req, res, timeMs) {
  const line = formatAccess(req, res, timeMs);
  console.log(line);
  write(accessLog, line);

  sendEvent({
    type: "access",
    method: req.method,
    path: req.pathname,
    status: res.statusCode,
    time: timeMs,
    ts: Date.now()
  });
}, 

    error(err, req) {
  const line = `${new Date().toISOString()} | ERROR | ${req?.method || "-"} ${req?.pathname || "-"} | ${err.stack || err}`;
  console.error(line);
  write(errorLog, line);

  sendEvent({
    type: "error",
    message: err.stack || String(err),
    ts: Date.now()
  });
}
  };
}