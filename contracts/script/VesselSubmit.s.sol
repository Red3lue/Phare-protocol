// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function balanceOf(address) external view returns (uint256);
    function approve(address, uint256) external returns (bool);
}

interface IOOv3 {
    function getMinimumBond(address currency) external view returns (uint256);
}

interface IReportRegistryLive {
    struct Report {
        address reporter;
        uint96  bond;
        uint96  umaBond;
        uint64  submittedAt;
        uint64  settledAt;
        uint8   status;
        uint256 imo;
        bool    aisDark;
        bytes32 photoHash;
        string  metadataSwarm;
        bytes32 assertionId;
        bool    orbitalAttested;
        bytes32 orbitalImageHash;
    }
    function submit(uint256 imo, bool aisDark, bytes32 photoHash, string calldata metadataSwarm)
        external
        returns (bytes32);
    function getReport(bytes32) external view returns (Report memory);
    function protocolBond() external view returns (uint96);
    function liveness() external view returns (uint64);
    function bondCurrency() external view returns (address);
    function oo() external view returns (address);
}

/// @title  VesselSubmit — step 1 of the live vessel test
/// @notice Submits a real bonded report through ReportRegistry on Sepolia.
///         Auto-wraps ETH to WETH if the deployer's WETH balance is short
///         (saves needing a faucet). Saves the assertionId to a state file
///         that VesselSettle reads after liveness expires.
///
///         Run sequence:
///           1. forge script script/VesselSubmit.s.sol:VesselSubmit --broadcast --ffi --rpc-url $SEPOLIA_RPC_URL
///           2. wait until the printed "Settle after" timestamp (~60s)
///           3. forge script script/VesselSettle.s.sol:VesselSettle --broadcast --ffi --rpc-url $SEPOLIA_RPC_URL
///
///         Env (loaded from ../.env): DEPLOYER_PRIVATE_KEY, REPORT_REGISTRY.
///         Optional: VESSEL_IMO (default 9133701), PHOTO_HASH, METADATA_SWARM.
contract VesselSubmit is Script {
    function run() external {
        _loadDotenv(string.concat(vm.projectRoot(), "/../.env"));

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer    = vm.addr(deployerKey);
        address registry    = vm.envAddress("REPORT_REGISTRY");

        IReportRegistryLive reg = IReportRegistryLive(registry);
        address bondCurrency    = reg.bondCurrency();
        address oo              = reg.oo();

        uint256 imo            = vm.envOr("VESSEL_IMO", uint256(9133701));
        bytes32 photoHash      = vm.envOr("PHOTO_HASH", bytes32(uint256(0xdeadbeef)));
        string  memory swarm   = vm.envOr("METADATA_SWARM", string("bzz://test-vessel-smoke"));

        uint256 protocolBond   = uint256(reg.protocolBond());
        uint256 umaBond        = IOOv3(oo).getMinimumBond(bondCurrency);
        uint256 needed         = protocolBond + umaBond;

        console2.log("Deployer            :", deployer);
        console2.log("ReportRegistry      :", registry);
        console2.log("BondCurrency (WETH) :", bondCurrency);
        console2.log("Protocol bond       :", protocolBond);
        console2.log("UMA min bond        :", umaBond);
        console2.log("Total needed        :", needed);

        bytes32 reportId = _broadcastSubmit(deployerKey, deployer, registry, bondCurrency, needed, imo, photoHash, swarm);
        _writeState(reg, reportId, imo);
    }

    function _broadcastSubmit(
        uint256 deployerKey,
        address deployer,
        address registry,
        address bondCurrency,
        uint256 needed,
        uint256 imo,
        bytes32 photoHash,
        string memory swarm
    ) internal returns (bytes32 reportId) {
        uint256 wethBal = IERC20(bondCurrency).balanceOf(deployer);
        console2.log("WETH balance        :", wethBal);

        vm.startBroadcast(deployerKey);

        if (wethBal < needed) {
            uint256 toWrap = needed - wethBal;
            console2.log("Wrapping ETH->WETH  :", toWrap);
            IWETH(bondCurrency).deposit{value: toWrap}();
        }

        IERC20(bondCurrency).approve(registry, needed);
        reportId = IReportRegistryLive(registry).submit(imo, true, photoHash, swarm);

        vm.stopBroadcast();
    }

    function _writeState(IReportRegistryLive reg, bytes32 reportId, uint256 imo) internal {
        // NOTE: We deliberately store only reportId. UMA's assertionId is
        // derived from block.timestamp at execution, so the value seen during
        // forge-script simulation differs from the broadcast value. VesselSettle
        // reads the actual assertionId + submittedAt from chain state via
        // registry.getReport(reportId).
        uint64 liveness = reg.liveness();

        console2.log("");
        console2.log("reportId            :");
        console2.logBytes32(reportId);
        console2.log("imo                 :", imo);
        console2.log("liveness            :", uint256(liveness));
        console2.log("Wait              ~ :", liveness, "seconds, then run VesselSettle");

        string memory state = string.concat(
            "{\"reportId\":\"", vm.toString(reportId),
            "\",\"imo\":", vm.toString(imo),
            "}"
        );
        vm.writeFile("./.vessel-state.json", state);
        console2.log("State file written  : ./.vessel-state.json");
    }

    // ─── Dotenv loader ───────────────────────────────────────────────────

    function _loadDotenv(string memory file) internal {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(
            "f=\"", file, "\"; [ -f \"$f\" ] || exit 0; ",
            "grep -v -E '^[[:space:]]*(#|$)' \"$f\" | ",
            "while IFS= read -r line || [ -n \"$line\" ]; do ",
            "  case \"$line\" in *=*) ;; *) continue ;; esac; ",
            "  k=\"${line%%=*}\"; v=\"${line#*=}\"; ",
            "  [ -n \"$k\" ] && printf '%s\\x1f%s\\x1e' \"$k\" \"$v\"; ",
            "done"
        );
        bytes memory raw = vm.ffi(cmd);
        if (raw.length == 0) return;

        uint256 i = 0;
        while (i < raw.length) {
            uint256 us = i;
            while (us < raw.length && uint8(raw[us]) != 0x1f) us++;
            if (us == raw.length) break;
            uint256 rs = us + 1;
            while (rs < raw.length && uint8(raw[rs]) != 0x1e) rs++;

            bytes memory kBytes = new bytes(us - i);
            for (uint256 j = 0; j < kBytes.length; j++) kBytes[j] = raw[i + j];
            bytes memory vBytes = new bytes(rs - us - 1);
            for (uint256 j = 0; j < vBytes.length; j++) vBytes[j] = raw[us + 1 + j];

            string memory k = string(kBytes);
            string memory v = string(vBytes);

            if (bytes(v).length > 0 && bytes(vm.envOr(k, string(""))).length == 0) {
                vm.setEnv(k, v);
            }
            i = rs + 1;
        }
    }
}
