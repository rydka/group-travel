// GM operations: the active GM is the only writer (design "Droits").
// Every public operation runs in a serial queue, so that concurrent player
// requests never interleave their read-modify-write of the travel flag.
import { CONDITIONS, MODULE_ID, PACES, stepCondition } from "../core/constants.mjs";
import { classifyItem } from "../core/recognition.mjs";
import { aggregateInventory, itemCondition } from "../core/inventory.mjs";
import { applyChangesToHolders, mergeChanges, planConsumption, planRemoval } from "../core/consumption.mjs";
import { planEvent, readEventEffects } from "../core/events.mjs";
import { actionOutcome } from "../core/actions.mjs";
import { dailyPrivation } from "../core/privation.mjs";
import { effectiveDays, stageDc } from "../core/pace.mjs";
import {
  buildSaveQueue, createTravel as coreCreateTravel, currentStage, finishRun, isRunComplete, nextPendingSave, normalizeStage,
  recordActionResult, recordSave, setAction, setPace as coreSetPace, startRun
} from "../core/stage.mjs";
import { getRules } from "./settings.mjs";
import { getTravel, getUndo, maxExhaustion, readHolders, readMemberState } from "./read.mjs";
import { computeGroupState, stateFromRead } from "./state.mjs";
import { captureSnapshot, restoreSnapshot } from "./snapshot.mjs";
import { rollSave } from "./rolls.mjs";
import { postStageCard, markCardUndone } from "./chat.mjs";

const loc = (key) => game.i18n.localize(key);
const RATIONS_UUID = { legacy: "Compendium.dnd5e.items.Item.f4w4GxBi0nYXmhX4", modern: "Compendium.dnd5e.equipment24.Item.phbagRations0000" };
const WATER_PINT_UUID = "Compendium.dnd5e.equipment24.Item.phbWaterpint0000";

/* -------------------------------------------- */
/*  Serial queue                                */
/* -------------------------------------------- */

let queue = Promise.resolve();
/** Run an operation after every previous one. */
export function serial(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}

/** The active GM is the only writer. */
function assertGM() {
  if (!game.user.isActiveGM) throw new Error(loc(`${MODULE_ID}.Errors.gmOnly`));
}

/** A GM who is not the active GM: his operations go to the active GM through the request. */
const isOtherGM = () => game.user.isGM && !game.user.isActiveGM;

/** Send an operation to the active GM (the queries module imports this one: lazy import). */
async function forward(op, data) {
  const { request } = await import("./queries.mjs");
  return request(op, data);
}

function requireTravel(group) {
  const travel = getTravel(group);
  if (!travel) throw new Error(loc(`${MODULE_ID}.Errors.noTravel`));
  return travel;
}

async function writeTravel(group, travel, extra = {}) {
  await group.update({ [`flags.${MODULE_ID}.travel`]: _replace(travel), ...extra });
}

/**
 * The camp item a repair may target: an item of a world actor that is a member
 * of the run or the group itself, recognised as a camp item (not food or water).
 * @param {Actor} group
 * @param {object} run
 * @param {string} uuid
 * @param {object[]} entries
 * @returns {Item}
 */
function campTarget(group, run, uuid, entries) {
  const fail = () => new Error(loc(`${MODULE_ID}.Errors.badTarget`));
  let item;
  try { item = fromUuidSync(uuid); } catch { item = null; }
  const holder = item?.documentName === "Item" ? item.parent : null;
  if (!holder || holder.documentName !== "Actor" || game.actors.get(holder.id) !== holder) throw fail();
  if (holder.id !== group.id && !run.members.includes(holder.id)) throw fail();
  const category = classifyItem(item, entries)?.category;
  if (!category || category === "food" || category === "water") throw fail();
  return item;
}

/** Refuse a roll message already used during the run, then record it (on the given run object). */
function consumeMessage(run, messageId) {
  if (!messageId) return;
  run.usedMessages ??= [];
  if (run.usedMessages.includes(messageId)) throw new Error(loc(`${MODULE_ID}.Errors.rollUsed`));
  run.usedMessages.push(messageId);
}

