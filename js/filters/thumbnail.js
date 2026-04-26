import { readBuffer, parseExif } from './util/exif.js';

/**
 * Thumbnail extract + compare filter.
 * Uses OffscreenCanvas — works in workers.
 */
export const thumbnailFilter = {
  id: 'thumbnail',
  name: 'Thumbnail',
  meta: true,
  presets: [{ name: 'Show', params: {} }],
  defaultPreset: 'Show',
  paramSchema: [],

  async apply(_imageData, _params, _srcCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };
    if (!parsed.thumbnailBytes) {
      return { entries: [{ label: 'Thumbnail', detail: 'absent', severity: 'info' }] };
    }

    // Decode thumbnail JPEG via createImageBitmap + OffscreenCanvas
    const blob = new Blob([parsed.thumbnailBytes], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const tW = bitmap.width, tH = bitmap.height;
    const thumbCanvas = new OffscreenCanvas(tW, tH);
    const thumbCtx = thumbCanvas.getContext('2d');
    thumbCtx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const thumbData = thumbCtx.getImageData(0, 0, tW, tH);

    return {
      entries: [
        { label: 'Thumbnail', detail: 'present', severity: 'info' },
        { label: 'Size',      detail: `${tW}x${tH}` },
      ],
    };
  },
};
