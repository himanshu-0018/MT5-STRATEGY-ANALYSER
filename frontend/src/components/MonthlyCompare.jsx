import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { money, mergeMonthly } from "../lib/portfolio";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (k) => `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
const tone = (v) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-500");

export const MonthlyCompare = ({ beforeMonths, afterMonths }) => {
  const rows = useMemo(() => mergeMonthly(beforeMonths, afterMonths), [beforeMonths, afterMonths]);
  const data = useMemo(() => rows.map((r) => ({ ...r, name: label(r.key) })), [rows]);

  const totals = useMemo(() => {
    const before = rows.reduce((s, r) => s + r.before, 0);
    const after = rows.reduce((s, r) => s + r.after, 0);
    return {
      before,
      after,
      change: after - before,
      changePct: before !== 0 ? ((after - before) / Math.abs(before)) * 100 : null,
      trades: rows.reduce((s, r) => s + r.trades, 0),
      months: rows.length,
      winners: rows.filter((r) => r.change > 0).length,
      losers: rows.filter((r) => r.change < 0).length,
    };
  }, [rows]);

  const hasData = rows.length > 0 && (totals.before !== 0 || totals.after !== 0);
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.max(Math.abs(r.before), Math.abs(r.after))));

  return (
    <section data-testid="monthly-compare" className="qf-card qf-rise p-5" style={{ animationDelay: "110ms" }}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Monthly profit · current vs optimised lots</h2>
          <p className="qf-label mt-1">Every month re-priced at the recommended lot sizes</p>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-mono">
          <span className="flex items-center gap-1.5 text-slate-400"><span className="h-2 w-3 bg-slate-500" /> current lots</span>
          <span className="flex items-center gap-1.5 text-cyan-300"><span className="h-2 w-3 bg-cyan-400" /> optimised lots</span>
        </div>
      </div>

      {!hasData ? (
        <p className="mt-4 text-sm text-slate-500">
          No closed months to compare yet - the plan has no sized strategies, or the reports cover no complete month.
        </p>
      ) : (
        <>
          <div className="mt-4">
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={data} margin={{ left: 4, right: 8, top: 4 }} barGap={1}>
                <CartesianGrid stroke="#1F2937" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="name" stroke="#475569" fontSize={10} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
                <YAxis stroke="#475569" fontSize={10} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} tickFormatter={(v) => `$${Math.round(v)}`} width={58} />
                <Tooltip
                  cursor={{ fill: "#1E293B55" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="qf-tooltip">
                        <div className="text-slate-300">{label(d.key)}</div>
                        <div className="text-slate-400">current {money(d.before, true)}</div>
                        <div className="text-cyan-300">optimised {money(d.after, true)}</div>
                        <div className={d.change >= 0 ? "text-emerald-400" : "text-red-400"}>
                          {d.change >= 0 ? "+" : ""}
                          {money(d.change)} {d.changePct != null ? `(${d.changePct >= 0 ? "+" : ""}${d.changePct.toFixed(0)}%)` : ""}
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={0} stroke="#334155" />
                <Bar dataKey="before" name="Current" fill="#64748B" fillOpacity={0.65} isAnimationActive={false} />
                <Bar dataKey="after" name="Optimised" fill="#22D3EE" isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-slate-800">
                <tr>
                  <th className="qf-label px-2 py-2 text-left font-medium">Month</th>
                  <th className="qf-label px-2 py-2 text-right font-medium">Current lots</th>
                  <th className="qf-label px-2 py-2 text-right font-medium">Optimised lots</th>
                  <th className="qf-label px-2 py-2 text-right font-medium">Change</th>
                  <th className="qf-label px-2 py-2 text-right font-medium">Δ %</th>
                  <th className="qf-label px-2 py-2 text-center font-medium">Scale</th>
                  <th className="qf-label px-2 py-2 text-right font-medium">Trades</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const wide = (Math.abs(r.after) / maxAbs) * 100;
                  const narrow = (Math.abs(r.before) / maxAbs) * 100;
                  return (
                    <tr key={r.key} data-testid={`monthly-compare-row-${r.key}`} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                      <td className="px-2 py-2 font-mono text-xs text-slate-300">{label(r.key)}</td>
                      <td className={`px-2 py-2 text-right font-mono text-xs ${tone(r.before)}`}>{money(r.before, true)}</td>
                      <td className={`px-2 py-2 text-right font-mono text-xs font-semibold ${tone(r.after)}`}>{money(r.after, true)}</td>
                      <td className={`px-2 py-2 text-right font-mono text-xs ${r.change > 0 ? "text-emerald-400" : r.change < 0 ? "text-red-400" : "text-slate-500"}`}>
                        {r.change === 0 ? "—" : `${r.change > 0 ? "+" : ""}${money(r.change)}`}
                      </td>
                      <td className={`px-2 py-2 text-right font-mono text-[11px] ${r.changePct == null ? "text-slate-600" : r.changePct >= 0 ? "text-emerald-400/80" : "text-red-400/80"}`}>
                        {r.changePct == null ? "new" : `${r.changePct >= 0 ? "+" : ""}${r.changePct.toFixed(0)}%`}
                      </td>
                      <td className="px-2 py-2">
                        <div className="flex h-2 w-full max-w-[120px] mx-auto flex-col justify-center gap-[2px]">
                          <div className="h-[3px] bg-slate-700">
                            <div className="h-full bg-slate-500" style={{ width: `${narrow}%` }} />
                          </div>
                          <div className="h-[3px] bg-slate-800">
                            <div className="h-full bg-cyan-400" style={{ width: `${wide}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-[11px] text-slate-500">{r.trades}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t border-slate-700">
                <tr>
                  <td className="px-2 py-2.5 text-xs text-slate-300">Total ({totals.months} months)</td>
                  <td className={`px-2 py-2.5 text-right font-mono text-xs ${tone(totals.before)}`}>{money(totals.before, true)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono text-xs font-bold ${tone(totals.after)}`}>{money(totals.after, true)}</td>
                  <td className={`px-2 py-2.5 text-right font-mono text-xs ${totals.change > 0 ? "text-emerald-400" : totals.change < 0 ? "text-red-400" : "text-slate-500"}`}>
                    {totals.change === 0 ? "—" : `${totals.change > 0 ? "+" : ""}${money(totals.change)}`}
                  </td>
                  <td className={`px-2 py-2.5 text-right font-mono text-[11px] ${totals.changePct == null ? "text-slate-600" : totals.changePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {totals.changePct == null ? "—" : `${totals.changePct >= 0 ? "+" : ""}${totals.changePct.toFixed(0)}%`}
                  </td>
                  <td className="px-2 py-2.5" />
                  <td className="px-2 py-2.5 text-right font-mono text-[11px] text-slate-500">{totals.trades}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-[11px] text-slate-500 font-mono">
            {totals.winners} month{totals.winners === 1 ? "" : "s"} improve · {totals.losers} month{totals.losers === 1 ? "" : "s"} give up profit ·{" "}
            {totals.months - totals.winners - totals.losers} unchanged. Each month scales by its own mix of lot multipliers, so the change is not
            the same % every month.
          </p>
        </>
      )}
    </section>
  );
};
