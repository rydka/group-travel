import { describe, expect, it } from "vitest";
import { planConsumption, planRemoval } from "../../scripts/core/consumption.mjs";
import { classifyItem } from "../../scripts/core/recognition.mjs";
import { itemPortions } from "../../scripts/core/inventory.mjs";
import {
  DEFAULT_ENTRIES as E, PINTS_PER_WATER_RATION, applyChanges, camp, clone, container, group, intakeSeries, member,
  portionsIn, rations, waterPint, waterskin2014
} from "../helpers/builders.mjs";

const core = { classifyItem, itemPortions };
const left = (holders, id, category) => portionsIn(holders.find((h) => h.id === id), category, E, core);
const plan = (holders, grp, over = {}) => planConsumption({
  members: holders, group: grp, days: 3, foodPerDay: 1, waterPerDay: 1, pintsPerWaterRation: PINTS_PER_WATER_RATION, entries: E, ...over
});
const run = (members, grp, over) => {
  const p = plan(members, grp, over);
  return { p, after: applyChanges([...members, grp], p.changes) };
};

describe("planConsumption (C10, answers Q2)", () => {
  it("takes from the group first, then from the member's own sheet", () => {
    const members = [member("a", [rations("ra", 5)])];
    const grp = group("g", [rations("rg", 2)]);
    const { after } = run(members, grp);
    expect(left(after, "g", "food")).toBe(0);
    expect(left(after, "a", "food")).toBe(4);
  });

  it("the group stack is deleted when exhausted (autoDestroy), the member stack is kept", () => {
    const members = [member("a", [rations("ra", 5)])];
    const grp = group("g", [rations("rg", 2)]);
    const p = plan(members, grp);
    const gone = (p.changes.g?.delete ?? []).map((d) => d?._id ?? d);
    expect(gone).toContain("rg");
    expect((p.changes.a?.delete ?? []).length).toBe(0);
  });

  it("never takes from another member", () => {
    const members = [member("a", []), member("b", [rations("rb", 10)])];
    const grp = group("g", []);
    const { p, after } = run(members, grp);
    expect(left(after, "b", "food")).toBe(7); // only b's own 3 days
    expect(intakeSeries(p.intake, "a", "food")).toEqual([0, 0, 0]);
  });

  it("each member consumes foodPerDay x days from the sheet", () => {
    const members = [member("a", [rations("ra", 10)]), member("b", [rations("rb", 4)])];
    const { after } = run(members, group("g"), { days: 4, foodPerDay: 2 });
    expect(left(after, "a", "food")).toBe(2);
    expect(left(after, "b", "food")).toBe(0);
  });

  it("reports a shortage per day in the intake", () => {
    const members = [member("a", [rations("ra", 2)])];
    const { p } = run(members, group("g"));
    expect(intakeSeries(p.intake, "a", "food")).toEqual([1, 1, 0]);
  });

  it("water is counted in pints: one water ration = pintsPerWaterRation", () => {
    const members = [member("a", [waterskin2014("wa", 2)])]; // 8 pints
    const { p, after } = run(members, group("g"), { days: 2 });
    expect(left(after, "a", "water")).toBe(0);
    expect(intakeSeries(p.intake, "a", "water")).toEqual([4, 4]);
  });

  it("a 2014 waterskin with autoDestroy off is never deleted, even when empty", () => {
    const members = [member("a", [waterskin2014("wa", 1)])];
    const p = plan(members, group("g"), { days: 1 });
    expect((p.changes.a?.delete ?? [])).toEqual([]);
    expect(left(applyChanges([...members, group("g")], p.changes), "a", "water")).toBe(0);
  });

  it("2024 water pints inside containers are consumed; the container stays", () => {
    const members = [member("a", [
      container("skin", "Waterskin", "waterskin"),
      waterPint("p", 4, "skin")
    ])];
    const { after } = run(members, group("g"), { days: 1 });
    const a = after.find((h) => h.id === "a");
    expect(left(after, "a", "water")).toBe(0);
    expect(a.items.some((i) => i._id === "skin")).toBe(true);
    expect(a.items.some((i) => i._id === "p")).toBe(false);
  });

  it("a ration stack reduces by quantity; a partly used pile keeps its remaining portions", () => {
    const members = [member("a", [waterskin2014("wa", 3, 5)])]; // 7 pints
    const { after } = run(members, group("g"), { days: 1 });
    expect(left(after, "a", "water")).toBe(3);
  });

  it("foodPerDay = 0 (living off the land) consumes no food", () => {
    const members = [member("a", [rations("ra", 5)])];
    const { p, after } = run(members, group("g"), { foodPerDay: 0 });
    expect(left(after, "a", "food")).toBe(5);
    expect(intakeSeries(p.intake, "a", "food")).toEqual([0, 0, 0]);
  });

  it("waterPerDay = 2 consumes 8 pints a day", () => {
    const members = [member("a", [waterskin2014("wa", 6)])]; // 24 pints
    const { after } = run(members, group("g"), { days: 2, waterPerDay: 2 });
    expect(left(after, "a", "water")).toBe(8);
  });

  it("ignores unrecognised and camp objects", () => {
    const members = [member("a", [rations("ra", 1), camp("t", "Tent", "tent")])];
    const { after } = run(members, group("g"), { days: 1 });
    expect(after.find((h) => h.id === "a").items.map((i) => i._id)).toContain("t");
  });

  it("a member with nothing and a group with nothing: no change, no exception", () => {
    const p = plan([member("a", [])], group("g", []));
    expect(intakeSeries(p.intake, "a", "food")).toEqual([0, 0, 0]);
    expect(intakeSeries(p.intake, "a", "water")).toEqual([0, 0, 0]);
  });

  it("does not mutate its input", () => {
    const members = [member("a", [rations("ra", 5), waterskin2014("wa", 1)])];
    const grp = group("g", [rations("rg", 2)]);
    const before = clone([members, grp]);
    plan(members, grp);
    expect([members, grp]).toEqual(before);
  });

  it("a group item feeds several members in turn, once", () => {
    const members = [member("a", []), member("b", [])];
    const grp = group("g", [rations("rg", 4)]);
    const { p, after } = run(members, grp, { days: 2 });
    expect(left(after, "g", "food")).toBe(0);
    const total = intakeSeries(p.intake, "a", "food").concat(intakeSeries(p.intake, "b", "food")).reduce((s, x) => s + x, 0);
    expect(total).toBe(4);
  });
});

