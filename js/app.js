import { FILTERS, runFilter, getPresetParams } from './filters/index.js';
import { BUILTIN_TABS } from './presets.js';

// =====================================================================
// State
// =====================================================================
const state = {
  rawFile: null,
  baseCanvas: null,      // current base ImageData source (HTMLCanvasElement)
  baseImageData: null,   // ImageData of current base
  history: [],           // [{ canvas, filterId, presetName, label }]
  activeHistoryIdx: 0,
  currentTabIdx: 0,
  focusedTileIdx: -1,
  tiles: [],             // array of tile descriptor objects
  panelOpen: false,
  panelTileIdx: -1,
  panelParams: null,
  panelDirty: false,     // params changed since last apply
};

// =====================================================================
// DOM refs
// =====================================================================
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const tileGrid       = document.getElementById('tile-grid');
const historyList    = document.getElementById('history-list');
const tabBar         = document.getElementById('tab-bar');
const imageInfo      = document.getElementById('image-info');
const paramPanel     = document.getElementById('param-panel');
const paramTitle     = document.getElementById('param-panel-title');
const paramClose     = document.getElementById('param-panel-close');
const presetBar      = document.getElementById('preset-bar');
const paramCtrls     = document.getElementById('param-controls');
const promoteBtn     = document.getElementById('promote-btn');
const applyBtn       = document.getElementById('apply-btn');
const previewOverlay = document.getElementById('preview-overlay');
const previewCanvas  = document.getElementById('preview-canvas');
const previewLabel   = document.getElementById('preview-label');
const previewDims    = document.getElementById('preview-dims');
const previewClose   = document.getElementById('preview-close');
const keybindBar     = document.getElementById('keybind-bar');

// =====================================================================
// Image loading
// =====================================================================
function loadImageFile(file) {
  state.rawFile = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);

    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    state.baseCanvas    = canvas;
    state.baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    // Bootstrap history
    state.history = [{ canvas, filterId: null, presetName: null, label: 'Original' }];
    state.activeHistoryIdx = 0;

    imageInfo.textContent = `${img.naturalWidth} × ${img.naturalHeight} — ${file.name}`;

    // Update drop zone label to show current file
    const dzLabel = document.getElementById('drop-zone-label');
    if (dzLabel) dzLabel.innerHTML = `<strong style="color:var(--text-primary)">${escHtml(file.name)}</strong><br><span style="font-size:10px">Drop or <label for="file-input" class="file-label">browse</label> to replace</span>`;

    tileGrid.hidden = false;

    renderTabs();
    renderHistory();
    renderGrid();
    updateKeybindBar();
  };
  img.onerror = () => alert('Could not load image.');
  img.src = url;
}

// Accept drops on the panel drop zone AND anywhere on the grid area
function handleDragOver(e) { e.preventDefault(); dropZone.classList.add('drag-over'); }
function handleDragLeave(e) {
  // Only clear if leaving the element entirely (not entering a child)
  if (!e.currentTarget.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
}

dropZone.addEventListener('dragover', handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop', handleDrop);

// Also accept drops anywhere in the grid so users can drag to the center naturally
document.getElementById('grid-area').addEventListener('dragover', e => e.preventDefault());
document.getElementById('grid-area').addEventListener('drop', handleDrop);
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadImageFile(fileInput.files[0]); });

// =====================================================================
// Tab rendering
// =====================================================================
function renderTabs() {
  tabBar.innerHTML = '';
  BUILTIN_TABS.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === state.currentTabIdx ? ' active' : '');
    btn.textContent = tab.name;
    btn.dataset.idx = i;
    btn.addEventListener('click', () => { state.currentTabIdx = i; renderTabs(); renderGrid(); });
    tabBar.appendChild(btn);
  });
}

