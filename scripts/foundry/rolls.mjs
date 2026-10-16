// Wrappers around the dnd5e roll flow (checks and saves).
import { MODULE_ID } from "../core/constants.mjs";

/**
 * Message options: our flags (checked by the GM) and a nonce to find the message.
 * @returns {{ message: object, nonce: string }}
 */
function messageConfig({ create, flags, flavor }) {
  const nonce = foundry.utils.randomID();
  const data = { flags: { [MODULE_ID]: { roll: { ...(flags ?? {}), nonce } } } };
  if (flavor) data.flavor = flavor;
  return { message: { create, data }, nonce };
}

/** The chat message created for a roll (by its nonce), if any. */
export function findRollMessage(nonce) {
  return game.messages.contents.findLast((m) => m.flags?.[MODULE_ID]?.roll?.nonce === nonce) ?? null;
}

/**
 * Roll the check of an action. A tool check without a tool key, or an ability
 * check, uses rollAbilityCheck: rollToolCheck throws without a tool (D0 b).
 * @param {Actor} actor
 * @param {object} action   { check: { type, key, ability }, dc }
 * @param {{ create?: boolean, configure?: boolean, flags?: object, flavor?: string }} [options]
 * @returns {Promise<{ roll: D20Roll|null, message: ChatMessage|null }>}
 */
export async function rollAction(actor, action, { create = true, configure = true, flags, flavor } = {}) {
  const { type, key, ability } = action.check ?? {};
  const target = action.dc;
  const { message, nonce } = messageConfig({ create, flags, flavor });
  const dialog = { configure };
  let rolls;
  if (type === "skill" && key) rolls = await actor.rollSkill({ skill: key, target, ...(ability ? { ability } : {}) }, dialog, message);
  else if (type === "tool" && key) rolls = await actor.rollToolCheck({ tool: key, target, ...(ability ? { ability } : {}) }, dialog, message);
  else rolls = await actor.rollAbilityCheck({ ability: ability || "int", target }, dialog, message);
  const roll = Array.isArray(rolls) ? rolls[0] ?? null : rolls ?? null;
  return { roll, message: create && roll ? findRollMessage(nonce) : null };
}

/**
 * Constitution save at the DC of a queued save.
 * @param {Actor} actor
 * @param {{ dc: number }} save
 * @param {{ create?: boolean, configure?: boolean, flags?: object, flavor?: string }} [options]
 * @returns {Promise<{ roll: D20Roll|null, message: ChatMessage|null }>}
 */
export async function rollSave(actor, save, { create = true, configure = true, flags, flavor } = {}) {
  const { message, nonce } = messageConfig({ create, flags, flavor });
  const rolls = await actor.rollSavingThrow({ ability: "con", target: save.dc }, { configure }, message);
  const roll = Array.isArray(rolls) ? rolls[0] ?? null : rolls ?? null;
  return { roll, message: create && roll ? findRollMessage(nonce) : null };
}
