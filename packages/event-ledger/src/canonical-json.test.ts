import { describe, it, expect } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it("is invariant to input key order", () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });
  it("drops undefined values", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });
  it("keeps null and preserves array order", () => {
    expect(canonicalJson({ a: null, xs: [3, 1, 2] })).toBe('{"a":null,"xs":[3,1,2]}');
  });
  it("preserves decimal strings verbatim", () => {
    expect(canonicalJson({ n: "300.50" })).toBe('{"n":"300.50"}');
  });
  it("emits no insignificant whitespace", () => {
    expect(canonicalJson({ a: 1 })).not.toContain(" ");
  });
  it("throws on non-finite numbers", () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow();
    expect(() => canonicalJson({ x: Number.POSITIVE_INFINITY })).toThrow();
  });
});
