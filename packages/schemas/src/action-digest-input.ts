import { z } from "zod";
import { DecimalString } from "./scalars.js";

export const ActionDigestInput = z
  .object({
    workspaceId: z.string().min(1),
    runId: z.string().min(1),
    decisionId: z.string().min(1),
    providerConnectionId: z.string().min(1),
    toolName: z.string().min(1),
    toolManifestHash: z.string().min(1),
    policyVersionId: z.string().min(1),
    workspaceMode: z.string().min(1),
    instrument: z.string().min(1),
    marketType: z.string().min(1),
    action: z.string().min(1),
    requestedNotionalUsdt: DecimalString.optional(),
    requestedQuantity: DecimalString.optional(),
    requestedLeverage: DecimalString.optional(),
    orderType: z.string().optional(),
    limitPrice: DecimalString.optional(),
    stopLoss: DecimalString.optional(),
    takeProfit: DecimalString.optional(),
    marketSnapshotRef: z.string().optional(),
    executionAdapter: z.enum(["simulator", "bitget_live", "replay"]),
  })
  .strict();
export type ActionDigestInput = z.infer<typeof ActionDigestInput>;
