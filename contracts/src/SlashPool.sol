// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title SlashPool — pooled USDC from slashed bonds and donor seeds
/// @notice Per DESIGN_DOCUMENT §4.5 / §8.3. Holds slashed reporter bonds.
///         Only ReportRegistry can deposit slash shares; only ReportRegistry
///         can request reward payouts. Cannot be drained otherwise.
contract SlashPool {
    IERC20 public immutable usdc;
    address public immutable registry;

    event Slashed(bytes32 indexed reportId, uint256 amount);
    event Rewarded(bytes32 indexed reportId, address indexed reporter, uint256 amount);
    event Seeded(address indexed donor, uint256 amount);

    error NotRegistry();
    error TransferFailed();

    modifier onlyRegistry() {
        if (msg.sender != registry) revert NotRegistry();
        _;
    }

    constructor(address _usdc, address _registry) {
        usdc = IERC20(_usdc);
        registry = _registry;
    }

    /// @notice Pulls `amount` USDC from ReportRegistry into the pool.
    /// @dev    Caller must `approve(slashPool, amount)` on USDC first.
    function deposit(bytes32 reportId, uint256 amount) external onlyRegistry {
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Slashed(reportId, amount);
    }

    /// @notice Pays a reward to an honest reporter on uncontested settlement.
    /// @dev    Idempotency / per-report guard lives in ReportRegistry.
    function payReward(bytes32 reportId, address reporter, uint256 amount) external onlyRegistry {
        if (!usdc.transfer(reporter, amount)) revert TransferFailed();
        emit Rewarded(reportId, reporter, amount);
    }

    /// @notice Open donor seeding. Anyone can top up the pool.
    function seed(uint256 amount) external {
        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        emit Seeded(msg.sender, amount);
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }
}
