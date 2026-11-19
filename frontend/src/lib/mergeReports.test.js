import { buildMergedReport } from "./mergeReports";

const deal = (t, net, extra = {}) => ({ time: t, volume: 0.1, net, isOut: true, symbol: "XAUUSD", ...extra });
const rep = (label, eaExpert, deals, extra = {}) => ({
  id: label, label, expert: label, eaExpert, fileName: "fii_today.html",
  symbol: "XAUUSD", symbols: [{ symbol: "XAUUSD", trades: deals.length }],
  initialDeposit: 10000, deals, ...extra,
});

const T = Date.UTC(2025, 0, 2, 6);

describe("merging strategies into one EA", () => {
  const parts = [
    rep("fii · CG-M5", "CG-M5", [deal(T + 0, 10), deal(T + 4000, -2)]),
    rep("fii · CG-H1", "CG-H1", [deal(T + 1000, 4)]),
    rep("fii · CG-GRID", "CG-GRID", [deal(T + 2000, 7), deal(T + 5000, 1)]),
    rep("fii · CG-SCALP", "CG-SCALP", [deal(T + 3000, -1)]),
  ];

  test("keeps every deal, in time order", () => {
    const m = buildMergedReport(parts, "CG");
    expect(m.deals).toHaveLength(6);
    const times = m.deals.map((d) => d.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(m.deals.reduce((s, d) => s + d.net, 0)).toBe(19);
  });

  test("uses the typed name as the strategy label", () => {
    const m = buildMergedReport(parts, "CG");
    expect(m.expert).toBe("CG");
    expect(m.label).toBe("CG");
    expect(m.eaExpert).toBe("CG");
    expect(m.mergedFrom).toHaveLength(4);
  });

  test("blank name falls back to the file name and joins the EA tags", () => {
    const m = buildMergedReport(parts, "   ");
    expect(m.expert).toBe("fii_today");
    expect(m.eaExpert).toBe("CG-M5 + CG-H1 + CG-GRID + CG-SCALP");
  });

  test("recomputes the symbols of the joined deals", () => {
    const mixed = [
      rep("a", "A", [deal(T, 5, { symbol: "BTCUSD" }), deal(T + 1000, 3, { symbol: "BTCUSD" })]),
      rep("b", "B", [deal(T + 2000, 2, { symbol: "XAUUSD" })]),
    ];
    const m = buildMergedReport(mixed, "AB");
    expect(m.symbols).toEqual([{ symbol: "BTCUSD", trades: 2 }, { symbol: "XAUUSD", trades: 1 }]);
    expect(m.symbol).toBe("BTCUSD + XAUUSD");
  });

  test("needs at least two strategies", () => {
    expect(buildMergedReport([], "x")).toBeNull();
    expect(buildMergedReport([parts[0]], "x")).toBeNull();
  });

  test("keeps the account deposit and the file name", () => {
    const m = buildMergedReport(parts, "CG");
    expect(m.initialDeposit).toBe(10000);
    expect(m.fileName).toBe("fii_today.html");
  });
});
