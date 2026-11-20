import { loadMergeRules, saveMergeRule, forgetMergeRule, clearMergeRules, rulesForFile } from "./mergeRules";

beforeEach(() => {
  window.localStorage.clear();
});

describe("saved merge rules", () => {
  test("saves a rule per file and name", () => {
    saveMergeRule("fii.html", "CG", ["CG-M5", "CG-H1"]);
    const rules = rulesForFile("fii.html");
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ file: "fii.html", name: "CG" });
    expect(rules[0].tags.slice().sort()).toEqual(["CG-H1", "CG-M5"]);
  });

  test("editing a group replaces its rule instead of piling up", () => {
    saveMergeRule("fii.html", "CG", ["CG-M5", "CG-H1"]);
    saveMergeRule("fii.html", "CG", ["CG-M5", "CG-H1", "CG-GRID"]);
    const rules = rulesForFile("fii.html");
    expect(rules).toHaveLength(1);
    expect(rules[0].tags).toHaveLength(3);
  });

  test("keeps different groups of the same file apart", () => {
    saveMergeRule("fii.html", "CG", ["CG-M5", "CG-H1"]);
    saveMergeRule("fii.html", "TGS", ["TGS-A", "TGS-B"]);
    expect(rulesForFile("fii.html")).toHaveLength(2);
  });

  test("ignores rules with fewer than two strategies", () => {
    saveMergeRule("fii.html", "Solo", ["only-one"]);
    expect(loadMergeRules()).toHaveLength(0);
  });

  test("forgets a rule by name", () => {
    saveMergeRule("fii.html", "CG", ["a", "b"]);
    forgetMergeRule("fii.html", "CG");
    expect(rulesForFile("fii.html")).toHaveLength(0);
  });

  test("survives corrupted storage", () => {
    window.localStorage.setItem("qf.mergeRules.v1", "{not json");
    expect(loadMergeRules()).toEqual([]);
    saveMergeRule("fii.html", "CG", ["a", "b"]);
    expect(rulesForFile("fii.html")).toHaveLength(1);
    clearMergeRules();
    expect(loadMergeRules()).toEqual([]);
  });
});
