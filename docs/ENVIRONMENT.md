# TrovePilot Environment Configuration

This guide lists the environment variables required to run the demo scripts and the Next.js dashboard. Copy the snippets into your local `.env`, `.env.local`, or script environment as needed.

## Backend / Scripts

These variables are consumed by the Foundry scripts (`TrovePilotDeploy.s.sol`, `TrovePilotDemo.s.sol`, `TroveHintDump.s.sol`).

| Key | Required | Description |
| --- | --- | --- |
| `MEZO_RPC` | ✅ | Mezo testnet RPC URL. Used when running scripts with `--rpc-url $MEZO_RPC`. |
| `DEPLOYER_PRIVATE_KEY` | ✅ (deploy/demo) | Hex-encoded private key used to sign transactions. |
| `DEPLOY_REGISTRY` | ▫️ | When `true`, deploy `KeeperRegistry` alongside the core suite. |
| `AUTHORIZERS` | ▫️ | Comma-separated addresses granted as LiquidationEngine authorizers during deployment. |
| `DEMO_REDEEM_AMOUNT` | ▫️ | Redemption amount (wei) for `TrovePilotDemo`. Defaults to `10e18`. |
| `DEMO_MAX_ITER` | ▫️ | `VaultManager` max iterations hint. Defaults to `5`. |
| `DEMO_KEEPER_FEE_BPS` | ▫️ | Keeper fee basis points (uint16). Defaults to `100` (1%). |
| `DEMO_ENGINE_FUND` | ▫️ | MUSD amount to pre-fund the engine during the demo script. Defaults to `1e18`. |
| `USER` | ▫️ | Alternate address to act as the demo user; defaults to the deployer wallet. |
| `KEEPER_PAYTO` | ▫️ | Optional payout override stored in `KeeperRegistry`. |
| `PRICE_OVERRIDE` | ▫️ | Manual oracle price when on-chain feeds are inactive. |
| `SORTED_TROVES_ADDR` | ▫️ | Override SortedTroves address for `TroveHintDump`. Defaults to `MezoAddresses.SORTED_TROVES`. |
| `TROVE_DUMP_LIMIT` | ▫️ | Count of troves to export via `TroveHintDump`. Defaults to `8`. |
| `TROVE_DUMP_SKIP` | ▫️ | Number of SortedTroves entries to skip before sampling. Defaults to `0`. |
| `TROVE_DUMP_OUT` | ▫️ | File path to write the fallback CSV (empty string = stdout only). |
| `TROVE_DUMP_PREFIX` | ▫️ | Optional string prepended to the CSV output (handy for env files). |

## Frontend (Next.js Dashboard)

Create `ui/.env.local` with the following keys. Values shown are Mezo testnet defaults—replace them with your deployed addresses when running on a fork or alternative network.

```bash
NEXT_PUBLIC_RPC_URL=https://rpc.test.mezo.org
NEXT_PUBLIC_WC_PROJECT_ID=00000000000000000000000000000000

# TrovePilot contracts
NEXT_PUBLIC_ENGINE=0xd4c83DF44115999261b97A9321D44467FA12A94e
NEXT_PUBLIC_VAULT=0x56175AEC4F829df45649885e52F0DF0AD928B336
NEXT_PUBLIC_AGGREGATOR=0x7369e88CA0e58Db31185759c1B3199d8e4E4aC8b
NEXT_PUBLIC_REGISTRY=0x5C42320Ea8711E3fB811e136d87fe9a6B4d02025
NEXT_PUBLIC_ROUTER=0xe418f2Ab2fE248BAc5349a6FAbF338824Cd0a10A

# Oracle controls
NEXT_PUBLIC_DEFAULT_ORACLE_SOURCE=skip
NEXT_PUBLIC_PYTH_CONTRACT=0x2880aB155794e7179c9eE2e38200202908C17B43
NEXT_PUBLIC_PYTH_PRICE_ID=0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43  # BTC/USD
NEXT_PUBLIC_PYTH_MAX_AGE_SECONDS=3600

# Trove hints
NEXT_PUBLIC_SORTED_TROVES=0x722E4D24FD6Ff8b0AC679450F3D91294607268fA
NEXT_PUBLIC_TROVE_HINT_LIMIT=6
NEXT_PUBLIC_TROVE_FALLBACK_LIST=0x123694886DBf5Ac94DDA07135349534536D14cAf,0x8f2b368d78D51a679B82350A9BF55133f273A56f,0x4F5723979a70eACd03155a3cD0596f40Fe2fed46,0xcdb631b220cC680F8d756b3A0a0f4c1C271887a2,0x0781934b8E7267762f46cEb38bA2cfd01D25C1B4,0x82D6B86f820A9d912eF0b615bD8b9c4f947E8684,0x08a1D63589A52455E90CA1eC01c8D48C54a84Ed0,0xd15190548Bf6B3E5FD98A385F7e49046aCC2B02d

# Footer links (optional)
NEXT_PUBLIC_FAQ_URL=https://github.com/VitalR/mezo-trovepilot#readme
NEXT_PUBLIC_TROVEPILOT_DOCS_URL=https://github.com/VitalR/mezo-trovepilot/tree/main/docs
NEXT_PUBLIC_GITHUB_URL=https://github.com/VitalR/mezo-trovepilot
```

### Oracle Fallback Workflow

1. Run `forge script script/TroveHintDump.s.sol --rpc-url $MEZO_RPC --sig "run()"` to snapshot live troves.
2. Copy the emitted CSV (or the file written via `TROVE_DUMP_OUT`) into `NEXT_PUBLIC_TROVE_FALLBACK_LIST`.
3. The dashboard will auto-populate trove suggestions and allow keepers to proceed even if SortedTroves stops returning entries.
4. When the oracle feed is degraded, toggle the UI override checkbox to acknowledge the warning before running keeper jobs.

### Demo vs Live Modes

- **Demo Mode (default):** Uses scripted storyline data. Toggle off to enter live keeper mode once your env variables are configured.
- **Live Mode:** Requires wallet connection and valid contract addresses. The oracle dropdown lets you switch between Skip (default) and Pyth when both contract and price-ID envs are set.

Keep this file updated as new configuration knobs are added so future contributors can bootstrap quickly.
