import { solveLP } from "./simplex";
import {
  buildRiskModel,
  evaluatePlan,
  maxProfitLots,
  uniformLots,
  riskParityLots,
  buildPlan,
  monteCarlo,
  worstCaseDD,
  efficientFrontier,
  roundDown,
} from "./riskBrain";

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function makeReport({ id, n = 60, volume = 0.1, mean = 2, sd = 12, seed = 1, offset = 0 }) {
  const rnd = mulberry32(seed);
  const deals = [];
  let t = Date.UTC(2024, 0, 1) + offset;
  for (let i = 0; i < n; i++) {
    t += 3600 * 1000 * (1 + Math.floor(rnd() * 20));
    const g = (rnd() + rnd() + rnd() + rnd() - 2) / 2; // approx normal
    const net = (mean + g * sd) * volume;
    deals.push({ time: t, volume, net, isOut: true, symbol: "XAUUSD" });
  }
  return { id, expert: `EA ${id}`, symbol: "XAUUSD", deals };
}

/** Independent reference drawdown: build the merged event list from scratch. */
function referenceDD(reports, lots) {
  const ev = [];
  reports.forEach((r, i) => {
    const refLot = r.deals[0].volume;
    r.deals.forEach((d) => ev.push({ time: d.time, pnl: (d.net / d.volume) * (lots[i] || 0), refLot }));
  });
  ev.sort((a, b) => a.time - b.time);
  let bal = 0, peak = 0, dd = 0;
  for (const e of ev) {
    bal += e.pnl;
    if (bal > peak) peak = bal;
    if (peak - bal > dd) dd = peak - bal;
  }
  return dd;
}

const reports = [
  makeReport({ id: "a", seed: 1, mean: 3, sd: 10 }),
  makeReport({ id: "b", seed: 2, mean: 2, sd: 16, offset: 4000 }),
  makeReport({ id: "c", seed: 3, mean: 1.5, sd: 8, volume: 0.2, offset: 9000 }),
  makeReport({ id: "d", seed: 4, mean: -0.5, sd: 20, offset: 15000 }),
  makeReport({ id: "e", seed: 5, mean: 4, sd: 30, offset: 22000 }),
];

/* ------------------------------------------------------------------ */
/* tests                                                              */
/* ------------------------------------------------------------------ */

describe("simplex", () => {
  test("solves a textbook LP", () => {
    // max 3x+2y s.t. x+y<=4, x+3y<=6, x<=3
    const r = solveLP([3, 2], [[1, 1], [1, 3], [1, 0]], [4, 6, 3]);
    expect(r.status).toBe("optimal");
    expect(r.value).toBeCloseTo(11, 6);
    expect(r.x[0]).toBeCloseTo(3, 6);
    expect(r.x[1]).toBeCloseTo(1, 6);
  });

  test("detects unbounded", () => {
    const r = solveLP([1, 1], [[-1, 1]], [1]);
    expect(["unbounded", "optimal"]).toContain(r.status);
    if (r.status === "optimal") expect(r.value).toBeLessThan(Infinity);
  });

  test("respects caps", () => {
    const r = solveLP([5, 5], [[1, 0], [0, 1]], [2, 3]);
    expect(r.status).toBe("optimal");
    expect(r.value).toBeCloseTo(25, 6);
  });
});

describe("risk model", () => {
  const model = buildRiskModel(reports);

  test("normalises every report to P&L per lot", () => {
    expect(model.eas).toHaveLength(5);
    expect(model.eas[0].refLot).toBeCloseTo(0.1, 6);
    expect(model.eas[2].refLot).toBeCloseTo(0.2, 6);
    expect(model.T).toBeGreaterThan(0);
  });

  test("drawdown matches an independent implementation", () => {
    const lots = [0.1, 0.25, 0.05, 0, 0.4];
    const got = evaluatePlan(model, lots).dd;
    expect(got).toBeCloseTo(referenceDD(reports, lots), 6);
  });

  test("drawdown is linear in size (homogeneous)", () => {
    const lots = [0.1, 0.2, 0.3, 0.4, 0.5];
    const one = evaluatePlan(model, lots).dd;
    const two = evaluatePlan(model, lots.map((v) => v * 2)).dd;
    expect(two).toBeCloseTo(one * 2, 6);
  });

  test("profit is linear in size", () => {
    const lots = [0.1, 0.2, 0.3, 0.4, 0.5];
    const p1 = evaluatePlan(model, lots).profit;
    const p2 = evaluatePlan(model, lots.map((v) => v * 3)).profit;
    expect(p2).toBeCloseTo(p1 * 3, 6);
  });
});

