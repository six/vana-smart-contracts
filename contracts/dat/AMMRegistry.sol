// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title AMMRegistry
 * @notice A shared allow-list of Automated-Market-Maker addresses.
 *         Any DATTaxable token consults this list to decide
 *         whether a transfer is a “buy/sell” and must pay the 1 % fee.
 *
 * Roles
 * ──────────────────────────────────────────────────────
 * DEFAULT_ADMIN_ROLE  – can grant/revoke REGISTRAR_ROLE and
 *                       update timelock parameters (if any).
 * REGISTRAR_ROLE      – can add/remove recognised AMM pairs.
 */
contract AMMRegistry is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");

    /// @dev pair → bool mapping
    mapping(address => bool) private _isPair;

    event PairStatusUpdated(address indexed pair, bool enabled);

    constructor(address admin) {
        require(admin != address(0), "AMMRegistry: zero admin");
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(REGISTRAR_ROLE,     admin);
    }

    // ─────────────────────── admin ops ────────────────────────────

    /**
     * @notice Add or drop an address from the recognised-pair list.
     * @param pair    Uniswap-V2 pair, Uniswap-V3 pool, router, etc.
     * @param enabled true → add,  false → remove.
     */
    function setPair(address pair, bool enabled)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        require(pair != address(0), "AMMRegistry: zero pair");
        _isPair[pair] = enabled;
        emit PairStatusUpdated(pair, enabled);
    }

    // ────────────────────── view helpers ──────────────────────────

    function isPair(address addr) external view returns (bool) {
        return _isPair[addr];
    }
}
