import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import chokidar from "chokidar";
import { pathToFileURL } from "node:url";

import {
  readDiskCache,
  writeDiskCache
} from "./disk-cache.js";

import {
  getCache,
  setCache,
  hasCache
} from "./deps-cache.js";

import msg from "./msg.js";

let config = null;

async function loadConfig() {
  if (config) return config;

  try {
    const configPath = path.join(process.cwd(), "nitro5.config.js");
    const configUrl = pathToFileURL(configPath).href;
    config = (await import(configUrl)).default;
  } catch (err) {
    throw new Error(msg.noConfigFound);
  }

  if (!config || typeof config !== "object") {
    throw new Error(msg.noConfigFound);
  }

  return config;
}

function fileExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function isLocalImport(specifier) {
  return (
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("file:")
  );
}

function tryResolveFile(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    `${basePath}.mts`,
    `${basePath}.cts`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.jsx"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs"),
  ];

  for (const candidate of candidates) {
    if (fileExists(candidate)) return path.resolve(candidate);
  }

  return null;
}

function resolveImport(specifier, fromFile) {
  if (!isLocalImport(specifier)) return null;

  let rawPath = specifier;

  if (rawPath.startsWith("file:")) {
    try {
      rawPath = new URL(rawPath).pathname;
    } catch {
      return null;
    }
  }

  const fromDir = path.dirname(fromFile);
  const absBase = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(fromDir, rawPath);

  return tryResolveFile(absBase);
}

function extractLocalImports(source) {
  const result = new Set();

  const re = /(?:import\s+(?:[\s\S]*?\s+from\s+)?|export\s+[\s\S]*?\s+from\s+|import\s*\()\s*['"]([^'"]+)['"]/g;
  let match;

  while ((match = re.exec(source)) !== null) {
    result.add(match[1]);
  }

  return [...result];
}

async function collectDependencyTree(entryPath) {
  const root = path.resolve(entryPath);
  const seen = new Set();
  const stack = [root];
  const files = new Set();

  while (stack.length) {
    const file = stack.pop();
    const abs = path.resolve(file);

    if (seen.has(abs)) continue;
    seen.add(abs);

    if (!fileExists(abs)) continue;

    files.add(abs);

    const source = readText(abs);
    const imports = extractLocalImports(source);

    for (const spec of imports) {
      const resolved = resolveImport(spec, abs);
      if (resolved && !seen.has(resolved)) {
        stack.push(resolved);
      }
    }
  }

  return [...files].sort();
}

function buildTreeHash(files) {
  const h = crypto.createHash("sha1");

  for (const file of files) {
    const content = fs.readFileSync(file);
    h.update(file);
    h.update("\0");
    h.update(content);
    h.update("\0");
  }

  return h.digest("hex");
}

async function buildTS(entryPath, useCache) {
  const deps = await collectDependencyTree(entryPath);
  const treeHash = buildTreeHash(deps);
  const cacheKey = `${path.resolve(entryPath)}:${treeHash}`;

  if (useCache && hasCache(cacheKey)) {
    return {
      code: getCache(cacheKey),
      deps,
      cacheKey,
      treeHash
    };
  }

  if (useCache) {
    const disk = readDiskCache(cacheKey);
    if (disk?.code) {
      setCache(cacheKey, disk.code);
      return {
        code: disk.code,
        deps,
        cacheKey,
        treeHash
      };
    }
  }

  const result = await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    sourcemap: false,
    minify: false,
    metafile: true,
    loader: {
      ".ts": "ts",
      ".tsx": "tsx",
      ".js": "js",
      ".jsx": "jsx"
    },
    jsx: "automatic",
    jsxImportSource: "react"
  });

  if (!result.outputFiles?.length) {
    throw new Error("TS build failed");
  }

  const code = result.outputFiles[0].text;

  if (useCache) {
    setCache(cacheKey, code);
    writeDiskCache(cacheKey, {
      code,
      time: Date.now()
    });
  }

  return {
    code,
    deps,
    cacheKey,
    treeHash
  };
}

export async function bundleTS(entryPath, options = {}) {
  if (!entryPath) {
    throw new Error("bundleTS: entryPath undefined");
  }

  await loadConfig();

  const useCache = options.cacheTs ?? config.cacheTs !== false;
  const result = await buildTS(entryPath, useCache);

  return result.code;
}

export async function getDependencyTree(entryPath) {
  if (!entryPath) {
    throw new Error("getDependencyTree: entryPath undefined");
  }

  return await collectDependencyTree(entryPath);
}

export function watchTS(entryPath, onRebuild, options = {}) {
  if (!entryPath) {
    throw new Error("watchTS: entryPath undefined");
  }

  let watcher = null;
  let rebuilding = false;
  let watchedFiles = new Set();

  const useCache = options.cacheTs ?? true;

  async function rebuild(changedFile = entryPath) {
    if (rebuilding) return;
    rebuilding = true;

    try {
      const result = await buildTS(entryPath, useCache);

      const nextFiles = new Set(result.deps);
      const toAdd = [...nextFiles].filter((f) => !watchedFiles.has(f));
      const toRemove = [...watchedFiles].filter((f) => !nextFiles.has(f));

      for (const file of toRemove) {
        watcher?.unwatch(file);
      }

      for (const file of toAdd) {
        watcher?.add(file);
      }

      watchedFiles = nextFiles;

      if (typeof onRebuild === "function") {
        await onRebuild({
          entryPath,
          changedFile,
          code: result.code,
          deps: result.deps,
          cacheKey: result.cacheKey,
          treeHash: result.treeHash
        });
      }
    } finally {
      rebuilding = false;
    }
  }

  (async () => {
    const deps = await collectDependencyTree(entryPath);
    watchedFiles = new Set(deps);

    watcher = chokidar.watch([...watchedFiles], {
      ignoreInitial: true
    });

    const handleChange = async (file) => {
      await rebuild(file);
    };

    watcher.on("change", handleChange);
    watcher.on("add", handleChange);
    watcher.on("unlink", handleChange);
  })().catch((err) => {
    console.error("watchTS init error:", err);
  });

  return {
    close() {
      watcher?.close();
    },
    rebuild
  };
}
