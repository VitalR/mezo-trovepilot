// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";

import { MezoAddresses } from "./MezoAddresses.sol";
import { TrovePilotEngine } from "../src/TrovePilotEngine.sol";

/// @title DeployTrovePilotEngineScript
/// @notice Deploys `TrovePilotEngine` and updates `configs/addresses.testnet.json` (or CONFIG_PATH override).
/// @dev Uses `DEPLOYER_PRIVATE_KEY` for broadcasting.
///      Optional env vars:
///      - `CONFIG_PATH`: JSON manifest path (defaults to `../configs/addresses.testnet.json`)
///      - `OWNER`: owner of `TrovePilotEngine` (defaults to deployer)
contract DeployTrovePilotEngineScript is Script {
    using stdJson for string;

    address public deployedEngine;

    struct Core {
        address troveManager;
        address hintHelpers;
        address sortedTroves;
        address borrowerOperations;
    }

    struct Tokens {
        address musd;
    }

    struct Price {
        address priceFeed;
        address skipOracle;
        address pythOracle;
    }

    struct MezoCfg {
        Core core;
        Tokens tokens;
        Price price;
    }

    struct TrovePilotCfg {
        address liquidationEngine;
        address redemptionRouter;
    }

    struct AddressesCfg {
        uint256 chainId;
        string network;
        MezoCfg mezo;
        TrovePilotCfg trovePilot;
    }

    function run() external returns (address deployed) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory path = _resolveConfigPath();
        AddressesCfg memory cfg = _loadConfig(path);

        address owner = vm.addr(pk);
        try vm.envAddress("OWNER") returns (address o) {
            owner = o;
        } catch { }

        vm.startBroadcast(pk);
        deployedEngine = address(new TrovePilotEngine(cfg.mezo.core.troveManager, cfg.mezo.tokens.musd, owner));
        vm.stopBroadcast();

        _writeManifest(path, deployedEngine);

        console2.log("=== TrovePilotEngine deployed ===");
        console2.log("TrovePilotEngine:", deployedEngine);
        console2.log("Owner:", owner);

        return deployedEngine;
    }

    /// @dev Writes updated trovePilot section to `path`, preserving other fields.
    function _writeManifest(string memory path, address engine) internal {
        AddressesCfg memory cfg = _loadConfig(path);
        cfg.trovePilot.liquidationEngine = engine;

        string memory json = string.concat(
            "{\n",
            '  "chainId": ',
            vm.toString(cfg.chainId),
            ",\n",
            '  "network": "',
            cfg.network,
            '",\n',
            '  "mezo": {\n',
            '    "core": {\n',
            '      "troveManager": "',
            vm.toString(cfg.mezo.core.troveManager),
            '",\n',
            '      "hintHelpers": "',
            vm.toString(cfg.mezo.core.hintHelpers),
            '",\n',
            '      "sortedTroves": "',
            vm.toString(cfg.mezo.core.sortedTroves),
            '",\n',
            '      "borrowerOperations": "',
            vm.toString(cfg.mezo.core.borrowerOperations),
            '"\n',
            "    },\n",
            '    "tokens": {\n',
            '      "musd": "',
            vm.toString(cfg.mezo.tokens.musd),
            '"\n',
            "    },\n",
            '    "price": {\n',
            '      "priceFeed": "',
            vm.toString(cfg.mezo.price.priceFeed),
            '",\n',
            '      "skipOracle": "',
            vm.toString(cfg.mezo.price.skipOracle),
            '",\n',
            '      "pythOracle": "',
            vm.toString(cfg.mezo.price.pythOracle),
            '"\n',
            "    }\n",
            "  },\n",
            '  "trovePilot": {\n',
            '    "liquidationEngine": "',
            vm.toString(cfg.trovePilot.liquidationEngine),
            '",\n',
            '    "redemptionRouter": "',
            vm.toString(cfg.trovePilot.redemptionRouter),
            '"\n',
            "  }\n",
            "}\n"
        );

        vm.writeFile(path, json);
    }

    function _loadConfig(string memory path) internal view returns (AddressesCfg memory cfg) {
        // Defaults based on MezoAddresses for first-time creation.
        cfg.chainId = MezoAddresses.CHAIN_ID;
        cfg.network = "mezo-testnet";
        cfg.mezo.core = Core({
            troveManager: MezoAddresses.TROVE_MANAGER,
            hintHelpers: MezoAddresses.HINT_HELPERS,
            sortedTroves: MezoAddresses.SORTED_TROVES,
            borrowerOperations: MezoAddresses.BORROWER_OPERATIONS
        });
        cfg.mezo.tokens = Tokens({ musd: MezoAddresses.MUSD });
        cfg.mezo.price = Price({
            priceFeed: MezoAddresses.PRICE_FEED,
            skipOracle: MezoAddresses.SKIP_ORACLE,
            pythOracle: MezoAddresses.PYTH_ORACLE
        });
        cfg.trovePilot = TrovePilotCfg({ liquidationEngine: address(0), redemptionRouter: address(0) });

        // If file exists, parse and reuse existing fields (best-effort).
        try vm.readFile(path) returns (string memory raw) {
            if (bytes(raw).length == 0) return cfg;

            if (raw.keyExists(".chainId")) cfg.chainId = raw.readUint(".chainId");
            if (raw.keyExists(".network")) cfg.network = raw.readString(".network");

            if (raw.keyExists(".mezo.core.troveManager")) {
                cfg.mezo.core.troveManager = raw.readAddress(".mezo.core.troveManager");
            }
            if (raw.keyExists(".mezo.core.hintHelpers")) {
                cfg.mezo.core.hintHelpers = raw.readAddress(".mezo.core.hintHelpers");
            }
            if (raw.keyExists(".mezo.core.sortedTroves")) {
                cfg.mezo.core.sortedTroves = raw.readAddress(".mezo.core.sortedTroves");
            }
            if (raw.keyExists(".mezo.core.borrowerOperations")) {
                cfg.mezo.core.borrowerOperations = raw.readAddress(".mezo.core.borrowerOperations");
            }

            if (raw.keyExists(".mezo.tokens.musd")) cfg.mezo.tokens.musd = raw.readAddress(".mezo.tokens.musd");

            if (raw.keyExists(".mezo.price.priceFeed")) {
                cfg.mezo.price.priceFeed = raw.readAddress(".mezo.price.priceFeed");
            }
            if (raw.keyExists(".mezo.price.skipOracle")) {
                cfg.mezo.price.skipOracle = raw.readAddress(".mezo.price.skipOracle");
            }
            if (raw.keyExists(".mezo.price.pythOracle")) {
                cfg.mezo.price.pythOracle = raw.readAddress(".mezo.price.pythOracle");
            }

            if (raw.keyExists(".trovePilot.liquidationEngine")) {
                cfg.trovePilot.liquidationEngine = raw.readAddress(".trovePilot.liquidationEngine");
            }
            if (raw.keyExists(".trovePilot.redemptionRouter")) {
                cfg.trovePilot.redemptionRouter = raw.readAddress(".trovePilot.redemptionRouter");
            }
        } catch { }
    }

    function _resolveConfigPath() internal view returns (string memory path) {
        // projectRoot() returns the contracts/ dir; configs/ lives one level up.
        path = string.concat(vm.projectRoot(), "/../configs/addresses.testnet.json");
        try vm.envString("CONFIG_PATH") returns (string memory p) {
            if (bytes(p).length != 0) path = p;
        } catch { }
    }
}

