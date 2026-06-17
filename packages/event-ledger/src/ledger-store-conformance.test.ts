import { describe, it, expect } from "vitest";
import type { LedgerStore } from "./ledger-store.js";
import {
  InMemoryLedgerStore,
  LedgerConflictError,
  LedgerChainError,
  LedgerIntegrityError,
} from "./ledger-store.js";
import { makeEvent } from "./make-event.js";
import type { Clock, IdGen } from "./clock-id.js";

const clock: Clock = { now: () => "2026-06-08T00:00:00.000Z" };

export function idGen(): IdGen {
  let n = 0;
  return { next: (p) => `${p}_${String(++n).padStart(6, "0")}` };
}

export function chainOf(prev: string | null, count: number, newId: IdGen) {
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

/**
 * The behavioral contract every LedgerStore must satisfy. Invoke inside a
 * `describe` block, passing a factory that returns a fresh, empty store.
 */
export function runLedgerStoreContract(
  makeStore: () => Promise<LedgerStore> | LedgerStore,
): void {
  it("starts empty (head null) and appends a linked batch", async () => {
    const store = await makeStore();
    expect(await store.head("ws_1")).toBeNull();
    const events = chainOf(null, 2, idGen());
    await store.append(null, events);
    expect(await store.head("ws_1")).toBe(events[1]!.eventHash);
    expect(await store.read("ws_1")).toHaveLength(2);
  });

  it("rejects an append when expectedHead does not match (optimistic concurrency)", async () => {
    const store = await makeStore();
    await store.append(null, chainOf(null, 1, idGen()));
    await expect(store.append(null, chainOf(null, 1, idGen()))).rejects.toBeInstanceOf(
      LedgerConflictError,
    );
  });

  it("rejects a broken intra-batch link", async () => {
    const store = await makeStore();
    const events = chainOf(null, 2, idGen());
    const tampered = [events[0]!, { ...events[1]!, previousEventHash: "wrong" }];
    await expect(store.append(null, tampered)).rejects.toBeInstanceOf(LedgerChainError);
  });

  it("rejects an event whose eventHash was tampered", async () => {
    const store = await makeStore();
    const [e] = chainOf(null, 1, idGen());
    await expect(store.append(null, [{ ...e!, eventHash: "deadbeef" }])).rejects.toBeInstanceOf(
      LedgerIntegrityError,
    );
  });

  it("read filters by runId and isolates workspaces", async () => {
    const store = await makeStore();
    await store.append(null, chainOf(null, 2, idGen()));
    expect(await store.read("ws_1", "run_1")).toHaveLength(2);
    expect(await store.read("ws_1", "run_other")).toHaveLength(0);
    expect(await store.read("ws_other")).toHaveLength(0);
  });

  it("does not let original event mutations change stored events after append", async () => {
    const store = await makeStore();
    const [event] = chainOf(null, 1, idGen());
    await store.append(null, [event!]);
    const originalHash = event!.eventHash;

    (event!.payload as { i: number }).i = 999;
    event!.eventHash = "tampered";

    const [stored] = await store.read("ws_1");
    expect(stored!.payload).toEqual({ i: 0 });
    expect(stored!.eventHash).toBe(originalHash);
  });

  it("does not let read result mutations affect later reads or head", async () => {
    const store = await makeStore();
    const [event] = chainOf(null, 1, idGen());
    await store.append(null, [event!]);
    const originalHead = await store.head("ws_1");

    const [readEvent] = await store.read("ws_1");
    (readEvent!.payload as { i: number }).i = 999;
    readEvent!.eventHash = "tampered";

    expect(await store.head("ws_1")).toBe(originalHead);
    const [stored] = await store.read("ws_1");
    expect(stored!.payload).toEqual({ i: 0 });
    expect(stored!.eventHash).toBe(originalHead);
  });

  it("serializes concurrent appends at the same head (one wins, one conflicts)", async () => {
    const store = await makeStore();
    const results = await Promise.allSettled([
      store.append(null, chainOf(null, 1, idGen())),
      store.append(null, chainOf(null, 1, idGen())),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(LedgerConflictError);
    expect(await store.read("ws_1")).toHaveLength(1);
  });
}

describe("LedgerStore conformance: InMemoryLedgerStore", () => {
  runLedgerStoreContract(() => new InMemoryLedgerStore());
});
