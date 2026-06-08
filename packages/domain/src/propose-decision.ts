import {
  DecisionEnvelope,
  DecisionProposedPayload,
  DecisionRejectedPayload,
  DecisionValidatedPayload,
  PolicyEvaluatedPayload,
  PolicyEvaluationStartedPayload,
  type ActorType,
  type DecisionEnvelope as DecisionEnvelopeType,
  type DecisionRejectedPayload as DecisionRejectedPayloadType,
  type EvaluationContext,
  type LedgerEvent,
  type Policy,
} from "@traceguard/schemas";
import { canonicalJson, makeEvent, type Clock, type IdGen } from "@traceguard/event-ledger";
import { evaluate, type PolicyDecision } from "@traceguard/policy-engine";

export interface ProposeDecisionArgs {
  workspaceId: string;
  actorId?: string;
  envelope: unknown;
  policy: Policy;
  context: EvaluationContext;
  previousEventHash?: string | null;
}

export interface ProposeDecisionDeps {
  clock: Clock;
  newId: IdGen;
  hash: (s: string) => string;
}

export interface ProposeDecisionResult {
  decision: PolicyDecision;
  events: LedgerEvent[];
}

type ValidationIssue = {
  path: readonly PropertyKey[];
  message: string;
  code: string;
  received?: unknown;
  input?: unknown;
};

type ValidationError = DecisionRejectedPayloadType["validationErrors"][number];
type RejectionReasonCode = DecisionRejectedPayloadType["reasonCode"];

type MaterialDecision = Omit<DecisionEnvelopeType, "confidence">;

function failClosedDecision(): PolicyDecision {
  return { outcome: "block", matchedRules: [] };
}

function rawDecisionId(envelope: unknown): string | undefined {
  if (typeof envelope !== "object" || envelope === null) return undefined;
  const raw = envelope as { id?: unknown };
  return typeof raw.id === "string" ? raw.id : undefined;
}

function reasonFromIssues(issues: readonly ValidationIssue[]): RejectionReasonCode {
  const numericFields = new Set<PropertyKey>([
    "requestedNotionalUsdt",
    "requestedQuantity",
    "requestedLeverage",
    "limitPrice",
    "stopLoss",
    "takeProfit",
  ]);

  if (issues.some((issue) => issue.path[0] === "action")) return "unsupported_action";
  if (issues.some((issue) => issue.path[0] !== undefined && numericFields.has(issue.path[0]))) {
    return "numeric_parse_error";
  }
  if (
    issues.some(
      (issue) =>
        issue.code === "invalid_type" &&
        (issue.received === "undefined" || issue.input === undefined || issue.message.includes("received undefined")),
    )
  ) {
    return "missing_required_field";
  }
  return "schema_invalid";
}

