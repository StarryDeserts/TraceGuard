import { describe, it } from "vitest";
import fc from "fast-check";
import { SEVERITY, joinRisk, type Severity } from "./classify.js";

const severityArb = fc.constantFrom<Severity>(...SEVERITY);

describe("joinRisk (property)", () => {
  it("is raise-only: the result is never below either input", () => {
    fc.assert(
      fc.property(severityArb, severityArb, (a, b) => {
        const out = joinRisk(a, b);
        return (
          SEVERITY.indexOf(out) >= SEVERITY.indexOf(a) &&
          SEVERITY.indexOf(out) >= SEVERITY.indexOf(b)
        );
      }),
    );
  });

  it("equals the lattice max of the two inputs", () => {
    fc.assert(
      fc.property(severityArb, severityArb, (a, b) => {
        const out = joinRisk(a, b);
        const expected = SEVERITY.indexOf(a) >= SEVERITY.indexOf(b) ? a : b;
        return out === expected;
      }),
    );
  });

  it("is idempotent and commutative", () => {
    fc.assert(
      fc.property(severityArb, severityArb, (a, b) => {
        return joinRisk(a, a) === a && joinRisk(a, b) === joinRisk(b, a);
      }),
    );
  });
});
