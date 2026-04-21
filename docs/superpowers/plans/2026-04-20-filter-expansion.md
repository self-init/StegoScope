# Filter Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ten new forensics filters (bitplane, pca, wavelet, histogram, jpeg-ghost, thumbnail, gps, quantization, strings, autodetect) to RapidForensics, including auto-detection of 1-bit alpha-channel steganography.

**Architecture:** Each filter is a new ES module in `js/filters/` conforming to the existing filter contract. A shared `js/filters/util/exif.js` holds EXIF parsing reused by `metadata`, `thumbnail`, `gps`, `quantization`, and `autodetect`. Presets updated in `js/presets.js`. No changes to `app.js` or state model.

**Tech Stack:** Plain ES modules, Canvas 2D, no build step, no test runner. Verification is manual-in-browser per task.

**Testing approach:** The project has no test harness. Each filter task ends with an explicit browser verification step using a known sample image before committing. Pure-function math (bit extraction, DQT parse, strings scan, chi-square) is sanity-checked via short `console.log` assertions temporarily added during dev and removed before commit.

**Branch:** `filters/forensics-expansion` (already created, spec commit already made).

---

## File Structure

New files:

| File | Responsibility |
|---|---|
| `js/filters/util/exif.js` | Shared EXIF parser: JPEG APP1 walk, IFD traversal, tag decoding, thumbnail byte extraction, GPS sub-IFD extraction, DQT segment walk |
| `js/filters/bitplane.js` | Extract bit N of channel X as binary mask |
| `js/filters/pca.js` | Project image onto Nth principal component of RGB covariance |
| `js/filters/wavelet.js` | Haar DWT residual / detail visualisation |
| `js/filters/histogram.js` | Histogram graph overlay, stretch, equalize |
| `js/filters/jpeg-ghost.js` | Per-block MSE heatmap after re-encoding at target Q |
| `js/filters/thumbnail.js` | Extract embedded EXIF thumbnail, SSIM vs main |
| `js/filters/gps.js` | GPS EXIF → decimal + OSM URL |
| `js/filters/quantization.js` | JPEG DQT table dump + estimated quality |
| `js/filters/strings.js` | Printable-run extraction from raw bytes |
| `js/filters/autodetect.js` | Runs forensic heuristics, reports anomalies |

Modified files:

| File | Change |
|---|---|
| `js/filters/metadata.js` | Refactor to consume `util/exif.js`; no behavior change |
| `js/filters/index.js` | Register ten new filters |
| `js/presets.js` | Add Steganography + Metadata tabs; extend Overview/Color/Compression/Noise |
| `README.md` | Add new filters + autodetect to the filter list |

---

## Reference: existing filter contract

Each filter module exports an object shaped like:

```js
export const fooFilter = {
  id: 'foo',
  name: 'Display Name',
  slow: false,            // true → explicit Apply step in panel
  meta: false,            // true → non-visual tile, output {entries} or {text}
  presets: [{ name, params }],
  defaultPreset: 'Preset Name',
  paramSchema: [{ id, label, type, ...typeArgs }],
  apply(imageData, params, sourceCanvas, rawFile) {
    // return ImageData | {text} | {entries} | Promise<any of above>
  },
};
```

`entries` output is an array of `{ label, detail, severity? }` objects. Severity values used: `'info'`, `'warn'`, `'alert'`.

---

## Task 1: Shared EXIF utility

**Goal:** Extract the EXIF parsing currently hidden inside `metadata.js` into `js/filters/util/exif.js` so `thumbnail`, `gps`, `quantization`, `autodetect` can reuse it. `metadata.js` becomes a thin consumer. No behavior change for the existing metadata tile.

**Files:**
- Create: `js/filters/util/exif.js`
- Modify: `js/filters/metadata.js`

- [ ] **Step 1: Create `js/filters/util/exif.js` with the full parser API**

Write the new file:

```js
/**
 * Shared EXIF parser utilities.
 * Exposes low-level access so multiple filters can consume the same parse.
 *
 * All functions operate on an ArrayBuffer. Consumers call parseExif(buf)
 * once and read the returned object.
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
  // GPS tags (same tag numbers live in GPS sub-IFD)
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
 * Parse EXIF from a JPEG ArrayBuffer.
 * Returns { tags, ifd1, thumbnailBytes, dqtTables, trailerBytes, markers }:
 *   tags          — flat object of ifd0 + exifIFD + gpsIFD tags
 *   ifd1          — tag object for IFD1 (thumbnail metadata) or null
 *   thumbnailBytes — Uint8Array of embedded thumbnail JPEG bytes, or null
 *   dqtTables     — array of {index, precision, values (64-int array)} per DQT segment
 *   trailerBytes  — Uint8Array of bytes after EOI marker, or empty
 *   markers       — array of {marker, offset, length} segments, useful for debugging
 * Returns { error: '...' } if not a JPEG.
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
    if (marker === 0xFFDA) { // SOS — scan data, skip to next marker by searching
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

    if (marker === 0xFFE1) { // APP1 (EXIF)
      const header = readString(view, offset + 4, 4);
      if (header === 'Exif') {
        parseExifPayload(view, offset + 10, result);
      }
    } else if (marker === 0xFFDB) { // DQT
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
    // Extract embedded thumbnail bytes if metadata points to them.
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
  // segStart points to the length field; payload is segStart + 2 .. segStart + segLen
  const end = segStart + segLen;
  let p = segStart + 2;
  while (p + 65 <= end) {
    const pq = (view.getUint8(p) >> 4) & 0x0F; // precision: 0 = 8-bit, 1 = 16-bit
    const tq = view.getUint8(p) & 0x0F;        // table index
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

/**
 * Return a filtered copy of the flat tags object, keyed by mode.
 * mode: 'all' | 'gps' | 'camera'
 */
export function filterTagsByMode(tags, mode) {
  if (mode === 'all') return { ...tags };
  const allowed = mode === 'gps' ? GPS_TAG_NAMES : CAMERA_TAG_NAMES;
  const result = {};
  for (const [k, v] of Object.entries(tags)) {
    if (allowed.has(k)) result[k] = v;
  }
  return result;
}

/**
 * Convert a GPS rational-array coordinate + hemisphere ref to decimal degrees.
 * rat: [deg, min, sec] as numbers. refChar: 'N'|'S'|'E'|'W' (single char).
 * Returns number or null if malformed.
 */
export function gpsToDecimal(rat, refChar) {
  if (!Array.isArray(rat) || rat.length < 3) return null;
  const [d, m, s] = rat;
  if (typeof d !== 'number' || typeof m !== 'number' || typeof s !== 'number') return null;
  let v = d + m / 60 + s / 3600;
  if (refChar === 'S' || refChar === 'W') v = -v;
  return v;
}

/**
 * Estimate JPEG quality (0-100) from a DQT table values array.
 * Uses the Annex K reference luminance table; finds the best-matching Q.
 */
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
  const scale = sum / 64; // average scale factor relative to Q50
  const quality = scale <= 1
    ? Math.round(100 - 50 * scale)
    : Math.round(50 / scale);
  return Math.max(1, Math.min(100, quality));
}
```

- [ ] **Step 2: Refactor `js/filters/metadata.js` to use the util**

Replace the entire file with this version:

```js
import { readBuffer, parseExif, filterTagsByMode } from './util/exif.js';

/**
 * Metadata filter — parses EXIF data from JPEG files.
 * Thin wrapper around util/exif.js.
 */
export const metadataFilter = {
  id: 'metadata',
  name: 'EXIF / Metadata',
  slow: false,
  meta: true,
  presets: [
    { name: 'All',    params: { mode: 'all' } },
    { name: 'GPS',    params: { mode: 'gps' } },
    { name: 'Camera', params: { mode: 'camera' } },
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

  async apply(imageData, params, _sourceCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available for EXIF parsing.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG — EXIF unavailable.' };
    const filtered = filterTagsByMode(parsed.tags, params.mode);
    if (!Object.keys(filtered).length) return { text: 'No EXIF data found.' };
    return { entries: toEntries(filtered) };
  },
};

function toEntries(tags) {
  return Object.entries(tags).map(([label, detail]) => ({ label, detail: String(detail) }));
}
```

Note: the return shape for non-empty metadata changes from the raw tag object (which the old code returned via `filterByMode` without wrapping) to `{ entries }`. Check the old code path — if app.js consumed raw objects, this is a real behavior change that needs reconciliation.

- [ ] **Step 3: Verify app.js expects `{entries}` from metadata filter**

Run:

```
grep -n "entries" js/app.js
```

Expected: app.js renders `result.entries` for meta filters. If the grep shows `entries` handling, confirm by opening a sample JPEG in the browser after the refactor — the Metadata tile should show the same tags as before. If app.js was consuming the raw flat object instead, fall back to keeping metadata.js's original return style by wrapping like the old code did.

Verification command:

```
python3 -m http.server 8765
```

Open `http://localhost:8765`, drag in a JPEG with EXIF (e.g. any recent phone photo), navigate to the Overview tab, confirm the metadata tile renders the expected tags.

- [ ] **Step 4: Commit**

```
git add js/filters/util/exif.js js/filters/metadata.js
git commit -m "refactor: extract EXIF parser into util/exif.js

Shared module now consumed by metadata filter. Thumbnail, gps,
quantization, and autodetect will consume it in follow-ups.
No user-visible change."
```

