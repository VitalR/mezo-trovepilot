import { Address } from 'viem';
import { PublicClient } from '../clients/mezoClient.js';
import { sortedTrovesAbi } from '../abis/sortedTrovesAbi.js';
import { troveManagerAbi } from '../abis/troveManagerAbi.js';
import { MCR } from '../config.js';
import { log } from './logging.js';

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
    return { liquidatableBorrowers: [], totalScanned: 0n, totalBelowMcr: 0n };
  }

  let current = (await client.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getFirst',
  })) as Address;

  const liquidatable: Address[] = [];
  let checked = 0n;
  let belowMcr = 0n;

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

    if (icr < MCR) {
      liquidatable.push(current);
      belowMcr += 1n;
    }

    current = (await client.readContract({
      address: sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getNext',
      args: [current],
    })) as Address;

    checked += 1n;

    if (
      earlyExitThreshold > 0 &&
      checked >= BigInt(earlyExitThreshold) &&
      liquidatable.length === 0
    ) {
      log.info(`Early-exit: scanned ${checked} troves, none below MCR`);
      break;
    }
  }

  log.info(
    `Discovery checked=${checked} liquidatable=${liquidatable.length} belowMCR=${belowMcr}`
  );
  return {
    liquidatableBorrowers: liquidatable,
    totalScanned: checked,
    totalBelowMcr: belowMcr,
  };
}
