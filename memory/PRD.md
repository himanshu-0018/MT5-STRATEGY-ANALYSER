# QuantFolio – MT5 Portfolio Analyser

## Problem Statement
StrategyQuant-like analyser: upload multiple MT5 Strategy Tester HTML reports, analyse each separately and show combined: total trades, total profit, profit factor, true chronological max drawdown (deal-by-deal, SL times across reports), combined equity chart, monthly profit.

## User Choices
Browser-only (no saving), single custom starting balance, deal-level DD, no login.

## Architecture
Frontend-only React. `lib/mt5Parser.js` (UTF-16/UTF-8 decode, DOMParser, Deals table), `lib/portfolio.js` (merge, stats, DD walk, monthly, days), `lib/calendar.js` (Monday-first month grid, week rollups, month summary). `lib/simplex.js` + `lib/riskBrain.js` + `lib/insights.js` power the Risk Brain (see below). Sample reports in `public/samples`.

## Implemented (2026-06)
- Multi-file drag/drop upload, per-report table (include toggle, remove), numbers match MT5 report
- Combined KPIs: net profit/ROI, true max DD $ & % with peak/trough timestamps, PF (MT5 convention), trades, win rate
- Combined balance curve + underwater chart, max-DD window deal list
- Monthly profit (bar + per-report matrix), worst days with per-deal timestamps

## Implemented (2026-11)
- Profit Calendar (`components/ProfitCalendar.jsx`): FTMO-style monthly heat grid of daily P&L for the combined portfolio, Monday-first, heat intensity scaled to the month's biggest day
- Days / Weeks toggle: weekly view lists every week of the selected month with days combined (period, trading days, trades, win/loss days, week return + bar, week P&L), expandable into per-day chips
- $ / % toggle per day (day P&L vs. % of the balance at day open), month navigation across the whole uploaded range + month picker, monthly totals strip (net, trading days, trades, best/worst/avg day, win-day rate), click a day to list its deals with timestamps


## Implemented (2026-11) – real-world 344-report batch
First tested with the user's actual export: 344 HTML reports, 728 MB, 170,934 trades, UTF-16, files up to 33 MB with 678k `<td>` cells.
- `mt5Parser` rewritten: `scanReport()` scans the HTML string for the Deals section and stops at the Orders header, so no DOM is built for normal reports (DOM path kept as a fallback). Result: 5.0 s to load all 344 (was: unable to load 50) at 357 MB heap; trade total matches an independent count exactly (170,934).
- Empty exports (deals table present, zero buy/sell rows - e.g. 192.html/199.html) now report "contains no trades (only a deposit, no positions)" instead of a parse error.
- `buildPortfolio`: trade pairing is lazy (only when a calendar day opens), and the equity curve is sampled while walking instead of materialising one object per deal. Toggle at this scale: 504ms -> 246ms; calendar day with 265 trades: 328ms.
- Lot Brain on a 12-report subset of the same files: plan in 0.3 s.

## Implemented (2026-11) – performance + offline desktop build
- **Performance** (500 reports / 90k deals): keystroke latency 390ms -> 67ms, report toggle 549ms -> 225ms, tab switch 113ms -> 26ms, upload+render 5.9s -> 4.2s, DOM nodes 14.8k -> 1.4k.
  - `ReportTable` is virtualised (fixed 62px rows, spacer rows, sticky header, ResizeObserver) and `memo`ised with stable `useCallback` handlers.
  - The starting balance is debounced (220ms) so typing does not rebuild the portfolio per keystroke; `portfolio` still recomputes only on report/enabled/start changes.
  - `buildPortfolio` buckets deals through a cached day/month key map (integer day index) instead of allocating three `Date`s per deal.
  - `mt5Parser` finds the Deals header first and only stringifies the settings rows above it, then uses `row.cells` (with a full-scan fallback when `Initial Deposit` is missing); settings are still read exactly as before (tests assert deal counts and net sums).
- **Desktop (Electron)**: `desktop/` shells the built app over a private `app://` protocol (`main.js`), single-instance lock, external links to the browser, no node integration. `electron-builder` config targets NSIS x64 (Windows), dmg (macOS), AppImage (Linux); packaged app bundles `frontend/build` into the asar at `web/`. GitHub Actions `build-desktop.yml` builds both installers on their native runners (a Windows NSIS build cannot be produced on macOS without Wine).
- **Offline**: fonts (Outfit / JetBrains Mono / IBM Plex Sans) are self-hosted from `src/fonts` with `@font-face` rules; the Google Fonts `@import` and `<link>` are gone, so a production/desktop run makes zero network requests. Page title is `QuantFolio — MT5 Strategy Analyser` with an app icon generated for the installer and favicon.

## Implemented (2026-11) – large uploads, file-name labels, scale guards
- **Upload progress overlay** (`components/UploadProgress.jsx` + `lib/uploadProgress.js`): uploading hundreds of reports used to freeze the page with no feedback. The overlay shows the phase (reading → building portfolio), a percentage, `done / total` files, the file being parsed, an ETA, unreadable-file count and a Cancel button. Progress lives in a tiny pub/sub store (`useSyncExternalStore`) so a tick re-renders only the overlay - putting it in App state would re-render 500 table rows per file. Parsing yields to the browser between files; the "building" bar is transform-animated so it keeps moving while the main thread merges deals. Measured: 500 reports / 35.6 MB parsed in ~4.1 s with a live progress bar.
- **Reports are labelled by their file name**, not the EA name inside the report: `parseMt5Report` now returns `label` (file name without extension) as `expert` (what every table/chart/dropdown shows) and keeps the real `eaExpert` for the subtitle/tooltip (`EA: buster_ea_001`). `reportLabel()` handles paths and extensions.
- **Scale guards found while testing 500 reports**: (a) the sizing model is reports x timestamps, so it is now built lazily only when the Lot Brain tab is opened, cached per report set, and `buildRiskModel` throws `RiskModelTooLargeError` past 2M cells with a card explaining the arithmetic and how many reports fit; (b) the monthly matrix showed one column per report (503 columns at 500 reports) and now shows the best 12 with a summed "+N more" column.

