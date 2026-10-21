// "Rules" settings menu: comfort, default tiers, actions, pace and water,
// recognition, official rules. ApplicationV2 + Handlebars, fixed footer.
// The class is built lazily so this file can be imported without Foundry.
import { CATEGORIES, CHECK_TYPES, ACTION_EFFECTS, CONDITIONS, MODULE_ID, RARITIES } from "../../core/constants.mjs";
import { validateTiers } from "../../core/tiers.mjs";
import { validateAction } from "../../core/actions.mjs";

let RulesConfigClass = null;

const LIST_SEPARATOR = ";";
const splitList = (s) => String(s ?? "").split(LIST_SEPARATOR).map((x) => x.trim()).filter(Boolean);
const numberOr = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** Objects with numeric keys (from expandObject) back to arrays. */
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
}

/** Plain editor data from the expanded form object. */
export function parseRulesForm(data) {
  const comfort = {
    rarityComfort: Object.fromEntries(RARITIES.map((r) => [r, numberOr(data.comfort?.rarityComfort?.[r], 0)])),
    conditionFactor: Object.fromEntries(CONDITIONS.map((c) => [c, numberOr(data.comfort?.conditionFactor?.[c], 0)])),
    shortageMalus: {
      food: numberOr(data.comfort?.shortageMalus?.food, 0),
      water: numberOr(data.comfort?.shortageMalus?.water, 0)
    }
  };
  const defaultTiers = toArray(data.defaultTiers).map((t, i) => ({
    id: String(t.id || `tier${i}`),
    name: String(t.name ?? "").trim(),
    min: typeof t.min === "number" && Number.isFinite(t.min) ? t.min : null,
    dc: t.dc
  }));
  const actions = toArray(data.actions).map((a, i) => {
    const effect = { type: a.effect?.type };
    if (effect.type === "addFood" || effect.type === "addWater") effect.formula = String(a.effect?.formula ?? "").trim();
    if (effect.type === "comfort") effect.value = a.effect?.value;
    if (effect.type === "repair") effect.steps = numberOr(a.effect?.steps, 1);
    return {
      id: String(a.id || `action${i}`).trim(),
      label: String(a.label ?? "").trim(),
      check: { type: a.check?.type, key: String(a.check?.key ?? "").trim() || null, ability: String(a.check?.ability ?? "").trim() || null },
      dc: a.dc,
      effect
    };
  });
  const pace = Object.fromEntries(["fast", "normal", "slow"].map((p) => [p, {
    durationPct: numberOr(data.pace?.[p]?.durationPct, 0),
    dcMod: numberOr(data.pace?.[p]?.dcMod, 0)
  }]));
  const recognition = toArray(data.recognition).map((r, i) => ({
    key: String(r.key || `entry${i}`).trim(),
    category: CATEGORIES.includes(r.category) ? r.category : "gear",
    identifiers: splitList(r.identifiers),
    names: splitList(r.names),
    portionsPerUse: ["food", "water"].includes(r.category) ? numberOr(r.portionsPerUse, 1) : null
  }));
  return {
    comfort,
    defaultTiers,
    actions,
    pace,
    water: { pintsPerWaterRation: Math.max(1, numberOr(data.water?.pintsPerWaterRation, 4)) },
    shortage: { dcPenalty: numberOr(data.shortage?.dcPenalty, 0) },
    recognition,
    officialRules: { forcedMarch: !!data.officialRules?.forcedMarch, privation: !!data.officialRules?.privation },
    fatigueSave: !!data.fatigueSave,
    defaultTable: String(data.defaultTable ?? "").trim()
  };
}

/** Validation of the editor data; returns i18n keys. */
export function validateRules(rules) {
  const errors = [...validateTiers(rules.defaultTiers)];
  for (const a of rules.actions) errors.push(...validateAction(a));
  const ids = rules.actions.map((a) => a.id);
  if (new Set(ids).size !== ids.length) errors.push("group-travel.Errors.action.duplicate");
  return [...new Set(errors)];
}

