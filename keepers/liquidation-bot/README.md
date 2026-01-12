## Liquidation Keeper (TrovePilot v2)

Minimal off-chain bot that discovers undercollateralized troves on Mezo and executes liquidations via the unified TrovePilot `TrovePilotEngine`.

### Setup

1. Install deps

```
cd keepers/liquidation-bot
npm install
```

2. Copy `env.example` to `.env` and fill in:

- `MEZO_RPC_URL` — Mezo RPC endpoint
- `KEEPER_PRIVATE_KEY` — hex private key for the executor (default/dev path; keep balance small)
- Optional unlocked signer (only if the node supports `eth_sendTransaction` with an unlocked account):
  - `UNLOCKED_RPC_URL`
  - `KEEPER_ADDRESS`
- Optional gas controls: `MAX_TX_RETRIES`, `MAX_FEE_PER_GAS`, `MAX_PRIORITY_FEE_PER_GAS`, `MAX_NATIVE_SPENT_PER_RUN`, `MAX_GAS_PER_JOB`, `GAS_BUFFER_PCT`
  - Set to blank or `0` to disable caps/overrides (auto fee estimation via `estimateFeesPerGas` is used when unset).
- Optional balance safety: `MIN_KEEPER_BALANCE_WEI` (skip txs if keeper balance is too low)
- `TROVE_MANAGER_ADDRESS`, `SORTED_TROVES_ADDRESS`, `TROVE_PILOT_ENGINE_ADDRESS`, `PRICE_FEED_ADDRESS`
- Deprecated alias: `LIQUIDATION_ENGINE_ADDRESS` (kept for older deployments/configs)
- Optional discovery/price bounds: `MAX_TROVES_TO_SCAN_PER_RUN`, `MAX_TROVES_PER_JOB`, `EARLY_EXIT_SCAN_THRESHOLD`, `MIN_BTC_PRICE`, `MAX_BTC_PRICE`, `MAX_PRICE_AGE_SECONDS`
- Optional: `DRY_RUN`

### How it works

- Config / signer: loads env (optionally from `CONFIG_PATH`/`NETWORK`), validates bounds. Default signer is a small hot key via `KEEPER_PRIVATE_KEY`. Optional unlocked RPC path (`UNLOCKED_RPC_URL` + `KEEPER_ADDRESS`) is used only when the node supports `eth_sendTransaction` and no private key is provided.
- Price: reads price feed in 1e18 units, enforces min/max bounds, and optional staleness. If `MAX_PRICE_AGE_SECONDS > 0` and `updatedAt` is unavailable or stale, the bot skips the run (fail closed). Fallback to `fetchPrice` only when staleness is not required; price feed errors log as JSON `warn` (staleness required) or `info` (fallback path) with error payloads.
- Discovery: scans `SortedTroves` from the tail (risky end) using `getLast` then `getPrev`, up to `MAX_TROVES_TO_SCAN_PER_RUN`. Early-exits if `EARLY_EXIT_SCAN_THRESHOLD` is hit with no liquidatables, and stops once it finds a safe trove after any liquidatable (tail segment property). Uses `MCR_ICR = 1.1e18`.
- Jobs: chunks liquidatable borrowers into batches of `MAX_TROVES_PER_JOB`.
- Execution: applies a gas buffer (`GAS_BUFFER_PCT`), enforces `MAX_GAS_PER_JOB` by shrinking batches (and re-queuing suffix leftovers), re-estimates gas **and refreshes fees** on first retry, and enforces `MAX_NATIVE_SPENT_PER_RUN`plus optional `MIN_KEEPER_BALANCE_WEI` preflight. By default (`PREFER_BATCH_LIQUIDATION=false`), the bot submits `TrovePilotEngine.liquidateSingle(borrower, keeper)` for maximum robustness (processing at most one borrower per job and re-queuing the suffix). If `PREFER_BATCH_LIQUIDATION=true`, it submits `TrovePilotEngine.liquidateBatch(borrowers, keeper)` for multi-borrower jobs; if batch estimation reverts and fallback is enabled, it shrinks the batch until it can estimate or skips the job. Fee resolution is: config override (EIP-1559) → `estimateFeesPerGas` (EIP-1559) → `getGasPrice` fallback (legacy). If spend cap is enabled and fees are unknown, the job is skipped as `FEE_UNAVAILABLE`. Structured JSON logs cover plan/shrink/skip, `tx_error`, `retry_scheduled`, `tx_sent`, `tx_confirmed`, and `requeue`.
- The bot always sets `recipient = keeper address` so any gas compensation is forwarded back to the operator.

