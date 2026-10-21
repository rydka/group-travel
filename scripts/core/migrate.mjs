// Data migrations of the travel flag.

export const SCHEMA_VERSION = 1;

/**
 * Bring a stored travel record to the current schema (in memory).
 * @param {object} raw
 * @returns {{ data: object|null, migrated: boolean }}
 */
export function migrateTravel(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { data: null, migrated: false };
  if (raw.schemaVersion === SCHEMA_VERSION) return { data: structuredClone(raw), migrated: false };
  const data = structuredClone(raw);
  // Version 0 (no version): same shape, fill the missing fields.
  data.stages ??= [];
  data.tiers ??= [];
  data.history ??= [];
  data.counters ??= {};
  data.run ??= null;
  data.current ??= 0;
  data.status ??= "planning";
  data.schemaVersion = SCHEMA_VERSION;
  return { data, migrated: true };
}
