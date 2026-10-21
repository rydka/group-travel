/* global window, document */
import fs from "node:fs";
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { install, loadFixture, settle } from "./helpers.mjs";

const groups = loadFixture("m4/reference/groups.json");
const byId = (id) => groups.find((g) => g.id === id);

test.beforeEach(async ({ gamePage }) => {
  await install(gamePage);
});
test.afterEach(async ({ gamePage }) => {
  await gamePage.evaluate(async () => {
    await game.settings.set("group-travel", "enabled", true);
    await window.gtT.cleanup();
  });
});

const openSheet = (page, groupId) => page.evaluate(async (id) => {
  const group = game.actors.get(id);
  await group.sheet.render({ force: true });
  return true;
}, groupId);

test("C1: the group sheet gets a Travel tab, other tabs and sheets are untouched", async ({ gamePage, foundry }) => {
  const spec = byId("g01");
  const { id } = await foundry(async (spec) => {
    const { group } = await window.gtT.makeGroup(spec);
    return { id: group.id };
  }, spec);
  await openSheet(gamePage, id);
  await settle(gamePage, 800);

  const info = await foundry((id) => {
    const S = dnd5e.applications.actor;
    const tabs = (cls) => cls.TABS.map((t) => t.tab);
    const nav = [...document.querySelectorAll(`.application[data-appid="${game.actors.get(id).sheet.id}"] nav [data-tab], #${game.actors.get(id).sheet.id} nav [data-tab]`)].map((a) => a.dataset.tab);
    return {
      groupTabs: tabs(S.GroupActorSheet),
      nav: [...new Set(nav)],
      parts: Object.keys(S.GroupActorSheet.PARTS),
      other: {
        character: [tabs(S.CharacterActorSheet).includes("travel"), "travel" in S.CharacterActorSheet.PARTS],
        npc: [tabs(S.NPCActorSheet).includes("travel"), "travel" in S.NPCActorSheet.PARTS],
        vehicle: [tabs(S.VehicleActorSheet).includes("travel"), "travel" in S.VehicleActorSheet.PARTS],
        encounter: [tabs(S.EncounterActorSheet).includes("travel"), "travel" in S.EncounterActorSheet.PARTS]
      }
    };
  }, id);
  fs.writeFileSync(test.info().outputPath("C1-tabs.json"), JSON.stringify(info, null, 2));
  for (const t of ["members", "inventory", "effects", "biography", "travel"]) expect(info.groupTabs).toContain(t);
  expect(info.nav).toEqual(expect.arrayContaining(["members", "inventory", "effects", "biography", "travel"]));
  for (const [kind, [tab, part]] of Object.entries(info.other)) {
    expect(tab, `${kind} tab`).toBe(false);
    expect(part, `${kind} part`).toBe(false);
  }

  await gamePage.locator('nav [data-tab="travel"]').first().click();
  await settle(gamePage);
  await gamePage.screenshot({ path: test.info().outputPath("C1-onglet-voyage.png") });
  // The original tabs still work.
  for (const tab of ["inventory", "members"]) {
    await gamePage.locator(`nav [data-tab="${tab}"]`).first().click();
    await expect(gamePage.locator(`.group-sheet section[data-tab="${tab}"], section.tab[data-tab="${tab}"]`).first()).toBeVisible();
  }
});

test("C1: the tab survives re-renders (group and member updates) and the setting hides it", async ({ gamePage, foundry }) => {
  const { id, memberId, itemId } = await foundry(async (spec) => {
    const { group, map } = await window.gtT.makeGroup(spec);
    const arwen = game.actors.get(map.arwen);
    return { id: group.id, memberId: arwen.id, itemId: arwen.items.contents[0].id };
  }, byId("g01"));
  await openSheet(gamePage, id);
  await gamePage.locator('nav [data-tab="travel"]').first().click();
  await settle(gamePage);
  await foundry(async ({ id, memberId, itemId }) => {
    await game.actors.get(id).update({ name: "GT renamed group" });
    await game.actors.get(memberId).items.get(itemId).update({ "system.quantity": 9 });
  }, { id, memberId, itemId });
  await settle(gamePage, 800);
  expect(await foundry((id) => game.actors.get(id).sheet.tabGroups.primary, id)).toBe("travel");
  await expect(gamePage.locator('section.group-travel[data-tab="travel"]').first()).toBeVisible();

  await foundry(async (id) => {
    await game.settings.set("group-travel", "enabled", false);
    await game.actors.get(id).sheet.close();
    await game.actors.get(id).sheet.render({ force: true });
  }, id);
  await settle(gamePage, 800);
  await expect(gamePage.locator('nav [data-tab="travel"]')).toHaveCount(0);
});

