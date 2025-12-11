**Keeper Hardening Checklist for TrovePilot**
---

## 1. Core correctness & safety (on-chain + bot)

1. **Finalize contract layer (you’re almost there):**

   * LiquidationEngine:

     * Deterministic `liquidateRange(borrowers, fallbackOnFail)`.
     * Reward forwarding (native BTC delta) to `msg.sender`.
     * Owner-only `sweep` as emergency escape.
   * RedemptionRouter:

     * `redeemQuick` (Option A).
     * `redeemHinted` (Option B with strict `musdAmount == truncated`).

2. **Bot correctness (MVP):**

   * Implement `getLiquidatableTroves()` using Mezo docs / SortedTroves.
   * Implement basic `buildLiquidationJobs()` (chunking).
   * Implement `executeLiquidationJob()` with:

     * `fallbackOnFail` flag wired to config.
     * Clear logging of attempted vs succeeded.

3. **Basic guardrails:**

   * `dryRun` mode (no transactions).
   * Explicit “max borrowers per batch”, “max gas per tx” in config.
   * Clear rejection on missing env (private key, RPC, addresses).

---

## 2. Observability & runtime robustness

4. **Structured logging (beyond console.log):**

   * Add a small logger wrapper with:

     * Levels: `DEBUG / INFO / WARN / ERROR`.
     * Structured context: `{ jobId, block, attempted, succeeded }`.
   * Make logs greppable and machine-readable.

5. **Error handling & backoff:**

   * Wrap main loop in try–catch.
   * On RPC errors:

     * exponential backoff (e.g., 2s → 4s → 8s up to a max).
   * On transaction failure:

     * log reason,
     * mark job as failed, but don’t crash the process.

6. **Health indicators:**

   * Periodic “heartbeat” log every N minutes:

     * last block processed,
     * number of jobs attempted,
     * last error (if any).

---

## 3. State & idempotency

7. **Lightweight state tracking (even just file/JSON at first):**

   * Track:

     * last processed block,
     * recently liquidated troves (e.g. sliding window),
     * last successful jobId.
   * Use this to avoid:

     * re-sending identical jobs,
     * hammering already-cleared troves.

8. **Job de-duplication:**

   * When building new jobs:

     * filter out troves recently liquidated (using state storage).
   * Optional: “cooldown” per trove (e.g. do not re-attempt for X blocks).

---

## 4. Profitability & risk filters

9. **Cost / reward estimation:**

   * Estimate:

     * gas cost (gas price * estimated gas),
     * minimum liquidation reward (per Mezo docs).
   * Skip jobs where:

     * estimated reward < gas cost * safety factor.

10. **Priority ordering:**

* Sort liquidatable troves by:

  * expected reward,
  * risk (how far below threshold).
* Prefer jobs with:

  * higher reward,
  * lower risk of borderline-collateral.

---

## 5. Price & oracle alignment

11. **Use correct price feed:**

* Read price from the **same source** TroveManager uses (or as close as possible per Mezo docs).
* Verify:

  * price freshness,
  * no obvious anomalies (e.g. > X% jump vs previous sample).

12. **Consistency checks:**

* Before sending a job:

  * re-check that troves are still liquidatable at the current price.
* Abort job build if:

  * price changed too much since discovery.

---

## 6. Key management & infra

13. **Safer key handling:**

* Move from plain private key in `.env` to:

  * OS-level secrets,
  * or a simple remote signer (e.g., a local HSM / hardware wallet integration) if possible.

14. **Process supervision:**

* Run bot under:

  * `pm2`, `systemd`, or Docker + restart policy.
* Configure:

  * resource limits (CPU, memory),
  * restarts on crash.

---

## 7. Testing & simulation

15. **Unit tests (bot side):**

* For `getLiquidatableTroves()` (using mocks / fork).
* For `buildLiquidationJobs()` (correct chunking).
* For safety filters (profitability, max size).

16. **Mainnet-fork or testnet simulation:**

* Run liquidation bot on a fork:

  * read actual Mezo state,
  * simulate jobs without actually sending txs.
* Validate:

  * no unexpected reverts,
  * job sizes and gas usage are sane.

---

## 8. “Production polish”

17. **Metrics & alerts (optional but ideal):**

* Expose metrics via:

  * Prometheus / HTTP endpoint (jobs succeeded, failed, gas used).
* Set up alerts for:

  * no jobs executed for X hours,
  * repeated tx failures,
  * RPC outages.

18. **Config profiles:**

* Support multiple profiles:

  * `dev`, `testnet`, `mezo-mainnet`.
* Each with:

  * specific RPCs,
  * conservative vs aggressive strategies.
