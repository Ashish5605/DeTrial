// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./DTTypes.sol";
import "./KeyRegistry.sol";
import "./CheckpointAnchor.sol";
import "./RFC6962Verifier.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Existing DecisionTrail registry, hardened for the receipt accountability demo.
contract DisputeManager is EIP712 {
    enum CaseState { NONE, OPEN, SEALED, REOPENED, RESPONDED, ESCALATED, DEEMED_APPROVED }
    struct CaseRecord {
        CaseState state;
        bytes32 institutionId;
        bytes32 serviceId;
        bytes32 holderCommitment;
        uint64 round;
        uint64 deadline;
        uint64 outstandingObligations;
    }
    KeyRegistry public immutable keyRegistry;
    CheckpointAnchor public immutable checkpointAnchor;
    mapping(bytes32 => CaseRecord) public cases;
    mapping(bytes32 => bool) public registeredReceipts;
    mapping(bytes32 => bytes32) public receiptCase;
    mapping(bytes32 => bytes32) public dispositions;
    mapping(bytes32 => bytes32) public latestDisposition;
    mapping(bytes32 => uint64) public dispositionTreeSize;
    mapping(bytes32 => uint64) public sealedTreeSize;

    event AuditOpened(bytes32 indexed caseId, address indexed actor);
    event ReceiptRegistered(bytes32 indexed caseId, bytes32 indexed receiptHash, address indexed actor);
    event RoundSealed(bytes32 indexed caseId, uint64 round, bytes32 rootHash, address actor);
    event CaseReopened(bytes32 indexed caseId, uint64 round, uint64 deadline);
    event DispositionRecorded(bytes32 indexed caseId, bytes32 indexed receiptHash, bytes32 responseHash, uint8 disposition, address actor);

    error InvalidState();
    error Unauthorized();
    error SignatureMismatch();
    error KeyNotValid();
    error InvalidInclusionProof();
    error AlreadyRegistered();
    error ReceiptMismatch();
    error OutstandingObligations(uint64 count);
    error CheckpointRequired();
    error InvalidReceipt();

    constructor(address registry, address anchor) EIP712("DecisionTrail", "1") {
        keyRegistry = KeyRegistry(registry);
        checkpointAnchor = CheckpointAnchor(anchor);
    }
    function _officer(bytes32 institutionId) internal view {
        if (!keyRegistry.isKeyValidAt(institutionId, msg.sender, uint64(block.timestamp))) revert Unauthorized();
    }
    function openCase(bytes32 caseId, bytes32 institutionId, bytes32 serviceId, bytes32 holderCommitment) external {
        _officer(institutionId);
        if (cases[caseId].state != CaseState.NONE) revert InvalidState();
        if (caseId == bytes32(0) || holderCommitment == bytes32(0)) revert InvalidReceipt();
        cases[caseId] = CaseRecord(CaseState.OPEN, institutionId, serviceId, holderCommitment, 0, 0, 0);
        emit AuditOpened(caseId, msg.sender);
    }
    function receiptDigest(DTTypes.Receipt memory receipt) public view returns (bytes32) {
        return _hashTypedDataV4(DTTypes.hashReceipt(receipt));
    }
    function registerReceipt(DTTypes.Receipt memory receipt, bytes memory institutionSig, bytes32 holderSalt) external {
        CaseRecord storage c = cases[receipt.caseId];
        if (c.state == CaseState.NONE) revert InvalidState();
        if (receipt.institutionId != c.institutionId || receipt.serviceId != c.serviceId || receipt.holderCommitment != c.holderCommitment) revert ReceiptMismatch();
        if (receipt.docCommitments.length == 0 || receipt.timestamp > block.timestamp) revert InvalidReceipt();
        if (keccak256(abi.encodePacked(msg.sender, holderSalt)) != receipt.holderCommitment) revert SignatureMismatch();
        bytes32 digest = receiptDigest(receipt);
        address signer = ECDSA.recover(digest, institutionSig);
        if (!keyRegistry.isKeyValidAt(receipt.institutionId, signer, receipt.timestamp)) revert KeyNotValid();
        if (registeredReceipts[digest]) revert AlreadyRegistered();
        registeredReceipts[digest] = true;
        receiptCase[digest] = receipt.caseId;
        c.outstandingObligations++;
        emit ReceiptRegistered(receipt.caseId, digest, msg.sender);
        if (c.state == CaseState.SEALED) {
            c.state = CaseState.REOPENED;
            c.round++;
            (uint64 window,,,) = keyRegistry.serviceConfigs(c.institutionId, c.serviceId);
            c.deadline = uint64(block.timestamp) + (window == 0 ? 604800 : window);
            emit CaseReopened(receipt.caseId, c.round, c.deadline);
        } else if (c.state == CaseState.RESPONDED) {
            c.state = CaseState.REOPENED;
        }
    }
    function recordDisposition(bytes32 caseId, bytes32 receiptHash, bytes32 responseHash, uint8 disposition) external {
        CaseRecord storage c = cases[caseId];
        _officer(c.institutionId);
        if (!registeredReceipts[receiptHash] || receiptCase[receiptHash] != caseId || dispositions[receiptHash] != bytes32(0)) revert InvalidState();
        if (responseHash == bytes32(0) || disposition > 2) revert InvalidReceipt();
        dispositions[receiptHash] = responseHash;
        latestDisposition[caseId] = responseHash;
        dispositionTreeSize[caseId] = checkpointAnchor.latestTreeSize(c.institutionId);
        c.outstandingObligations--;
        if (c.outstandingObligations == 0) c.state = CaseState.RESPONDED;
        emit DispositionRecorded(caseId, receiptHash, responseHash, disposition, msg.sender);
    }
    /// @dev Leaf binds the case, audit round and latest disposition to the anchored log.
    function sealRound(bytes32 caseId, bytes32 rootHash, uint64 treeSize, uint64 leafIndex, bytes32[] memory inclusionProof) external {
        CaseRecord storage c = cases[caseId];
        _officer(c.institutionId);
        if (c.outstandingObligations > 0) revert OutstandingObligations(c.outstandingObligations);
        if (c.state != CaseState.OPEN && c.state != CaseState.RESPONDED) revert InvalidState();
        if (treeSize <= sealedTreeSize[caseId] || (c.state == CaseState.RESPONDED && treeSize <= dispositionTreeSize[caseId])) revert CheckpointRequired();
        if (!checkpointAnchor.isRootAnchored(c.institutionId, treeSize, rootHash)) revert CheckpointRequired();
        bytes32 leaf = RFC6962Verifier.hashLeaf(abi.encodePacked(caseId, c.round, latestDisposition[caseId]));
        if (!RFC6962Verifier.verifyInclusion(leaf, leafIndex, treeSize, inclusionProof, rootHash)) revert InvalidInclusionProof();
        c.state = CaseState.SEALED;
        sealedTreeSize[caseId] = treeSize;
        emit RoundSealed(caseId, c.round, rootHash, msg.sender);
    }
}
