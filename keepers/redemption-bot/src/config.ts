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

function parseOptionalAddressEnv(name: string): Address | undefined {
  const raw = process.env[name];
  if (!raw || raw === '0') return undefined;
  if (!isAddress(raw)) return undefined;
  if (raw === '0x0000000000000000000000000000000000000000') return undefined;
  return raw as Address;
}

function parseOptionalBigIntEnv(name: string): bigint | undefined {
  const raw = process.env[name];
  if (!raw || raw === '0') return undefined;
  const v = BigInt(raw);
  return v === 0n ? undefined : v;
}

function parseOptionalNumberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '' || raw === '0') return undefined;
  return Number(raw);
}

function parseBoolEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw.toLowerCase() === 'true' || raw === '1';
}

export interface BotConfig {
  rpcUrl: string;
  privateKey: `0x${string}`;
  unlockedRpcUrl?: string;
  keeperAddress?: Address;

  minKeeperBalanceWei?: bigint;
  maxTxRetries: number;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  maxNativeSpentPerRun?: bigint;
  maxGasPerTx?: bigint;
  gasBufferPct: number;
  dryRun: boolean;

  // Addresses
  trovePilotEngine: Address;
  hintHelpers: Address;
  sortedTroves: Address;
  priceFeed: Address;
  musd: Address;

  // Price controls
  maxPriceAgeSeconds: number;
  minBtcPrice: bigint;
  maxBtcPrice: bigint;

  // Redemption strategy (operator-driven MVP)
  redeemMusdAmount: bigint;
  redeemMaxChunkMusd?: bigint;
  maxIterations: number;
  strictTruncation: boolean;

  // Insert position seeds
  upperSeed?: Address;
  lowerSeed?: Address;
  seedScanWindow: number;

  // Allowance/approval behavior
  autoApprove: boolean;
  approveExact: boolean;
}

type AddressDefaults = Partial<{
  trovePilotEngine: Address;
  hintHelpers: Address;
  sortedTroves: Address;
  priceFeed: Address;
  musd: Address;
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
    const tokens = mezo.tokens ?? {};
    return {
      hintHelpers: core.hintHelpers,
      sortedTroves: core.sortedTroves,
      priceFeed: price.priceFeed,
      musd: tokens.musd,
      trovePilotEngine:
        trovePilot.trovePilotEngine ?? trovePilot.liquidationEngine,
    };
  } catch (err) {
    log.warn(`Failed to load CONFIG_PATH ${configPath}: ${String(err)}`);
    return {};
  }
}

