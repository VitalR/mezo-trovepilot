import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../src/config.js';

const REQUIRED_ENV = {
  MEZO_RPC_URL: 'https://rpc.local',
  TROVE_MANAGER_ADDRESS: '0x0000000000000000000000000000000000000001',
  SORTED_TROVES_ADDRESS: '0x0000000000000000000000000000000000000002',
  LIQUIDATION_ENGINE_ADDRESS: '0x0000000000000000000000000000000000000003',
  PRICE_FEED_ADDRESS: '0x0000000000000000000000000000000000000004',
};

describe('config parsing semantics', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    process.env.KEEPER_PRIVATE_KEY = '0xabc123';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('"0" optional caps are treated as disabled/auto', () => {
    process.env.MAX_FEE_PER_GAS = '0';
    process.env.MAX_PRIORITY_FEE_PER_GAS = '0';
    process.env.MAX_NATIVE_SPENT_PER_RUN = '0';
    process.env.MAX_GAS_PER_JOB = '0';
    const cfg = loadConfig();
    expect(cfg.maxFeePerGas).toBeUndefined();
    expect(cfg.maxPriorityFeePerGas).toBeUndefined();
    expect(cfg.maxNativeSpentPerRun).toBeUndefined();
    expect(cfg.maxGasPerJob).toBeUndefined();
  });

  it('blank optional caps are treated as disabled/auto', () => {
    process.env.MAX_FEE_PER_GAS = '';
    process.env.MAX_PRIORITY_FEE_PER_GAS = '';
    process.env.MAX_NATIVE_SPENT_PER_RUN = '';
    process.env.MAX_GAS_PER_JOB = '';
    const cfg = loadConfig();
    expect(cfg.maxFeePerGas).toBeUndefined();
    expect(cfg.maxPriorityFeePerGas).toBeUndefined();
    expect(cfg.maxNativeSpentPerRun).toBeUndefined();
    expect(cfg.maxGasPerJob).toBeUndefined();
  });

  it('parses optional caps when provided', () => {
    process.env.MAX_FEE_PER_GAS = '10';
    process.env.MAX_PRIORITY_FEE_PER_GAS = '2';
    process.env.MAX_NATIVE_SPENT_PER_RUN = '100';
    process.env.MAX_GAS_PER_JOB = '500000';
    const cfg = loadConfig();
    expect(cfg.maxFeePerGas).toBe(10n);
    expect(cfg.maxPriorityFeePerGas).toBe(2n);
    expect(cfg.maxNativeSpentPerRun).toBe(100n);
    expect(cfg.maxGasPerJob).toBe(500000n);
  });
});
