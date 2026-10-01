import { ProofPacket, TrustAnchor, anchorFingerprint, challengeText, verifyPacket } from '../shared/closure';
const $ = (id: string) => document.getElementById(id)!;
const anchor: TrustAnchor | null = JSON.parse($('trust-anchor').textContent || '{}').pin;
let packet: ProofPacket | null = null;
const field = (id: string, value: string) => { $(id).textContent = value; };
if (anchor) {
  field('issuer', anchor.issuer); field('contract', anchor.contracts.DisputeManager.address);
  field('chain', String(anchor.chainId)); field('fingerprint', anchorFingerprint(anchor));
} else { field('status', 'Download a deployment-pinned verifier from DecisionTrail → Evidence check.'); }
function reset() { $('result').hidden = true; field('status',''); $('report').hidden=true; }
function ready() { ($('verify') as HTMLButtonElement).disabled = !anchor || !packet || !($('trust-confirm') as HTMLInputElement).checked; }
$('trust-confirm').addEventListener('change',()=>{reset();ready();});
$('packet').addEventListener('change', async event => {
  reset(); packet=null; ready();
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  field('filename',file.name);
  try {
    if (!file.name.toLowerCase().endsWith('.json') || file.size > 1024*1024 || !file.size) throw new Error('Choose a JSON proof packet up to 1 MB.');
    packet=JSON.parse(await file.text());
    field('status','Packet selected. Confirm the trusted issuer, then verify.'); ready();
  } catch(e:any) { field('status','Verification failed: '+e.message); }
});
$('verify').addEventListener('click',()=>{
  reset();
  try {
    if (!packet || !anchor || !($('trust-confirm') as HTMLInputElement).checked) throw new Error('A trusted issuer and proof packet are required.');
    const result=verifyPacket(packet,anchor);
    field('result-title',result.missing?`${result.missing} acknowledged receipt${result.missing===1?'':'s'} missing from the signed record`:'No gap among the supplied receipts');
    field('result-summary',`Application ${result.label} · snapshot block ${packet.record.statement.blockNumber} · ${result.listed} listed · ${result.later} dated after closure`);
    const rows=$('rows'); rows.replaceChildren();
    for (const row of result.rows) {
      const tr=document.createElement('tr');
      for(const text of [row.label+' · '+row.digest,row.status==='MISSING'?'NOT LISTED':row.status==='LATER'?'DATED AFTER CLOSURE — no omission claim':'LISTED',row.evidenceCount+' acknowledged commitments']) {const td=document.createElement('td');td.textContent=text;tr.appendChild(td);}
      rows.appendChild(tr);
    }
    $('result').hidden=false;$('result').className=result.missing?'result gap':'result';
    $('report').hidden=false;field('status','Issuer signatures and signed inventory verified offline. No network request was made.');
  } catch(e:any) { field('status','Verification failed: '+e.message); }
});
$('report').addEventListener('click',()=>{
  if(!packet||!anchor)return;
  const url=URL.createObjectURL(new Blob([challengeText(packet,anchor)],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='DecisionTrail-reconciliation.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
ready();
