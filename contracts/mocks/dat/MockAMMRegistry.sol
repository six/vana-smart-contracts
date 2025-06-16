// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockAMMRegistry {
    function isPair(address) external pure returns (bool) {
        return false;
    }
} 