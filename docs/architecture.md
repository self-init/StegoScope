# StegoScope Architecture

Browser-based image forensics tool for CTF players and forensics analysts. Drop an image, inspect it through a grid of forensic filters, and iteratively drill down by promoting filtered outputs as the new base image. All processing is client-side — images never leave the browser.

---

## Overview

```
index.html          Shell — layout, DOM structure, zero inline JS
css/style.css       Dark theme (Photoshop/Photopea-inspired)
js/app.js           Central orchestrator — keyboard shortcuts, menu, init wiring
js/app/
  state.js          State object + helper functions
  cache.js          imageDataChecksum, makeCacheKey, runTile
  zoom.js           Zoom controls
  grid.js           Tile grid rendering + tile DOM construction
  keyboard.js        Tab bar keyboard navigation
  history.js        Undo/redo + history list rendering
  panel.js          Parameter panel + presets + promote
  preview.js         Preview overlay + text search
  menu.js           Menu bar + dropdown rendering
js/presets.js       Built-in grid tab definitions (8 tabs)
js/filters/
  index.js          Filter registry + getPresetParams()
  util/
    exif.js         Shared JPEG EXIF parser
    jpeg.js         JPEG round-trip utility (OffscreenCanvas-based, worker-safe)
  [30 individual filter files]
js/workers/
  pool.js           Worker pool — FilterWorkerPool class + getWorkerPool() singleton
docs/               User-facing documentation
```

**Tech stack:** Vanilla ES modules, Canvas 2D API, Web Workers, no build step, no framework. Serves directly from any static file server (`python3 -m http.server`, `npx serve`, etc.).

---

## State Model

All mutable state lives in a single `state` object in `js/app/state.js`:

| Key | Type | Purpose |
|-----|------|---------|
| `rawFile` | `File` | Original uploaded file (for filters that need raw bytes) |
| `baseCanvas` | `HTMLCanvasElement` | Current base canvas |
| `baseImageData` | `ImageData` | Current base ImageData — all filters run against this |
| `history[]` | `Array<{canvas, filterId, presetName, label}>` | Stack of analysis states |
| `activeHistoryIdx` | `number` | Current position in history (undo/redo) |
| `currentTabIdx` | `number` | Active tab index |
| `tiles[]` | `Array<TileDescriptor>` | Current tab's tiles with latest result cached |
| `panelOpen` | `boolean` | Parameter panel open |
| `panelTileIdx` | `number` | Which tile's panel is open |
| `panelDirty` | `boolean` | Unsaved param changes |
| `zoomLevel` | `number` (1–5) | Maps to tile widths 140/180/220/300/380px |

**TileDescriptor shape:**
```js
{
  filterId: string,
  presetName: string,
  params: object,           // resolved from preset
  resultImageData: ImageData | null,
  loading: boolean,
}
```

**History operations:**
- `promote(tileIdx)` — creates new canvas from tile output, pushes to `history`, sets `baseImageData` to tile's output, re-renders grid.
- `restoreHistory(idx)` — sets `baseImageData` to past entry's canvas. Non-destructive: forward history is preserved.

---

## Filter Registry (`js/filters/index.js`)

Central hub. Imports all 30 filters, exports `FILTERS` map and `getPresetParams()`.

**Filter contract:**

```js
{
  id:            string,
  name:          string,
  meta:          boolean,       // true = non-visual tile (text/entries output)
  presets:       Array<{ name: string, params: object }>,
  defaultPreset: string,
  paramSchema:   Array<{ id, label, type, ...typeArgs }>,

  apply(imageData, params, sourceCanvas, rawFile)
    // -> ImageData | { text: string } | { entries: Entry[] } | Promise<any>
}
```

---

## Worker Pool (`js/workers/pool.js`)

Every filter runs in a Web Worker. No filter runs on the main thread.

**`FilterWorkerPool`:**
- Spawns `navigator.hardwareConcurrency` workers at startup
- Round-robin dispatch across the pool
- Auto-respawns crashed workers
- Uses `transfer` for zero-copy ArrayBuffer / Uint8ClampedArray transfer
- Worker script is bundled as a blob URL (no bundler, no server-side toolchain)

**JPEG round-trip (`js/filters/util/jpeg.js`):**
- `OffscreenCanvas.convertToBlob()` → JPEG blob (encoder runs in worker thread)
- `createImageBitmap(blob)` → `ImageBitmap`
- `OffscreenCanvas.drawImage(bitmap)` → compressed `ImageData`
- Both `ela` and `jpeg-ghost` use this for the JPEG re-encode step

**Message protocol:**
```js
// Main → Worker
{ id, filterId, imageData: { data, width, height }, params, rawFile }

// Worker → Main
{ id, result }  |  { id, error: string }
```

---

## Preset Tabs (`js/presets.js`)

`BUILTIN_TABS` defines 8 named tabs, each an ordered list of `{ filterId, presetName }` pairs:

