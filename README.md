# RapidForensics

Browser-based image forensics tool for CTF players and forensics analysts. Drop an image, inspect it through a grid of forensic filters, and iteratively drill down by promoting filtered outputs as the new base image.

All processing is **client-side** — images never leave the browser.

---

## Running

No build step. Serve the directory with any static file server:

```bash
# Python (built-in)
python3 -m http.server 8765

# Node
npx serve .

# Any other static server works too
```

Then open `http://localhost:8765` in your browser.

---

## Usage

1. **Load an image** — drag onto the drop zone in the left panel, or click Browse
2. **Navigate tiles** — arrow keys move between filter tiles in the grid
3. **Open a filter** — press Enter on a focused tile to open its parameter panel
4. **Promote** — press Enter again (or click Promote) to set the filtered output as the new base image, re-running all filters on it
5. **History** — click any entry in the left panel to restore that analysis state non-destructively
6. **Preview** — tap Space to toggle full-screen preview of the base image or focused tile; hold Space to show while held
7. **Switch tabs** — Ctrl+1–7 switches between filter preset tabs

### Keyboard reference

| Key | Action |
|-----|--------|
| Arrow keys | Navigate grid / history / preset pills / params |
| Enter | Open parameter panel (Promote auto-focused) |
| Enter (again) | Promote image |
| Tab | Move through panel controls |
| Space (tap) | Toggle full preview |
| Space (hold) | Show preview while held |
| Escape | Close panel / deselect tile / close preview |
| Ctrl+1–7 | Switch grid tab |

---

## Architecture

```
index.html          Shell — layout, DOM structure, no inline JS
css/style.css       Dark theme (Photoshop/Photopea-inspired)
js/app.js           All application state, rendering, keyboard handling
js/presets.js       Built-in grid tab definitions
js/filters/
  index.js          Filter registry + runFilter() helper
  util/exif.js      Shared EXIF parser (metadata/thumbnail/gps/quant/autodetect)
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
  autodetect.js     Meta filter: alpha-LSB stego, trailing bytes, etc.
```

### Autodetect heuristics

The `autodetect` filter runs a battery of checks and emits severity-ranked entries:

- **Alpha LSB stego** — entropy/ratio test on alpha-channel bit 0. Fires when alpha varies but its LSB distribution is suspiciously uniform (1-bit payload hallmark).
- **Bit-plane entropy asymmetry** — reports bit-0 entropy for R/G/B/A/Luma; warns if one channel near 1.0 while others < 0.9.
- **Trailing bytes** — data after JPEG EOI or PNG IEND.
- **Embedded magic** — scans for ZIP/PNG/JPEG/RAR/7z/PDF/GIF signatures after the file's own header.
- **Double-JPEG hint** — re-encodes at Q=50/70/85/90 at low resolution; warns if MSE minimum isn't at the highest tested Q.
- **EXIF thumbnail mismatch** — SSIM of EXIF thumbnail against downscaled main; alerts below 0.85.
- **Dimension mismatch** — EXIF PixelXDimension vs decoded dimensions.

### Filter contract

Each filter exports an object:

```js
{
  id:           string,          // unique key
  name:         string,          // display name
  slow:         boolean,         // true = explicit Apply step, not live preview
  meta:         boolean,         // true = non-visual tile (text output)
  presets:      [{ name, params }],
  defaultPreset: string,
  paramSchema:  [{ id, label, type, ...typeArgs }],

  apply(imageData, params, sourceCanvas, rawFile)
    // returns ImageData | { text } | { entries } | Promise<any of these>
}
```

### State model

All mutable state lives in the `state` object in `app.js`:

- `baseImageData` — the current ImageData all filters run against
- `history` — stack of `{ canvas, filterId, presetName, label }` entries
- `tiles` — current tab's tile descriptors, including last result
- `panelOpen / panelTileIdx / panelParams / panelDirty` — parameter panel state

Promoting a tile: writes a new entry to `history`, sets `baseImageData` to the tile's output, re-renders the grid.

Restoring history: sets `baseImageData` to a prior entry's canvas and re-renders — non-destructive, forward history is preserved.

---

## Adding a filter

1. Create `js/filters/yourfilter.js` following the contract above
2. Import and register it in `js/filters/index.js`
3. Add tiles referencing it to any tab in `js/presets.js`
