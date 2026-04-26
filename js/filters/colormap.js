// Colormaps as equally-spaced RGB stops (0..1 → [r,g,b])
const MAPS = {
  viridis: [
    [68,1,84],[72,33,115],[64,67,135],[52,100,142],[41,130,142],
    [32,158,135],[55,184,120],[112,207,86],[180,222,44],[253,231,37],
  ],
  inferno: [
    [0,0,4],[23,11,58],[65,12,108],[101,21,110],[139,34,103],
    [176,55,90],[209,81,64],[237,115,27],[249,156,3],[252,255,164],
  ],
  plasma: [
    [13,8,135],[62,4,155],[104,14,157],[143,29,144],[177,50,121],
    [207,73,93],[230,101,63],[246,130,33],[254,162,5],[240,249,33],
  ],
  hot: [
    [0,0,0],[96,0,0],[192,0,0],[255,0,0],[255,96,0],
    [255,192,0],[255,255,0],[255,255,128],[255,255,255],
  ],
  cool: [
    [0,255,255],[32,223,255],[64,191,255],[96,159,255],[128,127,255],
    [160,95,255],[192,63,255],[224,31,255],[255,0,255],
  ],
  jet: [
    [0,0,128],[0,0,255],[0,128,255],[0,255,255],[128,255,128],
    [255,255,0],[255,128,0],[255,0,0],[128,0,0],
  ],
  gray: [
    [0,0,0],[255,255,255],
  ],
};

function applyColormap(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const f = t * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  return [
    (r0 + u * (r1 - r0) + 0.5) | 0,
    (g0 + u * (g1 - g0) + 0.5) | 0,
    (b0 + u * (b1 - b0) + 0.5) | 0,
  ];
}

export const colormapFilter = {
  id: 'colormap',
  name: 'False Color',
  presets: [
    { name: 'Viridis',  params: { colormap: 'viridis', channel: 'luma' } },
    { name: 'Inferno',  params: { colormap: 'inferno', channel: 'luma' } },
    { name: 'Plasma',   params: { colormap: 'plasma',  channel: 'luma' } },
    { name: 'Hot',      params: { colormap: 'hot',     channel: 'luma' } },
    { name: 'Jet',      params: { colormap: 'jet',     channel: 'luma' } },
    { name: 'Cool',     params: { colormap: 'cool',    channel: 'luma' } },
    { name: 'Red ch',   params: { colormap: 'inferno', channel: 'r'    } },
    { name: 'Alpha ch', params: { colormap: 'plasma',  channel: 'a'    } },
  ],
  defaultPreset: 'Viridis',
  paramSchema: [
    {
      id: 'colormap', label: 'Colormap', type: 'select',
      options: [
        { value: 'viridis', label: 'Viridis'    },
        { value: 'inferno', label: 'Inferno'    },
        { value: 'plasma',  label: 'Plasma'     },
        { value: 'hot',     label: 'Hot'        },
        { value: 'cool',    label: 'Cool'       },
        { value: 'jet',     label: 'Jet'        },
        { value: 'gray',    label: 'Grayscale'  },
      ],
    },
    {
      id: 'channel', label: 'Source Channel', type: 'select',
      options: [
        { value: 'luma', label: 'Luma'  },
        { value: 'r',    label: 'Red'   },
        { value: 'g',    label: 'Green' },
        { value: 'b',    label: 'Blue'  },
        { value: 'a',    label: 'Alpha' },
      ],
    },
  ],

  apply(imageData, params) {
    const { colormap, channel } = params;
    const stops = MAPS[colormap] ?? MAPS.viridis;
    const { data, width, height } = imageData;
    const out = new ImageData(width, height);
    const dst = out.data;

    for (let i = 0; i < data.length; i += 4) {
      let v;
      switch (channel) {
        case 'r': v = data[i]     / 255; break;
        case 'g': v = data[i + 1] / 255; break;
        case 'b': v = data[i + 2] / 255; break;
        case 'a': v = data[i + 3] / 255; break;
        default:  v = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      }
      const [r, g, b] = applyColormap(stops, v);
      dst[i]     = r;
      dst[i + 1] = g;
      dst[i + 2] = b;
      dst[i + 3] = 255;
    }
    return out;
  },
};