## Implemented (2026-11) – Calendar day trade list
Clicking any day in the Profit Calendar (days grid or a week's day chips) opens `components/DayTradesModal.jsx`, a full trade list for that day: date + weekday, day P&L, closed trades with W/L split, total volume, a "by EA" filter row with per-EA contribution, best/worst trade and % of balance, and a sortable table of #/opened/closed/held/EA/symbol/side/lots/open→close price/P&L. SL/TP tags come from the exit deal comment, and trades opened on an earlier day show the date. Esc, the X and the backdrop all close it, with body scroll locked while open.
`lib/trades.js` pairs the raw deals back into trades (`pairTrades`): a per-report FIFO per symbol matches each "out" deal to the earliest open "in" deal of the opposite side, splits partial closes and allocates entry commission pro rata, and keeps unmatched closes (reversals / positions opened before the report window) flagged as incomplete so the day still reconciles. `tradesByCloseDay` groups them by close day and `buildPortfolio` exposes `trades` + `tradesByDay`. The footer states whether the day matches the calendar cell, or shows the small difference when an entry commission lands on another day.

## Implemented (2026-11) – Risk Brain (position sizing)
Tab `Lot brain` (`components/RiskBrain.jsx`, charts in `components/BrainCharts.jsx`).
- Normalises every report to P&L per 1.00 lot so profit and drawdown scale linearly with lot size; all deals are replayed on one merged timeline (`lib/riskBrain.js`).
- Drawdown is a max of linear functions of the lot vector => convex and homogeneous, so *max profit subject to DD <= budget* is exactly solvable. `maxProfitLots()` runs a cutting-plane loop around a dense simplex (`lib/simplex.js`): solve, measure the true worst window, add it as a constraint, repeat until the LP answer is feasible => provably optimal for that budget.
- Other modes: `uniformLots()` (one multiplier on the original lots, closed form because DD is homogeneous) and `riskParityLots()` (equal risk budget per strategy - cannot breach even if every EA bottoms out together, since DD(sum) <= sum DD_i).
- Drawdown budget in $ or % of starting balance, risk buffer (sizes to a fraction of the budget), per-strategy risk cap (stops the solver piling the budget into one EA), broker lot step / minimum lot, max lots per strategy.
- Lot-step handling: floor to the step, then `refineToStep()` greedily adds one step at a time (exact O(T) drawdown walk per candidate) so leftover budget is used. Nothing below the minimum lot is ever suggested - an EA that cannot be funded at 0.01 is marked DROP, never resized below the broker minimum.
- Per-strategy verdicts: RAISE / CUT / KEEP / DROP with a data-driven reason ("One 0.01 lot takes drawdown to $207.02 - $7.02 over your limit (it would add $381.23 of profit)", "Loses $25,007 per lot", "Your budget only funds 0.005 lots - below the 0.01 minimum").
- Before/after view: net profit, max drawdown, profit per $1 of drawdown and total lots, now vs optimised, plus the "shrink the same book to fit the budget" baseline that the reallocation has to beat.
- Efficient-frontier chart (max profit / uniform / equal risk at the same budget), equity chart at the planned lots vs the original backtest, risk attribution of the worst window (additive, can be negative for hedges).
- Monte Carlo: block bootstrap over the joint calendar-day P&L matrix (all strategies resampled on the same days, so correlation is kept), 400 sims, intraday-adjusted; p50/p90/p95/worst, breach probability, and a "95% safe sizing" button that re-sizes through the risk buffer.
- Copy-plan export (tab separated, includes DO NOT TRADE rows).
- Monthly P&L comparison (`components/MonthlyCompare.jsx`): every month of the backtest re-priced at both the current backtest lots and the recommended lots, as grouped bars plus a table (month, current, optimised, change, change %, mini before/after bars, trades). `mergeMonthly()` in `lib/portfolio.js` lines the two month sets up; the totals reconcile with the before/after hero (verified: sum of monthly = plan profit).
- Trade list tests: `src/lib/trades.test.js` (entry/exit pairing, FIFO for concurrent positions, partial closes, unmatched closes, close-day grouping, and on the real MT5 samples: paired P&L equals the sum of every deal, plus per-day reconciliation with the calendar).
- `src/lib/portfolio.test.js` covers `mergeMonthly` (chronology, one-sided months, sign-safe % change) and monthly totals vs portfolio net.
- Tests: `src/lib/riskBrain.test.js` (LP vs random search optimality, homogeneity, budget compliance, verdicts, minimum lot, MC determinism) and `src/lib/sample.integration.test.js` (parses the bundled MT5 samples end to end).

## Backlog
- P1: CSV/PDF export of the lot plan, per-strategy lot locks
- P2: Correlation matrix between strategies, save portfolios
- Done: lot-size multiplier per report + Monte Carlo (Risk Brain)
