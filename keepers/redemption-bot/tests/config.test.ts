import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const REQUIRED_ENV = {
  MEZO_RPC_URL: 'https://rpc.local',
  TROVE_PILOT_ENGINE_ADDRESS: '0x0000000000000000000000000000000000000001',
  HINT_HELPERS_ADDRESS: '0x0000000000000000000000000000000000000002',
  SORTED_TROVES_ADDRESS: '0x0000000000000000000000000000000000000003',
  PRICE_FEED_ADDRESS: '0x0000000000000000000000000000000000000004',
  MUSD_ADDRESS: '0x0000000000000000000000000000000000000005',
};

describe('config parsing semantics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    // Valid 32-byte key (tests should remain robust if buildClients() is used in the future).
    process.env.KEEPER_PRIVATE_KEY =
      '0x0000000000000000000000000000000000000000000000000000000000000001';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('"0" optional caps are treated as disabled/auto', () => {
    process.env.MAX_FEE_PER_GAS = '0';
    process.env.MAX_PRIORITY_FEE_PER_GAS = '0';
    process.env.MAX_NATIVE_SPENT_PER_RUN = '0';
    process.env.MAX_GAS_PER_TX = '0';
    process.env.REDEEM_MAX_CHUNK_MUSD = '0';
    const cfg = loadConfig();
    expect(cfg.maxFeePerGas).toBeUndefined();
    expect(cfg.maxPriorityFeePerGas).toBeUndefined();
    expect(cfg.maxNativeSpentPerRun).toBeUndefined();
    expect(cfg.maxGasPerTx).toBeUndefined();
    expect(cfg.redeemMaxChunkMusd).toBeUndefined();
  });

  it('parses redemption amounts and booleans', () => {
    process.env.REDEEM_MUSD_AMOUNT = '123';
    process.env.REDEEM_MAX_CHUNK_MUSD = '50';
    process.env.STRICT_TRUNCATION = 'true';
    process.env.AUTO_APPROVE = '1';
    process.env.APPROVE_EXACT = 'false';
    const cfg = loadConfig();
    expect(cfg.redeemMusdAmount).toBe(123n);
    expect(cfg.redeemMaxChunkMusd).toBe(50n);
    expect(cfg.strictTruncation).toBe(true);
    expect(cfg.autoApprove).toBe(true);
    expect(cfg.approveExact).toBe(false);
  });

  it('does not require CONFIG_PATH (defaults loading is optional)', () => {
    delete process.env.CONFIG_PATH;
    const cfg = loadConfig();
    expect(cfg.rpcUrl).toBe(REQUIRED_ENV.MEZO_RPC_URL);
  });
});
