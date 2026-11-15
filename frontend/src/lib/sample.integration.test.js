/**
 * End-to-end check on the two real MT5 Strategy Tester reports that ship with
 * the app: parse -> normalise -> optimise. Guards the parser/optimiser contract.
 */
import fs from "fs";
import path from "path";
import { parseMt5Report } from "./mt5Parser";
import { buildRiskModel, buildPlan, evaluatePlan, monteCarlo } from "./riskBrain";

const load = (name) => {
  const p = path.join(__dirname, "..", "..", "public", "samples", name);
  const buf = fs.readFileSync(p);
  return parseMt5Report(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
};

describe("real MT5 reports", () => {
  const reports = [load("dynamic.html"), load("smc.html")];

  test("reports are labelled by their file name, EA name kept separately", () => {
    expect(reports[0].label).toBe("dynamic");
    expect(reports[0].expert).toBe("dynamic");
    expect(reports[0].eaExpert).toMatch(/Dynamic Liquidity/i);
    expect(reports[1].label).toBe("smc");
    expect(reports[1].eaExpert).toMatch(/SMC/i);
  });

  test("parses both samples into deals", () => {
    for (const r of reports) {
      expect(r.deals.length).toBeGreaterThan(50);
      expect(r.initialDeposit).toBeGreaterThan(0);
      expect(r.deals.every((d) => Number.isFinite(d.net))).toBe(true);
    }
  });

  test("produces a feasible plan for a $200 drawdown budget", () => {
    const model = buildRiskModel(reports);
    const plan = buildPlan(model, { budget: 200, mode: "maxprofit", safety: 1, lotStep: 0.01 });
    expect(plan.dd).toBeLessThanOrEqual(200 + 1e-6);
    expect(plan.profit).toBeGreaterThan(0);
    expect(plan.perEa.some((e) => e.lot > 0)).toBe(true);
  });

  test("scaling all lots by two doubles the drawdown", () => {
    const model = buildRiskModel(reports);
    const lots = [0.1, 0.1];
    const a = evaluatePlan(model, lots).dd;
    const b = evaluatePlan(model, lots.map((v) => v * 2)).dd;
    expect(b).toBeCloseTo(a * 2, 5);
  });

  test("monte carlo runs on real data", () => {
    const model = buildRiskModel(reports);
    const plan = buildPlan(model, { budget: 200, mode: "maxprofit" });
    const mc = monteCarlo(model, plan.lots, { histDD: plan.dd, sims: 100, budget: 200 });
    expect(mc.p95).toBeGreaterThan(0);
    expect(mc.confidence).toBeGreaterThanOrEqual(0);
  });
});
