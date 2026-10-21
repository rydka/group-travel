// Forced march (C11b): one Con save per hour beyond the threshold, DC 10 + n.

/**
 * @param {number|null} hoursPerDay
 * @param {number} days
 * @param {{ threshold?: number }} [options]
 * @returns {{ day: number, hour: number, dc: number }[]}
 */
export function forcedMarchChecks(hoursPerDay, days, { threshold = 8 } = {}) {
  const hours = Number(hoursPerDay);
  const extra = Number.isFinite(hours) ? Math.floor(hours - threshold) : 0;
  const checks = [];
  if (extra <= 0) return checks;
  for (let day = 1; day <= (Number(days) || 0); day++) {
    for (let n = 1; n <= extra; n++) checks.push({ day, hour: threshold + n, dc: 10 + n });
  }
  return checks;
}
