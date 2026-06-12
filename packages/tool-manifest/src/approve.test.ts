import { describe, expect, it } from "vitest";
import { fixedClock, sequentialIdGen } from "@traceguard/testing-fixtures";
import { approveToolManifest, type ApproveDeps } from "./approve.js";

function deps(): ApproveDeps {
  return { clock: fixedClock(), newId: sequentialIdGen() };
}

describe("approveToolManifest", () => {
  it("emits a user-authored ToolManifestApproved event", () => {
    const event = approveToolManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        toolManifestVersionId: "tmv_1",
        manifestHash: "h:approved",
        approvedBy: "user_42",
      },
      deps(),
    );

    expect(event.eventType).toBe("ToolManifestApproved");
    expect(event.aggregateType).toBe("tool_manifest");
    expect(event.aggregateId).toBe("tmv_1");
    expect(event.actorType).toBe("user");
    expect(event.actorId).toBe("user_42");
  });

  it("stamps approvedAt from the injected clock", () => {
    const event = approveToolManifest(
      {
        workspaceId: "ws_1",
        providerConnectionId: "pc_1",
        toolManifestVersionId: "tmv_1",
        manifestHash: "h:approved",
        approvedBy: "user_42",
      },
      deps(),
    );

    expect((event.payload as { approvedAt: string }).approvedAt).toBe(
      "2026-06-08T00:00:00.000Z",
    );
  });
});
