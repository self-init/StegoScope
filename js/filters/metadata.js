import { readBuffer, parseExif, filterTagsByMode } from './util/exif.js';

/**
 * Metadata filter — parses EXIF data from JPEG files.
 * Thin wrapper around util/exif.js.
 */
export const metadataFilter = {
  id: 'metadata',
  name: 'EXIF / Metadata',
  slow: false,
  meta: true,
  presets: [
    { name: 'All',    params: { mode: 'all' } },
    { name: 'GPS',    params: { mode: 'gps' } },
    { name: 'Camera', params: { mode: 'camera' } },
  ],
  defaultPreset: 'All',
  paramSchema: [
    {
      id: 'mode', label: 'Show', type: 'select',
      options: [
        { value: 'all',    label: 'All Tags' },
        { value: 'gps',    label: 'GPS Only' },
        { value: 'camera', label: 'Camera Only' },
      ],
    },
  ],

  async apply(imageData, params, _sourceCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available for EXIF parsing.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG — EXIF unavailable.' };
    const filtered = filterTagsByMode(parsed.tags, params.mode);
    if (!Object.keys(filtered).length) return { text: 'No EXIF data found.' };
    return { entries: Object.entries(filtered).map(([label, detail]) => ({ label, detail: String(detail) })) };
  },
};