### Run

Dry run (no txs):

```
DRY_RUN=true npm start
```

Live mode (sends txs):

```
DRY_RUN=false npm start
```

### Tests

Run unit tests (discovery, chunking, gas-cap behavior):

```
npm test
```

### Testnet scripts

Scripts live under `scripts/testnet/` and are **safe by default**:

- They refuse to run unless `NETWORK` looks like a testnet and the RPC `chainId` matches `CONFIG_PATH`.
- They default to `DRY_RUN=true` and require `CONFIRM=true` to send transactions.

#### Required env

- `MEZO_RPC_URL` — Mezo RPC endpoint (testnet)
- `NETWORK` — must include `testnet` (recommended: `mezo-testnet`)
- `CONFIG_PATH` — address book JSON (recommended: `../../configs/addresses.testnet.json` when running from this package)

Optional address overrides (use only if deployments moved; still gated by testnet + chainId):

- `BORROWER_OPERATIONS_ADDRESS`
- `HINT_HELPERS_ADDRESS`
- `SORTED_TROVES_ADDRESS`
- `TROVE_MANAGER_ADDRESS`
- `PRICE_FEED_ADDRESS`
- `TROVE_PILOT_ENGINE_ADDRESS` (TrovePilotEngine)
- Deprecated alias: `LIQUIDATION_ENGINE_ADDRESS`

#### Mezo testnet parameters

