/**
 * Built-in grid preset tabs.
 * Each tab is an ordered list of { filterId, presetName } pairs.
 */
export const BUILTIN_TABS = [
  {
    id: 'overview',
    name: 'Overview',
    tiles: [
      { filterId: 'channel',   presetName: 'Red' },
      { filterId: 'channel',   presetName: 'Green' },
      { filterId: 'channel',   presetName: 'Blue' },
      { filterId: 'ela',       presetName: 'High Quality (95)' },
      { filterId: 'noise',     presetName: 'Soft' },
      { filterId: 'gradient',  presetName: 'Both' },
      { filterId: 'hsv',       presetName: 'Hue' },
      { filterId: 'metadata',  presetName: 'All' },
    ],
  },
  {
    id: 'color',
    name: 'Color',
    tiles: [
      { filterId: 'channel',   presetName: 'Red' },
      { filterId: 'channel',   presetName: 'Green' },
      { filterId: 'channel',   presetName: 'Blue' },
      { filterId: 'channel',   presetName: 'Alpha' },
      { filterId: 'hsv',       presetName: 'Hue' },
      { filterId: 'hsv',       presetName: 'Saturation' },
      { filterId: 'hsv',       presetName: 'Value' },
      { filterId: 'lab',       presetName: 'L*' },
      { filterId: 'lab',       presetName: 'a*' },
      { filterId: 'lab',       presetName: 'b*' },
    ],
  },
  {
    id: 'compression',
    name: 'Compression',
    tiles: [
      { filterId: 'ela', presetName: 'Low Quality (65)' },
      { filterId: 'ela', presetName: 'Medium (80)' },
      { filterId: 'ela', presetName: 'High Quality (95)' },
    ],
  },
  {
    id: 'noise',
    name: 'Noise',
    tiles: [
      { filterId: 'noise',     presetName: 'Soft' },
      { filterId: 'noise',     presetName: 'Aggressive' },
      { filterId: 'frequency', presetName: 'High Pass' },
      { filterId: 'frequency', presetName: 'Low Pass' },
    ],
  },
  {
    id: 'structure',
    name: 'Structure',
    tiles: [
      { filterId: 'gradient', presetName: 'Both' },
      { filterId: 'gradient', presetName: 'Horizontal' },
      { filterId: 'gradient', presetName: 'Vertical' },
      { filterId: 'clone',    presetName: 'Fast (16px)' },
    ],
  },
];