---

## Task 2: bitplane filter

**Goal:** Extract bit N (0-7) of channel R/G/B/A/Luma as a binary mask. Core stego inspection tool.

**Files:**
- Create: `js/filters/bitplane.js`
- Modify: `js/filters/index.js`, `js/presets.js` (append temporary tile for verification)

- [ ] **Step 1: Write `js/filters/bitplane.js`**

```js
/**
 * Bit-plane extraction filter.
 * Output: binary mask (0 or 255) representing bit N of the chosen channel.
 * Luma is computed as ITU-R BT.601: 0.299R + 0.587G + 0.114B.
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
        { value: 'R', label: 'Red' },
        { value: 'G', label: 'Green' },
        { value: 'B', label: 'Blue' },
        { value: 'A', label: 'Alpha' },
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
        const y = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
        v = y | 0;
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
```

- [ ] **Step 2: Register in `js/filters/index.js`**

Current file imports filters and exports a `FILTERS` map. Add bitplane to both places.

Open `js/filters/index.js` and:

After the existing imports, add:
```js
import { bitplaneFilter }  from './bitplane.js';
```

Inside the `FILTERS` object literal, add:
```js
  bitplane:  bitplaneFilter,
```

- [ ] **Step 3: Add a temporary preset tile so the filter is visible**

Open `js/presets.js`. Inside the `overview` tab's `tiles` array, append:
```js
      { filterId: 'bitplane', presetName: 'Alpha Bit 0' },
```

This tile will be kept in the final layout; no need to remove.

- [ ] **Step 4: Browser verification**

Serve and test:
```
python3 -m http.server 8765
```

Open `http://localhost:8765`. Drag in:
1. A normal JPEG — bitplane Alpha Bit 0 tile should show solid white (alpha=255 everywhere, bit 0 = 1).
2. A PNG with transparency — should show the alpha pattern's LSB.
3. Open the tile's param panel, change channel to `R`, bit to `0`. Expected: high-entropy noise (natural image LSB is noisy).
4. Change bit to `7`. Expected: a blocky image resembling the red channel's macrostructure.

If all four behave as expected, proceed.

- [ ] **Step 5: Commit**

```
git add js/filters/bitplane.js js/filters/index.js js/presets.js
git commit -m "feat: add bitplane filter

Extract bit N of channel R/G/B/A/Luma as binary mask. Foundation
for LSB steganography inspection."
```

---

## Task 3: pca filter

**Goal:** Project image onto Nth principal component of RGB covariance. Decorrelates channels, often reveals hidden information.

**Files:**
- Create: `js/filters/pca.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/pca.js`**

```js
/**
 * PCA projection filter.
 * Computes 3x3 covariance of RGB across all pixels, then projects each
 * pixel onto chosen principal component. Output is grayscale.
 *
 * Marked slow — covariance sweep is O(W*H). Explicit Apply.
 */
export const pcaFilter = {
  id: 'pca',
  name: 'PCA',
  slow: true,
  presets: [
    { name: 'PC1', params: { component: 1, normalize: true } },
    { name: 'PC2', params: { component: 2, normalize: true } },
    { name: 'PC3', params: { component: 3, normalize: true } },
  ],
  defaultPreset: 'PC1',
  paramSchema: [
    {
      id: 'component', label: 'Component', type: 'select',
      options: [
        { value: 1, label: 'PC1 (dominant)' },
        { value: 2, label: 'PC2' },
        { value: 3, label: 'PC3 (residual)' },
      ],
    },
    { id: 'normalize', label: 'Normalize', type: 'checkbox' },
  ],

  apply(imageData, params) {
    const { component, normalize } = params;
    const src = imageData.data;
    const n = imageData.width * imageData.height;

    // Means
    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < src.length; i += 4) {
      mr += src[i]; mg += src[i + 1]; mb += src[i + 2];
    }
    mr /= n; mg /= n; mb /= n;

    // Covariance (3x3 symmetric)
    let crr = 0, cgg = 0, cbb = 0, crg = 0, crb = 0, cgb = 0;
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i] - mr, g = src[i + 1] - mg, b = src[i + 2] - mb;
      crr += r * r; cgg += g * g; cbb += b * b;
      crg += r * g; crb += r * b; cgb += g * b;
    }
    crr /= n; cgg /= n; cbb /= n; crg /= n; crb /= n; cgb /= n;

    const M = [
      [crr, crg, crb],
      [crg, cgg, cgb],
      [crb, cgb, cbb],
    ];

    const { vectors, values } = jacobiEigen3(M);
    // Sort by descending eigenvalue
    const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
    const pick = order[(component | 0) - 1] ?? order[0];
    const v = vectors[pick];

    // Project each pixel
    const proj = new Float32Array(n);
    let min = Infinity, max = -Infinity;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const val = (src[i] - mr) * v[0] + (src[i + 1] - mg) * v[1] + (src[i + 2] - mb) * v[2];
      proj[p] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    const range = max - min;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      let g;
      if (normalize && range > 1e-9) {
        g = ((proj[p] - min) / range) * 255;
      } else {
        g = 128 + proj[p];
        if (g < 0) g = 0; else if (g > 255) g = 255;
      }
      dst[i] = dst[i + 1] = dst[i + 2] = g | 0;
      dst[i + 3] = 255;
    }
    return out;
  },
};

// 3x3 Jacobi eigendecomposition. M is a symmetric 3x3 matrix as [[..],[..],[..]].
// Returns { vectors, values } where vectors[k] is the kth eigenvector (array len 3)
// and values[k] is its eigenvalue.
function jacobiEigen3(M) {
  const a = [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]],
  ];
  const V = [[1,0,0],[0,1,0],[0,0,1]];
  const MAX_SWEEPS = 32;
  const EPS = 1e-10;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let offDiag = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (offDiag < EPS) break;

    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < EPS) continue;
        const app = a[p][p], aqq = a[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = a[r][p], arq = a[r][q];
            a[r][p] = c * arp - s * arq;
            a[p][r] = a[r][p];
            a[r][q] = s * arp + c * arq;
            a[q][r] = a[r][q];
          }
          const vrp = V[r][p], vrq = V[r][q];
          V[r][p] = c * vrp - s * vrq;
          V[r][q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const values = [a[0][0], a[1][1], a[2][2]];
  const vectors = [
    [V[0][0], V[1][0], V[2][0]],
    [V[0][1], V[1][1], V[2][1]],
    [V[0][2], V[1][2], V[2][2]],
  ];
  return { vectors, values };
}
```

- [ ] **Step 2: Register in `js/filters/index.js`**

Add import:
```js
import { pcaFilter } from './pca.js';
```

Add to `FILTERS`:
```js
  pca: pcaFilter,
```

- [ ] **Step 3: Add temp preset tiles**

In `js/presets.js`, under the `color` tab's `tiles`, append:
```js
      { filterId: 'pca', presetName: 'PC1' },
      { filterId: 'pca', presetName: 'PC2' },
      { filterId: 'pca', presetName: 'PC3' },
```

- [ ] **Step 4: Browser verification**

Open `http://localhost:8765`. Drag in a color photo. Go to Color tab. PCA tiles should each show grayscale renders. PC1 should resemble luma. PC3 should look like high-frequency noise. Open PCA's param panel, click Apply, confirm no errors in console.

- [ ] **Step 5: Commit**

```
git add js/filters/pca.js js/filters/index.js js/presets.js
git commit -m "feat: add PCA projection filter

3x3 Jacobi eigendecomposition on RGB covariance. PC1/PC2/PC3
presets for decorrelated channel inspection."
```

---

## Task 4: wavelet filter

**Goal:** Haar DWT residual (original − reconstructed) or detail (HH sub-band) visualisation.

**Files:**
- Create: `js/filters/wavelet.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/wavelet.js`**

