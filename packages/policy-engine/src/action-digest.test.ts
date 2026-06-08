import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { computeActionDigest } from "./action-digest.js";
import type { ActionDigestInput } from "@traceguard/schemas";

function sha256hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

const input: ActionDigestInput = {
  workspaceId: "ws_1",
  runId: "run_1",
  decisionId: "dec_1",
  providerConnectionId: "pc_1",
  toolName: "place_order",
  toolManifestHash: "tmh_1",
  policyVersionId: "pv_1",
  workspaceMode: "approval_mode",
  instrument: "BTCUSDT",
  marketType: "futures",
  action: "open_long",
  requestedNotionalUsdt: "300",
  requestedQuantity: "0.01",
  requestedLeverage: "2",
  orderType: "limit",
  limitPrice: "65000.50",
  stopLoss: "63000",
  takeProfit: "69000",
  marketSnapshotRef: "snap_1",
  executionAdapter: "simulator",
};

describe("computeActionDigest", () => {
  it("is stable under object key reordering", () => {
    const reordered: ActionDigestInput = {
      executionAdapter: input.executionAdapter,
      marketSnapshotRef: input.marketSnapshotRef,
      takeProfit: input.takeProfit,
      stopLoss: input.stopLoss,
      limitPrice: input.limitPrice,
      orderType: input.orderType,
      requestedLeverage: input.requestedLeverage,
      requestedQuantity: input.requestedQuantity,
      requestedNotionalUsdt: input.requestedNotionalUsdt,
      action: input.action,
      marketType: input.marketType,
      instrument: input.instrument,
      workspaceMode: input.workspaceMode,
      policyVersionId: input.policyVersionId,
      toolManifestHash: input.toolManifestHash,
      toolName: input.toolName,
      providerConnectionId: input.providerConnectionId,
      decisionId: input.decisionId,
      runId: input.runId,
      workspaceId: input.workspaceId,
    };
    expect(computeActionDigest(reordered, sha256hex)).toBe(computeActionDigest(input, sha256hex));
  });

  it("changes when a material field changes", () => {
    expect(computeActionDigest({ ...input, requestedNotionalUsdt: "301" }, sha256hex)).not.toBe(
      computeActionDigest(input, sha256hex),
    );
    expect(computeActionDigest({ ...input, executionAdapter: "bitget_live" }, sha256hex)).not.toBe(
      computeActionDigest(input, sha256hex),
    );
  });

  it("validates ActionDigestInput before hashing", () => {
    expect(() => computeActionDigest({ ...input, requestedNotionalUsdt: 300 } as unknown as ActionDigestInput, sha256hex)).toThrow();
  });
});
