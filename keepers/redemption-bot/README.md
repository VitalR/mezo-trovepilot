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
- Install deps:

```bash
cd keepers/redemption-bot
npm install
```

### Run (keeper entrypoint)

```bash
cd keepers/redemption-bot
npm start
```

### Testnet scripts (safe-by-default)

These persist `.state/latest.json` + snapshots under `.state/runs/`.

- Safety gates:

  - Scripts will only send txs when **`DRY_RUN=false` AND `CONFIRM=true`**.
  - Read-only scripts (`quote`, `verify`) do not require `CONFIRM`.

- Prepare allowance (read-only by default; can auto-approve):

```bash
npm run testnet:prepare-allowance
```

- Quote a redemption (price + hints + truncation + seeds):

```bash
npm run testnet:quote
```

- Execute a single redemption:

```bash
CONFIRM=true DRY_RUN=false npm run testnet:redeem-once
```

- Verify post-state / deltas:

```bash
npm run testnet:verify
```

### Chunking (off-chain loop)

Set `REDEEM_MAX_CHUNK_MUSD` to cap one run. Run repeatedly to redeem in chunks.

### Tests

```bash
npm test
```