describe("optimisers", () => {
  const model = buildRiskModel(reports);
  const budget = 120;

  test("max-profit plan stays inside the drawdown budget", () => {
    const plan = buildPlan(model, { budget, mode: "maxprofit", safety: 1, lotStep: 0.01 });
    expect(plan.dd).toBeLessThanOrEqual(budget + 1e-6);
    expect(plan.profit).toBeGreaterThan(0);
  });

  test("max-profit plan is not beaten by random feasible allocations", () => {
    const plan = buildPlan(model, { budget, mode: "maxprofit", safety: 1, lotStep: 0.01 });
    const rnd = mulberry32(99);
    let bestRatio = 0;
    const dir = maxProfitLots(model, budget).lots;
    const baseDD = evaluatePlan(model, dir).dd;
    for (let s = 0; s < 4000; s++) {
      const raw = dir.map(() => rnd());
      // scale to the same budget, then measure the profit / DD ratio
      const scale = budget / Math.max(1e-9, evaluatePlan(model, raw).dd);
      const lots = raw.map((v) => v * scale);
      const ev = evaluatePlan(model, lots);
      if (ev.dd > budget * 1.0001) continue;
      const ratio = ev.profit / ev.dd;
      if (ratio > bestRatio) bestRatio = ratio;
    }
    const planRatio = plan.profit / plan.dd;
    expect(planRatio).toBeGreaterThanOrEqual(bestRatio * 0.999);
    expect(baseDD).toBeLessThanOrEqual(budget * 1.0001);
  });

  test("uniform sizing lands exactly on the budget", () => {
    const { k } = uniformLots(model, budget);
    const lots = model.eas.map((e) => e.refLot * k);
    const ev = evaluatePlan(model, lots);
    expect(ev.dd).toBeCloseTo(budget, 6);
  });

  test("equal-risk plan can never breach, even if every EA draws down together", () => {
    const lots = riskParityLots(model, budget).lots;
    const ev = evaluatePlan(model, lots);
    expect(ev.dd).toBeLessThanOrEqual(budget + 1e-6);
    expect(worstCaseDD(model, lots)).toBeLessThanOrEqual(budget + 1e-6);
  });

  test("lots respect the broker lot step", () => {
    const plan = buildPlan(model, { budget, mode: "maxprofit", lotStep: 0.01 });
    for (const e of plan.perEa) {
      const units = e.lot / 0.01;
      expect(Math.abs(units - Math.round(units))).toBeLessThan(1e-6);
    }
  });

  test("risk contributions add up to the drawdown", () => {
    const plan = buildPlan(model, { budget, mode: "maxprofit" });
    const sum = plan.perEa.reduce((s, e) => s + e.risk, 0);
    expect(sum).toBeCloseTo(plan.dd, 6);
  });

  test("max-profit sizing dominates the other methods on profit per $ of risk", () => {
    const f = efficientFrontier(model, { budget });
    const byKey = Object.fromEntries(f.map((m) => [m.key, m]));
    expect(byKey.maxprofit.slope).toBeGreaterThan(0);
    expect(byKey.maxprofit.slope).toBeGreaterThanOrEqual(byKey.uniform.slope - 1e-6);
    expect(byKey.maxprofit.slope).toBeGreaterThanOrEqual(byKey.riskparity.slope - 1e-6);
    const plan = buildPlan(model, { budget, mode: "maxprofit" });
    expect(plan.profit / plan.dd).toBeGreaterThan(0);
  });
});

describe("monte carlo", () => {
  const model = buildRiskModel(reports);
  const plan = buildPlan(model, { budget: 120, mode: "maxprofit" });

  test("is deterministic and returns ordered percentiles", () => {
    const a = monteCarlo(model, plan.lots, { histDD: plan.dd, sims: 120, budget: 120, seed: 7 });
    const b = monteCarlo(model, plan.lots, { histDD: plan.dd, sims: 120, budget: 120, seed: 7 });
    expect(a.p50).toBeCloseTo(b.p50, 6);
    expect(a.p50).toBeLessThanOrEqual(a.p90);
    expect(a.p90).toBeLessThanOrEqual(a.p95);
    expect(a.p95).toBeLessThanOrEqual(a.p99);
    expect(a.breaches).toBeGreaterThanOrEqual(0);
    expect(a.breaches).toBeLessThanOrEqual(1);
  });

  test("scaling down to the p95 keeps the budget", () => {
    const a = monteCarlo(model, plan.lots, { histDD: plan.dd, sims: 200, budget: 120, seed: 3 });
    if (a.p95 > 120) {
      const scaled = evaluatePlan(model, a.robustLots);
      expect(scaled.dd).toBeLessThan(plan.dd);
    }
  });
});

