import { readBuffer } from './util/exif.js';

// Color each byte by its category
function byteColor(b) {
  if (b === 0x00)                               return [80,  80,  80 ]; // null
  if (b <= 0x08)                                return [200, 60,  60 ]; // non-print control
  if (b === 0x09 || b === 0x0A || b === 0x0D)   return [220, 200, 60 ]; // tab / LF / CR
  if (b <= 0x1F || b === 0x7F)                  return [210, 120, 40 ]; // other control / DEL
  if (b <= 0x7E)                                return [80,  200, 100]; // printable ASCII
  return [100, 130, 255];                                                // high bytes 0x80-0xFF
}

export const byteHistogramFilter = {
  id: 'byte-histogram',
  name: 'Byte Histogram',
  presets: [
    { name: 'File Bytes',   params: { source: 'file'   } },
    { name: 'Pixel Luma',   params: { source: 'pixels' } },
  ],
  defaultPreset: 'File Bytes',
  paramSchema: [
    {
      id: 'source', label: 'Source', type: 'select',
      options: [
        { value: 'file',   label: 'Raw file bytes' },
        { value: 'pixels', label: 'Pixel luma'     },
      ],
    },
  ],

  async apply(imageData, params, _src, rawFile) {
    const { source } = params;
    const counts = new Uint32Array(256);

    if (source === 'file' && rawFile) {
      const bytes = new Uint8Array(await readBuffer(rawFile));
      for (let i = 0; i < bytes.length; i++) counts[bytes[i]]++;
    } else {
      const { data } = imageData;
      for (let i = 0; i < data.length; i += 4) {
        const y = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5) | 0;
        counts[y]++;
      }
    }

    const W = 512; // 2px per bin × 256 bins
    const H = 200;
    const out = new ImageData(W, H);
    const dst = out.data;

    // Dark background
    for (let i = 0; i < dst.length; i += 4) {
      dst[i] = 18; dst[i + 1] = 18; dst[i + 2] = 18; dst[i + 3] = 255;
    }

    let maxCount = 1;
    for (let b = 0; b < 256; b++) if (counts[b] > maxCount) maxCount = counts[b];

    for (let b = 0; b < 256; b++) {
      if (counts[b] === 0) continue;
      const [cr, cg, cb] = byteColor(b);
      const barH = Math.max(1, Math.round((counts[b] / maxCount) * (H - 2)));
      const x0 = b * 2;
      for (let y = H - barH; y < H; y++) {
        const idx0 = (y * W + x0) * 4;
        dst[idx0]     = cr; dst[idx0 + 1] = cg; dst[idx0 + 2] = cb; dst[idx0 + 3] = 255;
        dst[idx0 + 4] = cr; dst[idx0 + 5] = cg; dst[idx0 + 6] = cb; dst[idx0 + 7] = 255;
      }
    }
    return out;
  },
};
