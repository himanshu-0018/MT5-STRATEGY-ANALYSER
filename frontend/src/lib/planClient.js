import { computeBrain } from "./brainCompute";

/**
 * Runs the Lot Brain in a Web Worker so the tab stays responsive while a large
 * book is being sized, and falls back to computing inline when workers are not
 * available (older browsers, test environments).
 */
let worker = null;
let workerBroken = false;
let cachedModel = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker || workerBroken) return worker;
  if (typeof Worker === "undefined") { workerBroken = true; return null; }
  try {
    worker = new Worker(new URL("./plan.worker.js", import.meta.url));
    worker.onmessage = (event) => {
      const { id, result, error } = event.data || {};
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(result);
    };
    worker.onerror = () => {
      // the model clone or the worker itself failed - compute inline from now on
      workerBroken = true;
      worker = null;
      cachedModel = null;
      for (const job of pending.values()) job.fallback();
      pending.clear();
    };
  } catch (err) {
    workerBroken = true;
    worker = null;
  }
  return worker;
}

export function runBrain(model, opts) {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => computeBrain(model, opts));

  if (cachedModel !== model) {
    cachedModel = model;
    w.postMessage({ type: "model", model });
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, {
      resolve,
      reject,
      fallback: () => { try { resolve(computeBrain(model, opts)); } catch (err) { reject(err); } },
    });
    w.postMessage({ type: "plan", id, opts });
  });
}

/** Forget the cached model (e.g. after the report list changes identity). */
export function resetBrainWorker() {
  cachedModel = null;
}
