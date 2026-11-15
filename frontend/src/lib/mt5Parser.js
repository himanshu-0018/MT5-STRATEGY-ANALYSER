const num = (s) => {
  if (s == null) return 0;
  const v = parseFloat(String(s).replace(/[\s\u00a0]/g, "").replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

const decode = (buf) => {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(buf);
  if (b.length > 1 && b[1] === 0 && b[0] !== 0) return new TextDecoder("utf-16le").decode(buf);
  return new TextDecoder("utf-8").decode(buf);
};

const cellText = (td) => (td.textContent || "").replace(/\u00a0/g, " ").trim();

const findValue = (cells, label) => {
  const i = cells.findIndex((t) => t.toLowerCase() === label.toLowerCase());
  return i >= 0 ? cells[i + 1] : undefined;
};

const TIME_RE = /(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/;

const OUT_DIRS = new Set(["out", "in/out", "out by"]);

/** "btc_2024_fixed.html" -> "btc_2024_fixed" (what the trader sees in their folder) */
export const reportLabel = (fileName) =>
  String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();

export function parseMt5Report(buffer, fileName) {
  const html = decode(buffer);
  const doc = new DOMParser().parseFromString(html, "text/html");

  // Find the "Deals" header first - querying `th, b` is cheap, while turning
  // every <td> in the document into a string is not (a 500-report upload was
  // mapping millions of cells just to read five settings fields).
  const dealsHeader = Array.from(doc.querySelectorAll("th, b")).find((el) => cellText(el) === "Deals");
  if (!dealsHeader) throw new Error("No 'Deals' table found. Is this an MT5 Strategy Tester HTML report?");

  const headerRow = dealsHeader.closest("tr");
  const table = dealsHeader.closest("table");
  if (!table) throw new Error("Malformed report: 'Deals' is not inside a table.");

  // Settings live in the rows above the Deals header (same table in MT5
  // exports). Only those rows are stringified.
  const settings = [];
  for (const row of table.rows) {
    if (row === headerRow) break;
    const cs = row.cells;
    for (let i = 0; i < cs.length; i++) settings.push(cellText(cs[i]));
  }
  // Unusual layouts: fall back to the full scan only when the deposit is missing.
  const cells = findValue(settings, "Initial Deposit:") === undefined
    ? Array.from(doc.querySelectorAll("td")).map(cellText)
    : settings;

  let startIdx = -1;
  const rows = table.rows;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === headerRow) { startIdx = i; break; }
  }

  const deals = [];
  for (let i = startIdx + 1; i < rows.length; i++) {
    const cs = rows[i].cells;
    if (cs.length < 13) continue;
    const t0 = cellText(cs[0]);
    if (t0.length < 16) continue;
    const tm = TIME_RE.exec(t0);
    if (!tm) continue;
    const type = cellText(cs[3]).toLowerCase();
    if (type !== "buy" && type !== "sell") continue;
    const time = Date.UTC(+tm[1], +tm[2] - 1, +tm[3], +tm[4], +tm[5], +(tm[6] || 0));
    const direction = cellText(cs[4]).toLowerCase();
    const commission = num(cellText(cs[8]));
    const swap = num(cellText(cs[9]));
    const profit = num(cellText(cs[10]));
    deals.push({
      time,
      deal: cellText(cs[1]),
      symbol: cellText(cs[2]),
      type,
      direction,
      volume: num(cellText(cs[5])),
      price: num(cellText(cs[6])),
      commission,
      swap,
      profit,
      net: commission + swap + profit,
      isOut: OUT_DIRS.has(direction),
      comment: cellText(cs[12]),
    });
  }
  if (!deals.length) throw new Error("No trade deals found in report.");
  deals.sort((a, b) => a.time - b.time);

  const eaExpert = findValue(cells, "Expert:") || "";
  // Reports are identified by the file name the trader actually saved, not by
  // the EA name inside the report (two files can be the same EA, and the file
  // name is what they recognise). The EA name is kept for tooltips/subtitles.
  const label = reportLabel(fileName) || eaExpert || fileName;
  const period = findValue(cells, "Period:") || "";
  return {
    id: `${fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    fileName,
    label,
    expert: label,
    eaExpert,
    symbol: findValue(cells, "Symbol:") || deals[0].symbol,
    period,
    timeframe: period.split(" ")[0],
    initialDeposit: num(findValue(cells, "Initial Deposit:")) || 1000,
    reported: {
      netProfit: num(findValue(cells, "Total Net Profit:")),
      profitFactor: num(findValue(cells, "Profit Factor:")),
      equityDD: findValue(cells, "Equity Drawdown Maximal:") || "",
      totalTrades: num(findValue(cells, "Total Trades:")),
    },
    deals,
  };
}
