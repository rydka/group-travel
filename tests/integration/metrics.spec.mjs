/* global window */
// Metrics M2, M3 and M4 (integration level). They measure and record: no
// assertion depends on the value of a metric (only on the test having run).
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "../../../../test-env/fixtures.mjs";
import { FIXTURES, install, loadFixture, settle } from "./helpers.mjs";

test.beforeEach(async ({ gamePage }) => {
  await install(gamePage);
});
test.afterEach(async ({ gamePage }) => {
  await gamePage.evaluate(async () => {
    await game.settings.set("group-travel", "officialRules", { forcedMarch: true, privation: false });
    await game.settings.set("dnd5e", "rulesVersion", "modern");
    await window.gtT.cleanup();
  });
});

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

test("M2: display time of the tab for 6 members x 100 objects", async ({ gamePage, foundry }) => {
  const spec = loadFixture("m2/group-6x100.json");
  const { id } = await foundry(async (spec) => {
    const { group } = await window.gtT.makeGroup(spec);
    return { id: group.id };
  }, spec);
  const r = await foundry(async (id) => {
    const group = game.actors.get(id);
    const api = game.modules.get("group-travel").api;
    await group.sheet.render({ force: true });
    await group.sheet.changeTab("travel", "primary");
    for (let i = 0; i < 3; i++) await group.sheet.render({ parts: ["travel"] });
    const renders = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      await group.sheet.render({ parts: ["travel"] });
      renders.push(performance.now() - t);
    }
    const ctxTimes = [];
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      api.buildTravelContext(group);
      ctxTimes.push(performance.now() - t);
    }
    const ctx = api.buildTravelContext(group);
    return { renders, ctxTimes, totals: Object.fromEntries(ctx.inventory.map((c) => [c.category, c.totalText])), members: ctx.memberCount, items: group.system.creatures.map((a) => a.items.size) };
  }, id);
  const summary = { renderMedianMs: median(r.renders), renderMaxMs: Math.max(...r.renders), contextMedianMs: median(r.ctxTimes), contextMaxMs: Math.max(...r.ctxTimes), items: r.items, totals: r.totals, target: "<= 200 ms" };
  fs.writeFileSync(test.info().outputPath("M2-temps-affichage.json"), JSON.stringify({ ...summary, renders: r.renders, ctxTimes: r.ctxTimes }, null, 2));
  await settle(gamePage);
  await gamePage.screenshot({ path: test.info().outputPath("M2-onglet-6x100.png") });
  expect(r.members).toBe(6);
  expect(r.items.every((n) => n === 100)).toBe(true);
  console.log("M2", JSON.stringify(summary));
});

test("M3: closure time of a 4-day stage (6 members, forced march, partial privation)", async ({ foundry }) => {
  const spec = loadFixture("m2/group-6x100.json");
  const r = await foundry(async (spec) => {
    const api = game.modules.get("group-travel").api;
    const { group } = await window.gtT.makeGroup(spec);
    await game.settings.set("group-travel", "officialRules", { forcedMarch: true, privation: true });
    await api.saveTravel(group, {
      name: "M3", tableUuid: null,
      stages: [{ id: "s1", name: "Long march", days: 4, terrain: "plain", dc: null, foodPerDay: 1, waterPerDay: 3, hoursPerDay: 10 }]
    });
    const times = [];
    const exhaustion = [];
    for (let pass = 0; pass < 5; pass++) {
      await api.startStage(group);
      const t = performance.now();
      await api.closeStage(group, { autoRoll: true });
      const card = game.messages.find((m) => m.flags["group-travel"]?.card && !m.flags["group-travel"].card.undone);
      times.push(performance.now() - t);
      exhaustion.push(card ? group.system.creatures.reduce((s, a) => s + a.system.attributes.exhaustion, 0) : null);
      if (!card) break;
      await api.undoStage(group);
      await ChatMessage.deleteDocuments(game.messages.filter((m) => m.flags["group-travel"]).map((m) => m.id));
    }
    return { times, exhaustion };
  }, spec);
  const summary = { medianMs: median(r.times), maxMs: Math.max(...r.times), passes: r.times.length, target: "<= 3000 ms" };
  fs.writeFileSync(test.info().outputPath("M3-duree-cloture.json"), JSON.stringify({ ...summary, times: r.times, exhaustionTotals: r.exhaustion }, null, 2));
  expect(r.times).toHaveLength(5);
  console.log("M3", JSON.stringify(summary));
});

/* -------------------------------------------- */
/*  M4 at the integration level                 */
/* -------------------------------------------- */

const sets = fs.readdirSync(path.join(FIXTURES, "m4")).filter((d) => fs.existsSync(path.join(FIXTURES, "m4", d, "groups.json")));

