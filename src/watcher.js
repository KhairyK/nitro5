import fs from "node:fs";
import path from "node:path";

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "build") {
        continue;
      }
      walkFiles(fullPath, out);
    } else {
      out.push(fullPath);
    }
  }

  return out;
}

export function watchProjectFiles({
  roots = [],
  onChange
}) {
  const watched = new Set();
  const timers = new Map();

  const files = [];

  for (const root of roots) {
    files.push(...walkFiles(root));
  }

  for (const file of files) {
    if (watched.has(file)) continue;
    watched.add(file);

    fs.watchFile(file, { interval: 500 }, () => {
      clearTimeout(timers.get(file));

      const timer = setTimeout(() => {
        onChange(file);
      }, 150);

      timers.set(file, timer);
    });
  }

  return () => {
    for (const file of watched) {
      fs.unwatchFile(file);
    }
    watched.clear();
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
  };
}