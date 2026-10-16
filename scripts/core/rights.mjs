// Who may do what (C14). The active GM is the only writer.

const GM_ONLY = new Set(["configure", "startStage", "closeStage", "undoStage", "setItemCondition", "rollPending"]);

/**
 * @param {string} op
 * @param {{ isGM: boolean, ownsGroup: boolean, ownsActor: boolean, gmOnline: boolean }} ctx
 * @returns {boolean}
 */
export function canDo(op, { isGM = false, ownsGroup = false, ownsActor = false, gmOnline = false } = {}) {
  const known = GM_ONLY.has(op) || ["setPace", "chooseAction", "rollAction", "rollSave"].includes(op);
  if (!known) return false;
  if (isGM) return true;
  if (!gmOnline || GM_ONLY.has(op)) return false;
  if (op === "setPace") return ownsGroup;
  return ownsActor;
}
