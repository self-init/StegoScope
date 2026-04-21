/**
 * Shared EXIF parser utilities.
 * Consumers: metadata, thumbnail, gps, quantization, autodetect.
 */

const TAG_NAMES = {
  0x010F: 'Make',           0x0110: 'Model',
  0x0112: 'Orientation',    0x011A: 'XResolution',
  0x011B: 'YResolution',    0x0128: 'ResolutionUnit',
  0x0131: 'Software',       0x0132: 'DateTime',
  0x013B: 'Artist',
  0x0201: 'ThumbnailOffset',
  0x0202: 'ThumbnailLength',
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
  0xA002: 'PixelXDimension',   0xA003: 'PixelYDimension',
  0xA005: 'InteropOffset',     0xA20E: 'FocalPlaneXResolution',
  0xA20F: 'FocalPlaneYResolution', 0xA210: 'FocalPlaneResolutionUnit',
  0xA217: 'SensingMethod',     0xA300: 'FileSource',
  0xA301: 'SceneType',
  0x0000: 'GPSVersionID',   0x0001: 'GPSLatitudeRef',
  0x0002: 'GPSLatitude',    0x0003: 'GPSLongitudeRef',
  0x0004: 'GPSLongitude',   0x0005: 'GPSAltitudeRef',
  0x0006: 'GPSAltitude',    0x0007: 'GPSTimeStamp',
  0x0012: 'GPSMapDatum',    0x001D: 'GPSDateStamp',
};

const GPS_TAG_NAMES = new Set([
  'GPSVersionID', 'GPSLatitudeRef', 'GPSLatitude', 'GPSLongitudeRef', 'GPSLongitude',
  'GPSAltitudeRef', 'GPSAltitude', 'GPSTimeStamp', 'GPSMapDatum', 'GPSDateStamp',
]);
const CAMERA_TAG_NAMES = new Set([
  'Make', 'Model', 'ShutterSpeedValue', 'ApertureValue', 'FocalLength',
  'Flash', 'MeteringMode', 'PixelXDimension', 'PixelYDimension',
]);

const TYPE_SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

export async function readBuffer(fileOrBuf) {
  if (fileOrBuf instanceof ArrayBuffer) return fileOrBuf;
  return fileOrBuf.arrayBuffer();
}

/**
 * Parse EXIF + DQT + trailer from a JPEG ArrayBuffer.
 * Returns { tags, ifd1, thumbnailBytes, dqtTables, trailerBytes, markers } or { error }.
 */
export function parseExif(buf) {
  const view = new DataView(buf);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) {
    return { error: 'not-jpeg' };
  }

  const result = {
    tags: {},
    ifd1: null,
    thumbnailBytes: null,
    dqtTables: [],
    trailerBytes: new Uint8Array(0),
    markers: [],
  };

  let offset = 2;
  let eoiOffset = -1;

  while (offset < view.byteLength - 1) {
    if (view.getUint8(offset) !== 0xFF) break;
    const marker = view.getUint16(offset);
    result.markers.push({ marker, offset });

    if (marker === 0xFFD9) { eoiOffset = offset + 2; break; }
    if (marker === 0xFFDA) {
      offset += 2;
      while (offset < view.byteLength - 1) {
        if (view.getUint8(offset) === 0xFF && view.getUint8(offset + 1) !== 0x00
            && view.getUint8(offset + 1) !== 0xFF) break;
        offset++;
      }
      continue;
    }
    if (marker >= 0xFFD0 && marker <= 0xFFD8) { offset += 2; continue; }

    const length = view.getUint16(offset + 2);

    if (marker === 0xFFE1) {
      const header = readString(view, offset + 4, 4);
      if (header === 'Exif') {
        parseExifPayload(view, offset + 10, result);
      }
    } else if (marker === 0xFFDB) {
      parseDqtSegment(view, offset + 2, length, result);
    }

    offset += 2 + length;
  }

  if (eoiOffset >= 0 && eoiOffset < view.byteLength) {
    result.trailerBytes = new Uint8Array(buf, eoiOffset, view.byteLength - eoiOffset);
  }
  return result;
}

function parseExifPayload(view, base, result) {
  const littleEndian = view.getUint8(base) === 0x49;
  const ifd0Offset = view.getUint32(base + 4, littleEndian);
  const ifd0 = parseIFD(view, base + ifd0Offset, base, littleEndian);
  Object.assign(result.tags, ifd0.tags);

  if (ifd0.nextIfdOffset) {
    const ifd1 = parseIFD(view, base + ifd0.nextIfdOffset, base, littleEndian);
    result.ifd1 = ifd1.tags;
    const off = ifd1.tags.ThumbnailOffset;
    const len = ifd1.tags.ThumbnailLength;
    if (typeof off === 'number' && typeof len === 'number' && len > 0) {
      const absStart = base + off;
      if (absStart + len <= view.byteLength) {
        result.thumbnailBytes = new Uint8Array(view.buffer, absStart, len);
      }
    }
  }
}

