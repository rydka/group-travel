/* global window, Actor, User */
// Shared helpers of the integration tests. `install(page)` defines
// `window.gtT` in the Foundry client (groups from the M4 fixtures, canonical
// capture for M5, cleanup). Everything created is tracked and removed by `cleanup()`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES = path.join(here, "..", "fixtures");
export const loadFixture = (rel) => JSON.parse(fs.readFileSync(path.join(FIXTURES, rel), "utf8"));
export const MODULE_ID = "group-travel";

/** Define window.gtT in the client. Safe to call twice. */
export async function install(page) {
  await page.evaluate(() => {
    const idFor = (k) => ("gt" + String(k).replace(/[^A-Za-z0-9]/g, "")).slice(0, 16).padEnd(16, "Z");
    const created = { actors: [], tables: [], messages: [] };

    const itemData = (c) => ({
      _id: idFor(c._id),
      name: c.name,
      type: c.type,
      system: {
        identifier: c.system.identifier,
        quantity: c.system.quantity,
        uses: { max: c.system.uses.max ? String(c.system.uses.max) : "", spent: c.system.uses.spent, autoDestroy: c.system.uses.autoDestroy },
        rarity: c.system.rarity,
        container: c.system.container ? idFor(c.system.container) : null
      },
      flags: c.flags ?? {}
    });

    /** Create a group (members, vehicles, items) from a fixture description. */
    async function makeGroup(spec, { tag = "GT" } = {}) {
      const map = {};
      const memberIds = [];
      for (const m of spec.members) {
        const actor = await Actor.create({ name: `${tag} ${m.name}`, type: m.type === "vehicle" ? "vehicle" : "character" });
        created.actors.push(actor.id);
        if (m.items?.length) await actor.createEmbeddedDocuments("Item", m.items.map(itemData), { keepId: true });
        map[m.id] = actor.id;
        memberIds.push(actor.id);
      }
      const system = { members: memberIds.map((id) => ({ actor: id })) };
      if (spec.primaryVehicle) system.primaryVehicle = map[spec.primaryVehicle];
      const group = await Actor.create({
        name: `${tag} ${spec.name}`, type: "group", system,
        flags: spec.inventorySource ? { dnd5e: { inventorySource: spec.inventorySource } } : {}
      });
      created.actors.push(group.id);
      if (spec.items?.length) await group.createEmbeddedDocuments("Item", spec.items.map(itemData), { keepId: true });
      map[spec.id] = group.id;
      return { group, map };
    }

    /** Canonical capture (M5): everything the module may touch, without _stats. */
    function canon(group) {
      const strip = (o) => {
        const c = foundry.utils.deepClone(o);
        const rec = (x) => {
          if (Array.isArray(x)) x.forEach(rec);
          else if (x && typeof x === "object") {
            delete x._stats;
            Object.values(x).forEach(rec);
          }
        };
        rec(c);
        return c;
      };
      const out = {};
      const actors = [group, ...group.system.members.map((m) => m.actor).filter(Boolean)];
      for (const a of actors) {
        out[a.id] = {
          items: a.items.map((i) => strip(i.toObject())).sort((x, y) => x._id.localeCompare(y._id)),
          effects: a.effects.map((e) => strip(e.toObject())).sort((x, y) => x._id.localeCompare(y._id)),
          exhaustion: a._source.system.attributes?.exhaustion ?? 0,
          flags: strip(a.flags?.["group-travel"] ?? {})
        };
      }
      return out;
    }

    /** Differences between two canonical captures, as dotted paths. */
    function diff(a, b, base = "") {
      const out = [];
      const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
      for (const k of keys) {
        const va = a?.[k], vb = b?.[k];
        const p = base ? `${base}.${k}` : k;
        if (va && vb && typeof va === "object" && typeof vb === "object") out.push(...diff(va, vb, p));
        else if (JSON.stringify(va) !== JSON.stringify(vb)) out.push(p);
      }
      return out;
    }

    async function cleanup() {
      for (const id of created.actors.splice(0)) await game.actors.get(id)?.delete();
      for (const id of created.tables.splice(0)) await game.tables.get(id)?.delete();
      for (const id of created.messages.splice(0)) await game.messages.get(id)?.delete();
      // Any chat message produced by the module during a test.
      const ours = game.messages.filter((m) => m.flags?.["group-travel"]).map((m) => m.id);
      if (ours.length) await ChatMessage.deleteDocuments(ours);
      const rolls = game.messages.filter((m) => m.rolls?.length).map((m) => m.id);
      if (rolls.length) await ChatMessage.deleteDocuments(rolls);
      for (const app of Object.values(ui.windows ?? {})) app.close?.();
      for (const app of foundry.applications.instances.values()) await app.close?.();
    }

    /** Table with the given effects per result (world table, tracked). */
    async function makeTable(name, results) {
      const table = await RollTable.create({
        name: `GT ${name}`, formula: `1d${results.length}`, replacement: true,
        results: results.map((r, i) => ({
          type: "text", name: r.name, description: r.name, range: [i + 1, i + 1], weight: 1,
          flags: { "group-travel": { effects: r.effects } }
        }))
      });
      created.tables.push(table.id);
      return table;
    }

    window.gtT = { idFor, itemData, makeGroup, canon, diff, cleanup, makeTable, created };
  });
}

/** Wait for a sheet render to settle. */
export const settle = (page, ms = 300) => page.waitForTimeout(ms);

/** Create (or reuse) a PLAYER user with the given permissions; returns its id. */
export async function ensurePlayer(page, { name, groupId, actorIds = [] }) {
  return page.evaluate(async ({ name, groupId, actorIds }) => {
    let user = game.users.getName(name);
    if (!user) user = await User.create({ name, role: CONST.USER_ROLES.PLAYER });
    const O = CONST.DOCUMENT_OWNERSHIP_LEVELS;
    const group = game.actors.get(groupId);
    await group.update({ [`ownership.${user.id}`]: O.OBSERVER });
    for (const id of actorIds) await game.actors.get(id).update({ [`ownership.${user.id}`]: O.OWNER });
    return user.id;
  }, { name, groupId, actorIds });
}

/** Open a second browser context logged in as the given user. */
export async function joinAs(browser, baseURL, name) {
  const context = await browser.newContext({ baseURL, viewport: { width: 1600, height: 900 }, storageState: { cookies: [], origins: [] } });
  await context.addInitScript(() => localStorage.setItem("core.noCanvas", "true"));
  const page = await context.newPage();
  await page.goto("/join");
  await page.getByRole("combobox", { name: "Select User" }).selectOption({ label: name });
  await page.getByRole("button", { name: "Join Game Session" }).click();
  await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
  return { context, page };
}
