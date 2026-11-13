/**
 * Turns the optimiser output into plain-English, actionable notes.
 * Pure data in, list of { tone, title, body } out - easy to unit test.
 */

import { evaluatePlan } from "./riskBrain";

export const baselinePlan = (model) => {
  const refLots = model.eas.map((e) => e.refLot || 1);
  const ev = evaluatePlan(model, refLots);
  const profit = model.eas.reduce((s, e, i) => s + refLots[i] * e.totalPerLot, 0);
  return { lots: refLots, dd: ev.dd, profit, totalLots: refLots.reduce((a, b) => a + b, 0) };
};

/**
 * What happens to drawdown and profit if we add exactly one lot step to one
 * strategy - the "next best trade" analysis behind lot sizing.
 */
export function marginalSteps(model, lots, lotStep) {
  const out = [];
  model.eas.forEach((e, i) => {
    const next = lots.map((v, j) => (j === i ? parseFloat((v + lotStep).toFixed(8)) : v));
    const ev = evaluatePlan(model, next);
    const profit = next.reduce((s, w, j) => s + w * model.eas[j].totalPerLot, 0);
    out.push({
      id: e.id,
      name: e.name,
      dd: ev.dd,
      profit,
      deltaProfit: profit - lots.reduce((s, w, j) => s + w * model.eas[j].totalPerLot, 0),
      deltaDD: ev.dd,
      ddPerLot: e.ddPerLot,
      ratio: e.ddPerLot > 0 ? e.totalPerLot / e.ddPerLot : Infinity,
    });
  });
  return out;
}

