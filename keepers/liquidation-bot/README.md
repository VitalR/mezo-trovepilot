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
- Execution: applies a gas buffer (`GAS_BUFFER_PCT`), enforces `MAX_GAS_PER_JOB` by shrinking batches (and re-queuing suffix leftovers), re-estimates gas **and refreshes fees** on first retry, and enforces `MAX_NATIVE_SPENT_PER_RUN`. Sends `liquidateRange` with auto fee estimation when caps are unset (config override -> `estimateFeesPerGas` -> `getGasPrice` fallback; legacy fallback submits with `gasPrice`). If spend cap is enabled and fees cannot be determined, the job is skipped as `FEE_UNAVAILABLE`; if spend cap is disabled, the bot submits best-effort with no fee overrides. Spend tracking updates with receipt-based actual cost; structured JSON logs cover plan/shrink/skip, `tx_error` on failure, `retry_scheduled` (emits `nextBackoffMs`; `backoffMs` kept temporarily for compatibility) before backoff/replan, and `tx_sent`/`tx_confirmed`/`requeue` with fee metadata.

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

Open a small trove near MCR (default DRY_RUN):

```
npm run testnet:open
CONFIRM=true DRY_RUN=false npm run testnet:open -- --COLLATERAL_BTC=0.03 --TARGET_ICR=1.102
```

Notes:

- `01_open_trove_near_mcr.ts` enforces a **minimum collateral** of `0.03 BTC` by default.
- `01_open_trove_near_mcr.ts` uses Mezo’s `BorrowerOperations.openTrove(uint256 debtAmount, address upperHint, address lowerHint)` ABI (see explorer link above). If it changes, update `scripts/testnet/_abis.ts`.

Poll until liquidatable:

```
npm run testnet:poll
npm run testnet:poll -- --STATE_FILE=scripts/testnet/.state/latest.json --POLL_INTERVAL_SEC=15 --TIMEOUT_SEC=7200
```

Run keeper logic once:

```
npm run testnet:run-once
CONFIRM=true DRY_RUN=false npm run testnet:run-once
npm run testnet:run-once -- --FORCE_BORROWER=0x...
npm run testnet:run-once -- --MAX_TO_SCAN=2000
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
