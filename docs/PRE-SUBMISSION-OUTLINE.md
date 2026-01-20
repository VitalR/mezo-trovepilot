# [Archived] TrovePilot — Pre-Submission Outline

_This pre-submission outline is kept for historical context. The up‑to‑date README and architecture live in `README.md` and `docs/ARCHITECTURE.md`. Legacy wrapper names (e.g., LiquidationBatcher / LiquidationEngine / RedemptionRouter) were consolidated into the unified `TrovePilotEngine`._

_Advanced DeFi Solutions – Mezo Hackathon_

## 1) Problem & Motivation

Liquidations and redemptions are the backbone of MUSD stability, yet running reliable keepers is operationally heavy and UX is fragmented. Today, efficient batching, hinting, reward routing, and public keeper reputation are not packaged as reusable on-chain infrastructure for Mezo.

## 2) Solution (What we’re building)

**TrovePilot** is a permissionless, composable automation layer:

- **LiquidationBatcher** – Executes batch liquidations (falls back per-trove on errors) and forwards protocol rewards (e.g., gas deposit in MUSD + 0.5% collateral) to the caller, minus optional protocol fee.
- **RedemptionRouter** – “Option B (with hints)” one-call redemption using HintHelpers + SortedTroves; also exposes a “quick mode” for small redemptions.
- **KeeperRegistry** – Minimal on-chain registry + score to encourage an open keeper market (authorizers like the batcher can bump scores post-success).

All modules are **Mezo-native**, **permissionless**, and **auditable**. No user funds are custodied—only transient balances from protocol rewards.

## 3) Architecture (MVP)

User/Bot ──calls────► LiquidationBatcher ──► TroveManager.batchLiquidateTroves / liquidate
│ │
│ └─► forwards native + MUSD rewards to caller (minus fee)
│
└─calls────► RedemptionRouter ──► HintHelpers.getRedemptionHints
└─► SortedTroves.findInsertPosition
└─► TroveManager.redeemCollateral

### Contracts (v0)

- `LiquidationBatcher.sol` – reward forwarding, fee sink (bps), keeper-agnostic, best-effort execution.
- `RedemptionRouter.sol` – `redeemExact` (with hints) and `redeemQuick` (no hints), ownerless & immutable.
- `KeeperRegistry.sol` – register, optional payTo, bumpScore (authorized by owner or batcher).

## 4) Why it’s new/valuable to Mezo

- Codifies **batch liquidation** + **hinted redemption** plumbing into reusable contracts.
- **Opens** peg-defense participation: anyone can click “Batch” and earn rewards.
- Introduces **public keeper reputation** and fee-share hooks that protocols/treasuries can extend.

## 5) Current Status (as of pre-submission)

- ✅ Core contracts drafted with full NatSpec.
- ✅ Docs: Overview, Architecture, Security.
- 🟨 Tests (unit/fork) scaffolding next.
- 🟨 Minimal UI (batch & redeem) next.
- 🟨 Testnet deployment addresses to be added.

Repo (public soon): `https://github.com/VitalR/mezo-trovepilot`  
Network: **Mezo Testnet** (Chain ID 31611, RPC `https://rpc.test.mezo.org`)

## 6) Milestones

- **M1 – Pre-submission (this doc):** architecture + core contracts in repo.
- **M2 – Testnet Deploy:** deploy batcher/router/registry; run at least one live batch and one redemption.
- **M3 – Minimal UI + Demo:** single-page app (connect wallet, list at-risk troves, “Batch now”, “Redeem”); 2-min video.
- **M4 – Keeper Scoreboard:** bumpScore wiring from batcher; simple leaderboard.

## 7) Judging Alignment

- **Mezo Integration (30%)** – Calls `batchLiquidateTroves`/`liquidate` and `redeemCollateral` with hints; forwards rewards as per protocol.
- **Technical (30%)** – Gas-aware batching, fail-soft loops, immutable router, typed mapping keys, NatSpec, tests.
- **Business (20%)** – Clear incentives (keeper rewards, optional protocol fee, open marketplace).
- **UX (10%)** – One-click batch/redemption; scoreboard.
- **Presentation (10%)** – Concise README, diagrams, demo video.

## 8) Roadmap (post-hackathon ideas)

- Post-action hooks (DEX route seized BTC/MUSD).
- Stability Pool views & analytics for LPs.
- Permissionless “keeper vault” with fee-share.
- Alerts API + bot templates (optional off-chain).
