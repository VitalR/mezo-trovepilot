## TrovePilot Redemption Bot (Mezo testnet)

Operator-grade redemption keeper for Mezo/Liquity-style redemptions.

- **Quotes** a redemption attempt deterministically (price + hints + truncation).
- **Executes** exactly one `TrovePilotEngine.redeemHintedTo(...)` per run (MVP).
- **Handles truncation gracefully**: uses `effectiveAmount = truncated` by default; can enforce `STRICT_TRUNCATION=true` to skip.
- **No on-chain hinting**: hints are computed off-chain using on-chain _view_ calls to HintHelpers / SortedTroves.
- **Structured JSON logs**: JSONL events compatible with the liquidation bot style.

### Safety model (defaults)

- **DRY_RUN=true** by default.
- Refuses to send txs unless **CONFIRM=true** (scripts) and `DRY_RUN=false`.
- Explicit fee caps and spend caps are supported; `MAX_NATIVE_SPENT_PER_RUN` requires fee info to be known.
- Redemption partial/early-stop is treated as **success** if the tx succeeds; the engine refunds unused MUSD.

### What it does on-chain

This bot redeems through `TrovePilotEngine`:

- It checks **MUSD allowance for the caller** (`msg.sender`, i.e. tx signer) to the engine.
- If allowance is insufficient and `AUTO_APPROVE=true`, it submits an **approve** tx **from the caller**.
- It calls `redeemHintedTo(effectiveAmount, recipient, firstHint, upperHint, lowerHint, partialNICR, maxIter)` **from the caller**.
- The engine:
  - temporarily holds MUSD (atomic custody),
  - calls core `redeemCollateral`,
  - forwards native BTC collateral (delta) and refunds unused MUSD (delta) to `recipient`.

### Caller vs recipient (important)

- **caller**: the tx signer / `msg.sender`. The caller must hold MUSD and must grant allowance to `TrovePilotEngine`.
- **recipient**: the address that receives **BTC collateral** and **unused MUSD refunds** from the engine. By default, scripts use `recipient == caller`.

### Setup

- Copy `env.example` to `.env` and fill required fields.
- **Redemption requires MUSD inventory**. The keeper is not “paid a reward” like liquidation; redemption is an economic action that typically only makes sense when MUSD can be acquired at a discount vs collateral value (testnet economics may not reflect mainnet incentives).
- Install deps:

```bash
cd keepers/redemption-bot
npm install
```

## Testnet: Run a Redemption End-to-End (Scripts)

This repo includes deterministic **testnet scripts** that let you run a full redemption flow against Mezo testnet via the deployed `TrovePilotEngine` wrapper.

### What redemption does (important mental model)

- The **redeemer pays MUSD** (burned by core) and receives **native BTC collateral** from the system.

- The redemption is **not “redeeming your own trove.”** It redeems against the **lowest-collateralized eligible troves** (based on Mezo’s redemption ordering/rules).

  - This is why the Mezo UI for a borrower can show: _“Loan redeemed by another user”_ — **redemption is permissionless**, unlike liquidation which is triggered by undercollateralization thresholds.

- A borrower whose trove was redeemed may need to **claim remaining collateral** (UI prompt).

### Prerequisites

1. **Env configured** (see `env.example`):

- `MEZO_RPC_URL`

- One signer mode:

  - `KEEPER_PRIVATE_KEY` (recommended), **or**
  - `UNLOCKED_RPC_URL` + `KEEPER_ADDRESS` (node must support `eth_sendTransaction`)

2. **Native gas balance** on Mezo testnet for the signer (`BTC` as native coin).

3. **MUSD balance is required** for redemption.

- You must have `MUSD.balanceOf(KEEPER_ADDRESS) >= REDEEM_MUSD_AMOUNT`.
- If you request more than your MUSD balance, estimation or execution can fail (often with unhelpful revert text).

### Recommended amounts

- **Smoke test**: `REDEEM_MUSD_AMOUNT=100e18` (100 MUSD).
- **Meaningful test**: `REDEEM_MUSD_AMOUNT=2000e18` (2,000 MUSD), _only if you actually have ≥2,000 MUSD_.
- Set `REDEEM_MAX_CHUNK_MUSD` to the same value for a single-shot redemption in scripts.

### Step-by-step commands (recommended workflow)

#### 0) Confirm balances (recommended)

