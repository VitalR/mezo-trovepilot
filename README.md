# TrovePilot

**Permissionless keeper automation for Mezo MUSD**

TrovePilot is a composable, on-chain automation layer that improves Mezo’s peg-defense and user UX by batching liquidations, streamlining redemptions, and enabling an open keeper economy. It ships with a small, demo-friendly UI so judges can see the system in action on Mezo testnet.

Built for the **Advanced DeFi Solutions** track of the **Mezo Hackathon 2025**.

---

## What’s inside

- **LiquidationEngine** — strategy-oriented executor with partial ranges, retries, and on-chain job indexing; forwards protocol rewards to the caller. Optional scoring and fee routing.
- **RedemptionRouter** — helper for hinted redemptions plus a “quick mode” for small amounts.
- **KeeperRegistry** — minimal registry + scoring to enable an open keeper economy.
- **VaultManager (MVP)** — users pre-fund MUSD; any keeper can execute small redemptions on their behalf and earn a fee.
- **YieldAggregator (stub)** — minimal MUSD sink to demonstrate routing/compounding flows in the demo.
- **UI** — a lightweight Next.js dashboard with a guided demo, live contract references, a keeper console, and activity feed.

---

## Why it matters (judge lens)

- **Mezo integration (30%)**: Uses MUSD in redemptions, integrates with oracle flows, and exposes keeper operations that move protocol state on Mezo testnet.
- **Technical implementation (30%)**: Modular Solidity contracts, clear separation of responsibilities, deterministic scripts, and a Makefile-based workflow for repeatable deploys and demos.
- **Business viability (20%)**: Lowers the barrier for community keepers; turns security-critical operations into a transparent, competitive market with reputation and payouts.
- **UX (10%)**: Guided “Automation Story”, activity feed, and a keeper console that runs a live job.
- **Presentation (10%)**: One-command scripts, clear docs, and a demo-first UI.

---

## Getting started

Configuration notes live in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md). These Make targets wrap all shell incantations so judges can reproduce quickly.

### Prereqs

- Foundry (forge/cast): see the [installation guide](https://book.getfoundry.sh/getting-started/installation)
- Mezo testnet RPC and a funded deployer key (tBTC)

### Install & build

```bash
make install
make build
```

### Run tests

```bash
make test
# or against a live Mezo fork (requires MEZO_RPC in .env.testnet)
make test-fork
```

### Deploy to Mezo testnet (one-shot deploy + verify)

```bash
# Expects .env.testnet with MEZO_RPC and DEPLOYER_PRIVATE_KEY
make deploy-testnet
```

### Run the on-chain demo flow

```bash
make demo-testnet
```

### Export ABIs for the UI (optional)

```bash
make abi
```

---

## UI (Next.js) – live dashboard & guided demo

The UI shows metrics, contract addresses, an activity feed, and a keeper console capable of running a live job.

1. `cd ui && npm i`
2. Create `ui/.env.local` with at least:

```bash
NEXT_PUBLIC_RPC_URL=https://rpc.test.mezo.org
# Optional: wire live contracts (all lowercase)
NEXT_PUBLIC_ENGINE=0x...
NEXT_PUBLIC_ROUTER=0x...
NEXT_PUBLIC_VAULT=0x...
NEXT_PUBLIC_AGGREGATOR=0x...
NEXT_PUBLIC_REGISTRY=0x...
NEXT_PUBLIC_SORTED_TROVES=0x722E4D24FD6Ff8b0AC679450F3D91294607268fA
# Fallback trove list used when on-chain hints are unavailable (comma-separated)
NEXT_PUBLIC_TROVE_FALLBACK_LIST=0xabc...,0xdef...
# Optional Pyth support
NEXT_PUBLIC_PYTH_CONTRACT=0x...
NEXT_PUBLIC_PYTH_PRICE_ID=0x...
NEXT_PUBLIC_PYTH_MAX_AGE_SECONDS=3600
```

3. `npm run dev` and open http://localhost:3000

Tips for judges:

- Toggle “Demo Mode” to see simulated activity instantly.
- Click “Run Guided Demo” to watch the Automation Story fill in.
- With live addresses configured, paste troves in the keeper console and submit a job.

---

## Contract details

### Keeper Scoring & Payouts (LiquidationEngine)

- When `KeeperRegistry` is configured, `LiquidationEngine` will:
  - bump the caller's score by `pointsPerLiquidation * executed`
  - forward rewards to the keeper's `payTo` address if set (else to caller)
- Owners can tune:
  - `setPointsPerLiquidation(uint96)` to adjust scoring weight
  - `setFeeBps(uint16)` and `setFeeSink(address)` for protocol fees

### VaultManager (MVP) Flow

1. User opts in and sets config:
   - `musdPerRedeem`, `maxIterations`, `keeperFeeBps`, `active`
2. User funds MUSD into `VaultManager`.
3. Any keeper calls `execute(user, price)` to run `redeemExact` with user's funds.
4. Keeper receives MUSD fee from the user’s balance; user’s MUSD is burned to redeem collateral.

Notes:

- MVP demonstrates automation; users explicitly pre-fund keeper bounties in MUSD.
- Price must match the system price used by TroveManager.

### Trove Hint Dump (keeper fallback list)

Export addresses from `SortedTroves` and paste into `NEXT_PUBLIC_TROVE_FALLBACK_LIST` so the UI can suggest troves when the oracle/hints are unavailable.

```bash
make demo-testnet   # also logs addresses used in the session
```

---

## Roadmap (post‑hackathon)

- Enable continuous vault protection (policy-based triggers, partial liquidations)
- Keeper marketplace with slashing-resistant scoring and transparent payouts
- Yield routes for idle MUSD balances with risk controls
- Live analytics and alerts (webhooks, Telegram/Discord)

---

## Motivation

MUSD stability depends on timely liquidations and redemptions, but running private keepers is complex. TrovePilot turns these core mechanisms into permissionless, reusable, on‑chain modules and a simple UI—so anyone can participate in peg maintenance, earn keeper rewards, and strengthen Mezo’s decentralization.

---

## License

MIT
