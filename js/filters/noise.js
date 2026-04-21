/**
 * Noise extraction — median filter residual.
 * Approximates median with a 3×3 box blur, then shows the residual.
 */
export const noiseFilter = {
  id: 'noise',
  name: 'Noise',
  slow: false,
  presets: [
    { name: 'Soft',       params: { radius: 1, scale: 4 } },
    { name: 'Aggressive', params: { radius: 2, scale: 8 } },
  ],
  defaultPreset: 'Soft',
  paramSchema: [
    { id: 'radius', label: 'Blur Radius', type: 'range', min: 1, max: 5, step: 1 },
    { id: 'scale',  label: 'Amplify',     type: 'range', min: 1, max: 20, step: 1 },
  ],

  apply(imageData, params) {
    const { radius, scale } = params;
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;

    // Box blur approximation
    const blurred = boxBlur(src, w, h, radius);

    const out = new ImageData(w, h);
    const dst = out.data;

    for (let i = 0; i < src.length; i += 4) {
      dst[i]     = clamp(128 + (src[i]     - blurred[i])     * scale);
      dst[i + 1] = clamp(128 + (src[i + 1] - blurred[i + 1]) * scale);
      dst[i + 2] = clamp(128 + (src[i + 2] - blurred[i + 2]) * scale);
      dst[i + 3] = 255;
    }
    return out;
  },
};

function clamp(v) { return Math.max(0, Math.min(255, v)); }

function boxBlur(src, w, h, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);
  const d = radius * 2 + 1;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        const nx = Math.min(w - 1, Math.max(0, x + kx));
        const idx = (y * w + nx) * 4;
        r += src[idx]; g += src[idx + 1]; b += src[idx + 2];
        cnt++;
      }
      const oi = (y * w + x) * 4;
      tmp[oi]     = r / cnt;
      tmp[oi + 1] = g / cnt;
      tmp[oi + 2] = b / cnt;
      tmp[oi + 3] = src[oi + 3];
    }
  }

  // Vertical pass
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.min(h - 1, Math.max(0, y + ky));
        const idx = (ny * w + x) * 4;
        r += tmp[idx]; g += tmp[idx + 1]; b += tmp[idx + 2];
        cnt++;
      }
      const oi = (y * w + x) * 4;
      dst[oi]     = r / cnt;
      dst[oi + 1] = g / cnt;
      dst[oi + 2] = b / cnt;
      dst[oi + 3] = src[oi + 3];
    }
  }

  return dst;
}
