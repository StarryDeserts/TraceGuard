import { describe, expect, it } from "vitest";
import { sha256hex } from "@traceguard/event-ledger";
import { bitget36RawTools, bitgetManifestHashV1 } from "@traceguard/testing-fixtures";
import type { RiskClass } from "@traceguard/schemas";
import { classifyRisk } from "./classify.js";
import { normalizeToolDefinition } from "./normalize.js";
import { computeManifestHash } from "./manifest-hash.js";

const identity = {
  providerConnectionId: "pc_bitget",
  providerType: "bitget_agent_hub" as const,
};

function bucket(rc: RiskClass): "visible" | "blocked" | "frozen" {
  if (rc === "unknown") return "frozen";
  if (rc === "asset_movement" || rc === "administrative") return "blocked";
  return "visible";
}

describe("bitget 36-tool golden manifest", () => {
  it("classifies into the locked 32 visible / 4 blocked / 0 frozen distribution", () => {
    const counts = { visible: 0, blocked: 0, frozen: 0 };
    for (const t of bitget36RawTools) {
      counts[bucket(classifyRisk(t, "bitget_agent_hub"))] += 1;
    }
    expect(counts).toEqual({ visible: 32, blocked: 4, frozen: 0 });
  });

  it("hashes to the pinned golden manifest hash (regression anchor)", () => {
    const normalized = bitget36RawTools.map((t) =>
      normalizeToolDefinition(t, identity, { hash: sha256hex }),
    );
    const manifestHash = computeManifestHash(normalized, { hash: sha256hex });
    expect(manifestHash).toBe(bitgetManifestHashV1);
  });
});
