/* global window */
import fs from "node:fs";
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { camp, container, rations, waterPint } from "../helpers/builders.mjs";
const bed = (key) => camp(key, "Bedroll", "bedroll");
import { install, settle } from "./helpers.mjs";

// A 3-member 2024 party: 6 rations and 8 pints each, a tent and two bedrolls (comfort 3, "rough", DC 13).
const ch = (id, name, items) => ({ id, name, type: "character", items });
const skin = (k, pints) => [container(`${k}-s`, "Waterskin", "waterskin"), waterPint(`${k}-p`, pints, `${k}-s`)];
const party = (over = {}) => ({
  id: "gp", name: "Party", rulesVersion: "modern", primaryVehicle: null, items: [],
  members: [
    ch("alba", "Alba", [rations("alba-r", 6), ...skin("alba", 8), camp("alba-t", "Tent", "tent"), bed("alba-b")]),
    ch("bran", "Bran", [rations("bran-r", 6), ...skin("bran", 8)]),
    ch("cora", "Cora", [rations("cora-r", 6), ...skin("cora", 8), bed("cora-b")])
  ],
  ...over
});
const stages = (extra = {}) => [
  { id: "s1", name: "Road", days: 4, terrain: "road", dc: null, foodPerDay: 1, waterPerDay: 1, hoursPerDay: null, ...extra },
  { id: "s2", name: "Hills", days: 2, terrain: "hills", dc: null, foodPerDay: 1, waterPerDay: 1, hoursPerDay: null }
];

test.beforeEach(async ({ gamePage }) => {
  await install(gamePage);
});
test.afterEach(async ({ gamePage }) => {
  await gamePage.evaluate(async () => {
    await game.settings.set("group-travel", "officialRules", { forcedMarch: true, privation: false });
    if (window.__gtActions) await game.settings.set("group-travel", "actions", window.__gtActions);
    window.__gtActions = null;
    await window.gtT.cleanup();
  });
});

/** Create the party and its travel in the client; returns ids. */
async function setup(foundry, { spec = party(), stage = {}, tableResults = null } = {}) {
  return foundry(async ({ spec, stages, tableResults }) => {
    const api = game.modules.get("group-travel").api;
    const { group, map } = await window.gtT.makeGroup(spec);
    let tableUuid = null;
    if (tableResults) tableUuid = (await window.gtT.makeTable("events", tableResults)).uuid;
    await api.saveTravel(group, { name: "To the Grey Mountains", tableUuid, stages });
    return { groupId: group.id, map };
  }, { spec, stages: stages(stage), tableResults });
}

test("C7: the travel is stored on the group, a single travel per group", async ({ foundry }) => {
  const r = await foundry(async ({ spec, stages }) => {
    const api = game.modules.get("group-travel").api;
    const { group } = await window.gtT.makeGroup(spec);
    await api.saveTravel(group, { name: "First", tableUuid: null, stages });
    const first = foundry.utils.deepClone(group.getFlag("group-travel", "travel"));
    await api.saveTravel(group, { name: "Second", tableUuid: null, stages });
    const second = group.getFlag("group-travel", "travel");
    await api.startStage(group);
    let secondStart = null;
    try { await api.startStage(group); } catch (e) { secondStart = e.message; }
    return { first, secondName: second.name, stages: second.stages.length, tiers: second.tiers.map((t) => t.dc), secondStart };
  }, { spec: party(), stages: stages() });
  fs.writeFileSync(test.info().outputPath("C7-voyage.json"), JSON.stringify(r, null, 2));
  expect(r.first.stages).toHaveLength(2);
  expect(r.first.stages[0]).toMatchObject({ days: 4, foodPerDay: 1, waterPerDay: 1, dc: null });
  expect(r.secondName).toBe("Second");
  expect(r.stages).toBe(2);
  expect(r.tiers).toEqual([8, 10, 13, 16]);
  expect(r.secondStart).toBeTruthy(); // a stage is already running
});

test("C7b: pace changes the effective days and the fatigue DC", async ({ foundry }) => {
  const { groupId } = await setup(foundry);
  const r = await foundry(async (id) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    await api.startStage(group);
    const out = {};
    for (const pace of ["normal", "fast", "slow"]) {
      await api.setPace(group, pace);
      const run = group.getFlag("group-travel", "travel").run;
      out[pace] = { days: run.effectiveDays, dc: api.buildTravelContext(group).fatigueDc };
    }
    return out;
  }, groupId);
  fs.writeFileSync(test.info().outputPath("C7b-allures.json"), JSON.stringify(r, null, 2));
  expect(r.normal.days).toBe(4);
  expect(r.fast.days).toBe(3);
  expect(r.slow.days).toBe(6);
  expect(r.fast.dc - r.normal.dc).toBe(2);
  expect(r.slow.dc - r.normal.dc).toBe(-2);
});

