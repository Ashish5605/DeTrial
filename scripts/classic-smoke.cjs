const {chromium,expect}=require('@playwright/test');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const close=async()=>{const drawer=page.getByRole('dialog',{name:'Transaction details'});await expect(drawer).toBeVisible({timeout:10000});await drawer.getByRole('button',{name:'Close dialog'}).click();await expect(drawer).toHaveCount(0);};
 try{
  await page.goto('http://127.0.0.1:5176');await expect(page.getByRole('heading',{name:/When your evidence matters/})).toBeVisible();
  await page.getByRole('button',{name:/Experience the demo/i}).click();await expect(page.getByRole('heading',{name:/Choose your perspective/})).toBeVisible();
  await page.getByRole('button',{name:/Enter applicant view/}).click();await page.getByRole('button',{name:/Verify issued receipt R17/}).click();
  if(await page.getByRole('button',{name:/Register this receipt/}).count()){await page.getByRole('button',{name:/Register this receipt/}).click();await expect(page.getByText(/Receipt registered. The sealed record has reopened/)).toBeVisible({timeout:30000});await close();}else await expect(page.getByText('REGISTERED ON-CHAIN')).toBeVisible();
  await page.getByRole('button',{name:/Switch to department/}).click();await expect(page.getByRole('heading',{name:/The record is open again|The audit is sealed/})).toBeVisible();
  const cfg=await (await page.request.get('http://127.0.0.1:5176/api/config')).json();
  const before=await (await page.request.get('http://127.0.0.1:5176/api/state/'+cfg.cases[0].caseId)).json();
  if(before.outstanding){
  await page.getByRole('button',{name:'Attempt closure',exact:true}).click();await page.getByRole('dialog',{name:'Seal audit'}).getByRole('button',{name:'Attempt closure',exact:true}).click();
  await expect(page.getByText(/Closure blocked. The registered evidence/)).toBeVisible({timeout:30000});await close();
  await page.getByRole('button',{name:/Account for R17/}).click();await page.getByRole('dialog',{name:/Account for receipt/}).getByRole('button',{name:/Record disposition/}).click();await expect(page.getByText(/Disposition recorded. The next step/)).toBeVisible({timeout:30000});await close();
  await page.getByRole('button',{name:/Append checkpoint/}).click();await expect(page.getByText('Checkpoint appended. The audit can be sealed.',{exact:true})).toBeVisible({timeout:30000});await close();
  await page.getByRole('button',{name:'Seal audit',exact:true}).click();await page.getByRole('dialog',{name:'Seal audit'}).getByRole('button',{name:'Seal audit',exact:true}).click();await expect(page.getByText(/Audit sealed. Earlier events remain/)).toBeVisible({timeout:30000});await close();
  }else if(before.state!=='SEALED')throw new Error('The case has an unexpected state: '+before.state);
  await page.getByRole('button',{name:'Audit history'}).click();await expect(page.getByText('Closure blocked',{exact:true}).first()).toBeVisible();await page.screenshot({path:path.join(__dirname,'../classic-verified.png'),fullPage:true});
  if(errors.length)throw new Error(errors.join('; '));console.log('Classic end-to-end flow passed: signed receipt, reopen, real blocked closure, disposition, checkpoint, seal, retained history.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

