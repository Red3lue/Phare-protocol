// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20}              from "./interfaces/IERC20.sol";
import {IOptimisticOracleV3} from "./interfaces/IOptimisticOracleV3.sol";
import {ISlashPool}          from "./interfaces/ISlashPool.sol";
import {ILighthouse}         from "./interfaces/ILighthouse.sol";

/// @title  ReportRegistry
/// @notice Phare's bonded sighting registry. Reporters escrow a protocol bond
///         (denominated in `bondCurrency`) behind each report; UMA OOv3
///         adjudicates the truth claim; slashed bonds split 50% disputer /
///         30% slash pool / 20% treasury per Design Document §8. Real bond
///         is held here, not inside UMA — UMA receives only its minimum
///         anti-spam bond. Settlement occurs via the OOv3 resolution
///         callback. Orbital corroboration is bound by an EIP-191 signature
///         from the KMS-derived `orbitalAttestor`. Immutable, no proxies,
///         no governance.
///
///         The bond currency is whatever ERC20 was passed at construction.
///         For Sepolia we use WETH (the canonical UMA-whitelisted USDC has
///         a 400-token minimum bond which is impractical for a hackathon
///         demo); for mainnet a USDC variant remains the design default.
contract ReportRegistry {
    // ────────────────────────────────────────────────────────────────────────
    // Configuration
    // ────────────────────────────────────────────────────────────────────────

    IERC20              public immutable bondCurrency;
    IOptimisticOracleV3 public immutable oo;
    ISlashPool          public immutable slashPool;
    address             public immutable treasury;
    address             public immutable orbitalAttestor;
    uint96              public immutable protocolBond; // bond amount, in bondCurrency's smallest unit
    uint64              public immutable liveness;     // OOv3 challenge window, seconds
    string              public swarmGatewayPrefix;     // e.g. "https://gateway.ethswarm.org/access/"

    // Phare ENS layer. Settable exactly once by `admin` after Lighthouse is
    // deployed (chicken-and-egg: Lighthouse takes registry address as an
    // immutable). Until set, the truthful-settle and attest paths skip the
    // ENS calls — the registry remains fully functional without a Lighthouse.
    address      public immutable admin;
    ILighthouse  public           lighthouse;

    // Per-IMO state that backs the `vessel.sightings.*` text records.
    mapping(uint256 imo => uint32) public sightingsByImo;
    mapping(uint256 imo => uint32) public disputedByImo;
    mapping(uint256 imo => bool)   public vesselNamed;

    // ────────────────────────────────────────────────────────────────────────
    // Status codes
    // ────────────────────────────────────────────────────────────────────────

    uint8 internal constant STATUS_PENDING       = 0;
    uint8 internal constant STATUS_DISPUTED      = 1;
    uint8 internal constant STATUS_SETTLED_TRUE  = 2;
    uint8 internal constant STATUS_SETTLED_FALSE = 3;

    // ────────────────────────────────────────────────────────────────────────
    // Slash split (basis points, sum = 10_000)
    // ────────────────────────────────────────────────────────────────────────

    uint256 internal constant DISPUTER_BPS = 5_000;
    uint256 internal constant POOL_BPS     = 3_000;
    uint256 internal constant TREASURY_BPS = 2_000;
    uint256 internal constant BPS_DENOM    = 10_000;

    // ────────────────────────────────────────────────────────────────────────
    // Storage
    // ────────────────────────────────────────────────────────────────────────

    struct Report {
        address reporter;
        uint96  bond;             // protocol bond held here
        uint96  umaBond;          // UMA's anti-spam bond, round-tripped on truthful resolve
        uint64  submittedAt;
        uint64  settledAt;
        uint8   status;
        uint256 imo;
        bool    aisDark;
        bytes32 photoHash;        // sha256/keccak of photo bytes on Swarm
        string  metadataSwarm;    // bzz reference to metadata JSON
        bytes32 assertionId;      // UMA OOv3
        bool    orbitalAttested;
        bytes32 orbitalImageHash;
        // Vessel descriptors propagated to ENS text records on settle.
        // Reporter-supplied; not adjudicated separately by UMA — they ride
        // on the truthfulness assertion of the metadata as a whole.
        string  country;          // origin / flag-of-convenience hint, e.g. "RU"
        string  cargo;            // free-form cargo description, e.g. "Crude · ~730k bbl"
        string  lastSeen;         // "lat,lon" snapshot at submission time
    }

    uint256 public reportCount;
    mapping(bytes32 => Report)  public reports;
    mapping(bytes32 => bytes32) public assertionToReport;

    // ────────────────────────────────────────────────────────────────────────
    // Events
    // ────────────────────────────────────────────────────────────────────────

    event Submitted(
        bytes32 indexed reportId,
        address indexed reporter,
        uint256 indexed imo,
        bool    aisDark,
        bytes32 photoHash,
        string  metadataSwarm,
        bytes32 assertionId,
        uint96  bond,
        uint96  umaBond,
        string  country,
        string  cargo,
        string  lastSeen
    );

    event Disputed(bytes32 indexed reportId, address indexed disputer);

    event Settled(bytes32 indexed reportId, bool truthful);

    event OrbitallyCorroborated(
        bytes32 indexed reportId,
        uint256 indexed imo,
        bytes32 imageHash,
        string  imageSwarm,
        string  teePrediction
    );

    // ────────────────────────────────────────────────────────────────────────
    // Modifiers
    // ────────────────────────────────────────────────────────────────────────

    modifier onlyOO() {
        require(msg.sender == address(oo), "ReportRegistry: caller not OOv3");
        _;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Constructor
    // ────────────────────────────────────────────────────────────────────────

    constructor(
        IERC20 _bondCurrency,
        IOptimisticOracleV3 _oo,
        ISlashPool _slashPool,
        address _treasury,
        address _orbitalAttestor,
        uint96 _protocolBond,
        uint64 _liveness,
        string memory _swarmGatewayPrefix
    ) {
        require(address(_bondCurrency) != address(0), "bondCurrency=0");
        require(address(_oo)           != address(0), "oo=0");
        require(address(_slashPool)    != address(0), "slashPool=0");
        require(_treasury              != address(0), "treasury=0");
        require(_orbitalAttestor       != address(0), "attestor=0");
        require(_protocolBond          != 0,          "bond=0");
        require(_liveness              != 0,          "liveness=0");

        bondCurrency       = _bondCurrency;
        oo                 = _oo;
        slashPool          = _slashPool;
        treasury           = _treasury;
        orbitalAttestor    = _orbitalAttestor;
        protocolBond       = _protocolBond;
        liveness           = _liveness;
        swarmGatewayPrefix = _swarmGatewayPrefix;
        admin              = msg.sender;
    }

    // ────────────────────────────────────────────────────────────────────────
    // Lighthouse wiring
    // ────────────────────────────────────────────────────────────────────────

    error NotAdmin();
    error LighthouseAlreadySet();
    error LighthouseZero();

    event LighthouseSet(address indexed lighthouse);

    /// @notice One-shot setter. Called by the deployer after Lighthouse has
    ///         been deployed against this registry's address.
    function setLighthouse(ILighthouse _lighthouse) external {
        if (msg.sender != admin)                 revert NotAdmin();
        if (address(lighthouse) != address(0))   revert LighthouseAlreadySet();
        if (address(_lighthouse) == address(0))  revert LighthouseZero();
        lighthouse = _lighthouse;
        emit LighthouseSet(address(_lighthouse));
    }

    // ────────────────────────────────────────────────────────────────────────
    // Submit
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Open a bonded report. Pulls `protocolBond + UMA min bond` in
    ///         USDC from `msg.sender`, opens an OOv3 assertion, returns the
    ///         report id. Settlement is asynchronous via OOv3 callbacks.
    function submit(
        uint256 imo,
        bool aisDark,
        bytes32 photoHash,
        string calldata metadataSwarm,
        string calldata country,
        string calldata cargo,
        string calldata lastSeen
    ) external returns (bytes32 reportId) {
        require(imo                          != 0,         "imo=0");
        require(photoHash                    != bytes32(0), "photoHash=0");
        require(bytes(metadataSwarm).length  != 0,         "metaSwarm=empty");

        uint256 umaBond   = oo.getMinimumBond(address(bondCurrency));
        uint256 totalPull = uint256(protocolBond) + umaBond;

        require(
            bondCurrency.transferFrom(msg.sender, address(this), totalPull),
            "bond pull failed"
        );

        // Some ERC20s (notably USDC) require zero-then-set on allowance
        // changes; reset defensively to support either variant.
        require(bondCurrency.approve(address(oo), 0),       "approve reset");
        require(bondCurrency.approve(address(oo), umaBond), "approve uma");

        bytes32 assertionId = oo.assertTruth(
            _buildClaim(metadataSwarm),
            address(this),       // asserter (bond comes from us)
            address(this),       // callbackRecipient
            address(0),          // no escalation manager
            liveness,
            bondCurrency,
            umaBond,
            oo.defaultIdentifier(),
            bytes32(0)           // default domain
        );

        unchecked { reportCount += 1; }
        reportId = bytes32(reportCount);

        Report storage r = reports[reportId];
        r.reporter      = msg.sender;
        r.bond          = protocolBond;
        r.umaBond       = uint96(umaBond);
        r.submittedAt   = uint64(block.timestamp);
        r.imo           = imo;
        r.aisDark       = aisDark;
        r.photoHash     = photoHash;
        r.metadataSwarm = metadataSwarm;
        r.assertionId   = assertionId;
        r.country       = country;
        r.cargo         = cargo;
        r.lastSeen      = lastSeen;
        // r.status remains STATUS_PENDING (0).

        assertionToReport[assertionId] = reportId;

        emit Submitted(
            reportId,
            msg.sender,
            imo,
            aisDark,
            photoHash,
            metadataSwarm,
            assertionId,
            protocolBond,
            uint96(umaBond),
            country,
            cargo,
            lastSeen
        );
    }

    // ────────────────────────────────────────────────────────────────────────
    // UMA OOv3 callbacks
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Resolution callback. Fires for both undisputed and post-DVM
    ///         disputed assertions. Truthful → refund reporter (protocol bond
    ///         + UMA min-bond returned by UMA). False → split protocol bond
    ///         50/30/20 between disputer / slash pool / treasury.
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully)
        external
        onlyOO
    {
        bytes32 reportId = assertionToReport[assertionId];
        require(reportId != bytes32(0), "unknown assertion");

        Report storage r = reports[reportId];
        require(
            r.status == STATUS_PENDING || r.status == STATUS_DISPUTED,
            "already settled"
        );
        bool wasDisputed = (r.status == STATUS_DISPUTED);
        r.settledAt = uint64(block.timestamp);

        if (assertedTruthfully) {
            r.status = STATUS_SETTLED_TRUE;
            uint256 refund = uint256(r.bond) + uint256(r.umaBond);
            require(bondCurrency.transfer(r.reporter, refund), "refund failed");
            _onTruthfulSettlement(r, wasDisputed);
        } else {
            r.status = STATUS_SETTLED_FALSE;
            address disputer = oo.getAssertion(assertionId).disputer;
            require(disputer != address(0), "no disputer");

            uint256 bond          = uint256(r.bond);
            uint256 disputerShare = (bond * DISPUTER_BPS) / BPS_DENOM;
            uint256 poolShare     = (bond * POOL_BPS)     / BPS_DENOM;
            uint256 treasuryShare = bond - disputerShare - poolShare;

            require(bondCurrency.transfer(disputer, disputerShare), "disputer xfer");

            require(bondCurrency.approve(address(slashPool), 0),         "approve reset");
            require(bondCurrency.approve(address(slashPool), poolShare), "approve pool");
            slashPool.depositSlash(reportId, poolShare);

            require(bondCurrency.transfer(treasury, treasuryShare), "treasury xfer");
        }

        emit Settled(reportId, assertedTruthfully);
    }

    /// @notice Dispute callback. Records disputer for off-chain consumers and
    ///         flips status to Disputed. Final settlement still arrives via
    ///         `assertionResolvedCallback` after the DVM vote.
    function assertionDisputedCallback(bytes32 assertionId) external onlyOO {
        bytes32 reportId = assertionToReport[assertionId];
        require(reportId != bytes32(0), "unknown assertion");

        Report storage r = reports[reportId];
        require(r.status == STATUS_PENDING, "not pending");
        r.status = STATUS_DISPUTED;

        address disputer = oo.getAssertion(assertionId).disputer;
        emit Disputed(reportId, disputer);
    }

    // ────────────────────────────────────────────────────────────────────────
    // Orbital attestation
    // ────────────────────────────────────────────────────────────────────────

    /// @notice Bind a SpaceComputer KMS-signed orbital corroboration to a
    ///         settled-truthful report. Signature is EIP-191 over
    ///         `keccak256(abi.encode(reportId, imageHash, keccak256(teePrediction)))`,
    ///         signer must equal the immutable `orbitalAttestor`.
    function attest(
        bytes32 reportId,
        string calldata imageSwarm,
        bytes32 imageHash,
        string calldata teePrediction,
        bytes calldata signature
    ) external {
        Report storage r = reports[reportId];
        require(r.reporter           != address(0),         "unknown report");
        require(r.status             == STATUS_SETTLED_TRUE, "not settled-true");
        require(!r.orbitalAttested,                          "already attested");
        require(imageHash            != bytes32(0),          "imageHash=0");

        bytes32 digest = keccak256(
            abi.encode(reportId, imageHash, keccak256(bytes(teePrediction)))
        );
        address signer = _recover(_eip191(digest), signature);
        require(signer == orbitalAttestor, "bad attestor sig");

        r.orbitalAttested  = true;
        r.orbitalImageHash = imageHash;

        emit OrbitallyCorroborated(reportId, r.imo, imageHash, imageSwarm, teePrediction);

        if (address(lighthouse) != address(0)) {
            lighthouse.recordOrbital(r.imo, imageSwarm, imageHash, teePrediction);
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Lighthouse hook (truthful settlement path)
    // ────────────────────────────────────────────────────────────────────────

    /// @dev Called from `assertionResolvedCallback` only when the assertion
    ///      resolved truthfully. First sighting per IMO mints the vessel
    ///      subname; subsequent ones refresh its records (incl. the trio of
    ///      vessel descriptors). No-op if Lighthouse is not yet wired.
    function _onTruthfulSettlement(Report storage r, bool wasDisputed) internal {
        if (address(lighthouse) == address(0)) return;

        uint256 imo = r.imo;
        sightingsByImo[imo] += 1;
        if (wasDisputed) disputedByImo[imo] += 1;

        if (!vesselNamed[imo]) {
            vesselNamed[imo] = true;
            lighthouse.nameVessel(imo, r.metadataSwarm, r.country, r.cargo, r.lastSeen);
        } else {
            lighthouse.recordSighting(
                imo,
                r.metadataSwarm,
                sightingsByImo[imo],
                disputedByImo[imo],
                r.country,
                r.cargo,
                r.lastSeen
            );
        }
    }

    // ────────────────────────────────────────────────────────────────────────
    // Views
    // ────────────────────────────────────────────────────────────────────────

    function getReport(bytes32 reportId) external view returns (Report memory) {
        return reports[reportId];
    }

    // ────────────────────────────────────────────────────────────────────────
    // Internals
    // ────────────────────────────────────────────────────────────────────────

    function _buildClaim(string memory metadataSwarm) internal view returns (bytes memory) {
        // Voter-readable claim. Includes an HTTPS Swarm gateway URL so UMA
        // voters who do not run a Bee node can resolve the metadata JSON.
        return bytes(
            string.concat(
                "Phare report at ",
                metadataSwarm,
                " is a truthful sighting. Public gateway: ",
                swarmGatewayPrefix,
                metadataSwarm
            )
        );
    }

    function _eip191(bytes32 hash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
    }

    function _recover(bytes32 hash, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "bad sig len");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        address signer = ecrecover(hash, v, r, s);
        require(signer != address(0), "ecrecover=0");
        return signer;
    }
}
