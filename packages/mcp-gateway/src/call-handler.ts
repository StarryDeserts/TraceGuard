import { canonicalJson, type LedgerStore } from "@traceguard/event-ledger";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ReconcileDeps } from "@traceguard/tool-manifest";
import type { UpstreamManifestClient } from "./upstream-client.js";
import type { GatewayState } from "./gateway-state.js";
import { routeCall, type CallDenyCode } from "./call-router.js";
import {
  recordToolCallRequested,
  recordToolCallCompleted,
  recordToolCallFailed,
  recordToolCallDenied,
  recordIncidentOpened,
  type CallAudit,
} from "./tool-call-events.js";

export interface GatewayCallContext {
  client: UpstreamManifestClient;
  store: LedgerStore;
  deps: ReconcileDeps;
  audit: CallAudit;
}

export type CallErrorCode = CallDenyCode | "TOOL_CALL_NOT_AVAILABLE" | "UPSTREAM_CALL_FAILED";

export interface ToolCallDenial {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
  traceguard: { errorCode: CallErrorCode; toolName: string };
}

const DENY_TEXT: Record<CallErrorCode, string> = {
  UNKNOWN_TOOL: "This tool is not part of the governed manifest.",
  TOOL_FROZEN: "This tool is frozen by policy and cannot be called.",
  TOOL_BLOCKED: "This tool is blocked by policy; a security incident has been recorded.",
  DECISION_ENVELOPE_REQUIRED:
    "This action requires an approved Decision Envelope before it can execute.",
  TOOL_CALL_NOT_AVAILABLE: "Tool execution is not available because the gateway booted degraded.",
  UPSTREAM_CALL_FAILED: "The upstream provider call failed; the request was not completed.",
};

export function denyCall(
  code: CallErrorCode,
  toolName: string,
  message?: string,
): CallToolResult {
  const denial: ToolCallDenial = {
    isError: true,
    content: [{ type: "text", text: message ?? DENY_TEXT[code] }],
    traceguard: { errorCode: code, toolName },
  };
  return denial as unknown as CallToolResult;
}

export async function handleToolCall(
  state: GatewayState,
  ctx: GatewayCallContext | undefined,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  if (ctx === undefined) {
    return denyCall("TOOL_CALL_NOT_AVAILABLE", name);
  }

  const outcome = routeCall(state, name);

  if (outcome.kind === "deny") {
    const deniedHead = await ctx.store.head(ctx.audit.workspaceId);
    const denied = recordToolCallDenied(ctx.audit, ctx.deps, deniedHead, {
      toolName: name,
      denyCode: outcome.code,
      ...(outcome.riskClass !== undefined ? { riskClass: outcome.riskClass } : {}),
    });
    await ctx.store.append(deniedHead, [denied]);

    if (outcome.incident && outcome.riskClass !== undefined) {
      const incident = recordIncidentOpened(ctx.audit, ctx.deps, denied.eventHash, {
        toolName: name,
        riskClass: outcome.riskClass,
      });
      await ctx.store.append(denied.eventHash, [incident]);
    }
    return denyCall(outcome.code, name);
  }

  const argumentsDigest = ctx.deps.hash(canonicalJson(args));
  const requestedHead = await ctx.store.head(ctx.audit.workspaceId);
  const requested = recordToolCallRequested(ctx.audit, ctx.deps, requestedHead, {
    toolName: name,
    riskClass: outcome.riskClass,
    argumentsDigest,
  });
  await ctx.store.append(requestedHead, [requested]);

  try {
    const result = await ctx.client.callTool(name, args);
    const completed = recordToolCallCompleted(ctx.audit, ctx.deps, requested.eventHash, {
      toolName: name,
      result,
    });
    await ctx.store.append(requested.eventHash, [completed]);
    return result;
  } catch {
    const failed = recordToolCallFailed(ctx.audit, ctx.deps, requested.eventHash, {
      toolName: name,
    });
    await ctx.store.append(requested.eventHash, [failed]);
    return denyCall("UPSTREAM_CALL_FAILED", name);
  }
}
