import { describe, it, expect } from "vitest";
import { makeEvent } from "./make-event.js";
import { eventHash, payloadHash } from "./hashing.js";
import type { Clock, IdGen } from "./clock-id.js";

const clock: Clock = { now: () => "2026-06-08T00:00:00.000Z" };
function idGen(): IdGen {
  let n = 0;
  return { next: (p) => `${p}_${String(++n).padStart(6, "0")}` };
}

const args = {
  workspaceId: "ws_1",
  aggregateType: "decision" as const,
  aggregateId: "dec_1",
  eventType: "DecisionProposed",
  eventVersion: 1,
  schemaVersion: 1,
  actorType: "agent" as const,
  runId: "run_1",
  payload: { hello: "world" },
  previousEventHash: null,
};

describe("makeEvent", () => {
  it("fills id, timestamps, hashes, and links", () => {
    const e = makeEvent(args, { clock, newId: idGen() });
    expect(e.id).toBe("evt_000001");
    expect(e.occurredAt).toBe("2026-06-08T00:00:00.000Z");
    expect(e.recordedAt).toBe("2026-06-08T00:00:00.000Z");
    expect(e.payloadHash).toBe(payloadHash(args.payload));
    expect(e.eventHash).toBe(
      eventHash({
        id: "evt_000001",
        workspaceId: "ws_1",
        aggregateType: "decision",
        aggregateId: "dec_1",
        eventType: "DecisionProposed",
        eventVersion: 1,
        schemaVersion: 1,
        occurredAt: "2026-06-08T00:00:00.000Z",
        actorType: "agent",
        payloadHash: payloadHash(args.payload),
        previousEventHash: null,
      }),
    );
  });
  it("omits previousEventHash on the first event", () => {
    const e = makeEvent(args, { clock, newId: idGen() });
    expect("previousEventHash" in e).toBe(false);
  });
  it("stores previousEventHash when linking", () => {
    const e = makeEvent({ ...args, previousEventHash: "prev" }, { clock, newId: idGen() });
    expect(e.previousEventHash).toBe("prev");
  });
  it("is deterministic under fixed deps", () => {
    const a = makeEvent(args, { clock, newId: idGen() });
    const b = makeEvent(args, { clock, newId: idGen() });
    expect(a).toEqual(b);
  });
});
