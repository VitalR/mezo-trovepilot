# TrovePilot Architecture

This document provides a high-level view of the components and the two primary flows demonstrated in the hackathon UI.

---

## Components

```mermaid
flowchart LR
    subgraph UI["Next.js Dashboard"]
        A["Automation Story"]
        B["Keeper Console"]
        C["Contracts Panel"]
    end

    subgraph OnChain["Contracts - Mezo Testnet"]
        LE["LiquidationEngine"]
        RR["RedemptionRouter"]
        VM["VaultManager (MVP)"]
        YA["YieldAggregator (stub)"]
        KR["KeeperRegistry"]
    end

    subgraph Mezo["Mezo Protocol"]
        TM["TroveManager"]
        ST["SortedTroves"]
    end

    subgraph Oracles["Oracle Network"]
        PY["Pyth"]
        SK["Skip / Chainlink-style"]
    end

    %% connections
    UI -->|read/write| OnChain
    LE --> TM
    RR --> TM
    RR --> ST
    VM --> RR
    VM --> YA
    LE --> KR
    UI -->|read| Oracles
```

## Flow 1 - Keeper job (liquidateRange)

```mermaid
sequenceDiagram
    participant K as "Keeper (wallet)"
    participant UI as "Keeper Console (UI)"
    participant LE as "LiquidationEngine"
    participant TM as "TroveManager"
    participant KR as "KeeperRegistry"

    UI->>K: Connect wallet
    UI->>UI: Parse trove list (comma/newline)
    UI->>LE: liquidateRange(troves, start=0, end=N, retries)
    LE->>TM: liquidate or batch liquidate
    TM-->>LE: result (attempted, executed, gas)
    LE->>KR: bump score (optional)
    LE-->>UI: tx hash -> UI fetches job summary
```

**Description**

- The keeper submits a liquidation batch through the UI.
- The LiquidationEngine executes best-effort liquidations, records results, and forwards rewards.
- The KeeperRegistry optionally updates the keeper's score and payout routing.
- The UI polls `getRecentJobs()` for visual feedback.

## Flow 2 - Redemption via VaultManager (MVP)

```mermaid
sequenceDiagram
    participant U as "User"
    participant VM as "VaultManager"
    participant RR as "RedemptionRouter"
    participant TM as "TroveManager"

    U->>VM: deposit MUSD, set config (musdPerRedeem, feeBps, active)
    U->>VM: execute(price) (keeper may relay)
    VM->>RR: redeemExact(...hints)
    RR->>TM: redeemCollateral
    TM-->>RR: redemption filled
    RR-->>VM: amounts returned
    VM-->>U: update balances and pay keeper fee
```

**Description**

- A user pre-funds VaultManager with MUSD and sets parameters.
- A keeper (or the user) calls `execute(price)` to trigger redemptions via RedemptionRouter.
- The router performs the redemption on Mezo's TroveManager, then returns results.
- The VaultManager settles balances internally and credits the keeper fee.

## Notes for reviewers

- The UI supports Demo Mode (scripted events) and Live Mode (on-chain reads/writes).
- Oracles are pluggable: Pyth is the primary feed when available; Skip acts as a fallback or standalone price source.
- `getRecentJobs` powers the activity feed and offers quick transparency during demos.
- All interactions are deterministic and replayable using the included Foundry scripts.

---

> TrovePilot is backend-first: contracts are reusable building blocks for Mezo-native automation.
> The dashboard simply demonstrates how keepers and users interact with those primitives.
