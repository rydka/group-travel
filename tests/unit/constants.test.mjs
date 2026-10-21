import { describe, expect, it } from "vitest";
import { CATEGORIES, CONDITIONS, DEFAULTS, stepCondition } from "../../scripts/core/constants.mjs";

describe("constants", () => {
  it("lists the categories and conditions of the design", () => {
    expect(CATEGORIES).toEqual(["food", "water", "shelter", "bedding", "gear"]);
    expect(CONDITIONS).toEqual(["intact", "worn", "damaged", "destroyed"]);
  });

  it("exposes defaults as an object", () => {
    expect(DEFAULTS).toBeTypeOf("object");
  });

  it("stepCondition moves along the condition scale (+ repairs, - damages)", () => {
    expect(stepCondition("damaged", 1)).toBe("worn");
    expect(stepCondition("worn", 1)).toBe("intact");
    expect(stepCondition("intact", -1)).toBe("worn");
    expect(stepCondition("worn", -2)).toBe("destroyed");
  });

  it("stepCondition clamps at both ends", () => {
    expect(stepCondition("intact", 3)).toBe("intact");
    expect(stepCondition("destroyed", -2)).toBe("destroyed");
    expect(stepCondition("intact", 0)).toBe("intact");
  });

  it("stepCondition treats an unknown condition as intact", () => {
    expect(stepCondition("???", -1)).toBe("worn");
  });
});
