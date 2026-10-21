// Comfort score (C4, C6): absolute sum over the camp items (user answer Q1).
import { normalizeCondition } from "./constants.mjs";

const rarityKey = (r) => String(r ?? "").replace(/[\s_-]/g, "").toLowerCase();

/**
 * @param {object} input
 * @param {{ name?: string, rarity?: string, condition?: string, quantity?: number }[]} input.campItems
 * @param {{ source?: string, label?: string, value: number }[]} [input.mods]
 * @param {{ food?: boolean, water?: boolean }} [input.shortage]
 * @param {{ rarityComfort: object, conditionFactor: object, shortageMalus: { food: number, water: number } }} rules
 * @returns {{ score: number, base: number, bonus: number, malus: number, lines: object[], modLines: object[] }}
 */
export function computeComfort({ campItems = [], mods = [], shortage = { food: false, water: false } } = {}, rules) {
  const rarityTable = new Map(Object.entries(rules?.rarityComfort ?? {}).map(([k, v]) => [rarityKey(k), Number(v) || 0]));
  const common = rarityTable.get("common") ?? 1;
  const lines = (campItems ?? []).map((item) => {
    const rarity = rarityTable.has(rarityKey(item.rarity)) ? item.rarity : "common";
    const rarityValue = rarityTable.get(rarityKey(rarity)) ?? common;
    const condition = normalizeCondition(item.condition);
    const factor = Number(rules?.conditionFactor?.[condition] ?? 1);
    const quantity = Math.max(0, Number(item.quantity ?? 1) || 0);
    return { name: item.name ?? "", rarity, rarityValue, condition, factor, quantity, value: rarityValue * factor * quantity };
  });
  const modLines = (mods ?? []).map((m) => ({ source: m?.source ?? "", label: m?.label ?? "", value: Number(m?.value) || 0 }));
  const base = lines.reduce((s, l) => s + l.value, 0);
  const bonus = modLines.reduce((s, m) => s + m.value, 0);
  const malus = (shortage?.food ? Number(rules?.shortageMalus?.food) || 0 : 0)
    + (shortage?.water ? Number(rules?.shortageMalus?.water) || 0 : 0);
  return { score: base + bonus - malus, base, bonus, malus, lines, modLines };
}
