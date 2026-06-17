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

const SAFE_WORKSPACE_ID = /^[A-Za-z0-9_.-]+$/;

export class LedgerStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerStorageError";
  }
}

export class FileLedgerStore implements LedgerStore {
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly dir: string) {}

  private fileFor(workspaceId: string): string {
    if (workspaceId === "." || workspaceId === ".." || !SAFE_WORKSPACE_ID.test(workspaceId)) {
      throw new LedgerStorageError(`unsafe workspaceId for file storage: ${workspaceId}`);
    }
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
    const lines = raw.split("\n").filter((line) => line.length > 0);
    return lines.map((line, i) => {
      try {
        return JSON.parse(line) as LedgerEvent;
      } catch {
        throw new LedgerStorageError(
          `corrupt ledger line ${i + 1} for workspace ${workspaceId}`,
        );
      }
    });
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