/** Apply a { [actorId]: { update, delete } } plan to the documents. */
async function applyChanges(actors, changes) {
  for (const [id, c] of Object.entries(changes ?? {})) {
    const actor = actors.get(id) ?? game.actors.get(id);
    if (!actor) continue;
    if (c.update?.length) await actor.updateEmbeddedDocuments("Item", c.update);
    if (c.delete?.length) await actor.deleteEmbeddedDocuments("Item", c.delete);
  }
}

/* -------------------------------------------- */
/*  Travel                                      */
/* -------------------------------------------- */

/** The running stage keeps its place and its content in the new stage list. */
function sameRunningStage(before, after) {
  const i = before.current;
  const old = before.stages[i];
  const now = after.stages[i];
  return !!old && !!now && old.id === before.run.stageId
    && JSON.stringify(normalizeStage(old)) === JSON.stringify(normalizeStage(now));
}

/**
 * Create or replace the travel of a group (GM). Only one travel per group:
 * while a stage is in progress, that stage can be neither removed nor changed.
 * @param {Actor} group
 * @param {{ name, tableUuid, tiers, stages }} data
 */
export function saveTravel(group, data) {
  if (isOtherGM()) return forward("saveTravel", { groupUuid: group.uuid, travel: data });
  return serial(async () => {
    assertGM();
    const existing = getTravel(group);
    let travel;
    if (existing) {
      travel = structuredClone(existing);
      travel.name = data.name ?? travel.name;
      travel.tableUuid = data.tableUuid ?? null;
      if (data.tiers) travel.tiers = structuredClone(data.tiers);
      if (data.stages) {
        travel.stages = coreCreateTravel({ stages: data.stages }).stages;
        if (travel.run && !sameRunningStage(existing, travel)) throw new Error(loc(`${MODULE_ID}.Errors.stageLocked`));
      }
      if (!travel.run) {
        travel.current = Math.min(travel.current, travel.stages.length);
        travel.status = travel.current >= travel.stages.length ? (travel.history.length ? "finished" : "planning")
          : travel.history.length ? "active" : "planning";
      }
    } else {
      const rules = getRules();
      travel = coreCreateTravel({ ...data, tiers: data.tiers ?? rules.tiers.map((t) => ({ ...t, name: loc(t.name) })) });
    }
    await writeTravel(group, travel);
    return travel;
  });
}

/** Delete the travel of a group (GM). */
export function deleteTravel(group) {
  if (isOtherGM()) return forward("deleteTravel", { groupUuid: group.uuid });
  return serial(async () => {
    assertGM();
    await group.update({ [`flags.${MODULE_ID}.travel`]: null, [`flags.${MODULE_ID}.undo`]: null });
  });
}

/** Set the condition of a camp item (GM). */
export function setItemCondition(item, condition) {
  if (isOtherGM()) return forward("setItemCondition", { itemUuid: item.uuid, condition });
  return serial(async () => {
    assertGM();
    if (!CONDITIONS.includes(condition)) throw new Error(`Unknown condition ${condition}`);
    await item.update({ [`flags.${MODULE_ID}.condition`]: condition });
  });
}

/* -------------------------------------------- */
/*  Stage start                                 */
/* -------------------------------------------- */

/**
 * HTML of a table result, shown to every user: same as TableResult#getHTML but
 * always enriched without secrets (getHTML keeps them for the GM who draws).
 */
async function eventHtml(result) {
  const documentLink = result.documentToAnchor?.()?.outerHTML ?? null;
  const description = await foundry.applications.ux.TextEditor.implementation.enrichHTML(result.description ?? "", {
    relativeTo: result, secrets: false
  });
  const data = { result: { name: result.name, documentLink, description } };
  return foundry.applications.handlebars.renderTemplate("templates/sheets/roll-table/result-details.hbs", data);
}

async function drawEvent(tableUuid) {
  if (!tableUuid) return null;
  const table = await fromUuid(tableUuid);
  if (!table) {
    ui.notifications.warn(loc(`${MODULE_ID}.Warnings.noTable`));
    return null;
  }
  const { roll, results } = await table.roll();
  const result = results?.[0];
  if (!result) return null;
  const { effects, warnings } = readEventEffects(result.flags);
  for (const w of warnings) ui.notifications.warn(loc(w));
  const html = await eventHtml(result);
  const name = result.name || String(result.description ?? "").replace(/<[^>]+>/g, "").trim() || table.name;
  return { resultUuid: result.uuid, name, html, effects, roll: roll?.total ?? null };
}

