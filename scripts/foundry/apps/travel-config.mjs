// "Configure the travel" window: stages, tiers, event table, result effects.
// ApplicationV2 + Handlebars, fixed footer, scrolling body. Built lazily.
import { MODULE_ID } from "../../core/constants.mjs";
import { EFFECT_TYPES, readEventEffects } from "../../core/events.mjs";
import { normalizeStage } from "../../core/stage.mjs";
import { validateTiers } from "../../core/tiers.mjs";
import { getRules } from "../settings.mjs";
import { getTravel } from "../read.mjs";

let TravelConfigClass = null;
const DAMAGE_CATEGORIES = ["any", "shelter", "bedding", "gear"];

const num = (v, d = null) => (typeof v === "number" && Number.isFinite(v) ? v : d);
function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
}

/** Editor data from the expanded form object. */
export function parseTravelForm(data) {
  const stages = toArray(data.stages).map((s) => normalizeStage({
    id: s.id || undefined, name: String(s.name ?? "").trim(), days: num(s.days, 1), terrain: s.terrain ?? "",
    dc: num(s.dc), foodPerDay: num(s.foodPerDay, 1), waterPerDay: num(s.waterPerDay, 1), hoursPerDay: num(s.hoursPerDay)
  }));
  const tiers = toArray(data.tiers).map((t, i) => ({ id: String(t.id || `tier${i}`), name: String(t.name ?? "").trim(), min: num(t.min), dc: t.dc }));
  const effects = {};
  for (const id of String(data.effectResults ?? "").split(",").filter(Boolean)) effects[id] = [];
  for (const [resultId, list] of Object.entries(data.effects ?? {})) {
    effects[resultId] = toArray(list).map((e) => {
      const out = { type: EFFECT_TYPES.includes(e.type) ? e.type : "none" };
      if (out.type === "loseFood" || out.type === "loseWater") out.amount = Math.max(0, num(e.amount, 0));
      if (out.type === "damageItem") {
        out.category = DAMAGE_CATEGORIES.includes(e.category) ? e.category : "any";
        out.count = Math.max(0, num(e.count, 1));
        out.steps = Math.max(1, num(e.steps, 1));
      }
      if (out.type === "comfort") out.value = num(e.value, 0);
      return out;
    });
  }
  return { name: String(data.name ?? "").trim(), tableUuid: String(data.tableUuid ?? "").trim() || null, stages, tiers, effects };
}

/** Validation; returns i18n keys. */
export function validateTravel(t) {
  const errors = [];
  if (!t.name) errors.push(`${MODULE_ID}.Errors.travel.name`);
  if (!t.stages.length) errors.push(`${MODULE_ID}.Errors.travel.stages`);
  if (t.stages.some((s) => !s.name || !(s.days > 0))) errors.push(`${MODULE_ID}.Errors.travel.stage`);
  errors.push(...validateTiers(t.tiers));
  return [...new Set(errors)];
}

/** Open the configuration of a group's travel (GM). */
export function openTravelConfig(group) {
  const Cls = getTravelConfigClass();
  const existing = foundry.applications.instances.get(`${MODULE_ID}-config-${group.id}`);
  if (existing) return existing.render({ force: true });
  return new Cls({ group }).render({ force: true });
}