// =====================================================================
// Grid rendering
// =====================================================================
function renderGrid() {
  if (!state.baseImageData) return;
  tileGrid.innerHTML = '';
  state.focusedTileIdx = -1;
  closePanelUI();

  const tab = BUILTIN_TABS[state.currentTabIdx];
  state.tiles = tab.tiles.map(({ filterId, presetName }) => ({
    filterId,
    presetName,
    params: getPresetParams(filterId, presetName),
    resultImageData: null,
    loading: false,
  }));

  state.tiles.forEach((tile, idx) => {
    const el = buildTileEl(tile, idx);
    tileGrid.appendChild(el);
    runTile(idx);
  });
}

function buildTileEl(tile, idx) {
  const filter = FILTERS[tile.filterId];
  const el = document.createElement('div');
  el.className = 'tile' + (filter?.meta ? ' tile-meta' : '');
  el.dataset.idx = idx;
  el.tabIndex = 0;

  const wrap = document.createElement('div');
  wrap.className = 'tile-canvas-wrap';

  if (filter?.meta) {
    const pre = document.createElement('div');
    pre.className = 'tile-meta-content';
    pre.textContent = 'Loading…';
    wrap.appendChild(pre);
  } else {
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
  }

  // Loading overlay
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'tile-loading';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  loadingDiv.appendChild(spinner);
  wrap.appendChild(loadingDiv);

  const footer = document.createElement('div');
  footer.className = 'tile-footer';
  const nameSpan = document.createElement('span');
  nameSpan.className = 'tile-name';
  nameSpan.textContent = filter?.name ?? tile.filterId;
  const presetSpan = document.createElement('span');
  presetSpan.className = 'tile-preset';
  presetSpan.textContent = tile.presetName;
  footer.appendChild(nameSpan);
  footer.appendChild(presetSpan);

  el.appendChild(wrap);
  el.appendChild(footer);

  el.addEventListener('click', () => focusTile(idx));
  el.addEventListener('focus', () => { state.focusedTileIdx = idx; el.classList.add('focused'); });
  el.addEventListener('blur', () => el.classList.remove('focused'));
  el.addEventListener('keydown', handleTileKeydown);

  return el;
}

async function runTile(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;

  const tileEl = tileGrid.children[idx];
  if (!tileEl) return;

  const filter = FILTERS[tile.filterId];
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'flex';
  tile.loading = true;

  try {
    const result = await runFilter(
      tile.filterId,
      state.baseImageData,
      tile.params,
      state.baseCanvas,
      state.rawFile,
    );

    tile.resultImageData = result;
    tile.loading = false;

    if (filter?.meta) {
      renderMetaTile(tileEl, result);
    } else {
      renderImageTile(tileEl, result);
    }
  } catch (err) {
    console.error(`Filter ${tile.filterId} failed:`, err);
    tile.loading = false;
    if (loadingDiv) loadingDiv.style.display = 'none';
  }
}

function renderImageTile(tileEl, imageData) {
  const canvas = tileEl.querySelector('canvas');
  if (!canvas) return;
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
}

