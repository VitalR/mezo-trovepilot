import { describe, expect, it } from 'vitest';
import { Address } from 'viem';
import {
  getLiquidatableTroves,
  DiscoveryStats,
} from '../src/core/discovery.js';

// Simple in-memory mock client implementing readContract
function makeMockClient(
  icrMap: Record<Address, bigint>,
  prevMap: Record<Address, Address>,
  last: Address,
  size: bigint,
  visited: Address[] = []
) {
  return {
    async readContract(opts: {
      address: Address;
      abi: unknown;
      functionName: string;
      args?: any[];
    }) {
      if (opts.functionName === 'getSize') return size;
      if (opts.functionName === 'getLast') return last;
      if (opts.functionName === 'getPrev') {
        const [cur] = opts.args ?? [];
        visited.push(cur as Address);
        return (
          prevMap[cur as Address] ??
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

describe('discovery tail scan and early exit', () => {
  it('scans from tail and captures risky borrower near the end quickly', async () => {
    const safeHead = '0x1' as Address;
    const safeMid = '0x2' as Address;
    const riskyTail = '0x3' as Address;

    const icrMap = {
      [safeHead]: 1_300_000_000_000_000_000n,
      [safeMid]: 1_250_000_000_000_000_000n,
      [riskyTail]: 900_000_000_000_000_000n, // below MCR, sits at tail
    };
    const prevMap = {
      [riskyTail]: safeMid,
      [safeMid]: safeHead,
      [safeHead]: ZERO,
    };
    const visited: Address[] = [];
    const client = makeMockClient(icrMap, prevMap, riskyTail, 3n, visited);
    const res = await getLiquidatableTroves({
      client: client as any,
      troveManager: ZERO,
      sortedTroves: ZERO,
      price: 0n,
      maxToScan: 3,
      earlyExitThreshold: 2,
    });

    expect(res.liquidatableBorrowers).toEqual([riskyTail]);
    expect(res.totalScanned).toBe(3n);
    expect(res.totalBelowMcr).toBe(1n);
    expect((res.stats as DiscoveryStats).earlyExit).toBe(false);
    expect(visited).toEqual([riskyTail, safeMid, safeHead]); // walk tail -> head
  });

  it('early exits when threshold reached and none liquidatable (tail first)', async () => {
    const a = '0x1' as Address;
    const b = '0x2' as Address;
    const icrMap = {
      [a]: 1_200_000_000_000_000_000n,
      [b]: 1_300_000_000_000_000_000n,
    };
    const prevMap = { [b]: a, [a]: ZERO };
    const client = makeMockClient(icrMap, prevMap, b, 2n);
    const res = await getLiquidatableTroves({
      client: client as any,
      troveManager: ZERO,
      sortedTroves: ZERO,
      price: 0n,
      maxToScan: 10,
      earlyExitThreshold: 1,
    });
    expect(res.liquidatableBorrowers).toEqual([]);
    expect(res.totalScanned).toBe(1n);
    expect((res.stats as DiscoveryStats).earlyExit).toBe(true);
  });

  it('respects maxToScan while scanning tail to head', async () => {
    const a = '0x1' as Address;
    const b = '0x2' as Address;
    const c = '0x3' as Address;
    const d = '0x4' as Address;
    const icrMap = {
      [a]: 800_000_000_000_000_000n,
      [b]: 1_200_000_000_000_000_000n,
      [c]: 700_000_000_000_000_000n,
      [d]: 1_400_000_000_000_000_000n,
    };
    const prevMap = { [d]: c, [c]: b, [b]: a, [a]: ZERO };
    const client = makeMockClient(icrMap, prevMap, d, 4n);
    const res = await getLiquidatableTroves({
      client: client as any,
      troveManager: ZERO,
      sortedTroves: ZERO,
      price: 0n,
      maxToScan: 2,
      earlyExitThreshold: 0,
    });
    expect(res.liquidatableBorrowers).toEqual([c]);
    expect(res.totalScanned).toBe(2n);
    expect(res.totalBelowMcr).toBe(1n);
  });
});
