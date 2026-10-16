// Public API: game.modules.get("group-travel").api (integration tests, macros).
import { MODULE_ID } from "./core/constants.mjs";
import * as constants from "./core/constants.mjs";
import * as recognition from "./core/recognition.mjs";
import * as inventory from "./core/inventory.mjs";
import * as autonomy from "./core/autonomy.mjs";
import * as comfort from "./core/comfort.mjs";
import * as tiers from "./core/tiers.mjs";
import * as pace from "./core/pace.mjs";
import * as forcedMarch from "./core/forced-march.mjs";
import * as privation from "./core/privation.mjs";
import * as consumption from "./core/consumption.mjs";
import * as events from "./core/events.mjs";
import * as actions from "./core/actions.mjs";
import * as stage from "./core/stage.mjs";
import * as snapshot from "./core/snapshot.mjs";
import * as migrate from "./core/migrate.mjs";
import * as rights from "./core/rights.mjs";
import * as service from "./foundry/service.mjs";
import { buildTravelContext } from "./foundry/sheet.mjs";
import { getRules } from "./foundry/settings.mjs";
import { getTravel } from "./foundry/read.mjs";
import { createExampleTable } from "./foundry/example-table.mjs";
import { rollMemberAction, rollMemberSave } from "./foundry/controller.mjs";

/**
 * GM shortcut: choose an action and apply its result without a roll message.
 * @param {Actor} group
 * @param {string} actorId
 * @param {{ actionId: string, targetItemUuid?: string, success: boolean, total?: number }} data
 */
async function submitAction(group, actorId, { actionId, targetItemUuid = null, success, total = null }) {
  await service.chooseAction(group, actorId, { actionId, targetItemUuid });
  return service.applyActionResult(group, actorId, { success, total });
}

export function buildApi() {
  return {
    buildTravelContext,
    getRules,
    getTravel,
    saveTravel: service.saveTravel,
    deleteTravel: service.deleteTravel,
    startStage: service.startStage,
    setPace: service.setPace,
    chooseAction: service.chooseAction,
    applyActionResult: service.applyActionResult,
    submitAction,
    closeStage: service.closeStage,
    resolveSave: service.resolveSave,
    rollPending: service.rollPending,
    undoStage: service.undoStage,
    setItemCondition: service.setItemCondition,
    createExampleTable,
    rollMemberAction,
    rollMemberSave,
    openTravelConfig: async (group) => (await import("./foundry/apps/travel-config.mjs")).openTravelConfig(group),
    core: {
      constants, recognition, inventory, autonomy, comfort, tiers, pace, forcedMarch, privation, consumption,
      events, actions, stage, snapshot, migrate, rights
    }
  };
}

/** Expose the API on the module. */
export function registerApi() {
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = buildApi();
}
