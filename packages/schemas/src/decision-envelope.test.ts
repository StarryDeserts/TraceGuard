import { describe, it, expect } from "vitest";
import { DecisionEnvelope } from "./decision-envelope.js";

const valid = {
  id: "dec_1",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  thesis: "Momentum positive, funding moderate.",
  evidenceRefs: ["ev_1"],
  requestedNotionalUsdt: "300",
  requestedLeverage: "2",
};

describe("DecisionEnvelope", () => {
  it("accepts a minimal valid envelope", () => {
    expect(DecisionEnvelope.parse(valid)).toMatchObject({ action: "open_long" });
  });
  it("accepts confidence as a number", () => {
    expect(DecisionEnvelope.parse({ ...valid, confidence: 0.7 }).confidence).toBe(0.7);
  });
  it("rejects an unknown action", () => {
    expect(() => DecisionEnvelope.parse({ ...valid, action: "yolo" })).toThrow();
  });
  it("rejects a numeric notional (must be a decimal string)", () => {
    expect(() => DecisionEnvelope.parse({ ...valid, requestedNotionalUsdt: 300 })).toThrow();
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => DecisionEnvelope.parse({ ...valid, surprise: 1 })).toThrow();
  });
});
