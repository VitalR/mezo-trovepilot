import { Address } from 'viem';
import { PublicClient } from '../clients/mezoClient.js';
import { priceFeedAbi } from '../abis/priceFeedAbi.js';
import { log } from './logging.js';

// Prices are expected in 1e18 units (e.g., 60,000 USD => 60000e18).
// MIN_BTC_PRICE / MAX_BTC_PRICE must use the same 1e18 scale.

type LatestRound = {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
} | null;

async function readLatestRound(
  client: PublicClient,
  priceFeed: Address,
  maxAgeSeconds: number
): Promise<LatestRound> {
  try {
    const latest = (await client.readContract({
      address: priceFeed,
      abi: priceFeedAbi,
      functionName: 'latestRoundData',
    } as const)) as unknown as [bigint, bigint, bigint, bigint, bigint];
    const [roundId, answer, , updatedAt] = latest;

    return { roundId, answer, updatedAt };
  } catch (err) {
    if (maxAgeSeconds > 0) {
      log.jsonWarnWithError('price_unverifiable_staleness', err, {
        component: 'price',
        reason: 'latestRoundData_unavailable',
      });
      return null;
    }
    log.jsonInfoWithError(
      'price_latestRoundData_unavailable_fallback_fetchPrice',
      err,
      {
        component: 'price',
        reason: 'latestRoundData_unavailable',
      }
    );
    return null;
  }
}

async function readFetchPrice(
  client: PublicClient,
  priceFeed: Address
): Promise<bigint> {
  // Narrowing the overloads for non-latestRoundData calls is awkward; cast for clarity.
  return (await (client.readContract as any)({
    address: priceFeed,
    abi: priceFeedAbi,
    functionName: 'fetchPrice',
  })) as bigint;
}

export async function getCurrentPrice(params: {
  client: PublicClient;
  priceFeed: Address;
  minPrice: bigint;
  maxPrice: bigint;
  maxAgeSeconds: number;
}): Promise<bigint | null> {
  const { client, priceFeed, minPrice, maxPrice, maxAgeSeconds } = params;

  let price: bigint | null = null;
  let updatedAt: bigint | null = null;

  const latest = await readLatestRound(client, priceFeed, maxAgeSeconds);
  if (latest) {
    price = latest.answer;
    updatedAt = latest.updatedAt;
  } else if (maxAgeSeconds === 0) {
    try {
      price = await readFetchPrice(client, priceFeed);
    } catch (err) {
      log.error('Failed to fetch price', err);
      return null;
    }
  } else {
    return null;
  }

  if (price === null) return null;
  if (price <= 0n) {
    log.jsonWarn('price_out_of_bounds', {
      component: 'price',
      reason: 'NON_POSITIVE',
      price: price.toString(),
    });
    return null;
  }

  if (minPrice > 0n && price < minPrice) {
    log.jsonWarn('price_out_of_bounds', {
      component: 'price',
      reason: 'OUT_OF_BOUNDS_LOW',
      price: price.toString(),
      min: minPrice.toString(),
      max: maxPrice > 0n ? maxPrice.toString() : undefined,
      maxAgeSeconds: maxAgeSeconds || undefined,
      ageSeconds: updatedAt
        ? Number(BigInt(Math.floor(Date.now() / 1000)) - updatedAt)
        : undefined,
    });
    return null;
  }
  if (maxPrice > 0n && price > maxPrice) {
    log.jsonWarn('price_out_of_bounds', {
      component: 'price',
      reason: 'OUT_OF_BOUNDS_HIGH',
      price: price.toString(),
      min: minPrice > 0n ? minPrice.toString() : undefined,
      max: maxPrice.toString(),
      maxAgeSeconds: maxAgeSeconds || undefined,
      ageSeconds: updatedAt
        ? Number(BigInt(Math.floor(Date.now() / 1000)) - updatedAt)
        : undefined,
    });
    return null;
  }

  if (updatedAt !== null && updatedAt === 0n) {
    updatedAt = null;
  }

  if (maxAgeSeconds > 0 && updatedAt && updatedAt > 0n) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const age = now - updatedAt;
    if (age > BigInt(maxAgeSeconds)) {
      log.jsonWarn('price_stale', {
        component: 'price',
        price: price.toString(),
        ageSeconds: Number(age),
        maxAgeSeconds,
        min: minPrice > 0n ? minPrice.toString() : undefined,
        max: maxPrice > 0n ? maxPrice.toString() : undefined,
      });
      return null;
    }
  } else if (maxAgeSeconds > 0 && updatedAt === null) {
    log.jsonWarn('price_unverifiable_staleness', {
      component: 'price',
      reason: 'missing_updatedAt',
    });
    return null;
  }

  return price;
}
