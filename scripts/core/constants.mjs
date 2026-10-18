// Pure constants and default values of every setting. No Foundry global here.

export const MODULE_ID = "group-travel";

/** Recognised item categories, in display order. */
export const CATEGORIES = ["food", "water", "shelter", "bedding", "gear"];

/** Categories that count towards the comfort score. */
export const COMFORT_CATEGORIES = ["shelter", "bedding"];

/** Camp item conditions, from best to worst. */
export const CONDITIONS = ["intact", "worn", "damaged", "destroyed"];

export const RARITIES = ["common", "uncommon", "rare", "veryRare", "legendary", "artifact"];

export const PACES = ["slow", "normal", "fast"];

export const ACTION_EFFECTS = ["addFood", "addWater", "repair", "comfort", "guard"];

export const CHECK_TYPES = ["skill", "tool", "ability"];

/**
 * Move a condition along the scale: positive steps repair, negative steps damage.
 * Clamped at both ends; an unknown condition is treated as intact.
 * @param {string} cond
 * @param {number} steps
 * @returns {string}
 */
export function stepCondition(cond, steps) {
  const index = Math.max(0, CONDITIONS.indexOf(cond));
  const next = Math.min(CONDITIONS.length - 1, Math.max(0, index - Math.trunc(Number(steps) || 0)));
  return CONDITIONS[next];
}

/** Normalise a condition value: anything unknown is intact. */
export function normalizeCondition(cond) {
  return CONDITIONS.includes(cond) ? cond : "intact";
}

/** Default values of the world settings (see design "Réglages"). */
export const DEFAULTS = Object.freeze({
  comfort: {
    rarityComfort: { common: 1, uncommon: 2, rare: 3, veryRare: 4, legendary: 5, artifact: 5 },
    conditionFactor: { intact: 1, worn: 0.5, damaged: 0.25, destroyed: 0 },
    shortageMalus: { food: 2, water: 2 }
  },
  tiers: [
    { id: "comfortable", name: "group-travel.Tier.comfortable", min: 8, dc: 8 },
    { id: "fair", name: "group-travel.Tier.fair", min: 5, dc: 10 },
    { id: "rough", name: "group-travel.Tier.rough", min: 2, dc: 13 },
    { id: "miserable", name: "group-travel.Tier.miserable", min: null, dc: 16 }
  ],
  actions: [
    { id: "hunt", label: "group-travel.Action.hunt", check: { type: "skill", key: "sur", ability: null }, dc: 13,
      effect: { type: "addFood", formula: "1d4" } },
    { id: "repair", label: "group-travel.Action.repair", check: { type: "tool", key: null, ability: "int" }, dc: 12,
      effect: { type: "repair", steps: 1 } },
    { id: "camp", label: "group-travel.Action.camp", check: { type: "skill", key: "sur", ability: null }, dc: 12,
      effect: { type: "comfort", value: 2 } },
    { id: "guard", label: "group-travel.Action.guard", check: { type: "skill", key: "prc", ability: null }, dc: 12,
      effect: { type: "guard" } }
  ],
  pace: {
    fast: { durationPct: -25, dcMod: 2 },
    normal: { durationPct: 0, dcMod: 0 },
    slow: { durationPct: 50, dcMod: -2 }
  },
  water: { pintsPerWaterRation: 4 },
  // House rule (user answer Q2): a member who missed part of a day's food or water
  // during the stage gets this flat penalty on the end-of-stage fatigue DC, once.
  shortage: { dcPenalty: 5 },
  recognition: [
    { key: "rations", category: "food", identifiers: ["rations"],
      names: ["Rations", "Rations (1 day)", "Ration", "Rations (1 jour)", "Ration de voyage"], portionsPerUse: 1 },
    { key: "waterskin", category: "water", identifiers: ["waterskin"], names: ["Waterskin", "Outre", "Gourde"], portionsPerUse: 1 },
    { key: "water-pint", category: "water", identifiers: ["water-pint"], names: ["Water (Pint)", "Eau (pinte)"], portionsPerUse: 1 },
    { key: "tent", category: "shelter", identifiers: ["tent", "two-person-tent"],
      names: ["Tent", "Tent, two-person", "Tente", "Tente (deux places)"], portionsPerUse: null },
    { key: "bedroll", category: "bedding", identifiers: ["bedroll"], names: ["Bedroll", "Sac de couchage"], portionsPerUse: null },
    { key: "blanket", category: "bedding", identifiers: ["blanket"], names: ["Blanket", "Couverture"], portionsPerUse: null },
    { key: "gear", category: "gear", identifiers: ["mess-kit", "tinderbox", "cook-pot"],
      names: ["Mess Kit", "Tinderbox", "Gamelle", "Boîte d'allume-feu"], portionsPerUse: null }
  ],
  // Official rules. Privation is optional and off by default (user answer Q2).
  officialRules: { forcedMarch: true, privation: false },
  fatigueSave: true,
  defaultTable: ""
});

/** Deep copy of a default value, safe to mutate. */
export function defaultOf(key) {
  return structuredClone(DEFAULTS[key]);
}
