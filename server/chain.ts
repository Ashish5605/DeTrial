import { ethers } from 'ethers';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DT_DOMAIN, DT_TYPES, STATES, caseLabel, canonicalDisposition } from '../shared/receipt';
import { MerkleLog } from '../packages/crypto/src/merkleLog';
import { validateFileMetadata, validateFileBytes } from '../shared/formats';

export const root = path.resolve(__dirname, '..');
export const isQA = process.env.DT_PROFILE === 'qa';
export const ports = { rpc: 9655, api: 3004, web: 5176 };
export const runtime = path.join(root, '.runtime-classic');
fs.mkdirSync(runtime, { recursive: true });
if (process.env.NODE_ENV === 'production' && !process.env.RPC_URL) throw new Error('RPC_URL environment variable is required in production.');
export const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || `http://127.0.0.1:${ports.rpc}`, undefined, { cacheTimeout: -1 });
export async function getSigner(address: string) { if(process.env.DEPARTMENT_PRIVATE_KEY && (address === data?.department || address === data?.issuer)) return new ethers.Wallet(process.env.DEPARTMENT_PRIVATE_KEY, provider); return provider.getSigner(address); }
provider.pollingInterval = 250;
export const json = (v: any) => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? x.toString() : x, 2);
const stateFile = path.join(runtime, 'deployment.json');
export let data: any;
export function save() { fs.writeFileSync(stateFile + '.tmp', json(data)); fs.renameSync(stateFile + '.tmp', stateFile); }
export function artifact(name: string) { return JSON.parse(fs.readFileSync(path.join(root, `artifacts/contracts/${name}.sol/${name}.json`), 'utf8')); }
export function contract(name: string, signer?: any) { return new ethers.Contract(data.contracts[name].address, data.contracts[name].abi, signer || provider); }
export function publicConfig() { return { ...data, leaves: undefined, checkpoints: undefined, dispositions: undefined, receipts: undefined, submissions: undefined }; }
export async function checkpoint(caseId: string) {
  const manager = contract('DisputeManager');
  const c = await manager.cases(caseId);
  if (Number(c.outstandingObligations) !== 0) throw new Error('Resolve the outstanding obligation before appending a closure checkpoint.');
  if (![1, 4].includes(Number(c.state))) throw new Error('This audit is not ready for a checkpoint.');
  const responseHash = await manager.latestDisposition(caseId);
  const leaf = ethers.solidityPacked(['bytes32', 'uint64', 'bytes32'], [caseId, c.round, responseHash]);
  const leaves = [...data.leaves, leaf];
  const log = new MerkleLog(leaves);
  const cp = { institutionId: data.institutionId, treeSize: log.getSize(), rootHash: log.getRoot(), timestamp: (await provider.getBlock('latest'))!.timestamp };
  const anchor = contract('CheckpointAnchor', await getSigner(data.department));
  const hash = await anchor.hashCheckpoint(cp);
  const institutionSig = await (await getSigner(data.issuer)).signMessage(ethers.getBytes(hash));
  const witnessSig = await (await getSigner(data.witness)).signMessage(ethers.getBytes(hash));
  const tx = await anchor.anchorCheckpoint(cp, institutionSig, [witnessSig]);
  const mined = await tx.wait();
  if (mined.status !== 1) throw new Error('Checkpoint transaction reverted.');
  const proof = { caseId, rootHash: cp.rootHash, treeSize: cp.treeSize, leafIndex: leaves.length - 1, inclusionProof: log.getInclusionProof(leaves.length - 1), transactionHash: tx.hash, blockNumber: mined.blockNumber, round: c.round.toString(), responseHash };
  data.leaves = leaves;
  data.checkpoints.push(proof);
  save();
  return proof;
}
export async function disposition(caseId: string, file: any, disposition = 0, reason = 'Synthetic evidence accounted for in the demonstration.') {
  const digest = ethers.TypedDataEncoder.hash(file.domain, DT_TYPES, file.receipt);
  const text = canonicalDisposition(caseId, digest, disposition, reason);
  const hash = ethers.keccak256(ethers.toUtf8Bytes(text));
  const tx = await contract('DisputeManager', await getSigner(data.department)).recordDisposition(caseId, digest, hash, disposition);
  await tx.wait();
  data.dispositions[hash] = JSON.parse(text);
  save();
  return tx.hash;
}
export async function initialize() {
  const network = await provider.getNetwork();
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.KEY_REGISTRY_ADDRESS || !process.env.CHECKPOINT_ANCHOR_ADDRESS || !process.env.DISPUTE_MANAGER_ADDRESS) {
      throw new Error('KEY_REGISTRY_ADDRESS, CHECKPOINT_ANCHOR_ADDRESS, and DISPUTE_MANAGER_ADDRESS are required in production.');
    }
    data = {
      version: 1, chainId: Number(process.env.CHAIN_ID), chainName: 'Production',
      deploymentBlock: 0, deploymentBlockHash: ethers.ZeroHash, codeHash: ethers.ZeroHash,
      contracts: {
        KeyRegistry: { address: process.env.KEY_REGISTRY_ADDRESS, abi: artifact('KeyRegistry').abi },
        CheckpointAnchor: { address: process.env.CHECKPOINT_ANCHOR_ADDRESS, abi: artifact('CheckpointAnchor').abi },
        DisputeManager: { address: process.env.DISPUTE_MANAGER_ADDRESS, abi: artifact('DisputeManager').abi }
      },
      issuer: new ethers.Wallet(process.env.DEPARTMENT_PRIVATE_KEY!).address,
      department: new ethers.Wallet(process.env.DEPARTMENT_PRIVATE_KEY!).address,
      witness: process.env.WITNESS_ADDRESS || ethers.ZeroAddress,
      applicant: ethers.ZeroAddress,
      institutionId: ethers.id('DecisionTrail:Public Service Department'),
      serviceId: ethers.id('DecisionTrail:Evidence accountability'),
      cases: [], leaves: [], checkpoints: [], receipts: {}, dispositions: {}, submissions: {}
    };
    return;
  }
  if (network.chainId !== 31337n) throw new Error('DecisionTrail only runs against local Hardhat chain 31337.');
  if (fs.existsSync(stateFile)) {
    data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    const deployedCode = await provider.getCode(data.contracts.DisputeManager.address);
    const deployedBlock = await provider.getBlock(data.deploymentBlock);
    if (deployedCode !== '0x' && ethers.keccak256(deployedCode) === data.codeHash && deployedBlock?.hash === data.deploymentBlockHash) { await ensureFormatFixtures(); return; }
    fs.copyFileSync(stateFile, path.join(runtime, `previous-deployment-${Date.now()}.json`));
  }
  const department = await provider.getSigner(0), witness = await provider.getSigner(1), applicant = await provider.getSigner(2);
  const contracts: any = {};
  for (const name of ['KeyRegistry', 'CheckpointAnchor', 'DisputeManager']) {
    const a = artifact(name);
    const args = name === 'KeyRegistry' ? [department.address] : name === 'CheckpointAnchor' ? [department.address, [witness.address], 1] : [contracts.KeyRegistry.address, contracts.CheckpointAnchor.address];
    const deployed = await new ethers.ContractFactory(a.abi, a.bytecode, department).deploy(...args);
    await deployed.waitForDeployment();
    contracts[name] = { address: await deployed.getAddress(), abi: a.abi };
  }
  const block = (await provider.getBlock('latest'))!;
  data = { version: 1, chainId: 31337, chainName: 'Local Hardhat', deploymentBlock: block.number, deploymentBlockHash: block.hash, codeHash: ethers.keccak256(await provider.getCode(contracts.DisputeManager.address)), contracts, issuer: department.address, department: department.address, applicant: applicant.address, witness: witness.address, institutionId: ethers.id('DecisionTrail:Public Service Department'), serviceId: ethers.id('DecisionTrail:Evidence accountability'), cases: [], leaves: [], checkpoints: [], receipts: {}, dispositions: {} };
  const registry = contract('KeyRegistry', department);
  await (await registry.registerSigner(data.institutionId, department.address, block.timestamp - 1, block.timestamp + 315360000)).wait();
  await (await registry.setServiceConfig(data.institutionId, data.serviceId, 604800, false, ethers.ZeroHash, department.address)).wait();
  save();
  for (const [label, scenario] of [['R17', 'A'], ['R18', 'B'], ['R19', 'C']]) await createFixture(label, scenario);
  await ensureFormatFixtures();
}
export async function createFixture(label: string, scenario: string, commitments?: string[]) {
  if (data.cases.some((c: any) => c.label === label)) return;
  const caseId = ethers.encodeBytes32String(label);
  const holderSalt = ethers.id(`decisiontrail:synthetic:${label}`);
  const holderCommitment = ethers.solidityPackedKeccak256(['address', 'bytes32'], [data.applicant, holderSalt]);
  const manager = contract('DisputeManager', await getSigner(data.department));
  await (await manager.openCase(caseId, data.institutionId, data.serviceId, holderCommitment)).wait();
  const receipt = { caseId, institutionId: data.institutionId, serviceId: data.serviceId, docCommitments: commitments || [1, 2, 3].map(n => ethers.sha256(ethers.toUtf8Bytes(`SYNTHETIC ${label} evidence item ${n}`))), policyHash: ethers.id('DecisionTrail synthetic receipt accountability v1'), timestamp: (await provider.getBlock('latest'))!.timestamp, logIndex: 17 + data.cases.length, holderCommitment };
  const domain = { ...DT_DOMAIN, chainId: 31337, verifyingContract: data.contracts.DisputeManager.address };
  const file = { schema: 'decisiontrail/receipt-v1', synthetic: true, domain, receipt, holderSalt, signature: await (await getSigner(data.issuer)).signTypedData(domain, DT_TYPES, receipt) };
  data.receipts[caseId] = file;
  data.cases.push({ caseId, label, scenario, description: scenario === 'D' ? 'Multi-format evidence · registered' : scenario === 'A' ? 'Sealed · omitted receipt' : scenario === 'B' ? 'Reopened · unresolved receipt' : 'Resolved · resealed audit' });
  save();
  const cp = await checkpoint(caseId);
  await (await manager.sealRound(caseId, cp.rootHash, cp.treeSize, cp.leafIndex, cp.inclusionProof)).wait();
  if (scenario !== 'A') {
    await (await manager.connect(await getSigner(data.applicant)).getFunction('registerReceipt')(receipt, file.signature, holderSalt)).wait();
    if (scenario === 'C') {
      await disposition(caseId, file);
      const next = await checkpoint(caseId);
      await (await manager.sealRound(caseId, next.rootHash, next.treeSize, next.leafIndex, next.inclusionProof)).wait();
    }
  }
  fs.writeFileSync(path.join(root, 'fixtures', `${isQA ? 'QA-' : ''}${label}.json`), json(file));
}
export async function txDetails(hash: string) {
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) return { hash, status: 'PENDING' };
  const tx = await provider.getTransaction(hash);
  const block = await provider.getBlock(receipt.blockNumber);
  return { hash, status: receipt.status === 1 ? 'CONFIRMED' : 'REVERTED', blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), gasPrice: receipt.gasPrice.toString(), timestamp: block!.timestamp, from: receipt.from, to: receipt.to, chainId: data.chainId, method: tx?.data.slice(0, 10) };
}
export async function auditState(caseId: string) {
  const manager = contract('DisputeManager');
  const c = await manager.cases(caseId);
  if (Number(c.state) === 0) throw new Error('This case is not in the current registry.');
  const file = data.receipts[caseId];
  const digest = file ? ethers.TypedDataEncoder.hash(file.domain, DT_TYPES, file.receipt) : ethers.ZeroHash;
  const [registered, responseHash, latestResponse, sealedSize, disposedSize, latestBlock] = await Promise.all([manager.registeredReceipts(digest), manager.dispositions(digest), manager.latestDisposition(caseId), manager.sealedTreeSize(caseId), manager.dispositionTreeSize(caseId), provider.getBlockNumber()]);
  const proof = data.checkpoints.filter((p: any) => p.caseId === caseId && p.round === c.round.toString() && p.responseHash === latestResponse).at(-1);
  const ready = !!proof && BigInt(proof.treeSize) > sealedSize && (Number(c.state) !== 4 || BigInt(proof.treeSize) > disposedSize);
  const history: any[] = [];
  const logs = await manager.queryFilter('*', data.deploymentBlock, latestBlock);
  for (const log of logs) {
    const parsed = manager.interface.parseLog(log);
    if (parsed?.args.caseId !== caseId) continue;
    const transaction = await txDetails(log.transactionHash);
    history.push({ name: parsed.name, index: log.index, ...transaction, actor: transaction.from, responseHash: parsed.name === 'DispositionRecorded' ? parsed.args.responseHash : undefined, disposition: parsed.name === 'DispositionRecorded' ? Number(parsed.args.disposition) : undefined });
  }
  for (const cp of data.checkpoints.filter((p: any) => p.caseId === caseId)) history.push({ name: 'CheckpointAnchored', index: 0, ...await txDetails(cp.transactionHash), actor: data.department });
  // Only transactions submitted for this case are inspected; avoid rescanning every chain block.
  for (const hash of data.failedClosures?.[caseId] || []) {
    const transaction = await txDetails(hash);
    if (transaction.status === 'REVERTED') history.push({ name: 'ClosureRejected', index: 0, ...transaction, actor: transaction.from });
  }
  history.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
  return { caseId, label: caseLabel(caseId), evidenceCount: file?.receipt.docCommitments.length || 0, state: STATES[Number(c.state)], outstanding: Number(c.outstandingObligations), round: Number(c.round), deadline: Number(c.deadline), registered, digest, responseHash, checkpoint: proof || null, readyToSeal: ready, latestBlock, history };
}

