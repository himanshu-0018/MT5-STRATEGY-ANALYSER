import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Checkbox } from "./ui/checkbox";
import { money, fmtDate, REPORT_COLORS } from "../lib/portfolio";

/**
 * The report list can hold hundreds of rows. Drawing them all costs thousands
 * of DOM nodes and makes every toggle / keystroke crawl, so only the rows in
 * the viewport are rendered, with spacer rows keeping the scroll height honest.
 */
const ROW_H = 62;
const OVERSCAN = 6;
const COL_COUNT = 11;

const H = ({ children, right }) => <th className={`qf-label py-3 px-3 font-medium ${right ? "text-right" : "text-left"}`}>{children}</th>;
const C = ({ children, right, className = "" }) => <td className={`py-2 px-3 font-mono text-xs ${right ? "text-right" : ""} ${className}`}>{children}</td>;

const ReportTableInner = ({ reports, summaries, enabled, onToggle, onRemove }) => {
  const scroller = useRef(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(reports.length, 24) });

  const recalc = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const first = Math.max(0, Math.floor(el.scrollTop / ROW_H) - OVERSCAN);
    const count = Math.ceil((el.clientHeight || 620) / ROW_H) + OVERSCAN * 2;
    setRange({ start: first, end: Math.min(reports.length, first + count) });
  }, [reports.length]);

  useEffect(() => {
    recalc();
    const el = scroller.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(recalc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [recalc]);

  const start = Math.max(0, Math.min(range.start, Math.max(0, reports.length - 1)));
  const end = Math.min(range.end, reports.length);
  const visible = reports.slice(start, end);
  const padTop = start * ROW_H;
  const padBottom = Math.max(0, (reports.length - end) * ROW_H);
  const activeCount = Object.values(enabled || {}).filter(Boolean).length;

  return (
    <div data-testid="per-report-table-container" className="qf-card qf-rise p-5" style={{ animationDelay: "60ms" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-heading text-base md:text-lg font-semibold text-slate-100">Individual Reports</h2>
        <span className="qf-label">{reports.length} reports · {activeCount} active</span>
      </div>
      <p className="qf-label mb-4">Each file analysed separately on its own initial deposit</p>

      <div ref={scroller} onScroll={recalc} className="max-h-[620px] overflow-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 z-10 bg-[#111827] border-b border-slate-800">
            <tr><H>Use</H><H>Strategy</H><H>Symbol / TF</H><H>Range</H><H right>Deposit</H><H right>Trades</H><H right>Net Profit</H><H right>PF</H><H right>Win %</H><H right>Max DD</H><H /></tr>
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true" style={{ height: padTop }}>
                <td colSpan={COL_COUNT} style={{ padding: 0, border: 0 }} />
              </tr>
            )}
            {visible.map((r, vi) => {
              const i = start + vi;
              const s = summaries[r.id];
              return (
                <tr key={r.id} data-testid={`per-report-row-${i}`} style={{ height: ROW_H }}
                  className={`border-b border-slate-800/60 transition-colors hover:bg-slate-800/30 ${enabled[r.id] ? "" : "opacity-40"}`}>
                  <C><Checkbox data-testid={`report-include-checkbox-${i}`} checked={!!enabled[r.id]} onCheckedChange={() => onToggle(r.id)} /></C>
                  <C className="font-sans text-sm text-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0" style={{ background: REPORT_COLORS[i % REPORT_COLORS.length] }} />
                      <span className="truncate max-w-[260px]" title={r.eaExpert ? `${r.expert} · EA: ${r.eaExpert}` : r.expert}>{r.expert}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate max-w-[260px]">
                      {r.eaExpert ? `EA: ${r.eaExpert}` : r.fileName}
                    </div>
                  </C>
                  <C>{r.symbol} · {r.timeframe}</C>
                  <C className="text-slate-400">{fmtDate(s.from)} → {fmtDate(s.to)}</C>
                  <C right>{money(r.initialDeposit)}</C>
                  <C right>{s.trades}</C>
                  <C right className={s.net >= 0 ? "text-emerald-400" : "text-red-400"}>{money(s.net, true)}</C>
                  <C right>{Number.isFinite(s.pf) ? s.pf.toFixed(2) : "∞"}</C>
                  <C right>{(s.winRate * 100).toFixed(1)}%</C>
                  <C right className="text-red-400">-{money(s.dd.amount)} <span className="text-slate-500">({(s.dd.pct * 100).toFixed(2)}%)</span></C>
                  <C right>
                    <button data-testid={`report-remove-button-${i}`} onClick={() => onRemove(r.id)} className="text-slate-500 hover:text-red-400 transition-colors">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </C>
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true" style={{ height: padBottom }}>
                <td colSpan={COL_COUNT} style={{ padding: 0, border: 0 }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="qf-label mt-3">Scroll to browse all {reports.length} reports - only the visible rows are drawn.</p>
    </div>
  );
};

export const ReportTable = memo(ReportTableInner);
