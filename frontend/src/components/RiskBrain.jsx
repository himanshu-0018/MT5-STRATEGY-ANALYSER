import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BrainCircuit,
  ShieldAlert,
  Gauge,
  Copy,
  RotateCcw,
  SlidersHorizontal,
  AlertTriangle,
  Info,
  CheckCircle2,
  Minus,
  Plus,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
  Ban,
} from "lucide-react";
import { buildPortfolio, money } from "../lib/portfolio";
import { buildPlan, efficientFrontier, monteCarlo, scaleReports, fmtLot } from "../lib/riskBrain";
import { buildInsights } from "../lib/insights";
import { PlanEquityChart, FrontierChart, MonteCarloChart } from "./BrainCharts";
import { MonthlyCompare } from "./MonthlyCompare";

const MODES = [
  { key: "maxprofit", label: "Max profit", hint: "Solve for the exact combination that earns the most inside the budget" },
  { key: "uniform", label: "Scale all", hint: "One multiplier applied to every strategy's original lot" },
  { key: "riskparity", label: "Equal risk", hint: "Same drawdown allowance per strategy - safe even if every EA draws down together" },
];

const TONE = {
  good: { border: "border-l-emerald-400", icon: CheckCircle2, color: "text-emerald-400" },
  info: { border: "border-l-cyan-400", icon: Info, color: "text-cyan-400" },
  warn: { border: "border-l-amber-400", icon: AlertTriangle, color: "text-amber-400" },
  bad: { border: "border-l-red-400", icon: AlertTriangle, color: "text-red-400" },
};

const ACTION = {
  increase: { label: "RAISE", icon: ArrowUpRight, cls: "text-emerald-400 border-emerald-500/40 bg-emerald-500/5" },
  reduce: { label: "CUT", icon: ArrowDownRight, cls: "text-amber-300 border-amber-500/40 bg-amber-500/5" },
  keep: { label: "KEEP", icon: CheckCircle2, cls: "text-slate-400 border-slate-600 bg-slate-700/10" },
  drop: { label: "DROP", icon: Ban, cls: "text-red-400 border-red-500/40 bg-red-500/5" },
};

const pct = (v) => `${(v * 100).toFixed(0)}%`;
const sign = (v) => (v >= 0 ? "+" : "−");
const signed = (v) => `${sign(v)}${money(Math.abs(v))}`;
const signedRaw = (v, d = 2) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

