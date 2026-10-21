// M4 (core level): exactness of totals, autonomy, comfort, tier and consumption
// on an annotated set. Never part of `npm test` (a metric is measured and
// recorded, it does not fail the build).
//
//   node tests/metrics/m4-core.mjs [<set-dir>] [--out=<file.json>]
//
// <set-dir> holds groups.json and voyages.json (default: the reference set).
// Fixture format: see tests/fixtures/m4/*/groups.json ("expected" blocks are
// annotated by hand). Shape assumptions about the core live in
// tests/helpers/builders.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateInventory, itemPortions } from "../../scripts/core/inventory.mjs";
import { classifyItem } from "../../scripts/core/recognition.mjs";
import { computeAutonomy } from "../../scripts/core/autonomy.mjs";
import { computeComfort } from "../../scripts/core/comfort.mjs";
import { resolveTier } from "../../scripts/core/tiers.mjs";
import { planConsumption } from "../../scripts/core/consumption.mjs";
import { effectiveDays, stageDc } from "../../scripts/core/pace.mjs";
import {
  DEFAULT_ENTRIES, DEFAULT_RULES, DEFAULT_TIERS, PACE_RULES, PINTS_PER_WATER_RATION, applyChanges, totalOf
} from "../helpers/builders.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dir = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(here, "../fixtures/m4/reference"));
const out = args.find((a) => a.startsWith("--out="))?.slice(6);
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));

const checks = [];
const check = (scope, name, actual, expected) => {
  const ok = typeof expected === "number" && typeof actual === "number"
    ? Math.abs(actual - expected) < 1e-9
    : JSON.stringify(actual) === JSON.stringify(expected);
  checks.push({ scope, name, ok, actual, expected });
};

const holdersOf = (g) => [
  ...g.members.filter((m) => m.type !== "vehicle").map((m) => ({ id: m.id, kind: "member", items: m.items })),
  { id: g.id, kind: "group", items: g.items }
];
const campItems = (holders) => holders.flatMap((h) => h.items).flatMap((i) => {
  const c = classifyItem(i, DEFAULT_ENTRIES);
  if (!c || !["shelter", "bedding"].includes(c.category)) return [];
  return [{ name: i.name, rarity: i.system.rarity, condition: i.flags?.["group-travel"]?.condition ?? "intact", quantity: i.system.quantity }];
});
const portions = (holders, id, category) => holders.find((h) => h.id === id).items
  .reduce((s, i) => (classifyItem(i, DEFAULT_ENTRIES)?.category === category ? s + itemPortions(i) : s), 0);

function runGroup(g) {
  const holders = holdersOf(g);
  const inv = aggregateInventory(holders, DEFAULT_ENTRIES);
  const e = g.expected;
  for (const c of Object.keys(e.totals)) check(g.id, `total.${c}`, totalOf(inv, c) ?? 0, e.totals[c]);
  const members = holders.filter((h) => h.kind === "member").length;
  check(g.id, "memberCount", members, e.memberCount);
  const a = computeAutonomy({ foodPortions: totalOf(inv, "food") ?? 0, waterPints: totalOf(inv, "water") ?? 0, members });
  check(g.id, "foodDays", a.foodDays ?? null, e.foodDays);
  check(g.id, "waterRations", a.waterRations, e.waterRations);
  check(g.id, "waterDays", a.waterDays ?? null, e.waterDays);
  check(g.id, "days", a.days, e.days);
  const comfort = computeComfort({ campItems: campItems(holders) }, DEFAULT_RULES);
  check(g.id, "comfort", comfort.score, e.comfort);
  check(g.id, "tier", resolveTier(comfort.score, DEFAULT_TIERS).id, e.tier);
}

function runVoyage(v) {
  const g = v.group;
  const holders = holdersOf(g);
  const x = v.expected;
  const days = effectiveDays(v.stage.days, v.pace, PACE_RULES);
  check(v.id, "effectiveDays", days, x.effectiveDays);
  const plan = planConsumption({
    members: holders.filter((h) => h.kind === "member"), group: holders.find((h) => h.kind === "group"),
    days, foodPerDay: v.stage.foodPerDay, waterPerDay: v.stage.waterPerDay,
    pintsPerWaterRation: PINTS_PER_WATER_RATION, entries: DEFAULT_ENTRIES
  });
  const after = applyChanges(holders, plan.changes);
  const idOfGroup = g.id;
  for (const [who, want] of Object.entries(x.finalPortions)) {
    const id = who === "group" ? idOfGroup : who;
    check(v.id, `final.${who}.food`, portions(after, id, "food"), want.food);
    check(v.id, `final.${who}.water`, portions(after, id, "water"), want.water);
  }
  const deleted = Object.values(plan.changes).flatMap((c) => (c.delete ?? []).map((d) => d?._id ?? d)).sort();
  check(v.id, "deletedItems", deleted, [...x.deletedItems].sort());
  const shortage = { food: false, water: false };
  for (const [id, want] of Object.entries(x.intake)) {
    const series = plan.intake[id] ?? [];
    check(v.id, `intake.${id}.food`, series.map((d) => d.food), want.food);
    check(v.id, `intake.${id}.water`, series.map((d) => d.water), want.water);
    if (series.some((d) => d.food < v.stage.foodPerDay)) shortage.food = true;
    if (series.some((d) => d.water < v.stage.waterPerDay * PINTS_PER_WATER_RATION)) shortage.water = true;
  }
  check(v.id, "shortage", shortage, x.shortage);
  const before = computeComfort({ campItems: campItems(holders) }, DEFAULT_RULES).score;
  check(v.id, "comfortBefore", before, x.comfortBefore);
  const afterComfort = computeComfort({ campItems: campItems(holders), shortage }, DEFAULT_RULES);
  check(v.id, "comfortAfter", afterComfort.score, x.comfortAfter);
  const tier = resolveTier(afterComfort.score, DEFAULT_TIERS);
  check(v.id, "tierAfter", tier.id, x.tierAfter);
  for (const [id, want] of Object.entries(x.fatigueDc)) {
    const base = stageDc({ stageDc: v.stage.dc, tierDc: tier.dc, pace: v.pace, paceRules: PACE_RULES }).dc;
    const short = (plan.intake[id] ?? []).some((d) => d.food < v.stage.foodPerDay || d.water < v.stage.waterPerDay * PINTS_PER_WATER_RATION);
    check(v.id, `fatigueDc.${id}`, base + (short ? 5 : 0), want);
  }
}

for (const g of read("groups.json")) runGroup(g);
if (fs.existsSync(path.join(dir, "voyages.json"))) for (const v of read("voyages.json")) runVoyage(v);

const ok = checks.filter((c) => c.ok).length;
const result = { set: path.basename(dir), checks: checks.length, ok, accuracy: checks.length ? ok / checks.length : null, failures: checks.filter((c) => !c.ok) };
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`${result.set}: ${ok}/${checks.length} (${(100 * result.accuracy).toFixed(1)} %)`);
for (const f of result.failures) console.log(`  FAIL ${f.scope} ${f.name}: got ${JSON.stringify(f.actual)}, expected ${JSON.stringify(f.expected)}`);