function renderMetaTile(tileEl, result) {
  const pre = tileEl.querySelector('.tile-meta-content');
  if (!pre) return;
  if (result?.text) {
    pre.textContent = result.text;
  } else if (result?.entries) {
    pre.innerHTML = '';
    for (const [key, val] of Object.entries(result.entries)) {
      const line = document.createElement('div');
      line.innerHTML = `<span class="meta-key">${escHtml(key)}</span>: <span class="meta-val">${escHtml(String(val))}</span>`;
      pre.appendChild(line);
    }
  }
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// =====================================================================
// Focus / keyboard
// =====================================================================
function focusTile(idx) {
  const tileEl = tileGrid.children[idx];
  if (!tileEl) return;
  // Remove focused class from others
  tileGrid.querySelectorAll('.tile.focused').forEach(el => el.classList.remove('focused'));
  tileEl.classList.add('focused');
  tileEl.focus({ preventScroll: false });
  state.focusedTileIdx = idx;
  updateKeybindBar();
}

function handleTileKeydown(e) {
  const idx = parseInt(e.currentTarget.dataset.idx, 10);
  const cols = getGridCols();

  switch (e.key) {
    case 'ArrowRight': e.preventDefault(); focusTile(Math.min(idx + 1, state.tiles.length - 1)); break;
    case 'ArrowLeft':  e.preventDefault(); focusTile(Math.max(idx - 1, 0)); break;
    case 'ArrowDown':  e.preventDefault(); focusTile(Math.min(idx + cols, state.tiles.length - 1)); break;
    case 'ArrowUp':    e.preventDefault(); focusTile(Math.max(idx - cols, 0)); break;
    case 'Enter':
      e.preventDefault();
      if (!state.panelOpen || state.panelTileIdx !== idx) {
        openPanel(idx);
      } else {
        // Panel already open for this tile — Enter = promote
        promoteCurrentTile();
      }
      break;
    case 'Escape':
      e.preventDefault();
      if (state.panelOpen) {
        closePanelUI();
        focusTile(idx);
      } else {
        e.currentTarget.blur();
        state.focusedTileIdx = -1;
      }
      break;
  }
}

function getGridCols() {
  const style = getComputedStyle(tileGrid);
  const tpl = style.gridTemplateColumns;
  return tpl.split(' ').length;
}

// Global keyboard shortcuts
document.addEventListener('keydown', e => {
  // Ctrl+1–9 — switch tabs
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key, 10) - 1;
    if (i < BUILTIN_TABS.length) {
      e.preventDefault();
      state.currentTabIdx = i;
      renderTabs();
      renderGrid();
    }
  }
});

// =====================================================================
// Parameter Panel
// =====================================================================
function openPanel(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  const filter = FILTERS[tile.filterId];
  if (!filter) return;

  state.panelOpen    = true;
  state.panelTileIdx = idx;
  state.panelParams  = { ...tile.params };
  state.panelDirty   = false;
  updateKeybindBar();

  paramPanel.classList.remove('panel-hidden');
  paramTitle.textContent = filter.name + (filter.slow ? '<span class="slow-badge">slow</span>' : '');
  if (filter.slow) {
    paramTitle.innerHTML = filter.name + ' <span class="slow-badge">slow</span>';
  } else {
    paramTitle.textContent = filter.name;
  }

  renderPresetBar(filter, tile.presetName);
  renderParamControls(filter, state.panelParams);
  updatePromoteBtn();

  // Auto-focus promote button
  promoteBtn.focus();
}

function closePanelUI() {
  state.panelOpen    = false;
  state.panelTileIdx = -1;
  paramPanel.classList.add('panel-hidden');
  presetBar.innerHTML = '';
  paramCtrls.innerHTML = '';
  updateKeybindBar();
}

function focusFirstParamControl() {
  const first = presetBar.querySelector('.preset-pill') ??
                paramCtrls.querySelector('input, select');
  first?.focus();
}

function focusLastParamControl() {
  const allControls = [
    ...presetBar.querySelectorAll('.preset-pill'),
    ...paramCtrls.querySelectorAll('input, select'),
  ];
  allControls.at(-1)?.focus();
}

paramClose.addEventListener('click', () => {
  const prevTile = state.panelTileIdx;
  closePanelUI();
  if (prevTile >= 0) focusTile(prevTile);
});

function renderPresetBar(filter, activePresetName) {
  presetBar.innerHTML = '';
  filter.presets.forEach(preset => {
    const pill = document.createElement('button');
    pill.className = 'preset-pill' + (preset.name === activePresetName ? ' active' : '');
    pill.textContent = preset.name;
    pill.addEventListener('click', () => {
      state.panelParams = { ...preset.params };
      renderPresetBar(filter, preset.name);
      renderParamControls(filter, state.panelParams);
      markDirty();
      if (!filter.slow) applyParamPreview();
    });
    pill.addEventListener('keydown', e => {
      const pills = [...presetBar.querySelectorAll('.preset-pill')];
      const cur = pills.indexOf(e.currentTarget);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (cur > 0) pills[cur - 1].focus();
        else promoteBtn.focus();           // wrap back to Promote
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (cur < pills.length - 1) {
          pills[cur + 1].focus();
        } else {
          focusFirstParamControl();        // last pill → first param
        }
      }
    });
    presetBar.appendChild(pill);
  });
}

