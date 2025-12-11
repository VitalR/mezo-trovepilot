import { Address } from 'viem';
import { PublicClient } from '../clients/mezoClient.js';
import { priceFeedAbi } from '../abis/priceFeedAbi.js';
import { log } from './logging.js';

type LatestRound = {
  roundId: bigint;
  answer: bigint;
  updatedAt: bigint;
} | null;

async function readLatestRound(
  client: PublicClient,
  priceFeed: Address
): Promise<LatestRound> {
  try {
    const [roundId, answer, , updatedAt] = (await client.readContract({
      address: priceFeed,
      abi: priceFeedAbi,
      functionName: 'latestRoundData',
    })) as [bigint, bigint, bigint, bigint, bigint];

    return { roundId, answer, updatedAt };
  } catch (err) {
    log.warn('latestRoundData unavailable; falling back to fetchPrice', err);
    return null;
  }
}

async function readFetchPrice(
  client: PublicClient,
  priceFeed: Address
): Promise<bigint> {
  return (await client.readContract({
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

  const latest = await readLatestRound(client, priceFeed);
  if (latest) {
    price = latest.answer;
    updatedAt = latest.updatedAt;
  } else {
    try {
      price = await readFetchPrice(client, priceFeed);
    } catch (err) {
      log.error('Failed to fetch price', err);
      return null;
    }
  }

  if (price === null) return null;
  if (price <= 0n) {
    log.warn(`Price feed returned non-positive price: ${price.toString()}`);
    return null;
  }

  if (minPrice > 0n && price < minPrice) {
    log.warn(
      `Price ${price.toString()} below MIN_BTC_PRICE ${minPrice.toString()}; skipping run`
    );
    return null;
  }
  if (maxPrice > 0n && price > maxPrice) {
    log.warn(
      `Price ${price.toString()} above MAX_BTC_PRICE ${maxPrice.toString()}; skipping run`
    );
    return null;
  }

  if (maxAgeSeconds > 0 && updatedAt && updatedAt > 0n) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const age = now - updatedAt;
    if (age > BigInt(maxAgeSeconds)) {
      log.warn(
        `Price age ${age}s exceeds MAX_PRICE_AGE_SECONDS=${maxAgeSeconds}; skipping run`
      );
      return null;
    }
  } else if (maxAgeSeconds > 0 && updatedAt === null) {
    log.warn('Price staleness cannot be verified (no updatedAt provided)');
  }

  return price;
}
