import { parentPort } from "node:worker_threads";
import { readFile } from "node:fs/promises";

parentPort.on("message", async (message) => {
  try {
    const buffer = await readFile(message.filePath);
    parentPort.postMessage({
      id: message.id,
      ok: true,
      base64: buffer.toString("base64")
    });
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error?.message || "Failed to read file"
    });
  }
});