```js
/**
 * Haar wavelet residual / detail filter.
 * - residual mode: original minus soft-thresholded reconstruction, centered at 128.
 * - detail mode: HH sub-band of the chosen level, amplified and centered.
 */
export const waveletFilter = {
  id: 'wavelet',
  name: 'Wavelet',
  slow: false,
  presets: [
    { name: 'Residual L1', params: { level: 1, mode: 'residual', threshold: 8  } },
    { name: 'Residual L2', params: { level: 2, mode: 'residual', threshold: 8  } },
    { name: 'Detail L1',   params: { level: 1, mode: 'detail',   threshold: 0  } },
  ],
  defaultPreset: 'Residual L1',
  paramSchema: [
    { id: 'level',     label: 'Level',     type: 'range', min: 1, max: 3,  step: 1 },
    {
      id: 'mode', label: 'Mode', type: 'select',
      options: [
        { value: 'residual', label: 'Residual' },
        { value: 'detail',   label: 'Detail (HH)' },
      ],
    },
    { id: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 32, step: 1 },
  ],

  apply(imageData, params) {
    const { level, mode, threshold } = params;
    const W = imageData.width, H = imageData.height;
    const out = new ImageData(W, H);

    // Process each channel independently
    for (let ch = 0; ch < 3; ch++) {
      const plane = extractPlane(imageData, ch);
      if (mode === 'residual') {
        const thresholded = haarThenThreshold(plane, W, H, level | 0, threshold);
        const recon = invHaar(thresholded, W, H, level | 0);
        for (let i = 0; i < plane.length; i++) {
          const r = plane[i] - recon[i];
          writeChannel(out, i, ch, 128 + r);
        }
      } else {
        const hh = haarDetailOnly(plane, W, H, level | 0);
        for (let i = 0; i < hh.length; i++) {
          writeChannel(out, i, ch, 128 + hh[i] * 4);
        }
      }
    }
    // alpha=255
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    return out;
  },
};

function extractPlane(img, ch) {
  const n = img.width * img.height;
  const plane = new Float32Array(n);
  const src = img.data;
  for (let p = 0, i = 0; p < n; p++, i += 4) plane[p] = src[i + ch];
  return plane;
}

function writeChannel(img, pixelIdx, ch, value) {
  if (value < 0) value = 0; else if (value > 255) value = 255;
  img.data[pixelIdx * 4 + ch] = value | 0;
}

// In-place Haar transform with `level` iterations.
// Returns a new Float32Array holding the transformed coefficients.
function haarThenThreshold(plane, W, H, level, threshold) {
  const coef = plane.slice();
  let w = W, h = H;
  for (let l = 0; l < level; l++) {
    haarStep(coef, W, w, h);
    w = w >> 1; h = h >> 1;
    if (w < 1 || h < 1) break;
  }
  // soft-threshold all non-LL coefficients
  if (threshold > 0) {
    let cw = W, ch = H;
    for (let l = 0; l < level; l++) {
      const hw = cw >> 1, hh = ch >> 1;
      softThresholdRegion(coef, W, hw, 0,  hw, hh, threshold); // HL
      softThresholdRegion(coef, W, 0,  hh, hw, hh, threshold); // LH
      softThresholdRegion(coef, W, hw, hh, hw, hh, threshold); // HH
      cw = hw; ch = hh;
    }
  }
  return coef;
}

function invHaar(coef, W, H, level) {
  const out = coef.slice();
  let w = W >> level, h = H >> level;
  for (let l = 0; l < level; l++) {
    const fw = w << 1, fh = h << 1;
    invHaarStep(out, W, fw, fh);
    w = fw; h = fh;
  }
  return out;
}

function haarDetailOnly(plane, W, H, level) {
  const coef = plane.slice();
  let w = W, h = H;
  for (let l = 0; l < level; l++) {
    haarStep(coef, W, w, h);
    w = w >> 1; h = h >> 1;
    if (w < 1 || h < 1) break;
  }
  // zero out LL, LH, HL; keep HH
  const out = new Float32Array(W * H);
  const hw = w, hh = h;
  const prevW = hw << 1, prevH = hh << 1;
  for (let y = 0; y < prevH; y++) {
    for (let x = 0; x < prevW; x++) {
      const inHH = (x >= hw) && (y >= hh);
      if (inHH) out[y * W + x] = coef[y * W + x];
    }
  }
  return out;
}

function haarStep(coef, stride, w, h) {
  const tmp = new Float32Array(w);
  // rows
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 1 < w; x += 2) {
      const a = coef[y * stride + x];
      const b = coef[y * stride + x + 1];
      tmp[x >> 1]          = (a + b) * 0.5;
      tmp[(w >> 1) + (x >> 1)] = (a - b) * 0.5;
    }
    for (let x = 0; x < w; x++) coef[y * stride + x] = tmp[x];
  }
  // cols
  const tmpC = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y + 1 < h; y += 2) {
      const a = coef[y * stride + x];
      const b = coef[(y + 1) * stride + x];
      tmpC[y >> 1]           = (a + b) * 0.5;
      tmpC[(h >> 1) + (y >> 1)] = (a - b) * 0.5;
    }
    for (let y = 0; y < h; y++) coef[y * stride + x] = tmpC[y];
  }
}

function invHaarStep(coef, stride, w, h) {
  // cols
  const tmpC = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    const halfH = h >> 1;
    for (let y = 0; y < halfH; y++) {
      const lo = coef[y * stride + x];
      const hi = coef[(halfH + y) * stride + x];
      tmpC[2 * y]     = lo + hi;
      tmpC[2 * y + 1] = lo - hi;
    }
    for (let y = 0; y < h; y++) coef[y * stride + x] = tmpC[y];
  }
  // rows
  const tmpR = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const halfW = w >> 1;
    for (let x = 0; x < halfW; x++) {
      const lo = coef[y * stride + x];
      const hi = coef[y * stride + halfW + x];
      tmpR[2 * x]     = lo + hi;
      tmpR[2 * x + 1] = lo - hi;
    }
    for (let x = 0; x < w; x++) coef[y * stride + x] = tmpR[x];
  }
}

function softThresholdRegion(coef, stride, x0, y0, w, h, thr) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * stride + (x0 + x);
      const v = coef[i];
      if (v > thr) coef[i] = v - thr;
      else if (v < -thr) coef[i] = v + thr;
      else coef[i] = 0;
    }
  }
}
```

- [ ] **Step 2: Register in index.js**

```js
import { waveletFilter } from './wavelet.js';
```

Add `wavelet: waveletFilter,` to `FILTERS`.

- [ ] **Step 3: Add temp tiles**

In `js/presets.js`, under `noise` tab tiles, append:
```js
      { filterId: 'wavelet', presetName: 'Residual L1' },
```

- [ ] **Step 4: Browser verification**

Load a photo. Noise tab. Wavelet Residual L1 should show fine-grained noise centered at mid-gray. Switch mode to Detail — should show high-frequency texture. Increase threshold — residual intensity should increase (more low-freq content survives).

- [ ] **Step 5: Commit**

```
git add js/filters/wavelet.js js/filters/index.js js/presets.js
git commit -m "feat: add Haar wavelet filter

Residual and detail modes for noise/stego inspection.
Soft-threshold on detail coefficients tunes aggressiveness."
```

---

## Task 5: histogram filter

**Goal:** Histogram graph visualization + auto-stretch + equalize modes.

**Files:**
- Create: `js/filters/histogram.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/histogram.js`**

