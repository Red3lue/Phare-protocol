// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SlashPool} from "../src/SlashPool.sol";
import {ReportRegistry} from "../src/ReportRegistry.sol";
import {Lighthouse} from "../src/Lighthouse.sol";

interface INameWrapperApproval {
    function setApprovalForAll(address operator, bool approved) external;
}

/// @title  Deploy — atomic deployment of Phare's three contracts on Sepolia
/// @notice Order: SlashPool → ReportRegistry → Lighthouse → wire-up.
///         SlashPool's `registry` and ReportRegistry's `slashPool` are both
///         immutable, so we pre-compute ReportRegistry's address with
///         `vm.computeCreateAddress` before deploying SlashPool.
/// @dev    Loads config from env vars with safe defaults for Sepolia.
///         Required env: DEPLOYER_PRIVATE_KEY, VESSEL_PARENT_NODE, VERIFIER_PARENT_NODE.
///         Optional env: SEPOLIA_USDC, UMA_OOV3, ENS_NAMEWRAPPER, ENS_PUBLIC_RESOLVER,
///                       TREASURY, ORBITAL_ATTESTOR, BOND_AMOUNT, LIVENESS.
contract Deploy is Script {
    function run() external {
        // ─── Config ──────────────────────────────────────────────────────
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address usdc = vm.envOr(
            "SEPOLIA_USDC", address(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238)
        );
        address uma = vm.envOr(
            "UMA_OOV3", address(0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB)
        );
        address nameWrapper = vm.envOr(
            "ENS_NAMEWRAPPER", address(0x0635513f179D50A207757E05759CbD106d7dFcE8)
        );
        address resolver = vm.envOr(
            "ENS_PUBLIC_RESOLVER", address(0x8FADE66B79cC9f707aB26799354482EB93a5B7dD)
        );

        bytes32 vesselParent = vm.envBytes32("VESSEL_PARENT_NODE");
        bytes32 verifierParent = vm.envBytes32("VERIFIER_PARENT_NODE");

        address treasury = vm.envOr("TREASURY", deployer);
        address orbitalAttestor = vm.envOr("ORBITAL_ATTESTOR", deployer);
        uint128 bondAmount = uint128(vm.envOr("BOND_AMOUNT", uint256(5_000_000)));
        uint64 liveness = uint64(vm.envOr("LIVENESS", uint256(60)));

        // ─── Pre-compute ReportRegistry address (deployed at nonce+1) ───
        uint64 nonce = vm.getNonce(deployer);
        address predictedRegistry = vm.computeCreateAddress(deployer, nonce + 1);

        console2.log("Deployer            :", deployer);
        console2.log("Predicted Registry  :", predictedRegistry);

        // ─── Deploy ──────────────────────────────────────────────────────
        vm.startBroadcast(deployerKey);

        // 1. SlashPool — wired to the predicted ReportRegistry address
        SlashPool slashPool = new SlashPool(usdc, predictedRegistry);

        // 2. ReportRegistry — must land at the predicted address
        ReportRegistry registry = new ReportRegistry(
            usdc,
            uma,
            address(slashPool),
            treasury,
            orbitalAttestor,
            bondAmount,
            liveness
        );
        require(address(registry) == predictedRegistry, "registry address mismatch");

        // 3. Lighthouse — depends on registry
        Lighthouse lighthouse = new Lighthouse(
            nameWrapper,
            resolver,
            vesselParent,
            verifierParent,
            address(registry)
        );

        // 4. Wire setLighthouse on the registry (settable once)
        registry.setLighthouse(address(lighthouse));

        // 5. Approve Lighthouse as NameWrapper operator across deployer's
        //    wrapped names. Covers both vessel.phare.eth and verifier.phare.eth.
        INameWrapperApproval(nameWrapper).setApprovalForAll(address(lighthouse), true);

        vm.stopBroadcast();

        // ─── Summary ─────────────────────────────────────────────────────
        console2.log("SlashPool           :", address(slashPool));
        console2.log("ReportRegistry      :", address(registry));
        console2.log("Lighthouse          :", address(lighthouse));
        console2.log("Treasury            :", treasury);
        console2.log("OrbitalAttestor     :", orbitalAttestor);
    }
}
