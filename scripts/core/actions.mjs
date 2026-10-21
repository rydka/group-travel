// Character actions during a stage (C9).
import { ACTION_EFFECTS, CHECK_TYPES } from "./constants.mjs";

/**
 * Validate an action definition. Returns i18n keys of the problems found.
 * check.key may be null for a tool or ability check (any tool / the given ability).
 * @param {object} a
 * @returns {string[]}
 */
export function validateAction(a) {
  const errors = [];
  if (!a || typeof a !== "object") return ["group-travel.Errors.action.invalid"];
  if (!String(a.id ?? "").trim()) errors.push("group-travel.Errors.action.id");
  if (!String(a.label ?? "").trim()) errors.push("group-travel.Errors.action.label");
  if (typeof a.dc !== "number" || !Number.isFinite(a.dc)) errors.push("group-travel.Errors.action.dc");
  if (!CHECK_TYPES.includes(a.check?.type)) errors.push("group-travel.Errors.action.check");
  else if (a.check.type === "skill" && !a.check.key) errors.push("group-travel.Errors.action.check");
  const effect = a.effect;
  if (!ACTION_EFFECTS.includes(effect?.type)) errors.push("group-travel.Errors.action.effect");
  else if ((effect.type === "addFood" || effect.type === "addWater") && !String(effect.formula ?? effect.value ?? "").trim()) {
    errors.push("group-travel.Errors.action.formula");
  } else if (effect.type === "comfort" && (typeof effect.value !== "number" || !Number.isFinite(effect.value))) {
    errors.push("group-travel.Errors.action.value");
  }
  return errors;
}

/**
 * Effect of an action once its check is resolved.
 * @param {object} action
 * @param {{ success: boolean }} result
 * @returns {{ type: string, formula?: string, value?: number, steps?: number }|null}
 */
export function actionOutcome(action, { success } = {}) {
  if (!success || !ACTION_EFFECTS.includes(action?.effect?.type)) return null;
  const e = action.effect;
  switch (e.type) {
    case "addFood":
    case "addWater":
      return { type: e.type, formula: String(e.formula ?? e.value ?? "1") };
    case "repair":
      return { type: "repair", steps: Number(e.steps) || 1 };
    case "comfort":
      return { type: "comfort", value: Number(e.value) || 0 };
    default:
      return { type: "guard" };
  }
}