| Tab ID | Name | Filters |
|--------|------|---------|
| `overview` | Overview | autodetect, channel(R/G/B), bitplane(Alpha Bit 0), ela, noise, gradient(Both), hsv(Hue), metadata |
| `color` | Color | channel(R/G/B/A), hsv(H/S/V), lab(L*/a*/b*), pca(PC1/2/3), colormap(Viridis/Inferno/Jet), palette(File Palette/Top 64) |
| `compression` | Compression | ela(Q65/80/95), jpeg-ghost(Q70/Q85), quantization |
| `noise` | Noise | noise(Soft/Aggressive), frequency(High/Low Pass), wavelet, histogram |
| `structure` | Structure | gradient(Both/H/V), clone(Fast 16px) |
| `stego` | Steganography | autodetect, bitplane(R/G/B/A/Luma bit0), bitplane-xor(6 XOR combos), pca(PC3), strings, chi-square(Full/Top/Bot), lsb-extract(8 variants) |
| `metadata` | Metadata | metadata, thumbnail, gps, quantization, strings, autodetect, embedded, palette |
| `analysis` | Analysis | entropy(8×8/16×16/32×32), fft(Luma logmag/phase), dct(AC Energy/High-Freq/Avg), byte-histogram, curves(3 variants) |

---

## Filter Inventory (30 filters)

### Visual — ImageData output

| Filter ID | File | Name | Description |
|-----------|------|------|-------------|
| `channel` | `channel.js` | Channel | Isolates R/G/B/A as grayscale. Presets: Red, Green, Blue, Alpha |
| `hsv` | `hsv.js` | HSV | Hue / Saturation / Value channel extraction |
| `lab` | `lab.js` | LAB | L\* / a\* / b\* channel extraction |
| `bitplane` | `bitplane.js` | Bit Plane | Binary mask of bit N of R/G/B/A/Luma |
| `bitplane-xor` | `bitplane-xor.js` | Bitplane XOR | XOR of two channels' bit 0 — highlights correlation between channels |
| `colormap` | `colormap.js` | Colormap | False-color heatmap overlay (Viridis, Inferno, Jet) |
| `palette` | `palette.js` | Palette | Dominant color extraction — File Palette / Top 64 Colors |
| `gradient` | `gradient.js` | Gradient | Sobel-style luminance edge detection. Presets: Both, Horizontal, Vertical |
| `noise` | `noise.js` | Noise | Box-blur residual noise extraction. Presets: Soft, Aggressive |
| `frequency` | `frequency.js` | Frequency Split | High-pass / Low-pass via box blur |
| `wavelet` | `wavelet.js` | Wavelet | Haar DWT residual / detail coefficients |
| `histogram` | `histogram.js` | Histogram | Per-channel bar graph with stretch / equalize modes |
| `curves` | `curves.js` | Curves | Brightness / contrast / gamma adjustments |
| `entropy` | `entropy.js` | Entropy | Block-by-block Shannon entropy, color-mapped. Block sizes: 8×8, 16×16, 32×32 |
| `pca` | `pca.js` | PCA | Project onto Nth principal component of RGB |
| `fft` | `fft.js` | FFT | 2D FFT magnitude (log-scale) / phase |
| `dct` | `dct.js` | DCT | Discrete cosine transform: AC Energy / High-Freq AC / Avg Block |
| `byte-histogram` | `byte-histogram.js` | Byte Histogram | Raw file byte frequency distribution (requires `rawFile`) |
| `chi-square` | `chi-square.js` | Chi-Square | LSB stego detection via pair-frequency test across full image / top half / bottom half |
| `ela` | `ela.js` | ELA | Error Level Analysis — re-encode at JPEG quality Q, amplify pixel diff |
| `clone` | `clone.js` | Clone Detection | Block-hash matching to find duplicated image regions |
| `jpeg-ghost` | `jpeg-ghost.js` | JPEG Ghost | Per-block MSE heatmap vs re-encoded at given Q |

### Meta — text/entries output (`meta: true`)

| Filter ID | File | Name | Description |
|-----------|------|------|-------------|
| `metadata` | `metadata.js` | Metadata | EXIF tag dump. Parses JPEG APP1 segments directly |
| `thumbnail` | `thumbnail.js` | Thumbnail | Extract embedded EXIF thumbnail |
| `gps` | `gps.js` | GPS | GPS decimal coordinates + OpenStreetMap link |
| `quantization` | `quantization.js` | Quantization | JPEG DQT table dump + estimated quality from table values |
| `strings` | `strings.js` | Strings | Printable byte sequences (ASCII ≥6 or ≥8 chars) from raw file |
| `lsb-extract` | `lsb-extract.js` | LSB Extract | Bit-plane as hex dump — R/G/B/A, row MSB / interleaved modes |
| `autodetect` | `autodetect.js` | Auto-Detect | Meta-filter running forensic heuristics, severity-ranked entries |
| `embedded` | `embedded.js` | Embedded | Scan raw file for ZIP/PNG/JPEG/RAR/7z/PDF/GIF magic byte signatures |

---

## Data Flow

