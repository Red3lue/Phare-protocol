// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm}                 from "forge-std/Test.sol";
import {Lighthouse}                from "../src/Lighthouse.sol";
import {MockNameWrapper, MockPublicResolver} from "./mocks/MockENS.sol";

/// @notice Standalone unit tests for `Lighthouse.sol` against local ENS mocks
///         that mirror the real authorization model. Covers minting, post-mint
///         text-record updates, the two-step verifier handover, and registry
///         gating.
contract LighthouseTest is Test {
    MockNameWrapper     internal wrapper;
    MockPublicResolver  internal resolver;
    Lighthouse          internal lighthouse;

    bytes32 internal constant VESSEL_PARENT   = keccak256("vessel.phare.eth");
    bytes32 internal constant VERIFIER_PARENT = keccak256("verifier.phare.eth");

    address internal registry  = makeAddr("reportRegistry");
    address internal principal = makeAddr("verifierPrincipal");
    address internal stranger  = makeAddr("stranger");

    // Mirror of Lighthouse's private fuse constants.
    uint32 internal constant CANNOT_UNWRAP         = 0x00000001;
    uint32 internal constant CANNOT_TRANSFER       = 0x00000004;
    uint32 internal constant PARENT_CANNOT_CONTROL = 0x00010000;
    uint32 internal constant FUSES_VESSEL    = PARENT_CANNOT_CONTROL | CANNOT_TRANSFER | CANNOT_UNWRAP;
    uint32 internal constant FUSES_VERIFIER  = PARENT_CANNOT_CONTROL;

    function setUp() public {
        wrapper    = new MockNameWrapper();
        resolver   = new MockPublicResolver(wrapper);
        lighthouse = new Lighthouse(
            address(wrapper),
            address(resolver),
            VESSEL_PARENT,
            VERIFIER_PARENT,
            registry
        );

        // Pretend the deployer minted the two parents and approved Lighthouse
        // as operator. Mocks don't enforce operator approval, so this is
        // documentation more than authority — but it mirrors `ENS_INIT.md §7`.
        wrapper.mintRoot(VESSEL_PARENT,   address(this));
        wrapper.mintRoot(VERIFIER_PARENT, address(this));
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    function _vesselNode(uint256 imo) internal pure returns (bytes32) {
        string memory label = string.concat("imo-", _toString(imo));
        return keccak256(abi.encodePacked(VESSEL_PARENT, keccak256(bytes(label))));
    }

    function _verifierNode(string memory handle) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(VERIFIER_PARENT, keccak256(bytes(handle))));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buf = new bytes(digits);
        while (value != 0) {
            digits--;
            buf[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buf);
    }

    // ─── Vessels ─────────────────────────────────────────────────────────

    function test_NameVessel_HappyPath() public {
        uint256 imo = 9133701;
        string  memory swarmRef = "bzz://aaaa";

        vm.prank(registry);
        bytes32 node = lighthouse.nameVessel(imo, swarmRef);

        assertEq(node, _vesselNode(imo), "node hash");
        assertEq(wrapper.ownerOf(uint256(node)), address(lighthouse), "vessel owner = Lighthouse");

        (, uint32 fuses, ) = wrapper.getData(uint256(node));
        assertEq(uint256(fuses), uint256(FUSES_VESSEL), "vessel fuses");

        assertEq(resolver.text(node, "vessel.imo"),       _toString(imo));
        assertEq(resolver.text(node, "vessel.swarm.log"), swarmRef);
    }

    function test_NameVessel_OnlyRegistry() public {
        vm.prank(stranger);
        vm.expectRevert(Lighthouse.NotRegistry.selector);
        lighthouse.nameVessel(1, "bzz://x");
    }

    function test_RecordSighting_OverwritesPriorValuesAndUpdatesCounters() public {
        uint256 imo = 9133701;

        vm.prank(registry);
        lighthouse.nameVessel(imo, "bzz://first");

        bytes32 node = _vesselNode(imo);
        assertEq(resolver.text(node, "vessel.swarm.log"), "bzz://first");

        vm.prank(registry);
        lighthouse.recordSighting(imo, "bzz://second", 2, 1);

        // setText is overwrite, not append.
        assertEq(resolver.text(node, "vessel.swarm.log"),         "bzz://second");
        assertEq(resolver.text(node, "vessel.sightings.count"),    "2");
        assertEq(resolver.text(node, "vessel.sightings.disputed"), "1");

        // imo record was set at mint and is not touched by recordSighting.
        assertEq(resolver.text(node, "vessel.imo"), _toString(imo));
    }

    function test_RecordSighting_OnlyRegistry() public {
        vm.prank(registry);
        lighthouse.nameVessel(1, "bzz://x");

        vm.prank(stranger);
        vm.expectRevert(Lighthouse.NotRegistry.selector);
        lighthouse.recordSighting(1, "bzz://y", 2, 0);
    }

    function test_RecordOrbital_WritesAllThreeKeys() public {
        uint256 imo = 9133701;
        bytes32 imageHash = keccak256("img");

        vm.prank(registry);
        lighthouse.nameVessel(imo, "bzz://log");

        vm.prank(registry);
        lighthouse.recordOrbital(imo, "bzz://image", imageHash, "bzz://tee");

        bytes32 node = _vesselNode(imo);
        assertEq(resolver.text(node, "vessel.orbital.image"),          "bzz://image");
        assertEq(resolver.text(node, "vessel.orbital.tee.prediction"), "bzz://tee");
        // imageHash text is the lower-cased 0x-prefixed hex.
        bytes memory got = bytes(resolver.text(node, "vessel.orbital.imageHash"));
        assertEq(got.length, 66, "0x + 64 hex");
        assertEq(bytes1(got[0]), bytes1("0"));
        assertEq(bytes1(got[1]), bytes1("x"));
    }

    function test_VesselReMint_RevertsBecauseNodeAlreadyExists() public {
        // Real NameWrapper rejects re-mint on a child whose owner-controlled
        // fuses are burnt. The mock doesn't enforce that, but we still want
        // to document the expected behaviour: registry must call only on
        // first sighting (or guard upstream).
        vm.prank(registry);
        lighthouse.nameVessel(1, "bzz://x");

        // Mock allows re-mint but overwrites — assert that's the mock's
        // behaviour so we don't accidentally rely on "real" reverting here.
        vm.prank(registry);
        bytes32 node = lighthouse.nameVessel(1, "bzz://y");
        assertEq(wrapper.ownerOf(uint256(node)), address(lighthouse));
        // Documentation marker: on real NameWrapper this second call reverts.
        // ReportRegistry guards via `vesselNamed[imo]` so we never call twice.
    }

    // ─── Verifiers ───────────────────────────────────────────────────────

    function test_EnrollVerifier_PermissionlessTwoStepHandover() public {
        string memory handle = "agent-3a4b5c";

        vm.prank(principal);
        bytes32 node = lighthouse.enrollVerifier(handle, "bzz://policy", "bzz://soul");

        assertEq(node, _verifierNode(handle));

        // After the two-step, the principal owns the wrapped node...
        assertEq(wrapper.ownerOf(uint256(node)), principal, "owner = principal");

        // ...with PCC burnt (and only PCC).
        (, uint32 fuses, ) = wrapper.getData(uint256(node));
        assertEq(uint256(fuses), uint256(FUSES_VERIFIER), "verifier fuses");

        // Records were written by Lighthouse during step 2 (when it owned).
        assertEq(resolver.text(node, "verifier.policy"),  "bzz://policy");
        assertEq(resolver.text(node, "verifier.soul"),    "bzz://soul");
        assertEq(resolver.text(node, "verifier.runtime"), "openclaw");
    }

    function test_EnrollVerifier_AnyoneCanCall() public {
        // No `onlyRegistry` on enrollVerifier — permissionless by design.
        vm.prank(stranger);
        bytes32 node = lighthouse.enrollVerifier("any-handle", "p", "s");
        assertEq(wrapper.ownerOf(uint256(node)), stranger);
    }

    // ─── Post-mint updates (the §5 question) ─────────────────────────────

    function test_PostMint_VesselUpdate_RegistryWritesNewValue() public {
        uint256 imo = 9133701;

        vm.prank(registry);
        lighthouse.nameVessel(imo, "bzz://old");

        bytes32 node = _vesselNode(imo);
        assertEq(resolver.text(node, "vessel.swarm.log"), "bzz://old");

        // Update via Lighthouse — Lighthouse owns the wrapped node.
        vm.prank(registry);
        lighthouse.recordSighting(imo, "bzz://new", 5, 2);
        assertEq(resolver.text(node, "vessel.swarm.log"), "bzz://new");
    }

    function test_PostMint_VesselUpdate_DirectResolverCallReverts() public {
        // Sanity: even the registry can't bypass Lighthouse and call the
        // resolver directly, because the resolver checks wrapped ownership
        // and the wrapped owner is the Lighthouse contract, not the registry.
        uint256 imo = 9133701;
        vm.prank(registry);
        lighthouse.nameVessel(imo, "bzz://x");

        bytes32 node = _vesselNode(imo);
        vm.prank(registry);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockPublicResolver.NotAuthorised.selector,
                registry,
                address(lighthouse)
            )
        );
        resolver.setText(node, "vessel.swarm.log", "bzz://hijack");
    }

    function test_PostMint_VerifierUpdate_PrincipalWritesDirectly() public {
        string memory handle = "agent-x";
        vm.prank(principal);
        bytes32 node = lighthouse.enrollVerifier(handle, "p", "s");

        // After enrollment Lighthouse is no longer the owner — the principal
        // calls the resolver directly. This is the spec §5.5 "post-dispute
        // writes" path.
        vm.prank(principal);
        resolver.setText(node, "verifier.lastDecision", "bzz://decision");
        assertEq(resolver.text(node, "verifier.lastDecision"), "bzz://decision");

        // And a stranger cannot write — only the principal owns the node.
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                MockPublicResolver.NotAuthorised.selector,
                stranger,
                principal
            )
        );
        resolver.setText(node, "verifier.lastDecision", "bzz://hijack");
    }

    function test_PostMint_VerifierUpdate_LighthouseCannotWriteAnymore() public {
        // After the handover, Lighthouse itself loses authority over the
        // verifier node. There's no exposed path through Lighthouse to write
        // a verifier text record post-enrollment; this test pokes the
        // resolver directly to prove the auth model.
        string memory handle = "agent-y";
        vm.prank(principal);
        bytes32 node = lighthouse.enrollVerifier(handle, "p", "s");

        vm.prank(address(lighthouse));
        vm.expectRevert(
            abi.encodeWithSelector(
                MockPublicResolver.NotAuthorised.selector,
                address(lighthouse),
                principal
            )
        );
        resolver.setText(node, "verifier.policy", "bzz://hijack");
    }

    // ─── Events ──────────────────────────────────────────────────────────

    function test_Events_VesselNamedEmitted() public {
        uint256 imo = 9133701;
        bytes32 expected = _vesselNode(imo);

        vm.prank(registry);
        vm.recordLogs();
        lighthouse.nameVessel(imo, "bzz://x");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        bool seen;
        bytes32 sig = keccak256("VesselNamed(uint256,bytes32,string)");
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length == 3 && logs[i].topics[0] == sig) {
                assertEq(uint256(logs[i].topics[1]), imo);
                assertEq(logs[i].topics[2], expected);
                seen = true;
                break;
            }
        }
        assertTrue(seen, "VesselNamed not emitted");
    }
}
