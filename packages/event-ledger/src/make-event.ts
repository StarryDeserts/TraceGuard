import type { AggregateType, ActorType, LedgerEvent } from "@traceguard/schemas";
import { eventHash, payloadHash } from "./hashing.js";
import type { Clock, IdGen } from "./clock-id.js";

export interface MakeEventArgs<T> {
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  schemaVersion: number;
  actorType: ActorType;
  actorId?: string;
  runId?: string;
  payload: T;
  previousEventHash: string | null;
}

export function makeEvent<T>(args: MakeEventArgs<T>, deps: { clock: Clock; newId: IdGen }): LedgerEvent<T> {
  const id = deps.newId.next("evt");
  const occurredAt = deps.clock.now();
  const ph = payloadHash(args.payload);
  const eh = eventHash({
    id,
    workspaceId: args.workspaceId,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.eventType,
    eventVersion: args.eventVersion,
    schemaVersion: args.schemaVersion,
    occurredAt,
    actorType: args.actorType,
    actorId: args.actorId,
    payloadHash: ph,
    previousEventHash: args.previousEventHash,
  });
  const event: LedgerEvent<T> = {
    id,
    workspaceId: args.workspaceId,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.eventType,
    eventVersion: args.eventVersion,
    schemaVersion: args.schemaVersion,
    occurredAt,
    recordedAt: occurredAt,
    actorType: args.actorType,
    payload: args.payload,
    payloadHash: ph,
    eventHash: eh,
  };
  if (args.actorId !== undefined) event.actorId = args.actorId;
  if (args.runId !== undefined) event.runId = args.runId;
  if (args.previousEventHash !== null) event.previousEventHash = args.previousEventHash;
  return event;
}
