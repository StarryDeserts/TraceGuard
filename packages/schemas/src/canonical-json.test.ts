import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("is invariant to input key order", () => {
    const a = canonicalJson({ x: 1, y: 2 });
    const b = canonicalJson({ y: 2, x: 1 });
    expect(a).toBe(b);
  });

  it("drops undefined-valued keys", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("preserves a __proto__ data key", () => {
    const parsed = JSON.parse('{"__proto__":1}');
    expect(canonicalJson(parsed)).toBe('{"__proto__":1}');
  });

  it("keeps null values", () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits decimal strings verbatim", () => {
    expect(canonicalJson({ price: "1.50" })).toBe('{"price":"1.50"}');
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });
});
