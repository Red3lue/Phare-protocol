// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2}     from "forge-std/Script.sol";
import {SlashPool}            from "../src/SlashPool.sol";
import {ReportRegistry}       from "../src/ReportRegistry.sol";
import {Lighthouse}           from "../src/Lighthouse.sol";
import {ILighthouse}          from "../src/interfaces/ILighthouse.sol";
import {IERC20}               from "../src/interfaces/IERC20.sol";
import {IOptimisticOracleV3}  from "../src/interfaces/IOptimisticOracleV3.sol";
import {ISlashPool}           from "../src/interfaces/ISlashPool.sol";

interface INameWrapperApproval {
    function setApprovalForAll(address operator, bool approved) external;
    function isApprovedForAll(address owner, address operator) external view returns (bool);
}

/// @title  Deploy — single-shot deployment of Phare's three contracts (Path B)
/// @notice Deploys SlashPool (or reuses one given via SLASH_POOL env),
///         ReportRegistry (the new Lighthouse-wired version), and
///         Lighthouse. Wires them, approves NameWrapper operator, runs
///         post-deploy assertions, then patches .env files in place.
///
///         Required env: DEPLOYER_PRIVATE_KEY, VESSEL_PARENT_NODE, VERIFIER_PARENT_NODE
///         Optional env: BOND_CURRENCY, UMA_OOV3, ENS_NAMEWRAPPER, ENS_PUBLIC_RESOLVER,
///                       TREASURY, ORBITAL_ATTESTOR, BOND_AMOUNT, LIVENESS,
///                       SWARM_GATEWAY_PREFIX, SLASH_POOL,
///                       SKIP_OPERATOR_APPROVAL, SKIP_ENV_PATCH.
contract Deploy is Script {
    struct Cfg {
        address deployer;
        address bondCurrency;
        address oo;
        address nameWrapper;
        address resolver;
        bytes32 vesselParent;
        bytes32 verifierParent;
        address treasury;
        address orbitalAttestor;
        uint96  bondAmount;
        uint64  liveness;
        string  gateway;
        bool    skipApproval;
        bool    skipEnvPatch;
    }

    struct Out {
        SlashPool      pool;
        ReportRegistry registry;
        Lighthouse     lighthouse;
    }

    function run() external {
        // Load ../.env (the repo-root file your teammate populates) into the
        // process env before reading vars. forge auto-loads contracts/.env
        // only — without this hook you'd need a symlink. Existing process
        // env vars are NOT overwritten.
        _loadDotenv(string.concat(vm.projectRoot(), "/../.env"));

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        Cfg memory c = _loadConfig(vm.addr(deployerKey));
        _logConfig(c);

        Out memory o = _deploy(deployerKey, c);

        _verify(o, c);
        _logSummary(o);

        if (!c.skipEnvPatch) _patchAllEnv(o);
    }

    // ─── Config ──────────────────────────────────────────────────────────

    function _loadConfig(address deployer) internal view returns (Cfg memory c) {
        c.deployer        = deployer;
        c.bondCurrency    = vm.envOr("BOND_CURRENCY",       address(0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9));
        c.oo              = vm.envOr("UMA_OOV3",            address(0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944));
        c.nameWrapper     = vm.envOr("ENS_NAMEWRAPPER",     address(0x0635513f179D50A207757E05759CbD106d7dFcE8));
        c.resolver        = vm.envOr("ENS_PUBLIC_RESOLVER", address(0x8FADE66B79cC9f707aB26799354482EB93a5B7dD));
        c.vesselParent    = _resolveNamehash("VESSEL_PARENT_NODE");
        c.verifierParent  = _resolveNamehash("VERIFIER_PARENT_NODE");
        c.treasury        = vm.envOr("TREASURY",         deployer);
        c.orbitalAttestor = vm.envOr("ORBITAL_ATTESTOR", deployer);
        c.bondAmount      = uint96(vm.envOr("BOND_AMOUNT", uint256(5_000_000_000_000_000)));
        c.liveness        = uint64(vm.envOr("LIVENESS",   uint256(60)));
        c.gateway         = vm.envOr("SWARM_GATEWAY_PREFIX", string("https://api.gateway.ethswarm.org/access/"));
        c.skipApproval    = vm.envOr("SKIP_OPERATOR_APPROVAL", false);
        c.skipEnvPatch    = vm.envOr("SKIP_ENV_PATCH",         false);
    }

    function _logConfig(Cfg memory c) internal pure {
        console2.log("Deployer            :", c.deployer);
        console2.log("BondCurrency        :", c.bondCurrency);
        console2.log("OOv3                :", c.oo);
        console2.log("NameWrapper         :", c.nameWrapper);
        console2.log("PublicResolver      :", c.resolver);
        console2.log("Treasury            :", c.treasury);
        console2.log("OrbitalAttestor     :", c.orbitalAttestor);
    }

    // ─── Deploy ──────────────────────────────────────────────────────────

    function _deploy(uint256 deployerKey, Cfg memory c) internal returns (Out memory o) {
        vm.startBroadcast(deployerKey);

        // 1. SlashPool — reuse if SLASH_POOL set with matching currency.
        address existingPool = vm.envOr("SLASH_POOL", address(0));
        if (existingPool != address(0) && existingPool.code.length > 0) {
            o.pool = SlashPool(existingPool);
            require(
                address(o.pool.bondCurrency()) == c.bondCurrency,
                "SLASH_POOL bondCurrency mismatch"
            );
            console2.log("Reusing SlashPool   :", existingPool);
        } else {
            o.pool = new SlashPool(IERC20(c.bondCurrency));
        }

        // 2. ReportRegistry
        o.registry = new ReportRegistry(
            IERC20(c.bondCurrency),
            IOptimisticOracleV3(c.oo),
            ISlashPool(address(o.pool)),
            c.treasury,
            c.orbitalAttestor,
            c.bondAmount,
            c.liveness,
            c.gateway
        );

        // 3. Lighthouse
        o.lighthouse = new Lighthouse(
            c.nameWrapper,
            c.resolver,
            c.vesselParent,
            c.verifierParent,
            address(o.registry)
        );

        // 4. Wire registry → lighthouse (one-shot)
        o.registry.setLighthouse(ILighthouse(address(o.lighthouse)));

        // 5. NameWrapper operator approval — covers both phare.eth parents.
        if (!c.skipApproval) {
            INameWrapperApproval(c.nameWrapper).setApprovalForAll(address(o.lighthouse), true);
        }

        vm.stopBroadcast();
    }

    // ─── Verify ──────────────────────────────────────────────────────────

    function _verify(Out memory o, Cfg memory c) internal view {
        // External addresses must actually have code — caught one bug where
        // .env had mainnet's UMA OOv3 on Sepolia, deployment "succeeded", but
        // every assertTruth/settleAssertion would have reverted.
        require(c.bondCurrency.code.length > 0, "VERIFY: bondCurrency has no code on this chain");
        require(c.oo.code.length          > 0, "VERIFY: UMA OOv3 has no code on this chain");
        require(c.nameWrapper.code.length > 0, "VERIFY: NameWrapper has no code on this chain");
        require(c.resolver.code.length    > 0, "VERIFY: PublicResolver has no code on this chain");

        require(address(o.registry.lighthouse()) == address(o.lighthouse), "VERIFY: registry.lighthouse");
        require(o.lighthouse.reportRegistry()    == address(o.registry),   "VERIFY: lighthouse.reportRegistry");
        require(o.lighthouse.vesselParent()      == c.vesselParent,        "VERIFY: vesselParent");
        require(o.lighthouse.verifierParent()    == c.verifierParent,      "VERIFY: verifierParent");
        require(address(o.lighthouse.nameWrapper()) == c.nameWrapper,      "VERIFY: nameWrapper");
        require(address(o.lighthouse.resolver())    == c.resolver,         "VERIFY: resolver");
        require(address(o.registry.slashPool())     == address(o.pool),    "VERIFY: registry.slashPool");
        require(o.registry.admin()                  == c.deployer,         "VERIFY: registry.admin");

        if (!c.skipApproval) {
            require(
                INameWrapperApproval(c.nameWrapper).isApprovedForAll(c.deployer, address(o.lighthouse)),
                "VERIFY: operator approval not set"
            );
        }
        console2.log("VERIFY              : all integration checks PASS");
    }

    function _logSummary(Out memory o) internal pure {
        console2.log("SlashPool           :", address(o.pool));
        console2.log("ReportRegistry      :", address(o.registry));
        console2.log("Lighthouse          :", address(o.lighthouse));
    }

    // ─── Env patching ────────────────────────────────────────────────────

    function _patchAllEnv(Out memory o) internal {
        string memory root = vm.projectRoot();
        string memory slashStr = vm.toString(address(o.pool));
        string memory regStr   = vm.toString(address(o.registry));
        string memory lhStr    = vm.toString(address(o.lighthouse));

        _patchOne(string.concat(root, "/../.env"),             "SLASH_POOL",      slashStr);
        _patchOne(string.concat(root, "/../.env"),             "REPORT_REGISTRY", regStr);
        _patchOne(string.concat(root, "/../.env"),             "LIGHTHOUSE",      lhStr);

        _patchOne(string.concat(root, "/../.env.example"),     "SLASH_POOL",      slashStr);
        _patchOne(string.concat(root, "/../.env.example"),     "REPORT_REGISTRY", regStr);
        _patchOne(string.concat(root, "/../.env.example"),     "LIGHTHOUSE",      lhStr);

        _patchOne(string.concat(root, "/../web/.env"),         "NEXT_PUBLIC_SLASH_POOL",      slashStr);
        _patchOne(string.concat(root, "/../web/.env"),         "NEXT_PUBLIC_REPORT_REGISTRY", regStr);
        _patchOne(string.concat(root, "/../web/.env"),         "NEXT_PUBLIC_LIGHTHOUSE",      lhStr);

        _patchOne(string.concat(root, "/../web/.env.example"), "NEXT_PUBLIC_SLASH_POOL",      slashStr);
        _patchOne(string.concat(root, "/../web/.env.example"), "NEXT_PUBLIC_REPORT_REGISTRY", regStr);
        _patchOne(string.concat(root, "/../web/.env.example"), "NEXT_PUBLIC_LIGHTHOUSE",      lhStr);

        _patchOne(string.concat(root, "/../agent/.env"),         "SLASH_POOL",      slashStr);
        _patchOne(string.concat(root, "/../agent/.env"),         "REPORT_REGISTRY", regStr);
        _patchOne(string.concat(root, "/../agent/.env"),         "LIGHTHOUSE",      lhStr);

        _patchOne(string.concat(root, "/../agent/.env.example"), "SLASH_POOL",      slashStr);
        _patchOne(string.concat(root, "/../agent/.env.example"), "REPORT_REGISTRY", regStr);
        _patchOne(string.concat(root, "/../agent/.env.example"), "LIGHTHOUSE",      lhStr);

        console2.log("env files patched   : .env / .env.example / web/.env / web/.env.example / agent/.env / agent/.env.example (if present)");
    }

    // ─── Namehash resolver ───────────────────────────────────────────────

    /// @dev Accepts either a 32-byte hex namehash (`0x…`) OR a dotted ENS
    ///      name like `vessel.phare.eth`. In the latter case we compute the
    ///      namehash on-chain — same algorithm as `cast namehash`, no ffi.
    function _resolveNamehash(string memory key) internal view returns (bytes32) {
        string memory raw = vm.envString(key);
        bytes memory rb = bytes(raw);
        require(rb.length > 0, string.concat("env not set: ", key));

        if (rb.length == 66 && rb[0] == bytes1("0") && (rb[1] == bytes1("x") || rb[1] == bytes1("X"))) {
            return vm.envBytes32(key);
        }
        return _namehashOf(raw);
    }

    /// @dev ENS namehash. Walks labels right-to-left:
    ///        node = keccak256(parentNode ++ keccak256(label))
    function _namehashOf(string memory name) internal pure returns (bytes32 node) {
        bytes memory b = bytes(name);
        if (b.length == 0) return bytes32(0);

        uint256 end = b.length;
        while (true) {
            uint256 start = end;
            while (start > 0 && b[start - 1] != bytes1(".")) {
                start--;
            }
            bytes memory label = new bytes(end - start);
            for (uint256 i = 0; i < label.length; i++) {
                label[i] = b[start + i];
            }
            node = keccak256(abi.encodePacked(node, keccak256(label)));
            if (start == 0) break;
            end = start - 1; // skip the dot
        }
    }

    // ─── Dotenv loader (sets process env vars so vm.envXxx finds them) ──

    /// @dev Reads `file` line-by-line via ffi, splits on first `=`, and calls
    ///      `vm.setEnv` for any key not already set in the process env. Skips
    ///      blank lines and `#` comments. No-op if the file doesn't exist.
    ///      Output framing: NUL-style separators (\x1f between key/value,
    ///      \x1e between records) so we don't have to worry about values
    ///      containing newlines or `=`.
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

            // Don't overwrite an already-set process env var (shell exports
            // win) and don't set empty values (would mask vm.envOr defaults).
            if (bytes(v).length > 0 && bytes(vm.envOr(k, string(""))).length == 0) {
                vm.setEnv(k, v);
            }
            i = rs + 1;
        }
    }

    /// @dev Idempotent patcher. No-op if file missing. If `key=` line exists,
    ///      replaces value; else appends. `sed -i.bak` is BSD/GNU portable —
    ///      we then `rm -f` the backup.
    function _patchOne(string memory file, string memory key, string memory value) internal {
        string[] memory cmd = new string[](3);
        cmd[0] = "bash";
        cmd[1] = "-c";
        cmd[2] = string.concat(
            "if [ ! -f \"", file, "\" ]; then exit 0; fi; ",
            "if grep -qE \"^", key, "=\" \"", file, "\"; then ",
            "sed -i.bak -E \"s|^", key, "=.*|", key, "=", value, "|\" \"", file, "\" && rm -f \"", file, ".bak\"; ",
            "else echo \"", key, "=", value, "\" >> \"", file, "\"; fi"
        );
        vm.ffi(cmd);
    }
}
