import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from "recharts";
import { money, REPORT_COLORS } from "../lib/portfolio";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (k) => `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}`;
const tone = (v) => (v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-slate-500");

const MAX_COLUMNS = 12;

export const MonthlyTable = ({ p, reports }) => {
  const data = p.months.map((m) => ({ ...m, name: label(m.key) }));

  // A matrix with one column per report stops being readable (and gets slow)
  // once the book has dozens of strategies, so show the best 12 and roll the
  // rest up into one "others" column.
  const ranked = reports
    .map((r, ri) => ({ r, ri, net: p.months.reduce((s, m) => s + (m.byReport[ri] || 0), 0) }))
    .sort((a, b) => b.net - a.net);
  const shownCols = ranked.length > MAX_COLUMNS ? ranked.slice(0, MAX_COLUMNS) : ranked;
  const hiddenCols = ranked.length > MAX_COLUMNS ? ranked.slice(MAX_COLUMNS) : [];
  const othersTotal = (m) => hiddenCols.reduce((s, c) => s + (m.byReport[c.ri] || 0), 0);
  return (
    <div data-testid="monthly-matrix-container" className="qf-card qf-rise p-5 overflow-x-auto" style={{ animationDelay: "180ms" }}>
      <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100 mb-1">Monthly Profit</h2>
      <p className="qf-label mb-4">
        Combined & per report, by deal close month
        {hiddenCols.length > 0 && ` · best ${MAX_COLUMNS} of ${reports.length} reports shown, the rest summed`}
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ left: 8, right: 8 }}>
          <CartesianGrid stroke="#1F2937" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="name" stroke="#475569" fontSize={11} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} />
          <YAxis stroke="#475569" fontSize={11} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} tickFormatter={(v) => `$${Math.round(v)}`} width={60} />
          <Tooltip cursor={{ fill: "#1E293B55" }} formatter={(v) => money(v)} contentStyle={{ background: "#0B0F19", border: "1px solid #1F2937", fontFamily: "JetBrains Mono", fontSize: 12 }} />
          <Bar dataKey="total" name="Combined" isAnimationActive={false}>
            {data.map((d) => <Cell key={d.key} fill={d.total >= 0 ? "#10B981" : "#EF4444"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table className="w-full mt-4">
        <thead className="border-b border-slate-800">
          <tr>
            <th className="qf-label text-left py-2 px-2 font-medium">Month</th>
            {shownCols.map(({ r }) => (
              <th key={r.id} className="qf-label text-right py-2 px-2 font-medium" title={r.eaExpert ? `${r.expert} · EA: ${r.eaExpert}` : r.expert}>
                <span className="inline-block h-1.5 w-1.5 mr-1.5 align-middle" style={{ background: REPORT_COLORS[r.ci % REPORT_COLORS.length] }} />
                {r.expert.slice(0, 14)}
              </th>
            ))}
            {hiddenCols.length > 0 && (
              <th className="qf-label text-right py-2 px-2 font-medium text-slate-500" title={`The other ${hiddenCols.length} reports, summed`}>
                +{hiddenCols.length} more
              </th>
            )}
            <th className="qf-label text-right py-2 px-2 font-medium">Trades</th>
            <th className="qf-label text-right py-2 px-2 font-medium text-slate-200">Combined</th>
          </tr>
        </thead>
        <tbody>
          {p.months.map((m, mi) => (
            <tr key={m.key} data-testid={`monthly-row-${m.key}`} className="border-b border-slate-800/60 hover:bg-slate-800/30">
              <td className="py-2 px-2 font-mono text-xs text-slate-300">{label(m.key)}</td>
              {shownCols.map(({ r, ri }) => (
                <td key={r.id} className={`py-2 px-2 font-mono text-xs text-right ${tone(m.byReport[ri] || 0)}`}>{money(m.byReport[ri] || 0)}</td>
              ))}
              {hiddenCols.length > 0 && (
                <td className={`py-2 px-2 font-mono text-xs text-right ${tone(othersTotal(m))}`}>{money(othersTotal(m))}</td>
              )}
              <td className="py-2 px-2 font-mono text-xs text-right text-slate-400">{m.trades}</td>
              <td data-testid={`monthly-total-${m.key}`} className={`py-2 px-2 font-mono text-xs text-right font-bold ${tone(m.total)}`}>{money(m.total, true)}</td>
            </tr>
          ))}
          <tr>
            <td className="py-2 px-2 qf-label">Total</td>
            {shownCols.map(({ r, ri }) => {
              const t = p.months.reduce((s, m) => s + (m.byReport[ri] || 0), 0);
              return <td key={r.id} className={`py-2 px-2 font-mono text-xs text-right ${tone(t)}`}>{money(t)}</td>;
            })}
            {hiddenCols.length > 0 && (
              <td className={`py-2 px-2 font-mono text-xs text-right ${tone(ranked.slice(MAX_COLUMNS).reduce((s, c) => s + c.net, 0))}`}>
                {money(ranked.slice(MAX_COLUMNS).reduce((s, c) => s + c.net, 0))}
              </td>
            )}
            <td className="py-2 px-2 font-mono text-xs text-right text-slate-400">{p.stats.trades}</td>
            <td className={`py-2 px-2 font-mono text-xs text-right font-bold ${tone(p.stats.net)}`}>{money(p.stats.net, true)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};
