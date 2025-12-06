## TrovePilot — Mission & Roadmap

Version: December 2025  
Status: Public Reference

---

### Mission Statement

TrovePilot provides transparent, permissionless execution tools that help community keepers interact with Mezo’s liquidation and redemption mechanisms safely and efficiently.

The goals are simple:
- Make Mezo’s liquidation and redemption flows easier to use
- Provide clean, minimal on-chain execution wrappers
- Enable off-chain keeper bots to run safe, transparent strategies
- Avoid overlapping with protocol-owned logic such as SafetyBuffer
- Support the Mezo ecosystem with reliable tooling

TrovePilot is not a protocol, not a vault product, and not an automation network — it is a lightweight execution toolkit designed to help Mezo’s community of keepers operate more effectively.


## Roadmap (Mezo-Focused, Practical, Aligned with Mezo)

A concise, achievable roadmap aligned with Mezo’s automation philosophy (“thin on-chain, logic off-chain”).

### Phase 1 — Execution Primitives

**Goal:** Deliver the minimal set of safe, transparent building blocks for keeper operations.

**Deliverables:**
- LiquidationEngine v2
- RedemptionRouter v2
- RedemptionLoopExecutor (Tigris integration)
- DexAdapter_Tigris
- Basic event schemas for monitoring
- Foundry test suite & invariant checks
- Initial documentation

**Outcome:**
A clean, auditable execution layer with no strategy or state, ready for off-chain automation.

---

### Phase 2 — Keeper Tooling & SDK

**Goal:** Make it easy for community members to run keepers.

**Deliverables:**
- TrovePilot SDK (`@trovepilot/sdk`)
- Redemption loop bot (reference implementation)
- Liquidation bot (reference implementation)
- Monitoring / alerting scripts
- Demo dashboard updates (optional)

**Outcome:** 
Community keepers can run bots locally or extend the SDK, enabling open participation.

---

### Phase 3 — Hardening & Mainnet Readiness

**Goal:** Prepare TrovePilot for stable and safe mainnet usage.

**Deliverables:**
- Code freeze for v2 contracts
- Audit preparation (coverage, fuzzing, docs)
- Integration tests on Mezo testnet
- Example keeper configurations
- Optional LOI milestone with Mezo

**Outcome:** 
A battle-tested keeper toolkit that Mezo community members can safely depend on.

---

### Scope Boundaries

To avoid overlap with core protocol initiatives:

**TrovePilot Will Not:**
- Manage protocol-owned capital  
- Implement peg-defense policy  
- Custody user funds  
- Introduce tokenomics or staking  
- Replace SafetyBuffer  
- Provide on-chain automation logic  
- Run a keeper marketplace or job network  

**TrovePilot Will:**
- Provide safe contract wrappers for Mezo flows  
- Help keepers interact with Mezo efficiently  
- Offer off-chain reference bots and simulator tools  
- Stay fully permissionless and transparent  
- Support community-driven stability operations  

---
>### Future Evolution (Optional, Based on Demand)
>TrovePilot is currently focused on execution primitives and off-chain automation tooling.  
If the ecosystem finds value in the toolkit and adoption grows, future expansions may be explored — but only if they remain aligned with Mezo’s architecture and community needs.