# TrovePilot v2 — Mezo Keeper Execution Toolkit

**Version:** December 2025  
**Status:** Active Development (v2)

TrovePilot v2 is a lightweight, permissionless execution toolkit designed to help community keepers interact safely and efficiently with **Mezo’s liquidation and redemption flows**.

It provides:

- Clean contract wrappers for liquidation & redemption
- Execution primitives for redemption loops (via Tigris)
- Reference off-chain bots for liquidations, redemptions, and loops
- TypeScript SDK for custom keeper strategies

TrovePilot v2 follows Mezo’s automation philosophy:

> **“Thin on-chain, logic off-chain.”**

The on-chain layer stays minimal and transparent, while all strategy and automation runs off-chain through open-source bots and the TrovePilot SDK.

---

### Key Objectives

- Make Mezo’s liquidation and redemption flows easier to use
- Provide clean on-chain wrappers with minimal logic
- Enable off-chain bots to simulate & decide strategies safely
- Avoid any overlap with SafetyBuffer or protocol-owned capital
- Support a decentralized keeper ecosystem

---

### Architecture Overview

TrovePilot v2 follows a strict separation:

**Off-chain (strategy)**

- Keeper bots
- SDK for calldata
- Monitoring & simulation
- Profitability decision-making

**On-chain (execution)**

- Stateless wrapper contracts
- Batch liquidation
- Redemption with hints
- DEX swaps (Tigris)
- Redemption-loop executor

Detailed architecture:  
[`ARCHITECTURE_V2.md`](./docs/ARCHITECTURE_V2.md)

---

### On-Chain Components (v2)

| Contract                 | Responsibility                         |
| ------------------------ | -------------------------------------- |
| `LiquidationEngine`      | Batch + fallback liquidation execution |
| `RedemptionRouter`       | Quick-mode or hint-assisted redemption |
| `RedemptionLoopExecutor` | swap → redeem → optional rebalance     |
| `DexAdapter_Tigris`      | Minimal DEX wrapper for swaps          |

Full contract reference:  
[`CONTRACTS_V2.md`](./docs/CONTRACTS_V2.md)

---

### Off-Chain Components (v2)

- `@trovepilot/sdk` — calldata generation
- Keeper bots (reference implementations):
  - liquidation bot
  - redemption bot
  - redemption-loop bot
- Monitoring / profitability scripts
- Optional dashboard (analytics, job history)

---

### Roadmap

High-level roadmap from mission → mainnet:  
[`MISSION_AND_ROADMAP.md`](./docs/MISSION_AND_ROADMAP.md)

---

### Migration Guide

Migrating from hackathon v1 to v2:  
[`MIGRATION_V1_TO_V2.md`](./docs/MIGRATION_V1_TO_V2.md)

---

### Build

constacts:

```
forge install
forge test
```

bots:

```
npm install
npm run dev
```

---

### License

MIT © VitalR / TrovePilot contributors