```js
/**
 * Histogram filter.
 * graph    — render 256-bin histogram as a visualization.
 * stretch  — linear remap [min,max] -> [0,255] per channel.
 * equalize — CDF-based equalization per channel.
 */
export const histogramFilter = {
  id: 'histogram',
  name: 'Histogram',
  slow: false,
  presets: [
    { name: 'Graph All',      params: { mode: 'graph',    channel: 'All'  } },
    { name: 'Stretch Luma',   params: { mode: 'stretch',  channel: 'Luma' } },
    { name: 'Equalize Luma',  params: { mode: 'equalize', channel: 'Luma' } },
  ],
  defaultPreset: 'Graph All',
  paramSchema: [
    {
      id: 'mode', label: 'Mode', type: 'select',
      options: [
        { value: 'graph',    label: 'Graph' },
        { value: 'stretch',  label: 'Auto-Stretch' },
        { value: 'equalize', label: 'Equalize' },
      ],
    },
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'R',    label: 'Red' },
        { value: 'G',    label: 'Green' },
        { value: 'B',    label: 'Blue' },
        { value: 'Luma', label: 'Luma' },
        { value: 'All',  label: 'All (RGB)' },
      ],
    },
  ],

  apply(imageData, params) {
    const { mode, channel } = params;
    if (mode === 'graph') return renderHistogramGraph(imageData, channel);
    if (mode === 'stretch') return stretchMode(imageData, channel);
    return equalizeMode(imageData, channel);
  },
};

function computeHistograms(img, luma = false) {
  const src = img.data;
  const hr = new Uint32Array(256);
  const hg = new Uint32Array(256);
  const hb = new Uint32Array(256);
  const hy = new Uint32Array(256);
  for (let i = 0; i < src.length; i += 4) {
    hr[src[i]]++; hg[src[i + 1]]++; hb[src[i + 2]]++;
    if (luma) {
      const y = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      hy[y]++;
    }
  }
  return { hr, hg, hb, hy };
}

function renderHistogramGraph(img, channel) {
  const { hr, hg, hb, hy } = computeHistograms(img, true);
  const W = img.width, H = img.height;
  const out = new ImageData(W, H);
  const dst = out.data;
  for (let i = 3; i < dst.length; i += 4) dst[i] = 255; // opaque black background

  const bars = channel === 'All'
    ? [{ data: hr, color: [255,  80,  80] }, { data: hg, color: [100, 220, 100] }, { data: hb, color: [100, 150, 255] }]
    : channel === 'Luma'
      ? [{ data: hy, color: [220, 220, 220] }]
      : channel === 'R' ? [{ data: hr, color: [255, 80, 80] }]
      : channel === 'G' ? [{ data: hg, color: [100, 220, 100] }]
                        : [{ data: hb, color: [100, 150, 255] }];

  let maxCount = 1;
  for (const b of bars) for (let i = 0; i < 256; i++) if (b.data[i] > maxCount) maxCount = b.data[i];

  const drawH = H;
  for (const b of bars) {
    for (let bin = 0; bin < 256; bin++) {
      const x0 = Math.floor((bin       / 256) * W);
      const x1 = Math.floor(((bin + 1) / 256) * W);
      const barH = Math.round((b.data[bin] / maxCount) * (drawH - 2));
      for (let y = H - barH; y < H; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * W + x) * 4;
          // additive blend
          dst[o    ] = Math.min(255, dst[o    ] + b.color[0] / bars.length);
          dst[o + 1] = Math.min(255, dst[o + 1] + b.color[1] / bars.length);
          dst[o + 2] = Math.min(255, dst[o + 2] + b.color[2] / bars.length);
        }
      }
    }
  }
  return out;
}

function stretchMode(img, channel) {
  const out = new ImageData(img.width, img.height);
  const src = img.data, dst = out.data;
  if (channel === 'Luma' || channel === 'All') {
    // per-channel stretch on R,G,B
    const ranges = [findRange(src, 0), findRange(src, 1), findRange(src, 2)];
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const [lo, hi] = ranges[c];
        const v = src[i + c];
        dst[i + c] = hi > lo ? ((v - lo) / (hi - lo)) * 255 | 0 : v;
      }
      dst[i + 3] = 255;
    }
  } else {
    const ci = { R: 0, G: 1, B: 2 }[channel];
    const [lo, hi] = findRange(src, ci);
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        if (c === ci) dst[i + c] = hi > lo ? ((src[i + c] - lo) / (hi - lo)) * 255 | 0 : src[i + c];
        else dst[i + c] = src[i + c];
      }
      dst[i + 3] = 255;
    }
  }
  return out;
}

function findRange(src, ci) {
  let lo = 255, hi = 0;
  for (let i = ci; i < src.length; i += 4) {
    const v = src[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

function equalizeMode(img, channel) {
  const out = new ImageData(img.width, img.height);
  const src = img.data, dst = out.data;
  const total = img.width * img.height;

  if (channel === 'Luma') {
    // equalize luma, preserve hue
    const lut = new Uint8Array(256);
    const h = new Uint32Array(256);
    for (let i = 0; i < src.length; i += 4) {
      const y = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      h[y]++;
    }
    let sum = 0;
    for (let i = 0; i < 256; i++) { sum += h[i]; lut[i] = (sum / total * 255) | 0; }
    for (let i = 0; i < src.length; i += 4) {
      const y  = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      const y2 = lut[y];
      const scale = y > 0 ? y2 / y : 1;
      dst[i    ] = Math.min(255, src[i    ] * scale) | 0;
      dst[i + 1] = Math.min(255, src[i + 1] * scale) | 0;
      dst[i + 2] = Math.min(255, src[i + 2] * scale) | 0;
      dst[i + 3] = 255;
    }
    return out;
  }

  if (channel === 'All') {
    for (let c = 0; c < 3; c++) {
      const lut = channelLut(src, c, total);
      for (let i = 0; i < src.length; i += 4) dst[i + c] = lut[src[i + c]];
    }
    for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
    return out;
  }

  const ci = { R: 0, G: 1, B: 2 }[channel];
  const lut = channelLut(src, ci, total);
  for (let i = 0; i < src.length; i += 4) {
    dst[i    ] = (ci === 0) ? lut[src[i    ]] : src[i    ];
    dst[i + 1] = (ci === 1) ? lut[src[i + 1]] : src[i + 1];
    dst[i + 2] = (ci === 2) ? lut[src[i + 2]] : src[i + 2];
    dst[i + 3] = 255;
  }
  return out;
}

function channelLut(src, ci, total) {
  const h = new Uint32Array(256);
  for (let i = ci; i < src.length; i += 4) h[src[i]]++;
  let sum = 0;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { sum += h[i]; lut[i] = (sum / total * 255) | 0; }
  return lut;
}
```

- [ ] **Step 2: Register**

Import `histogramFilter` from `./histogram.js` in `index.js`, add `histogram: histogramFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tile**

In `js/presets.js` under `noise` tiles, append:
```js
      { filterId: 'histogram', presetName: 'Graph All' },
```

- [ ] **Step 4: Browser verification**

Load a photo. Noise tab. Histogram Graph All should render a tri-color bar chart filling the tile. Open panel, switch to Stretch Luma → image should gain contrast. Switch to Equalize Luma → contrast flattens to a more uniform distribution.

- [ ] **Step 5: Commit**

```
git add js/filters/histogram.js js/filters/index.js js/presets.js
git commit -m "feat: add histogram filter

Graph overlay, per-channel auto-stretch, and luma/channel equalization."
```

---

## Task 6: jpeg-ghost filter

**Goal:** Per-block MSE heatmap between original and a re-encoded version at target quality. Spots regions originally compressed at that quality (double-compression detector).

**Files:**
- Create: `js/filters/jpeg-ghost.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/jpeg-ghost.js`**

```js
/**
 * JPEG Ghost.
 * Re-encodes the current image as JPEG at `quality`, computes per-block MSE
 * vs original, renders as a heatmap. Regions with low MSE at a given Q are
 * the ones that were already at that quality — the "ghost" of an earlier
 * compression.
 */
export const jpegGhostFilter = {
  id: 'jpeg-ghost',
  name: 'JPEG Ghost',
  slow: true,
  presets: [
    { name: 'Q50', params: { quality: 50, blockSize: 16 } },
    { name: 'Q70', params: { quality: 70, blockSize: 16 } },
    { name: 'Q85', params: { quality: 85, blockSize: 16 } },
    { name: 'Q90', params: { quality: 90, blockSize: 16 } },
  ],
  defaultPreset: 'Q70',
  paramSchema: [
    { id: 'quality',   label: 'Quality',    type: 'range', min: 30, max: 95, step: 5 },
    {
      id: 'blockSize', label: 'Block Size', type: 'select',
      options: [
        { value: 8,  label: '8 px' },
        { value: 16, label: '16 px' },
      ],
    },
  ],

  apply(imageData, params) {
    const { quality, blockSize } = params;
    const W = imageData.width, H = imageData.height;

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = W; tmpCanvas.height = H;
    const tmpCtx = tmpCanvas.getContext('2d');
    tmpCtx.putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
      tmpCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const cmpCanvas = document.createElement('canvas');
          cmpCanvas.width = W; cmpCanvas.height = H;
          const cmpCtx = cmpCanvas.getContext('2d');
          cmpCtx.drawImage(img, 0, 0);
          const cmp = cmpCtx.getImageData(0, 0, W, H).data;

          const out = new ImageData(W, H);
          const src = imageData.data;
          const dst = out.data;
          const bs = blockSize | 0;

          // per-block MSE over RGB
          const bW = Math.ceil(W / bs);
          const bH = Math.ceil(H / bs);
          const mse = new Float32Array(bW * bH);
          let maxMse = 1e-6;
          for (let by = 0; by < bH; by++) {
            for (let bx = 0; bx < bW; bx++) {
              let sum = 0, count = 0;
              const x0 = bx * bs, y0 = by * bs;
              const x1 = Math.min(x0 + bs, W), y1 = Math.min(y0 + bs, H);
              for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                  const o = (y * W + x) * 4;
                  const dr = src[o    ] - cmp[o    ];
                  const dg = src[o + 1] - cmp[o + 1];
                  const db = src[o + 2] - cmp[o + 2];
                  sum += dr*dr + dg*dg + db*db;
                  count += 3;
                }
              }
              const m = count ? sum / count : 0;
              mse[by * bW + bx] = m;
              if (m > maxMse) maxMse = m;
            }
          }

          // render heatmap: hot = low error (likely target quality)
          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const bx = (x / bs) | 0;
              const by = (y / bs) | 0;
              const m = mse[by * bW + bx] / maxMse;
              // invert so low error = bright
              const t = 1 - m;
              const o = (y * W + x) * 4;
              const [r, g, b] = viridis(t);
              dst[o]     = r;
              dst[o + 1] = g;
              dst[o + 2] = b;
              dst[o + 3] = 255;
            }
          }
          resolve(out);
        };
        img.src = url;
      }, 'image/jpeg', quality / 100);
    });
  },
};

// Tiny viridis-ish colormap, good enough for heatmap.
function viridis(t) {
  t = Math.max(0, Math.min(1, t));
  const r = (68 + t * (253 - 68))  | 0;
  const g = (1  + t * (231 - 1))   | 0;
  const b = (84 + t * (37  - 84))  | 0;
  return [r, g, b];
}
```

- [ ] **Step 2: Register**

Import `jpegGhostFilter` in index.js, add `'jpeg-ghost': jpegGhostFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tiles**

In `js/presets.js` under `compression` tab tiles, append:
```js
      { filterId: 'jpeg-ghost', presetName: 'Q70' },
      { filterId: 'jpeg-ghost', presetName: 'Q85' },
```

- [ ] **Step 4: Browser verification**

Take a JPEG photo saved at Q=90. Re-save it at Q=70. Load the Q70 version. Compression tab → JPEG Ghost Q70 tile should show mostly-hot (bright) heatmap (image already near Q70). Q85 tile should be noticeably cooler on most regions.

- [ ] **Step 5: Commit**

```
git add js/filters/jpeg-ghost.js js/filters/index.js js/presets.js
git commit -m "feat: add JPEG ghost filter

Per-block MSE heatmap against re-encoded image. Detects regions
already at target quality (double-compression artifact)."
```

---

## Task 7: thumbnail filter

