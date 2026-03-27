import cluster from "node:cluster";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { createApp } from "./app.js";
import { watchProjectFiles } from "./watcher.js";

function resolveWorkers(value) {
  if (value === "auto") return os.cpus().length;

  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }

  return 1;
}

function serializeConfig(config) {
  try {
    return JSON.stringify(config ?? {});
  } catch {
    return "{}";
  }
}

function readConfigFromEnv() {
  try {
    const raw = process.env.NITRO5_CONFIG;
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function formatChangedFile(changedFile) {
  if (!changedFile || changedFile === "manual-restart") return "manual-restart";
  try {
    return path.relative(process.cwd(), changedFile) || changedFile;
  } catch {
    return String(changedFile);
  }
}

async function startWorker(inputConfig = {}) {
  const config =
    inputConfig && Object.keys(inputConfig).length > 0
      ? inputConfig
      : readConfigFromEnv();

  const app = await createApp(config);
  const port = Number(config.server?.port) || 3000;

  let server;
  try {
    server = await app.listen(port, () => {
      console.log(
        chalk.green(`[worker ${process.pid}] Nitro5 listening on ${port}`)
      );
    });
  } catch (error) {
    console.error(
      chalk.red(`[worker ${process.pid}] failed to listen on ${port}:`),
      error
    );
    process.exit(1);
    return;
  }

  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(
      chalk.yellow(`[worker ${process.pid}] received ${signal}, shutting down...`)
    );

    const exitNow = () => process.exit(0);

    try {
      if (server && typeof server.close === "function") {
        server.close(exitNow);
      } else {
        exitNow();
      }
    } catch {
      exitNow();
    }

    setTimeout(() => process.exit(0), 5000).unref?.();
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  process.on("uncaughtException", (error) => {
    console.error(chalk.red(`[worker ${process.pid}] uncaughtException:`), error);
    process.exit(1);
  });

  process.on("unhandledRejection", (error) => {
    console.error(
      chalk.red(`[worker ${process.pid}] unhandledRejection:`),
      error
    );
    process.exit(1);
  });

  return server;
}

export async function startSupervisor(config = {}) {
  const isPrimary = cluster.isPrimary ?? cluster.isMaster;

  if (!isPrimary) {
    await startWorker(config);
    return;
  }

  const workerCount = resolveWorkers(config.server?.workers ?? 1);

  console.log(
    chalk.cyan(`Nitro5 supervisor started with ${workerCount} worker(s)`)
  );

  const workers = new Set();
  const baseEnv = {
    ...process.env,
    NITRO5_CONFIG: serializeConfig(config),
  };

  let restarting = false;
  let restartQueued = false;

  const spawnWorker = () => {
    const worker = cluster.fork(baseEnv);
    workers.add(worker);

    worker.on("online", () => {
      console.log(chalk.gray(`[supervisor] worker ${worker.process.pid} online`));
    });

    worker.on("message", (msg) => {
      if (msg?.type === "restart") {
        void restartAll("manual-restart");
      }
    });

    worker.on("exit", (code, signal) => {
      workers.delete(worker);

      console.log(
        chalk.gray(
          `[supervisor] worker ${worker.process.pid} exited (code=${code}, signal=${signal ?? "none"})`
        )
      );

      if (!restarting && config.server?.autoStart) {
        setTimeout(() => {
          if (!restarting) spawnWorker();
        }, 300);
      }
    });

    return worker;
  };

  const spawnWorkerBatch = () => {
    for (let i = 0; i < workerCount; i++) {
      spawnWorker();
    }
  };

  const restartAll = async (changedFile = "manual-restart") => {
    if (restarting) {
      restartQueued = true;
      return;
    }

    restarting = true;

    console.log(
      chalk.magenta(
        `[hot reload] ${formatChangedFile(changedFile)} changed`
      )
    );

    const currentWorkers = Array.from(workers);

    for (const worker of currentWorkers) {
      try {
        worker.kill("SIGTERM");
      } catch {}
    }

    await new Promise((resolve) => setTimeout(resolve, 500));

    workers.clear();
    spawnWorkerBatch();

    restarting = false;

    if (restartQueued) {
      restartQueued = false;
      void restartAll("queued-restart");
    }
  };

  const shutdownPrimary = () => {
    if (restarting) return;
    restarting = true;

    console.log(chalk.yellow("[supervisor] shutting down workers..."));

    for (const worker of workers) {
      try {
        worker.kill("SIGTERM");
      } catch {}
    }

    setTimeout(() => process.exit(0), 5000).unref?.();
  };

  process.once("SIGTERM", shutdownPrimary);
  process.once("SIGINT", shutdownPrimary);

  spawnWorkerBatch();

  if (config.dev?.hotReload) {
    watchProjectFiles({
      roots: [
        path.join(process.cwd(), "src"),
        path.join(process.cwd(), "public"),
        path.join(process.cwd(), "native"),
        process.cwd(),
      ],
      onChange: (changedFile) => {
        void restartAll(changedFile);
      },
    });
  }
}
