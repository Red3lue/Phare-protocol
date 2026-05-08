// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface ISlashPool {
    function deposit(bytes32 reportId, uint256 amount) external;
}

interface ILighthouse {
    function nameVessel(uint256 imo, string calldata swarmRef) external returns (bytes32);
    function recordSighting(uint256 imo, string calldata swarmRef, uint32 sightings, uint32 disputed) external;
    function recordOrbital(uint256 imo, string calldata image, bytes32 imageHash, string calldata teePrediction) external;
}

/// @notice Minimal slice of UMA Optimistic Oracle V3 we depend on.
///         See https://docs.uma.xyz/developers/optimistic-oracle-v3 for full ABI.
interface IOptimisticOracleV3 {
    struct EscalationManagerSettings {
        bool arbitrateViaEscalationManager;
        bool discardOracle;
        bool validateDisputers;
        address assertingCaller;
        address escalationManager;
    }

    struct Assertion {
        EscalationManagerSettings escalationManagerSettings;
        address asserter;
        uint64 assertionTime;
        bool settled;
        IERC20 currency;
        uint64 expirationTime;
        bool settlementResolution;
        bytes32 domainId;
        bytes32 identifier;
        uint256 bond;
        address callbackRecipient;
        address disputer;
    }

    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domain
    ) external returns (bytes32 assertionId);

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory);
    function getMinimumBond(address currency) external view returns (uint256);
}

