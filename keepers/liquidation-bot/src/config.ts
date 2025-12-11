import dotenv from 'dotenv';
import { Address } from 'viem';

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
  maxTroves: bigint;
  maxPerJob: number;
  dryRun: boolean;
  staticBtcPrice: bigint;
}

export function loadConfig(): BotConfig {
  return {
    rpcUrl: requireEnv('MEZO_RPC_URL'),
    privateKey: requireEnv('KEEPER_PRIVATE_KEY') as `0x${string}`,
    troveManager: requireEnv('TROVE_MANAGER_ADDRESS') as Address,
    sortedTroves: requireEnv('SORTED_TROVES_ADDRESS') as Address,
    liquidationEngine: requireEnv('LIQUIDATION_ENGINE_ADDRESS') as Address,
    maxTroves: BigInt(process.env.MAX_TROVES ?? '500'),
    maxPerJob: Number(process.env.MAX_PER_JOB ?? '20'),
    dryRun: (process.env.DRY_RUN ?? 'true').toLowerCase() === 'true',
    staticBtcPrice: BigInt(process.env.STATIC_BTC_PRICE ?? '0'),
  };
}
