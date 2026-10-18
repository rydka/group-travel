// Undo snapshot (C13): capture at stage start, restore with the documents.
import { MODULE_ID } from "../core/constants.mjs";
import { classifyItem } from "../core/recognition.mjs";
import { planRestore } from "../core/snapshot.mjs";
import { statusEffectIds } from "./read.mjs";

const FLUID = new Set(["food", "water"]);

function trackedItems(actor, entries, runId) {
  return actor.items.filter((i) => FLUID.has(classifyItem(i, entries)?.category)
    || (runId && i.flags?.[MODULE_ID]?.created?.runId === runId));
}

function campConditions(actor, entries) {
  const out = {};
  for (const i of actor.items) {
    const c = classifyItem(i, entries);
    // null = no flag (restored by deleting the flag, so that the item data is identical).
    if (c && !FLUID.has(c.category)) out[i.id] = i.flags?.[MODULE_ID]?.condition ?? null;
  }
  return out;
}

function trackedEffects(actor) {
  const ids = Object.values(statusEffectIds());
  return actor.effects.filter((e) => ids.includes(e.id));
}

/**
 * @param {Actor} group
 * @param {string[]} memberIds
 * @param {{ runId: string, travel: object, entries: object[] }} options
 * @returns {object} Undo = { runId, travel, actors: { [id]: { items, conditions, effects } } }
 */
export function captureSnapshot(group, memberIds, { runId, travel, entries }) {
  const actors = {};
  const list = [...memberIds.map((id) => game.actors.get(id)).filter(Boolean), group];
  for (const actor of list) {
    actors[actor.id] = {
      items: trackedItems(actor, entries).map((i) => i.toObject()),
      conditions: campConditions(actor, entries),
      effects: actor === group ? [] : trackedEffects(actor).map((e) => e.toObject())
    };
  }
  return { runId, travel: structuredClone(travel), actors };
}

/** Current state of the documents tracked by a snapshot. */
export function currentState(undo, entries) {
  const current = {};
  for (const id of Object.keys(undo.actors ?? {})) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    current[id] = {
      items: trackedItems(actor, entries, undo.runId).map((i) => i.toObject()),
      effects: actor.type === "group" ? [] : trackedEffects(actor).map((e) => e.toObject())
    };
  }
  return current;
}

/**
 * Restore every actor of a snapshot. Deleted documents are recreated with their ids.
 * @returns {Promise<object>} The plan that was applied.
 */
export async function restoreSnapshot(undo, entries) {
  const items = Object.fromEntries(Object.entries(undo.actors ?? {}).map(([id, a]) => [id, { items: a.items, effects: a.effects }]));
  const plan = planRestore(items, currentState(undo, entries));
  for (const [id, p] of Object.entries(plan)) {
    const actor = game.actors.get(id);
    if (!actor) continue;
    if (p.deleteItems.length) await actor.deleteEmbeddedDocuments("Item", p.deleteItems);
    if (p.createItems.length) await actor.createEmbeddedDocuments("Item", p.createItems, { keepId: true });
    if (p.updateItems.length) await actor.updateEmbeddedDocuments("Item", p.updateItems);
    if (p.deleteEffects.length) await actor.deleteEmbeddedDocuments("ActiveEffect", p.deleteEffects);
    if (p.createEffects.length) await actor.createEmbeddedDocuments("ActiveEffect", p.createEffects, { keepId: true });
    // dnd5e conditions with levels need the level before the update (condition.mjs _onUpdate).
    for (const update of p.updateEffects) {
      const originalLevel = actor.effects.get(update._id)?.system?.level ?? 0;
      await actor.updateEmbeddedDocuments("ActiveEffect", [update], { dnd5e: { originalLevel } });
    }
    // Camp items keep their documents: only their condition flag is restored.
    const conditions = Object.entries(undo.actors[id]?.conditions ?? {})
      .filter(([itemId, cond]) => actor.items.has(itemId) && (actor.items.get(itemId).flags?.[MODULE_ID]?.condition ?? null) !== cond)
      .map(([itemId, cond]) => ({ _id: itemId, [`flags.${MODULE_ID}.condition`]: cond ?? _del }));
    if (conditions.length) await actor.updateEmbeddedDocuments("Item", conditions);
  }
  return plan;
}
