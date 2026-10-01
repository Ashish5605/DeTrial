import { Contract, JsonRpcProvider, ZeroHash } from 'ethers';
import { CLOSURE_SCOPE, CLOSURE_TYPES, ClosureRecord, closureDomain, inventoryHash, trustAnchor, verifyClosure } from '../../../shared/closure';

export async function readClosureSnapshot(config: any, rpc: JsonRpcProvider, caseId: string, snapshotBlock?: number) {
  const manager = new Contract(config.contracts.DisputeManager.address, config.contracts.DisputeManager.abi, rpc);
  const latest = await rpc.getBlock('latest');
  if (!latest || Number((await rpc.getNetwork()).chainId) !== config.chainId) throw new Error('The configured chain is unavailable.');
  const deployment = await rpc.getBlock(config.deploymentBlock);
  if (deployment?.hash !== config.deploymentBlockHash) throw new Error('The deployment changed. Refresh the application before signing a record.');
  const upper = snapshotBlock ?? latest.number;
  const seals = await manager.queryFilter(manager.filters.RoundSealed(caseId),config.deploymentBlock,upper);
  const seal: any = seals.at(-1);
  if (!seal || (snapshotBlock !== undefined && seal.blockNumber !== snapshotBlock)) throw Object.assign(new Error('No confirmed seal exists at the requested snapshot. Seal an eligible audit first.'), { code: 'PROOF_MISMATCH' });
  const [block, c, registrations, mined] = await Promise.all([
    rpc.getBlock(seal.blockNumber), manager.cases(caseId, { blockTag: seal.blockNumber }),
    manager.queryFilter(manager.filters.ReceiptRegistered(caseId),config.deploymentBlock,seal.blockNumber), rpc.getTransactionReceipt(seal.transactionHash),
  ]);
  if (!block?.hash || mined?.status !== 1 || Number(c.state) !== 2 || Number(c.outstandingObligations) !== 0) throw Object.assign(new Error('The referenced block does not end with a confirmed sealed audit.'), { code: 'PROOF_MISMATCH' });
  const inventory = await Promise.all(registrations.map(async (event: any) => ({ receiptHash: event.args.receiptHash as string, responseHash: await manager.dispositions(event.args.receiptHash,{ blockTag: block.number }) as string })));
  if (inventory.some(i => i.responseHash === ZeroHash)) throw new Error('The sealed inventory contains an unresolved receipt. Refusing to sign an inconsistent record.');
  const statement = { caseId, institutionId: c.institutionId, serviceId: c.serviceId, holderCommitment: c.holderCommitment, deploymentBlockHash: config.deploymentBlockHash,
    blockNumber: block.number, blockHash: block.hash, blockTimestamp: block.timestamp, round: c.round.toString(), sealTransaction: seal.transactionHash,
    inventoryHash: inventoryHash(inventory), receiptCount: inventory.length, signedAt: Math.max(latest.timestamp,Math.floor(Date.now()/1000)), scope: CLOSURE_SCOPE };
  return { schema: 'decisiontrail/closure-v1' as const, domain: closureDomain(trustAnchor(config)), statement, inventory };
}
export async function signClosureRecord(config: any, rpc: JsonRpcProvider, caseId: string, progress: (value: string) => void): Promise<ClosureRecord> {
  progress('Reading the sealed registry and every registered receipt...');
  const record = await readClosureSnapshot(config,rpc,caseId);
  progress('Requesting the local department signature...');
  const signature = await (await rpc.getSigner(config.department)).signTypedData(record.domain,CLOSURE_TYPES,record.statement);
  const signed = { ...record, signature };
  verifyClosure(signed,trustAnchor(config)); return signed;
}
export async function checkClosureOnChain(record: ClosureRecord, config: any, rpc: JsonRpcProvider) {
  verifyClosure(record,trustAnchor(config));
  const actual = await readClosureSnapshot(config,rpc,record.statement.caseId,Number(record.statement.blockNumber));
  for (const key of Object.keys(actual.statement).filter(k => k !== 'signedAt')) {
    if (String((actual.statement as any)[key]).toLowerCase() !== String(record.statement[key]).toLowerCase()) throw Object.assign(new Error('Signed closure statement disagrees with the live chain: '+key), { code: 'PROOF_MISMATCH' });
  }
  const registry = new Contract(config.contracts.KeyRegistry.address,config.contracts.KeyRegistry.abi,rpc);
  if (!await registry.isKeyValidAt(config.institutionId,config.issuer,record.statement.signedAt)) throw Object.assign(new Error('The closure signer was not valid at its stated signing time.'), { code: 'PROOF_MISMATCH' });
  return { block: Number(record.statement.blockNumber), transaction: record.statement.sealTransaction };
}
