import { describe, expect, it, vi } from 'vitest';
import { computeHintBundle, deriveSeedsFromTail } from '../src/core/hinting.js';
import { log } from '../src/core/logging.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const addr = (n: number) => `0x${n.toString(16)}`.padEnd(42, '0');

describe('hinting', () => {
  it('scanWindow=0 => ZERO seeds and empty scannedTail', async () => {
    const readContract = vi.fn();
    const res = await deriveSeedsFromTail({
      client: { readContract } as any,
      sortedTroves: addr(999) as any,
      scanWindow: 0,
    });
    expect(res.upperSeed).toBe(ZERO);
    expect(res.lowerSeed).toBe(ZERO);
    expect(res.scannedTail).toEqual([]);
  });

  it('getLast failure => ZERO seeds + warning log', async () => {
    const readContract = vi.fn().mockRejectedValueOnce(new Error('boom'));
    const spy = vi.spyOn(log, 'jsonWarnWithError').mockImplementation(() => {});
    const res = await deriveSeedsFromTail({
      client: { readContract } as any,
      sortedTroves: addr(999) as any,
      scanWindow: 10,
    });
    expect(res.upperSeed).toBe(ZERO);
    expect(res.lowerSeed).toBe(ZERO);
    expect(res.scannedTail).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('derives seeds from tail (getLast/getPrev window)', async () => {
    const readContract = vi.fn();
    // getLast -> addr(3), getPrev(addr(3)) -> addr(2), getPrev(addr(2)) -> addr(1), getPrev(addr(1)) -> ZERO
    readContract
      .mockResolvedValueOnce(addr(3))
      .mockResolvedValueOnce(addr(2))
      .mockResolvedValueOnce(addr(1))
      .mockResolvedValueOnce(ZERO);

    const res = await deriveSeedsFromTail({
      client: { readContract } as any,
      sortedTroves: addr(999) as any,
      scanWindow: 10,
    });

    expect(res.derived).toBe(true);
    expect(res.upperSeed).toBe(addr(3));
    expect(res.lowerSeed).toBe(addr(2));
    expect(res.scannedTail).toEqual([addr(3), addr(2), addr(1)]);
  });

  it('getPrev failure mid-scan => partial scannedTail', async () => {
    const readContract = vi.fn();
    readContract
      .mockResolvedValueOnce(addr(3)) // getLast
      .mockRejectedValueOnce(new Error('prev fail')); // getPrev(addr(3))
    const spy = vi.spyOn(log, 'jsonWarnWithError').mockImplementation(() => {});
    const res = await deriveSeedsFromTail({
      client: { readContract } as any,
      sortedTroves: addr(999) as any,
      scanWindow: 10,
    });
    expect(res.scannedTail).toEqual([addr(3)]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('uses operator-provided seeds when both are set', async () => {
    const readContract = vi.fn();
    // getRedemptionHints
    readContract.mockResolvedValueOnce([addr(11), 123n, 50n]);
    // findInsertPosition
    readContract.mockResolvedValueOnce([addr(21), addr(22)]);

    const bundle = await computeHintBundle({
      client: { readContract } as any,
      hintHelpers: addr(101) as any,
      sortedTroves: addr(102) as any,
      requestedMusd: 100n,
      priceE18: 1_000n,
      maxIterations: 50,
      upperSeed: addr(1) as any,
      lowerSeed: addr(2) as any,
      seedScanWindow: 10,
    });

    expect(bundle.firstHint).toBe(addr(11));
    expect(bundle.partialNICR).toBe(123n);
    expect(bundle.truncatedMusd).toBe(50n);
    expect(bundle.derived).toBe(false);
    expect(bundle.upperSeed).toBe(addr(1));
    expect(bundle.lowerSeed).toBe(addr(2));
    expect(bundle.upperHint).toBe(addr(21));
    expect(bundle.lowerHint).toBe(addr(22));
    expect(bundle.insertHintsComputed).toBe(true);
  });

  it('partialNICR==0 => skip findInsertPosition and return ZERO insert hints', async () => {
    const readContract = vi.fn();
    // getRedemptionHints => partialNICR 0
    readContract.mockResolvedValueOnce([addr(11), 0n, 50n]);

    const bundle = await computeHintBundle({
      client: { readContract } as any,
      hintHelpers: addr(101) as any,
      sortedTroves: addr(102) as any,
      requestedMusd: 100n,
      priceE18: 1_000n,
      maxIterations: 50,
      upperSeed: addr(1) as any,
      lowerSeed: addr(2) as any,
      seedScanWindow: 10,
    });

    expect(bundle.partialNICR).toBe(0n);
    expect(bundle.upperHint).toBe(ZERO);
    expect(bundle.lowerHint).toBe(ZERO);
    expect(bundle.insertHintsComputed).toBe(false);
    // Only getRedemptionHints should be called.
    expect(readContract).toHaveBeenCalledTimes(1);
  });
});
