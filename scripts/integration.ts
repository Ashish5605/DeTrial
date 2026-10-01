import { Contract, JsonRpcProvider, TypedDataEncoder, ZeroHash, encodeBytes32String } from 'ethers';
import assert from 'node:assert/strict';
import { DT_TYPES, STATES, verifyReceipt } from '../shared/receipt';
async function main() {
  const base = 'http://127.0.0.1:3001/api';
  const config = await (await fetch(`${base}/config`)).json() as any;
  const rpc = new JsonRpcProvider('http://127.0.0.1:8545');
  try {
    const manager = new Contract(config.contracts.DisputeManager.address, config.contracts.DisputeManager.abi, rpc);
    const anchor = new Contract(config.contracts.CheckpointAnchor.address, config.contracts.CheckpointAnchor.abi, rpc);
    for (const fixture of config.cases) {
      const file = await (await fetch(`${base}/receipt/${fixture.caseId}`)).json() as any;
      const checked = verifyReceipt(file, config);
      assert.equal(checked.digest, await manager.receiptDigest(file.receipt));
      assert.equal(TypedDataEncoder.hash(file.domain, DT_TYPES, file.receipt), checked.digest);
      assert.throws(() => verifyReceipt({ ...file, receipt: { ...file.receipt, caseId: encodeBytes32String('TAMPERED') } }, config));
      const state = await (await fetch(`${base}/state/${fixture.caseId}`)).json() as any;
      const onchain = await manager.cases(fixture.caseId);
      assert.equal(state.state, STATES[Number(onchain.state)]);
      assert.equal(state.outstanding, Number(onchain.outstandingObligations));
      if (state.checkpoint) assert.equal(await anchor.isRootAnchored(config.institutionId, state.checkpoint.treeSize, state.checkpoint.rootHash), true);
      for (const event of state.history) {
        const receipt = await rpc.getTransactionReceipt(event.hash);
        assert.equal(receipt!.blockNumber, event.blockNumber);
        assert.equal(receipt!.status, event.status === 'CONFIRMED' ? 1 : 0);
      }
      console.log(`PASS ${fixture.label}: ${state.state}, ${state.outstanding} obligations, ${state.history.length} verified chain records`);
    }
    console.log('PASS: API state, signatures, tamper detection, checkpoint anchoring and transaction receipts agree with the deployed contracts. No primary-chain state was changed.');
  } finally { rpc.destroy(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
