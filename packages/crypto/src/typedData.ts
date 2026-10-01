export const DT_DOMAIN = {
    name: "DecisionTrail",
    version: "1",
};

export const DT_TYPES = {
    Receipt: [
        { name: "caseId", type: "bytes32" },
        { name: "institutionId", type: "bytes32" },
        { name: "serviceId", type: "bytes32" },
        { name: "docCommitments", type: "bytes32[]" },
        { name: "policyHash", type: "bytes32" },
        { name: "timestamp", type: "uint64" },
        { name: "logIndex", type: "uint64" },
        { name: "holderCommitment", type: "bytes32" }
    ]
};
