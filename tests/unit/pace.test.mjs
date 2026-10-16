import { describe, expect, it } from "vitest";
import { effectiveDays, stageDc } from "../../scripts/core/pace.mjs";
import { forcedMarchChecks } from "../../scripts/core/forced-march.mjs";
import { PACE_RULES as P } from "../helpers/builders.mjs";

describe("effectiveDays (C7b)", () => {
  it("normal keeps the average duration", () => {
    expect(effectiveDays(4, "normal", P)).toBe(4);
  });
  it("fast = -25 %, rounded up: 4 -> 3", () => {
    expect(effectiveDays(4, "fast", P)).toBe(3);
  });
  it("slow = +50 %, rounded up: 4 -> 6", () => {
    expect(effectiveDays(4, "slow", P)).toBe(6);
  });
  it("rounds up to the next day", () => {
    expect(effectiveDays(3, "fast", P)).toBe(3); // 2.25
    expect(effectiveDays(5, "fast", P)).toBe(4); // 3.75
    expect(effectiveDays(1, "fast", P)).toBe(1); // 0.75
    expect(effectiveDays(3, "slow", P)).toBe(5); // 4.5
    expect(effectiveDays(10, "slow", P)).toBe(15);
  });
  it("does not round up on float noise (exact products)", () => {
    expect(effectiveDays(2, "slow", P)).toBe(3);
    expect(effectiveDays(8, "fast", P)).toBe(6);
    expect(effectiveDays(12, "fast", P)).toBe(9);
  });
  it("uses the configured percentages", () => {
    expect(effectiveDays(4, "fast", { ...P, fast: { durationPct: -50, dcMod: 4 } })).toBe(2);
  });
});

describe("stageDc (C7b, C11)", () => {
  it("uses the tier DC when the stage has none", () => {
    expect(stageDc({ stageDc: null, tierDc: 10, pace: "normal", paceRules: P })).toMatchObject({ dc: 10, base: 10, source: "tier", paceMod: 0 });
  });
  it("a stage DC replaces the tier DC", () => {
    expect(stageDc({ stageDc: 12, tierDc: 16, pace: "normal", paceRules: P })).toMatchObject({ dc: 12, base: 12, source: "stage" });
  });
  it("fast adds 2, slow subtracts 2", () => {
    expect(stageDc({ stageDc: null, tierDc: 10, pace: "fast", paceRules: P }).dc).toBe(12);
    expect(stageDc({ stageDc: null, tierDc: 10, pace: "slow", paceRules: P }).dc).toBe(8);
    expect(stageDc({ stageDc: 12, tierDc: 16, pace: "slow", paceRules: P })).toMatchObject({ dc: 10, source: "stage", paceMod: -2 });
  });
  it("a stage DC of 0 is still a stage DC only when defined as a number", () => {
    expect(stageDc({ stageDc: undefined, tierDc: 13, pace: "normal", paceRules: P }).source).toBe("tier");
  });
});

describe("forcedMarchChecks (C11b)", () => {
  it("no check up to 8 hours", () => {
    expect(forcedMarchChecks(8, 3)).toEqual([]);
    expect(forcedMarchChecks(6, 3)).toEqual([]);
  });
  it("one check per hour beyond 8, DC 10 + n", () => {
    const c = forcedMarchChecks(10, 1);
    expect(c.map((x) => x.dc)).toEqual([11, 12]);
    expect(c.every((x) => x.day === 1)).toBe(true);
  });
  it("repeats for every day, in day order", () => {
    const c = forcedMarchChecks(10, 2);
    expect(c.map((x) => [x.day, x.dc])).toEqual([[1, 11], [1, 12], [2, 11], [2, 12]]);
  });
  it("12 hours gives DC 11 to 14", () => {
    expect(forcedMarchChecks(12, 1).map((x) => x.dc)).toEqual([11, 12, 13, 14]);
  });
  it("honours a custom threshold", () => {
    expect(forcedMarchChecks(10, 1, { threshold: 10 })).toEqual([]);
    expect(forcedMarchChecks(10, 1, { threshold: 9 }).map((x) => x.dc)).toEqual([11]);
  });
  it("missing hours or zero days gives no check", () => {
    expect(forcedMarchChecks(null, 3)).toEqual([]);
    expect(forcedMarchChecks(undefined, 3)).toEqual([]);
    expect(forcedMarchChecks(12, 0)).toEqual([]);
  });
  it("the hour of each check increases within a day", () => {
    const hours = forcedMarchChecks(11, 1).map((x) => x.hour);
    expect([...hours].sort((a, b) => a - b)).toEqual(hours);
    expect(new Set(hours).size).toBe(hours.length);
  });
});