export const sampleNames = ['sample-evidence.pdf', 'sample-evidence.png', 'sample-evidence.jpg', 'sample-evidence.jpeg'];
export function sampleBytes(name: string) {
  if (!sampleNames.includes(name)) throw new Error('Unknown sample file.');
  return fs.readFileSync(path.join(root, 'fixtures', 'documents', name));
}
async function ensureFormatFixtures() {
  data.submissions ||= {};
  const samples = sampleNames.map(name => { const bytes = sampleBytes(name); return { name, size: bytes.length, sha256: ethers.sha256(bytes), caseId: ethers.encodeBytes32String('R20') }; });
  await createFixture('R20', 'D', samples.map(s => s.sha256));
  // Refuse silent fixture replacement: an existing signed receipt remains authoritative.
  const original = data.receipts[ethers.encodeBytes32String('R20')];
  if (samples.some(s => !original.receipt.docCommitments.includes(s.sha256))) throw new Error('Sample file bytes changed after signing. Keep the original fixtures or start a separate development chain.');
  data.fileSamples = samples;
  save();
}
export function resolveFile(hash: string, caseId?: string) {
  if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid SHA-256 fingerprint.');
  const matches = Object.values(data.receipts).filter((file: any) => (!caseId || file.receipt.caseId === caseId) && file.receipt.docCommitments.some((h: string) => h.toLowerCase() === hash.toLowerCase()));
  return { matches: matches.map((file: any) => ({ caseId: file.receipt.caseId, label: caseLabel(file.receipt.caseId), receipt: file })), extraction: 'None. Association uses the actual SHA-256 commitment, not OCR or document text.' };
}
export function submitEvidence(name: string, mime: string, bytes: Buffer, owner?: string) {
  const info = validateFileMetadata(name, mime, bytes.length);
  validateFileBytes(info, bytes);
  if (info.format === 'JSON') throw new Error('Import signed JSON receipts in the verifier. Submit PDF or image evidence for acknowledgement.');
  const sha256 = '0x' + createHash('sha256').update(bytes).digest('hex');
  data.submissions ||= {};
  const duplicate: any = Object.values(data.submissions).find((s: any) => s.sha256 === sha256);
  if (duplicate) return duplicate;
  const id = randomUUID();
  const folder = path.join(runtime, 'evidence'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, id + '.bin'), bytes, { flag: 'wx', mode: 0o600 });
  const item = { ...info, id, sha256, createdAt: Math.floor(Date.now() / 1000), status: 'PENDING', caseId: ethers.encodeBytes32String('DT-' + id.replaceAll('-', '').slice(0, 10).toUpperCase()) };
  data.submissions[id] = item;
  save();
  return item;
}
export function evidenceBytes(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !data.submissions?.[id]) throw new Error('Evidence record not found.');
  const info = data.submissions[id];
  return { info, bytes: fs.readFileSync(path.join(runtime, 'evidence', id + '.bin')) };
}
export async function acknowledgeEvidence(id: string, holder = data.applicant) {
  const { info, bytes } = evidenceBytes(id);
  if (ethers.sha256(bytes) !== info.sha256) throw new Error('Stored file integrity check failed. Acknowledgement was not signed.');
  if (info.status === 'ACKNOWLEDGED') return { item: info, receipt: data.receipts[info.caseId] };
  const department = await getSigner(data.department);
  const manager = contract('DisputeManager', department);
  const salt = ethers.id(`DecisionTrail local acknowledgement ${id}`);
  const commitment = ethers.solidityPackedKeccak256(['address', 'bytes32'], [holder, salt]);
  if (Number((await manager.cases(info.caseId)).state) === 0) {
    const opened = await manager.openCase(info.caseId, data.institutionId, data.serviceId, commitment);
    const mined = await opened.wait();
    if (mined.status !== 1) throw new Error('Case creation was not confirmed.');
    info.openTransactionHash = opened.hash; save();
  }
  const receipt = { caseId: info.caseId, institutionId: data.institutionId, serviceId: data.serviceId, docCommitments: [info.sha256], policyHash: ethers.id('DecisionTrail local-demo file acknowledgement v1'), timestamp: (await provider.getBlock('latest'))!.timestamp, logIndex: data.cases.length + 17, holderCommitment: commitment };
  const domain = { ...DT_DOMAIN, chainId: data.chainId, verifyingContract: data.contracts.DisputeManager.address };
  const file = { schema: 'decisiontrail/receipt-v1', synthetic: false, issuerContext: 'LOCAL_DEMO_ACKNOWLEDGEMENT', domain, receipt, holderSalt: salt, signature: await department.signTypedData(domain, DT_TYPES, receipt) };
  data.receipts[info.caseId] = file;
  if (!data.cases.some((c: any) => c.caseId === info.caseId)) data.cases.push({ caseId: info.caseId, label: caseLabel(info.caseId), scenario: 'File', description: `${info.format} · local acknowledgement` });
  info.status = 'ACKNOWLEDGED'; info.acknowledgedAt = receipt.timestamp;
  save();
  return { item: info, receipt: file };
}
