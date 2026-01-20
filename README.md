# TrovePilot v2 — Mezo Keeper Execution Toolkit

**Version:** December 2025

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
- Liquidation (single + batch) via unified wrapper
- Redemption with hints via unified wrapper

Detailed architecture:  
[`ARCHITECTURE_V2.md`](./docs/ARCHITECTURE_V2.md)

---

### On-Chain Components (v2)

| Contract           | Responsibility                               |
| ------------------ | -------------------------------------------- |
| `TrovePilotEngine` | Unified wrapper for liquidation + redemption |

Full contract reference:  
[`CONTRACTS_V2.md`](./docs/CONTRACTS_V2.md)

Testnet deployment (Mezo Explorer):  
[`TrovePilotEngine` at `0x878a85eaaF24902fD6985d3CB2D51a299E33F43c`](https://explorer.test.mezo.org/address/0x878a85eaaF24902fD6985d3CB2D51a299E33F43c)

---

### Off-Chain Components (v2)

- `@trovepilot/sdk` — calldata generation
- Keeper bots (reference implementations):
  - liquidation bot
  - redemption bot
  - redemption-loop bot
- Monitoring / profitability scripts
- Optional dashboard (analytics, job history)

Keeper runbooks:
- [`keepers/liquidation-bot/README.md`](./keepers/liquidation-bot/README.md)
- [`keepers/redemption-bot/README.md`](./keepers/redemption-bot/README.md)

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

contracts:

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
