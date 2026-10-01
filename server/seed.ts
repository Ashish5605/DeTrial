import { initialize, provider } from './chain';
initialize().then(() => { console.log('Fixtures ready. Existing deployment and case state preserved.'); provider.destroy(); }).catch(e => { console.error(e.message); process.exit(1); });
