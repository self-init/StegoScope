import { jpegRoundTrip } from './util/jpeg.js';

/**
 * Error Level Analysis (ELA)
 * Re-saves the image at a given JPEG quality, then amplifies the difference.
 * Uses OffscreenCanvas + createImageBitmap — works in workers.
 */
export const elaFilter = {
  id: 'ela',
  name: 'ELA',
  presets: [
    { name: 'Low Quality (65)',  params: { quality: 65,  scale: 15 } },
    { name: 'High Quality (95)', params: { quality: 95,  scale: 15 } },
    { name: 'Medium (80)',       params: { quality: 80,  scale: 15 } },
  ],
  defaultPreset: 'High Quality (95)',
  paramSchema: [
    { id: 'quality', label: 'JPEG Quality', type: 'range', min: 10, max: 99, step: 1 },
    { id: 'scale',   label: 'Amplify',      type: 'range', min: 1,  max: 50, step: 1 },
  ],

  async apply(imageData, params) {
    const { quality, scale } = params;
    const w = imageData.width;
    const h = imageData.height;

    const compressed = await jpegRoundTrip(imageData, quality);
    const out = new ImageData(w, h);
    const src = imageData.data;
    const cmp = compressed.data;
    const dst = out.data;

    for (let i = 0; i < src.length; i += 4) {
      dst[i]     = Math.min(255, Math.abs(src[i]     - cmp[i])     * scale);
      dst[i + 1] = Math.min(255, Math.abs(src[i + 1] - cmp[i + 1]) * scale);
      dst[i + 2] = Math.min(255, Math.abs(src[i + 2] - cmp[i + 2]) * scale);
      dst[i + 3] = 255;
    }
    return out;
  },
};
