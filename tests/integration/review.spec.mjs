/* global window, User */
// Tests added after the review: secrets, repair targets, forged/reused roll
// messages, locked running stage, all-or-nothing closure, non-active GM, default pace.
import fs from "node:fs";
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { camp, container, rations, waterPint } from "../helpers/builders.mjs";
import { ensurePlayer, install, joinAs, settle } from "./helpers.mjs";

const ch = (id, name, items) => ({ id, name, type: "character", items });
const skin = (k, pints) => [container(`${k}-s`, "Waterskin", "waterskin"), waterPint(`${k}-p`, pints, `${k}-s`)];
const party = () => ({
  id: "gp", name: "Review party", rulesVersion: "modern", primaryVehicle: null, items: [],
  members: [
    ch("alba", "Alba", [rations("alba-r", 6), ...skin("alba", 8), camp("alba-t", "Tent", "tent")]),
    ch("bran", "Bran", [rations("bran-r", 6), ...skin("bran", 8)]),
    ch("cora", "Cora", [rations("cora-r", 6), ...skin("cora", 8), camp("cora-b", "Bedroll", "bedroll")])
  ]
});
const stage = (extra = {}) => ({ id: "s1", name: "Road", days: 2, terrain: "road", dc: 40, foodPerDay: 1, waterPerDay: 1, hoursPerDay: null, ...extra });
const PLAYER = "GT Pat";
const GM2 = "GT GM2";

let other = null;
test.beforeEach(async ({ gamePage }) => {
  await install(gamePage);
});
test.afterEach(async ({ gamePage }) => {
  await other?.context.close().catch(() => {});
  other = null;
  if (gamePage.isClosed()) return;
  await gamePage.evaluate(async (names) => {
    await window.gtT?.cleanup();
    for (const n of names) await game.users.getName(n)?.delete();
  }, [PLAYER, GM2]).catch(() => {});
});

async function setupGroup(foundry, { stages = [stage()], table = null, start = false } = {}) {
  return foundry(async ({ spec, stages, table, start }) => {
    const api = game.modules.get("group-travel").api;
    const { group, map } = await window.gtT.makeGroup(spec);
    let tableUuid = null;
    if (table) {
      const t = await RollTableCreate(table);
      tableUuid = t.uuid;
    }
    await api.saveTravel(group, { name: "T", tableUuid, stages });
    if (start) await api.startStage(group);
    return { groupId: group.id, map, gmId: game.user.id };
    async function RollTableCreate(results) { return window.gtT.makeTable("review", results); }
  }, { spec: party(), stages, table, start });
}

async function joinPlayer({ foundry, gamePage, browser }, ids) {
  await ensurePlayer(gamePage, { name: PLAYER, groupId: ids.groupId, actorIds: [ids.map.alba] });
  other = await joinAs(browser, test.info().project.use.baseURL, PLAYER);
  await other.page.evaluate((id) => game.actors.get(id).sheet.render({ force: true }), ids.groupId);
  await other.page.locator('nav [data-tab="travel"]').first().click();
  await settle(other.page, 600);
  void foundry;
}

test("the default pace of a stage is normal", async ({ foundry }) => {
  const ids = await setupGroup(foundry, { start: true });
  const run = await foundry((id) => game.actors.get(id).getFlag("group-travel", "travel").run, ids.groupId);
  expect(run.pace).toBe("normal");
  expect(run.effectiveDays).toBe(2);
});

test("a secret in a table result stays invisible to the player", async ({ foundry, gamePage, browser }) => {
  const ids = await setupGroup(foundry, {
    table: [{ name: "Ambush", effects: [{ type: "none" }] }], start: false
  });
  await foundry(async (id) => {
    const group = game.actors.get(id);
    const table = game.tables.find((t) => t.name === "GT review");
    await table.results.contents[0].update({ description: '<p>Visible omen</p><section class="secret"><p>TOPSECRET plan</p></section>' });
    await game.modules.get("group-travel").api.startStage(group);
  }, ids.groupId);
  await joinPlayer({ foundry, gamePage, browser }, ids);
  const gm = await foundry((id) => game.actors.get(id).getFlag("group-travel", "travel").run.event.html, ids.groupId);
  const text = await other.page.locator('section.group-travel[data-tab="travel"]').innerText();
  const html = await other.page.locator('section.group-travel[data-tab="travel"]').innerHTML();
  fs.writeFileSync(test.info().outputPath("S1-secret.json"), JSON.stringify({ storedHtml: gm, playerText: text }, null, 2));
  await other.page.screenshot({ path: test.info().outputPath("S1-secret-vue-joueur.png") });
  expect(gm).not.toContain("TOPSECRET");
  expect(html).not.toContain("TOPSECRET");
  expect(text).toContain("Visible omen");
});

