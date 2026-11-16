/**
 * Risk Brain - position sizing engine.
 *
 * ---------------------------------------------------------------------------
 * The idea
 * ---------------------------------------------------------------------------
 * Every uploaded report was produced at a fixed lot size. For a fixed-lot
 * strategy P&L is linear in lot: doubling the lot doubles every win, every
 * loss, every commission and therefore every dollar of drawdown. So if we
 * normalise each report to "P&L per 1.00 lot", the combined equity curve for
 * any vector of lot sizes `w` is simply
 *
 *      equity(t) = start + SUM_i  w_i * C_i(t)
 *
 * where `C_i(t)` is EA i's cumulative P&L-per-lot at time t.
 *
 * Drawdown (in dollars) is then
 *
 *      DD(w) = max_{s <= t} ( equity(s) - equity(t) )
 *            = max_k <w, a_k>          for the finite set of window vectors
 *                                       a_k = C(s_k) - C(t_k)
 *
 * i.e. a max of linear functions => convex, positively homogeneous of degree 1.
 * That means "maximum profit subject to DD <= budget" is a clean linear
 * program, and the optimal allocation direction is independent of the budget
 * (the budget only scales the size). We solve it exactly with a cutting-plane
 * loop around the simplex solver: solve the LP over the windows discovered so
 * far, measure the true drawdown of that solution, add the worst violated
 * window as a new constraint, repeat until the LP answer is feasible - at that
 * point it is globally optimal.
 * ---------------------------------------------------------------------------
 */

import { solveLP } from "./simplex";

/** Solved max-profit vertex per model, keyed by cap settings (see maxProfitLots). */
const directionCache = new WeakMap();

const EPS = 1e-9;
const DAY = 86400000;

/**
 * Sizing model limits.
 *
 * The model used to be a dense reports x timestamps matrix (~46M numbers for a
 * 342-report book). It is now sparse - one entry per deal on a shared timeline -
 * so memory and per-evaluation cost scale with the number of DEALS, not with
 * reports x timestamps. The caps are absurdly high compared to what a human can
 * actually size, and exist only so the tab can never lock up.
 */
export const RISK_MODEL_MAX_REPORTS = 1000;
export const RISK_MODEL_MAX_EVENTS = 4_000_000;

export class RiskModelTooLargeError extends Error {
  constructor(info) {
    super("Too many reports to size at once");
    this.name = "RiskModelTooLargeError";
    this.info = info;
  }
}


export const roundDown = (v, step) => {
  if (!(step > 0)) return v;
  const n = Math.floor(v / step + 1e-9);
  return parseFloat((n * step).toFixed(8));
};

export const roundLot = (v, step) => {
  if (!(step > 0)) return v;
  return parseFloat((Math.round(v / step) * step).toFixed(8));
};

export const lotDecimals = (step) => {
  const s = String(step);
  const i = s.indexOf(".");
  return i < 0 ? 0 : s.length - i - 1;
};

export const fmtLot = (v, step = 0.01) => (v == null || !Number.isFinite(v) ? "-" : v.toFixed(lotDecimals(step)));

