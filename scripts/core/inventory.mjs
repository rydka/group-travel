// Inventory totals by category, read from plain holders. Nothing is moved.
import { CATEGORIES, COMFORT_CATEGORIES, MODULE_ID, normalizeCondition } from "./constants.mjs";
import { classifyItem, normalizeName } from "./recognition.mjs";

/**
 * Units held by an item: quantity x uses.max - uses.spent when the item has uses,
 * otherwise its quantity.
 * @param {object} item
 * @returns {number}
 */
export function itemPortions(item) {
  const quantity = Math.max(0, Number(item?.system?.quantity) || 0);
  const max = Number(item?.system?.uses?.max) || 0;
  if (max > 0) {
    const spent = Math.max(0, Number(item.system.uses.spent) || 0);
    return Math.max(0, quantity * max - spent);
  }
  return quantity;
}

/** Portions of a recognised food or water item (units x portionsPerUse). */
export function fluidPortions(item, recognised) {
  return itemPortions(item) * (recognised?.portionsPerUse ?? 1);
}

/** Read the module condition of a camp item. */
export function itemCondition(item) {
  return normalizeCondition(item?.flags?.[MODULE_ID]?.condition);
}

/**
 * Aggregate the recognised items of every holder.
 * Food is counted in rations, water in pints, camp items in quantity.
 * @param {{ id: string, kind: "member"|"group", name?: string, items: object[] }[]} holders
 * @param {object[]} entries
 * @returns {{
 *   totals: Record<string, number>,
 *   categories: Record<string, { total: number, rows: object[] }>,
 *   camp: { holderId: string, itemId: string, name: string, key: string, category: string,
 *           rarity: string, condition: string, quantity: number }[]
 * }}
 */
export function aggregateInventory(holders, entries) {
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const categories = Object.fromEntries(CATEGORIES.map((c) => [c, { total: 0, rows: [] }]));
  const rowIndex = new Map();
  const camp = [];

  for (const holder of holders ?? []) {
    for (const item of holder?.items ?? []) {
      const recognised = classifyItem(item, entries);
      if (!recognised || !(recognised.category in totals)) continue;
      const { category } = recognised;
      const fluid = category === "food" || category === "water";
      const amount = fluid ? fluidPortions(item, recognised) : Math.max(0, Number(item.system?.quantity) || 0);
      totals[category] += amount;
      categories[category].total += amount;

      const mergeKey = `${category}|${item.system?.identifier || `name:${normalizeName(item.name)}`}`;
      let row = rowIndex.get(mergeKey);
      if (!row) {
        row = { key: recognised.key, category, name: item.name, total: 0, holders: [] };
        rowIndex.set(mergeKey, row);
        categories[category].rows.push(row);
      }
      row.total += amount;
      const condition = fluid ? null : itemCondition(item);
      row.holders.push({ holderId: holder.id, kind: holder.kind, itemId: item._id, name: item.name, amount, condition });

      if (!fluid) {
        camp.push({
          holderId: holder.id, itemId: item._id, name: item.name, key: recognised.key, category,
          rarity: item.system?.rarity ?? "", condition, quantity: amount
        });
      }
    }
  }
  return { totals, categories, camp };
}

/** Camp items that count towards comfort, in the shape computeComfort expects. */
export function comfortItems(inventory) {
  return (inventory?.camp ?? [])
    .filter((c) => COMFORT_CATEGORIES.includes(c.category))
    .map((c) => ({ name: c.name, rarity: c.rarity, condition: c.condition, quantity: c.quantity }));
}
