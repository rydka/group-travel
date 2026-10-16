// Example event table: a world RollTable created from a JSON file of the module
// (no compendium: a LevelDB pack cannot be shared by parallel test instances, D0 a).
import { MODULE_ID } from "../core/constants.mjs";

export const EXAMPLE_TABLE_PATH = `modules/${MODULE_ID}/data/example-events.json`;

/** RollTable data from the JSON source, in the given language. */
export function exampleTableData(source, lang = "en") {
  const pick = (v) => (v && typeof v === "object" ? v[lang] ?? v.en : v);
  return {
    name: pick(source.name),
    img: source.img,
    formula: source.formula,
    replacement: true,
    displayRoll: true,
    flags: { [MODULE_ID]: { example: true } },
    results: source.results.map((r) => ({
      type: "text",
      name: pick(r.name),
      description: pick(r.description),
      range: r.range,
      weight: r.range[1] - r.range[0] + 1,
      flags: { [MODULE_ID]: { effects: r.effects } }
    }))
  };
}

/**
 * Create the example table in the world (GM).
 * @returns {Promise<RollTable>}
 */
export async function createExampleTable() {
  const response = await fetch(foundry.utils.getRoute(EXAMPLE_TABLE_PATH));
  if (!response.ok) throw new Error(`${MODULE_ID} | cannot load ${EXAMPLE_TABLE_PATH}`);
  const source = await response.json();
  const lang = game.i18n.lang?.startsWith("fr") ? "fr" : "en";
  return RollTable.implementation.create(exampleTableData(source, lang));
}
