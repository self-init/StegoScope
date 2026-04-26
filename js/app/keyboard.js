/**
 * Keyboard module.
 * Tab bar arrow nav only — all other keyboard handling stays in app.js
 * (preview hold/release, global Ctrl shortcuts, Esc).
 */
import { state } from './state.js';

export function handleTabBarKeydown(e) {
  const tabs = [...document.querySelectorAll('.tab-btn')];
  const cur  = tabs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.baseImageData) {
      const tileGrid = document.getElementById('tile-grid');
      tileGrid?.children[0]?.focus();
    }
  } else if (e.key === 'ArrowLeft' && cur > 0) {
    e.preventDefault(); tabs[cur - 1].focus();
  } else if (e.key === 'ArrowRight' && cur < tabs.length - 1) {
    e.preventDefault(); tabs[cur + 1].focus();
  }
}

export function getGridCols() {
  const tileGrid = document.getElementById('tile-grid');
  return tileGrid ? getComputedStyle(tileGrid).gridTemplateColumns.split(' ').length : 5;
}
