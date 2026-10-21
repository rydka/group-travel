// Shared builders and shape adapters for the pure-core unit tests.
//
// The design (specs/group-travel/initial/design.md, "Structure") fixes the
// function signatures but not every object shape. Every assumption about a
// shape lives in this file, so aligning the tests with the real core after D1
// means editing this file only.
//
// Assumed shapes
//   item    : plain object { _id, name, type, system: { identifier, quantity,
//             uses: { max, spent, autoDestroy }, rarity, container }, flags }
//   holder  : { id, kind: "member" | "group", items: item[] }
//   entries : recognition table (design "Reconnaissance par défaut")
//   rules   : { rarityComfort, conditionFactor, shortageMalus } (comfort)
//   Inventory totals : read through totalsOf() below.

export const MODULE_ID = "group-travel";

export const DEFAULT_ENTRIES = [
  { key: "rations", category: "food", identifiers: ["rations"], names: ["Rations", "Rations (1 day)", "Ration", "Rations (1 jour)", "Ration de voyage"], portionsPerUse: 1 },
  { key: "waterskin", category: "water", identifiers: ["waterskin"], names: ["Waterskin", "Outre", "Gourde"], portionsPerUse: 1 },
  { key: "water-pint", category: "water", identifiers: ["water-pint"], names: ["Water (Pint)", "Eau (pinte)"], portionsPerUse: 1 },
  { key: "tent", category: "shelter", identifiers: ["tent", "two-person-tent"], names: ["Tent", "Tent, two-person", "Tente", "Tente (deux places)"], portionsPerUse: null },
  { key: "bedroll", category: "bedding", identifiers: ["bedroll"], names: ["Bedroll", "Sac de couchage"], portionsPerUse: null },
  { key: "blanket", category: "bedding", identifiers: ["blanket"], names: ["Blanket", "Couverture"], portionsPerUse: null },
  { key: "gear", category: "gear", identifiers: ["mess-kit", "tinderbox", "cook-pot"], names: ["Mess Kit", "Tinderbox", "Gamelle", "Boîte d'allume-feu"], portionsPerUse: null }
];

export const DEFAULT_RULES = {
  rarityComfort: { common: 1, uncommon: 2, rare: 3, veryRare: 4, legendary: 5, artifact: 5 },
  conditionFactor: { intact: 1, worn: 0.5, damaged: 0.25, destroyed: 0 },
  shortageMalus: { food: 2, water: 2 }
};

export const DEFAULT_TIERS = [
  { id: "comfortable", name: "Confortable", min: 8, dc: 8 },
  { id: "fair", name: "Correct", min: 5, dc: 10 },
  { id: "rough", name: "Rude", min: 2, dc: 13 },
  { id: "miserable", name: "Misérable", min: null, dc: 16 }
];

export const PACE_RULES = {
  fast: { durationPct: -25, dcMod: 2 },
  normal: { durationPct: 0, dcMod: 0 },
  slow: { durationPct: 50, dcMod: -2 }
};

export const PINTS_PER_WATER_RATION = 4;

/** Plain item from a compact description (also used by the M4 fixtures). */
export function makeItem({
  key, name, type = "loot", identifier = "", quantity = 1, max = 0, spent = 0,
  autoDestroy = false, rarity = "", condition = null, container = null
}) {
  const item = {
    _id: key,
    name,
    type,
    system: { identifier, quantity, uses: { max, spent, autoDestroy }, rarity, container },
    flags: {}
  };
  if (condition) item.flags[MODULE_ID] = { condition };
  return item;
}

export const rations = (key, quantity, extra = {}) =>
  makeItem({ key, name: "Rations", type: "consumable", identifier: "rations", quantity, max: 1, autoDestroy: true, ...extra });
export const waterskin2014 = (key, quantity, spent = 0, extra = {}) =>
  makeItem({ key, name: "Waterskin", type: "consumable", identifier: "waterskin", quantity, max: 4, spent, autoDestroy: false, ...extra });
export const waterPint = (key, quantity, container = null, extra = {}) =>
  makeItem({ key, name: "Water (Pint)", type: "consumable", identifier: "water-pint", quantity, max: 1, autoDestroy: true, container, ...extra });
export const container = (key, name, identifier, extra = {}) =>
  makeItem({ key, name, type: "container", identifier, ...extra });
export const camp = (key, name, identifier, extra = {}) =>
  makeItem({ key, name, type: "loot", identifier, ...extra });

export const member = (id, items = []) => ({ id, kind: "member", items });
export const group = (id, items = []) => ({ id, kind: "group", items });

/** Deep copy so tests can assert that inputs are never mutated. */
export const clone = (x) => structuredClone(x);

function setPath(obj, path, value) {
  const parts = path.split(".");
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]] ??= {};
  o[parts.at(-1)] = value;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

/**
 * Apply a `changes` object ({ [holderId]: { update: [...], delete: [...] } })
 * to holders and return the new holders. Updates may use dotted keys or nested
 * objects; deletes may be ids or { _id } objects.
 */
export function applyChanges(holders, changes) {
  const next = clone(holders);
  for (const h of next) {
    const c = changes?.[h.id];
    if (!c) continue;
    for (const u of c.update ?? []) {
      const item = h.items.find((i) => i._id === u._id);
      if (!item) throw new Error(`update targets unknown item ${u._id} on ${h.id}`);
      for (const [path, value] of Object.entries(flatten(u))) if (path !== "_id") setPath(item, path, value);
    }
    const gone = new Set((c.delete ?? []).map((d) => d?._id ?? d));
    h.items = h.items.filter((i) => !gone.has(i._id));
  }
  return next;
}

/** Portions held by a holder in a recognised category, through the core. */
export function portionsIn(holder, category, entries, { classifyItem, itemPortions }) {
  return holder.items.reduce((sum, item) => {
    const c = classifyItem(item, entries);
    return c?.category === category ? sum + itemPortions(item) : sum;
  }, 0);
}

/** Read a category total from an aggregateInventory() result (shape adapter). */
export function totalOf(inventory, category) {
  const v = inventory?.totals?.[category] ?? inventory?.categories?.[category]?.total ?? inventory?.[category]?.total ?? inventory?.[category];
  return typeof v === "object" && v !== null ? v.total : v;
}

/** Per-day amounts from planConsumption().intake[actorId] (shape adapter). */
export function intakeSeries(intake, actorId, field) {
  return (intake?.[actorId] ?? []).map((d) => d[field]);
}
