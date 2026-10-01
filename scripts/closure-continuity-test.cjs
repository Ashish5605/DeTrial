const {chromium,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const base=process.env.DT_TEST_URL||'http://127.0.0.1:5174',output=process.env.DT_TEST_OUTPUT||path.resolve(__dirname,'../.qa-results');
(async()=>{
  const browser=await chromium.launch({channel:process.env.DT_BROWSER_CHANNEL==='chromium'?undefined:process.env.DT_BROWSER_CHANNEL||'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  try{
    await page.goto(base+'/#/department');await page.getByRole('button',{name:'Evidence check',exact:true}).click();
    await page.getByLabel('Import portable proof packet').setInputFiles(path.join(output,'R17-proof.json'));
    await expect(page.getByTestId('reconciliation-result')).toContainText('1 acknowledged receipt is missing.');
    await expect(page.getByTestId('reconciliation-result')).toContainText('Disposition recorded');
    await expect(page.getByText('Signed snapshot matches the live chain',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Create signed closure record',exact:true}).click();
    await expect(page.getByTestId('reconciliation-result')).toContainText('No gap among the supplied receipts.');
    await expect(page.getByTestId('reconciliation-result')).toContainText('LISTED');
    const options=page.getByLabel('Retained signed snapshots').locator('option');await expect(options).toHaveCount(2);
    await page.getByLabel('Retained signed snapshots').selectOption({index:0});
    await expect(page.getByTestId('reconciliation-result')).toContainText('1 acknowledged receipt is missing.');
    await expect(page.getByTestId('reconciliation-result')).toContainText('Disposition recorded');
    await page.reload();await page.getByRole('button',{name:'Evidence check',exact:true}).click();
    await expect(page.getByLabel('Retained signed snapshots').locator('option')).toHaveCount(2);
    await page.screenshot({path:path.join(output,'retained-closure-history.png'),fullPage:true});
    console.log('PASS: earlier omission survives registration and reseal; a new signed closure lists the receipt; both signed snapshots survive reload.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
