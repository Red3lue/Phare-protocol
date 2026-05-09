// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IOOv3Settle {
    function settleAssertion(bytes32 assertionId) external;
}

interface ILighthouseLive {
    function vesselParent() external view returns (bytes32);
    function resolver()     external view returns (address);
}

interface IReportRegistryLive2 {
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
    function getReport(bytes32) external view returns (Report memory);
    function lighthouse() external view returns (address);
    function oo() external view returns (address);
    function liveness() external view returns (uint64);
    function vesselNamed(uint256) external view returns (bool);
    function sightingsByImo(uint256) external view returns (uint32);
}

interface IPublicResolverLive {
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @title  VesselSettle — step 2 of the live vessel test
/// @notice Reads `reportId` from the state file, fetches the report's
///         assertionId + submittedAt from CHAIN STATE (not from the state
///         file — UMA's assertionId differs between forge-script simulation
///         and broadcast), then calls OOv3.settleAssertion. The truthful
///         resolution callback fires Lighthouse.nameVessel; we read the
///         freshly-minted vessel.phare.eth records back at the end.
///
///         Recovery: if you already have a submitted report and just need
///         to settle, set REPORT_ID=0x0000…0001 (or whatever) in env to
///         override the state file.
contract VesselSettle is Script {
    function run() external {
        _loadDotenv(string.concat(vm.projectRoot(), "/../.env"));

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registry    = vm.envAddress("REPORT_REGISTRY");

        // reportId — from env override OR from the state file.
        bytes32 reportId = vm.envOr("REPORT_ID", bytes32(0));
        if (reportId == bytes32(0)) {
            string memory state = vm.readFile("./.vessel-state.json");
            reportId = vm.parseJsonBytes32(state, ".reportId");
        }

        IReportRegistryLive2 reg = IReportRegistryLive2(registry);
        IReportRegistryLive2.Report memory r = reg.getReport(reportId);
        require(r.reporter != address(0), "report does not exist on this registry");
        require(r.status == 0 || r.status == 1, "report already settled (status > 1)");

        uint64 liveness = reg.liveness();
        uint256 settleAfter = uint256(r.submittedAt) + uint256(liveness);

        console2.log("ReportRegistry      :", registry);
        console2.log("reportId            :");
        console2.logBytes32(reportId);
        console2.log("assertionId (chain) :");
        console2.logBytes32(r.assertionId);
        console2.log("imo                 :", r.imo);
        console2.log("submittedAt (chain) :", uint256(r.submittedAt));
        console2.log("liveness            :", uint256(liveness));
        console2.log("Settle-after        :", settleAfter);
        console2.log("block.timestamp     :", block.timestamp);

        require(
            block.timestamp >= settleAfter,
            "liveness window not yet elapsed - wait a bit longer and retry"
        );

        address oo = reg.oo();

        vm.startBroadcast(deployerKey);
        IOOv3Settle(oo).settleAssertion(r.assertionId);
        vm.stopBroadcast();

        console2.log(unicode"settleAssertion broadcast OK");

        require(reg.vesselNamed(r.imo), "vesselNamed(imo) is false - settlement was not truthful?");
        console2.log("vesselNamed         : true");
        console2.log("sightingsByImo      :", uint256(reg.sightingsByImo(r.imo)));

        _readVesselRecords(reg, r.imo);
    }

    function _readVesselRecords(IReportRegistryLive2 reg, uint256 imo) internal view {
        ILighthouseLive lh = ILighthouseLive(reg.lighthouse());
        address resolverAddr = lh.resolver();
        bytes32 vesselParent = lh.vesselParent();

        bytes memory label = abi.encodePacked("imo-", _toString(imo));
        bytes32 vesselNode = keccak256(abi.encodePacked(vesselParent, keccak256(label)));

        console2.log("vesselNode          :");
        console2.logBytes32(vesselNode);

        IPublicResolverLive pr = IPublicResolverLive(resolverAddr);
        console2.log("vessel.imo          :", pr.text(vesselNode, "vessel.imo"));
        console2.log("vessel.swarm.log    :", pr.text(vesselNode, "vessel.swarm.log"));
        console2.log("");
        console2.log(string.concat(
            unicode"OK. Resolve at sepolia.app.ens.domains: imo-",
            _toString(imo),
            ".vessel.phare.eth"
        ));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v;
        uint256 d;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (v != 0) { d--; b[d] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(b);
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
