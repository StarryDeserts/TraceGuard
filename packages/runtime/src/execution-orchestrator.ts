import {
  authorizeExecution,
  settleExecution,
  type ExecutionAdapter,
  type ExecutionResult,
  type ExecutionTransitionDeps,
} from "@traceguard/domain";
import { authorizationProjection, makeEvent, type LedgerStore } from "@traceguard/event-ledger";
import { RunFailedPayload, type ExecutionAdapterType } from "@traceguard/schemas";

export interface ExecutionOrchestratorArgs {
  workspaceId: string;
  runId: string;
  decisionId: string;
  attemptedActionDigest: string;
  adapterType: ExecutionAdapterType;
  gates: { workspaceLocked: boolean; manifestChanged: boolean; policyChanged: boolean };
  executionGates: { capabilityUnavailable: boolean; snapshotStale: boolean; manifestUnapproved: boolean };
}

export interface ExecutionOrchestratorDeps extends ExecutionTransitionDeps {
  store: LedgerStore;
  adapter: ExecutionAdapter;
}

export type ExecutionOrchestratorOutcome = "denied" | "rejected" | "completed" | "unknown" | "failed";

export async function executionOrchestrator(
  args: ExecutionOrchestratorArgs,
  deps: ExecutionOrchestratorDeps,
): Promise<{ outcome: ExecutionOrchestratorOutcome }> {
  const transitionDeps: ExecutionTransitionDeps = { clock: deps.clock, newId: deps.newId, hash: deps.hash };
  const events = await deps.store.read(args.workspaceId, args.runId);
  const head = await deps.store.head(args.workspaceId);
  const view = authorizationProjection(events);

  const authorization =
    view.authorizationId && view.actionDigest && view.expiresAt
      ? {
          authorizationId: view.authorizationId,
          actionDigest: view.actionDigest,
          expiresAt: view.expiresAt,
          status: view.status,
          ...(view.approvalId ? { approvalId: view.approvalId } : {}),
        }
      : undefined;

  const auth = authorizeExecution(
    {
      workspaceId: args.workspaceId,
      runId: args.runId,
      decisionId: args.decisionId,
      ...(authorization ? { authorization } : {}),
      attemptedActionDigest: args.attemptedActionDigest,
      gates: args.gates,
      executionGates: args.executionGates,
      adapterType: args.adapterType,
      previousEventHash: head,
    },
    transitionDeps,
  );

  if (auth.outcome === "denied" || auth.outcome === "rejected") {
    await deps.store.append(head, auth.events);
    return { outcome: auth.outcome };
  }

  // BURN BEFORE EXECUTE: persist ExecutionRequested + AuthorizationConsumed before any adapter call.
  await deps.store.append(head, auth.events);
  const burnHead = auth.events[auth.events.length - 1]!.eventHash;

  let result: ExecutionResult;
  try {
    result = await deps.adapter.call(auth.request!);
  } catch {
    const failed = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType: "run",
        aggregateId: args.runId,
        eventType: "RunFailed",
        eventVersion: 1,
        schemaVersion: 1,
        actorType: "system",
        runId: args.runId,
        payload: RunFailedPayload.parse({
          runId: args.runId,
          failedAt: deps.clock.now(),
          reasonCode: "orchestrator_error",
        }),
        previousEventHash: burnHead,
      },
      transitionDeps,
    );
    await deps.store.append(burnHead, [failed]);
    return { outcome: "failed" };
  }

  const settle = settleExecution(
    {
      workspaceId: args.workspaceId,
      runId: args.runId,
      decisionId: args.decisionId,
      executionId: auth.request!.executionId,
      adapterType: args.adapterType,
      previousEventHash: burnHead,
    },
    result,
    transitionDeps,
  );
  await deps.store.append(burnHead, settle.events);
  return { outcome: settle.outcome };
}
