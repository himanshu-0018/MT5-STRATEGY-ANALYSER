# QuantFolio — MT5 Strategy Analyser

Upload any number of **MT5 Strategy Tester reports** and analyse them as one book: a true combined
drawdown, an equity curve built deal-by-deal, and a **position-sizing optimiser** that tells you the
maximum lot size for every strategy — and which strategies to stop trading — while keeping your
drawdown under a limit you choose.

Everything runs **in the browser**. Reports are parsed locally; nothing is uploaded anywhere.

![Lot Brain sizing a ten-strategy book](docs/lot-brain.png)

<sub>Lot Brain with a $200 drawdown budget over a ten-strategy book (synthetic demo data).</sub>

---

## Why this exists

Combining backtests is easy; knowing **how big to trade them** is not. Every MT5 report is produced at
one fixed lot size, and fixed-lot P&L is linear in lot size — double the lot and every win, loss,
commission and dollar of drawdown doubles with it.

That single property is enough to answer the sizing question **exactly**:

> *"I can bear $200 of drawdown. What is the largest lot size for each of my 10 EAs such that the
> combined book never draws down more than $200?"*

## Two upload modes

Chosen **before** you upload, in the uploader card:

| Mode | Use it when |
|---|---|
| **One file per EA** | Each Strategy Tester export is its own strategy (the normal case). Every file becomes one row, labelled with the file name. |
| **Files hold several EAs** | A single file contains trades from many EAs - e.g. an account statement or merged history. |

The **symbol** shown for each strategy is derived from the deals it actually
traded, not from the report header (an EA launched on BTCUSD can still trade
XAUUSD): a single symbol is shown as-is, two as `BTCUSD + XAUUSD`, and more as
`BTCUSD +2` with the full breakdown in the tooltip.

In the second mode the Deals table is split into one strategy per EA: the EA tag
comes from each trade's **entry** comment (its exits inherit it, since they
usually just say `sl 4092.42`), a **Magic** column wins when the export has one,
untagged deals join the dominant group, and a split only happens when at least
two EAs each have a meaningful number of trades - so a normal single-EA report is
never chopped up. Each resulting strategy gets its own row (`statement · Grid-B`),
its own drawdown and its own lot size in the Lot Brain.

Splitting can over-split - one EA may label its trades with four different
comments (`CG-M5`, `CG-H1`, `CG-GRID`, `CG-SCALP`). Click **Merge strategies**,
tick the rows that belong to the same EA, type its name and they are joined back
into one strategy (deals merged on one timeline, nothing lost).

## Two views

### Portfolio
- Per-report table: trades, net profit, profit factor, win rate, own max DD (include/exclude any report)
- Combined KPIs with the real peak/trough timestamps
- Combined balance curve + underwater chart, worst-drawdown window with every deal
- FTMO-style profit calendar (days/weeks, $ or % of balance), monthly matrix and worst-day rankings
- Click any calendar day for the **full trade list**: open/close time and price, time held, EA, side,
  lots, P&L per trade, SL/TP tags, a by-EA filter and the day's best/worst trade. Deals are paired
  back into trades (FIFO per symbol, partial closes split, commissions allocated pro rata) so the
  list reconciles exactly with the calendar cell

### Lot Brain — position sizing optimiser
- **Drawdown budget** in $ or % of the account, optional risk buffer, per-strategy risk cap
  (default: no single EA may draw down more than the whole budget on its own), broker lot step /
  minimum lot, max lots per strategy
- **Per-strategy verdict: `RAISE` / `CUT` / `KEEP` / `DROP`**, each with a numeric reason, e.g.
  *"One 0.01 lot takes drawdown to $207.02 — $7.02 over your limit (it would add $381.23 of profit)"*
- **Before vs after**: net profit, max drawdown, profit per $1 of drawdown and total lots — now vs
  optimised — including the "shrink the same book until it fits" baseline the reallocation has to beat
- Nothing below the broker minimum lot is ever suggested: a strategy that cannot be funded at
  0.01 lots is marked **DROP**, never resized below the minimum
- **Month-by-month P&L**, current lots vs recommended lots, as grouped bars and a table with the
  change and % change per month (totals reconcile with the headline before/after)
- **Risk attribution** of the worst window (additive; negative = a strategy that hedges the book)
- **Efficient frontier** comparing max-profit, uniform-scale and equal-risk sizing at the same budget
- **Monte Carlo** block bootstrap over the joint daily P&L (400 reshuffled histories, all strategies
  resampled on the same days so correlation is preserved): p50/p90/p95/worst, probability of
  breaching the budget, and a one-click "95% safe sizing"
- Copy the whole plan to the clipboard, ready to configure in MT5

## How the optimiser works

1. **Normalise** — every deal is divided by its own lot, so each report becomes P&L per `1.00` lot.
2. **Merge** — all normalised deals are replayed on one timeline, to the second.
3. **Solve** — for a lot vector `w`, equity is `start + Σ wᵢ·Cᵢ(t)`, so drawdown is
   `max_{s≤t} Σ wᵢ·(Cᵢ(s) − Cᵢ(t))` — a **max of linear functions**, i.e. convex and positively
   homogeneous. *Maximise profit subject to DD ≤ budget* is therefore a linear program. A
   cutting-plane loop solves the LP over the windows found so far, measures the true drawdown of that
   answer, adds the violated window as a new constraint and repeats until the LP solution is feasible
   — at which point it is **provably optimal** for that budget.
4. **Respect the broker** — the continuous optimum is floored to the lot step, then a greedy step
   refinement spends the leftover budget one lot step at a time (checked with an exact O(T) drawdown walk).
5. **Stress** — the plan is re-run through the block bootstrap to see how often the budget would have
   been breached on a different ordering of the same history.

