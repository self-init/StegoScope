/**
 * Luminance gradient — highlights edges via Sobel operator.
 */
export const gradientFilter = {
  id: 'gradient',
  name: 'Gradient',
  slow: false,
  presets: [
    { name: 'Both',       params: { direction: 'both',       scale: 3 } },
    { name: 'Horizontal', params: { direction: 'horizontal', scale: 3 } },
    { name: 'Vertical',   params: { direction: 'vertical',   scale: 3 } },
  ],
  defaultPreset: 'Both',
  paramSchema: [
    {
      id: 'direction', label: 'Direction', type: 'select',
      options: [
        { value: 'both',       label: 'Both' },
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical',   label: 'Vertical' },
      ],
    },
    { id: 'scale', label: 'Scale', type: 'range', min: 1, max: 10, step: 1 },
  ],

  apply(imageData, params) {
    const { direction, scale } = params;
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;
    const out = new ImageData(w, h);
    const dst = out.data;

    // Sobel kernels
    const Kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const Ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let gx = 0, gy = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const nx = Math.min(w - 1, Math.max(0, x + kx));
            const ny = Math.min(h - 1, Math.max(0, y + ky));
            const idx = (ny * w + nx) * 4;
            const lum = (src[idx] * 0.2126 + src[idx + 1] * 0.7152 + src[idx + 2] * 0.0722);
            const ki = (ky + 1) * 3 + (kx + 1);
            gx += lum * Kx[ki];
            gy += lum * Ky[ki];
          }
        }

        let mag;
        if (direction === 'horizontal') mag = Math.abs(gx);
        else if (direction === 'vertical') mag = Math.abs(gy);
        else mag = Math.sqrt(gx * gx + gy * gy);

        const v = Math.min(255, mag * scale / 4);
        const oi = (y * w + x) * 4;
        dst[oi] = dst[oi + 1] = dst[oi + 2] = v;
        dst[oi + 3] = 255;
      }
    }
    return out;
  },
};