test("C8: example table, event drawn with roll() and applied at closure, table untouched", async ({ foundry }) => {
  const r = await foundry(async ({ spec, stages }) => {
    const api = game.modules.get("group-travel").api;
    const example = await api.createExampleTable();
    window.gtT.created.tables.push(example.id);
    const exampleInfo = { results: example.results.size, withEffects: example.results.filter((x) => x.flags["group-travel"]?.effects?.length).length };

    const { group, map } = await window.gtT.makeGroup(spec);
    const table = await window.gtT.makeTable("event", [{
      name: "Storm", effects: [{ type: "loseFood", amount: 3 }, { type: "damageItem", category: "shelter", count: 1, steps: 1 }, { type: "comfort", value: -1 }]
    }]);
    await api.saveTravel(group, { name: "T", tableUuid: table.uuid, stages });
    const tentId = window.gtT.idFor("alba-t");
    const food = () => ["alba", "bran", "cora"].map((k) => game.actors.get(map[k]).items.filter((i) => i.system.identifier === "rations").reduce((s, i) => s + i.system.quantity, 0));
    const foodBefore = food();
    await api.startStage(group);
    const run = group.getFlag("group-travel", "travel").run;
    const drawnBefore = table.results.filter((x) => x.drawn).length;
    await api.setPace(group, "normal");
    await api.closeStage(group, { autoRoll: true });
    const tent = game.actors.get(map.alba).items.get(tentId);
    const card = game.messages.find((m) => m.flags["group-travel"]?.card);
    return {
      exampleInfo, event: run.event.name, effects: run.event.effects, foodBefore, foodAfter: food(),
      tentCondition: tent.getFlag("group-travel", "condition") ?? "intact",
      drawnBefore, drawnAfter: table.results.filter((x) => x.drawn).length,
      tableUpdated: game.tables.get(table.id).results.map((x) => x.toObject().drawn),
      cardHasEvent: card?.content.includes("Storm")
    };
  }, { spec: party(), stages: stages({ days: 1 }) });
  fs.writeFileSync(test.info().outputPath("C8-evenement.json"), JSON.stringify(r, null, 2));
  expect(r.exampleInfo.results).toBeGreaterThanOrEqual(6);
  expect(r.exampleInfo.withEffects).toBeGreaterThanOrEqual(6);
  expect(r.event).toBe("Storm");
  expect(r.effects).toHaveLength(3);
  // 3 members x 1 day of food, plus 3 lost to the event.
  expect(r.foodBefore.reduce((a, b) => a + b)).toBe(18);
  expect(r.foodAfter.reduce((a, b) => a + b)).toBe(18 - 3 - 3);
  expect(r.tentCondition).toBe("worn");
  expect(r.drawnAfter).toBe(r.drawnBefore);
  expect(r.cardHasEvent).toBe(true);
});

test("C9 (GM): the four default actions and their effects", async ({ foundry }) => {
  const { groupId, map } = await setup(foundry);
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const actions = api.getRules().actions.map((a) => ({ id: a.id, dc: a.dc, effect: a.effect.type, check: a.check.type }));
    const tentId = window.gtT.idFor("alba-t");
    await api.setItemCondition(game.actors.get(map.alba).items.get(tentId), "damaged");
    await api.startStage(group);
    const foodOf = (k) => game.actors.get(map[k]).items.filter((i) => i.system.identifier === "rations").reduce((s, i) => s + i.system.quantity, 0);
    const before = foodOf("bran");
    await api.submitAction(group, map.alba, { actionId: "repair", targetItemUuid: game.actors.get(map.alba).items.get(tentId).uuid, success: true });
    await api.submitAction(group, map.bran, { actionId: "hunt", success: true });
    await api.submitAction(group, map.cora, { actionId: "camp", success: true });
    const run = group.getFlag("group-travel", "travel").run;
    return {
      actions,
      tent: game.actors.get(map.alba).items.get(tentId).getFlag("group-travel", "condition"),
      hunted: foodOf("bran") - before,
      comfortMods: run.comfortMods.map((m) => m.value),
      results: Object.fromEntries(Object.entries(run.actions).map(([k, v]) => [k, v.result?.success]))
    };
  }, { id: groupId, map });
  fs.writeFileSync(test.info().outputPath("C9-actions-mj.json"), JSON.stringify(r, null, 2));
  expect(r.actions.map((a) => a.id)).toEqual(expect.arrayContaining(["hunt", "repair", "camp", "guard"]));
  expect(r.tent).toBe("worn"); // damaged -> worn
  expect(r.hunted).toBeGreaterThanOrEqual(1);
  expect(r.hunted).toBeLessThanOrEqual(4);
  expect(r.comfortMods).toContain(2);
});