export const modalVolume = (deals) => {
  const counts = new Map();
  for (const d of deals) {
    if (!(d.volume > 0)) continue;
    const k = d.volume.toFixed(4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; best = parseFloat(k); }
  return best || 1;
};

const utcDay = (t) => Math.floor(t / DAY) * DAY;
const dot = (xs, ys) => {
  let s2 = 0;
  for (let i = 0; i < xs.length; i++) s2 += xs[i] * ys[i];
  return s2;
};

export function buildRiskModel(reports) {
  if (!reports || !reports.length) return null;

  const eas = [];
  const timeSet = new Set();

  for (const r of reports) {
    const refLot = modalVolume(r.deals);
    const deals = [];
    let profit = 0;
    for (const d of r.deals) {
      const vol = d.volume > 0 ? d.volume : refLot;
      const ppl = vol > 0 ? d.net / vol : 0;
      deals.push({ time: d.time, ppl, net: d.net, volume: vol, isOut: d.isOut, symbol: d.symbol });
      profit += ppl;
      timeSet.add(d.time);
    }
    deals.sort((a, b) => a.time - b.time);
    eas.push({
      id: r.id,
      name: r.expert,
      eaExpert: r.eaExpert || "",
      symbol: r.symbol,
      symbols: r.symbols || [],
      refLot,
      trades: deals.filter((d) => d.isOut).length,
      deals,
      totalPerLot: profit,
    });
  }

  const times = Float64Array.from([...timeSet].sort((a, b) => a - b));
  const T = times.length;

  let eventCount = 0;
  for (const ea of eas) eventCount += ea.deals.length;
  if (eas.length > RISK_MODEL_MAX_REPORTS || eventCount > RISK_MODEL_MAX_EVENTS) {
    throw new RiskModelTooLargeError({
      reports: eas.length,
      events: eventCount,
      timestamps: T,
      maxReports: RISK_MODEL_MAX_REPORTS,
      maxEvents: RISK_MODEL_MAX_EVENTS,
    });
  }

  // time -> timeline index
  const index = new Map();
  for (let j = 0; j < T; j++) index.set(times[j], j);

  // flat event list bucketed by timeline index: evStart[g]..evStart[g+1]
  const counts = new Int32Array(T);
  for (const ea of eas) {
    for (const d of ea.deals) counts[index.get(d.time)] += 1;
  }
  const evStart = new Int32Array(T + 1);
  for (let j = 0; j < T; j++) evStart[j + 1] = evStart[j] + counts[j];
  const evEa = new Int32Array(eventCount);
  const evPpl = new Float64Array(eventCount);
  const cursor = evStart.slice(0, T);
  for (let i = 0; i < eas.length; i++) {
    for (const d of eas[i].deals) {
      const g = index.get(d.time);
      const k = cursor[g]++;
      evEa[k] = i;
      evPpl[k] = d.ppl;
    }
  }

  // per-EA view: which timeline slot each deal lands in, plus its running sum
  for (const ea of eas) {
    const n = ea.deals.length;
    const g = new Int32Array(n);
    const gcum = new Float64Array(n);
    let run = 0;
    for (let k = 0; k < n; k++) {
      g[k] = index.get(ea.deals[k].time);
      run += ea.deals[k].ppl;
      gcum[k] = run;
    }
    ea.g = g;
    ea.gcum = gcum;

    // standalone drawdown of this EA at 1.00 lot
    let peak = 0;
    let dd = 0;
    for (let k = 0; k < n; k++) {
      const v = gcum[k];
      if (v > peak) peak = v;
      const cur = peak - v;
      if (cur > dd) dd = cur;
    }
    ea.ddPerLot = dd;
    ea.firstTime = n ? ea.deals[0].time : null;
    ea.lastTime = n ? ea.deals[n - 1].time : null;
  }

  const daily = buildDailyMatrix(eas);

  return { eas, times, T, daily, evStart, evEa, evPpl, eventCount, from: times[0], to: times[T - 1], count: reports.length };
}

/** Joint calendar-day P&L matrix, used by the Monte Carlo engine. */
function buildDailyMatrix(eas) {
  const daySet = new Set();
  for (const ea of eas) for (const d of ea.deals) daySet.add(utcDay(d.time));
  const days = Float64Array.from([...daySet].sort((a, b) => a - b));
  const nd = days.length;
  const idx = new Map();
  for (let i = 0; i < nd; i++) idx.set(days[i], i);

  const mat = eas.map((ea) => {
    const arr = new Float64Array(nd);
    for (const d of ea.deals) arr[idx.get(utcDay(d.time))] += d.ppl;
    return arr;
  });
  return { days, nd, mat };
}

/* -------------------------------------------------------------------------- */
/* evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/** Cumulative P&L-per-lot of one report at timeline index g (binary search). */
export function cumAt(model, i, g) {
  const ea = model.eas[i];
  const arr = ea.g;
  let lo = 0;
  let hi = arr.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= g) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return best < 0 ? 0 : ea.gcum[best];
}

/** The whole cumulative curve of one report, materialised (used by the greedy step fill). */
function cumSeries(model, i) {
  const { T } = model;
  const ea = model.eas[i];
  const out = new Float64Array(T);
  let k = 0;
  let val = 0;
  for (let j = 0; j < T; j++) {
    while (k < ea.g.length && ea.g[k] <= j) { val = ea.gcum[k]; k += 1; }
    out[j] = val;
  }
  return out;
}

export function equityAt(model, lots) {
  const { T, evStart, evEa, evPpl } = model;
  const eq = new Float64Array(T);
  let run = 0;
  for (let g = 0; g < T; g++) {
    let step = 0;
    for (let k = evStart[g]; k < evStart[g + 1]; k++) step += (lots[evEa[k]] || 0) * evPpl[k];
    run += step;
    eq[g] = run;
  }
  return eq;
}

