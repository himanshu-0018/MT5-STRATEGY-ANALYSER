/**
 * Splitting one report into several strategies.
 *
 * A Strategy Tester export is always one expert, but an account statement (or a
 * merged history) can hold trades from many EAs in a single Deals table. The
 * only identity MT5 gives us per row is the Comment column (and, in some
 * exports, a Magic column).
 *
 * Rules that keep this safe:
 *   - the EA tag comes from the ENTRY deal; its exit deals inherit it (exits
 *     usually carry "sl 4092.42" / "tp ..." which says nothing about the EA)
 *   - trailing trade markers and their prices are stripped from the tag
 *   - untagged deals join the biggest tagged group instead of forming their own
 *   - a split only happens when at least two tags each have a meaningful
 *     number of trades, so a normal single-EA report is never chopped up
 */

const MIN_TRADES_PER_EA = 3;
const MIN_SHARE = 0.05;

/** "XAUUSD D1 SR 11 sl 4577.20" -> "XAUUSD D1 SR 11" */
export function normaliseEaTag(comment) {
  let s = String(comment || "").replace(/\u00a0/g, " ").trim();
  if (!s) return "";
  // "[tp 1990.0]" / "(sl 12.5)" -> "tp 1990.0" / "sl 12.5"
  s = s.replace(/^\s*[\[(]([\s\S]*)[\])]\s*$/, "$1").trim();
  // a trailing trade marker ("sl 1234.56", "tp 2000", "so") is not the EA
  s = s.replace(/\s*\b(sl|tp|so|from|to)\b[\s\])]*[-+]?\d*([.,]\d+)?\s*$/i, "").trim();
  // pure marker rows ("sl 4577.20") leave nothing behind
  if (/^(sl|tp|so|from|to|close|partial)[\s\d.,\-+]*$/i.test(s)) return "";
  return s.replace(/\s+/g, " ");
}

/**
 * @param {Array} deals  parsed deals of one report (sorted by time)
 * @returns {Array<{tag: string, deals: Array}>|null} null when it is one EA
 */
export function splitDealsByEa(deals) {
  if (!deals || deals.length < 2) return null;

  // a Magic column, when the export has one, beats the comment
  const hasMagic = deals.some((d) => d.magic != null && d.magic !== "");
  const tagOfDeal = (d) => (hasMagic ? String(d.magic) : normaliseEaTag(d.comment));

  const groups = new Map();
  const bucket = (tag) => {
    if (!groups.has(tag)) groups.set(tag, []);
    return groups.get(tag);
  };

  // FIFO per symbol so an exit inherits the tag of the entry it closes
  const open = new Map();
  const booking = new Set(["out", "in/out", "out by"]);

  for (const d of deals) {
    const symbol = d.symbol || "—";
    const dir = String(d.direction || "").toLowerCase();
    if (dir === "in") {
      const tag = tagOfDeal(d);
      bucket(tag).push(d);
      const queue = open.get(symbol) || [];
      queue.push({ tag, side: d.type, remaining: d.volume || 0 });
      open.set(symbol, queue);
      continue;
    }
    if (booking.has(dir)) {
      const want = d.type === "buy" ? "sell" : "buy";
      const queue = open.get(symbol) || [];
      let remaining = d.volume || 0;
      let tag = tagOfDeal(d);
      let matched = false;
      while (remaining > 1e-9) {
        const idx = queue.findIndex((e) => e.side === want && e.remaining > 1e-9);
        if (idx < 0) break;
        const entry = queue[idx];
        if (!matched) { tag = entry.tag; matched = true; }
        const v = Math.min(entry.remaining, remaining);
        entry.remaining -= v;
        remaining -= v;
        if (entry.remaining <= 1e-9) queue.splice(idx, 1);
      }
      bucket(tag).push(d);
    }
  }

  const tagged = [...groups.entries()].filter(([tag]) => tag !== "");
  if (tagged.length < 2) return null;

  // untagged deals belong to the dominant tagged group, not to their own
  const untagged = groups.get("") || [];
  tagged.sort((a, b) => b[1].length - a[1].length);
  if (untagged.length) {
    tagged[0][1].push(...untagged);
    groups.delete("");
  }

  const second = tagged[1];
  if (!second || second[1].length < Math.max(MIN_TRADES_PER_EA, tagged[0][1].length * MIN_SHARE)) return null;

  return tagged
    .filter(([, list]) => list.length >= MIN_TRADES_PER_EA)
    .map(([tag, list]) => ({ tag, deals: [...list].sort((a, b) => a.time - b.time) }));
}
