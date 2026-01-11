import { describe, expect, it } from 'vitest';
import { buildRedeemPlan } from '../src/core/strategy.js';

const ZERO = '0x0000000000000000000000000000000000000000';
const KEEPER = '0x000000000000000000000000000000000000bEEF';

describe('strategy', () => {
  it('skips when requested amount is 0', () => {
    const plan = buildRedeemPlan({
      requestedMusd: 0n,
      truncatedMusd: 0n,
      maxIterations: 50,
      strictTruncation: false,
      recipient: KEEPER as any,
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? undefined : plan.reason).toBe('NOOP_AMOUNT');
  });

  it('skips when recipient is zero', () => {
    const plan = buildRedeemPlan({
      requestedMusd: 1n,
      truncatedMusd: 1n,
      maxIterations: 50,
      strictTruncation: false,
      recipient: ZERO as any,
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? undefined : plan.reason).toBe('INVALID_RECIPIENT');
  });

  it('skips under strict truncation mismatch', () => {
    const plan = buildRedeemPlan({
      requestedMusd: 100n,
      truncatedMusd: 50n,
      maxIterations: 50,
      strictTruncation: true,
      recipient: KEEPER as any,
    });
    expect(plan.ok).toBe(false);
    expect(plan.ok ? undefined : plan.reason).toBe(
      'STRICT_TRUNCATION_MISMATCH'
    );
  });

  it('applies chunk cap after truncation', () => {
    const plan = buildRedeemPlan({
      requestedMusd: 100n,
      truncatedMusd: 90n,
      maxChunk: 25n,
      maxIterations: 50,
      strictTruncation: false,
      recipient: KEEPER as any,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok ? plan.effectiveMusd : 0n).toBe(25n);
  });

  it('does not apply chunk cap when truncated < maxChunk', () => {
    const plan = buildRedeemPlan({
      requestedMusd: 100n,
      truncatedMusd: 30n,
      maxChunk: 50n,
      maxIterations: 50,
      strictTruncation: false,
      recipient: KEEPER as any,
    });
    expect(plan.ok).toBe(true);
    expect(plan.ok ? plan.effectiveMusd : 0n).toBe(30n);
  });
});
