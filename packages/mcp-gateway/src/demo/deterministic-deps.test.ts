import { describe, it, expect } from "vitest";
import { counterIdGen, fixedClock, DEFAULT_DEMO_INSTANT } from "./deterministic-deps.js";

describe("counterIdGen", () => {
  it("issues per-prefix monotonic ids", () => {
    const id = counterIdGen();
    expect(id.next("run")).toBe("run_1");
    expect(id.next("dec")).toBe("dec_1");
    expect(id.next("run")).toBe("run_2");
    expect(id.next("dec")).toBe("dec_2");
  });

  it("gives independent instances independent counters", () => {
    expect(counterIdGen().next("run")).toBe("run_1");
    expect(counterIdGen().next("run")).toBe("run_1");
  });
});

describe("fixedClock", () => {
  it("returns the pinned instant", () => {
    expect(fixedClock().now()).toBe(DEFAULT_DEMO_INSTANT);
    expect(fixedClock("2020-01-01T00:00:00.000Z").now()).toBe("2020-01-01T00:00:00.000Z");
  });
});
