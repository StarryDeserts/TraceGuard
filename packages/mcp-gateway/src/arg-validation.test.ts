import { describe, it, expect, vi } from "vitest";
import { Ajv } from "ajv";
import { createArgValidator } from "./arg-validation.js";
import type { ServedTool } from "./gateway-state.js";

function tool(name: string, inputSchema: unknown): ServedTool {
  return { name, inputSchema };
}

const TICKER: ServedTool = tool("spot_get_ticker", {
  type: "object",
  properties: {
    symbol: { type: "string" },
    limit: { type: "number" },
    side: { type: "string", enum: ["buy", "sell"] },
  },
  required: ["symbol"],
});

describe("createArgValidator", () => {
  it("accepts valid args", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("spot_get_ticker", { symbol: "BTCUSDT" })).toEqual({ ok: true });
  });

  it("rejects a missing required property", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("spot_get_ticker", { limit: 5 }).ok).toBe(false);
  });

  it("rejects a wrong type", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("spot_get_ticker", { symbol: 123 }).ok).toBe(false);
  });

  it("rejects an enum violation", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("spot_get_ticker", { symbol: "x", side: "hold" }).ok).toBe(false);
  });

  it("tolerates additional properties", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("spot_get_ticker", { symbol: "x", extra: 1 })).toEqual({ ok: true });
  });

  it("does not coerce types (string for a number field fails)", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("spot_get_ticker", { symbol: "x", limit: "5" }).ok).toBe(false);
  });

  it("skips validation when the schema is undefined", () => {
    const v = createArgValidator([tool("noschema", undefined)]);
    expect(v.validate("noschema", { anything: true })).toEqual({ ok: true });
  });

  it("skips validation for an empty {} schema", () => {
    const v = createArgValidator([tool("empty", {})]);
    expect(v.validate("empty", { anything: true })).toEqual({ ok: true });
  });

  it("skips (does not throw) when a schema cannot compile, logging once", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const v = createArgValidator([tool("broken", { $ref: "#/$defs/missing" })]);
    expect(v.validate("broken", { anything: true })).toEqual({ ok: true });
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0]?.[0]).toMatch(/uncompilable inputSchema/);
    errSpy.mockRestore();
  });

  it("returns ok for a tool name it has never seen", () => {
    const v = createArgValidator([TICKER]);
    expect(v.validate("unknown_tool", {})).toEqual({ ok: true });
  });

  it("reports ajv error strings on failure", () => {
    const v = createArgValidator([TICKER]);
    const r = v.validate("spot_get_ticker", { limit: 5 });
    if (r.ok) throw new Error("expected failure");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(typeof r.errors[0]).toBe("string");
  });

  it("compiles each schema once at construction, not per validate call", () => {
    const compileSpy = vi.spyOn(Ajv.prototype, "compile");
    const v = createArgValidator([
      tool("a", { type: "object", properties: { x: { type: "string" } } }),
      tool("b", { type: "object", properties: { y: { type: "number" } } }),
    ]);
    expect(compileSpy).toHaveBeenCalledTimes(2);
    v.validate("a", { x: "ok" });
    v.validate("a", { x: "ok" });
    v.validate("b", { y: 1 });
    expect(compileSpy).toHaveBeenCalledTimes(2);
    compileSpy.mockRestore();
  });
});