function defaultPace(group) {
  const pace = group.system.getTravelPace?.().pace?.value;
  return PACES.includes(pace) ? pace : "normal";
}

/** Start the current stage (GM): snapshot, event draw, phase "actions". */
export function startStage(group) {
  if (isOtherGM()) return forward("startStage", { groupUuid: group.uuid });
  return serial(async () => {
    assertGM();
    const travel = requireTravel(group);
    if (travel.run) throw new Error(loc(`${MODULE_ID}.Errors.stageRunning`));
    const stage = currentStage(travel);
    if (!stage) throw new Error(loc(`${MODULE_ID}.Errors.noStage`));
    const rules = getRules();
    const ids = (group.system.creatures ?? []).map((a) => a.id);
    const pace = defaultPace(group);
    const runId = foundry.utils.randomID();
    const undo = captureSnapshot(group, ids, { runId, travel, entries: rules.recognition });
    const event = await drawEvent(travel.tableUuid);
    const state = computeGroupState(group, { rules, travel, ids });
    const next = startRun(travel, {
      members: ids, pace, effectiveDays: effectiveDays(stage.days, pace, rules.pace),
      comfortBefore: state.comfort.score, eventPlan: null, runId, event
    });
    next.run.guarded = false;
    next.run.tierBefore = state.tier ? { id: state.tier.id, name: state.tier.name, dc: state.tier.dc } : null;
    await group.update({
      [`flags.${MODULE_ID}.travel`]: _replace(next),
      [`flags.${MODULE_ID}.undo`]: _replace(undo)
    });
    return next;
  });
}

/* -------------------------------------------- */
/*  Pace and actions                            */
/* -------------------------------------------- */

/** Change the pace of the running stage (GM or group owner, through a request). */
export function setPace(group, pace) {
  return serial(async () => {
    const travel = requireTravel(group);
    if (travel.run?.phase !== "actions") throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
    if (!PACES.includes(pace)) throw new Error(`Unknown pace ${pace}`);
    const stage = travel.stages.find((s) => s.id === travel.run.stageId);
    const rules = getRules();
    await writeTravel(group, coreSetPace(travel, pace, effectiveDays(stage?.days ?? 0, pace, rules.pace)));
  });
}

/** Choose a member's action (owner of the member or GM, through a request). */
export function chooseAction(group, actorId, { actionId, targetItemUuid = null }) {
  return serial(async () => {
    const travel = requireTravel(group);
    const run = travel.run;
    if (run?.phase !== "actions") throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
    if (!run.members.includes(actorId)) throw new Error(loc(`${MODULE_ID}.Errors.notMember`));
    if (run.actions?.[actorId]?.result) throw new Error(loc(`${MODULE_ID}.Errors.actionDone`));
    const rules = getRules();
    if (actionId && !rules.actions.some((a) => a.id === actionId)) throw new Error(`Unknown action ${actionId}`);
    if (actionId && targetItemUuid) campTarget(group, run, targetItemUuid, rules.recognition);
    let next;
    if (!actionId) {
      next = structuredClone(travel);
      delete next.run.actions[actorId];
    } else next = setAction(travel, actorId, { actionId, targetItemUuid: targetItemUuid || null });
    await writeTravel(group, next);
  });
}

/** Add food (rations) or water (pints) to a member, from the dnd5e compendiums. */
async function addProvisions(actor, kind, amount, { rules, runId }) {
  if (amount <= 0) return null;
  const entries = rules.recognition;
  const identifier = kind === "food" ? "rations" : "water-pint";
  const stack = actor.items.find((i) => i.system?.identifier === identifier && !i.system?.container
    && classifyItem(i, entries)?.category === (kind === "food" ? "food" : "water"));
  if (stack) {
    await stack.update({ "system.quantity": (Number(stack.system.quantity) || 0) + amount });
    return null;
  }
  const uuid = kind === "food" ? RATIONS_UUID[rules.rulesVersion === "legacy" ? "legacy" : "modern"] : WATER_PINT_UUID;
  const source = await fromUuid(uuid).catch(() => null);
  const data = source ? source.toObject() : {
    name: kind === "food" ? "Rations" : "Water (Pint)", type: "consumable",
    system: { identifier, type: { value: "food" }, uses: { max: "1", spent: 0, autoDestroy: true } }
  };
  delete data._id;
  foundry.utils.setProperty(data, "system.quantity", amount);
  foundry.utils.setProperty(data, `flags.${MODULE_ID}.created`, { runId });
  const [created] = await actor.createEmbeddedDocuments("Item", [data]);
  return created?.uuid ?? null;
}

