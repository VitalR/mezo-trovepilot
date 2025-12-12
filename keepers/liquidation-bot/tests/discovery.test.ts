import { describe, expect, it } from 'vitest';
import { Address } from 'viem';
import {
  getLiquidatableTroves,
  DiscoveryStats,
} from '../src/core/discovery.js';

// Simple in-memory mock client implementing readContract
function makeMockClient(
  icrMap: Record<Address, bigint>,
  nextMap: Record<Address, Address>,
  size: bigint
) {
  return {
    async readContract(opts: {
      address: Address;
      abi: unknown;
      functionName: string;
      args?: any[];
    }) {
      if (opts.functionName === 'getSize') return size;
      if (opts.functionName === 'getFirst')
        return Object.keys(nextMap)[0] as Address;
      if (opts.functionName === 'getNext') {
        const [cur] = opts.args ?? [];
        return (
          nextMap[cur as Address] ??
          ('0x0000000000000000000000000000000000000000' as Address)
        );
      }
      if (opts.functionName === 'getCurrentICR') {
        const [addr] = opts.args ?? [];
        return icrMap[addr as Address] ?? 0n;
      }
      throw new Error(`unexpected function ${opts.functionName}`);
    },
  };
}

const ZERO = '0x0000000000000000000000000000000000000000' as Address;

describe('discovery caps and early exit', () => {
  it('respects maxToScan and returns stats', async () => {
    const a = '0x1' as Address;
    const b = '0x2' as Address;
    const c = '0x3' as Address;
    const icrMap = {
      [a]: 900_000_000_000_000_000n, // below MCR
      [b]: 1_200_000_000_000_000_000n,
      [c]: 900_000_000_000_000_000n, // below MCR
    };
    const nextMap = {
      [a]: b,
      [b]: c,
      [c]: ZERO,
    };
    const client = makeMockClient(icrMap, nextMap, 3n);
    const res = await getLiquidatableTroves({
      client: client as any,
      troveManager: ZERO,
      sortedTroves: ZERO,
      price: 0n,
      maxToScan: 2,
      earlyExitThreshold: 0,
    });
    expect(res.liquidatableBorrowers).toEqual([a]);
    expect(res.totalScanned).toBe(2n);
    expect(res.totalBelowMcr).toBe(1n);
    expect((res.stats as DiscoveryStats).earlyExit).toBe(false);
  });

  it('early exits when threshold reached and none liquidatable', async () => {
    const a = '0x1' as Address;
    const b = '0x2' as Address;
    const icrMap = {
      [a]: 1_200_000_000_000_000_000n,
      [b]: 1_300_000_000_000_000_000n,
    };
    const nextMap = { [a]: b, [b]: ZERO };
    const client = makeMockClient(icrMap, nextMap, 2n);
    const res = await getLiquidatableTroves({
      client: client as any,
      troveManager: ZERO,
      sortedTroves: ZERO,
      price: 0n,
      maxToScan: 10,
      earlyExitThreshold: 2,
    });
    expect(res.liquidatableBorrowers).toEqual([]);
    expect(res.totalScanned).toBe(2n);
    expect((res.stats as DiscoveryStats).earlyExit).toBe(true);
  });
});
