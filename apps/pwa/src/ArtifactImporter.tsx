import { authFetch as fetch } from './authClient';
import React, { useEffect, useRef, useState } from 'react';
import { JsonRpcProvider } from 'ethers';
import QRCode from 'qrcode';
import { ArrowDownToLine, ArrowRight, Check, LockKeyhole, Upload, X } from 'lucide-react';
import { ACCEPT_FILES, humanSize } from '../../../shared/formats';
import { ReceiptFile } from '../../../shared/receipt';
import { Badge, Button, CopyValue, ErrorBox, Progress } from './ui';
import FilePreview from './FilePreview';
import { PreparedFile, RecordReference, VerificationResult, prepareFile, verifyFile } from './fileVerification';

export function readRecordReference(): RecordReference | undefined {
  const match = location.hash.match(/^#\/verify\/(0x[a-fA-F0-9]{64})(?:\?(.*))?$/);
  if (!match) return;
  const params = new URLSearchParams(match[2]);
  return { caseId: match[1], sha256: params.get('sha256') || undefined, deployment: params.get('deployment') || undefined };
}

function RecordQR({ result, config }: { result: VerificationResult; config: any }) {
  const [image, setImage] = useState('');
  const link = `${location.origin}/#/verify/${result.caseId}?sha256=${result.sha256}&deployment=${config.deploymentBlockHash}`;
  useEffect(() => { let active = true; QRCode.toDataURL(link, { width: 184, margin: 2, errorCorrectionLevel: 'M' }).then(x => { if (active) setImage(x); }); return () => { active = false; }; }, [link]);
  return <details className="record-qr"><summary>QR verification record</summary><div>{image && <img src={image} alt="QR code linking to this application verification record" width="184" height="184"/>}<div><strong>Case {result.label}</strong><p>Open this record and select the original file to verify its bytes. The link alone does not verify a document.</p><a className="text-link" href={link}>Open verification record <ArrowRight size={14}/></a><CopyValue value={link} full/><small>This localhost link is available on this computer. Remote access is not configured.</small></div></div></details>;
}

type Props = { config: any; rpc: JsonRpcProvider; selected: string; label: string; onAccepted?: (receipt: ReceiptFile) => void; onReset?: () => void; onTransaction: (hash: string) => void; reference?: RecordReference; registered?: boolean; compact?: boolean };
export default function ArtifactImporter({ config, rpc, selected, label, onAccepted, onReset, onTransaction, reference, registered, compact }: Props) {
  const [file, setFile] = useState<PreparedFile | null>(null), [result, setResult] = useState<VerificationResult | null>(null);
  const [error, setError] = useState(''), [progress, setProgress] = useState(''), [drag, setDrag] = useState(false), [submission, setSubmission] = useState('');
  const input = useRef<HTMLInputElement>(null), version = useRef(0), lastRegistered = useRef(registered);
  const busy = !!progress;
  useEffect(() => () => { version.current++; }, []);
  async function verify(prepared: PreparedFile, token: number) {
    const next = await verifyFile(prepared, config, rpc, selected, message => { if (version.current === token) setProgress(message); }, reference);
    if (token !== version.current) return;
    setResult(next);
    if (next.receipt && next.signatureValid && next.commitmentMatched) onAccepted?.(next.receipt);
  }
  async function choose(upload?: File) {
    if (!upload) return;
    const token = ++version.current;
    setError(''); setResult(null); setFile(null); setSubmission(''); onReset?.();
    try {
      const prepared = await prepareFile(upload, message => { if (version.current === token) setProgress(message); });
      if (token !== version.current) return;
      setFile(prepared); await verify(prepared, token);
    } catch (e: any) { if (token === version.current) setError(e.shortMessage || e.message); }
    finally { if (token === version.current) setProgress(''); }
  }
  async function recheck() {
    if (!file || busy) return;
    const token = ++version.current; setError(''); setResult(null);
    try { await verify(file, token); } catch (e: any) { setError(e.shortMessage || e.message); } finally { if (version.current === token) setProgress(''); }
  }
  useEffect(() => { if (registered && !lastRegistered.current && file) void recheck(); lastRegistered.current = registered; }, [registered]);
  async function fixture(name?: string) {
    setError(''); setProgress('Reading receipt...');
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || '') + (name ? `/api/samples/${name}` : `/api/receipt/${selected}`));
      if (!response.ok) throw new Error('Sample receipt is unavailable. Retry after starting the local service.');
      await choose(new File([await response.blob()], name || `DecisionTrail-${label}.json`, { type: name ? response.headers.get('content-type') || '' : 'application/json' }));
    } catch (e: any) { setError(e.message); setProgress(''); }
  }
  async function requestAcknowledgement() {
    if (!file) return;
    setProgress('Saving evidence off-chain...'); setError('');
    try {
      const response = await fetch((import.meta.env.VITE_API_URL || '') + `/api/submissions?name=${encodeURIComponent(file.info.name)}`, { method: 'POST', headers: { 'Content-Type': file.info.mime }, body: file.original, signal: AbortSignal.timeout(20000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (data.sha256 !== file.sha256) throw new Error('The local upload fingerprint does not match. Please retry.');
      setSubmission(data.status === 'ACKNOWLEDGED' ? 'Already acknowledged. Recheck the file to retrieve its signed receipt.' : 'Saved off-chain. Switch to Department → Audit control to review and acknowledge this file, then return here and recheck.');
    } catch (e: any) { setError(e.message); } finally { setProgress(''); }
  }
  return <section className={`import-panel artifact-importer ${compact && !file ? 'compact-importer' : ''}`} aria-label="Multi-format receipt importer">
    <div className="import-heading"><span className="outline-icon"><ArrowDownToLine size={23}/></span><h2>Bring your receipt.</h2><p>Import a signed receipt or a document with a recorded commitment.</p></div>
    {reference && <div className="reference-note"><strong>Verification record selected</strong><CopyValue value={reference.caseId} full/><p>Select the original file. A QR link identifies a record; it does not establish file integrity.</p></div>}
    <input ref={input} type="file" accept={ACCEPT_FILES} className="visually-hidden" aria-label="Choose receipt or evidence file" onChange={e => { void choose(e.target.files?.[0]); e.target.value = ''; }}/>
    <button className={`drop-zone ${drag ? 'dragging' : ''}`} onClick={() => input.current?.click()} onDragOver={e => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); e.stopPropagation(); setDrag(false); if (e.dataTransfer.files.length !== 1) { setError('Choose one file at a time.'); return; } if (!busy) void choose(e.dataTransfer.files[0]); }} disabled={busy}>
      <span><Upload size={27}/></span><strong>{drag ? 'Release to verify your file' : file ? 'Choose another file' : 'Drop your receipt here'}</strong><p>or <u>choose a file</u></p><small>PDF · PNG · JPG / JPEG · JSON</small><small>Documents up to 10 MB · JSON receipts up to 128 KB</small>
    </button>
    {!file && <div className="sample-import"><span>Issued for this case</span><Button kind="secondary" disabled={busy} onClick={() => fixture()}>Verify issued receipt {label} <ArrowRight size={16}/></Button></div>}
    {!config.productMode && <details className="sample-documents"><summary>Try a committed sample document</summary><p>These synthetic files are acknowledged by receipt R20 and registered on the local chain.</p><div>{['pdf', 'png', 'jpg', 'jpeg'].map(ext => <Button kind="secondary" key={ext} disabled={busy} onClick={() => fixture(`sample-evidence.${ext}`)}>{ext.toUpperCase()}</Button>)}</div><a href={(import.meta.env.VITE_API_URL || '') + `/api/receipt/${config.cases.find((c: any) => c.scenario === 'D')?.caseId}`} download="DecisionTrail-R20.json">Download the R20 signed JSON receipt</a></details>}
    {file && <><div className="selected-artifact"><strong>{file.info.name}</strong><Badge>{file.info.format}</Badge><span>{humanSize(file.info.size)} · {file.info.size.toLocaleString()} bytes</span></div><FilePreview file={file}/><div className="file-fingerprint"><span>SHA-256 · ACTUAL FILE BYTES</span><CopyValue value={file.sha256} full/></div></>}
    {progress && <Progress text={progress}/>}
    {error && <ErrorBox message={`Verification failed. ${error}`}/>}
    {result && <div className={`file-verification ${result.status.toLowerCase()}`} aria-live="polite" data-testid="file-verification">
      <div className="panel-heading"><h3>{result.anchored ? <><Check size={21}/> Verified</> : result.status === 'UNREGISTERED' ? <><Check size={21}/> Signature valid · not registered</> : <><X size={21}/> Verification failed</>}</h3><Badge tone={result.anchored ? 'success' : result.status === 'MISMATCH' ? 'error' : 'warning'}>{result.anchored ? 'VERIFIED' : result.status === 'UNREGISTERED' ? 'NOT ANCHORED' : 'NO MATCH'}</Badge></div>
      <p>{result.message}</p><dl><div><dt>Blockchain</dt><dd>{result.anchored ? 'ANCHORED' : 'NOT ANCHORED'}</dd></div><div><dt>Commitment</dt><dd>{result.commitmentMatched ? 'MATCHED' : 'NOT MATCHED'}</dd></div>{result.label && <div><dt>Application</dt><dd>{result.label}</dd></div>}{result.blockNumber !== undefined && <div><dt>Block</dt><dd>{result.blockNumber}</dd></div>}</dl>
      {result.transactionHash && <div className="actual-file-transaction"><span>ACTUAL REGISTRATION TRANSACTION</span><CopyValue value={result.transactionHash} full/><button className="text-link" onClick={() => onTransaction(result.transactionHash!)}>View transaction <ArrowRight size={14}/></button></div>}
      <p className="association-note">{result.association}</p>
      {result.receipt && (result.receipt as any).issuerContext === 'LOCAL_DEMO_ACKNOWLEDGEMENT' && <p>The configured workspace issuer acknowledged these bytes. This does not authenticate an external government issuer.</p>}
      {result.caseId && result.signatureValid && <RecordQR result={result} config={config}/>}
    </div>}
    {file && <div className="file-actions"><Button kind="secondary" disabled={busy} onClick={recheck}>Recheck file</Button>{!config.productMode && result?.status === 'MISMATCH' && file.info.format !== 'JSON' && !reference && <details className="ack-request"><summary>Need a local demo acknowledgement?</summary><p>This explicitly saves the file on this computer for the demo department to review. A signed acknowledgement and applicant registration are still required. It does not verify an original government signature.</p><Button kind="secondary" disabled={busy} onClick={requestAcknowledgement}>Request local demo acknowledgement</Button></details>}</div>}
    {submission && <p className="submission-note" role="status">{submission}</p>}
    <p className="privacy-note"><LockKeyhole size={14}/> File previews and hashing stay in your browser. Documents are never stored on-chain.</p>
    <p className="authenticity-note">Authenticity is not truth. A matching commitment proves integrity and acknowledgement, not the factual accuracy of the contents. No OCR or semantic verification is performed.</p>
  </section>;
}
