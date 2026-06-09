import { createHash } from "node:crypto";
import type { AggregateType, ActorType } from "@traceguard/schemas";
import { canonicalJson } from "./canonical-json.js";

export function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function payloadHash(payload: unknown): string {
  return sha256hex(canonicalJson(payload));
}

export interface EventHashHeader {
  id: string;
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  schemaVersion: number;
  occurredAt: string;
  actorType: ActorType;
  actorId?: string;
  payloadHash: string;
  previousEventHash: string | null;
}

export function eventHash(h: EventHashHeader): string {
  return sha256hex(
    canonicalJson({
      id: h.id,
      workspaceId: h.workspaceId,
      aggregateType: h.aggregateType,
      aggregateId: h.aggregateId,
      eventType: h.eventType,
      eventVersion: h.eventVersion,
      schemaVersion: h.schemaVersion,
      occurredAt: h.occurredAt,
      actorType: h.actorType,
      actorId: h.actorId,
      payloadHash: h.payloadHash,
      previousEventHash: h.previousEventHash,
    }),
  );
}
