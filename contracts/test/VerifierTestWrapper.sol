// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import "../RFC6962Verifier.sol";

contract VerifierTestWrapper {
    function verifyInclusion(bytes32 leafHash, uint256 index, uint256 treeSize, bytes32[] memory proof, bytes32 expectedRoot) external pure returns (bool) {
        return RFC6962Verifier.verifyInclusion(leafHash, index, treeSize, proof, expectedRoot);
    }
    
    function verifyConsistency(uint256 oldSize, uint256 newSize, bytes32 oldRoot, bytes32 newRoot, bytes32[] memory proof) external pure returns (bool) {
        return RFC6962Verifier.verifyConsistency(oldSize, newSize, oldRoot, newRoot, proof);
    }
}