- **Network Name**: Mezo Testnet
- **RPC Endpoint (HTTPS)**: `https://rpc.test.mezo.org`
- **RPC Endpoint (WSS)**: `wss://rpc-ws.test.mezo.org`
- **Chain ID**: `31611`
- **Native Currency**: BTC (decimals 18)
- **Block Explorer**: `explorer.test.mezo.org`
- **BorrowerOperations contract (per explorer)**: [`0xCdF7028ceAB81fA0C6971208e83fa7872994beE5`](https://explorer.test.mezo.org/address/0xCdF7028ceAB81fA0C6971208e83fa7872994beE5?tab=contract)

For scripts that **send transactions** (`01_open...`, `03_run_keeper_once`), also provide one of:

- `KEEPER_PRIVATE_KEY` (recommended), or
- `UNLOCKED_RPC_URL` + `KEEPER_ADDRESS`

#### Commands

Open a small trove near MCR (recommended: manual via UI; scripts also available):

UI: [Mezo testnet borrow UI](https://testnet.mezo.org/borrow)

```
# Manual (recommended): open a “weak” trove via the UI so it can be liquidated
#
# Target parameters:
# - Collateralization ratio as low as possible (e.g. ~110.1%)
# - Loan debt at least 1800 MUSD (so it shows up meaningfully in scans/tests)

# Optional (scripted) open-trove helper:
npm run testnet:open
CONFIRM=true DRY_RUN=false npm run testnet:open -- --COLLATERAL_BTC=0.03 --TARGET_ICR=1.102
```

Notes:

- `01_open_trove_near_mcr.ts` enforces a **minimum collateral** of `0.03 BTC` by default.
- `01_open_trove_near_mcr.ts` uses Mezo’s `BorrowerOperations.openTrove(uint256 debtAmount, address upperHint, address lowerHint)` ABI (see explorer link above). If it changes, update `scripts/testnet/_abis.ts`.

Monitor / scan until liquidatable (recommended):

```
npm run testnet:scan -- --THRESHOLD_PCT=110 --MAX_TO_SCAN=500 --TOP=50 --STOP_AFTER_FIRST_ABOVE=false
```

Liquidate single (force one borrower):

```
MEZO_RPC_URL=https://rpc.test.mezo.org \
CONFIG_PATH=../../configs/addresses.testnet.json \
NETWORK=testnet \
DRY_RUN=false \
CONFIRM=true \
FORCE_BORROWER=0xcC7d7D810132c44061d99928AA6e4D63c7c693c7 \
npm run testnet:run-once
```

Liquidate batch (force a specific set; strict mode):

```
MEZO_RPC_URL=https://rpc.test.mezo.org \
CONFIG_PATH=../../configs/addresses.testnet.json \
NETWORK=testnet \
DRY_RUN=false \
CONFIRM=true \
STRICT_BATCH=true \
FORCE_BORROWERS=0xcC7d7D810132c44061d99928AA6e4D63c7c693c7,0x9fD12be3448d73c4eF4B0ae189E090c4FD83C9A1 \
npm run testnet:run-once
```

Verify post-state:

```
npm run testnet:verify
npm run testnet:verify -- --STATE_FILE=scripts/testnet/.state/latest.json
```

### Notes / TODOs

- Security: bot holds signing rights; default is a small hot wallet via `KEEPER_PRIVATE_KEY`. Optional unlocked RPC signer (`UNLOCKED_RPC_URL` + `KEEPER_ADDRESS`) works only if the node supports `eth_sendTransaction`; clear `KEEPER_PRIVATE_KEY` to force this path. Never commit/log private keys.
- Discovery is sequential; consider multicall/batching and smarter gas heuristics to reduce RPC round-trips.
- Executor re-queues leftovers when gas-capped; still add visibility/metrics to alert on repeated splits/skips.
- Add metrics/telemetry and richer retry/backoff policies for production.
- Ops guidance: start with `GAS_BUFFER_PCT=20`, `MAX_GAS_PER_JOB` tuned to chain block gas, `MAX_NATIVE_SPENT_PER_RUN` set to a small per-run limit, `MAX_TX_RETRIES=1`. Watch JSON logs for `job_skip`, `job_shrink`, `tx_sent`, `tx_confirmed`, and `requeue` to debug caps and spend behavior.
- Fee selection: config EIP-1559 overrides take priority (`maxFeePerGas` plus optional `maxPriorityFeePerGas`; if only `maxFeePerGas` is set, the bot tries to fill `maxPriorityFeePerGas` from `estimateFeesPerGas`). Otherwise it uses `estimateFeesPerGas` (EIP-1559) then falls back to `getGasPrice` with legacy submission. If both fee sources fail and the spend cap is disabled, the bot submits best-effort with no fee overrides; if the spend cap is enabled, it skips with `FEE_UNAVAILABLE` and re-queues borrowers.
- Fee logs: `job_plan`, `job_skip`, `tx_sent`, `tx_confirmed` include `fee.mode/source/known/maxFeePerGas/maxPriorityFeePerGas/prioritySource/priorityKnown/gasPrice` plus `estimatedCostKnown/projectedCostKnown` when relevant. Modes align with submission: `eip1559` for `maxFeePerGas` (priority fee falls back to `0` if not sourceable; `priorityKnown=false`). For EIP-1559, `prioritySource` is `'config'` when `MAX_PRIORITY_FEE_PER_GAS` is set, otherwise `'estimateFeesPerGas'` when the bot attempted to derive it (even if it fell back to `0`). Operators can set `MAX_PRIORITY_FEE_PER_GAS` explicitly. `legacy` uses `gasPrice`, `unknown` when fee resolution failed and no cap is enforced.
