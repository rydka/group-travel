// Item recognition: system.identifier first, then normalised name.

const FLUID_CATEGORIES = new Set(["food", "water"]);

/**
 * Lowercase, strip accents, trim and collapse whitespace.
 * @param {string} s
 * @returns {string}
 */
export function normalizeName(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Recognise an item against the recognition table.
 * A container is never food or water (2024 waterskin = container of water pints).
 * @param {object} item     Plain item data ({ name, type, system: { identifier } }).
 * @param {object[]} entries Recognition entries ({ key, category, identifiers, names, portionsPerUse }).
 * @returns {{ key: string, category: string, portionsPerUse: number|null }|null}
 */
export function classifyItem(item, entries) {
  if (!item || !Array.isArray(entries)) return null;
  const allowed = (e) => !(item.type === "container" && FLUID_CATEGORIES.has(e.category));
  const result = (e) => ({ key: e.key, category: e.category, portionsPerUse: e.portionsPerUse ?? null });

  const identifier = item.system?.identifier;
  if (identifier) {
    const byId = entries.find((e) => (e.identifiers ?? []).includes(identifier));
    if (byId) return allowed(byId) ? result(byId) : null;
  }
  const name = normalizeName(item.name);
  if (!name) return null;
  const byName = entries.find((e) => (e.names ?? []).some((n) => normalizeName(n) === name));
  return byName && allowed(byName) ? result(byName) : null;
}
