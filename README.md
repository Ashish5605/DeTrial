# DecisionTrail Classic

**Your evidence. Your receipt. Your trail.**

This is the earlier role-selection demonstration, reconstructed from its retained landing page, verifier, contract code and workflow components. The exact source snapshot from two revisions earlier was not saved, so this is a functional restoration of that experience rather than a byte-for-byte rollback.

## Run

Install Node.js 22 or 24. Extract the ZIP and double-click `RUN-DECISIONTRAIL.cmd`, or run:

```sh
npm ci
npm start
```

Open **http://localhost:5176**. The launcher compiles the contracts and starts a separate local Hardhat chain at `127.0.0.1:9655`, API at `127.0.0.1:3004`, and browser UI at `127.0.0.1:5176`. This version does not use the newer account setup or its `.secure` database. It does not alter the current DecisionTrail instance at port 5173.

The first launch generates synthetic fixtures for the new chain. Keep the command window open. Source changes require `npm run build` to refresh the distributable production assets; `npm start` serves the source through Vite. The launcher never resets an existing matching classic deployment.

## Earlier demo flow

1. Select **Experience the demo → Applicant**.
2. In Case R17, click **Verify issued receipt R17**, or import its signed JSON file. A changed signed field is rejected.
3. Click **Register this receipt**. The contract records the applicant transaction, reopens the sealed case and creates an outstanding obligation.
4. **Switch to department → Audit control → Attempt closure**. The contract mines and reverts this transaction. Its hash, block and gas are visible.
5. **Account for R17** with a reason, **Append checkpoint**, then **Seal audit**.
6. Open **Audit history** and **Evidence check** to inspect retained events and signed closure inventories. The offline verifier exports a deployment-pinned copy.

R18 starts reopened, R19 starts resolved and resealed, and R20 holds real sample PDF/PNG/JPG/JPEG commitments. These are synthetic cases. Case state comes from the running contract.

## Scope

This classic build intentionally has no login or account isolation. The local Hardhat node uses unlocked synthetic signers and must stay on this computer. It is a demonstration, not an externally hosted government or production service. Private evidence files are stored locally and off-chain. Receipt signatures and transaction results are real for this local deployment; they do not certify an external government issuer.

The runnable archive excludes `node_modules`, generated chain data, account files and private stores. The separate newer account-based build remains available in its own folder.

## Validation

`npm run typecheck`, `npm run build`, and all 38 contract/cryptographic tests passed. The browser flow completed actual receipt registration, a reverted closure, disposition, checkpoint, reclosure and an accumulated timeline on the isolated classic chain. `npm run test:browser` checks the restored browser flow at port 5176; on an already completed chain it confirms the retained history.
