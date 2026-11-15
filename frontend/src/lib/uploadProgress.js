/**
 * Tiny pub/sub store for the upload progress overlay.
 *
 * Deliberately outside React state: while 500 reports are parsed the App must
 * NOT re-render (it holds hundreds of table rows). Only the overlay subscribes,
 * so a progress tick costs one small component render instead of the whole tree.
 */

let state = null;
const listeners = new Set();

const emit = () => {
  for (const fn of listeners) fn();
};

export const uploadProgress = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  snapshot() {
    return state;
  },
  start(total) {
    state = {
      phase: 'parsing',
      total,
      done: 0,
      failed: 0,
      current: '',
      startedAt: Date.now(),
      cancel: false,
    };
    emit();
  },
  update(patch) {
    if (!state) return;
    state = { ...state, ...patch };
    emit();
  },
  setPhase(phase) {
    if (!state) return;
    state = { ...state, phase };
    emit();
  },
  requestCancel() {
    if (!state) return;
    state = { ...state, cancel: true };
    emit();
  },
  isCancelled() {
    return !!(state && state.cancel);
  },
  finish() {
    state = null;
    emit();
  },
};
