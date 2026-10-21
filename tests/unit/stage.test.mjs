import { describe, expect, it } from "vitest";
import {
  buildSaveQueue, createTravel, finishRun, isRunComplete, nextPendingSave, recordSave, setAction, setPace, startRun
} from "../../scripts/core/stage.mjs";
import { DEFAULT_TIERS } from "../helpers/builders.mjs";

const stages = [
  { id: "s1", name: "Road", days: 4, terrain: "road", dc: null, foodPerDay: 1, waterPerDay: 1, hoursPerDay: null },
  { id: "s2", name: "Hills", days: 2, terrain: "hills", dc: 12, foodPerDay: 1, waterPerDay: 2, hoursPerDay: null }
];
const make = () => createTravel({ name: "To the Grey Mountains", tableUuid: "RollTable.x", tiers: DEFAULT_TIERS, stages });
const start = (t, over = {}) => startRun(t, { members: ["a", "b"], pace: "normal", effectiveDays: 4, comfortBefore: 4.5, eventPlan: null, ...over });

describe("createTravel / startRun / finishRun (C7)", () => {
  it("creates a travel at the first stage with an empty history", () => {
    const t = make();
    expect(t.name).toBe("To the Grey Mountains");
    expect(t.stages).toHaveLength(2);
    expect(t.current).toBe(0);
    expect(t.history).toEqual([]);
    expect(t.run ?? null).toBeNull();
  });

  it("startRun returns a copy with the run set up; the original is untouched", () => {
    const t = make();
    const before = structuredClone(t);
    const t2 = start(t);
    expect(t).toEqual(before);
    expect(t2).not.toBe(t);
    expect(t2.run.members).toEqual(["a", "b"]);
    expect(t2.run.stageId).toBe("s1");
    expect(t2.run.effectiveDays).toBe(4);
    expect(t2.run.comfortBefore).toBe(4.5);
  });

  it("setPace updates the pace on a copy", () => {
    const t2 = start(make());
    const t3 = setPace(t2, "fast", 3);
    expect(t3.run.pace).toBe("fast");
    expect(t2.run.pace).toBe("normal");
  });

  it("setAction records one action per member (the last choice wins)", () => {
    let t = start(make());
    t = setAction(t, "a", { actionId: "hunt" });
    t = setAction(t, "a", { actionId: "guard" });
    expect(t.run.actions.a.actionId).toBe("guard");
    expect(Object.keys(t.run.actions)).toEqual(["a"]);
  });

  it("finishRun moves to the next stage and records the history", () => {
    const t = finishRun(start(make()), { cardId: "m1" });
    expect(t.current).toBe(1);
    expect(t.run ?? null).toBeNull();
    expect(t.history).toHaveLength(1);
  });

  it("finishing the last stage finishes the travel", () => {
    let t = finishRun(start(make()), {});
    t = finishRun(startRun(t, { members: ["a"], pace: "normal", effectiveDays: 2, comfortBefore: 0, eventPlan: null }), {});
    expect(t.status).toBe("finished");
  });
});

describe("buildSaveQueue (C11, C11b)", () => {
  const queue = (over = {}) => buildSaveQueue({ days: 2, hoursPerDay: 8, forcedMarch: true, privationByDay: [], fatigue: { dc: 13 }, ...over });

  it("without forced march nor privation, a single fatigue save at the end", () => {
    const q = queue();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "fatigue", dc: 13, levels: 1 });
  });

  it("forced march: one save per extra hour and per day, DC 10 + n, before the fatigue save", () => {
    const q = queue({ hoursPerDay: 10 });
    expect(q.map((s) => s.kind)).toEqual(["march", "march", "march", "march", "fatigue"]);
    expect(q.filter((s) => s.kind === "march").map((s) => s.dc)).toEqual([11, 12, 11, 12]);
    expect(q.filter((s) => s.kind === "march").map((s) => s.day)).toEqual([1, 1, 2, 2]);
  });

  it("the forced march setting can be turned off", () => {
    expect(queue({ hoursPerDay: 12, forcedMarch: false }).map((s) => s.kind)).toEqual(["fatigue"]);
  });

  it("a day's privation steps follow that day's march saves", () => {
    const q = queue({
      days: 2, hoursPerDay: 9,
      privationByDay: [[], [{ kind: "water", type: "auto", levels: 1, levelsIfExhausted: 2 }]]
    });
    expect(q.map((s) => `${s.kind}${s.day ?? ""}`)).toEqual(["march1", "march2", "water2", "fatigue"]);
    expect(q.find((s) => s.kind === "water")).toMatchObject({ auto: true });
  });

  it("every save starts without a result", () => {
    for (const s of queue({ hoursPerDay: 10 })) expect(s.result ?? null).toBeNull();
  });

  it("fatigue save disabled: none queued", () => {
    expect(queue({ fatigue: null }).filter((s) => s.kind === "fatigue")).toEqual([]);
  });
});

describe("save resolution, one at a time", () => {
  const withQueue = () => {
    let t = start(make());
    const saves = buildSaveQueue({ days: 1, hoursPerDay: 10, forcedMarch: true, privationByDay: [], fatigue: { dc: 12 } });
    t = { ...t, run: { ...t.run, phase: "saves", saves: { a: structuredClone(saves), b: structuredClone(saves) } } };
    return t;
  };

  it("nextPendingSave returns the first unresolved save of a member", () => {
    const t = withQueue();
    expect(nextPendingSave(t.run, "a")).toMatchObject({ index: 0 });
  });

  it("recordSave resolves in order and returns a copy", () => {
    const t = withQueue();
    const t2 = { ...t, run: recordSave(t.run, "a", 0, { total: 9, success: false, applied: true }) };
    expect(nextPendingSave(t2.run, "a")).toMatchObject({ index: 1 });
    expect(nextPendingSave(t.run, "a")).toMatchObject({ index: 0 });
    expect(nextPendingSave(t2.run, "b")).toMatchObject({ index: 0 });
  });

  it("the run is complete when every member has resolved every save", () => {
    let run = withQueue().run;
    expect(isRunComplete(run)).toBe(false);
    for (const id of ["a", "b"]) {
      for (let i = 0; i < run.saves[id].length; i++) run = recordSave(run, id, i, { total: 15, success: true, applied: false });
    }
    expect(isRunComplete(run)).toBe(true);
    expect(nextPendingSave(run, "a") ?? null).toBeNull();
  });
});
