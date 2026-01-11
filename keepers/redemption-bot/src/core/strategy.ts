import { Address } from 'viem';

export type RedeemPlan =
  | {
      ok: true;
      requestedMusd: bigint;
      truncatedMusd: bigint;
      effectiveMusd: bigint;
      maxIterations: number;
      recipient: Address;
      strictTruncation: boolean;
      maxChunk?: bigint;
    }
  | {
      ok: false;
      reason:
        | 'NOOP_AMOUNT'
        | 'TRUNCATED_TO_ZERO'
        | 'STRICT_TRUNCATION_MISMATCH'
        | 'INVALID_RECIPIENT';
      requestedMusd: bigint;
      truncatedMusd?: bigint;
      maxIterations: number;
      recipient?: Address;
      strictTruncation: boolean;
      maxChunk?: bigint;
    };

export function buildRedeemPlan(params: {
  requestedMusd: bigint;
  truncatedMusd: bigint;
  maxChunk?: bigint;
  maxIterations: number;
  strictTruncation: boolean;
  recipient: Address;
}): RedeemPlan {
  const {
    requestedMusd,
    truncatedMusd,
    maxChunk,
    maxIterations,
    strictTruncation,
    recipient,
  } = params;

  if (
    !recipient ||
    recipient === ('0x0000000000000000000000000000000000000000' as Address)
  ) {
    return {
      ok: false,
      reason: 'INVALID_RECIPIENT',
      requestedMusd,
      truncatedMusd,
      maxIterations,
      strictTruncation,
      maxChunk,
    };
  }

  if (requestedMusd === 0n) {
    return {
      ok: false,
      reason: 'NOOP_AMOUNT',
      requestedMusd,
      truncatedMusd,
      maxIterations,
      recipient,
      strictTruncation,
      maxChunk,
    };
  }

  if (truncatedMusd === 0n) {
    return {
      ok: false,
      reason: 'TRUNCATED_TO_ZERO',
      requestedMusd,
      truncatedMusd,
      maxIterations,
      recipient,
      strictTruncation,
      maxChunk,
    };
  }

  if (strictTruncation && truncatedMusd !== requestedMusd) {
    return {
      ok: false,
      reason: 'STRICT_TRUNCATION_MISMATCH',
      requestedMusd,
      truncatedMusd,
      maxIterations,
      recipient,
      strictTruncation,
      maxChunk,
    };
  }

  const effectivePreChunk = truncatedMusd;
  const effectiveMusd =
    maxChunk && maxChunk > 0n && effectivePreChunk > maxChunk
      ? maxChunk
      : effectivePreChunk;

  if (effectiveMusd === 0n) {
    return {
      ok: false,
      reason: 'TRUNCATED_TO_ZERO',
      requestedMusd,
      truncatedMusd,
      maxIterations,
      recipient,
      strictTruncation,
      maxChunk,
    };
  }

  return {
    ok: true,
    requestedMusd,
    truncatedMusd,
    effectiveMusd,
    maxIterations,
    recipient,
    strictTruncation,
    maxChunk,
  };
}
