// Official privation rules (optional, off by default; user answer Q2).
// Source: reports/rules/group-travel-rules.md sections 2 and 6.
// `need` and `got` share one unit per resource (rations of food, water rations).
// End-of-day order: forced march (handled elsewhere), then food, then water.

/**
 * @typedef {object} PrivationStep
 * @property {"food"|"water"} kind
 * @property {"auto"|"save"} type
 * @property {number} [dc]
 * @property {number} levels
 * @property {number} [levelsIfExhausted]   2014 water: levels when the member already has exhaustion.
 * @property {"malnutrition"|"dehydration"} status  State to set when the step adds a level.
 */

/**
 * One day of privation for one member.
 * @param {object} args
 * @param {"legacy"|"modern"} args.rulesVersion   dnd5e `rulesVersion` (2014 / 2024).
 * @param {{ need: number, got: number }} args.food
 * @param {{ need: number, got: number }} args.water
 * @param {number} [args.counter=0]   Days without food (2014: may be fractional; 2024: consecutive days eating nothing).
 * @param {number} [args.conMod=0]    Constitution modifier (2014 only).
 * @returns {{
 *   steps: PrivationStep[],
 *   counter: number,
 *   statuses: { malnutrition: boolean, dehydration: boolean },
 *   clear: { malnutrition: boolean, dehydration: boolean }
 * }}
 * `statuses` is true only when an automatic level is added this day; a save step
 * carries `status`, to be set only if the save fails. `clear` is true when the day
 * is covered and the state must be removed (2014: food and water both covered).
 */
export function dailyPrivation({ rulesVersion, food, water, counter = 0, conMod = 0 }) {
  const legacy = rulesVersion === "legacy";
  const ratio = ({ need, got } = {}) => {
    const n = Number(need) || 0;
    return n > 0 ? Math.max(0, Number(got) || 0) / n : 1;
  };
  const foodRatio = ratio(food);
  const waterRatio = ratio(water);
  const steps = [];
  const statuses = { malnutrition: false, dehydration: false };
  let next = Number(counter) || 0;

  // Food
  if (legacy) {
    if (foodRatio >= 1) next = 0;
    else {
      next += 1 - foodRatio;
      const limit = Math.max(1, 3 + (Number(conMod) || 0));
      if (next > limit + 1e-9) {
        steps.push({ kind: "food", type: "auto", levels: 1, status: "malnutrition" });
        statuses.malnutrition = true;
      }
    }
  } else if (foodRatio > 0) {
    next = 0;
    if (foodRatio < 0.5) steps.push({ kind: "food", type: "save", dc: 10, levels: 1, status: "malnutrition" });
  } else {
    next += 1;
    if (next >= 5) {
      steps.push({ kind: "food", type: "auto", levels: 1, status: "malnutrition" });
      statuses.malnutrition = true;
    }
  }

  // Water
  if (waterRatio < 0.5) {
    steps.push(legacy
      ? { kind: "water", type: "auto", levels: 1, levelsIfExhausted: 2, status: "dehydration" }
      : { kind: "water", type: "auto", levels: 1, status: "dehydration" });
    statuses.dehydration = true;
  } else if (legacy && waterRatio < 1) {
    steps.push({ kind: "water", type: "save", dc: 15, levels: 1, levelsIfExhausted: 2, status: "dehydration" });
  }

  const clear = legacy
    ? { malnutrition: foodRatio >= 1 && waterRatio >= 1, dehydration: foodRatio >= 1 && waterRatio >= 1 }
    : { malnutrition: foodRatio >= 1, dehydration: waterRatio >= 1 };
  return { steps, counter: next, statuses, clear };
}
