// Group state computed by the core from the live documents: inventory,
// autonomy, comfort and tier. Synchronous (used by the sheet context).
import { aggregateInventory, comfortItems } from "../core/inventory.mjs";
import { computeAutonomy } from "../core/autonomy.mjs";
import { computeComfort } from "../core/comfort.mjs";
import { resolveTier } from "../core/tiers.mjs";
import { currentStage } from "../core/stage.mjs";
import { readHolders } from "./read.mjs";

/**
 * @param {Actor} group
 * @param {object} options
 * @param {object} options.rules        getRules()
 * @param {object|null} [options.travel]
 * @param {string[]} [options.ids]      Member ids (default: current creatures).
 * @param {object[]} [options.mods]     Comfort modifiers of the stage.
 * @param {{ food: boolean, water: boolean }} [options.shortage]
 */
export function computeGroupState(group, { rules, travel = null, ids, mods = [], shortage = { food: false, water: false } }) {
  const read = readHolders(group, ids);
  const inventory = aggregateInventory(read.holders, rules.recognition);
  const stage = currentStage(travel);
  const autonomy = computeAutonomy({
    foodPortions: inventory.totals.food,
    waterPints: inventory.totals.water,
    members: read.members.length,
    foodPerDay: stage?.foodPerDay ?? 1,
    waterPerDay: stage?.waterPerDay ?? 1,
    pintsPerWaterRation: rules.water.pintsPerWaterRation
  });
  const comfort = computeComfort({ campItems: comfortItems(inventory), mods, shortage }, rules.comfort);
  const tier = resolveTier(comfort.score, travel?.tiers?.length ? travel.tiers : rules.tiers);
  return { read, inventory, autonomy, comfort, tier };
}
