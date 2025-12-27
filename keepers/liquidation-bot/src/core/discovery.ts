import { Address } from 'viem';
import { PublicClient } from '../clients/mezoClient.js';
import { sortedTrovesAbi } from '../abis/sortedTrovesAbi.js';
import { troveManagerAbi } from '../abis/troveManagerAbi.js';
import { MCR_ICR } from '../config.js';
import { log } from './logging.js';

export interface DiscoveryStats {
  scanned: number;
  liquidatable: number;
  belowMcr: number;
  earlyExit: boolean;
}

export async function getLiquidatableTroves(params: {
  client: PublicClient;
  troveManager: Address;
  sortedTroves: Address;
  price: bigint;
  maxToScan: number;
  earlyExitThreshold: number;
}): Promise<{
  liquidatableBorrowers: Address[];
  totalScanned: bigint;
  totalBelowMcr: bigint;
  stats: DiscoveryStats;
}> {
  const {
    client,
    troveManager,
    sortedTroves,
    price,
    maxToScan,
    earlyExitThreshold,
  } = params;
  const maxScanBig = BigInt(maxToScan);

  const size = (await client.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getSize',
  })) as bigint;

  if (size === 0n) {
    return {
      liquidatableBorrowers: [],
      totalScanned: 0n,
      totalBelowMcr: 0n,
      stats: { scanned: 0, liquidatable: 0, belowMcr: 0, earlyExit: false },
    };
  }

  let current = (await client.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getLast',
  })) as Address;

  const liquidatable: Address[] = [];
  let checked = 0n;
  let belowMcr = 0n;

  let earlyExit = false;

  while (
    current !== '0x0000000000000000000000000000000000000000' &&
    checked < size &&
    checked < maxScanBig
  ) {
    const icr = (await client.readContract({
      address: troveManager,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [current, price],
    })) as bigint;

    if (icr < MCR_ICR) {
      liquidatable.push(current);
      belowMcr += 1n;
    } else if (liquidatable.length > 0) {
      log.jsonInfo('discovery_stop_after_safe', {
        component: 'discovery',
        current,
      });
      checked += 1n;
      break;
    }

    current = (await client.readContract({
      address: sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getPrev',
      args: [current],
    })) as Address;

    checked += 1n;

    if (
      earlyExitThreshold > 0 &&
      checked >= BigInt(earlyExitThreshold) &&
      liquidatable.length === 0
    ) {
      earlyExit = true;
      log.jsonInfo('discovery_early_exit', {
        component: 'discovery',
        scanned: Number(checked),
        liquidatable: liquidatable.length,
        maxScan: Number(maxScanBig),
        threshold: earlyExitThreshold,
      });
      break;
    }
  }

  log.jsonInfo('discovery_summary', {
    component: 'discovery',
    checked: Number(checked),
    liquidatable: liquidatable.length,
    belowMcr: Number(belowMcr),
    earlyExit,
    maxScan: Number(maxScanBig),
  });
  return {
    liquidatableBorrowers: liquidatable,
    totalScanned: checked,
    totalBelowMcr: belowMcr,
    stats: {
      scanned: Number(checked),
      liquidatable: liquidatable.length,
      belowMcr: Number(belowMcr),
      earlyExit,
    },
  };
}
