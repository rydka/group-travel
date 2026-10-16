// Undo (C13): restoration plan from a snapshot taken when the stage started.
import { MODULE_ID } from "./constants.mjs";

/** Deep copy without `_stats` (at any depth). */
function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) if (k !== "_stats") out[k] = strip(v);
  return out;
}

function equal(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || !a || !b || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => k !== "_stats");
  const kb = Object.keys(b).filter((k) => k !== "_stats");
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.hasOwn(b, k) && equal(a[k], b[k]));
}

function diff(before = [], now = []) {
  const current = new Map(now.map((d) => [d._id, d]));
  const kept = new Set(before.map((d) => d._id));
  const create = [];
  const update = [];
  for (const doc of before) {
    const cur = current.get(doc._id);
    if (!cur) create.push(strip(doc));
    else if (!equal(doc, cur)) update.push(strip(doc));
  }
  const remove = now.filter((d) => !kept.has(d._id)).map((d) => d._id);
  return { create, update, remove };
}

/**
 * @param {Record<string, { items?: object[], effects?: object[], conditions?: Record<string, string> }>} snapshot
 *   State at stage start. `items`/`effects`: full data of the tracked documents.
 *   `conditions` (optional): camp item conditions by item id, for items not copied in full.
 * @param {Record<string, { items?: object[], effects?: object[] }>} current
 *   Current state of the same tracked documents (plus any document created since).
 * @returns {Record<string, { createItems, updateItems, deleteItems, createEffects, updateEffects, deleteEffects }>}
 *   create/update lists carry full data (with `_id`, without `_stats`); delete lists carry ids.
 */
export function planRestore(snapshot, current) {
  const plan = {};
  for (const [actorId, before] of Object.entries(snapshot ?? {})) {
    const now = current?.[actorId] ?? {};
    const items = diff(before?.items ?? [], now.items ?? []);
    const effects = diff(before?.effects ?? [], now.effects ?? []);
    // An update merges flags: make the condition explicit so a flag added since is overwritten.
    for (const u of items.update) {
      const cur = (now.items ?? []).find((i) => i._id === u._id);
      if (u.flags === undefined || !cur?.flags?.[MODULE_ID]?.condition) continue;
      u.flags = { ...u.flags, [MODULE_ID]: { ...(u.flags[MODULE_ID] ?? {}), condition: u.flags[MODULE_ID]?.condition ?? "intact" } };
    }
    for (const [itemId, cond] of Object.entries(before?.conditions ?? {})) {
      const item = (now.items ?? []).find((i) => i._id === itemId);
      const nowCond = item?.flags?.[MODULE_ID]?.condition ?? "intact";
      if (item && nowCond !== cond && !items.update.some((u) => u._id === itemId)) {
        items.update.push({ _id: itemId, [`flags.${MODULE_ID}.condition`]: cond });
      }
    }
    plan[actorId] = {
      createItems: items.create, updateItems: items.update, deleteItems: items.remove,
      createEffects: effects.create, updateEffects: effects.update, deleteEffects: effects.remove
    };
  }
  return plan;
}
