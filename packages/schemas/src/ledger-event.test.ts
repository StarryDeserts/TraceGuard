import { describe, it, expect } from "vitest";
import { AggregateType, ActorType, LedgerEvent } from "./ledger-event.js";

const base = {
  id: "evt_1",
  workspaceId: "ws_1",
  aggregateType: "decision",
  aggregateId: "dec_1",
  eventType: "DecisionProposed",
  eventVersion: 1,
  schemaVersion: 1,
  occurredAt: "2026-06-08T00:00:00.000Z",
  recordedAt: "2026-06-08T00:00:00.000Z",
  actorType: "agent",
  payload: { any: "thing" },
  payloadHash: "h1",
  eventHash: "h2",
};

describe("LedgerEvent", () => {
  it("accepts a minimal event without previousEventHash", () => {
    expect(LedgerEvent.parse(base).eventHash).toBe("h2");
  });
  it("rejects an event without a payload key", () => {
    const eventWithoutPayload: Partial<typeof base> = { ...base };
    delete eventWithoutPayload.payload;

    expect(() => LedgerEvent.parse(eventWithoutPayload)).toThrow();
  });
  it("accepts an event with previousEventHash and runId", () => {
    expect(LedgerEvent.parse({ ...base, previousEventHash: "h0", runId: "run_1" }).previousEventHash).toBe("h0");
  });
  it("rejects an unknown aggregateType", () => {
    expect(() => LedgerEvent.parse({ ...base, aggregateType: "spaceship" })).toThrow();
  });
  it("enumerates the canonical aggregate and actor types", () => {
    expect(AggregateType.options).toContain("authorization");
    expect(ActorType.options).toEqual(["user", "agent", "system", "provider", "worker"]);
  });
});