**Goal:** Extract embedded EXIF thumbnail, SSIM-compare to downscaled main image. Entries output.

**Files:**
- Create: `js/filters/thumbnail.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/thumbnail.js`**

```js
import { readBuffer, parseExif } from './util/exif.js';

/**
 * Thumbnail extract + compare filter.
 * Pulls embedded EXIF thumbnail (IFD1) and reports SSIM vs downscaled main.
 * Mismatch often indicates the main image was edited after the thumbnail
 * was generated.
 */
export const thumbnailFilter = {
  id: 'thumbnail',
  name: 'Thumbnail',
  slow: false,
  meta: true,
  presets: [{ name: 'Show', params: {} }],
  defaultPreset: 'Show',
  paramSchema: [],

  async apply(imageData, _params, sourceCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };
    if (!parsed.thumbnailBytes) {
      return { entries: [{ label: 'Thumbnail', detail: 'absent', severity: 'info' }] };
    }

    const blob = new Blob([parsed.thumbnailBytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = img.naturalWidth;
    thumbCanvas.height = img.naturalHeight;
    thumbCanvas.getContext('2d').drawImage(img, 0, 0);

    // downscale main to thumbnail size
    const down = document.createElement('canvas');
    down.width = thumbCanvas.width;
    down.height = thumbCanvas.height;
    down.getContext('2d').drawImage(sourceCanvas, 0, 0, down.width, down.height);

    const thumbData = thumbCanvas.getContext('2d').getImageData(0, 0, thumbCanvas.width, thumbCanvas.height);
    const downData  = down.getContext('2d').getImageData(0, 0, down.width, down.height);
    const ssim = computeSsim(thumbData, downData);

    return {
      entries: [
        { label: 'Thumbnail', detail: 'present', severity: 'info' },
        { label: 'Size',      detail: `${thumbCanvas.width}×${thumbCanvas.height}` },
        {
          label:    'SSIM vs main',
          detail:   ssim.toFixed(3),
          severity: ssim < 0.85 ? 'alert' : 'info',
        },
      ],
    };
  },
};

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Simple single-scale SSIM over luma. Not the full 2D-window formulation —
// uses per-pixel comparison with a small 8x8 block mean for quick estimates.
function computeSsim(a, b) {
  const W = Math.min(a.width, b.width);
  const H = Math.min(a.height, b.height);
  const la = lumaArray(a, W, H);
  const lb = lumaArray(b, W, H);
  const n = W * H;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += la[i]; sumB += lb[i]; }
  const muA = sumA / n, muB = sumB / n;

  let varA = 0, varB = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = la[i] - muA, db = lb[i] - muB;
    varA += da * da; varB += db * db; cov += da * db;
  }
  varA /= n; varB /= n; cov /= n;

  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const num = (2 * muA * muB + C1) * (2 * cov + C2);
  const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
  return num / den;
}

function lumaArray(img, W, H) {
  const out = new Float32Array(W * H);
  const src = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * img.width + x) * 4;
      out[y * W + x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
  }
  return out;
}
```

- [ ] **Step 2: Register**

Import `thumbnailFilter` in index.js, add `thumbnail: thumbnailFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tile (no new tab yet)**

In `js/presets.js`, under `overview` tab, append:
```js
      { filterId: 'thumbnail', presetName: 'Show' },
```

- [ ] **Step 4: Browser verification**

Load a phone photo (usually has EXIF thumbnail). Thumbnail tile should show "present", size, and an SSIM near 1.0. Load an edited-then-resaved photo (e.g. crop in Preview.app but preserve EXIF thumbnail) — SSIM should drop.

Load a PNG — should show "Not a JPEG."

- [ ] **Step 5: Commit**

```
git add js/filters/thumbnail.js js/filters/index.js js/presets.js
git commit -m "feat: add thumbnail extract + SSIM filter

Parses EXIF IFD1 thumbnail, compares against downscaled main via
single-scale SSIM. Alerts if similarity < 0.85 (likely edit)."
```

---

## Task 8: gps filter

**Goal:** Decode GPS EXIF tags, emit decimal lat/lon and OpenStreetMap URL entry.

**Files:**
- Create: `js/filters/gps.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/gps.js`**

```js
import { readBuffer, parseExif, gpsToDecimal } from './util/exif.js';

/**
 * GPS filter — decodes GPS EXIF sub-IFD, emits decimal lat/lon + OSM link.
 */
export const gpsFilter = {
  id: 'gps',
  name: 'GPS',
  slow: false,
  meta: true,
  presets: [{ name: 'All', params: {} }],
  defaultPreset: 'All',
  paramSchema: [],

  async apply(imageData, _params, _srcCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };

    const t = parsed.tags;
    const lat = gpsToDecimal(t.GPSLatitude, t.GPSLatitudeRef);
    const lon = gpsToDecimal(t.GPSLongitude, t.GPSLongitudeRef);
    if (lat == null || lon == null) {
      return { entries: [{ label: 'GPS', detail: 'absent or unparseable', severity: 'info' }] };
    }

    const entries = [
      { label: 'Latitude',  detail: `${lat.toFixed(6)}° ${t.GPSLatitudeRef || ''}`.trim() },
      { label: 'Longitude', detail: `${lon.toFixed(6)}° ${t.GPSLongitudeRef || ''}`.trim() },
    ];
    if (typeof t.GPSAltitude === 'number') {
      entries.push({ label: 'Altitude', detail: `${t.GPSAltitude.toFixed(1)} m` });
    }
    if (t.GPSDateStamp) {
      entries.push({ label: 'Date', detail: String(t.GPSDateStamp) });
    }
    entries.push({
      label:  'OSM',
      detail: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
    });
    return { entries };
  },
};
```

- [ ] **Step 2: Register**

Import `gpsFilter` in index.js, add `gps: gpsFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tile**

In `js/presets.js` under `overview`, append:
```js
      { filterId: 'gps', presetName: 'All' },
```

- [ ] **Step 4: Browser verification**

Load a geotagged JPEG — lat/lon/OSM link entries should appear. Load a non-geotagged JPEG — "GPS absent" message. Load a PNG — "Not a JPEG."

- [ ] **Step 5: Commit**

```
git add js/filters/gps.js js/filters/index.js js/presets.js
git commit -m "feat: add GPS filter

Decimal lat/lon from EXIF GPS sub-IFD plus copyable OpenStreetMap URL."
```

---

## Task 9: quantization filter

**Goal:** Dump JPEG DQT tables + estimated quality.

**Files:**
- Create: `js/filters/quantization.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/quantization.js`**

```js
import { readBuffer, parseExif, estimateJpegQuality } from './util/exif.js';

/**
 * JPEG quantization table dump.
 * Parses DQT segments and renders each table as an 8x8 flattened value list
 * plus an estimated quality factor relative to Annex K luma reference.
 */
export const quantizationFilter = {
  id: 'quantization',
  name: 'Quant Tables',
  slow: false,
  meta: true,
  presets: [{ name: 'All Tables', params: {} }],
  defaultPreset: 'All Tables',
  paramSchema: [],

  async apply(imageData, _params, _src, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };
    if (!parsed.dqtTables.length) {
      return { entries: [{ label: 'DQT', detail: 'no tables found' }] };
    }

    const entries = [];
    for (const table of parsed.dqtTables) {
      const q = estimateJpegQuality(table.values);
      entries.push({
        label:  `DQT ${table.index}`,
        detail: `precision=${table.precision === 0 ? '8-bit' : '16-bit'}`,
      });
      entries.push({
        label:  `DQT ${table.index} est Q`,
        detail: q == null ? 'unknown' : `${q}`,
      });
      // Split the 64 values into 8 rows of 8 for easier reading
      for (let row = 0; row < 8; row++) {
        const vals = table.values.slice(row * 8, row * 8 + 8).join(' ');
        entries.push({ label: `DQT ${table.index}[${row}]`, detail: vals });
      }
    }
    return { entries };
  },
};
```

- [ ] **Step 2: Register**

Import `quantizationFilter` in index.js, add `quantization: quantizationFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tile**

In `js/presets.js` under `compression`, append:
```js
      { filterId: 'quantization', presetName: 'All Tables' },
```

- [ ] **Step 4: Browser verification**

Load any JPEG. Compression tab → Quant Tables tile should show DQT 0 (and usually DQT 1) with 8 rows of 8 values and an estimated Q. On a Q=90 re-save, estimated Q should be ≈ 90.

- [ ] **Step 5: Commit**

```
git add js/filters/quantization.js js/filters/index.js js/presets.js
git commit -m "feat: add JPEG DQT table dump

Parses DQT segments, shows 8×8 values and estimates quality
via Annex K luma ratio match."
```

---

## Task 10: strings filter

**Goal:** Extract printable-ASCII runs from raw file bytes.

**Files:**
- Create: `js/filters/strings.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/strings.js`**

```js
import { readBuffer } from './util/exif.js';

/**
 * Strings filter — unix `strings(1)`-style extractor for raw file bytes.
 * ASCII and UTF-16LE modes. Caps output at 200 runs, 120 chars each.
 */
