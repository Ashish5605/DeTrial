const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('node:fs'); const path = require('node:path');
const output = process.env.DT_TEST_OUTPUT || path.resolve(__dirname, '../.qa-results');
(async () => {
  const browser = await chromium.launch({ channel: process.env.DT_BROWSER_CHANNEL === 'chromium' ? undefined : (process.env.DT_BROWSER_CHANNEL || 'msedge'), headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const results = []; fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto('http://127.0.0.1:5173');
    await page.waitForLoadState('networkidle');
    for (const screen of ['landing', 'roles', 'applicant', 'verified', 'department', 'closure-dialog', 'history', 'tamper']) {
      if (screen === 'roles') await page.getByRole('button', { name: 'Experience the demo' }).click();
      if (screen === 'applicant') { await page.getByRole('button', { name: /Enter applicant view/ }).click(); await expect(page.getByRole('heading', { name: 'Bring your receipt.' })).toBeVisible(); }
      if (screen === 'verified') { await page.getByRole('button', { name: 'Import synthetic R17' }).click(); await expect(page.getByRole('heading', { name: 'Receipt verified' })).toBeVisible(); }
      if (screen === 'department') { await page.getByRole('button', { name: 'Switch to department' }).click(); await page.locator('.fixture-select select').selectOption({ index: 1 }); await expect(page.getByRole('heading', { name: 'The record is open again.' })).toBeVisible(); }
      if (screen === 'closure-dialog') await page.getByRole('button', { name: 'Attempt closure', exact: true }).click();
      if (screen === 'history') { await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await page.getByRole('button', { name: 'Audit history', exact: true }).click(); }
      if (screen === 'tamper') { await page.getByRole('button', { name: 'Receipt verifier', exact: true }).click(); await page.getByText('Explore EIP-712 signature tampering', { exact: true }).click();
    await page.getByRole('button', { name: 'Load signed receipt' }).click(); await expect(page.getByText('Signature valid', { exact: true })).toBeVisible(); }
      await page.waitForLoadState('networkidle');
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      results.push({ screen, violations: result.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })) });
    }
    await page.getByRole('button', { name: 'Audit history', exact: true }).click();
    await page.getByRole('button', { name: 'View transaction', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Transaction details' })).toContainText('Open audit');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Transaction details' })).toHaveCount(0);
    await page.route('**/api/state/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'QA unavailable-chain check.' }) }));
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Chain unavailable');
    await expect(page.getByRole('button', { name: 'Register this receipt' })).toHaveCount(0);
    console.log('PASS: unavailable-chain state is explicit; no success or registration action shown.');
    await page.unroute('**/api/state/**');
    await page.getByRole('button', { name: 'DecisionTrail home' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'mobile-layout.png'), fullPage: true });
    const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('body *')].map(e => ({ tag: e.tagName, class: e.className, right: e.getBoundingClientRect().right, left: e.getBoundingClientRect().left })).filter(e => e.right > innerWidth + 1 || e.left < -1) }));
    fs.writeFileSync(path.join(output, 'layout.json'), JSON.stringify(overflow, null, 2));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: path.join(output, 'final-preview.png') });
    fs.writeFileSync(path.join(output, 'accessibility.json'), JSON.stringify(results, null, 2));
    console.log(results.map(r => `${r.screen}: ${r.violations.length} accessibility violations`).join('\n'));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });


