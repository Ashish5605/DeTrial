import { expect } from "chai";
import { ethers } from "hardhat";
import { MerkleLog, hashLeaf } from "../packages/crypto/src/merkleLog";

describe("Cross-Language RFC 6962 Verifier", function () {
    let verifier: any;
    const numLeaves = 17; // Crosses 1, 2, 4, 8, 16 boundaries
    let log: MerkleLog;
    let leaves: string[] = [];

    before(async function () {
        const VerifierTestWrapper = await ethers.getContractFactory("VerifierTestWrapper");
        verifier = await VerifierTestWrapper.deploy();

        log = new MerkleLog();
        for (let i = 0; i < numLeaves; i++) {
            const leafStr = `tx_data_${i}`;
            leaves.push(leafStr);
            log.append(leafStr);
        }
    });

    it("Solidity should verify TS-generated inclusion proofs", async function () {
        for (let treeSize = 1; treeSize <= numLeaves; treeSize++) {
            const root = log.getRoot(treeSize);
            for (let index = 0; index < treeSize; index++) {
                const proof = log.getInclusionProof(index, treeSize);
                const leafHash = hashLeaf(leaves[index]);
                
                const isValid = await verifier.verifyInclusion(leafHash, index, treeSize, proof, root);
                expect(isValid).to.be.true;
            }
        }
    });

    it("Solidity should verify TS-generated consistency proofs", async function () {
        for (let newSize = 2; newSize <= numLeaves; newSize++) {
            const newRoot = log.getRoot(newSize);
            for (let oldSize = 1; oldSize < newSize; oldSize++) {
                const oldRoot = log.getRoot(oldSize);
                const proof = log.getConsistencyProof(oldSize, newSize);
                
                const isValid = await verifier.verifyConsistency(oldSize, newSize, oldRoot, newRoot, proof);
                expect(isValid).to.be.true;
            }
        }
    });

    it("Solidity should reject tampered inclusion proofs", async function () {
        const treeSize = 8;
        const index = 3;
        const root = log.getRoot(treeSize);
        const proof = log.getInclusionProof(index, treeSize);
        const leafHash = hashLeaf(leaves[index]);

        // Tamper with one hash in the array
        const tamperedProof = [...proof];
        tamperedProof[0] = ethers.id("fake_hash");

        const isValid = await verifier.verifyInclusion(leafHash, index, treeSize, tamperedProof, root);
        expect(isValid).to.be.false;
        
        // Feed an array that is too long
        const paddedProof = [...proof, ethers.id("extra_hash")];
        const isPadValid = await verifier.verifyInclusion(leafHash, index, treeSize, paddedProof, root);
        expect(isPadValid).to.be.false;
    });
});
