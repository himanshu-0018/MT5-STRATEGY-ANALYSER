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
- Trade list tests: `src/lib/trades.test.js` (entry/exit pairing, FIFO for concurrent positions, partial closes, unmatched closes, close-day grouping, and on the real MT5 samples: paired P&L equals the sum of every deal, plus per-day reconciliation with the calendar).
- Tests: `src/lib/riskBrain.test.js` (LP vs random search optimality, homogeneity, budget compliance, verdicts, minimum lot, MC determinism) and `src/lib/sample.integration.test.js` (parses the bundled MT5 samples end to end).

## Backlog
- P1: CSV/PDF export of the lot plan, per-strategy lot locks
- P2: Correlation matrix between strategies, save portfolios
- Done: lot-size multiplier per report + Monte Carlo (Risk Brain)
