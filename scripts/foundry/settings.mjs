// World settings and the "Rules" menu.
import { DEFAULTS, MODULE_ID, defaultOf } from "../core/constants.mjs";
import { getRulesConfigClass } from "./apps/rules-config.mjs";

/** Settings edited through the Rules menu, with their default (design "Réglages"). */
export const RULE_SETTINGS = {
  comfort: "object",
  defaultTiers: "array",
  actions: "array",
  pace: "object",
  water: "object",
  shortage: "object",
  recognition: "array",
  officialRules: "object",
  fatigueSave: "boolean",
  defaultTable: "string"
};

const DEFAULT_KEY = { defaultTiers: "tiers" };
export const ruleDefault = (key) => defaultOf(DEFAULT_KEY[key] ?? key);

/**
 * Setting type. Uses Foundry DataFields; falls back to plain constructors when
 * Foundry is not loaded (unit tests with stand-in globals).
 */
function settingType(kind) {
  const fields = globalThis.foundry?.data?.fields;
  if (!fields) return { boolean: Boolean, string: String, number: Number }[kind] ?? Object;
  switch (kind) {
    case "boolean": return new fields.BooleanField();
    case "string": return new fields.StringField({ blank: true });
    case "number": return new fields.NumberField({ nullable: false });
    case "array": return new fields.ArrayField(new fields.ObjectField());
    default: return new fields.ObjectField();
  }
}

/** Register every setting and the Rules menu. Called on `init`. */
export function registerSettings() {
  game.settings.register(MODULE_ID, "enabled", {
    name: `${MODULE_ID}.settings.enabled.name`,
    hint: `${MODULE_ID}.settings.enabled.hint`,
    scope: "world",
    config: true,
    type: settingType("boolean"),
    default: true
  });

  for (const [key, kind] of Object.entries(RULE_SETTINGS)) {
    game.settings.register(MODULE_ID, key, {
      name: `${MODULE_ID}.settings.${key}.name`,
      scope: "world",
      config: false,
      type: settingType(kind),
      default: ruleDefault(key)
    });
  }

  game.settings.register(MODULE_ID, "dataVersion", {
    scope: "world",
    config: false,
    type: settingType("number"),
    default: 1
  });

  if (typeof game.settings.registerMenu === "function" && globalThis.foundry?.applications) {
    game.settings.registerMenu(MODULE_ID, "rules", {
      name: `${MODULE_ID}.settings.rules.name`,
      label: `${MODULE_ID}.settings.rules.label`,
      hint: `${MODULE_ID}.settings.rules.hint`,
      icon: "fa-solid fa-route",
      type: getRulesConfigClass(),
      restricted: true
    });
  }
}

export function isEnabled() {
  return game.settings.get(MODULE_ID, "enabled");
}

/** Read a rule setting, falling back to its default when unset or malformed. */
export function getRule(key) {
  let value;
  try {
    value = game.settings.get(MODULE_ID, key);
  } catch {
    value = undefined;
  }
  const kind = RULE_SETTINGS[key];
  const ok = kind === "array" ? Array.isArray(value)
    : kind === "object" ? value && typeof value === "object" && !Array.isArray(value)
      : typeof value === kind;
  if (!ok) return ruleDefault(key);
  return kind === "object" ? { ...ruleDefault(key), ...structuredClone(value) } : structuredClone(value);
}

/** Read a dnd5e setting without failing when it does not exist. */
function systemSetting(key, fallback) {
  try {
    return game.settings.get("dnd5e", key) ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Every rule as a plain object, for the pure core.
 * @returns {object}
 */
export function getRules() {
  return {
    comfort: getRule("comfort"),
    tiers: getRule("defaultTiers"),
    actions: getRule("actions"),
    pace: getRule("pace"),
    water: getRule("water"),
    shortage: getRule("shortage"),
    recognition: getRule("recognition"),
    officialRules: getRule("officialRules"),
    fatigueSave: getRule("fatigueSave"),
    defaultTable: getRule("defaultTable"),
    rulesVersion: systemSetting("rulesVersion", "modern"),
    disableExhaustion: !!systemSetting("disableExhaustion", false)
  };
}

export { DEFAULTS };
