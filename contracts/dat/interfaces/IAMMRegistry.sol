// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAMMRegistry
 * @dev Minimal interface so DATTaxable can query the registry via `staticcall`.
 */
interface IAMMRegistry {
    /**
     * @notice Returns true if `addr` is recognised as an AMM pair / router.
     */
    function isPair(address pair) external view returns (bool);
}
