import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "@/App.css";
import { Toaster, toast } from "sonner";
import { FlaskConical, Eraser, LayoutDashboard, BrainCircuit, Loader2, AlertTriangle } from "lucide-react";
import { parseMt5Report, parseMt5Reports } from "./lib/mt5Parser";
import { buildPortfolio, reportSummary, REPORT_COLORS } from "./lib/portfolio";
import { buildRiskModel, buildPlan, RiskModelTooLargeError } from "./lib/riskBrain";
import { Uploader } from "./components/Uploader";
import { KpiGrid } from "./components/KpiGrid";
import { EquityChart } from "./components/EquityChart";
import { ReportTable } from "./components/ReportTable";
import { MonthlyTable } from "./components/MonthlyTable";
import { WorstDays, DrawdownWindow } from "./components/WorstDays";
import { ProfitCalendar } from "./components/ProfitCalendar";
import { RiskBrain } from "./components/RiskBrain";
import { UploadProgressHost } from "./components/UploadProgress";
import { uploadProgress } from "./lib/uploadProgress";

const yieldToBrowser = () => new Promise((r) => setTimeout(r, 0));

const SAMPLES = ["dynamic.html", "smc.html"];

const TABS = [
  { key: "portfolio", label: "Portfolio", icon: LayoutDashboard, hint: "Merged equity, drawdown and monthly breakdown" },
  { key: "brain", label: "Lot brain", icon: BrainCircuit, hint: "Maximum lot size per strategy inside a drawdown budget" },
];

