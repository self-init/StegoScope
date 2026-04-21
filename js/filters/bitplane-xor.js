/**
 * Bit-plane XOR filter.
 * XOR bit N of channel A with bit M of channel B → binary mask.
 * Targets cross-channel LSB stego where one channel carries camouflage
 * correlated with another (e.g. G LSB locked to A LSB). XOR cancels
 * the correlated carrier and exposes the payload in the delta.
 */
export const bitplaneXorFilter = {
  id: 'bitplane-xor',
  name: 'Bitplane XOR',
  slow: false,
  presets: [
    { name: 'G XOR A bit0', params: { channelA: 'G', bitA: 0, channelB: 'A', bitB: 0 } },
    { name: 'R XOR A bit0', params: { channelA: 'R', bitA: 0, channelB: 'A', bitB: 0 } },
    { name: 'B XOR A bit0', params: { channelA: 'B', bitA: 0, channelB: 'A', bitB: 0 } },
    { name: 'R XOR G bit0', params: { channelA: 'R', bitA: 0, channelB: 'G', bitB: 0 } },
    { name: 'G XOR B bit0', params: { channelA: 'G', bitA: 0, channelB: 'B', bitB: 0 } },
    { name: 'R XOR B bit0', params: { channelA: 'R', bitA: 0, channelB: 'B', bitB: 0 } },
  ],
  defaultPreset: 'G XOR A bit0',
  paramSchema: [
    {
      id: 'channelA', label: 'Channel A', type: 'select',
      options: [
        { value: 'R',    label: 'Red' },
        { value: 'G',    label: 'Green' },
        { value: 'B',    label: 'Blue' },
        { value: 'A',    label: 'Alpha' },
        { value: 'Luma', label: 'Luma' },
      ],
    },
    { id: 'bitA', label: 'Bit A', type: 'range', min: 0, max: 7, step: 1 },
    {
      id: 'channelB', label: 'Channel B', type: 'select',
      options: [
        { value: 'R',    label: 'Red' },
        { value: 'G',    label: 'Green' },
        { value: 'B',    label: 'Blue' },
        { value: 'A',    label: 'Alpha' },
        { value: 'Luma', label: 'Luma' },
      ],
    },
    { id: 'bitB', label: 'Bit B', type: 'range', min: 0, max: 7, step: 1 },
  ],

  apply(imageData, params) {
    const src = imageData.data;
    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    const maskA = 1 << (params.bitA | 0);
    const maskB = 1 << (params.bitB | 0);
    const idxA = { R: 0, G: 1, B: 2, A: 3 }[params.channelA];
    const idxB = { R: 0, G: 1, B: 2, A: 3 }[params.channelB];
    const aIsLuma = params.channelA === 'Luma';
    const bIsLuma = params.channelB === 'Luma';

    for (let i = 0; i < src.length; i += 4) {
      const va = aIsLuma
        ? ((0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0)
        : src[i + idxA];
      const vb = bIsLuma
        ? ((0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0)
        : src[i + idxB];
      const bit = ((va & maskA) ? 1 : 0) ^ ((vb & maskB) ? 1 : 0);
      const v = bit ? 255 : 0;
      dst[i]     = v;
      dst[i + 1] = v;
      dst[i + 2] = v;
      dst[i + 3] = 255;
    }
    return out;
  },
};
