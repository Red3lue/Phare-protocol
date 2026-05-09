// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

/// @notice Minimal subset of UMA's OptimisticOracleV3 used by ReportRegistry.
///         Reference deployment on Sepolia: 0x9923D42eF695B5dd9911D05Ac944d4cAca3c4EAB.
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
        bytes calldata claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) external returns (bytes32 assertionId);

    function disputeAssertion(bytes32 assertionId, address disputer) external;

    function settleAssertion(bytes32 assertionId) external;

    function getMinimumBond(address currency) external view returns (uint256);

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory);

    function defaultIdentifier() external view returns (bytes32);
}