test("a repair target outside the camp items of the group is refused", async ({ foundry }) => {
  const ids = await setupGroup(foundry, { start: true });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const { Actor } = foundry.documents;
    const stranger = await Actor.create({ name: "GT Stranger", type: "character" });
    window.gtT.created.actors.push(stranger.id);
    const [tent] = await stranger.createEmbeddedDocuments("Item", [{ name: "Tent", type: "loot", system: { identifier: "tent" } }]);
    const food = game.actors.get(map.bran).items.find((i) => i.system.identifier === "rations");
    const own = game.actors.get(map.alba).items.get(window.gtT.idFor("alba-t"));
    const ask = (uuid) => api.chooseAction(group, map.alba, { actionId: "repair", targetItemUuid: uuid }).then(() => "accepted", (e) => e.message);
    return { stranger: await ask(tent.uuid), food: await ask(food.uuid), bogus: await ask("Actor.nope.Item.nope"), own: await ask(own.uuid) };
  }, { id: ids.groupId, map: ids.map });
  fs.writeFileSync(test.info().outputPath("S2-cibles-reparation.json"), JSON.stringify(r, null, 2));
  expect(r.stranger).not.toBe("accepted");
  expect(r.food).not.toBe("accepted");
  expect(r.bogus).not.toBe("accepted");
  expect(r.own).toBe("accepted");
});

test("a reused, foreign or forged roll message is refused", async ({ foundry, gamePage, browser }) => {
  const ids = await setupGroup(foundry, { stages: [stage({ hoursPerDay: 10 })], start: true });
  await foundry((id) => game.modules.get("group-travel").api.closeStage(game.actors.get(id)), ids.groupId);
  await joinPlayer({ foundry, gamePage, browser }, ids);
  const gmMessage = await foundry(async ({ id, map }) => {
    const group = game.actors.get(id);
    const run = group.getFlag("group-travel", "travel").run;
    const roll = await new Roll("1d20", {}, { target: 11 }).evaluate();
    const m = await ChatMessage.create({ content: "gm", rolls: [roll], speaker: { actor: map.alba }, flags: { "group-travel": { roll: { groupUuid: group.uuid, runId: run.id, actorId: map.alba, kind: "save", index: 1 } } } });
    return m.id;
  }, { id: ids.groupId, map: ids.map });
  const out = await other.page.evaluate(async ({ id, alba, gmMessage }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const gm = game.users.activeGM;
    const run = () => group.getFlag("group-travel", "travel").run;
    const ask = (index, messageId) => gm.query("group-travel.request", { op: "saveResult", groupUuid: group.uuid, actorId: alba, index, messageId }, { timeout: 8000 })
      .then(() => "accepted", (e) => String(e.message ?? e));
    // 1. a genuine roll is accepted once
    await api.rollMemberSave(group, alba, { configure: false });
    const first = game.messages.contents.findLast((m) => m.flags["group-travel"]?.roll)?.id;
    const done = run().saves[alba].filter((s) => s.result).length;
    // 2. the same message for the next save
    const reused = await ask(1, first);
    // 3. a message of the GM
    const foreign = await ask(1, gmMessage);
    // 4. a forged message by the player: right flags, invented total
    const roll = await new Roll("99", {}, { target: run().saves[alba][1].dc }).evaluate();
    const forged = await ChatMessage.create({
      content: "forged", rolls: [roll], speaker: { actor: alba },
      flags: { "group-travel": { roll: { groupUuid: group.uuid, runId: run().id, actorId: alba, kind: "save", index: 1 } } }
    });
    const forgedResult = await ask(1, forged.id);
    // 5. an unknown id
    const unknown = await ask(1, "doesNotExist0000");
    return { done, resolvedAfter: run().saves[alba].filter((s) => s.result).length, reused, foreign, forgedResult, unknown };
  }, { id: ids.groupId, alba: ids.map.alba, gmMessage });
  fs.writeFileSync(test.info().outputPath("S3-messages-de-jet.json"), JSON.stringify(out, null, 2));
  expect(out.done).toBeGreaterThanOrEqual(1);
  for (const k of ["reused", "foreign", "forgedResult", "unknown"]) expect(out[k], k).not.toBe("accepted");
  expect(out.resolvedAfter).toBe(out.done);
});

test("saveTravel cannot remove or change the running stage", async ({ foundry }) => {
  const ids = await setupGroup(foundry, { stages: [stage(), { ...stage({ dc: 12 }), id: "s2", name: "Hills" }], start: true });
  const r = await foundry(async (id) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const cur = foundry.utils.deepClone(group.getFlag("group-travel", "travel").stages);
    const attempt = (stages) => api.saveTravel(group, { name: "T2", tableUuid: null, stages }).then(() => "accepted", (e) => e.message);
    return {
      changeDays: await attempt([{ ...cur[0], days: 9 }, cur[1]]),
      changeDc: await attempt([{ ...cur[0], dc: 1 }, cur[1]]),
      remove: await attempt([cur[1]]),
      reorder: await attempt([cur[1], cur[0]]),
      changeLater: await attempt([cur[0], { ...cur[1], days: 5 }]),
      after: group.getFlag("group-travel", "travel").stages.map((s) => s.days)
    };
  }, ids.groupId);
  fs.writeFileSync(test.info().outputPath("S4-etape-verrouillee.json"), JSON.stringify(r, null, 2));
  for (const k of ["changeDays", "changeDc", "remove", "reorder"]) expect(r[k], k).not.toBe("accepted");
  expect(r.changeLater).toBe("accepted");
  expect(r.after).toEqual([2, 5]);
});

