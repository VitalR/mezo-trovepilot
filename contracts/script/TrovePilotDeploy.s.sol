// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import "forge-std/Script.sol";
import "forge-std/StdJson.sol";

import { MezoAddresses } from "./MezoAddresses.sol";
import { RedemptionRouter } from "../src/RedemptionRouter.sol";
import { LiquidationEngine } from "../src/LiquidationEngine.sol";

/// @notice Deploys the minimal v2 wrappers (LiquidationEngine, RedemptionRouter) on Mezo testnet.
/// @dev Owner for LiquidationEngine is the deployer (msg.sender).
contract TrovePilotDeployScript is Script {
    using stdJson for string;

    address public deployedRouter;
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
        address pyth;
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

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(pk);

        // Deploy RedemptionRouter (stateless)
        deployedRouter = address(
            new RedemptionRouter(MezoAddresses.TROVE_MANAGER, MezoAddresses.HINT_HELPERS, MezoAddresses.SORTED_TROVES)
        );

        // Deploy LiquidationEngine (stateless except jobId; owner = deployer)
        deployedEngine = address(new LiquidationEngine(MezoAddresses.TROVE_MANAGER));

        vm.stopBroadcast();

        _writeManifest();

        console2.log("=== TrovePilot deployed (Mezo testnet) ===");
        console2.log("RedemptionRouter:", deployedRouter);
        console2.log("LiquidationEngine:", deployedEngine);
        console2.log("Owner (LiquidationEngine):", vm.addr(pk));
    }

    /// @dev Writes updated trovePilot section to configs/addresses.testnet.json, preserving other fields.
    function _writeManifest() internal {
        // projectRoot() returns the contracts/ dir; configs/ lives one level up.
        string memory path = string.concat(vm.projectRoot(), "/../configs/addresses.testnet.json");

        AddressesCfg memory cfg = _loadConfig(path);
        cfg.trovePilot.liquidationEngine = deployedEngine;
        cfg.trovePilot.redemptionRouter = deployedRouter;

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
            '      "pyth": "',
            vm.toString(cfg.mezo.price.pyth),
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
            priceFeed: MezoAddresses.PRICE_FEED, skipOracle: MezoAddresses.SKIP_ORACLE, pyth: MezoAddresses.PYTH_ORACLE
        });

        // If file exists, parse and reuse existing fields.
        try vm.readFile(path) returns (string memory raw) {
            if (bytes(raw).length > 0) {
                try vm.parseJson(raw) returns (bytes memory parsed) {
                    cfg = abi.decode(parsed, (AddressesCfg));
                } catch { }
            }
        } catch { }
    }
}
