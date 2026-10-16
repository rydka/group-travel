import { describe, expect, it } from "vitest";
import { planRestore } from "../../scripts/core/snapshot.mjs";
import { canDo } from "../../scripts/core/rights.mjs";
import { SCHEMA_VERSION, migrateTravel } from "../../scripts/core/migrate.mjs";
import { rations, waterskin2014, camp } from "../helpers/builders.mjs";

// Assumed input shape: snapshot and current are { [actorId]: { items, effects } }
// with full item/effect data (_id, flags, _stats...). Output lists carry
// documents (with _id) or ids for deletions.
const ids = (list) => (list ?? []).map((x) => x?._id ?? x);
const snap = (items, effects = []) => ({ a: { items, effects } });

describe("planRestore (C13)", () => {
  it("nothing to do when state is identical", () => {
    const items = [rations("r1", 3)];
    const plan = planRestore(snap(items), snap(structuredClone(items)));
    expect(ids(plan.a?.createItems)).toEqual([]);
    expect(ids(plan.a?.updateItems)).toEqual([]);
    expect(ids(plan.a?.deleteItems)).toEqual([]);
  });

  it("recreates an item deleted since, with its original id", () => {
    const r = rations("r1", 3);
    const plan = planRestore(snap([r, waterskin2014("w", 1)]), snap([waterskin2014("w", 1)]));
    expect(ids(plan.a.createItems)).toEqual(["r1"]);
    expect(plan.a.createItems[0]).toMatchObject({ _id: "r1", name: "Rations" });
  });

  it("restores a modified item", () => {
    const before = rations("r1", 5);
    const after = rations("r1", 2);
    const plan = planRestore(snap([before]), snap([after]));
    expect(ids(plan.a.updateItems)).toEqual(["r1"]);
    expect(JSON.stringify(plan.a.updateItems[0])).toContain("5");
  });

  it("deletes an item created since (e.g. rations from hunting)", () => {
    const plan = planRestore(snap([rations("r1", 1)]), snap([rations("r1", 1), rations("hunt", 2)]));
    expect(ids(plan.a.deleteItems)).toEqual(["hunt"]);
  });

  it("restores camp item conditions (module flag)", () => {
    const before = camp("t", "Tent", "tent");
    const after = camp("t", "Tent", "tent", { condition: "damaged" });
    const plan = planRestore(snap([before]), snap([after]));
    expect(ids(plan.a.updateItems)).toEqual(["t"]);
  });

  it("ignores _stats", () => {
    const a = { ...rations("r1", 1), _stats: { modifiedTime: 1 } };
    const b = { ...rations("r1", 1), _stats: { modifiedTime: 999 } };
    const plan = planRestore(snap([a]), snap([b]));
    expect(ids(plan.a?.updateItems)).toEqual([]);
  });

  it("handles effects the same way: recreate, update, delete", () => {
    const e1 = { _id: "ex", name: "Exhaustion", system: { level: 2 } };
    const e2 = { _id: "ex", name: "Exhaustion", system: { level: 3 } };
    const m = { _id: "mal", name: "Malnutrition" };
    expect(ids(planRestore(snap([], [e1]), snap([], [])).a.createEffects)).toEqual(["ex"]);
    expect(ids(planRestore(snap([], [e1]), snap([], [e2])).a.updateEffects)).toEqual(["ex"]);
    expect(ids(planRestore(snap([], [e1]), snap([], [e1, m])).a.deleteEffects)).toEqual(["mal"]);
  });

  it("an actor present in the snapshot only is restored from scratch", () => {
    const plan = planRestore({ a: { items: [rations("r1", 1)], effects: [] } }, {});
    expect(ids(plan.a.createItems)).toEqual(["r1"]);
  });

  it("does not mutate its inputs", () => {
    const s = snap([rations("r1", 3)]);
    const c = snap([rations("r1", 1), rations("x", 1)]);
    const before = structuredClone([s, c]);
    planRestore(s, c);
    expect([s, c]).toEqual(before);
  });
});

describe("migrateTravel", () => {
  it("exposes the current schema version", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });
  it("a current record is returned as is", () => {
    const raw = { schemaVersion: SCHEMA_VERSION, name: "x", stages: [], tiers: [], history: [] };
    const { data, migrated } = migrateTravel(raw);
    expect(migrated).toBe(false);
    expect(data).toEqual(raw);
  });
  it("a record without version is stamped with the current version", () => {
    const { data, migrated } = migrateTravel({ name: "old", stages: [], tiers: [], history: [] });
    expect(migrated).toBe(true);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(data.name).toBe("old");
  });
  it("does not mutate its input", () => {
    const raw = { name: "old" };
    migrateTravel(raw);
    expect(raw).toEqual({ name: "old" });
  });
  it("garbage in, no exception", () => {
    expect(() => migrateTravel(null)).not.toThrow();
    expect(() => migrateTravel(undefined)).not.toThrow();
  });
});

describe("canDo (C14)", () => {
  const ctx = (over = {}) => ({ isGM: false, ownsGroup: false, ownsActor: false, gmOnline: true, ...over });

  it("the GM can do everything", () => {
    for (const op of ["configure", "startStage", "closeStage", "undoStage", "setPace", "chooseAction", "setItemCondition"]) {
      expect(canDo(op, ctx({ isGM: true }))).toBe(true);
    }
  });

  it("a player cannot configure, start, close, undo or edit conditions", () => {
    for (const op of ["configure", "startStage", "closeStage", "undoStage", "setItemCondition"]) {
      expect(canDo(op, ctx({ ownsGroup: true, ownsActor: true }))).toBe(false);
    }
  });

  it("a group owner can choose the pace", () => {
    expect(canDo("setPace", ctx({ ownsGroup: true }))).toBe(true);
    expect(canDo("setPace", ctx())).toBe(false);
  });

  it("a player chooses actions for the actors they own only", () => {
    expect(canDo("chooseAction", ctx({ ownsActor: true }))).toBe(true);
    expect(canDo("chooseAction", ctx())).toBe(false);
  });

  it("without a GM online, a player can do nothing (single writer)", () => {
    expect(canDo("chooseAction", ctx({ ownsActor: true, gmOnline: false }))).toBe(false);
    expect(canDo("setPace", ctx({ ownsGroup: true, gmOnline: false }))).toBe(false);
  });

  it("an unknown operation is refused", () => {
    expect(canDo("hack", ctx({ isGM: true }))).toBe(false);
  });
});
