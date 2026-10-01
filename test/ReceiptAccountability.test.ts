import { expect } from 'chai';
import { ethers } from 'hardhat';
import { DT_TYPES, verifyReceipt } from '../shared/receipt';
import { MerkleLog } from '../packages/crypto/src/merkleLog';

describe('DecisionTrail receipt accountability', function () {
  let registry: any, anchor: any, manager: any, issuer: any, holder: any, witness: any, outsider: any, domain: any, receipt: any, signature: string, log: MerkleLog;
  const caseId = ethers.encodeBytes32String('R17'), institutionId = ethers.id('institution'), serviceId = ethers.id('service'), salt = ethers.id('synthetic holder salt');
  beforeEach(async () => {
    [issuer, witness, holder, outsider] = await ethers.getSigners();
    registry = await (await ethers.getContractFactory('KeyRegistry')).deploy(issuer.address);
    anchor = await (await ethers.getContractFactory('CheckpointAnchor')).deploy(issuer.address, [witness.address], 1);
    manager = await (await ethers.getContractFactory('DisputeManager')).deploy(await registry.getAddress(), await anchor.getAddress());
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    await registry.registerSigner(institutionId, issuer.address, now - 1, now + 315360000);
    domain = { name: 'DecisionTrail', version: '1', chainId: 31337, verifyingContract: await manager.getAddress() };
    receipt = { caseId, institutionId, serviceId, docCommitments: [ethers.sha256(ethers.toUtf8Bytes('synthetic evidence'))], policyHash: ethers.id('policy'), timestamp: now, logIndex: 17, holderCommitment: ethers.solidityPackedKeccak256(['address', 'bytes32'], [holder.address, salt]) };
    signature = await issuer.signTypedData(domain, DT_TYPES, receipt);
    log = new MerkleLog();
    await manager.openCase(caseId, institutionId, serviceId, receipt.holderCommitment);
    const cp = await checkpoint(); await manager.sealRound(...cp);
  });
  async function checkpoint(id = caseId) {
    const c = await manager.cases(id);
    const response = await manager.latestDisposition(id);
    log.append(ethers.solidityPacked(['bytes32', 'uint64', 'bytes32'], [id, c.round, response]));
    const cp = { institutionId, treeSize: log.getSize(), rootHash: log.getRoot(), timestamp: (await ethers.provider.getBlock('latest'))!.timestamp };
    const bytes = ethers.getBytes(await anchor.hashCheckpoint(cp));
    await anchor.anchorCheckpoint(cp, await issuer.signMessage(bytes), [await witness.signMessage(bytes)]);
    return [id, cp.rootHash, cp.treeSize, cp.treeSize - 1, log.getInclusionProof(cp.treeSize - 1)];
  }
  const register = () => manager.connect(holder).registerReceipt(receipt, signature, salt);
  it('reopens, mines a blocked closure, resolves, checkpoints and seals without losing history', async () => {
    await expect(register()).to.emit(manager, 'CaseReopened');
    const before = await manager.cases(caseId);
    expect(before.state).eq(3n); expect(before.outstandingObligations).eq(1n);
    const tx = await manager.sealRound(caseId, log.getRoot(), log.getSize(), 0, [], { gasLimit: 600000 });
    const failed = await ethers.provider.getTransactionReceipt(tx.hash);
    expect(failed!.status).eq(0); expect(failed!.logs.length).eq(0);
    expect((await manager.cases(caseId)).outstandingObligations).eq(1n);
    const digest = await manager.receiptDigest(receipt);
    await manager.recordDisposition(caseId, digest, ethers.id('used in decision'), 0);
    expect((await manager.cases(caseId)).outstandingObligations).eq(0n);
    const cp = await checkpoint(); await manager.sealRound(...cp);
    expect((await manager.cases(caseId)).state).eq(2n);
    expect((await manager.queryFilter(manager.filters.RoundSealed(caseId))).length).eq(2);
    expect((await manager.queryFilter(manager.filters.CaseReopened(caseId))).length).eq(1);
  });
  it('rejects tampering with signed evidence and timestamp fields', async () => {
    for (const changed of [{ ...receipt, docCommitments: [ethers.id('tampered')] }, { ...receipt, timestamp: receipt.timestamp - 1 }]) await expect(manager.connect(holder).registerReceipt.staticCall(changed, signature, salt)).revertedWithCustomError(manager, 'KeyNotValid');
    expect((await manager.cases(caseId)).state).eq(2n);
  });
  it('rejects signatures from another chain and deployment', async () => {
    for (const changed of [{ ...domain, chainId: 1 }, { ...domain, verifyingContract: outsider.address }]) {
      const sig = await issuer.signTypedData(changed, DT_TYPES, receipt);
      await expect(manager.connect(holder).registerReceipt.staticCall(receipt, sig, salt)).revertedWithCustomError(manager, 'KeyNotValid');
    }
  });
  it('rejects personal-message signatures used by the legacy implementation', async () => {
    const sig = await issuer.signMessage(ethers.getBytes(ethers.TypedDataEncoder.hashStruct('Receipt', DT_TYPES, receipt)));
    await expect(manager.connect(holder).registerReceipt.staticCall(receipt, sig, salt)).revertedWithCustomError(manager, 'KeyNotValid');
  });
  it('prevents unauthorized holders and receipt replay', async () => {
    await expect(manager.connect(outsider).registerReceipt.staticCall(receipt, signature, salt)).revertedWithCustomError(manager, 'SignatureMismatch');
    await expect(manager.connect(holder).registerReceipt.staticCall(receipt, signature, ethers.ZeroHash)).revertedWithCustomError(manager, 'SignatureMismatch');
    await register();
    await expect(manager.connect(holder).registerReceipt.staticCall(receipt, signature, salt)).revertedWithCustomError(manager, 'AlreadyRegistered');
    expect((await manager.cases(caseId)).outstandingObligations).eq(1n);
  });
  it('does not permit anyone else to open, resolve or seal an audit', async () => {
    await expect(manager.connect(outsider).openCase.staticCall(ethers.id('new'), institutionId, serviceId, receipt.holderCommitment)).revertedWithCustomError(manager, 'Unauthorized');
    await register();
    await expect(manager.connect(holder).recordDisposition.staticCall(caseId, await manager.receiptDigest(receipt), ethers.id('response'), 0)).revertedWithCustomError(manager, 'Unauthorized');
    await expect(manager.connect(holder).sealRound.staticCall(caseId, log.getRoot(), 1, 0, [])).revertedWithCustomError(manager, 'Unauthorized');
  });
  it('requires every obligation to be resolved, not just the first receipt', async () => {
    await register();
    const second = { ...receipt, logIndex: 18 };
    await manager.connect(holder).registerReceipt(second, await issuer.signTypedData(domain, DT_TYPES, second), salt);
    expect((await manager.cases(caseId)).outstandingObligations).eq(2n);
    await manager.recordDisposition(caseId, await manager.receiptDigest(receipt), ethers.id('response1'), 0);
    await expect(manager.sealRound.staticCall(caseId, log.getRoot(), 1, 0, [])).revertedWithCustomError(manager, 'OutstandingObligations').withArgs(1n);
    await manager.recordDisposition(caseId, await manager.receiptDigest(second), ethers.id('response2'), 0);
    const cp = await checkpoint(); await manager.sealRound(...cp);
    expect((await manager.cases(caseId)).state).eq(2n);
  });
  it('requires a fresh checkpoint and verifies the actual inclusion proof', async () => {
    await register();
    const oldRoot = log.getRoot();
    await manager.recordDisposition(caseId, await manager.receiptDigest(receipt), ethers.id('response'), 0);
    await expect(manager.sealRound.staticCall(caseId, oldRoot, 1, 0, [])).revertedWithCustomError(manager, 'CheckpointRequired');
    const cp = await checkpoint();
    await expect(manager.sealRound.staticCall(cp[0], cp[1], cp[2], cp[3], [])).revertedWithCustomError(manager, 'InvalidInclusionProof');
    await manager.sealRound(...cp);
  });
  it('prevents double dispositions and cross-case receipt resolution', async () => {
    await register(); const digest = await manager.receiptDigest(receipt);
    const secondCase = ethers.id('another case');
    await manager.openCase(secondCase, institutionId, serviceId, receipt.holderCommitment);
    await expect(manager.recordDisposition.staticCall(secondCase, digest, ethers.id('response'), 0)).revertedWithCustomError(manager, 'InvalidState');
    await manager.recordDisposition(caseId, digest, ethers.id('response'), 0);
    await expect(manager.recordDisposition.staticCall(caseId, digest, ethers.id('response'), 0)).revertedWithCustomError(manager, 'InvalidState');
  });
  it('rejects an unsigned checkpoint and an invalid witness signature', async () => {
    const cp = { institutionId, treeSize: 2, rootHash: ethers.id('arbitrary root'), timestamp: receipt.timestamp };
    const bytes = ethers.getBytes(await anchor.hashCheckpoint(cp));
    await expect(anchor.anchorCheckpoint.staticCall(cp, await outsider.signMessage(bytes), [await witness.signMessage(bytes)])).revertedWithCustomError(anchor, 'InvalidSignature');
    await expect(anchor.anchorCheckpoint.staticCall(cp, await issuer.signMessage(bytes), [await outsider.signMessage(bytes)])).revertedWithCustomError(anchor, 'InvalidSignature');
  });
  it('rejects future receipts and mismatched case metadata', async () => {
    const future = { ...receipt, timestamp: receipt.timestamp + 100000 };
    await expect(manager.connect(holder).registerReceipt.staticCall(future, await issuer.signTypedData(domain, DT_TYPES, future), salt)).revertedWithCustomError(manager, 'InvalidReceipt');
    const other = { ...receipt, serviceId: ethers.id('other service') };
    await expect(manager.connect(holder).registerReceipt.staticCall(other, await issuer.signTypedData(domain, DT_TYPES, other), salt)).revertedWithCustomError(manager, 'ReceiptMismatch');
  });
  it('uses the same cryptographic verifier in the UI and contract', async () => {
    const config = { chainId: 31337, issuer: issuer.address, applicant: holder.address, institutionId, serviceId, contracts: { DisputeManager: { address: await manager.getAddress() } } };
    const file = { schema: 'decisiontrail/receipt-v1', synthetic: true, domain, receipt, signature, holderSalt: salt };
    expect(verifyReceipt(file, config).digest).eq(await manager.receiptDigest(receipt));
    expect(() => verifyReceipt({ ...file, receipt: { ...receipt, caseId: ethers.encodeBytes32String('R18') } }, config)).to.throw('Receipt verification failed');
    expect(() => verifyReceipt({ ...file, domain: { ...domain, chainId: 1 } }, config)).to.throw('another deployment');
    expect(() => verifyReceipt({ ...file, receipt: { ...receipt, docCommitments: [] } }, config)).to.throw('Invalid evidence');
  });
});

