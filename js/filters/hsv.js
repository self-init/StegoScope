/**
 * HSV channel filter — shows Hue, Saturation, or Value as grayscale.
 */
export const hsvFilter = {
  id: 'hsv',
  name: 'HSV',
  slow: false,
  presets: [
    { name: 'Hue',        params: { channel: 'h' } },
    { name: 'Saturation', params: { channel: 's' } },
    { name: 'Value',      params: { channel: 'v' } },
  ],
  defaultPreset: 'Hue',
  paramSchema: [
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'h', label: 'Hue' },
        { value: 's', label: 'Saturation' },
        { value: 'v', label: 'Value' },
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
      const [h, s, v] = rgbToHsv(r, g, b);

      let val;
      if (channel === 'h') val = (h / 360) * 255;
      else if (channel === 's') val = s * 255;
      else val = v * 255;

      dst[i] = dst[i + 1] = dst[i + 2] = Math.round(val);
      dst[i + 3] = 255;
    }
    return out;
  },
};

function rgbToHsv(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0, s = 0, v = max;

  if (max !== 0) s = d / max;

  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, s, v];
}
