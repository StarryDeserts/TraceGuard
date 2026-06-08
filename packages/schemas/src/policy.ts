import { z } from "zod";
import { DecimalString } from "./scalars.js";
import { DecisionAction, MarketType } from "./decision-envelope.js";
import { Effect } from "./event-payloads.js";

export const Condition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("action_in"), values: z.array(DecisionAction).min(1) }).strict(),
  z.object({ kind: z.literal("instrument_in"), values: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ kind: z.literal("market_type_in"), values: z.array(MarketType).min(1) }).strict(),
  z.object({ kind: z.literal("notional_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("notional_lte"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("quantity_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("leverage_gt"), value: DecimalString }).strict(),
  z.object({ kind: z.literal("workspace_mode_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("manifest_status_eq"), value: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("snapshot_age_gt"), seconds: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("tool_risk_class_eq"), value: z.string().min(1) }).strict(),
]);
export type Condition = z.infer<typeof Condition>;

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
