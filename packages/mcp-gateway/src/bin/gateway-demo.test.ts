import { describe, it, expect } from "vitest";
import {
  parseDemoArgs,
  resolveOutPath,
  buildDemoDocument,
  DEFAULT_GOLDEN_PATH,
  DEFAULT_LIVE_PATH,
} from "./gateway-demo.js";

describe("parseDemoArgs", () => {
  it("defaults to both/deterministic", () => {
    expect(parseDemoArgs([])).toEqual({ scenario: "both", mode: "deterministic" });
  });

  it("parses scenario, mode, and out flags", () => {
    expect(parseDemoArgs(["--scenario", "happy", "--mode", "live", "--out", "x.md"])).toEqual({
      scenario: "happy",
      mode: "live",
      out: "x.md",
    });
  });

  it("ignores unrecognized flag values", () => {
    expect(parseDemoArgs(["--scenario", "bogus"])).toEqual({ scenario: "both", mode: "deterministic" });
  });
});

describe("resolveOutPath", () => {
  it("uses the committed golden path for deterministic mode", () => {
    expect(resolveOutPath({ scenario: "both", mode: "deterministic" })).toBe(DEFAULT_GOLDEN_PATH);
  });

  it("uses the gitignored live path for live mode", () => {
    expect(resolveOutPath({ scenario: "both", mode: "live" })).toBe(DEFAULT_LIVE_PATH);
  });

  it("prefers an explicit --out over the defaults", () => {
    expect(resolveOutPath({ scenario: "happy", mode: "live", out: "custom.md" })).toBe("custom.md");
  });
});

describe("buildDemoDocument (deterministic)", () => {
  it("renders both scenario sections without spawning a live upstream", async () => {
    const { markdown, lines } = await buildDemoDocument({ scenario: "both", mode: "deterministic" });
    expect(markdown).toContain("Happy path — approval granted, paper order placed");
    expect(markdown).toContain("Fail-closed — approval denied, nothing reaches the exchange");
    expect(lines).toContain("Happy path — approval granted, paper order placed");
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
