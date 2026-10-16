// "Travel" tab of the dnd5e group sheet: declared PART and TAB (no DOM
// injection), context from dnd5e.prepareSheetContext, delegated listeners.
import { CATEGORIES, CONDITIONS, MODULE_ID, PACES } from "../core/constants.mjs";
import { canDo } from "../core/rights.mjs";
import { currentStage, nextPendingSave } from "../core/stage.mjs";
import { effectiveDays, stageDc } from "../core/pace.mjs";
import { getRules, isEnabled } from "./settings.mjs";
import { getTravel, getUndo } from "./read.mjs";
import { computeGroupState } from "./state.mjs";

export const TAB_TEMPLATE = `modules/${MODULE_ID}/templates/travel-tab.hbs`;

const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const round = (n) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * 100) / 100 : n);

/** Declare the part and the tab on GroupActorSheet. Called on `init`. */
export function registerTravelTab() {
  const Sheet = dnd5e.applications.actor.GroupActorSheet;
  Sheet.PARTS.travel = {
    container: { classes: ["tab-body"], id: "tabs" },
    template: TAB_TEMPLATE,
    scrollable: [".gt-scroll"]
  };
  if (!Sheet.TABS.some((t) => t.tab === "travel")) {
    Sheet.TABS.push({ tab: "travel", label: `${MODULE_ID}.Tab.Label`, icon: "fa-solid fa-route", condition: () => isEnabled() });
  }

  Hooks.on("dnd5e.prepareSheetContext", (sheet, partId, context) => {
    if (partId !== "travel" || !(sheet instanceof Sheet)) return;
    try {
      context.travel = buildTravelContext(sheet.actor);
    } catch (err) {
      console.error(`${MODULE_ID} | travel tab context`, err);
      context.travel = { error: err.message };
    }
  });

  Hooks.on(`render${Sheet.name}`, (app, element) => bindTravelTab(app, element));
}

/** Human-readable description of an event effect. */
export function describeEffect(e) {
  switch (e?.type) {
    case "loseFood": return fmt(`${MODULE_ID}.EffectText.loseFood`, { n: e.amount });
    case "loseWater": return fmt(`${MODULE_ID}.EffectText.loseWater`, { n: e.amount });
    case "damageItem": return fmt(`${MODULE_ID}.EffectText.damageItem`, {
      n: e.count ?? 1, steps: e.steps ?? 1,
      category: e.category && e.category !== "any" ? loc(`${MODULE_ID}.Category.${e.category}`) : loc(`${MODULE_ID}.Category.any`)
    });
    case "comfort": return fmt(`${MODULE_ID}.EffectText.comfort`, { n: e.value > 0 ? `+${e.value}` : e.value });
    default: return loc(`${MODULE_ID}.EffectText.none`);
  }
}

/** Label of a queued save. */
export function describeSave(s) {
  const kind = loc(`${MODULE_ID}.Save.${s.kind}`);
  const where = s.kind === "march" ? fmt(`${MODULE_ID}.Save.dayHour`, { day: s.day, hour: s.hour })
    : s.day ? fmt(`${MODULE_ID}.Save.day`, { day: s.day }) : "";
  return [kind, where].filter(Boolean).join(" · ");
}

/** Text of a save result. */
export function describeSaveResult(r) {
  if (!r) return "";
  if (r.skipped === "max") return loc(`${MODULE_ID}.Save.maxLevel`);
  if (r.skipped === "missing") return loc(`${MODULE_ID}.Save.missing`);
  const parts = [];
  if (r.total !== null && r.total !== undefined) parts.push(String(r.total));
  parts.push(loc(r.success ? `${MODULE_ID}.Save.success` : `${MODULE_ID}.Save.failure`));
  if (!r.success) {
    if (r.disabled) parts.push(loc(`${MODULE_ID}.Save.notApplied`));
    else if (r.levels) parts.push(fmt(`${MODULE_ID}.Save.levels`, { n: r.levels }));
  }
  return parts.join(" · ");
}

function itemUuid(holderId, itemId) {
  return game.actors.get(holderId)?.items.get(itemId)?.uuid ?? null;
}

/**
 * Context of the travel tab. Synchronous (dnd5e.prepareSheetContext is not awaited).
 * @param {Actor} group
 * @returns {object}
 */
