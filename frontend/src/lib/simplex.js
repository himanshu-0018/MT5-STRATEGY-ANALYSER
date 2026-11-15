/**
 * Tiny dense primal simplex solver.
 *
 * Solves:  maximise  c . x
 *          subject to A x <= b,  x >= 0        (with b >= 0 so the origin is feasible)
 *
 * The problems produced by the Risk Brain are small (one variable per strategy,
 * at most a few hundred rows), so a straightforward tableau implementation is
 * both fast enough and numerically safe.
 */

const EPS = 1e-9;

export function solveLP(c, A, b, opts = {}) {
  const n = c.length;
  const m = A.length;
  if (n === 0 || m === 0) return { status: "empty", x: new Array(n).fill(0), value: 0 };

  const W = n + m + 1; // columns + slacks + rhs
  const T = new Float64Array((m + 1) * W);
  for (let i = 0; i < m; i++) {
    const row = A[i];
    for (let j = 0; j < n; j++) T[i * W + j] = row[j];
    T[i * W + n + i] = 1;
    T[i * W + n + m] = b[i] < 0 ? 0 : b[i];
  }
  // Objective row stores -c so a negative entry means "can improve".
  const O = m * W;
  for (let j = 0; j < n; j++) T[O + j] = -c[j];

  const basis = new Int32Array(m);
  for (let i = 0; i < m; i++) basis[i] = n + i;

  const maxIter = opts.maxIter || 4000;
  let iter = 0;
  let useBland = false;

  const pivot = (row, col) => {
    const p = T[row * W + col];
    if (Math.abs(p) < 1e-12) return;
    const inv = 1 / p;
    for (let j = 0; j < W; j++) T[row * W + j] *= inv;
    T[row * W + col] = 1;
    for (let i = 0; i <= m; i++) {
      if (i === row) continue;
      const f = T[i * W + col];
      if (f === 0) continue;
      for (let j = 0; j < W; j++) T[i * W + j] -= f * T[row * W + j];
      T[i * W + col] = 0;
    }
  };

  while (iter++ < maxIter) {
    // --- entering column -------------------------------------------------
    let enter = -1;
    if (useBland) {
      for (let j = 0; j < n + m; j++) if (T[O + j] < -EPS) { enter = j; break; }
    } else {
      let best = -EPS;
      for (let j = 0; j < n + m; j++) {
        const v = T[O + j];
        if (v < best) { best = v; enter = j; }
      }
    }
    if (enter < 0) break; // optimal

    // --- leaving row (minimum ratio) -------------------------------------
    let leave = -1;
    let bestRatio = Infinity;
    for (let i = 0; i < m; i++) {
      const a = T[i * W + enter];
      if (a <= EPS) continue;
      const ratio = T[i * W + n + m] / a;
      if (ratio < bestRatio - 1e-12 || (Math.abs(ratio - bestRatio) <= 1e-12 && leave >= 0 && basis[i] < basis[leave])) {
        bestRatio = ratio;
        leave = i;
      }
    }
    if (leave < 0) return { status: "unbounded", x: null, value: Infinity };

    pivot(leave, enter);
    basis[leave] = enter;

    // Dantzig can cycle on degenerate problems. Only fall back to Bland's rule
    // when that actually happens - on a 300-variable LP Dantzig legitimately
    // needs hundreds of pivots, and Bland is ~10x slower per pivot.
    if (!useBland && iter > 900) useBland = true;
  }

  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i * W + n + m];
  for (let j = 0; j < n; j++) if (!Number.isFinite(x[j]) || Math.abs(x[j]) < 1e-12) x[j] = Math.max(0, x[j] || 0);
  let value = 0;
  for (let j = 0; j < n; j++) value += c[j] * x[j];
  return { status: iter > maxIter ? "iteration_limit" : "optimal", x, value };
}
