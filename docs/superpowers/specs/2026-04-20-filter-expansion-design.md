# Filter Expansion — Design

Date: 2026-04-20
Status: Approved

## Goal

Expand RapidForensics filter library with ten new filters covering bit-plane stego detection, PCA, wavelet residuals, JPEG ghost, histogram, and expanded metadata parsing. Add an `autodetect` meta filter that scans for common forensic anomalies including 1-bit alpha-channel steganography.

All additions run client-side. No framework changes. Each filter conforms to the existing `apply(imageData, params, sourceCanvas, rawFile)` contract.

## Non-Goals

- Server-side processing.
- Machine-learning-based classifiers. Heuristics only.
- Shipping test images.
- Publishing the PR (user will review the local branch first).

## Architecture

No changes to `app.js`, state model, or the grid rendering path. All ten filters are new files registered in `js/filters/index.js`. Preset tabs updated in `js/presets.js`.

### New files

```
js/filters/bitplane.js      visual, fast
js/filters/pca.js           visual, slow
js/filters/wavelet.js       visual, fast
js/filters/histogram.js     visual, fast
js/filters/jpeg-ghost.js    visual, slow
js/filters/thumbnail.js     meta (entries)
js/filters/gps.js           meta (entries)
js/filters/quantization.js  meta (entries)
js/filters/strings.js       meta (entries)
js/filters/autodetect.js    meta (entries), slow
js/filters/util/exif.js     shared EXIF parser
```

### Shared utility

`js/filters/util/exif.js` extracts the EXIF parse logic currently private to `metadata.js`. Three consumers need it: `metadata`, `thumbnail`, `gps`, plus `quantization` for JPEG segment traversal. Refactor `metadata.js` to consume the util. No behavior change for existing metadata output.

## Filter Specs

### bitplane — `bitplane.js`

- `slow: false`, `meta: false`
- `paramSchema`:
  - `{ id: 'channel', type: 'select', options: ['R','G','B','A','Luma'] }`
  - `{ id: 'bit', type: 'range', min: 0, max: 7, step: 1 }`
- Output: binary mask, 0 or 255 per pixel on selected channel's selected bit, alpha=255
- Presets (each sets `channel` and `bit`):
  - `Alpha Bit 0` — `{channel:'A', bit:0}` (default)
  - `Red Bit 0` — `{channel:'R', bit:0}`
  - `Green Bit 0` — `{channel:'G', bit:0}`
  - `Blue Bit 0` — `{channel:'B', bit:0}`
  - `Luma Bit 0` — `{channel:'Luma', bit:0}`
  - `Alpha Bit 1` — `{channel:'A', bit:1}`

### pca — `pca.js`

- `slow: true`, `meta: false`
- Params: `component` (1|2|3), `normalize` (bool, default true)
- Algorithm:
  1. Compute 3×3 covariance of R,G,B over all pixels
  2. Closed-form 3×3 eigendecomposition (Jacobi iteration, capped at 32 sweeps)
  3. Project each pixel onto chosen eigenvector
  4. If normalize: linear rescale projection range to 0–255
- Output: grayscale ImageData
- Presets: `PC1` (default), `PC2`, `PC3`

### wavelet — `wavelet.js`

- `slow: false`, `meta: false`
- Params: `level` (1–3), `mode` (`residual`|`detail`), `threshold` (0–32)
- Algorithm:
  1. Per-channel Haar DWT to `level` levels
  2. Soft-threshold all detail coefficients by `threshold`
  3. Inverse DWT
  4. `residual` mode → `original − reconstruction`, centered at 128
  5. `detail` mode → amplify HH sub-band of chosen level
- Presets: `Residual L1` (default), `Residual L2`, `Detail L1`

### histogram — `histogram.js`

- `slow: false`, `meta: false`
- Params: `mode` (`graph`|`stretch`|`equalize`), `channel` (`R`|`G`|`B`|`Luma`|`All`)
- Modes:
  - `graph` — renders 256-bin histogram overlay on black canvas at image aspect
  - `stretch` — linear remap `[min,max] → [0,255]` per channel
  - `equalize` — CDF-based equalization per channel