test("C9: a watch halves the event penalties (answers Q6)", async ({ foundry }) => {
  const { groupId, map } = await setup(foundry, {
    stage: { days: 1 }, tableResults: [{ name: "Raid", effects: [{ type: "loseFood", amount: 5 }, { type: "comfort", value: -4 }] }]
  });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    await api.startStage(group);
    await api.submitAction(group, map.alba, { actionId: "guard", success: true });
    await api.closeStage(group, { autoRoll: true });
    const card = game.messages.find((m) => m.flags["group-travel"]?.card);
    const travel = group.getFlag("group-travel", "travel");
    return { cardText: card.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "), history: travel.history.length };
  }, { id: groupId, map });
  fs.writeFileSync(test.info().outputPath("C9-garde.json"), JSON.stringify(r, null, 2));
  expect(r.cardText).toContain("Halved by the watch");
  expect(r.cardText).toMatch(/lose 2 ration|2 ration/i);
});

test("C10, C11, C11b, C12: closure consumes, queues the saves, applies failures one by one, posts the card", async ({ foundry, gamePage }) => {
  const { groupId, map } = await setup(foundry, { stage: { days: 2, hoursPerDay: 10, dc: 40 } });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    await api.startStage(group);
    await api.closeStage(group); // no autoRoll: inspect the queue first
    const run = group.getFlag("group-travel", "travel").run;
    const queue = run.saves[map.alba].map((s) => ({ kind: s.kind, day: s.day, dc: s.dc }));
    await api.rollPending(group);
    const travel = group.getFlag("group-travel", "travel");
    const card = game.messages.find((m) => m.flags["group-travel"]?.card);
    const ex = (k) => game.actors.get(map[k]).system.attributes.exhaustion;
    const portions = (k) => game.actors.get(map[k]).items.filter((i) => ["rations", "water-pint"].includes(i.system.identifier)).map((i) => [i.system.identifier, i.system.quantity]);
    return {
      queue, phase: run.phase, current: travel.current, run: travel.run, exhaustion: [ex("alba"), ex("bran"), ex("cora")],
      portions: portions("alba"), card: card?.content ?? "", effects: game.actors.get(map.alba).effects.map((e) => e.name)
    };
  }, { id: groupId, map });
  const text = r.card.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  fs.writeFileSync(test.info().outputPath("C12-carte.json"), JSON.stringify({ text, queue: r.queue, exhaustion: r.exhaustion }, null, 2));
  // C11b: 10 h => 2 extra hours per day, DC 11 and 12; C11: the fatigue save comes last.
  expect(r.queue.map((q) => q.kind)).toEqual(["march", "march", "march", "march", "fatigue"]);
  expect(r.queue.filter((q) => q.kind === "march").map((q) => q.dc)).toEqual([11, 12, 11, 12]);
  expect(r.queue.at(-1).dc).toBe(40);
  // C10: 2 days x 1 ration, 1 water ration (4 pints)
  expect(r.portions.find(([k]) => k === "rations")[1]).toBe(4);
  // C11: the fatigue save (DC 40) always fails; march saves (DC 11-12) may fail too
  for (const e of r.exhaustion) { expect(e).toBeGreaterThanOrEqual(1); expect(e).toBeLessThanOrEqual(5); }
  // C12: card sections, next stage current
  expect(text).toContain("Road");
  expect(text).toMatch(/Comfort/);
  expect(text).toContain("Alba");
  expect(text).toMatch(/Exhaustion 0 → [1-5]/);
  expect(text).toMatch(/house rule/i);
  expect(r.current).toBe(1);
  expect(r.run ?? null).toBeNull();
  await gamePage.evaluate(() => ui.sidebar?.changeTab?.("chat", "primary"));
  await settle(gamePage);
  await gamePage.screenshot({ path: test.info().outputPath("C12-carte-etape.png") });
});

