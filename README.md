# TrovePilot

**Permissionless keeper automation for Mezo MUSD**

TrovePilot is a composable, on-chain automation layer for the Mezo stablecoin ecosystem.

It focuses on:
- batching liquidations,
- streamlining redemptions, and
- enabling an open, transparent keeper economy around MUSD.

Built during the **Mezo Hackathon 2025** (Advanced DeFi Solutions track).

> **Protocol-first:** TrovePilot is designed primarily as **infrastructure**.  
> The core value lives in the smart contracts (liquidation, redemption, keeper logic).  
> The Next.js dashboard is a minimal reference client to visualize how these pieces work on Mezo testnet—not a finished consumer product.

---

## Why it matters

MUSD stability and healthy trove management depend on timely liquidations and redemptions.

Today, this kind of maintenance is often:
- concentrated in a few private bots,
- opaque to users,
- hard to join as an independent keeper.

**TrovePilot** aims to turn that into:

- **Open peg defense** – replaces closed infra with verifiable, on-chain executors.
- **Real MUSD utility** – MUSD is used for funding actions, rewarding keepers, and routing flows.
- **Composable infra** – small modules that plug directly into Mezo’s TroveManager, SortedTroves, and oracle stack.
- **Permissionless participation** – anyone can integrate, run keepers, or build on top.

---

## What’s inside

**Core contracts and components**

| Module | Function |
|:--|:--|
| **LiquidationEngine** | Batches liquidations, handles retries, indexes jobs on-chain, forwards rewards (with optional fees & scoring) |
| **RedemptionRouter** | Wraps TroveManager; supports hinted redemptions + “quick mode” for small redemptions |
| **KeeperRegistry** | Tracks keeper metadata (e.g. `payTo`, score) and enables transparent payout routing |
| **VaultManager (MVP)** | Lets users pre-fund MUSD so any keeper can execute small redemptions on their behalf for a fee |
| **YieldAggregator (stub)** | Placeholder sink to demonstrate how automated MUSD routing/compounding could plug in |
| **UI (Next.js)** | Lightweight dashboard with demo mode, contract references, keeper console, and activity feed |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for diagrams and flows.

---

## Status & scope

This repository is a **hackathon prototype**, not production code.

**Included**

- Working, verifiable contracts on Mezo testnet.
- Deterministic deployment & verification scripts.
- Demo-focused dashboard with Demo Mode + Live wiring.
- Example flows for:
  - batched liquidations,
  - hinted/quick redemptions,
  - opt-in vault automation via `VaultManager`.

**Not (yet) included**

- Formal audits / full production hardening.
- Complete keeper marketplace, slashing, or complex incentive logic.
- Production-grade UX for non-technical users.
- Finalized yield routes or continuous policy engines.

The design is intentionally modular so it can be extended with Mezo and the community.

---

## Getting started

Configuration details live in [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

Use the provided `make` targets for reproducible flows.

### Prereqs

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- Mezo testnet RPC
- EVM wallet funded with gas on Mezo testnet (tBTC as gas)

### Install & build

```bash
make install
make build
```

Run tests
```bash
# Local / unit tests
make test

# Against a Mezo fork (requires MEZO_RPC in .env.testnet)
make test-fork
```

Deploy to Mezo testnet
```bash
# Uses .env.testnet:
# MEZO_RPC, DEPLOYER_PRIVATE_KEY, plus optional flags
make deploy-testnet
```

Run the demo flow
```bash
make demo-testnet
```

Export ABIs
```bash
make abi
```

### UI (Next.js) — reference dashboard

The `ui` package is a thin reference client to:
- display live contract addresses and status,
- run a guided “Automation Story”,
- provide a keeper console for job submission,
- show a simple activity feed.

Quick start:
1. `cd ui && npm i`
2. Create `ui/.env.local` (see [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for all keys)
3. `npm run dev` → open http://localhost:3000

Notes:
- `Demo Mode`: uses scripted data; no wallet needed.
- `Live Mode`: uses your configured Mezo RPC + contracts for real calls.
- Trove suggestions can come from `SortedTroves` or from a fallback list exported by the helper scripts.

---

### Contract details (high level)

**LiquidationEngine**
- Batches or loops through trove sets (best-effort, non-reverting).
- Records job metadata on-chain for easy indexing.
- Forwards rewards to:
  - keeper’s `payTo` in `KeeperRegistry`, or
  - caller address by default.
- Optional:
  - protocol fee via `feeSink` + `feeBps`,
  - scoring hooks via `KeeperRegistry`.

**RedemptionRouter**
- Wraps Mezo’s TroveManager redemption paths.
- Supports:
  - hinted redemptions for efficient bulk operations,
  - a simplified quick mode for smaller/interactive use.
- Stateless and integrator-friendly.

**KeeperRegistry**
- Maps keeper addresses to:
  - optional `payTo` payout address,
  - score (if utilized),
  - future flags.
- Keeps keeper configuration visible and queryable on-chain.

**VaultManager (MVP)**
- Users opt in:
  - set redeem parameters and keeper fee,
  - deposit MUSD.
- Any keeper can:
  - call `execute(user, price)` → triggers `RedemptionRouter`.
- Keeper:
  - earns a fee in MUSD from the user’s balance.
- User:
  - gets redemptions executed without manual calls.
- Intended as a pattern example, not a final policy engine.

**YieldAggregator (stub)**
- Receives MUSD/rewards in demo flows.
- Demonstrates how real yield strategies could attach later.
- Intentionally non-opinionated.

---

### Roadmap (beyond hackathon)

Potential next steps:
- **Policy-based vault protection**
  - automated triggers (LTV, volatility),
  - partial redemptions / top-ups.
- **Keeper marketplace**
  - richer scoring,
  - stake/slash mechanics,
  - competition for best execution.
- **MUSD yield routing**
  - curated strategies for idle balances,
  - visible risk controls.
- **Monitoring & alerts**
  - real-time analytics,
  - Telegram/Discord/webhook integrations.
- **Productionization**
  - audits,
  - extended tests,
  - griefing & gas-efficiency analysis.

---

### Motivation

Relying on closed, private keeper infra for peg defense creates:
 - concentration risk,
 - limited accountability,
 - high barriers to entry.

TrovePilot explores the opposite direction:
 - **Permissionless** – execution and incentives codified on-chain.
 - **Composable** – use any module independently or together.
 - **Transparent** – every job and payout is inspectable.
 - **MUSD-centric** – flows fund and reward in MUSD, reinforcing its role in Mezo.

The long-term goal:
>Make Mezo’s peg defense and maintenance an open, auditable, community-aligned process.

---

### License

MIT © VitalR / TrovePilot contributors