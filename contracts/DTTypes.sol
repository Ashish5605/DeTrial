// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

library DTTypes {
    struct Receipt {
        bytes32 caseId;
        bytes32 institutionId;
        bytes32 serviceId;
        bytes32[] docCommitments;
        bytes32 policyHash;
        uint64 timestamp;
        uint64 logIndex;
        bytes32 holderCommitment;
    }

    bytes32 constant RECEIPT_TYPEHASH = keccak256(
        "Receipt(bytes32 caseId,bytes32 institutionId,bytes32 serviceId,bytes32[] docCommitments,bytes32 policyHash,uint64 timestamp,uint64 logIndex,bytes32 holderCommitment)"
    );

    function hashReceipt(Receipt memory receipt) internal pure returns (bytes32) {
        bytes32 docCommitmentsHash = keccak256(abi.encodePacked(receipt.docCommitments));
        
        return keccak256(abi.encode(
            RECEIPT_TYPEHASH,
            receipt.caseId,
            receipt.institutionId,
            receipt.serviceId,
            docCommitmentsHash,
            receipt.policyHash,
            receipt.timestamp,
            receipt.logIndex,
            receipt.holderCommitment
        ));
    }
}
