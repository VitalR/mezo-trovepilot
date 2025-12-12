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
- `TROVE_MANAGER_ADDRESS`, `SORTED_TROVES_ADDRESS`, `LIQUIDATION_ENGINE_ADDRESS`, `PRICE_FEED_ADDRESS`
- Optional discovery/price bounds: `MAX_TROVES_TO_SCAN_PER_RUN`, `MAX_TROVES_PER_JOB`, `EARLY_EXIT_SCAN_THRESHOLD`, `MIN_BTC_PRICE`, `MAX_BTC_PRICE`, `MAX_PRICE_AGE_SECONDS`
- Optional: `DRY_RUN`

### Run

Dry run (no txs):

```
DRY_RUN=true npm start
```

Live mode (sends txs):

```
DRY_RUN=false npm start
```

### Notes / TODOs

- Security: bot holds signing rights; prefer an external signer (EXTERNAL_SIGNER_URL + KEEPER_ADDRESS) in production. Never commit/log private keys.
- Discovery is sequential; consider multicall and better gas heuristics.
- Add metrics/telemetry and retries/backoff for prod use.
