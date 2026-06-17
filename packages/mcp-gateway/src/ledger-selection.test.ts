import { describe, it, expect } from "vitest";
import { InMemoryLedgerStore, FileLedgerStore } from "@traceguard/event-ledger";
import { resolveLedgerStore } from "./ledger-selection.js";

describe("resolveLedgerStore", () => {
  it("returns InMemoryLedgerStore when TRACEGUARD_LEDGER_DIR is unset", () => {
    expect(resolveLedgerStore({})).toBeInstanceOf(InMemoryLedgerStore);
  });

  it("returns InMemoryLedgerStore when TRACEGUARD_LEDGER_DIR is empty", () => {
    expect(resolveLedgerStore({ TRACEGUARD_LEDGER_DIR: "" })).toBeInstanceOf(InMemoryLedgerStore);
  });

  it("returns FileLedgerStore when TRACEGUARD_LEDGER_DIR is set", () => {
    expect(resolveLedgerStore({ TRACEGUARD_LEDGER_DIR: "/tmp/tg" })).toBeInstanceOf(
      FileLedgerStore,
    );
  });
});