test("a failed closure restores the state from before", async ({ foundry }) => {
  const ids = await setupGroup(foundry, { start: true });
  const r = await foundry(async ({ id, map }) => {
    const api = game.modules.get("group-travel").api;
    const group = game.actors.get(id);
    const before = window.gtT.canon(group);
    const cora = game.actors.get(map.cora);
    // Fault injection: Cora's first write fails (once), the other members' writes go through.
    cora.updateEmbeddedDocuments = async () => { delete cora.updateEmbeddedDocuments; delete cora.deleteEmbeddedDocuments; throw new Error("injected failure"); };
    cora.deleteEmbeddedDocuments = cora.updateEmbeddedDocuments;
    const error = await api.closeStage(group, { autoRoll: true }).then(() => null, (e) => e.message);
    delete cora.updateEmbeddedDocuments; delete cora.deleteEmbeddedDocuments;
    await new Promise((r) => setTimeout(r, 500));
    const after = window.gtT.canon(group);
    const travel = group.getFlag("group-travel", "travel");
    // The stage can be closed again afterwards.
    const retry = await api.closeStage(group, { autoRoll: true }).then(() => "closed", (e) => e.message);
    return { error, differences: window.gtT.diff(before, after), phase: travel.run?.phase, cards: game.messages.filter((m) => m.flags["group-travel"]?.card).length, retry };
  }, { id: ids.groupId, map: ids.map });
  fs.writeFileSync(test.info().outputPath("S5-cloture-en-echec.json"), JSON.stringify(r, null, 2));
  expect(r.error).toContain("injected failure");
  expect(r.differences).toEqual([]);
  expect(r.phase).toBe("actions");
  expect(r.cards).toBe(0);
  expect(r.retry).toBe("closed");
});

test("a GM who is not the active GM goes through the active GM", async ({ foundry, gamePage, browser }) => {
  const ids = await setupGroup(foundry, {});
  await gamePage.evaluate(async (name) => {
    if (!game.users.getName(name)) await User.create({ name, role: CONST.USER_ROLES.GAMEMASTER });
  }, GM2);
  other = await joinAs(browser, test.info().project.use.baseURL, GM2);
  const active = { first: await gamePage.evaluate(() => game.user.isActiveGM), second: await other.page.evaluate(() => game.user.isActiveGM) };
  expect(active.first !== active.second).toBe(true);
  const [activePage, passivePage] = active.first ? [gamePage, other.page] : [other.page, gamePage];
  const activeId = await activePage.evaluate(() => {
    window.__writes = [];
    for (const h of ["createItem", "updateItem", "deleteItem", "updateActor", "createActiveEffect", "updateActiveEffect", "createChatMessage"]) {
      Hooks.on(h, (...args) => window.__writes.push({ h, userId: args.findLast((x) => typeof x === "string") }));
    }
    return game.user.id;
  });
  const passiveId = await passivePage.evaluate(() => game.user.id);
  const r = await passivePage.evaluate(async ({ id }) => {
    const api = game.modules.get("group-travel").api;
    const group = await fromUuid(`Actor.${id}`);
    const out = {};
    out.active = game.user.isActiveGM;
    const stage = { id: "s9", name: "Forwarded", days: 1, terrain: "x", dc: 40, foodPerDay: 1, waterPerDay: 1, hoursPerDay: null };
    await api.saveTravel(group, { name: "Forwarded", tableUuid: null, stages: [stage] });
    await api.startStage(group);
    out.phaseAfterStart = group.getFlag("group-travel", "travel").run?.phase;
    await api.closeStage(group, { autoRoll: true });
    out.current = group.getFlag("group-travel", "travel").current;
    await api.undoStage(group);
    out.afterUndo = group.getFlag("group-travel", "travel").current;
    return out;
  }, { id: ids.groupId });
  const writes = await activePage.evaluate(() => window.__writes);
  const writers = [...new Set(writes.map((w) => w.userId))];
  fs.writeFileSync(test.info().outputPath("S6-mj-non-actif.json"), JSON.stringify({ r, activeId, passiveId, writers, writes: writes.length }, null, 2));
  expect(r.active).toBe(false);
  expect(r.phaseAfterStart).toBe("actions");
  expect(r.current).toBe(1);
  expect(r.afterUndo).toBe(0);
  expect(writes.length).toBeGreaterThan(0);
  expect(writers).toEqual([activeId]);
});
