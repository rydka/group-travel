import { describe, expect, it } from "vitest";
import { dailyPrivation } from "../../scripts/core/privation.mjs";

// Optional official privation (disabled by default, user answer Q2).
// Rules: reports/rules/group-travel-rules.md section 2. Amounts are in the same
// unit for need and got (1 ration of food, 1 ration of water per day).
const day = (rulesVersion, food, water, counter = 0, conMod = 0) =>
  dailyPrivation({ rulesVersion, food: { need: 1, got: food }, water: { need: 1, got: water }, counter, conMod });
const of = (r, kind) => r.steps.filter((s) => s.kind === kind);

describe("dailyPrivation, 2014 (legacy)", () => {
  it("a full day of food and water changes nothing and resets the counter", () => {
    const r = day("legacy", 1, 1, 2);
    expect(r.steps).toEqual([]);
    expect(r.counter).toBe(0);
    expect(r.statuses).toEqual({ malnutrition: false, dehydration: false });
  });

  it("food: 3 + Con modifier days are tolerated, then 1 automatic level per day", () => {
    let r = day("legacy", 0, 1, 0, 0);
    expect(r.counter).toBe(1);
    expect(of(r, "food")).toEqual([]);
    r = day("legacy", 0, 1, 2, 0);
    expect(r.counter).toBe(3);
    expect(of(r, "food")).toEqual([]);
    r = day("legacy", 0, 1, 3, 0);
    expect(r.counter).toBe(4);
    expect(of(r, "food")).toHaveLength(1);
    expect(of(r, "food")[0]).toMatchObject({ type: "auto", levels: 1 });
    expect(day("legacy", 0, 1, 7, 0).steps.filter((s) => s.kind === "food")).toHaveLength(1);
  });

  it("food: the Con modifier extends the limit, with a minimum of 1 day", () => {
    expect(of(day("legacy", 0, 1, 3, 2), "food")).toEqual([]); // limit 5, counter -> 4
    expect(of(day("legacy", 0, 1, 5, 2), "food")).toHaveLength(1); // counter -> 6
    expect(of(day("legacy", 0, 1, 0, -5), "food")).toEqual([]); // limit 1, counter -> 1
    expect(of(day("legacy", 0, 1, 1, -5), "food")).toHaveLength(1); // counter -> 2
  });

  it("food: half a ration counts as half a day without food", () => {
    const r = dailyPrivation({ rulesVersion: "legacy", food: { need: 1, got: 0.5 }, water: { need: 1, got: 1 }, counter: 0, conMod: 0 });
    expect(r.counter).toBe(0.5);
  });

  it("water: less than half of the need is an automatic level", () => {
    const r = day("legacy", 1, 0);
    expect(of(r, "water")).toHaveLength(1);
    expect(of(r, "water")[0]).toMatchObject({ type: "auto", levels: 1, levelsIfExhausted: 2 });
    expect(r.statuses.dehydration).toBe(true);
  });

  it("water: at least half but not all is a Con save DC 15", () => {
    const r = dailyPrivation({ rulesVersion: "legacy", food: { need: 1, got: 1 }, water: { need: 2, got: 1 }, counter: 0, conMod: 0 });
    expect(of(r, "water")).toHaveLength(1);
    expect(of(r, "water")[0]).toMatchObject({ type: "save", dc: 15, levels: 1, levelsIfExhausted: 2 });
  });

  it("water: the whole need gives nothing", () => {
    expect(of(day("legacy", 1, 1), "water")).toEqual([]);
  });

  it("food and water failures stack in the same day", () => {
    const r = day("legacy", 0, 0, 5, 0);
    expect(r.steps.map((s) => s.kind).sort()).toEqual(["food", "water"]);
    expect(r.statuses).toEqual({ malnutrition: true, dehydration: true });
  });
});

describe("dailyPrivation, 2024 (modern)", () => {
  it("a full day changes nothing and resets the counter", () => {
    const r = day("modern", 1, 1, 3);
    expect(r.steps).toEqual([]);
    expect(r.counter).toBe(0);
  });

  it("food: no automatic level before the 5th day without food", () => {
    const r = day("modern", 0, 1, 3, 4);
    expect(r.counter).toBe(4);
    expect(of(r, "food").filter((s) => s.type === "auto")).toEqual([]);
  });

  it("food: automatic level at the end of the 5th day, whatever the Con modifier", () => {
    for (const conMod of [-3, 0, 5]) {
      const r = day("modern", 0, 1, 4, conMod);
      expect(r.counter).toBe(5);
      expect(of(r, "food").filter((s) => s.type === "auto")).toHaveLength(1);
    }
    expect(of(day("modern", 0, 1, 9), "food").filter((s) => s.type === "auto")).toHaveLength(1);
  });

  it("food: less than half of the need is a Con save DC 10", () => {
    const r = dailyPrivation({ rulesVersion: "modern", food: { need: 2, got: 0.5 }, water: { need: 1, got: 1 }, counter: 0, conMod: 0 });
    expect(of(r, "food")).toHaveLength(1);
    expect(of(r, "food")[0]).toMatchObject({ type: "save", dc: 10, levels: 1 });
  });

  it("food: at least half of the need gives nothing", () => {
    const r = dailyPrivation({ rulesVersion: "modern", food: { need: 2, got: 1 }, water: { need: 1, got: 1 }, counter: 0, conMod: 0 });
    expect(of(r, "food")).toEqual([]);
  });

  it("water: less than half is an automatic level without a save", () => {
    const r = day("modern", 1, 0);
    expect(of(r, "water")).toHaveLength(1);
    expect(of(r, "water")[0]).toMatchObject({ type: "auto", levels: 1 });
    expect(r.statuses.dehydration).toBe(true);
  });

  it("water: half or more gives nothing", () => {
    const r = dailyPrivation({ rulesVersion: "modern", food: { need: 1, got: 1 }, water: { need: 2, got: 1 }, counter: 0, conMod: 0 });
    expect(of(r, "water")).toEqual([]);
  });

  it("no 'already exhausted' doubling in 2024", () => {
    const w = of(day("modern", 1, 0), "water")[0];
    expect(w.levelsIfExhausted ?? w.levels).toBe(1);
  });
});