function validateConfig(cfg: BotConfig) {
  const addrs: Array<[string, Address]> = [
    ['TROVE_PILOT_ENGINE_ADDRESS', cfg.trovePilotEngine],
    ['HINT_HELPERS_ADDRESS', cfg.hintHelpers],
    ['SORTED_TROVES_ADDRESS', cfg.sortedTroves],
    ['PRICE_FEED_ADDRESS', cfg.priceFeed],
    ['MUSD_ADDRESS', cfg.musd],
  ];
  for (const [name, addr] of addrs) {
    if (
      addr === '0x0000000000000000000000000000000000000000' ||
      !isAddress(addr)
    ) {
      throw new Error(`Invalid address for ${name}`);
    }
  }

  if (cfg.maxTxRetries < 0) throw new Error('MAX_TX_RETRIES must be >= 0');
  if (cfg.gasBufferPct < 0 || cfg.gasBufferPct > 500) {
    throw new Error('GAS_BUFFER_PCT must be between 0 and 500');
  }
  if (cfg.maxIterations < 0) throw new Error('MAX_ITERATIONS must be >= 0');
  if (cfg.seedScanWindow < 0) throw new Error('SEED_SCAN_WINDOW must be >= 0');

  if (
    cfg.minBtcPrice > 0n &&
    cfg.maxBtcPrice > 0n &&
    cfg.minBtcPrice > cfg.maxBtcPrice
  ) {
    throw new Error('MIN_BTC_PRICE cannot be greater than MAX_BTC_PRICE');
  }
  if (cfg.maxPriceAgeSeconds < 0)
    throw new Error('MAX_PRICE_AGE_SECONDS must be >= 0');

  const gasBounds = [
    cfg.minKeeperBalanceWei,
    cfg.maxFeePerGas,
    cfg.maxPriorityFeePerGas,
    cfg.maxNativeSpentPerRun,
    cfg.maxGasPerTx,
  ];
  for (const bound of gasBounds) {
    if (bound !== undefined && bound < 0n) {
      throw new Error('Gas/fee bounds must be non-negative');
    }
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

export function loadConfig(): BotConfig {
  const defaults = loadAddressDefaults();

  const cfg: BotConfig = {
    rpcUrl: requireEnv('MEZO_RPC_URL'),
    privateKey: (process.env.KEEPER_PRIVATE_KEY ?? '') as `0x${string}`,
    unlockedRpcUrl: process.env.UNLOCKED_RPC_URL,
    keeperAddress: process.env.KEEPER_ADDRESS as Address | undefined,

    minKeeperBalanceWei: parseOptionalBigIntEnv('MIN_KEEPER_BALANCE_WEI'),
    maxTxRetries: Number(process.env.MAX_TX_RETRIES ?? '2'),
    maxFeePerGas: parseOptionalBigIntEnv('MAX_FEE_PER_GAS'),
    maxPriorityFeePerGas: parseOptionalBigIntEnv('MAX_PRIORITY_FEE_PER_GAS'),
    maxNativeSpentPerRun: parseOptionalBigIntEnv('MAX_NATIVE_SPENT_PER_RUN'),
    maxGasPerTx: parseOptionalBigIntEnv('MAX_GAS_PER_TX'),
    gasBufferPct: Number(process.env.GAS_BUFFER_PCT ?? '20'),
    dryRun: parseBoolEnv('DRY_RUN', true),

    trovePilotEngine: (parseOptionalAddressEnv('TROVE_PILOT_ENGINE_ADDRESS') ??
      defaults.trovePilotEngine ??
      (requireEnv('TROVE_PILOT_ENGINE_ADDRESS') as Address)) as Address,
    hintHelpers: (parseOptionalAddressEnv('HINT_HELPERS_ADDRESS') ??
      defaults.hintHelpers ??
      (requireEnv('HINT_HELPERS_ADDRESS') as Address)) as Address,
    sortedTroves: (parseOptionalAddressEnv('SORTED_TROVES_ADDRESS') ??
      defaults.sortedTroves ??
      (requireEnv('SORTED_TROVES_ADDRESS') as Address)) as Address,
    priceFeed: (parseOptionalAddressEnv('PRICE_FEED_ADDRESS') ??
      defaults.priceFeed ??
      (requireEnv('PRICE_FEED_ADDRESS') as Address)) as Address,
    musd: (parseOptionalAddressEnv('MUSD_ADDRESS') ??
      defaults.musd ??
      (requireEnv('MUSD_ADDRESS') as Address)) as Address,

    maxPriceAgeSeconds: Number(process.env.MAX_PRICE_AGE_SECONDS ?? '0'),
    minBtcPrice: BigInt(process.env.MIN_BTC_PRICE ?? '0'),
    maxBtcPrice: BigInt(process.env.MAX_BTC_PRICE ?? '0'),

    redeemMusdAmount: BigInt(process.env.REDEEM_MUSD_AMOUNT ?? '0'),
    redeemMaxChunkMusd: parseOptionalBigIntEnv('REDEEM_MAX_CHUNK_MUSD'),
    maxIterations: Number(process.env.MAX_ITERATIONS ?? '50'),
    strictTruncation: parseBoolEnv('STRICT_TRUNCATION', false),

    upperSeed: parseOptionalAddressEnv('UPPER_SEED'),
    lowerSeed: parseOptionalAddressEnv('LOWER_SEED'),
    seedScanWindow: Number(process.env.SEED_SCAN_WINDOW ?? '10'),

    autoApprove: parseBoolEnv('AUTO_APPROVE', false),
    approveExact: parseBoolEnv('APPROVE_EXACT', true),
  };

  validateConfig(cfg);
  return cfg;
}