function parseIFD(view, ifdOffset, tiffBase, littleEndian) {
  const tags = {};
  let nextIfdOffset = 0;
  try {
    const count = view.getUint16(ifdOffset, littleEndian);
    for (let i = 0; i < count; i++) {
      const entryOffset = ifdOffset + 2 + i * 12;
      const tag = view.getUint16(entryOffset, littleEndian);
      const type = view.getUint16(entryOffset + 2, littleEndian);
      const numValues = view.getUint32(entryOffset + 4, littleEndian);
      const valueOffset = entryOffset + 8;

      if (tag === 0x8769 || tag === 0x8825) {
        const subOffset = view.getUint32(valueOffset, littleEndian);
        const sub = parseIFD(view, tiffBase + subOffset, tiffBase, littleEndian);
        Object.assign(tags, sub.tags);
        continue;
      }

      let value;
      try { value = readTagValue(view, type, numValues, valueOffset, tiffBase, littleEndian); }
      catch { value = '[parse error]'; }

      const name = TAG_NAMES[tag] || `0x${tag.toString(16).padStart(4, '0')}`;
      tags[name] = value;
    }
    nextIfdOffset = view.getUint32(ifdOffset + 2 + count * 12, littleEndian);
  } catch { /* truncated */ }
  return { tags, nextIfdOffset };
}

function readTagValue(view, type, count, valueOffset, tiffBase, le) {
  const size = (TYPE_SIZES[type] || 1) * count;
  const dataOffset = size > 4 ? (tiffBase + view.getUint32(valueOffset, le)) : valueOffset;

  if (type === 2) {
    let s = '';
    for (let i = 0; i < count - 1; i++) {
      const c = view.getUint8(dataOffset + i);
      if (c) s += String.fromCharCode(c);
    }
    return s.trim();
  }
  if (type === 5 || type === 10) {
    const vals = [];
    for (let i = 0; i < count; i++) {
      const num = type === 5
        ? view.getUint32(dataOffset + i * 8, le)
        : view.getInt32(dataOffset + i * 8, le);
      const den = type === 5
        ? view.getUint32(dataOffset + i * 8 + 4, le)
        : view.getInt32(dataOffset + i * 8 + 4, le);
      vals.push(den ? num / den : num);
    }
    return vals.length === 1 ? vals[0] : vals;
  }
  if (type === 3) return count === 1 ? view.getUint16(dataOffset, le) : '[multiple]';
  if (type === 4) return count === 1 ? view.getUint32(dataOffset, le) : '[multiple]';
  if (type === 1) {
    if (count <= 4) return view.getUint8(dataOffset);
    return '[binary]';
  }
  return '[unknown]';
}

function parseDqtSegment(view, segStart, segLen, result) {
  const end = segStart + segLen;
  let p = segStart + 2;
  while (p + 65 <= end) {
    const pq = (view.getUint8(p) >> 4) & 0x0F;
    const tq = view.getUint8(p) & 0x0F;
    p += 1;
    const byteLen = pq === 0 ? 64 : 128;
    if (p + byteLen > end) break;
    const values = new Array(64);
    for (let i = 0; i < 64; i++) {
      values[i] = pq === 0 ? view.getUint8(p + i) : view.getUint16(p + i * 2);
    }
    result.dqtTables.push({ index: tq, precision: pq, values });
    p += byteLen;
  }
}

function readString(view, offset, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function filterTagsByMode(tags, mode) {
  if (mode === 'all') return { ...tags };
  const allowed = mode === 'gps' ? GPS_TAG_NAMES : CAMERA_TAG_NAMES;
  const result = {};
  for (const [k, v] of Object.entries(tags)) {
    if (allowed.has(k)) result[k] = v;
  }
  return result;
}

export function gpsToDecimal(rat, refChar) {
  if (!Array.isArray(rat) || rat.length < 3) return null;
  const [d, m, s] = rat;
  if (typeof d !== 'number' || typeof m !== 'number' || typeof s !== 'number') return null;
  let v = d + m / 60 + s / 3600;
  if (refChar === 'S' || refChar === 'W') v = -v;
  return v;
}

const REF_LUM_Q50 = [
  16,11,10,16,24,40,51,61,
  12,12,14,19,26,58,60,55,
  14,13,16,24,40,57,69,56,
  14,17,22,29,51,87,80,62,
  18,22,37,56,68,109,103,77,
  24,35,55,64,81,104,113,92,
  49,64,78,87,103,121,120,101,
  72,92,95,98,112,100,103,99,
];

export function estimateJpegQuality(tableValues) {
  if (!tableValues || tableValues.length < 64) return null;
  let sum = 0;
  for (let i = 0; i < 64; i++) {
    const ref = REF_LUM_Q50[i];
    const v = tableValues[i];
    if (!ref) continue;
    sum += v / ref;
  }
  const scale = sum / 64;
  const quality = scale <= 1
    ? Math.round(100 - 50 * scale)
    : Math.round(50 / scale);
  return Math.max(1, Math.min(100, quality));
}
