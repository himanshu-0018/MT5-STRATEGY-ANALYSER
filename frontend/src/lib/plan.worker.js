/* eslint-disable no-restricted-globals */
import { computeBrain } from "./brainCompute";

let model = null;

self.onmessage = (event) => {
  const { type, id, model: incoming, opts } = event.data || {};
  if (type === "model") {
    model = incoming;
    self.postMessage({ id, type: "model-ready" });
    return;
  }
  if (type !== "plan") return;
  try {
    if (!model) throw new Error("No model in the worker yet");
    const result = computeBrain(model, opts);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