- Presets: `Graph All` (default), `Stretch Luma`, `Equalize Luma`

### jpeg-ghost — `jpeg-ghost.js`

- `slow: true`, `meta: false`
- Params: `quality` (30–95, step 5), `blockSize` (8|16)
- Algorithm:
  1. Encode `sourceCanvas` as JPEG at `quality` via `canvas.toBlob('image/jpeg', quality/100)`
  2. Decode back to ImageData
  3. Compute per-block mean squared error between original and re-encoded
  4. Render heatmap, hot = low error (region already at this quality → likely recompressed)
- Presets: `Q50`, `Q70` (default), `Q85`, `Q90`

### thumbnail — `thumbnail.js`

- `slow: false`, `meta: true`
- Params: none (one preset)
- Behavior:
  1. Parse EXIF IFD1 from `rawFile` for JPEG thumbnail bytes
  2. If present: decode, compute SSIM against downscaled original
  3. Output entries:
     - `{ label: 'Thumbnail', severity: 'info', detail: 'present' | 'absent' }`
     - `{ label: 'Size', detail: 'WxH' }` (if present)
     - `{ label: 'SSIM vs main', detail: '0.xxx', severity: 'alert' if <0.85 }` (if present)
- Presets: `Show` (only)

### gps — `gps.js`

- `slow: false`, `meta: true`
- Parses EXIF GPS sub-IFD. Converts lat/lon to decimal degrees.
- Entries:
  - `{ label: 'Latitude', detail: '…' }`
  - `{ label: 'Longitude', detail: '…' }`
  - `{ label: 'Altitude', detail: '… m' }` (if present)
  - `{ label: 'Timestamp', detail: '…' }` (if present)
  - `{ label: 'Map', detail: 'openstreetmap.org/?mlat=…&mlon=…' }` — copyable text only, no auto-fetch
- Entry renderer already supports link-looking strings; no user-fetch until clicked.
- Presets: `All`

### quantization — `quantization.js`

- `slow: false`, `meta: true`
- Parses JPEG DQT segments directly from raw bytes (no library).
- Entries per table:
  - `{ label: 'DQT N', detail: 'precision=… 64 values flattened' }`
  - `{ label: 'Est quality', detail: '…' }` — computed by ratio match to standard Annex K Q50 tables
- Presets: `All Tables`

### strings — `strings.js`

- `slow: false`, `meta: true`
- Params: `minLength` (4–16, default 6), `encoding` (`ascii`|`utf16le`|`both`)
- Scans raw file bytes, extracts printable runs meeting `minLength`.
- Caps output at first 200 runs; truncates each to 120 chars.
- Entries: `{ label: '0x…', detail: 'the string' }` (offset as label).
- Presets: `ASCII ≥6` (default), `ASCII ≥8`, `UTF-16 ≥6`.

### autodetect — `autodetect.js`

- `slow: true`, `meta: true`
- Params: none (one preset: `All`)
- Heuristics run in order. Each appends zero or more entries.

#### Heuristic 1: Alpha LSB stego

- Collect alpha-channel bit 0 across all pixels.
- Compute ratio p = (count of 1s) / N.
- Chi-square vs uniform 0.5: `χ² = (|p − 0.5| * 2 * sqrt(N))²`
- Also compute alpha variance. If alpha is fully opaque (variance 0) across all pixels, heuristic cannot flag.
- Flag conditions:
  - Alpha not uniformly 255, AND
  - Bit-0 distribution within 0.48–0.52 (suspiciously uniform — natural images cluster further from 0.5 when alpha varies)
  - AND per-pixel bit-0 entropy ≥ 0.98
- Severity: `alert`. Detail: `p=…, entropy=…`.

#### Heuristic 2: Bit-plane entropy asymmetry

- For each of R, G, B, A, Luma, compute Shannon entropy of bit 0 over all pixels.
- Report each as `info` entries.
- If one channel ≥ 0.98 while median of others ≤ 0.90 → additional `warn` entry naming the outlier channel.

#### Heuristic 3: Trailing bytes

- JPEG: locate last `FFD9` EOI marker. Bytes after → report count + first 64 hex.
- PNG: locate last `IEND` + 4-byte CRC. Bytes after → same.
- Non-empty trailer → `alert`.

