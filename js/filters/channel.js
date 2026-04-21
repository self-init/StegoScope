/**
 * Channel separation filter — isolates R, G, B, or A channel.
 */
export const channelFilter = {
  id: 'channel',
  name: 'Channel',
  slow: false,
  presets: [
    { name: 'Red',   params: { channel: 'r' } },
    { name: 'Green', params: { channel: 'g' } },
    { name: 'Blue',  params: { channel: 'b' } },
    { name: 'Alpha', params: { channel: 'a' } },
  ],
  defaultPreset: 'Red',
  paramSchema: [
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'r', label: 'Red' },
        { value: 'g', label: 'Green' },
        { value: 'b', label: 'Blue' },
        { value: 'a', label: 'Alpha' },
      ],
    },
  ],

  apply(imageData, params) {
    const { channel } = params;
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    const ci = { r: 0, g: 1, b: 2, a: 3 }[channel];

    for (let i = 0; i < src.length; i += 4) {
      const v = (channel === 'a') ? src[i + 3] : src[i + ci];
      dst[i]     = v;
      dst[i + 1] = v;
      dst[i + 2] = v;
      dst[i + 3] = 255;
    }
    return out;
  },
};
