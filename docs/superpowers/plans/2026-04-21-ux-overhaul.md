# UX Overhaul — Implementation Plan
_2026-04-21_

## Implementation Order

Order matters: items that restructure existing DOM/JS must come before items that build on them.

1. Drop zone relocation
2. Menu bar dropdown system
3. Menu bar items (File, View)
4. Tile click behavior + magnifying glass
5. Export button in properties panel
6. Zoom controls
7. Undo/Redo
8. Keybind bar display rewrite
9. Arrow navigation overhaul

---

## 1. Drop Zone Relocation

**Goal:** Drop zone fills the entire grid area and hides once an image is loaded. Remove from history panel.

**HTML (`index.html`)**
- Remove `<div id="drop-zone">` from `#history-panel`
- Add it inside `#grid-area`, before `#tile-grid`, as a sibling (or absolute overlay)
- History panel header becomes just `<div class="panel-header">…</div>` with no drop zone above it

**CSS (`style.css`)**
- `.drop-zone-grid`: `position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 10; background: var(--bg-darkest)`
- `#grid-area`: add `position: relative` (needed for absolute child)
- Hidden state: `display: none` — add `.drop-zone-hidden` class on image load

**JS (`app.js`)**
- In `loadImageFile`: after image loads, add `dropZone.classList.add('drop-zone-hidden')` (or `dropZone.hidden = true`)
- Remove the label update logic (`dzLabel.innerHTML = …`) — no longer needed
- Drag handlers stay the same (drop zone ID unchanged)

---

## 2. Menu Bar Dropdown System

**Goal:** File/View/Help buttons open dropdown menus. Click outside or Escape closes them.

**HTML (`index.html`)**
- Add `<div id="menu-dropdown" class="menu-dropdown hidden"></div>` just inside `#menubar` (positioned absolute)

**CSS (`style.css`)**
- `.menu-dropdown`: `position: absolute; top: var(--header-h); left: 0; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 3px; min-width: 200px; z-index: 500; padding: 4px 0`
- `.menu-item`: `display: block; width: 100%; padding: 6px 16px; text-align: left; background: none; border: none; color: var(--text-primary); font-size: 12px; cursor: pointer`
- `.menu-item:hover`, `.menu-item.focused`: `background: var(--accent); color: #fff`
- `.menu-item-sep`: `height: 1px; background: var(--border); margin: 4px 0`
- `.menu-dropdown.hidden`: `display: none`

**JS (`app.js`)**
- State: `let openMenu = null` (tracks which menu is open: `'file'|'view'|'help'|null`)
- `openMenuDropdown(name, items)` — positions the shared dropdown element, renders items, opens it
- `closeMenuDropdown()` — hides it, clears `openMenu`
- Each `.menu-btn` click: if same menu already open → close; else open that menu
- `document.addEventListener('click', e => { if (!menubar.contains(e.target)) closeMenuDropdown(); })`
- Keyboard in dropdown: ArrowUp/Down cycle items, Enter activates, Escape closes

**Menu items are defined as arrays** passed to `openMenuDropdown`:
```js
const FILE_MENU = [
  { label: 'Open Image…',          action: () => fileInput.click() },
  { sep: true },
  { label: 'Export Current Image', action: exportCurrentImage },
  { label: 'Export History as ZIP',action: exportHistoryZip },
];
const VIEW_MENU = [
  { label: 'Preview (Space)',      action: showPreview },
  { sep: true },
  { label: 'Zoom In  Ctrl+=',     action: () => adjustZoom(+1) },
  { label: 'Zoom Out  Ctrl+-',    action: () => adjustZoom(-1) },
  { label: 'Reset Zoom  Ctrl+0',  action: () => setZoom(3) },
];
```

---

## 3. Menu Bar Items

### File Menu

**Open Image** — `fileInput.click()`

**Export Current Image**
- Take `state.history[state.activeHistoryIdx].canvas`
- `canvas.toBlob(blob => downloadBlob(blob, 'export.png'), 'image/png')`
- `downloadBlob(blob, name)` helper: creates object URL, clicks `<a download>`, revokes

**Export History as ZIP**
- Requires a zip library. Recommended: load `JSZip` via dynamic import from jsDelivr (`https://cdn.jsdelivr.net/npm/jszip/dist/jszip.min.js`) on first use.
- ⚠️ **Needs user sign-off** on CDN dependency vs. vendoring vs. manual multi-download fallback
- Each history entry: `canvas.toBlob → zip.file('step-N-label.png', blob)`
- `zip.generateAsync({ type: 'blob' }).then(blob => downloadBlob(blob, 'history.zip'))`

### View Menu

Items covered under Zoom Controls section below. Preview item calls existing `showPreview()`.

---

## 4. Tile Click Behavior + Magnifying Glass

