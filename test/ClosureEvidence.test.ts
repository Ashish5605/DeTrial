import { expect } from 'chai';
import { Wallet, ZeroHash, encodeBytes32String, id, solidityPackedKeccak256 } from 'ethers';
import { DT_DOMAIN, DT_TYPES, ReceiptFile, verifyReceipt } from '../shared/receipt';
import { CLOSURE_SCOPE, CLOSURE_TYPES, ClosureRecord, ProofPacket, TrustAnchor, compareClosure, closureDomain, inventoryHash, verifyPacket } from '../shared/closure';

describe('Portable closure reconciliation',()=>{
  const issuer=Wallet.createRandom(), applicant=Wallet.createRandom();
  const anchor:TrustAnchor={chainId:31337,issuer:issuer.address,applicant:applicant.address,institutionId:id('institution'),serviceId:id('service'),deploymentBlock:3,deploymentBlockHash:id('deployment'),contracts:{DisputeManager:{address:Wallet.createRandom().address}}};
  const salt=id('holder salt'), holder=solidityPackedKeccak256(['address','bytes32'],[applicant.address,salt]);
  async function receipt(timestamp=1000,caseId=encodeBytes32String('R17')):Promise<ReceiptFile>{
    const value={caseId,institutionId:anchor.institutionId,serviceId:anchor.serviceId,docCommitments:[id('evidence')],policyHash:id('policy'),timestamp,logIndex:17,holderCommitment:holder};
    const domain={...DT_DOMAIN,chainId:anchor.chainId,verifyingContract:anchor.contracts.DisputeManager.address};
    return {schema:'decisiontrail/receipt-v1',synthetic:true,domain,receipt:value,holderSalt:salt,signature:await issuer.signTypedData(domain,DT_TYPES,value)};
  }
  async function record(entries:{receiptHash:string;responseHash:string}[]=[]):Promise<ClosureRecord>{
    const statement={caseId:encodeBytes32String('R17'),institutionId:anchor.institutionId,serviceId:anchor.serviceId,holderCommitment:holder,deploymentBlockHash:anchor.deploymentBlockHash,blockNumber:8,blockHash:id('block'),blockTimestamp:1100,round:0,sealTransaction:id('seal'),inventoryHash:inventoryHash(entries),receiptCount:entries.length,signedAt:1200,scope:CLOSURE_SCOPE};
    const domain=closureDomain(anchor);return {schema:'decisiontrail/closure-v1',statement,domain,inventory:entries,signature:await issuer.signTypedData(domain,CLOSURE_TYPES,statement)};
  }
  it('identifies an issuer-signed pre-closure receipt absent from the signed complete inventory',async()=>{
    const result=compareClosure(await record(),[await receipt()],anchor);expect(result.missing).to.equal(1);expect(result.rows[0].status).to.equal('MISSING');
  });
  it('recognizes a listed receipt using its full EIP-712 digest',async()=>{
    const file=await receipt();const digest=verifyReceipt(file,anchor).digest;const result=compareClosure(await record([{receiptHash:digest,responseHash:id('response')}]),[file],anchor);expect(result.missing).to.equal(0);expect(result.listed).to.equal(1);
  });
  it('does not call a receipt dated after closure an omission',async()=>{
    const result=compareClosure(await record(),[await receipt(1300)],anchor);expect(result.missing).to.equal(0);expect(result.later).to.equal(1);
  });
  it('rejects altering the declared inventory even if receipt signatures remain valid',async()=>{
    const file=await receipt();const signed=await record([{receiptHash:verifyReceipt(file,anchor).digest,responseHash:id('response')}]);signed.inventory=[];expect(()=>compareClosure(signed,[file],anchor)).to.throw('changed after signing');
  });
  it('rejects altered signed block metadata',async()=>{
    const signed=await record();signed.statement.blockHash=id('different block');const file=await receipt();expect(()=>compareClosure(signed,[file],anchor)).to.throw('signature');
  });
  it('rejects a self-signed packet whose issuer was not independently trusted',async()=>{
    const signed=await record();signed.signature=await Wallet.createRandom().signTypedData(signed.domain,CLOSURE_TYPES,signed.statement);const file=await receipt();expect(()=>compareClosure(signed,[file],anchor)).to.throw('trusted issuer');
  });
  it('rejects signed receipts from a different application',async()=>{
    const signed=await record();const file=await receipt(1000,encodeBytes32String('R18'));expect(()=>compareClosure(signed,[file],anchor)).to.throw('different applications');
  });
  it('rejects a changed deployment fingerprint even with matching contract address',async()=>{
    const signed=await record();const file=await receipt();expect(()=>compareClosure(signed,[file],{...anchor,deploymentBlockHash:id('new deployment')})).to.throw('another deployment');
  });
  it('does not count duplicate supplied receipts twice',async()=>{
    const signed=await record();const file=await receipt();expect(()=>compareClosure(signed,[file,file],anchor)).to.throw('Duplicate applicant receipt');
  });
  it('rejects duplicate inventory entries',()=>{expect(()=>inventoryHash([{receiptHash:id('a'),responseHash:ZeroHash},{receiptHash:id('a'),responseHash:ZeroHash}])).to.throw('Duplicate receipt');});
  it('rejects a tampered applicant evidence commitment',async()=>{
    const signed=await record();const file=await receipt();file.receipt.docCommitments[0]=id('changed evidence');expect(()=>compareClosure(signed,[file],anchor)).to.throw('signature');
  });
  it('recomputes packet results and ignores untrusted saved result labels',async()=>{
    const packet:any={schema:'decisiontrail/proof-packet-v1',record:await record(),receipts:[await receipt()],result:'NO GAP',verified:true};expect(verifyPacket(packet,anchor).missing).to.equal(1);
  });
  it('requires an actual receipt before making any coverage statement',async()=>{
    const signed=await record();expect(()=>compareClosure(signed,[],anchor)).to.throw('between 1 and 32');
  });
  it('binds the completeness scope into the signature',async()=>{
    const signed=await record();signed.statement.scope=id('partial registry');signed.signature=await issuer.signTypedData(signed.domain,CLOSURE_TYPES,signed.statement);const file=await receipt();expect(()=>compareClosure(signed,[file],anchor)).to.throw('completeness scope');
  });
});
