import { describe, it, expect } from "vitest";
import { INTERNAL_TOOL_DEFS, INTERNAL_TOOL_NAMES } from "./internal-tools.js";

describe("internal tool definitions", () => {
  it("defines the six traceguard_* tools", () => {
    const names = INTERNAL_TOOL_DEFS.map((t) => t.name);
    expect(names).toEqual([
      "traceguard_start_run",
      "traceguard_record_decision",
      "traceguard_request_execution",
      "traceguard_check_approval",
      "traceguard_execute_authorized_action",
      "traceguard_finish_run",
    ]);
  });

  it("INTERNAL_TOOL_NAMES matches the defs", () => {
    for (const t of INTERNAL_TOOL_DEFS) expect(INTERNAL_TOOL_NAMES.has(t.name)).toBe(true);
    expect(INTERNAL_TOOL_NAMES.size).toBe(INTERNAL_TOOL_DEFS.length);
  });

  it("every tool carries an object inputSchema and a description", () => {
    for (const t of INTERNAL_TOOL_DEFS) {
      expect(typeof t.description).toBe("string");
      expect((t.inputSchema as { type?: string }).type).toBe("object");
    }
  });
});