/** Make sure the undo snapshot of the run holds the condition of a camp item before it changes. */
async function keepConditionInSnapshot(group, run, item) {
  const undo = getUndo(group);
  if (!undo || undo.runId !== run.id) return;
  const holderId = item.parent.id;
  if (Object.hasOwn(undo.actors?.[holderId]?.conditions ?? {}, item.id)) return;
  await group.update({
    [`flags.${MODULE_ID}.undo.actors.${holderId}.conditions.${item.id}`]: item.flags?.[MODULE_ID]?.condition ?? null
  });
}

/**
 * Apply the result of a member's action check (GM).
 * @param {Actor} group
 * @param {string} actorId
 * @param {{ success: boolean, total: number|null, messageId?: string }} result
 */
export function applyActionResult(group, actorId, result) {
  if (isOtherGM()) return forward("applyActionResult", { groupUuid: group.uuid, actorId, result });
  return serial(() => applyActionResultNow(group, actorId, result));
}

async function applyActionResultNow(group, actorId, { success, total = null, messageId = null }) {
  assertGM();
  const travel = requireTravel(group);
  const run = travel.run;
  const choice = run?.actions?.[actorId];
  if (run?.phase !== "actions" || !choice) throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
  if (choice.result) throw new Error(loc(`${MODULE_ID}.Errors.actionDone`));
  consumeMessage(run, messageId);
  const rules = getRules();
  const action = rules.actions.find((a) => a.id === choice.actionId);
  const outcome = actionOutcome(action, { success });
  const actor = game.actors.get(actorId);
  let next = structuredClone(travel);
  let detail = "";
  if (outcome && actor) {
    switch (outcome.type) {
      case "addFood":
      case "addWater": {
        const roll = await new Roll(outcome.formula).evaluate();
        const n = Math.max(0, Math.floor(roll.total));
        const kind = outcome.type === "addFood" ? "food" : "water";
        const amount = kind === "water" ? n * rules.water.pintsPerWaterRation : n;
        const uuid = await addProvisions(actor, kind, amount, { rules, runId: run.id });
        if (uuid) next.run.createdItems.push(uuid);
        detail = game.i18n.format(`${MODULE_ID}.Run.added.${kind}`, { n });
        break;
      }
      case "repair": {
        const item = choice.targetItemUuid ? campTarget(group, run, choice.targetItemUuid, rules.recognition) : null;
        if (item) {
          await keepConditionInSnapshot(group, run, item);
          const to = stepCondition(itemCondition(item), outcome.steps);
          await item.update({ [`flags.${MODULE_ID}.condition`]: to });
          detail = `${item.name} → ${loc(`${MODULE_ID}.Condition.${to}`)}`;
        }
        break;
      }
      case "comfort":
        next.run.comfortMods.push({ source: "action", label: action.label, value: outcome.value });
        detail = `${loc(`${MODULE_ID}.Tab.comfort`)} ${outcome.value > 0 ? "+" : ""}${outcome.value}`;
        break;
      case "guard":
        next.run.guarded = true;
        detail = loc(`${MODULE_ID}.Run.guarded`);
        break;
    }
  }
  next = recordActionResult(next, actorId, { total, success: !!success, outcome, detail, messageId });
  await writeTravel(group, next);
  return { outcome, detail };
}

/* -------------------------------------------- */
/*  Stage closure                               */
/* -------------------------------------------- */

/**
 * Close the running stage (GM): event effects (halved by a successful guard),
 * consumption, comfort after, save queues. With autoRoll, the GM rolls every
 * save at once (tests, M3).
 * @param {Actor} group
 * @param {{ autoRoll?: boolean }} [options]
 */