export const stringsFilter = {
  id: 'strings',
  name: 'Strings',
  slow: false,
  meta: true,
  presets: [
    { name: 'ASCII ≥6',  params: { minLength: 6,  encoding: 'ascii'    } },
    { name: 'ASCII ≥8',  params: { minLength: 8,  encoding: 'ascii'    } },
    { name: 'UTF-16 ≥6', params: { minLength: 6,  encoding: 'utf16le'  } },
  ],
  defaultPreset: 'ASCII ≥6',
  paramSchema: [
    { id: 'minLength', label: 'Min Length', type: 'range', min: 4, max: 16, step: 1 },
    {
      id: 'encoding', label: 'Encoding', type: 'select',
      options: [
        { value: 'ascii',   label: 'ASCII' },
        { value: 'utf16le', label: 'UTF-16LE' },
        { value: 'both',    label: 'Both' },
      ],
    },
  ],

  async apply(imageData, params, _src, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const bytes = new Uint8Array(buf);

    const runs = [];
    const { minLength, encoding } = params;
    if (encoding === 'ascii' || encoding === 'both') collectAscii(bytes, minLength, runs);
    if (encoding === 'utf16le' || encoding === 'both') collectUtf16le(bytes, minLength, runs);

    const MAX = 200;
    const trimmed = runs.slice(0, MAX);
    const entries = trimmed.map(r => ({
      label: `0x${r.offset.toString(16).padStart(8, '0')}`,
      detail: r.text.length > 120 ? r.text.slice(0, 117) + '…' : r.text,
    }));
    if (runs.length > MAX) {
      entries.push({ label: '…', detail: `(${runs.length - MAX} more truncated)`, severity: 'info' });
    }
    if (!entries.length) entries.push({ label: 'none', detail: 'no runs found', severity: 'info' });
    return { entries };
  },
};

function isPrintable(b) { return b >= 0x20 && b <= 0x7E; }

function collectAscii(bytes, min, runs) {
  let start = -1;
  for (let i = 0; i <= bytes.length; i++) {
    const printable = i < bytes.length && isPrintable(bytes[i]);
    if (printable && start < 0) start = i;
    if (!printable && start >= 0) {
      const len = i - start;
      if (len >= min) {
        runs.push({ offset: start, text: bytesToString(bytes, start, len) });
      }
      start = -1;
    }
  }
}

function collectUtf16le(bytes, min, runs) {
  let start = -1;
  let count = 0;
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const lo = bytes[i], hi = bytes[i + 1];
    const printable = hi === 0 && isPrintable(lo);
    if (printable) {
      if (start < 0) { start = i; count = 0; }
      count++;
    } else {
      if (start >= 0 && count >= min) {
        const text = decodeUtf16LE(bytes, start, count);
        runs.push({ offset: start, text });
      }
      start = -1; count = 0;
    }
  }
  if (start >= 0 && count >= min) {
    runs.push({ offset: start, text: decodeUtf16LE(bytes, start, count) });
  }
}

function bytesToString(bytes, start, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(bytes[start + i]);
  return s;
}

function decodeUtf16LE(bytes, start, count) {
  let s = '';
  for (let i = 0; i < count; i++) s += String.fromCharCode(bytes[start + i * 2]);
  return s;
}
```

- [ ] **Step 2: Register**

Import `stringsFilter` in index.js, add `strings: stringsFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tile**

In `js/presets.js` under `overview`, append:
```js
      { filterId: 'strings', presetName: 'ASCII ≥6' },
```

- [ ] **Step 4: Browser verification**

Load a JPEG with EXIF Software tag set — strings output should include that software name with its offset. Load `cat cover.jpg payload.zip > stego.jpg` — output should include file names from the zip central directory. Switch to ASCII ≥8 — fewer, longer results.

- [ ] **Step 5: Commit**

```
git add js/filters/strings.js js/filters/index.js js/presets.js
git commit -m "feat: add strings filter

Unix strings(1)-style extraction from raw bytes. ASCII and UTF-16LE.
Helpful for flag / appended-data discovery."
```

---

## Task 11: autodetect filter

**Goal:** Meta-filter that runs forensic heuristics including 1-bit alpha stego detection.

**Files:**
- Create: `js/filters/autodetect.js`
- Modify: `js/filters/index.js`, `js/presets.js`

- [ ] **Step 1: Write `js/filters/autodetect.js`**

