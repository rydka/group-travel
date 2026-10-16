import { MODULE_ID } from "./core/constants.mjs";
import { isEnabled, registerSettings } from "./foundry/settings.mjs";

export { MODULE_ID, isEnabled, registerSettings };

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", () => {
  if (game.system.id !== "dnd5e") {
    ui.notifications.error(game.i18n.localize(`${MODULE_ID}.Errors.wrongSystem`));
    return;
  }
  console.log(`${MODULE_ID} | ready`);
});
