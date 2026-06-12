import type { RawUpstreamTool } from "@traceguard/schemas";

interface UpstreamToolShape {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export function mapTool(tool: UpstreamToolShape): RawUpstreamTool {
  const mapped: RawUpstreamTool = { name: tool.name, inputSchema: tool.inputSchema ?? {} };
  if (tool.title !== undefined) mapped.title = tool.title;
  if (tool.description !== undefined) mapped.description = tool.description;
  if (tool.outputSchema !== undefined) mapped.outputSchema = tool.outputSchema;
  if (tool.annotations !== undefined) mapped.annotations = tool.annotations;
  return mapped;
}
