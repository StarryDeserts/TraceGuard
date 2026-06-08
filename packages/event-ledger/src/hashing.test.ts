import { describe, it, expect } from "vitest";
import { sha256hex, payloadHash, eventHash, type EventHashHeader } from "./hashing.js";

const header: EventHashHeader = {
  id: "evt_1",
  workspaceId: "ws_1",
  aggregateType: "decision",
  aggregateId: "dec_1",
  eventType: "DecisionProposed",
  eventVersion: 1,
  schemaVersion: 1,
  occurredAt: "2026-06-08T00:00:00.000Z",
  actorType: "agent",
  payloadHash: "ph",
  previousEventHash: null,
};

describe("hashing", () => {
  it("sha256hex matches the known SHA-256 of 'abc'", () => {
    expect(sha256hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
  it("payloadHash is the sha256 of the canonical JSON", () => {
    expect(payloadHash({ b: 1, a: 2 })).toBe(sha256hex('{"a":2,"b":1}'));
  });
  it("eventHash covers exactly the 12-field preimage", () => {
    const direct = sha256hex(
      '{"actorType":"agent","aggregateId":"dec_1","aggregateType":"decision",' +
        '"eventType":"DecisionProposed","eventVersion":1,"id":"evt_1",' +
        '"occurredAt":"2026-06-08T00:00:00.000Z","payloadHash":"ph",' +
        '"previousEventHash":null,"schemaVersion":1,"workspaceId":"ws_1"}',
    );
    expect(eventHash(header)).toBe(direct);
  });
  it("eventHash ignores fields outside the preimage (e.g. recordedAt)", () => {
    const withExtra = { ...header } as EventHashHeader & { recordedAt: string };
    withExtra.recordedAt = "2026-01-01T00:00:00.000Z";
    expect(eventHash(withExtra)).toBe(eventHash(header));
  });
  it("eventHash changes when previousEventHash changes", () => {
    expect(eventHash({ ...header, previousEventHash: "abc" })).not.toBe(eventHash(header));
  });
});