function validationErrorsFromIssues(issues: readonly ValidationIssue[]): ValidationError[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function materialDecision(envelope: DecisionEnvelopeType): MaterialDecision {
  const { confidence: _confidence, ...material } = envelope;
  return material;
}

function optionalEnvelopeFields(envelope: DecisionEnvelopeType): Partial<DecisionProposedPayload> {
  return {
    ...(envelope.confidence !== undefined ? { confidence: envelope.confidence } : {}),
    ...(envelope.requestedNotionalUsdt !== undefined ? { requestedNotionalUsdt: envelope.requestedNotionalUsdt } : {}),
    ...(envelope.requestedQuantity !== undefined ? { requestedQuantity: envelope.requestedQuantity } : {}),
    ...(envelope.requestedLeverage !== undefined ? { requestedLeverage: envelope.requestedLeverage } : {}),
    ...(envelope.orderType !== undefined ? { orderType: envelope.orderType } : {}),
    ...(envelope.limitPrice !== undefined ? { limitPrice: envelope.limitPrice } : {}),
    ...(envelope.stopLoss !== undefined ? { stopLoss: envelope.stopLoss } : {}),
    ...(envelope.takeProfit !== undefined ? { takeProfit: envelope.takeProfit } : {}),
    ...(envelope.promptVersion !== undefined ? { promptVersion: envelope.promptVersion } : {}),
    ...(envelope.modelProvider !== undefined ? { modelProvider: envelope.modelProvider } : {}),
    ...(envelope.modelName !== undefined ? { modelName: envelope.modelName } : {}),
  };
}

function proposedPayload(
  envelope: DecisionEnvelopeType,
  runId: string,
  decisionHash: string,
): DecisionProposedPayload {
  return DecisionProposedPayload.parse({
    decisionId: envelope.id,
    runId,
    envelopeVersion: 1,
    instrument: envelope.instrument,
    marketType: envelope.marketType,
    action: envelope.action,
    thesis: envelope.thesis,
    evidenceRefs: envelope.evidenceRefs,
    ...optionalEnvelopeFields(envelope),
    decisionHash,
  });
}

function rejectionPayload(
  runId: string,
  decisionId: string | undefined,
  reasonCode: RejectionReasonCode,
  validationErrors: ValidationError[],
): DecisionRejectedPayloadType {
  return DecisionRejectedPayload.parse({
    ...(decisionId !== undefined ? { decisionId } : {}),
    runId,
    reasonCode,
    validationErrors,
  });
}

export function proposeDecision(args: ProposeDecisionArgs, deps: ProposeDecisionDeps): ProposeDecisionResult {
  const parsed = DecisionEnvelope.safeParse(args.envelope);
  const decisionId = parsed.success ? parsed.data.id : rawDecisionId(args.envelope);
  const aggregateId = decisionId ?? args.context.runId;
  let previousEventHash = args.previousEventHash ?? null;
  const events: LedgerEvent[] = [];

  function emit<TPayload>(eventType: string, actorType: ActorType, payload: TPayload): LedgerEvent<TPayload> {
    const event = makeEvent(
      {
        workspaceId: args.workspaceId,
        aggregateType: "decision",
        aggregateId,
        eventType,
        eventVersion: 1,
        schemaVersion: 1,
        actorType,
        actorId: actorType === "agent" ? args.actorId : undefined,
        runId: args.context.runId,
        payload,
        previousEventHash,
      },
      deps,
    );
    events.push(event);
    previousEventHash = event.eventHash;
    return event;
  }

  if (!parsed.success) {
    emit(
      "DecisionRejected",
      "system",
      rejectionPayload(
        args.context.runId,
        decisionId,
        reasonFromIssues(parsed.error.issues),
        validationErrorsFromIssues(parsed.error.issues),
      ),
    );
    return { decision: failClosedDecision(), events };
  }

  const envelope = parsed.data;
  const material = materialDecision(envelope);
  const decisionHash = deps.hash(canonicalJson(material));

  emit("DecisionProposed", "agent", proposedPayload(envelope, args.context.runId, decisionHash));

  if (envelope.evidenceRefs.length === 0) {
    emit(
      "DecisionRejected",
      "system",
      rejectionPayload(args.context.runId, envelope.id, "missing_evidence", [
        { path: "evidenceRefs", message: "must contain at least one evidence reference" },
      ]),
    );
    return { decision: failClosedDecision(), events };
  }

  emit(
    "DecisionValidated",
    "system",
    DecisionValidatedPayload.parse({
      decisionId: envelope.id,
      runId: args.context.runId,
      validationResult: "valid",
      normalizedDecisionRef: `normalized:${envelope.id}`,
      normalizedDecisionHash: deps.hash(canonicalJson(material)),
    }),
  );

  const evaluationId = deps.newId.next("eval");
  const evaluationInputHash = deps.hash(canonicalJson({ decision: material, policy: args.policy, context: args.context }));

  emit(
    "PolicyEvaluationStarted",
    "system",
    PolicyEvaluationStartedPayload.parse({
      evaluationId,
      runId: args.context.runId,
      decisionId: envelope.id,
      policyVersionId: args.context.policyVersionId,
      evaluatorVersion: args.context.evaluatorVersion,
      evaluationInputHash,
    }),
  );

  const decision = evaluate(envelope, args.policy, args.context);

  emit(
    "PolicyEvaluated",
    "system",
    PolicyEvaluatedPayload.parse({
      evaluationId,
      runId: args.context.runId,
      decisionId: envelope.id,
      policyVersionId: args.context.policyVersionId,
      evaluatorVersion: args.context.evaluatorVersion,
      outcome: decision.outcome,
      matchedRules: decision.matchedRules,
      evaluationOutputHash: deps.hash(canonicalJson(decision)),
    }),
  );

  return { decision, events };
}