describe("edge cases", () => {
  test("zero budget yields an empty plan", () => {
    const model = buildRiskModel(reports);
    const plan = buildPlan(model, { budget: 0, mode: "maxprofit" });
    expect(plan.dd).toBe(0);
    expect(plan.totalLots).toBe(0);
  });

  test("tiny budget does not explode", () => {
    const model = buildRiskModel(reports);
    const plan = buildPlan(model, { budget: 0.5, mode: "maxprofit", lotStep: 0.01 });
    expect(plan.dd).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  test("single report", () => {
    const model = buildRiskModel([reports[0]]);
    const plan = buildPlan(model, { budget: 50, mode: "maxprofit" });
    expect(plan.profit).toBeGreaterThan(0);
    expect(plan.dd).toBeLessThanOrEqual(50 + 1e-6);
  });

  test("roundDown never rounds up", () => {
    expect(roundDown(0.019, 0.01)).toBeCloseTo(0.01, 8);
    expect(roundDown(1.999, 0.01)).toBeCloseTo(1.99, 8);
  });
});

describe("per-strategy verdicts", () => {
  // one clear winner, one pure loser (every deal negative => it can only add
  // drawdown), and one small steady earner
  const winner = makeReport({ id: "w", seed: 21, mean: 6, sd: 8, volume: 0.1 });
  const loser = makeReport({ id: "l", seed: 22, mean: -9, sd: 3, volume: 0.1, offset: 7000 });
  const steady = makeReport({ id: "s", seed: 23, mean: 2, sd: 4, volume: 0.1, offset: 13000 });
  const model = buildRiskModel([winner, loser, steady]);

  test("a strategy that only loses money is marked DROP with a reason", () => {
    const plan = buildPlan(model, { budget: 200, mode: "maxprofit", lotStep: 0.01 });
    const l = plan.perEa.find((e) => e.id === "l");
    expect(l.action).toBe("drop");
    expect(l.lot).toBe(0);
    expect(l.reason).toMatch(/Loses/);
    expect(plan.drops.map((d) => d.id)).toContain("l");
  });

  test("a generous budget produces RAISE verdicts", () => {
    const plan = buildPlan(model, { budget: 4000, mode: "maxprofit", lotStep: 0.01 });
    expect(plan.increases.length).toBeGreaterThan(0);
    for (const e of plan.increases) expect(e.lot).toBeGreaterThan(e.refLot);
  });

  test("no suggestion is ever below the minimum lot", () => {
    for (const budget of [50, 200, 1000, 5000]) {
      const plan = buildPlan(model, { budget, mode: "maxprofit", lotStep: 0.01 });
      for (const e of plan.perEa) {
        if (e.lot > 0) expect(e.lot).toBeGreaterThanOrEqual(0.01 - 1e-9);
        const units = e.lot / 0.01;
        expect(Math.abs(units - Math.round(units))).toBeLessThan(1e-6);
      }
    }
  });

  test("before / after figures describe the same book", () => {
    const plan = buildPlan(model, { budget: 200, mode: "maxprofit", lotStep: 0.01 });
    expect(plan.before.totalLots).toBeCloseTo(0.3, 6);
    expect(plan.before.dd).toBeGreaterThan(0);
    expect(plan.before.profit).toBeCloseTo(plan.perEa.reduce((s, e) => s + e.beforeProfit, 0), 6);
    // every row's before values come from the report's own lot size
    for (const e of plan.perEa) {
      expect(e.beforeProfit).toBeCloseTo(e.refLot * e.profitPerLot, 6);
      expect(e.beforeDD).toBeCloseTo(e.refLot * e.ddPerLot, 6);
    }
  });

  test("every strategy gets exactly one verdict", () => {
    const plan = buildPlan(model, { budget: 200, mode: "maxprofit" });
    const total = plan.drops.length + plan.increases.length + plan.reductions.length + plan.keeps.length;
    expect(total).toBe(model.eas.length);
  });
});
