import { describe, expect, it } from "vitest";
import { aggregateInventory, itemPortions } from "../../scripts/core/inventory.mjs";
import {
  DEFAULT_ENTRIES as E, camp, clone, container, group, makeItem, member, rations, totalOf, waterPint, waterskin2014
} from "../helpers/builders.mjs";

describe("itemPortions", () => {
  it("without uses, counts the quantity", () => {
    expect(itemPortions(camp("a", "Tent", "tent", { quantity: 3 }))).toBe(3);
  });
  it("with uses, counts quantity x max - spent", () => {
    expect(itemPortions(waterskin2014("a", 1, 0))).toBe(4);
    expect(itemPortions(waterskin2014("a", 1, 3))).toBe(1);
    expect(itemPortions(waterskin2014("a", 3, 5))).toBe(7);
    expect(itemPortions(waterskin2014("a", 2, 8))).toBe(0);
  });
  it("a stack of rations (max 1) is its quantity", () => {
    expect(itemPortions(rations("a", 5))).toBe(5);
    expect(itemPortions(rations("a", 0))).toBe(0);
  });
});

describe("aggregateInventory", () => {
  it("sums members and the group by category (C2)", () => {
    const holders = [
      member("m1", [rations("r1", 5), waterskin2014("w1", 2), camp("t1", "Tent", "tent")]),
      member("m2", [rations("r2", 3), camp("b1", "Bedroll", "bedroll")]),
      group("g", [rations("r3", 6), camp("b2", "Bedroll", "bedroll", { quantity: 2 })])
    ];
    const inv = aggregateInventory(holders, E);
    expect(totalOf(inv, "food")).toBe(14);
    expect(totalOf(inv, "water")).toBe(8);
    expect(totalOf(inv, "shelter")).toBe(1);
    expect(totalOf(inv, "bedding")).toBe(3);
    expect(totalOf(inv, "gear")).toBe(0);
  });

  it("counts the contents of nested containers, not the containers", () => {
    const holders = [member("m1", [
      container("bag", "Backpack", "backpack"),
      container("skin", "Waterskin", "waterskin", { container: "bag" }),
      waterPint("p1", 4, "skin"),
      rations("r1", 2, { container: "bag" })
    ])];
    const inv = aggregateInventory(holders, E);
    expect(totalOf(inv, "water")).toBe(4);
    expect(totalOf(inv, "food")).toBe(2);
  });

  it("merges identical objects (same identifier, else same name)", () => {
    const holders = [
      member("m1", [camp("a", "Bedroll", "bedroll")]),
      member("m2", [camp("b", "Sac de couchage", "bedroll")]),
      member("m3", [camp("c", "Couverture", "couverture")]),
      member("m4", [camp("d", "Couverture", "couverture")])
    ];
    expect(totalOf(aggregateInventory(holders, E), "bedding")).toBe(4);
  });

  it("leaves unrecognised objects out (C15)", () => {
    const holders = [member("m1", [makeItem({ key: "s", name: "Sword", type: "weapon", identifier: "sword", quantity: 4 })])];
    const inv = aggregateInventory(holders, E);
    for (const c of ["food", "water", "shelter", "bedding", "gear"]) expect(totalOf(inv, c) ?? 0).toBe(0);
  });

  it("handles no holders and holders without items", () => {
    expect(() => aggregateInventory([], E)).not.toThrow();
    expect(totalOf(aggregateInventory([member("m1", [])], E), "food") ?? 0).toBe(0);
  });

  it("never mutates its input (nothing is moved)", () => {
    const holders = [member("m1", [rations("r1", 5)]), group("g", [rations("r2", 1)])];
    const before = clone(holders);
    aggregateInventory(holders, E);
    expect(holders).toEqual(before);
  });
});