const Verdict = ({ action }) => {
  const a = ACTION[action] || ACTION.keep;
  const Icon = a.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 border text-[10px] font-mono tracking-wider ${a.cls}`}>
      <Icon className="h-3 w-3" /> {a.label}
    </span>
  );
};

const Compare = ({ label, before, after, delta, deltaPct, tone, deltaTone = "text-cyan-300", hint }) => (
  <div>
    <div className="qf-label">{label}</div>
    <div className="mt-2 flex flex-wrap items-baseline gap-1.5">
      <span className="font-mono text-sm text-slate-500 line-through decoration-slate-700">{before}</span>
      <span className="text-slate-600 text-xs">→</span>
      <span className={`font-mono text-xl font-bold ${tone || "text-slate-50"}`}>{after}</span>
    </div>
    <div className={`text-[11px] font-mono mt-1 ${deltaTone}`}>
      {delta}
      {deltaPct ? <span className="text-slate-500 ml-1">({deltaPct})</span> : null}
    </div>
    {hint ? <div className="text-[10px] text-slate-600 font-mono mt-0.5">{hint}</div> : null}
  </div>
);

export const RiskBrain = ({ model, start, baselinePortfolio }) => {
  const [budgetInput, setBudgetInput] = useState("200");
  const [unit, setUnit] = useState("usd");
  const [mode, setMode] = useState("maxprofit");
  const [buffer, setBuffer] = useState(0);
  const [lotStep, setLotStep] = useState("0.01");
  const [maxLot, setMaxLot] = useState("100");
  const [advanced, setAdvanced] = useState(false);
  const [dropLosers, setDropLosers] = useState(false);
  const [riskCap, setRiskCap] = useState("1");
  const [customLots, setCustomLots] = useState(null);

  const step = Math.max(0.001, parseFloat(lotStep) || 0.01);
  const capLot = Math.max(step, parseFloat(maxLot) || 100);
  const rawBudget = parseFloat(budgetInput) || 0;
  const budget = unit === "pct" ? (rawBudget / 100) * start : rawBudget;
  const safety = Math.max(0.1, 1 - buffer / 100);
  const capShare = parseFloat(riskCap) || 1;

  const blocked = useMemo(
    () => (dropLosers && model ? model.eas.map((e) => e.totalPerLot <= 0) : null),
    [model, dropLosers],
  );

  const shown = useMemo(() => {
    if (!model) return null;
    return buildPlan(model, {
      budget,
      mode: customLots ? "custom" : mode,
      safety,
      lotStep: step,
      maxLot: capLot,
      customLots,
      blocked,
      riskCap: capShare,
    });
  }, [model, budget, mode, safety, step, capLot, customLots, blocked, capShare]);

  const frontier = useMemo(
    () => (model ? efficientFrontier(model, { budget, maxLot: capLot, riskCap: capShare }) : []),
    [model, budget, capLot, capShare],
  );
  const mc = useMemo(
    () => (model && shown ? monteCarlo(model, shown.lots, { histDD: shown.dd, sims: 400, budget: shown.effectiveBudget }) : null),
    [model, shown],
  );
  const insights = useMemo(
    () => (model && shown ? buildInsights({ model, plan: shown, baseline: shown.before, mc, budget, start, lotStep: step }) : []),
    [model, shown, mc, budget, start, step],
  );
  const planPortfolio = useMemo(() => {
    if (!model || !shown) return null;
    const rs = scaleReports(model, shown.lots, start);
    return rs.length ? buildPortfolio(rs, start) : null;
  }, [model, shown, start]);

  if (!model || !shown) {
    return <p className="text-sm text-slate-500">Enable at least one report to size it.</p>;
  }

  const minimumCands = model.eas
    .filter((e) => e.totalPerLot > 0 && e.ddPerLot > 0)
    .map((e) => ({ name: e.name, budget: e.ddPerLot * step }))
    .sort((a, b) => a.budget - b.budget);
  const minimum = minimumCands[0] || null;

  const before = shown.before;
  const used = shown.effectiveBudget > 0 ? shown.dd / shown.effectiveBudget : 0;
  const over = shown.dd > shown.effectiveBudget + 1e-6;
  const beforeOver = before.dd > shown.effectiveBudget + 1e-6;
  const sizeMult = before.totalLots > 0 ? shown.totalLots / before.totalLots : 0;
  const profitDelta = shown.profit - before.profit;
  const profitPct = Math.abs(before.profit) > 1e-9 ? `${sign(profitDelta)}${Math.abs((profitDelta / Math.abs(before.profit)) * 100).toFixed(0)}%` : null;
  const ddDelta = shown.dd - before.dd;
  const ddPct = before.dd > 1e-9 ? `${sign(ddDelta)}${Math.abs((ddDelta / before.dd) * 100).toFixed(0)}%` : null;

  const applyRobust = (scale) => {
    setCustomLots(null);
    setBuffer(Math.min(60, Math.max(0, Math.round((1 - scale) * 100))));
    toast.success(`Re-sized for ${Math.round(shown.effectiveBudget * scale)} of drawdown - the budget holds in 95% of reshuffled histories`);
  };

  const bump = (i, dir) => {
    const base = customLots ? customLots.slice() : shown.lots.slice();
    base[i] = Math.max(0, parseFloat((base[i] + dir * step).toFixed(8)));
    setCustomLots(base);
  };
  const reset = () => setCustomLots(null);

  const copyPlan = async () => {
    const lines = [
      "QUANTFOLIO - RISK BRAIN PLAN",
      `Max drawdown budget: ${money(shown.effectiveBudget)}${buffer ? ` (${buffer}% buffer on ${money(budget)})` : ""}`,
      `Mode: ${MODES.find((m) => m.key === mode)?.label}${customLots ? " (manually edited)" : ""} · lot step ${step}`,
      "",
      "Strategy\tNow\tSuggested\tAction\tProfitNow\tProfitAfter\tRiskContribution",
      ...shown.perEa.map((e) =>
        [
          e.name,
          fmtLot(e.refLot, step),
          e.lot > 0 ? fmtLot(e.lot, step) : "DO NOT TRADE",
          e.action.toUpperCase(),
          money(e.beforeProfit),
          money(e.profit),
          money(e.risk),
        ].join("\t"),
      ),
      "",
      `NOW:   ${before.totalLots.toFixed(2)} lots · ${money(before.profit)} profit · ${money(before.dd)} max DD`,
      `AFTER: ${shown.totalLots.toFixed(2)} lots · ${money(shown.profit)} profit · ${money(shown.dd)} max DD`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Lot plan copied to clipboard");
    } catch (e) {
      toast.error("Could not copy - clipboard blocked by the browser");
    }
  };

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- controls */}
      <section data-testid="brain-controls" className="qf-card qf-rise p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4 text-cyan-400" />
              <span className="qf-label text-cyan-400">Risk brain · position sizing</span>
            </div>
            <h2 className="font-heading text-xl font-semibold text-slate-50 mt-1.5">The biggest lot size that still respects your drawdown</h2>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              Each report is normalised to P&amp;L per 1.00 lot, so profit and drawdown scale exactly with size. The solver searches
              every combination of lots and returns the one that earns the most without breaching the budget - including telling
              you which strategies to <span className="text-red-300">drop</span>.
            </p>
          </div>
          <div data-testid="sizing-mode-toggle" className="flex border border-slate-700 self-start">
            {MODES.map((m) => (
              <button
                key={m.key}
                data-testid={`sizing-mode-${m.key}`}
                title={m.hint}
                onClick={() => { setMode(m.key); setCustomLots(null); }}
                className={`px-3 py-1.5 text-xs font-mono transition-colors ${mode === m.key && !customLots ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 mt-5">
          <label className="block">
            <span className="qf-label">Max drawdown I can bear</span>
            <div className="flex items-stretch mt-1.5">
              <div className="flex border border-slate-700 border-r-0">
                {["usd", "pct"].map((u) => (
                  <button key={u} onClick={() => setUnit(u)}
                    className={`px-2.5 text-xs font-mono transition-colors ${unit === u ? "bg-slate-700/60 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}>
                    {u === "usd" ? "$" : "%"}
                  </button>
                ))}
              </div>
              <input data-testid="drawdown-budget-input" type="number" min="0" value={budgetInput} onChange={(e) => setBudgetInput(e.target.value)}
                className="flex-1 min-w-0 bg-slate-900 border border-slate-700 px-2 py-1.5 font-mono text-sm text-slate-100 focus:outline-none focus:border-cyan-400" />
            </div>
            <span className="block text-[11px] text-slate-500 font-mono mt-1">
              {unit === "pct" ? `= ${money(budget)} on a ${money(start)} balance` : `= ${pct(start > 0 ? budget / start : 0)} of your ${money(start)} account`}
            </span>
          </label>

          <label className="block">
            <span className="qf-label flex items-center justify-between">
              <span>Risk buffer</span>
              <span className="font-mono text-slate-300 normal-case tracking-normal">{buffer}%</span>
            </span>
            <input data-testid="risk-buffer-slider" type="range" min="0" max="60" step="5" value={buffer}
              onChange={(e) => { setBuffer(parseInt(e.target.value, 10)); setCustomLots(null); }}
              className="w-full mt-3 accent-cyan-400" />
            <span className="block text-[11px] text-slate-500 font-mono mt-1">sizes to {money(shown.effectiveBudget)} of drawdown</span>
          </label>

          <label className="block">
            <span className="qf-label flex items-center justify-between">
              <span>Risk cap / strategy</span>
              <span className="font-mono text-slate-300 normal-case tracking-normal">{capShare > 1 ? "off" : `${Math.round(capShare * 100)}%`}</span>
            </span>
            <select data-testid="risk-cap-select" value={riskCap} onChange={(e) => { setRiskCap(e.target.value); setCustomLots(null); }}
              className="w-full mt-1.5 bg-slate-900 border border-slate-700 px-2 py-1.5 font-mono text-sm text-slate-100 focus:outline-none focus:border-cyan-400">
              <option value="1">100% - no EA above the budget</option>
              <option value="0.5">50% of budget per EA</option>
              <option value="0.33">33% of budget per EA</option>
              <option value="0.25">25% of budget per EA</option>
              <option value="0.2">20% of budget per EA</option>
              <option value="0.1">10% of budget per EA</option>
              <option value="25">No cap - pure max profit</option>
            </select>
            <span className="block text-[11px] text-slate-500 font-mono mt-1">
              worst dip a single EA may have on its own
            </span>
          </label>

          <div className="block">
            <span className="qf-label">Total recommended size</span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-2xl font-bold text-cyan-300">{shown.totalLots.toFixed(2)}</span>
              <span className="text-xs text-slate-400">lots</span>
            </div>
            <span className="block text-[11px] text-slate-500 font-mono mt-1">
              {sizeMult >= 1 ? `${sizeMult.toFixed(1)}× your backtest size` : `${(1 / Math.max(sizeMult, 1e-9)).toFixed(1)}× smaller than backtest`}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="qf-label">Drawdown usage</span>
            <div className="mt-2">
              <div className="h-2.5 w-full bg-slate-800 relative overflow-hidden">
                <div className={`h-full transition-all duration-300 ${over ? "bg-red-500" : used > 0.85 ? "bg-amber-400" : "bg-gradient-to-r from-cyan-500 to-emerald-400"}`}
                  style={{ width: `${Math.min(100, used * 100)}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-[11px] font-mono">
                <span className={over ? "text-red-400" : "text-slate-300"}>{money(shown.dd)}</span>
                <span className="text-slate-500">of {money(shown.effectiveBudget)}</span>
              </div>
            </div>
            <div className="flex gap-2 mt-auto pt-2">
              <button onClick={copyPlan} data-testid="copy-plan-button" className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition-colors">
                <Copy className="h-3 w-3" /> Copy plan
              </button>
              <button onClick={() => setAdvanced((a) => !a)} data-testid="broker-toggle" className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono border transition-colors ${advanced ? "border-cyan-400 text-cyan-300" : "border-slate-700 text-slate-400 hover:text-slate-200"}`}>
                <SlidersHorizontal className="h-3 w-3" /> Broker
              </button>
            </div>
          </div>
        </div>

        {advanced && (
          <div className="flex flex-wrap items-end gap-5 mt-4 pt-4 border-t border-slate-800">
            <label className="block">
              <span className="qf-label">Lot step = minimum lot</span>
              <select value={lotStep} onChange={(e) => { setLotStep(e.target.value); setCustomLots(null); }}
                className="mt-1.5 bg-slate-900 border border-slate-700 px-2 py-1.5 font-mono text-sm text-slate-100 focus:outline-none focus:border-cyan-400">
                {["0.01", "0.1", "1"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="qf-label">Max lots per strategy</span>
              <input type="number" min="0.01" value={maxLot} onChange={(e) => { setMaxLot(e.target.value); setCustomLots(null); }}
                className="mt-1.5 w-28 bg-slate-900 border border-slate-700 px-2 py-1.5 font-mono text-sm text-slate-100 focus:outline-none focus:border-cyan-400" />
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input type="checkbox" checked={dropLosers} onChange={(e) => { setDropLosers(e.target.checked); setCustomLots(null); }} className="accent-cyan-400" />
              <span className="text-xs text-slate-300">Never size unprofitable strategies</span>
            </label>
            <span className="text-[11px] text-slate-500 font-mono max-w-md">
              Nothing below {step} lots is ever suggested - a strategy that cannot be funded at {step} lots is marked DROP, not resized below the broker minimum.
            </span>
          </div>
        )}
      </section>

      {shown.warnings.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {shown.warnings.map((w) => (
            <div key={w} className="flex items-center gap-2 px-3 py-2 border border-amber-500/40 bg-amber-500/5 text-amber-300 text-xs font-mono">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {w}
            </div>
          ))}
        </div>
      )}

      {shown.totalLots === 0 && minimum && (
        <section data-testid="nothing-fits" className="qf-card border-l-2 border-l-red-500 p-5">
          <div className="flex items-start gap-2">
            <Ban className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <h2 className="font-heading text-base font-semibold text-slate-100">Nothing can be traded inside this budget</h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                The smallest tradable size ({step} lots) of your most drawdown-efficient strategy - <span className="text-slate-200">{minimum.name}</span> - already
                needs about <span className="font-mono text-slate-200">{money(minimum.budget)}</span> of drawdown.
              </p>
              <p className="text-xs text-slate-400 mt-1.5">
                Raise the budget to at least <span className="font-mono text-cyan-300">{money(Math.ceil(minimum.budget))}</span>, or trade a broker/instrument where one lot step costs less risk.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ------------------------------------------------ before / after hero */}
      <section data-testid="before-after" className="grid grid-cols-1 lg:grid-cols-[1.75fr_1fr] gap-6">
        <div className="qf-card qf-rise p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="qf-label">What changes if you follow the plan</span>
              <div className="text-[11px] text-slate-500 font-mono mt-1">
                {MODES.find((m) => m.key === mode)?.label}{customLots ? " · manually edited" : ""} · {lotStep} lot step · {shown.perEa.length} reports
              </div>
            </div>
            {customLots && (
              <button onClick={reset} className="flex items-center gap-1.5 text-[11px] font-mono text-amber-300 hover:text-amber-200">
                <RotateCcw className="h-3 w-3" /> reset to optimal
              </button>
            )}
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-x-6 gap-y-5 mt-5">
            <Compare label="Net profit" before={money(before.profit)} after={money(shown.profit, true)}
              delta={signed(profitDelta)} deltaPct={profitPct}
              tone={shown.profit >= 0 ? "text-emerald-400" : "text-red-400"}
              deltaTone={profitDelta >= 0 ? "text-emerald-400" : "text-amber-300"} />
            <Compare label="Max drawdown" before={money(before.dd)} after={money(shown.dd)}
              delta={`${sign(ddDelta)}${money(Math.abs(ddDelta))}`} deltaPct={ddPct}
              tone={over ? "text-red-400" : "text-emerald-400"}
              deltaTone={ddDelta <= 0 ? "text-emerald-400" : "text-red-400"} />
            <Compare label="Profit per $1 of DD" before={Number.isFinite(before.profitPerDD) ? before.profitPerDD.toFixed(2) : "-"}
              after={Number.isFinite(shown.profitPerDD) ? shown.profitPerDD.toFixed(2) : "-"}
              delta={Number.isFinite(shown.profitPerDD) && Number.isFinite(before.profitPerDD) ? signed(shown.profitPerDD - before.profitPerDD).replace("$", "") : "—"}
              tone="text-amber-300"
              deltaTone={shown.profitPerDD >= before.profitPerDD ? "text-emerald-400" : "text-amber-300"} />
            <Compare label="Total lots" before={before.totalLots.toFixed(2)} after={shown.totalLots.toFixed(2)}
              delta={signedRaw(shown.totalLots - before.totalLots)} tone="text-cyan-300" deltaTone="text-cyan-300" />
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-6">
            {shown.drops.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 border border-red-500/40 bg-red-500/5 text-red-400 text-[11px] font-mono">
                <Ban className="h-3 w-3" /> DROP {shown.drops.length}
              </span>
            )}
            {shown.increases.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 border border-emerald-500/40 bg-emerald-500/5 text-emerald-400 text-[11px] font-mono">
                <ArrowUpRight className="h-3 w-3" /> RAISE {shown.increases.length}
              </span>
            )}
            {shown.reductions.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 border border-amber-500/40 bg-amber-500/5 text-amber-300 text-[11px] font-mono">
                <ArrowDownRight className="h-3 w-3" /> CUT {shown.reductions.length}
              </span>
            )}
            {shown.keeps.length > 0 && (
              <span className="inline-flex items-center gap-1.5 px-2 py-1 border border-slate-600 bg-slate-700/10 text-slate-300 text-[11px] font-mono">
                <CheckCircle2 className="h-3 w-3" /> KEEP {shown.keeps.length}
              </span>
            )}
            <span className={`ml-auto text-[11px] font-mono ${beforeOver ? "text-amber-300" : "text-slate-500"}`}>
              {beforeOver
                ? `today you run ${money(before.dd)} of drawdown - ${(before.dd / Math.max(shown.effectiveBudget, 1e-9)).toFixed(1)}× your limit`
                : `today you are inside the limit with ${money(shown.effectiveBudget - before.dd)} to spare`}
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-800 flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
            <Sparkles className="h-3.5 w-3.5 text-cyan-500 shrink-0 mt-0.5" />
            <span>
              {before.dd > shown.effectiveBudget
                ? `Your current book needs ${money(before.dd)} of drawdown - ${(before.dd / Math.max(shown.effectiveBudget, 1e-9)).toFixed(1)}× your limit. Shrinking it unchanged to fit ${money(shown.effectiveBudget)} would earn about ${money(before.atBudgetProfit)}; reallocating the same risk earns ${money(shown.profit)}${before.atBudgetProfit > 0 ? `, ${(((shown.profit - before.atBudgetProfit) / Math.abs(before.atBudgetProfit)) * 100).toFixed(0)}% more` : ""}.`
                : `Your current book fits inside ${money(shown.effectiveBudget)} with ${money(shown.effectiveBudget - before.dd)} to spare, so the plan keeps every lot it can and only reallocates what pays for its risk.`}
            </span>
          </div>
        </div>

        <div className="qf-card qf-rise p-6" style={{ animationDelay: "60ms" }}>
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-slate-500" />
            <span className="qf-label">Drawdown budget</span>
          </div>
          <div className="mt-4 flex items-end justify-between">
            <span className="font-mono text-4xl font-bold text-slate-50">{money(shown.dd)}</span>
            <span className="font-mono text-sm text-slate-500 mb-1">/ {money(shown.effectiveBudget)}</span>
          </div>
          <div className="mt-1 h-4 bg-slate-800 relative overflow-hidden">
            <div className={`h-full ${over ? "bg-red-500" : "bg-gradient-to-r from-cyan-500 via-teal-400 to-emerald-400"}`} style={{ width: `${Math.min(100, used * 100)}%` }} />
            <div className="absolute inset-0 flex">
              {Array.from({ length: 10 }).map((_, i) => <div key={i} className="flex-1 border-r border-[#0B0F19]" />)}
            </div>
          </div>
          <div className="flex justify-between mt-2 text-[11px] font-mono">
            <span className={over ? "text-red-400" : used > 0.85 ? "text-amber-300" : "text-emerald-400"}>{pct(used)} of budget used</span>
            <span className="text-slate-500">{money(Math.max(0, shown.effectiveBudget - shown.dd))} left</span>
          </div>
          <div className="mt-5 space-y-2.5">
            {[...shown.perEa].filter((e) => e.lot > 0).sort((a, b) => b.risk - a.risk).slice(0, 4).map((e) => {
              const share = shown.dd > 0 ? e.risk / shown.dd : 0;
              return (
                <div key={e.id}>
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="truncate max-w-[150px] text-slate-300" title={e.name}>{e.name}</span>
                    <span className={e.risk < 0 ? "text-emerald-400" : "text-slate-400"}>{money(e.risk)} · {pct(share)}</span>
                  </div>
                  <div className="h-1 bg-slate-800 mt-1">
                    <div className={`h-full ${e.risk < 0 ? "bg-emerald-500" : "bg-red-500/70"}`} style={{ width: `${Math.min(100, Math.abs(share) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- drop callout */}
      {shown.drops.length > 0 && (
        <section data-testid="drop-callout" className="qf-card border-l-2 border-l-red-500 p-5">
          <div className="flex items-center gap-2">
            <Ban className="h-4 w-4 text-red-400" />
            <h2 className="font-heading text-base font-semibold text-slate-100">
              Do not trade {shown.drops.length} of these strategies
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Keeping them sized would eat drawdown (or lose money outright) without buying enough profit. The budget they free goes to the strategies below.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 mt-4">
            {shown.drops.map((e) => (
              <div key={e.id} className="flex items-start gap-2 text-[12px]">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 bg-red-500" />
                <div>
                  <span className="text-slate-200 font-mono">{e.name}</span>
                  <span className="text-slate-500"> — {e.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* -------------------------------------------------------- lot plan */}
      <section data-testid="lot-plan" className="qf-card qf-rise p-5 overflow-x-auto" style={{ animationDelay: "90ms" }}>
        <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
          <div>
            <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Lot plan · now vs suggested</h2>
            <p className="qf-label mt-1">Nudge any row by one lot step - the drawdown updates live</p>
          </div>
          <div className="text-[11px] font-mono text-slate-500">
            worst window {shown.peakTime ? new Date(shown.peakTime).toISOString().slice(0, 10) : "-"} → {shown.troughTime ? new Date(shown.troughTime).toISOString().slice(0, 10) : "-"}
          </div>
        </div>
        <table className="w-full min-w-[1080px]">
          <thead className="border-b border-slate-800">
            <tr>
              {[
                "Strategy",
                "Lots now → suggested",
                "Action",
                "Profit now → after",
                { label: "Worst dip alone now → after", title: "That strategy's OWN worst peak-to-trough dip if it traded by itself at that lot. It is not additive - the drawdown budget applies to the combined curve, and other strategies may be making money during this one's bad stretch." },
                { label: "Share of combined DD", title: "How much of the portfolio's worst window this strategy contributes. These add up exactly to the combined drawdown, so the budget is checked against their sum, not against any single row." },
                "",
              ].map((h, i) => (
                <th
                  key={(h?.label || h) + i}
                  title={h?.title}
                  className={`qf-label py-3 px-3 font-medium ${i === 0 ? "text-left" : i === 6 ? "" : "text-right"} ${h?.title ? "cursor-help" : ""}`}
                >
                  {h?.label || h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.perEa.map((e, i) => {
              const share = shown.dd > 0 ? e.risk / shown.dd : 0;
              return (
                <tr key={e.id} data-testid={`lot-plan-row-${i}`}
                  className={`border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors ${e.action === "drop" ? "opacity-55" : ""}`}>
                  <td className="py-3 px-3">
                    <div className="text-sm text-slate-100 truncate max-w-[250px]" title={e.name}>{e.name}</div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5">{e.symbol} · {e.trades} trades</div>
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs whitespace-nowrap">
                    <span className="text-slate-500">{fmtLot(e.refLot, step)}</span>
                    <span className="text-slate-600 mx-1.5">→</span>
                    <span className={`text-sm font-bold ${e.action === "drop" ? "text-red-400" : e.lot > e.refLot ? "text-emerald-300" : "text-cyan-300"}`}>
                      {e.lot > 0 ? fmtLot(e.lot, step) : "0"}
                    </span>
                    {e.lot > 0 && <span className="text-[10px] text-slate-500 ml-1.5">{e.multiplier.toFixed(2)}×</span>}
                  </td>
                  <td className="py-3 px-3 text-right"><Verdict action={e.action} /></td>
                  <td className="py-3 px-3 text-right font-mono text-xs whitespace-nowrap">
                    <span className="text-slate-500">{money(e.beforeProfit)}</span>
                    <span className="text-slate-600 mx-1.5">→</span>
                    <span className={e.profit > 0 ? "text-emerald-400" : e.profit < 0 ? "text-red-400" : "text-slate-500"}>{money(e.profit)}</span>
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-xs whitespace-nowrap"
                    title="This strategy's own worst drawdown if it traded alone at that lot - the portfolio drawdown is smaller because different strategies peak at different times">
                    <span className="text-slate-500">{money(e.beforeDD)}</span>
                    <span className="text-slate-600 mx-1.5">→</span>
                    <span className={e.standaloneDD > shown.effectiveBudget + 1e-6 ? "text-amber-300 font-semibold" : e.standaloneDD > 0 ? "text-slate-300" : "text-slate-500"}>
                      {money(e.standaloneDD)}
                      {e.standaloneDD > shown.effectiveBudget + 1e-6 ? " ⚠" : ""}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-14 h-1 bg-slate-800 hidden sm:block">
                        <div className={`h-full ${e.risk < 0 ? "bg-emerald-500" : "bg-red-500/70"}`} style={{ width: `${Math.min(100, Math.abs(share) * 100)}%` }} />
                      </div>
                      <span className={`font-mono text-xs w-16 ${e.risk < 0 ? "text-emerald-400" : "text-slate-300"}`}>{money(e.risk)}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => bump(i, -1)} className="p-1 border border-slate-700 text-slate-400 hover:border-red-400 hover:text-red-300 transition-colors" title="one lot step down">
                        <Minus className="h-3 w-3" />
                      </button>
                      <button onClick={() => bump(i, 1)} className="p-1 border border-slate-700 text-slate-400 hover:border-cyan-400 hover:text-cyan-300 transition-colors" title="one lot step up">
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-slate-700">
            <tr>
              <td className="py-3 px-3 text-xs text-slate-300">Total book</td>
              <td className="py-3 px-3 text-right font-mono text-xs whitespace-nowrap">
                <span className="text-slate-500">{before.totalLots.toFixed(2)}</span>
                <span className="text-slate-600 mx-1.5">→</span>
                <span className="text-sm font-bold text-cyan-300">{shown.totalLots.toFixed(2)}</span>
              </td>
              <td className="py-3 px-3 text-right">{sizeMult > 1 ? <Verdict action="increase" /> : sizeMult < 1 ? <Verdict action="reduce" /> : <Verdict action="keep" />}</td>
              <td className="py-3 px-3 text-right font-mono text-xs whitespace-nowrap">
                <span className="text-slate-500">{money(before.profit)}</span>
                <span className="text-slate-600 mx-1.5">→</span>
                <span className={shown.profit >= 0 ? "text-emerald-400" : "text-red-400"}>{money(shown.profit)}</span>
              </td>
              <td className="py-3 px-3 text-right font-mono text-[10px] text-slate-600" title="These are per-strategy dips and do not add up - the combined drawdown is in the next column">
                not additive
              </td>
              <td className="py-3 px-3 text-right font-mono text-xs text-red-400">{money(shown.dd)}</td>
              <td className="py-3 px-3" />
            </tr>
          </tfoot>
        </table>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 text-[11px] leading-relaxed">
          <p className="text-slate-500">
            <span className="text-slate-300">&ldquo;Worst dip alone&rdquo; is not the budget check:</span> that number is one
            strategy&rsquo;s own peak-to-trough dip. Your {money(shown.effectiveBudget)} limit applies to the <span className="text-slate-300">combined</span> curve,
            so it only sees the sum of the shares - which is exactly{" "}
            <span className={over ? "text-red-400" : "text-emerald-400"}>{money(shown.dd)}</span>.
          </p>
          <p className="text-slate-500">
            If every EA drew down at the same moment you would see{" "}
            <span className="text-slate-300">{money(shown.worstCaseDD)}</span>. That is why the shares can sum to the budget while
            individual rows sit above or below their true standalone risk.
          </p>
        </div>
        {shown.overBudget.length > 0 && (
          <div data-testid="standalone-warning" className="mt-3 flex items-start gap-2 border border-amber-500/40 bg-amber-500/5 px-3 py-2">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              <span className="font-semibold">{shown.overBudget.map((e) => e.name).join(", ")}</span>{" "}
              {shown.overBudget.length === 1 ? "can" : "can each"} draw down more than your whole{" "}
              {money(shown.effectiveBudget)} budget on {shown.overBudget.length === 1 ? "its" : "their"} own - worst is{" "}
              <span className="font-semibold">{shown.maxStandaloneEa?.name}</span> at {money(shown.maxStandalone)}. The combined curve still
              stays inside the budget because other strategies were making money during that stretch, but if they are flat next time this
              alone would breach it. Set <span className="text-amber-100">Max risk per EA</span> to 100% so no single strategy can.
            </p>
          </div>
        )}
      </section>

      {/* --------------------------------------------- month-by-month P&L */}
      <MonthlyCompare beforeMonths={baselinePortfolio?.months} afterMonths={planPortfolio?.months} />

      {/* --------------------------------------------------------- insights */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-4 w-4 text-cyan-400" />
          <h2 className="font-heading text-base font-semibold text-slate-100">What the brain sees</h2>
          <span className="qf-label ml-1">auto-generated from your reports</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {insights.map((n, i) => {
            const t = TONE[n.tone] || TONE.info;
            const Icon = t.icon;
            return (
              <div key={n.id} data-testid={`insight-${i}`} className={`qf-card qf-rise border-l-2 ${t.border} p-4`} style={{ animationDelay: `${Math.min(i * 40, 240)}ms` }}>
                <div className="flex items-start gap-2">
                  <Icon className={`h-3.5 w-3.5 ${t.color} mt-0.5 shrink-0`} />
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{n.title}</div>
                    <p className="text-[12px] text-slate-400 mt-1.5 leading-relaxed">{n.body}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------------- charts */}
      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {planPortfolio ? (
          <PlanEquityChart planPortfolio={planPortfolio} baselinePortfolio={baselinePortfolio} start={start} />
        ) : (
          <div className="qf-card p-5">
            <h2 className="font-heading text-base font-semibold text-slate-100">Equity at the recommended sizing</h2>
            <p className="text-sm text-slate-500 mt-3">No strategy is sized yet - raise the budget or lower the lot step.</p>
          </div>
        )}
        <FrontierChart frontier={frontier} plan={{ dd: shown.dd, profit: shown.profit }} budget={budget} />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <MonteCarloChart mc={mc} budget={shown.effectiveBudget} onApplyRobust={applyRobust} />
        <div className="qf-card p-5">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-slate-500" />
            <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Where the risk goes</h2>
          </div>
          <p className="qf-label mt-1">Split of the worst drawdown window across the book</p>
          <div className="mt-4 space-y-3">
            {[...shown.perEa].filter((e) => e.lot > 0).sort((a, b) => b.risk - a.risk).map((e) => {
              const share = shown.dd > 0 ? e.risk / shown.dd : 0;
              return (
                <div key={e.id}>
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-slate-300 truncate max-w-[220px]" title={e.name}>{e.name}</span>
                    <span className={e.risk < 0 ? "text-emerald-400" : "text-slate-400"}>{money(e.risk)} · {(share * 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-800 mt-1">
                    <div className={`h-full ${e.risk < 0 ? "bg-emerald-500" : "bg-gradient-to-r from-red-500/80 to-amber-400/80"}`}
                      style={{ width: `${Math.min(100, Math.abs(share) * 100)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 pt-4 border-t border-slate-800 text-[11px] text-slate-500 leading-relaxed">
            A negative bar means the strategy <span className="text-emerald-400">earns</span> during the portfolio's worst stretch, which is why the optimiser
            may keep it sized even when its own profit is thin.
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- method */}
      <details className="qf-card p-5">
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <Info className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">How this is calculated - and what it does not model</span>
        </summary>
        <div className="mt-4 grid md:grid-cols-2 gap-6 text-[12px] text-slate-400 leading-relaxed">
          <div className="space-y-2">
            <p><span className="text-slate-200 font-semibold">1. Normalise.</span> Every deal is divided by its own lot so each report becomes P&amp;L per 1.00 lot. A 0.01-lot report that made $14 becomes $1,400 per lot.</p>
            <p><span className="text-slate-200 font-semibold">2. Merge.</span> All normalised deals are replayed on one timeline to the second, so simultaneous losses stack.</p>
            <p><span className="text-slate-200 font-semibold">3. Solve.</span> Drawdown is a max of linear functions of the lot vector, so "max profit subject to DD ≤ budget" is a linear program. A cutting-plane loop re-resolves the exact worst window again and again until the plan is provably optimal for that budget.</p>
            <p><span className="text-slate-200 font-semibold">4. Stress.</span> The plan is re-run through a block bootstrap of the joint daily P&amp;L - 400 reshuffled histories - to see how often the budget would have been breached.</p>
          </div>
          <div className="space-y-2">
            <p className="text-amber-300/90 font-semibold">Not modelled</p>
            <p>Spread widening, slippage, swap, execution limits, margin calls and each broker's maximum lot per order. The linear-scaling assumption holds for fixed-lot strategies but not for compounding, martingale or equity-based risk logic.</p>
            <p>The drawdown shown is the worst peak-to-trough dip in the <em>backtested</em> period. The Monte Carlo gives a distribution around it; neither guarantees the future.</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {["convex optimisation", "linear program", "block bootstrap", "risk attribution"].map((t) => (
                <span key={t} className="px-2 py-1 border border-slate-700 text-[10px] font-mono text-slate-500">{t}</span>
              ))}
            </div>
          </div>
        </div>
      </details>
    </div>
  );
};