test("C2: inventory by category over members and group, vehicles excluded, nothing moved", async ({ foundry }) => {
  const result = {};
  for (const gid of ["g01", "g04", "g08", "g07"]) {
    const spec = byId(gid);
    result[gid] = await foundry(async (spec) => {
      const { group } = await window.gtT.makeGroup(spec);
      const before = Object.fromEntries([group, ...game.actors.filter((a) => a.name.startsWith("GT "))].map((a) => [a.id, a.items.size]));
      const ctx = game.modules.get("group-travel").api.buildTravelContext(group);
      const after = Object.fromEntries(Object.keys(before).map((k) => [k, game.actors.get(k).items.size]));
      await window.gtT.cleanup();
      return {
        totals: Object.fromEntries(ctx.inventory.map((c) => [c.category, c.totalText])),
        memberCount: ctx.memberCount, moved: JSON.stringify(before) !== JSON.stringify(after)
      };
    }, spec);
  }
  fs.writeFileSync(test.info().outputPath("C2-inventaire.json"), JSON.stringify(result, null, 2));
  expect(result.g01.totals.food).toBe("14 ration(s)");
  expect(result.g01.totals.water).toBe("12 water ration(s) (48 pints)");
  expect(result.g01.totals.shelter).toBe("2");
  expect(result.g01.totals.bedding).toBe("3");
  expect(result.g04.totals.food).toBe("3 ration(s)"); // the wagon (50 rations) is not counted
  expect(result.g04.memberCount).toBe(1);
  expect(result.g08.totals.water).toContain("4 pints"); // pints inside a waterskin inside a backpack
  expect(result.g07.totals.food).toBe("14 ration(s)"); // members + group
  for (const r of Object.values(result)) expect(r.moved).toBe(false);
});

test("C2: the tab follows an inventory change", async ({ gamePage, foundry }) => {
  const { id, memberId } = await foundry(async (spec) => {
    const { group, map } = await window.gtT.makeGroup(spec);
    return { id: group.id, memberId: map.arwen };
  }, byId("g01"));
  await openSheet(gamePage, id);
  await gamePage.locator('nav [data-tab="travel"]').first().click();
  const total = gamePage.locator('section.group-travel[data-tab="travel"] .gt-cat >> nth=0 >> .gt-total >> nth=0');
  await expect(total).toHaveText("14 ration(s)");
  await foundry(async (memberId) => {
    const a = game.actors.get(memberId);
    await a.createEmbeddedDocuments("Item", [{ name: "Rations", type: "consumable", system: { identifier: "rations", quantity: 6, uses: { max: "1", spent: 0, autoDestroy: true } } }]);
  }, memberId);
  await expect(total).toHaveText("20 ration(s)");
  await gamePage.screenshot({ path: test.info().outputPath("C2-inventaire-mis-a-jour.png") });
});

test("C3: autonomy (scenario 2), and a group without members", async ({ foundry }) => {
  const r = await foundry(async ({ g01, g03 }) => {
    const api = game.modules.get("group-travel").api;
    const a = (await window.gtT.makeGroup(g01)).group;
    const b = (await window.gtT.makeGroup(g03)).group;
    const out = { full: api.buildTravelContext(a), empty: api.buildTravelContext(b) };
    await window.gtT.cleanup();
    return { full: out.full.autonomy, empty: { autonomy: out.empty.autonomy, noMembers: out.empty.noMembers } };
  }, { g01: byId("g01"), g03: byId("g03") });
  fs.writeFileSync(test.info().outputPath("C3-autonomie.json"), JSON.stringify(r, null, 2));
  expect(r.full.days).toBe(3);
  expect(r.full.waterDays).toBe(3);
  expect(r.full.foodDays).toBe(3.5);
  expect(r.empty.noMembers).toBe(true);
  expect(r.empty.autonomy.days).toBe("—");
});

