import { describe, it, expect } from "vitest";
import { DecimalString, IsoTimestamp, PrefixedId } from "./scalars.js";

describe("DecimalString", () => {
  it("accepts integer and decimal strings", () => {
    expect(DecimalString.parse("300")).toBe("300");
    expect(DecimalString.parse("300.50")).toBe("300.50");
    expect(DecimalString.parse("-1.25")).toBe("-1.25");
  });
  it("rejects numbers and non-decimal strings", () => {
    expect(() => DecimalString.parse(300 as unknown)).toThrow();
    expect(() => DecimalString.parse("3e2")).toThrow();
    expect(() => DecimalString.parse("abc")).toThrow();
    expect(() => DecimalString.parse("")).toThrow();
  });
});

describe("IsoTimestamp", () => {
  it("accepts ISO-8601 UTC instants", () => {
    expect(IsoTimestamp.parse("2026-06-08T00:00:00.000Z")).toBe("2026-06-08T00:00:00.000Z");
  });
  it("rejects non-UTC or malformed", () => {
    expect(() => IsoTimestamp.parse("2026-06-08")).toThrow();
    expect(() => IsoTimestamp.parse("2026-06-08T00:00:00+02:00")).toThrow();
  });
});

describe("PrefixedId", () => {
  it("builds a schema that requires the given prefix", () => {
    const DecisionId = PrefixedId("dec");
    expect(DecisionId.parse("dec_01")).toBe("dec_01");
    expect(() => DecisionId.parse("evt_01")).toThrow();
  });
});
