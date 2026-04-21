# Image Forensics App — Product Spec

## Overview

A browser-based image forensics tool aimed at CTF players and forensics professionals. Drop in an image, instantly see it analyzed through a grid of forensic filters, then iteratively drill down by promoting filtered outputs as the new base image — building a visual history of your analysis chain.

---

## Core Concepts

### The Grid

- On image load, all available filters are applied automatically and displayed as a tile grid
- Each tile shows the filter name and active preset label
- Tiles are navigable with **arrow keys**
- The grid is the primary workspace

### Promoting an Image

Promoting sets a filtered tile as the new base image, re-running all filters on it. This is the core investigative loop.

- **Enter** on a focused tile opens its parameter panel, with the **Promote button auto-focused**
- **Enter again** immediately promotes (zero-friction path for confident selections)
- **Tab** moves focus into parameters if adjustments are needed before promoting
- After changing parameters, Enter regenerates the tile; Tab back to Promote, then Enter to promote
- The button label reflects state: **"Promote"** when parameters are unchanged, **"Apply & Promote"** after edits

### Analysis History

A persistent history panel displays the chain of promotions, styled like Photoshop's layer history. Each entry shows:
- The base image thumbnail at that step
- Which filter/preset was promoted to get there
- Clicking any history entry restores that state as the current base image (non-destructive)

---

## Keyboard Navigation

| Key | Action |
|-----|--------|
| Arrow keys | Navigate grid tiles |
| Enter | Open parameter panel (Promote button focused) |
| Enter (again) | Promote image immediately |
| Tab | Move focus into parameters within panel |
| Escape | Close panel, return focus to grid tile |
| Escape (again) | Deselect tile entirely |
| Ctrl+1–9 | Switch between grid tabs |

---

## Parameter Panel

Opens when a tile is focused and Enter is pressed. Contains:

- **Preset selector** — pill buttons or dropdown at the top (e.g. Red / Green / Blue / Alpha for a channel filter)
- **Parameter sliders/inputs** — specific to the filter
- **Live preview** for fast filters (brightness, channel splits, etc.)
- **Explicit Apply step** for slow filters (ELA, clone detection) — visually distinguished so users know what to expect
- **Promote / Apply & Promote button** — auto-focused on panel open

---

## Preset System

### Filter Presets

Named parameter snapshots for individual filters. Examples:

- Channel: `Red`, `Green`, `Blue`, `Alpha`
- ELA: `Low Quality (65)`, `High Quality (95)`
- Noise: `Soft`, `Aggressive`

Filter presets appear in the parameter panel as selectable options. Users can create and name their own.

### Grid Presets (Tabs)

A grid preset is an ordered list of `(filter, preset)` pairs, defining a full workspace tab. Tabs are switchable via **Ctrl+1–9**.

**Built-in default tabs:**

| Tab | Contents |
|-----|----------|
| Overview | One tile per major filter category |
| Color | Channel splits, HSV, LAB, PCA projections |
| Compression | ELA variants, JPEG structure, quantization |
| Noise | Noise extraction, frequency split, wavelet |
| Clone / Splicing | Clone detection, luminance gradient |

Users can create custom tabs and name them. Grid presets are stored as JSON and shareable (e.g. posted to CTF forums as part of a toolkit).

---

## Filter Library (Initial Set)

### Compression / ELA
- Error Level Analysis (ELA) — parameter: JPEG quality

### Noise
- Noise extraction (median filter residual)
- Frequency split (high / low)
- Wavelet threshold

### Color / Channels
- Channel separation (R, G, B, A)
- HSV conversion
- LAB conversion
- PCA projection

### Structure
- Luminance gradient (horizontal / vertical)
- Echo edge filter
- Clone detection

### Metadata (non-visual tiles)
- EXIF dump
- Thumbnail extraction and comparison
- GPS data

---

## Data Model

A grid preset is a simple JSON structure, making sharing easy:

```json
{
  "name": "My CTF Grid",
  "tiles": [
    { "filter": "ela", "preset": "High Quality" },
    { "filter": "channel", "preset": "Red" },
    { "filter": "noise", "preset": "Aggressive" }
  ]
}
```

Filter presets follow the same pattern:

```json
{
  "filter": "ela",
  "name": "High Quality",
  "params": { "quality": 95 }
}
```

---

## Privacy

All processing is done **client-side**. Images never leave the browser. This is a hard requirement.

---

## Out of Scope (v1)

- Pinning individual tiles across tabs (composable grids) — revisit post-v1
- Collaboration / shared sessions
- Server-side processing
