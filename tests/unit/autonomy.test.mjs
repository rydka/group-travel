import { describe, expect, it } from "vitest";
import { computeAutonomy } from "../../scripts/core/autonomy.mjs";

describe("computeAutonomy (C3)", () => {
  it("scenario 2: 14 rations, 12 full waterskins (48 pints), 4 members -> 3 days", () => {
    const r = computeAutonomy({ foodPortions: 14, waterPints: 48, members: 4 });
    expect(r.members).toBe(4);
    expect(r.waterRations).toBe(12);
    expect(Math.floor(r.foodDays)).toBe(3);
    expect(r.waterDays).toBe(3);
    expect(r.days).toBe(3);
  });

  it("autonomy is the floor of the smaller of food and water days", () => {
    expect(computeAutonomy({ foodPortions: 20, waterPints: 12, members: 2 }).days).toBe(1);
    expect(computeAutonomy({ foodPortions: 3, waterPints: 80, members: 2 }).days).toBe(1);
    expect(computeAutonomy({ foodPortions: 3, waterPints: 80, members: 4 }).days).toBe(0);
  });

  it("partly drunk 2014 waterskins: 7 pints = 1.75 water rations", () => {
    const r = computeAutonomy({ foodPortions: 8, waterPints: 7, members: 2 });
    expect(r.waterRations).toBe(1.75);
    expect(r.waterDays).toBe(0.875);
    expect(r.days).toBe(0);
  });

  it("respects per-day consumption", () => {
    const r = computeAutonomy({ foodPortions: 12, waterPints: 48, members: 2, foodPerDay: 2, waterPerDay: 3 });
    expect(r.foodDays).toBe(3);
    expect(r.waterDays).toBe(2);
    expect(r.days).toBe(2);
  });

  it("honours a custom pintsPerWaterRation", () => {
    expect(computeAutonomy({ foodPortions: 99, waterPints: 16, members: 2, pintsPerWaterRation: 8 }).waterDays).toBe(1);
  });

  it("zero members -> days null, no exception", () => {
    const r = computeAutonomy({ foodPortions: 5, waterPints: 5, members: 0 });
    expect(r.days).toBeNull();
    expect(r.members).toBe(0);
  });

  it("zero per-day need -> Infinity for that resource", () => {
    const r = computeAutonomy({ foodPortions: 5, waterPints: 8, members: 2, foodPerDay: 0 });
    expect(r.foodDays).toBe(Infinity);
    expect(r.days).toBe(Math.floor(r.waterDays));
  });

  it("nothing at all -> 0 days", () => {
    expect(computeAutonomy({ foodPortions: 0, waterPints: 0, members: 3 }).days).toBe(0);
  });
});
