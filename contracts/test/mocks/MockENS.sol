// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC1155Receiver {
    function onERC1155Received(
        address operator,
        address from,
        uint256 id,
        uint256 value,
        bytes calldata data
    ) external returns (bytes4);
}

/// @notice Minimal NameWrapper mock that mirrors the ownership / fuses /
///         resolver state Lighthouse touches. Authorization is intentionally
///         lax (no operator-approval enforcement) — tests assert behaviour at
///         the Lighthouse boundary, not NameWrapper internals.
contract MockNameWrapper {
    struct Node {
        address owner;
        address resolver;
        uint64  ttl;
        uint32  fuses;
        uint64  expiry;
        bool    exists;
    }

    mapping(bytes32 node => Node)                      private _nodes;
    mapping(address owner => mapping(address operator => bool)) private _operatorApproval;

    event SubnodeRecord(
        bytes32 indexed parentNode,
        string  label,
        bytes32 indexed node,
        address owner,
        address resolver,
        uint32  fuses
    );

    event SubnodeOwner(
        bytes32 indexed parentNode,
        string  label,
        bytes32 indexed node,
        address owner,
        uint32  fuses
    );

    function setSubnodeRecord(
        bytes32 parentNode,
        string calldata label,
        address owner,
        address resolver,
        uint64 ttl,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node) {
        node = _node(parentNode, label);
        _nodes[node] = Node({
            owner:    owner,
            resolver: resolver,
            ttl:      ttl,
            fuses:    fuses,
            expiry:   expiry,
            exists:   true
        });
        // Mirror real NameWrapper: ERC1155 _safeMint invokes the receiver
        // hook on contract recipients. This is what catches the
        // "Lighthouse forgot onERC1155Received" bug at unit-test time.
        _safeMintHook(owner, uint256(node));
        emit SubnodeRecord(parentNode, label, node, owner, resolver, fuses);
    }

    function setSubnodeOwner(
        bytes32 parentNode,
        string calldata label,
        address owner,
        uint32 fuses,
        uint64 expiry
    ) external returns (bytes32 node) {
        node = _node(parentNode, label);
        Node storage n = _nodes[node];
        require(n.exists, "MockNameWrapper: node does not exist");
        address prev = n.owner;
        n.owner  = owner;
        n.fuses  = fuses;
        n.expiry = expiry;
        // Real NameWrapper does a safeTransferFrom on owner change; if the
        // new owner is a contract, the receiver hook runs.
        if (owner != prev) _safeMintHook(owner, uint256(node));
        emit SubnodeOwner(parentNode, label, node, owner, fuses);
    }

    /// @dev Calls `onERC1155Received` on contract recipients, reverting if
    ///      the recipient doesn't implement the receiver interface — same
    ///      shape as OpenZeppelin's ERC-1155 `_doSafeTransferAcceptanceCheck`.
    function _safeMintHook(address to, uint256 id) internal {
        if (to.code.length == 0) return;
        try IERC1155Receiver(to).onERC1155Received(msg.sender, address(0), id, 1, "")
            returns (bytes4 retval)
        {
            require(
                retval == IERC1155Receiver.onERC1155Received.selector,
                "MockNameWrapper: receiver returned wrong selector"
            );
        } catch Error(string memory reason) {
            revert(reason);
        } catch {
            revert("MockNameWrapper: ERC1155 transfer to non-receiver");
        }
    }

    function ownerOf(uint256 id) external view returns (address) {
        return _nodes[bytes32(id)].owner;
    }

    function getData(uint256 id) external view returns (address owner, uint32 fuses, uint64 expiry) {
        Node storage n = _nodes[bytes32(id)];
        return (n.owner, n.fuses, n.expiry);
    }

    function getResolver(bytes32 node) external view returns (address) {
        return _nodes[node].resolver;
    }

    function setApprovalForAll(address operator, bool approved) external {
        _operatorApproval[msg.sender][operator] = approved;
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApproval[owner][operator];
    }

    /// @dev Convenience used by tests / the parent-mint helper.
    function mintRoot(bytes32 node, address owner) external {
        _nodes[node] = Node({
            owner:    owner,
            resolver: address(0),
            ttl:      0,
            fuses:    0,
            expiry:   type(uint64).max,
            exists:   true
        });
    }

    function _node(bytes32 parent, string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parent, keccak256(bytes(label))));
    }
}

/// @notice Minimal PublicResolver mock that enforces the real authorization
///         rule: only the current wrapped owner of `node` may write. This is
///         what makes the Lighthouse two-step verifier mint test meaningful —
///         a one-step mint-to-msg.sender would revert here just like on
///         Sepolia.
contract MockPublicResolver {
    MockNameWrapper public immutable nameWrapper;

    mapping(bytes32 node => mapping(string key => string value)) private _texts;
    mapping(bytes32 node => bytes)                               private _contenthash;

    event TextChanged(bytes32 indexed node, string indexedKey, string key, string value);
    event ContenthashChanged(bytes32 indexed node, bytes hash);

    error NotAuthorised(address caller, address owner);

    constructor(MockNameWrapper _nameWrapper) {
        nameWrapper = _nameWrapper;
    }

    modifier onlyNodeOwner(bytes32 node) {
        address owner = nameWrapper.ownerOf(uint256(node));
        if (msg.sender != owner) revert NotAuthorised(msg.sender, owner);
        _;
    }

    function setText(bytes32 node, string calldata key, string calldata value)
        external
        onlyNodeOwner(node)
    {
        _texts[node][key] = value;
        emit TextChanged(node, key, key, value);
    }

    function setContenthash(bytes32 node, bytes calldata hash) external onlyNodeOwner(node) {
        _contenthash[node] = hash;
        emit ContenthashChanged(node, hash);
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        return _texts[node][key];
    }

    function contenthash(bytes32 node) external view returns (bytes memory) {
        return _contenthash[node];
    }
}
