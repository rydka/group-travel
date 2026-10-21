/* global window */
import fs from "node:fs";
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { camp, container, rations, waterPint } from "../helpers/builders.mjs";
import { ensurePlayer, install, joinAs, settle } from "./helpers.mjs";

// Player context helper: a PLAYER user who is OBSERVER of the group and OWNER of Alba only.
const ch = (id, name, items) => ({ id, name, type: "character", items });
const skin = (k, pints) => [container(`${k}-s`, "Waterskin", "waterskin"), waterPint(`${k}-p`, pints, `${k}-s`)];
const party = () => ({
  id: "gp", name: "Player party", rulesVersion: "modern", primaryVehicle: null, items: [],
  members: [
    ch("alba", "Alba", [rations("alba-r", 6), ...skin("alba", 8), camp("alba-t", "Tent", "tent")]),
    ch("bran", "Bran", [rations("bran-r", 6), ...skin("bran", 8)])
  ]
});
const stages = [{ id: "s1", name: "Road", days: 2, terrain: "road", dc: 40, foodPerDay: 1, waterPerDay: 1, hoursPerDay: null }];
const PLAYER = "GT Pat";

let player = null;
test.beforeEach(async ({ gamePage }) => {
  await install(gamePage);
});
test.afterEach(async ({ gamePage }) => {
  await player?.context.close().catch(() => {});
  player = null;
  if (gamePage.isClosed()) return;
  await gamePage.evaluate(async (name) => {
    await window.gtT?.cleanup();
    await game.users.getName(name)?.delete();
  }, PLAYER).catch(() => {});
});

async function prepare({ foundry, gamePage, browser }) {
  const ids = await foundry(async ({ spec, stages }) => {
    const api = game.modules.get("group-travel").api;
    const { group, map } = await window.gtT.makeGroup(spec);
    await api.saveTravel(group, { name: "T", tableUuid: null, stages });
    await api.startStage(group);
    // Server-side journal: who wrote what (C14).
    window.__writes = [];
    const rec = (kind) => (doc, changes, opts, userId) => window.__writes.push({ kind, userId, name: doc.name ?? doc.parent?.name });
    for (const h of ["createItem", "updateItem", "deleteItem", "updateActor", "createActiveEffect", "updateActiveEffect"]) Hooks.on(h, rec(h));
    return { groupId: group.id, map, gmId: game.user.id };
  }, { spec: party(), stages });
  await ensurePlayer(gamePage, { name: PLAYER, groupId: ids.groupId, actorIds: [ids.map.alba] });
  const baseURL = test.info().project.use.baseURL;
  player = await joinAs(browser, baseURL, PLAYER);
  await player.page.evaluate(async (id) => {
    const group = game.actors.get(id);
    await group.sheet.render({ force: true });
  }, ids.groupId);
  await player.page.locator('nav [data-tab="travel"]').first().click();
  await settle(player.page, 600);
  return ids;
}

test("C14: a player sees the tab, no GM control, controls only for their own character", async ({ foundry, gamePage, browser }) => {
  const ids = await prepare({ foundry, gamePage, browser });
  const p = player.page;
  const pane = p.locator('section.group-travel[data-tab="travel"]');
  await expect(pane).toBeVisible();
  for (const a of ["configure", "start", "close", "rollAll", "undo"]) {
    await expect(pane.locator(`[data-gt-action="${a}"]`), a).toHaveCount(0);
  }
  await expect(pane.locator(`select[data-gt-change="chooseAction"][data-actor-id="${ids.map.alba}"]`)).toBeEnabled();
  await expect(pane.locator(`select[data-gt-change="chooseAction"][data-actor-id="${ids.map.bran}"]`)).toHaveCount(0);
  await expect(pane.locator(`select[data-gt-change="condition"]`)).toHaveCount(0);
  await p.screenshot({ path: test.info().outputPath("C14-vue-joueur.png") });
  const tabs = await p.evaluate((id) => game.actors.get(id).sheet.constructor.TABS.map((t) => t.tab), ids.groupId);
  expect(tabs).toContain("travel");
});

