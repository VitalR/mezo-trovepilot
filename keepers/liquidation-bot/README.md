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
- `KEEPER_PRIVATE_KEY` — hex private key for the executor (default/dev path; keep balance small)
- Optional unlocked signer (only if the node supports `eth_sendTransaction` with an unlocked account):
  - `UNLOCKED_RPC_URL`
  - `KEEPER_ADDRESS`
- Optional gas controls: `MAX_TX_RETRIES`, `MAX_FEE_PER_GAS`, `MAX_PRIORITY_FEE_PER_GAS`, `MAX_NATIVE_SPENT_PER_RUN`, `MAX_GAS_PER_JOB`
- `TROVE_MANAGER_ADDRESS`, `SORTED_TROVES_ADDRESS`, `LIQUIDATION_ENGINE_ADDRESS`, `PRICE_FEED_ADDRESS`
- Optional discovery/price bounds: `MAX_TROVES_TO_SCAN_PER_RUN`, `MAX_TROVES_PER_JOB`, `EARLY_EXIT_SCAN_THRESHOLD`, `MIN_BTC_PRICE`, `MAX_BTC_PRICE`, `MAX_PRICE_AGE_SECONDS`
- Optional: `DRY_RUN`

### How it works

- Config / signer: loads env (optionally from `CONFIG_PATH`/`NETWORK`), validates bounds. Default signer is a small hot key via `KEEPER_PRIVATE_KEY`. Optional unlocked RPC path (`UNLOCKED_RPC_URL` + `KEEPER_ADDRESS`) is used only when the node supports `eth_sendTransaction` and no private key is provided.
- Price: reads price feed in 1e18 units, enforces min/max bounds, and optional staleness. If `MAX_PRICE_AGE_SECONDS > 0` and `updatedAt` is unavailable or stale, the bot skips the run (fail closed). Fallback to `fetchPrice` only when staleness is not required.
- Discovery: scans `SortedTroves` from the tail (risky end) using `getLast` then `getPrev`, up to `MAX_TROVES_TO_SCAN_PER_RUN`. Early-exits if `EARLY_EXIT_SCAN_THRESHOLD` is hit with no liquidatables. Uses `MCR_ICR = 1.1e18`.
- Jobs: chunks liquidatable borrowers into batches of `MAX_TROVES_PER_JOB`.
- Execution: applies a gas buffer (`GAS_BUFFER_PCT`), enforces `MAX_GAS_PER_JOB` by shrinking batches (and re-queuing leftovers), re-estimates gas on first retry, and enforces `MAX_NATIVE_SPENT_PER_RUN`. Sends `liquidateRange` with optional fee caps and retries non-logic errors up to `MAX_TX_RETRIES`. Spend tracking updates with receipt-based actual cost; clear logs indicate shrink/skip/requeue.

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

- Security: bot holds signing rights; default is a small hot wallet via `KEEPER_PRIVATE_KEY`. Optional unlocked RPC signer (`UNLOCKED_RPC_URL` + `KEEPER_ADDRESS`) works only if the node supports `eth_sendTransaction`; clear `KEEPER_PRIVATE_KEY` to force this path. Never commit/log private keys.
- Discovery is sequential; consider multicall/batching and smarter gas heuristics to reduce RPC round-trips.
- Executor re-queues leftovers when gas-capped; still add visibility/metrics to alert on repeated splits/skips.
- Add metrics/telemetry and richer retry/backoff policies for production.