for (const set of sets) {
  test(`M4 (tab and closure on real documents): set ${set}`, async ({ foundry }) => {
    const groups = loadFixture(`m4/${set}/groups.json`);
    const voyages = fs.existsSync(path.join(FIXTURES, "m4", set, "voyages.json")) ? loadFixture(`m4/${set}/voyages.json`) : [];
    const checks = [];
    const out = await foundry(async ({ groups, voyages }) => {
      const api = game.modules.get("group-travel").api;
      const checks = [];
      const check = (scope, name, actual, expected) => {
        const ok = typeof expected === "number" && typeof actual === "number" ? Math.abs(actual - expected) < 1e-9 : JSON.stringify(actual) === JSON.stringify(expected);
        checks.push({ scope, name, ok, actual, expected });
      };
      const num = (t) => Number(/[\d.]+/.exec(t)?.[0] ?? 0);
      const dash = (v) => (v === "—" ? null : v);

      for (const g of groups) {
        const { group } = await window.gtT.makeGroup(g);
        const ctx = api.buildTravelContext(group);
        const tot = Object.fromEntries(ctx.inventory.map((c) => [c.category, c.totalText]));
        const e = g.expected;
        check(g.id, "total.food", num(tot.food), e.totals.food);
        check(g.id, "total.water", Number(/([\d.]+) pints/.exec(tot.water)?.[1] ?? 0), e.totals.water);
        for (const c of ["shelter", "bedding", "gear"]) check(g.id, `total.${c}`, num(tot[c]), e.totals[c]);
        check(g.id, "memberCount", ctx.memberCount, e.memberCount);
        check(g.id, "foodDays", dash(ctx.autonomy.foodDays), e.foodDays === null ? null : Math.round(e.foodDays * 100) / 100);
        check(g.id, "waterDays", dash(ctx.autonomy.waterDays), e.waterDays === null ? null : Math.round(e.waterDays * 100) / 100);
        check(g.id, "days", dash(ctx.autonomy.days), e.days);
        check(g.id, "comfort", ctx.comfort.score, e.comfort);
        const tier = api.getRules().tiers.find((t) => t.id === e.tier);
        check(g.id, "tier", ctx.tier.name, game.i18n.localize(tier.name));
        await window.gtT.cleanup();
      }

      for (const v of voyages) {
        const x = v.expected;
        const { group, map } = await window.gtT.makeGroup(v.group);
        const id = (k) => (k === "group" ? group.id : map[k]);
        const portions = (actorId) => {
          const out = { food: 0, water: 0 };
          const { classifyItem } = api.core.recognition;
          const { itemPortions } = api.core.inventory;
          const plain = (i) => ({ _id: i.id, name: i.name, type: i.type, system: { identifier: i.system.identifier, quantity: i.system.quantity, uses: { max: Number(i.system.uses.max) || 0, spent: i.system.uses.spent || 0, autoDestroy: !!i.system.uses.autoDestroy }, container: i.system.container } });
          for (const i of game.actors.get(actorId).items) {
            const c = classifyItem(plain(i), api.getRules().recognition);
            if (c && (c.category === "food" || c.category === "water")) out[c.category] += itemPortions(plain(i));
          }
          return out;
        };
        const before = new Set([group, ...Object.values(map).map((a) => game.actors.get(a))].flatMap((a) => a.items.map((i) => i.id)));
        const priorVersion = game.settings.get("dnd5e", "rulesVersion");
        await game.settings.set("dnd5e", "rulesVersion", v.rulesVersion);
        await game.settings.set("group-travel", "officialRules", { forcedMarch: true, privation: !!v.officialPrivation });
        await api.saveTravel(group, { name: v.name, tableUuid: null, stages: [v.stage] });
        await api.startStage(group);
        await api.setPace(group, v.pace);
        await api.closeStage(group, { autoRoll: false });
        const run = group.getFlag("group-travel", "travel").run;
        check(v.id, "effectiveDays", run.effectiveDays, x.effectiveDays);
        for (const [who, want] of Object.entries(x.finalPortions)) {
          const got = portions(id(who));
          check(v.id, `final.${who}.food`, got.food, want.food);
          check(v.id, `final.${who}.water`, got.water, want.water);
        }
        const after = new Set([group, ...Object.values(map).map((a) => game.actors.get(a))].flatMap((a) => a.items.map((i) => i.id)));
        const deleted = [...before].filter((i) => !after.has(i)).sort();
        check(v.id, "deletedItems", deleted, x.deletedItems.map((k) => window.gtT.idFor(k)).sort());
        const ppwr = api.getRules().water.pintsPerWaterRation;
        let sf = false, sw = false;
        for (const [who, want] of Object.entries(x.intake)) {
          const info = run.memberInfo[map[who]];
          check(v.id, `intake.${who}.food`, info.intake.map((d) => d.food), want.food);
          check(v.id, `intake.${who}.water`, info.intake.map((d) => d.water * ppwr), want.water);
          sf ||= info.shortage.food; sw ||= info.shortage.water;
        }
        check(v.id, "shortage", { food: sf, water: sw }, x.shortage);
        check(v.id, "comfortAfter", run.consumption.comfortAfter, x.comfortAfter);
        check(v.id, "tierAfter", run.consumption.tier.id, x.tierAfter);
        for (const [who, want] of Object.entries(x.fatigueDc)) check(v.id, `fatigueDc.${who}`, run.memberInfo[map[who]].dc.dc, want);
        if (x.saveQueue) {
          for (const [who, want] of Object.entries(x.saveQueue)) {
            const got = run.saves[map[who]].map((s) => {
              const o = { kind: s.kind, ...(s.day ? { day: s.day } : {}), ...(s.dc && s.kind !== "water" && s.kind !== "food" ? { dc: s.dc } : {}), ...(s.auto && s.kind !== "march" ? { type: "auto" } : {}) };
              return o;
            });
            check(v.id, `saveQueue.${who}`, got, want);
          }
        }
        await api.undoStage(group);
        await game.settings.set("dnd5e", "rulesVersion", priorVersion);
        await window.gtT.cleanup();
      }
      return checks;
    }, { groups, voyages });
    checks.push(...out);
    const ok = checks.filter((c) => c.ok).length;
    const result = { set, checks: checks.length, ok, accuracy: ok / checks.length, failures: checks.filter((c) => !c.ok) };
    fs.writeFileSync(test.info().outputPath(`M4-integration-${set}.json`), JSON.stringify(result, null, 2));
    console.log(`M4 integration ${set}: ${ok}/${checks.length}`);
    expect(checks.length).toBeGreaterThan(0);
  });
}
