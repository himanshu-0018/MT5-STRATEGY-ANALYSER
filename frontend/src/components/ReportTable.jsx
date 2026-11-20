import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Trash2, Eye, EyeOff, Layers } from "lucide-react";
import { MergeEditor } from "./MergeEditor";
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

const ReportTableInner = ({ reports, summaries, enabled, onToggle, onRemove, mergeMode, mergeSel, onMergeMode, onMergeSel, onMerge, onRemovePart, onAddToMerge, onRenameMerge }) => {
  const [mergeName, setMergeName] = useState("");
  const [editing, setEditing] = useState(null);
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
        <div className="flex items-center gap-3">
          <span className="qf-label">{reports.length} reports · {activeCount} active</span>
          {reports.length > 1 && (
            <button
              data-testid="merge-mode-toggle"
              onClick={() => onMergeMode()}
              title="Join strategies that belong to the same EA into one"
              className={`px-2.5 py-1 border text-[11px] font-mono transition-colors ${mergeMode ? "border-cyan-300 bg-cyan-400 text-slate-900 font-bold" : "border-cyan-500/50 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"}`}
            >
              {mergeMode ? "Cancel merge" : "Merge strategies"}
            </button>
          )}
        </div>
      </div>
      <p className="qf-label mb-4">Each file analysed separately on its own initial deposit</p>

      <div ref={scroller} onScroll={recalc} className="max-h-[620px] overflow-auto">
        <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 z-10 bg-[#111827] border-b border-slate-800">
            <tr><th className={`qf-label py-3 px-3 font-medium text-left ${mergeMode ? "text-cyan-300" : ""}`}>{mergeMode ? "Merge" : "Use"}</th><H>Strategy</H><H>Symbol / TF</H><H>Range</H><H right>Deposit</H><H right>Trades</H><H right>Net Profit</H><H right>PF</H><H right>Win %</H><H right>Max DD</H><H /></tr>
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
                  className={`border-b border-slate-800/60 transition-colors hover:bg-slate-800/30 ${enabled[r.id] ? "" : "opacity-40"} ${mergeMode && mergeSel?.has(r.id) ? "bg-cyan-500/10 shadow-[inset_2px_0_0_0_#22d3ee]" : ""}`}>
                  <C>
                    {mergeMode ? (
                      <Checkbox
                        data-testid={`merge-check-${i}`}
                        checked={!!mergeSel?.has(r.id)}
                        onCheckedChange={() => onMergeSel(r.id)}
                        className="border-cyan-400/70 bg-slate-800 data-[state=checked]:bg-cyan-400 data-[state=checked]:border-cyan-300 data-[state=checked]:text-slate-900 h-4 w-4"
                      />
                    ) : (
                      <Checkbox data-testid={`report-include-checkbox-${i}`} checked={!!enabled[r.id]} onCheckedChange={() => onToggle(r.id)} />
                    )}
                  </C>
                  <C className="font-sans text-sm text-slate-100">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 shrink-0" style={{ background: REPORT_COLORS[i % REPORT_COLORS.length] }} />
                      <span className="truncate max-w-[260px]" title={r.eaExpert ? `${r.expert} · EA: ${r.eaExpert}` : r.expert}>{r.expert}</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate max-w-[260px]">
                      {r.eaExpert ? `EA: ${r.eaExpert}` : r.fileName}
                      {r.mergedParts?.length >= 2 && (
                        <span className="ml-2 px-1 py-0.5 border border-cyan-500/50 bg-cyan-500/10 text-[9px] tracking-wider text-cyan-300">
                          MERGED · {r.mergedParts.length}
                        </span>
                      )}
                      {!enabled[r.id] && <span className="ml-2 px-1 py-0.5 border border-slate-600 text-[9px] tracking-wider text-slate-400">HIDDEN</span>}
                    </div>
                  </C>
                  <C>
                    <span title={(r.symbols || []).map((x) => `${x.symbol} · ${x.trades} deals`).join("\n") || r.symbol}>{r.symbol}</span>
                    <span className="text-slate-500"> · {r.timeframe}</span>
                  </C>
                  <C className="text-slate-400">{fmtDate(s.from)} → {fmtDate(s.to)}</C>
                  <C right>{money(r.initialDeposit)}</C>
                  <C right>{s.trades}</C>
                  <C right className={s.net >= 0 ? "text-emerald-400" : "text-red-400"}>{money(s.net, true)}</C>
                  <C right>{Number.isFinite(s.pf) ? s.pf.toFixed(2) : "∞"}</C>
                  <C right>{(s.winRate * 100).toFixed(1)}%</C>
                  <C right className="text-red-400">-{money(s.dd.amount)} <span className="text-slate-500">({(s.dd.pct * 100).toFixed(2)}%)</span></C>
                  <C right>
                    <div className="flex items-center justify-end gap-2">
                      {r.mergedParts?.length >= 2 && (
                        <button
                          data-testid={`report-edit-merge-${i}`}
                          onClick={() => setEditing(r.id)}
                          title="Edit this merged EA - rename it, remove or add strategies"
                          className="text-cyan-300 hover:text-cyan-100 transition-colors"
                        >
                          <Layers className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        data-testid={`report-hide-button-${i}`}
                        onClick={() => onToggle(r.id)}
                        title={enabled[r.id] ? "Hide this report from the analysis (keeps it in the list)" : "Bring this report back into the analysis"}
                        className={`transition-colors ${enabled[r.id] ? "text-slate-500 hover:text-cyan-300" : "text-cyan-400 hover:text-cyan-200"}`}
                      >
                        {enabled[r.id] ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                      </button>
                      <button data-testid={`report-remove-button-${i}`} onClick={() => onRemove(r.id)} title="Remove from the list entirely" className="text-slate-500 hover:text-red-400 transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
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
      {mergeMode && (
        <div className="mt-3 flex flex-wrap items-center gap-3 border-2 border-cyan-400/60 bg-cyan-500/10 px-3 py-2.5">
          <span className="font-mono text-xs font-bold text-cyan-200">{mergeSel?.size || 0} selected</span>
          <input
            data-testid="merge-name-input"
            value={mergeName}
            onChange={(e) => setMergeName(e.target.value)}
            placeholder="Name this EA (e.g. CG) - blank keeps the file name"
            className="flex-1 min-w-[240px] bg-slate-950 border border-cyan-400/40 px-2 py-1.5 text-xs text-slate-100 font-mono outline-none focus:border-cyan-300"
          />
          <button
            data-testid="merge-confirm"
            disabled={(mergeSel?.size || 0) < 2}
            onClick={() => { onMerge(mergeSel, mergeName); setMergeName(""); }}
            className="px-3 py-1 bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 text-[11px] font-mono disabled:opacity-40 disabled:cursor-not-allowed hover:bg-cyan-500/30 transition-colors"
          >
            Merge into one EA
          </button>
          <button onClick={() => { onMergeMode(false); setMergeName(""); }} className="px-2 py-1 text-[11px] font-mono text-slate-400 hover:text-slate-200">Cancel</button>
        </div>
      )}
      <p className="qf-label mt-3">Scroll to browse all {reports.length} reports - only the visible rows are drawn.</p>
      {editing && (() => {
        const merged = reports.find((r) => r.id === editing);
        return merged && merged.mergedParts?.length >= 2 ? (
          <MergeEditor
            merged={merged}
            reports={reports}
            onClose={() => setEditing(null)}
            onRemovePart={onRemovePart}
            onAdd={onAddToMerge}
            onRename={onRenameMerge}
          />
        ) : null;
      })()}
    </div>
  );
};

export const ReportTable = memo(ReportTableInner);
