import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { RawUpstreamTool } from "@traceguard/schemas";
import {
  type UpstreamLaunchConfig,
  type UpstreamManifestClient,
  UpstreamUnavailableError,
  UpstreamListToolsError,
  UpstreamCallError,
} from "./upstream-client.js";
import { mapTool } from "./map-tool.js";

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;
const DEFAULT_LIST_TIMEOUT_MS = 10_000;
const DEFAULT_CALL_TIMEOUT_MS = 10_000;

export class StdioUpstreamClient implements UpstreamManifestClient {
  readonly #config: UpstreamLaunchConfig;
  #client: Client | null = null;

  constructor(config: UpstreamLaunchConfig) {
    this.#config = config;
  }

  async open(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.#config.command,
      args: this.#config.args ?? [],
      env: { ...getDefaultEnvironment(), ...(this.#config.env ?? {}) },
      stderr: "inherit",
    });
    const client = new Client(
      {
        name: this.#config.clientName ?? "traceguard-gateway",
        version: this.#config.clientVersion ?? "0.0.0",
      },
      { capabilities: {} },
    );
    try {
      await withTimeout(
        client.connect(transport),
        DEFAULT_OPEN_TIMEOUT_MS,
        "upstream initialize timed out",
      );
    } catch (err) {
      await safeClose(client);
      throw new UpstreamUnavailableError(messageOf(err), { cause: err });
    }
    this.#client = client;
  }

  async listTools(): Promise<RawUpstreamTool[]> {
    const client = this.#client;
    if (client === null) throw new UpstreamListToolsError("listTools called before open");
    try {
      const { tools } = await client.listTools(undefined, { timeout: DEFAULT_LIST_TIMEOUT_MS });
      if (!Array.isArray(tools)) throw new UpstreamListToolsError("tools/list returned a non-array");
      return tools.map(mapTool);
    } catch (err) {
      if (err instanceof UpstreamListToolsError) throw err;
      throw new UpstreamListToolsError(messageOf(err), { cause: err });
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const client = this.#client;
    if (client === null) {
      throw new UpstreamCallError("callTool called before open");
    }
    try {
      const result = await client.callTool(
        { name, arguments: args },
        undefined,
        { timeout: DEFAULT_CALL_TIMEOUT_MS },
      );
      return result as CallToolResult;
    } catch (err) {
      throw new UpstreamCallError(messageOf(err), { cause: err });
    }
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = null; // idempotent: subsequent close() is a no-op
    if (client !== null) await safeClose(client);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function safeClose(closable: { close(): Promise<void> }): Promise<void> {
  try {
    await closable.close();
  } catch {
    /* teardown is best-effort; never mask the original failure */
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