/**
 * Fast walk: drawdown of an already-built equity array. O(T).
 *
 * `blocks > 1` also returns the deepest trough inside each slice of the
 * timeline, which the cutting-plane solver adds as several constraints at once.
 * A single cut per iteration converges very slowly on a 300-report book because
 * the LP can dodge it by reallocating across hundreds of strategies.
 */
function walk(eq, T, blocks = 1) {
  let peak = 0;
  let bestPeakIdx = 0;
  let dd = 0;
  let ddIdx = 0;
  let peakAtTrough = 0;
  const cuts = blocks > 1 ? new Array(blocks).fill(null) : null;
  const span = T > 0 ? T / blocks : 1;
  for (let j = 0; j < T; j++) {
    const v = eq[j];
    if (v > peak) { peak = v; bestPeakIdx = j; }
    const cur = peak - v;
    if (cur > dd) { dd = cur; ddIdx = j; peakAtTrough = bestPeakIdx; }
    if (cuts && cur > 0) {
      const b = Math.min(blocks - 1, (j / span) | 0);
      const seenCut = cuts[b];
      if (!seenCut || cur > seenCut.d) cuts[b] = { d: cur, t: j, p: bestPeakIdx };
    }
  }
  return { dd, peakIdx: peakAtTrough, troughIdx: ddIdx, peak, cuts };
}

/** Combined equity, profit and true (deal-by-deal) drawdown for a lot vector. */
export function evaluatePlan(model, lots) {
  const { times, T, eas } = model;
  const eq = equityAt(model, lots);
  const w = walk(eq, T);
  const profit = T ? eq[T - 1] : 0;
  const contrib = new Array(eas.length).fill(0);
  if (w.dd > 0) {
    for (let i = 0; i < eas.length; i++) {
      contrib[i] = (lots[i] || 0) * (cumAt(model, i, w.peakIdx) - cumAt(model, i, w.troughIdx));
    }
  }
  return {
    eq,
    profit,
    dd: w.dd,
    peakIdx: w.peakIdx,
    troughIdx: w.troughIdx,
    peakTime: times[w.peakIdx],
    troughTime: times[w.troughIdx],
    peakBal: w.peak,
    contrib,
  };
}

/* -------------------------------------------------------------------------- */
/* optimisers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Most this strategy may be sized to, in lots.
 *
 * `perLot` is the lot size at which the strategy's OWN worst peak-to-trough dip
 * equals the whole budget. `riskCap` scales that: 1 = "no single EA may ever
 * draw down more than the budget on its own", 0.25 = "not more than a quarter
 * of it", 25 = no cap (pure max-profit; the LP only constrains the combined
 * curve).
 */
function capFor(model, budget, i, maxLot, riskCap = 1) {
  const ea = model.eas[i];
  if (!(ea.ddPerLot > budget * 1e-6)) return maxLot;
  const perLot = budget / ea.ddPerLot;
  return Math.max(1e-9, Math.min(maxLot, riskCap * perLot));
}

function capsFor(model, budget, maxLot, blocked, riskCap = 1) {
  return model.eas.map((_, i) =>
    blocked && blocked[i] ? 0 : capFor(model, budget, i, maxLot, riskCap),
  );
}

/**
 * Global optimum of  max profit  s.t.  DD(w) <= budget,  w >= 0.
 * Cutting-plane around an LP whose constraints are the drawdown windows
 * discovered so far.
 */
