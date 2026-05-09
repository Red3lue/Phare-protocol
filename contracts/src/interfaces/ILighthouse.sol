// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Subset of `Lighthouse.sol` that `ReportRegistry` calls into.
///         Vessel writes only — verifier enrollment is permissionless and
///         lives outside the registry's path.
interface ILighthouse {
    function nameVessel(
        uint256 imo,
        string calldata swarmRef,
        string calldata country,
        string calldata cargo,
        string calldata lastSeen
    ) external returns (bytes32 node);

    function recordSighting(
        uint256 imo,
        string calldata swarmRef,
        uint32 sightings,
        uint32 disputed,
        string calldata country,
        string calldata cargo,
        string calldata lastSeen
    ) external;

    function recordOrbital(
        uint256 imo,
        string calldata image,
        bytes32 imageHash,
        string calldata teePrediction
    ) external;
}