export function closeStage(group, { autoRoll = false } = {}) {
  if (isOtherGM()) return forward("closeStage", { groupUuid: group.uuid, autoRoll });
  return serial(async () => {
    await closeStageNow(group);
    if (autoRoll) await rollPendingNow(group, null);
    return maybeFinalize(group);
  });
}

async function closeStageNow(group) {
  assertGM();
  const original = requireTravel(group);
  const travel = structuredClone(original);
  const run = travel.run;
  if (run?.phase !== "actions") throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
  const stage = travel.stages.find((s) => s.id === run.stageId);
  if (!stage) throw new Error(loc(`${MODULE_ID}.Errors.noStage`));
  const rules = getRules();
  const entries = rules.recognition;
  const ppwr = rules.water.pintsPerWaterRation;
  const ids = run.members.filter((id) => game.actors.get(id));

  // Everything is planned on plain data before anything is written.
  const before = Object.fromEntries(ids.map((id) => [id, readMemberState(game.actors.get(id))]));
  const read = readHolders(group, ids);
  let holders = read.holders;
  const plans = [];
  const step = (changes) => {
    plans.push(changes);
    holders = applyChangesToHolders(holders, changes);
  };

  // 1. Event effects
  const eventPlan = planEvent(run.event?.effects ?? [], {
    inventory: aggregateInventory(holders, entries), guarded: !!run.guarded,
    pintsPerWaterRation: ppwr, label: run.event?.name ?? ""
  });
  const lost = { food: 0, water: 0 };
  if (eventPlan.losses.food) {
    const { changes, removed } = planRemoval(holders, "food", eventPlan.losses.food, entries);
    step(changes);
    lost.food = removed;
  }
  if (eventPlan.losses.waterPints) {
    const { changes, removed } = planRemoval(holders, "water", eventPlan.losses.waterPints, entries);
    step(changes);
    lost.water = removed / ppwr;
  }
  const damaged = [];
  const conditionChanges = {};
  for (const c of eventPlan.conditionChanges) {
    const item = c.itemId ? read.actors.get(c.holderId)?.items.get(c.itemId) : null;
    if (!item) continue;
    (conditionChanges[c.holderId] ??= { update: [] }).update.push({ _id: c.itemId, [`flags.${MODULE_ID}.condition`]: c.to });
    damaged.push(`${item.name}: ${loc(`${MODULE_ID}.Condition.${c.from}`)} → ${loc(`${MODULE_ID}.Condition.${c.to}`)}`);
  }
  step(conditionChanges);
  run.comfortMods.push(...eventPlan.comfortMods);
  run.eventResult = { guarded: !!run.guarded, lost, damaged, comfort: eventPlan.comfortMods.map((m) => m.value) };

  // 2. Consumption: group first, then the member's own sheet
  const members = holders.filter((h) => h.kind === "member");
  const consumption = planConsumption({
    members, group: holders.find((h) => h.kind === "group"), days: run.effectiveDays,
    foodPerDay: stage.foodPerDay, waterPerDay: stage.waterPerDay, pintsPerWaterRation: ppwr, entries
  });
  step(consumption.changes);
  const groupShortage = {
    food: Object.values(consumption.shortage).some((s) => s.food),
    water: Object.values(consumption.shortage).some((s) => s.water)
  };

  // 3. Comfort after and tier
  const state = stateFromRead({ members, holders }, { rules, travel, mods: run.comfortMods, shortage: groupShortage });
  const tier = state.tier;

  // 4. Save queues
  const hoursPerDay = stage.hoursPerDay ?? group.system.attributes?.travel?.time ?? 8;
  run.saves = {};
  run.memberInfo = {};
  travel.counters ??= {};
  for (const id of ids) {
    const shortage = consumption.shortage[id] ?? { food: false, water: false };
    const dc = stageDc({
      stageDc: stage.dc, tierDc: tier?.dc ?? 10, pace: run.pace, paceRules: rules.pace,
      shortage: shortage.food || shortage.water, shortagePenalty: rules.shortage.dcPenalty
    });
    const privationByDay = [];
    const privation = [];
    if (rules.officialRules.privation) {
      let counter = travel.counters[id]?.daysWithoutFood ?? 0;
      for (const day of consumption.intake[id] ?? []) {
        const r = dailyPrivation({
          rulesVersion: rules.rulesVersion,
          food: { need: stage.foodPerDay, got: day.food },
          water: { need: stage.waterPerDay, got: day.water / ppwr },
          counter, conMod: before[id].conMod
        });
        counter = r.counter;
        privationByDay.push(r.steps);
        privation.push({ day: day.day, statuses: r.statuses, clear: r.clear });
      }
      travel.counters[id] = { daysWithoutFood: counter };
    }
    run.saves[id] = buildSaveQueue({
      days: run.effectiveDays, hoursPerDay, forcedMarch: rules.officialRules.forcedMarch, privationByDay,
      fatigue: rules.fatigueSave ? { dc: dc.dc } : null
    });
    run.memberInfo[id] = {
      dc, shortage, privation,
      intake: (consumption.intake[id] ?? []).map((d) => ({ day: d.day, food: d.food, water: d.water / ppwr })),
      before: before[id]
    };
  }
  run.phase = "saves";
  run.consumption = {
    groupShortage, foodPerDay: stage.foodPerDay, waterPerDay: stage.waterPerDay,
    comfortAfter: state.comfort.score, tier: tier ? { id: tier.id, name: tier.name, dc: tier.dc } : null
  };

  // 5. Write: documents, travel, automatic levels (no roll). Any error restores
  // the documents and the travel as they were before the closure.
  const guard = captureSnapshot(group, ids, { runId: run.id, travel: original, entries });
  try {
    await applyChanges(read.actors, mergeChanges(...plans));
    await writeTravel(group, travel);
    for (const id of ids) await advance(group, id);
  } catch (err) {
    await rollbackClosure(group, guard, entries);
    throw err;
  }
}

