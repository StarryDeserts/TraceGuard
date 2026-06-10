import type { ExecutionAdapter, ExecutionRequest, ExecutionResult } from "@traceguard/domain";

export function createSimulatorAdapter(deps: { hash: (s: string) => string }): ExecutionAdapter {
  return {
    adapterType: "simulator",
    async call(request: ExecutionRequest): Promise<ExecutionResult> {
      const receiptRef = `receipt:${request.executionId}`;
      const receiptHash = deps.hash(`receipt:${request.executionId}:${request.requestHash}`);
      return { kind: "completed", finalStatus: "simulated", receiptRef, receiptHash };
    },
  };
}
