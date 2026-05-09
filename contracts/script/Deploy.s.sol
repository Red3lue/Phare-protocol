// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console}     from "forge-std/Script.sol";
import {ReportRegistry}      from "../src/ReportRegistry.sol";
import {SlashPool}           from "../src/SlashPool.sol";
import {IERC20}              from "../src/interfaces/IERC20.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";

/// @dev Minimal WETH9 surface for the post-deploy wrap step. Sepolia WETH
///      (0x7b79…E7f9) implements both interfaces.
interface IWETH9 {
    function deposit() external payable;
}

/// @title  Deploy
/// @notice Single-script deployment for the Phare on-chain layer.
///         Deploys SlashPool, then ReportRegistry wired to it; pins external
///         addresses (UMA OOv3, WETH bond currency) for Sepolia by default,
///         all overrideable via env. Reads `DEPLOYER_PRIVATE_KEY` from env
///         and broadcasts with it — no `--private-key` flag needed.
///
///             cd contracts && forge script script/Deploy.s.sol:Deploy \
///                 --rpc-url $SEPOLIA_RPC_URL --broadcast
contract Deploy is Script {
    // ── Sepolia defaults (DESIGN_DOCUMENT §14.4) ──────────────────────────
    address constant DEFAULT_OOV3 = 0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944;
    address constant DEFAULT_WETH = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // ── Bond + liveness defaults (Design §8 + demo posture) ───────────────
    uint96  constant DEFAULT_PROTOCOL_BOND = 5_000_000_000_000_000;       // 0.005 WETH
    uint64  constant DEFAULT_LIVENESS      = 60;                          // 1 min, demo
    string  constant DEFAULT_GATEWAY       = "https://api.gateway.ethswarm.org/access/";

    // ── Reporter prep ─────────────────────────────────────────────────────
    // Top-up target for deployer's WETH balance (covers ~7 submits at the
    // demo bond size). Anything beyond this is left as ETH for gas.
    uint256 constant DEPLOYER_WETH_TARGET = 0.05 ether;

    function run() external returns (SlashPool slashPool, ReportRegistry registry) {
        // ── Resolve config (env overrides) ───────────────────────────────
        uint256 deployerPk      = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer        = vm.addr(deployerPk);
        address bondCurrency    = vm.envOr("BOND_CURRENCY",    DEFAULT_WETH);
        address oov3            = vm.envOr("UMA_OOV3",         DEFAULT_OOV3);
        address treasury        = vm.envOr("TREASURY",         deployer);
        address orbitalAttestor = vm.envOr("ORBITAL_ATTESTOR", deployer);
        uint96  protocolBond    = uint96(vm.envOr("PROTOCOL_BOND", uint256(DEFAULT_PROTOCOL_BOND)));
        uint64  liveness        = uint64(vm.envOr("LIVENESS",      uint256(DEFAULT_LIVENESS)));
        string  memory gateway  = vm.envOr("SWARM_GATEWAY",    DEFAULT_GATEWAY);
        if (bytes(gateway).length == 0) gateway = DEFAULT_GATEWAY;

        console.log("=== Phare deploy ==================================");
        console.log("deployer        :", deployer);
        console.log("bondCurrency    :", bondCurrency);
        console.log("oov3            :", oov3);
        console.log("treasury        :", treasury);
        console.log("orbitalAttestor :", orbitalAttestor);
        console.log("protocolBond    :", uint256(protocolBond));
        console.log("liveness        :", uint256(liveness));
        console.log("swarmGateway    :", gateway);

        vm.startBroadcast(deployerPk);

        slashPool = new SlashPool(IERC20(bondCurrency));
        console.log("SlashPool       :", address(slashPool));

        registry = new ReportRegistry(
            IERC20(bondCurrency),
            IOptimisticOracleV3(oov3),
            slashPool,
            treasury,
            orbitalAttestor,
            protocolBond,
            liveness,
            gateway
        );
        console.log("ReportRegistry  :", address(registry));

        // ── Reporter prep: wrap ETH→WETH if low + grant MAX allowance ────
        IERC20  weth   = IERC20(bondCurrency);
        uint256 wethBal = weth.balanceOf(deployer);
        if (wethBal < DEPLOYER_WETH_TARGET) {
            uint256 toWrap = DEPLOYER_WETH_TARGET - wethBal;
            IWETH9(bondCurrency).deposit{value: toWrap}();
            console.log("wrapped (wei)   :", toWrap);
        }
        weth.approve(address(registry), type(uint256).max);
        console.log("approval (max)  : reporter -> registry");

        vm.stopBroadcast();

        _updateWebEnv(address(slashPool), address(registry));

        console.log("===================================================");
    }

    /// @dev ffi-shells out to sed and rewrites the address lines in both
    ///      /.env (REPORT_REGISTRY, SLASH_POOL) and /web/.env (their
    ///      NEXT_PUBLIC_* mirrors) so any consumer — PWA or CLI helpers —
    ///      picks up the freshly deployed contracts without a manual copy.
    function _updateWebEnv(address slashPoolAddr, address registryAddr) internal {
        _patch(
            string.concat(vm.projectRoot(), "/../.env"),
            "REPORT_REGISTRY",
            vm.toString(registryAddr),
            "SLASH_POOL",
            vm.toString(slashPoolAddr)
        );
        _patch(
            string.concat(vm.projectRoot(), "/../web/.env"),
            "NEXT_PUBLIC_REPORT_REGISTRY",
            vm.toString(registryAddr),
            "NEXT_PUBLIC_SLASH_POOL",
            vm.toString(slashPoolAddr)
        );
        console.log("wrote addresses to    : .env, web/.env");
    }

    function _patch(
        string memory path,
        string memory key1, string memory val1,
        string memory key2, string memory val2
    ) internal {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(
            "f='", path, "' && ",
            "sed -i.bak ",
            "-e 's|^", key1, "=.*|", key1, "=", val1, "|' ",
            "-e 's|^", key2, "=.*|", key2, "=", val2, "|' ",
            "\"$f\" && rm -f \"$f.bak\""
        );
        vm.ffi(cmd);
    }
}
