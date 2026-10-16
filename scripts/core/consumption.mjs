// Consumption plans (C10) and event losses. Pure: inputs are never mutated.
// Removal reproduces dnd5e item uses: spent grows; with autoDestroy, an emptied
// unit lowers the quantity and the item is deleted at 0; without autoDestroy
// (2014 waterskin) the last unit stays, empty (design Q3).
import { classifyItem } from "./recognition.mjs";

/** Mutable working copy of the recognised items of one category. */
function workingHolder(holder, category, entries) {
  const items = [];
  for (const item of holder?.items ?? []) {
    const recognised = classifyItem(item, entries);
    if (recognised?.category !== category) continue;
    items.push({
      _id: item._id,
      ppu: recognised.portionsPerUse ?? 1,
      quantity: Math.max(0, Number(item.system?.quantity) || 0),
      max: Number(item.system?.uses?.max) || 0,
      spent: Math.max(0, Number(item.system?.uses?.spent) || 0),
      autoDestroy: !!item.system?.uses?.autoDestroy,
      touched: false,
      deleted: false
    });
  }
  return { id: holder?.id, kind: holder?.kind, items };
}

const units = (w) => (w.deleted ? 0 : w.max > 0 ? Math.max(0, w.quantity * w.max - w.spent) : w.quantity);
const stock = (h) => h.items.reduce((s, w) => s + units(w) * w.ppu, 0);

/** Take up to `amount` portions from a working holder; returns what was taken. */
function take(holder, amount) {
  let left = amount;
  for (const w of holder.items) {
    if (left <= 1e-9) break;
    const available = units(w);
    if (!available) continue;
    const wanted = Math.min(available, Math.ceil(left / w.ppu - 1e-9));
    const remaining = available - wanted;
    left -= Math.min(left, wanted * w.ppu);
    w.touched = true;
    if (w.max > 0) {
      const q = Math.ceil(remaining / w.max - 1e-9);
      w.quantity = w.autoDestroy ? q : Math.max(1, q);
      w.spent = w.quantity * w.max - remaining;
    } else w.quantity = remaining;
    if (w.autoDestroy && w.quantity === 0) w.deleted = true;
  }
  return amount - Math.max(0, left);
}

/** Turn working holders into { [holderId]: { update, delete } }. */
function toChanges(holders, changes = {}) {
  for (const h of holders) {
    for (const w of h.items) {
      if (!w.touched) continue;
      const c = (changes[h.id] ??= { update: [], delete: [] });
      if (w.deleted) c.delete.push(w._id);
      else {
        const update = { _id: w._id, "system.quantity": w.quantity };
        if (w.max > 0) update["system.uses.spent"] = w.spent;
        c.update.push(update);
      }
    }
  }
  return changes;
}

/**
 * Remove portions of a category: from the group first, then from members by
 * decreasing stock. Used for event losses.
 * @param {{ id: string, kind: string, items: object[] }[]} holders
 * @param {"food"|"water"} category
 * @param {number} portions   Rations for food, pints for water.
 * @param {object[]} entries
 * @returns {{ changes: object, removed: number }}
 */
export function planRemoval(holders, category, portions, entries) {
  const work = (holders ?? []).map((h) => workingHolder(h, category, entries));
  const groups = work.filter((h) => h.kind === "group");
  const members = work.filter((h) => h.kind !== "group")
    .map((h, i) => ({ h, i, s: stock(h) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.h);
  let left = Math.max(0, Number(portions) || 0);
  for (const h of [...groups, ...members]) left -= take(h, left);
  const removed = Math.max(0, Number(portions) || 0) - left;
  return { changes: toChanges(work), removed };
}

/**
 * Daily consumption for every member: from the group first, then from the
 * member's own sheet, never from another member (user answer Q2).
 * Water is consumed and reported in pints: waterPerDay x pintsPerWaterRation per day.
 * @param {object} args
 * @param {object[]} args.members   Member holders.
 * @param {object} args.group       Group holder.
 * @param {number} args.days
 * @param {number} [args.foodPerDay=1]   Rations per member per day.
 * @param {number} [args.waterPerDay=1]  Water rations per member per day.
 * @param {number} [args.pintsPerWaterRation=4]
 * @param {object[]} args.entries
 * @returns {{
 *   changes: Record<string, { update: object[], delete: string[] }>,
 *   intake: Record<string, { day: number, food: number, water: number }[]>,
 *   shortage: Record<string, { food: boolean, water: boolean }>
 * }}
 * `intake` water is in pints. `shortage[actorId]` is true when at least one day
 * was not fully covered.
 */
export function planConsumption({
  members = [], group = null, days = 0, foodPerDay = 1, waterPerDay = 1, pintsPerWaterRation = 4, entries
}) {
  const foodNeed = Math.max(0, Number(foodPerDay) || 0);
  const waterNeed = Math.max(0, Number(waterPerDay) || 0) * (Number(pintsPerWaterRation) || 0);
  const groupFood = group ? workingHolder(group, "food", entries) : null;
  const groupWater = group ? workingHolder(group, "water", entries) : null;
  const memberFood = members.map((m) => workingHolder(m, "food", entries));
  const memberWater = members.map((m) => workingHolder(m, "water", entries));
  const intake = Object.fromEntries(members.map((m) => [m.id, []]));
  const shortage = Object.fromEntries(members.map((m) => [m.id, { food: false, water: false }]));

  const consume = (fromGroup, own, need) => {
    let got = fromGroup ? take(fromGroup, need) : 0;
    got += take(own, need - got);
    return got;
  };
  for (let day = 1; day <= (Number(days) || 0); day++) {
    members.forEach((m, i) => {
      const food = consume(groupFood, memberFood[i], foodNeed);
      const water = consume(groupWater, memberWater[i], waterNeed);
      intake[m.id].push({ day, food, water });
      if (food < foodNeed - 1e-9) shortage[m.id].food = true;
      if (water < waterNeed - 1e-9) shortage[m.id].water = true;
    });
  }
  const changes = toChanges([...memberFood, ...memberWater]);
  if (group) toChanges([groupFood, groupWater], changes);
  return { changes, intake, shortage };
}
