/**
 * Turns MT5 deal rows into complete trades.
 *
 * A Strategy Tester report lists *deals*, not trades: an "in" deal opens a
 * position and a later "out" deal closes it (profit/swap on the way out,
 * commission split across both). To show a day's trades the way a trader
 * thinks about them - one row per position, with open and close price, time
 * held and total P&L - the deals have to be paired back up.
 *
 * The pairing is a per-report FIFO per symbol: an "out" deal closes the
 * earliest still-open "in" deal of the opposite side. Partial closes split the
 * entry and allocate its commission pro-rata, so the row totals always add up
 * to exactly what the deal table contains.
 */

const EPS = 1e-9;
const CLOSING = new Set(["out", "in/out", "out by"]);

const opposite = (side) => (side === "buy" ? "sell" : "buy");

/**
 * @param {Array} reports  [{ expert, deals: [...] }] in portfolio order
 * @returns {Array} closed trades sorted by close time
 */
export function pairTrades(reports) {
  const trades = [];
  let seq = 0;

  reports.forEach((r, ri) => {
    const openBySymbol = new Map();
    const deals = [...r.deals].sort((a, b) => a.time - b.time);

    for (const d of deals) {
      const dir = String(d.direction || "").toLowerCase();
      const symbol = d.symbol || "—";
      const volume = d.volume > 0 ? d.volume : 0;

      if (dir === "in") {
        if (!(volume > 0)) continue;
        const queue = openBySymbol.get(symbol) || [];
        queue.push({
          side: d.type,
          time: d.time,
          price: d.price,
          volume,
          remaining: volume,
          net: d.net || 0,
          ea: r.expert,
          ri,
        });
        openBySymbol.set(symbol, queue);
        continue;
      }

      if (!CLOSING.has(dir)) continue;

      const queue = openBySymbol.get(symbol) || [];
      const positionSide = opposite(d.type);
      let remaining = volume;
      let matched = 0;

      while (remaining > EPS) {
        const idx = queue.findIndex((e) => e.side === positionSide && e.remaining > EPS);
        if (idx < 0) break;
        const entry = queue[idx];
        const v = Math.min(entry.remaining, remaining);
        trades.push(makeTrade(r, ri, symbol, entry, d, v, volume, seq++));
        entry.remaining -= v;
        remaining -= v;
        matched += v;
        if (entry.remaining <= EPS) queue.splice(idx, 1);
      }

      // A close with nothing to close against: a reversal leg ("in/out") or a
      // position opened before the report period. Keep it so the day's total
      // still reconciles with the deal table, just without an open price.
      if (remaining > EPS) {
        trades.push(makeTrade(r, ri, symbol, null, d, remaining, volume, seq++));
      }
      openBySymbol.set(symbol, queue);
    }
  });

  trades.sort((a, b) => a.closeTime - b.closeTime || a.id.localeCompare(b.id));
  return trades;
}

function makeTrade(report, ri, symbol, entry, exit, lots, exitVolume, seq) {
  const entryNet = entry && entry.volume > 0 ? (entry.net * lots) / entry.volume : 0;
  const exitShare = exitVolume > 0 ? lots / exitVolume : 1;
  const exitNet = (exit.net || 0) * exitShare;
  const comment = exit.comment || "";
  return {
    id: `t${seq}`,
    ri,
    ea: entry?.ea ?? report.expert,
    symbol,
    side: entry?.side ?? opposite(exit.type),
    lots,
    openTime: entry?.time ?? null,
    openPrice: entry?.price ?? null,
    closeTime: exit.time,
    closePrice: exit.price,
    heldMs: entry ? exit.time - entry.time : null,
    exitComment: comment,
    pnl: entryNet + exitNet,
    incomplete: !entry,
  };
}

/** Group closed trades by the calendar day they were closed on (UTC). */
export function tradesByCloseDay(trades) {
  const map = new Map();
  for (const t of trades) {
    const d = new Date(t.closeTime);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    const list = map.get(key);
    if (list) list.push(t);
    else map.set(key, [t]);
  }
  return map;
}
