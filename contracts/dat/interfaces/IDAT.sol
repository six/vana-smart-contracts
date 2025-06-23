// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDAT {
    function initialize(
        string memory name,
        string memory symbol,
        address owner,
        address treasury,
        uint256 cap,
        address[] memory receivers,
        uint256[] memory amounts
    ) external;

    /* ─── factory-only setters ─── */
    function setAmmPair(address pair) external;
    function setTreasury(address t) external;
    function setFeeExempt(address a, bool e) external;
}
