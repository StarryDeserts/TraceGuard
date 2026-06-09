import { z } from "zod";
import { DecimalString } from "./scalars.js";

export const MarketType = z.enum(["spot", "futures", "tokenized_stock"]);
export type MarketType = z.infer<typeof MarketType>;

export const DecisionAction = z.enum([
  "buy",
  "sell",
  "open_long",
  "open_short",
  "reduce",
  "close",
  "hold",
  "abstain",
]);
export type DecisionAction = z.infer<typeof DecisionAction>;

export const DecisionEnvelope = z
  .object({
    id: z.string().min(1),
    instrument: z.string().min(1),
    marketType: MarketType,
    action: DecisionAction,
    thesis: z.string(),
    confidence: z.number().min(0).max(1).optional(),
    evidenceRefs: z.array(z.string()),
    requestedNotionalUsdt: DecimalString.optional(),
    requestedQuantity: DecimalString.optional(),
    requestedLeverage: DecimalString.optional(),
    orderType: z.string().optional(),
    limitPrice: DecimalString.optional(),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    promptVersion: z.string().optional(),
    modelProvider: z.string().optional(),
    modelName: z.string().optional(),
  })
  .strict();
export type DecisionEnvelope = z.infer<typeof DecisionEnvelope>;
