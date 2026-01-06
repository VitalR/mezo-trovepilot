import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { Address, isAddress } from 'viem';
import { log } from './core/logging.js';

dotenv.config();

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

// Mezo MCR (ICR threshold) in 1e18 units. Keep in sync with protocol.
export const MCR_ICR = 1_100_000_000_000_000_000n; // 110% in 1e18

export interface BotConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  unlockedRpcUrl?: string;
  keeperAddress?: Address;
  minKeeperBalanceWei?: bigint;
  troveManager: Address;
  sortedTroves: Address;
  liquidationEngine: Address;
  priceFeed: Address;
  maxTxRetries: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  maxNativeSpentPerRun?: bigint;
  maxGasPerJob?: bigint;
  gasBufferPct: number;
  maxTrovesToScan: number;
  maxTrovesPerJob: number;
  earlyExitScanThreshold: number;
  maxPriceAgeSeconds: number;
  minBtcPrice: bigint;
  maxBtcPrice: bigint;
  dryRun: boolean;
}

export function loadConfig(): BotConfig {
  const defaults = loadAddressDefaults();

  const parseOptionalBigIntEnv = (name: string): bigint | undefined => {
    const raw = process.env[name];
    if (!raw || raw === '0') return undefined;
    const v = BigInt(raw);
    return v === 0n ? undefined : v;
  };

  const parseOptionalNumberEnv = (name: string): number | undefined => {
    const raw = process.env[name];
    if (raw === undefined || raw === '' || raw === '0') return undefined;
    return Number(raw);
  };

  const config: BotConfig = {
    rpcUrl: requireEnv('MEZO_RPC_URL'),
    privateKey: (process.env.KEEPER_PRIVATE_KEY ?? '') as `0x${string}`,
    unlockedRpcUrl: process.env.UNLOCKED_RPC_URL,
    keeperAddress: process.env.KEEPER_ADDRESS as Address | undefined,
    minKeeperBalanceWei: parseOptionalBigIntEnv('MIN_KEEPER_BALANCE_WEI'),
    troveManager: (process.env.TROVE_MANAGER_ADDRESS ??
      defaults.troveManager ??
      requireEnv('TROVE_MANAGER_ADDRESS')) as Address,
    sortedTroves: (process.env.SORTED_TROVES_ADDRESS ??
      defaults.sortedTroves ??
      requireEnv('SORTED_TROVES_ADDRESS')) as Address,
    liquidationEngine: (process.env.LIQUIDATION_ENGINE_ADDRESS ??
      defaults.liquidationEngine ??
      requireEnv('LIQUIDATION_ENGINE_ADDRESS')) as Address,
    priceFeed: (process.env.PRICE_FEED_ADDRESS ??
      defaults.priceFeed ??
      requireEnv('PRICE_FEED_ADDRESS')) as Address,
    maxTxRetries: Number(process.env.MAX_TX_RETRIES ?? '2'),
    maxFeePerGas: parseOptionalBigIntEnv('MAX_FEE_PER_GAS'),
    maxPriorityFeePerGas: parseOptionalBigIntEnv('MAX_PRIORITY_FEE_PER_GAS'),
    maxNativeSpentPerRun: parseOptionalBigIntEnv('MAX_NATIVE_SPENT_PER_RUN'),
    maxGasPerJob: parseOptionalBigIntEnv('MAX_GAS_PER_JOB'),
    gasBufferPct: Number(process.env.GAS_BUFFER_PCT ?? '20'),
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

type AddressDefaults = Partial<{
  troveManager: Address;
  sortedTroves: Address;
  liquidationEngine: Address;
  priceFeed: Address;
}>;

function loadAddressDefaults(): AddressDefaults {
  const configPath = process.env.CONFIG_PATH;
  const rawNetwork = process.env.NETWORK ?? 'mezo-testnet';
  // Backwards/ergonomic aliases (docs/scripts often say "testnet").
  const network =
    rawNetwork === 'testnet'
      ? 'mezo-testnet'
      : rawNetwork === 'mainnet'
      ? 'mezo'
      : rawNetwork;
  if (!configPath) return {};

  try {
    const resolved = path.resolve(process.cwd(), configPath);
    const raw = fs.readFileSync(resolved, 'utf8');
    const json = JSON.parse(raw);
    if (!json || json.network !== network) {
      log.warn(
        `CONFIG_PATH loaded but network mismatch or missing (expected ${network}, got ${String(
          json?.network
        )})`
      );
      return {};
    }
    const mezo = json.mezo ?? {};
    const trovePilot = json.trovePilot ?? {};
    const core = mezo.core ?? {};
    const price = mezo.price ?? {};
    return {
      troveManager: core.troveManager,
      sortedTroves: core.sortedTroves,
      priceFeed: price.priceFeed,
      liquidationEngine: trovePilot.liquidationEngine,
    };
  } catch (err) {
    log.warn(`Failed to load CONFIG_PATH ${configPath}: ${String(err)}`);
    return {};
  }
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

  if (
    cfg.minBtcPrice > 0n &&
    cfg.maxBtcPrice > 0n &&
    cfg.minBtcPrice > cfg.maxBtcPrice
  ) {
    throw new Error('MIN_BTC_PRICE cannot be greater than MAX_BTC_PRICE');
  }

  if (cfg.maxPriceAgeSeconds > 0 && cfg.maxPriceAgeSeconds < 5) {
    log.warn(
      `MAX_PRICE_AGE_SECONDS is very low (${cfg.maxPriceAgeSeconds}); may reject fresh prices`
    );
  }

  if (cfg.maxTxRetries < 0) throw new Error('MAX_TX_RETRIES must be >= 0');
  const gasBounds = [
    cfg.minKeeperBalanceWei,
    cfg.maxFeePerGas,
    cfg.maxPriorityFeePerGas,
    cfg.maxNativeSpentPerRun,
    cfg.maxGasPerJob,
  ];
  for (const bound of gasBounds) {
    if (bound !== undefined && bound < 0n) {
      throw new Error('Gas/fee bounds must be non-negative');
    }
  }
  if (cfg.gasBufferPct < 0 || cfg.gasBufferPct > 500) {
    throw new Error('GAS_BUFFER_PCT must be between 0 and 500');
  }

  // Signer validation
  const hasExt = Boolean(cfg.unlockedRpcUrl);
  const hasPk = cfg.privateKey && cfg.privateKey.length > 2;
  if (!hasExt && !hasPk) {
    if (cfg.dryRun) {
      log.warn(
        'DRY_RUN enabled and no signer configured; running in read-only mode (no transactions can be sent)'
      );
      return;
    }
    throw new Error(
      'Provide either KEEPER_PRIVATE_KEY or UNLOCKED_RPC_URL + KEEPER_ADDRESS'
    );
  }
  if (hasExt) {
    if (!cfg.keeperAddress) {
      throw new Error('KEEPER_ADDRESS is required when using UNLOCKED_RPC_URL');
    }
    if (hasPk) {
      log.warn(
        'Both KEEPER_PRIVATE_KEY and UNLOCKED_RPC_URL provided; defaulting to local private key signer. Clear KEEPER_PRIVATE_KEY to force unlocked RPC usage.'
      );
    }
  }
}