```bash
export RPC=https://rpc.test.mezo.org
export CALLER=<YOUR_KEEPER_EOA>
export MUSD=0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503

cast call $MUSD "balanceOf(address)(uint256)" $CALLER --rpc-url $RPC
cast balance $CALLER --rpc-url $RPC
```

#### 1) Quote redemption (computes hints + writes state)

This computes price (with fallback), computes hint bundle, and prints a quote.

```bash
# Example: 2000 MUSD end-to-end test
export REDEEM_MUSD_AMOUNT=2000000000000000000000
export REDEEM_MAX_CHUNK_MUSD=2000000000000000000000
export MAX_ITERATIONS=50

npm run testnet:quote
```

Output includes:

- `priceE18`
- computed hints (`firstHint`, `upperHint`, `lowerHint`, `partialNICR`)
- seeds/scan tail (debug)
- `planOk=true/false`

State files:

- Latest state: `scripts/testnet/.state/latest.json`
- Snapshots: `scripts/testnet/.state/<timestamp>_*`

#### 2) Prepare allowance (approve MUSD → engine)

First run (dry-run default) will show current allowance:

```bash
npm run testnet:prepare-allowance
```

Then enable auto-approve and actually send the approve tx:

```bash
AUTO_APPROVE=true DRY_RUN=false CONFIRM=true npm run testnet:prepare-allowance
```

Notes:

- Scripts use **approveExact** by default, so allowance is typically fully consumed by the redemption and can become **0** afterward (this is expected).

#### 3) Execute redemption once

```bash
CONFIRM=true DRY_RUN=false npm run testnet:redeem-once
```

What to expect in logs:

- `job_plan` (gas estimate + fee model)
- `tx_sent` (full calldata logged)
- `tx_confirmed`
- `redeem_result` including:
  - `callerMusdDelta` (negative)
  - `recipientNativeDelta` (positive)
  - decoded engine event `RedemptionExecuted`:
    - `musdRequested`
    - `musdRedeemed`
    - `musdRefunded`
    - `collateralOut`

#### 4) Verify post-state (decode engine event + refresh live allowance)

```bash
npm run testnet:verify
```

This script:

- fetches latest price (best-effort)
- decodes engine events from the last redemption tx
- reads **live balances**
- reads **live allowance(caller → engine)** and persists it back into `scripts/testnet/.state/latest.json`

### Known quirks / findings from testnet runs

1. **Price feed read path**

- On Mezo testnet, calling `latestRoundData()` can revert.
- The scripts handle this by falling back to `fetchPrice()` and logging `price_latestRoundData_unavailable_fallback_fetchPrice`.

2. **Allowance going to 0 is normal**

- With `approveExact=true`, flow is:
  - `approve(required)` → allowance = required
  - `redeemHintedTo` pulls `musdRequested` via `transferFrom` → allowance decreases by `musdRequested`
  - often ends at `0`

3. **Redemption can target other accounts**

- Redemption is not tied to the redeemer’s trove.
- It redeems against the system’s lowest-collateralized eligible troves, which can include your “weak test trove” borrower address.

4. **Hints may succeed in quote, but redeem can still fail**

Common causes:

- Insufficient MUSD balance at execution time
- Insufficient allowance (fixed by prepare-allowance)
- Redemption constraints in core (e.g., not enough redeemable amount at current TCR / system conditions)
- Stale hints (if ordering changed between quote and execution)

### Troubleshooting

**A) `approve_needed` but script stops**

- You ran with `AUTO_APPROVE=false` (default). Re-run:

```bash
AUTO_APPROVE=true DRY_RUN=false CONFIRM=true npm run testnet:prepare-allowance
```

**B) `ESTIMATE_REVERT` with `TroveManager: Unable to redeem any amount`**

- Ensure you have enough **MUSD balance** and **allowance**.
- Re-run `testnet:quote` and then `testnet:redeem-once` soon after.
- If the system has nothing redeemable at that moment, it may legitimately revert.

**C) “No BTC transfer visible” in UI**

- Redemption pays out in **native BTC**; you should see the **balance delta** on the redeemer EOA.
- Use:

```bash
cast balance $CALLER --rpc-url $RPC --block <before>
cast balance $CALLER --rpc-url $RPC --block <after>
```

and compare with `recipientNativeDelta` logged by the executor.

### Run (keeper entrypoint)

```bash
cd keepers/redemption-bot
npm start
```

### Chunking (off-chain loop)

Set `REDEEM_MAX_CHUNK_MUSD` to cap one run. Run repeatedly to redeem in chunks.

### Tests

```bash
npm test
```
