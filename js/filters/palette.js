import { readBuffer } from './util/exif.js';

// Parse PNG PLTE chunk → [[r,g,b], ...]
function parsePNGPalette(bytes) {
  if (bytes.length < 8) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4E || bytes[3] !== 0x47) return null;
  let pos = 8;
  while (pos + 12 <= bytes.length) {
    const len  = ((bytes[pos] << 24) | (bytes[pos+1] << 16) | (bytes[pos+2] << 8) | bytes[pos+3]) >>> 0;
    const type = String.fromCharCode(bytes[pos+4], bytes[pos+5], bytes[pos+6], bytes[pos+7]);
    if (type === 'PLTE' && len % 3 === 0) {
      const colors = [];
      for (let i = 0; i < len; i += 3) {
        colors.push([bytes[pos + 8 + i], bytes[pos + 9 + i], bytes[pos + 10 + i]]);
      }
      return colors;
    }
    if (type === 'IDAT' || type === 'IEND') break;
    pos += 12 + len;
  }
  return null;
}

// Parse GIF global color table
function parseGIFPalette(bytes) {
  if (bytes.length < 13) return null;
  if (bytes[0] !== 0x47 || bytes[1] !== 0x49 || bytes[2] !== 0x46) return null;
  const flags = bytes[10];
  if (!(flags & 0x80)) return null; // no global color table
  const tableSize = 2 ** ((flags & 0x07) + 1);
  const colors = [];
  for (let i = 0; i < tableSize; i++) {
    colors.push([bytes[13 + i * 3], bytes[14 + i * 3], bytes[15 + i * 3]]);
  }
  return colors;
}

// Extract most-frequent unique colors from pixel data
function extractTopColors(imageData, maxColors) {
  const { data, width, height } = imageData;
  const freq = new Map();
  for (let i = 0; i < data.length; i += 4) {
    const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
    freq.set(key, (freq.get(key) ?? 0) + 1);
  }
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxColors);
  return sorted.map(([k]) => [(k >> 16) & 0xFF, (k >> 8) & 0xFF, k & 0xFF]);
}

// Render a list of [r,g,b] swatches as ImageData
function renderSwatches(colors) {
  const sw    = 24; // swatch size in pixels
  const cols  = Math.ceil(Math.sqrt(colors.length));
  const rows  = Math.ceil(colors.length / cols);
  const imgW  = cols * sw;
  const imgH  = rows * sw;
  const out   = new ImageData(imgW, imgH);
  const dst   = out.data;

  // White background
  dst.fill(255);

  for (let ci = 0; ci < colors.length; ci++) {
    const [r, g, b] = colors[ci];
    const cx = (ci % cols) * sw;
    const cy = Math.floor(ci / cols) * sw;
    for (let dy = 0; dy < sw; dy++) {
      for (let dx = 0; dx < sw; dx++) {
        const idx = ((cy + dy) * imgW + (cx + dx)) * 4;
        dst[idx]     = r;
        dst[idx + 1] = g;
        dst[idx + 2] = b;
        dst[idx + 3] = 255;
      }
    }
  }
  return out;
}

export const paletteFilter = {
  id: 'palette',
  name: 'Palette',
  slow: false,
  meta: false,
  presets: [
    { name: 'File Palette',  params: { source: 'file', maxColors: 256 } },
    { name: 'Top 64 Colors', params: { source: 'pixels', maxColors: 64  } },
    { name: 'Top 256 Colors',params: { source: 'pixels', maxColors: 256 } },
  ],
  defaultPreset: 'File Palette',
  paramSchema: [
    {
      id: 'source', label: 'Source', type: 'select',
      options: [
        { value: 'file',   label: 'File palette (PNG/GIF)' },
        { value: 'pixels', label: 'Top pixel colors'       },
      ],
    },
    {
      id: 'maxColors', label: 'Max Colors', type: 'select',
      options: [
        { value: 16,  label: '16'  },
        { value: 32,  label: '32'  },
        { value: 64,  label: '64'  },
        { value: 128, label: '128' },
        { value: 256, label: '256' },
      ],
    },
  ],

  async apply(imageData, params, _src, rawFile) {
    const { source, maxColors } = params;
    const mc = maxColors | 0 || 256;

    if (source === 'file' && rawFile) {
      const buf   = await readBuffer(rawFile);
      const bytes = new Uint8Array(buf);
      const colors = parsePNGPalette(bytes) ?? parseGIFPalette(bytes);
      if (colors && colors.length) return renderSwatches(colors);
      // Fall through to pixel extraction if no palette found
    }

    const colors = extractTopColors(imageData, mc);
    return renderSwatches(colors);
  },
};
