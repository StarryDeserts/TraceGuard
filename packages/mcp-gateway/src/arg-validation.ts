import { Ajv, type ValidateFunction } from "ajv";
import type { ServedTool } from "./gateway-state.js";

export type ArgValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

export interface ArgValidator {
  validate(toolName: string, args: Record<string, unknown>): ArgValidationResult;
}

// `null` marks a tool whose schema is absent/empty/uncompilable → validation skipped.
export function createArgValidator(servedTools: ServedTool[]): ArgValidator {
  const ajv = new Ajv({
    strict: false, // tolerate upstream schema quirks so they compile
    allErrors: true, // collect every error for a useful message
    coerceTypes: false, // never mutate args (digest fidelity)
    useDefaults: false,
    removeAdditional: false, // tolerate additionalProperties
  });

  const validators = new Map<string, ValidateFunction | null>();
  for (const tool of servedTools) {
    validators.set(tool.name, compileOrNull(ajv, tool));
  }

  return {
    validate(toolName, args) {
      if (!validators.has(toolName)) return { ok: true }; // existence gated by routeCall
      const fn = validators.get(toolName);
      if (fn === null || fn === undefined) return { ok: true }; // unusable schema → skip
      if (fn(args)) return { ok: true };
      return { ok: false, errors: (fn.errors ?? []).map(formatError) };
    },
  };
}

function compileOrNull(ajv: Ajv, tool: ServedTool): ValidateFunction | null {
  const schema = tool.inputSchema;
  if (schema === undefined || schema === null) return null;
  if (typeof schema === "object" && Object.keys(schema as object).length === 0) return null;
  try {
    return ajv.compile(schema as object);
  } catch (err) {
    console.error(
      `[arg-validation] tool ${tool.name} has an uncompilable inputSchema; ` +
        `argument validation skipped: ${(err as Error).message}`,
    );
    return null;
  }
}

function formatError(e: { instancePath?: string; message?: string }): string {
  const at = e.instancePath && e.instancePath.length > 0 ? e.instancePath : "(root)";
  return `${at} ${e.message ?? "is invalid"}`.trim();
}
