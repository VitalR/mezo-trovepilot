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
  maxTroves?: bigint;
}): Promise<Address[]> {
  const { client, troveManager, sortedTroves, price } = params;
  const maxTroves = params.maxTroves ?? 500n;

  const size = (await client.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getSize',
  })) as bigint;

  if (size === 0n) return [];

  let current = (await client.readContract({
    address: sortedTroves,
    abi: sortedTrovesAbi,
    functionName: 'getFirst',
  })) as Address;

  const liquidatable: Address[] = [];
  let checked = 0n;

  while (
    current !== '0x0000000000000000000000000000000000000000' &&
    checked < size &&
    checked < maxTroves
  ) {
    const icr = (await client.readContract({
      address: troveManager,
      abi: troveManagerAbi,
      functionName: 'getCurrentICR',
      args: [current, price],
    })) as bigint;

    if (icr < MCR) {
      liquidatable.push(current);
    }

    current = (await client.readContract({
      address: sortedTroves,
      abi: sortedTrovesAbi,
      functionName: 'getNext',
      args: [current],
    })) as Address;

    checked += 1n;
  }

  log.info(`Discovery checked=${checked} liquidatable=${liquidatable.length}`);
  return liquidatable;
}
