#!/usr/bin/node
import cluster from "node:cluster";
import chalk from "chalk";
import ora from "ora";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startSupervisor } from "./src/supervisor.js";
import msg from "./src/msg.js";

// =======================
// Resolve config safely
// =======================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let config;

try {
  const configPath = path.join(process.cwd(), "nitro5.config.js");
  config = (await import(configPath)).default;
} catch (err) {
  throw new Error(msg.noConfigFound);
}

if (!config || typeof config !== "object") {
  throw new Error(msg.noConfigFound);
}

// =======================
// Cluster mode
// =======================
const isPrimary = cluster.isPrimary || cluster.isMaster;

if (isPrimary) {
  console.log(chalk.blue(msg.info));

  const spinner = ora("Starting Nitro5...").start();

  try {
    await startSupervisor(config);

    const port = config?.server?.port ?? config?.port ?? 3000;

    spinner.succeed(
      chalk.green(`Nitro5 ready on port ${port}`)
    );
  } catch (error) {
    spinner.fail(chalk.red("Nitro5 failed to start"));
    console.error(error);
    process.exit(1);
  }
} else {
  await startSupervisor(config);
}
