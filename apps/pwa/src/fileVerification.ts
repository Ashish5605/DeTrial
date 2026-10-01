import { authFetch as fetch } from './authClient';
import { Contract, JsonRpcProvider, TypedDataEncoder, isHexString } from 'ethers';
import { FileInfo, validateFileMetadata, validateFileBytes } from '../../../shared/formats';
import { DT_TYPES, ReceiptFile, verifyReceipt } from '../../../shared/receipt';

export type PreparedFile = { info: FileInfo; bytes: Uint8Array; sha256: string; json?: any; original: File };
export type VerificationResult = { status: 'VERIFIED' | 'UNREGISTERED' | 'MISMATCH'; message: string; sha256: string; caseId?: string; label?: string; receipt?: ReceiptFile; digest?: string; signatureValid: boolean; commitmentMatched: boolean; anchored: boolean; transactionHash?: string; blockNumber?: number; association: string };
export type RecordReference = { caseId: string; sha256?: string; deployment?: string };

export async function prepareFile(file: File, progress: (text: string) => void): Promise<PreparedFile> {
  const info = validateFileMetadata(file.name, file.type, file.size);
  progress('Reading receipt...');
  const bytes = new Uint8Array(await file.arrayBuffer());
  validateFileBytes(info, bytes);
  progress('Calculating integrity fingerprint...');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = '0x' + Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  let parsed: any;
  if (info.format === 'JSON') {
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('Invalid receipt JSON. Choose a valid UTF-8 JSON signed receipt.'); }
  }
  return { info, bytes, sha256, json: parsed, original: file };
}

async function readJson(url: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const result = await res.json().catch(() => ({ error: 'The record service is unavailable.' }));
  if (!res.ok) throw new Error(result.error || 'The record could not be read.');
  return result;
}

export async function checkSignedReceipt(file: ReceiptFile, config: any, rpc: JsonRpcProvider, progress: (text: string) => void) {
  progress('Verifying issuer signature...');
  const checked = verifyReceipt(file, config);
  progress('Checking blockchain record...');
  const manager = new Contract(config.contracts.DisputeManager.address, config.contracts.DisputeManager.abi, rpc);
  const registry = new Contract(config.contracts.KeyRegistry.address, config.contracts.KeyRegistry.abi, rpc);
  const [network, code, block, validKey, c, digest, registered] = await Promise.all([
    rpc.getNetwork(), rpc.getCode(config.contracts.DisputeManager.address), rpc.getBlock('latest'),
    registry.isKeyValidAt(file.receipt.institutionId, checked.signer, file.receipt.timestamp), manager.cases(checked.caseId), manager.receiptDigest(file.receipt), manager.registeredReceipts(checked.digest),
  ]);
  if (Number(network.chainId) !== Number(config.chainId) || code === '0x' || !block) throw new Error('Chain unavailable or wrong deployment. Start the configured local node and retry.');
  if (!validKey) throw new Error('The issuer key is not valid at the receipt timestamp.');
  if (Number(file.receipt.timestamp) > block.timestamp) throw new Error('The receipt timestamp is in the future.');
  if (Number(c.state) === 0 || c.institutionId !== file.receipt.institutionId || c.serviceId !== file.receipt.serviceId || c.holderCommitment !== file.receipt.holderCommitment) throw new Error('The receipt does not match this on-chain application record.');
  if (digest !== checked.digest || TypedDataEncoder.hash(file.domain, DT_TYPES, file.receipt) !== digest) throw new Error('The on-chain receipt digest does not match the signed fields.');
  if (!registered) return { ...checked, anchored: false };
  if (await manager.receiptCase(digest) !== checked.caseId) throw new Error('The registered commitment belongs to another application.');
  const logs = await manager.queryFilter(manager.filters.ReceiptRegistered(checked.caseId, digest), config.deploymentBlock, block.number);
  const event = logs.at(-1);
  if (!event) throw new Error('Registered state found, but its transaction could not be verified. Retry reading the chain.');
  const [tx, mined] = await Promise.all([rpc.getTransaction(event.transactionHash), rpc.getTransactionReceipt(event.transactionHash)]);
  if (!tx || !mined || mined.status !== 1 || tx.to?.toLowerCase() !== config.contracts.DisputeManager.address.toLowerCase()) throw new Error('The registration transaction is not confirmed.');
  const decoded = manager.interface.parseTransaction({ data: tx.data });
  if (decoded?.name !== 'registerReceipt') throw new Error('The referenced transaction did not register this receipt.');
  const values: any = {};
  for (const field of DT_TYPES.Receipt) values[field.name] = decoded.args[0][field.name];
  if (TypedDataEncoder.hash(file.domain, DT_TYPES, values) !== digest) throw new Error('The transaction payload does not contain the expected commitment.');
  return { ...checked, anchored: true, transactionHash: tx.hash, blockNumber: mined.blockNumber };
}

export async function verifyFile(file: PreparedFile, config: any, rpc: JsonRpcProvider, selectedCase: string, progress: (text: string) => void, reference?: RecordReference): Promise<VerificationResult> {
  const base = { sha256: file.sha256, signatureValid: false, commitmentMatched: false, anchored: false };
  if (reference?.deployment && reference.deployment !== config.deploymentBlockHash) throw new Error('Verification link belongs to another deployment. Open a link generated by the current local chain.');
  if (reference?.sha256 && (!isHexString(reference.sha256, 32) || reference.sha256.toLowerCase() !== file.sha256)) return { ...base, status: 'MISMATCH', caseId: reference.caseId, message: 'The uploaded file does not match the fingerprint in this verification reference.', association: 'Verification reference; the file itself has not matched.' };
  progress('Verifying commitment...');
  let signed: ReceiptFile | undefined;
  let association: string;
  if (file.info.format === 'JSON') {
    signed = file.json;
    association = 'Application ID from the verified signed payload. SHA-256 fingerprints the exact JSON bytes; EIP-712 verifies its signed fields.';
    if (signed?.receipt?.caseId !== (reference?.caseId || selectedCase)) return { ...base, status: 'MISMATCH', caseId: reference?.caseId || selectedCase, message: 'This JSON receipt belongs to another application.', association };
  } else {
    const suffix = `&caseId=${encodeURIComponent(reference?.caseId || selectedCase)}`;
    const resolved = await readJson(`/api/resolve?sha256=${file.sha256}${suffix}`);
    signed = resolved.matches?.find((m: any) => m.caseId === selectedCase)?.receipt || resolved.matches?.[0]?.receipt;
    association = 'Exact file SHA-256 matched to an issuer-signed receipt. No OCR, QR extraction, or semantic interpretation was performed.';
    if (!signed) return { ...base, status: 'MISMATCH', caseId: reference?.caseId || selectedCase, message: 'The uploaded file does not match a recorded cryptographic commitment. Select the original artifact or create a new evidence case.', association: 'No matching signed file commitment. The selected case alone is not proof.' };
    if (!signed.receipt.docCommitments.includes(file.sha256)) throw new Error('The returned receipt does not commit to this file.');
  }
  const proof = await checkSignedReceipt(signed!, config, rpc, progress);
  return { ...base, ...proof, receipt: signed, status: proof.anchored ? 'VERIFIED' : 'UNREGISTERED', signatureValid: true, commitmentMatched: true, message: proof.anchored ? 'The artifact commitment and issuer signature match a confirmed registration in the deployed contract.' : 'The issuer signature is valid, but this receipt has not been registered on-chain. Register it before claiming blockchain anchoring.', association };
}
