# Classic restoration validation

- TypeScript server and frontend: passed.
- Release frontend and offline verifier build: passed.
- Contract and cryptographic tests: 38 passed.
- Browser: landing, role selection, signed receipt verification, real applicant registration, audit reopening, reverted closure, disposition, checkpoint, reclosure, retained event history: passed on isolated Hardhat 9655.
- The current authenticated DecisionTrail at port 5173 and its primary chain were not reset.

The exact two-revision source snapshot was unavailable. This version reconstructs the earlier role-selection user flow using retained components and original contracts. It is a synthetic-data local demo and intentionally has no login.
