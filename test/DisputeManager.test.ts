import { expect } from "chai";
import { ethers } from "hardhat";

import { DT_DOMAIN, DT_TYPES } from "../packages/crypto/src/typedData";

describe("DisputeManager State Machine & Clock", function () {
    let keyRegistry: any;
    let anchor: any;
    let disputeManager: any;
    let owner: any;
    let institutionSigner: any;
    let holder: any;
    let witness: any;

    const institutionId = ethers.id("inst_nit_delhi");
    const serviceId = ethers.id("srv_scholarship");
    const caseId = ethers.id("case_test_001");

    beforeEach(async function () {
        [owner, institutionSigner, holder, witness] = await ethers.getSigners();

        // 1. Deploy KeyRegistry
        const KeyRegistry = await ethers.getContractFactory("KeyRegistry");
        keyRegistry = await KeyRegistry.deploy(owner.address);

        // Register institution signer
        const now = Math.floor(Date.now() / 1000);
        await keyRegistry.registerSigner(institutionId, institutionSigner.address, BigInt(now - 1000), BigInt(now + 100000));
        
        // Configure service
        await keyRegistry.setServiceConfig(
            institutionId,
            serviceId,
            86400n, // 1 day response window
            true,
            ethers.id("statute_ref"),
            owner.address
        );

        // 2. Deploy CheckpointAnchor
        const CheckpointAnchor = await ethers.getContractFactory("CheckpointAnchor");
        anchor = await CheckpointAnchor.deploy(owner.address, [witness.address], 1n);

        // 3. Deploy DisputeManager
        const DisputeManager = await ethers.getContractFactory("DisputeManager");
        disputeManager = await DisputeManager.deploy(await keyRegistry.getAddress(), await anchor.getAddress());
    });

    it("Should register an issuer-signed receipt for its bound applicant", async function () {
        const now = Math.floor(Date.now() / 1000);
        const salt = ethers.id("holder_salt_abc");
        const holderCommitment = ethers.keccak256(ethers.solidityPacked(["address", "bytes32"], [holder.address, salt]));

        const receipt = {
            caseId: caseId,
            institutionId: institutionId,
            serviceId: serviceId,
            docCommitments: [ethers.id("doc_1")],
            policyHash: ethers.id("policy_v1"),
            timestamp: BigInt(now),
            logIndex: 1n,
            holderCommitment: holderCommitment
        };

        // Receipt signatures use the complete chain- and contract-bound EIP-712 domain.
        const domain = { ...DT_DOMAIN, chainId: 31337, verifyingContract: await disputeManager.getAddress() };
        const institutionSig = await institutionSigner.signTypedData(domain, DT_TYPES, receipt);

        // Register receipt — signer will be recovered correctly and validated against KeyRegistry
        await disputeManager.connect(institutionSigner).openCase(caseId, institutionId, serviceId, holderCommitment);
        await disputeManager.connect(holder).registerReceipt(receipt, institutionSig, salt);

        const caseRec = await disputeManager.cases(caseId);
        expect(caseRec.state).to.equal(1n); // OPEN = 1
    });
});

