// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IFiadoScoring} from "../../src/interfaces/IFiadoScoring.sol";

/// @notice Test double standing in for the real Stylus FiadoScoring contract, so PaymentRouter
/// can be unit-tested without a WASM runtime. Just records calls.
contract MockFiadoScoring is IFiadoScoring {
    struct Payment {
        address bodega;
        uint256 amount;
        uint256 timestamp;
    }

    Payment[] public payments;

    function recordPayment(address bodega, uint256 amount, uint256 timestamp) external override {
        payments.push(Payment(bodega, amount, timestamp));
    }

    function getCreditLimit(address) external pure override returns (uint256) {
        return 0;
    }

    function getScore(address) external pure override returns (uint256) {
        return 0;
    }

    function getAiAdjustmentInfo(address) external pure override returns (bool, uint256) {
        return (false, 0);
    }

    function getPaymentHistory(address) external pure override returns (uint256[] memory, uint256[] memory) {
        return (new uint256[](0), new uint256[](0));
    }

    function updateScoreFromAi(address, uint256, uint256) external override {}

    mapping(address => bool) public fiadoEnabled;

    function isFiadoEnabled(address bodega) external view override returns (bool) {
        return fiadoEnabled[bodega];
    }

    function setFiadoEnabled(bool enabled) external override {
        fiadoEnabled[msg.sender] = enabled;
    }

    function paymentsLength() external view returns (uint256) {
        return payments.length;
    }
}