export function buildTravelContext(group) {
  const rules = getRules();
  const travel = getTravel(group);
  const run = travel?.run ?? null;
  const isGM = game.user.isGM;
  const gmOnline = !!game.users.activeGM;
  const ownsGroup = group.isOwner;
  const state = computeGroupState(group, {
    rules, travel, ids: run?.members, mods: run?.comfortMods ?? [], shortage: run?.consumption?.groupShortage
  });
  const ppwr = rules.water.pintsPerWaterRation;
  const actorName = (id) => state.read.actors.get(id)?.name ?? game.actors.get(id)?.name ?? "?";
  const condOptions = Object.fromEntries(CONDITIONS.map((c) => [c, loc(`${MODULE_ID}.Condition.${c}`)]));

  // Inventory
  const inventory = CATEGORIES.map((category) => {
    const data = state.inventory.categories[category];
    const fluid = category === "food" || category === "water";
    const amountText = (n) => (category === "water"
      ? fmt(`${MODULE_ID}.Unit.water`, { n: round(n / ppwr), pints: round(n) })
      : category === "food" ? fmt(`${MODULE_ID}.Unit.food`, { n: round(n) }) : String(round(n)));
    return {
      category,
      label: loc(`${MODULE_ID}.Category.${category}`),
      totalText: amountText(data.total),
      empty: !data.rows.length,
      rows: data.rows.map((row) => ({
        name: row.name,
        totalText: amountText(row.total),
        holders: row.holders.map((h) => ({
          name: actorName(h.holderId),
          amountText: amountText(h.amount),
          camp: !fluid,
          condition: h.condition,
          conditionLabel: h.condition ? condOptions[h.condition] : "",
          uuid: fluid ? null : itemUuid(h.holderId, h.itemId),
          editable: !fluid && isGM
        }))
      }))
    };
  });

  const tierName = state.tier ? loc(state.tier.name) : "—";
  const stage = currentStage(travel);
  const paceForPreview = run?.pace ?? group.system.getTravelPace?.().pace?.value ?? "normal";
  const dcPreview = state.tier ? stageDc({ stageDc: stage?.dc ?? null, tierDc: state.tier.dc, pace: paceForPreview, paceRules: rules.pace }) : null;
  const autonomy = state.autonomy;
  const ctx = {
    isGM, gmOnline, noGm: !gmOnline,
    noGmText: loc(`${MODULE_ID}.Tab.noGm`),
    enabled: gmOnline,
    memberCount: state.read.members.length,
    noMembers: !state.read.members.length,
    autonomy: {
      foodDays: autonomy.foodDays === null ? "—" : round(autonomy.foodDays),
      waterDays: autonomy.waterDays === null ? "—" : round(autonomy.waterDays),
      days: autonomy.days === null ? "—" : autonomy.days
    },
    inventory,
    conditionOptions: condOptions,
    comfort: {
      score: round(state.comfort.score), base: round(state.comfort.base), bonus: round(state.comfort.bonus),
      malus: round(state.comfort.malus),
      lines: state.comfort.lines.map((l) => ({ ...l, conditionLabel: condOptions[l.condition], value: round(l.value) })),
      modLines: state.comfort.modLines.map((m) => ({ ...m, label: loc(m.label) || loc(`${MODULE_ID}.Comfort.mod.${m.source}`) }))
    },
    tier: { name: tierName, dc: state.tier?.dc ?? null },
    fatigueDc: dcPreview?.dc ?? null,
    fatigueSave: rules.fatigueSave,
    travel: travel ? {
      name: travel.name, status: travel.status, finished: travel.status === "finished",
      stageNumber: Math.min(travel.current + 1, travel.stages.length), stageCount: travel.stages.length
    } : null,
    stage: stage ? {
      ...stage, dcText: stage.dc ?? "—",
      infoText: [
        fmt(`${MODULE_ID}.Tab.stageDays`, { days: stage.days, preview: effectiveDays(stage.days, paceForPreview, rules.pace) }),
        stage.terrain,
        stage.dc !== null ? fmt(`${MODULE_ID}.Tab.stageDc`, { dc: stage.dc }) : null,
        fmt(`${MODULE_ID}.Tab.stageNeeds`, { food: stage.foodPerDay, water: stage.waterPerDay }),
        stage.hoursPerDay ? fmt(`${MODULE_ID}.Tab.stageHours`, { n: stage.hoursPerDay }) : null
      ].filter(Boolean).join(" · ")
    } : null,
    gm: {
      configure: isGM,
      start: isGM && !!stage && !run && gmOnline,
      close: isGM && run?.phase === "actions",
      rollAll: isGM && run?.phase === "saves",
      undo: isGM && !!getUndo(group)
    },
    history: (travel?.history ?? []).slice().reverse().map((h) => ({
      name: travel.stages.find((s) => s.id === h.stageId)?.name ?? "?",
      cardId: h.cardId, tier: h.summary?.tierName ?? "", comfort: h.summary?.comfortAfter ?? ""
    })),
    run: null
  };

  if (run) ctx.run = buildRunContext({ rules, travel, run, isGM, gmOnline, ownsGroup, state, actorName });
  return ctx;
}

