import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";
import { money, REPORT_COLORS } from "../lib/portfolio";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (k, short) => (short ? MONTHS[+k.slice(5) - 1] : `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`);
const tone = (v) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-500");

/** "+1.2k" / "-840" - cells get narrow when the history is long */
const compact = (v) => {
  if (!v) return "—";
  const sign = v > 0 ? "+" : "-";
  const a = Math.abs(v);
  if (a >= 10000) return `${sign}${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(1)}k`;
  if (a >= 10) return `${sign}${Math.round(a)}`;
  return `${sign}${a.toFixed(1)}`;
};

const MAX_ROWS = 40;
const MANY_MONTHS = 24;

/**
 * Monthly profit matrix.
 *
 * Strategies are the ROWS and periods the COLUMNS, so adding strategies grows
 * the table downwards instead of forcing a horizontal scroll. Long histories
 * (a book easily spans 3-4 years) automatically collapse to one column per YEAR
 * - 47 month columns across one screen would be unreadable at any font size -
 * and the Months/Years switch drills back in.
 */
export const MonthlyTable = ({ p, reports }) => {
  const months = useMemo(() => p.months || [], [p.months]);
  const [unit, setUnit] = useState(null);
  const view = unit || (months.length > MANY_MONTHS ? "years" : "months");
  const dense = view === "months" && months.length > 14;
  const fmt = (v) => (dense || view === "years" ? compact(v) : money(v));

  const cols = useMemo(() => {
    if (view === "months") {
      return months.map((m) => ({
        key: m.key,
        label: dense ? monthLabel(m.key, true) : monthLabel(m.key),
        title: monthLabel(m.key),
        get: (ri) => m.byReport[ri] || 0,
        total: m.total,
        trades: m.trades,
      }));
    }
    const years = new Map();
    for (const m of months) {
      const y = m.key.slice(0, 4);
      const cur = years.get(y) || { key: y, total: 0, trades: 0, by: {} };
      cur.total += m.total;
      cur.trades += m.trades;
      for (const [ri, v] of Object.entries(m.byReport)) cur.by[ri] = (cur.by[ri] || 0) + v;
      years.set(y, cur);
    }
    return [...years.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((y) => ({ key: y.key, label: y.key, title: `${y.key} - ${y.trades} trades`, get: (ri) => y.by[ri] || 0, total: y.total, trades: y.trades }));
  }, [view, months, dense]);

  const rows = useMemo(() => {
    const totalOf = (ri) => cols.reduce((s, c) => s + c.get(ri), 0);
    const ranked = reports.map((r, ri) => ({ r, ri, total: totalOf(ri) }));
    ranked.sort((a, b) => b.total - a.total);
    const shown = ranked.length > MAX_ROWS ? ranked.slice(0, MAX_ROWS) : ranked;
    const hidden = ranked.length > MAX_ROWS ? ranked.slice(MAX_ROWS) : [];
    return { shown, hidden };
  }, [reports, cols]);

  const data = months.map((m) => ({ ...m, name: monthLabel(m.key) }));
  const grandTotal = cols.reduce((s, c) => s + c.total, 0);
  const hiddenSum = rows.hidden.length ? cols.reduce((s, c) => s + rows.hidden.reduce((t, x) => t + c.get(x.ri), 0), 0) : 0;

  return (
    <div data-testid="monthly-matrix-container" className="qf-card qf-rise p-5" style={{ animationDelay: "180ms" }}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
        <div>
          <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Monthly Profit</h2>
          <p className="qf-label mt-1">
            Per report, by deal close month · months across, strategies down
            {rows.hidden.length > 0 && ` · best ${MAX_ROWS} shown, ${rows.hidden.length} more summed`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="qf-label">{reports.length} strategies · {months.length} months</span>
          <div data-testid="monthly-unit-toggle" className="flex border border-slate-700">
            {[{ k: "months", l: "Months" }, { k: "years", l: "Years" }].map((o) => (
              <button
                key={o.k}
                type="button"
                data-testid={`monthly-unit-${o.k}`}
                onClick={() => setUnit(o.k)}
                className={`px-2.5 py-1 text-[11px] font-mono transition-colors ${view === o.k ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:text-slate-200"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </div>
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
        <table
          className="w-full"
          style={
            view === "months" && dense
              ? { tableLayout: "fixed", minWidth: `${240 + cols.length * 66 + 96}px` }
              : { tableLayout: "fixed" }
          }
        >
          <colgroup>
            {view === "months" && dense ? (
              <>
                <col style={{ width: "240px" }} />
                {cols.map((c) => <col key={c.key} style={{ width: "66px" }} />)}
                <col style={{ width: "96px" }} />
              </>
            ) : (
              <>
                <col style={{ width: view === "years" ? "34%" : "24%" }} />
                {cols.map((c) => <col key={c.key} />)}
                <col style={{ width: view === "years" ? "14%" : "10%" }} />
              </>
            )}
          </colgroup>
          <thead className="border-b border-slate-800">
            <tr>
              <th className="qf-label py-2 px-2 text-left font-medium">Strategy</th>
              {cols.map((c) => (
                <th key={c.key} className="qf-label py-2 px-1 text-right font-medium" title={c.title}>{c.label}</th>
              ))}
              <th className="qf-label py-2 px-2 text-right font-medium text-slate-200">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.shown.map(({ r, ri, total }) => (
              <tr key={r.id} className="border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors">
                <td className="py-1.5 px-2 text-xs text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0" style={{ background: REPORT_COLORS[r.ci % REPORT_COLORS.length] }} />
                    <span className="truncate" title={r.eaExpert ? `${r.expert} · EA: ${r.eaExpert}` : r.expert}>{r.expert}</span>
                  </span>
                </td>
                {cols.map((c) => {
                  const v = c.get(ri);
                  return <td key={c.key} className={`py-1.5 px-1 text-right font-mono text-[11px] ${tone(v)}`}>{fmt(v)}</td>;
                })}
                <td className={`py-1.5 px-2 text-right font-mono text-[11px] font-bold ${tone(total)}`}>{fmt(total)}</td>
              </tr>
            ))}
            {rows.hidden.length > 0 && (
              <tr className="border-b border-slate-800/60">
                <td className="py-1.5 px-2 text-xs italic text-slate-500">+{rows.hidden.length} more</td>
                {cols.map((c) => {
                  const v = rows.hidden.reduce((t, x) => t + c.get(x.ri), 0);
                  return <td key={c.key} className={`py-1.5 px-1 text-right font-mono text-[11px] ${tone(v)}`}>{fmt(v)}</td>;
                })}
                <td className={`py-1.5 px-2 text-right font-mono text-[11px] font-bold ${tone(hiddenSum)}`}>{fmt(hiddenSum)}</td>
              </tr>
            )}
          </tbody>
          <tfoot className="border-t border-slate-700">
            <tr>
              <td className="qf-label py-2 px-2">Combined</td>
              {cols.map((c) => (
                <td key={c.key} className={`py-2 px-1 text-right font-mono text-[11px] font-bold ${tone(c.total)}`} title={`${c.trades} trades`}>{fmt(c.total)}</td>
              ))}
              <td className={`py-2 px-2 text-right font-mono text-xs font-bold ${tone(grandTotal)}`}>{fmt(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {view === "years" && months.length > MANY_MONTHS && (
        <p className="qf-label mt-3">
          {months.length} months are grouped into yearly columns so nothing needs sideways scrolling - switch to Months to see each one.
        </p>
      )}
    </div>
  );
};
