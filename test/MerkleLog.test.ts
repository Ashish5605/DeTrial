import { expect } from "chai";
import { MerkleLog, hashLeaf, verifyInclusion, verifyConsistency } from "../packages/crypto/src/merkleLog";

describe("RFC 6962 Merkle Log", function () {
    const numLeaves = 33; // Tests power of 2 boundaries
    let log: MerkleLog;
    let leaves: string[] = [];

    beforeEach(() => {
        log = new MerkleLog();
        leaves = [];
        for (let i = 0; i < numLeaves; i++) {
            const leafStr = `event_${i}`;
            leaves.push(leafStr);
            log.append(leafStr);
        }
    });

    it("should compute correct inclusion proofs for all tree sizes up to 33", () => {
        for (let treeSize = 1; treeSize <= numLeaves; treeSize++) {
            const root = log.getRoot(treeSize);
            for (let index = 0; index < treeSize; index++) {
                const proof = log.getInclusionProof(index, treeSize);
                const leafHash = hashLeaf(leaves[index]);
                
                const isValid = verifyInclusion(leafHash, index, treeSize, proof, root);
                expect(isValid).to.be.true;

                // Tamper test: Fake leaf
                const isInvalidLeaf = verifyInclusion(hashLeaf("fake"), index, treeSize, proof, root);
                expect(isInvalidLeaf).to.be.false;
            }
        }
    });

    it("should compute correct consistency proofs for all valid size pairs up to 33", () => {
        for (let newSize = 2; newSize <= numLeaves; newSize++) {
            const newRoot = log.getRoot(newSize);
            for (let oldSize = 1; oldSize < newSize; oldSize++) {
                const oldRoot = log.getRoot(oldSize);
                const proof = log.getConsistencyProof(oldSize, newSize);
                
                const isValid = verifyConsistency(oldSize, newSize, oldRoot, newRoot, proof);
                expect(isValid).to.be.true;

                // Tamper test: Altered proof array length
                const isInvalidLength = verifyConsistency(oldSize, newSize, oldRoot, newRoot, [...proof, newRoot]);
                expect(isInvalidLength).to.be.false;
            }
        }
    });
});
