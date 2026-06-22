import type { Clock, IdGen } from "@traceguard/event-ledger";

export const DEFAULT_DEMO_INSTANT = "2026-06-22T00:00:00.000Z";

export function counterIdGen(): IdGen {
  const counters = new Map<string, number>();
  return {
    next(prefix: string): string {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}_${n}`;
    },
  };
}

export function fixedClock(instant: string = DEFAULT_DEMO_INSTANT): Clock {
  return { now: () => instant };
}
