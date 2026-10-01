const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
async function available(url) { return new Promise(resolve => { const req = require('node:http').get(url, res => { res.resume(); res.on('end', () => resolve(res.statusCode === 200)); }); req.setTimeout(2000, () => { req.destroy(); resolve(false); }); req.on('error', () => resolve(false)); }); }
(async () => {
  if (await available('http://127.0.0.1:5174')) throw new Error('QA server already running on 5174. Stop that QA session before starting a fresh browser test.');
  process.env.DT_TEST_RUN='run-'+Date.now();
  const logPath = path.join(process.env.DT_TEST_OUTPUT || path.join(root, '.qa-results'), 'qa-runner.log'); fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.openSync(logPath, 'w');
  const child = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'server/launch.ts'], { cwd: root, env: { ...process.env, DT_PROFILE: 'qa' }, stdio: ['ignore', log, log], windowsHide: true });
  try {
    let ready = false;
    for (let i = 0; i < 90; i++) {
      if (child.exitCode !== null) throw new Error('QA launcher stopped: ' + fs.readFileSync(logPath, 'utf8'));
      if (await available('http://127.0.0.1:5174/api/session')) { ready = true; break; }
      await new Promise(r => setTimeout(r, 600));
    }
    if (!ready) throw new Error('QA deployment did not become ready. See ' + logPath);
    for (const script of ['scripts/secure-browser-test.cjs']) {
      const status = await new Promise((resolve, reject) => { const t = spawn(process.execPath, [script], { cwd: root, stdio: 'inherit', windowsHide: true }); t.on('error', reject); t.on('exit', resolve); });
      if (status !== 0) { process.exitCode = 1; break; }
    }
  } finally {
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {} }
    else child.kill('SIGTERM');
    fs.closeSync(log);
  }
})().catch(e => { console.error(e.message); process.exitCode = 1; });

