const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '..');
(async()=>{
  const bundle = await build({ entryPoints:[path.join(root,'offline/verifier.ts')], bundle:true, minify:true, format:'iife', platform:'browser', target:['es2022'], write:false, legalComments:'none' });
  const code=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  const html=fs.readFileSync(path.join(root,'offline/template.html'),'utf8').replace('/*__VERIFIER_CODE__*/',()=>code);
  const out=path.join(root,'apps/pwa/public/offline-verifier.html');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,html);
  console.log('Built standalone offline verifier ('+Buffer.byteLength(html)+' bytes; no network dependencies).');
})().catch(e=>{console.error(e);process.exitCode=1;});
