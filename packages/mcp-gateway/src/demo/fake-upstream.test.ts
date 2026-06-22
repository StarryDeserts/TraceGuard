import { describe, it, expect } from "vitest";
import { createFakeUpstream } from "./fake-upstream.js";

describe("createFakeUpstream", () => {
  it("lists three tools spanning active/blocked/frozen risk classes", async () => {
    const client = createFakeUpstream();
    await client.open();
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(["spot_place_order", "withdraw", "mystery_capability"]);
    await client.close();
  });

  it("returns a canned receipt from callTool", async () => {
    const client = createFakeUpstream();
    const res = await client.callTool("spot_place_order", { symbol: "BTCUSDT" });
    const sc = (res as { structuredContent?: { orderId?: string } }).structuredContent;
    expect(sc?.orderId).toBe("PAPER-OID-1");
  });
});
