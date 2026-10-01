import http from 'node:http';
import { ethers } from 'ethers';
import { initialize, publicConfig, data, auditState, txDetails, checkpoint, disposition, json, ports, resolveFile, sampleBytes, submitEvidence, evidenceBytes, acknowledgeEvidence, save, provider } from './chain';
import { DOCUMENT_LIMIT, validateFileMetadata } from '../shared/formats';
let writing=false;
async function read(req:http.IncomingMessage, limit=4096) {let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new Error('Request too large.');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);}
export async function startApi(){await initialize();const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  const send=(value:any,status=200)=>{res.statusCode=status;res.end(json(value));};
  try{
    const origin=req.headers.origin;if(origin&&!['http://localhost:5176','http://127.0.0.1:5176'].includes(origin)){send({error:'Local classic demo access only.'},403);return;}
    const url=new URL(req.url||'/','http://localhost:3004'),parts=url.pathname.split('/').filter(Boolean);let result:any;
    if(req.method==='GET'&&url.pathname==='/api/config')result=publicConfig();
    else if(req.method==='GET'&&url.pathname==='/api/resolve')result=resolveFile(url.searchParams.get('sha256')||'',url.searchParams.get('caseId')||undefined);
    else if(req.method==='GET'&&url.pathname==='/api/submissions')result=Object.values(data.submissions||{});
    else if(req.method==='GET'&&parts[1]==='samples'){const name=decodeURIComponent(parts.at(-1)!);const bytes=sampleBytes(name),info=validateFileMetadata(name,'',bytes.length);res.setHeader('Content-Type',info.mime);res.setHeader('Content-Disposition',`attachment; filename="${name}"`);res.end(bytes);return;}
    else if(req.method==='GET'&&parts[1]==='evidence'){const {info,bytes}=evidenceBytes(parts.at(-1)!);res.setHeader('Content-Type',info.mime);res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(info.name)}`);res.end(bytes);return;}
    else if(req.method==='POST'&&url.pathname==='/api/submissions'){if(writing)throw new Error('Another write is in progress.');writing=true;try{result=submitEvidence(url.searchParams.get('name')||'',req.headers['content-type']||'',await read(req,DOCUMENT_LIMIT));}finally{writing=false;}}
    else if(req.method==='POST'&&parts[1]==='acknowledge'){if(writing)throw new Error('Another write is in progress.');writing=true;try{result=await acknowledgeEvidence(parts.at(-1)!);}finally{writing=false;}}
    else if(req.method==='GET'&&parts[1]==='receipt')result=data.receipts[parts.at(-1)!];
    else if(req.method==='GET'&&parts[1]==='state')result=await auditState(parts.at(-1)!);
    else if(req.method==='GET'&&parts[1]==='tx')result=await txDetails(parts.at(-1)!);
    else if(req.method==='POST'&&url.pathname==='/api/checkpoint'){if(writing)throw new Error('Another write is in progress.');writing=true;try{const {caseId}=JSON.parse((await read(req)).toString());if(!data.cases.some((c:any)=>c.caseId===caseId))throw new Error('Unknown case.');result=await checkpoint(caseId);}finally{writing=false;}}
    else if(req.method==='POST'&&url.pathname==='/api/disposition'){if(writing)throw new Error('Another write is in progress.');writing=true;try{const {caseId,reason,code}=JSON.parse((await read(req)).toString());if(!data.cases.some((c:any)=>c.caseId===caseId))throw new Error('Unknown case.');if(typeof reason!=='string'||reason.trim().length<10||reason.length>2000||![0,1,2].includes(code))throw new Error('Choose a disposition and give a reason of 10 to 2,000 characters.');const file=data.receipts[caseId];result={transactionHash:await disposition(caseId,file,code,reason)};}finally{writing=false;}}
    else if(req.method==='POST'&&url.pathname==='/api/closure-failed'){const {caseId,hash}=JSON.parse((await read(req)).toString());if(!data.cases.some((c:any)=>c.caseId===caseId)||!ethers.isHexString(hash,32))throw new Error('Unknown transaction.');const tx=await provider.getTransaction(hash),detail=await txDetails(hash);if(detail.status!=='REVERTED'||tx?.to?.toLowerCase()!==data.contracts.DisputeManager.address.toLowerCase())throw new Error('The submitted transaction is not a reverted registry call.');const decoded=new ethers.Interface(data.contracts.DisputeManager.abi).parseTransaction({data:tx!.data});if(decoded?.name!=='sealRound'||decoded.args[0]!==caseId)throw new Error('The reverted transaction did not attempt closure of this case.');data.failedClosures||={};data.failedClosures[caseId]||=[];if(!data.failedClosures[caseId].includes(hash))data.failedClosures[caseId].push(hash);save();result=detail;}
    else {send({error:'Resource not found.'},404);return;}
    if(!result){send({error:'Receipt not found in this deployment.'},404);return;}send(result);
  }catch(e:any){send({error:e.shortMessage||e.message||'Local registry unavailable.'},503);}
});await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(ports.api,'127.0.0.1',resolve);});return server;}

