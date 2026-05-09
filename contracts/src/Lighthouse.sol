// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface INameWrapper {
    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node);

    function setSubnodeOwner(
        bytes32 parentNode,
        string calldata label,
        address owner,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node);
}

interface IPublicResolver {
    function setText(bytes32 node, string calldata key, string calldata value) external;
    function setContenthash(bytes32 node, bytes calldata hash) external;
}

/// @title Lighthouse — Phare's on-chain ENS layer
/// @notice One contract for two namespaces under `phare.eth`:
///         - `imo-<n>.vessel.phare.eth`   — owned by this contract, sealed by CANNOT_TRANSFER
///         - `<handle>.verifier.phare.eth` — owned by the principal, PCC burnt
///         See LIGHTHOUSE_SPEC.md §3 for the full design.
/// @dev    Operator-approved on both wrapped parents during pre-event setup
///         (`NameWrapper.setApprovalForAll(Lighthouse, true)`). Vessel mints
///         and updates are gated to `reportRegistry`. Verifier mints are
///         permissionless.
contract Lighthouse {
    INameWrapper    public immutable nameWrapper;
    IPublicResolver public immutable resolver;
    bytes32         public immutable vesselParent;
    bytes32         public immutable verifierParent;
    address         public immutable reportRegistry;

    // Fuse bits (https://docs.ens.domains/wrapper/fuses)
    uint32 internal constant CANNOT_UNWRAP          = 0x00000001;
    uint32 internal constant CANNOT_TRANSFER        = 0x00000004;
    uint32 internal constant PARENT_CANNOT_CONTROL  = 0x00010000;

    uint32 internal constant FUSES_VERIFIER = PARENT_CANNOT_CONTROL;
    uint32 internal constant FUSES_VESSEL   = PARENT_CANNOT_CONTROL | CANNOT_TRANSFER | CANNOT_UNWRAP;

    uint64 internal constant MAX_EXPIRY = type(uint64).max;

    event VesselNamed(uint256 indexed imo, bytes32 indexed node, string ens);
    event VesselSighted(uint256 indexed imo, bytes32 indexed node, uint32 sightings, uint32 disputed);
    event VesselOrbital(uint256 indexed imo, bytes32 indexed node, bytes32 imageHash);
    event VerifierEnrolled(address indexed principal, string handle, bytes32 indexed node);

    error NotRegistry();

    modifier onlyRegistry() {
        if (msg.sender != reportRegistry) revert NotRegistry();
        _;
    }

    constructor(
        address _nameWrapper,
        address _resolver,
        bytes32 _vesselParent,
        bytes32 _verifierParent,
        address _reportRegistry
    ) {
        nameWrapper    = INameWrapper(_nameWrapper);
        resolver       = IPublicResolver(_resolver);
        vesselParent   = _vesselParent;
        verifierParent = _verifierParent;
        reportRegistry = _reportRegistry;
    }

    // ─── Vessels ─────────────────────────────────────────────────────────

    /// @notice Mint `imo-<n>.vessel.phare.eth`, owned by this contract, sealed
    ///         by CANNOT_TRANSFER. Records the IMO and the initial Swarm log
    ///         pointer. Subsequent settlements call `recordSighting`.
    function nameVessel(uint256 imo, string calldata swarmRef)
        external
        onlyRegistry
        returns (bytes32 node)
    {
        string memory label = _vesselLabel(imo);
        node = nameWrapper.setSubnodeRecord(
            vesselParent,
            label,
            address(this),
            address(resolver),
            0,
            FUSES_VESSEL,
            MAX_EXPIRY
        );
        resolver.setText(node, "vessel.imo", _toString(imo));
        resolver.setText(node, "vessel.swarm.log", swarmRef);
        emit VesselNamed(imo, node, string.concat(label, ".vessel.phare.eth"));
    }

    /// @notice Update vessel records after a subsequent upheld settlement.
    function recordSighting(
        uint256 imo,
        string calldata swarmRef,
        uint32 sightings,
        uint32 disputed
    ) external onlyRegistry {
        bytes32 node = _vesselNode(imo);
        resolver.setText(node, "vessel.swarm.log", swarmRef);
        resolver.setText(node, "vessel.sightings.count",    _toString(sightings));
        resolver.setText(node, "vessel.sightings.disputed", _toString(disputed));
        emit VesselSighted(imo, node, sightings, disputed);
    }

    /// @notice Record orbital corroboration on a vessel. Fields scoped under
    ///         `vessel.orbital.*` per ENS_SPEC §3.2.
    function recordOrbital(
        uint256 imo,
        string calldata image,
        bytes32 imageHash,
        string calldata teePrediction
    ) external onlyRegistry {
        bytes32 node = _vesselNode(imo);
        resolver.setText(node, "vessel.orbital.image",          image);
        resolver.setText(node, "vessel.orbital.imageHash",      _toHex(imageHash));
        resolver.setText(node, "vessel.orbital.tee.prediction", teePrediction);
        emit VesselOrbital(imo, node, imageHash);
    }

    // ─── Verifiers ───────────────────────────────────────────────────────

    /// @notice Permissionless verifier registration. Mints
    ///         `<handle>.verifier.phare.eth` to msg.sender with PCC burnt,
    ///         setting policy / soul / runtime text records atomically.
    /// @dev    Two-step transfer: mint with self as owner so we can write
    ///         records, then re-assign ownership to msg.sender with
    ///         PARENT_CANNOT_CONTROL burnt in a single setSubnodeOwner call.
    function enrollVerifier(
        string calldata handle,
        string calldata policyURI,
        string calldata soulURI
    ) external returns (bytes32 node) {
        // 1. Mint with self as wrapped owner so we have authority to setText.
        node = nameWrapper.setSubnodeRecord(
            verifierParent,
            handle,
            address(this),
            address(resolver),
            0,
            0, // no fuses yet — parent retains control for the transfer below
            MAX_EXPIRY
        );

        // 2. Write the three identity / soul / policy text records.
        resolver.setText(node, "verifier.policy",  policyURI);
        resolver.setText(node, "verifier.soul",    soulURI);
        resolver.setText(node, "verifier.runtime", "openclaw");

        // 3. Hand the wrapped subname to the principal and burn PCC. After
        //    this call, only the principal can write records on this node.
        nameWrapper.setSubnodeOwner(
            verifierParent,
            handle,
            msg.sender,
            FUSES_VERIFIER,
            MAX_EXPIRY
        );

        emit VerifierEnrolled(msg.sender, handle, node);
    }

    // ─── ERC1155 receiver (NameWrapper mints wrapped names as ERC1155) ───

    /// @dev NameWrapper's `setSubnodeRecord` does a `_safeMint` of the wrapped
    ///      ERC-1155 token to `owner`. When `owner == address(this)` (vessel
    ///      mint, and step 1 of verifier enrollment) the safe-transfer hook
    ///      runs and the call reverts unless we accept it. We accept any
    ///      ERC-1155 — the only legitimate caller in our flows is NameWrapper.
    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    /// @dev ERC-165 introspection. NameWrapper queries this before invoking
    ///      `onERC1155Received` in some paths.
    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == 0x01ffc9a7 || // ERC-165
            interfaceId == 0x4e2312e0;   // ERC-1155 Receiver
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _vesselLabel(uint256 imo) internal pure returns (string memory) {
        return string.concat("imo-", _toString(imo));
    }

    function _vesselNode(uint256 imo) internal view returns (bytes32) {
        bytes32 labelhash = keccak256(bytes(_vesselLabel(imo)));
        return keccak256(abi.encodePacked(vesselParent, labelhash));
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    function _toHex(bytes32 value) internal pure returns (string memory) {
        bytes16 alphabet = 0x30313233343536373839616263646566; // "0123456789abcdef"
        bytes memory str = new bytes(66);
        str[0] = "0";
        str[1] = "x";
        for (uint256 i = 0; i < 32; i++) {
            str[2 + i * 2]     = alphabet[uint8(uint8(value[i]) >> 4)];
            str[2 + i * 2 + 1] = alphabet[uint8(uint8(value[i]) & 0x0f)];
        }
        return string(str);
    }
}
