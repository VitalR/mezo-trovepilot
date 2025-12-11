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
- `KEEPER_PRIVATE_KEY` — hex private key for the executor
- `TROVE_MANAGER_ADDRESS`, `SORTED_TROVES_ADDRESS`, `LIQUIDATION_ENGINE_ADDRESS`
- Optional: `MAX_TROVES`, `MAX_PER_JOB`, `DRY_RUN`, `STATIC_BTC_PRICE`

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

- Price is currently provided via `STATIC_BTC_PRICE` (1e18 scale). Replace with an oracle feed.
- Discovery is sequential; consider multicall and better gas heuristics.
- Add metrics/telemetry and retries/backoff for prod use.
