// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "../DTTypes.sol";

contract TypesTestWrapper {
    function hashReceipt(DTTypes.Receipt memory receipt) external pure returns (bytes32) {
        return DTTypes.hashReceipt(receipt);
    }
}
