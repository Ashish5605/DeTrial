import { spawn, ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { root, runtime, provider, ports } from './chain';
import { startApi } from './main';
const children:ChildProcess[]=[];
function run(args:string[],stdio:any='inherit'){const child=spawn(process.execPath,args,{cwd:root,stdio,windowsHide:true});children.push(child);return child;}
async function main(){
 console.log('DecisionTrail Classic · local synthetic-data demonstration');
 await new Promise<void>((resolve,reject)=>{const c=run([require.resolve('hardhat/internal/cli/cli'),'compile']);c.on('exit',code=>code===0?resolve():reject(new Error('Contract compilation failed.')));c.on('error',reject);});
 let chainRunning=false;try{await provider.send('eth_chainId',[]);chainRunning=true;}catch{}
 if(!chainRunning && process.env.NODE_ENV !== 'production'){const log=fs.openSync(path.join(runtime,'chain.log'),'a');const node=run([require.resolve('hardhat/internal/cli/cli'),'node','--hostname','127.0.0.1','--port',String(ports.rpc)],['ignore',log,log]);for(let i=0;i<60;i++){if(node.exitCode!==null)throw new Error('Classic chain could not start.');try{await provider.send('eth_chainId',[]);chainRunning=true;break;}catch{await new Promise(r=>setTimeout(r,500));}}if(!chainRunning)throw new Error('Classic chain did not become available.');}
  if(!chainRunning && process.env.NODE_ENV === 'production') throw new Error('Production chain could not be reached at RPC_URL.');
 await startApi();if(process.env.NODE_ENV==='production'){console.log(`DecisionTrail Backend running on port ${process.env.PORT||ports.api}`);}else{const vite=run([path.join(root,'node_modules/vite/bin/vite.js'),'--config','apps/pwa/vite.config.mts']);vite.once('exit',code=>{if(code)shutdown(1);});console.log(`Open http://localhost:${ports.web}`);}
}
function shutdown(code=0){for(const child of children)if(child.exitCode===null)child.kill();setTimeout(()=>process.exit(code),200);}
process.on('SIGINT',()=>shutdown());process.on('SIGTERM',()=>shutdown());main().catch(e=>{console.error(e.message);shutdown(1);});
