// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract CheckpointAnchor is Ownable2Step {
    using ECDSA for bytes32;

    struct Checkpoint {
        bytes32 institutionId;
        uint64 treeSize;
        bytes32 rootHash;
        uint64 timestamp;
    }

    // institutionId => treeSize => anchored rootHash
    mapping(bytes32 => mapping(uint64 => bytes32)) public anchoredRoots;
    
    // institutionId => latest anchored treeSize
    mapping(bytes32 => uint64) public latestTreeSize;

    // Witness management
    mapping(address => bool) public isWitness;
    uint256 public witnessThreshold;
    uint256 public witnessCount;

    event WitnessAdded(address indexed witness);
    event WitnessRemoved(address indexed witness);
    event ThresholdUpdated(uint256 newThreshold);
    event CheckpointAnchored(bytes32 indexed institutionId, uint64 treeSize, bytes32 rootHash);

    error InvalidWitness();
    error WitnessAlreadyExists();
    error InsufficientWitnesses();
    error InvalidThreshold();
    error InvalidTreeSize();
    error DuplicateAnchor();
    error InvalidSignature();

    constructor(address initialOwner, address[] memory initialWitnesses, uint256 threshold) Ownable(initialOwner) {
        if (threshold == 0 || threshold > initialWitnesses.length) revert InvalidThreshold();
        witnessThreshold = threshold;
        
        for (uint256 i = 0; i < initialWitnesses.length; i++) {
            address w = initialWitnesses[i];
            if (w == address(0) || isWitness[w]) revert InvalidWitness();
            isWitness[w] = true;
            emit WitnessAdded(w);
        }
        witnessCount = initialWitnesses.length;
    }

    function setWitnessThreshold(uint256 newThreshold) external onlyOwner {
        if (newThreshold == 0 || newThreshold > witnessCount) revert InvalidThreshold();
        witnessThreshold = newThreshold;
        emit ThresholdUpdated(newThreshold);
    }

    function addWitness(address witness) external onlyOwner {
        if (witness == address(0) || isWitness[witness]) revert InvalidWitness();
        isWitness[witness] = true;
        witnessCount++;
        emit WitnessAdded(witness);
    }

    function removeWitness(address witness) external onlyOwner {
        if (!isWitness[witness]) revert InvalidWitness();
        if (witnessCount - 1 < witnessThreshold) revert InvalidThreshold();
        isWitness[witness] = false;
        witnessCount--;
        emit WitnessRemoved(witness);
    }

    function hashCheckpoint(Checkpoint memory cp) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(
            cp.institutionId,
            cp.treeSize,
            cp.rootHash,
            cp.timestamp
        ));
    }

    function anchorCheckpoint(
        Checkpoint memory cp,
        bytes calldata institutionSig,
        bytes[] calldata witnessSigs
    ) external {
        if (cp.treeSize <= latestTreeSize[cp.institutionId]) revert InvalidTreeSize();
        if (witnessSigs.length < witnessThreshold) revert InsufficientWitnesses();

        bytes32 cpHash = hashCheckpoint(cp);
        bytes32 ethSignedMessageHash = MessageHashUtils.toEthSignedMessageHash(cpHash);

        // Local prototype: owner is the institution; witness is a separate test account.
        if (ethSignedMessageHash.recover(institutionSig) != owner()) revert InvalidSignature();
        address lastSigner = address(0);
        uint256 validSigs = 0;

        for (uint256 i = 0; i < witnessSigs.length; i++) {
            address signer = ethSignedMessageHash.recover(witnessSigs[i]);
            if (!isWitness[signer]) revert InvalidSignature();
            // Prevent duplicate witness signatures in the array
            require(signer > lastSigner, "Duplicate witness"); 
            lastSigner = signer;
            validSigs++;
        }

        if (validSigs < witnessThreshold) revert InsufficientWitnesses();

        anchoredRoots[cp.institutionId][cp.treeSize] = cp.rootHash;
        latestTreeSize[cp.institutionId] = cp.treeSize;

        emit CheckpointAnchored(cp.institutionId, cp.treeSize, cp.rootHash);
    }

    function isRootAnchored(bytes32 institutionId, uint64 treeSize, bytes32 rootHash) external view returns (bool) {
        return anchoredRoots[institutionId][treeSize] == rootHash;
    }
}
