import { describe, it, expect } from "vitest";
import {
  redactResult,
  normalizeKey,
  AGENT_CREDENTIAL_PROFILE,
} from "./result-redaction.js";

describe("normalizeKey", () => {
  it("lowercases and strips underscores and dashes", () => {
    expect(normalizeKey("API_KEY")).toBe("apikey");
    expect(normalizeKey("api-key")).toBe("apikey");
    expect(normalizeKey("ApiKey")).toBe("apikey");
  });
});

describe("redactResult", () => {
  const P = AGENT_CREDENTIAL_PROFILE;

  it("redacts a top-level apiKey", () => {
    expect(redactResult({ apiKey: "live-123" }, P)).toEqual({ apiKey: "[REDACTED]" });
  });

  it("redacts every profile key across naming variants", () => {
    const input = {
      api_key: "a",
      secretKey: "b",
      passphrase: "c",
      Authorization: "Bearer x",
      "private-key": "d",
      credential: "e",
      credentialRef: "f",
    };
    expect(redactResult(input, P)).toEqual({
      api_key: "[REDACTED]",
      secretKey: "[REDACTED]",
      passphrase: "[REDACTED]",
      Authorization: "[REDACTED]",
      "private-key": "[REDACTED]",
      credential: "[REDACTED]",
      credentialRef: "[REDACTED]",
    });
  });

  it("redacts the expanded exchange-credential keys (secret/apiSecret/signature/etc.)", () => {
    const input = {
      secret: "a",
      apiSecret: "b",
      api_secret: "c",
      signature: "d",
      sign: "e",
      mnemonic: "f",
      seed: "g",
      seedPhrase: "h",
      privKey: "i",
      wsToken: "j",
      listenKey: "k",
    };
    expect(redactResult(input, P)).toEqual({
      secret: "[REDACTED]",
      apiSecret: "[REDACTED]",
      api_secret: "[REDACTED]",
      signature: "[REDACTED]",
      sign: "[REDACTED]",
      mnemonic: "[REDACTED]",
      seed: "[REDACTED]",
      seedPhrase: "[REDACTED]",
      privKey: "[REDACTED]",
      wsToken: "[REDACTED]",
      listenKey: "[REDACTED]",
    });
  });

  it("redacts nested and array-embedded secrets at any depth", () => {
    const input = {
      data: { account: { apiKey: "x" } },
      keys: [{ secretKey: "y" }, { secretKey: "z" }],
    };
    expect(redactResult(input, P)).toEqual({
      data: { account: { apiKey: "[REDACTED]" } },
      keys: [{ secretKey: "[REDACTED]" }, { secretKey: "[REDACTED]" }],
    });
  });

  it("leaves non-sensitive fields untouched (balance/positions/token)", () => {
    const input = { balance: "100", positions: [{ size: 1 }], token: "BTC" };
    expect(redactResult(input, P)).toEqual(input);
  });

  it("does not mutate the input", () => {
    const input = { apiKey: "x", nested: { secretKey: "y" } };
    const snapshot = structuredClone(input);
    redactResult(input, P);
    expect(input).toEqual(snapshot);
  });

  it("passes primitives, null, and undefined through unchanged", () => {
    expect(redactResult("hello", P)).toBe("hello");
    expect(redactResult(42, P)).toBe(42);
    expect(redactResult(null, P)).toBe(null);
    expect(redactResult(undefined, P)).toBe(undefined);
  });

  it("walks a CallToolResult-shaped object including structuredContent", () => {
    const result = {
      content: [{ type: "text", text: "ok" }],
      structuredContent: { credential: "secret", balance: "5" },
      isError: false,
    };
    expect(redactResult(result, P)).toEqual({
      content: [{ type: "text", text: "ok" }],
      structuredContent: { credential: "[REDACTED]", balance: "5" },
      isError: false,
    });
  });
});
