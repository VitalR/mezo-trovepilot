# TrovePilot

**Permissionless liquidation & redemption automation for Mezo MUSD**

TrovePilot is a composable automation layer for the Mezo stablecoin ecosystem.  
It provides:
- **LiquidationBatcher** — executes batch liquidations and forwards protocol rewards to the caller.  
- **RedemptionRouter** — on-chain hint computation and “quick mode” for small redemptions.  
- **KeeperRegistry** — minimal registry + scoring to enable an open keeper economy.

> Built for the **Advanced DeFi Solutions** track of the **Mezo Hackathon 2025**.

---

## Why TrovePilot?

- Makes **peg-defense participation accessible** — no bespoke bots or servers required.  
- Codifies **hinted redemptions & batch liquidations** into reusable on-chain modules.  
- Creates an **open keeper economy** with optional fee-sharing and transparent reputation.  

---

## Quick Start

### Install Foundry and Forge: [installation guide](https://book.getfoundry.sh/getting-started/installation)

```bash
forge install
cp .env.example .env   # set MEZO_RPC & PRIVATE_KEY
forge build
```

## Usage

### Build

```shell
$ forge build
```

### Test

```shell
$ forge test
```

## Motivation

MUSD’s stability depends on timely liquidations and redemptions, but running private keepers is complex.
TrovePilot brings these core mechanisms on-chain and permissionless, ensuring everyone can participate in peg maintenance, earn keeper rewards, and improve Mezo’s decentralization.

---

## License

MIT