function renderParamControls(filter, params) {
  paramCtrls.innerHTML = '';
  if (!filter.paramSchema) return;

  filter.paramSchema.forEach(schema => {
    const group = document.createElement('div');
    group.className = 'param-group';

    if (schema.type === 'range') {
      const labelRow = document.createElement('div');
      labelRow.className = 'param-label';
      const labelText = document.createElement('span');
      labelText.textContent = schema.label;
      const valSpan = document.createElement('span');
      valSpan.className = 'param-value';
      valSpan.textContent = params[schema.id] ?? schema.min;
      labelRow.appendChild(labelText);
      labelRow.appendChild(valSpan);

      const slider = document.createElement('input');
      slider.type  = 'range';
      slider.className = 'param-slider';
      slider.min   = schema.min;
      slider.max   = schema.max;
      slider.step  = schema.step ?? 1;
      slider.value = params[schema.id] ?? schema.min;
      slider.dataset.id = schema.id;

      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        params[schema.id] = v;
        valSpan.textContent = v;
        markDirty();
        if (!FILTERS[state.tiles[state.panelTileIdx]?.filterId]?.slow) {
          applyParamPreview();
        }
      });

      group.appendChild(labelRow);
      group.appendChild(slider);
    } else if (schema.type === 'select') {
      const labelEl = document.createElement('div');
      labelEl.className = 'param-label';
      labelEl.textContent = schema.label;

      const sel = document.createElement('select');
      sel.style.cssText = 'width:100%;background:var(--bg-mid);color:var(--text-primary);border:1px solid var(--border-light);border-radius:3px;padding:4px 6px;font-size:11px;outline:none;';
      schema.options?.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === params[schema.id]) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        params[schema.id] = sel.value;
        markDirty();
        if (!FILTERS[state.tiles[state.panelTileIdx]?.filterId]?.slow) {
          applyParamPreview();
        }
      });

      group.appendChild(labelEl);
      group.appendChild(sel);
    }

    paramCtrls.appendChild(group);
  });
}

function markDirty() {
  state.panelDirty = true;
  updatePromoteBtn();
}

function updatePromoteBtn() {
  const filter = FILTERS[state.tiles[state.panelTileIdx]?.filterId];
  if (filter?.slow && state.panelDirty) {
    applyBtn.hidden = false;
    promoteBtn.textContent = 'Apply & Promote';
  } else if (state.panelDirty) {
    applyBtn.hidden = true;
    promoteBtn.textContent = 'Apply & Promote';
  } else {
    applyBtn.hidden = true;
    promoteBtn.textContent = 'Promote';
  }
}

// Live preview for fast filters
async function applyParamPreview() {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile = state.tiles[idx];
  tile.params = { ...state.panelParams };
  await runTile(idx);
  state.panelDirty = true;
  updatePromoteBtn();
}

// Explicit apply for slow filters
applyBtn.addEventListener('click', async () => {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile = state.tiles[idx];
  tile.params = { ...state.panelParams };
  await runTile(idx);
  state.panelDirty = true;
  updatePromoteBtn();
});

// Arrow nav from Promote/Apply buttons down into the panel controls
[promoteBtn, applyBtn].forEach(btn => {
  btn.addEventListener('keydown', e => {
    if (!state.panelOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      focusFirstParamControl();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusLastParamControl();
    }
  });
});

// Arrow nav on param inputs: Up from first control → last preset pill / Promote
paramCtrls.addEventListener('keydown', e => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const controls = [...paramCtrls.querySelectorAll('input[type="range"], select')];
  const cur = controls.indexOf(document.activeElement);
  if (cur === -1) return;
  if (e.key === 'ArrowUp' && cur === 0) {
    e.preventDefault();
    // Jump to last preset pill, or Promote if no presets
    const pills = [...presetBar.querySelectorAll('.preset-pill')];
    (pills.at(-1) ?? promoteBtn)?.focus();
  } else if (e.key === 'ArrowDown' && cur === controls.length - 1) {
    e.preventDefault();
    promoteBtn.focus();                    // wrap back to Promote
  }
  // For range inputs, let browser handle Left/Right; Up/Down we intercept only at edges
});

