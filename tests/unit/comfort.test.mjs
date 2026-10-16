import { describe, expect, it } from "vitest";
import { computeComfort } from "../../scripts/core/comfort.mjs";
import { resolveTier, validateTiers } from "../../scripts/core/tiers.mjs";
import { DEFAULT_RULES as RULES, DEFAULT_TIERS as TIERS } from "../helpers/builders.mjs";

const item = (rarity, condition, quantity = 1, name = "x") => ({ name, rarity, condition, quantity });

describe("computeComfort (C4, C6)", () => {
  it("value = rarity x condition x quantity", () => {
    expect(computeComfort({ campItems: [item("common", "intact")] }, RULES).score).toBe(1);
    expect(computeComfort({ campItems: [item("rare", "worn")] }, RULES).score).toBe(1.5);
    expect(computeComfort({ campItems: [item("uncommon", "damaged", 4)] }, RULES).score).toBe(2);
    expect(computeComfort({ campItems: [item("legendary", "intact", 2)] }, RULES).score).toBe(10);
  });

  it("spec scenario 2 with the default table: 1 tent + 1 worn tent + 3 bedrolls = 4.5", () => {
    const campItems = [item("common", "intact"), item("common", "worn"), item("common", "intact", 3)];
    expect(computeComfort({ campItems }, RULES).score).toBe(4.5);
  });

  it("an object without rarity counts as common, an unknown rarity too (C15)", () => {
    expect(computeComfort({ campItems: [item("", "intact")] }, RULES).score).toBe(1);
    expect(computeComfort({ campItems: [item(undefined, "intact")] }, RULES).score).toBe(1);
    expect(computeComfort({ campItems: [item("mythic", "intact")] }, RULES).score).toBe(1);
  });

  it("artifact is worth as much as legendary by default", () => {
    expect(computeComfort({ campItems: [item("artifact", "intact")] }, RULES).score).toBe(5);
  });

  it("a destroyed object no longer counts", () => {
    expect(computeComfort({ campItems: [item("rare", "destroyed", 3)] }, RULES).score).toBe(0);
  });

  it("a missing or unknown condition is intact", () => {
    expect(computeComfort({ campItems: [item("common", undefined)] }, RULES).score).toBe(1);
    expect(computeComfort({ campItems: [item("common", "weird")] }, RULES).score).toBe(1);
  });

  it("adds action and event bonuses, subtracts event penalties", () => {
    const campItems = [item("common", "intact", 2)];
    const mods = [{ source: "action", label: "Camp", value: 2 }, { source: "event", label: "Rain", value: -1 }];
    const r = computeComfort({ campItems, mods }, RULES);
    expect(r.base).toBe(2);
    expect(r.score).toBe(3);
  });

  it("subtracts the shortage malus when food or water is short", () => {
    const campItems = [item("common", "intact", 5)];
    expect(computeComfort({ campItems, shortage: { food: true, water: false } }, RULES).score).toBe(3);
    expect(computeComfort({ campItems, shortage: { food: false, water: true } }, RULES).score).toBe(3);
    const both = computeComfort({ campItems, shortage: { food: true, water: true } }, RULES);
    expect(both.score).toBe(1);
    expect(both.malus).toBe(4);
  });

  it("uses a custom table", () => {
    const rules = { ...RULES, rarityComfort: { ...RULES.rarityComfort, common: 10 } };
    expect(computeComfort({ campItems: [item("common", "intact")] }, rules).score).toBe(10);
  });

  it("exposes the breakdown (lines per object, lines per modifier)", () => {
    const r = computeComfort({ campItems: [item("rare", "worn", 2, "Tente"), item("common", "intact", 1, "Sac")], mods: [{ source: "a", label: "L", value: 1 }] }, RULES);
    expect(r.lines).toHaveLength(2);
    expect(r.modLines).toHaveLength(1);
    expect(r.base).toBe(3 + 1);
  });

  it("an empty camp scores 0 and does not throw", () => {
    const r = computeComfort({ campItems: [] }, RULES);
    expect(r.score).toBe(0);
    expect(computeComfort({ campItems: [], mods: undefined, shortage: undefined }, RULES).score).toBe(0);
  });

  it("does not mutate its input", () => {
    const input = { campItems: [item("rare", "worn")], mods: [{ value: 1 }] };
    const before = structuredClone(input);
    computeComfort(input, RULES);
    expect(input).toEqual(before);
  });
});

describe("resolveTier (C5)", () => {
  it("resolves at the boundaries", () => {
    expect(resolveTier(8, TIERS).id).toBe("comfortable");
    expect(resolveTier(7.99, TIERS).id).toBe("fair");
    expect(resolveTier(5, TIERS).id).toBe("fair");
    expect(resolveTier(4.5, TIERS).id).toBe("rough");
    expect(resolveTier(2, TIERS).id).toBe("rough");
    expect(resolveTier(1.99, TIERS).id).toBe("miserable");
    expect(resolveTier(0, TIERS).id).toBe("miserable");
    expect(resolveTier(-12, TIERS).id).toBe("miserable");
    expect(resolveTier(1000, TIERS).id).toBe("comfortable");
  });

  it("does not depend on the order of the tiers", () => {
    const shuffled = [TIERS[2], TIERS[0], TIERS[3], TIERS[1]];
    expect(resolveTier(5, shuffled).id).toBe("fair");
    expect(resolveTier(-1, shuffled).id).toBe("miserable");
  });

  it("returns the tier DC", () => {
    expect(resolveTier(6, TIERS).dc).toBe(10);
  });

  it("supports a custom number of tiers", () => {
    const two = [{ id: "ok", name: "OK", min: 3, dc: 5 }, { id: "bad", name: "Bad", min: null, dc: 20 }];
    expect(resolveTier(3, two).id).toBe("ok");
    expect(resolveTier(2.9, two).id).toBe("bad");
  });
});

describe("validateTiers", () => {
  it("accepts the default tiers", () => {
    expect(validateTiers(TIERS)).toEqual([]);
  });
  it("rejects an empty list", () => {
    expect(validateTiers([]).length).toBeGreaterThan(0);
  });
  it("rejects duplicated minimums", () => {
    expect(validateTiers([{ id: "a", name: "A", min: 5, dc: 8 }, { id: "b", name: "B", min: 5, dc: 9 }, { id: "c", name: "C", min: null, dc: 10 }]).length).toBeGreaterThan(0);
  });
  it("rejects a list without a floor tier (min null)", () => {
    expect(validateTiers([{ id: "a", name: "A", min: 5, dc: 8 }, { id: "b", name: "B", min: 2, dc: 9 }]).length).toBeGreaterThan(0);
  });
  it("rejects a non numeric DC", () => {
    expect(validateTiers([{ id: "a", name: "A", min: null, dc: "x" }]).length).toBeGreaterThan(0);
  });
});
