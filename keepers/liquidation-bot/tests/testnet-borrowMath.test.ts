import { describe, expect, it } from 'vitest';
import {
  parseDecimalToWei,
  solveDebtAmountForTargetIcr,
} from '../scripts/testnet/borrowMath.js';

describe('testnet borrow math', () => {
  it('solves debtAmount using a monotonic on-chain-style fee function', async () => {
    const collateralWei = parseDecimalToWei('0.01', 18); // 0.01 BTC
    const priceE18 = parseDecimalToWei('60000', 18); // 60k USD/BTC
    const targetIcrE18 = parseDecimalToWei('1.102', 18);
    const gasCompWei = parseDecimalToWei('200', 18);

    // Fee is 0.1% of debt (floor).
    const getBorrowingFeeWei = async (debt: bigint) => debt / 1000n;

    const res = await solveDebtAmountForTargetIcr({
      collateralWei,
      priceE18,
      targetIcrE18,
      gasCompensationWei: gasCompWei,
      getBorrowingFeeWei,
    });

    expect(res.expectedTotalDebtWei).toBeLessThanOrEqual(
      res.targetTotalDebtWei
    );
    expect(res.icrE18).toBeGreaterThanOrEqual(targetIcrE18);

    // Minimality: debt+1 should typically exceed the target.
    const feeNext = await getBorrowingFeeWei(res.debtAmountWei + 1n);
    const totalNext = res.debtAmountWei + 1n + feeNext + gasCompWei;
    expect(totalNext).toBeGreaterThan(res.targetTotalDebtWei);
  });

  it('supports non-linear but monotonic fee functions', async () => {
    const collateralWei = parseDecimalToWei('0.03', 18);
    const priceE18 = parseDecimalToWei('50000', 18);
    const targetIcrE18 = parseDecimalToWei('1.102', 18);
    const gasCompWei = parseDecimalToWei('200', 18);

    // Piecewise monotonic fee: max(0.1%, 10 MUSD).
    const minFee = parseDecimalToWei('10', 18);
    const getBorrowingFeeWei = async (debt: bigint) => {
      const pct = debt / 1000n;
      return pct > minFee ? pct : minFee;
    };

    const res = await solveDebtAmountForTargetIcr({
      collateralWei,
      priceE18,
      targetIcrE18,
      gasCompensationWei: gasCompWei,
      getBorrowingFeeWei,
    });

    expect(res.expectedTotalDebtWei).toBeLessThanOrEqual(
      res.targetTotalDebtWei
    );
    expect(res.icrE18).toBeGreaterThanOrEqual(targetIcrE18);
  });
});
