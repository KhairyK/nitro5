import fs from "node:fs";
import path from "node:path";

const CACHE_DIR = "./.nitro-cache";

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR);
}

function safeName(file) {
  return file.replace(/[\/\\:]/g, "_");
}

export function getDiskPath(file) {
  return path.join(CACHE_DIR, safeName(file) + ".json");
}

export function readDiskCache(file) {
  const p = getDiskPath(file);
  if (!fs.existsSync(p)) return null;

  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function writeDiskCache(file, data) {
  const p = getDiskPath(file);
  fs.writeFileSync(p, JSON.stringify(data));
}

export function clearDiskCache(file) {
  const p = getDiskPath(file);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