test("C4, C5, C6: condition stored on the object, comfort and tier follow live", async ({ gamePage, foundry }) => {
  const { id, bedrollId, pia } = await foundry(async (spec) => {
    const { group, map } = await window.gtT.makeGroup(spec);
    return { id: group.id, pia: map.pia, bedrollId: window.gtT.idFor("pia-b") };
  }, byId("g09")); // 5 bedrolls = comfort 5 = "Correct"
  await openSheet(gamePage, id);
  await gamePage.locator('nav [data-tab="travel"]').first().click();
  const badge = gamePage.locator('section.group-travel[data-tab="travel"] .gt-tier').first();
  await expect(badge).toContainText("5");
  const tierBefore = await badge.innerText();
  await gamePage.screenshot({ path: test.info().outputPath("C5-palier-avant.png") });

  const flag = await foundry(async ({ pia, bedrollId }) => {
    const item = game.actors.get(pia).items.get(bedrollId);
    await game.modules.get("group-travel").api.setItemCondition(item, "worn");
    return item.getFlag("group-travel", "condition");
  }, { pia, bedrollId });
  expect(flag).toBe("worn");
  await expect(badge).toContainText("2.5");
  const tierAfter = await badge.innerText();
  expect(tierAfter).not.toBe(tierBefore);
  await gamePage.screenshot({ path: test.info().outputPath("C6-etat-use-palier-change.png") });
  await expect(gamePage.locator('section.group-travel[data-tab="travel"] select[data-gt-change="condition"]').first()).toHaveValue("worn");

  const destroyed = await foundry(async ({ id, pia, bedrollId }) => {
    const api = game.modules.get("group-travel").api;
    await api.setItemCondition(game.actors.get(pia).items.get(bedrollId), "destroyed");
    const ctx = api.buildTravelContext(game.actors.get(id));
    return { score: ctx.comfort.score, tier: ctx.tier.name, lines: ctx.comfort.lines.length };
  }, { id, pia, bedrollId });
  fs.writeFileSync(test.info().outputPath("C6-detruit.json"), JSON.stringify({ tierBefore, tierAfter, destroyed }, null, 2));
  expect(destroyed.score).toBe(0);
  expect(destroyed.tier).toMatch(/miser/i);
});

test("C4: comfort detail by rarity x condition x quantity", async ({ foundry }) => {
  const r = await foundry(async (spec) => {
    const { group } = await window.gtT.makeGroup(spec);
    const ctx = game.modules.get("group-travel").api.buildTravelContext(group);
    await window.gtT.cleanup();
    return { score: ctx.comfort.score, lines: ctx.comfort.lines };
  }, byId("g06"));
  fs.writeFileSync(test.info().outputPath("C4-detail-confort.json"), JSON.stringify(r, null, 2));
  expect(r.score).toBe(6.75);
  expect(r.lines.length).toBeGreaterThanOrEqual(5);
});

test("C15: no rarity = common, unrecognised objects absent, removed member no longer counted", async ({ foundry }) => {
  const r = await foundry(async (spec) => {
    const api = game.modules.get("group-travel").api;
    const { group, map } = await window.gtT.makeGroup(spec);
    const names = (ctx) => ctx.inventory.flatMap((c) => c.rows.map((x) => x.name));
    const before = api.buildTravelContext(group);
    const namesBefore = names(before);
    await group.update({ "system.members": group.system.members.filter((m) => m.actor.id !== map.hugo).map((m) => ({ actor: m.actor.id })) });
    const after = api.buildTravelContext(group);
    await window.gtT.cleanup();
    return { namesBefore, members: [before.memberCount, after.memberCount], food: [before.inventory[0].totalText, after.inventory[0].totalText] };
  }, byId("g05"));
  fs.writeFileSync(test.info().outputPath("C15-reconnaissance.json"), JSON.stringify(r, null, 2));
  expect(r.namesBefore.join("|")).not.toMatch(/Épée|Gold/);
  expect(r.members).toEqual([2, 1]);
  expect(r.food).toEqual(["5 ration(s)", "2 ration(s)"]);
});