test("C11: exhaustion is capped at 6 and disableExhaustion is respected", async ({ foundry }) => {
  const { groupId, map } = await setup(foundry, { stage: { days: 1, hoursPerDay: 12, dc: 40 } });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const alba = game.actors.get(map.alba);
    await alba.update({ "system.attributes.exhaustion": 5 });
    await api.startStage(group);
    await api.closeStage(group, { autoRoll: true });
    const capped = alba.system.attributes.exhaustion; // 5 + at least the fatigue failure, max 6
    await api.undoStage(group);
    await game.settings.set("dnd5e", "disableExhaustion", true);
    const bran = game.actors.get(map.bran).system.attributes.exhaustion;
    await api.startStage(group);
    await api.closeStage(group, { autoRoll: true });
    const text = game.messages.filter((m) => m.flags["group-travel"]?.card).at(-1).content.replace(/<[^>]+>/g, " ");
    const after = game.actors.get(map.bran).system.attributes.exhaustion;
    await game.settings.set("dnd5e", "disableExhaustion", false);
    return { capped, bran, after, text };
  }, { id: groupId, map });
  fs.writeFileSync(test.info().outputPath("C11-plafond-desactive.json"), JSON.stringify(r, null, 2));
  expect(r.capped).toBe(6);
  expect(r.after).toBe(r.bran);
  expect(r.text).toMatch(/disabled/i);
});

test("C15: a member removed during the travel is not counted at the next stage", async ({ foundry }) => {
  const { groupId, map } = await setup(foundry, { stage: { days: 1 } });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    await api.startStage(group);
    const first = group.getFlag("group-travel", "travel").run.members.length;
    await api.closeStage(group, { autoRoll: true });
    await group.update({ "system.members": group.system.members.filter((m) => m.actor.id !== map.cora).map((m) => ({ actor: m.actor.id })) });
    await api.startStage(group);
    return { first, second: group.getFlag("group-travel", "travel").run.members.length };
  }, { id: groupId, map });
  expect(r).toEqual({ first: 3, second: 2 });
});

test("C13, M5: undo restores every field (items, effects, exhaustion, flags), recreated items keep their ids", async ({ foundry }) => {
  // Alba: pile of rations fully eaten (deleted), tent damaged by the event then repaired, exhaustion 1 -> 2.
  // Bran: no exhaustion -> effect created; hunts rations (created item); no water -> dehydration state.
  // Cora: 2024 water pint stack deleted inside a waterskin; level 5 -> 6.
  const spec = party({
    members: [
      ch("alba", "Alba", [rations("alba-r", 2), ...skin("alba", 8), camp("alba-t", "Tent", "tent")]),
      ch("bran", "Bran", [...skin("bran", 0).slice(0, 1)]),
      ch("cora", "Cora", [rations("cora-r", 6), ...skin("cora", 4), camp("cora-b", "Bedroll", "bedroll")])
    ]
  });
  const { groupId, map } = await setup(foundry, {
    spec, stage: { days: 2, dc: 40 },
    tableResults: [{ name: "Rain", effects: [{ type: "damageItem", category: "shelter", count: 1, steps: 1 }] }]
  });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    window.__gtActions = foundry.utils.deepClone(api.getRules().actions);
    await game.settings.set("group-travel", "actions", window.__gtActions.map((a) => (a.id === "hunt" ? { ...a, effect: { ...a.effect, formula: "4" } } : a)));
    await game.settings.set("group-travel", "officialRules", { forcedMarch: true, privation: true });
    await game.actors.get(map.alba).update({ "system.attributes.exhaustion": 1 });
    await game.actors.get(map.cora).update({ "system.attributes.exhaustion": 5 });
    await new Promise((r) => setTimeout(r, 500));
    const before = window.gtT.canon(group);
    await api.startStage(group);
    const tent = game.actors.get(map.alba).items.get(window.gtT.idFor("alba-t"));
    await api.submitAction(group, map.alba, { actionId: "repair", targetItemUuid: tent.uuid, success: true });
    await api.submitAction(group, map.bran, { actionId: "hunt", success: true });
    await api.closeStage(group, { autoRoll: true });
    const mid = window.gtT.canon(group);
    const midInfo = {
      exhaustion: ["alba", "bran", "cora"].map((k) => game.actors.get(map[k]).system.attributes.exhaustion),
      albaRationsGone: !game.actors.get(map.alba).items.get(window.gtT.idFor("alba-r")),
      coraPintGone: !game.actors.get(map.cora).items.get(window.gtT.idFor("cora-p")),
      branStates: game.actors.get(map.bran).effects.map((e) => e.name),
      created: game.actors.get(map.bran).items.filter((i) => i.flags["group-travel"]?.created).length
    };
    await api.undoStage(group);
    await new Promise((r) => setTimeout(r, 500));
    const after = window.gtT.canon(group);
    const differences = window.gtT.diff(before, after);
    const movedIds = Object.keys(before).every((a) => JSON.stringify(before[a].items.map((i) => i._id)) === JSON.stringify(after[a].items.map((i) => i._id)));
    return { differences, midChanged: window.gtT.diff(before, mid).length, midInfo, movedIds };
  }, { id: groupId, map });
  fs.writeFileSync(test.info().outputPath("M5-fidelite-annulation.json"), JSON.stringify(r, null, 2));
  expect(r.midChanged).toBeGreaterThan(5); // the stage really changed things
  expect(r.midInfo.albaRationsGone).toBe(true);
  expect(r.midInfo.coraPintGone).toBe(true);
  expect(r.midInfo.created).toBeGreaterThan(0);
  expect(r.movedIds).toBe(true);
  expect(r.differences).toEqual([]);
});

