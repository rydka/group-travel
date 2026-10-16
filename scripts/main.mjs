import { MODULE_ID } from "./core/constants.mjs";
import { isEnabled, registerSettings } from "./foundry/settings.mjs";
import { registerTravelTab } from "./foundry/sheet.mjs";
import { registerQueries } from "./foundry/queries.mjs";

export { MODULE_ID, isEnabled, registerSettings };

Hooks.once("init", () => {
  registerSettings();
  // The sheet and the queries need the real Foundry and dnd5e (absent from unit tests).
  if (globalThis.dnd5e?.applications?.actor?.GroupActorSheet) registerTravelTab();
  if (globalThis.CONFIG?.queries) registerQueries();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.Errors.wrongSystem`));
    return;
  }
  console.log(`${MODULE_ID} | ready`);
});
