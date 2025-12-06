# Migration Guide — TrovePilot v1 → TrovePilot v2

**Version:** December 2025  
**Audience:** Developers upgrading from hackathon version to v2

---

# 1. Philosophy Shift

TrovePilot v1 (hackathon) was designed as a **strategy-oriented execution engine + scoring registry** with broader ambitions:

- dynamic liquidation strategy  
- inline heuristics  
- on-chain keeper scoring  
- reward forwarding with fee sinks  
- yield modules (VaultManager, YieldAggregator)  
- partial peg-defense features

TrovePilot v2 removes all of that.

### v2 Focuses Exclusively On:
- stateless execution wrappers  
- clean interaction with Mezo core  
- off-chain bots deciding strategies  
- structured events  
- minimal risk and surface area

---

# 2. Removed in v2

| Component | Status | Reason |
|----------|--------|--------|
| VaultManager | ❌ Removed | Not aligned with Mezo peg-defense (SafetyBuffer owns this domain) |
| YieldAggregator | ❌ Removed | Out of scope; introduces custodial complexity |
| Keeper scoring incentives | Optional | v2 provides a minimal standalone registry only |
| On-chain profit logic | ❌ Removed | Off-chain bots handle profitability |
| Slippage checks | ❌ Removed | Off-chain simulation decides safe bounds |
| Reward redistribution | ❌ Removed | Protocol should not rely on TP for redistribution |
| Strategy parameters | ❌ Removed | Off-chain bots define strategy |
| Automation layer / job system | ❌ Removed | Not in scope for v2 |

Everything tying TrovePilot to *strategy logic* or *capital logic* is gone.

---

# 3. What Remains (Improved)

| v1 Component | v2 Equivalent |
|--------------|---------------|
| LiquidationBatcher | `LiquidationEngine` |
| Redemption helper | `RedemptionRouter` |
| DEX swap logic | `DexAdapter_Tigris` |
| Loop logic (hackathon) | `RedemptionLoopExecutor` (cleaner/simpler) |

---

# 4. API Changes

### liquidations
```
v1: liquidationBatch(...)
v2: liquidateRange(...)
```
- simpler interface  
- full fallback logic remains  
- scoring is optional  

### redemptions  
```
v1: redeem(...)
v2: redeemQuick / redeemExact
```

Clear separation between simple vs hint-assisted flows.

### redemption loops  
```
v1: executeLoop(...)
v2: executeLoop(...) (renamed parameters, cleaner)
```

---

# 5. Deployment Layout Changes

Recommended folder structure:

/contracts/src
```
LiquidationEngine.sol
RedemptionRouter.sol
RedemptionLoopExecutor.sol
DexAdapter_Tigris.sol
```

/sdk
```
calldata builders
trove helpers
```

/bots
```
liquidation-bot
redemption-bot
loop-bot
```

/docs
```
README_v2.md
ARCHITECTURE_V2.md
CONTRACTS_V2.md
MIGRATION_V1_TO_V2.md
```


---

# 6. Required Migration Steps

1. **Remove deprecated contracts**  
   (`VaultManager`, `YieldAggregator`, unused scoring paths)

2. **Deploy new v2 wrappers**  
   - LiquidationEngine  
   - RedemptionRouter  
   - RedemptionLoopExecutor  
   - DexAdapter_Tigris  

3. **Update bots to use new SDK**  
   - liquidation bot: `liquidateRange()`  
   - redemption bot: choose quick/hinted  
   - loop bot: new swap API  

4. **Drop v1 dashboard logic**  
   Dashboard is optional and can be replaced.

5. **Audit scripts & CI**  
   Ensure tests match the new reduced surface area.

---

# 7. Recommendations

- Keep v1 in a separate branch:  
  `archive/hackathon-v1`  
- Use v2 as the foundation for Mezo-compatible mainnet release  
- Minimize any new storage variables in future additions  
- Keep strategy off-chain always


