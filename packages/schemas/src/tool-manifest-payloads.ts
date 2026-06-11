import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";
import { RiskClass } from "./tool-manifest.js";

export const ToolManifestEntry = z
  .object({
    name: z.string().min(1),
    riskClass: RiskClass,
    schemaHash: z.string().min(1),
  })
  .strict();
export type ToolManifestEntry = z.infer<typeof ToolManifestEntry>;

export const ChangedTool = z
  .object({
    name: z.string().min(1),
    previousSchemaHash: z.string().optional(),
    schemaHash: z.string().optional(),
    previousRiskClass: RiskClass.optional(),
    riskClass: RiskClass.optional(),
    sensitive: z.boolean(),
  })
  .strict();
export type ChangedTool = z.infer<typeof ChangedTool>;

export const ToolFreezeReason = z.enum(["changed_sensitive", "unknown_risk"]);
export type ToolFreezeReason = z.infer<typeof ToolFreezeReason>;

export const ToolBlockReason = z.enum(["risk_class_default", "operator_blocklist"]);
export type ToolBlockReason = z.infer<typeof ToolBlockReason>;

export const ToolManifestImportedPayload = z
  .object({
    toolManifestVersionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    manifestHash: z.string().min(1),
    normalizationVersion: z.number().int().nonnegative(),
    tools: z.array(ToolManifestEntry),
  })
  .strict();
export type ToolManifestImportedPayload = z.infer<typeof ToolManifestImportedPayload>;

export const ToolManifestChangedPayload = z
  .object({
    toolManifestVersionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    previousManifestHash: z.string().min(1),
    manifestHash: z.string().min(1),
    added: z.array(ToolManifestEntry),
    removed: z.array(z.string().min(1)),
    changed: z.array(ChangedTool),
  })
  .strict();
export type ToolManifestChangedPayload = z.infer<typeof ToolManifestChangedPayload>;

export const ToolFrozenPayload = z
  .object({
    providerConnectionId: z.string().min(1),
    toolName: z.string().min(1),
    manifestHash: z.string().min(1),
    reasonCode: ToolFreezeReason,
  })
  .strict();
export type ToolFrozenPayload = z.infer<typeof ToolFrozenPayload>;

export const ToolBlockedPayload = z
  .object({
    providerConnectionId: z.string().min(1),
    toolName: z.string().min(1),
    riskClass: RiskClass,
    manifestHash: z.string().min(1),
    reasonCode: ToolBlockReason,
  })
  .strict();
export type ToolBlockedPayload = z.infer<typeof ToolBlockedPayload>;

export const ToolManifestApprovedPayload = z
  .object({
    toolManifestVersionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    manifestHash: z.string().min(1),
    approvedBy: z.string().min(1),
    approvedAt: IsoTimestamp,
  })
  .strict();
export type ToolManifestApprovedPayload = z.infer<typeof ToolManifestApprovedPayload>;
