// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test}   from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";

/// @notice Verifies the on-chain namehash computation in Deploy.s.sol
///         against `cast namehash` reference values.
contract NamehashTest is Test, Deploy {
    function test_Namehash_VesselPhareEth() public pure {
        bytes32 expected = 0x10291dd0a534f52daec01ee88a5294198f34972aa44b9fec5a9ea4cb54dcc777;
        assertEq(_namehashOf("vessel.phare.eth"), expected);
    }

    function test_Namehash_VerifierPhareEth() public pure {
        bytes32 expected = 0x1d0a693788914f44825e605b794abcba12ecf39372b1c4835b16d6a99fd58447;
        assertEq(_namehashOf("verifier.phare.eth"), expected);
    }

    function test_Namehash_Empty() public pure {
        assertEq(_namehashOf(""), bytes32(0));
    }
}
