import { describe, it, expect } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import type { ApprovalRequestedPayload, AuthorizationIssuedPayload, Effect, LedgerEvent } from "@traceguard/schemas";
import {
  fixedClock,
  sampleActionDigestInput,
  sampleApprovalExpiresAt,
  sampleAuthorizationExpiresAt,
  sampleChannelOptions,
  sampleDecisionId,
  samplePolicyEvaluationId,
  sampleRunId,
  sampleWorkspaceId,
  sequentialIdGen,
} from "@traceguard/testing-fixtures";
import { resolveAuthorizationGateway, type ResolveAuthorizationGatewayArgs } from "./authorization-gateway.js";

function makeArgs(outcome: Effect): ResolveAuthorizationGatewayArgs {
  return {
    workspaceId: sampleWorkspaceId,
    runId: sampleRunId,
    decisionId: sampleDecisionId,
    policyEvaluationId: samplePolicyEvaluationId,
    outcome,
    actionDigestInput: sampleActionDigestInput,
    channelOptions: sampleChannelOptions,
    summary: { instrument: "BTCUSDT", action: "open_long", notionalUsdt: "300", leverage: "2" },
    approvalExpiresAt: sampleApprovalExpiresAt,
    authorizationExpiresAt: sampleAuthorizationExpiresAt,
    previousEventHash: null,
  };
}

function makeDeps() {
  return { clock: fixedClock(), newId: sequentialIdGen(), hash: sha256hex };
}

describe("resolveAuthorizationGateway", () => {
  it("issues a single-action authorization on allow", () => {
    const result = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    expect(result.outcome).toBe("issued");
    expect(result.events.map((e) => e.eventType)).toEqual(["AuthorizationIssued"]);
    const event = result.events[0] as LedgerEvent<AuthorizationIssuedPayload>;
    expect(event.aggregateType).toBe("authorization");
    expect(event.actorType).toBe("system");
    expect(event.actorId).toBeUndefined();
    expect(event.payload.scope).toBe("single_action");
    expect(event.payload.expiresAt).toBe(sampleAuthorizationExpiresAt);
    expect(event.payload.approvalId).toBeUndefined();
    expect(event.payload.actionDigest.length).toBeGreaterThan(0);
  });

  it("requests approval on require_approval, pinning summary.policyOutcome", () => {
    const result = resolveAuthorizationGateway(makeArgs("require_approval"), makeDeps());
    expect(result.outcome).toBe("requested");
    expect(result.events.map((e) => e.eventType)).toEqual(["ApprovalRequested"]);
    const event = result.events[0] as LedgerEvent<ApprovalRequestedPayload>;
    expect(event.aggregateType).toBe("approval");
    expect(event.actorType).toBe("system");
    expect(event.payload.summary.policyOutcome).toBe("require_approval");
    expect(event.payload.summary.notionalUsdt).toBe("300");
    expect(event.payload.channelOptions).toEqual(sampleChannelOptions);
    expect(event.payload.expiresAt).toBe(sampleApprovalExpiresAt);
    expect(event.payload.policyEvaluationId).toBe(samplePolicyEvaluationId);
  });

  it("emits no events on block", () => {
    const result = resolveAuthorizationGateway(makeArgs("block"), makeDeps());
    expect(result.outcome).toBe("blocked");
    expect(result.events).toEqual([]);
  });

  it("recomputes the action digest from the input (matches policy-engine)", async () => {
    const { computeActionDigest } = await import("@traceguard/policy-engine");
    const result = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    const event = result.events[0] as LedgerEvent<AuthorizationIssuedPayload>;
    expect(event.payload.actionDigest).toBe(computeActionDigest(sampleActionDigestInput, sha256hex));
  });

  it("is deterministic — identical args+deps produce byte-identical events", () => {
    const a = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    const b = resolveAuthorizationGateway(makeArgs("allow"), makeDeps());
    expect(a.events).toEqual(b.events);
    expect(a.events[0]?.eventHash).toBe(b.events[0]?.eventHash);
  });

  it("threads previousEventHash from args into the emitted event", () => {
    const result = resolveAuthorizationGateway({ ...makeArgs("allow"), previousEventHash: "prev_hash" }, makeDeps());
    expect(result.events[0]?.previousEventHash).toBe("prev_hash");
  });
});
