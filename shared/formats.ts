export type FileFormat = 'PDF' | 'PNG' | 'JPG' | 'JPEG' | 'JSON';
export type FileInfo = { name: string; format: FileFormat; mime: string; size: number };
export const DOCUMENT_LIMIT = 10 * 1024 * 1024;
export const JSON_LIMIT = 128 * 1024;
export const ACCEPT_FILES = '.pdf,.png,.jpg,.jpeg,.json,application/pdf,image/png,image/jpeg,application/json';
const formats: Record<string, { format: FileFormat; mime: string }> = {
  pdf: { format: 'PDF', mime: 'application/pdf' }, png: { format: 'PNG', mime: 'image/png' },
  jpg: { format: 'JPG', mime: 'image/jpeg' }, jpeg: { format: 'JPEG', mime: 'image/jpeg' }, json: { format: 'JSON', mime: 'application/json' },
};
export function validateFileMetadata(name: string, mime: string, size: number): FileInfo {
  if (typeof name !== 'string' || name.length > 240) throw new Error('Invalid filename. Use a filename shorter than 240 characters.');
  const extension = name.split('.').pop()?.toLowerCase() || '';
  const entry = Object.hasOwn(formats, extension) ? formats[extension] : undefined;
  if (!entry) throw new Error('Unsupported file type. Upload PDF, PNG, JPG, or JSON.');
  const suppliedMime = (mime || '').split(';')[0].trim().toLowerCase();
  if (suppliedMime && suppliedMime !== 'application/octet-stream' && suppliedMime !== entry.mime) throw new Error('File extension and MIME type do not match. Upload a genuine PDF, PNG, JPG, or JSON file.');
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error('The selected file is empty. Choose a non-empty file.');
  if (size > (entry.format === 'JSON' ? JSON_LIMIT : DOCUMENT_LIMIT)) throw new Error(entry.format === 'JSON' ? 'JSON receipt exceeds the 128 KB limit.' : 'File is too large. Maximum size is 10 MB.');
  return { name, size, ...entry };
}
export function validateFileBytes(info: FileInfo, bytes: Uint8Array) {
  if (bytes.length !== info.size) throw new Error('File could not be read completely. Choose it again.');
  const prefix = (values: number[]) => values.every((n, i) => bytes[i] === n);
  const valid = info.format === 'JSON' || (info.format === 'PDF' ? prefix([37,80,68,70,45]) : info.format === 'PNG' ? prefix([137,80,78,71,13,10,26,10]) : prefix([255,216,255]));
  if (!valid) throw new Error(`The file content does not match its ${info.format} extension. Choose a valid ${info.format} file.`);
}
export function humanSize(size: number) { return size >= 1024 * 1024 ? `${(size / (1024 * 1024)).toFixed(2)} MB` : size >= 1024 ? `${(size / 1024).toFixed(1)} KB` : `${size} bytes`; }
