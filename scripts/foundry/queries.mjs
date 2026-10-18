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

/**
 * dnd5e message fields expected for the check of an action (see rolls.mjs#rollAction)
 * or for a Constitution save.
 * @param {"action"|"save"} kind
 * @param {object} [action]
 * @returns {{ type: string, system: object }}
 */
export function expectedRollType(kind, action) {
  if (kind === "save") return { type: "save", system: { ability: "con" } };
  const { type, key, ability } = action?.check ?? {};
  if (type === "skill" && key) return { type: "check", system: { skill: key } };
  if (type === "tool" && key) return { type: "check", system: { tool: key } };
  return { type: "check", system: { ability: ability || "int" } };
}

/**
 * The total of a roll recomputed from its terms, when its first term is a
 * single kept d20 result between 1 and 20; otherwise null.
 * @param {Roll} roll
 * @returns {number|null}
 */
export function checkedTotal(roll) {
  const d20 = roll?.terms?.[0];
  if (!(d20 instanceof foundry.dice.terms.Die) || d20.faces !== 20) return null;
  const results = d20.results ?? [];
  const active = results.filter((r) => r.active);
  if (active.length !== 1 || !results.every((r) => Number.isInteger(r.result) && r.result >= 1 && r.result <= 20)) return null;
  try {
    const total = Roll.safeEval(roll.terms.map((t) => t.total).join(" "));
    return Number.isFinite(total) ? total : null;
  } catch {
    return null;
  }
}

/**
 * Check a roll message sent by the user and return its outcome. The message
 * must be a dnd5e roll message of this user for the expected actor and roll
 * type, carry our flags and the expected DC, have a total consistent with its
 * dice, and not have been used already during the stage.
 * @param {string} messageId
 * @param {User} user
 * @param {{ flags: object, actorId: string, rollType: { type: string, system: object }, dc: number, used: string[] }} expected
 */
async function verifyRoll(messageId, user, { flags: expectedFlags, actorId, rollType, dc, used = [] }) {
  const mismatch = () => new Error(loc(`${MODULE_ID}.Errors.rollMismatch`));
  if (used.includes(messageId)) throw new Error(loc(`${MODULE_ID}.Errors.rollUsed`));
  const message = await getMessage(messageId);
  if (!message) throw new Error(loc(`${MODULE_ID}.Errors.rollMissing`));
  if (message.author?.id !== user.id) throw new Error(loc(`${MODULE_ID}.Errors.rollAuthor`));
  const flags = message.flags?.[MODULE_ID]?.roll ?? {};
  for (const [k, v] of Object.entries(expectedFlags)) {
    if (flags[k] !== v) throw mismatch();
  }
  if (message.speaker?.actor !== actorId || message.type !== rollType.type) throw mismatch();
  for (const [k, v] of Object.entries(rollType.system)) {
    if (message.system?.[k] !== v) throw mismatch();
  }
  if (message.rolls?.length !== 1) throw mismatch();
  const roll = message.rolls[0];
  if (roll.options?.target !== dc) throw mismatch();
  const total = checkedTotal(roll);
  if (total === null || total !== roll.total) throw new Error(loc(`${MODULE_ID}.Errors.rollTotal`));
  return { success: total >= dc, total, messageId };
}

/**
 * Handler run on the active GM.
 * @param {{ op: string, groupUuid: string, actorId?: string, [key: string]: any }} data
 * @param {{ user: User }} context
 */
export async function handleRequest(data, { user }) {
  if (!game.user.isActiveGM) throw new Error(loc(`${MODULE_ID}.Errors.notActiveGm`));
  if (data.op === "setItemCondition") {
    if (!user.isGM) throw new Error(loc(`${MODULE_ID}.Errors.forbidden`));
    const item = await fromUuid(data.itemUuid);
    if (item?.documentName !== "Item") throw new Error(loc(`${MODULE_ID}.Errors.forbidden`));
    await service.setItemCondition(item, data.condition);
    return true;
  }
  const group = await fromUuid(data.groupUuid);
  if (group?.type !== "group") throw new Error(loc(`${MODULE_ID}.Errors.noGroup`));
  const actor = data.actorId ? game.actors.get(data.actorId) : null;
  const ctx = {
    isGM: user.isGM, gmOnline: true,
    ownsGroup: group.testUserPermission(user, "OWNER"),
    ownsActor: !!actor?.testUserPermission(user, "OWNER")
  };
  const op = { actionResult: "chooseAction", saveResult: "chooseAction", saveTravel: "configure", deleteTravel: "configure" }[data.op]
    ?? data.op;
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
      const r = await verifyRoll(data.messageId, user, {
        flags: { groupUuid: group.uuid, runId: run.id, actorId: data.actorId, kind: "action" },
        actorId: data.actorId, rollType: expectedRollType("action", action), dc: action.dc, used: run.usedMessages ?? []
      });
      return service.applyActionResult(group, data.actorId, r);
    }
    case "saveResult": {
      const run = getTravel(group)?.run;
      const next = nextPendingSave(run, data.actorId);
      if (!next || next.index !== data.index) throw new Error(loc(`${MODULE_ID}.Errors.saveOrder`));
      const r = await verifyRoll(data.messageId, user, {
        flags: { groupUuid: group.uuid, runId: run.id, actorId: data.actorId, kind: "save", index: data.index },
        actorId: data.actorId, rollType: expectedRollType("save"), dc: next.save.dc, used: run.usedMessages ?? []
      });
      await service.resolveSave(group, data.actorId, { index: data.index, ...r });
      return true;
    }
    // GM operations sent by a GM who is not the active GM
    case "saveTravel":
      return service.saveTravel(group, data.travel ?? {});
    case "deleteTravel":
      await service.deleteTravel(group);
      return true;
    case "startStage":
      return service.startStage(group);
    case "closeStage":
      return service.closeStage(group, { autoRoll: !!data.autoRoll });
    case "rollPending":
      return service.rollPending(group, { actorIds: Array.isArray(data.actorIds) ? data.actorIds : null });
    case "applyActionResult":
      return service.applyActionResult(group, data.actorId, data.result ?? {});
    case "resolveSave":
      return service.resolveSave(group, data.actorId, data.result ?? {});
    case "undoStage":
      await service.undoStage(group);
      return true;
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
