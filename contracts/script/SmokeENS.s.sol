// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface ILighthouseLive {
    function enrollVerifier(string calldata handle, string calldata policyURI, string calldata soulURI)
        external
        returns (bytes32);
    function nameWrapper()    external view returns (address);
    function resolver()       external view returns (address);
    function vesselParent()   external view returns (bytes32);
    function verifierParent() external view returns (bytes32);
    function reportRegistry() external view returns (address);
}

interface INameWrapperLive {
    function ownerOf(uint256 id) external view returns (address);
    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

interface IPublicResolverLive {
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function text(bytes32 node, string calldata key) external view returns (string memory);
}

/// @title  SmokeENS — live Sepolia smoke for the deployed Lighthouse
/// @notice Required env (loaded from ../.env): DEPLOYER_PRIVATE_KEY, LIGHTHOUSE.
///         Optional: ENS_NAMEWRAPPER, ENS_PUBLIC_RESOLVER, VERIFIER_HANDLE,
///                   POLICY_URI, SOUL_URI, SKIP_RECORD_UPDATE.
contract SmokeENS is Script {
    struct Cfg {
        uint256 deployerKey;
        address deployer;
        address lighthouse;
        address nameWrapper;
        address resolver;
        string  handle;
        string  policy;
        string  soul;
        bool    skipUpdate;
    }

    function run() external {
        _loadDotenv(string.concat(vm.projectRoot(), "/../.env"));

        Cfg memory c = _loadCfg();
        _preflight(c);

        bytes32 node = _enroll(c);
        _readBack(c, node);

        if (!c.skipUpdate) _updateLastDecision(c, node);

        console2.log("");
        console2.log(string.concat(unicode"OK. Resolve at sepolia.app.ens.domains: ", c.handle, ".verifier.phare.eth"));
    }

    function _loadCfg() internal view returns (Cfg memory c) {
        c.deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        c.deployer    = vm.addr(c.deployerKey);
        c.lighthouse  = vm.envAddress("LIGHTHOUSE");
        c.nameWrapper = vm.envOr("ENS_NAMEWRAPPER",     address(0x0635513f179D50A207757E05759CbD106d7dFcE8));
        c.resolver    = vm.envOr("ENS_PUBLIC_RESOLVER", address(0x8FADE66B79cC9f707aB26799354482EB93a5B7dD));
        c.handle      = vm.envOr("VERIFIER_HANDLE", string("agent-test01"));
        c.policy      = vm.envOr("POLICY_URI",      string("bzz://policy-smoke-test"));
        c.soul        = vm.envOr("SOUL_URI",        string("bzz://soul-smoke-test"));
        c.skipUpdate  = vm.envOr("SKIP_RECORD_UPDATE", false);
    }

    function _preflight(Cfg memory c) internal view {
        ILighthouseLive lh  = ILighthouseLive(c.lighthouse);
        INameWrapperLive nw = INameWrapperLive(c.nameWrapper);

        console2.log("Deployer            :", c.deployer);
        console2.log("Lighthouse          :", c.lighthouse);
        console2.log("verifier handle     :", c.handle);

        require(lh.nameWrapper() == c.nameWrapper, "lighthouse.nameWrapper mismatch");
        require(lh.resolver()    == c.resolver,    "lighthouse.resolver mismatch");

        require(
            nw.isApprovedForAll(c.deployer, c.lighthouse),
            "Lighthouse not approved as NameWrapper operator (re-run setApprovalForAll)"
        );

        address parentOwner = nw.ownerOf(uint256(lh.verifierParent()));
        require(parentOwner != address(0), "verifier.phare.eth not minted (do ENS_INIT.md steps 1-4)");
        console2.log("verifier-parent owner:", parentOwner);
    }

    function _enroll(Cfg memory c) internal returns (bytes32 node) {
        ILighthouseLive lh = ILighthouseLive(c.lighthouse);
        bytes32 expected = keccak256(
            abi.encodePacked(lh.verifierParent(), keccak256(bytes(c.handle)))
        );

        vm.startBroadcast(c.deployerKey);
        node = lh.enrollVerifier(c.handle, c.policy, c.soul);
        vm.stopBroadcast();

        require(node == expected, "node mismatch - labelhash off");
    }

    function _readBack(Cfg memory c, bytes32 node) internal view {
        INameWrapperLive nw = INameWrapperLive(c.nameWrapper);
        IPublicResolverLive pr = IPublicResolverLive(c.resolver);

        address nodeOwner = nw.ownerOf(uint256(node));
        (, uint32 fuses, ) = nw.getData(uint256(node));

        console2.log("node owner          :", nodeOwner);
        console2.log("node fuses (65536=PCC):", uint256(fuses));
        require(nodeOwner == c.deployer, "node owner != deployer");
        require(fuses == 0x10000,        "PCC not burnt");

        console2.log("verifier.policy     :", pr.text(node, "verifier.policy"));
        console2.log("verifier.soul       :", pr.text(node, "verifier.soul"));
        console2.log("verifier.runtime    :", pr.text(node, "verifier.runtime"));
    }

    function _updateLastDecision(Cfg memory c, bytes32 node) internal {
        IPublicResolverLive pr = IPublicResolverLive(c.resolver);

        string memory decision = string.concat("bzz://decision-smoke-", vm.toString(block.timestamp));

        vm.startBroadcast(c.deployerKey);
        pr.setText(node, "verifier.lastDecision", decision);
        vm.stopBroadcast();

        string memory got = pr.text(node, "verifier.lastDecision");
        console2.log("lastDecision written:", decision);
        console2.log("lastDecision read   :", got);
        require(keccak256(bytes(got)) == keccak256(bytes(decision)), "post-mint update did not persist");
    }

    // ─── Dotenv loader (mirrors Deploy.s.sol) ────────────────────────────

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
