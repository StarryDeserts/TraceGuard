import type { LedgerEvent } from "@traceguard/schemas";
import { eventHash, payloadHash } from "./hashing.js";

export class LedgerConflictError extends Error {
  constructor(
    readonly expectedHead: string | null,
    readonly actualHead: string | null,
  ) {
    super(`ledger head conflict: expected ${expectedHead}, actual ${actualHead}`);
    this.name = "LedgerConflictError";
  }
}
export class LedgerChainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerChainError";
  }
}
export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

export interface LedgerStore {
  append(expectedHead: string | null, events: LedgerEvent[]): Promise<void>;
  read(workspaceId: string, runId?: string): Promise<LedgerEvent[]>;
  head(workspaceId: string): Promise<string | null>;
}

function recompute(e: LedgerEvent): string {
  return eventHash({
    id: e.id,
    workspaceId: e.workspaceId,
    aggregateType: e.aggregateType,
    aggregateId: e.aggregateId,
    eventType: e.eventType,
    eventVersion: e.eventVersion,
    schemaVersion: e.schemaVersion,
    occurredAt: e.occurredAt,
    actorType: e.actorType,
    actorId: e.actorId,
    payloadHash: e.payloadHash,
    previousEventHash: e.previousEventHash ?? null,
  });
}

function cloneEvent(e: LedgerEvent): LedgerEvent {
  return structuredClone(e);
}

export function verifyChain(events: LedgerEvent[], startHead: string | null = null): void {
  let prev = startHead;
  for (const e of events) {
    if (payloadHash(e.payload) !== e.payloadHash) {
      throw new LedgerIntegrityError(`payloadHash mismatch at ${e.id}`);
    }
    const ePrev = e.previousEventHash ?? null;
    if (ePrev !== prev) {
      throw new LedgerChainError(`broken link at ${e.id}: previousEventHash ${ePrev} != ${prev}`);
    }
    if (recompute(e) !== e.eventHash) {
      throw new LedgerIntegrityError(`eventHash mismatch at ${e.id}`);
    }
    prev = e.eventHash;
  }
}

export class InMemoryLedgerStore implements LedgerStore {
  private readonly byWorkspace = new Map<string, LedgerEvent[]>();

  async head(workspaceId: string): Promise<string | null> {
    const list = this.byWorkspace.get(workspaceId);
    if (list === undefined || list.length === 0) return null;
    return list[list.length - 1]!.eventHash;
  }

  async append(expectedHead: string | null, events: LedgerEvent[]): Promise<void> {
    if (events.length === 0) return;
    const workspaceId = events[0]!.workspaceId;
    for (const e of events) {
      if (e.workspaceId !== workspaceId) {
        throw new LedgerChainError("all events in a batch must share one workspaceId");
      }
    }
    const list = this.byWorkspace.get(workspaceId) ?? [];
    const currentHead = list.length === 0 ? null : list[list.length - 1]!.eventHash;
    if (currentHead !== expectedHead) {
      throw new LedgerConflictError(expectedHead, currentHead);
    }
    verifyChain(events, currentHead);
    this.byWorkspace.set(workspaceId, [...list, ...events.map(cloneEvent)]);
  }

  async read(workspaceId: string, runId?: string): Promise<LedgerEvent[]> {
    const list = this.byWorkspace.get(workspaceId) ?? [];
    const events = runId === undefined ? list : list.filter((e) => e.runId === runId);
    return events.map(cloneEvent);
  }
}
