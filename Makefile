# ========= Mezo TrovePilot – Makefile =========
# Usage examples:
#   make help
#   make build
#   make test
#   make test MATCH=Redeem_UsingRealUserBalance
#   make test-fork MATCH=TrovePilotIntegrationTest -- runs with MEZO fork
#   make deploy-testnet
#   make verify-address ADDR=0x... CONTRACT=src/RedemptionRouter.sol:RedemptionRouter
# ==============================================

SHELL := /usr/bin/env bash

# --- Config ---
ENV_FILE       ?= .env.testnet           # contains MEZO_RPC and DEPLOYER_PRIVATE_KEY
CHAIN_ID       ?= 31611
RPC_URL        ?= https://rpc.test.mezo.org
BLOCKSCOUT_API ?= https://api.explorer.test.mezo.org/api/

# Deploy script & contract names
DEPLOY_SCRIPT  ?= script/TrovePilotDeploy.s.sol:TrovePilotDeployScript

# Test matching (you can override: make test MATCH=MyTestName)
MATCH          ?=

# Helper to source env for each command
env = set -euo pipefail; source $(ENV_FILE);

# --- Meta ---
.PHONY: help
help:
	@echo ""
	@echo "TrovePilot – common tasks"
	@echo "-------------------------"
	@echo "make install                # forge install (submodules / deps)"
	@echo "make build                  # forge build"
	@echo "make clean                  # clean artifacts"
	@echo "make fmt                    # auto-format"
	@echo "make fmt-check              # format check only"
	@echo "make snapshot               # gas snapshots"
	@echo "make coverage               # coverage report"
	@echo "make test [MATCH=...]       # run tests"
	@echo "make test-fork [MATCH=...]  # run tests on Mezo fork (needs MEZO_RPC)"
	@echo "make deploy-testnet         # deploy + verify on Mezo testnet"
	@echo "make verify-address ADDR=0x.. CONTRACT=src/File.sol:Name"
	@echo "make verify-router          # convenience verify for RedemptionRouter (ADDR=...)"
	@echo "make verify-batcher         # convenience verify for LiquidationBatcher (ADDR=...)"
	@echo ""

# --- Project hygiene ---
.PHONY: install
install:
	forge install

.PHONY: build
build:
	forge build -vv

.PHONY: clean
clean:
	forge clean

.PHONY: fmt
fmt:
	forge fmt

.PHONY: fmt-check
fmt-check:
	forge fmt --check

.PHONY: snapshot
snapshot:
	forge snapshot -vv

.PHONY: coverage
coverage:
	forge coverage -vv

# --- Tests ---
.PHONY: test
test:
	forge test $(if $(MATCH),--match-test "$(MATCH)",) -vvv

# Run tests with live Mezo fork (reads MEZO_RPC from $(ENV_FILE))
.PHONY: test-fork
test-fork:
	@bash -lc '$(env) forge test $(if $(MATCH),--match-test "$(MATCH)",) --fork-url "$$MEZO_RPC" -vvv'

# Handy target for the specific user-balance redeem test from your suite
.PHONY: test-redeem-user
test-redeem-user:
	@bash -lc '$(env) forge test --match-test test_Redeem_UsingRealUserBalance --fork-url "$$MEZO_RPC" -vvv'

# Optional: pin a fork block (override with: make test-fork-at BLOCK=8235732)
BLOCK ?=
.PHONY: test-fork-at
test-fork-at:
	@bash -lc '$(env) forge test $(if $(MATCH),--match-test "$(MATCH)",) --fork-url "$$MEZO_RPC" $(if $(BLOCK),--fork-block-number $(BLOCK),) -vvv'

# --- Deploy & Verify (Blockscout) ---
# One-shot deploy + verify (uses $(ENV_FILE) for MEZO_RPC and DEPLOYER_PRIVATE_KEY)
.PHONY: deploy-testnet
deploy-testnet:
	@bash -lc '$(env) forge script $(DEPLOY_SCRIPT) \
	  --rpc-url "$$MEZO_RPC" \
	  --private-key "$$DEPLOYER_PRIVATE_KEY" \
	  --broadcast \
	  --verify \
	  --verifier blockscout \
	  --verifier-url "$(BLOCKSCOUT_API)" \
	  -vvvv'

# Post-deploy verification helpers
# Usage:
#  make verify-address ADDR=0x... CONTRACT=src/RedemptionRouter.sol:RedemptionRouter
ADDR     ?=
CONTRACT ?=

.PHONY: verify-address
verify-address:
	@test -n "$(ADDR)" || (echo "ERR: please provide ADDR=0x..."; exit 1)
	@test -n "$(CONTRACT)" || (echo "ERR: please provide CONTRACT=src/File.sol:Name"; exit 1)
	forge verify-contract \
	  --rpc-url "$(RPC_URL)" \
	  --verifier blockscout \
	  --verifier-url '$(BLOCKSCOUT_API)' \
	  $(ADDR) \
	  $(CONTRACT)

# Convenience wrappers (set ADDR=...)
.PHONY: verify-router verify-batcher
verify-router:
	@test -n "$(ADDR)" || (echo "ERR: provide ADDR=router_address"; exit 1)
	$(MAKE) verify-address ADDR=$(ADDR) CONTRACT=src/RedemptionRouter.sol:RedemptionRouter

verify-batcher:
	@test -n "$(ADDR)" || (echo "ERR: provide ADDR=batcher_address"; exit 1)
	$(MAKE) verify-address ADDR=$(ADDR) CONTRACT=src/LiquidationBatcher.sol:LiquidationBatcher

# --- Extras ---
# Export ABIs for frontend (outputs JSON to ./abi/)
ABI_OUT ?= abi
.PHONY: abi
abi:
	mkdir -p $(ABI_OUT)
	forge inspect RedemptionRouter abi > $(ABI_OUT)/RedemptionRouter.json
	forge inspect LiquidationBatcher abi > $(ABI_OUT)/LiquidationBatcher.json
	@echo "ABIs written to $(ABI_OUT)/"

# Encode example (constructor for RedemptionRouter)
.PHONY: encode-router-ctor
encode-router-ctor:
	@cast abi-encode 'constructor(address,address,address)' \
	  0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 \
	  0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 \
	  0x722E4D24FD6Ff8b0AC679450F3D91294607268fA | xargs echo "ctor args:"
