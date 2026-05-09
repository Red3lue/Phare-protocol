// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}                from "forge-std/Test.sol";
import {ReportRegistry}      from "../src/ReportRegistry.sol";
import {SlashPool}           from "../src/SlashPool.sol";
import {Lighthouse}          from "../src/Lighthouse.sol";
import {ILighthouse}         from "../src/interfaces/ILighthouse.sol";
import {IERC20}              from "../src/interfaces/IERC20.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {MockNameWrapper, MockPublicResolver} from "./mocks/MockENS.sol";

/// @notice End-to-end integration on a Sepolia fork.
///         - Real UMA OOv3 + WETH (the only way to exercise the resolution
///           callback path with the actual UMA voter-readable claim shape).
///         - Mock NameWrapper + Resolver. Real ENS would require us to own
///           and burn fuses on `phare.eth` inside the test, which isn't
///           available without the deployer's key. The mocks enforce the
///           same authorization rule (only the wrapped owner can write
///           records), so behaviour is faithful.
///
///         The point is to assert the wiring between the three contracts:
///         settling truthful → Lighthouse mints/updates; attest →
///         recordOrbital; disputed-then-settled-true bumps `disputed`.
contract IntegrationForkTest is Test {
    // Sepolia pinned addresses (mirrors ReportRegistry.fork.t.sol).
    address constant OOV3_ADDR = 0xFd9e2642a170aDD10F53Ee14a93FcF2F31924944;
    address constant WETH_ADDR = 0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9;

    bytes32 constant VESSEL_PARENT   = keccak256("vessel.phare.eth");
    bytes32 constant VERIFIER_PARENT = keccak256("verifier.phare.eth");

    // System under test
    ReportRegistry      registry;
    SlashPool           slashPool;
    Lighthouse          lighthouse;
    MockNameWrapper     wrapper;
    MockPublicResolver  resolver;
    IERC20              weth;
    IOptimisticOracleV3 oo;

    // Actors
    address reporter  = makeAddr("reporter");
    address verifier  = makeAddr("verifier");
    address treasury  = makeAddr("treasury");
    address attestor;
    uint256 attestorKey;

    // Config
    uint96  constant PROTOCOL_BOND = 5_000_000_000_000_000;  // 0.005 WETH
    uint64  constant LIVENESS      = 60;
    uint256 constant IMO           = 9133701;
    string  constant GATEWAY       = "https://api.gateway.ethswarm.org/access/";

    function setUp() public {
        string memory rpc = vm.envOr(
            "SEPOLIA_RPC_URL",
            string("https://ethereum-sepolia-rpc.publicnode.com")
        );
        vm.createSelectFork(rpc);

        weth = IERC20(WETH_ADDR);
        oo   = IOptimisticOracleV3(OOV3_ADDR);

        (attestor, attestorKey) = makeAddrAndKey("attestor");

        slashPool = new SlashPool(weth);
        registry  = new ReportRegistry(
            weth, oo, slashPool,
            treasury, attestor,
            PROTOCOL_BOND, LIVENESS, GATEWAY
        );

        wrapper  = new MockNameWrapper();
        resolver = new MockPublicResolver(wrapper);

        // Lighthouse takes registry address as immutable.
        lighthouse = new Lighthouse(
            address(wrapper),
            address(resolver),
            VESSEL_PARENT,
            VERIFIER_PARENT,
            address(registry)
        );

        // Mark the parents as Lighthouse-owned-or-operator-controlled. Mock
        // doesn't enforce operator approval — these mintRoot calls are
        // documentation that mirrors ENS_INIT.md §3-4.
        wrapper.mintRoot(VESSEL_PARENT,   address(this));
        wrapper.mintRoot(VERIFIER_PARENT, address(this));

        // Wire the registry → lighthouse (one-shot). Admin is the test
        // contract because it deployed the registry.
        registry.setLighthouse(ILighthouse(address(lighthouse)));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _fundAndApprove(address user, address spender, uint256 amount) internal {
        deal(WETH_ADDR, user, amount);
        vm.prank(user);
        weth.approve(spender, amount);
    }

    function _submit(uint256 imo, string memory swarmRef)
        internal
        returns (bytes32 reportId, uint256 umaBond)
    {
        umaBond = oo.getMinimumBond(WETH_ADDR);
        _fundAndApprove(reporter, address(registry), uint256(PROTOCOL_BOND) + umaBond);
        vm.prank(reporter);
        reportId = registry.submit(imo, true, bytes32(uint256(0xdeadbeef)), swarmRef);
    }

    function _vesselNode(uint256 imo) internal pure returns (bytes32) {
        bytes memory label = abi.encodePacked("imo-", _toString(imo));
        return keccak256(abi.encodePacked(VESSEL_PARENT, keccak256(label)));
    }

    function _toString(uint256 v) internal pure returns (string memory) {
        if (v == 0) return "0";
        uint256 t = v; uint256 d;
        while (t != 0) { d++; t /= 10; }
        bytes memory b = new bytes(d);
        while (v != 0) { d--; b[d] = bytes1(uint8(48 + (v % 10))); v /= 10; }
        return string(b);
    }

    function _signOrbitalAttest(bytes32 reportId, bytes32 imageHash, string memory teePrediction)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(
            abi.encode(reportId, imageHash, keccak256(bytes(teePrediction)))
        );
        bytes32 eip191 = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, eip191);
        return abi.encodePacked(r, s, v);
    }

    // ─── Tests ───────────────────────────────────────────────────────────

    function test_FirstSighting_TruthfulSettle_MintsVesselSubname() public {
        string memory meta = "bzz://0000000000000000000000000000000000000000000000000000000000000abc";
        (bytes32 reportId, ) = _submit(IMO, meta);
        ReportRegistry.Report memory r0 = registry.getReport(reportId);

        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(r0.assertionId);

        // Registry state
        assertEq(registry.sightingsByImo(IMO), 1, "sightings=1");
        assertEq(registry.disputedByImo(IMO),  0, "disputed=0");
        assertTrue(registry.vesselNamed(IMO),     "vesselNamed");

        // ENS state
        bytes32 node = _vesselNode(IMO);
        assertEq(wrapper.ownerOf(uint256(node)), address(lighthouse), "owner = Lighthouse");
        assertEq(resolver.text(node, "vessel.imo"),       _toString(IMO));
        assertEq(resolver.text(node, "vessel.swarm.log"), meta);
    }

    function test_SecondSighting_TruthfulSettle_UpdatesRecordSighting() public {
        // First sighting → mints
        string memory metaA = "bzz://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
        (bytes32 idA, ) = _submit(IMO, metaA);
        ReportRegistry.Report memory ra = registry.getReport(idA);
        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(ra.assertionId);

        // Second sighting on same IMO → recordSighting path
        string memory metaB = "bzz://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
        (bytes32 idB, ) = _submit(IMO, metaB);
        ReportRegistry.Report memory rb = registry.getReport(idB);
        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(rb.assertionId);

        assertEq(registry.sightingsByImo(IMO), 2, "sightings=2");

        bytes32 node = _vesselNode(IMO);
        assertEq(resolver.text(node, "vessel.swarm.log"),       metaB,        "swarm.log overwritten");
        assertEq(resolver.text(node, "vessel.sightings.count"),  "2",         "count=2");
        assertEq(resolver.text(node, "vessel.sightings.disputed"), "0",       "disputed=0");
    }

    function test_DisputedThenTruthfulSettle_BumpsDisputedCounter() public {
        // First sighting upheld undisputed → mint with disputed=0.
        string memory metaA = "bzz://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
        (bytes32 idA, ) = _submit(IMO, metaA);
        ReportRegistry.Report memory ra = registry.getReport(idA);
        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(ra.assertionId);

        // Second sighting: disputed via real UMA, then DVM rules truthful.
        string memory metaB = "bzz://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
        (bytes32 idB, uint256 umaBond) = _submit(IMO, metaB);
        ReportRegistry.Report memory rb = registry.getReport(idB);

        _fundAndApprove(verifier, address(oo), umaBond);
        vm.prank(verifier);
        oo.disputeAssertion(rb.assertionId, verifier);

        assertEq(registry.getReport(idB).status, 1, "status=DISPUTED");

        // DVM-truthful: simulate by pranking OOv3 and topping up the bond
        // UMA would normally return alongside the callback.
        uint256 bal = weth.balanceOf(address(registry));
        deal(WETH_ADDR, address(registry), bal + umaBond);

        vm.prank(address(oo));
        registry.assertionResolvedCallback(rb.assertionId, true);

        assertEq(registry.sightingsByImo(IMO), 2, "sightings=2");
        assertEq(registry.disputedByImo(IMO),  1, "disputed=1 (this one was disputed-then-upheld)");

        bytes32 node = _vesselNode(IMO);
        assertEq(resolver.text(node, "vessel.sightings.count"),    "2");
        assertEq(resolver.text(node, "vessel.sightings.disputed"), "1");
    }

    function test_DisputedSettledFalse_DoesNotTouchLighthouse() public {
        // First mint
        string memory metaA = "bzz://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1";
        (bytes32 idA, ) = _submit(IMO, metaA);
        ReportRegistry.Report memory ra = registry.getReport(idA);
        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(ra.assertionId);

        bytes32 node = _vesselNode(IMO);
        string memory swarmAfterFirst = resolver.text(node, "vessel.swarm.log");

        // Second sighting: disputed, then DVM rules false. ENS records must
        // be unchanged from their post-first-mint state.
        string memory metaB = "bzz://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2";
        (bytes32 idB, uint256 umaBond) = _submit(IMO, metaB);
        ReportRegistry.Report memory rb = registry.getReport(idB);

        _fundAndApprove(verifier, address(oo), umaBond);
        vm.prank(verifier);
        oo.disputeAssertion(rb.assertionId, verifier);

        vm.prank(address(oo));
        registry.assertionResolvedCallback(rb.assertionId, false);

        // Counters unchanged since the false-resolve path doesn't bump them.
        assertEq(registry.sightingsByImo(IMO), 1, "sightings still 1");
        assertEq(registry.disputedByImo(IMO),  0, "disputed still 0");
        // ENS records unchanged.
        assertEq(resolver.text(node, "vessel.swarm.log"),         swarmAfterFirst);
        assertEq(resolver.text(node, "vessel.sightings.count"),    "");
        assertEq(resolver.text(node, "vessel.sightings.disputed"), "");
    }

    function test_Attest_AfterTruthfulSettle_WritesOrbitalRecords() public {
        string memory meta = "bzz://0000000000000000000000000000000000000000000000000000000000000abc";
        (bytes32 reportId, ) = _submit(IMO, meta);
        ReportRegistry.Report memory r = registry.getReport(reportId);
        vm.warp(block.timestamp + LIVENESS + 1);
        oo.settleAssertion(r.assertionId);

        bytes32 imageHash    = keccak256("orbital-image-bytes");
        string memory image  = "bzz://image-ref";
        string memory tee    = "bzz://tee-prediction";

        bytes memory sig = _signOrbitalAttest(reportId, imageHash, tee);
        registry.attest(reportId, image, imageHash, tee, sig);

        bytes32 node = _vesselNode(IMO);
        assertEq(resolver.text(node, "vessel.orbital.image"),          image);
        assertEq(resolver.text(node, "vessel.orbital.tee.prediction"), tee);
        // imageHash text is "0x" + 64 hex chars
        assertEq(bytes(resolver.text(node, "vessel.orbital.imageHash")).length, 66);
    }

    function test_SetLighthouse_OnlyOnce() public {
        Lighthouse other = new Lighthouse(
            address(wrapper), address(resolver),
            VESSEL_PARENT, VERIFIER_PARENT, address(registry)
        );
        vm.expectRevert(ReportRegistry.LighthouseAlreadySet.selector);
        registry.setLighthouse(ILighthouse(address(other)));
    }

    function test_SetLighthouse_OnlyAdmin() public {
        // Need a fresh registry with no lighthouse wired.
        SlashPool sp2 = new SlashPool(weth);
        ReportRegistry r2 = new ReportRegistry(
            weth, oo, sp2, treasury, attestor, PROTOCOL_BOND, LIVENESS, GATEWAY
        );
        // r2.admin() is this test contract.
        vm.prank(makeAddr("notAdmin"));
        vm.expectRevert(ReportRegistry.NotAdmin.selector);
        r2.setLighthouse(ILighthouse(address(lighthouse)));
    }
}