**Goal:** Click image area → open panel. Magnifying glass button in bottom-right of tile image → open preview.

**JS (`app.js`) — `buildTileEl`**

Replace the `wrap.addEventListener('click', … showPreview())` block:
```js
// Click on image wrap → open panel
wrap.style.cursor = 'pointer';
wrap.addEventListener('click', e => { e.stopPropagation(); focusTile(idx); openPanel(idx); });
```

Add magnifying glass button inside `wrap` (for non-meta tiles only):
```js
const zoomBtn = document.createElement('button');
zoomBtn.className = 'tile-zoom-btn';
zoomBtn.innerHTML = `<svg …>…</svg>`;  // magnifying glass icon
zoomBtn.title = 'Preview (Space)';
zoomBtn.addEventListener('click', e => { e.stopPropagation(); focusTile(idx); showPreview(); });
wrap.appendChild(zoomBtn);
```

**CSS (`style.css`)**
- `.tile-zoom-btn`: `position: absolute; bottom: 6px; right: 6px; width: 24px; height: 24px; background: rgba(0,0,0,0.6); border: 1px solid var(--border-light); border-radius: 3px; color: var(--text-muted); cursor: pointer; display: none; align-items: center; justify-content: center; padding: 0`
- `.tile-canvas-wrap:hover .tile-zoom-btn`: `display: flex`
- `.tile-zoom-btn:hover`: `color: var(--text-bright); background: rgba(0,0,0,0.85)`

---

## 5. Export Button in Properties Panel

**Goal:** Button next to Promote that downloads the tile's current result image.

**HTML (`index.html`)**
```html
<div id="param-panel-top">
  <button id="export-tile-btn" class="btn-secondary">Export</button>
  <button id="apply-btn"       class="btn-secondary" hidden>Apply</button>
  <button id="promote-btn"     class="btn-primary">Promote</button>
</div>
```

**JS (`app.js`)**
- `exportTileBtn` DOM ref
- Click handler: get `state.tiles[state.panelTileIdx].resultImageData`, draw to temp canvas, `toBlob → downloadBlob`
- Disabled when tile has no result yet (`tile.resultImageData == null`)
- Update `openPanel` and `runTile` to refresh disabled state

---

## 6. Zoom Controls

**Goal:** Change tile grid column size. Bottom-right of grid area, View menu entries, keybinds Ctrl+= / Ctrl+- / Ctrl+0.

**State**
```js
state.zoomLevel = 3;  // 1–5
```

Zoom levels → min tile width: `[140, 180, 220, 300, 380]` px (220 is current default = level 3)

**JS (`app.js`)**
- `setZoom(level)`: clamps to 1–5, updates `state.zoomLevel`, sets `tileGrid.style.gridTemplateColumns`
- `adjustZoom(delta)`: `setZoom(state.zoomLevel + delta)`
- Global keydown: `Ctrl+=` → `adjustZoom(+1)`, `Ctrl+-` → `adjustZoom(-1)`, `Ctrl+0` → `setZoom(3)`

**HTML (`index.html`)**
```html
<div id="zoom-controls">
  <button id="zoom-out-btn" title="Zoom Out (Ctrl+-)">−</button>
  <span id="zoom-label">100%</span>
  <button id="zoom-in-btn"  title="Zoom In (Ctrl+=)">+</button>
</div>
```
Place inside `#grid-area`, `position: absolute; bottom: 8px; right: 8px`.

**CSS (`style.css`)**
- `#zoom-controls`: `position: absolute; bottom: 8px; right: 8px; display: flex; align-items: center; gap: 4px; background: var(--bg-panel); border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; z-index: 20`
- Zoom buttons: small secondary style

---

## 7. Undo / Redo

**Goal:** Ctrl+Z / Ctrl+Y navigate backwards/forwards through history. Undo/Redo buttons in history panel header.

History already acts as the undo stack. `state.activeHistoryIdx` is the cursor.

**JS (`app.js`)**
- `undoHistory()`: if `activeHistoryIdx > 0` → `restoreHistory(activeHistoryIdx - 1)`
- `redoHistory()`: if `activeHistoryIdx < history.length - 1` → `restoreHistory(activeHistoryIdx + 1)`
- Global keydown: `Ctrl+Z` → `undoHistory()`, `Ctrl+Y` → `redoHistory()`
- After undo/redo, update button disabled states

**HTML (`index.html`)** — history panel header:
```html
<div class="panel-header">
  History
  <div class="panel-header-actions">
    <button id="undo-btn" title="Undo (Ctrl+Z)">↩</button>
    <button id="redo-btn" title="Redo (Ctrl+Y)">↪</button>
  </div>
</div>
```

