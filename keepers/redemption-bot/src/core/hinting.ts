import { Address } from 'viem';
import { hintHelpersAbi } from '../abis/hintHelpersAbi.js';
import { sortedTrovesAbi } from '../abis/sortedTrovesAbi.js';
import { PublicClient } from '../clients/mezoClient.js';
import { log } from './logging.js';

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

export type RedemptionHints = {
  firstHint: Address;
  partialNICR: bigint;
  truncatedMusd: bigint;
};

export type SeedSelection = {
  upperSeed: Address;
  lowerSeed: Address;
  derived: boolean;
  scannedTail?: Address[];
};

export type InsertHints = {
  upperHint: Address;
  lowerHint: Address;
};

export type HintBundle = RedemptionHints &
  SeedSelection &
  InsertHints & {
    requestedMusd: bigint;
    priceE18: bigint;
    maxIterations: number;
    /**
     * Whether insert hints were computed via SortedTroves.findInsertPosition().
     * If false (e.g., partialNICR == 0), upperHint/lowerHint will be ZERO.
     */
    insertHintsComputed: boolean;
  };

async function readRedemptionHints(params: {
  client: PublicClient;
  hintHelpers: Address;
  requestedMusd: bigint;
  priceE18: bigint;
  maxIterations: number;
}): Promise<RedemptionHints> {
  const { client, hintHelpers, requestedMusd, priceE18, maxIterations } =
    params;
  const [firstHint, partialNICR, truncated] = (await client.readContract({
    address: hintHelpers,
    abi: hintHelpersAbi,
    functionName: 'getRedemptionHints',
    args: [requestedMusd, priceE18, BigInt(maxIterations)],
  } as const)) as unknown as [Address, bigint, bigint];

  return { firstHint, partialNICR, truncatedMusd: truncated };
}

export async function deriveSeedsFromTail(params: {
  client: PublicClient;
  sortedTroves: Address;
  scanWindow: number;
}): Promise<SeedSelection> {
  const { client, sortedTroves, scanWindow } = params;
  if (scanWindow <= 0) {
    return { upperSeed: ZERO, lowerSeed: ZERO, derived: true, scannedTail: [] };
  }

  const scanned: Address[] = [];
  let current: Address = ZERO;
  try {
    current = (await client.readContract({
      address: sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getLast',
    } as const)) as unknown as Address;
  } catch (err) {
    log.jsonWarnWithError('redeem_seeds_tail_scan_failed', err, {
      component: 'hinting',
      stage: 'getLast',
    });
    return { upperSeed: ZERO, lowerSeed: ZERO, derived: true, scannedTail: [] };
  }

  for (let i = 0; i < scanWindow && current !== ZERO; i++) {
    scanned.push(current);
    try {
      const prev = (await client.readContract({
        address: sortedTroves,
        abi: sortedTrovesAbi,
        functionName: 'getPrev',
        args: [current],
      } as const)) as unknown as Address;
      current = prev;
    } catch (err) {
      log.jsonWarnWithError('redeem_seeds_tail_scan_failed', err, {
        component: 'hinting',
        stage: 'getPrev',
        at: current,
      });
      break;
    }
  }

  const upperSeed = scanned[0] ?? ZERO;
  const lowerSeed = scanned[1] ?? ZERO;
  return { upperSeed, lowerSeed, derived: true, scannedTail: scanned };
}

export async function findInsertHints(params: {
  client: PublicClient;
  sortedTroves: Address;
  partialNICR: bigint;
  upperSeed: Address;
  lowerSeed: Address;
}): Promise<InsertHints> {
  const { client, sortedTroves, partialNICR, upperSeed, lowerSeed } = params;
  const [upperHint, lowerHint] = (await client.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'findInsertPosition',
    args: [partialNICR, upperSeed, lowerSeed],
  } as const)) as unknown as [Address, Address];
  return { upperHint, lowerHint };
}

export async function computeHintBundle(params: {
  client: PublicClient;
  hintHelpers: Address;
  sortedTroves: Address;
  requestedMusd: bigint;
  priceE18: bigint;
  maxIterations: number;
  upperSeed?: Address;
  lowerSeed?: Address;
  seedScanWindow: number;
}): Promise<HintBundle> {
  const {
    client,
    hintHelpers,
    sortedTroves,
    requestedMusd,
    priceE18,
    maxIterations,
    upperSeed: upperSeedOpt,
    lowerSeed: lowerSeedOpt,
    seedScanWindow,
  } = params;

  const { firstHint, partialNICR, truncatedMusd } = await readRedemptionHints({
    client,
    hintHelpers,
    requestedMusd,
    priceE18,
    maxIterations,
  });

  let seeds: SeedSelection;
  if (upperSeedOpt && lowerSeedOpt) {
    seeds = {
      upperSeed: upperSeedOpt,
      lowerSeed: lowerSeedOpt,
      derived: false,
    };
  } else {
    seeds = await deriveSeedsFromTail({
      client,
      sortedTroves,
      scanWindow: seedScanWindow,
    });
  }

  // Hinting safety: if partialNICR == 0, core will not reinsert a partially redeemed trove,
  // so insert hints are unused. Skip the on-chain call for determinism and efficiency.
  let upperHint: Address = ZERO;
  let lowerHint: Address = ZERO;
  let insertHintsComputed = false;
  if (partialNICR !== 0n) {
    const res = await findInsertHints({
      client,
      sortedTroves,
      partialNICR,
      upperSeed: seeds.upperSeed,
      lowerSeed: seeds.lowerSeed,
    });
    upperHint = res.upperHint;
    lowerHint = res.lowerHint;
    insertHintsComputed = true;
  }

  return {
    requestedMusd,
    priceE18,
    maxIterations,
    firstHint,
    partialNICR,
    truncatedMusd,
    upperSeed: seeds.upperSeed,
    lowerSeed: seeds.lowerSeed,
    derived: seeds.derived,
    scannedTail: seeds.scannedTail,
    upperHint,
    lowerHint,
    insertHintsComputed,
  };
}
