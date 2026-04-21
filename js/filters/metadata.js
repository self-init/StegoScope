/**
 * Metadata filter — parses EXIF data from JPEG/PNG files.
 * Returns structured text for display in a non-visual tile.
 */
export const metadataFilter = {
  id: 'metadata',
  name: 'EXIF / Metadata',
  slow: false,
  meta: true,  // non-visual tile
  presets: [
    { name: 'All',      params: { mode: 'all' } },
    { name: 'GPS',      params: { mode: 'gps' } },
    { name: 'Camera',   params: { mode: 'camera' } },
  ],
  defaultPreset: 'All',
  paramSchema: [
    {
      id: 'mode', label: 'Show', type: 'select',
      options: [
        { value: 'all',    label: 'All Tags' },
        { value: 'gps',    label: 'GPS Only' },
        { value: 'camera', label: 'Camera Only' },
      ],
    },
  ],

  // For metadata, apply receives the raw File/Blob via the app
  apply(imageData, params, _sourceCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available for EXIF parsing.' };
    return parseExif(rawFile, params.mode);
  },
};

// Minimal EXIF parser — handles JPEG APP1/Exif segments
async function parseExif(file, mode) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);

  if (view.getUint16(0) !== 0xFFD8) {
    return { text: 'Not a JPEG — EXIF unavailable.' };
  }

  let offset = 2;
  let exifData = null;

  while (offset < view.byteLength - 4) {
    const marker = view.getUint16(offset);
    const length = view.getUint16(offset + 2);

    if (marker === 0xFFE1) {
      // APP1 — check for Exif header
      const header = getString(view, offset + 4, 4);
      if (header === 'Exif') {
        exifData = parseIFD(view, offset + 10, offset + 10, view.getUint8(offset + 10) === 0x49);
      }
    }
    if (marker === 0xFFDA) break; // SOS - no more metadata
    offset += 2 + length;
  }

  if (!exifData || Object.keys(exifData).length === 0) {
    return { text: 'No EXIF data found.' };
  }

  const filtered = filterByMode(exifData, mode);
  return { entries: filtered };
}

function getString(view, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

const TAG_NAMES = {
  0x010F: 'Make',           0x0110: 'Model',
  0x0112: 'Orientation',    0x011A: 'XResolution',
  0x011B: 'YResolution',    0x0128: 'ResolutionUnit',
  0x0131: 'Software',       0x0132: 'DateTime',
  0x013B: 'Artist',         0x013E: 'WhitePoint',
  0x013F: 'PrimaryChromaticities',
  0x0213: 'YCbCrPositioning',
  0x8298: 'Copyright',
  0x8769: 'ExifIFD',
  0x8825: 'GPSIFD',
  0x9000: 'ExifVersion',    0x9003: 'DateTimeOriginal',
  0x9004: 'CreateDate',     0x9101: 'ComponentsConfiguration',
  0x9102: 'CompressedBitsPerPixel',
  0x9201: 'ShutterSpeedValue', 0x9202: 'ApertureValue',
  0x9203: 'BrightnessValue',   0x9204: 'ExposureBiasValue',
  0x9205: 'MaxApertureValue',  0x9206: 'SubjectDistance',
  0x9207: 'MeteringMode',      0x9208: 'LightSource',
  0x9209: 'Flash',             0x920A: 'FocalLength',
  0x927C: 'MakerNote',         0x9286: 'UserComment',
  0xA000: 'FlashpixVersion',   0xA001: 'ColorSpace',
  0xA002: 'ExifImageWidth',    0xA003: 'ExifImageHeight',
  0xA005: 'InteropOffset',     0xA20E: 'FocalPlaneXResolution',
  0xA20F: 'FocalPlaneYResolution', 0xA210: 'FocalPlaneResolutionUnit',
  0xA217: 'SensingMethod',     0xA300: 'FileSource',
  0xA301: 'SceneType',
  // GPS tags
  0x0000: 'GPSVersionID',   0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',    0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',   0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude',    0x0007: 'GPSTimeStamp',
  0x0012: 'GPSMapDatum',    0x001D: 'GPSDateStamp',
};

// Keys are resolved name strings (e.g. "GPSLatitude"), so filter by name
const GPS_TAG_NAMES = new Set([
  'GPSVersionID', 'GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude',
  'GPSAltitudeRef', 'GPSAltitude', 'GPSTimeStamp', 'GPSMapDatum', 'GPSDateStamp',
]);
const CAMERA_TAG_NAMES = new Set([
  'Make', 'Model', 'ShutterSpeedValue', 'ApertureValue', 'FocalLength',
  'Flash', 'MeteringMode', 'ExifImageWidth', 'ExifImageHeight',
]);

function filterByMode(data, mode) {
  if (mode === 'all') return data;
  const allowed = mode === 'gps' ? GPS_TAG_NAMES : CAMERA_TAG_NAMES;
  const result = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowed.has(k)) result[k] = v;
  }
  return result;
}

function parseIFD(view, ifdOffset, tiffBase, littleEndian) {
  const tags = {};
  try {
    const count = view.getUint16(ifdOffset, littleEndian);
    for (let i = 0; i < count; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const numValues = view.getUint32(entryOffset + 4, littleEndian);
      const valueOffset = entryOffset + 8;

      let value;
      try { value = readTagValue(view, type, numValues, valueOffset, tiffBase, littleEndian); }
      catch { value = '[parse error]'; }

      const name = TAG_NAMES[tag] || `0x${tag.toString(16).padStart(4, '0')}`;

      // Recurse into sub-IFDs
      if (tag === 0x8769 || tag === 0x8825) {
        const subOffset = view.getUint32(valueOffset, littleEndian);
        const subTags = parseIFD(view, tiffBase + subOffset, tiffBase, littleEndian);
        Object.assign(tags, subTags);
        continue;
      }

      tags[name] = value;
    }
  } catch { /* truncated */ }
  return tags;
}

const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

function readTagValue(view, type, count, valueOffset, tiffBase, le) {
  const size = (TYPE_SIZES[type] || 1) * count;
  const dataOffset = size > 4 ? (tiffBase + view.getUint32(valueOffset, le)) : valueOffset;

  if (type === 2) { // ASCII
    let s = '';
    for (let i = 0; i < count - 1; i++) {
      const c = view.getUint8(dataOffset + i);
      if (c) s += String.fromCharCode(c);
    }
    return s.trim();
  }
  if (type === 5 || type === 10) { // Rational / SRational
    const vals = [];
    for (let i = 0; i < count; i++) {
      const num = type === 5
        ? view.getUint32(dataOffset + i * 8, le)
        : view.getInt32(dataOffset + i * 8, le);
      const den = type === 5
        ? view.getUint32(dataOffset + i * 8 + 4, le)
        : view.getInt32(dataOffset + i * 8 + 4, le);
      vals.push(den ? `${num}/${den}` : `${num}`);
    }
    return vals.length === 1 ? vals[0] : vals.join(', ');
  }
  if (type === 3) return count === 1 ? view.getUint16(dataOffset, le) : '[multiple]';
  if (type === 4) return count === 1 ? view.getUint32(dataOffset, le) : '[multiple]';
  if (type === 1) {
    if (count <= 4) return view.getUint8(dataOffset);
    return '[binary]';
  }
  return '[unknown]';
}
