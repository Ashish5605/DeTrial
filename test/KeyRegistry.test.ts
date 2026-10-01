import { expect } from "chai";
import { ethers } from "hardhat";

describe("KeyRegistry Contract", function () {
    let registry: any;
    let owner: any;
    let addr1: any;
    let addr2: any;
    const institutionId = ethers.id("inst_nit_delhi");
    const serviceId = ethers.id("srv_scholarship");

    beforeEach(async function () {
        [owner, addr1, addr2] = await ethers.getSigners();
        const KeyRegistry = await ethers.getContractFactory("KeyRegistry");
        registry = await KeyRegistry.deploy(owner.address);
    });

    it("Should allow owner to register and validate a signer key", async function () {
        const now = Math.floor(Date.now() / 1000);
        const validFrom = BigInt(now - 100);
        const validUntil = BigInt(now + 10000);

        await registry.registerSigner(institutionId, addr1.address, validFrom, validUntil);

        const isValid = await registry.isKeyValidAt(institutionId, addr1.address, BigInt(now));
        expect(isValid).to.be.true;

        const isBeforeValid = await registry.isKeyValidAt(institutionId, addr1.address, validFrom - 10n);
        expect(isBeforeValid).to.be.false;
    });

    it("Should invalidate key after revocation", async function () {
        const now = Math.floor(Date.now() / 1000);
        await registry.registerSigner(institutionId, addr1.address, BigInt(now - 100), BigInt(now + 10000));

        const tx = await registry.revokeSigner(institutionId, addr1.address);
        const receipt = await tx.wait();
        const block = await ethers.provider.getBlock(receipt!.blockNumber);

        const isValid = await registry.isKeyValidAt(institutionId, addr1.address, BigInt(block!.timestamp));
        expect(isValid).to.be.false;
    });

    it("Should configure and store service parameters", async function () {
        await registry.setServiceConfig(
            institutionId,
            serviceId,
            604800n, // 7 days in seconds
            true,
            ethers.id("statute_ref_sec_9"),
            addr2.address
        );

        const config = await registry.serviceConfigs(institutionId, serviceId);
        expect(config.responseWindowSeconds).to.equal(604800n);
        expect(config.deemedApprovalEnabled).to.be.true;
        expect(config.appellateAuthority).to.equal(addr2.address);
    });
});
