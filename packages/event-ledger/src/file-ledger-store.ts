import { promises as fs } from "node:fs";
import path from "node:path";
import type { LedgerEvent } from "@traceguard/schemas";
import { canonicalJson } from "./canonical-json.js";
import {
  type LedgerStore,
  LedgerConflictError,
  LedgerChainError,
  verifyChain,
} from "./ledger-store.js";

export class FileLedgerStore implements LedgerStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private fileFor(workspaceId: string): string {
    return path.join(this.dir, `${workspaceId}.jsonl`);
  }

  // Serialize the read-head→write window per workspace so two concurrent
  // appends at the same head cannot both pass the optimistic-concurrency
  // check and fork the chain. In-process only (one gateway owns the dir).
  private withLock<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(workspaceId) ?? Promise.resolve();
    const next = prior.then(fn, fn);
    this.locks.set(
      workspaceId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async readEvents(workspaceId: string): Promise<LedgerEvent[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.fileFor(workspaceId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return raw
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LedgerEvent);
  }

  async head(workspaceId: string): Promise<string | null> {
    const events = await this.readEvents(workspaceId);
    if (events.length === 0) return null;
    return events[events.length - 1]!.eventHash;
  }

  async read(workspaceId: string, runId?: string): Promise<LedgerEvent[]> {
    const events = await this.readEvents(workspaceId);
    return runId === undefined ? events : events.filter((e) => e.runId === runId);
  }

  async append(expectedHead: string | null, events: LedgerEvent[]): Promise<void> {
    if (events.length === 0) return;
    const workspaceId = events[0]!.workspaceId;
    for (const e of events) {
      if (e.workspaceId !== workspaceId) {
        throw new LedgerChainError("all events in a batch must share one workspaceId");
      }
    }
    return this.withLock(workspaceId, async () => {
      const existing = await this.readEvents(workspaceId);
      const currentHead =
        existing.length === 0 ? null : existing[existing.length - 1]!.eventHash;
      if (currentHead !== expectedHead) {
        throw new LedgerConflictError(expectedHead, currentHead);
      }
      verifyChain(events, currentHead);

      const payload = events.map((e) => canonicalJson(e)).join("\n") + "\n";
      await fs.mkdir(this.dir, { recursive: true });
      const handle = await fs.open(this.fileFor(workspaceId), "a");
      try {
        await handle.appendFile(payload, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    });
  }
}
