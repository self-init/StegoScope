export const lsbExtractFilter = {
  id: 'lsb-extract',
  name: 'LSB Extract',
  slow: false,
  meta: true,
  presets: [
    { name: 'R bit0 row MSB',   params: { channel: 'r',    bit: 0, order: 'row', endian: 'msb' } },
    { name: 'G bit0 row MSB',   params: { channel: 'g',    bit: 0, order: 'row', endian: 'msb' } },
    { name: 'B bit0 row MSB',   params: { channel: 'b',    bit: 0, order: 'row', endian: 'msb' } },
    { name: 'A bit0 row MSB',   params: { channel: 'a',    bit: 0, order: 'row', endian: 'msb' } },
    { name: 'Luma bit0 row',    params: { channel: 'luma', bit: 0, order: 'row', endian: 'msb' } },
    { name: 'RGB interleaved',  params: { channel: 'rgb',  bit: 0, order: 'row', endian: 'msb' } },
    { name: 'R bit0 col MSB',   params: { channel: 'r',    bit: 0, order: 'col', endian: 'msb' } },
    { name: 'R bit0 row LSB',   params: { channel: 'r',    bit: 0, order: 'row', endian: 'lsb' } },
  ],
  defaultPreset: 'R bit0 row MSB',
  paramSchema: [
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'r',    label: 'Red'               },
        { value: 'g',    label: 'Green'             },
        { value: 'b',    label: 'Blue'              },
        { value: 'a',    label: 'Alpha'             },
        { value: 'luma', label: 'Luma'              },
        { value: 'rgb',  label: 'RGB (R,G,B order)' },
      ],
    },
    {
      id: 'bit', label: 'Bit Plane', type: 'select',
      options: [
        { value: 0, label: 'Bit 0 (LSB)' },
        { value: 1, label: 'Bit 1'       },
        { value: 2, label: 'Bit 2'       },
        { value: 3, label: 'Bit 3'       },
      ],
    },
    {
      id: 'order', label: 'Scan Order', type: 'select',
      options: [
        { value: 'row', label: 'Row-major (L→R, T→B)' },
        { value: 'col', label: 'Column-major (T→B, L→R)' },
      ],
    },
    {
      id: 'endian', label: 'Byte Bit Order', type: 'select',
      options: [
        { value: 'msb', label: 'MSB first' },
        { value: 'lsb', label: 'LSB first' },
      ],
    },
  ],

  apply(imageData, params) {
    const { channel, order, endian } = params;
    const bit  = params.bit | 0;
    const mask = 1 << bit;
    const { data, width, height } = imageData;
    const bits  = [];
    const limit = 8192; // decode at most 8192 bytes worth of bits

    function pushPixelBit(x, y) {
      if (bits.length >= limit * 8) return;
      const i = (y * width + x) * 4;
      if (channel === 'r')    bits.push((data[i]     & mask) ? 1 : 0);
      else if (channel === 'g') bits.push((data[i + 1] & mask) ? 1 : 0);
      else if (channel === 'b') bits.push((data[i + 2] & mask) ? 1 : 0);
      else if (channel === 'a') bits.push((data[i + 3] & mask) ? 1 : 0);
      else {
        // luma
        const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5) | 0;
        bits.push((luma & mask) ? 1 : 0);
      }
    }

    function pushRGBBits(x, y) {
      if (bits.length >= limit * 8) return;
      const i = (y * width + x) * 4;
      bits.push((data[i]     & mask) ? 1 : 0);
      bits.push((data[i + 1] & mask) ? 1 : 0);
      bits.push((data[i + 2] & mask) ? 1 : 0);
    }

    const pushFn = channel === 'rgb' ? pushRGBBits : pushPixelBit;

    if (order === 'row') {
      outer: for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          pushFn(x, y);
          if (bits.length >= limit * 8) break outer;
        }
      }
    } else {
      outer: for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
          pushFn(x, y);
          if (bits.length >= limit * 8) break outer;
        }
      }
    }

    // Pack bits into bytes
    const bytes = [];
    for (let i = 0; i + 7 < bits.length; i += 8) {
      let byte = 0;
      if (endian === 'msb') {
        for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
      } else {
        for (let j = 0; j < 8; j++) byte |= bits[i + j] << j;
      }
      bytes.push(byte & 0xFF);
    }

    // Hex dump with ASCII side-panel
    const lines = [];
    const show  = Math.min(bytes.length, 512);
    for (let i = 0; i < show; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const hex = chunk.map(b => b.toString(16).padStart(2, '0')).join(' ');
      const asc = chunk.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
      lines.push(`${i.toString(16).padStart(4, '0')}  ${hex.padEnd(47)}  ${asc}`);
    }
    if (bytes.length > 512) {
      lines.push(`... ${bytes.length - 512} more bytes (${bits.length >> 3} total)`);
    }
    return { text: lines.join('\n') };
  },
};