describe("planRemoval (event losses)", () => {
  const holders = () => [
    group("g", [rations("rg", 3)]),
    member("a", [rations("ra", 5)]),
    member("b", [rations("rb", 2)])
  ];

  it("removes from the group first", () => {
    const h = holders();
    const { changes, removed } = planRemoval(h, "food", 2, E);
    const after = applyChanges(h, changes);
    expect(removed).toBe(2);
    expect(left(after, "g", "food")).toBe(1);
    expect(left(after, "a", "food")).toBe(5);
  });

  it("then takes from members by decreasing stock", () => {
    const h = holders();
    const { changes, removed } = planRemoval(h, "food", 4, E);
    const after = applyChanges(h, changes);
    expect(removed).toBe(4);
    expect(left(after, "g", "food")).toBe(0);
    expect(left(after, "a", "food")).toBe(4);
    expect(left(after, "b", "food")).toBe(2);
  });

  it("caps at what exists", () => {
    const h = holders();
    const { changes, removed } = planRemoval(h, "food", 99, E);
    expect(removed).toBe(10);
    const after = applyChanges(h, changes);
    for (const id of ["g", "a", "b"]) expect(left(after, id, "food")).toBe(0);
  });

  it("only touches the requested category", () => {
    const h = [member("a", [rations("ra", 5), waterskin2014("wa", 1)])];
    const after = applyChanges(h, planRemoval(h, "water", 2, E).changes);
    expect(left(after, "a", "food")).toBe(5);
    expect(left(after, "a", "water")).toBe(2);
  });

  it("removing nothing changes nothing", () => {
    const h = holders();
    const { removed } = planRemoval(h, "food", 0, E);
    expect(removed).toBe(0);
  });
});

describe("fatigue DC penalty without rations (answers Q2)", () => {
  it.todo("a member who got no rations rolls the fatigue save at DC + 5, once per stage (no function carries it in the design signatures: see the report)");
});
