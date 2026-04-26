/**
 * Menu module.
 * Menu bar open/close, dropdown rendering. Delegates cross-module actions via _onAction.
 */
import { state } from './state.js';

let _onAction = null;
export function onAction(fn) { _onAction = fn; }

// Resolved in initMenu
let _menuDropdown = null;
let _menubar = null;
let _fileInput = null;
export { _menubar as menubar };

export function initMenu() {
  _menuDropdown = document.getElementById('menu-dropdown');
  _menubar      = document.getElementById('menubar');
  _fileInput    = document.getElementById('file-input');

  _menubar?.querySelectorAll('.menu-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const name = btn.dataset.menu;
      _onAction?.('openMenu', name);
    });
    btn.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        closeMenuDropdown();
        if (state.baseImageData) _onAction?.('focusTile', 0);
      }
    });
  });

  document.addEventListener('click', e => {
    if (openMenu && !_menubar?.contains(e.target)) closeMenuDropdown();
  });

  _menuDropdown?.addEventListener('keydown', e => {
    const items = [..._menuDropdown.querySelectorAll('.menu-item')];
    const cur   = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(cur + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(cur - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenuDropdown();
    }
  });
}

let openMenu = null;

export function openMenuDropdown(name, items) {
  if (openMenu === name) { closeMenuDropdown(); return; }
  openMenu = name;

  if (!_menuDropdown) return;
  _menuDropdown.innerHTML = '';
  items.forEach(item => {
    if (item.sep) {
      const s = document.createElement('div');
      s.className = 'menu-item-sep';
      _menuDropdown.appendChild(s);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    const checkSpan = `<span class="menu-check">${'checked' in item && item.checked ? '✓' : ''}</span>`;
    const left = `<span class="menu-left">${checkSpan}<span>${escHtml(item.label)}</span></span>`;
    if (item.keyhint) {
      btn.innerHTML = left + `<span class="menu-item-hint">${escHtml(item.keyhint)}</span>`;
    } else {
      btn.innerHTML = left;
    }
    btn.addEventListener('click', () => { closeMenuDropdown(); item.action(); });
    _menuDropdown.appendChild(btn);
  });

  const triggerBtn = _menubar?.querySelector(`.menu-btn[data-menu="${name}"]`);
  if (triggerBtn) {
    _menuDropdown.style.left = triggerBtn.getBoundingClientRect().left + 'px';
  }
  _menuDropdown.classList.remove('hidden');
  _menuDropdown.querySelector('.menu-item')?.focus();
}

export function closeMenuDropdown() {
  openMenu = null;
  _menuDropdown?.classList.add('hidden');
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
