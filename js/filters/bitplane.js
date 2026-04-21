/**
 * Bit-plane extraction filter.
 * Output: binary mask (0 or 255) representing bit N of the chosen channel.
 * Luma computed as ITU-R BT.601: 0.299R + 0.587G + 0.114B.
 */
export const bitplaneFilter = {
  id: 'bitplane',
  name: 'Bit Plane',
  slow: false,
  presets: [
    { name: 'Alpha Bit 0', params: { channel: 'A',    bit: 0 } },
    { name: 'Red Bit 0',   params: { channel: 'R',    bit: 0 } },
    { name: 'Green Bit 0', params: { channel: 'G',    bit: 0 } },
    { name: 'Blue Bit 0',  params: { channel: 'B',    bit: 0 } },
    { name: 'Luma Bit 0',  params: { channel: 'Luma', bit: 0 } },
    { name: 'Alpha Bit 1', params: { channel: 'A',    bit: 1 } },
  ],
  defaultPreset: 'Alpha Bit 0',
  paramSchema: [
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'R',    label: 'Red' },
        { value: 'G',    label: 'Green' },
        { value: 'B',    label: 'Blue' },
        { value: 'A',    label: 'Alpha' },
        { value: 'Luma', label: 'Luma' },
      ],
    },
    { id: 'bit', label: 'Bit', type: 'range', min: 0, max: 7, step: 1 },
  ],

  apply(imageData, params) {
    const { channel, bit } = params;
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    const mask = 1 << (bit | 0);

    const channelIdx = { R: 0, G: 1, B: 2, A: 3 }[channel];

    for (let i = 0; i < src.length; i += 4) {
      let v;
      if (channel === 'Luma') {
        v = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      } else {
        v = src[i + channelIdx];
      }
      const bitVal = (v & mask) ? 255 : 0;
      dst[i]     = bitVal;
      dst[i + 1] = bitVal;
      dst[i + 2] = bitVal;
      dst[i + 3] = 255;
    }
    return out;
  },
};
