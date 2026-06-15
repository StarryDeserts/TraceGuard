import { z } from "zod";
import { IsoTimestamp } from "./scalars.js";

export const RunCompletedPayload = z
  .object({
    runId: z.string().min(1),
    completedAt: IsoTimestamp,
    executionId: z.string().min(1).optional(),
  })
  .strict();
export type RunCompletedPayload = z.infer<typeof RunCompletedPayload>;

export const RunFailureReason = z.enum(["orchestrator_error"]);
export type RunFailureReason = z.infer<typeof RunFailureReason>;

export const RunFailedPayload = z
  .object({
    runId: z.string().min(1),
    failedAt: IsoTimestamp,
    reasonCode: RunFailureReason,
  })
  .strict();
export type RunFailedPayload = z.infer<typeof RunFailedPayload>;

export const RunCreatedPayload = z
  .object({
    runId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    createdAt: IsoTimestamp,
  })
  .strict();
export type RunCreatedPayload = z.infer<typeof RunCreatedPayload>;
