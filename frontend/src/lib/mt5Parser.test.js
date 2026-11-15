import { parseMt5Report, reportLabel } from "./mt5Parser";

/* Build a report the way MT5 exports it: settings rows, a Deals table, then a
   much larger Orders table that must never be read as deals. */
function makeReport({ deals = 5, orders = 40, expert = "BusterEA", symbol = "XAUUSD", empty = false } = {}) {
  const rows = [];
  let t = Date.UTC(2025, 0, 2, 6, 0, 0);
  for (let i = 0; i < deals; i++) {
    t += 90 * 60000;
    rows.push(
      `<tr bgcolor="#FFFFFF" align=right><td>${fmt(t)}</td><td>${i * 2 + 2}</td><td>${symbol}</td><td>buy</td><td>in</td><td>0.10</td><td>2000.00</td><td>${i * 2 + 2}</td><td>-0.07</td><td>0.00</td><td>0.00</td><td>10000.00</td><td>${expert}</td></tr>`,
    );
    t += 30 * 60000;
    rows.push(
      `<tr bgcolor="#F7F7F7" align=right><td>${fmt(t)}</td><td>${i * 2 + 3}</td><td>${symbol}</td><td>sell</td><td>out</td><td>0.10</td><td>2010.00</td><td>${i * 2 + 3}</td><td>-0.07</td><td>0.00</td><td>${(10 + i).toFixed(2)}</td><td>${(10010 + i).toFixed(2)}</td><td>tp 2010.00</td></tr>`,
    );
  }
  const orderRows = [];
  for (let j = 0; j < orders; j++) {
    orderRows.push(
      `<tr bgcolor="#FFFFFF" align=right><td>${fmt(t - j * 60000)}</td><td>${j + 1}</td><td>${symbol}</td><td>buy limit</td><td colspan="2">0.10 / 0.10</td><td>1999.00</td><td>1990.00</td><td>2020.00</td><td colspan="2">${fmt(t)}</td><td>filled</td><td>${expert}</td></tr>`,
    );
  }
  const body = empty
    ? `<tr bgcolor="#FFFFFF" align=right><td>2025.01.02 06:00:00</td><td>1</td><td></td><td>balance</td><td></td><td></td><td></td><td></td><td>0.00</td><td>0.00</td><td>10 000.00</td><td>10 000.00</td><td></td></tr>`
    : rows.join("\n");

  return `<!DOCTYPE html><html><body><div align="center"><table cellspacing="1" cellpadding="3" border="0">
<tr align="center"><td colspan="13"><div><b>Strategy Tester Report</b></div></td></tr>
<tr align="right"><td nowrap colspan="3">Expert:</td><td nowrap colspan="10" align="left"><b>${expert}</b></td></tr>
<tr align="right"><td nowrap colspan="3">Symbol:</td><td nowrap colspan="10" align="left"><b>${symbol}</b></td></tr>
<tr align="right"><td nowrap colspan="3">Period:</td><td nowrap colspan="10" align="left"><b>M15 (2025.01.01 - 2025.12.31)</b></td></tr>
<tr align="right"><td nowrap colspan="3">Initial Deposit:</td><td nowrap colspan="10" align="left"><b>10 000.00</b></td></tr>
<tr align="right"><td nowrap colspan="3">Total Net Profit:</td><td nowrap colspan="10" align="left"><b>52.00</b></td></tr>
<tr align="right"><td nowrap colspan="3">Total Trades:</td><td nowrap colspan="10" align="left"><b>${empty ? 0 : deals}</b></td></tr>
<tr align="center"><th colspan="13"><div><b>Deals</b></div></th></tr>
<tr align="center" bgcolor="#E5F0FC"><td><b>Time</b></td><td><b>Deal</b></td><td><b>Symbol</b></td><td><b>Type</b></td><td><b>Direction</b></td><td><b>Volume</b></td><td><b>Price</b></td><td><b>Order</b></td><td><b>Commission</b></td><td><b>Swap</b></td><td><b>Profit</b></td><td><b>Balance</b></td><td><b>Comment</b></td></tr>
${body}
<tr align="center"><th colspan="13"><div><b>Orders</b></div></th></tr>
${orderRows.join("\n")}
</table></div></body></html>`;
}

const fmt = (t) => {
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
};

const buf = (html, { utf16 = false } = {}) => {
  const b = Buffer.from(html, utf16 ? "utf16le" : "utf8");
  const copy = new Uint8Array(b.length);
  copy.set(b);
  return copy.buffer;
};

describe("mt5 parser", () => {
  test("reads the Deals table and ignores the Orders table", () => {
    const r = parseMt5Report(buf(makeReport({ deals: 120, orders: 900 })), "btc.html");
    expect(r.deals).toHaveLength(240); // in + out per deal
    expect(r.deals.filter((d) => d.isOut)).toHaveLength(120);
    expect(r.deals.every((d) => d.type === "buy" || d.type === "sell")).toBe(true);
  });

  test("parses UTF-16 exports (the usual MT5 format)", () => {
    const r = parseMt5Report(buf(makeReport({ deals: 3 }), { utf16: true }), "x.html");
    expect(r.deals).toHaveLength(6);
    expect(r.eaExpert).toBe("BusterEA");
  });

  test("reads settings from above the Deals header", () => {
    const r = parseMt5Report(buf(makeReport({ expert: "My EA", symbol: "GBPUSD" })), "file.html");
    expect(r.eaExpert).toBe("My EA");
    expect(r.symbol).toBe("GBPUSD");
    expect(r.initialDeposit).toBe(10000);
    expect(r.period).toContain("M15");
  });

  test("labels the report by file name, keeping the EA name", () => {
    const r = parseMt5Report(buf(makeReport({ expert: "BusterEA" })), "btc_2024.html");
    expect(r.label).toBe("btc_2024");
    expect(r.expert).toBe("btc_2024");
    expect(r.eaExpert).toBe("BusterEA");
    expect(reportLabel("/tmp/a/b/my report.html")).toBe("my report");
  });

  test("numbers with thousands separators and no-break spaces parse", () => {
    const r = parseMt5Report(buf(makeReport({ deals: 1 })), "n.html");
    expect(r.initialDeposit).toBe(10000);
  });

  test("a report with no trades says so clearly", () => {
    expect(() => parseMt5Report(buf(makeReport({ empty: true })), "empty.html")).toThrow(/no trades/i);
  });

  test("a file that is not an MT5 report fails with a helpful message", () => {
    expect(() => parseMt5Report(buf("<html><body><p>hello</p></body></html>"), "x.html")).toThrow(/Deals/i);
  });

  test("a big Orders section does not slow the parse down", () => {
    const t0 = Date.now();
    const r = parseMt5Report(buf(makeReport({ deals: 400, orders: 8000 })), "big.html");
    const ms = Date.now() - t0;
    expect(r.deals).toHaveLength(800);
    expect(ms).toBeLessThan(1500);
  });
});
