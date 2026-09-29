/**
 * modelWorkerPool.js
 * -------------------
 * Manages a small pool of inferenceWorker.js threads. Requests are handed
 * out round-robin, so under load (many app users detecting disease at the
 * same time) requests are spread across CPU cores instead of queueing
 * behind a single blocked event loop. Tune INFERENCE_WORKERS in .env to
 * roughly match the number of CPU cores available on your Render instance.
 */
const { Worker } = require("worker_threads");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

class InferencePool {
  constructor(size = 2) {
    this.size = size;
    this.workers = [];
    this.nextWorker = 0;
    this.pending = new Map();
  }

  init() {
    return new Promise((resolve, reject) => {
      let readyCount = 0;
      let settled = false;

      for (let i = 0; i < this.size; i++) {
        const worker = new Worker(path.join(__dirname, "inferenceWorker.js"));

        worker.on("message", (msg) => {
          if (msg.type === "ready") {
            readyCount++;
            console.log(`[Inference] Worker ${i} ready (${readyCount}/${this.size})`);
            if (readyCount === this.size && !settled) {
              settled = true;
              resolve();
            }
          } else if (msg.type === "load-error" && !settled) {
            settled = true;
            reject(new Error(`Worker ${i} failed to load model: ${msg.error}`));
          } else if (msg.type === "result") {
            const p = this.pending.get(msg.id);
            if (p) {
              p.resolve(msg.result);
              this.pending.delete(msg.id);
            }
          } else if (msg.type === "error") {
            const p = this.pending.get(msg.id);
            if (p) {
              p.reject(new Error(msg.error));
              this.pending.delete(msg.id);
            }
          }
        });

        worker.on("error", (err) => {
          console.error(`[Inference] Worker ${i} crashed:`, err.message);
        });

        this.workers.push(worker);
      }
    });
  }

  /**
   * Runs inference on an image buffer. Returns { label, confidence, allScores }.
   */
  predict(arrayBuffer, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = uuidv4();
      const worker = this.workers[this.nextWorker];
      this.nextWorker = (this.nextWorker + 1) % this.size;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Inference timed out"));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });

      // Transfer ownership of the buffer to the worker (zero-copy, faster
      // than the default structured-clone for large image payloads).
      worker.postMessage({ type: "predict", id, buffer: arrayBuffer }, [arrayBuffer]);
    });
  }
}

module.exports = InferencePool;
