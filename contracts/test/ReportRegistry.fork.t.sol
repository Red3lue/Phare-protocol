// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}                from "forge-std/Test.sol";
import {ReportRegistry}      from "../src/ReportRegistry.sol";
import {SlashPool}           from "../src/SlashPool.sol";
import {IERC20}              from "../src/interfaces/IERC20.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";

/// @notice Fork tests against real Sepolia UMA OOv3 + WETH (UMA-whitelisted).
///
///         Happy path uses real UMA `settleAssertion` after liveness expires —
///         exercises the full undisputed flow including the real callback
///         dispatch into `assertionResolvedCallback`.
///
///         Disputed paths use real UMA `disputeAssertion` for the dispute
///         leg (proves our `assertionDisputedCallback` is wired correctly),
///         then simulate the DVM ruling by pranking the OOv3 address and
///         invoking `assertionResolvedCallback` directly. Real DVM
///         resolution on testnet requires owner-restricted price pushes that
///         are out of scope for an automated fork test.
contract ReportRegistryForkTest is Test {
    // ── Sepolia pinned addresses (Design Document §14.4) ──────────────────
    // OOv3 from UMA's networks/11155111.json. Bond currency is WETH on Sepolia
    // because the canonical UMA-whitelisted USDC has a 400-token min bond
    // (impractical for a hackathon). WETH min bond is 0.002 — manageable.
    address constant OOV3_ADDR = 0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944;
    address constant WETH_ADDR = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    // ── System under test ─────────────────────────────────────────────────
    ReportRegistry      registry;
    SlashPool       slashPool;
    IERC20              weth;
    IOptimisticOracleV3 oo;

    // ── Actors ────────────────────────────────────────────────────────────
    address reporter = makeAddr("reporter");
    address verifier = makeAddr("verifier");
    address treasury = makeAddr("treasury");
    address attestor = makeAddr("attestor");

    // ── Test config ───────────────────────────────────────────────────────
    // WETH has 18 decimals. Protocol bond = 0.005 WETH; UMA min bond on
    // Sepolia for WETH = 0.002 WETH. Reporter fronts ~0.007 WETH per submit.
    uint96  constant PROTOCOL_BOND = 5_000_000_000_000_000;  // 0.005 WETH
    uint64  constant LIVENESS      = 60;                      // 1 minute, demo
    uint256 constant IMO           = 9133701;
    bool    constant AIS_DARK      = true;
    bytes32 constant PHOTO_HASH    = bytes32(uint256(0xdeadbeef));
    string  constant META_SWARM    = "bzz://0000000000000000000000000000000000000000000000000000000000000abc";
    string  constant GATEWAY       = "https://api.gateway.ethswarm.org/access/";

    function setUp() public {
        string memory rpc = vm.envOr(
            "SEPOLIA_RPC_URL",
            string("https://ethereum-sepolia-rpc.publicnode.com")
        );
        vm.createSelectFork(rpc);

        weth = IERC20(WETH_ADDR);
        oo   = IOptimisticOracleV3(OOV3_ADDR);

        slashPool = new SlashPool(weth);
        registry  = new ReportRegistry(
            weth, oo, slashPool,
            treasury, attestor,
            PROTOCOL_BOND, LIVENESS, GATEWAY
        );
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function _fundAndApprove(address user, address spender, uint256 amount) internal {
        deal(WETH_ADDR, user, amount);
        vm.prank(user);
        weth.approve(spender, amount);
    }

    function _submit() internal returns (bytes32 reportId, uint256 umaBond) {
        umaBond = oo.getMinimumBond(WETH_ADDR);
        _fundAndApprove(reporter, address(registry), uint256(PROTOCOL_BOND) + umaBond);
        vm.prank(reporter);
        reportId = registry.submit(IMO, AIS_DARK, PHOTO_HASH, META_SWARM, "", "", "");
    }

    // ── Tests ─────────────────────────────────────────────────────────────

    function test_Submit_PullsBondAndOpensAssertion() public {
        (bytes32 reportId, uint256 umaBond) = _submit();

        ReportRegistry.Report memory r = registry.getReport(reportId);
        assertEq(r.reporter,            reporter);
        assertEq(uint256(r.bond),       uint256(PROTOCOL_BOND));
        assertEq(uint256(r.umaBond),    umaBond);
        assertEq(r.imo,                 IMO);
        assertEq(r.aisDark,             AIS_DARK);
        assertEq(r.photoHash,           PHOTO_HASH);
        assertEq(r.metadataSwarm,       META_SWARM);
        assertEq(r.status,              0); // PENDING
        assertTrue(r.assertionId       != bytes32(0));

        // Reporter is empty; registry holds the protocol bond; UMA holds umaBond.
        assertEq(weth.balanceOf(reporter),         0);
        assertEq(weth.balanceOf(address(registry)), uint256(PROTOCOL_BOND));
    }

    function test_HappyPath_UndisputedTruthfulSettle() public {
        (bytes32 reportId, uint256 umaBond) = _submit();
        ReportRegistry.Report memory r0 = registry.getReport(reportId);

        vm.warp(block.timestamp + LIVENESS + 1);

        // Real UMA settleAssertion fires our resolvedCallback(true).
        oo.settleAssertion(r0.assertionId);

        ReportRegistry.Report memory r1 = registry.getReport(reportId);
        assertEq(r1.status, 2); // SETTLED_TRUE
        assertGt(uint256(r1.settledAt), 0);

        // Reporter refunded protocol bond + UMA min bond.
        assertEq(weth.balanceOf(reporter), uint256(PROTOCOL_BOND) + umaBond);
        assertEq(weth.balanceOf(address(registry)), 0);
    }

    function test_DisputePath_RealDispute_FlipsStatus() public {
        (bytes32 reportId, uint256 umaBond) = _submit();
        ReportRegistry.Report memory r = registry.getReport(reportId);

        // Verifier opens a real UMA dispute. UMA pulls counter-bond from
        // verifier and fires our assertionDisputedCallback synchronously.
        _fundAndApprove(verifier, address(oo), umaBond);
        vm.prank(verifier);
        oo.disputeAssertion(r.assertionId, verifier);

        ReportRegistry.Report memory r2 = registry.getReport(reportId);
        assertEq(r2.status, 1); // DISPUTED
    }

    function test_DispatchedFalse_SplitsBond_50_30_20() public {
        (bytes32 reportId, uint256 umaBond) = _submit();
        ReportRegistry.Report memory r = registry.getReport(reportId);

        _fundAndApprove(verifier, address(oo), umaBond);
        vm.prank(verifier);
        oo.disputeAssertion(r.assertionId, verifier);

        uint256 verifierBefore = weth.balanceOf(verifier);
        uint256 treasuryBefore = weth.balanceOf(treasury);
        uint256 poolBefore     = weth.balanceOf(address(slashPool));

        // Simulate DVM ruling against the reporter.
        vm.prank(address(oo));
        registry.assertionResolvedCallback(r.assertionId, false);

        ReportRegistry.Report memory r3 = registry.getReport(reportId);
        assertEq(r3.status, 3); // SETTLED_FALSE

        uint256 disputerShare = (uint256(PROTOCOL_BOND) * 5_000) / 10_000;
        uint256 poolShare     = (uint256(PROTOCOL_BOND) * 3_000) / 10_000;
        uint256 treasuryShare = uint256(PROTOCOL_BOND) - disputerShare - poolShare;

        assertEq(weth.balanceOf(verifier)           - verifierBefore, disputerShare, "disputer 50%");
        assertEq(weth.balanceOf(address(slashPool)) - poolBefore,     poolShare,     "pool 30%");
        assertEq(weth.balanceOf(treasury)           - treasuryBefore, treasuryShare, "treasury 20%");
        assertEq(slashPool.depositOf(reportId),                       poolShare,     "pool deposit recorded");
    }

    function test_DispatchedTrue_RefundsReporter() public {
        (bytes32 reportId, uint256 umaBond) = _submit();
        ReportRegistry.Report memory r = registry.getReport(reportId);

        _fundAndApprove(verifier, address(oo), umaBond);
        vm.prank(verifier);
        oo.disputeAssertion(r.assertionId, verifier);

        // In a real DVM-truthful resolve, UMA returns the asserter's bond
        // (and a portion of the disputer's bond) to us before firing the
        // callback. We're not exercising that path here — fake it by
        // crediting the registry with the umaBond it would have received.
        uint256 regBal = weth.balanceOf(address(registry));
        deal(WETH_ADDR, address(registry), regBal + umaBond);

        vm.prank(address(oo));
        registry.assertionResolvedCallback(r.assertionId, true);

        ReportRegistry.Report memory r4 = registry.getReport(reportId);
        assertEq(r4.status, 2); // SETTLED_TRUE
        assertEq(weth.balanceOf(reporter), uint256(PROTOCOL_BOND) + umaBond);
    }

    function test_OnlyOO_CanFireCallbacks() public {
        bytes32 fake = bytes32(uint256(1));

        vm.expectRevert(bytes("ReportRegistry: caller not OOv3"));
        registry.assertionResolvedCallback(fake, true);

        vm.expectRevert(bytes("ReportRegistry: caller not OOv3"));
        registry.assertionDisputedCallback(fake);
    }

    function test_DoubleSettle_Reverts() public {
        (bytes32 reportId, ) = _submit();
        ReportRegistry.Report memory r = registry.getReport(reportId);

        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(r.assertionId);

        vm.prank(address(oo));
        vm.expectRevert(bytes("already settled"));
        registry.assertionResolvedCallback(r.assertionId, true);
    }

    function test_Submit_RevertsOnEmptyMetaSwarm() public {
        deal(WETH_ADDR, reporter, 10 ether);
        vm.prank(reporter);
        weth.approve(address(registry), type(uint256).max);

        vm.prank(reporter);
        vm.expectRevert(bytes("metaSwarm=empty"));
        registry.submit(IMO, AIS_DARK, PHOTO_HASH, "", "", "", "");
    }

    function test_Submit_RevertsOnZeroPhotoHash() public {
        deal(WETH_ADDR, reporter, 10 ether);
        vm.prank(reporter);
        weth.approve(address(registry), type(uint256).max);

        vm.prank(reporter);
        vm.expectRevert(bytes("photoHash=0"));
        registry.submit(IMO, AIS_DARK, bytes32(0), META_SWARM, "", "", "");
    }

    function test_Submit_RevertsOnZeroImo() public {
        deal(WETH_ADDR, reporter, 10 ether);
        vm.prank(reporter);
        weth.approve(address(registry), type(uint256).max);

        vm.prank(reporter);
        vm.expectRevert(bytes("imo=0"));
        registry.submit(0, AIS_DARK, PHOTO_HASH, META_SWARM, "", "", "");
    }
}
