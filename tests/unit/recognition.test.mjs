import { describe, expect, it } from "vitest";
import { classifyItem, normalizeName } from "../../scripts/core/recognition.mjs";
import { DEFAULT_ENTRIES as E, camp, container, makeItem, rations, waterPint, waterskin2014 } from "../helpers/builders.mjs";

describe("normalizeName", () => {
  it("lowercases, strips accents and collapses spaces", () => {
    expect(normalizeName("  Épée   LONGUE ")).toBe("epee longue");
    expect(normalizeName("Boîte d'allume-feu")).toBe("boite d'allume-feu");
  });
  it("tolerates empty input", () => {
    expect(normalizeName("")).toBe("");
  });
});

describe("classifyItem", () => {
  it("recognises by system.identifier first", () => {
    const r = classifyItem(rations("a", 3), E);
    expect(r).toMatchObject({ key: "rations", category: "food", portionsPerUse: 1 });
  });

  it("falls back to the normalised name when the identifier is unknown", () => {
    expect(classifyItem(camp("a", "Sac de couchage", "sac-de-couchage"), E)).toMatchObject({ key: "bedroll", category: "bedding" });
    expect(classifyItem(camp("b", "TENTE (deux places)", "tente-deux-places"), E)).toMatchObject({ key: "tent", category: "shelter" });
    expect(classifyItem(camp("c", "Gamelle", "gamelle"), E)).toMatchObject({ category: "gear" });
  });

  it("recognises both tent identifiers (2014 and 2024)", () => {
    expect(classifyItem(camp("a", "x", "tent"), E).key).toBe("tent");
    expect(classifyItem(camp("b", "x", "two-person-tent"), E).key).toBe("tent");
  });

  it("identifier wins over a conflicting name", () => {
    expect(classifyItem(camp("a", "Bedroll", "tent"), E).category).toBe("shelter");
  });

  it("returns null for unrecognised items (C15)", () => {
    expect(classifyItem(makeItem({ key: "a", name: "Épée longue", type: "weapon", identifier: "longsword" }), E)).toBeNull();
    expect(classifyItem(camp("b", "Gold bar", "gold-bar"), E)).toBeNull();
  });

  it("a waterskin container (2024) is never counted as water", () => {
    expect(classifyItem(container("c", "Waterskin", "waterskin"), E)).toBeNull();
  });

  it("a consumable waterskin (2014) and a water pint are water", () => {
    expect(classifyItem(waterskin2014("a", 1), E)).toMatchObject({ key: "waterskin", category: "water" });
    expect(classifyItem(waterPint("b", 4, "c"), E)).toMatchObject({ key: "water-pint", category: "water" });
  });

  it("honours a user-edited table", () => {
    const entries = [...E, { key: "lantern", category: "gear", identifiers: ["lantern"], names: ["Lanterne"], portionsPerUse: null }];
    expect(classifyItem(camp("a", "Lanterne", "lanterne"), entries).key).toBe("lantern");
    expect(classifyItem(camp("a", "Lanterne", "lanterne"), E)).toBeNull();
  });
});
