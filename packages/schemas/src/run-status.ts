import { z } from "zod";

export const RunStatus = z.enum([
  "created",
  "capturing",
  "decision_ready",
  "policy_evaluating",
  "allowed",
  "approval_required",
  "blocked",
  "executing",
  "completed",
  "failed",
  "replayed",
]);
export type RunStatus = z.infer<typeof RunStatus>;
