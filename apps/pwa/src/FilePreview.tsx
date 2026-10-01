import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { PreparedFile } from './fileVerification';
import { Button, ErrorBox, Progress } from './ui';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function FilePreview({ file }: { file: PreparedFile }) {
  const canvas = useRef<HTMLCanvasElement>(null), docRef = useRef<any>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(0), [error, setError] = useState(''), [reading, setReading] = useState(false), [imageUrl, setImageUrl] = useState('');
  useEffect(() => {
    setError(''); setPage(1); setCount(0); docRef.current = null;
    if (file.info.format === 'JSON') return;
    if (file.info.format !== 'PDF') { const url = URL.createObjectURL(new Blob([file.bytes.slice().buffer], { type: file.info.mime })); setImageUrl(url); return () => URL.revokeObjectURL(url); }
    let active = true; setReading(true);
    const task = pdfjs.getDocument({ data: file.bytes.slice(), stopAtErrors: true });
    task.promise.then(doc => { if (active) { docRef.current = doc; setCount(doc.numPages); setReading(false); } }).catch(e => { if (active) { setError(e.name === 'PasswordException' ? 'This PDF is password protected. Its bytes can still be checked, but the preview needs an unlocked copy.' : 'This PDF could not be rendered. Its byte-level verification is separate from preview availability.'); setReading(false); } });
    return () => { active = false; void task.destroy(); };
  }, [file]);
  useEffect(() => {
    if (!count || !canvas.current || !docRef.current) return;
    let active = true, render: any;
    setReading(true);
    docRef.current.getPage(page).then((pdfPage: any) => {
      if (!active || !canvas.current) return;
      const viewport = pdfPage.getViewport({ scale: 1.2 });
      const target = canvas.current; target.width = viewport.width; target.height = viewport.height;
      render = pdfPage.render({ canvas: target, canvasContext: target.getContext('2d')!, viewport });
      return render.promise;
    }).then(() => { if (active) setReading(false); }).catch((e: any) => { if (active && e.name !== 'RenderingCancelledException') { setError('PDF preview could not be rendered. File verification remains independent.'); setReading(false); } });
    return () => { active = false; render?.cancel(); };
  }, [page, count, file]);
  return <section tabIndex={0} className="artifact-preview" aria-label={`${file.info.format} preview`}><div className="preview-heading"><span><FileText size={15}/> {file.info.format === 'JSON' ? 'SIGNED DATA PREVIEW' : 'ACTUAL FILE PREVIEW'}</span>{file.info.format === 'PDF' && count > 0 && <div><Button kind="ghost" disabled={page === 1} onClick={() => setPage(p => p - 1)} aria-label="Previous PDF page"><ChevronLeft size={14}/></Button><span>Page {page} of {count}</span><Button kind="ghost" disabled={page === count} onClick={() => setPage(p => p + 1)} aria-label="Next PDF page"><ChevronRight size={14}/></Button></div>}</div>{error && <ErrorBox message={error}/>} {reading && <Progress text="Rendering document preview"/>}{file.info.format === 'JSON' ? <pre className="json-view" tabIndex={0}>{JSON.stringify(file.json, null, 2)}</pre> : file.info.format === 'PDF' ? <canvas ref={canvas} aria-label={`Preview of ${file.info.name}, page ${page}`}/> : imageUrl && <img src={imageUrl} alt={`Uploaded artifact: ${file.info.name}`} onError={() => setError('The image cannot be decoded. Check that the selected file is a valid image.')}/>}</section>;
}
