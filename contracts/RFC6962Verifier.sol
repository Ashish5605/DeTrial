// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library RFC6962Verifier {
    function hashLeaf(bytes memory leafBytes) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uint8(0x00), leafBytes));
    }

    function hashNode(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uint8(0x01), left, right));
    }

    function largestPowerOfTwoLessThan(uint256 n) internal pure returns (uint256) {
        uint256 k = 1;
        while (k * 2 < n) {
            k *= 2;
        }
        return k;
    }

    function verifyInclusion(
        bytes32 leafHash,
        uint256 index,
        uint256 treeSize,
        bytes32[] memory proof,
        bytes32 expectedRoot
    ) internal pure returns (bool) {
        if (index >= treeSize) return false;
        (bool ok, bytes32 computed, uint256 nextPIdx) = _evalInclusion(index, treeSize, leafHash, proof, proof.length);
        return ok && computed == expectedRoot && nextPIdx == 0;
    }

    function _evalInclusion(
        uint256 index,
        uint256 size,
        bytes32 leafHash,
        bytes32[] memory proof,
        uint256 pIdx
    ) internal pure returns (bool success, bytes32 computedHash, uint256 nextPIdx) {
        if (size == 1) return (true, leafHash, pIdx);
        
        uint256 k = largestPowerOfTwoLessThan(size);
        if (index < k) {
            if (pIdx == 0) return (false, bytes32(0), 0);
            bytes32 right = proof[pIdx - 1];
            (bool ok, bytes32 left, uint256 nPIdx) = _evalInclusion(index, k, leafHash, proof, pIdx - 1);
            if (!ok) return (false, bytes32(0), 0);
            return (true, hashNode(left, right), nPIdx);
        } else {
            if (pIdx == 0) return (false, bytes32(0), 0);
            bytes32 left = proof[pIdx - 1];
            (bool ok, bytes32 right, uint256 nPIdx) = _evalInclusion(index - k, size - k, leafHash, proof, pIdx - 1);
            if (!ok) return (false, bytes32(0), 0);
            return (true, hashNode(left, right), nPIdx);
        }
    }

    function verifyConsistency(
        uint256 oldSize,
        uint256 newSize,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32[] memory proof
    ) internal pure returns (bool) {
        if (oldSize == newSize) return oldRoot == newRoot && proof.length == 0;
        if (oldSize == 0 || oldSize > newSize) return false;

        (bool ok, bytes32 cOld, bytes32 cNew, uint256 nextPIdx) = _evalConsistency(oldSize, newSize, true, proof, oldRoot, proof.length);
        return ok && cOld == oldRoot && cNew == newRoot && nextPIdx == 0;
    }

    function _evalConsistency(
        uint256 m,
        uint256 n,
        bool b,
        bytes32[] memory proof,
        bytes32 oldRoot,
        uint256 pIdx
    ) internal pure returns (bool success, bytes32 computedOld, bytes32 computedNew, uint256 nextPIdx) {
        if (m == n) {
            if (b) return (true, oldRoot, oldRoot, pIdx);
            if (pIdx == 0) return (false, bytes32(0), bytes32(0), 0);
            bytes32 node = proof[pIdx - 1];
            return (true, node, node, pIdx - 1);
        }
        
        uint256 k = largestPowerOfTwoLessThan(n);
        if (m <= k) {
            if (pIdx == 0) return (false, bytes32(0), bytes32(0), 0);
            bytes32 right = proof[pIdx - 1];
            (bool ok, bytes32 leftOld, bytes32 leftNew, uint256 nPIdx) = _evalConsistency(m, k, b, proof, oldRoot, pIdx - 1);
            if (!ok) return (false, bytes32(0), bytes32(0), 0);
            return (true, leftOld, hashNode(leftNew, right), nPIdx);
        } else {
            if (pIdx == 0) return (false, bytes32(0), bytes32(0), 0);
            bytes32 left = proof[pIdx - 1];
            (bool ok, bytes32 rightOld, bytes32 rightNew, uint256 nPIdx) = _evalConsistency(m - k, n - k, false, proof, oldRoot, pIdx - 1);
            if (!ok) return (false, bytes32(0), bytes32(0), 0);
            return (true, hashNode(left, rightOld), hashNode(left, rightNew), nPIdx);
        }
    }
}
