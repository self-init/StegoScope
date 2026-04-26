export const curvesFilter = {
  id: 'curves',
  name: 'Curves',
  slow: false,
  meta: false,
  presets: [
    { name: 'Brighten',      params: { brightness: 40,  contrast: 0,   gamma: 1.0 } },
    { name: 'Darken',        params: { brightness: -40, contrast: 0,   gamma: 1.0 } },
    { name: 'High Contrast', params: { brightness: 0,   contrast: 60,  gamma: 1.0 } },
    { name: 'Lift Shadows',  params: { brightness: 25,  contrast: -20, gamma: 0.6 } },
    { name: 'Gamma 0.5',     params: { brightness: 0,   contrast: 0,   gamma: 0.5 } },
    { name: 'Gamma 2.0',     params: { brightness: 0,   contrast: 0,   gamma: 2.0 } },
  ],
  defaultPreset: 'Brighten',
  paramSchema: [
    { id: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100,  step: 1    },
    { id: 'contrast',   label: 'Contrast',   type: 'range', min: -100, max: 100,  step: 1    },
    { id: 'gamma',      label: 'Gamma',      type: 'range', min: 0.1,  max: 5.0,  step: 0.05 },
  ],

  apply(imageData, params) {
    const { brightness, contrast, gamma } = params;
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;

    const lut = new Uint8Array(256);
    const b = brightness / 100;
    const c = contrast   / 100;
    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      v = Math.pow(v, 1 / gamma);
      v += b;
      v = (v - 0.5) * (1 + c) + 0.5;
      lut[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }

    for (let i = 0; i < src.length; i += 4) {
      dst[i]     = lut[src[i]];
      dst[i + 1] = lut[src[i + 1]];
      dst[i + 2] = lut[src[i + 2]];
      dst[i + 3] = src[i + 3];
    }
    return out;
  },
};
