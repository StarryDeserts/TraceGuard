import { randomUUID } from "node:crypto";
import type { Clock, IdGen } from "./clock-id.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class SystemIdGen implements IdGen {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}
