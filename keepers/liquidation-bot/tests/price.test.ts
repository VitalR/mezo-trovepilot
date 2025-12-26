import { describe, expect, it } from 'vitest';
import { Address } from 'viem';
import { getCurrentPrice } from '../src/core/price.js';

const FEED = '0xfeed000000000000000000000000000000000000' as Address;
const NOW = Math.floor(Date.now() / 1000);

describe('price freshness policy', () => {
  it('returns null when staleness required and latestRoundData unavailable', async () => {
    const client = {
      readContract: async () => {
        throw new Error('no latestRoundData');
      },
    };

    const res = await getCurrentPrice({
      client: client as any,
      priceFeed: FEED,
      minPrice: 0n,
      maxPrice: 0n,
      maxAgeSeconds: 60,
    });

    expect(res).toBeNull();
  });

  it('uses fetchPrice when staleness not required', async () => {
    const client = {
      readContract: async (opts: any) => {
        if (opts.functionName === 'latestRoundData') {
          throw new Error('no latestRoundData');
        }
        if (opts.functionName === 'fetchPrice') {
          return 100_000n;
        }
        throw new Error('unexpected');
      },
    };

    const res = await getCurrentPrice({
      client: client as any,
      priceFeed: FEED,
      minPrice: 0n,
      maxPrice: 0n,
      maxAgeSeconds: 0,
    });

    expect(res).toBe(100_000n);
  });

  it('rejects stale price when updatedAt too old', async () => {
    const client = {
      readContract: async (opts: any) => {
        if (opts.functionName === 'latestRoundData') {
          return [1n, 200_000n, 0n, BigInt(NOW - 1_000), 0n];
        }
        throw new Error('unexpected');
      },
    };

    const res = await getCurrentPrice({
      client: client as any,
      priceFeed: FEED,
      minPrice: 0n,
      maxPrice: 0n,
      maxAgeSeconds: 100,
    });

    expect(res).toBeNull();
  });
});

