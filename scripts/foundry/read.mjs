// Documents -> plain objects for the pure core. Synchronous, light (M2).
import { MODULE_ID } from "../core/constants.mjs";
import { migrateTravel } from "../core/migrate.mjs";

/** Plain item with only the fields the core reads. */
export function plainItem(item) {
  const s = item.system ?? {};
  const flags = item.flags?.[MODULE_ID];
  return {
    _id: item.id,
    name: item.name,
    type: item.type,
    system: {
      identifier: s.identifier ?? "",
      quantity: s.quantity ?? 1,
      uses: { max: Number(s.uses?.max) || 0, spent: Number(s.uses?.spent) || 0, autoDestroy: !!s.uses?.autoDestroy },
      rarity: s.rarity ?? "",
      container: s.container ?? null
    },
    flags: flags ? { [MODULE_ID]: { ...flags } } : {}
  };
}

/** Plain holder of an actor. */
export function plainHolder(actor, kind) {
  return { id: actor.id, kind, name: actor.name, items: actor.items.map(plainItem) };
}

/**
 * Member actors counted by the module: creatures only (no vehicle), optionally
 * restricted to a list of ids still present in the group.
 * @param {Actor} group
 * @param {string[]} [ids]
 * @returns {Actor[]}
 */
export function memberActors(group, ids) {
  const creatures = group.system?.creatures ?? [];
  if (!ids) return creatures;
  return creatures.filter((a) => ids.includes(a.id));
}

/**
 * Plain holders of the group: members first, then the group itself.
 * The primary vehicle inventory is not counted (spec C2).
 * @param {Actor} group
 * @param {string[]} [ids]
 * @returns {{ members: object[], group: object, holders: object[], actors: Map<string, Actor> }}
 */
export function readHolders(group, ids) {
  const actors = memberActors(group, ids);
  const members = actors.map((a) => plainHolder(a, "member"));
  const own = plainHolder(group, "group");
  const map = new Map(actors.map((a) => [a.id, a]));
  map.set(group.id, group);
  return { members, group: own, holders: [...members, own], actors: map };
}

/** Exhaustion level and privation states of a member. */
export function readMemberState(actor) {
  const ids = statusEffectIds();
  return {
    exhaustion: Number(actor.system?.attributes?.exhaustion) || 0,
    malnutrition: actor.effects.has(ids.malnutrition),
    dehydration: actor.effects.has(ids.dehydration),
    conMod: Number(actor.system?.abilities?.con?.mod) || 0
  };
}

/** Static ids of the dnd5e status effects the module touches. */
export function statusEffectIds() {
  const id = (s) => dnd5e.utils.staticID(`dnd5e${s}`);
  return { exhaustion: id("exhaustion"), malnutrition: id("malnutrition"), dehydration: id("dehydration") };
}

/** Maximum exhaustion level of the system. */
export function maxExhaustion() {
  return CONFIG.DND5E?.conditionTypes?.exhaustion?.levels ?? 6;
}

/** The travel stored on a group, migrated in memory (or null). */
export function getTravel(group) {
  return migrateTravel(group?.flags?.[MODULE_ID]?.travel).data;
}

/** The undo snapshot of the last stage started (or null). */
export function getUndo(group) {
  return group?.flags?.[MODULE_ID]?.undo ?? null;
}
