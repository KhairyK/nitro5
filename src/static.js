import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getMimeType } from "./mime.js";
import { matchesCacheRule } from "./cache.js";
import { bundleTS } from "./tsc.js";

/**
 * Safe path resolver (anti directory traversal)
 */
function safeResolve(root, requestPath) {
  const clean = requestPath.startsWith("/")
    ? requestPath
    : `/${requestPath}`;

  const normalized = path.normalize(clean).replace(/^(\.\.[/\\])+/, "");
  const abs = path.resolve(root, `.${normalized}`);
  const rootAbs = path.resolve(root);

  if (!abs.startsWith(rootAbs)) return null;
  return abs;
}

function getMTimeKey(absPath) {
  const stat = fs.statSync(absPath);
  return `${absPath}:${stat.mtimeMs}`;
}

function injectHMRClient(html, hmrPort = 3001) {
  const client = `
<script>
(() => {
  try {
    const ws = new WebSocket("ws://" + location.hostname + ":" + ${hmrPort});

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      if (msg.type === "hmr:update" && typeof msg.code === "string") {
        const blob = new Blob([msg.code], { type: "text/javascript" });
        const url = URL.createObjectURL(blob) + "?t=" + Date.now();

        try {
          await import(url);
        } catch (err) {
          console.error("HMR import failed:", err);
          location.reload();
        }
      }
    };

    ws.onclose = () => {
      console.warn("HMR socket closed");
    };
  } catch (err) {
    console.error("HMR client error:", err);
  }
})();
</script>
`;

  if (html.includes("</body>")) {
    return html.replace("</body>", `${client}</body>`);
  }

  return html + client;
}

/**
 * Static server factory
 */
export function createStaticServer({
  publicDir,
  cache,
  cacheConfig,
  filePool,
  vite,
  hmrPort = 3001
}) {
  return async function serveStatic(req, res) {
    let requestPath = req.pathname || "/";
    requestPath = requestPath.split("?")[0];

    if (requestPath === "/") {
      requestPath = "/index.html";
    }

    const absPath = safeResolve(publicDir, requestPath);
    if (!absPath) return false;

    if (!fs.existsSync(absPath)) return false;
    if (!fs.statSync(absPath).isFile()) return false;

    const ext = path.extname(absPath).toLowerCase();
    const cacheable =
      cacheConfig?.enabled &&
      matchesCacheRule(absPath, cacheConfig.files);

    const cacheKey = cacheable ? getMTimeKey(absPath) : null;

    /**
     * =========================
     * CACHE HIT
     * =========================
     */
    if (cacheable && cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        res.binary(cached.buffer, 200, cached.contentType);
        return true;
      }
    }

    /**
     * =========================
     * HTML (VITE STYLE TRANSFORM)
     * =========================
     */
    if (ext === ".html") {
      const html = await fsp.readFile(absPath, "utf8");

      let transformed = html;

      if (vite?.transformIndexHtml) {
        transformed = await vite.transformIndexHtml(
          req.fullPath || req.pathname || "/",
          html
        );
      }

      transformed = injectHMRClient(transformed, hmrPort);

      const buffer = Buffer.from(transformed);
      const contentType = "text/html; charset=utf-8";

      if (cacheable && cacheKey) {
        cache.set(cacheKey, { buffer, contentType }, cacheConfig.ttl);
      }

      res.binary(buffer, 200, contentType);
      return true;
    }

    /**
     * =========================
     * TYPESCRIPT SUPPORT
     * =========================
     */
    if (ext === ".ts" || ext === ".tsx") {
      try {
        const code = await bundleTS(absPath);

        if (!code) {
          throw new Error("TS bundle returned empty output");
        }

        const buffer = Buffer.from(code);
        const contentType = "application/javascript; charset=utf-8";

        if (cacheable && cacheKey) {
          cache.set(cacheKey, { buffer, contentType }, cacheConfig.ttl);
        }

        res.binary(buffer, 200, contentType);
        return true;
      } catch (err) {
        console.error("TS BUNDLE ERROR:", err);

        res.send(
          `console.error("TS build failed: ${err.message}")`,
          500,
          "application/javascript"
        );
        return true;
      }
    }

    /**
     * =========================
     * NORMAL FILES
     * =========================
     */
    const contentType = getMimeType(absPath);

    const buffer = filePool
      ? await filePool.run(absPath)
      : await fsp.readFile(absPath);

    if (cacheable && cacheKey) {
      cache.set(cacheKey, { buffer, contentType }, cacheConfig.ttl);
    }

    res.binary(buffer, 200, contentType);
    return true;
  };
}
