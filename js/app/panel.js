/**
 * Panel module.
 * Parameter panel + presets + promote.
 * User actions delegate back to app.js via _onAction callback.
 */
import { state } from './state.js';
import { FILTERS } from '../filters/index.js';
import { imageDataChecksum } from './cache.js';

let _onAction = null;
export function onAction(fn) { _onAction = fn; }

export function initPanel() {
  const promoteBtn = document.getElementById('promote-btn');
  const applyBtn   = document.getElementById('apply-btn');
  const exportBtn  = document.getElementById('export-tile-btn');
  const paramClose = document.getElementById('param-panel-close');

  promoteBtn?.addEventListener('click', () => _onAction?.('promoteCurrentTile'));
  applyBtn?.addEventListener('click', () => _onAction?.('applyAndPromote'));
  exportBtn?.addEventListener('click', () => _onAction?.('exportTile'));

  paramClose?.addEventListener('click', () => {
    const prev = state.panelTileIdx;
    _onAction?.('hidePropertiesPanel');
    if (prev >= 0) _onAction?.('focusTile', prev);
  });

  // Arrow nav: Promote/Apply buttons → preset pills / param controls
  [promoteBtn, applyBtn].forEach(btn => {
    btn?.addEventListener('keydown', e => {
      if (!state.panelOpen) return;
      const presetBar = document.getElementById('preset-bar');
      const pills = [...presetBar?.querySelectorAll('.preset-pill') ?? []];
      const paramCtrls = document.getElementById('param-controls');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (pills.length) pills[0].focus(); else _onAction?.('focusFirstControl');
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _onAction?.('focusLastControl');
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (state.panelTileIdx >= 0) _onAction?.('focusTile', state.panelTileIdx);
      }
    });
  });

  // Arrow nav: param controls → preset pills / promote button
  const paramCtrls = document.getElementById('param-controls');
  paramCtrls?.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const controls = [...paramCtrls.querySelectorAll('input[type="range"], select')];
    const cur = controls.indexOf(document.activeElement);
    if (cur === -1) return;
    const promoteBtn = document.getElementById('promote-btn');
    const presetBar = document.getElementById('preset-bar');
    const pills = [...presetBar?.querySelectorAll('.preset-pill') ?? []];
    if (e.key === 'ArrowUp' && cur === 0) {
      e.preventDefault();
      (pills.at(-1) ?? promoteBtn)?.focus();
    } else if (e.key === 'ArrowDown' && cur === controls.length - 1) {
      e.preventDefault();
      promoteBtn?.focus();
    }
  });
}

export function openPanel(idx) {
  if (!state.propertiesPanelOpen) return;

  const tile = state.tiles[idx];
  if (!tile) return;
  const filter = FILTERS[tile.filterId];
  if (!filter) return;

  const tileGrid = document.getElementById('tile-grid');
  tileGrid?.querySelectorAll('.tile-active-panel').forEach(el => el.classList.remove('tile-active-panel'));
  tileGrid?.children[idx]?.classList.add('tile-active-panel');

  state.panelOpen    = true;
  state.panelTileIdx = idx;
  state.panelParams  = { ...tile.params };
  state.panelDirty   = false;

  const paramPanel            = document.getElementById('param-panel');
  const paramPanelPlaceholder = document.getElementById('param-panel-placeholder');
  const paramPanelBody        = document.getElementById('param-panel-body');
  const paramTitle           = document.getElementById('param-panel-title');
  const promoteBtn           = document.getElementById('promote-btn');

  if (paramPanelPlaceholder) paramPanelPlaceholder.hidden = true;
  if (paramPanelBody) paramPanelBody.hidden = false;
  if (paramTitle) paramTitle.textContent = filter.name;

  _onAction?.('renderPresetBar', filter, tile.presetName);
  _onAction?.('renderParamControls', filter, state.panelParams);
  _onAction?.('updatePromoteBtn');
  _onAction?.('updateExportBtn');
  _onAction?.('updateKeybindBar');
  promoteBtn?.focus();
}

