# TrovePilot v2 — Contracts Specification

**Version:** December 2025  
**Scope:** On-chain execution primitives (stateless wrappers)

---

## 1. Overview

TrovePilot v2 contracts are **minimal execution wrappers** around Mezo’s liquidation and redemption flows.

They **never**:

- Hold user funds
- Implement strategy
- Manage protocol-owned capital
- Introduce governance or tokenomics
- Create keeper markets

They **only**:

- Forward calldata to Mezo primitives
- Emit structured events
- Serve as safe/flexible entrypoints for off-chain bots

---

## 2. Contract Details

### 2.1 `LiquidationEngine`

### Purpose

Batch or per-trove liquidation executor with fallback and retry logic.

### Key Features

- `liquidateRange()` with batching + fallback
- Records job metadata (`JobRecorded`)
- Optional scoring via `KeeperRegistry`
- Optional fee forwarding (native + MUSD)
- Owner-only `sweep(token, recipient)` is an emergency escape hatch to clear dust; execution remains fully permissionless.

### State

- Minimal: job logs only
- No custody of collateral or MUSD
- No strategy logic; off-chain decides which troves to liquidate

### Events

- `JobRecorded`
- `RewardsForwarded`

---

### 2.2 `RedemptionRouter`

### Purpose

Simplified interface for MUSD → BTC redemptions.

### Modes

- `redeemQuick()` — simple, no hints (higher gas)
- `redeemExact()` — hint-assisted (cheaper)

### Integrations

- `HintHelpers`
- `SortedTroves`
- `TroveManager`

### Events

- `Redeemed`

---

### 2.3 `RedemptionLoopExecutor`

### Purpose

Workhorse for arbitrage/redemption strategies:

> swap → redeem → (optional) rebalance

### Properties

- Stateless
- Slippage validated off-chain
- Calls:
  - DEX adapter (Tigris)
  - RedemptionRouter

### Events

- Emitted via underlying calls (swap, redemption)

---

### 2.4 `DexAdapter_Tigris`

### Purpose

Single-purpose DEX wrapper for swaps required in redemption loops.

### Characteristics

- Minimal surface
- Permissionless
- No pricing logic
- No liquidity logic
- Optional future: more adapters (`DexAdapter_Uniswap`, etc.)

---

## 3. Integrations

All v2 contracts integrate only with:

- `TroveManager`
- `HintHelpers`
- `SortedTroves`
- Optional `KeeperRegistry`
- Optional DEX

No new protocol dependencies.

---

## 4. Security Model

- Stateless interactions
- Clear event logs
- No approvals stored
- No reentrancy-sensitive interactions
- Minimal storage = easy audits
- Clean separation from protocol-owned logic

---

## 5. Future Extensions

Safe additions:

- More DEX adapters
- Wrapper for future Mezo flows
- Batch redemptions (if supported later)
- Simpler “job builder” helper contracts (optional)

Unsafe (and therefore excluded):

- Keeper incentive layer
- Vault or yield strategies
- Governance
- Tokenomics

---

## 6. Summary Table

| Contract                  | State     | Responsibility       | Notes                   |
| ------------------------- | --------- | -------------------- | ----------------------- |
| LiquidationEngine         | Minimal   | Execute liquidations | Optional scoring & fees |
| RedemptionRouter          | Stateless | Redemption execution | Hint helpers            |
| RedemptionLoopExecutor    | Stateless | Swap → redeem        | Strategy is off-chain   |
| DexAdapter_Tigris         | Stateless | Swap wrapper         | Simple, composable      |
| KeeperRegistry (optional) | Minimal   | Score registry       | Not required            |