/// @title ReportRegistry — Phare's bonded sighting registry on Sepolia
/// @notice Per DESIGN_DOCUMENT §4.5 and §8.1. Holds the real $5 USDC bond
///         in this contract (UMA only sees an anti-spam minimum), runs the
///         50/30/20 slash split, calls into Lighthouse on settlement, and
///         records orbital corroborations from the SpaceComputer KMS key.
/// @dev    WebAuthn signature verification is intentionally not wired up
///         in this scaffold — the signature parameter is preserved on the
///         submit ABI so a Daimo p256-verifier integration can drop in.
contract ReportRegistry {
    // ─── Immutable wiring ────────────────────────────────────────────────

    IERC20 public immutable usdc;
    IOptimisticOracleV3 public immutable uma;
    ISlashPool public immutable slashPool;
    address public immutable treasury;
    address public immutable orbitalAttestor;
    uint128 public immutable bondAmount; // $5 USDC = 5_000_000
    uint64  public immutable liveness;   // seconds
    bytes32 public immutable identifier; // UMA truth identifier ("ASSERT_TRUTH")
    address public immutable deployer;   // used once to set lighthouse

    // ─── Wired post-deploy (Lighthouse depends on this contract) ─────────

    ILighthouse public lighthouse;

    // ─── Storage ─────────────────────────────────────────────────────────

    struct Report {
        address reporter;
        uint256 imo;
        string  metaSwarmRef;
        uint128 bond;
        uint64  submittedAt;
        bool    settled;
        bool    reportUpheld;
        bool    orbitallyCorroborated;
        bytes32 orbitalImageHash;
    }

    mapping(bytes32 reportId => Report) public reports;
    mapping(bytes32 assertionId => bytes32 reportId) public assertionToReport;
    mapping(uint256 imo => bool) public vesselNamed;
    mapping(uint256 imo => uint32) public sightingsByImo;
    mapping(uint256 imo => uint32) public disputedByImo;

    // ─── Events ──────────────────────────────────────────────────────────

    event Submitted(bytes32 indexed reportId, address indexed reporter, uint256 indexed imo, string metaSwarmRef, bytes32 assertionId);
    event Settled(bytes32 indexed reportId, bool reportUpheld);
    event Disputed(bytes32 indexed reportId, address indexed disputer);
    event OrbitallyCorroborated(bytes32 indexed reportId, bytes32 imageHash);
    event LighthouseSet(address indexed lighthouse);

    // ─── Errors ──────────────────────────────────────────────────────────

    error NotUma();
    error NotDeployer();
    error LighthouseAlreadySet();
    error LighthouseNotSet();
    error UnknownAssertion();
    error UnknownReport();
    error AlreadySettled();
    error NotUpheld();
    error AlreadyCorroborated();
    error BadSignature();
    error TransferFailed();
    error DuplicateReport();

    // ─── Construction ────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _uma,
        address _slashPool,
        address _treasury,
        address _orbitalAttestor,
        uint128 _bondAmount,
        uint64  _liveness
    ) {
        usdc = IERC20(_usdc);
        uma = IOptimisticOracleV3(_uma);
        slashPool = ISlashPool(_slashPool);
        treasury = _treasury;
        orbitalAttestor = _orbitalAttestor;
        bondAmount = _bondAmount;
        liveness = _liveness;
        identifier = bytes32("ASSERT_TRUTH");
        deployer = msg.sender;

        // Pre-approve UMA and SlashPool for unbounded pulls.
        usdc.approve(_uma, type(uint256).max);
        usdc.approve(_slashPool, type(uint256).max);
    }

    /// @notice Wire up Lighthouse once after both contracts are deployed.
    function setLighthouse(address _lighthouse) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (address(lighthouse) != address(0)) revert LighthouseAlreadySet();
        lighthouse = ILighthouse(_lighthouse);
        emit LighthouseSet(_lighthouse);
    }

    // ─── Submit ──────────────────────────────────────────────────────────

    /// @notice Submit a sighting. Pulls `bondAmount` USDC from the caller,
    ///         opens a UMA truth assertion with the project's anti-spam
    ///         minimum bond, and stores the report.
    /// @dev    `webauthnSig` is preserved on the ABI for a future Daimo
    ///         p256-verifier integration; not verified in this scaffold.
    function submit(
        uint256 imo,
        string calldata metaSwarmRef,
        bytes32 photoHash,
        uint64 timestamp,
        uint256 nonce,
        bytes calldata /*webauthnSig*/
    ) external returns (bytes32 reportId) {
        if (address(lighthouse) == address(0)) revert LighthouseNotSet();

        // Pull the real bond into ReportRegistry's escrow.
        if (!usdc.transferFrom(msg.sender, address(this), bondAmount)) revert TransferFailed();

        reportId = keccak256(
            abi.encode(msg.sender, imo, metaSwarmRef, photoHash, timestamp, nonce, block.chainid)
        );
        if (reports[reportId].reporter != address(0)) revert DuplicateReport();

        reports[reportId] = Report({
            reporter: msg.sender,
            imo: imo,
            metaSwarmRef: metaSwarmRef,
            bond: bondAmount,
            submittedAt: uint64(block.timestamp),
            settled: false,
            reportUpheld: false,
            orbitallyCorroborated: false,
            orbitalImageHash: bytes32(0)
        });

        // Open the UMA truth assertion. The asserter is this contract; the
        // anti-spam bond is funded from this contract's USDC balance, which
        // the deployer seeds before the first submit.
        bytes memory claim = bytes(string.concat("Report at bzz://", metaSwarmRef, " is true"));
        uint256 antiSpam = uma.getMinimumBond(address(usdc));
        bytes32 assertionId = uma.assertTruth(
            claim,
            address(this),
            address(this),
            address(0),
            liveness,
            usdc,
            antiSpam,
            identifier,
            bytes32(0)
        );

        assertionToReport[assertionId] = reportId;
        emit Submitted(reportId, msg.sender, imo, metaSwarmRef, assertionId);
    }

    // ─── UMA callbacks ───────────────────────────────────────────────────

    /// @notice UMA OOv3 settlement callback. Applies the slash split or
    ///         refund, and pokes Lighthouse to mint or update the vessel
    ///         subname when the report was upheld.
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external {
        if (msg.sender != address(uma)) revert NotUma();
        bytes32 reportId = assertionToReport[assertionId];
        if (reportId == bytes32(0)) revert UnknownAssertion();

        Report storage r = reports[reportId];
        if (r.settled) revert AlreadySettled();

        IOptimisticOracleV3.Assertion memory asn = uma.getAssertion(assertionId);
        bool wasDisputed = asn.disputer != address(0);

        r.settled = true;
        r.reportUpheld = assertedTruthfully;

        if (assertedTruthfully) {
            sightingsByImo[r.imo] += 1;
            if (wasDisputed) disputedByImo[r.imo] += 1;

            uint256 imo = r.imo;
            string memory ref = r.metaSwarmRef;

            if (!vesselNamed[imo]) {
                vesselNamed[imo] = true;
                lighthouse.nameVessel(imo, ref);
            } else {
                lighthouse.recordSighting(imo, ref, sightingsByImo[imo], disputedByImo[imo]);
            }

            // Refund the full bond to the reporter.
            if (!usdc.transfer(r.reporter, r.bond)) revert TransferFailed();
        } else {
            // Slash 50 / 30 / 20.
            uint256 b = r.bond;
            uint256 toDisputer = b / 2;
            uint256 toPool = (b * 30) / 100;
            uint256 toTreasury = b - toDisputer - toPool;

            if (toDisputer > 0 && asn.disputer != address(0)) {
                if (!usdc.transfer(asn.disputer, toDisputer)) revert TransferFailed();
            }
            if (toPool > 0) {
                slashPool.deposit(reportId, toPool); // pulls via the constructor-set approval
            }
            if (toTreasury > 0) {
                if (!usdc.transfer(treasury, toTreasury)) revert TransferFailed();
            }
        }

        emit Settled(reportId, assertedTruthfully);
    }

    /// @notice UMA OOv3 dispute callback — informational only; we mark the
    ///         dispute event and let the eventual resolution callback handle
    ///         the bond split.
    function assertionDisputedCallback(bytes32 assertionId) external {
        if (msg.sender != address(uma)) revert NotUma();
        bytes32 reportId = assertionToReport[assertionId];
        if (reportId == bytes32(0)) revert UnknownAssertion();
        IOptimisticOracleV3.Assertion memory asn = uma.getAssertion(assertionId);
        emit Disputed(reportId, asn.disputer);
    }

    // ─── Orbital corroboration ───────────────────────────────────────────

    /// @notice Record an orbital corroboration on a previously-settled,
    ///         upheld report. Verifies an EIP-191 signature from the
    ///         SpaceComputer KMS-derived address baked in at deploy time.
    function attest(
        bytes32 reportId,
        bytes32 imageHash,
        string calldata imageRef,
        string calldata teePredictionRef,
        bytes calldata sig
    ) external {
        Report storage r = reports[reportId];
        if (!r.settled || !r.reportUpheld) revert NotUpheld();
        if (r.orbitallyCorroborated) revert AlreadyCorroborated();

        bytes32 inner = keccak256(abi.encode(reportId, imageHash, imageRef, teePredictionRef));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", inner));
        address recovered = _recover(digest, sig);
        if (recovered != orbitalAttestor) revert BadSignature();

        r.orbitallyCorroborated = true;
        r.orbitalImageHash = imageHash;

        lighthouse.recordOrbital(r.imo, imageRef, imageHash, teePredictionRef);
        emit OrbitallyCorroborated(reportId, imageHash);
    }

    // ─── Internals ───────────────────────────────────────────────────────

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }
}
