// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISlashPool} from "./interfaces/ISlashPool.sol";
import {IERC20}     from "./interfaces/IERC20.sol";

/// @title  SlashPool
/// @notice Holds slashed-bond shares forwarded from `ReportRegistry`. Pulls
///         the deposit via `transferFrom` so the registry only needs to
///         approve, not transfer-then-call. Reward payouts on honest
///         settlements are out of hackathon scope (Design §8.2 — still
///         open); v0 is deposit-and-record only.
contract SlashPool is ISlashPool {
    IERC20 public immutable bondCurrency;

    uint256 public totalDeposited;
    mapping(bytes32 => uint256) public depositOf;

    event Deposited(bytes32 indexed reportId, uint256 amount);

    constructor(IERC20 _bondCurrency) {
        require(address(_bondCurrency) != address(0), "bondCurrency=0");
        bondCurrency = _bondCurrency;
    }

    function depositSlash(bytes32 reportId, uint256 amount) external {
        require(amount != 0, "amount=0");
        require(
            bondCurrency.transferFrom(msg.sender, address(this), amount),
            "pull failed"
        );
        depositOf[reportId] += amount;
        totalDeposited      += amount;
        emit Deposited(reportId, amount);
    }
}