// =====================================================================
// Promote
// =====================================================================
promoteBtn.addEventListener('click', () => promoteCurrentTile());

function promoteCurrentTile() {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile = state.tiles[idx];
  const filter = FILTERS[tile.filterId];

  // For slow/dirty filters, apply first if not yet applied
  if (filter?.slow && state.panelDirty) {
    const doIt = async () => {
      tile.params = { ...state.panelParams };
      await runTile(idx);
      promote(idx);
    };
    doIt();
    return;
  }

  promote(idx);
}

function promote(idx) {
  const tile = state.tiles[idx];
  if (!tile?.resultImageData) return;

  // Don't promote metadata tiles
  const filter = FILTERS[tile.filterId];
  if (filter?.meta) return;

  const newCanvas = document.createElement('canvas');
  newCanvas.width  = tile.resultImageData.width;
  newCanvas.height = tile.resultImageData.height;
  newCanvas.getContext('2d').putImageData(tile.resultImageData, 0, 0);

  state.baseCanvas    = newCanvas;
  state.baseImageData = tile.resultImageData;

  // Truncate history forward and push new entry
  state.history = state.history.slice(0, state.activeHistoryIdx + 1);
  state.history.push({
    canvas:     newCanvas,
    filterId:   tile.filterId,
    presetName: tile.presetName,
    label:      `${filter?.name ?? tile.filterId} — ${tile.presetName}`,
  });
  state.activeHistoryIdx = state.history.length - 1;

  closePanelUI();
  renderHistory();
  renderGrid();
}

// =====================================================================
// History
// =====================================================================
function renderHistory() {
  historyList.innerHTML = '';
  if (!state.history.length) {
    historyList.innerHTML = '<div class="history-empty">No history</div>';
    return;
  }

  state.history.forEach((entry, i) => {
    const el = document.createElement('div');
    el.className = 'history-entry' + (i === state.activeHistoryIdx ? ' active' : '');

    // Thumbnail — fit within 36×36 preserving aspect ratio
    const thumb = document.createElement('canvas');
    thumb.className = 'history-thumb';
    thumb.width  = 36;
    thumb.height = 36;
    const tctx = thumb.getContext('2d');
    const sw = entry.canvas.width, sh = entry.canvas.height;
    const scale = Math.min(36 / sw, 36 / sh);
    const dw = sw * scale, dh = sh * scale;
    const dx = (36 - dw) / 2, dy = (36 - dh) / 2;
    tctx.drawImage(entry.canvas, dx, dy, dw, dh);

    const info = document.createElement('div');
    info.className = 'history-entry-info';
    const label = document.createElement('div');
    label.className = 'history-entry-label';
    label.textContent = entry.label;
    const sub = document.createElement('div');
    sub.className = 'history-entry-sub';
    sub.textContent = `Step ${i + 1}`;
    info.appendChild(label);
    info.appendChild(sub);

    el.appendChild(thumb);
    el.appendChild(info);

    el.tabIndex = 0;
    el.addEventListener('click', () => restoreHistory(i));
    el.addEventListener('keydown', e => {
      const entries = [...historyList.querySelectorAll('.history-entry')];
      const cur = entries.indexOf(e.currentTarget);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        entries[Math.max(0, cur - 1)]?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        entries[Math.min(entries.length - 1, cur + 1)]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        restoreHistory(i);
      }
    });
    historyList.appendChild(el);
  });

  // Scroll to active
  const active = historyList.querySelector('.history-entry.active');
  active?.scrollIntoView({ block: 'nearest' });
}

function restoreHistory(idx) {
  const entry = state.history[idx];
  if (!entry) return;
  state.activeHistoryIdx = idx;
  state.baseCanvas    = entry.canvas;
  state.baseImageData = entry.canvas.getContext('2d').getImageData(0, 0, entry.canvas.width, entry.canvas.height);
  renderHistory();
  renderGrid();
}

