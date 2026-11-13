import fs from "fs";
import path from "path";
import { parseMt5Report } from "./mt5Parser";
import { pairTrades, tradesByCloseDay } from "./trades";
import { buildPortfolio } from "./portfolio";

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */

let seq = 0;
const deal = (over) => {
  seq += 1;
  const base = {
    time: Date.UTC(2026, 10, 5, 2, 30, 10) + seq * 60000,
    deal: String(seq),
    symbol: "XAUUSD+",
    type: "buy",
    direction: "in",
    volume: 0.01,
    price: 4080.75,
    commission: -0.03,
    swap: 0,
    profit: 0,
    comment: "",
  };
  const d = { ...base, ...over };
  d.net = d.commission + d.swap + d.profit;
  d.isOut = ["out", "in/out", "out by"].includes(d.direction);
  d.time = over.time ?? base.time;
  return d;
};

const report = (deals, expert = "EA One") => ({ expert, deals });

const T0 = Date.UTC(2026, 10, 5, 2, 30, 10);
const MIN = 60000;

/* ------------------------------------------------------------------ */

describe("trade pairing", () => {
  test("pairs one entry with one exit", () => {
    const r = report([
      deal({ time: T0, direction: "in", type: "buy", volume: 0.01, price: 4080.75, commission: -0.03, profit: 0 }),
      deal({ time: T0 + 40 * 1000, direction: "out", type: "sell", volume: 0.01, price: 4092.42, commission: -0.03, profit: 11.52 }),
    ]);
    const [t] = pairTrades([r]);
    expect(t.side).toBe("buy");
    expect(t.lots).toBeCloseTo(0.01, 8);
    expect(t.openTime).toBe(T0);
    expect(t.closeTime).toBe(T0 + 40000);
    expect(t.heldMs).toBe(40000);
    expect(t.openPrice).toBeCloseTo(4080.75, 6);
    expect(t.closePrice).toBeCloseTo(4092.42, 6);
    // entry commission + (exit commission + profit)
    expect(t.pnl).toBeCloseTo(-0.03 + (-0.03 + 11.52), 6);
    expect(t.incomplete).toBe(false);
  });

  test("pairs a sell position and detects a stop-loss comment", () => {
    const r = report([
      deal({ time: T0, direction: "in", type: "sell", volume: 0.01, price: 4080.9, commission: 0 }),
      deal({ time: T0 + MIN, direction: "out", type: "buy", volume: 0.01, price: 4090, commission: 0, profit: -9.1, comment: "sl 4090.00" }),
    ]);
    const [t] = pairTrades([r]);
    expect(t.side).toBe("sell");
    expect(t.pnl).toBeCloseTo(-9.1, 6);
    expect(t.exitComment).toMatch(/sl/);
  });

  test("keeps two concurrent positions apart (FIFO per symbol)", () => {
    const r = report([
      deal({ time: T0 + 0, direction: "in", type: "buy", volume: 0.01, price: 100, commission: 0 }),
      deal({ time: T0 + MIN, direction: "in", type: "buy", volume: 0.01, price: 101, commission: 0 }),
      deal({ time: T0 + 2 * MIN, direction: "out", type: "sell", volume: 0.01, price: 110, commission: 0, profit: 10 }),
      deal({ time: T0 + 3 * MIN, direction: "out", type: "sell", volume: 0.01, price: 120, commission: 0, profit: 19 }),
    ]);
    const trades = pairTrades([r]);
    expect(trades).toHaveLength(2);
    expect(trades[0].openPrice).toBe(100);
    expect(trades[0].pnl).toBeCloseTo(10, 6);
    expect(trades[1].openPrice).toBe(101);
    expect(trades[1].pnl).toBeCloseTo(19, 6);
  });

  test("splits a partial close and allocates entry commission pro rata", () => {
    const r = report([
      deal({ time: T0, direction: "in", type: "buy", volume: 0.10, price: 100, commission: -1.0 }),
      deal({ time: T0 + MIN, direction: "out", type: "sell", volume: 0.05, price: 110, commission: 0, profit: 10 }),
      deal({ time: T0 + 2 * MIN, direction: "out", type: "sell", volume: 0.05, price: 120, commission: 0, profit: 20 }),
    ]);
    const trades = pairTrades([r]);
    expect(trades).toHaveLength(2);
    expect(trades[0].lots).toBeCloseTo(0.05, 8);
    expect(trades[0].pnl).toBeCloseTo(-0.5 + 10, 6);
    expect(trades[1].pnl).toBeCloseTo(-0.5 + 20, 6);
  });

  test("keeps an unmatched close so the day still reconciles", () => {
    const r = report([
      deal({ time: T0, direction: "out", type: "sell", volume: 0.02, price: 4090, commission: 0, profit: 5 }),
    ]);
    const [t] = pairTrades([r]);
    expect(t.incomplete).toBe(true);
    expect(t.openPrice).toBeNull();
    expect(t.pnl).toBeCloseTo(5, 6);
  });

  test("groups trades by the day they closed, not the day they opened", () => {
    const r = report([
      deal({ time: Date.UTC(2026, 10, 4, 23, 0, 0), direction: "in", type: "buy", volume: 0.01, price: 100, commission: -0.1 }),
      deal({ time: Date.UTC(2026, 10, 5, 1, 0, 0), direction: "out", type: "sell", volume: 0.01, price: 110, commission: 0, profit: 10 }),
    ]);
    const trades = pairTrades([r]);
    const byDay = tradesByCloseDay(trades);
    expect(byDay.has("2026-11-04")).toBe(false);
    expect(byDay.get("2026-11-05")).toHaveLength(1);
  });
});

describe("pairing against real MT5 reports", () => {
  const load = (name) => {
    const p = path.join(__dirname, "..", "..", "public", "samples", name);
    const buf = fs.readFileSync(p);
    return parseMt5Report(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), name);
  };
  const reports = [load("dynamic.html"), load("smc.html")];
  const trades = pairTrades(reports);
  const dealNet = reports.reduce((s, r) => s + r.deals.reduce((a, d) => a + d.net, 0), 0);
  const tradeNet = trades.reduce((s, t) => s + t.pnl, 0);

  test("every closing deal becomes exactly one trade row", () => {
    const closes = reports.reduce((s, r) => s + r.deals.filter((d) => d.isOut).length, 0);
    expect(trades.length).toBe(closes);
  });

  test("paired P&L equals the sum of every deal (nothing lost or double counted)", () => {
    expect(tradeNet).toBeCloseTo(dealNet, 4);
  });

  test("trade sides and symbols survive pairing", () => {
    for (const t of trades) {
      expect(["buy", "sell"]).toContain(t.side);
      expect(typeof t.symbol).toBe("string");
      expect(t.lots).toBeGreaterThan(0);
      expect(t.closeTime).toBeGreaterThanOrEqual(t.openTime);
    }
  });

  test("the portfolio exposes per-day trade lists that reconcile with the calendar cell", () => {
    const p = buildPortfolio(reports, 1000);
    let checked = 0;
    for (const day of p.days) {
      const list = p.tradesByDay.get(day.key) || [];
      if (!list.length) continue;
      const closed = list.reduce((s, t) => s + t.pnl, 0);
      // the difference can only be entry commission on positions opened on
      // another day - it must stay tiny relative to the day itself
      expect(Math.abs(day.total - closed)).toBeLessThan(Math.max(5, Math.abs(day.total) * 0.05));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });
});
