// Client side of the travel tab: buttons and selects -> requests or GM operations.
import { MODULE_ID } from "../core/constants.mjs";
import { nextPendingSave } from "../core/stage.mjs";
import { getRules } from "./settings.mjs";
import { getTravel } from "./read.mjs";
import { request } from "./queries.mjs";
import { rollAction, rollSave } from "./rolls.mjs";
import { describeSave } from "./sheet.mjs";
import * as service from "./service.mjs";

const loc = (key) => game.i18n.localize(key);

/** Roll the chosen action of a member on this client, then report it to the GM. */
export async function rollMemberAction(group, actorId, { configure = true } = {}) {
  const run = getTravel(group)?.run;
  const choice = run?.actions?.[actorId];
  const action = getRules().actions.find((a) => a.id === choice?.actionId);
  const actor = game.actors.get(actorId);
  if (!action || !actor) throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
  const { message } = await rollAction(actor, action, {
    configure,
    flags: { groupUuid: group.uuid, runId: run.id, actorId, kind: "action" },
    flavor: `${loc(`${MODULE_ID}.Tab.Label`)} · ${loc(action.label)}`
  });
  if (!message) return null;
  return request("actionResult", { groupUuid: group.uuid, actorId, messageId: message.id });
}

/** Roll the next pending save of a member on this client, then report it to the GM. */
export async function rollMemberSave(group, actorId, { configure = true } = {}) {
  const run = getTravel(group)?.run;
  const next = nextPendingSave(run, actorId);
  const actor = game.actors.get(actorId);
  if (!next || next.save.auto || !actor) throw new Error(loc(`${MODULE_ID}.Errors.saveOrder`));
  const { message } = await rollSave(actor, next.save, {
    configure,
    flags: { groupUuid: group.uuid, runId: run.id, actorId, kind: "save", index: next.index },
    flavor: `${loc(`${MODULE_ID}.Tab.Label`)} · ${describeSave(next.save)}${next.save.kind === "fatigue" ? ` (${loc(`${MODULE_ID}.Tab.houseRuleShort`)})` : ""}`
  });
  if (!message) return null;
  return request("saveResult", { groupUuid: group.uuid, actorId, index: next.index, messageId: message.id });
}

/**
 * Handle a control of the travel tab.
 * @param {Actor} group
 * @param {string} action
 * @param {object} data   Dataset of the control (+ value for selects).
 */
export async function handleTabAction(group, action, data) {
  try {
    switch (action) {
      case "configure": {
        const { openTravelConfig } = await import("./apps/travel-config.mjs");
        return openTravelConfig(group);
      }
      case "start": return await service.startStage(group);
      case "close": return await service.closeStage(group);
      case "rollAll": return await service.rollPending(group);
      case "undo": {
        const ok = await foundry.applications.api.DialogV2.confirm({
          window: { title: `${MODULE_ID}.GM.undo` },
          content: `<p>${loc(`${MODULE_ID}.GM.undoConfirm`)}</p>`
        });
        if (ok) await service.undoStage(group);
        return ok;
      }
      case "pace": return await request("setPace", { groupUuid: group.uuid, pace: data.value });
      case "chooseAction":
        return await request("chooseAction", { groupUuid: group.uuid, actorId: data.actorId, actionId: data.value || null });
      case "chooseTarget":
        return await request("chooseAction", {
          groupUuid: group.uuid, actorId: data.actorId, actionId: data.actionId, targetItemUuid: data.value || null
        });
      case "rollAction": return await rollMemberAction(group, data.actorId);
      case "rollSave": return await rollMemberSave(group, data.actorId);
      case "condition": {
        const item = await fromUuid(data.uuid);
        if (item) await service.setItemCondition(item, data.value);
        return true;
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} |`, err);
    ui.notifications.error(err.message);
    group.sheet?.render();
  }
  return null;
}
