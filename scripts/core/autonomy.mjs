// Autonomy (C3): days of food and water. Water is held in pints and needed in
// water rations (one full waterskin = pintsPerWaterRation pints = one ration).

/**
 * @param {object} args
 * @param {number} args.foodPortions          Rations held.
 * @param {number} args.waterPints            Water held, in pints.
 * @param {number} args.members               Member count.
 * @param {number} [args.foodPerDay=1]        Rations per member per day.
 * @param {number} [args.waterPerDay=1]       Water rations per member per day.
 * @param {number} [args.pintsPerWaterRation=4]
 * @returns {{ members: number, foodDays: number|null, waterRations: number, waterDays: number|null, days: number|null }}
 */
export function computeAutonomy({
  foodPortions = 0, waterPints = 0, members = 0, foodPerDay = 1, waterPerDay = 1, pintsPerWaterRation = 4
} = {}) {
  const ratio = Number(pintsPerWaterRation) > 0 ? Number(pintsPerWaterRation) : 1;
  const waterRations = (Number(waterPints) || 0) / ratio;
  const count = Math.max(0, Math.trunc(Number(members) || 0));
  if (!count) return { members: 0, foodDays: null, waterRations, waterDays: null, days: null };
  const daysOf = (amount, perDay) => (perDay > 0 ? amount / (count * perDay) : Infinity);
  const foodDays = daysOf(Number(foodPortions) || 0, Number(foodPerDay) || 0);
  const waterDays = daysOf(waterRations, Number(waterPerDay) || 0);
  const min = Math.min(foodDays, waterDays);
  return { members: count, foodDays, waterRations, waterDays, days: Number.isFinite(min) ? Math.floor(min) : min };
}
