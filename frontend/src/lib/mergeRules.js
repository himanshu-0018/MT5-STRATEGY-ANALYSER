/**
 * Saved merge rules.
 *
 * When a multi-EA file is split, one EA can arrive as several strategies (four
 * comment tags, for example). Merging them by hand is fine once - having to do
 * it again on every re-upload is not. A rule remembers, per file, which tags
 * belong together and what the merged strategy is called, so the next upload of
 * the same file is merged automatically.
 */
const KEY = "qf.mergeRules.v1";
const MAX_RULES = 200;

const read = () => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    // one rule per (file, name), newest wins - older duplicates are ignored
    const byKey = new Map();
    for (const r of list) if (r && r.file && r.name) byKey.set(`${r.file}|||${r.name}`, r);
    return [...byKey.values()];
  } catch (err) {
    return [];
  }
};

const write = (rules) => {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rules.slice(-MAX_RULES)));
  } catch (err) {
    /* private mode / quota - merging still works, it just is not remembered */
  }
};

export const loadMergeRules = () => read();

export const clearMergeRules = () => {
  try { window.localStorage.removeItem(KEY); } catch (err) { /* ignore */ }
};

/** Rules that were saved for this file. */
export const rulesForFile = (fileName) => read().filter((r) => r.file === fileName);

/**
 * Remember that `tags` of `file` form one EA called `name`.
 *
 * One rule per (file, name): editing a group replaces its rule instead of
 * piling up a second one, so a re-upload reproduces the LAST arrangement.
 */
export const saveMergeRule = (file, name, tags) => {
  if (!file || !name || !tags || tags.length < 2) return;
  const rules = read().filter((r) => !(r.file === file && r.name === name));
  rules.push({ file, name, tags: [...tags].sort(), savedAt: Date.now() });
  write(rules);
};

export const forgetMergeRule = (file, name) => {
  write(read().filter((r) => !(r.file === file && r.name === name)));
};

/** The tag a strategy carries inside its file (the EA tag for split strategies). */
export const tagOf = (report) => (report && (report.eaExpert || report.expert)) || "";
