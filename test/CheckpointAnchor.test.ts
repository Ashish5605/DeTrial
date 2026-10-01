import { expect } from "chai";
import { ethers } from "hardhat";

describe("CheckpointAnchor Contract", function () {
    let anchor: any;
    let owner: any;
    let w1: any;
    let w2: any;
    let w3: any;
    let other: any;
    const institutionId = ethers.id("inst_nit_delhi");

    beforeEach(async function () {
        [owner, w1, w2, w3, other] = await ethers.getSigners();
        
        const CheckpointAnchor = await ethers.getContractFactory("CheckpointAnchor");
        // Deploy with 3 witnesses and a threshold of 2-of-3
        anchor = await CheckpointAnchor.deploy(
            owner.address,
            [w1.address, w2.address, w3.address],
            2n
        );
    });

    it("Should successfully anchor a checkpoint with valid witness signatures", async function () {
        const now = Math.floor(Date.now() / 1000);
        const checkpoint = {
            institutionId: institutionId,
            treeSize: 5n,
            rootHash: ethers.id("root_hash_v1"),
            timestamp: BigInt(now)
        };

        // Compute checkpoint hash
        const cpHash = await anchor.hashCheckpoint(checkpoint);
        const cpBytes = ethers.getBytes(cpHash);

        // Witnesses sign the message (using standard wallet signMessage which handles Ethereum signed message prefix)
        const sig1 = await w1.signMessage(cpBytes);
        const sig2 = await w2.signMessage(cpBytes);

        // Sort signatures by signer address to satisfy the contract requirement (signer > lastSigner)
        const sortedSigs = [w1.address.toLowerCase() < w2.address.toLowerCase() ? sig1 : sig2,
                            w1.address.toLowerCase() < w2.address.toLowerCase() ? sig2 : sig1];

        await anchor.anchorCheckpoint(checkpoint, await owner.signMessage(cpBytes), sortedSigs);

        const isAnchored = await anchor.isRootAnchored(institutionId, 5n, checkpoint.rootHash);
        expect(isAnchored).to.be.true;
        expect(await anchor.latestTreeSize(institutionId)).to.equal(5n);
    });

    it("Should reject checkpoint if tree size shrinks or duplicates", async function () {
        const now = Math.floor(Date.now() / 1000);
        const cp1 = { institutionId, treeSize: 5n, rootHash: ethers.id("r1"), timestamp: BigInt(now) };
        
        const cpHash1 = await anchor.hashCheckpoint(cp1);
        const sig1 = await w1.signMessage(ethers.getBytes(cpHash1));
        const sig2 = await w2.signMessage(ethers.getBytes(cpHash1));
        const sortedSigs = [w1.address.toLowerCase() < w2.address.toLowerCase() ? sig1 : sig2,
                            w1.address.toLowerCase() < w2.address.toLowerCase() ? sig2 : sig1];

        await anchor.anchorCheckpoint(cp1, await owner.signMessage(ethers.getBytes(cpHash1)), sortedSigs);

        // Try anchoring a smaller tree size (4)
        const cp2 = { institutionId, treeSize: 4n, rootHash: ethers.id("r2"), timestamp: BigInt(now + 10) };
        const cpHash2 = await anchor.hashCheckpoint(cp2);
        const s1 = await w1.signMessage(ethers.getBytes(cpHash2));
        const s2 = await w2.signMessage(ethers.getBytes(cpHash2));
        const sortedSigs2 = [w1.address.toLowerCase() < w2.address.toLowerCase() ? s1 : s2,
                             w1.address.toLowerCase() < w2.address.toLowerCase() ? s2 : s1];

        await expect(
            anchor.anchorCheckpoint.staticCall(cp2, "0x", sortedSigs2)
        ).to.be.revertedWithCustomError(anchor, "InvalidTreeSize");
    });
});

