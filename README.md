# TrovePilot

**Permissionless liquidation & redemption automation for Mezo MUSD**

TrovePilot is a composable automation layer for the Mezo stablecoin ecosystem.  
It provides:

- **LiquidationEngine** — strategy-oriented executor with partial ranges, retries, and on-chain job indexing; forwards protocol rewards to the caller.
- **RedemptionRouter** — on-chain hint computation and “quick mode” for small redemptions.
- **KeeperRegistry** — minimal registry + scoring to enable an open keeper economy.
- **VaultManager (MVP)** — users pre-fund MUSD; any keeper can execute small redemptions on their behalf and earn a fee.
- **YieldAggregator (stub)** — minimal MUSD sink to demonstrate routing/compounding flows for demos.

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

### Deploy (Mezo Testnet)

```shell
$ forge script script/TrovePilotDeploy.s.sol \
    --rpc-url $MEZO_RPC \
    --broadcast \
    --sig "run()" \
    -vvvv
# Optional env:
# DEPLOY_REGISTRY=true  # deploy KeeperRegistry and wire to LiquidationEngine
# FEE_SINK=0x...        # fee sink for protocol fee
# FEE_BPS=25            # 0.25% protocol fee
```

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
2. User funds MUSD into `VaultManager`
3. Any keeper calls `execute(user, price)` to run `redeemExact` with user's funds
4. Keeper receives MUSD fee from user's balance; user's MUSD is burned to redeem collateral from the system

Notes:

- This is an MVP to demonstrate automation; users explicitly pre-fund keeper bounties in MUSD.
- Price must match the system price used by TroveManager.

### YieldAggregator (stub) Flow

- Owner enables `VaultManager` as a notifier in `YieldAggregator` and sets the aggregator in `VaultManager`.
- Anyone can call `VaultManager.autoDeposit(user, amount)` to move a portion of the user’s internal MUSD balance to the aggregator and credit the user.
- Users can withdraw their aggregator balance via `YieldAggregator.withdraw(amount)`.

### Demo Script (Mezo Testnet)

```shell
$ forge script script/TrovePilotDemo.s.sol \
    --rpc-url $MEZO_RPC \
    --broadcast \
    --sig "run()" \
    -vvvv
# Optional env:
# USER=0xYourKeeperWallet        # defaults to deployer; must equal keeper for full loop
# ROUTER_ADDR=0x... ENGINE_ADDR=0x... VAULT_ADDR=0x... AGGREGATOR_ADDR=0x... REGISTRY_ADDR=0x...
# DEPLOYMENT_JSON=path/to/mezo-31611.json  # auto-resolve addresses if env unset
# KEEPER_PAYTO=0x...            # used when REGISTRY_ADDR is set
# PRICE_OVERRIDE=1234           # manual price if oracle is inactive
```

**Demo flow (when `USER == keeper`):**

1. Resolve existing TrovePilot contracts (from env or `deployments/31611/mezo-31611.json`).
2. Optionally register the keeper in `KeeperRegistry` so payTo overrides and scoring work.
3. Fund the vault with 20 MUSD, execute a redemption via `VaultManager.execute`, and route 2 MUSD into `YieldAggregator`.
4. Withdraw 1 MUSD back from the aggregator.
5. Log the contract addresses for quick reference.

> ℹ️ **Oracle note:** the Mezo testnet price feed occasionally returns `NotActivated`. Supply `PRICE_OVERRIDE` when that happens to force a demo price.

## Motivation

MUSD’s stability depends on timely liquidations and redemptions, but running private keepers is complex.
TrovePilot brings these core mechanisms on-chain and permissionless, ensuring everyone can participate in peg maintenance, earn keeper rewards, and improve Mezo’s decentralization.

---

## License

MIT
