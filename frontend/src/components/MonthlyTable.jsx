import { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";
import { money, REPORT_COLORS } from "../lib/portfolio";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthName = (k) => MONTHS[+k.slice(5) - 1];
const tone = (v) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-500");

/** one EA column is 92px - enough for "$1,234.56" at 11px mono */
const COL_W = 92;
const NAME_W = 118;

/**
 * Monthly profit matrix - months down, strategies across.
 *
 * The section runs the full page width and shows EVERY strategy as a column
 * (no "+N more" cap): with a wide screen a dozen fit without any sideways
 * scrolling, and the month column stays pinned on the left when a bigger book
 * does need it.
 */
export const MonthlyTable = ({ p, reports }) => {
  const months = useMemo(() => p.months || [], [p.months]);

  const totals = useMemo(() => {
    const perEa = reports.map((_, ri) => months.reduce((s, m) => s + (m.byReport[ri] || 0), 0));
    const grand = months.reduce((s, m) => s + m.total, 0);
    return { perEa, grand };
  }, [reports, months]);

  const data = months.map((m) => ({ ...m, name: monthName(m.key) }));
  const width = NAME_W + reports.length * COL_W + COL_W;

  return (
    <div data-testid="monthly-matrix-container" className="qf-card qf-rise p-5" style={{ animationDelay: "180ms" }}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
        <div>
          <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Monthly Profit</h2>
          <p className="qf-label mt-1">Per report, by deal close month · months down, strategies across</p>
        </div>
        <span className="qf-label">
          {reports.length} strateg{reports.length === 1 ? "y" : "ies"} · {months.length} month{months.length === 1 ? "" : "s"}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid stroke="#1F2937" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="name" stroke="#475569" fontSize={10} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={16} />
          <YAxis stroke="#475569" fontSize={10} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} tickFormatter={(v) => `$${Math.round(v)}`} width={58} />
          <Tooltip cursor={{ fill: "#1E293B55" }} formatter={(v) => money(v)} contentStyle={{ background: "#0B0F19", border: "1px solid #1F2937", fontFamily: "JetBrains Mono", fontSize: 12 }} />
          <Bar dataKey="total" name="Combined" isAnimationActive={false}>
            {data.map((d) => <Cell key={d.key} fill={d.total >= 0 ? "#10B981" : "#EF4444"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full" style={{ tableLayout: "fixed", minWidth: `${width}px` }}>
          <colgroup>
            <col style={{ width: `${NAME_W}px` }} />
            {reports.map((r) => <col key={r.id} style={{ width: `${COL_W}px` }} />)}
            <col style={{ width: `${COL_W}px` }} />
          </colgroup>
          <thead className="border-b border-slate-800">
            <tr>
              <th className="qf-label py-3 px-3 text-left font-medium sticky left-0 z-20 bg-slate-900/95 backdrop-blur">Month</th>
              {reports.map((r) => (
                <th key={r.id} className="qf-label py-3 px-2 text-right font-medium">
                  <span className="flex items-center justify-end gap-1.5">
                    <span className="truncate max-w-[74px]" title={r.eaExpert ? `${r.expert} · EA: ${r.eaExpert}` : r.expert}>{r.expert}</span>
                    <span className="h-1.5 w-1.5 shrink-0" style={{ background: REPORT_COLORS[r.ci % REPORT_COLORS.length] }} />
                  </span>
                </th>
              ))}
              <th className="qf-label py-3 px-2 text-right font-medium text-slate-200">Total</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={m.key} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                <td className="py-2.5 px-3 text-xs sticky left-0 z-10 bg-slate-900/95 backdrop-blur">
                  <span className="block text-slate-200 font-medium">{monthName(m.key)}</span>
                  <span className="block text-[10px] text-slate-500 font-mono">{m.key.slice(0, 4)}</span>
                </td>
                {reports.map((r, ri) => {
                  const v = m.byReport[ri] || 0;
                  return (
                    <td key={r.id} className={`py-2.5 px-2 text-right font-mono text-[11px] ${tone(v)}`} title={`${r.expert} · ${monthName(m.key)} ${m.key.slice(0, 4)}`}>
                      {v ? money(v) : <span className="text-slate-600">$0.00</span>}
                    </td>
                  );
                })}
                <td className={`py-2.5 px-2 text-right font-mono text-[11px] font-bold ${tone(m.total)}`} title={`${m.trades} trades`}>{money(m.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-slate-700">
            <tr>
              <td className="py-3 px-3 qf-label sticky left-0 z-10 bg-slate-900/95 backdrop-blur">Total</td>
              {reports.map((r, ri) => (
                <td key={r.id} className={`py-3 px-2 text-right font-mono text-[11px] font-bold ${tone(totals.perEa[ri])}`}>{money(totals.perEa[ri])}</td>
              ))}
              <td className={`py-3 px-2 text-right font-mono text-[11px] font-bold ${tone(totals.grand)}`}>{money(totals.grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {reports.length * COL_W + NAME_W > 1400 && (
        <p className="qf-label mt-3">The month column stays pinned while you scroll across - every report has its own column.</p>
      )}
    </div>
  );
};