export function closePanelUI() {
  const tileGrid = document.getElementById('tile-grid');
  tileGrid?.querySelectorAll('.tile-active-panel').forEach(el => el.classList.remove('tile-active-panel'));
  state.panelOpen    = false;
  state.panelTileIdx = -1;

  const presetBar = document.getElementById('preset-bar');
  const paramCtrls = document.getElementById('param-controls');
  const paramPanelPlaceholder = document.getElementById('param-panel-placeholder');
  const paramPanelBody = document.getElementById('param-panel-body');

  if (presetBar) presetBar.innerHTML = '';
  if (paramCtrls) paramCtrls.innerHTML = '';
  if (state.propertiesPanelOpen) {
    if (paramPanelPlaceholder) paramPanelPlaceholder.hidden = false;
    if (paramPanelBody) paramPanelBody.hidden = true;
  }
  _onAction?.('updateKeybindBar');
}

export function hidePropertiesPanel() {
  state.propertiesPanelOpen = false;
  state.panelOpen = false;
  state.panelTileIdx = -1;
  const paramPanel = document.getElementById('param-panel');
  paramPanel?.classList.add('panel-hidden');
  _onAction?.('clearTileActivePanel');
  _onAction?.('updateKeybindBar');
}

export function showPropertiesPanel() {
  state.propertiesPanelOpen = true;
  const paramPanel = document.getElementById('param-panel');
  paramPanel?.classList.remove('panel-hidden');
  _onAction?.('updateKeybindBar');
}

export function renderPresetBar(filter, activePresetName) {
  const presetBar = document.getElementById('preset-bar');
  if (!presetBar) return;
  presetBar.innerHTML = '';
  if (!filter.presets?.length) return;

  const title = document.createElement('div');
  title.className = 'preset-bar-title';
  title.textContent = 'Presets';
  presetBar.appendChild(title);

  filter.presets.forEach(preset => {
    const pill = document.createElement('button');
    pill.className = 'preset-pill' + (preset.name === activePresetName ? ' active' : '');
    pill.textContent = preset.name;
    pill.addEventListener('click', () => {
      state.panelParams = { ...preset.params };
      _onAction?.('renderPresetBar', filter, preset.name);
      _onAction?.('renderParamControls', filter, state.panelParams);
      _onAction?.('markDirty');
      if (state.panelDirty) _onAction?.('applyParamPreview');
    });
    pill.addEventListener('keydown', e => {
      const pills = [...presetBar.querySelectorAll('.preset-pill')];
      const cur   = pills.indexOf(e.currentTarget);
      const promoteBtn = document.getElementById('promote-btn');
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (cur > 0) pills[cur - 1].focus(); else promoteBtn?.focus();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (cur < pills.length - 1) pills[cur + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        promoteBtn?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        _onAction?.('focusFirstControl');
      }
    });
    presetBar.appendChild(pill);
  });
}

export function renderParamControls(filter, params) {
  const paramCtrls = document.getElementById('param-controls');
  if (!paramCtrls) return;
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
      const valSpan = Object.assign(document.createElement('span'), {
        className: 'param-value',
        textContent: params[schema.id] ?? schema.min,
      });
      labelRow.appendChild(labelText);
      labelRow.appendChild(valSpan);

      const slider = document.createElement('input');
      slider.type      = 'range';
      slider.className = 'param-slider';
      slider.min       = schema.min;
      slider.max       = schema.max;
      slider.step      = schema.step ?? 1;
      slider.value     = params[schema.id] ?? schema.min;
      slider.dataset.id = schema.id;

      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        params[schema.id] = v;
        valSpan.textContent = v;
        _onAction?.('markDirty');
        if (FILTERS[state.tiles[state.panelTileIdx]?.filterId]) _onAction?.('applyParamPreview');
      });

      group.appendChild(labelRow);
      group.appendChild(slider);
    } else if (schema.type === 'select') {
      const labelEl = Object.assign(document.createElement('div'), {
        className: 'param-label', textContent: schema.label,
      });
      const sel = document.createElement('select');
      sel.className = 'param-select';
      schema.options?.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === params[schema.id]) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        params[schema.id] = sel.value;
        _onAction?.('markDirty');
        if (FILTERS[state.tiles[state.panelTileIdx]?.filterId]) _onAction?.('applyParamPreview');
      });
      sel.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
        if (e.key === 'Enter') { e.preventDefault(); sel.click(); }
      });
      group.appendChild(labelEl);
      group.appendChild(sel);
    }

    paramCtrls.appendChild(group);
  });
}

