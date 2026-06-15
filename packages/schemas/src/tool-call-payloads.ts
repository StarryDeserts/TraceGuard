import { z } from "zod";
import { RiskClass } from "./tool-manifest.js";

export const CallDenyCode = z.enum([
  "UNKNOWN_TOOL",
  "TOOL_FROZEN",
  "TOOL_BLOCKED",
  "DECISION_ENVELOPE_REQUIRED",
]);
export type CallDenyCode = z.infer<typeof CallDenyCode>;

export const ToolCallRequestedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    riskClass: RiskClass,
    argumentsDigest: z.string().length(64),
  })
  .strict();
export type ToolCallRequestedPayload = z.infer<typeof ToolCallRequestedPayload>;

export const ToolCallCompletedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    resultDigest: z.string().length(64),
    isError: z.boolean(),
  })
  .strict();
export type ToolCallCompletedPayload = z.infer<typeof ToolCallCompletedPayload>;

export const ToolCallFailureReason = z.enum(["upstream_call_failed"]);
export type ToolCallFailureReason = z.infer<typeof ToolCallFailureReason>;

export const ToolCallFailedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    reasonCode: ToolCallFailureReason,
  })
  .strict();
export type ToolCallFailedPayload = z.infer<typeof ToolCallFailedPayload>;

export const ToolCallDeniedPayload = z
  .object({
    runId: z.string().min(1),
    toolName: z.string().min(1),
    denyCode: CallDenyCode,
    riskClass: RiskClass.optional(),
  })
  .strict();
export type ToolCallDeniedPayload = z.infer<typeof ToolCallDeniedPayload>;

export const IncidentReason = z.enum(["blocked_tool_call_attempt"]);
export type IncidentReason = z.infer<typeof IncidentReason>;

export const IncidentOpenedPayload = z
  .object({
    incidentId: z.string().min(1),
    runId: z.string().min(1),
    toolName: z.string().min(1),
    riskClass: RiskClass,
    reasonCode: IncidentReason,
  })
  .strict();
export type IncidentOpenedPayload = z.infer<typeof IncidentOpenedPayload>;
