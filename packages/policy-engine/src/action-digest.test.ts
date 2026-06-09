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

const materialFieldChanges = [
  ["workspaceId", { ...input, workspaceId: "ws_2" }],
  ["runId", { ...input, runId: "run_2" }],
  ["decisionId", { ...input, decisionId: "dec_2" }],
  ["providerConnectionId", { ...input, providerConnectionId: "pc_2" }],
  ["toolName", { ...input, toolName: "cancel_order" }],
  ["toolManifestHash", { ...input, toolManifestHash: "tmh_2" }],
  ["policyVersionId", { ...input, policyVersionId: "pv_2" }],
  ["workspaceMode", { ...input, workspaceMode: "autonomous_mode" }],
  ["instrument", { ...input, instrument: "ETHUSDT" }],
  ["marketType", { ...input, marketType: "spot" }],
  ["action", { ...input, action: "close_long" }],
  ["requestedNotionalUsdt", { ...input, requestedNotionalUsdt: "301" }],
  ["requestedQuantity", { ...input, requestedQuantity: "0.02" }],
  ["requestedLeverage", { ...input, requestedLeverage: "3" }],
  ["orderType", { ...input, orderType: "market" }],
  ["limitPrice", { ...input, limitPrice: "65001.50" }],
  ["stopLoss", { ...input, stopLoss: "62000" }],
  ["takeProfit", { ...input, takeProfit: "70000" }],
  ["marketSnapshotRef", { ...input, marketSnapshotRef: "snap_2" }],
  ["executionAdapter", { ...input, executionAdapter: "bitget_live" }],
] satisfies Array<readonly [keyof ActionDigestInput, ActionDigestInput]>;

const materialFields = [
  "workspaceId",
  "runId",
  "decisionId",
  "providerConnectionId",
  "toolName",
  "toolManifestHash",
  "policyVersionId",
  "workspaceMode",
  "instrument",
  "marketType",
  "action",
  "requestedNotionalUsdt",
  "requestedQuantity",
  "requestedLeverage",
  "orderType",
  "limitPrice",
  "stopLoss",
  "takeProfit",
  "marketSnapshotRef",
  "executionAdapter",
] satisfies Array<keyof ActionDigestInput>;

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

  it("changes when any material field changes", () => {
    expect(materialFieldChanges.map(([field]) => field)).toEqual(materialFields);

    const baseDigest = computeActionDigest(input, sha256hex);
    for (const [field, changedInput] of materialFieldChanges) {
      expect(computeActionDigest(changedInput, sha256hex), field).not.toBe(baseDigest);
    }
  });

  it("validates ActionDigestInput before hashing", () => {
    let hashCalls = 0;
    const hashShouldNotRun = () => {
      hashCalls += 1;
      throw new Error("hash should not run for invalid action digest input");
    };

    expect(() =>
      computeActionDigest({ ...input, requestedNotionalUsdt: 300 } as unknown as ActionDigestInput, hashShouldNotRun),
    ).toThrow();
    expect(hashCalls).toBe(0);
  });
});
