import {
  InMemoryLedgerStore,
  FileLedgerStore,
  type LedgerStore,
} from "@traceguard/event-ledger";

/**
 * Choose the ledger backing store from the environment. Default (no
 * TRACEGUARD_LEDGER_DIR) keeps the in-memory store, so existing behavior is
 * unchanged; setting the var to a directory makes the ledger durable.
 */
export function resolveLedgerStore(env: NodeJS.ProcessEnv): LedgerStore {
  const dir = env.TRACEGUARD_LEDGER_DIR;
  return dir ? new FileLedgerStore(dir) : new InMemoryLedgerStore();
}
