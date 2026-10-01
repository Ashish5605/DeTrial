const { chromium, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.DT_TEST_URL || 'http://127.0.0.1:5174';
const output = process.env.DT_TEST_OUTPUT || path.resolve(__dirname, '../.qa-results');
const hash = bytes => '0x' + createHash('sha256').update(bytes).digest('hex');
const mime = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json' };

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.DT_BROWSER_CHANNEL === 'chromium' ? undefined : process.env.DT_BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], evidence = [], accessibility = [];
  page.on('pageerror', e => errors.push(e.message));
  const input = () => page.getByLabel('Choose receipt or evidence file');
  const result = () => page.getByTestId('file-verification');
  async function scan(screen) { const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); accessibility.push({ screen, violations: r.violations }); }
  async function drop(file) {
    const handle = await page.evaluateHandle(({ name, type, encoded }) => { const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], name, { type })); return dt; }, { name: file.name, type: file.mimeType, encoded: file.buffer.toString('base64') });
    await page.locator('.drop-zone').dispatchEvent('dragover', { dataTransfer: handle });
    await expect(page.locator('.drop-zone')).toHaveClass(/dragging/);
    const prevented = await page.locator('.drop-zone').evaluate((el, transfer) => { const e = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }); el.dispatchEvent(e); return e.defaultPrevented; }, handle);
    if (!prevented) throw new Error('Drop did not prevent browser navigation.');
    await handle.dispose();
  }
  async function verifySuccess(file, method = 'picker') {
    if (method === 'drop') await drop(file); else await input().setInputFiles(file);
    await expect(result()).toContainText('ANCHORED', { timeout: 30000 });
    await expect(result()).toContainText('MATCHED');
    await expect(result().getByRole('heading', { name: 'Verified', exact: true })).toBeVisible();
    await expect(page.locator('.file-fingerprint')).toContainText(hash(file.buffer));
    await expect(page.locator('.selected-artifact')).toContainText(file.name);
    const data = { file: file.name, method, sha256: hash(file.buffer), result: await result().innerText() };
    evidence.push(data);
  }
  try {
    await page.goto(`${base}/#/applicant`);
    await expect(page.getByRole('heading', { name: 'Bring your receipt.' })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Receipt verifier', exact: true }).click();
    const config = await (await page.request.get(`${base}/api/config`)).json();
    const record = config.cases.find(c => c.scenario === 'D');
    if (!record) throw new Error('No real multi-format fixture was deployed.');
    const receipt = await (await page.request.get(`${base}/api/receipt/${record.caseId}`)).json();
    const stateBefore = await (await page.request.get(`${base}/api/state/${record.caseId}`)).json();
    const registration = stateBefore.history.find(e => e.name === 'ReceiptRegistered');
    if (!registration || !stateBefore.registered) throw new Error('Fixture is not actually registered.');
    const files = ['pdf', 'png', 'jpg', 'jpeg'].map(ext => ({ name: `sample-evidence.${ext}`, mimeType: mime[ext], buffer: fs.readFileSync(path.resolve(__dirname, `../fixtures/documents/sample-evidence.${ext}`)) }));
    files.push({ name: 'R20.json', mimeType: mime.json, buffer: Buffer.from(JSON.stringify(receipt, null, 2)) });
    // The browser's actual native picker is connected to an input accepting every requested format.
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('.drop-zone').click();
    const chooser = await chooserPromise;
    const accept = await input().getAttribute('accept');
    for (const ext of ['pdf','png','jpg','jpeg','json']) if (!accept.includes('.' + ext)) throw new Error('Picker is missing ' + ext);
    await chooser.setFiles(files[0]);
    await expect(result()).toContainText('ANCHORED', { timeout: 30000 });
    for (const file of files) {
      await verifySuccess(file);
      await expect(result()).toContainText(registration.hash);
      await expect(result()).toContainText(String(registration.blockNumber));
      const ext = file.name.split('.').pop();
      if (ext === 'pdf') {
        await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
        await expect.poll(() => page.locator('.artifact-preview canvas').evaluate(c => c.width > 0 && c.height > 0 && c.getContext('2d').getImageData(10, 10, 1, 1).data[3] > 0)).toBeTruthy();
      } else if (ext === 'json') {
        await expect(page.locator('.artifact-preview pre')).toContainText(receipt.signature);
        await expect(result()).toContainText('EIP-712');
      } else await expect.poll(() => page.locator('.artifact-preview img').evaluate(img => img.complete && img.naturalWidth > 0)).toBeTruthy();
      await page.screenshot({ path: path.join(output, `format-${ext}.png`), fullPage: true });
      if (['pdf','png','json'].includes(ext)) await scan(ext);
      // Each format must also survive a real drag/drop path without opening another tab.
      await verifySuccess(file, 'drop');
      if (context.pages().length !== 1) throw new Error('Dropping a file opened another tab.');
      await page.getByText('QR verification record', { exact: true }).click();
      const link = await page.getByRole('link', { name: 'Open verification record' }).getAttribute('href');
      if (!link.includes(record.caseId) || !link.includes(hash(file.buffer))) throw new Error('QR record does not identify the actual case/hash.');
      await expect(page.getByAltText('QR code linking to this application verification record')).toBeVisible();
      await page.goto(link);
      await expect(page.getByText('Verification record selected', { exact: true })).toBeVisible();
      await expect(result()).toHaveCount(0); // A QR link must never verify a file by itself.
      await verifySuccess(file);
      await page.setViewportSize({ width: 390, height: 844 });
      if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error('Mobile file verification overflows for ' + ext);
      if (ext === 'pdf') await page.screenshot({ path: path.join(output, 'file-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(`${base}/#/applicant`);
      await page.getByRole('button', { name: 'Receipt verifier', exact: true }).click();
    }
    // Pretty-printing JSON changes its raw fingerprint but retains the signed EIP-712 commitment.
    await verifySuccess({ ...files[4], name: 'compact.json', buffer: Buffer.from(JSON.stringify(receipt)) });
    if (hash(files[4].buffer) === hash(Buffer.from(JSON.stringify(receipt)))) throw new Error('JSON serialization test did not change bytes.');
    for (const file of [files[0], files[1], files[2]]) {
      const changed = { ...file, name: 'changed-' + file.name, buffer: Buffer.concat([file.buffer, Buffer.from('\n% Changed after acknowledgement\n')]) };
      await input().setInputFiles(changed);
      await expect(result()).toContainText('Verification failed');
      await expect(result()).toContainText('NOT MATCHED');
      await expect(page.locator('.file-fingerprint')).toContainText(hash(changed.buffer));
      await expect(page.getByRole('button', { name: 'Register this receipt' })).toHaveCount(0);
      evidence.push({ file: changed.name, sha256: hash(changed.buffer), rejected: true });
    }
    const invalids = [
      [{ name: 'script.html', mimeType: 'text/html', buffer: Buffer.from('<html>') }, 'Unsupported file type'],
      [{ name: 'wrong.pdf', mimeType: 'image/png', buffer: files[0].buffer }, 'extension and MIME type do not match'],
      [{ name: 'fake.pdf', mimeType: mime.pdf, buffer: Buffer.from('not a PDF') }, 'content does not match'],
      [{ name: 'large.pdf', mimeType: mime.pdf, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, 'Maximum size is 10 MB'],
      [{ name: 'large.json', mimeType: mime.json, buffer: Buffer.alloc(128 * 1024 + 1) }, 'JSON receipt exceeds the 128 KB limit'],
      [{ name: 'empty.png', mimeType: mime.png, buffer: Buffer.alloc(0) }, 'selected file is empty'],
      [{ name: 'bad.json', mimeType: mime.json, buffer: Buffer.from('{invalid') }, 'Invalid receipt JSON'],
    ];
    for (const [file, reason] of invalids) { await input().setInputFiles(file); await expect(page.getByRole('alert')).toContainText(reason); await expect(result()).toHaveCount(0); }
    const altered = structuredClone(receipt); altered.receipt.docCommitments[0] = '0x' + '1'.repeat(64);
    await input().setInputFiles({ ...files[4], buffer: Buffer.from(JSON.stringify(altered)) });
    await expect(page.getByRole('alert')).toContainText('signature');
    await page.route('**/api/resolve?**', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Chain record unavailable. Retry.' }) }));
    await input().setInputFiles(files[0]);
    await expect(page.getByRole('alert')).toContainText('unavailable'); await expect(result()).toHaveCount(0);
    await page.unroute('**/api/resolve?**');
    await page.goto(`${base}/#/verify/${record.caseId}?sha256=${hash(files[0].buffer)}&deployment=${config.deploymentBlockHash}`);
    await input().setInputFiles(files[1]); await expect(result()).toContainText('Verification failed');
    await page.goto(`${base}/#/verify/${record.caseId}?deployment=wrong-deployment`);
    await input().setInputFiles(files[0]); await expect(page.getByRole('alert')).toContainText('another deployment');
    // A previously unseen real binary cannot become verified until acknowledgement + real registration.
    await page.goto(`${base}/#/applicant`);
    const newFile = { ...files[0], name: 'additional-evidence.pdf', buffer: Buffer.concat([files[0].buffer, Buffer.from('\n% Separate QA application evidence\n')]) };
    await input().setInputFiles(newFile); await expect(result()).toContainText('Verification failed');
    await page.getByText('Need a local demo acknowledgement?', { exact: true }).click();
    await page.getByRole('button', { name: 'Request local demo acknowledgement', exact: true }).click();
    await expect(page.locator('.submission-note')).toContainText('Saved off-chain');
    const inbox = await (await page.request.get(`${base}/api/submissions`)).json();
    const submitted = inbox.find(i => i.sha256 === hash(newFile.buffer));
    if (!submitted || submitted.status !== 'PENDING') throw new Error('Upload was falsely acknowledged.');
    const stored = await (await page.request.get(`${base}/api/evidence/${submitted.id}`)).body();
    if (hash(stored) !== hash(newFile.buffer)) throw new Error('Off-chain stored bytes changed.');
    await page.getByRole('button', { name: 'Switch to department' }).click();
    await page.getByRole('button', { name: 'Review file', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Acknowledge file', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Acknowledge file', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Acknowledge file', exact: true })).toHaveCount(0, { timeout: 30000 });
    await page.getByRole('button', { name: 'Switch to applicant' }).click();
    await page.locator('.fixture-select select').selectOption(submitted.caseId);
    await input().setInputFiles(newFile);
    await expect(result()).toContainText('Signature valid · not registered');
    await expect(result()).toContainText('NOT ANCHORED');
    await page.getByRole('button', { name: 'Register this receipt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Receipt registered', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Return to audit' }).click();
    await expect(result()).toContainText('ANCHORED', { timeout: 30000 });
    const newState = await (await page.request.get(`${base}/api/state/${submitted.caseId}`)).json();
    if (newState.outstanding !== 1 || !newState.registered) throw new Error('Uploaded evidence was not registered in the real contract.');
    const signed = await (await page.request.get(`${base}/api/receipt/${submitted.caseId}`)).json();
    if (signed.receipt.docCommitments[0] !== hash(newFile.buffer)) throw new Error('Signed bytes do not match uploaded bytes.');
    evidence.push({ flow: 'off-chain upload → explicit acknowledgement → applicant registration', state: newState, hash: hash(newFile.buffer) });
    await scan('new-evidence-registered');
    // Reusing the existing state machine: disposition → checkpoint → seal a new evidence case.
    await page.getByRole('button', { name: 'Switch to department' }).click();
    await page.getByRole('button', { name: `Account for ${newState.label}`, exact: true }).click();
    await page.getByRole('button', { name: 'Record disposition', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Disposition recorded', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Return to audit' }).click();
    await page.getByRole('button', { name: 'Append checkpoint', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Checkpoint appended', exact: true })).toBeVisible({ timeout: 30000 });
    await page.getByRole('button', { name: 'Return to audit' }).click();
    await page.getByRole('button', { name: 'Seal audit', exact: true }).click();
    await page.getByRole('dialog', { name: 'Seal audit' }).getByRole('button', { name: 'Seal audit', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Audit sealed', exact: true })).toBeVisible({ timeout: 30000 });
    if (errors.length) throw new Error(errors.join('\n'));
    fs.writeFileSync(path.join(output, 'format-verification-evidence.json'), JSON.stringify(evidence, null, 2));
    fs.writeFileSync(path.join(output, 'format-accessibility.json'), JSON.stringify(accessibility, null, 2));
    const violations = accessibility.flatMap(r => r.violations.map(v => `${r.screen}: ${v.id} ${v.nodes.map(n => n.target.join(',')).join(';')}`));
    if (violations.length) throw new Error('Accessibility violations: ' + violations.join('\n'));
    console.log('PASS: PDF, PNG, JPG, JPEG and JSON: native picker, drag/drop, actual SHA-256, previews, signed commitment + mined transaction, QR record routes, tamper rejection, MIME/size limits, offline errors, mobile layouts, accessibility, and new evidence acknowledgement/registration/disposition/checkpoint/seal.');
  } catch (e) { await page.screenshot({ path: path.join(output, 'formats-failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(output, 'format-partial-evidence.json'), JSON.stringify({ evidence, accessibility, errors }, null, 2)); throw e; }
  finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
