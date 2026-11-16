import { splitDealsByEa } from "./eaSplit";

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

const TIME_RE = /(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/;
const OUT_DIRS = new Set(["out", "in/out", "out by"]);

/** "btc_2024_fixed.html" -> "btc_2024_fixed" (what the trader sees in their folder) */
export const reportLabel = (fileName) =>
  String(fileName || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").trim();

/* ------------------------------------------------------------------ */
/* Fast path: scan the HTML string for the Deals section              */
/* ------------------------------------------------------------------ */

// MT5 reports are machine generated: every cell is a plain <td>. Stripping tags
// only when they are present keeps the hot loop cheap.
const cleanCell = (v) => {
  let s = v;
  if (s.indexOf("<") >= 0) s = s.replace(/<[^>]*>/g, " ");
  if (s.indexOf("&") >= 0) {
    s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return s.trim();
};

/** Every <td> inside [from, to) as trimmed text. */
function cellsBetween(s, from, to) {
  const out = [];
  let i = s.indexOf("<td", from);
  while (i >= 0 && i < to) {
    const gt = s.indexOf(">", i);
    if (gt < 0 || gt > to) break;
    const close = s.indexOf("</td>", gt);
    if (close < 0 || close > to) break;
    out.push(cleanCell(s.slice(gt + 1, close)));
    i = s.indexOf("<td", close);
  }
  return out;
}

const findValue = (cells, label) => {
  const want = label.toLowerCase();
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].toLowerCase() === want) return cells[i + 1];
  }
  return undefined;
};

/**
 * Walk the Deals table without building a DOM.
 *
 * A 30 MB report holds ~680k <td> cells; DOMParser turns that into a ~1 GB tree
 * (seconds of blocking work per file) whereas this reads only the ~15k deal
 * rows we need and stops before the Orders section.
 */
function scanReport(html) {
  const iDeals = html.indexOf(">Deals<");
  if (iDeals < 0) return null;

  // settings live above the Deals header (a few dozen cells)
  const headCells = cellsBetween(html, 0, iDeals);

  let end = html.length;
  const iOrders = html.indexOf(">Orders<", iDeals + 1);
  if (iOrders > 0) end = iOrders;
  const iTable = html.indexOf("</table>", iDeals);
  if (iTable > 0 && iTable < end) end = iTable;

  // the first row after the Deals marker is the column header
  let magicIdx = -1;
  {
    const hStart = html.indexOf("<tr", iDeals);
    const hEnd = hStart >= 0 ? html.indexOf("</tr>", hStart) : -1;
    if (hStart >= 0 && hEnd > hStart) {
      const header = cellsBetween(html, hStart, hEnd);
      magicIdx = header.findIndex((c) => /^magic/i.test(c));
    }
  }

  const deals = [];
  let pos = html.indexOf("<tr", iDeals);
  while (pos >= 0 && pos < end) {
    const rowEnd = html.indexOf("</tr>", pos);
    const stop = rowEnd < 0 || rowEnd > end ? end : rowEnd;

    // cheap gate: a deal row's first cell must start with a date/time
    const firstCell = html.indexOf("<td", pos);
    let parsedRow = false;
    if (firstCell > 0 && firstCell < stop) {
      const gt = html.indexOf(">", firstCell);
      const close = gt > 0 ? html.indexOf("</td>", gt) : -1;
      if (close > gt) {
        const tm = TIME_RE.exec(html.slice(gt + 1, close));
        if (tm) {
          const cells = cellsBetween(html, pos, stop);
          if (cells.length >= 13) {
            const type = cells[3].toLowerCase();
            if (type === "buy" || type === "sell") {
              const direction = cells[4].toLowerCase();
              const commission = num(cells[8]);
              const swap = num(cells[9]);
              const profit = num(cells[10]);
              deals.push({
                time: Date.UTC(+tm[1], +tm[2] - 1, +tm[3], +tm[4], +tm[5], +(tm[6] || 0)),
                deal: cells[1],
                symbol: cells[2],
                type,
                direction,
                volume: num(cells[5]),
                price: num(cells[6]),
                commission,
                swap,
                profit,
                net: commission + swap + profit,
                isOut: OUT_DIRS.has(direction),
                comment: cells[12],
                magic: magicIdx >= 0 ? cells[magicIdx] : undefined,
              });
              parsedRow = true;
            }
          }
        }
      }
    }
    if (!parsedRow && rowEnd < 0) break;
    pos = rowEnd < 0 ? -1 : html.indexOf("<tr", rowEnd);
  }

  if (!deals.length) return null;
  return { deals, cells: headCells };
}

