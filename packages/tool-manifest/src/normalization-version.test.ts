import { describe, expect, it } from "vitest";
import { NORMALIZATION_VERSION } from "./normalization-version.js";

describe("NORMALIZATION_VERSION", () => {
  it("is a non-negative integer", () => {
    expect(Number.isInteger(NORMALIZATION_VERSION)).toBe(true);
    expect(NORMALIZATION_VERSION).toBeGreaterThanOrEqual(0);
  });

  it("is pinned to 1 for the initial normalization scheme", () => {
    expect(NORMALIZATION_VERSION).toBe(1);
  });
});
