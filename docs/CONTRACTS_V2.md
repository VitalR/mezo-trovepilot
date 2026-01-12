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

### 2.1 `TrovePilotEngine` (unified wrapper)

`TrovePilotEngine` is the **only on-chain wrapper contract** retained in this repo. Legacy wrappers (`LiquidationEngine`, `RedemptionRouter`) were removed and consolidated into this single primitive.

### Purpose

Provide a **permissionless**, **auditable** execution wrapper for:

- liquidations (single + batch)
- hinted redemptions (one-call execution using off-chain computed hints)

while supporting an explicit `recipient` so operators can keep custody and route payouts/refunds deterministically.

### Key Features

- **Liquidation**:
  - `liquidateSingle(address borrower, address recipient)`
  - `liquidateBatch(address[] borrowers, address recipient)`
- **Redemption**:
  - `redeemHintedTo(uint256 musdAmount, address recipient, address firstHint, address upperHint, address lowerHint, uint256 partialNICR, uint256 maxIter)`
  - Atomic custody: pulls MUSD from `msg.sender`, calls core redemption, then forwards native + MUSD deltas to `recipient`.
- **Indexing**:
  - `jobId()` monotonic counter for off-chain indexing
- **Safety**:
  - `Ownable2Step` gated `sweep(token, recipient)` as an emergency escape hatch only

### State

- Minimal:
  - `jobId` (monotonic counter)
  - immutable references to Mezo core (`TROVE_MANAGER`) and `MUSD`
- No strategy logic (all strategy remains off-chain).

### Events

- `TrovePilotEngineInitialized(troveManager, musd, owner)`
- `LiquidationExecuted(jobId, caller, recipient, attempted, succeeded, nativeReward, musdReward)`
- `RedemptionExecuted(jobId, caller, recipient, musdRequested, musdRedeemed, musdRefunded, collateralOut, maxIter, hinted)`
- `SweepExecuted(caller, token, amount, recipient)`

---

### 2.2 Deprecated v2 wrappers (removed)

Earlier iterations included separate wrappers (`LiquidationEngine`, `RedemptionRouter`) and loop executors. Those contracts have been removed from `contracts/src/` and are intentionally not part of the maintained on-chain surface.

---

## 3. Integrations

`TrovePilotEngine` integrates only with:

- `TroveManager` (Mezo core)
- `MUSD` (ERC-20)

All redemption hints (`HintHelpers`, `SortedTroves`) are computed off-chain and provided by the caller.

---

## 4. Security Model

- Minimal surface area and storage (`jobId` only)
- Strict bubbling of core reverts (no hidden fallback loops on-chain)
- Reentrancy guarded
- Emergency `sweep` is owner-gated (`Ownable2Step`) and intended only to clear dust

---

## 5. Summary Table

| Contract         | State   | Responsibility                    | Notes                                      |
| ---------------- | ------- | --------------------------------- | ------------------------------------------ |
| TrovePilotEngine | Minimal | Liquidations + hinted redemptions | Canonical on-chain wrapper (only one kept) |
