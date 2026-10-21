// Comfort tiers (C5).

const floorOf = (min) => (min === null || min === undefined || min === "" ? -Infinity : Number(min));

/**
 * Highest tier whose minimum is reached (min null = floor tier).
 * @param {number} score
 * @param {{ id: string, name: string, min: number|null, dc: number }[]} tiers
 * @returns {object|null}
 */
export function resolveTier(score, tiers) {
  const sorted = [...(tiers ?? [])].sort((a, b) => floorOf(b.min) - floorOf(a.min));
  return sorted.find((t) => score >= floorOf(t.min)) ?? sorted.at(-1) ?? null;
}

/**
 * Validate a tier list. Returns i18n keys of the problems found.
 * @param {object[]} tiers
 * @returns {string[]}
 */
export function validateTiers(tiers) {
  const errors = [];
  if (!Array.isArray(tiers) || !tiers.length) return ["group-travel.Errors.tiers.empty"];
  const mins = tiers.map((t) => floorOf(t?.min));
  if (mins.some((m) => Number.isNaN(m))) errors.push("group-travel.Errors.tiers.min");
  if (new Set(mins).size !== mins.length) errors.push("group-travel.Errors.tiers.duplicate");
  if (!mins.includes(-Infinity)) errors.push("group-travel.Errors.tiers.floor");
  if (tiers.some((t) => typeof t?.dc !== "number" || !Number.isFinite(t.dc))) errors.push("group-travel.Errors.tiers.dc");
  if (tiers.some((t) => !String(t?.name ?? "").trim())) errors.push("group-travel.Errors.tiers.name");
  return errors;
}
