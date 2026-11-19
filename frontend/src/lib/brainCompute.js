import { buildPlan, efficientFrontier, monteCarlo, scaleReports } from "./riskBrain";
import { buildPortfolio } from "./portfolio";
import { buildInsights } from "./insights";

/**
 * Everything the Lot Brain displays, computed from one settings object.
 *
 * Runs in a Web Worker (see plan.worker.js) so a 300-report optimiser pass no
 * longer freezes the tab, and is also the synchronous fallback for browsers
 * without workers.
 */
export function computeBrain(model, opts) {
  const { start = 1000, budget, maxLot, riskCap, lotStep } = opts;
  const plan = buildPlan(model, opts);

  // the "after" portfolio is only used for its curve and monthly totals, so
  // return a light copy instead of the full event list
  let portfolio = null;
  const scaled = scaleReports(model, plan.lots, start);
  if (scaled.length) {
    const p = buildPortfolio(scaled, start);
    portfolio = { curve: p.curve, months: p.months, stats: p.stats };
  }

  const mc = monteCarlo(model, plan.lots, {
    histDD: plan.dd,
    sims: 400,
    budget: plan.effectiveBudget != null ? plan.effectiveBudget : budget,
  });
  const frontier = efficientFrontier(model, { budget, maxLot, riskCap });
  const insights = buildInsights({ model, plan, baseline: plan.before, mc, budget, start, lotStep });

  return { plan, portfolio, mc, frontier, insights };
}
