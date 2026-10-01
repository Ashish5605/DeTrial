/** The local runner and this entry point share the same idempotent deployment path. */
import { initialize, provider, publicConfig } from '../server/chain';
initialize().then(() => { console.log('DecisionTrail deployment ready:', publicConfig().contracts.DisputeManager.address); provider.destroy(); }).catch(error => { console.error(error); process.exitCode = 1; provider.destroy(); });
