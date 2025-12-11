import dotenv from 'dotenv';
import { Address, isAddress } from 'viem';

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const MCR = 1_100_000_000_000_000_000n; // 110% in 1e18

export interface BotConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  troveManager: Address;
  sortedTroves: Address;
  liquidationEngine: Address;
  priceFeed: Address;
  maxTrovesToScan: number;
  maxTrovesPerJob: number;
  earlyExitScanThreshold: number;
  maxPriceAgeSeconds: number;
  minBtcPrice: bigint;
  maxBtcPrice: bigint;
  dryRun: boolean;
}

export function loadConfig(): BotConfig {
  const config: BotConfig = {
    rpcUrl: requireEnv('MEZO_RPC_URL'),
    privateKey: requireEnv('KEEPER_PRIVATE_KEY') as `0x${string}`,
    troveManager: requireEnv('TROVE_MANAGER_ADDRESS') as Address,
    sortedTroves: requireEnv('SORTED_TROVES_ADDRESS') as Address,
    liquidationEngine: requireEnv('LIQUIDATION_ENGINE_ADDRESS') as Address,
    priceFeed: requireEnv('PRICE_FEED_ADDRESS') as Address,
    maxTrovesToScan: Number(process.env.MAX_TROVES_TO_SCAN_PER_RUN ?? '500'),
    maxTrovesPerJob: Number(process.env.MAX_TROVES_PER_JOB ?? '20'),
    earlyExitScanThreshold: Number(
      process.env.EARLY_EXIT_SCAN_THRESHOLD ?? '50'
    ),
    maxPriceAgeSeconds: Number(process.env.MAX_PRICE_AGE_SECONDS ?? '0'),
    minBtcPrice: BigInt(process.env.MIN_BTC_PRICE ?? '0'),
    maxBtcPrice: BigInt(process.env.MAX_BTC_PRICE ?? '0'),
    dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() === 'true',
  };

  validateConfig(config);
  return config;
}

function validateConfig(cfg: BotConfig) {
  const addrs: Array<[string, Address]> = [
    ['TROVE_MANAGER_ADDRESS', cfg.troveManager],
    ['SORTED_TROVES_ADDRESS', cfg.sortedTroves],
    ['LIQUIDATION_ENGINE_ADDRESS', cfg.liquidationEngine],
    ['PRICE_FEED_ADDRESS', cfg.priceFeed],
  ];
  for (const [name, addr] of addrs) {
    if (
      addr === '0x0000000000000000000000000000000000000000' ||
      !isAddress(addr)
    ) {
      throw new Error(`Invalid address for ${name}`);
    }
  }

  if (cfg.maxTrovesToScan <= 0)
    throw new Error('MAX_TROVES_TO_SCAN_PER_RUN must be > 0');
  if (cfg.maxTrovesPerJob <= 0)
    throw new Error('MAX_TROVES_PER_JOB must be > 0');
  if (cfg.maxTrovesPerJob > cfg.maxTrovesToScan) {
    throw new Error(
      'MAX_TROVES_PER_JOB cannot exceed MAX_TROVES_TO_SCAN_PER_RUN'
    );
  }
  if (cfg.earlyExitScanThreshold < 0)
    throw new Error('EARLY_EXIT_SCAN_THRESHOLD must be >= 0');
  if (cfg.maxPriceAgeSeconds < 0)
    throw new Error('MAX_PRICE_AGE_SECONDS must be >= 0');
}
