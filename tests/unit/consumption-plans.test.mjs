import { describe, expect, it } from "vitest";
import { applyChangesToHolders, mergeChanges, planConsumption } from "../../scripts/core/consumption.mjs";
import { DEFAULT_ENTRIES as E, clone, group, member, rations, waterskin2014 } from "../helpers/builders.mjs";

describe("applyChangesToHolders", () => {
  it("applies updates (dotted keys) and deletions on copies", () => {
    const holders = [member("a", [rations("r1", 5), waterskin2014("w1", 1)]), group("g", [rations("r2", 2)])];
    const before = clone(holders);
    const next = applyChangesToHolders(holders, {
      a: { update: [{ _id: "r1", "system.quantity": 3 }, { _id: "w1", "system.uses.spent": 2 }] },
      g: { delete: ["r2"] }
    });
    expect(holders).toEqual(before);
    expect(next.find((h) => h.id === "a").items.find((i) => i._id === "r1").system.quantity).toBe(3);
    expect(next.find((h) => h.id === "a").items.find((i) => i._id === "w1").system.uses.spent).toBe(2);
    expect(next.find((h) => h.id === "g").items).toEqual([]);
  });

  it("leaves holders without changes as they are, and tolerates missing input", () => {
    const holders = [member("a", [rations("r1", 5)])];
    expect(applyChangesToHolders(holders, {})[0]).toBe(holders[0]);
    expect(applyChangesToHolders(holders, undefined)).toEqual(holders);
    expect(applyChangesToHolders(undefined, {})).toEqual([]);
  });

  it("chaining plans gives the same result as one planConsumption on the final state", () => {
    const holders = [member("a", [rations("r1", 5)]), group("g", [rations("r2", 1)])];
    const plan = planConsumption({ members: [holders[0]], group: holders[1], days: 3, foodPerDay: 1, waterPerDay: 0, pintsPerWaterRation: 4, entries: E });
    const after = applyChangesToHolders(holders, plan.changes);
    expect(after.find((h) => h.id === "g").items).toEqual([]);
    expect(after.find((h) => h.id === "a").items[0].system.quantity).toBe(3);
  });
});

describe("mergeChanges", () => {
  it("merges the updates of the same item key by key, later ones win", () => {
    const m = mergeChanges(
      { a: { update: [{ _id: "i", "system.quantity": 4, x: 1 }] } },
      { a: { update: [{ _id: "i", "system.quantity": 2 }] } }
    );
    expect(m.a.update).toEqual([{ _id: "i", "system.quantity": 2, x: 1 }]);
    expect(m.a.delete).toEqual([]);
  });

  it("a deleted item is not updated", () => {
    const m = mergeChanges({ a: { update: [{ _id: "i", y: 1 }, { _id: "j", y: 1 }] } }, { a: { delete: ["i"] } });
    expect(m.a.update.map((u) => u._id)).toEqual(["j"]);
    expect(m.a.delete).toEqual(["i"]);
  });

  it("keeps holders apart and ignores empty sets", () => {
    const m = mergeChanges({ a: { delete: ["x"] } }, undefined, { b: { update: [{ _id: "y", k: 1 }] } });
    expect(Object.keys(m).sort()).toEqual(["a", "b"]);
    expect(mergeChanges()).toEqual({});
  });

  it("does not mutate its inputs", () => {
    const a = { h: { update: [{ _id: "i", k: 1 }] } };
    const before = clone(a);
    mergeChanges(a, { h: { update: [{ _id: "i", k: 2 }] } });
    expect(a).toEqual(before);
  });
});