export function markDirty() {
  state.panelDirty = true;
  _onAction?.('updatePromoteBtn');
}

export function updatePromoteBtn() {
  const filter = FILTERS[state.tiles[state.panelTileIdx]?.filterId];
  const promoteBtn = document.getElementById('promote-btn');
  const applyBtn   = document.getElementById('apply-btn');
  if (promoteBtn) promoteBtn.disabled = !!filter?.meta;
  if (state.panelDirty) {
    if (applyBtn) applyBtn.hidden = false;
    if (promoteBtn) promoteBtn.textContent = 'Apply & Promote';
  } else {
    if (applyBtn) applyBtn.hidden = true;
    if (promoteBtn) promoteBtn.textContent = 'Promote';
  }
}

export function updateExportBtn() {
  const tile = state.panelTileIdx >= 0 ? state.tiles[state.panelTileIdx] : null;
  const exportBtn = document.getElementById('export-tile-btn');
  if (exportBtn) exportBtn.disabled = !tile?.resultImageData;
}

export async function applyParamPreview() {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile = state.tiles[idx];
  tile.params = { ...state.panelParams };
  await _onAction?.('runTile', idx);
  state.panelDirty = true;
  _onAction?.('updatePromoteBtn');
}

export async function promoteCurrentTile() {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile   = state.tiles[idx];
  const filter = FILTERS[tile.filterId];
  if (state.panelDirty) {
    tile.params = { ...state.panelParams };
    await _onAction?.('runTile', idx);
    state.panelDirty = true;
    _onAction?.('updatePromoteBtn');
    _onAction?.('promote', idx);
    return;
  }
  _onAction?.('promote', idx);
}

export function promote(idx) {
  const tile   = state.tiles[idx];
  const filter = FILTERS[tile.filterId];
  if (!tile?.resultImageData || filter?.meta) return;

  const newCanvas = document.createElement('canvas');
  newCanvas.width  = tile.resultImageData.width;
  newCanvas.height = tile.resultImageData.height;
  newCanvas.getContext('2d').putImageData(tile.resultImageData, 0, 0);

  state.baseCanvas    = newCanvas;
  state.baseImageData = tile.resultImageData;
  state.baseImageDataChecksum = imageDataChecksum(state.baseImageData);
  state.tileResultCache = new Map();
  state.history       = state.history.slice(0, state.activeHistoryIdx + 1);
  state.history.push({
    canvas:     newCanvas,
    filterId:   tile.filterId,
    presetName: tile.presetName,
    label:      `${filter?.name ?? tile.filterId} — ${tile.presetName}`,
  });
  state.activeHistoryIdx = state.history.length - 1;

  _onAction?.('closePanelUI');
  _onAction?.('renderHistory');
  _onAction?.('renderGrid');
}

export function metaResultToText(result) {
  if (result?.text) return result.text;
  if (Array.isArray(result?.entries)) {
    return result.entries.map(e => `${e.label ?? ''}: ${e.detail ?? ''}`).join('\n');
  }
  if (result?.entries) {
    return Object.entries(result.entries).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  return '';
}

export function exportTile() {
  const tile   = state.tiles[state.panelTileIdx];
  const filter = FILTERS[tile?.filterId];
  if (!tile?.resultImageData) return;

  const safeName = `${filter?.name ?? tile.filterId}-${tile.presetName ?? ''}`
    .replace(/[^a-z0-9_-]/gi, '-').toLowerCase();

  if (filter?.meta) {
    const text = metaResultToText(tile.resultImageData);
    _onAction?.('downloadBlob', new Blob([text], { type: 'text/plain' }), `${safeName}.txt`);
    return;
  }

  const tmp = document.createElement('canvas');
  tmp.width  = tile.resultImageData.width;
  tmp.height = tile.resultImageData.height;
  tmp.getContext('2d').putImageData(tile.resultImageData, 0, 0);
  tmp.toBlob(blob => _onAction?.('downloadBlob', blob, `${safeName}.png`), 'image/png');
}
