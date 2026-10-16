// Player -> GM requests through Foundry queries (CONFIG.queries + User#query).
// The server gives the handler the sender's identity; the GM checks the rights
// and the roll messages before writing anything.
import { MODULE_ID } from "../core/constants.mjs";
import { canDo } from "../core/rights.mjs";
import { nextPendingSave } from "../core/stage.mjs";
import { getRules } from "./settings.mjs";
import { getTravel } from "./read.mjs";
import * as service from "./service.mjs";

export const QUERY = `${MODULE_ID}.request`;
const TIMEOUT = 15000;
const loc = (key) => game.i18n.localize(key);

/** Register the query handler. Called on `init`. */
export function registerQueries() {
  CONFIG.queries[QUERY] = handleRequest;
}

/** Wait for a chat message that may still be on its way. */
async function getMessage(id) {
  for (let i = 0; i < 10; i++) {
    const message = game.messages.get(id);
    if (message) return message;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Check a roll message sent by the user and return its outcome. */
async function verifyRoll(messageId, user, expected, dc) {
  const message = await getMessage(messageId);
  if (!message) throw new Error(loc(`${MODULE_ID}.Errors.rollMissing`));
  if (message.author?.id !== user.id) throw new Error(loc(`${MODULE_ID}.Errors.rollAuthor`));
  const flags = message.flags?.[MODULE_ID]?.roll ?? {};
  for (const [k, v] of Object.entries(expected)) {
    if (flags[k] !== v) throw new Error(loc(`${MODULE_ID}.Errors.rollMismatch`));
  }
  const roll = message.rolls?.[0];
  if (!roll || roll.options?.target !== dc) throw new Error(loc(`${MODULE_ID}.Errors.rollMismatch`));
  return { success: !!roll.isSuccess, total: roll.total, messageId };
}

/**
 * Handler run on the active GM.
 * @param {{ op: string, groupUuid: string, actorId?: string, [key: string]: any }} data
 * @param {{ user: User }} context
 */
export async function handleRequest(data, { user }) {
  if (!game.user.isActiveGM) throw new Error(loc(`${MODULE_ID}.Errors.notActiveGm`));
  const group = await fromUuid(data.groupUuid);
  if (group?.type !== "group") throw new Error(loc(`${MODULE_ID}.Errors.noGroup`));
  const actor = data.actorId ? game.actors.get(data.actorId) : null;
  const ctx = {
    isGM: user.isGM, gmOnline: true,
    ownsGroup: group.testUserPermission(user, "OWNER"),
    ownsActor: !!actor?.testUserPermission(user, "OWNER")
  };
  const op = { actionResult: "chooseAction", saveResult: "chooseAction" }[data.op] ?? data.op;
  if (!canDo(op, ctx)) throw new Error(loc(`${MODULE_ID}.Errors.forbidden`));

  switch (data.op) {
    case "setPace":
      await service.setPace(group, data.pace);
      return true;
    case "chooseAction":
      await service.chooseAction(group, data.actorId, { actionId: data.actionId, targetItemUuid: data.targetItemUuid });
      return true;
    case "actionResult": {
      const run = getTravel(group)?.run;
      const choice = run?.actions?.[data.actorId];
      const action = getRules().actions.find((a) => a.id === choice?.actionId);
      if (!action) throw new Error(loc(`${MODULE_ID}.Errors.wrongPhase`));
      const r = await verifyRoll(data.messageId, user, { groupUuid: group.uuid, runId: run.id, actorId: data.actorId, kind: "action" }, action.dc);
      return service.applyActionResult(group, data.actorId, r);
    }
    case "saveResult": {
      const run = getTravel(group)?.run;
      const next = nextPendingSave(run, data.actorId);
      if (!next || next.index !== data.index) throw new Error(loc(`${MODULE_ID}.Errors.saveOrder`));
      const r = await verifyRoll(data.messageId, user,
        { groupUuid: group.uuid, runId: run.id, actorId: data.actorId, kind: "save", index: data.index }, next.save.dc);
      await service.resolveSave(group, data.actorId, { index: data.index, ...r });
      return true;
    }
    default:
      throw new Error(loc(`${MODULE_ID}.Errors.forbidden`));
  }
}

/**
 * Send a request to the active GM (or run it here when this user is the active GM).
 * @param {string} op
 * @param {object} data
 */
export async function request(op, data) {
  const payload = { op, ...data };
  if (game.user.isActiveGM) return handleRequest(payload, { user: game.user });
  const gm = game.users.activeGM;
  if (!gm) throw new Error(loc(`${MODULE_ID}.Tab.noGm`));
  if (!game.user.hasPermission("QUERY_USER")) throw new Error(loc(`${MODULE_ID}.Errors.noQuery`));
  return gm.query(QUERY, payload, { timeout: TIMEOUT });
}