/** Restore the documents and the travel as they were before a failed closure. */
async function rollbackClosure(group, guard, entries) {
  try {
    await restoreSnapshot(guard, entries);
    await writeTravel(group, guard.travel);
  } catch (err) {
    console.error(`${MODULE_ID} | closure rollback failed`, err);
  }
}

/** Apply a failed save or an automatic level to a member. */
async function applyFailure(actor, save, rules) {
  const max = maxExhaustion();
  const beforeLevel = Number(actor.system.attributes?.exhaustion) || 0;
  const wanted = save.levelsIfExhausted !== undefined && beforeLevel >= 1 ? save.levelsIfExhausted : save.levels ?? 1;
  if (rules.disableExhaustion) return { applied: false, disabled: true, levels: wanted, before: beforeLevel, after: beforeLevel };
  const add = Math.max(0, Math.min(wanted, max - beforeLevel));
  if (add > 0) await actor.toggleStatusEffect("exhaustion", { levels: add });
  const after = Number(actor.system.attributes?.exhaustion) || 0;
  return { applied: add > 0, levels: add, before: beforeLevel, after };
}

/** Resolve automatic entries of a member's queue, until a roll is needed. */
async function advance(group, actorId) {
  const rules = getRules();
  for (;;) {
    const travel = getTravel(group);
    const next = nextPendingSave(travel?.run, actorId);
    if (!next) return;
    const actor = game.actors.get(actorId);
    let result = null;
    if (!actor) result = { total: null, success: null, applied: false, skipped: "missing" };
    else if (!rules.disableExhaustion && (Number(actor.system.attributes?.exhaustion) || 0) >= maxExhaustion()) {
      result = { total: null, success: null, applied: false, skipped: "max" };
    } else if (next.save.auto) {
      result = { total: null, success: false, ...(await applyFailure(actor, next.save, rules)) };
    }
    if (!result) return;
    result.status = !result.success && !result.skipped ? next.save.status ?? null : null;
    travel.run = recordSave(travel.run, actorId, next.index, result);
    await writeTravel(group, travel);
  }
}

/**
 * Resolve the next save of a member (GM). The failure is applied before the
 * next roll is allowed (2024 exhaustion penalty, R2).
 */
export function resolveSave(group, actorId, result) {
  if (isOtherGM()) return forward("resolveSave", { groupUuid: group.uuid, actorId, result });
  return serial(async () => {
    await resolveSaveNow(group, actorId, result);
    return maybeFinalize(group);
  });
}