**CSS (`style.css`)**
- `.panel-header-actions`: `display: flex; gap: 2px`
- `#undo-btn, #redo-btn`: small icon button style matching `#param-panel-close`
- Disabled state: `opacity: 0.35; cursor: default`

---

## 8. Keybind Bar Display Rewrite

**Goal:** Each key in a binding is its own `<kbd>` element. Combos use ` + ` between keys.

**JS (`app.js`)** — replace `kb()` helper:
```js
// kb('Ctrl', '=', 'Zoom In')  or  kb('↑', 'Navigate')
function kb(action, ...keys) { … }
```

Actually cleaner to pass keys as array:
```js
function kb(action, keys) {
  // keys: array of strings e.g. ['Ctrl', '='] or ['↑','↓','←','→']
  const keysHtml = keys.map(k => `<kbd class="kb-key">${k}</kbd>`).join('<span class="kb-sep">+</span>');
  return `<span class="kb-item">${keysHtml}<span class="kb-action">${action}</span></span>`;
}
```

Arrow display: `['↑','↓','←','→']` renders as four separate `<kbd>` with no `+` between them (space-separated navigation keys). Handle by passing them as a "group" variant or just joining with spaces.

Update all `updateKeybindBar()` call sites:
- `['Ctrl','1–7']` → `[Ctrl] + [1–7]`
- `['↑','↓','←','→']` → four separate keys
- `['Space']`, `['Esc']`, `['Enter']`, `['Tab']` → single keys as before

**CSS**: `.kb-sep` gets minimal styling (no border, just spacing).

---

## 9. Arrow Navigation Overhaul

### 9a. Default focus first tile

On keydown of any ArrowKey globally, if `state.baseImageData` and `state.focusedTileIdx === -1` and focus is not in any panel → `focusTile(0)`.

### 9b. Cross-panel navigation

**Grid → History** (ArrowLeft from column 0):
```js
case 'ArrowLeft':
  if (idx % cols === 0) { focusHistory(); return; }
  focusTile(idx - 1); break;
```
`focusHistory()`: focus first `.history-entry` (or drop zone if no entries)

**Grid → Properties** (ArrowRight from last column or last tile):
```js
case 'ArrowRight':
  if (idx % cols === cols - 1 || idx === state.tiles.length - 1) {
    if (state.panelOpen) focusPanel(); return;
  }
  focusTile(Math.min(idx + 1, state.tiles.length - 1)); break;
```
`focusPanel()`: focus `promoteBtn`

**Grid → Menubar** (ArrowUp from row 0):
```js
case 'ArrowUp':
  if (idx < cols) { focusMenubar(); return; }
  focusTile(idx - cols); break;
```
`focusMenubar()`: focus first `.tab-btn` (if any), else first `.menu-btn`

**History → Grid** (ArrowRight from any history entry):
In history entry keydown: `ArrowRight` → `focusTile(state.focusedTileIdx >= 0 ? state.focusedTileIdx : 0)`

**Properties → Grid** (ArrowLeft from promoteBtn or first control):
In promoteBtn/applyBtn keydown: add `ArrowLeft` → `closePanelUI(); focusTile(state.panelTileIdx)`
In param controls: `ArrowLeft` at edge → same

**Menubar → Grid** (ArrowDown from any tab/menu button):
`tabBar.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); focusTile(0); } })`
Same for `.menubar-menus` buttons.

### 9c. Fix properties panel pill → control navigation

Bug: `focusFirstParamControl()` queries `presetBar` first, finds pills, never reaches controls.

Fix:
```js
function focusFirstControl() {
  paramCtrls.querySelector('input[type="range"], select')?.focus();
}
function focusLastControl() {
  const all = [...paramCtrls.querySelectorAll('input[type="range"], select')];
  all.at(-1)?.focus();
}
```

Update pill keydown: `ArrowDown` from any pill → `focusFirstControl()` (not just last pill).
`ArrowUp` from any pill → `promoteBtn.focus()`.

In `paramCtrls` keydown:
- `ArrowUp` from first control → focus last pill (or promoteBtn if no pills)
- `ArrowDown` from last control → `promoteBtn.focus()`
- Non-edge: let browser handle (range value change, select option change) — **do not** preventDefault on non-edge

---

## Notes / Open Questions

- **JSZip for zip export**: static site with no bundler. Options:
  1. Dynamic `import()` from jsDelivr on first use (CDN dependency)
  2. Vendor the file into `js/lib/jszip.min.js` (no CDN, ~100 KB)
  3. Skip zip — offer individual PNG downloads per step instead
  
  Awaiting user preference before implementing.

- **Zoom percentages**: level labels `['50%','75%','100%','150%','200%']` map to tile widths `[140,180,220,300,380]`.

- **Undo on fresh load**: undo to "before image loaded" is a no-op (history length 1, idx 0 → undo disabled).
