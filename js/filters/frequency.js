/**
 * Frequency split — separates high/low frequency detail via blur residual.
 */
export const frequencyFilter = {
  id: 'frequency',
  name: 'Frequency Split',
  presets: [
    { name: 'High Pass', params: { band: 'high', radius: 3, scale: 4 } },
    { name: 'Low Pass',  params: { band: 'low',  radius: 3, scale: 1 } },
  ],
  defaultPreset: 'High Pass',
  paramSchema: [
    {
      id: 'band', label: 'Band', type: 'select',
      options: [
        { value: 'high', label: 'High Pass' },
        { value: 'low',  label: 'Low Pass' },
      ],
    },
    { id: 'radius', label: 'Blur Radius', type: 'range', min: 1, max: 10, step: 1 },
    { id: 'scale',  label: 'Scale',       type: 'range', min: 1, max: 20, step: 1 },
  ],

  apply(imageData, params) {
    const { band, radius, scale } = params;
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;

    const blurred = gaussianBlur(src, w, h, radius);

    const out = new ImageData(w, h);
    const dst = out.data;

    for (let i = 0; i < src.length; i += 4) {
      if (band === 'high') {
        dst[i]     = clamp(128 + (src[i]     - blurred[i])     * scale);
        dst[i + 1] = clamp(128 + (src[i + 1] - blurred[i + 1]) * scale);
        dst[i + 2] = clamp(128 + (src[i + 2] - blurred[i + 2]) * scale);
      } else {
        dst[i]     = clamp(blurred[i]);
        dst[i + 1] = clamp(blurred[i + 1]);
        dst[i + 2] = clamp(blurred[i + 2]);
      }
      dst[i + 3] = 255;
    }
    return out;
  },
};

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function gaussianBlur(src, w, h, radius) {
  // Multi-pass box blur approximates Gaussian
  let buf = new Float32Array(src);
  for (let pass = 0; pass < 3; pass++) {
    buf = boxBlurPass(buf, w, h, radius);
  }
  return buf;
}

function boxBlurPass(src, w, h, radius) {
  const tmp = new Float32Array(src.length);
  const dst = new Float32Array(src.length);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let kx = -radius; kx <= radius; kx++) {
        const nx = Math.min(w - 1, Math.max(0, x + kx));
        const idx = (y * w + nx) * 4;
        r += src[idx]; g += src[idx + 1]; b += src[idx + 2]; cnt++;
      }
      const oi = (y * w + x) * 4;
      tmp[oi] = r / cnt; tmp[oi + 1] = g / cnt; tmp[oi + 2] = b / cnt; tmp[oi + 3] = src[oi + 3];
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, cnt = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const ny = Math.min(h - 1, Math.max(0, y + ky));
        const idx = (ny * w + x) * 4;
        r += tmp[idx]; g += tmp[idx + 1]; b += tmp[idx + 2]; cnt++;
      }
      const oi = (y * w + x) * 4;
      dst[oi] = r / cnt; dst[oi + 1] = g / cnt; dst[oi + 2] = b / cnt; dst[oi + 3] = tmp[oi + 3];
    }
  }
  return dst;
}
