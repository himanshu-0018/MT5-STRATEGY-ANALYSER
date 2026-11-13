import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ArrowUpDown, Ban } from "lucide-react";
import { money, REPORT_COLORS } from "../lib/portfolio";

const pad = (n) => String(n).padStart(2, "0");
const clock = (t) => {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
const dayKeyOf = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

/** 02.11 18:04:31 when the trade was opened on an earlier day, HH:MM:SS otherwise */
const openStamp = (t, closeTime) => {
  if (t == null) return "—";
  if (dayKeyOf(t) === dayKeyOf(closeTime)) return clock(t);
  const d = new Date(t);
  return `${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${clock(t)}`;
};

export const formatHeld = (ms) => {
  if (ms == null) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${pad(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${pad(m % 60)}m`;
  return `${Math.floor(h / 24)}d ${pad(h % 24)}h`;
};

const price = (v) => {
  if (!Number.isFinite(v)) return "—";
  const decimals = Math.abs(v) >= 100 ? 2 : Math.abs(v) >= 10 ? 3 : 5;
  return v.toFixed(decimals);
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const weekdayOf = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

const SideBadge = ({ side }) => (
  <span
    className={`inline-block border px-1.5 py-0.5 text-[10px] font-mono tracking-wider ${
      String(side).toLowerCase() === "buy"
        ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/5"
        : "border-red-500/50 text-red-300 bg-red-500/5"
    }`}
  >
    {String(side).toUpperCase()}
  </span>
);

const Stat = ({ label, value, sub, tone }) => (
  <div className="min-w-[92px] text-right">
    <div className="qf-label">{label}</div>
    <div className={`font-mono font-bold leading-tight mt-1 ${tone || "text-slate-100"} text-lg`}>{value}</div>
    {sub ? <div className="font-mono text-[10px] text-slate-500 mt-0.5">{sub}</div> : null}
  </div>
);

export const DayTradesModal = ({ dayKey, trades, day, cellTotal, balanceAtOpen, onClose, colorOf }) => {
  const [eaFilter, setEaFilter] = useState(null);
  const [sort, setSort] = useState({ key: "closeTime", dir: 1 });
  const closeRef = useRef(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const list = useMemo(() => (trades || []).filter((t) => t.closeTime), [trades]);

  const byEa = useMemo(() => {
    const map = new Map();
    for (const t of list) {
      const cur = map.get(t.ri) || { ri: t.ri, ea: t.ea, pnl: 0, count: 0 };
      cur.pnl += t.pnl;
      cur.count += 1;
      map.set(t.ri, cur);
    }
    return [...map.values()].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }, [list]);

  const totals = useMemo(() => {
    const pnl = list.reduce((s, t) => s + t.pnl, 0);
    const wins = list.filter((t) => t.pnl > 0).length;
    const losses = list.filter((t) => t.pnl < 0).length;
    const lots = list.reduce((s, t) => s + (t.lots || 0), 0);
    const best = list.reduce((m, t) => (m == null || t.pnl > m ? t.pnl : m), null);
    const worst = list.reduce((m, t) => (m == null || t.pnl < m ? t.pnl : m), null);
    return { pnl, wins, losses, flats: list.length - wins - losses, lots, best, worst };
  }, [list]);

  const rows = useMemo(() => {
    const filtered = eaFilter == null ? list : list.filter((t) => t.ri === eaFilter);
    const dir = sort.dir;
    const val = (t) => {
      switch (sort.key) {
        case "pnl": return t.pnl;
        case "openTime": return t.openTime ?? t.closeTime;
        case "held": return t.heldMs ?? -1;
        case "ea": return t.ea || "";
        case "symbol": return t.symbol || "";
        case "lots": return t.lots || 0;
        default: return t.closeTime;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * dir;
      return (va - vb) * dir;
    });
  }, [list, eaFilter, sort]);

  const toggleSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === "closeTime" || key === "openTime" ? 1 : -1 }));

  const cell = Number.isFinite(cellTotal) ? cellTotal : day?.total;
  const diff = cell != null ? cell - totals.pnl : 0;
  const matches = cell == null || Math.abs(diff) < 0.005;
  const pctOfBalance = balanceAtOpen > 0 ? (totals.pnl / balanceAtOpen) * 100 : null;

  const Th = ({ label, sortKey, right, width }) => (
    <th className={`qf-label px-3 py-2.5 font-medium ${right ? "text-right" : "text-left"}`} style={width ? { width } : undefined}>
      {sortKey ? (
        <button
          type="button"
          onClick={() => toggleSort(sortKey)}
          className={`inline-flex items-center gap-1 transition-colors hover:text-cyan-300 ${sort.key === sortKey ? "text-cyan-300" : ""}`}
        >
          {label}
          <ArrowUpDown className={`h-2.5 w-2.5 ${sort.key === sortKey ? "opacity-100" : "opacity-40"}`} />
        </button>
      ) : (
        label
      )}
    </th>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/70 p-3 backdrop-blur-sm sm:p-6"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="day-trades-backdrop"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Trades closed on ${dayKey}`}
        data-testid="day-trades-modal"
        className="qf-card w-full max-w-[1500px] my-auto"
      >
        {/* ── header ─────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <div className="qf-label text-cyan-400">Trades · combined portfolio</div>
            <div className="mt-1 flex flex-wrap items-baseline gap-2">
              <span className="font-heading text-xl font-semibold text-slate-50">
                {dayKey.replace(/-/g, ".")} · {weekdayOf(dayKey)}
              </span>
              {eaFilter != null && (
                <span className="font-mono text-[11px] text-slate-500">filtered to one EA</span>
              )}
            </div>
          </div>
          <div className="flex items-start gap-6">
            <Stat label="Day P&L" value={money(totals.pnl, true)} tone={totals.pnl >= 0 ? "text-emerald-400" : "text-red-400"} />
            <Stat
              label="Closed trades"
              value={list.length}
              sub={`${totals.wins}W / ${totals.losses}L${totals.flats ? ` / ${totals.flats} flat` : ""}`}
            />
            <Stat label="Volume" value={`${totals.lots.toFixed(2)} lots`} />
            <button
              ref={closeRef}
              type="button"
              data-testid="day-trades-close"
              onClick={onClose}
              aria-label="Close trade list"
              className="mt-1 border border-slate-700 p-1.5 text-slate-400 transition-colors hover:border-cyan-400 hover:text-cyan-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* ── by EA ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 px-5 py-2">
          <span className="qf-label mr-1">By EA</span>
          <button
            type="button"
            data-testid="day-trades-filter-all"
            onClick={() => setEaFilter(null)}
            className={`border px-2 py-0.5 text-[11px] font-mono transition-colors ${
              eaFilter == null ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-300" : "border-slate-700 text-slate-400 hover:text-slate-200"
            }`}
          >
            All ({list.length})
          </button>
          {byEa.map((e) => (
            <button
              key={e.ri}
              type="button"
              data-testid={`day-trades-filter-${e.ri}`}
              onClick={() => setEaFilter(eaFilter === e.ri ? null : e.ri)}
              className={`flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-mono transition-colors ${
                eaFilter === e.ri ? "border-cyan-500/60 bg-cyan-500/10 text-cyan-200" : "border-slate-700 text-slate-400 hover:text-slate-200"
              }`}
              title={`${e.ea} · ${e.count} trade${e.count === 1 ? "" : "s"}`}
            >
              <span className="h-1.5 w-1.5 shrink-0" style={{ background: colorOf ? colorOf(e.ri) : REPORT_COLORS[e.ri % REPORT_COLORS.length] }} />
              <span className="max-w-[190px] truncate">{e.ea}</span>
              <span className={e.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{money(e.pnl, true)}</span>
              <span className="text-slate-600">({e.count})</span>
            </button>
          ))}
          <span className="ml-auto font-mono text-[11px] text-slate-500">
            {totals.best != null && (
              <>
                best <span className="text-emerald-400">{money(totals.best, true)}</span> · worst{" "}
                <span className={totals.worst < 0 ? "text-red-400" : "text-emerald-400"}>{money(totals.worst, true)}</span>
              </>
            )}
            {pctOfBalance != null && (
              <>
                {" · "}
                <span className={pctOfBalance >= 0 ? "text-emerald-400/80" : "text-red-400/80"}>
                  {pctOfBalance >= 0 ? "+" : ""}
                  {pctOfBalance.toFixed(2)}% of balance
                </span>
              </>
            )}
          </span>
        </div>

        {/* ── table ──────────────────────────────────────────────────────── */}
        <div className="max-h-[62vh] overflow-auto">
          {list.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-slate-400">No trades were closed on this day.</p>
              <p className="text-[11px] text-slate-600 font-mono mt-1">
                Positions opened here are counted on the day they close.
              </p>
            </div>
          ) : (
            <table className="w-full min-w-[1040px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0F1524]">
                <tr className="border-b border-slate-800">
                  <Th label="#" width={44} />
                  <Th label="Opened" sortKey="openTime" />
                  <Th label="Closed" sortKey="closeTime" />
                  <Th label="Held" sortKey="held" />
                  <Th label="EA" sortKey="ea" />
                  <Th label="Symbol" sortKey="symbol" />
                  <Th label="Side" />
                  <Th label="Lots" sortKey="lots" right />
                  <Th label="Open → Close" right />
                  <Th label="P&L" sortKey="pnl" right />
                </tr>
              </thead>
              <tbody>
                {rows.map((t, i) => {
                  const held = t.heldMs;
                  const tag = (t.exitComment || "").match(/^\s*(s\/l|sl|t\/p|tp)\b/i)?.[1]?.toLowerCase().replace("/", "");
                  return (
                    <tr
                      key={t.id}
                      data-testid={`day-trades-row-${i}`}
                      className="border-b border-slate-800/50 transition-colors hover:bg-slate-800/30"
                    >
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{i + 1}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-300 whitespace-nowrap">{openStamp(t.openTime, t.closeTime)}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        {clock(t.closeTime)}
                        {tag === "sl" && <span className="ml-1.5 border border-red-500/50 px-1 text-[9px] text-red-400">SL</span>}
                        {tag === "tp" && <span className="ml-1.5 border border-emerald-500/50 px-1 text-[9px] text-emerald-400">TP</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-500 whitespace-nowrap">{formatHeld(held)}</td>
                      <td className="px-3 py-2 text-[11px] text-slate-300">
                        <span className="flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 shrink-0" style={{ background: colorOf ? colorOf(t.ri) : REPORT_COLORS[t.ri % REPORT_COLORS.length] }} />
                          <span className="truncate max-w-[210px]" title={t.ea}>{t.ea}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-slate-400 whitespace-nowrap">{t.symbol}</td>
                      <td className="px-3 py-2"><SideBadge side={t.side} /></td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] text-slate-300">{t.lots.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[11px] whitespace-nowrap">
                        {t.incomplete ? (
                          <span className="text-amber-400/80" title="Opened before the reported period">opened earlier</span>
                        ) : (
                          <>
                            <span className="text-slate-400">{price(t.openPrice)}</span>
                            <span className="text-slate-600"> → </span>
                            <span className="text-slate-200">{price(t.closePrice)}</span>
                          </>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono text-xs font-semibold ${t.pnl > 0 ? "text-emerald-400" : t.pnl < 0 ? "text-red-400" : "text-slate-500"}`}>
                        {money(t.pnl, true)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── footer ─────────────────────────────────────────────────────── */}
        <div data-testid="day-trades-footer" className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-5 py-2.5">
          <span className="font-mono text-[11px] text-slate-400">
            {eaFilter != null && (
              <span className="text-slate-500">
                showing {rows.length} of {list.length} ·{" "}
              </span>
            )}
            <span className={totals.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>
              {list.length} closed today ({money(totals.pnl, true)})
            </span>{" "}
            {matches ? (
              <span className="text-slate-500">· matches the calendar cell</span>
            ) : (
              <span className="text-slate-500" title="Positions opened on one day and closed on another move their entry commission between days">
                · calendar cell {money(cell, true)} ({money(diff, true)} is entry commission booked on another day)
              </span>
            )}
          </span>
          <span className="flex items-center gap-3 font-mono text-[10px] text-slate-600">
            {list.some((t) => t.incomplete) && (
              <span className="flex items-center gap-1 text-amber-500/80">
                <Ban className="h-3 w-3" /> some trades opened before the report period
              </span>
            )}
            esc to close
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
};
