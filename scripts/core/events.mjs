// Random events (C8). A table result carries its effects in
// TableResult.flags["group-travel"].effects.
// A successful guard halves every effect, rounded down (user answer Q6). The
// guard is only known after the actions, so every effect is deferred to the
// stage closure: `immediate` is always empty, `deferred` lists all effects.
import { MODULE_ID, stepCondition } from "./constants.mjs";

export const EFFECT_TYPES = ["loseFood", "loseWater", "damageItem", "comfort", "none"];
const DAMAGE_CATEGORIES = ["shelter", "bedding", "gear", "any"];
const CAMP_CATEGORIES = ["shelter", "bedding", "gear"];

const isCount = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;

/**
 * Read and validate the effects stored on a table result.
 * @param {object} flags  The result flags ({ "group-travel": { effects } }).
 * @returns {{ effects: object[], warnings: string[] }}
 */
export function readEventEffects(flags) {
  const raw = flags?.[MODULE_ID]?.effects;
  const effects = [];
  const warnings = [];
  if (raw === undefined || raw === null) return { effects, warnings };
  if (!Array.isArray(raw)) return { effects, warnings: ["group-travel.Warnings.effects.notList"] };
  for (const e of raw) {
    if (!e || typeof e !== "object" || !EFFECT_TYPES.includes(e.type)) {
      warnings.push("group-travel.Warnings.effects.type");
      continue;
    }
    switch (e.type) {
      case "loseFood":
      case "loseWater":
        if (!isCount(e.amount)) warnings.push("group-travel.Warnings.effects.amount");
        else effects.push({ type: e.type, amount: e.amount });
        break;
      case "damageItem": {
        const category = e.category ?? "any";
        const count = e.count ?? 1;
        const steps = e.steps ?? 1;
        if (!DAMAGE_CATEGORIES.includes(category) || !isCount(count) || !isCount(steps)) {
          warnings.push("group-travel.Warnings.effects.damage");
        } else effects.push({ type: "damageItem", category, count, steps });
        break;
      }
      case "comfort":
        if (typeof e.value !== "number" || !Number.isFinite(e.value)) warnings.push("group-travel.Warnings.effects.value");
        else effects.push({ type: "comfort", value: e.value, ...(e.label ? { label: String(e.label) } : {}) });
        break;
      default:
        effects.push({ type: "none" });
    }
  }
  return { effects, warnings };
}

/**
 * Resolve an event's effects.
 * @param {object[]} effects  Validated effects.
 * @param {object} options
 * @param {{ camp?: { holderId, itemId, name, category, condition }[] }} [options.inventory]  aggregateInventory() result.
 * @param {boolean} [options.guarded=false]   A guard succeeded: halve every effect, rounded down.
 * @param {() => number} [options.random=Math.random]
 * @param {number} [options.pintsPerWaterRation=4]  loseWater amounts are water rations.
 * @param {string} [options.label=""]          Label of the comfort modifiers (event name).
 * @returns {{
 *   immediate: object[], deferred: object[],
 *   comfortMods: { source: "event", label: string, value: number }[],
 *   conditionChanges: { holderId: string|null, itemId: string|null, name: string|null, category: string,
 *                       steps: number, from: string|null, to: string|null }[],
 *   losses: { food: number, water: number, waterPints: number },
 *   guarded: boolean
 * }}
 * A conditionChanges entry with a null itemId means there was no object left to damage.
 */
export function planEvent(effects, { inventory = {}, guarded = false, random = Math.random, pintsPerWaterRation = 4, label = "" } = {}) {
  const halve = (n) => (guarded ? Math.floor(n / 2) : n);
  const losses = { food: 0, water: 0, waterPints: 0 };
  const comfortMods = [];
  const conditionChanges = [];
  const conditions = new Map((inventory?.camp ?? []).map((c) => [`${c.holderId}|${c.itemId}`, c.condition ?? "intact"]));
  const valid = (effects ?? []).filter((e) => e && EFFECT_TYPES.includes(e.type));

  for (const e of valid) {
    if (e.type === "loseFood") losses.food += halve(e.amount);
    else if (e.type === "loseWater") losses.water += halve(e.amount);
    else if (e.type === "comfort") {
      // Only a penalty is mitigated by the guard, by its absolute value.
      const value = e.value < 0 ? -halve(-e.value) : e.value;
      if (value) comfortMods.push({ source: "event", label: e.label ?? label, value });
    } else if (e.type === "damageItem") {
      const count = halve(e.count ?? 1);
      const steps = e.steps ?? 1;
      const categories = e.category === "any" || !e.category ? CAMP_CATEGORIES : [e.category];
      const pool = (inventory?.camp ?? []).filter((c) => categories.includes(c.category)
        && conditions.get(`${c.holderId}|${c.itemId}`) !== "destroyed");
      for (let i = 0; i < count; i++) {
        if (!pool.length) {
          conditionChanges.push({ holderId: null, itemId: null, name: null, category: e.category ?? "any", steps: -steps, from: null, to: null });
          continue;
        }
        const index = Math.min(pool.length - 1, Math.floor(random() * pool.length));
        const [c] = pool.splice(index, 1);
        const key = `${c.holderId}|${c.itemId}`;
        const from = conditions.get(key);
        const to = stepCondition(from, -steps);
        conditions.set(key, to);
        conditionChanges.push({ holderId: c.holderId, itemId: c.itemId, name: c.name, category: c.category, steps: -steps, from, to });
      }
    }
  }
  losses.waterPints = losses.water * (Number(pintsPerWaterRation) || 0);
  return { immediate: [], deferred: structuredClone(valid), comfortMods, conditionChanges, losses, guarded: !!guarded };
}
