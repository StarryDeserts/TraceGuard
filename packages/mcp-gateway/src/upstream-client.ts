import type { RawUpstreamTool } from "@traceguard/schemas";

export interface UpstreamLaunchConfig {
  command: string; // executable to spawn (e.g. process.execPath = node)
  args?: string[]; // e.g. [<bitget-mcp-server entry>, "--paper-trading"]
  env?: Record<string, string>; // merged over getDefaultEnvironment(); omit to inherit safe defaults
  clientName?: string; // MCP client identity (initialize); default "traceguard-gateway"
  clientVersion?: string; // default "0.0.0"
}

export interface UpstreamManifestClient {
  open(): Promise<void>; // spawn + MCP initialize handshake
  listTools(): Promise<RawUpstreamTool[]>; // MCP tools/list, mapped into RawUpstreamTool
  close(): Promise<void>; // terminate the upstream; idempotent
}

export class UpstreamUnavailableError extends Error {
  readonly name = "UpstreamUnavailableError";
}
export class UpstreamListToolsError extends Error {
  readonly name = "UpstreamListToolsError";
}
