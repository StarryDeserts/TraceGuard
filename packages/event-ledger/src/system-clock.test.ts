import { describe, it, expect } from "vitest";
import { IsoTimestamp } from "@traceguard/schemas";
import { SystemClock, SystemIdGen } from "./system-clock.js";

describe("SystemClock", () => {
  it("returns a valid ISO-8601 UTC instant", () => {
    const now = new SystemClock().now();
    expect(() => IsoTimestamp.parse(now)).not.toThrow();
  });
});

describe("SystemIdGen", () => {
  it("prefixes ids and never repeats", () => {
    const gen = new SystemIdGen();
    const a = gen.next("exec");
    const b = gen.next("exec");
    expect(a.startsWith("exec_")).toBe(true);
    expect(a).not.toBe(b);
  });
});
