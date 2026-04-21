import { readBuffer, parseExif, estimateJpegQuality } from './util/exif.js';

/**
 * JPEG quantization table dump + estimated quality.
 */
export const quantizationFilter = {
  id: 'quantization',
  name: 'Quant Tables',
  slow: false,
  meta: true,
  presets: [{ name: 'All Tables', params: {} }],
  defaultPreset: 'All Tables',
  paramSchema: [],

  async apply(imageData, _params, _src, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };
    if (!parsed.dqtTables.length) {
      return { entries: [{ label: 'DQT', detail: 'no tables found', severity: 'info' }] };
    }

    const entries = [];
    for (const table of parsed.dqtTables) {
      const q = estimateJpegQuality(table.values);
      entries.push({
        label:  `DQT ${table.index}`,
        detail: `precision=${table.precision === 0 ? '8-bit' : '16-bit'}`,
      });
      entries.push({
        label:  `DQT ${table.index} est Q`,
        detail: q == null ? 'unknown' : `${q}`,
      });
      for (let row = 0; row < 8; row++) {
        const vals = table.values.slice(row * 8, row * 8 + 8).join(' ');
        entries.push({ label: `DQT ${table.index}[${row}]`, detail: vals });
      }
    }
    return { entries };
  },
};
