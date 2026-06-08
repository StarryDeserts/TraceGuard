import type { Condition, DecisionEnvelope, EvaluationContext } from "@traceguard/schemas";

export interface PredicateResult {
  matched: boolean;
  explanation: string;
  expected?: unknown;
  actual?: unknown;
}

type ComparisonOperator = "lt" | "lte" | "eq" | "gte" | "gt";

function toScaledInteger(value: string, scale: number): bigint {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction.padEnd(scale, "0")}`;
  const scaled = BigInt(digits);
  return negative ? -scaled : scaled;
}

export function compareDecimalStrings(a: string, b: string): -1 | 0 | 1 {
  const aFraction = a.split(".")[1] ?? "";
  const bFraction = b.split(".")[1] ?? "";
  const scale = Math.max(aFraction.length, bFraction.length);
  const scaledA = toScaledInteger(a, scale);
  const scaledB = toScaledInteger(b, scale);

  if (scaledA < scaledB) return -1;
  if (scaledA > scaledB) return 1;
  return 0;
}

function compareWithOperator(actual: string, expected: string, operator: ComparisonOperator): boolean {
  const comparison = compareDecimalStrings(actual, expected);
  switch (operator) {
    case "lt":
      return comparison < 0;
    case "lte":
      return comparison <= 0;
    case "eq":
      return comparison === 0;
    case "gte":
      return comparison >= 0;
    case "gt":
      return comparison > 0;
  }
}

function financialResult(
  fieldName: "requestedNotionalUsdt" | "requestedQuantity" | "requestedLeverage",
  operator: ComparisonOperator,
  expected: string,
  actual: string | undefined,
): PredicateResult {
  return {
    matched: actual === undefined ? false : compareWithOperator(actual, expected, operator),
    explanation: `${fieldName} ${operator} ${expected}`,
    expected,
    actual,
  };
}

export function evaluateCondition(
  condition: Condition,
  envelope: DecisionEnvelope,
  context: EvaluationContext,
): PredicateResult {
  switch (condition.kind) {
    case "action_in":
      return {
        matched: condition.values.includes(envelope.action),
        explanation: `action in ${condition.values.join(",")}`,
        expected: condition.values,
        actual: envelope.action,
      };
    case "instrument_in":
      return {
        matched: condition.values.includes(envelope.instrument) && context.instrumentAllowlist.includes(envelope.instrument),
        explanation: `instrument in policy values and context allowlist`,
        expected: { values: condition.values, instrumentAllowlist: context.instrumentAllowlist },
        actual: envelope.instrument,
      };
    case "market_type_in":
      return {
        matched: condition.values.includes(envelope.marketType),
        explanation: `marketType in ${condition.values.join(",")}`,
        expected: condition.values,
        actual: envelope.marketType,
      };
    case "notional_lt":
      return financialResult("requestedNotionalUsdt", "lt", condition.value, envelope.requestedNotionalUsdt);
    case "notional_lte":
      return financialResult("requestedNotionalUsdt", "lte", condition.value, envelope.requestedNotionalUsdt);
    case "notional_eq":
      return financialResult("requestedNotionalUsdt", "eq", condition.value, envelope.requestedNotionalUsdt);
    case "notional_gte":
      return financialResult("requestedNotionalUsdt", "gte", condition.value, envelope.requestedNotionalUsdt);
    case "notional_gt":
      return financialResult("requestedNotionalUsdt", "gt", condition.value, envelope.requestedNotionalUsdt);
    case "quantity_lt":
      return financialResult("requestedQuantity", "lt", condition.value, envelope.requestedQuantity);
    case "quantity_lte":
      return financialResult("requestedQuantity", "lte", condition.value, envelope.requestedQuantity);
    case "quantity_eq":
      return financialResult("requestedQuantity", "eq", condition.value, envelope.requestedQuantity);
    case "quantity_gte":
      return financialResult("requestedQuantity", "gte", condition.value, envelope.requestedQuantity);
    case "quantity_gt":
      return financialResult("requestedQuantity", "gt", condition.value, envelope.requestedQuantity);
    case "leverage_lt":
      return financialResult("requestedLeverage", "lt", condition.value, envelope.requestedLeverage);
    case "leverage_lte":
      return financialResult("requestedLeverage", "lte", condition.value, envelope.requestedLeverage);
    case "leverage_eq":
      return financialResult("requestedLeverage", "eq", condition.value, envelope.requestedLeverage);
    case "leverage_gte":
      return financialResult("requestedLeverage", "gte", condition.value, envelope.requestedLeverage);
    case "leverage_gt":
      return financialResult("requestedLeverage", "gt", condition.value, envelope.requestedLeverage);
    case "workspace_mode_eq":
      return {
        matched: context.workspaceMode === condition.value,
        explanation: `workspaceMode eq ${condition.value}`,
        expected: condition.value,
        actual: context.workspaceMode,
      };
    case "manifest_status_eq":
      return {
        matched: context.manifestStatus === condition.value,
        explanation: `manifestStatus eq ${condition.value}`,
        expected: condition.value,
        actual: context.manifestStatus,
      };
    case "snapshot_age_gt":
      return {
        matched: context.snapshotAgeSeconds > condition.seconds,
        explanation: `snapshotAgeSeconds gt ${condition.seconds}`,
        expected: condition.seconds,
        actual: context.snapshotAgeSeconds,
      };
    case "tool_risk_class_eq":
      return {
        matched: context.toolRiskClass === condition.value,
        explanation: `toolRiskClass eq ${condition.value}`,
        expected: condition.value,
        actual: context.toolRiskClass,
      };
  }
}
