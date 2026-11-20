import { symbolSummary } from "./mt5Parser";

/**
 * Join several detected strategies into one EA.
 *
 * Splitting a multi-EA file can over-split: one EA may label its trades with
 * four different comments ("CG-M5", "CG-H1", "CG-GRID", "CG-SCALP"), which the
 * splitter cannot know belong together. Merging puts their deals back onto one
 * timeline - nothing is discarded or reordered - and recomputes the symbols, so
 * the rest of the app (portfolio, calendar, Lot Brain) sees a single strategy.
 *
 * @param {Array} picked  the report objects to join (2 or more)
 * @param {string} rawName  the EA name the user typed; blank falls back to the
 *                          source file name
 */
export function buildMergedReport(picked, rawName) {
  if (!picked || picked.length < 2) return null;
  const base = picked[0];
  const deals = picked.flatMap((p) => p.deals).sort((a, b) => a.time - b.time);
  const name = (rawName || "").trim();
  // a blank name should read like the report it came from, not like whichever
  // sub-strategy happened to be first
  const sharedFile = picked.every((p) => p.fileName === base.fileName)
    ? String(base.fileName || "").replace(/\.html?$/i, "")
    : "";
  const label = name || base.splitFrom || sharedFile || base.expert;
  const symbols = symbolSummary(deals);

  return {
    ...base,
    id: base.id && base.id.startsWith("merged-") ? base.id : `merged-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    mergedParts: picked,
    fileName: [...new Set(picked.map((p) => p.fileName))].join(", "),
    label,
    expert: label,
    eaExpert: name || picked.map((p) => p.eaExpert).filter(Boolean).join(" + ") || base.eaExpert,
    symbol: symbols.display || base.symbol,
    symbols: symbols.list,
    deals,
    mergedFrom: picked.map((p) => p.label),
  };
}
