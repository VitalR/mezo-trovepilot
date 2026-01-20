// Pure helpers for script (unit-testable).

export function parseDecimalToWei(decimal: string, decimals: number): bigint {
  // Supports forms like "0.01", "1", "1.234".
  const s = decimal.trim();
  if (!s) throw new Error('Empty decimal');
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal: ${decimal}`);
  const [whole, frac = ''] = s.split('.');
  const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  const weiStr = `${whole}${fracPadded}`.replace(/^0+/, '') || '0';
  return BigInt(weiStr);
}

export function formatWeiToDecimal(wei: bigint, decimals: number): string {
  const neg = wei < 0n;
  const v = neg ? -wei : wei;
  const s = v.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

// Compute borrow amount (in 1e18 token units) targeting a specific ICR:
//
// totalDebt = borrowAmount * (1 + feeRate) + gasDeposit
// icr       = (collateralValue) / totalDebt
//
// All values are scaled to 1e18 where applicable:
// - price: 1e18 USD/BTC
// - collateralWei: 1e18 BTC
// - borrow/gasDeposit/totalDebt/collateralValue: 1e18 USD (MUSD)
// - targetIcrE18: 1e18 (e.g., 1.102e18)
// - feeRateE18: 1e18 fraction (e.g., 0.001e18 = 0.1%)
export function computeBorrowAmountWei(params: {
  collateralWei: bigint;
  priceE18: bigint;
  targetIcrE18: bigint;
  gasDepositWei: bigint;
  feeRateE18: bigint;
}): {
  desiredTotalDebtWei: bigint;
  borrowAmountWei: bigint;
  collateralValueWei: bigint;
} {
  const { collateralWei, priceE18, targetIcrE18, gasDepositWei, feeRateE18 } =
    params;
  if (collateralWei <= 0n) throw new Error('collateralWei must be > 0');
  if (priceE18 <= 0n) throw new Error('priceE18 must be > 0');
  if (targetIcrE18 <= 0n) throw new Error('targetIcrE18 must be > 0');
  if (gasDepositWei < 0n) throw new Error('gasDepositWei must be >= 0');
  if (feeRateE18 < 0n) throw new Error('feeRateE18 must be >= 0');

  // collateralValueWei = collateralWei * priceE18 / 1e18
  const collateralValueWei =
    (collateralWei * priceE18) / 1_000_000_000_000_000_000n;

  // desiredTotalDebtWei = collateralValueWei / targetIcr
  const desiredTotalDebtWei =
    (collateralValueWei * 1_000_000_000_000_000_000n) / targetIcrE18;

  if (desiredTotalDebtWei <= gasDepositWei) {
    throw new Error(
      `desiredTotalDebtWei (${desiredTotalDebtWei}) <= gasDepositWei (${gasDepositWei})`
    );
  }

  // borrowAmountWei = (desiredTotalDebt - gasDeposit) / (1 + feeRate)
  const numerator =
    (desiredTotalDebtWei - gasDepositWei) * 1_000_000_000_000_000_000n;
  const denom = 1_000_000_000_000_000_000n + feeRateE18;
  const borrowAmountWei = numerator / denom;

  if (borrowAmountWei <= 0n) throw new Error('Computed borrowAmountWei <= 0');

  return { desiredTotalDebtWei, borrowAmountWei, collateralValueWei };
}

export async function solveDebtAmountForTargetIcr(params: {
  collateralWei: bigint; // 1e18 BTC
  priceE18: bigint; // 1e18 USD/BTC
  targetIcrE18: bigint; // 1e18 ratio
  gasCompensationWei: bigint; // 1e18 MUSD
  getBorrowingFeeWei: (debtAmountWei: bigint) => Promise<bigint>; // 1e18 MUSD
  // Max iterations is a safety cap. If unset, we converge exactly (lo==hi).
  maxIterations?: number;
}): Promise<{
  debtAmountWei: bigint;
  expectedFeeWei: bigint;
  expectedTotalDebtWei: bigint;
  collateralValueWei: bigint;
  targetTotalDebtWei: bigint;
  gasCompensationWei: bigint;
  icrE18: bigint;
  nicrE20: bigint;
}> {
  const {
    collateralWei,
    priceE18,
    targetIcrE18,
    gasCompensationWei,
    getBorrowingFeeWei,
    maxIterations,
  } = params;

  if (collateralWei <= 0n) throw new Error('collateralWei must be > 0');
  if (priceE18 <= 0n) throw new Error('priceE18 must be > 0');
  if (targetIcrE18 <= 0n) throw new Error('targetIcrE18 must be > 0');
  if (gasCompensationWei < 0n)
    throw new Error('gasCompensationWei must be >= 0');
  const maxIters = maxIterations ?? 256;
  if (maxIters <= 0) throw new Error('maxIterations must be > 0');

  const ONE_E18 = 1_000_000_000_000_000_000n;
  const ONE_E20 = 100_000_000_000_000_000_000n;

  const collateralValueWei = (collateralWei * priceE18) / ONE_E18;
  const targetTotalDebtWei = (collateralValueWei * ONE_E18) / targetIcrE18;
  if (targetTotalDebtWei <= gasCompensationWei) {
    throw new Error(
      `targetTotalDebtWei (${targetTotalDebtWei}) <= gasCompensationWei (${gasCompensationWei})`
    );
  }

  // We assume getBorrowingFee(debt) is monotonic (true in Liquity-like designs),
  // so expectedTotalDebt(debt)=debt+fee(debt)+gasComp is monotonic.
  const expectedTotalDebt = async (debtAmountWei: bigint) => {
    const fee = await getBorrowingFeeWei(debtAmountWei);
    if (fee < 0n) throw new Error('getBorrowingFeeWei returned negative');
    return { fee, total: debtAmountWei + fee + gasCompensationWei };
  };

  // Binary search the maximum debt such that expectedTotalDebt <= targetTotalDebt
  // (ICR >= target; slightly safer due to floor rounding).
  let lo = 0n;
  let hi = targetTotalDebtWei; // cannot exceed target even if fee=0 and gasComp=0

  // Ensure hi is valid upper bound. If even hi is within target (unlikely), keep it.
  // But if hi violates, normal search will shrink.

  for (let i = 0; i < maxIters && lo < hi; i++) {
    const mid = (lo + hi + 1n) / 2n;
    const { total } = await expectedTotalDebt(mid);
    if (total <= targetTotalDebtWei) {
      lo = mid;
    } else {
      hi = mid - 1n;
    }
  }

  const debtAmountWei = lo;
  if (debtAmountWei <= 0n) throw new Error('Solved debtAmountWei <= 0');
  const { fee: expectedFeeWei, total: expectedTotalDebtWei } =
    await expectedTotalDebt(debtAmountWei);

  const icrE18 = (collateralValueWei * ONE_E18) / expectedTotalDebtWei;
  const nicrE20 = (collateralWei * ONE_E20) / expectedTotalDebtWei;

  return {
    debtAmountWei,
    expectedFeeWei,
    expectedTotalDebtWei,
    collateralValueWei,
    targetTotalDebtWei,
    // useful for callers
    gasCompensationWei,
    icrE18,
    nicrE20,
  };
}
