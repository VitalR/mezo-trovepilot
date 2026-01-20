import { describe, expect, it } from 'vitest';
import {
  loadAddressBook,
  buildPublicClient,
  requireEnv,
  assertTestnet,
} from '../../scripts/testnet/_lib.js';

// Optional live check: skipped unless explicitly enabled.
describe('integration (live testnet) - guarded', () => {
  it('loads address book and matches RPC chainId (no txs)', async () => {
    const runLive =
      (process.env.RUN_LIVE_TESTNET ?? '').toLowerCase() === 'true';
    const confirm =
      (process.env.CONFIRM ?? '').toLowerCase() === 'true' ||
      (process.env.CONFIRM ?? '') === '1';
    if (!runLive || !confirm) {
      // Skipped by default to keep unit tests always-on and deterministic.
      return;
    }

    const book = loadAddressBook();
    const rpcUrl = requireEnv('MEZO_RPC_URL');
    const client = buildPublicClient(rpcUrl);

    await assertTestnet(client, book);
    const chainId = await client.getChainId();
    expect(chainId).toBe(book.chainId);
  });
});
