import { useMemo } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  ReferenceDot,
  Cell,
  Area,
} from "recharts";
import { fmtDate, money } from "../lib/portfolio";

const AXIS = { stroke: "#475569", fontSize: 11, fontFamily: "JetBrains Mono", tickLine: false, axisLine: false };

const sample = (arr, max = 1400) => {
  if (arr.length <= max) return arr;
  const step = Math.ceil(arr.length / max);
  return arr.filter((_, i) => i % step === 0 || i === arr.length - 1);
};

/* ------------------------------------------------------------------ */
/* equity at the planned lot sizes vs the original backtest           */
/* ------------------------------------------------------------------ */

export const PlanEquityChart = ({ planPortfolio, baselinePortfolio, start }) => {
  const data = useMemo(() => {
    if (!planPortfolio) return [];
    const base = baselinePortfolio?.curve || [];
    const rows = planPortfolio.curve.map((p, i) => ({
      time: p.time,
      plan: p.balance,
      base: base[i]?.balance ?? start,
    }));
    return sample([{ time: (rows[0]?.time ?? Date.now()) - 1, plan: start, base: start }, ...rows]);
  }, [planPortfolio, baselinePortfolio, start]);

  return (
    <div className="qf-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Equity at the recommended sizing</h2>
          <p className="qf-label mt-1">Solid = planned lots · dashed = original backtest lots</p>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span className="flex items-center gap-1.5 text-cyan-300"><span className="h-0.5 w-4 bg-cyan-400" />planned</span>
          <span className="flex items-center gap-1.5 text-slate-400"><span className="h-0.5 w-4 border-t border-dashed border-slate-500" />backtest</span>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ left: 6, right: 8, top: 4 }}>
          <defs>
            <linearGradient id="planFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1F2937" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="time" type="number" scale="time" domain={["dataMin", "dataMax"]} tickFormatter={fmtDate} {...AXIS} minTickGap={60} />
          <YAxis tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`} {...AXIS} width={74} domain={["auto", "auto"]} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="qf-tooltip">
                  <div className="text-slate-400">{fmtDate(d.time)}</div>
                  <div className="text-cyan-300">planned {money(d.plan)}</div>
                  <div className="text-slate-400">backtest {money(d.base)}</div>
                </div>
              );
            }}
          />
          <ReferenceLine y={start} stroke="#475569" strokeDasharray="4 4" />
          <Line type="monotone" dataKey="base" stroke="#64748B" strokeWidth={1.1} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Area type="monotone" dataKey="plan" stroke="#22D3EE" strokeWidth={1.7} fill="url(#planFill)" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* profit achievable per drawdown budget, by sizing method            */
/* ------------------------------------------------------------------ */

const METHOD_META = {
  maxprofit: { label: "Max profit", color: "#22D3EE" },
  uniform: { label: "Uniform scale", color: "#F59E0B" },
  riskparity: { label: "Equal risk", color: "#A78BFA" },
};

export const FrontierChart = ({ frontier, plan, budget }) => {
  const data = useMemo(() => {
    if (!frontier?.length) return [];
    const maxDD = Math.max(budget, ...frontier.map((f) => f.dd)) * 1.12;
    const rows = [];
    const n = 12;
    for (let i = 0; i <= n; i++) {
      const dd = (maxDD * i) / n;
      const row = { dd: +dd.toFixed(2) };
      for (const f of frontier) {
        const slope = f.dd > 0 ? f.profit / f.dd : 0;
        row[f.key] = +(dd * slope).toFixed(2);
      }
      rows.push(row);
    }
    return rows;
  }, [frontier, budget]);

  return (
    <div className="qf-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Profit per drawdown budget</h2>
          <p className="qf-label mt-1">Steeper line = more profit for the same pain</p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={data} margin={{ left: 6, right: 8, top: 4 }}>
          <CartesianGrid stroke="#1F2937" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="dd" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `$${Math.round(v)}`} {...AXIS} />
          <YAxis tickFormatter={(v) => `$${Math.round(v).toLocaleString()}`} {...AXIS} width={74} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="qf-tooltip">
                  <div className="text-slate-400">budget {money(label)}</div>
                  {payload.map((p) => (
                    <div key={p.dataKey} style={{ color: p.color }}>
                      {METHOD_META[p.dataKey]?.label}: {money(p.value)}
                    </div>
                  ))}
                </div>
              );
            }}
          />
          <ReferenceLine x={budget} stroke="#EF4444" strokeDasharray="4 3" label={{ value: "budget", fill: "#F87171", fontSize: 10, position: "insideTopRight" }} />
          {frontier.map((f) => (
            <Line key={f.key} type="linear" dataKey={f.key} stroke={METHOD_META[f.key]?.color} strokeWidth={f.key === "maxprofit" ? 2.1 : 1.3}
              dot={false} isAnimationActive={false} strokeDasharray={f.key === "riskparity" ? "5 3" : undefined} />
          ))}
          {plan && plan.dd > 0 && (
            <ReferenceDot x={plan.dd} y={plan.profit} r={4.5} fill="#22D3EE" stroke="#0B0F19" strokeWidth={2} isFront />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-4 mt-3 text-[11px] font-mono">
        {frontier.map((f) => (
          <span key={f.key} className="flex items-center gap-1.5" style={{ color: METHOD_META[f.key]?.color }}>
            <span className="h-0.5 w-4" style={{ background: METHOD_META[f.key]?.color }} />
            {METHOD_META[f.key]?.label} · {money(f.dd)} DD → {money(f.profit)}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 font-mono mt-2 leading-relaxed">
        Lines assume continuous lot sizes. Your broker's lot step rounds the dot down to the plan above - that gap is what a finer lot step would recover.
      </p>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* monte-carlo drawdown distribution                                  */
/* ------------------------------------------------------------------ */

export const MonteCarloChart = ({ mc, budget, onApplyRobust }) => {
  const bins = useMemo(() => {
    if (!mc?.samples?.length) return [];
    const hi = Math.max(mc.p99, budget * 1.25) * 1.05;
    const n = 26;
    const width = hi / n;
    const counts = new Array(n).fill(0);
    for (const v of mc.samples) counts[Math.min(n - 1, Math.max(0, Math.floor(v / width)))]++;
    return counts.map((c, i) => ({
      from: i * width,
      to: (i + 1) * width,
      mid: (i + 0.5) * width,
      count: c,
      pct: (c / mc.samples.length) * 100,
      over: (i + 1) * width > budget,
    }));
  }, [mc, budget]);

  if (!mc) {
    return (
      <div className="qf-card p-5">
        <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Drawdown stress test</h2>
        <p className="text-sm text-slate-500 mt-3">Size at least one strategy to run the Monte Carlo reshuffle.</p>
      </div>
    );
  }

  return (
    <div className="qf-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Drawdown stress test</h2>
          <p className="qf-label mt-1">{mc.sims} reshuffled histories · block {mc.blockDays} days</p>
        </div>
        <div className="text-right">
          <div className="qf-label">Chance of breach</div>
          <div className={`font-mono text-lg font-bold ${mc.breaches > 0.2 ? "text-red-400" : mc.breaches > 0.05 ? "text-amber-400" : "text-emerald-400"}`}>
            {(mc.breaches * 100).toFixed(1)}%
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={bins} margin={{ left: 4, right: 8, top: 4 }}>
          <CartesianGrid stroke="#1F2937" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="mid" type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `$${Math.round(v)}`} {...AXIS} minTickGap={40} />
          <YAxis tickFormatter={(v) => `${v}%`} {...AXIS} width={44} />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload;
              return (
                <div className="qf-tooltip">
                  <div className="text-slate-400">{money(d.from)} – {money(d.to)} DD</div>
                  <div className="text-cyan-300">{d.pct.toFixed(1)}% of runs</div>
                </div>
              );
            }}
          />
          <ReferenceLine x={budget} stroke="#EF4444" strokeDasharray="4 3" />
          {mc.historical > 0 && <ReferenceLine x={mc.historical} stroke="#34D399" strokeDasharray="4 3" />}
          <Bar dataKey="pct" isAnimationActive={false}>
            {bins.map((b) => (
              <Cell key={b.mid} fill={b.over ? "#EF4444" : "#06B6D4"} fillOpacity={b.over ? 0.55 : 0.5} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 text-[11px] font-mono text-slate-400">
        <span className="text-emerald-400">| backtest {money(mc.historical)}</span>
        <span className="text-red-400">| budget {money(budget)}</span>
        <span>p50 {money(mc.p50)}</span>
        <span>p90 {money(mc.p90)}</span>
        <span>p95 {money(mc.p95)}</span>
        <span>worst {money(mc.max)}</span>
      </div>
      {onApplyRobust && mc.scale < 0.995 && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            data-testid="apply-robust-sizing"
            onClick={() => onApplyRobust(mc.scale)}
            className="px-3 py-1.5 text-[11px] font-mono border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 transition-colors"
          >
            Use 95% safe sizing · {mc.robustLots.reduce((a, b) => a + b, 0).toFixed(2)} lots
          </button>
          <span className="text-[11px] text-slate-500 font-mono">
            {(mc.scale * 100).toFixed(0)}% of the current plan keeps the budget in 95 of 100 re-shuffled histories
          </span>
        </div>
      )}
    </div>
  );
};