/* ------------------------------------------------------------------ */
/* Fallback: DOM parse (unusual layouts)                              */
/* ------------------------------------------------------------------ */

function parseWithDom(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const cellText = (td) => (td.textContent || "").replace(/\u00a0/g, " ").trim();

  const dealsHeader = Array.from(doc.querySelectorAll("th, b")).find((el) => cellText(el) === "Deals");
  if (!dealsHeader) throw new Error("No 'Deals' table found. Is this an MT5 Strategy Tester HTML report?");

  const headerRow = dealsHeader.closest("tr");
  const table = dealsHeader.closest("table");
  if (!table) throw new Error("Malformed report: 'Deals' is not inside a table.");

  const cells = [];
  for (const row of table.rows) {
    if (row === headerRow) break;
    const cs = row.cells;
    for (let i = 0; i < cs.length; i++) cells.push(cellText(cs[i]));
  }

  let startIdx = -1;
  const rows = table.rows;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === headerRow) { startIdx = i; break; }
  }
  let magicIdx = -1;
  if (startIdx + 1 < rows.length) {
    magicIdx = Array.from(rows[startIdx + 1].cells).findIndex((c) => /^magic/i.test(cellText(c)));
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
    const direction = cellText(cs[4]).toLowerCase();
    const commission = num(cellText(cs[8]));
    const swap = num(cellText(cs[9]));
    const profit = num(cellText(cs[10]));
    deals.push({
      time: Date.UTC(+tm[1], +tm[2] - 1, +tm[3], +tm[4], +tm[5], +(tm[6] || 0)),
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
      magic: magicIdx >= 0 && cs[magicIdx] ? cellText(cs[magicIdx]) : undefined,
    });
  }
  if (!deals.length) throw new Error("No trade deals found in report.");
  return { deals, cells };
}

/* ------------------------------------------------------------------ */

/**
 * Parse one file into one or more strategies.
 *
 * `splitByEa` is the user's choice from the uploader: when a single file holds
 * trades from several EAs, the Deals table is split into one report per EA so
 * each gets its own row, lot size and drawdown instead of being merged into one.
 */
export function parseMt5Reports(buffer, fileName, opts = {}) {
  const single = parseMt5Report(buffer, fileName);
  if (!opts.splitByEa) return [single];
  const parts = splitDealsByEa(single.deals);
  if (!parts || parts.length < 2) return [single];
  return parts.map((part) => ({
    ...single,
    id: `${single.fileName}-${part.tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: `${single.label} · ${part.tag}`,
    expert: `${single.label} · ${part.tag}`,
    eaExpert: part.tag,
    splitFrom: single.label,
    deals: part.deals,
  }));
}

export function parseMt5Report(buffer, fileName) {
  const html = decode(buffer);
  let parsed = scanReport(html);
  if (!parsed) {
    // An MT5 report can be exported with settings but no trading history (the
    // EA never opened a position). Say so instead of "malformed report".
    if (html.indexOf(">Deals<") >= 0 && !/<td>\s*(buy|sell)\s*<\/td>/i.test(html)) {
      throw new Error("contains no trades (only a deposit, no positions)");
    }
    parsed = parseWithDom(html);
  }
  parsed.deals.sort((a, b) => a.time - b.time);

  const cells = parsed.cells;
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
    symbol: findValue(cells, "Symbol:") || parsed.deals[0].symbol,
    period,
    timeframe: period.split(" ")[0],
    initialDeposit: num(findValue(cells, "Initial Deposit:")) || 1000,
    reported: {
      netProfit: num(findValue(cells, "Total Net Profit:")),
      profitFactor: num(findValue(cells, "Profit Factor:")),
      equityDD: findValue(cells, "Equity Drawdown Maximal:") || "",
      totalTrades: num(findValue(cells, "Total Trades:")),
    },
    deals: parsed.deals,
  };
}
