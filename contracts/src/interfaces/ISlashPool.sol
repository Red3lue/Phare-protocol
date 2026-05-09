// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Receives slashed-bond shares from ReportRegistry. Reward payouts on
///         honest settlements are out of hackathon scope; the deposit hook
///         is the only call ReportRegistry needs in v0.
interface ISlashPool {
    function depositSlash(bytes32 reportId, uint256 amount) external;
}