#### Heuristic 4: Embedded magic

- Scan raw bytes for: `PK\x03\x04`, `\x89PNG\r\n\x1a\n`, `\xFFD8\xFF`, `Rar!\x1a\x07`, `7z\xBC\xAF\x27\x1C`, `%PDF-`.
- Skip the file's own header (first match of its own magic).
- Each additional match → `alert` entry with offset.

#### Heuristic 5: Double JPEG hint

- Run a fast jpeg-ghost sweep at Q=50, 70, 85, 90 at 1/4 resolution.
- If global-MSE minimum is not at the highest tested Q → `warn` with curve summary.

#### Heuristic 6: Palette anomaly (PNG indexed only)

- Parse `PLTE` chunk. Count unused entries by scanning IDAT-decoded pixels (already in `imageData`, compare RGB to palette).
- `warn` if ≥ 20% of palette entries unused.

#### Heuristic 7: Thumbnail SSIM

- Parse EXIF thumbnail directly via `util/exif.js` (does not depend on `thumbnail` filter having been rendered — autodetect stands alone).
- If thumbnail present and SSIM vs downscaled main < 0.85 → `alert`.

#### Heuristic 8: Dimension mismatch

- Compare EXIF `PixelXDimension`/`PixelYDimension` against decoded image dims.
- Mismatch → `warn`.

All heuristics that require raw bytes guard on `rawFile` being defined; if not, they skip silently (current `app.js` passes `rawFile` through).

## Preset Tab Changes

### New tab: Steganography

```js
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
```

### New tab: Metadata

```js
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
```

### Extend existing tabs

- Overview: append `autodetect All`, `bitplane Alpha Bit 0`
- Color: append `pca PC1`, `pca PC2`, `pca PC3`
- Compression: append `jpeg-ghost Q70`, `jpeg-ghost Q85`, `quantization All Tables`
- Noise: append `wavelet Residual L1`, `histogram Graph All`

## Testing

No test harness exists in the project. Manual verification plan runs for each filter before merge:

1. **Clean baseline** — load an unmodified phone photo. `autodetect` shows `info`-only entries; every new filter renders without error.
2. **Alpha LSB stego** — generate with ImageMagick:
   ```
   convert cover.png -define png:color-type=6 +depth 8 cover_rgba.png
   # embed 1-bit payload into alpha LSB via python PIL or custom script
   ```
   `autodetect` must flag `alert` on "Alpha LSB stego". `bitplane Alpha Bit 0` must show the payload.
3. **Appended zip** — `cat cover.jpg secret.zip > stego.jpg`. `autodetect` flags trailing bytes and embedded `PK` magic. `strings` shows ZIP entries.
4. **Recompressed JPEG** — save a photo at Q=90, reopen, re-save at Q=70. `jpeg-ghost Q90` should show a heatmap dip where recompression occurred. `autodetect` flags "Double JPEG hint".
5. **GPS-tagged photo** — iPhone sample. `gps` entries show correct lat/lon and OSM link.
6. **PNG with small palette** — 8-color palette PNG with 3 unused slots. `autodetect` flags palette anomaly.
7. **EXIF thumbnail mismatch** — swap thumbnail in an edited photo (exiftool). `thumbnail` reports SSIM < 0.85 with `alert`.

## Branch / PR Policy

- Branch: `filters/forensics-expansion`
- One commit per filter (easier review). Final commit updates `presets.js`, `index.js`, `README.md`.
- PR is **not** published. Branch is pushed locally for user review.

## Risks

- **PCA performance** on large images: Jacobi over 3×3 is cheap; covariance loop is the cost. `slow: true` gates it behind explicit Apply.
- **jpeg-ghost** encode round-trip via `toBlob` is async; filter `apply` already supports Promises.
- **DQT parsing** on non-JPEG `rawFile`: guard and return `{ entries: [{ label: 'Not a JPEG', severity: 'info' }] }`.
- **Raw-byte access**: existing filters already receive `rawFile`; no new plumbing needed.
- **Chi-square threshold tuning**: initial thresholds are conservative. May produce false negatives on stego with very low payload ratio. Refine after manual test pass 2.
