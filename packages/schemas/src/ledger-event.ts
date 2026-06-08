import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const AggregateType = z.enum([
  "workspace",
  "provider_connection",
  "tool_manifest",
  "tool_definition",
  "agent",
  "run",
  "decision",
  "policy",
  "approval",
  "authorization",
  "execution",
  "replay",
  "incident",
  "evidence_export",
  "telegram_binding",
]);
export type AggregateType = z.infer<typeof AggregateType>;

export const ActorType = z.enum(["user", "agent", "system", "provider", "worker"]);
export type ActorType = z.infer<typeof ActorType>;

export const RedactionProfile = z.enum(["internal_full", "developer_debug", "public_demo"]);
export type RedactionProfile = z.infer<typeof RedactionProfile>;

export interface LedgerEvent<TPayload = unknown> {
  id: string;
  workspaceId: string;
  aggregateType: AggregateType;
  aggregateId: string;
  eventType: string;
  eventVersion: number;
  schemaVersion: number;
  occurredAt: string;
  recordedAt: string;
  actorType: ActorType;
  actorId?: string;
  runId?: string;
  agentId?: string;
  providerConnectionId?: string;
  policyVersionId?: string;
  toolManifestVersionId?: string;
  traceId?: string;
  spanId?: string;
  correlationId?: string;
  causationId?: string;
  idempotencyKey?: string;
  payload: TPayload;
  payloadHash: string;
  previousEventHash?: string;
  eventHash: string;
  redactionProfile?: RedactionProfile;
}

export const LedgerEvent = z
  .object({
    id: z.string().min(1),
    workspaceId: z.string().min(1),
    aggregateType: AggregateType,
    aggregateId: z.string().min(1),
    eventType: z.string().min(1),
    eventVersion: z.number().int().nonnegative(),
    schemaVersion: z.number().int().nonnegative(),
    occurredAt: IsoTimestamp,
    recordedAt: IsoTimestamp,
    actorType: ActorType,
    actorId: z.string().optional(),
    runId: z.string().optional(),
    agentId: z.string().optional(),
    providerConnectionId: z.string().optional(),
    policyVersionId: z.string().optional(),
    toolManifestVersionId: z.string().optional(),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    correlationId: z.string().optional(),
    causationId: z.string().optional(),
    idempotencyKey: z.string().optional(),
    payload: z.unknown(),
    payloadHash: z.string().min(1),
    previousEventHash: z.string().optional(),
    eventHash: z.string().min(1),
    redactionProfile: RedactionProfile.optional(),
  })
  .strict();
