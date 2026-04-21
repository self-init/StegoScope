/**
 * LAB color space channel filter.
 */
export const labFilter = {
  id: 'lab',
  name: 'LAB',
  slow: false,
  presets: [
    { name: 'L*', params: { channel: 'l' } },
    { name: 'a*', params: { channel: 'a' } },
    { name: 'b*', params: { channel: 'b' } },
  ],
  defaultPreset: 'L*',
  paramSchema: [
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'l', label: 'L* (Lightness)' },
        { value: 'a', label: 'a* (Green–Red)' },
        { value: 'b', label: 'b* (Blue–Yellow)' },
      ],
    },
  ],

  apply(imageData, params) {
    const { channel } = params;
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;

    for (let i = 0; i < src.length; i += 4) {
      const r = src[i] / 255;
      const g = src[i + 1] / 255;
      const b = src[i + 2] / 255;
      const [L, a, bLab] = rgbToLab(r, g, b);

      let val;
      if (channel === 'l') val = (L / 100) * 255;
      else if (channel === 'a') val = ((a + 128) / 255) * 255;
      else val = ((bLab + 128) / 255) * 255;

      dst[i] = dst[i + 1] = dst[i + 2] = Math.max(0, Math.min(255, Math.round(val)));
      dst[i + 3] = 255;
    }
    return out;
  },
};

function rgbToLab(r, g, b) {
  // sRGB to linear
  const linearize = c => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  const rl = linearize(r), gl = linearize(g), bl = linearize(b);

  // to XYZ (D65)
  let x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  let y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  let z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  // D65 white
  x /= 0.95047; y /= 1.00000; z /= 1.08883;

  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bLab = 200 * (fy - fz);
  return [L, a, bLab];
}