```js
import { readBuffer, parseExif, gpsToDecimal } from './util/exif.js';

/**
 * Autodetect — runs forensic heuristics and reports anomalies.
 * Output: { entries: [{ label, detail, severity }] }
 *
 * Severities: 'info', 'warn', 'alert'
 */
export const autodetectFilter = {
  id: 'autodetect',
  name: 'Auto-Detect',
  slow: true,
  meta: true,
  presets: [{ name: 'All', params: {} }],
  defaultPreset: 'All',
  paramSchema: [],

  async apply(imageData, _params, sourceCanvas, rawFile) {
    const entries = [];

    alphaLsbStego(imageData, entries);
    bitplaneEntropy(imageData, entries);

    if (rawFile) {
      const buf = await readBuffer(rawFile);
      const bytes = new Uint8Array(buf);

      trailingBytes(bytes, entries);
      embeddedMagic(bytes, entries);
      dimensionMismatch(buf, imageData, entries);
      await thumbnailSsim(buf, sourceCanvas, entries);
      await doubleJpegHint(imageData, entries);
    }

    if (!entries.length) entries.push({ label: 'Clean', detail: 'no anomalies found', severity: 'info' });
    return { entries };
  },
};

// ----- Heuristic 1: Alpha LSB stego -----
function alphaLsbStego(img, entries) {
  const src = img.data;
  const n = img.width * img.height;
  let alphaVariance = 0, alphaMean = 0, ones = 0;
  for (let i = 3; i < src.length; i += 4) alphaMean += src[i];
  alphaMean /= n;
  for (let i = 3; i < src.length; i += 4) {
    const d = src[i] - alphaMean;
    alphaVariance += d * d;
    if (src[i] & 1) ones++;
  }
  alphaVariance /= n;

  const p = ones / n;
  const entropy = p === 0 || p === 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  const alphaVaries = alphaVariance > 0.5;

  entries.push({
    label: 'Alpha channel',
    detail: alphaVaries
      ? `mean=${alphaMean.toFixed(1)} variance=${alphaVariance.toFixed(2)} bit0 p=${p.toFixed(4)} H=${entropy.toFixed(3)}`
      : `uniform (mean=${alphaMean.toFixed(1)})`,
    severity: 'info',
  });

  const suspicious =
    alphaVaries &&
    p > 0.48 && p < 0.52 &&
    entropy > 0.98;
  if (suspicious) {
    entries.push({
      label:    'Alpha LSB stego',
      detail:   `p=${p.toFixed(4)} H=${entropy.toFixed(3)} — bit-0 distribution is suspiciously uniform`,
      severity: 'alert',
    });
  }
}

// ----- Heuristic 2: Bit-plane entropy asymmetry -----
function bitplaneEntropy(img, entries) {
  const src = img.data;
  const n = img.width * img.height;
  const channels = [
    { name: 'R',    idx: 0    },
    { name: 'G',    idx: 1    },
    { name: 'B',    idx: 2    },
    { name: 'A',    idx: 3    },
    { name: 'Luma', idx: null },
  ];
  const results = [];
  for (const c of channels) {
    let ones = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const v = c.idx == null
        ? ((0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0)
        : src[i + c.idx];
      if (v & 1) ones++;
    }
    const r = ones / n;
    const h = r === 0 || r === 1 ? 0 : -(r * Math.log2(r) + (1 - r) * Math.log2(1 - r));
    results.push({ name: c.name, entropy: h });
    entries.push({
      label:    `Bit0 entropy ${c.name}`,
      detail:   h.toFixed(3),
      severity: 'info',
    });
  }
  results.sort((a, b) => b.entropy - a.entropy);
  const top = results[0];
  const median = results[Math.floor(results.length / 2)].entropy;
  if (top.entropy >= 0.98 && median <= 0.90) {
    entries.push({
      label:    'Bit0 entropy asymmetry',
      detail:   `${top.name} entropy ${top.entropy.toFixed(3)} vs median ${median.toFixed(3)}`,
      severity: 'warn',
    });
  }
}

// ----- Heuristic 3: Trailing bytes -----
function trailingBytes(bytes, entries) {
  // JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    const eoi = findLast(bytes, [0xFF, 0xD9]);
    if (eoi >= 0 && eoi + 2 < bytes.length) {
      const trail = bytes.length - (eoi + 2);
      entries.push({
        label:    'Trailing bytes (JPEG)',
        detail:   `${trail} bytes after EOI: ${hexPreview(bytes, eoi + 2, Math.min(64, trail))}`,
        severity: 'alert',
      });
    }
  } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    // PNG: find IEND chunk end
    let p = 8;
    let iendEnd = -1;
    while (p + 8 <= bytes.length) {
      const len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
      const typeStart = p + 4;
      const isIend =
        bytes[typeStart] === 0x49 && bytes[typeStart + 1] === 0x45 &&
        bytes[typeStart + 2] === 0x4E && bytes[typeStart + 3] === 0x44;
      p = typeStart + 4 + len + 4; // data + CRC
      if (isIend) { iendEnd = p; break; }
      if (p > bytes.length) break;
    }
    if (iendEnd > 0 && iendEnd < bytes.length) {
      const trail = bytes.length - iendEnd;
      entries.push({
        label:    'Trailing bytes (PNG)',
        detail:   `${trail} bytes after IEND: ${hexPreview(bytes, iendEnd, Math.min(64, trail))}`,
        severity: 'alert',
      });
    }
  }
}

function findLast(bytes, marker) {
  for (let i = bytes.length - marker.length; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

function hexPreview(bytes, start, len) {
  const parts = [];
  for (let i = 0; i < len; i++) parts.push(bytes[start + i].toString(16).padStart(2, '0'));
  return parts.join(' ');
}

// ----- Heuristic 4: Embedded magic -----
const MAGICS = [
  { name: 'ZIP',  sig: [0x50, 0x4B, 0x03, 0x04] },
  { name: 'PNG',  sig: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { name: 'JPEG', sig: [0xFF, 0xD8, 0xFF] },
  { name: 'RAR',  sig: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07] },
  { name: '7z',   sig: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
  { name: 'PDF',  sig: [0x25, 0x50, 0x44, 0x46, 0x2D] },
  { name: 'GIF',  sig: [0x47, 0x49, 0x46, 0x38] },
];

function embeddedMagic(bytes, entries) {
  // Determine the file's own magic so we can skip the first hit.
  let ownName = null;
  for (const m of MAGICS) {
    if (startsWith(bytes, m.sig, 0)) { ownName = m.name; break; }
  }
  for (const m of MAGICS) {
    let from = 1;
    while (from < bytes.length) {
      const idx = findSig(bytes, m.sig, from);
      if (idx < 0) break;
      if (!(m.name === ownName && idx === 0)) {
        entries.push({
          label:    `Embedded ${m.name}`,
          detail:   `offset 0x${idx.toString(16)}`,
          severity: 'alert',
        });
      }
      from = idx + 1;
    }
  }
}

function startsWith(bytes, sig, at) {
  if (at + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

function findSig(bytes, sig, from) {
  for (let i = from; i + sig.length <= bytes.length; i++) {
    let ok = true;
    for (let j = 0; j < sig.length; j++) {
      if (bytes[i + j] !== sig[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// ----- Heuristic 5: Double JPEG hint -----
async function doubleJpegHint(imageData, entries) {
  // Encode at a small set of Qs at reduced resolution, measure global MSE.
  const W = Math.min(imageData.width, 256);
  const H = Math.min(imageData.height, 256);
  const scale = Math.min(W / imageData.width, H / imageData.height, 1);
  const sw = Math.round(imageData.width * scale);
  const sh = Math.round(imageData.height * scale);

  const src = document.createElement('canvas');
  src.width = sw; src.height = sh;
  const srcCtx = src.getContext('2d');
  // blit imageData onto a temp canvas and scale
  const full = document.createElement('canvas');
  full.width = imageData.width; full.height = imageData.height;
  full.getContext('2d').putImageData(imageData, 0, 0);
  srcCtx.drawImage(full, 0, 0, sw, sh);
  const srcData = srcCtx.getImageData(0, 0, sw, sh).data;

  const QS = [50, 70, 85, 90];
  const curve = [];
  for (const q of QS) {
    const blob = await new Promise(r => src.toBlob(r, 'image/jpeg', q / 100));
    const url = URL.createObjectURL(blob);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    const c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    c.getContext('2d').drawImage(img, 0, 0);
    const cd = c.getContext('2d').getImageData(0, 0, sw, sh).data;
    let sum = 0;
    for (let i = 0; i < srcData.length; i += 4) {
      const dr = srcData[i] - cd[i];
      const dg = srcData[i + 1] - cd[i + 1];
      const db = srcData[i + 2] - cd[i + 2];
      sum += dr*dr + dg*dg + db*db;
    }
    curve.push({ q, mse: sum / (sw * sh * 3) });
  }

  let minIdx = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i].mse < curve[minIdx].mse) minIdx = i;
  const summary = curve.map(c => `Q${c.q}:${c.mse.toFixed(1)}`).join(' ');
  if (minIdx !== curve.length - 1) {
    entries.push({
      label:    'Double JPEG hint',
      detail:   `MSE min at Q${curve[minIdx].q} (not highest tested). Curve: ${summary}`,
      severity: 'warn',
    });
  }
}

function loadImg(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload  = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

// ----- Heuristic 7: Thumbnail SSIM -----
async function thumbnailSsim(buf, sourceCanvas, entries) {
  const parsed = parseExif(buf);
  if (parsed.error === 'not-jpeg') return;
  if (!parsed.thumbnailBytes) return;

  const blob = new Blob([parsed.thumbnailBytes], { type: 'image/jpeg' });
  const url = URL.createObjectURL(blob);
  let img;
  try { img = await loadImg(url); } catch { URL.revokeObjectURL(url); return; }
  URL.revokeObjectURL(url);

  const tC = document.createElement('canvas');
  tC.width = img.naturalWidth; tC.height = img.naturalHeight;
  tC.getContext('2d').drawImage(img, 0, 0);
  const dC = document.createElement('canvas');
  dC.width = tC.width; dC.height = tC.height;
  dC.getContext('2d').drawImage(sourceCanvas, 0, 0, dC.width, dC.height);

  const tData = tC.getContext('2d').getImageData(0, 0, tC.width, tC.height);
  const dData = dC.getContext('2d').getImageData(0, 0, dC.width, dC.height);
  const ssim = ssimSimple(tData, dData);
  if (ssim < 0.85) {
    entries.push({
      label:    'Thumbnail mismatch',
      detail:   `SSIM=${ssim.toFixed(3)} — main image differs from embedded thumbnail`,
      severity: 'alert',
    });
  }
}

function ssimSimple(a, b) {
  const W = Math.min(a.width, b.width);
  const H = Math.min(a.height, b.height);
  const la = luma(a, W, H), lb = luma(b, W, H);
  const n = W * H;
  let sA = 0, sB = 0;
  for (let i = 0; i < n; i++) { sA += la[i]; sB += lb[i]; }
  const mA = sA / n, mB = sB / n;
  let vA = 0, vB = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = la[i] - mA, db = lb[i] - mB;
    vA += da*da; vB += db*db; cov += da*db;
  }
  vA /= n; vB /= n; cov /= n;
  const C1 = (0.01 * 255) ** 2, C2 = (0.03 * 255) ** 2;
  return ((2*mA*mB + C1) * (2*cov + C2)) / ((mA*mA + mB*mB + C1) * (vA + vB + C2));
}
function luma(img, W, H) {
  const out = new Float32Array(W * H);
  const src = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * img.width + x) * 4;
      out[y * W + x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
  }
  return out;
}

// ----- Heuristic 8: Dimension mismatch -----
function dimensionMismatch(buf, imageData, entries) {
  const parsed = parseExif(buf);
  if (parsed.error === 'not-jpeg') return;
  const xDim = parsed.tags.PixelXDimension;
  const yDim = parsed.tags.PixelYDimension;
  if (typeof xDim === 'number' && typeof yDim === 'number') {
    if (xDim !== imageData.width || yDim !== imageData.height) {
      entries.push({
        label:    'Dimension mismatch',
        detail:   `EXIF says ${xDim}×${yDim}, decoded ${imageData.width}×${imageData.height}`,
        severity: 'warn',
      });
    }
  }
}
```

Note: Heuristic 6 (palette anomaly) is omitted. To implement it robustly requires parsing the PNG `PLTE` and `tRNS` chunks plus identifying indexed-color mode from the IHDR. The spec listed it but it depends on information the browser doesn't trivially expose for indexed PNGs (decoded ImageData is already RGBA). A follow-up task can add it; deferring does not block the rest of autodetect. Record this deferral in the commit body.

- [ ] **Step 2: Register**

Import `autodetectFilter` in index.js, add `autodetect: autodetectFilter,` to `FILTERS`.

- [ ] **Step 3: Temp tile**

In `js/presets.js` under `overview`, append:
```js
      { filterId: 'autodetect', presetName: 'All' },
```

- [ ] **Step 4: Browser verification**

Test matrix:
1. Clean phone JPEG: every heuristic reports `info` only. Alpha uniform. Bit-0 entropies between 0.7 and 0.95.
2. PNG with a known alpha-LSB payload: Alpha LSB stego fires `alert`.
3. `cat photo.jpg payload.zip > stego.jpg`: Trailing bytes + Embedded ZIP both fire.
4. JPEG saved at Q90 then re-saved at Q70: Double JPEG hint warns.
5. JPEG with EXIF thumbnail replaced by an unrelated image (exiftool): Thumbnail mismatch fires.

Step-by-step instructions for producing test case 2 without writing custom code:

```bash
# on a Mac with Python 3 + Pillow installed
python3 - <<'PY'
from PIL import Image
import random
img = Image.open('cover.png').convert('RGBA')
pixels = list(img.getdata())
random.seed(1)
new = [(r, g, b, (a & ~1) | (random.randint(0, 1))) for (r, g, b, a) in pixels]
img.putdata(new)
img.save('stego.png')
PY
```

Then `stego.png`'s alpha LSB is uniformly random → the heuristic should fire.

- [ ] **Step 5: Commit**

