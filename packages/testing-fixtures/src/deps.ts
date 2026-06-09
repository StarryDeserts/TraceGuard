export function fixedClock(instant = "2026-06-08T00:00:00.000Z") {
  return { now: () => instant };
}

export function sequentialIdGen() {
  let n = 0;
  return { next: (prefix: string) => `${prefix}_${String(++n).padStart(6, "0")}` };
}
