import { normaliseEaTag, splitDealsByEa } from "./eaSplit";
import { parseMt5Reports } from "./mt5Parser";

const fmt = (t) => { const d = new Date(t); const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth()+1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`; };

// one Deals table, several EAs, exits carrying "sl ..." instead of the EA tag
function multiEaFile(eas) {
  const rows = [];
  let t = Date.UTC(2025, 0, 2, 6, 0, 0);
  let n = 1;
  const plan = [];
  eas.forEach((ea, i) => { for (let k = 0; k < ea.trades; k++) plan.push({ ea: ea.tag, i, k }); });
  for (let idx = 0; idx < plan.length; idx++) {
    const { ea } = plan[idx];
    t += 20 * 60000;
    rows.push(`<tr><td>${fmt(t)}</td><td>${n++}</td><td>XAUUSD</td><td>buy</td><td>in</td><td>0.10</td><td>2000.00</td><td>${n}</td><td>-0.07</td><td>0.00</td><td>0.00</td><td>10000.00</td><td>${ea}</td></tr>`);
    t += 15 * 60000;
    const win = idx % 2 === 0;
    const pnl = (win ? 12 : -8) + plan[idx].i * 3;
    rows.push(`<tr><td>${fmt(t)}</td><td>${n++}</td><td>XAUUSD</td><td>sell</td><td>out</td><td>0.10</td><td>2010.00</td><td>${n}</td><td>-0.07</td><td>0.00</td><td>${pnl.toFixed(2)}</td><td>10004.00</td><td>${win ? "tp 2010.00" : "sl 1990.00"}</td></tr>`);
  }
  return `<html><body><table>
<tr><td>Expert:</td><td>Account History</td></tr>
<tr><td>Symbol:</td><td>XAUUSD</td></tr>
<tr><td>Period:</td><td>M15 (2025.01.01 - 2025.12.31)</td></tr>
<tr><td>Initial Deposit:</td><td>10 000.00</td></tr>
<th><b>Deals</b></th>
<tr><td><b>Time</b></td><td><b>Deal</b></td><td><b>Symbol</b></td><td><b>Type</b></td><td><b>Direction</b></td><td><b>Volume</b></td><td><b>Price</b></td><td><b>Order</b></td><td><b>Commission</b></td><td><b>Swap</b></td><td><b>Profit</b></td><td><b>Balance</b></td><td><b>Comment</b></td></tr>
${rows.join("\n")}
</table></body></html>`;
}

const buf = (html) => { const b = Buffer.from(html, "utf8"); const c = new Uint8Array(b.length); c.set(b); return c.buffer; };

describe("EA tag normalisation", () => {
  test("keeps the tag, drops the trade marker and its price", () => {
    expect(normaliseEaTag("XAUUSD D1 SR 11")).toBe("XAUUSD D1 SR 11");
    expect(normaliseEaTag("XAUUSD D1 SR 11 sl 4577.20")).toBe("XAUUSD D1 SR 11");
    expect(normaliseEaTag("Grid-B tp 2010.00")).toBe("Grid-B");
    expect(normaliseEaTag("sl 1990.00")).toBe("");
    expect(normaliseEaTag("[tp 1990.0]")).toBe("");
    expect(normaliseEaTag("")).toBe("");
  });
});

describe("splitting one file into several EAs", () => {
  test("finds each EA and gives the exits to their own entry", () => {
    const html = multiEaFile([{ tag: "Scalper-A", trades: 10 }, { tag: "Grid-B", trades: 8 }, { tag: "Trend-C", trades: 6 }]);
    const reports = parseMt5Reports(buf(html), "statement.html", { splitByEa: true });
    expect(reports).toHaveLength(3);
    expect(reports.map((r) => r.eaExpert)).toEqual(["Scalper-A", "Grid-B", "Trend-C"]);
    expect(reports.map((r) => r.deals.length)).toEqual([20, 16, 12]);
    expect(reports[0].expert).toBe("statement.html · Scalper-A".replace(".html", ""));
    expect(reports.every((r) => r.fileName === "statement.html")).toBe(true);
  });

  test("does not split when the file really is one EA", () => {
    const html = multiEaFile([{ tag: "OnlyOne", trades: 12 }]);
    expect(parseMt5Reports(buf(html), "one.html", { splitByEa: true })).toHaveLength(1);
  });

  test("does not split when comments are empty", () => {
    const html = multiEaFile([{ tag: "", trades: 20 }]);
    expect(parseMt5Reports(buf(html), "blank.html", { splitByEa: true })).toHaveLength(1);
  });

  test("ignores a one-off comment typo (tiny second group)", () => {
    const html = multiEaFile([{ tag: "MainEA", trades: 40 }, { tag: "Typo", trades: 1 }]);
    expect(parseMt5Reports(buf(html), "typo.html", { splitByEa: true })).toHaveLength(1);
  });

  test("per-EA mode never splits, even when the file has many EAs", () => {
    const html = multiEaFile([{ tag: "A", trades: 6 }, { tag: "B", trades: 6 }]);
    expect(parseMt5Reports(buf(html), "m.html", { splitByEa: false })).toHaveLength(1);
  });

  test("each split strategy keeps its own trades and pnl", () => {
    const html = multiEaFile([{ tag: "A", trades: 6 }, { tag: "B", trades: 6 }]);
    const [a, b] = parseMt5Reports(buf(html), "m.html", { splitByEa: true });
    const netA = a.deals.reduce((s, d) => s + d.net, 0);
    const netB = b.deals.reduce((s, d) => s + d.net, 0);
    expect(netA).not.toBe(netB);
    expect(splitDealsByEa([...a.deals, ...b.deals])).toHaveLength(2);
  });
});
