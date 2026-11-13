import { mergeMonthly, buildPortfolio } from "./portfolio";

const m = (key, total, trades = 10) => ({ key, total, trades });

describe("mergeMonthly", () => {
  test("lines two month sets up chronologically", () => {
    const rows = mergeMonthly([m("2024-02", 100), m("2024-01", 50)], [m("2024-01", 75), m("2024-02", 150)]);
    expect(rows.map((r) => r.key)).toEqual(["2024-01", "2024-02"]);
    expect(rows[0]).toMatchObject({ before: 50, after: 75, change: 25, trades: 10 });
    expect(rows[0].changePct).toBeCloseTo(50, 6);
  });

  test("keeps months that only exist on one side", () => {
    const rows = mergeMonthly([m("2024-01", 100)], [m("2024-01", 100), m("2024-02", 40)]);
    expect(rows).toHaveLength(2);
    const feb = rows[1];
    expect(feb).toMatchObject({ before: 0, after: 40, change: 40 });
    expect(feb.changePct).toBeNull(); // nothing to compare against
  });

  test("handles a month that disappears (all strategies dropped)", () => {
    const rows = mergeMonthly([m("2024-03", -25)], []);
    expect(rows[0]).toMatchObject({ key: "2024-03", before: -25, after: 0, change: 25 });
    expect(rows[0].changePct).toBeCloseTo(100, 6);
  });

  test("empty inputs", () => {
    expect(mergeMonthly()).toEqual([]);
    expect(mergeMonthly([], [])).toEqual([]);
  });

  test("percent change is sign-safe for losing months", () => {
    // -100 -> -50 is an improvement of 50 on a -100 base: +50%
    const [row] = mergeMonthly([m("2024-04", -100)], [m("2024-04", -50)]);
    expect(row.change).toBe(50);
    expect(row.changePct).toBeCloseTo(50, 6);
  });
});

describe("portfolio months", () => {
  test("monthly totals add up to the portfolio net", () => {
    const reports = [
      {
        id: "a",
        expert: "A",
        symbol: "XAUUSD",
        initialDeposit: 1000,
        deals: [
          { time: Date.UTC(2024, 0, 5), net: 100, volume: 0.1, isOut: true, symbol: "XAUUSD" },
          { time: Date.UTC(2024, 0, 20), net: -40, volume: 0.1, isOut: true, symbol: "XAUUSD" },
          { time: Date.UTC(2024, 1, 3), net: 60, volume: 0.1, isOut: true, symbol: "XAUUSD" },
        ],
      },
    ];
    const p = buildPortfolio(reports, 1000);
    expect(p.months.map((x) => x.key)).toEqual(["2024-01", "2024-02"]);
    expect(p.months[0].total).toBeCloseTo(60, 6);
    expect(p.months[1].total).toBeCloseTo(60, 6);
    expect(p.months.reduce((s, x) => s + x.total, 0)).toBeCloseTo(p.stats.net, 6);
  });
});
