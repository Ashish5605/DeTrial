const {chromium,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const fs=require('node:fs'),path=require('node:path');
const {pathToFileURL}=require('node:url');
require('ts-node/register/transpile-only');
const {JsonRpcProvider,TypedDataEncoder,id}=require('ethers');
const {CLOSURE_TYPES,inventoryHash}=require('../shared/closure');
const {DT_TYPES}=require('../shared/receipt');
const base=process.env.DT_TEST_URL||'http://127.0.0.1:5174';
const output=process.env.DT_TEST_OUTPUT||path.resolve(__dirname,'../.qa-results');
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({channel:process.env.DT_BROWSER_CHANNEL==='chromium'?undefined:process.env.DT_BROWSER_CHANNEL||'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',acceptDownloads:true});
  const page=await context.newPage(),errors=[],scans=[];page.on('pageerror',e=>errors.push(e.message));
  async function scan(label,target=page){const r=await new AxeBuilder({page:target}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();scans.push({label,violations:r.violations});}
  async function download(name,filename){const promise=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const result=await promise;const saved=path.join(output,filename);await result.saveAs(saved);return saved;}
  try{
    await page.goto(base+'/#/department');
    await page.getByRole('button',{name:'Evidence check',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Closed. But was your receipt included?'})).toBeVisible({timeout:30000});
    await scan('empty-reconciliation');
    const config=await(await page.request.get(base+'/api/config')).json();
    const before=await(await page.request.get(base+'/api/state/'+config.cases[0].caseId)).json();
    await page.getByRole('button',{name:'Create signed closure record',exact:true}).click();
    await expect(page.getByText('Signed snapshot matches the live chain',{exact:true})).toBeVisible({timeout:30000});
    await download('Download closure record','R17-closure.json');
    await page.getByRole('button',{name:'Switch to applicant',exact:true}).click();
    await page.getByRole('button',{name:'Evidence check',exact:true}).click();
    await page.getByRole('button',{name:'Use demo receipt R17',exact:true}).click();
    await expect(page.getByTestId('reconciliation-result')).toContainText('1 acknowledged receipt is missing.');
    await expect(page.getByTestId('reconciliation-result')).toContainText('Not registered');
    await expect(page.getByRole('button',{name:'Bring to registration',exact:true})).toBeVisible();
    await scan('confirmed-gap');
    const packetPath=await download('Download proof packet','R17-proof.json');
    const verifierPath=await download('Download offline verifier','DecisionTrail-offline-verifier.html');
    await download('Download factual report','R17-reconciliation.txt');
    const packet=JSON.parse(fs.readFileSync(packetPath,'utf8'));
    if(packet.record.inventory.length!==0||packet.receipts.length!==1)throw new Error('The signed packet does not capture the omitted receipt.');
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,'evidence-gap-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Evidence check overflows on mobile.');
    await page.screenshot({path:path.join(output,'evidence-gap-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    // Direct receipt handoff connects the comparison to the existing real registration flow.
    await page.getByRole('button',{name:'Bring to registration',exact:true}).click();
    await expect(page.getByRole('button',{name:'Register this receipt',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Evidence check',exact:true}).click();
    await page.getByLabel('Import portable proof packet').setInputFiles(packetPath);
    await expect(page.getByTestId('reconciliation-result')).toContainText('1 acknowledged receipt is missing.');
    const provider=new JsonRpcProvider(base+'/rpc');
    const contradiction=structuredClone(packet);
    contradiction.record.inventory=[{receiptHash:TypedDataEncoder.hash(packet.receipts[0].domain,DT_TYPES,packet.receipts[0].receipt),responseHash:id('fabricated response')}];
    contradiction.record.statement.inventoryHash=inventoryHash(contradiction.record.inventory);
    contradiction.record.statement.receiptCount=1;
    contradiction.record.signature=await(await provider.getSigner(config.department)).signTypedData(contradiction.record.domain,CLOSURE_TYPES,contradiction.record.statement);
    provider.destroy();
    await page.getByLabel('Import portable proof packet').setInputFiles({name:'signed-but-false.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(contradiction))});
    await expect(page.getByText('Signed snapshot conflicts with the live chain',{exact:true})).toBeVisible({timeout:30000});
    await expect(page.getByRole('button',{name:'Bring to registration',exact:true})).toHaveCount(0);
    const badPacket=structuredClone(packet);badPacket.record.statement.blockHash='0x'+'f'.repeat(64);
    await page.getByLabel('Import portable proof packet').setInputFiles({name:'tampered-packet.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(badPacket))});
    await expect(page.getByRole('alert')).toContainText('signature');
    await expect(page.getByTestId('reconciliation-result')).toHaveCount(0);
    await page.getByLabel('Import portable proof packet').setInputFiles(packetPath);
    // While the live RPC is unavailable, only the signed comparison may remain valid.
    await page.route('**/rpc',r=>r.fulfill({status:503,body:'unavailable'}));
    await page.getByLabel('Import signed closure record').setInputFiles(path.join(output,'R17-closure.json'));
    await page.getByRole('button',{name:'Use your imported receipt',exact:true}).click();
    await expect(page.getByText('Live chain check unavailable',{exact:true})).toBeVisible({timeout:30000});
    await expect(page.getByTestId('reconciliation-result')).toContainText('Current registry');
    await expect(page.getByTestId('reconciliation-result')).toContainText('Not checked');
    await expect(page.getByRole('button',{name:'Bring to registration',exact:true})).toHaveCount(0);
    await page.unroute('**/rpc');
    const after=await(await page.request.get(base+'/api/state/'+config.cases[0].caseId)).json();
    if(after.latestBlock!==before.latestBlock||after.registered!==before.registered)throw new Error('Signing/exporting the record changed chain state.');
    // A separate browser context opens the downloaded HTML with networking disabled.
    const offlineContext=await browser.newContext({viewport:{width:1280,height:1000},offline:true,acceptDownloads:true});
    const offline=await offlineContext.newPage(),requests=[];offline.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});offline.on('pageerror',e=>errors.push(e.message));
    await offline.goto(pathToFileURL(verifierPath).href);
    await offline.locator('#packet').setInputFiles(packetPath);
    await expect(offline.getByRole('button',{name:'Verify offline',exact:true})).toBeDisabled();
    await offline.getByRole('checkbox').check();
    await offline.getByRole('button',{name:'Verify offline',exact:true}).click();
    await expect(offline.locator('#result-title')).toContainText('1 acknowledged receipt missing');
    await expect(offline.locator('#status')).toContainText('No network request was made');
    await scan('standalone-offline-proof',offline);
    await offline.screenshot({path:path.join(output,'offline-proof.png'),fullPage:true});
    for(const mutate of [p=>p.record.statement.blockHash='0x'+'f'.repeat(64),p=>p.receipts[0].receipt.docCommitments[0]='0x'+'e'.repeat(64),p=>p.record.inventory.push({receiptHash:'0x'+'1'.repeat(64),responseHash:'0x'+'2'.repeat(64)})]){
      const bad=structuredClone(packet);mutate(bad);await offline.locator('#packet').setInputFiles({name:'tampered-proof.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bad))});await offline.getByRole('button',{name:'Verify offline',exact:true}).click();await expect(offline.locator('#status')).toContainText('Verification failed');await expect(offline.locator('#result')).toBeHidden();
    }
    if(requests.length)throw new Error('The offline verifier made network requests: '+requests.join(','));
    await offlineContext.close();
    fs.writeFileSync(path.join(output,'closure-accessibility.json'),JSON.stringify(scans,null,2));
    if(scans.some(s=>s.violations.length))throw new Error('Accessibility violations: '+scans.filter(s=>s.violations.length).map(s=>s.label+': '+s.violations.map(v=>v.id).join(',')).join('; '));
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('PASS: signed closure record, real-chain reconciliation, omitted receipt detection, registration handoff, portable export, network-disabled standalone verification, tamper rejection, 390/1440 layouts, accessibility. No chain mutation.');
  }catch(e){await page.screenshot({path:path.join(output,'closure-failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'closure-partial-scans.json'),JSON.stringify({scans,errors},null,2));throw e;}
  finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
