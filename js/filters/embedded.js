import { readBuffer } from './util/exif.js';

const SIGS = [
  { name: 'JPEG',         magic: [0xFF, 0xD8, 0xFF] },
  { name: 'PNG',          magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { name: 'GIF87a',       magic: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] },
  { name: 'GIF89a',       magic: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] },
  { name: 'BMP',          magic: [0x42, 0x4D] },
  { name: 'TIFF LE',      magic: [0x49, 0x49, 0x2A, 0x00] },
  { name: 'TIFF BE',      magic: [0x4D, 0x4D, 0x00, 0x2A] },
  { name: 'WebP',         magic: [0x52, 0x49, 0x46, 0x46], extra: { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] } },
  { name: 'WAV',          magic: [0x52, 0x49, 0x46, 0x46], extra: { offset: 8, bytes: [0x57, 0x41, 0x56, 0x45] } },
  { name: 'AVI',          magic: [0x52, 0x49, 0x46, 0x46], extra: { offset: 8, bytes: [0x41, 0x56, 0x49, 0x20] } },
  { name: 'ZIP',          magic: [0x50, 0x4B, 0x03, 0x04] },
  { name: 'ZIP (empty)',  magic: [0x50, 0x4B, 0x05, 0x06] },
  { name: 'ZIP (spanned)',magic: [0x50, 0x4B, 0x07, 0x08] },
  { name: 'RAR 4',        magic: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00] },
  { name: 'RAR 5',        magic: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00] },
  { name: '7-Zip',        magic: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
  { name: 'Gzip',         magic: [0x1F, 0x8B] },
  { name: 'bzip2',        magic: [0x42, 0x5A, 0x68] },
  { name: 'XZ',           magic: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00] },
  { name: 'Zstd',         magic: [0x28, 0xB5, 0x2F, 0xFD] },
  { name: 'Zlib (default)',magic: [0x78, 0x9C] },
  { name: 'Zlib (best)',  magic: [0x78, 0xDA] },
  { name: 'Zlib (low)',   magic: [0x78, 0x01] },
  { name: 'PDF',          magic: [0x25, 0x50, 0x44, 0x46] },       // %PDF
  { name: 'ELF',          magic: [0x7F, 0x45, 0x4C, 0x46] },
  { name: 'PE/EXE (MZ)',  magic: [0x4D, 0x5A] },
  { name: 'Java class',   magic: [0xCA, 0xFE, 0xBA, 0xBE] },
  { name: 'OGG',          magic: [0x4F, 0x67, 0x67, 0x53] },       // OggS
  { name: 'FLAC',         magic: [0x66, 0x4C, 0x61, 0x43] },       // fLaC
  { name: 'MP3 (ID3)',    magic: [0x49, 0x44, 0x33] },
  { name: 'MIDI',         magic: [0x4D, 0x54, 0x68, 0x64] },       // MThd
  { name: 'WebM/MKV',    magic: [0x1A, 0x45, 0xDF, 0xA3] },
  { name: 'MP4 (ftyp)',   magic: null, ftyp: true },                // bytes 4-7 = 'ftyp'
  { name: 'PSD',          magic: [0x38, 0x42, 0x50, 0x53] },       // 8BPS
  { name: 'SQLite',       magic: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65, 0x20, 0x66] },
  { name: 'LZH',          magic: [0x2D, 0x6C, 0x68] },
  { name: 'TAR',          magic: null, tar: true },                  // "ustar" at offset 257
];

function matchAt(bytes, offset, pattern) {
  if (offset + pattern.length > bytes.length) return false;
  for (let i = 0; i < pattern.length; i++) if (bytes[offset + i] !== pattern[i]) return false;
  return true;
}

function scan(bytes) {
  const hits = [];
  // Detect file's own leading signature to skip offset 0
  let ownSig = null;
  for (const sig of SIGS) {
    if (!sig.magic) continue;
    if (matchAt(bytes, 0, sig.magic)) { ownSig = sig.name; break; }
  }

  const startOffset = ownSig ? 1 : 0;

  for (let off = startOffset; off < bytes.length; off++) {
    for (const sig of SIGS) {
      // MP4 ftyp check
      if (sig.ftyp) {
        if (off >= 4 && off + 4 <= bytes.length) {
          if (bytes[off] === 0x66 && bytes[off+1] === 0x74 && bytes[off+2] === 0x79 && bytes[off+3] === 0x70) {
            hits.push({ name: 'MP4 (ftyp)', offset: off - 4 });
          }
        }
        continue;
      }
      // TAR ustar check
      if (sig.tar) {
        if (off === 257 && bytes.length > 262) {
          if (bytes[257] === 0x75 && bytes[258] === 0x73 && bytes[259] === 0x74 && bytes[260] === 0x61 && bytes[261] === 0x72) {
            hits.push({ name: 'TAR', offset: 0 });
          }
        }
        continue;
      }
      if (!matchAt(bytes, off, sig.magic)) continue;
      if (sig.extra && !matchAt(bytes, off + sig.extra.offset, sig.extra.bytes)) continue;
      // Skip BMP/MZ at very early offsets that might be sub-patterns of other formats
      if ((sig.name === 'BMP' || sig.name === 'PE/EXE (MZ)') && off < 4) continue;
      hits.push({ name: sig.name, offset: off });
    }
  }
  return hits;
}

export const embeddedFilter = {
  id: 'embedded',
  name: 'Embedded Files',
  slow: false,
  meta: true,
  presets: [{ name: 'Scan All', params: {} }],
  defaultPreset: 'Scan All',
  paramSchema: [],

  async apply(_imageData, _params, _src, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf   = await readBuffer(rawFile);
    const bytes = new Uint8Array(buf);
    const hits  = scan(bytes);

    if (!hits.length) {
      return { entries: [{ label: 'Result', detail: 'No embedded file signatures found', severity: 'info' }] };
    }

    const entries = hits.map(h => ({
      label:  `0x${h.offset.toString(16).padStart(8, '0')}`,
      detail: h.name,
      severity: h.offset === 0 ? 'info' : 'alert',
    }));
    entries.unshift({ label: 'Found', detail: `${hits.length} signature${hits.length !== 1 ? 's' : ''}`, severity: 'info' });
    return { entries };
  },
};