Because drawdown is homogeneous, the optimal allocation is a single direction in lot space: your
budget only scales the size. That is also why the efficient frontier is a set of straight lines and
why "equal risk" or "scale everything by the same multiplier" are just different slopes.

## Desktop app (fully offline)

The same app runs as a desktop application - no browser, no server, no internet.

```bash
cd frontend && yarn install && yarn build     # produces frontend/build
cd ../desktop && npm install && npm start     # runs it in an Electron window
```

### Building the installers

Run these on the matching OS (a Windows `.exe` cannot be produced on macOS):

| Target | Command (inside `desktop/`) | Output |
|---|---|---|
| Windows `.exe` installer | `npm run dist:win` | `release/QuantFolio-Setup-1.0.0.exe` |
| Windows portable folder | `npx electron-builder --win --dir` | `release/win-unpacked/QuantFolio.exe` |
| macOS `.dmg` | `npm run dist:mac` | `release/QuantFolio-1.0.0.dmg` |

Prerequisites on the Windows PC: [Node.js 20+](https://nodejs.org) and
[Yarn 1](https://classic.yarnpkg.com) (`npm i -g yarn`). Then:

```powershell
cd frontend
yarn install
yarn build
cd ..\desktop
npm install
npm run dist:win
```

`desktop/windows-installer.workflow.yml` is the same build as a GitHub Actions
workflow - copy it to `.github/workflows/build-desktop.yml` if you ever want CI
to produce the installer instead (adding it needs a token with the `workflow`
scope).

The shell (`desktop/main.js`) serves the built app over a private `app://`
protocol instead of opening a port - every absolute path (`/static/...`,
`/samples/...`) keeps working, there is no firewall prompt, and nothing is
requested from the network: fonts are self-hosted in `frontend/src/fonts`.

## Performance

Measured on a **real 344-report batch** (728 MB of MT5 HTML, 170,934 trades,
files up to 33 MB / 678,000 table cells each):

| | |
|---|---|
| Upload + parse + first render | **5.0 s** |
| JS heap after load | 357 MB |
| Keystroke in start balance | 80 ms |
| Toggle a report on/off | 246 ms |
| Switch Portfolio ↔ Lot Brain | 29 ms |
| Open a calendar day (265 trades) | 328 ms |
| Lot Brain on a 12-report subset | 0.3 s |

How it stays fast:

- **The parser never builds a DOM.** MT5 exports are UTF-16 HTML where a single
  file can hold 678k `<td>` cells; `DOMParser` on that is ~1 GB and seconds of
  blocking work per file. `scanReport()` instead walks the string, reads only the
  Deals section and stops before the Orders table (which is usually most of the
  file). DOM parsing remains only as a fallback for unusual layouts.
- **The monthly matrix is the classic layout**: months down the left, one
  column per strategy across, in a full-width section. Every strategy gets its
  own column (no "+N more" cap) and the month column stays pinned when a big
  book needs to scroll sideways.
- **The report list is virtualised** - 342 rows cost ~1.4k DOM nodes, not 5k cells.
- **Typing is debounced** (220 ms) so the portfolio is not rebuilt per keystroke.
- **Month/day buckets** reuse cached keys instead of allocating a `Date` per deal.
- **Trade pairing is lazy** - deals are paired only when a calendar day is opened.
- **The equity curve is sampled** while walking (the chart only draws ~2,500 points).
- **The Lot Brain sizes the whole book.** The model is sparse (one entry per
  deal, not a reports x timestamps matrix), the cutting-plane LP is scaled and
  prunes slack constraints, and the solved direction is cached - so a **342
  report book** sizes in ~10 s and changing the budget afterwards takes ~1 s
  (the LP vertex is budget-independent, so it is rescaled instead of re-solved).

## Quick start

```bash
cd frontend
yarn install
yarn start          # http://localhost:3000
```

Load the two bundled sample reports with **Load sample reports**, or drop your own `.html` / `.htm`
exports from `View → Strategy Tester → Report → Save as HTML`.

Then open the **Lot brain** tab, type the maximum drawdown you can bear, and read the plan.

### Tests

```bash
cd frontend
CI=true yarn test --watchAll=false
```

29 tests cover the optimiser (LP result vs a random-search optimum, drawdown homogeneity, budget
compliance, minimum-lot handling, verdicts, Monte Carlo determinism) and an end-to-end parse of the
bundled MT5 reports.

## Project structure

```
frontend/src
├── lib
│   ├── mt5Parser.js    # UTF-16/UTF-8 decode, DOMParser, Deals table → trades
│   ├── portfolio.js    # merge all reports, stats, drawdown walk, months, days
│   ├── calendar.js     # Monday-first month grid, week rollups
│   ├── simplex.js      # dense primal simplex solver
│   ├── riskBrain.js    # normalisation, drawdown evaluation, optimisers, Monte Carlo
│   └── insights.js     # plain-English analysis of the optimiser output
├── components
│   ├── RiskBrain.jsx   # the Lot Brain tab (controls, plan, verdicts, insights)
│   ├── BrainCharts.jsx # equity, frontier and Monte Carlo charts
│   └── …               # portfolio tables, charts, uploader
└── App.js              # tab shell: Portfolio | Lot Brain
```

`backend/` is an optional FastAPI stub from the original scaffold; the app is frontend-only.

## Limitations

The linear-scaling assumption holds for **fixed-lot** strategies. It does **not** hold for
compounding, martingale or equity-based sizing. Spread widening, slippage, swap, margin calls and
each broker's maximum lot per order are not modelled.

The drawdown shown is the worst peak-to-trough dip *in the backtested period*. The Monte Carlo gives
a distribution around it. Neither guarantees the future — size so that a bad streak is survivable.
