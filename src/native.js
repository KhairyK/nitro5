import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let addon = null;

try {
  addon = require("../build/Release/nitro5.node");
} catch {
  addon = null;
}

function jsFallbackParse(raw) {
  const headerEnd = raw.indexOf("\r\n\r\n");
  const head = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const body = headerEnd >= 0 ? raw.slice(headerEnd + 4) : "";
  
  const lines = head.split("\r\n");
  const [requestLine = "GET / HTTP/1.1"] = lines;
  const [method = "GET", fullPath = "/", httpVersion = "HTTP/1.1"] = requestLine.split(" ");
  
  const [pathname = "/", query = ""] = fullPath.split("?");
  const headers = {};
  
  for (const line of lines.slice(1)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[key] = value;
  }
  
  return {
    method,
    fullPath,
    pathname,
    query,
    httpVersion,
    headers,
    body,
    raw
  };
}

export function parseHttpRequest(raw) {
  if (addon && typeof addon.parseHttpRequest === "function") {
    return addon.parseHttpRequest(raw);
  }
  return jsFallbackParse(raw);
}

export function getMetrics() {
  try {
    if (!nativeReady || !addon?.getMetrics) {
      return {
        memoryKB: process.memoryUsage().rss / 1024,
        cpuUser: 0,
        cpuSystem: 0,
        fallback: true
      };
    }

    return addon.getMetrics();
  } catch (err) {
    return {
      memoryKB: process.memoryUsage().rss / 1024,
      cpuUser: 0,
      cpuSystem: 0,
      error: true
    };
  }
}

export const nativeReady = Boolean(addon);