const nm = (s, n = 34) => (s && s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function buildInsights({ model, plan, baseline, mc, budget, start, lotStep }) {
  const notes = [];
  const push = (tone, title, body) => notes.push({ id: `n${notes.length}`, tone, title, body });
  const money = (v) => `$${Math.abs(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  if (!model || !plan) return notes;

  const active = plan.perEa.filter((e) => e.lot > 0);
  const sizeMult = baseline.totalLots > 0 ? plan.totalLots / baseline.totalLots : 0;
  const pctUsed = plan.effectiveBudget > 0 ? plan.dd / plan.effectiveBudget : 0;

  /* ---- the headline answer ------------------------------------------- */
  if (active.length === 0) {
    push("bad", "No sizeable combination found",
      `With a ${money(budget)} drawdown budget even the smallest lot step (${lotStep}) does not fit. Raise the budget or add strategies with smaller drawdowns.`);
    return notes;
  }

  if (sizeMult >= 1.02) {
    push("good", `You can size up ${sizeMult.toFixed(1)}×`,
      `${plan.totalLots.toFixed(2)} lots in total across ${active.length} strateg${active.length === 1 ? "y" : "ies"} vs ${baseline.totalLots.toFixed(2)} in the backtests. That turns ${money(baseline.profit)} of backtest profit into about ${money(plan.profit)}, with drawdown capped near ${money(plan.dd)}.`);
  } else if (sizeMult > 0.98) {
    push("info", "Your backtest sizing is already about right",
      `The plan comes out at ${plan.totalLots.toFixed(2)} lots vs ${baseline.totalLots.toFixed(2)} in the reports - the current fixed lot is near the maximum your ${money(budget)} budget supports.`);
  } else {
    push("warn", `You are over-sized by ${(baseline.totalLots / Math.max(plan.totalLots, 1e-9)).toFixed(1)}×`,
      `Running at the backtest lot sizes implies ${money(baseline.dd)} of drawdown, but your budget is ${money(budget)}. The plan cuts the book to ${plan.totalLots.toFixed(2)} lots to keep the worst historical dip inside the budget.`);
  }

  /* ---- a single EA whose own dip exceeds the whole budget -------------- */
  if (plan.overBudget && plan.overBudget.length) {
    const worst = plan.maxStandaloneEa;
    const names = plan.overBudget.map((e) => nm(e.name, 26)).join(", ");
    push(
      "warn",
      `${nm(worst?.name || names, 30)} can dip more than your whole budget on its own`,
      `Your ${money(plan.effectiveBudget)} limit is checked against the combined curve, which is ${money(plan.dd)} because other strategies were earning during that stretch. But ${nm(worst?.name || "", 40)}'s own worst peak-to-trough is ${money(plan.maxStandalone)} - if the rest are flat next time, that one EA breaches the budget by itself. Set "Max risk per EA" to 100% so no single strategy can ever exceed it.`,
    );
  }

  /* ---- the "same risk, better mix" argument --------------------------- */
  if (baseline.dd > plan.effectiveBudget && baseline.atBudgetProfit > 0) {
    const uplift = plan.profit - baseline.atBudgetProfit;
    if (uplift > 0) {
      push(
        "good",
        `+${((uplift / Math.abs(baseline.atBudgetProfit)) * 100).toFixed(0)}% more profit for the same risk`,
        `Shrinking your current book unchanged until it fits ${money(plan.effectiveBudget)} of drawdown would earn about ${money(baseline.atBudgetProfit)}. Reallocating that same ${money(plan.effectiveBudget)} earns ${money(plan.profit)} - the gain comes from where the risk sits, not from taking more of it.`,
      );
    }
  }

  /* ---- explicit per-strategy verdicts --------------------------------- */
  if (plan.drops && plan.drops.length) {
    const names = plan.drops.map((d) => nm(d.name, 26)).join(", ");
    const losers = plan.drops.filter((d) => d.profitPerLot <= 0).length;
    push(
      "warn",
      `Drop ${plan.drops.length} strateg${plan.drops.length === 1 ? "y" : "ies"}: ${names}`,
      `${losers ? `${losers} of them lose money outright; the rest cannot be funded inside the budget (or would add drawdown without buying profit). ` : "They add drawdown without buying enough profit. "}Trading them would force the profitable strategies to run smaller - dropping them is what makes the rest of the plan possible.`,
    );
  }

  if (plan.increases && plan.increases.length) {
    const list = plan.increases.map((e) => `${nm(e.name, 22)} ${e.refLot}→${e.lot.toFixed(2)}`).join(", ");
    push("good", `Raise ${plan.increases.length}: you have room to grow`, `${list}. Since fixed-lot P&L scales with size, this takes expected profit to ${money(plan.profit)} while the drawdown stays at ${money(plan.dd)} - under your ${money(plan.effectiveBudget)} limit.`);
  }

  if (plan.reductions && plan.reductions.length) {
    const list = plan.reductions.map((e) => `${nm(e.name, 22)} ${e.refLot}→${e.lot.toFixed(2)}`).join(", ");
    push("warn", `Cut ${plan.reductions.length}: too big for this budget`, `${list}. At the backtest size these strategies alone would push the book past ${money(plan.effectiveBudget)}.`);
  }

  /* ---- budget utilisation -------------------------------------------- */
  if (plan.mode !== "custom" && pctUsed < 0.9) {
    push("info", `${Math.round((1 - pctUsed) * 100)}% of the budget cannot be used`,
      `The plan only reaches ${money(plan.dd)} of the ${money(plan.effectiveBudget)} allowed because the next lot step (${lotStep}) costs more risk than is left. A finer lot step - or a broker that allows micro lots - would let you use the full budget.`);
  }

  /* ---- concentration / attribution ----------------------------------- */
  const byProfit = [...active].sort((a, b) => b.profit - a.profit);
  const byRisk = [...active].sort((a, b) => b.risk - a.risk);
  if (active.length > 1) {
    const top = byProfit[0];
    const share = (top.risk / Math.max(plan.dd, 1e-9)) * 100;
    const riskText =
      share > 100
        ? `drives the entire ${money(plan.dd)} drawdown and then some (${share.toFixed(0)}%) - the other strategies give part of it back`
        : `takes ${share.toFixed(0)}% of the ${money(plan.dd)} drawdown`;
    push("info", `${nm(top.name)} carries the plan`,
      `${nm(top.name, 60)} ${riskText} and produces ${money(top.profit)} of the ${money(plan.profit)} expected profit (${((top.profit / Math.max(plan.profit, 1e-9)) * 100).toFixed(0)}%).`);
  }

  const hedge = plan.perEa.filter((e) => e.risk < -0.01 && e.lot > 0);
  if (hedge.length) {
    push("good", "Natural hedge inside the book",
      `${hedge.map((h) => h.name).join(", ")} ${hedge.length === 1 ? "loses" : "lose"} money during the portfolio's worst window - the optimiser keeps ${hedge.length === 1 ? "it" : "them"} sized as insurance even at a small profit cost.`);
  }

  if (active.length > 2 && byRisk[0].risk / Math.max(plan.dd, 1e-9) > 0.6) {
    push("warn", "Risk is concentrated in one strategy",
      `${nm(byRisk[0].name, 60)} alone drives ${((byRisk[0].risk / Math.max(plan.dd, 1e-9)) * 100).toFixed(0)}% of the ${money(plan.dd)} drawdown. If that strategy behaves differently live, the whole book is exposed. Consider the equal-risk plan for a smoother ride.`);
  }

  /* ---- risk efficiency ------------------------------------------------ */
  const efficient = [...active]
    .filter((e) => e.risk > 0)
    .sort((a, b) => b.profit / Math.max(b.risk, 1e-9) - a.profit / Math.max(a.risk, 1e-9));
  if (efficient.length > 1) {
    const best = efficient[0];
    const worst = efficient[efficient.length - 1];
    push("info", "Best risk-adjusted strategy",
      `${nm(best.name, 40)} returns ${(best.profit / Math.max(best.risk, 1e-9)).toFixed(1)}× its drawdown contribution, while ${nm(worst.name, 40)} returns ${(worst.profit / Math.max(worst.risk, 1e-9)).toFixed(1)}×. Money is allocated to the first, not the second.`);
  }

  /* ---- next step ------------------------------------------------------ */
  const steps = marginalSteps(model, plan.lots, lotStep)
    .filter((s) => s.deltaProfit > 0)
    .sort((a, b) => b.deltaProfit - a.deltaProfit);
  if (steps.length) {
    const s = steps[0];
    if (s.deltaDD <= plan.effectiveBudget * 1.0001) {
      push("good", `Your next ${lotStep} lot is affordable`,
        `Raising ${nm(s.name, 40)} to ${(plan.perEa.find((e) => e.id === s.id).lot + lotStep).toFixed(2)} lots costs ${money(s.deltaDD - plan.dd)} more drawdown and adds ${money(s.deltaProfit)} of expected profit - still inside ${money(plan.effectiveBudget)}.`);
    } else {
      push("info", `What the next lot step would cost`,
        `The cheapest way to grow is ${nm(s.name, 40)}: one more ${lotStep} lot adds ${money(s.deltaProfit)} of profit but takes drawdown to ${money(s.deltaDD)} - ${money(s.deltaDD - plan.effectiveBudget)} over your budget. Raising the budget to ${money(Math.ceil(s.deltaDD))} would unlock it.`);
    }
  }

  /* ---- budget sensitivity --------------------------------------------- */
  const perHundred = plan.dd > 0 ? (plan.profit / plan.dd) * (budget > 0 ? 100 : 0) : 0;
  if (perHundred > 0) {
    push("info", "What another $100 of risk buys",
      `Every additional $100 of tolerated drawdown buys roughly ${money(perHundred)} more profit at this allocation (${(plan.profit / Math.max(plan.dd, 1e-9)).toFixed(2)} profit per $1 of drawdown).`);
  }

  /* ---- robustness ------------------------------------------------------ */
  if (mc) {
    if (mc.breaches > 0.25) {
      push("warn", `${Math.round(mc.breaches * 100)}% chance of breaching in a re-shuffled market`,
        `Resampling the trade history ${mc.sims} times, the drawdown went past ${money(budget)} in ${(mc.breaches * 100).toFixed(0)}% of runs (95th percentile ${money(mc.p95)}). Scale to ${(mc.scale * 100).toFixed(0)}% of this plan - about ${mc.robustLots.reduce((a, b) => a + b, 0).toFixed(2)} lots - for a 95% confidence fit.`);
    } else if (mc.breaches > 0.05) {
      push("info", `${(mc.confidence * 100).toFixed(0)}% confidence the budget holds`,
        `In ${mc.sims} reshuffles the drawdown stayed under ${money(budget)} ${(mc.confidence * 100).toFixed(0)}% of the time; the 95th percentile is ${money(mc.p95)}. If you want ${money(budget)} to be a near-certain ceiling, run ${mc.robustLots.reduce((a, b) => a + b, 0).toFixed(2)} lots instead.`);
    } else {
      push("good", "Robust to reshuffling",
        `Even in the worst 5% of ${mc.sims} resampled orderings the drawdown stays near ${money(mc.p95)}, comfortably inside ${money(budget)}.`);
    }
  }

  /* ---- what-if on the budget ------------------------------------------ */
  if (budget > 0 && plan.dd > 0) {
    const scaled = (budget * 1.5) / Math.max(plan.dd, 1e-9);
    if (scaled > 1.1) {
      push("info", "If you could bear 50% more drawdown",
        `The same allocation scaled to ${money(budget * 1.5)} of drawdown would produce about ${money(plan.profit * Math.min(scaled, 1.5))}. Risk and reward scale together - there is no free lunch in lot sizing.`);
    }
  }

  if (start > 0 && plan.dd / start > 0.5) {
    push("warn", "This budget is very large for the account",
      `${money(plan.dd)} of drawdown on a ${money(start)} account is ${((plan.dd / start) * 100).toFixed(0)}% - a single bad streak could end the account. Most desks cap this near 20-30%.`);
  }

  return notes;
}
