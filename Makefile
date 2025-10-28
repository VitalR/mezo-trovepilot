# ========= Mezo TrovePilot – Makefile =========
# Usage examples:
#   make help
#   make update build test snapshot coverage
#   make test MATCH=Redeem_UsingRealUserBalance
#   make test-fork MATCH=TrovePilotLocalIntegrationTest  # runs with MEZO fork
#   make deploy-testnet  # deploy + verify on testnet
#   make demo-testnet    # run e2e demo script on testnet
#   make verify-address ADDR=0x... CONTRACT=src/File.sol:Name
# ==============================================

SHELL := /usr/bin/env bash

# Auto-load env if present (does not fail if missing)
-include .env

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
.PHONY: help install update build clean fmt fmt-check test test-fork deploy-testnet demo-testnet verify-address verify-router verify-engine check-env
help:
	@echo ""
	@echo "TrovePilot – common tasks"
	@echo "-------------------------"
	@echo "make install                # forge install (submodules / deps)"
	@echo "make build                  # forge build"
	@echo "make clean                  # clean artifacts"
	@echo "make fmt                    # auto-format"
	@echo "make fmt-check              # format check only"
	@echo "make test [MATCH=...]       # run tests"
	@echo "make test-fork [MATCH=...]  # run tests on Mezo fork (needs MEZO_RPC)"
	@echo "make deploy-testnet         # deploy + verify on Mezo testnet"
	@echo "make demo-testnet           # run end-to-end demo script on Mezo testnet"
	@echo "make verify-address ADDR=0x.. CONTRACT=src/File.sol:Name"
	@echo "make verify-router          # convenience verify for RedemptionRouter (ADDR=...)"
	@echo "make verify-engine          # convenience verify for LiquidationEngine (ADDR=...)"
	@echo ""

# --- Project hygiene ---
install:
	forge install

build:
	forge build -vv

clean:
	forge clean

fmt:
	forge fmt

fmt-check:
	forge fmt --check

# --- Tests ---
test:
	forge test $(if $(MATCH),--match-test "$(MATCH)",) -vvv

# Run tests with live Mezo fork (reads MEZO_RPC from $(ENV_FILE))
test-fork:
	@bash -lc '$(env) forge test $(if $(MATCH),--match-test "$(MATCH)",) --fork-url "$$MEZO_RPC" -vvv'

# --- Deploy & Verify (Blockscout) ---
# One-shot deploy + verify (uses $(ENV_FILE) for MEZO_RPC and DEPLOYER_PRIVATE_KEY)
.PHONY: deploy-testnet
deploy-testnet:
	@bash -lc '$(env) forge script $(DEPLOY_SCRIPT) \
	  --rpc-url "$$MEZO_RPC" \
	  --private-key "$$DEPLOYER_PRIVATE_KEY" \
	  --broadcast \
	  --slow \
	  --verify \
	  --verifier blockscout \
	  --verifier-url "$(BLOCKSCOUT_API)" \
	  -vvvv'

# Run demo script on testnet (reads addresses from env or deploys minimal fresh ones)
.PHONY: demo-testnet
demo-testnet:
	@bash -lc '$(env) forge script script/TrovePilotDemo.s.sol:TrovePilotDemoScript \
	  --rpc-url "$$MEZO_RPC" \
	  --private-key "$$DEPLOYER_PRIVATE_KEY" \
	  --broadcast \
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
.PHONY: verify-router verify-engine
verify-router:
	@test -n "$(ADDR)" || (echo "ERR: provide ADDR=router_address"; exit 1)
	$(MAKE) verify-address ADDR=$(ADDR) CONTRACT=src/RedemptionRouter.sol:RedemptionRouter

verify-engine:
	@test -n "$(ADDR)" || (echo "ERR: provide ADDR=engine_address"; exit 1)
	$(MAKE) verify-address ADDR=$(ADDR) CONTRACT=src/LiquidationEngine.sol:LiquidationEngine

# --- Extras ---
# Export ABIs for frontend (outputs JSON to ./abi/)
ABI_OUT ?= abi
.PHONY: abi
abi:
	mkdir -p $(ABI_OUT)
	forge inspect RedemptionRouter abi > $(ABI_OUT)/RedemptionRouter.json
	forge inspect LiquidationEngine abi > $(ABI_OUT)/LiquidationEngine.json
	forge inspect VaultManager abi > $(ABI_OUT)/VaultManager.json
	forge inspect YieldAggregator abi > $(ABI_OUT)/YieldAggregator.json
	forge inspect KeeperRegistry abi > $(ABI_OUT)/KeeperRegistry.json
	@echo "ABIs written to $(ABI_OUT)/"

# --- Utilities ---
.PHONY: check-env
check-env:
	@bash -lc 'set -euo pipefail; \
	  if [ ! -f $(ENV_FILE) ]; then echo "WARN: $(ENV_FILE) not found (using shell env)"; fi; \
	  : $${MEZO_RPC?Need MEZO_RPC}; : $${DEPLOYER_PRIVATE_KEY?Need DEPLOYER_PRIVATE_KEY}; \
	  echo "Env OK"'