test("M5b: undo restores every field when exhaustion effects are only created (no existing level raised)", async ({ foundry }) => {
  // Alba: pile of rations fully eaten (deleted), tent damaged by the event then repaired, exhaustion 1 -> 2.
  // Bran: no exhaustion -> effect created; hunts rations (created item); no water -> dehydration state.
  // Cora: 2024 water pint stack deleted inside a waterskin; level 5 -> 6.
  const spec = party({
    members: [
      ch("alba", "Alba", [rations("alba-r", 2), ...skin("alba", 8), camp("alba-t", "Tent", "tent")]),
      ch("bran", "Bran", [...skin("bran", 0).slice(0, 1)]),
      ch("cora", "Cora", [rations("cora-r", 6), ...skin("cora", 4), camp("cora-b", "Bedroll", "bedroll")])
    ]
  });
  const { groupId, map } = await setup(foundry, {
    spec, stage: { days: 2, dc: 40 },
    tableResults: [{ name: "Rain", effects: [{ type: "damageItem", category: "shelter", count: 1, steps: 1 }] }]
  });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    window.__gtActions = foundry.utils.deepClone(api.getRules().actions);
    await game.settings.set("group-travel", "actions", window.__gtActions.map((a) => (a.id === "hunt" ? { ...a, effect: { ...a.effect, formula: "4" } } : a)));
    await game.settings.set("group-travel", "officialRules", { forcedMarch: true, privation: true });
            await new Promise((r) => setTimeout(r, 500));
    const before = window.gtT.canon(group);
    await api.startStage(group);
    const tent = game.actors.get(map.alba).items.get(window.gtT.idFor("alba-t"));
    await api.submitAction(group, map.alba, { actionId: "repair", targetItemUuid: tent.uuid, success: true });
    await api.submitAction(group, map.bran, { actionId: "hunt", success: true });
    await api.closeStage(group, { autoRoll: true });
    const mid = window.gtT.canon(group);
    const midInfo = {
      exhaustion: ["alba", "bran", "cora"].map((k) => game.actors.get(map[k]).system.attributes.exhaustion),
      albaRationsGone: !game.actors.get(map.alba).items.get(window.gtT.idFor("alba-r")),
      coraPintGone: !game.actors.get(map.cora).items.get(window.gtT.idFor("cora-p")),
      branStates: game.actors.get(map.bran).effects.map((e) => e.name),
      created: game.actors.get(map.bran).items.filter((i) => i.flags["group-travel"]?.created).length
    };
    await api.undoStage(group);
    await new Promise((r) => setTimeout(r, 500));
    const after = window.gtT.canon(group);
    const differences = window.gtT.diff(before, after);
    const movedIds = Object.keys(before).every((a) => JSON.stringify(before[a].items.map((i) => i._id)) === JSON.stringify(after[a].items.map((i) => i._id)));
    return { differences, midChanged: window.gtT.diff(before, mid).length, midInfo, movedIds };
  }, { id: groupId, map });
  fs.writeFileSync(test.info().outputPath("M5b-fidelite-annulation-sans-niveau-existant.json"), JSON.stringify(r, null, 2));
  expect(r.midChanged).toBeGreaterThan(5); // the stage really changed things
  expect(r.midInfo.albaRationsGone).toBe(true);
  expect(r.midInfo.coraPintGone).toBe(true);
  expect(r.midInfo.created).toBeGreaterThan(0);
  expect(r.movedIds).toBe(true);
  expect(r.differences).toEqual([]);
});
