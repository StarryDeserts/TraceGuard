import { z } from "zod";
import { DecimalString } from "./scalars.js";
import { DecisionAction, MarketType } from "./decision-envelope.js";
import { Effect } from "./event-payloads.js";

export const Condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action_in"), values: z.array(DecisionAction).min(1) }).strict(),
  z.object({ kind: z.literal("instrument_in"), values: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("market_type_in"), values: z.array(MarketType).min(1) }).strict(),
  z.object({ kind: z.literal("notional_lt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_lte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_eq"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_gte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_lt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_lte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_eq"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_gte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_lt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_lte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_eq"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_gte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("workspace_mode_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("manifest_status_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("snapshot_age_gt"), seconds: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("tool_risk_class_eq"), value: z.string().min(1) }).strict(),
]);
export type Condition = z.infer<typeof Condition>;

export const EvaluationContext = z
  .object({
    runId: z.string().min(1),
    policyVersionId: z.string().min(1),
    evaluatorVersion: z.string().min(1),
    workspaceMode: z.string().min(1),
    manifestStatus: z.string().min(1),
    snapshotAgeSeconds: z.number().int().nonnegative(),
    toolRiskClass: z.string().min(1),
    instrumentAllowlist: z.array(z.string().min(1)),
  })
  .strict();
export type EvaluationContext = z.infer<typeof EvaluationContext>;

export const Rule = z
  .object({
    id: z.string().min(1),
    effect: Effect,
    conditions: z.array(Condition),
  })
  .strict();
export type Rule = z.infer<typeof Rule>;

export const Policy = z
  .object({
    version: z.number().int().nonnegative(),
    defaultEffect: z.literal("block"),
    rules: z.array(Rule),
  })
  .strict();
export type Policy = z.infer<typeof Policy>;