function App() {
  const [reports, setReports] = useState([]);
  const [enabled, setEnabled] = useState({});
  const [balance, setBalance] = useState("1000");
  const [tab, setTab] = useState("portfolio");
  // "per-ea": every file is one strategy. "multi": one file may hold several
  // EAs, which are split into separate strategies by magic number / comment.
  const [uploadMode, setUploadMode] = useState("per-ea");

  const addParsed = (parsed) => {
    if (!parsed.length) return;
    setReports((r) => [...r, ...parsed]);
    setEnabled((e) => ({ ...e, ...Object.fromEntries(parsed.map((p) => [p.id, true])) }));
    toast.success(`${parsed.length} report${parsed.length > 1 ? "s" : ""} analysed`);
  };

  const handleFiles = async (files) => {
    const list = Array.from(files || []);
    if (!list.length) return;
    const parsed = [];
    let failed = 0;
    let firstError = "";
    let splitFiles = 0;
    let splitStrategies = 0;
    uploadProgress.start(list.length);
    let cancelled = false;
    try {
      for (let i = 0; i < list.length; i++) {
        if (uploadProgress.isCancelled()) { cancelled = true; break; }
        const f = list[i];
        uploadProgress.update({ current: f.name, phase: "parsing" });
        await yieldToBrowser(); // let the overlay paint before the parse blocks the thread
        try {
          const parts = parseMt5Reports(await f.arrayBuffer(), f.name, { splitByEa: uploadMode === "multi" });
          if (parts.length > 1) { splitFiles += 1; splitStrategies += parts.length; }
          for (const p of parts) parsed.push(p);
        } catch (err) {
          failed += 1;
          if (!firstError) firstError = `${f.name}: ${err.message}`;
        }
        uploadProgress.update({ done: i + 1, failed });
        if (i % 6 === 5) await yieldToBrowser();
      }

      if (parsed.length) {
        uploadProgress.setPhase("building");
        await yieldToBrowser();
        addParsed(parsed); // heavy: merges every deal into the portfolio
        await yieldToBrowser();
      }
    } finally {
      uploadProgress.finish();
    }
    if (failed) toast.error(`${failed} file${failed === 1 ? "" : "s"} could not be read${firstError ? ` — ${firstError}` : ""}`);
    if (splitFiles) {
      toast.success(`${splitFiles} file${splitFiles === 1 ? "" : "s"} contained several EAs - split into ${splitStrategies} strategies`);
    }
    if (cancelled) toast(`Cancelled - kept ${parsed.length} report${parsed.length === 1 ? "" : "s"}`);
  };

  const loadSamples = async () => {
    const out = [];
    for (const s of SAMPLES) {
      const buf = await (await fetch(`/samples/${s}`)).arrayBuffer();
      out.push(parseMt5Report(buf, s));
    }
    addParsed(out);
  };

  const summaries = useMemo(() => Object.fromEntries(reports.map((r) => [r.id, reportSummary(r)])), [reports]);
  const colorIdx = Object.fromEntries(reports.map((r, i) => [r.id, i]));
  const active = reports.filter((r) => enabled[r.id]).map((r) => ({ ...r, ci: colorIdx[r.id] }));
  // Typing in the balance field used to rebuild the whole portfolio on every
  // keystroke (~400 ms at 500 reports). Keep the input instant and settle the
  // computed balance shortly after the user stops typing.
  const [start, setStart] = useState(parseFloat(balance) || 0);
  useEffect(() => {
    const v = parseFloat(balance) || 0;
    const h = setTimeout(() => setStart(v), 220);
    return () => clearTimeout(h);
  }, [balance]);
  const portfolio = useMemo(() => (active.length ? buildPortfolio(active, start) : null), [reports, enabled, start]); // eslint-disable-line react-hooks/exhaustive-deps
  // The sizing model is a T x EAs matrix of cumulative P&L, so building it for
  // hundreds of reports is expensive. Only do it when the brain is actually on
  // screen, and cache it until the report set changes.
  const [riskModel, setRiskModel] = useState(null);
  const [brainBusy, setBrainBusy] = useState(false);
  const [modelError, setModelError] = useState(null);
  const modelCache = useRef({ key: null, model: null });
  const activeKey = active.map((r) => r.id).join("|");
  useEffect(() => {
    if (tab !== "brain" || !active.length) { setRiskModel(null); setBrainBusy(false); return; }
    if (modelCache.current.key === activeKey) { setRiskModel(modelCache.current.model); setBrainBusy(false); return; }
    setBrainBusy(true);
    setModelError(null);
    const h = setTimeout(() => {
      try {
        const m = buildRiskModel(active);
        modelCache.current = { key: activeKey, model: m };
        // Warm the solver with the default settings so the first render of the
        // brain is a cache hit instead of a multi-second freeze.
        try { buildPlan(m, { budget: 200, mode: "maxprofit", safety: 1, lotStep: 0.01, maxLot: 100 }); } catch (e) { /* optional */ }
        setRiskModel(m);
      } catch (err) {
        if (err instanceof RiskModelTooLargeError) setModelError(err.info);
        else setModelError({ message: err.message });
      } finally {
        setBrainBusy(false);
      }
    }, 40);
    return () => clearTimeout(h);
  }, [tab, activeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const colorOf = useCallback((ri) => REPORT_COLORS[(active[ri]?.ci ?? 0) % REPORT_COLORS.length], [activeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // stable handlers keep the memoised report table from re-rendering
  const toggleReport = useCallback((id) => setEnabled((e) => ({ ...e, [id]: !e[id] })), []);
  const removeReport = useCallback((id) => setReports((r) => r.filter((x) => x.id !== id)), []);

  return (
    <div className="qf-app min-h-screen">
      <Toaster theme="dark" position="bottom-right" />
      <UploadProgressHost />
      <header data-testid="header-bar" className="sticky top-0 z-30 border-b border-slate-800 bg-[#0B0F19]/80 backdrop-blur-lg">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-wrap items-center gap-4">
          <div className="flex items-baseline gap-3 mr-auto">
            <span className="font-heading text-lg font-bold tracking-[0.2em] text-slate-50">QUANTFOLIO</span>
            <span className="qf-label hidden sm:inline">MT5 Portfolio Analyser</span>
          </div>
          <label className="flex items-center gap-2">
            <span className="qf-label">Start balance $</span>
            <input data-testid="portfolio-starting-balance-input" type="number" min="0" value={balance} onChange={(e) => setBalance(e.target.value)}
              className="w-28 bg-slate-900 border border-slate-700 px-2 py-1.5 font-mono text-sm text-slate-100 focus:outline-none focus:border-cyan-400" />
          </label>
          <button data-testid="load-sample-data-button" onClick={loadSamples}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono border border-slate-700 text-slate-300 hover:border-cyan-400 hover:text-cyan-300 transition-colors">
            <FlaskConical className="h-3.5 w-3.5" /> Load sample reports
          </button>
          {reports.length > 0 && (
            <button data-testid="clear-all-reports-button" onClick={() => { setReports([]); setEnabled({}); setTab("portfolio"); }}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono border border-slate-700 text-slate-400 hover:border-red-400 hover:text-red-300 transition-colors">
              <Eraser className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
        {reports.length > 0 && (
          <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 flex gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  data-testid={`tab-${t.key}`}
                  title={t.hint}
                  onClick={() => setTab(t.key)}
                  className={`relative flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono uppercase tracking-[0.16em] transition-colors ${on ? "text-cyan-300" : "text-slate-500 hover:text-slate-300"}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {t.label}
                  {on && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-cyan-400" />}
                </button>
              );
            })}
            <span className="ml-auto self-center qf-label hidden md:inline">
              {active.length} of {reports.length} reports active
            </span>
          </div>
        )}
      </header>

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {reports.length === 0 ? (
          <section className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center pt-10">
            <div className="qf-rise">
              <p className="qf-label text-cyan-400 mb-4">Portfolio backtest merger</p>
              <h1 className="font-heading text-4xl sm:text-5xl lg:text-6xl font-bold text-slate-50 leading-[1.05]">
                Combine MT5 backtests.<br /><span className="text-slate-500">See the real drawdown.</span>
              </h1>
              <p className="text-sm sm:text-base text-slate-400 mt-6 max-w-xl leading-relaxed">
                Upload any number of Strategy Tester reports. Every deal from every strategy is replayed on one timeline —
                to the second — so when three systems hit stop-loss on the same afternoon, your drawdown shows it.
              </p>
              <p className="text-xs sm:text-sm text-slate-500 mt-4 max-w-xl leading-relaxed">
                Then open <span className="text-cyan-400">Lot brain</span>: tell it the maximum drawdown you can stomach and it
                returns the lot size for every strategy that maximises profit inside that limit.
              </p>
            </div>
            <div className="qf-rise" style={{ animationDelay: "120ms" }}>
            <Uploader onFiles={handleFiles} mode={uploadMode} onModeChange={setUploadMode} />
          </div>
          </section>
        ) : (
          <>
            <Uploader onFiles={handleFiles} compact mode={uploadMode} onModeChange={setUploadMode} />
            <ReportTable reports={reports} summaries={summaries} enabled={enabled}
              onToggle={toggleReport}
              onRemove={removeReport} />
            {tab === "brain" ? (
              active.length ? (
                modelError ? (
                  <div data-testid="brain-too-large" className="qf-card border-l-2 border-l-amber-400 p-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <div>
                        <h2 className="font-heading text-base font-semibold text-slate-100">
                          {modelError.reports ? "Too many reports to size at once" : "Could not build the sizing model"}
                        </h2>
                        {modelError.reports ? (
                          <>
                            <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                              This book has{" "}
                              <span className="font-mono text-slate-200">{modelError.reports.toLocaleString()} reports ·{" "}
                              {modelError.events.toLocaleString()} deals</span>
                              {modelError.events > modelError.maxEvents
                                ? ` - past the ${modelError.maxEvents.toLocaleString()}-deal ceiling for one sizing pass.`
                                : ` - past the ${modelError.maxReports.toLocaleString()}-report ceiling for one sizing pass.`}
                            </p>
                            <p className="mt-2 text-xs leading-relaxed text-slate-400">
                              Turn some reports off in the <span className="text-slate-200">Use</span> column above - the plan then
                              builds right away. In practice this is only reached by a book far larger than anyone trades at once.
                            </p>
                          </>
                        ) : (
                          <p className="mt-1.5 text-xs text-slate-400">{modelError.message}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ) : riskModel && !brainBusy ? (
                  <RiskBrain model={riskModel} start={start} baselinePortfolio={portfolio} />
                ) : (
                  <div data-testid="brain-preparing" className="qf-card qf-rise flex items-center gap-3 p-6">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                    <div>
                      <div className="text-sm text-slate-200">Preparing the sizing model</div>
                      <div className="qf-label mt-0.5">
                        {active.length} report{active.length === 1 ? "" : "s"} · normalising every deal to P&amp;L per lot
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <p data-testid="no-active-reports-brain" className="text-sm text-slate-500">Enable at least one report to size the book.</p>
              )
            ) : portfolio ? (
              <>
                <KpiGrid p={portfolio} activeCount={active.length} />
                <EquityChart p={portfolio} />
                <DrawdownWindow p={portfolio} colorOf={colorOf} />
                <ProfitCalendar p={portfolio} colorOf={colorOf} />
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
                  <MonthlyTable p={portfolio} reports={active} />
                  <WorstDays p={portfolio} colorOf={colorOf} />
                </div>
              </>
            ) : (
              <p data-testid="no-active-reports" className="text-sm text-slate-500">Enable at least one report to see the combined portfolio.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default App;
