// Stage summary chat card (C12).
import { MODULE_ID } from "../core/constants.mjs";
import { getRules } from "./settings.mjs";
import { describeEffect, describeSave, describeSaveResult } from "./sheet.mjs";

export const CARD_TEMPLATE = `modules/${MODULE_ID}/templates/stage-card.hbs`;
const loc = (key) => game.i18n.localize(key);
const fmt = (key, data) => game.i18n.format(key, data);
const round = (n) => (typeof n === "number" ? Math.round(n * 100) / 100 : n);

/** Plain summary of a finished run, for the card. */
export function buildStageSummary(group, travel, statuses = {}) {
  const run = travel.run;
  const rules = getRules();
  const stage = travel.stages.find((s) => s.id === run.stageId);
  const actions = new Map(rules.actions.map((a) => [a.id, a]));
  const members = run.members.map((id) => {
    const actor = game.actors.get(id);
    const info = run.memberInfo?.[id] ?? {};
    const choice = run.actions?.[id];
    const action = choice ? actions.get(choice.actionId) : null;
    const intake = info.intake ?? [];
    const food = intake.reduce((s, d) => s + d.food, 0);
    const water = intake.reduce((s, d) => s + d.water, 0);
    const days = intake.length;
    return {
      name: actor?.name ?? "?",
      action: action ? {
        label: loc(action.label), dc: action.dc, total: choice.result?.total ?? "—",
        success: !!choice.result?.success, done: !!choice.result, detail: choice.result?.detail ?? ""
      } : null,
      consumption: fmt(`${MODULE_ID}.Card.consumption`, {
        food: round(food), foodNeed: round(days * (run.consumption?.foodPerDay ?? 1)),
        water: round(water), waterNeed: round(days * (run.consumption?.waterPerDay ?? 1))
      }),
      short: !!(info.shortage?.food || info.shortage?.water),
      dc: info.dc ? fmt(`${MODULE_ID}.Run.dcDetail`, { dc: info.dc.dc, base: info.dc.base, pace: info.dc.paceMod, shortage: info.dc.shortageMod }) : "",
      saves: (run.saves?.[id] ?? []).map((s) => ({
        label: describeSave(s), dc: s.dc, result: describeSaveResult(s.result), failed: s.result && !s.result.success && !s.result.skipped
      })),
      exhaustion: { before: info.before?.exhaustion ?? 0, after: actor?.system?.attributes?.exhaustion ?? 0 },
      privation: statuses[id] ? [
        statuses[id].malnutrition ? loc(`${MODULE_ID}.Card.malnutrition`) : null,
        statuses[id].dehydration ? loc(`${MODULE_ID}.Card.dehydration`) : null
      ].filter(Boolean).join(", ") : ""
    };
  });
  const result = run.eventResult ?? {};
  return {
    groupName: group.name,
    travelName: travel.name,
    stageName: stage?.name ?? "",
    pace: loc(`${MODULE_ID}.Pace.${run.pace}`),
    days: run.effectiveDays,
    event: run.event ? {
      name: run.event.name,
      effects: (run.event.effects ?? []).map(describeEffect),
      guarded: !!result.guarded,
      lost: [
        result.lost?.food ? fmt(`${MODULE_ID}.EffectText.loseFood`, { n: round(result.lost.food) }) : null,
        result.lost?.water ? fmt(`${MODULE_ID}.EffectText.loseWater`, { n: round(result.lost.water) }) : null,
        ...(result.damaged ?? [])
      ].filter(Boolean)
    } : null,
    comfort: {
      before: round(run.comfortBefore), after: round(run.consumption?.comfortAfter),
      tier: run.consumption?.tier ? loc(run.consumption.tier.name) : "—", dc: run.consumption?.tier?.dc ?? "—",
      shortage: run.consumption?.groupShortage?.food || run.consumption?.groupShortage?.water
    },
    members,
    fatigueSave: rules.fatigueSave,
    disableExhaustion: rules.disableExhaustion
  };
}

/** Create the card. */
export async function postStageCard(group, travel, statuses) {
  const summary = buildStageSummary(group, travel, statuses);
  const content = await foundry.applications.handlebars.renderTemplate(CARD_TEMPLATE, summary);
  return ChatMessage.implementation.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor: group }),
    flags: { [MODULE_ID]: { card: { groupUuid: group.uuid, runId: travel.run.id, undone: false } } }
  });
}

/** Mark a card as undone. */
export async function markCardUndone(messageId) {
  const message = game.messages.get(messageId);
  if (!message || message.flags?.[MODULE_ID]?.card?.undone) return;
  const banner = `<p class="${MODULE_ID}-undone"><i class="fa-solid fa-rotate-left" inert></i> ${loc(`${MODULE_ID}.Card.undone`)}</p>`;
  await message.update({ content: banner + message.content, [`flags.${MODULE_ID}.card.undone`]: true });
}