async function resolveSaveNow(group, actorId, { index, success, total = null, messageId = null }) {
  assertGM();
  const travel = requireTravel(group);
  if (travel.run?.phase !== "saves") throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
  const next = nextPendingSave(travel.run, actorId);
  if (!next || next.index !== index) throw new Error(loc(`${MODULE_ID}.Errors.saveOrder`));
  consumeMessage(travel.run, messageId);
  const actor = game.actors.get(actorId);
  const rules = getRules();
  let result = { total, success: !!success, applied: false, messageId };
  if (!success && actor) result = { ...result, ...(await applyFailure(actor, next.save, rules)), status: next.save.status ?? null };
  travel.run = recordSave(travel.run, actorId, index, result);
  await writeTravel(group, travel);
  await advance(group, actorId);
}

/** Roll every pending save (GM), for all members or the given ones, without chat messages. */
export function rollPending(group, { actorIds = null } = {}) {
  if (isOtherGM()) return forward("rollPending", { groupUuid: group.uuid, actorIds });
  return serial(async () => {
    await rollPendingNow(group, actorIds);
    return maybeFinalize(group);
  });
}

async function rollPendingNow(group, actorIds) {
  assertGM();
  const travel = requireTravel(group);
  if (travel.run?.phase !== "saves") return;
  const ids = actorIds ?? travel.run.members;
  for (const id of ids) {
    const actor = game.actors.get(id);
    for (;;) {
      const next = nextPendingSave(getTravel(group)?.run, id);
      if (!next || !actor) break;
      const { roll } = await rollSave(actor, next.save, { create: false, configure: false });
      if (!roll) break;
      await resolveSaveNow(group, id, { index: next.index, success: roll.isSuccess, total: roll.total });
    }
  }
}

/** Final privation states of a member, walking the days in order. */
function finalStates(info, saves) {
  const state = { malnutrition: !!info.before?.malnutrition, dehydration: !!info.before?.dehydration };
  for (const day of info.privation ?? []) {
    for (const s of saves.filter((x) => x.day === day.day && x.result?.status)) state[s.result.status] = true;
    for (const k of ["malnutrition", "dehydration"]) {
      if (day.statuses?.[k]) state[k] = true;
      if (day.clear?.[k]) state[k] = false;
    }
  }
  return state;
}

/** When every queue is resolved: privation states, chat card, next stage. */
async function maybeFinalize(group) {
  const travel = getTravel(group);
  const run = travel?.run;
  if (run?.phase !== "saves" || !isRunComplete(run)) return travel;
  const rules = getRules();
  const statuses = {};
  if (rules.officialRules.privation) {
    for (const id of run.members) {
      const actor = game.actors.get(id);
      const info = run.memberInfo?.[id];
      if (!actor || !info) continue;
      const final = finalStates(info, run.saves[id] ?? []);
      const now = readMemberState(actor);
      for (const k of ["malnutrition", "dehydration"]) {
        if (final[k] !== now[k]) await actor.toggleStatusEffect(k, { active: final[k] });
      }
      statuses[id] = final;
    }
  }
  const message = await postStageCard(group, travel, statuses);
  const stage = travel.stages.find((s) => s.id === run.stageId);
  const next = finishRun(travel, {
    cardId: message?.id ?? null, stageName: stage?.name ?? "",
    comfortAfter: run.consumption?.comfortAfter ?? null, tierName: run.consumption?.tier?.name ?? ""
  });
  await writeTravel(group, next);
  return next;
}

/* -------------------------------------------- */
/*  Undo                                        */
/* -------------------------------------------- */

/** Undo the last stage started (GM), during the stage or after its closure. */
export function undoStage(group) {
  if (isOtherGM()) return forward("undoStage", { groupUuid: group.uuid });
  return serial(async () => {
    assertGM();
    const undo = getUndo(group);
    if (!undo) throw new Error(loc(`${MODULE_ID}.Errors.noUndo`));
    const rules = getRules();
    await restoreSnapshot(undo, rules.recognition);
    const travel = getTravel(group);
    const card = travel?.history?.find((h) => h.runId === undo.runId)?.cardId;
    if (card) await markCardUndone(card);
    await group.update({
      [`flags.${MODULE_ID}.travel`]: _replace(undo.travel),
      [`flags.${MODULE_ID}.undo`]: null
    });
  });
}