```
git add js/filters/autodetect.js js/filters/index.js js/presets.js
git commit -m "feat: add autodetect meta filter

Heuristics: alpha LSB stego, bit-plane entropy asymmetry, trailing
bytes (JPEG/PNG), embedded magic numbers, double-JPEG MSE curve,
EXIF dimension mismatch, thumbnail SSIM. Palette anomaly deferred."
```

---

## Task 12: Final preset tab layout

**Goal:** Replace temporary per-task preset additions with the final organized tab layout per spec §4. Adds two new tabs (Steganography, Metadata). Extends existing tabs with the planned tile lists.

**Files:**
- Modify: `js/presets.js`

- [ ] **Step 1: Replace contents of `js/presets.js`**

Overwrite with:

```js
/**
 * Built-in grid preset tabs.
 * Each tab is an ordered list of { filterId, presetName } pairs.
 */
export const BUILTIN_TABS = [
  {
    id: 'overview',
    name: 'Overview',
    tiles: [
      { filterId: 'autodetect', presetName: 'All' },
      { filterId: 'channel',    presetName: 'Red' },
      { filterId: 'channel',    presetName: 'Green' },
      { filterId: 'channel',    presetName: 'Blue' },
      { filterId: 'bitplane',   presetName: 'Alpha Bit 0' },
      { filterId: 'ela',        presetName: 'High Quality (95)' },
      { filterId: 'noise',      presetName: 'Soft' },
      { filterId: 'gradient',   presetName: 'Both' },
      { filterId: 'hsv',        presetName: 'Hue' },
      { filterId: 'metadata',   presetName: 'All' },
    ],
  },
  {
    id: 'color',
    name: 'Color',
    tiles: [
      { filterId: 'channel', presetName: 'Red' },
      { filterId: 'channel', presetName: 'Green' },
      { filterId: 'channel', presetName: 'Blue' },
      { filterId: 'channel', presetName: 'Alpha' },
      { filterId: 'hsv',     presetName: 'Hue' },
      { filterId: 'hsv',     presetName: 'Saturation' },
      { filterId: 'hsv',     presetName: 'Value' },
      { filterId: 'lab',     presetName: 'L*' },
      { filterId: 'lab',     presetName: 'a*' },
      { filterId: 'lab',     presetName: 'b*' },
      { filterId: 'pca',     presetName: 'PC1' },
      { filterId: 'pca',     presetName: 'PC2' },
      { filterId: 'pca',     presetName: 'PC3' },
    ],
  },
  {
    id: 'compression',
    name: 'Compression',
    tiles: [
      { filterId: 'ela',          presetName: 'Low Quality (65)' },
      { filterId: 'ela',          presetName: 'Medium (80)' },
      { filterId: 'ela',          presetName: 'High Quality (95)' },
      { filterId: 'jpeg-ghost',   presetName: 'Q70' },
      { filterId: 'jpeg-ghost',   presetName: 'Q85' },
      { filterId: 'quantization', presetName: 'All Tables' },
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
      { filterId: 'wavelet',   presetName: 'Residual L1' },
      { filterId: 'histogram', presetName: 'Graph All' },
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
  {
    id: 'stego',
    name: 'Steganography',
    tiles: [
      { filterId: 'autodetect', presetName: 'All' },
      { filterId: 'bitplane',   presetName: 'Alpha Bit 0' },
      { filterId: 'bitplane',   presetName: 'Red Bit 0' },
      { filterId: 'bitplane',   presetName: 'Green Bit 0' },
      { filterId: 'bitplane',   presetName: 'Blue Bit 0' },
      { filterId: 'bitplane',   presetName: 'Luma Bit 0' },
      { filterId: 'pca',        presetName: 'PC3' },
      { filterId: 'strings',    presetName: 'ASCII ≥6' },
    ],
  },
  {
    id: 'metadata',
    name: 'Metadata',
    tiles: [
      { filterId: 'metadata',     presetName: 'All' },
      { filterId: 'thumbnail',    presetName: 'Show' },
      { filterId: 'gps',          presetName: 'All' },
      { filterId: 'quantization', presetName: 'All Tables' },
      { filterId: 'strings',      presetName: 'ASCII ≥8' },
      { filterId: 'autodetect',   presetName: 'All' },
    ],
  },
];
```

- [ ] **Step 2: Browser verification**

Reload page (may need hard refresh to bust module cache). Tabs now include Steganography and Metadata. Ctrl+6 should switch to Steganography, Ctrl+7 to Metadata. All tiles render without errors (any missing preset would throw in the console).

Existing keybind `Ctrl+1–5` still works; `Ctrl+6–9` for the new tabs. If the keybind bar / hint UI lists numbers explicitly, it may need updating separately — check `index.html` and the keybind bar rendering in `app.js`; if it dynamically reads tab count, nothing to change.

Check by running:
```
grep -n "Ctrl+" js/app.js index.html
```
If any hardcoded "Ctrl+1–5" string exists, update to "Ctrl+1–9" or "Ctrl+1–N". If not, proceed.

- [ ] **Step 3: Commit**

```
git add js/presets.js
git commit -m "feat: reorganize preset tabs with new filters

Adds Steganography and Metadata tabs. Extends Color (PCA),
Compression (JPEG ghost, quantization), Noise (wavelet, histogram),
Overview (autodetect, bitplane Alpha Bit 0)."
```

---

## Task 13: Update README

**Goal:** Document the new filters.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the filter file list in README**

Open `README.md`. Find the architecture block that lists `js/filters/`. Replace that block with:

```
js/filters/
  index.js          Filter registry + runFilter() helper
  util/exif.js      Shared EXIF parser (used by metadata/thumbnail/gps/quant/autodetect)
  channel.js        Channel separation (R/G/B/A)
  ela.js            Error Level Analysis (JPEG re-save diff)
  noise.js          Noise extraction (box-blur residual)
  gradient.js       Luminance gradient (Sobel)
  hsv.js            HSV channel extraction
  lab.js            LAB color space channels
  frequency.js      Frequency split (high/low pass)
  clone.js          Clone detection (block hash matching)
  metadata.js       EXIF tag dump
  bitplane.js       Bit-plane extraction (R/G/B/A/Luma, bits 0-7)
  pca.js            PCA projection (PC1/PC2/PC3)
  wavelet.js        Haar wavelet residual / detail
  histogram.js      Histogram graph / stretch / equalize
  jpeg-ghost.js     Per-block MSE vs re-encoded (double compression)
  thumbnail.js      EXIF thumbnail extract + SSIM vs main
  gps.js            GPS decimal coords + OSM URL
  quantization.js   JPEG DQT table dump + estimated quality
  strings.js        Printable-run extraction
  autodetect.js     Meta filter: alpha-LSB stego, trailing bytes, embedded magic, etc.
```

- [ ] **Step 2: Add an "Autodetect heuristics" section**

Under the existing "Filter contract" section, insert a new H3:

```markdown
### Autodetect heuristics

The `autodetect` filter runs a battery of checks and emits severity-ranked entries:

- **Alpha LSB stego** — chi-square / entropy test on alpha-channel bit 0. Fires when alpha varies but its LSB distribution is suspiciously uniform (hallmark of 1-bit payload).
- **Bit-plane entropy asymmetry** — reports bit-0 entropy for R/G/B/A/Luma; warns if one channel is near 1.0 while others are < 0.9.
- **Trailing bytes** — data after JPEG EOI or PNG IEND.
- **Embedded magic** — scans for ZIP/PNG/JPEG/RAR/7z/PDF/GIF signatures after the file's own header.
- **Double-JPEG hint** — re-encodes at Q=50/70/85/90 at low resolution; warns if MSE minimum isn't at the highest tested Q.
- **EXIF thumbnail mismatch** — SSIM of EXIF thumbnail against downscaled main; alerts below 0.85.
- **Dimension mismatch** — EXIF PixelXDimension vs decoded dimensions.
```

- [ ] **Step 3: Commit**

```
git add README.md
git commit -m "docs: list new filters and autodetect heuristics"
```

---

## Task 14: Push branch (do not open PR)

- [ ] **Step 1: Push**

```
git push -u origin filters/forensics-expansion
```

- [ ] **Step 2: Stop here**

Do not run `gh pr create`. User has explicitly asked to review locally before a PR is opened. Report to user with: branch name, commit count, final local verification result.

---

## Self-Review notes (fix inline before execution)

This section is not a task to execute; it is evidence that the plan was reviewed.

- **Spec coverage:** every filter, every heuristic, every preset change from the spec maps to a task. Palette anomaly heuristic is explicitly deferred with commit-note rationale.
- **Placeholders:** none. Every code block is complete. Every verification step names exact commands and expected signals.
- **Type consistency:** `FILTERS` map key matches `filter.id` for each new filter. `paramSchema` param `id`s match `params` keys in each preset and in `apply()`. `entries` severity strings are consistently `'info'`, `'warn'`, `'alert'`.
- **Behavior-change guard:** Task 1 Step 3 explicitly checks whether `metadata.js`'s return-shape refactor is compatible with `app.js` before moving on. If not, engineer falls back to preserving the original shape.
- **Keybind check:** Task 12 Step 2 checks for hardcoded `Ctrl+1–5` references before adding two new tabs.

---

## Execution

Plan complete and saved to `docs/superpowers/plans/2026-04-20-filter-expansion.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
