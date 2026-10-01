import { expect } from "chai";
import { ethers } from "hardhat";
import { TypedDataEncoder } from "ethers";
import { DT_TYPES } from "../packages/crypto/src/typedData";

describe("EIP-712 Cross-Language Types", function () {
    it("Should produce identical struct hashes in TS and Solidity", async function () {
        const TypesTestWrapper = await ethers.getContractFactory("TypesTestWrapper");
        const wrapper = await TypesTestWrapper.deploy();

        const dummyReceipt = {
            caseId: ethers.id("case_12345"),
            institutionId: ethers.id("inst_001"),
            serviceId: ethers.id("srv_scholarship"),
            docCommitments: [ethers.id("doc_1"), ethers.id("doc_2")],
            policyHash: ethers.id("policy_v1"),
            timestamp: 1726225000n,
            logIndex: 42n,
            holderCommitment: ethers.id("holder_001")
        };

        const solHash = await wrapper.hashReceipt(dummyReceipt);
        const tsHash = TypedDataEncoder.hashStruct("Receipt", DT_TYPES, dummyReceipt);

        expect(solHash).to.equal(tsHash);
    });
});
