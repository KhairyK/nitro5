import os from "node:os";
import { Worker } from "node:worker_threads";

class PoolWorker {
  constructor(worker) {
    this.worker = worker;
    this.busy = false;
    this.currentJob = null;
  }
}

export class ThreadPool {
  constructor(size = 1) {
    this.size = Math.max(1, size);
    this.workers = [];
    this.queue = [];
    this.jobId = 0;
    
    for (let i = 0; i < this.size; i++) {
      this.workers.push(this.createWorker());
    }
  }
  
  createWorker() {
    const worker = new Worker(new URL("./file-worker.js", import.meta.url), {
      type: "module"
    });
    
    const wrapped = new PoolWorker(worker);
    
    worker.on("message", (msg) => {
      const job = wrapped.currentJob;
      if (!job) return;
      
      wrapped.currentJob = null;
      wrapped.busy = false;
      
      if (msg.ok) {
        job.resolve(Buffer.from(msg.base64, "base64"));
      } else {
        job.reject(new Error(msg.error || "Worker thread failed"));
      }
      
      this.dispatch();
    });
    
    worker.on("error", (error) => {
      const job = wrapped.currentJob;
      wrapped.currentJob = null;
      wrapped.busy = false;
      
      if (job) job.reject(error);
    });
    
    worker.on("exit", (code) => {
      if (code !== 0) {
        const job = wrapped.currentJob;
        wrapped.currentJob = null;
        wrapped.busy = false;
        
        if (job) {
          job.reject(new Error(`Worker exited with code ${code}`));
        }
        
        const index = this.workers.indexOf(wrapped);
        if (index >= 0) {
          this.workers[index] = this.createWorker();
        }
      }
    });
    
    return wrapped;
  }
  
  run(filePath) {
    return new Promise((resolve, reject) => {
      const job = {
        id: ++this.jobId,
        filePath,
        resolve,
        reject
      };
      
      this.queue.push(job);
      this.dispatch();
    });
  }
  
  dispatch() {
    for (const wrapped of this.workers) {
      if (wrapped.busy) continue;
      const job = this.queue.shift();
      if (!job) return;
      
      wrapped.busy = true;
      wrapped.currentJob = job;
      wrapped.worker.postMessage({
        id: job.id,
        filePath: job.filePath
      });
    }
  }
  
  async close() {
    await Promise.allSettled(this.workers.map((w) => w.worker.terminate()));
  }
}