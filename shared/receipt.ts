import { DT_DOMAIN, DT_TYPES } from '../packages/crypto/src/typedData';
import { TypedDataEncoder, verifyTypedData, decodeBytes32String, isHexString, solidityPackedKeccak256 } from 'ethers';
export { DT_DOMAIN, DT_TYPES };
export const STATES = ['NONE', 'OPEN', 'SEALED', 'REOPENED', 'RESPONDED', 'ESCALATED', 'DEEMED_APPROVED'];
export function caseLabel(id: string) { try { return decodeBytes32String(id); } catch { return id.slice(0, 12); } }
export type ReceiptFile = { schema: string; domain: any; receipt: any; signature: string; holderSalt: string; synthetic: boolean };
export function verifyReceipt(file: ReceiptFile, config: any) {
  if (!file || file.schema !== 'decisiontrail/receipt-v1' || !file.receipt || !file.domain) throw new Error('Invalid receipt file. Choose a DecisionTrail receipt JSON.');
  const d = file.domain;
  if (d.name !== DT_DOMAIN.name || d.version !== DT_DOMAIN.version || Number(d.chainId) !== Number(config.chainId) || d.verifyingContract?.toLowerCase() !== config.contracts.DisputeManager.address.toLowerCase()) throw new Error('Receipt belongs to another deployment. Import a receipt for the current chain and contract.');
  const r = file.receipt;
  for (const k of ['caseId', 'institutionId', 'serviceId', 'policyHash', 'holderCommitment']) if (!isHexString(r[k], 32)) throw new Error('Invalid signed field: ' + k);
  if (!Array.isArray(r.docCommitments) || r.docCommitments.length < 1 || r.docCommitments.length > 64 || r.docCommitments.some((v: string) => !isHexString(v, 32))) throw new Error('Invalid evidence commitments.');
  if (!isHexString(file.holderSalt, 32)) throw new Error('Invalid holder binding.');
  for (const k of ['timestamp', 'logIndex']) if (!/^\d+$/.test(String(r[k])) || BigInt(r[k]) > (1n << 64n) - 1n) throw new Error('Invalid signed field: ' + k);
  const signer = verifyTypedData(d, DT_TYPES, r, file.signature);
  if (signer.toLowerCase() !== config.issuer.toLowerCase()) throw new Error('Receipt verification failed. The signed fields do not match the trusted issuer signature.');
  if (r.institutionId !== config.institutionId || r.serviceId !== config.serviceId) throw new Error('Receipt belongs to another institution or service.');
  if (solidityPackedKeccak256(['address', 'bytes32'], [config.applicant, file.holderSalt]) !== r.holderCommitment) throw new Error('This receipt belongs to another applicant.');
  return { signer, digest: TypedDataEncoder.hash(d, DT_TYPES, r), caseId: r.caseId, label: caseLabel(r.caseId) };
}
export function canonicalDisposition(caseId: string, receiptHash: string, disposition: number, reason: string) {
  return JSON.stringify({ caseId, receiptHash, disposition, reason: reason.trim() });
}
