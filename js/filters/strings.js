import { readBuffer } from './util/exif.js';

/**
 * Strings filter — unix strings(1)-style extractor for raw file bytes.
 */
export const stringsFilter = {
  id: 'strings',
  name: 'Strings',
  meta: true,
  presets: [
    { name: 'ASCII ≥6',  params: { minLength: 6, encoding: 'ascii' } },
    { name: 'ASCII ≥8',  params: { minLength: 8, encoding: 'ascii' } },
    { name: 'UTF-16 ≥6', params: { minLength: 6, encoding: 'utf16le' } },
  ],
  defaultPreset: 'ASCII ≥6',
  paramSchema: [
    { id: 'minLength', label: 'Min Length', type: 'range', min: 4, max: 16, step: 1 },
    {
      id: 'encoding', label: 'Encoding', type: 'select',
      options: [
        { value: 'ascii',   label: 'ASCII' },
        { value: 'utf16le', label: 'UTF-16LE' },
        { value: 'both',    label: 'Both' },
      ],
    },
  ],

  async apply(imageData, params, _src, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const bytes = new Uint8Array(buf);

    const runs = [];
    const minLength = (params.minLength | 0) || 6;
    const encoding = params.encoding || 'ascii';
    if (encoding === 'ascii' || encoding === 'both') collectAscii(bytes, minLength, runs);
    if (encoding === 'utf16le' || encoding === 'both') collectUtf16le(bytes, minLength, runs);

    const MAX = 200;
    const trimmed = runs.slice(0, MAX);
    const entries = trimmed.map(r => ({
      label: `0x${r.offset.toString(16).padStart(8, '0')}`,
      detail: r.text.length > 120 ? r.text.slice(0, 117) + '...' : r.text,
    }));
    if (runs.length > MAX) {
      entries.push({ label: '...', detail: `(${runs.length - MAX} more truncated)`, severity: 'info' });
    }
    if (!entries.length) entries.push({ label: 'none', detail: 'no runs found', severity: 'info' });
    return { entries };
  },
};

function isPrintable(b) { return b >= 0x20 && b <= 0x7E; }

function collectAscii(bytes, min, runs) {
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const printable = i < bytes.length && isPrintable(bytes[i]);
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      const len = i - start;
      if (len >= min) {
        runs.push({ offset: start, text: bytesToString(bytes, start, len) });
      }
      start = -1;
    }
  }
}

function collectUtf16le(bytes, min, runs) {
  let start = -1;
  let count = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i], hi = bytes[i + 1];
    const printable = hi === 0 && isPrintable(lo);
    if (printable) {
      if (start < 0) { start = i; count = 0; }
      count++;
    } else {
      if (start >= 0 && count >= min) {
        runs.push({ offset: start, text: decodeUtf16LE(bytes, start, count) });
      }
      start = -1; count = 0;
    }
  }
  if (start >= 0 && count >= min) {
    runs.push({ offset: start, text: decodeUtf16LE(bytes, start, count) });
  }
}

function bytesToString(bytes, start, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
  return s;
}

function decodeUtf16LE(bytes, start, count) {
  let s = '';
  for (let i = 0; i < count; i++) s += String.fromCharCode(bytes[start + i * 2]);
  return s;
}
