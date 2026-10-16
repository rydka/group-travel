import { describe, expect, it } from "vitest";
import { planEvent, readEventEffects } from "../../scripts/core/events.mjs";
import { validateAction, actionOutcome } from "../../scripts/core/actions.mjs";

// Shapes assumed for planEvent output (design: { immediate, deferred,
// comfortMods, conditionChanges, losses }): losses = { food, water } numbers,
// comfortMods = [{ value }], conditionChanges = one entry per damaged object,
// each carrying `steps` (negative). Adjust here if the core differs.
const inventory = { totals: { shelter: 2, bedding: 3 }, camp: [] };
const plan = (effects, over = {}) => planEvent(effects, { inventory, guarded: false, random: () => 0, ...over });
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const comfort = (p) => sum((p.comfortMods ?? []).map((m) => m.value));

describe("readEventEffects (C8)", () => {
  const flags = (effects) => ({ "group-travel": { effects } });

  it("reads the five effect types", () => {
    const { effects, warnings } = readEventEffects(flags([
      { type: "loseFood", amount: 2 },
      { type: "loseWater", amount: 1 },
      { type: "damageItem", category: "shelter", count: 1, steps: 1 },
      { type: "comfort", value: -2 },
      { type: "none" }
    ]));
    expect(effects).toHaveLength(5);
    expect(warnings).toEqual([]);
  });

  it("no flags, or no effects, means no effect (not an error)", () => {
    expect(readEventEffects(undefined).effects).toEqual([]);
    expect(readEventEffects({}).effects).toEqual([]);
    expect(readEventEffects(flags(undefined)).effects).toEqual([]);
  });

  it("drops unknown types and invalid amounts with a warning", () => {
    const { effects, warnings } = readEventEffects(flags([
      { type: "explode" },
      { type: "loseFood", amount: -3 },
      { type: "loseWater", amount: "lots" },
      { type: "loseFood", amount: 2 }
    ]));
    expect(effects).toEqual([expect.objectContaining({ type: "loseFood", amount: 2 })]);
    expect(warnings.length).toBe(3);
  });

  it("does not throw on garbage", () => {
    expect(() => readEventEffects(flags("nope"))).not.toThrow();
    expect(() => readEventEffects(flags([null, 3, "x"]))).not.toThrow();
  });
});

describe("planEvent without a guard", () => {
  it("applies food and water losses in full", () => {
    const p = plan([{ type: "loseFood", amount: 5 }, { type: "loseWater", amount: 3 }]);
    expect(p.losses.food).toBe(5);
    expect(p.losses.water).toBe(3);
  });

  it("applies a comfort modifier", () => {
    expect(comfort(plan([{ type: "comfort", value: -4 }]))).toBe(-4);
    expect(comfort(plan([{ type: "comfort", value: 2 }]))).toBe(2);
  });

  it("damages `count` objects by `steps` levels", () => {
    const p = plan([{ type: "damageItem", category: "shelter", count: 3, steps: 1 }]);
    expect(p.conditionChanges).toHaveLength(3);
  });

  it("'none' and an empty list have no effect", () => {
    for (const p of [plan([{ type: "none" }]), plan([])]) {
      expect(p.losses?.food ?? 0).toBe(0);
      expect(p.losses?.water ?? 0).toBe(0);
      expect(p.conditionChanges ?? []).toHaveLength(0);
      expect(comfort(p)).toBe(0);
    }
  });

  it("is deterministic for a given random source", () => {
    const e = [{ type: "damageItem", category: "any", count: 2, steps: 1 }];
    expect(plan(e, { random: () => 0.3 })).toEqual(plan(e, { random: () => 0.3 }));
  });

  it("does not mutate its inputs", () => {
    const effects = [{ type: "loseFood", amount: 5 }];
    const before = structuredClone([effects, inventory]);
    plan(effects);
    expect([effects, inventory]).toEqual(before);
  });
});

describe("planEvent with a successful guard (answers Q6: halves ALL effects, rounded down)", () => {
  const guarded = (effects) => plan(effects, { guarded: true });

  it("halves food and water losses", () => {
    const p = guarded([{ type: "loseFood", amount: 5 }, { type: "loseWater", amount: 3 }]);
    expect(p.losses.food).toBe(2);
    expect(p.losses.water).toBe(1);
  });

  it("halves a comfort penalty", () => {
    expect(comfort(guarded([{ type: "comfort", value: -4 }]))).toBe(-2);
  });

  it("halves the number of damaged objects, rounded down", () => {
    expect(guarded([{ type: "damageItem", category: "shelter", count: 3, steps: 1 }]).conditionChanges).toHaveLength(1);
    expect(guarded([{ type: "damageItem", category: "shelter", count: 4, steps: 1 }]).conditionChanges).toHaveLength(2);
    expect(guarded([{ type: "damageItem", category: "shelter", count: 1, steps: 1 }]).conditionChanges).toHaveLength(0);
  });

  it("applies to every effect, whether or not it is flagged mitigable", () => {
    const p = guarded([
      { type: "loseFood", amount: 4, mitigable: false },
      { type: "loseWater", amount: 4, mitigable: true }
    ]);
    expect(p.losses.food).toBe(2);
    expect(p.losses.water).toBe(2);
  });

  it("rounds down to nothing for a loss of 1", () => {
    expect(guarded([{ type: "loseFood", amount: 1 }]).losses?.food ?? 0).toBe(0);
  });

  it("guarded: false is the full effect", () => {
    expect(plan([{ type: "loseFood", amount: 5 }], { guarded: false }).losses.food).toBe(5);
  });
});

describe("actions (C9)", () => {
  const good = { id: "hunt", label: "Hunt", check: { type: "skill", key: "sur" }, dc: 13, effect: { type: "addFood", formula: "1d4" } };

  it("validateAction accepts a well-formed action", () => {
    expect(validateAction(good)).toEqual([]);
  });

  it("validateAction reports a missing label, a bad DC, an unknown effect", () => {
    expect(validateAction({ ...good, label: "" }).length).toBeGreaterThan(0);
    expect(validateAction({ ...good, dc: "x" }).length).toBeGreaterThan(0);
    expect(validateAction({ ...good, effect: { type: "teleport" } }).length).toBeGreaterThan(0);
  });

  it("actionOutcome: a failure has no effect", () => {
    expect(actionOutcome(good, { success: false })).toBeNull();
  });

  it("actionOutcome: a success returns the effect", () => {
    expect(actionOutcome(good, { success: true })).toMatchObject({ type: "addFood", formula: "1d4" });
    const repair = { ...good, effect: { type: "repair", steps: 1 } };
    expect(actionOutcome(repair, { success: true })).toMatchObject({ type: "repair", steps: 1 });
    const camp = { ...good, effect: { type: "comfort", value: 2 } };
    expect(actionOutcome(camp, { success: true })).toMatchObject({ type: "comfort", value: 2 });
    const guard = { ...good, effect: { type: "guard" } };
    expect(actionOutcome(guard, { success: true })).toMatchObject({ type: "guard" });
  });
});