/** @returns {typeof foundry.applications.api.ApplicationV2} */
export function getRulesConfigClass() {
  if (RulesConfigClass) return RulesConfigClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  class RulesConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    /** Working copy of the rules, kept between renders. */
    #rules = null;

    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-rules`,
      tag: "form",
      classes: [MODULE_ID, `${MODULE_ID}-rules`],
      window: { title: `${MODULE_ID}.Rules.title`, icon: "fa-solid fa-route", resizable: true, contentClasses: ["standard-form"] },
      position: { width: 760, height: 620 },
      form: { handler: RulesConfig.#onSubmit, closeOnSubmit: false, submitOnChange: false },
      actions: {
        addRow: RulesConfig.#onAddRow,
        deleteRow: RulesConfig.#onDeleteRow,
        resetDefaults: RulesConfig.#onReset
      }
    };

    static PARTS = {
      tabs: { template: "templates/generic/tab-navigation.hbs" },
      body: { template: `modules/${MODULE_ID}/templates/rules-config.hbs`, scrollable: [".gt-scroll"] },
      footer: { template: "templates/generic/form-footer.hbs" }
    };

    static TABS = {
      primary: {
        tabs: [
          { id: "comfort", icon: "fa-solid fa-campground" },
          { id: "tiers", icon: "fa-solid fa-layer-group" },
          { id: "actions", icon: "fa-solid fa-person-hiking" },
          { id: "pace", icon: "fa-solid fa-gauge" },
          { id: "recognition", icon: "fa-solid fa-magnifying-glass" },
          { id: "official", icon: "fa-solid fa-book" }
        ],
        initial: "comfort",
        labelPrefix: `${MODULE_ID}.Rules.tabs`
      }
    };

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const { getRule, RULE_SETTINGS } = await import("../settings.mjs");
      this.#rules ??= Object.fromEntries(Object.keys(RULE_SETTINGS).map((k) => [k, getRule(k)]));
      const r = this.#rules;
      const rarityLabels = globalThis.CONFIG?.DND5E?.itemRarity ?? {};
      const loc = (k) => game.i18n.localize(k);
      const options_ = (list, prefix) => Object.fromEntries(list.map((v) => [v, loc(`${prefix}.${v}`)]));
      return Object.assign(context, {
        rules: r,
        rarities: RARITIES.map((key) => ({ key, label: rarityLabels[key] ?? key, value: r.comfort.rarityComfort?.[key] ?? 0 })),
        conditions: CONDITIONS.map((key) => ({ key, label: loc(`${MODULE_ID}.Condition.${key}`), value: r.comfort.conditionFactor?.[key] ?? 0 })),
        paces: ["fast", "normal", "slow"].map((key) => ({ key, label: loc(`${MODULE_ID}.Pace.${key}`), ...r.pace[key] })),
        tiers: r.defaultTiers.map((t) => ({ ...t, name: loc(t.name), minValue: t.min ?? "" })),
        actions: r.actions,
        recognition: r.recognition.map((e) => ({ ...e, identifiersText: (e.identifiers ?? []).join(`${LIST_SEPARATOR} `),
          namesText: (e.names ?? []).join(`${LIST_SEPARATOR} `), fluid: ["food", "water"].includes(e.category) })),
        checkTypes: options_(CHECK_TYPES, `${MODULE_ID}.Check`),
        effectTypes: options_(ACTION_EFFECTS, `${MODULE_ID}.Effect`),
        categories: options_(CATEGORIES, `${MODULE_ID}.Category`),
        buttons: [
          { type: "button", action: "resetDefaults", icon: "fa-solid fa-arrow-rotate-left", label: `${MODULE_ID}.Rules.reset` },
          { type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }
        ]
      });
    }

    /** Copy the current form values into the working copy. */
    #syncFromForm() {
      const flat = new foundry.applications.ux.FormDataExtended(this.element).object;
      this.#rules = parseRulesForm(foundry.utils.expandObject(flat));
    }

    static async #onAddRow(event, target) {
      this.#syncFromForm();
      const list = target.dataset.list;
      const blank = {
        defaultTiers: { id: foundry.utils.randomID(8), name: "", min: 0, dc: 10 },
        actions: { id: foundry.utils.randomID(8), label: "", check: { type: "skill", key: "sur", ability: null }, dc: 12,
          effect: { type: "comfort", value: 1 } },
        recognition: { key: foundry.utils.randomID(8), category: "gear", identifiers: [], names: [], portionsPerUse: null }
      }[list];
      if (blank) this.#rules[list].push(blank);
      this.render();
    }

    static async #onDeleteRow(event, target) {
      this.#syncFromForm();
      const { list, index } = target.dataset;
      this.#rules[list]?.splice(Number(index), 1);
      this.render();
    }

    static async #onReset() {
      const { ruleDefault, RULE_SETTINGS } = await import("../settings.mjs");
      this.#rules = Object.fromEntries(Object.keys(RULE_SETTINGS).map((k) => [k, ruleDefault(k)]));
      this.render();
    }

    static async #onSubmit(event, form, formData) {
      const rules = parseRulesForm(foundry.utils.expandObject(formData.object));
      this.#rules = rules;
      const errors = validateRules(rules);
      if (errors.length) {
        ui.notifications.error(errors.map((e) => game.i18n.localize(e)).join(" "));
        return;
      }
      for (const [key, value] of Object.entries(rules)) await game.settings.set(MODULE_ID, key, value);
      ui.notifications.info(game.i18n.localize(`${MODULE_ID}.Rules.saved`));
      await this.close();
    }
  }

  RulesConfigClass = RulesConfig;
  return RulesConfig;
}
