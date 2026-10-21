// Pace (C7b) and end-of-stage fatigue DC (C11).

/**
 * Effective duration: days x (100 + pct) / 100, rounded up to the next day.
 * @param {number} days
 * @param {string} pace
 * @param {object} paceRules  { fast|normal|slow: { durationPct, dcMod } }
 * @returns {number}
 */
export function effectiveDays(days, pace, paceRules) {
  const pct = Number(paceRules?.[pace]?.durationPct) || 0;
  const value = (Number(days) || 0) * (100 + pct) / 100;
  return Math.max(0, Math.ceil(value - 1e-9));
}

/**
 * Fatigue save DC: stage DC if defined, else tier DC; plus the pace modifier;
 * plus a flat shortage penalty (house rule, user answer Q2: once per stage).
 * @param {object} args
 * @param {number|null} [args.stageDc]
 * @param {number} args.tierDc
 * @param {string} args.pace
 * @param {object} args.paceRules
 * @param {boolean} [args.shortage=false]       The member missed food or water on at least one day.
 * @param {number} [args.shortagePenalty=5]     Setting `shortage.dcPenalty`.
 * @returns {{ dc: number, base: number, source: "stage"|"tier", paceMod: number, shortageMod: number }}
 */
export function stageDc({ stageDc, tierDc, pace, paceRules, shortage = false, shortagePenalty = 5 }) {
  const fromStage = typeof stageDc === "number" && Number.isFinite(stageDc);
  const base = fromStage ? stageDc : Number(tierDc) || 0;
  const paceMod = Number(paceRules?.[pace]?.dcMod) || 0;
  const shortageMod = shortage ? Number(shortagePenalty) || 0 : 0;
  return { dc: base + paceMod + shortageMod, base, source: fromStage ? "stage" : "tier", paceMod, shortageMod };
}