function buildRunContext({ rules, travel, run, isGM, gmOnline, ownsGroup, state, actorName }) {
  const stage = travel.stages.find((s) => s.id === run.stageId);
  const actionsById = new Map(rules.actions.map((a) => [a.id, a]));
  const canPace = run.phase === "actions" && canDo("setPace", { isGM, ownsGroup, gmOnline });
  const repairTargets = state.inventory.camp.filter((c) => c.condition !== "intact")
    .map((c) => ({ uuid: itemUuid(c.holderId, c.itemId), label: `${c.name} (${actorName(c.holderId)}, ${loc(`${MODULE_ID}.Condition.${c.condition}`)})` }))
    .filter((t) => t.uuid);

  const members = run.members.map((id) => {
    const actor = game.actors.get(id);
    const ownsActor = !!actor?.isOwner;
    const choice = run.actions?.[id] ?? null;
    const action = choice ? actionsById.get(choice.actionId) : null;
    const done = !!choice?.result;
    const canChoose = !!actor && run.phase === "actions" && !done && canDo("chooseAction", { isGM, ownsActor, gmOnline });
    const needsTarget = action?.effect?.type === "repair";
    const saves = (run.saves?.[id] ?? []).map((s, index) => ({
      index, label: describeSave(s), dc: s.dc, auto: s.auto, result: describeSaveResult(s.result), done: !!s.result,
      failed: s.result && !s.result.success && !s.result.skipped
    }));
    const next = nextPendingSave(run, id);
    let actionResult = "";
    if (done) {
      const r = choice.result;
      actionResult = `${r.total ?? ""} · ${loc(r.success ? `${MODULE_ID}.Save.success` : `${MODULE_ID}.Save.failure`)}${r.detail ? ` · ${r.detail}` : ""}`;
    }
    return {
      id, name: actor?.name ?? "?", img: actor?.img,
      exhaustion: actor?.system?.attributes?.exhaustion ?? 0,
      canChoose, choiceId: choice?.actionId ?? "",
      actionLabel: action ? loc(action.label) : "",
      actionDc: action?.dc ?? null,
      needsTarget, targetUuid: choice?.targetItemUuid ?? "", targets: repairTargets,
      canRollAction: canChoose && !!action && (!needsTarget || !!choice?.targetItemUuid),
      actionResult, actionDone: done,
      saves,
      nextSaveIndex: next?.index ?? null,
      canRollSave: run.phase === "saves" && !!next && !next.save.auto && gmOnline && (isGM || ownsActor),
      dcText: run.memberInfo?.[id]?.dc ? fmt(`${MODULE_ID}.Run.dcDetail`, {
        dc: run.memberInfo[id].dc.dc, base: run.memberInfo[id].dc.base, pace: run.memberInfo[id].dc.paceMod,
        shortage: run.memberInfo[id].dc.shortageMod
      }) : ""
    };
  });

  return {
    phase: run.phase,
    phaseLabel: loc(`${MODULE_ID}.Run.phase.${run.phase}`),
    stageName: stage?.name ?? "",
    pace: run.pace,
    paceOptions: Object.fromEntries(PACES.map((p) => [p, loc(`${MODULE_ID}.Pace.${p}`)])),
    paceLabel: loc(`${MODULE_ID}.Pace.${run.pace}`),
    canPace,
    effectiveDays: run.effectiveDays,
    event: run.event ? {
      name: run.event.name, html: run.event.html,
      effects: (run.event.effects ?? []).map(describeEffect),
      guarded: !!run.guarded
    } : null,
    actionOptions: Object.fromEntries(rules.actions.map((a) => [a.id, `${loc(a.label)} (${a.dc})`])),
    members,
    tierName: run.consumption?.tier ? loc(run.consumption.tier.name) : null
  };
}

/** Delegated listeners on the travel part (bound once per element). */
export function bindTravelTab(app, element) {
  const part = element?.querySelector?.('[data-application-part="travel"]');
  if (!part || part.dataset.gtBound) return;
  part.dataset.gtBound = "1";
  const dispatch = async (action, data) => {
    const { handleTabAction } = await import("./controller.mjs");
    return handleTabAction(app.actor, action, data);
  };
  part.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gt-action]");
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    dispatch(button.dataset.gtAction, { ...button.dataset });
  });
  part.addEventListener("change", (event) => {
    const input = event.target.closest("[data-gt-change]");
    if (!input) return;
    // Keep the sheet form from submitting our controls (submitOnChange).
    event.stopPropagation();
    dispatch(input.dataset.gtChange, { ...input.dataset, value: input.value });
  });
}
