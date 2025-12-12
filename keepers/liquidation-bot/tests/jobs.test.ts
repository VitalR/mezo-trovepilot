import { describe, expect, it } from 'vitest';
import { Address } from 'viem';
import { buildLiquidationJobs } from '../src/core/jobs.js';

const a = '0x1' as Address;
const b = '0x2' as Address;
const c = '0x3' as Address;
const d = '0x4' as Address;

describe('job chunking', () => {
  it('chunks exact multiple', () => {
    const jobs = buildLiquidationJobs({
      liquidatable: [a, b, c, d],
      maxPerJob: 2,
      enableFallback: true,
    });
    expect(jobs.length).toBe(2);
    expect(jobs[0].borrowers).toEqual([a, b]);
    expect(jobs[1].borrowers).toEqual([c, d]);
    expect(jobs.every((j) => j.fallbackOnFail)).toBe(true);
  });

  it('chunks remainder', () => {
    const jobs = buildLiquidationJobs({
      liquidatable: [a, b, c],
      maxPerJob: 2,
      enableFallback: false,
    });
    expect(jobs.length).toBe(2);
    expect(jobs[0].borrowers).toEqual([a, b]);
    expect(jobs[1].borrowers).toEqual([c]);
    expect(jobs.every((j) => j.fallbackOnFail === false)).toBe(true);
  });

  it('handles small list', () => {
    const jobs = buildLiquidationJobs({
      liquidatable: [a],
      maxPerJob: 3,
      enableFallback: true,
    });
    expect(jobs.length).toBe(1);
    expect(jobs[0].borrowers).toEqual([a]);
  });

  it('handles empty list', () => {
    const jobs = buildLiquidationJobs({
      liquidatable: [],
      maxPerJob: 3,
      enableFallback: true,
    });
    expect(jobs.length).toBe(0);
  });
});
