import { Address } from 'viem';

export interface LiquidationJob {
  borrowers: Address[];
  fallbackOnFail: boolean;
  /**
   * If true, caller intends this job to be executed as a single batch tx when
   * `borrowers.length > 1`. Executor should not silently downselect to a single.
   *
   * Note: global default can still be provided via `executeLiquidationJob({ preferBatch })`.
   */
  preferBatch?: boolean;
}

export function buildLiquidationJobs(params: {
  liquidatable: Address[];
  maxPerJob: number;
  enableFallback?: boolean;
}): LiquidationJob[] {
  const { liquidatable, maxPerJob } = params;
  const enableFallback = params.enableFallback ?? true;
  const jobs: LiquidationJob[] = [];

  for (let i = 0; i < liquidatable.length; i += maxPerJob) {
    const chunk = liquidatable.slice(i, i + maxPerJob);
    jobs.push({
      borrowers: chunk,
      fallbackOnFail: enableFallback,
    });
  }

  return jobs;
}
