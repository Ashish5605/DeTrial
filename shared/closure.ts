import { AbiCoder, TypedDataEncoder, getAddress, isHexString, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';
import { ReceiptFile, caseLabel, verifyReceipt } from './receipt';

export const CLOSURE_SCOPE = keccak256(toUtf8Bytes('decisiontrail:complete-registered-receipts-at-seal:v1'));
export const CLOSURE_TYPES = { ClosureRecord: [
  { name: 'caseId', type: 'bytes32' }, { name: 'institutionId', type: 'bytes32' }, { name: 'serviceId', type: 'bytes32' }, { name: 'holderCommitment', type: 'bytes32' },
  { name: 'deploymentBlockHash', type: 'bytes32' }, { name: 'blockNumber', type: 'uint256' }, { name: 'blockHash', type: 'bytes32' }, { name: 'blockTimestamp', type: 'uint64' },
  { name: 'round', type: 'uint64' }, { name: 'sealTransaction', type: 'bytes32' }, { name: 'inventoryHash', type: 'bytes32' }, { name: 'receiptCount', type: 'uint64' },
  { name: 'signedAt', type: 'uint64' }, { name: 'scope', type: 'bytes32' },
] };
export type InventoryEntry = { receiptHash: string; responseHash: string };
export type TrustAnchor = { chainId: number; issuer: string; applicant: string; institutionId: string; serviceId: string; deploymentBlock: number; deploymentBlockHash: string; contracts: { DisputeManager: { address: string } } };
export type ClosureRecord = { schema: 'decisiontrail/closure-v1'; domain: any; statement: any; inventory: InventoryEntry[]; signature: string };
export type ProofPacket = { schema: 'decisiontrail/proof-packet-v1'; record: ClosureRecord; receipts: ReceiptFile[] };
export type ComparisonRow = { digest: string; label: string; evidenceCount: number; issuedAt: number; status: 'MISSING' | 'LISTED' | 'LATER'; responseHash?: string; receipt: ReceiptFile };
export type Comparison = { signer: string; recordDigest: string; label: string; missing: number; listed: number; later: number; rows: ComparisonRow[] };

export function trustAnchor(config: any): TrustAnchor {
  return { chainId: config.chainId, issuer: config.issuer, applicant: config.applicant, institutionId: config.institutionId, serviceId: config.serviceId, deploymentBlock: config.deploymentBlock, deploymentBlockHash: config.deploymentBlockHash, contracts: { DisputeManager: { address: config.contracts.DisputeManager.address } } };
}
export function anchorFingerprint(anchor: TrustAnchor) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(['uint256','address','address','bytes32','bytes32','bytes32','address'], [anchor.chainId,anchor.issuer,anchor.applicant,anchor.institutionId,anchor.serviceId,anchor.deploymentBlockHash,anchor.contracts.DisputeManager.address]));
}
export function inventoryHash(entries: InventoryEntry[]) {
  if (!Array.isArray(entries) || entries.length > 4096) throw new Error('Invalid or oversized closure inventory.');
  const keys = new Set<string>();
  for (const entry of entries) {
    if (!isHexString(entry?.receiptHash,32) || !isHexString(entry?.responseHash,32)) throw new Error('Malformed receipt or disposition commitment in closure record.');
    if (keys.has(entry.receiptHash.toLowerCase())) throw new Error('Duplicate receipt in closure inventory.');
    keys.add(entry.receiptHash.toLowerCase());
  }
  const sorted = [...entries].sort((a,b) => a.receiptHash.toLowerCase().localeCompare(b.receiptHash.toLowerCase()));
  return keccak256(AbiCoder.defaultAbiCoder().encode(['tuple(bytes32 receiptHash,bytes32 responseHash)[]'], [sorted]));
}
export function closureDomain(anchor: TrustAnchor) { return { name: 'DecisionTrail Closure Record', version: '1', chainId: anchor.chainId, verifyingContract: anchor.contracts.DisputeManager.address }; }
export function verifyClosure(record: ClosureRecord, anchor: TrustAnchor) {
  if (!anchor || !getAddress(anchor.issuer) || !getAddress(anchor.contracts.DisputeManager.address)) throw new Error('An independently trusted issuer and deployment are required.');
  if (record?.schema !== 'decisiontrail/closure-v1' || !record.statement || !record.domain) throw new Error('Choose a signed DecisionTrail closure record.');
  const expected = closureDomain(anchor), d = record.domain, s = record.statement;
  if (d.name !== expected.name || d.version !== expected.version || Number(d.chainId) !== anchor.chainId || d.verifyingContract?.toLowerCase() !== expected.verifyingContract.toLowerCase() || s.deploymentBlockHash !== anchor.deploymentBlockHash) throw new Error('Closure record belongs to another deployment or signing domain.');
  for (const key of ['caseId','institutionId','serviceId','holderCommitment','deploymentBlockHash','blockHash','sealTransaction','inventoryHash','scope']) if (!isHexString(s[key],32)) throw new Error('Invalid signed closure field: '+key);
  for (const key of ['blockNumber','blockTimestamp','round','receiptCount','signedAt']) if (!/^\d+$/.test(String(s[key])) || BigInt(s[key]) > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid numeric closure field: '+key);
  if (s.institutionId !== anchor.institutionId || s.serviceId !== anchor.serviceId || s.scope !== CLOSURE_SCOPE) throw new Error('The signed record has a different institution, service or completeness scope.');
  if (Number(s.blockNumber) < anchor.deploymentBlock || Number(s.signedAt) < Number(s.blockTimestamp)) throw new Error('Invalid closure record chronology.');
  if (Number(s.receiptCount) !== record.inventory?.length || inventoryHash(record.inventory) !== s.inventoryHash) throw new Error('Closure inventory was changed after signing.');
  const signer = verifyTypedData(d,CLOSURE_TYPES,s,record.signature);
  if (signer.toLowerCase() !== anchor.issuer.toLowerCase()) throw new Error('Closure signature does not match the trusted issuer.');
  return { signer, digest: TypedDataEncoder.hash(d,CLOSURE_TYPES,s) };
}
export function compareClosure(record: ClosureRecord, receipts: ReceiptFile[], anchor: TrustAnchor): Comparison {
  const checked = verifyClosure(record, anchor);
  if (!Array.isArray(receipts) || receipts.length < 1 || receipts.length > 32) throw new Error('Supply between 1 and 32 applicant-held signed receipts.');
  const seen = new Set<string>();
  const rows = receipts.map(receipt => {
    const proof = verifyReceipt(receipt, anchor);
    if (receipt.receipt.caseId !== record.statement.caseId || receipt.receipt.holderCommitment !== record.statement.holderCommitment) throw new Error('Receipt and closure record belong to different applications or holders.');
    if (seen.has(proof.digest)) throw new Error('Duplicate applicant receipt. Each signed receipt is counted once.');
    seen.add(proof.digest);
    const found = record.inventory.find(entry => entry.receiptHash.toLowerCase() === proof.digest.toLowerCase());
    const status = Number(receipt.receipt.timestamp) > Number(record.statement.blockTimestamp) ? 'LATER' : found ? 'LISTED' : 'MISSING';
    return { digest: proof.digest, label: caseLabel(proof.caseId), evidenceCount: receipt.receipt.docCommitments.length, issuedAt: Number(receipt.receipt.timestamp), status, responseHash: found?.responseHash, receipt } as ComparisonRow;
  });
  return { signer: checked.signer, recordDigest: checked.digest, label: caseLabel(record.statement.caseId), missing: rows.filter(r => r.status === 'MISSING').length, listed: rows.filter(r => r.status === 'LISTED').length, later: rows.filter(r => r.status === 'LATER').length, rows };
}
export function verifyPacket(packet: ProofPacket, anchor: TrustAnchor) {
  if (packet?.schema !== 'decisiontrail/proof-packet-v1') throw new Error('Choose a DecisionTrail proof packet.');
  return compareClosure(packet.record, packet.receipts, anchor);
}
export function challengeText(packet: ProofPacket, anchor: TrustAnchor) {
  const result = verifyPacket(packet, anchor), s = packet.record.statement;
  return [
    'DECISIONTRAIL — RECEIPT RECONCILIATION', `Application: ${result.label}`, `Issuer: ${result.signer}`,
    `Registry: ${anchor.contracts.DisputeManager.address}`, `Chain: ${anchor.chainId}`, `Deployment: ${anchor.deploymentBlockHash}`,
    `Snapshot block: ${s.blockNumber} (${s.blockHash})`, `Seal transaction: ${s.sealTransaction}`,
    `Snapshot time: ${new Date(Number(s.blockTimestamp)*1000).toISOString()}`, `Record signed at: ${new Date(Number(s.signedAt)*1000).toISOString()}`,
    '', 'Scope: complete registered-receipt inventory at the specified seal. This is a retrospective signed registry statement, not a claim about every off-chain departmental file.',
    '', ...result.rows.map(r => `${r.status}: ${r.digest} — ${r.evidenceCount} acknowledged evidence commitments`),
    '', result.missing ? 'Request: account for the signed receipt(s) missing from this registry snapshot and update the accountability record.' : 'No pre-closure receipt supplied in this packet was missing from the signed inventory.',
    '', 'Signatures and signed-inventory comparison can be checked offline. Offline verification does not establish canonical blockchain inclusion, current registry state, key revocation status, factual truth, or legal error. A missing registry entry does not prove that an officer ignored the evidence elsewhere.',
    'Receipt dates are issuer-signed claims, not independent trusted timestamps. This packet includes no original document bytes. It is not automatically submitted to any authority.',
  ].join('\n');
}
