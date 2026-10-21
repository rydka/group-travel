// Travel and stage state machine. Every function is pure and returns a copy.
// Phases of a run: "event" -> "actions" -> "saves" -> "done".
import { forcedMarchChecks } from "./forced-march.mjs";
import { SCHEMA_VERSION } from "./migrate.mjs";

const copy = (x) => structuredClone(x);
let counter = 0;
/** Local id generator (the Foundry layer may pass its own ids). */
export function makeId(prefix = "gt") {
  counter = (counter + 1) % 1e6;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Normalise a stage definition. */
export function normalizeStage(s = {}) {
  const num = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  return {
    id: s.id ?? makeId("s"),
    name: String(s.name ?? ""),
    days: Math.max(0, num(s.days, 1)),
    terrain: String(s.terrain ?? ""),
    dc: typeof s.dc === "number" && Number.isFinite(s.dc) ? s.dc : null,
    foodPerDay: Math.max(0, num(s.foodPerDay, 1)),
    waterPerDay: Math.max(0, num(s.waterPerDay, 1)),
    hoursPerDay: typeof s.hoursPerDay === "number" && Number.isFinite(s.hoursPerDay) ? s.hoursPerDay : null
  };
}

/**
 * @param {{ id?, name, tableUuid, tiers, stages }} data
 * @returns {object} Travel
 */
export function createTravel(data = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: data.id ?? makeId("t"),
    name: String(data.name ?? ""),
    tableUuid: data.tableUuid ?? null,
    status: "planning",
    tiers: copy(data.tiers ?? []),
    current: 0,
    stages: (data.stages ?? []).map(normalizeStage),
    counters: {},
    run: null,
    history: []
  };
}

/** The stage at `travel.current`, or null when the travel is over. */
export function currentStage(travel) {
  return travel?.stages?.[travel.current] ?? null;
}

/**
 * Start the current stage.
 * @param {object} travel
 * @param {{ members: string[], pace: string, effectiveDays: number, comfortBefore: number,
 *           eventPlan: object|null, runId?: string, event?: object|null }} args
 * @returns {object} Travel copy with `run` set, phase "actions".
 */
export function startRun(travel, { members, pace, effectiveDays, comfortBefore, eventPlan = null, runId, event = null }) {
  const stage = currentStage(travel);
  if (!stage) throw new Error("group-travel | no stage left to start");
  const next = copy(travel);
  next.status = "active";
  next.run = {
    id: runId ?? makeId("r"),
    stageId: stage.id,
    phase: "actions",
    members: [...(members ?? [])],
    pace,
    effectiveDays,
    comfortBefore,
    event: event ? copy(event) : null,
    eventPlan: eventPlan ? copy(eventPlan) : null,
    comfortMods: [],
    actions: {},
    consumption: null,
    saves: {},
    createdItems: []
  };
  return next;
}

/** Change the pace of the running stage. */
export function setPace(travel, pace, effectiveDays) {
  const next = copy(travel);
  if (!next.run) return next;
  next.run.pace = pace;
  if (effectiveDays !== undefined) next.run.effectiveDays = effectiveDays;
  return next;
}

/** Record a member's chosen action (one per member, last choice wins). */
export function setAction(travel, actorId, choice) {
  const next = copy(travel);
  if (!next.run) return next;
  next.run.actions[actorId] = { ...copy(choice ?? {}), result: null };
  return next;
}

/**
 * Record the result of a member's action check.
 * @param {object} travel
 * @param {string} actorId
 * @param {{ total: number, success: boolean, messageId?: string, outcome?: object|null }} result
 */
export function recordActionResult(travel, actorId, result) {
  const next = copy(travel);
  if (!next.run?.actions?.[actorId]) return next;
  next.run.actions[actorId].result = copy(result);
  return next;
}

/**
 * Ordered save queue of one member: for each day, forced march saves then that
 * day's privation steps (food, then water); then the fatigue save.
 * @param {object} args
 * @param {number} args.days
 * @param {number|null} args.hoursPerDay
 * @param {boolean} args.forcedMarch
 * @param {object[][]} [args.privationByDay]  Index 0 = day 1; steps of dailyPrivation().
 * @param {{ dc: number }|null} args.fatigue   null when the fatigue save is disabled.
 * @param {number} [args.threshold=8]
 * @returns {object[]} Save[]
 */
export function buildSaveQueue({ days, hoursPerDay, forcedMarch, privationByDay = [], fatigue, threshold = 8 }) {
  const queue = [];
  const march = forcedMarch ? forcedMarchChecks(hoursPerDay, days, { threshold }) : [];
  const order = { food: 0, water: 1 };
  for (let day = 1; day <= (Number(days) || 0); day++) {
    for (const m of march.filter((x) => x.day === day)) {
      queue.push({ kind: "march", day, hour: m.hour, dc: m.dc, levels: 1, auto: false, result: null });
    }
    const steps = [...(privationByDay?.[day - 1] ?? [])].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
    for (const s of steps) {
      const save = { kind: s.kind, day, dc: s.type === "save" ? s.dc ?? null : null, levels: s.levels ?? 1,
        auto: s.type === "auto", result: null };
      if (s.levelsIfExhausted !== undefined) save.levelsIfExhausted = s.levelsIfExhausted;
      if (s.status) save.status = s.status;
      queue.push(save);
    }
  }
  if (fatigue) queue.push({ kind: "fatigue", dc: fatigue.dc, levels: 1, auto: false, result: null });
  return queue;
}

/**
 * First unresolved save of a member.
 * @returns {{ index: number, save: object }|null}
 */
export function nextPendingSave(run, actorId) {
  const saves = run?.saves?.[actorId] ?? [];
  const index = saves.findIndex((s) => !s.result);
  return index < 0 ? null : { index, save: saves[index] };
}

/**
 * Record a save result; returns a run copy.
 * @param {object} run
 * @param {string} actorId
 * @param {number} index
 * @param {{ total: number|null, success: boolean, applied: boolean, messageId?: string, levels?: number }} result
 */
export function recordSave(run, actorId, index, result) {
  const next = copy(run);
  const save = next.saves?.[actorId]?.[index];
  if (save) save.result = copy(result);
  return next;
}

/** Every member has resolved every save. */
export function isRunComplete(run) {
  return Object.values(run?.saves ?? {}).every((list) => list.every((s) => !!s.result));
}

/**
 * Close the run: next stage becomes current, history updated.
 * @param {object} travel
 * @param {{ cardId?: string }} summary
 */
export function finishRun(travel, summary = {}) {
  const next = copy(travel);
  const run = next.run;
  next.history.push({ stageId: run?.stageId ?? null, runId: run?.id ?? null, cardId: summary?.cardId ?? null, summary: copy(summary ?? {}) });
  next.current += 1;
  next.run = null;
  next.status = next.current >= next.stages.length ? "finished" : "active";
  return next;
}
