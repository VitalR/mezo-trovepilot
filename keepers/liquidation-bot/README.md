## Liquidation Keeper (TrovePilot v2)

Minimal off-chain bot that discovers undercollateralized troves on Mezo and executes liquidations via the TrovePilot `LiquidationEngine`.

### Setup

1. Install deps

```
cd keepers/liquidation-bot
npm install
```

2. Copy `env.example` to `.env` and fill in:

- `MEZO_RPC_URL` — Mezo RPC endpoint
- `KEEPER_PRIVATE_KEY` — hex private key for the executor (dev only; prefer EXTERNAL_SIGNER_URL + KEEPER_ADDRESS for prod)
- Optional gas controls: `MAX_TX_RETRIES`, `MAX_FEE_PER_GAS`, `MAX_PRIORITY_FEE_PER_GAS`, `MAX_NATIVE_SPENT_PER_RUN`, `MAX_GAS_PER_JOB`
- `TROVE_MANAGER_ADDRESS`, `SORTED_TROVES_ADDRESS`, `LIQUIDATION_ENGINE_ADDRESS`, `PRICE_FEED_ADDRESS`
- Optional discovery/price bounds: `MAX_TROVES_TO_SCAN_PER_RUN`, `MAX_TROVES_PER_JOB`, `EARLY_EXIT_SCAN_THRESHOLD`, `MIN_BTC_PRICE`, `MAX_BTC_PRICE`, `MAX_PRICE_AGE_SECONDS`
- Optional: `DRY_RUN`

### How it works

- Config: loads env (can seed from `CONFIG_PATH`/`NETWORK` JSON), validates addresses and numeric bounds. Signer can be raw key (dev) or external signer URL + keeper address (preferred for prod).
- Price: reads Mezo price feed (1e18), enforces min/max bounds and optional staleness; skips run if price invalid.
- Discovery: scans `SortedTroves` up to `MAX_TROVES_TO_SCAN_PER_RUN`; early-exits if `EARLY_EXIT_SCAN_THRESHOLD` hit and none below MCR. Uses `MCR_ICR = 1.1e18` as the ICR threshold.
- Jobs: chunks liquidatable borrowers into batches of `MAX_TROVES_PER_JOB`. Executor re-estimates gas and, if `MAX_GAS_PER_JOB` is set, shrinks the batch until under the cap (or skips if a single borrower exceeds it).
- Execution: sends `liquidateRange` with optional `maxFeePerGas`/`maxPriorityFeePerGas`, retries transient errors up to `MAX_TX_RETRIES`, classifies logic reverts (no retry), enforces `MAX_NATIVE_SPENT_PER_RUN`, and logs discovery stats, job counts, tx hashes, and gas used.

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

### Notes / TODOs

- Security: bot holds signing rights; prefer an external signer (EXTERNAL_SIGNER_URL + KEEPER_ADDRESS) in production. Never commit/log private keys.
- Discovery is sequential; consider multicall and better gas heuristics.
- Add metrics/telemetry and retries/backoff for prod use.
