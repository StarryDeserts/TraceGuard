import type {
  ExecutionAdapterType,
  ExecutionFinalStatus,
  ExecutionUnknownReason,
} from "@traceguard/schemas";

export interface ExecutionRequest {
  executionId: string;
  runId: string;
  decisionId: string;
  authorizationId: string;
  actionDigest: string;
  idempotencyKey: string;
  requestRef: string;
  requestHash: string;
}

export type ExecutionResult =
  | {
      kind: "completed";
      finalStatus: ExecutionFinalStatus;
      receiptRef: string;
      receiptHash: string;
      upstreamRef?: string;
    }
  | {
      kind: "unknown";
      reasonCode: ExecutionUnknownReason;
      upstreamRequestId?: string;
    };

export interface ExecutionAdapter {
  readonly adapterType: ExecutionAdapterType;
  call(request: ExecutionRequest): Promise<ExecutionResult>;
}