test("C9, C14: the player chooses and rolls for their character; the GM client does the writing", async ({ foundry, gamePage, browser }) => {
  const ids = await prepare({ foundry, gamePage, browser });
  const p = player.page;
  const pane = p.locator('section.group-travel[data-tab="travel"]');
  const select = pane.locator(`select[data-gt-change="chooseAction"][data-actor-id="${ids.map.alba}"]`);
  await select.selectOption("hunt");
  await expect.poll(() => foundry((id) => game.actors.get(id).getFlag("group-travel", "travel").run.actions, ids.groupId)
    .then((a) => Object.values(a ?? {}).map((x) => x.actionId))).toContain("hunt");
  await p.screenshot({ path: test.info().outputPath("C9-joueur-action-choisie.png") });

  const rolled = await p.evaluate(async ({ id, alba }) => {
    const api = game.modules.get("group-travel").api;
    return api.rollMemberAction(game.actors.get(id), alba, { configure: false }).then(() => "ok", (e) => e.message);
  }, { id: ids.groupId, alba: ids.map.alba });
  expect(rolled).toBe("ok");
  const run = await foundry((id) => game.actors.get(id).getFlag("group-travel", "travel").run.actions, ids.groupId);
  expect(run[ids.map.alba].result).toBeTruthy();

  // Requests for somebody else's actor, or GM-only operations, are refused.
  const refused = await p.evaluate(async ({ id, bran }) => {
    const group = game.actors.get(id);
    const gm = game.users.activeGM;
    const ask = (data) => gm.query("group-travel.request", { groupUuid: group.uuid, ...data }, { timeout: 8000 }).then(() => "accepted", (e) => String(e.message ?? e));
    const api = game.modules.get("group-travel").api;
    return {
      chooseForOther: await ask({ op: "chooseAction", actorId: bran, actionId: "hunt" }),
      setPace: await ask({ op: "setPace", pace: "fast" }),
      start: await api.startStage(group).then(() => "accepted", (e) => e.message),
      close: await api.closeStage(group).then(() => "accepted", (e) => e.message),
      undo: await api.undoStage(group).then(() => "accepted", (e) => e.message),
      condition: await api.setItemCondition(group.items.contents[0] ?? game.actors.get(bran).items.contents[0], "worn").then(() => "accepted", (e) => e.message)
    };
  }, { id: ids.groupId, bran: ids.map.bran });
  fs.writeFileSync(test.info().outputPath("C14-refus.json"), JSON.stringify(refused, null, 2));
  for (const [k, v] of Object.entries(refused)) expect(v, k).not.toBe("accepted");

  // Every document write was made by the GM user (journal of hooks on the GM client).
  const writes = await foundry(() => window.__writes);
  fs.writeFileSync(test.info().outputPath("C14-journal-ecritures.json"), JSON.stringify(writes, null, 2));
  expect(writes.length).toBeGreaterThan(0);
  expect(new Set(writes.map((w) => w.userId))).toEqual(new Set([ids.gmId]));
});

test("C11, C14: the player rolls their own fatigue saves one at a time; another character is refused", async ({ foundry, gamePage, browser }) => {
  const ids = await prepare({ foundry, gamePage, browser });
  await foundry((id) => game.modules.get("group-travel").api.closeStage(game.actors.get(id)), ids.groupId);
  const p = player.page;
  await p.evaluate((id) => game.actors.get(id).sheet.render({ force: true }), ids.groupId);
  await settle(p, 600);
  await p.screenshot({ path: test.info().outputPath("C11-joueur-jets.png") });
  const out = await p.evaluate(async ({ id, alba, bran }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const results = [];
    for (let i = 0; i < 3; i++) {
      const next = group.getFlag("group-travel", "travel").run?.saves?.[alba]?.findIndex((s) => !s.result);
      if (next === undefined || next < 0) break;
      results.push(await api.rollMemberSave(group, alba, { configure: false }).then(() => "ok", (e) => e.message));
    }
    const other = await api.rollMemberSave(group, bran, { configure: false }).then(() => "accepted", (e) => e.message);
    return { results, other };
  }, { id: ids.groupId, alba: ids.map.alba, bran: ids.map.bran });
  fs.writeFileSync(test.info().outputPath("C11-jets-joueur.json"), JSON.stringify(out, null, 2));
  expect(out.results.length).toBeGreaterThan(0);
  expect(out.results.every((r) => r === "ok")).toBe(true);
  expect(out.other).not.toBe("accepted");
  const alba = await foundry(({ id, alba }) => {
    const travel = game.actors.get(id).getFlag("group-travel", "travel");
    return (travel.run?.saves?.[alba] ?? travel.history).length;
  }, { id: ids.groupId, alba: ids.map.alba });
  expect(alba).toBeGreaterThan(0);
});

test("C14: without a GM connected the tab is read-only", async ({ foundry, gamePage, browser }) => {
  const ids = await prepare({ foundry, gamePage, browser });
  const p = player.page;
  await gamePage.goto("about:blank"); // the GM leaves
  await expect.poll(() => p.evaluate(() => !!game.users.activeGM), { timeout: 30_000 }).toBe(false);
  await p.evaluate((id) => game.actors.get(id).sheet.render({ force: true }), ids.groupId);
  await settle(p, 800);
  const pane = p.locator('section.group-travel[data-tab="travel"]');
  await expect(pane.locator(".gt-warning")).toBeVisible();
  await expect(pane.locator('select[data-gt-change="chooseAction"]')).toHaveCount(0);
  await expect(pane.locator('[data-gt-action="rollAction"], [data-gt-action="rollSave"]')).toHaveCount(0);
  await p.screenshot({ path: test.info().outputPath("C14-sans-mj.png") });
  // Bring the GM back so that the shared world is cleaned.
  await gamePage.goto("/game");
  await gamePage.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
  await install(gamePage);
});
