import { describe, it, expect } from "vitest";
import {
  InMemoryLedgerStore,
  LedgerConflictError,
  LedgerChainError,
  LedgerIntegrityError,
  verifyChain,
} from "./ledger-store.js";
import { makeEvent } from "./make-event.js";
import type { Clock, IdGen } from "./clock-id.js";

const clock: Clock = { now: () => "2026-06-08T00:00:00.000Z" };
function idGen(): IdGen {
  let n = 0;
  return { next: (p) => `${p}_${String(++n).padStart(6, "0")}` };
}

function chainOf(prev: string | null, count: number, newId: IdGen) {
  const events = [];
  let head = prev;
  for (let i = 0; i < count; i++) {
    const e = makeEvent(
      {
        workspaceId: "ws_1",
        aggregateType: "decision",
        aggregateId: "dec_1",
        eventType: "DecisionProposed",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "agent",
        runId: "run_1",
        payload: { i },
        previousEventHash: head,
      },
      { clock, newId },
    );
    events.push(e);
    head = e.eventHash;
  }
  return events;
}

describe("InMemoryLedgerStore", () => {
  it("starts empty (head null) and appends a linked batch", async () => {
    const store = new InMemoryLedgerStore();
    expect(await store.head("ws_1")).toBeNull();
    const events = chainOf(null, 2, idGen());
    await store.append(null, events);
    expect(await store.head("ws_1")).toBe(events[1]!.eventHash);
    expect(await store.read("ws_1")).toHaveLength(2);
  });

  it("rejects an append when expectedHead does not match (optimistic concurrency)", async () => {
    const store = new InMemoryLedgerStore();
    await store.append(null, chainOf(null, 1, idGen()));
    await expect(store.append(null, chainOf(null, 1, idGen()))).rejects.toBeInstanceOf(LedgerConflictError);
  });

  it("rejects a broken intra-batch link", async () => {
    const store = new InMemoryLedgerStore();
    const events = chainOf(null, 2, idGen());
    const tampered = [events[0]!, { ...events[1]!, previousEventHash: "wrong" }];
    await expect(store.append(null, tampered)).rejects.toBeInstanceOf(LedgerChainError);
  });

  it("rejects an event whose eventHash was tampered", async () => {
    const store = new InMemoryLedgerStore();
    const [e] = chainOf(null, 1, idGen());
    await expect(store.append(null, [{ ...e!, eventHash: "deadbeef" }])).rejects.toBeInstanceOf(LedgerIntegrityError);
  });

  it("read filters by runId and isolates workspaces", async () => {
    const store = new InMemoryLedgerStore();
    await store.append(null, chainOf(null, 2, idGen()));
    expect(await store.read("ws_1", "run_1")).toHaveLength(2);
    expect(await store.read("ws_1", "run_other")).toHaveLength(0);
    expect(await store.read("ws_other")).toHaveLength(0);
  });

  it("verifyChain catches a tampered payload", async () => {
    const events = chainOf(null, 2, idGen());
    expect(() => verifyChain(events)).not.toThrow();
    const tampered = [events[0]!, { ...events[1]!, payload: { i: 999 } }];
    expect(() => verifyChain(tampered)).toThrow(LedgerIntegrityError);
  });
});