// =====================================================================
// Large image preview (Space key — hold or tap-toggle)
// =====================================================================
const preview = {
  visible: false,
  holdMode: false,    // true = showing due to hold, close on keyup
  holdTimer: null,
  HOLD_MS: 180,       // ms to distinguish hold from tap
};

function showPreview() {
  if (!state.baseImageData) return;

  // Show focused tile result if available, otherwise base image
  const idx = state.focusedTileIdx;
  const tile = idx >= 0 ? state.tiles[idx] : null;
  const useFiltered = tile && tile.resultImageData && !FILTERS[tile.filterId]?.meta;

  const imgData = useFiltered ? tile.resultImageData : state.baseImageData;
  const label   = useFiltered
    ? `${FILTERS[tile.filterId]?.name} — ${tile.presetName}`
    : 'Original';

  previewCanvas.width  = imgData.width;
  previewCanvas.height = imgData.height;
  previewCanvas.getContext('2d').putImageData(imgData, 0, 0);
  previewLabel.textContent = label;
  previewDims.innerHTML = `${imgData.width} × ${imgData.height} &nbsp;·&nbsp; <kbd>Space</kbd> or <kbd>Esc</kbd> to close`;

  previewOverlay.classList.remove('hidden');
  previewClose.focus();
  preview.visible = true;
  updateKeybindBar();
}

function hidePreview() {
  previewOverlay.classList.add('hidden');
  preview.visible  = false;
  preview.holdMode = false;
  updateKeybindBar();
}

previewClose.addEventListener('click', hidePreview);
previewOverlay.addEventListener('click', e => {
  // Click outside canvas closes
  if (e.target === previewOverlay || e.target.classList.contains('preview-canvas-wrap')) hidePreview();
});

// Space key — hold-vs-tap detection
function isInteractiveTarget(el) {
  return ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName);
}

document.addEventListener('keydown', e => {
  if (e.key === ' ' && !e.repeat && !isInteractiveTarget(document.activeElement)) {
    e.preventDefault();
    preview.holdTimer = setTimeout(() => {
      preview.holdMode = true;
      if (!preview.visible) showPreview();
    }, preview.HOLD_MS);
  }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ') {
    clearTimeout(preview.holdTimer);
    if (preview.holdMode) {
      // Release hold — close
      hidePreview();
      preview.holdMode = false;
    } else {
      // Tap — toggle
      if (preview.visible) hidePreview();
      else showPreview();
    }
  }
});

// =====================================================================
// Keybind bar
// =====================================================================
function kb(key, action) {
  return `<span class="kb-item"><span class="kb-key">${key}</span><span class="kb-action">${action}</span></span>`;
}

function updateKeybindBar() {
  if (preview.visible) {
    keybindBar.innerHTML =
      kb('Space', 'Close preview') +
      kb('Esc', 'Close preview');
    return;
  }

  if (!state.baseImageData) {
    keybindBar.innerHTML =
      kb('Drop / Browse', 'Load image');
    return;
  }

  if (state.panelOpen) {
    keybindBar.innerHTML =
      kb('Enter', 'Promote') +
      kb('Tab', 'Parameters') +
      kb('Space', 'Preview') +
      kb('Esc', 'Close panel');
    return;
  }

  if (state.focusedTileIdx >= 0) {
    keybindBar.innerHTML =
      kb('↑↓←→', 'Navigate') +
      kb('Enter', 'Open filter') +
      kb('Space', 'Preview') +
      kb('Esc', 'Deselect') +
      kb('Ctrl+1–5', 'Switch tab');
    return;
  }

  // Image loaded, nothing focused
  keybindBar.innerHTML =
    kb('↑↓←→', 'Navigate tiles') +
    kb('Space', 'Preview') +
    kb('Ctrl+1–5', 'Switch tab');
}

// Also handle Escape for preview when overlay is open
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && preview.visible) {
    e.preventDefault();
    hidePreview();
  }
});

// =====================================================================
// Init
// =====================================================================
renderTabs();
updateKeybindBar();