export function getTravelConfigClass() {
  if (TravelConfigClass) return TravelConfigClass;
  const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

  class TravelConfig extends HandlebarsApplicationMixin(ApplicationV2) {
    /** @type {Actor} */
    group;
    #data = null;

    constructor({ group, ...options } = {}) {
      super({ ...options, id: `${MODULE_ID}-config-${group.id}` });
      this.group = group;
    }

    static DEFAULT_OPTIONS = {
      tag: "form",
      classes: [MODULE_ID, `${MODULE_ID}-config`],
      window: { title: `${MODULE_ID}.Config.title`, icon: "fa-solid fa-route", resizable: true, contentClasses: ["standard-form"] },
      position: { width: 760, height: 620 },
      form: { handler: TravelConfig.#onSubmit, closeOnSubmit: false, submitOnChange: false },
      actions: {
        addRow: TravelConfig.#onAddRow,
        deleteRow: TravelConfig.#onDeleteRow,
        addEffect: TravelConfig.#onAddEffect,
        deleteEffect: TravelConfig.#onDeleteEffect,
        createExample: TravelConfig.#onCreateExample,
        importTable: TravelConfig.#onImportTable,
        deleteTravel: TravelConfig.#onDeleteTravel,
        cancel: TravelConfig.#onCancel
      }
    };

    static PARTS = {
      tabs: { template: "templates/generic/tab-navigation.hbs" },
      body: { template: `modules/${MODULE_ID}/templates/travel-config.hbs`, scrollable: [".gt-scroll"] },
      footer: { template: "templates/generic/form-footer.hbs" }
    };

    static TABS = {
      primary: {
        tabs: [
          { id: "stages", icon: "fa-solid fa-signs-post" },
          { id: "tiers", icon: "fa-solid fa-layer-group" },
          { id: "table", icon: "fa-solid fa-table-list" },
          { id: "effects", icon: "fa-solid fa-wand-magic-sparkles" }
        ],
        initial: "stages",
        labelPrefix: `${MODULE_ID}.Config.tabs`
      }
    };

    get title() {
      return `${game.i18n.localize(`${MODULE_ID}.Config.title`)} : ${this.group.name}`;
    }

    #initData() {
      const travel = getTravel(this.group);
      const rules = getRules();
      this.#data = {
        exists: !!travel,
        name: travel?.name ?? "",
        tableUuid: travel?.tableUuid ?? (rules.defaultTable || null),
        stages: structuredClone(travel?.stages ?? [normalizeStage({ name: "", days: 1 })]),
        tiers: structuredClone(travel?.tiers ?? rules.tiers.map((t) => ({ ...t, name: game.i18n.localize(t.name) }))),
        effects: {}
      };
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      if (!this.#data) this.#initData();
      const d = this.#data;
      const loc = (k) => game.i18n.localize(k);
      const table = d.tableUuid ? await fromUuid(d.tableUuid).catch(() => null) : null;
      const isRollTable = table?.documentName === "RollTable";
      const worldTable = isRollTable && !table.pack;
      const results = isRollTable ? table.results.contents.sort((a, b) => a.range[0] - b.range[0]).map((r) => ({
        id: r.id,
        label: `${r.range[0]}–${r.range[1]} · ${r.name || String(r.description ?? "").replace(/<[^>]+>/g, "").slice(0, 60)}`,
        effects: (d.effects[r.id] ?? readEventEffects(r.flags).effects).map((e) => ({ ...e }))
      })) : [];
      for (const r of results) d.effects[r.id] ??= r.effects;
      return Object.assign(context, {
        data: d,
        tiers: d.tiers.map((t) => ({ ...t, minValue: t.min ?? "" })),
        stages: d.stages.map((s) => ({ ...s, dcValue: s.dc ?? "", hoursValue: s.hoursPerDay ?? "" })),
        table: table ? { name: table.name, uuid: d.tableUuid, world: worldTable, valid: isRollTable } : null,
        tableMissing: !!d.tableUuid && !table,
        results,
        editableEffects: worldTable,
        effectTypes: Object.fromEntries(EFFECT_TYPES.map((t) => [t, loc(`${MODULE_ID}.EffectType.${t}`)])),
        damageCategories: Object.fromEntries(DAMAGE_CATEGORIES.map((c) => [c, loc(`${MODULE_ID}.Category.${c}`)])),
        running: !!getTravel(this.group)?.run,
        buttons: [
          ...(d.exists ? [{ type: "button", action: "deleteTravel", icon: "fa-solid fa-trash", label: `${MODULE_ID}.Config.delete` }] : []),
          { type: "button", action: "cancel", icon: "fa-solid fa-xmark", label: "Cancel" },
          { type: "submit", icon: "fa-solid fa-floppy-disk", label: d.exists ? "SETTINGS.Save" : `${MODULE_ID}.Config.create` }
        ]
      });
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      const zone = this.element.querySelector(".gt-drop");
      if (!zone) return;
      zone.addEventListener("dragover", (event) => event.preventDefault());
      zone.addEventListener("drop", async (event) => {
        event.preventDefault();
        const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
        if (data?.type !== "RollTable" || !data.uuid) return;
        this.#sync();
        this.#data.tableUuid = data.uuid;
        this.render();
      });
    }

    /** Copy the current form values into the working copy. */
    #sync() {
      const flat = new foundry.applications.ux.FormDataExtended(this.element).object;
      const parsed = parseTravelForm(foundry.utils.expandObject(flat));
      const effects = { ...this.#data.effects, ...parsed.effects };
      if (parsed.tableUuid !== this.#data.tableUuid) for (const k of Object.keys(effects)) delete effects[k];
      Object.assign(this.#data, parsed, { effects });
    }

    static #onAddRow(event, target) {
      this.#sync();
      const list = target.dataset.list;
      if (list === "stages") this.#data.stages.push(normalizeStage({ name: "", days: 1 }));
      if (list === "tiers") this.#data.tiers.push({ id: foundry.utils.randomID(8), name: "", min: 0, dc: 10 });
      this.render();
    }

    static #onDeleteRow(event, target) {
      this.#sync();
      this.#data[target.dataset.list]?.splice(Number(target.dataset.index), 1);
      this.render();
    }

    static #onAddEffect(event, target) {
      this.#sync();
      (this.#data.effects[target.dataset.result] ??= []).push({ type: "comfort", value: -1 });
      this.render();
    }

    static #onDeleteEffect(event, target) {
      this.#sync();
      this.#data.effects[target.dataset.result]?.splice(Number(target.dataset.index), 1);
      this.render();
    }

    static async #onCreateExample() {
      this.#sync();
      const { createExampleTable } = await import("../example-table.mjs");
      const table = await createExampleTable();
      this.#data.tableUuid = table.uuid;
      this.#data.effects = {};
      ui.notifications.info(game.i18n.format(`${MODULE_ID}.Config.exampleCreated`, { name: table.name }));
      this.render();
    }

    static async #onImportTable() {
      this.#sync();
      const source = this.#data.tableUuid ? await fromUuid(this.#data.tableUuid) : null;
      if (!source?.pack) return;
      const data = source.toObject();
      delete data._id;
      const table = await RollTable.implementation.create(data);
      this.#data.tableUuid = table.uuid;
      this.#data.effects = {};
      this.render();
    }

    static async #onDeleteTravel() {
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: `${MODULE_ID}.Config.delete` },
        content: `<p>${game.i18n.localize(`${MODULE_ID}.Config.deleteConfirm`)}</p>`
      });
      if (!ok) return;
      const { deleteTravel } = await import("../service.mjs");
      await deleteTravel(this.group);
      await this.close();
    }

    static #onCancel() {
      return this.close();
    }

    static async #onSubmit() {
      this.#sync();
      const d = this.#data;
      const errors = validateTravel(d);
      if (errors.length) {
        ui.notifications.error(errors.map((e) => game.i18n.localize(e)).join(" "));
        return;
      }
      const { saveTravel } = await import("../service.mjs");
      await saveTravel(this.group, { name: d.name, tableUuid: d.tableUuid, tiers: d.tiers, stages: d.stages });
      const table = d.tableUuid ? await fromUuid(d.tableUuid).catch(() => null) : null;
      if (table?.documentName === "RollTable" && !table.pack) {
        const updates = Object.entries(d.effects)
          .filter(([id]) => table.results.has(id))
          .map(([id, list]) => ({ _id: id, [`flags.${MODULE_ID}.effects`]: list }));
        if (updates.length) await table.updateEmbeddedDocuments("TableResult", updates);
      }
      ui.notifications.info(game.i18n.localize(`${MODULE_ID}.Config.saved`));
      await this.close();
    }
  }

  TravelConfigClass = TravelConfig;
  return TravelConfig;
}