```
User drops image
       ↓
loadImageFile()  [app.js]
  → FileReader + createObjectURL → Image → draw to baseCanvas
  → getImageData() → baseImageData
  → history = [{ canvas, label: 'Original' }]
  → getWorkerPool().start() — spawns hardwareConcurrency workers
       ↓
renderGrid()  [grid.js → app.js via _onAction]
  → for each tile in current tab:
       buildTileEl()    → DOM: canvas div + spinner + footer
       runTile(idx)     [app.js → cache.js]
         → get rawFile as ArrayBuffer (transferable, zero-copy)
         → getWorkerPool().dispatch({ filterId, imageData, params, rawFile })
           → worker picks task, runs filter
           → filter.apply() → ImageData | { text } | { entries }
           → result posted back to main thread
         → renderImageTile() [grid.js] or renderMetaTile() [grid.js]
       ↓
click tile → focusTile(idx) + openPanel(idx)  [app.js → panel.js]
  → panel shows preset pills + param controls
  → slider drag → applyParamPreview() [panel.js → app.js → cache.js]
  ↓
Enter on focused tile → promote(idx)  [panel.js → app.js]
  → new canvas from tile.resultImageData
  → push to history[]
  → baseImageData = tile output
  → re-render grid
```

**Cross-module callback pattern:** Each feature module (`grid`, `history`, `panel`, `preview`, `menu`) exposes `onAction(fn)` to register the central `handleGridAction` dispatcher. All DOM events within a module call `_onAction?.('actionName', ...args)` to communicate back to app.js.

---

## Autodetect Heuristics (`autodetect` filter)

Runs forensic checks and emits severity-ranked `{ severity, title, description }` entries:

| # | Heuristic | Detection method |
|---|-----------|----------------|
| 1 | **Alpha LSB stego** | Entropy of alpha bit 0. Fires when p≈0.5 and H>0.98 |
| 2 | **Bit-plane entropy asymmetry** | Bit-0 entropy per channel. Warns if any channel H>0.98 while median <0.90 |
| 3 | **Cross-channel LSB correlation** | Pearson r between channel LSB pairs. Fires at \|r\|≥0.15 |
| 4 | **Trailing bytes** | Data after JPEG EOI (0xFFD9) or PNG IEND marker |
| 5 | **Embedded magic** | ZIP/PNG/JPEG/RAR/7z/PDF/GIF signatures embedded past file header |
| 6 | **Double JPEG hint** | Re-encode at Q50/70/85/90 via `jpegRoundTrip()`; warns if MSE minimum not at highest Q |
| 7 | **Dimension mismatch** | EXIF PixelXDimension vs actual decoded dimensions |

---

## EXIF Parser (`js/filters/util/exif.js`)

Shared utility consumed by `metadata`, `gps`, `quantization`, `autodetect`. Reads JPEG APP1 (0xFFE1) segments. Worker-safe — pure DataView, no DOM.

**`parseExif(buf)`** returns:
```js
{
  tags: {},           // IFD0 tags (camera, settings, dimensions)
  ifd1: {} | null,   // IFD1 tags (thumbnail)
  thumbnailBytes: Uint8Array | null,
  dqtTables: Array<{ index, precision, values: Uint8Array[64] }>,
  trailerBytes: Uint8Array,   // bytes after JPEG EOI
  markers: Array<{ marker, offset }>,
}
```

**Key exports:**
- `readBuffer(fileOrBuf)` — returns `ArrayBuffer`
- `parseExif(buf)` — main parser
- `filterTagsByMode(tags, mode)` — filter to GPS or camera tag subsets
- `gpsToDecimal(rat, refChar)` — converts GPS rationals to decimal degrees
- `estimateJpegQuality(tableValues)` — matches DQT table against reference Q50 table

---

## Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow keys | Grid navigation; history list; preset pills; param sliders |
| Enter | Open parameter panel; promote auto-focused tile (double-enter) |
| Tab | Move through parameter panel controls |
| Space (tap) | Toggle full preview |
| Space (hold) | Show preview while held |
| Escape | Close panel / deselect tile / close preview |
| Ctrl+1–7 | Switch grid tabs |
| Ctrl+Z / Ctrl+Y | Undo / Redo in history |
| + / - | Zoom in / out |

---

## Zoom System

Five zoom levels (1–5) map to tile widths:

| Level | Tile width | Label |
|-------|-----------|-------|
| 1 | 140px | 50% |
| 2 | 180px | 75% |
| 3 | 220px | 100% |
| 4 | 300px | 150% |
| 5 | 380px | 200% |

Implemented via `setZoom(level)` which updates CSS `grid-template-columns` on the tile grid using `repeat(auto-fill, minmax(WIDTH, 1fr))`.

---

## Adding a Filter

1. Create `js/filters/yourfilter.js` following the filter contract
2. Import and register in `js/filters/index.js` (add to `FILTERS` object)
3. Add `{ filterId, presetName }` entries to the desired tab(s) in `js/presets.js`
4. If the new filter uses JPEG encoding/decoding, add a shared helper to `js/filters/util/jpeg.js`
