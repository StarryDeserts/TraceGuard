import { describe, it, expect, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FileLedgerStore, LedgerStorageError } from "./file-ledger-store.js";
import { runLedgerStoreContract, chainOf, idGen } from "./ledger-store-conformance.test.js";

const dirs: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tg-ledger-"));
  dirs.push(dir);
  return dir;
}

async function freshFileStore(): Promise<FileLedgerStore> {
  return new FileLedgerStore(await freshDir());
}

afterAll(async () => {
  for (const dir of dirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe("LedgerStore conformance: FileLedgerStore", () => {
  runLedgerStoreContract(freshFileStore);
});

describe("FileLedgerStore durability", () => {
  it("reads events appended by a previous store instance over the same dir", async () => {
    const dir = await freshDir();
    const writer = new FileLedgerStore(dir);
    const events = chainOf(null, 2, idGen());
    await writer.append(null, events);

    const reader = new FileLedgerStore(dir);
    expect(await reader.head("ws_1")).toBe(events[1]!.eventHash);
    expect(await reader.read("ws_1")).toHaveLength(2);
  });

  it("resumes the chain across a fresh instance using the persisted head", async () => {
    const dir = await freshDir();
    const first = new FileLedgerStore(dir);
    const batch1 = chainOf(null, 2, idGen());
    await first.append(null, batch1);

    const second = new FileLedgerStore(dir);
    const head = await second.head("ws_1");
    const batch2 = chainOf(head, 1, idGen());
    await second.append(head, batch2);

    expect(await second.read("ws_1")).toHaveLength(3);
    expect(await second.head("ws_1")).toBe(batch2[0]!.eventHash);
  });
});

describe("FileLedgerStore filesystem safety", () => {
  it("rejects a workspaceId that could escape the storage directory", async () => {
    const store = await freshFileStore();
    await expect(store.head("../evil")).rejects.toBeInstanceOf(LedgerStorageError);
    await expect(store.head("a/b")).rejects.toBeInstanceOf(LedgerStorageError);
    await expect(store.read("..")).rejects.toBeInstanceOf(LedgerStorageError);
    await expect(store.read(".")).rejects.toBeInstanceOf(LedgerStorageError);
  });

  it("raises LedgerStorageError on a corrupt ledger line", async () => {
    const dir = await freshDir();
    const store = new FileLedgerStore(dir);
    await fs.writeFile(path.join(dir, "ws_1.jsonl"), "{ not valid json\n", "utf8");
    await expect(store.head("ws_1")).rejects.toBeInstanceOf(LedgerStorageError);
    await expect(store.read("ws_1")).rejects.toBeInstanceOf(LedgerStorageError);
  });
});
