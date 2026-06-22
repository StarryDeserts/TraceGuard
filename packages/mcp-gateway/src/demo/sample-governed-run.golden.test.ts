import { describe, it, expect } from "vitest";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoDocument } from "../bin/gateway-demo.js";

// Resolve the golden from THIS test file's location, not the process cwd:
// src/demo -> src -> mcp-gateway -> packages -> repo root, then into docs/.
const GOLDEN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../docs/superpowers/demo/sample-governed-run.md",
);

describe("deterministic demo golden", () => {
  it("matches the committed sample-governed-run.md (UPDATE_GOLDEN=1 to regenerate)", async () => {
    const { markdown } = await buildDemoDocument({ scenario: "both", mode: "deterministic" });

    if (process.env.UPDATE_GOLDEN === "1") {
      await mkdir(dirname(GOLDEN_PATH), { recursive: true });
      await writeFile(GOLDEN_PATH, markdown, "utf8");
    }

    const golden = await readFile(GOLDEN_PATH, "utf8");
    expect(markdown).toBe(golden);
  });
});