export function maxProfitLots(model, budget, opts = {}) {
  const { eas } = model;
  const m = eas.length;
  if (m === 0 || !(budget > 0)) return { lots: new Array(m).fill(0), iters: 0, converged: false, cap: [] };

  const maxLot = opts.maxLot || 500;
  const blocked = opts.blocked;
  const cap = capsFor(model, budget, maxLot, blocked, opts.riskCap || 1);

  // Work in units of each strategy's own cap (w = scale * u, u in [0,1]).
  // The raw LP mixes caps from 0.001 to 100 lots and window coefficients that
  // span orders of magnitude, which makes the simplex crawl through degenerate
  // pivots. This scaling is an exact reparametrisation of the same problem.
  const scale = cap.map((c) => (c > 0 ? c : 1));
  const profit = eas.map((e, i) => (blocked && blocked[i] ? 0 : e.totalPerLot * scale[i]));

  const capRows = [];
  for (let i = 0; i < m; i++) {
    const row = new Array(m).fill(0);
    row[i] = 1;
    capRows.push({ a: row, b: 1 });
  }

  const CUTS = 10;
  const seen = new Set();
  let cutRows = [];
  const addCut = (p, t, at) => {
    const key = `${p}:${t}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const row = eas.map((_, i) => (cumAt(model, i, p) - cumAt(model, i, t)) * scale[i]);
    // normalise the row so every cut has comparable magnitude (same half-space)
    let norm = 0;
    for (const v of row) norm = Math.max(norm, Math.abs(v));
    if (norm < 1e-12) return false;
    cutRows.push({ a: row.map((v) => v / norm), b: budget / norm, key, at });
    return true;
  };

  // Seed with several windows from an equal-risk mix so the first LP is sharp.
  const seedLots = eas.map((e, i) => (cap[i] > 0 ? Math.min(cap[i], (budget / m) / Math.max(e.ddPerLot, budget * 1e-6)) : 0));
  const seedDD = walk(equityAt(model, seedLots), model.T, CUTS);
  if (seedDD.dd > budget * 1e-9) {
    addCut(seedDD.peakIdx, seedDD.troughIdx, 0);
    for (const c of seedDD.cuts) if (c) addCut(c.p, c.t, 0);
  }

  // The LP is homogeneous in the budget: caps and cut right-hand sides both
  // scale with it, so a solution found at one budget is the solution at any
  // other budget, rescaled. Cache the vertex per (model, cap) and scale.
  const cacheKey = `${opts.riskCap || 1}|${maxLot}|${blocked ? blocked.map((b) => (b ? 1 : 0)).join("") : "-"}`;
  let store = directionCache.get(model);
  if (!store) { store = new Map(); directionCache.set(model, store); }
  const cached = store.get(cacheKey);
  if (cached && cached.budget > 0 && budget > 0) {
    const f = budget / cached.budget;
    return { lots: cached.lots.map((v) => v * f), iters: cached.iters, converged: cached.converged, cap, warm: true };
  }

  let best = null;
  let iters = 0;
  const maxIters = opts.maxIters || 90;

  for (; iters < maxIters; iters++) {
    const rows = cutRows.length ? capRows.concat(cutRows) : capRows;
    const lp = solveLP(profit, rows.map((r) => r.a), rows.map((r) => r.b));
    if (!lp || !lp.x) break;

    const u = lp.x;
    const w = u.map((v, i) => (cap[i] > 0 ? Math.min(cap[i], Math.max(0, v * scale[i])) : 0));
    const r = walk(equityAt(model, w), model.T, CUTS);
    if (r.dd <= budget * (1 + 1e-7)) {
      store.set(cacheKey, { budget, lots: w.slice(), iters: iters + 1, converged: true });
      return { lots: w, iters: iters + 1, converged: true, cap };
    }
    if (!best || r.dd < best.dd) best = { lots: w, dd: r.dd };

    let added = addCut(r.peakIdx, r.troughIdx, iters) ? 1 : 0;
    for (const c of r.cuts) if (c && addCut(c.p, c.t, iters)) added += 1;
    if (!added) break;

    // Drop cuts that have gone slack: they no longer shape the solution, but
    // every extra row makes the simplex slower. A dropped window that becomes
    // violated again is simply re-added (its key is released).
    if (cutRows.length > 40) {
      const keep = [];
      for (const row of cutRows) {
        let slack = row.b;
        for (let i = 0; i < m; i++) slack -= row.a[i] * u[i];
        if (iters - row.at < 3 || slack <= row.b * 0.02) { keep.push(row); continue; }
        seen.delete(row.key);
      }
      cutRows = keep;
    }
  }

  return { lots: best?.lots || seedLots, iters, converged: false, cap };
}

/**
 * One common multiplier applied to every strategy's *original* lot size.
 * Drawdown is homogeneous, so the answer is closed form:
 *      k = budget / DD(original lots).
 */
export function uniformLots(model, budget, opts = {}) {
  const m = model.eas.length;
  const blocked = opts.blocked;
  const ref = model.eas.map((e, i) => (blocked && blocked[i] ? 0 : e.refLot || 1));
  if (!(budget > 0) || !ref.some((v) => v)) return { lots: new Array(m).fill(0), k: 0 };
  const base = walk(equityAt(model, ref), model.T).dd;
  const k = base > 0 ? budget / base : 0;
  return { lots: ref.map((r) => r * k), k };
}

/**
 * Equal risk budget per strategy: w_i * DD_i(1 lot) = budget / m.
 * That guarantees the combined drawdown can never exceed the budget, because
 * DD(sum) <= sum DD_i for a max-of-linear drawdown - i.e. this is the
 * "worst case: every strategy draws down at the same moment" plan.
 */
export function riskParityLots(model, budget, opts = {}) {
  const { eas } = model;
  const m = eas.length;
  if (!m || !(budget > 0)) return { lots: new Array(m).fill(0) };
  const maxLot = opts.maxLot || 500;
  const blocked = opts.blocked;
  const share = Math.min(budget / m, budget * (opts.riskCap || 1));
  const lots = eas.map((e, i) => {
    if (blocked && blocked[i]) return 0;
    if (e.totalPerLot <= 0) return 0;
    if (e.ddPerLot <= 0) return Math.min(maxLot, 1);
    return Math.min(maxLot, share / e.ddPerLot);
  });
  return { lots };
}

export function standaloneMaxLots(model, budget, opts = {}) {
  const maxLot = opts.maxLot || 500;
  return model.eas.map((e) =>
    e.ddPerLot > 0 ? Math.min(maxLot, budget / e.ddPerLot) : e.totalPerLot > 0 ? maxLot : 0,
  );
}

/* -------------------------------------------------------------------------- */
/* lot-step refinement                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Flooring to the broker lot step can leave budget on the table (and, with a
 * tight budget, can round everything to zero). Starting from the floored plan
 * we greedily add one lot step at a time to whichever strategy buys the most
 * profit while staying inside the budget. Each candidate is checked with an
 * exact O(T) drawdown walk on the cached equity array, so this stays cheap.
 */
function ddWithDelta(model, eq, i, delta) {
  const { T } = model;
  const cum = cumSeries(model, i);
  let peak = 0;
  let dd = 0;
  for (let j = 0; j < T; j++) {
    const v = eq[j] + delta * cum[j];
    if (v > peak) peak = v;
    const d = peak - v;
    if (d > dd) dd = d;
  }
  return dd;
}

function refineToStep(model, lots, budget, step, cap) {
  const { T, eas } = model;
  let cur = lots.slice();
  let eq = equityAt(model, cur);
  let curProfit = dot(cur, eas.map((e) => e.totalPerLot));
  // Each candidate costs a full O(T) walk, so a 300-report book only gets a few
  // refinement steps (the LP solution is already continuous-optimal).
  const maxAdds = eas.length > 60 ? 4 : Math.min(60, 2 * eas.length + 6);
  const series = [];

  for (let add = 0; add < maxAdds; add++) {
    let best = null;
    for (let i = 0; i < eas.length; i++) {
      if (cap && lot0(cap[i]) <= 0) continue;
      const next = parseFloat((cur[i] + step).toFixed(8));
      if (next < step / 2) continue;
      if (cap && next > cap[i] + step * 1e-6) continue;
      if (!series[i]) series[i] = cumSeries(model, i);
      const cum = series[i];
      // walk the hypothetical curve without rebuilding it
      let peak = 0;
      let dd = 0;
      for (let j = 0; j < T; j++) {
        const v = eq[j] + step * cum[j];
        if (v > peak) peak = v;
        const d = peak - v;
        if (d > dd) dd = d;
      }
      if (dd > budget * (1 - 1e-9)) continue;
      const p = curProfit + step * eas[i].totalPerLot;
      if (p > curProfit + 1e-9 && (!best || p > best.p)) best = { i, p, dd };
    }
    if (!best) break;
    cur[best.i] = parseFloat((cur[best.i] + step).toFixed(8));
    const cum = series[best.i] || (series[best.i] = cumSeries(model, best.i));
    for (let j = 0; j < T; j++) eq[j] += step * cum[j];
    curProfit = best.p;
  }
  return cur;
}

const lot0 = (v) => (Number.isFinite(v) ? v : 0);

const money = (v) =>
  `$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* -------------------------------------------------------------------------- */
/* plan assembly                                                              */
/* -------------------------------------------------------------------------- */

export function buildPlan(model, opts) {
  const {
    budget,
    mode = "maxprofit",
    safety = 1,
    lotStep = 0.01,
    maxLot = 500,
    customLots = null,
    blocked = null,
    riskCap = 1,
  } = opts;

  const m = model.eas.length;
  const effectiveBudget = Math.max(0, budget * safety);
  const warnings = [];
  const w = { maxLot, blocked, riskCap };
  let raw;
  let cap = capsFor(model, effectiveBudget, maxLot, blocked, riskCap);

  if (mode === "custom" && customLots) {
    raw = customLots.slice();
  } else if (mode === "uniform") {
    raw = uniformLots(model, effectiveBudget, w).lots;
  } else if (mode === "riskparity") {
    raw = riskParityLots(model, effectiveBudget, w).lots;
  } else {
    raw = maxProfitLots(model, effectiveBudget, w).lots;
  }
  raw = raw.map((v, i) => {
    if (blocked && blocked[i]) return 0;
    // a hand-edited plan is the user's call; optimiser output respects the cap
    return mode === "custom" ? v : Math.min(v, cap[i]);
  });

  let lots = raw.map((v) => Math.max(0, roundDown(v, lotStep)));
  let ev = evaluatePlan(model, lots);

  // Safety net: if the floor-rounded plan still breaches, scale the whole
  // book down (a uniform shrink scales drawdown by exactly the same factor).
  let guard = 0;
  while (mode !== "custom" && ev.dd > effectiveBudget + 1e-6 && guard++ < 12) {
    const f = Math.max(0, (effectiveBudget / ev.dd) * 0.99);
    lots = lots.map((v) => roundDown(v * f, lotStep));
    ev = evaluatePlan(model, lots);
    if (lots.every((v) => v === 0)) break;
  }

  if (mode !== "custom" && effectiveBudget > 0) {
    lots = refineToStep(model, lots, effectiveBudget, lotStep, cap);
    ev = evaluatePlan(model, lots);
  }

  const feasible = ev.dd <= effectiveBudget + 1e-6;
  if (!feasible && mode !== "custom") {
    warnings.push("The broker lot step is too coarse for this budget - the plan is slightly over.");
  }

  const perEa = model.eas.map((e, i) => {
    const lot = lots[i] || 0;
    const contrib = ev.contrib[i] || 0;
    const refLot = e.refLot;
    const beforeProfit = refLot * e.totalPerLot;
    const beforeDD = refLot * e.ddPerLot;

    // ---- verdict: what should the trader actually do with this EA? ----
    let action = "keep";
    let reason = "";
    const tol = lotStep / 2;
    if (blocked && blocked[i]) {
      action = "drop";
      reason = "You excluded it from this plan.";
    } else if (lot === 0) {
      action = "drop";
      if (e.totalPerLot <= 0) {
        reason = `Loses ${money(Math.abs(e.totalPerLot))} per lot - it can only cost you profit.`;
      } else if (raw[i] > 0 && raw[i] < lotStep) {
        reason = e.ddPerLot > 0 && cap[i] < lotStep
          ? `The risk cap (${Math.round(riskCap * 100)}% of the budget) allows only ${raw[i].toFixed(3)} lots - below the ${lotStep} minimum.`
          : `Your budget only funds ${raw[i].toFixed(3)} lots - below the ${lotStep} minimum, so it cannot be traded inside this drawdown limit.`;
      } else if (e.ddPerLot > 0) {
        const hypoDD = ddWithDelta(model, ev.eq, i, lotStep);
        reason =
          hypoDD > effectiveBudget
            ? `One ${lotStep} lot takes drawdown to ${money(hypoDD)} - ${money(hypoDD - effectiveBudget)} over your limit (it would add ${money(lotStep * e.totalPerLot)} of profit). Not affordable at this budget.`
            : `A ${lotStep} lot fits, but only adds ${money(lotStep * e.totalPerLot)} - the budget is worth more on the strategies above.`;
      } else {
        reason = "No measurable drawdown, but no profit either.";
      }
    } else if (lot > refLot + tol) {
      action = "increase";
      reason = `Room to grow from ${fmtLot(refLot, lotStep)} to ${fmtLot(lot, lotStep)} lots.`;
    } else if (lot < refLot - tol) {
      action = "reduce";
      reason = `Cut back from ${fmtLot(refLot, lotStep)} to ${fmtLot(lot, lotStep)} lots to stay inside the budget.`;
    } else {
      action = "keep";
      reason = `${fmtLot(lot, lotStep)} lots is already the right size for this budget.`;
    }

    return {
      id: e.id,
      name: e.name,
      eaExpert: e.eaExpert,
      symbol: e.symbol,
      symbols: e.symbols || [],
      refLot,
      trades: e.trades,
      lot,
      rawLot: raw[i] || 0,
      capLot: cap[i],
      multiplier: refLot > 0 ? lot / refLot : 0,
      profit: lot * e.totalPerLot,
      beforeProfit,
      beforeDD,
      profitPerLot: e.totalPerLot,
      ddPerLot: e.ddPerLot,
      standaloneDD: lot * e.ddPerLot,
      maxSafeAlone: e.ddPerLot > 0 ? budget / e.ddPerLot : Infinity,
      risk: contrib,
      riskPct: ev.dd > 0 ? (contrib / ev.dd) * 100 : 0,
      blocked: !!(blocked && blocked[i]),
      action,
      reason,
    };
  });

  const maxStandalone = perEa.reduce((mx, e) => Math.max(mx, e.standaloneDD), 0);
  const maxStandaloneEa = perEa.reduce((worst, e) => (e.standaloneDD > (worst?.standaloneDD ?? -1) ? e : worst), null);
  const overBudget = perEa.filter((e) => e.standaloneDD > effectiveBudget + 1e-6);

  const totalProfit = perEa.reduce((s, e) => s + e.profit, 0);
  if (lots.every((v) => v === 0) && effectiveBudget > 0) {
    warnings.push("Budget too small for even the smallest lot step on the best strategy.");
  }

  const refLots = model.eas.map((e) => e.refLot || 1);
  const beforeEV = evaluatePlan(model, refLots);
  const beforeProfit = refLots.reduce((s, w, i) => s + w * model.eas[i].totalPerLot, 0);
  const before = {
    lots: refLots,
    totalLots: refLots.reduce((a, b) => a + b, 0),
    profit: beforeProfit,
    dd: beforeEV.dd,
    ddPct: beforeEV.peakBal > 0 ? beforeEV.dd / beforeEV.peakBal : 0,
    profitPerDD: beforeEV.dd > 0 ? beforeProfit / beforeEV.dd : Infinity,
    // profit the same book would have made if it were simply shrunk to fit the
    // budget - the "do nothing but resize" baseline the brain has to beat
    atBudgetProfit: beforeEV.dd > 0 ? beforeProfit * (effectiveBudget / beforeEV.dd) : beforeProfit,
  };

  if (riskCap < 1) {
    const cappedOut = perEa.filter((e) => e.lot === 0 && e.capLot < lotStep && e.profitPerLot > 0 && !e.blocked);
    if (cappedOut.length) {
      warnings.push(
        `The ${Math.round(riskCap * 100)}% risk cap is below one ${lotStep} lot for ${cappedOut.length} strateg${cappedOut.length === 1 ? "y" : "ies"} - they cannot be sized at all.`,
      );
    }
  }

  const drops = perEa.filter((e) => e.action === "drop");
  const increases = perEa.filter((e) => e.action === "increase");
  const reductions = perEa.filter((e) => e.action === "reduce");
  const keeps = perEa.filter((e) => e.action === "keep");

  return {
    mode,
    budget,
    safety,
    effectiveBudget,
    lotStep,
    lots,
    perEa,
    profit: totalProfit,
    dd: ev.dd,
    ddPct: ev.peakBal > 0 ? ev.dd / ev.peakBal : 0,
    peakTime: ev.peakTime,
    troughTime: ev.troughTime,
    peakBal: ev.peakBal,
    profitPerDD: ev.dd > 0 ? totalProfit / ev.dd : Infinity,
    totalLots: lots.reduce((a, b) => a + b, 0),
    feasible,
    warnings,
    before,
    drops,
    increases,
    reductions,
    keeps,
    riskCap,
    maxStandalone,
    maxStandaloneEa,
    overBudget,
    activeCount: perEa.filter((e) => e.lot > 0).length,
    worstCaseDD: perEa.reduce((s, e) => s + e.standaloneDD, 0),
    frontierSlope: ev.dd > 0 ? totalProfit / ev.dd : 0,
  };
}

/* -------------------------------------------------------------------------- */
/* efficient frontier                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The three sizing philosophies, each measured at the same drawdown budget.
 * Because drawdown is homogeneous, every method scales linearly with the
 * budget - so the "frontier" is a set of rays out of the origin and the
 * steepest one simply buys the most profit per dollar of risk.
 */
export function efficientFrontier(model, { budget, maxLot = 500, riskCap = 1 } = {}) {
  if (!model || !(budget > 0)) return [];
  const totals = model.eas.map((e) => e.totalPerLot);
  const o = { maxLot, riskCap };
  const methods = [
    { key: "maxprofit", lots: maxProfitLots(model, budget, o).lots },
    { key: "uniform", lots: uniformLots(model, budget, o).lots },
    { key: "riskparity", lots: riskParityLots(model, budget, o).lots },
  ];
  return methods.map(({ key, lots }) => {
    const ev = evaluatePlan(model, lots);
    const profit = dot(lots, totals);
    return { key, dd: ev.dd, profit, slope: ev.dd > 0 ? profit / ev.dd : 0, lots };
  });
}

/* -------------------------------------------------------------------------- */
/* Monte Carlo                                                                */
/* -------------------------------------------------------------------------- */

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function dailyDD(model, lots, order) {
  const { nd, mat } = model.daily;
  const m = model.eas.length;
  let bal = 0;
  let peak = 0;
  let dd = 0;
  for (let s = 0; s < nd; s++) {
    const d = order ? order[s] : s;
    let pnl = 0;
    for (let i = 0; i < m; i++) if (lots[i]) pnl += lots[i] * mat[i][d];
    bal += pnl;
    if (bal > peak) peak = bal;
    const cur = peak - bal;
    if (cur > dd) dd = cur;
  }
  return dd;
}

/**
 * Block bootstrap over the joint calendar-day P&L matrix (all strategies are
 * resampled on the same days, so cross-strategy correlation is preserved).
 * The backtest is one path; this says how bad the drawdown typically gets on
 * another path of the same statistical character.
 */
export function monteCarlo(model, lots, opts = {}) {
  const { histDD = 0, sims = 400, blockDays = 5, seed = 42, budget = 0 } = opts;
  if (!model || !model.daily.nd || !lots || !lots.some((v) => v)) return null;
  const { nd } = model.daily;

  const histDaily = dailyDD(model, lots, null) || 1e-9;
  const intradayFactor = Math.min(3, Math.max(1, histDD / histDaily));

  const rng = mulberry32(seed);
  const block = Math.max(1, Math.min(blockDays, nd));
  const maxStart = Math.max(1, nd - block);
  const dds = new Float64Array(sims);

  for (let s = 0; s < sims; s++) {
    const order = new Int32Array(nd);
    let p = 0;
    while (p < nd) {
      const start = Math.floor(rng() * maxStart);
      for (let b = 0; b < block && p < nd; b++, p++) order[p] = (start + b) % nd;
    }
    dds[s] = dailyDD(model, lots, order) * intradayFactor;
  }

  const sorted = Array.from(dds).sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sims - 1, Math.max(0, Math.floor(p * sims)))];

  const p50 = q(0.5);
  const p90 = q(0.9);
  const p95 = q(0.95);
  const p99 = q(0.99);
  const breaches = budget > 0 ? sorted.filter((v) => v > budget).length / sims : 0;
  const scale = budget > 0 && p95 > budget ? budget / p95 : 1;

  return {
    sims,
    blockDays: block,
    p50,
    p90,
    p95,
    p99,
    max: sorted[sorted.length - 1],
    historical: histDD,
    histDaily,
    intradayFactor,
    breaches,
    confidence: 1 - breaches,
    scale,
    robustLots: lots.map((v) => v * scale),
    samples: sorted,
  };
}

/** Sum of every strategy's own worst-case drawdown at this sizing. */
export function worstCaseDD(model, lots) {
  return model.eas.reduce((s, e, i) => s + (lots[i] || 0) * e.ddPerLot, 0);
}

/* -------------------------------------------------------------------------- */
/* re-usable portfolio view                                                   */
/* -------------------------------------------------------------------------- */

/** Build report objects at the planned lot sizes so the existing charts work. */
export function scaleReports(model, lots, start) {
  return model.eas
    .map((e, i) => {
      const w = lots[i] || 0;
      return {
        id: e.id,
        expert: e.name,
        symbol: e.symbol,
        fileName: e.name,
        initialDeposit: start,
        deals: e.deals.map((d) => ({
          time: d.time,
          isOut: d.isOut,
          symbol: d.symbol,
          net: d.ppl * w,
          volume: w,
        })),
      };
    })
    .filter((r, i) => (lots[i] || 0) > 0);
}
