/* Dildows 7 - main script.
   Bootstraps and wires together all managers: AppManager, WindowManager,
   TaskbarManager, DesktopManager, and StartMenuManager. */
'use strict';

/* Central registry of every launchable application.
   Each entry provides the window title, taskbar icon class, default size,
   and the <template> ID whose content is cloned into the window body.
   fixedSize: true disables resize handles and the maximize button.
   aliasOf: redirects a key to another entry (e.g. 'pictures' → 'computer'). */
const APP_REGISTRY = {
  aboutme:      { title: 'About Me',            icon: 'icon-aboutme',      width: 760, height: 540, template: 'content-aboutme' },
  computer:     { title: 'Computer',            icon: 'icon-computer',     width: 700, height: 460, template: 'content-computer' },
  notepad:      { title: 'Untitled - Notepad',  icon: 'icon-notepad',      width: 520, height: 440, template: 'content-notepad' },
  calculator:   { title: 'Calculator',          icon: 'icon-calculator',   width: 280, height: 380, template: 'content-calculator', fixedSize: true },
  paint:        { title: 'untitled - Paint',    icon: 'icon-paint',        width: 760, height: 540, template: 'content-paint' },
  ie:           { title: 'Dildows Internet Explorer', icon: 'icon-ie', width: 760, height: 540, template: 'content-ie' },
  mediaplayer:  { title: 'Windows Media Player', icon: 'icon-mediaplayer', width: 360, height: 480, template: 'content-mediaplayer' },
  recyclebin:   { title: 'Recycle Bin',         icon: 'icon-recyclebin',   width: 560, height: 400, template: 'content-recyclebin' },
  games:        { title: 'Games',               icon: 'icon-games',        width: 480, height: 320, template: 'content-games' },
  solitaire:    { title: 'Solitaire',           icon: 'icon-solitaire',    width: 680, height: 560, template: 'content-solitaire' },
  minesweeper:  { title: 'Minesweeper',         icon: 'icon-minesweeper',  width: 340, height: 460, template: 'content-minesweeper', fixedSize: true },
  chesstitans:  { title: 'Chess Titans',        icon: 'icon-chess',        width: 460, height: 480, template: 'content-chesstitans' },
  doom:         { title: 'DOOM',                icon: 'icon-doom',         width: 680, height: 500, template: 'content-doom' },
  controlpanel: { title: 'Control Panel',       icon: 'icon-computer',     width: 600, height: 420, template: 'content-controlpanel' },
  devices:      { title: 'Devices and Printers',icon: 'icon-computer',     width: 560, height: 380, template: 'content-devices' },
  help:         { title: 'Windows Help and Support', icon: 'icon-ie',      width: 560, height: 440, template: 'content-help' },
  pictures:     { aliasOf: 'computer' },
  'aboutme-docs': { aliasOf: 'computer' },
};

/* ── Utilities ───────────────────────────────────────────── */
function clamp(val, min, max) { return Math.max(min, Math.min(max, val)); }
function uid(prefix) { return prefix + '-' + Math.random().toString(36).slice(2, 9); }

/* ── SoundManager ────────────────────────────────────────── *
 * Thin wrapper around <audio> elements defined in index.html.
 * Each method resets currentTime so rapid repeats always play from the start.
 * Errors (e.g. missing file, autoplay policy) are swallowed silently. */
class SoundManager {
  _play(id) {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      el.currentTime = 0;
      el.play().catch(() => {});
    } catch (e) {}
  }
  click()   { this._play('snd-click'); }
  open()    { this._play('snd-open');  }
  close()   { this._play('snd-close'); }
  error()   { this._play('snd-error'); }
  startup() { this._play('snd-boot');  }
}
const Sound = new SoundManager();

/* ── DesktopManager ──────────────────────────────────────── *
 * Manages desktop icons: double-click to launch, drag to reposition
 * with Windows-7-accurate grid snapping, rubber-band multi-select,
 * multi-icon drag, right-click context menus, and icon view modes.
 *
 * Grid system:
 *   - Icons snap to a virtual grid cell (GRID_W × GRID_H).
 *   - Each icon occupies exactly one cell; no two icons share a cell.
 *   - On drop, the nearest free cell is chosen (like real Windows 7).
 *   - Multi-selected icons maintain their relative cell offsets when dragged.
 */
class DesktopManager {
  constructor(appManager) {
    this.appManager = appManager;
    this.desktopEl = document.getElementById('desktop');
    this.iconsEl = document.getElementById('desktop-icons');
    this.selectionBox = document.getElementById('selection-box');
    this.desktopMenu = document.getElementById('desktop-context-menu');
    this.iconMenu = document.getElementById('icon-context-menu');
    this.selecting = false;
    this.selectStart = { x: 0, y: 0 };
    this.activeIconForMenu = null;

    // Grid cell dimensions (px) — must match icon slot size
    this.GRID_W = 90;
    this.GRID_H = 94;
    this.GRID_PAD_X = 10; // desktop left/top padding
    this.GRID_PAD_Y = 10;
    this.TASKBAR_H = 40;

    // Map<iconEl, {col, row}> — current grid position of each icon
    this.iconPositions = new Map();

    this._initGrid();
    this._bind();
  }

  /* ── Grid helpers ──────────────────────────────────────── */

  _cols() {
    return Math.max(1, Math.floor((window.innerWidth - this.GRID_PAD_X) / this.GRID_W));
  }
  _rows() {
    return Math.max(1, Math.floor((window.innerHeight - this.TASKBAR_H - this.GRID_PAD_Y) / this.GRID_H));
  }

  /** Convert pixel position (top-left of icon) → nearest grid cell {col, row} */
  _pxToCell(x, y) {
    const col = Math.round((x - this.GRID_PAD_X) / this.GRID_W);
    const row = Math.round((y - this.GRID_PAD_Y) / this.GRID_H);
    return { col: Math.max(0, col), row: Math.max(0, row) };
  }

  /** Convert grid cell → pixel position (top-left of icon's bounding cell) */
  _cellToPx(col, row) {
    return {
      x: this.GRID_PAD_X + col * this.GRID_W,
      y: this.GRID_PAD_Y + row * this.GRID_H,
    };
  }

  /** Set an icon's screen position based on its grid cell. */
  _placeIcon(icon, col, row) {
    const { x, y } = this._cellToPx(col, row);
    icon.style.position = 'absolute';
    icon.style.left = x + 'px';
    icon.style.top  = y + 'px';
    this.iconPositions.set(icon, { col, row });
  }

  /** Returns a Set of "col,row" strings for all currently occupied cells,
   *  optionally excluding a set of icon elements. */
  _occupiedCells(excludeIcons = new Set()) {
    const occupied = new Set();
    this.iconPositions.forEach((pos, icon) => {
      if (!excludeIcons.has(icon)) occupied.add(`${pos.col},${pos.row}`);
    });
    return occupied;
  }

  /** Find the nearest free cell to (targetCol, targetRow), scanning outward. */
  _nearestFreeCell(targetCol, targetRow, occupied) {
    const cols = this._cols();
    const rows = this._rows();
    // BFS-style outward spiral search
    for (let radius = 0; radius <= Math.max(cols, rows); radius++) {
      for (let dc = -radius; dc <= radius; dc++) {
        for (let dr = -radius; dr <= radius; dr++) {
          if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
          const c = targetCol + dc;
          const r = targetRow + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (!occupied.has(`${c},${r}`)) return { col: c, row: r };
        }
      }
    }
    return { col: targetCol, row: targetRow }; // fallback
  }

  /** Place all icons initially in a column-first grid layout. */
  _initGrid() {
    // Switch the icons container to absolute positioning mode
    this.iconsEl.style.position = 'absolute';
    this.iconsEl.style.inset = '0';
    this.iconsEl.style.display = 'block';
    this.iconsEl.style.width = '100%';
    this.iconsEl.style.height = `calc(100% - ${this.TASKBAR_H}px)`;

    const icons = Array.from(this.iconsEl.querySelectorAll('.desktop-icon'));
    const rows = this._rows();
    icons.forEach((icon, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      this._placeIcon(icon, col, row);
    });
  }

  /* ── Event binding ─────────────────────────────────────── */

  _bind() {
    this.iconsEl.querySelectorAll('.desktop-icon').forEach(icon => this._bindIcon(icon));

    // Rubber-band selection on bare desktop
    this.desktopEl.addEventListener('mousedown', (e) => {
      const onDesktop = e.target === this.desktopEl || e.target === this.iconsEl || e.target.id === 'windows-container' || e.target.classList.contains('background');
      if (!onDesktop) return;
      this._closeAllContextMenus();
      this._deselectAll();
      this.selecting = true;
      const rect = this.desktopEl.getBoundingClientRect();
      this.selectStart = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      this.selectionBox.style.left = this.selectStart.x + 'px';
      this.selectionBox.style.top = this.selectStart.y + 'px';
      this.selectionBox.style.width = '0px';
      this.selectionBox.style.height = '0px';
      this.selectionBox.style.display = 'block';
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.selecting) return;
      const rect = this.desktopEl.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      const left = Math.min(curX, this.selectStart.x);
      const top = Math.min(curY, this.selectStart.y);
      const w = Math.abs(curX - this.selectStart.x);
      const h = Math.abs(curY - this.selectStart.y);
      this.selectionBox.style.left = left + 'px';
      this.selectionBox.style.top = top + 'px';
      this.selectionBox.style.width = w + 'px';
      this.selectionBox.style.height = h + 'px';

      // Hit-test against absolute icon positions
      this.iconsEl.querySelectorAll('.desktop-icon').forEach(icon => {
        const iLeft = parseInt(icon.style.left, 10) || 0;
        const iTop  = parseInt(icon.style.top,  10) || 0;
        const iRight  = iLeft + icon.offsetWidth;
        const iBottom = iTop  + icon.offsetHeight;
        const overlap = !(iRight < left || iLeft > left + w || iBottom < top || iTop > top + h);
        icon.classList.toggle('selected', overlap);
      });
    });

    document.addEventListener('mouseup', () => {
      if (this.selecting) {
        this.selecting = false;
        this.selectionBox.style.display = 'none';
      }
    });

    this.desktopEl.addEventListener('contextmenu', (e) => {
      if (e.target === this.desktopEl || e.target === this.iconsEl || e.target.id === 'windows-container') {
        e.preventDefault();
        this._closeAllContextMenus();
        this._openContextMenu(this.desktopMenu, e.clientX, e.clientY);
      }
    });

    this.desktopMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-item');
      if (!item) return;
      this._handleDesktopMenuAction(item.dataset.action);
      this._closeAllContextMenus();
    });

    this.iconMenu.addEventListener('click', (e) => {
      const item = e.target.closest('.context-item');
      if (!item) return;
      this._handleIconMenuAction(item.dataset.action);
      this._closeAllContextMenus();
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.context-menu')) this._closeAllContextMenus();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this._closeAllContextMenus();
    });
  }

  _bindIcon(icon) {
    let lastClick = 0;
    icon.addEventListener('dragstart', (e) => e.preventDefault());

    icon.addEventListener('mousedown', (e) => {
      e.stopPropagation();

      // Selection logic
      if (e.ctrlKey) {
        icon.classList.toggle('selected');
      } else if (!icon.classList.contains('selected')) {
        this._deselectAll();
        icon.classList.add('selected');
      }
      // If already selected and multi-selected, keep group

      const selectedIcons = Array.from(this.iconsEl.querySelectorAll('.desktop-icon.selected'));
      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;
      const DRAG_THRESHOLD = 4;

      // Record each icon's starting pixel position and cell, and cursor offset from the primary icon
      const primaryRect = icon.getBoundingClientRect();
      const parentRect = this.desktopEl.getBoundingClientRect();
      const cursorOffsetX = startX - primaryRect.left;
      const cursorOffsetY = startY - primaryRect.top;

      // Snapshot start positions (px) for all dragged icons
      const startPositions = selectedIcons.map(ic => ({
        icon: ic,
        startLeft: parseInt(ic.style.left, 10) || 0,
        startTop:  parseInt(ic.style.top,  10) || 0,
        cell: this.iconPositions.get(ic) || { col: 0, row: 0 },
      }));

      // Primary icon's start position
      const primaryStart = startPositions.find(s => s.icon === icon) || startPositions[0];

      // Ghost overlay for multi-drag preview
      let ghostEls = [];

      const moveHandler = (ev) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!isDragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

        if (!isDragging) {
          isDragging = true;
          // Create semi-transparent ghost copies for all dragged icons
          selectedIcons.forEach(ic => {
            const ghost = ic.cloneNode(true);
            ghost.style.opacity = '0.55';
            ghost.style.pointerEvents = 'none';
            ghost.style.position = 'absolute';
            ghost.style.zIndex = '9998';
            ghost.classList.add('icon-ghost');
            this.iconsEl.appendChild(ghost);
            ghostEls.push({ ghost, icon: ic });
          });
          selectedIcons.forEach(ic => { ic.style.opacity = '0.25'; });
        }

        // Move ghosts
        ghostEls.forEach(({ ghost, icon: ic }) => {
          const sp = startPositions.find(s => s.icon === ic);
          let nx = sp.startLeft + dx;
          let ny = sp.startTop  + dy;
          // clamp to desktop area
          nx = Math.max(0, Math.min(nx, window.innerWidth - 90));
          ny = Math.max(0, Math.min(ny, window.innerHeight - this.TASKBAR_H - 94));
          ghost.style.left = nx + 'px';
          ghost.style.top  = ny + 'px';
        });
      };

      const upHandler = () => {
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);

        // Cleanup ghosts
        ghostEls.forEach(({ ghost }) => ghost.remove());
        ghostEls = [];
        selectedIcons.forEach(ic => { ic.style.opacity = ''; });

        if (!isDragging) {
          // Click / double-click
          const now = Date.now();
          if (now - lastClick < 400) this._launchFromIcon(icon);
          lastClick = now;
          return;
        }

        // ── Snap all dragged icons to grid ──────────────────────
        const dx = e.clientX - startX; // stale after mouseup — use last ev
        // We need to recompute from ghost final positions
        const excluded = new Set(selectedIcons);
        const occupied = this._occupiedCells(excluded);

        // Compute desired target cell for the primary icon based on cursor
        const primaryGhost = ghostEls.length ? null : null; // ghosts removed already
        // Use start + delta approach: reconstruct from last mousemove via stored ghost positions
        // Since ghosts are removed, compute from startPositions + accumulated dx/dy
        // We can get dx from last moveHandler — store it in closure
        // Actually we need the last ev position; use a stored ref:
        const lastEv = { clientX: e._lastClientX || startX, clientY: e._lastClientY || startY };

        // Better: track last mouse position in a ref
        const finalDx = (DesktopManager._lastMouseX || startX) - startX;
        const finalDy = (DesktopManager._lastMouseY || startY) - startY;

        // For each selected icon, compute its desired pixel pos and snap it
        // Process in order to avoid cell conflicts
        const assignments = [];
        startPositions.forEach(sp => {
          const desiredX = sp.startLeft + finalDx;
          const desiredY = sp.startTop  + finalDy;
          const desired = this._pxToCell(desiredX, desiredY);
          // Clamp to grid bounds
          desired.col = Math.max(0, Math.min(desired.col, this._cols() - 1));
          desired.row = Math.max(0, Math.min(desired.row, this._rows() - 1));

          // Find nearest free cell (considering already-assigned ones this drop)
          const allOccupied = new Set([...occupied, ...assignments.map(a => `${a.col},${a.row}`)]);
          const free = this._nearestFreeCell(desired.col, desired.row, allOccupied);
          assignments.push({ icon: sp.icon, col: free.col, row: free.row });
        });

        assignments.forEach(({ icon: ic, col, row }) => {
          this._placeIcon(ic, col, row);
        });
      };

      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    });

    icon.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._launchFromIcon(icon);
    });

    icon.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!icon.classList.contains('selected')) {
        this._deselectAll();
        icon.classList.add('selected');
      }
      this.activeIconForMenu = icon;
      this._closeAllContextMenus();
      this._openContextMenu(this.iconMenu, e.clientX, e.clientY);
    });
  }

  _launchFromIcon(icon) {
    const app = icon.dataset.app;
    Sound.click();
    this.appManager.launch(app);
  }

  _deselectAll() {
    this.iconsEl.querySelectorAll('.desktop-icon.selected').forEach(i => i.classList.remove('selected'));
  }

  _openContextMenu(menu, x, y) {
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.classList.add('open');
    requestAnimationFrame(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 6) + 'px';
      if (rect.bottom > window.innerHeight - 40) menu.style.top = (window.innerHeight - rect.height - 46) + 'px';
    });
  }

  _closeAllContextMenus() {
    document.querySelectorAll('.context-menu').forEach(m => m.classList.remove('open'));
  }

  _handleDesktopMenuAction(action) {
    switch (action) {
      case 'view-large': this._setIconSize('large'); break;
      case 'view-medium': this._setIconSize('medium'); break;
      case 'view-small': this._setIconSize('small'); break;
      case 'refresh': this._refreshAnim(); break;
      case 'new-textdoc': this.appManager.launch('notepad'); break;
      case 'new-folder': DialogManager.info('New Folder', 'A new folder has been created on the desktop.'); break;
      case 'personalize': DialogManager.info('Personalize', 'Personalization settings are not available in this demo.'); break;
      default: break;
    }
  }

  _setIconSize(size) {
    this.iconsEl.classList.remove('icons-small', 'icons-medium');
    if (size === 'small') {
      this.GRID_W = 80; this.GRID_H = 60;
      this.iconsEl.classList.add('icons-small');
    } else if (size === 'medium') {
      this.GRID_W = 84; this.GRID_H = 78;
      this.iconsEl.classList.add('icons-medium');
    } else {
      this.GRID_W = 90; this.GRID_H = 94;
    }
    // Re-snap all icons to grid with new cell size
    const icons = Array.from(this.iconsEl.querySelectorAll('.desktop-icon:not(.icon-ghost)'));
    const rows = this._rows();
    icons.forEach((icon, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      this._placeIcon(icon, col, row);
    });
  }

  _handleIconMenuAction(action) {
    if (!this.activeIconForMenu) return;
    const icon = this.activeIconForMenu;
    switch (action) {
      case 'open': this._launchFromIcon(icon); break;
      case 'delete': DialogManager.confirm('Delete Shortcut', `Are you sure you want to delete '${icon.querySelector('.icon-label').textContent}'?`, () => {
          icon.style.opacity = '0.3';
          setTimeout(() => { icon.style.opacity = ''; }, 600);
        });
        break;
      case 'rename': DialogManager.info('Rename', 'Renaming is disabled for system icons in this demo.'); break;
      case 'properties': DialogManager.info(icon.querySelector('.icon-label').textContent + ' Properties', 'Type: Application\nLocation: Desktop'); break;
      default: break;
    }
  }

  _refreshAnim() {
    this.desktopEl.style.transition = 'filter 0.15s ease';
    this.desktopEl.style.filter = 'brightness(1.15)';
    setTimeout(() => { this.desktopEl.style.filter = ''; }, 150);
  }
}

// Track global mouse position for drag-end snapping
document.addEventListener('mousemove', (e) => {
  DesktopManager._lastMouseX = e.clientX;
  DesktopManager._lastMouseY = e.clientY;
});
/* ── WindowManager ───────────────────────────────────────── *
 * Handles the full lifecycle of every app window:
 *   - Creation from <template>, cascaded positioning, z-index stacking
 *   - Title-bar drag with Aero Snap (left/right/maximize zones)
 *   - Edge/corner resize with min-size enforcement
 *   - Minimize, maximize/restore, snap, close (with media cleanup) */
class WindowManager {
  constructor(taskbarManager) {
    this.container = document.getElementById('windows-container');
    this.windows = new Map();
    this.zCounter = 100;
    this.activeId = null;
    this.taskbarManager = taskbarManager;
    this.cascadeOffset = 0;
  }

  createWindow(appKey, config, contentEl) {
    const id = uid('win');
    const tpl = document.getElementById('tpl-window');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.app = appKey;
    node.dataset.winId = id;
    
    const titleBar = node.querySelector('.title-bar');
    const titleText = titleBar.querySelector('.title-bar-text');
    const controls = titleBar.querySelector('.title-bar-controls');
    
    titleText.textContent = config.title;
    
    const iconSpan = document.createElement('span');
    iconSpan.className = 'window-icon ' + config.icon;
    iconSpan.style.cssText = 'display:inline-block;width:20px;height:20px;margin-right:6px;background-size:contain;background-repeat:no-repeat;background-position:center;';
    titleText.prepend(iconSpan);
    
    const body = node.querySelector('.window-body-content');
    body.innerHTML = '';
    body.appendChild(contentEl);
    
    const TASKBAR_H = 40;
    const w = config.width || 600;
    const h = config.height || 420;
    
    const visibleCount = Array.from(this.windows.values()).filter(wd => !wd.minimized).length;
    const offsetAmount = (visibleCount * 28) % 140;
    
    const maxLeft = Math.max(20, window.innerWidth - w - 20);
    const maxTop = Math.max(20, window.innerHeight - TASKBAR_H - h - 10);
    
    const left = Math.min(40 + offsetAmount, maxLeft);
    const top = Math.min(36 + offsetAmount, maxTop);
    
    node.style.width = w + 'px';
    node.style.height = h + 'px';
    node.style.left = left + 'px';
    node.style.top = top + 'px';
    node.style.position = 'absolute';
    node.style.margin = '0';
    
    if (config.fixedSize) {
        node.querySelectorAll('.resize-handle').forEach(h => h.style.display = 'none');
        controls.querySelector('.Maximize').style.display = 'none';
    }
    
    this.container.appendChild(node);

    const winData = {
      id, el: node, app: appKey, config,
      minimized: false, maximized: false,
      prevRect: null, snapped: null,
      onClose: null,
      _cleanupDoom: null,
      _cleanupFunctions: []
    };
    this.windows.set(id, winData);

    this._bindWindowChrome(winData);
    this._bindDrag(winData);
    if (!config.fixedSize) this._bindResize(winData);

    this.focus(id);
    this.taskbarManager.addApp(winData);
    Sound.open();
    return winData;
  }

  _bindWindowChrome(winData) {
    const { el, id } = winData;
    el.addEventListener('mousedown', () => this.focus(id));

    el.querySelector('.Close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.close(id);
    });
    el.querySelector('.Minimize').addEventListener('click', (e) => {
      e.stopPropagation();
      this.minimize(id);
    });
    el.querySelector('.Maximize').addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMaximize(id);
    });
    el.querySelector('.title-bar').addEventListener('dblclick', (e) => {
      if (e.target.closest('.button')) return;
      this.toggleMaximize(id);
    });
  }

  _bindDrag(winData) {
    const { el, id } = winData;
    const titlebar = el.querySelector('.title-bar');
    let dragging = false, offsetX = 0, offsetY = 0;
    let snapPreviewEl = this._getSnapPreviewEl();

    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('.button')) return;
      this.focus(id);
      const wd = this.windows.get(id);
      if (wd.maximized) {
        const ratioX = (e.clientX) / window.innerWidth;
        this.toggleMaximize(id, true);
        const rect = el.getBoundingClientRect();
        el.style.left = clamp(e.clientX - rect.width * ratioX, 0, window.innerWidth - rect.width) + 'px';
        el.style.top = '4px';
        const newRect = el.getBoundingClientRect();
        offsetX = e.clientX - newRect.left;
        offsetY = e.clientY - newRect.top;
        dragging = true;
        el.classList.add('dragging');
      } else {
        dragging = true;
        const rect = el.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        el.classList.add('dragging');
      }

      const moveHandler = (ev) => {
        if (!dragging) return;
        let x = ev.clientX - offsetX;
        let y = ev.clientY - offsetY;
        
        const TASKBAR_H = 40;
        const maxY = window.innerHeight - TASKBAR_H - 10;
        y = Math.max(0, Math.min(y, maxY));
        x = clamp(x, -el.offsetWidth + 80, window.innerWidth - 80);
        
        el.style.left = x + 'px';
        el.style.top = y + 'px';

        const SNAP_MARGIN = 18;
        let snapZone = null;
        if (ev.clientX <= SNAP_MARGIN) snapZone = 'left';
        else if (ev.clientX >= window.innerWidth - SNAP_MARGIN) snapZone = 'right';
        else if (ev.clientY <= SNAP_MARGIN) snapZone = 'maximize';
        this._showSnapPreview(snapPreviewEl, snapZone);
        winData._pendingSnap = snapZone;
      };
      const upHandler = () => {
        dragging = false;
        el.classList.remove('dragging');
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        this._hideSnapPreview(snapPreviewEl);
        if (winData._pendingSnap === 'left') this.snap(id, 'left');
        else if (winData._pendingSnap === 'right') this.snap(id, 'right');
        else if (winData._pendingSnap === 'maximize') this.toggleMaximize(id, false, true);
        winData._pendingSnap = null;
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    });
  }

  _getSnapPreviewEl() {
    let el = document.getElementById('snap-preview-global');
    if (!el) {
      el = document.createElement('div');
      el.id = 'snap-preview-global';
      el.className = 'snap-preview';
      document.getElementById('desktop').appendChild(el);
    }
    return el;
  }

  _showSnapPreview(el, zone) {
    if (!zone) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    if (zone === 'left') { el.style.left = '0'; el.style.top = '0'; el.style.width = '50%'; el.style.height = 'calc(100% - 40px)'; }
    else if (zone === 'right') { el.style.left = '50%'; el.style.top = '0'; el.style.width = '50%'; el.style.height = 'calc(100% - 40px)'; }
    else if (zone === 'maximize') { el.style.left = '0'; el.style.top = '0'; el.style.width = '100%'; el.style.height = 'calc(100% - 40px)'; }
  }
  _hideSnapPreview(el) { el.style.display = 'none'; }

  snap(id, side) {
    const wd = this.windows.get(id);
    if (!wd) return;
    const el = wd.el;
    if (!wd.prevRect) {
      wd.prevRect = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
    }
    el.classList.remove('maximized');
    el.classList.remove('snapped-left', 'snapped-right');
    const h = window.innerHeight - 40;
    if (side === 'left') {
      el.style.left = '0px'; el.style.top = '0px';
      el.style.width = (window.innerWidth / 2) + 'px'; el.style.height = h + 'px';
      el.classList.add('snapped-left');
      wd.snapped = 'left';
    } else {
      el.style.left = (window.innerWidth / 2) + 'px'; el.style.top = '0px';
      el.style.width = (window.innerWidth / 2) + 'px'; el.style.height = h + 'px';
      el.classList.add('snapped-right');
      wd.snapped = 'right';
    }
  }

  _bindResize(winData) {
    const { el, id } = winData;
    const handles = el.querySelectorAll('.resize-handle');
    
    handles.forEach(handle => {
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.focus(id);
            const wd = this.windows.get(id);
            if (wd.maximized) return;
            
            let dir = '';
            for (const cls of handle.classList) {
                if (cls.startsWith('resize-') && cls !== 'resize-handle') {
                    dir = cls.replace('resize-', '');
                    break;
                }
            }
            if (!dir) return;
            
            const startX = e.clientX;
            const startY = e.clientY;
            const rect = el.getBoundingClientRect();
            
            const initial = {
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                right: rect.right,
                bottom: rect.bottom
            };
            
            const MIN_W = 280;
            const MIN_H = 160;
            const TASKBAR_H = 40;

            const moveHandler = (ev) => {
                const dx = ev.clientX - startX;
                const dy = ev.clientY - startY;

                let newLeft   = initial.left;
                let newTop    = initial.top;
                let newWidth  = initial.width;
                let newHeight = initial.height;

                // East handle: anchor the left edge, stretch the right side.
                if (dir.includes('e')) {
                    newWidth = Math.max(MIN_W, initial.width + dx);
                }

                // West handle: anchor the right edge, move the left side.
                if (dir.includes('w')) {
                    const rawLeft = initial.left + dx;
                    newLeft  = Math.min(rawLeft, initial.right - MIN_W); // clamp so width >= MIN_W
                    newLeft  = Math.max(0, newLeft);                     // keep on-screen
                    newWidth = initial.right - newLeft;
                }

                // South handle: anchor the top edge, stretch the bottom.
                if (dir.includes('s')) {
                    const maxH = window.innerHeight - TASKBAR_H - initial.top;
                    newHeight = Math.min(Math.max(MIN_H, initial.height + dy), maxH);
                }

                // North handle: anchor the bottom edge, move the top side.
                if (dir.includes('n')) {
                    const rawTop = initial.top + dy;
                    newTop    = Math.min(rawTop, initial.bottom - MIN_H); // clamp so height >= MIN_H
                    newTop    = Math.max(0, newTop);                      // keep on-screen
                    newHeight = initial.bottom - newTop;
                }

                el.style.left   = newLeft   + 'px';
                el.style.top    = newTop    + 'px';
                el.style.width  = newWidth  + 'px';
                el.style.height = newHeight + 'px';
            };
            
            const upHandler = () => {
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
            };
            
            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });
    });
  }

  focus(id) {
    if (this.activeId === id) {
      const wd = this.windows.get(id);
      if (wd) { wd.el.classList.add('active'); }
      return;
    }
    this.windows.forEach((wd, wid) => {
      wd.el.classList.toggle('active', wid === id);
    });
    const wd = this.windows.get(id);
    if (wd) {
      this.zCounter += 1;
      wd.el.style.zIndex = this.zCounter;
      if (wd.minimized) this._restore(wd);
    }
    this.activeId = id;
    this.taskbarManager.setActive(id);
  }

  minimize(id) {
    const wd = this.windows.get(id);
    if (!wd) return;
    wd.minimized = true;
    wd.el.classList.add('minimized');
    Sound.click();
    if (this.activeId === id) {
      this.activeId = null;
      this.taskbarManager.setActive(null);
    }
    this.taskbarManager.setMinimized(id, true);
  }

  _restore(wd) {
    wd.minimized = false;
    wd.el.classList.remove('minimized');
    this.taskbarManager.setMinimized(wd.id, false);
  }

  toggleFromTaskbar(id) {
    const wd = this.windows.get(id);
    if (!wd) return;
    if (wd.minimized) {
      this.focus(id);
    } else if (this.activeId === id) {
      this.minimize(id);
    } else {
      this.focus(id);
    }
  }

  toggleMaximize(id, forceRestore, forceMaximize) {
    const wd = this.windows.get(id);
    if (!wd || wd.config.fixedSize) return;
    const el = wd.el;
    if (forceRestore || (wd.maximized && !forceMaximize)) {
      wd.maximized = false;
      el.classList.remove('maximized', 'snapped-left', 'snapped-right');
      if (wd.prevRect) {
        el.style.left = wd.prevRect.left;
        el.style.top = wd.prevRect.top;
        el.style.width = wd.prevRect.width;
        el.style.height = wd.prevRect.height;
      }
      wd.snapped = null;
    } else {
      if (!wd.prevRect) {
        wd.prevRect = { left: el.style.left, top: el.style.top, width: el.style.width, height: el.style.height };
      }
      wd.maximized = true;
      el.classList.remove('snapped-left', 'snapped-right');
      el.classList.add('maximized');
      el.style.left = '0px';
      el.style.top = '0px';
      el.style.width = '100%';
      el.style.height = 'calc(100% - 40px)';
      wd.snapped = null;
    }
    this.focus(id);
  }

  close(id) {
    const wd = this.windows.get(id);
    if (!wd) return;
    
    // Run registered DOOM cleanup (AudioContext, canvas, DOS instance) before DOM removal.
    if (wd._cleanupDoom) {
      try {
        wd._cleanupDoom();
      } catch (e) {
        console.warn('DOOM cleanup error:', e);
      }
      wd._cleanupDoom = null;
    }
    
    if (wd._cleanupFunctions && wd._cleanupFunctions.length > 0) {
      wd._cleanupFunctions.forEach(fn => {
        try {
          fn();
        } catch (e) {
          console.warn('Cleanup function error:', e);
        }
      });
      wd._cleanupFunctions = [];
    }
    
    if (wd.onClose) {
      try {
        wd.onClose();
      } catch (e) {
        console.warn('onClose error:', e);
      }
      wd.onClose = null;
    }
    
    try {
      const iframes = wd.el.querySelectorAll('iframe');
      iframes.forEach(iframe => {
        try {
          if (iframe.contentWindow) {
            if (iframe.contentWindow.stop) {
              try { iframe.contentWindow.stop(); } catch (e) {}
            }
            try {
              if (iframe.contentWindow.AudioContext) {
                const ctx = iframe.contentWindow.AudioContext;
                if (ctx && ctx.close) {
                  try { ctx.close(); } catch (e) {}
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
        iframe.src = 'about:blank';
        iframe.remove();
      });
      
      const audios = wd.el.querySelectorAll('audio');
      audios.forEach(audio => {
        try {
          audio.pause();
          audio.src = '';
          audio.load();
        } catch (e) {}
        audio.remove();
      });
      
      const videos = wd.el.querySelectorAll('video');
      videos.forEach(video => {
        try {
          video.pause();
          video.src = '';
          video.load();
        } catch (e) {}
        video.remove();
      });
      
      const canvases = wd.el.querySelectorAll('canvas');
      canvases.forEach(canvas => {
        try {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
          const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
          if (gl) {
            gl.getExtension('WEBGL_lose_context')?.loseContext();
          }
        } catch (e) {}
        canvas.remove();
      });
      
      const worklets = wd.el.querySelectorAll('audio-worklet');
      worklets.forEach(w => w.remove());
      
    } catch (e) {
      console.warn('Element cleanup error:', e);
    }
    
    try {
      const allElements = wd.el.querySelectorAll('*');
      allElements.forEach(el => {
        try {
          const clone = el.cloneNode(false);
          el.parentNode?.replaceChild(clone, el);
        } catch (e) {}
      });
    } catch (e) {}
    
    Sound.close();
    wd.el.classList.add('closing');
    
    setTimeout(() => {
        try {
          while (wd.el.firstChild) {
            try {
              const child = wd.el.firstChild;
              if (child.remove) {
                child.remove();
              } else {
                wd.el.removeChild(child);
              }
            } catch (e) {}
          }
        } catch (e) {}
        
        try {
          wd.el.remove();
        } catch (e) {}
        
        this.windows.delete(id);
        this.taskbarManager.removeApp(id);
        
        if (this.activeId === id) {
            this.activeId = null;
            let topId = null, topZ = -1;
            this.windows.forEach((w, wid) => {
                const z = parseInt(w.el.style.zIndex || '0', 10);
                if (!w.minimized && z > topZ) { topZ = z; topId = wid; }
            });
            if (topId) this.focus(topId);
        }
        if (this.windows.size === 0) {
            this.cascadeOffset = 0;
        }
    }, 150);
  }

  minimizeAll() {
    this.windows.forEach((wd, id) => { if (!wd.minimized) this.minimize(id); });
  }

  restoreAllFromShowDesktop(prevState) {
    prevState.forEach(id => {
      const wd = this.windows.get(id);
      if (wd) this._restore(wd);
    });
  }

  getWindowByApp(appKey) {
    for (const [id, wd] of this.windows) {
      if (wd.app === appKey) return wd;
    }
    return null;
  }
  
  registerCleanup(id, cleanupFn) {
    const wd = this.windows.get(id);
    if (wd) {
      if (!wd._cleanupFunctions) wd._cleanupFunctions = [];
      wd._cleanupFunctions.push(cleanupFn);
    }
  }
}

/* ── TaskbarManager ──────────────────────────────────────── *
 * Keeps the taskbar in sync with open windows:
 *   - Adds/removes app buttons as windows open and close
 *   - Highlights the active button and dims minimized ones
 *   - Drives the live clock and the "Show Desktop" toggle */
class TaskbarManager {
  constructor() {
    this.appsEl = document.getElementById('taskbar-apps');
    this.buttons = new Map();
    this.windowManager = null;
    this._showDesktopState = null;
    this._bindClock();
    this._bindShowDesktop();
  }

  setWindowManager(wm) { this.windowManager = wm; }

  addApp(winData) {
    const btn = document.createElement('div');
    btn.className = 'taskbar-app-btn active';
    btn.dataset.winId = winData.id;
    const icon = document.createElement('div');
    icon.className = 'taskbar-app-icon ' + winData.config.icon;
    btn.appendChild(icon);
    btn.addEventListener('click', () => {
      Sound.click();
      this.windowManager.toggleFromTaskbar(winData.id);
    });
    this.appsEl.appendChild(btn);
    this.buttons.set(winData.id, btn);
  }

  removeApp(winId) {
    const btn = this.buttons.get(winId);
    if (btn) btn.remove();
    this.buttons.delete(winId);
  }

  setActive(winId) {
    this.buttons.forEach((btn, id) => btn.classList.toggle('active', id === winId));
  }

  setMinimized(winId, isMin) {
    const btn = this.buttons.get(winId);
    if (btn) btn.classList.toggle('minimized', isMin);
  }

  updateTitle(winId, title) {
    const btn = this.buttons.get(winId);
    if (btn) btn.querySelector('.taskbar-app-label').textContent = title;
  }

  _bindClock() {
    const timeEl = document.getElementById('clock-time');
    const dateEl = document.getElementById('clock-date');
    const update = () => {
      const now = new Date();
      let h = now.getHours();
      const m = now.getMinutes().toString().padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12; if (h === 0) h = 12;
      timeEl.textContent = `${h}:${m} ${ampm}`;
      
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const day = now.getDate().toString().padStart(2, '0');
      const month = months[now.getMonth()];
      const year = now.getFullYear().toString().slice(-2);
      dateEl.textContent = `${day}-${month}-${year}`;
    };
    update();
    setInterval(update, 1000);
  }

  _bindShowDesktop() {
    const btn = document.getElementById('show-desktop-btn');
    btn.addEventListener('click', () => {
      if (!this.windowManager) return;
      if (this._showDesktopState) {
        this.windowManager.restoreAllFromShowDesktop(this._showDesktopState);
        this._showDesktopState = null;
      } else {
        const toMinimize = [];
        this.windowManager.windows.forEach((wd, id) => { if (!wd.minimized) toMinimize.push(id); });
        this._showDesktopState = toMinimize;
        this.windowManager.minimizeAll();
      }
    });
  }
}

/* ── StartMenuManager ────────────────────────────────────── *
 * Controls the Start Menu panel: open/close toggle, app launches from
 * pinned items and right-pane links, search, and the power/shutdown flow. */
class StartMenuManager {
  constructor(appManager) {
    this.appManager = appManager;
    this.menuEl = document.getElementById('start-menu');
    this.startBtn = document.getElementById('start-button');
    this.isOpen = false;
    this._bind();
  }

  _bind() {
    this.startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.menuEl.querySelectorAll('.start-item, .start-right-item').forEach(item => {
      item.addEventListener('click', () => {
        const app = item.dataset.app;
        if (app) {
          Sound.click();
          this.appManager.launch(app);
          this.close();
        }
      });
    });

    const allProgramsBtn = document.getElementById('all-programs-btn');
    if (allProgramsBtn) {
      allProgramsBtn.addEventListener('click', () => {
        DialogManager.info('All Programs', 'All installed programs are pinned to the Start Menu in this demo.');
        this.close();
      });
    }

    const search = document.getElementById('start-search');
    if (search) {
      search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = search.value.trim().toLowerCase();
          const map = {
            notepad: 'notepad', calculator: 'calculator', calc: 'calculator',
            paint: 'paint', internet: 'ie', explorer: 'ie', browser: 'ie',
            media: 'mediaplayer', music: 'mediaplayer', computer: 'computer',
            about: 'aboutme', me: 'aboutme', games: 'games', solitaire: 'solitaire',
            minesweeper: 'minesweeper', chess: 'chesstitans', recycle: 'recyclebin',
            bin: 'recyclebin', control: 'controlpanel', help: 'help',
          };
          const found = Object.keys(map).find(k => q.includes(k));
          if (found) {
            this.appManager.launch(map[found]);
            search.value = '';
            this.close();
          } else if (q) {
            DialogManager.info('Search Results', `No items match your search for "${q}".`);
          }
        }
      });
    }

    document.getElementById('shutdown-btn').addEventListener('click', () => {
      this.close();
      this.appManager.shutdown();
    });
    
    const arrowBtn = document.getElementById('shutdown-arrow');
    const shutdownMenu = document.getElementById('shutdown-options');
    if (arrowBtn && shutdownMenu) {
      arrowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        shutdownMenu.classList.toggle('open');
      });
      shutdownMenu.addEventListener('click', (e) => {
        const item = e.target.closest('.context-item');
        if (!item) return;
        shutdownMenu.classList.remove('open');
        this.close();
        const action = item.dataset.action;
        if (action === 'restart') this.appManager.shutdown(true);
        else if (action === 'sleep') DialogManager.info('Sleep', 'This demo cannot actually put your computer to sleep.');
        else if (action === 'lock') DialogManager.info('Lock', 'This demo cannot lock your screen.');
        else if (action === 'switchuser') DialogManager.info('Switch User', 'Switch User is a demo feature.');
        else if (action === 'logout') DialogManager.info('Log Off', 'Log Off is a demo feature.');
        else if (action === 'hibernate') DialogManager.info('Hibernate', 'Hibernate is a demo feature.');
      });
    }

    document.addEventListener('click', (e) => {
      if (this.isOpen && 
          !this.menuEl.contains(e.target) && 
          !this.startBtn.contains(e.target)) {
        this.close();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
      if (e.ctrlKey && e.key === 'Escape') { 
        e.preventDefault(); 
        this.toggle(); 
      }
    });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    this.menuEl.classList.add('open');
    this.startBtn.classList.add('active');
    this.isOpen = true;
    Sound.click();
    setTimeout(() => {
      const search = document.getElementById('start-search');
      if (search) search.focus();
    }, 50);
  }

  close() {
    this.menuEl.classList.remove('open');
    this.startBtn.classList.remove('active');
    const shutdownMenu = document.getElementById('shutdown-options');
    if (shutdownMenu) shutdownMenu.classList.remove('open');
    this.isOpen = false;
  }
}

/* ── DialogManager ───────────────────────────────────────── *
 * Static factory for modal dialogs (info, warning, error, confirm).
 * Clones #tpl-dialog, positions it at viewport center, and removes itself
 * on close. Multiple dialogs stack safely. */
class DialogManager {
  static _container() { return document.getElementById('dialogs-container'); }
  static _overlay() { return document.getElementById('dialog-overlay'); }

  static _show(title, message, type, buttons) {
    const overlay = this._overlay();
    overlay.classList.add('active');
    const tpl = document.getElementById('tpl-dialog');
    const node = tpl.content.firstElementChild.cloneNode(true);

    // Set title in the title-bar-text (with small icon)
    const titleBarText = node.querySelector('.title-bar-text');
    const iconTypeMap = { info: 'ℹ', warning: '⚠', error: '✕' };
    titleBarText.textContent = title;

    // Set dialog icon and message
    const iconEl = node.querySelector('.dialog-icon');
    iconEl.classList.add(type);
    iconEl.textContent = type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ';
    node.querySelector('.dialog-message').textContent = message;

    const btnContainer = node.querySelector('.dialog-buttons');
    const close = () => {
      overlay.classList.remove('active');
      node.classList.add('closing');
      setTimeout(() => node.remove(), 150);
    };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      btn.addEventListener('click', () => {
        close();
        if (b.onClick) b.onClick();
      });
      btnContainer.appendChild(btn);
    });

    // Close button (X in title bar)
    node.querySelector('.dialog-close-btn').addEventListener('click', close);

    // Make dialog draggable via title bar
    const titleBar = node.querySelector('.title-bar');
    let dragX = 0, dragY = 0, dragging = false;
    titleBar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = node.getBoundingClientRect();
      dragX = e.clientX - rect.left;
      dragY = e.clientY - rect.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      node.style.left = (e.clientX - dragX) + 'px';
      node.style.top  = (e.clientY - dragY) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    this._container().appendChild(node);

    // Center after append so getBoundingClientRect is accurate
    requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      node.style.left = Math.round((window.innerWidth  - rect.width)  / 2) + 'px';
      node.style.top  = Math.round((window.innerHeight - rect.height) / 2 - 20) + 'px';
    });

    if (type === 'error') Sound.error();
    return node;
  }

  static info(title, message) {
    return this._show(title, message, 'info', [{ label: 'OK', primary: true }]);
  }
  static warning(title, message) {
    return this._show(title, message, 'warning', [{ label: 'OK', primary: true }]);
  }
  static error(title, message) {
    return this._show(title, message, 'error', [{ label: 'OK', primary: true }]);
  }
  static confirm(title, message, onYes, onNo) {
    return this._show(title, message, 'warning', [
      { label: 'Yes', primary: true, onClick: onYes },
      { label: 'No', onClick: onNo || (() => {}) },
    ]);
  }
  static about(title, message) {
    return this._show(title, message, 'info', [{ label: 'Close', primary: true }]);
  }
}

/* ── AppManager ──────────────────────────────────────────── *
 * Resolves app keys against APP_REGISTRY, enforces singleton rules,
 * clones the correct <template> into a new window, then delegates to
 * a dedicated _init* method that wires up the app's interactivity. */
class AppManager {
  constructor() {
    this.windowManager = null;
    this.recycleBinHasItems = false;
  }

  setWindowManager(wm) { this.windowManager = wm; }

  launch(appKey) {
    
    const def = APP_REGISTRY[appKey];
    if (!def) {
      
      return;
    }
    if (def.aliasOf) appKey = def.aliasOf;
    const realDef = APP_REGISTRY[appKey];

    const explorerFolderApps = { recyclebin: 'recyclebin', games: 'games', controlpanel: 'controlpanel', devices: 'devices', help: 'help' };
    if (explorerFolderApps[appKey]) {
      const targetPath = explorerFolderApps[appKey];
      const existingExplorer = this.windowManager.getWindowByApp('computer');
      if (existingExplorer) {
        this.windowManager.focus(existingExplorer.id);
        if (window.__explorerInstances) {
          const inst = window.__explorerInstances[existingExplorer.id];
          if (inst && inst.navigateTo) inst.navigateTo(targetPath);
        }
        return;
      }
      this._launchExplorerAt(targetPath);
      return;
    }

    const singleton = ['computer', 'solitaire', 'minesweeper', 'chesstitans', 'doom', 'aboutme'];
    if (singleton.includes(appKey)) {
      const existing = this.windowManager.getWindowByApp(appKey);
      if (existing) { 
        this.windowManager.focus(existing.id); 
        return; 
      }
    }

    const tpl = document.getElementById(realDef.template);
    if (!tpl) {
      
      return;
    }
    const contentEl = tpl.content.firstElementChild.cloneNode(true);

    const winData = this.windowManager.createWindow(appKey, realDef, contentEl);
    this._initApp(appKey, winData, contentEl);
  }

  _launchExplorerAt(targetPath) {
    const def = APP_REGISTRY['computer'];
    const tpl = document.getElementById(def.template);
    if (!tpl) return;
    const contentEl = tpl.content.firstElementChild.cloneNode(true);
    const winData = this.windowManager.createWindow('computer', def, contentEl);
    this._initExplorer(winData, contentEl, targetPath);
  }

  _initApp(appKey, winData, contentEl) {
    switch (appKey) {
      case 'aboutme': this._initAboutMe(contentEl); break;
      case 'computer': this._initExplorer(winData, contentEl); break;
      case 'notepad': this._initNotepad(winData, contentEl); break;
      case 'calculator': this._initCalculator(contentEl); break;
      case 'paint': this._initPaint(contentEl); break;
      case 'ie': this._initIE(winData, contentEl); break;
      case 'mediaplayer': this._initMediaPlayer(contentEl); break;
      case 'solitaire': this._initSolitaire(contentEl); break;
      case 'minesweeper': this._initMinesweeper(contentEl); break;
      case 'chesstitans': this._initChess(contentEl); break;
      case 'doom': this._initDoom(contentEl); break;
      case 'controlpanel': this._initControlPanel(contentEl); break;
      default: break;
    }
  }

  _initAboutMe(root) {
    const links = root.querySelectorAll('.aboutme-nav-link');
    const main = root.querySelector('.aboutme-main');

    links.forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').slice(1);
        const target = root.querySelector('#' + targetId);
        if (target) {
          const offset = target.offsetTop - main.offsetTop;
          main.scrollTo({ top: offset, behavior: 'smooth' });
        }
      });
    });

    let ticking = false;
    main.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const sections = root.querySelectorAll('.aboutme-section');
          let current = sections[0];
          sections.forEach(sec => {
            if (sec.offsetTop - main.offsetTop <= main.scrollTop + 30) {
              current = sec;
            }
          });
          links.forEach(l => {
            l.classList.toggle('active', l.getAttribute('href') === '#' + current.id);
          });
          ticking = false;
        });
        ticking = true;
      }
    });
  }

  _initExplorer(winData, root, initialPath) {
    const self = this; // Capture AppManager instance
    const grid = root.querySelector('#explorer-grid');
    const pathEl = root.querySelector('#explorer-path');
    const statusEl = root.querySelector('#explorer-statusbar');
    const sidebarItems = root.querySelectorAll('.sidebar-item');
    const searchInput = root.querySelector('#explorer-search-input');
    const viewBtns = root.querySelectorAll('.view-btn');
    
    let currentView = 'icons';
    let currentPath = 'computer';
    const startPath = initialPath || 'computer';
    let history = [startPath];
    let historyIndex = 0;

    winData.explorerInstance = this;
    winData.explorerRoot = root;

    const fileSystem = {
      computer: {
        name: 'Computer',
        image: 'assets/icons/imageres_109-64x64.png',
        items: [
          { 
            name: 'Local Disk (C:)', 
            image: "assets/icons/c.png",
            path: 'localdisk',
            isDrive: true,
            usedSpace: 75,
            totalSpace: 120,
            driveLabel: 'Local Disk'
          },
          { 
            name: 'DVD Drive (D:)', 
            image: "assets/icons/d.png",
            path: 'dvd',
            isDrive: true,
            usedSpace: 0,
            totalSpace: 4.7,
            driveLabel: 'DVD RW Drive'
          },
        ]
      },
      localdisk: {
        name: 'Local Disk (C:)',
        image: "assets/icons/c.png",
        items: [
          { name: 'Program Files', image: "assets/icons/folder-programfiles.png", path: 'programfiles' },
          { name: 'Windows', image: "assets/icons/folder-windows.png", path: 'windows' },
          { name: 'Users', image: "assets/icons/users.png", path: 'users' },
          { name: 'Games', image: "assets/icons/games.png", path: 'games' },
        ]
      },
      dvd: {
        name: 'DVD Drive (D:)',
        image: "assets/icons/d.png",
        items: [
          { name: 'Insert a disc to view contents', image: "assets/icons/dvd.png", path: null },
        ]
      },
      documents: {
        name: 'Documents',
        image: "assets/icons/folder-documents.png",
        items: [
          { name: 'Public Documents', image: "assets/icons/folder.png", path: 'publicdocs' },
          { name: 'Resume.docx', image: "assets/icons/doc.png", path: null },
          { name: 'Project Notes.txt', image: "assets/icons/txt.png", path: null },
          { name: 'Budget.xlsx', image: "assets/icons/xls.png", path: null },
        ]
      },
      pictures: {
        name: 'Pictures',
        image: "assets/icons/photos.png",
        items: [
          { name: 'Camera Roll', image: "assets/icons/folder.png", path: null },
          { name: 'Screenshots', image: "assets/icons/folder.png", path: null },
        ]
      },
      music: {
        name: 'Music',
        image: "assets/icons/folder-music.png",
        items: [
          { name: 'Playlists', image: "assets/icons/folder.png", path: null },
          { name: 'Synthwave Sunset.mp3', image: "assets/icons/mp3.png", path: null },
          { name: 'Night Drive.mp3', image: "assets/icons/mp3.png", path: null },
          { name: 'Chiptune Dreams.mp3', image: "assets/icons/mp3.png", path: null },
        ]
      },
      videos: {
        name: 'Videos',
        image: "assets/icons/folder-videos.png",
        items: [
          { name: 'My Videos', image: "assets/icons/folder-videos.png", path: null },
          { name: 'Tutorials', image: "assets/icons/folder.png", path: null },
          { name: 'Movies', image: "assets/icons/folder.png", path: null },
          { name: 'Screen Recordings', image: "assets/icons/folder.png", path: null },
        ]
      },
      downloads: {
        name: 'Downloads',
        image: "assets/icons/downloads.png",
        items: [
          { name: 'Documents', image: "assets/icons/document.png", path: null },
          { name: 'Images', image: "assets/icons/images.png", path: null },
          { name: 'setup.exe', image: "assets/icons/exe.png", path: null },
          { name: 'file.zip', image: "assets/icons/zip.png", path: null },
        ]
      },
      recyclebin: {
        name: 'Recycle Bin',
        image: "assets/icons/can.png",
        items: [
          { name: 'Deleted Document.txt', image: "assets/icons/txt.png", path: null, deleted: true },
          { name: 'Old Photo.jpg', image: "assets/icons/image.png", path: null, deleted: true },
          { name: 'Unused File.exe', image: "assets/icons/exe.png", path: null, deleted: true },
          { name: 'Empty Recycle Bin', image: "assets/icons/can.png", path: 'emptyrecycle', isAction: true },
        ]
      },
      emptyrecycle: {
        name: 'Recycle Bin',
        image: "assets/icons/can.png",
        items: [
          { name: 'Recycle Bin is empty', image: "assets/icons/can.png", path: null },
        ]
      },
      games: {
        name: 'Games',
        image: "assets/icons/games.png",
        items: [
          { name: 'Solitaire', image: "assets/icons/solitaire.png", path: 'solitaire', isApp: true },
          { name: 'Minesweeper', image: "assets/icons/MineSweeper_111-7.png", path: 'minesweeper', isApp: true },
          { name: 'Chess Titans', image: "assets/icons/Chess_128-7.png", path: 'chesstitans', isApp: true },
          { name: 'DOOM', image: "assets/games/doom/logo.png", path: 'doom', isApp: true },
        ]
      },
      controlpanel: {
        name: 'Control Panel',
        image: "assets/icons/controlp.png",
        items: [
          { name: 'System', image: "assets/icons/imageres_109-64x64.png", path: null },
          { name: 'Display', image: "assets/icons/imageres_109-64x64.png", path: null },
          { name: 'Sound', image: "assets/icons/audio.png", path: null },
          { name: 'Mouse', image: "assets/icons/folder.png", path: null },
          { name: 'Keyboard', image: "assets/icons/folder.png", path: null },
          { name: 'Network and Sharing Center', image: "assets/icons/connect.png", path: null },
          { name: 'User Accounts', image: "assets/icons/users.png", path: null },
          { name: 'Personalization', image: "assets/icons/paint.png", path: null },
        ]
      },
      devices: {
        name: 'Devices and Printers',
        image: "assets/icons/connect.png",
        items: [
          { name: 'PC', image: "assets/icons/imageres_109-64x64.png", path: null },
          { name: 'HP LaserJet', image: "assets/icons/folder.png", path: null },
          { name: 'USB Keyboard', image: "assets/icons/folder.png", path: null },
          { name: 'USB Mouse', image: "assets/icons/folder.png", path: null },
          { name: 'Bluetooth Headphones', image: "assets/icons/folder.png", path: null },
          { name: 'External Drive', image: "assets/icons/folder.png", path: null },
        ]
      },
      help: {
        name: 'Windows Help and Support',
        image: "assets/icons/Info.png",
        items: [
          { name: 'Getting Started', image: "assets/icons/Info.png", path: null },
          { name: 'Using the Taskbar', image: "assets/icons/folder.png", path: null },
          { name: 'Working with Windows', image: "assets/icons/folder.png", path: null },
          { name: 'Troubleshooting', image: "assets/icons/folder.png", path: null },
          { name: 'About This Site', image: "assets/icons/Info.png", path: null },
        ]
      },
      programfiles: { name: 'Program Files', image: "assets/icons/folder.png", items: [{ name: 'This folder is empty', image: "assets/icons/folder.png", path: null }] },
      windows: { name: 'Windows', image: "assets/icons/folder.png", items: [{ name: 'This folder is empty', image: "assets/icons/folder.png", path: null }] },
      users: { name: 'Users', image: "assets/icons/folder.png", items: [{ name: 'This folder is empty', image: "assets/icons/folder.png", path: null }] },
      mydocuments: { name: 'My Documents', image: "assets/icons/document.png", items: [{ name: 'This folder is empty', image: "assets/icons/folder.png", path: null }] },
      publicdocs: { name: 'Public Documents', image: "assets/icons/folder.png", items: [{ name: 'This folder is empty', image: "assets/icons/folder.png", path: null }] },
    };

    function formatFileSize(size) {
      if (size >= 1024) return (size / 1024).toFixed(1) + ' TB';
      if (size >= 1) return size.toFixed(0) + ' GB';
      return size.toFixed(1) + ' GB';
    }

    function renderFolder(path) {
      const folder = fileSystem[path];
      if (!folder) {
        currentPath = 'computer';
        renderFolder('computer');
        return;
      }

      currentPath = path;
      pathEl.textContent = folder.name;
      
      const titleTextEl = winData.el.querySelector('.title-bar-text');
      if (titleTextEl) {
        const iconSpan = titleTextEl.querySelector('.window-icon');
        titleTextEl.textContent = folder.name;
        if (iconSpan) titleTextEl.prepend(iconSpan);
      }
      
      sidebarItems.forEach(item => {
        const itemPath = item.dataset.path;
        item.classList.toggle('active', itemPath === path || 
          (path === 'localdisk' && itemPath === 'computer') ||
          (path === 'emptyrecycle' && itemPath === 'recyclebin'));
      });

      grid.innerHTML = '';
      grid.className = `explorer-grid view-${currentView}`;

      if (folder.items && folder.items.length > 0) {
        folder.items.forEach(item => {
          let div;
          const iconImg = item.image || 'assets/icons/folder.png';
          
          if (currentView === 'icons') {
            div = document.createElement('div');
            div.className = 'explorer-folder';
            if (item.isDrive) {
              const usedPercent = item.usedSpace / item.totalSpace * 100;
              div.innerHTML = `
                <div class="folder-icon drive-icon">
                  <img src="${iconImg}" alt="${item.name}" style="width:56px;height:56px;object-fit:contain;">
                </div>
                <span class="drive-name">${item.name}</span>
                <span class="drive-label">${item.driveLabel}</span>
                <div class="drive-bar">
                  <div class="drive-bar-fill" style="width:${usedPercent}%"></div>
                </div>
                <span class="drive-space">${formatFileSize(item.usedSpace)} free of ${formatFileSize(item.totalSpace)}</span>
              `;
              div.style.width = '140px';
              div.style.padding = '12px 8px';
            } else if (item.deleted) {
              div.innerHTML = `
                <div class="folder-icon">
                  <img src="${iconImg}" alt="${item.name}" style="width:40px;height:40px;object-fit:contain;opacity:0.6;">
                </div>
                <span style="opacity:0.6;">${item.name}</span>
              `;
            } else if (item.isAction) {
              div.innerHTML = `
                <div class="folder-icon">
                  <img src="${iconImg}" alt="${item.name}" style="width:48px;height:48px;object-fit:contain;">
                </div>
                <span style="color:#2a7fc4; font-weight:600;">${item.name}</span>
              `;
              div.style.cursor = 'pointer';
            } else {
              div.innerHTML = `
                <div class="folder-icon">
                  <img src="${iconImg}" alt="${item.name}" style="width:48px;height:48px;object-fit:contain;">
                </div>
                <span>${item.name}</span>
              `;
            }
          } else if (currentView === 'list') {
            div = document.createElement('div');
            div.className = 'explorer-list-item';
            div.innerHTML = `
              <span class="list-icon"><img src="${iconImg}" alt="" style="width:20px;height:20px;object-fit:contain;"></span>
              <span class="list-name">${item.name}</span>
              <span class="list-type">${item.isDrive ? 'Drive' : item.isApp ? 'Application' : item.deleted ? 'Deleted Item' : item.isAction ? 'Task' : 'Folder'}</span>
              <span class="list-size">${item.isDrive ? formatFileSize(item.totalSpace) : '--'}</span>
            `;
          } else {
            div = document.createElement('div');
            div.className = 'explorer-details-item';
            div.innerHTML = `
              <span class="details-icon"><img src="${iconImg}" alt="" style="width:20px;height:20px;object-fit:contain;"></span>
              <span class="details-name">${item.name}</span>
              <span class="details-type">${item.isDrive ? 'Drive' : item.isApp ? 'Application' : item.deleted ? 'Deleted Item' : item.isAction ? 'Task' : 'Folder'}</span>
              <span class="details-size">${item.isDrive ? formatFileSize(item.totalSpace) : '--'}</span>
              <span class="details-date">${item.deleted ? 'Deleted' : new Date().toLocaleDateString()}</span>
            `;
          }

          if (item.path) {
            div.style.cursor = 'pointer';
            div.addEventListener('dblclick', () => {
              if (item.isAction) {
                if (item.path === 'emptyrecycle') {
                  DialogManager.confirm('Delete Multiple Items', 'Are you sure you want to permanently delete these items?', () => {
                    navigateTo('emptyrecycle');
                  });
                }
                return;
              }
              if (item.isApp) {
                // Launch via the captured AppManager reference (not `this`, which is the Explorer closure).
                self.launch(item.path);
              } else if (fileSystem[item.path]) {
                navigateTo(item.path);
              } else {
                DialogManager.info(item.name, `Opening "${item.name}"...\n\nThis folder is empty in the demo.`);
              }
            });
          } else {
            div.style.cursor = 'default';
            div.addEventListener('dblclick', () => {
              if (!item.deleted && !item.isAction) {
                DialogManager.info(item.name, `You double-clicked "${item.name}".\n\nThis is a demo item.`);
              }
            });
          }
          grid.appendChild(div);
        });
      } else {
        grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:#888;">This folder is empty</div>`;
      }

      const itemCount = folder.items ? folder.items.length : 0;
      statusEl.textContent = `${itemCount} item${itemCount !== 1 ? 's' : ''}`;
    }

    function navigateTo(path) {
      if (fileSystem[path]) {
        history = history.slice(0, historyIndex + 1);
        history.push(path);
        historyIndex = history.length - 1;
        renderFolder(path);
      }
    }

    sidebarItems.forEach(item => {
      item.addEventListener('click', () => {
        const path = item.dataset.path;
        if (fileSystem[path]) {
          navigateTo(path);
        }
      });
    });

    viewBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        viewBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = btn.dataset.view;
        renderFolder(currentPath);
      });
    });

    root.querySelector('[data-nav="back"]').addEventListener('click', () => {
      if (historyIndex > 0) {
        historyIndex--;
        renderFolder(history[historyIndex]);
      }
    });

    root.querySelector('[data-nav="forward"]').addEventListener('click', () => {
      if (historyIndex < history.length - 1) {
        historyIndex++;
        renderFolder(history[historyIndex]);
      }
    });

    root.querySelector('[data-nav="up"]').addEventListener('click', () => {
      if (currentPath !== 'computer') {
        const parentMap = {
          localdisk: 'computer',
          dvd: 'computer',
          documents: 'computer',
          pictures: 'computer',
          music: 'computer',
          videos: 'computer',
          downloads: 'computer',
          mydocuments: 'documents',
          publicdocs: 'documents',
          programfiles: 'localdisk',
          windows: 'localdisk',
          users: 'localdisk',
          recyclebin: 'computer',
          emptyrecycle: 'recyclebin',
          games: 'localdisk',
          controlpanel: 'computer',
          devices: 'computer',
          help: 'computer',
        };
        const parent = parentMap[currentPath] || 'computer';
        navigateTo(parent);
      }
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim().toLowerCase();
        if (query) {
          const results = [];
          Object.keys(fileSystem).forEach(key => {
            const folder = fileSystem[key];
            if (folder.items) {
              folder.items.forEach(item => {
                if (item.name.toLowerCase().includes(query)) {
                  results.push({ name: item.name, path: key });
                }
              });
            }
          });
          if (results.length > 0) {
            let msg = 'Search Results:\n\n';
            results.slice(0, 10).forEach(r => {
              msg += `• ${r.name} (in ${fileSystem[r.path]?.name || 'Unknown'})\n`;
            });
            if (results.length > 10) msg += `\n... and ${results.length - 10} more results`;
            DialogManager.info('Search Results', msg);
          } else {
            DialogManager.info('Search Results', `No results found for "${query}"`);
          }
          searchInput.value = '';
        }
      }
    });

    renderFolder(startPath);

    const winId = winData.id;
    if (!window.__explorerInstances) window.__explorerInstances = {};
    window.__explorerInstances[winId] = {
      navigateTo: navigateTo,
      windowManager: this.windowManager,
      winData: winData
    };
  }

  _initNotepad(winData, root) {
    const textarea = root.querySelector('.notepad-textarea');
    const statusbar = root.querySelector('.notepad-statusbar');
    const menus = root.querySelectorAll('.np-menu');
    const dropdowns = root.querySelectorAll('.np-dropdown');

    menus.forEach(menu => {
      menu.addEventListener('click', (e) => {
        e.stopPropagation();
        const key = menu.dataset.menu;
        const dd = root.querySelector(`.np-dropdown[data-dropdown="${key}"]`);
        const wasOpen = dd && dd.classList.contains('open');
        dropdowns.forEach(d => d.classList.remove('open'));
        menus.forEach(m => m.classList.remove('active'));
        if (dd && !wasOpen) { dd.classList.add('open'); menu.classList.add('active'); }
      });
    });
    document.addEventListener('click', () => {
      dropdowns.forEach(d => d.classList.remove('open'));
      menus.forEach(m => m.classList.remove('active'));
    });

    root.querySelector('[data-dropdown="file"] [data-action="new"]').addEventListener('click', () => {
      const clearAndReset = () => {
        textarea.value = '';
        winData.el.querySelector('.title-bar-text').textContent = 'Untitled - Notepad';
      };
      if (textarea.value.trim().length > 0) {
        DialogManager.confirm('Notepad', 'Do you want to save changes to Untitled?\n\nUnsaved changes will be lost.', clearAndReset);
      } else {
        clearAndReset();
      }
    });
    root.querySelector('[data-dropdown="file"] [data-action="open"]').addEventListener('click', () => {
      DialogManager.info('Open', 'File access is disabled in this demo — Notepad works entirely in-memory.');
    });
    root.querySelector('[data-dropdown="file"] [data-action="save"]').addEventListener('click', () => {
      DialogManager.info('Save', 'Your text has been "saved" (this demo does not write to disk).');
    });
    root.querySelector('[data-dropdown="file"] [data-action="exit"]').addEventListener('click', () => {
      this.windowManager.close(winData.id);
    });
    const wordWrapItem = root.querySelector('[data-dropdown="format"] [data-action="wordwrap"]');
    wordWrapItem.addEventListener('click', () => {
      const isWrapped = !textarea.classList.contains('nowrap');
      textarea.classList.toggle('nowrap');
      wordWrapItem.textContent = isWrapped ? 'Word Wrap' : '✓ Word Wrap';
    });

    const updateStatus = () => {
      const value = textarea.value.slice(0, textarea.selectionStart);
      const lines = value.split('\n');
      const ln = lines.length;
      const col = lines[lines.length - 1].length + 1;
      statusbar.textContent = `Ln ${ln}, Col ${col}`;
    };
    textarea.addEventListener('keyup', updateStatus);
    textarea.addEventListener('click', updateStatus);
    textarea.value = 'Welcome to Notepad.\n\nThis is a fully working text editor — type, edit, and explore the File and Format menus above.';
  }

  _initCalculator(root) {
    const mainDisplay = root.querySelector('.calc-display-main');
    const prevDisplay = root.querySelector('.calc-display-prev');
    let current = '0';
    let previous = null;
    let operator = null;
    let resetNext = false;

    const render = () => {
      mainDisplay.textContent = current;
      prevDisplay.textContent = previous !== null ? `${previous} ${opSymbol(operator)}` : '';
    };
    const opSymbol = (op) => ({ add: '+', subtract: '−', multiply: '×', divide: '÷' }[op] || '');

    const inputDigit = (d) => {
      if (resetNext || current === '0') { current = d; resetNext = false; }
      else if (current.length < 16) current += d;
      render();
    };
    const inputDecimal = () => {
      if (resetNext) { current = '0.'; resetNext = false; }
      else if (!current.includes('.')) current += '.';
      render();
    };
    const compute = (a, b, op) => {
      a = parseFloat(a); b = parseFloat(b);
      switch (op) {
        case 'add': return a + b;
        case 'subtract': return a - b;
        case 'multiply': return a * b;
        case 'divide': return b === 0 ? NaN : a / b;
        default: return b;
      }
    };
    const setOperator = (op) => {
      if (operator && !resetNext) {
        const result = compute(previous, current, operator);
        current = formatResult(result);
      }
      previous = current;
      operator = op;
      resetNext = true;
      render();
    };
    const formatResult = (n) => {
      if (Number.isNaN(n)) return 'Cannot divide by zero';
      let s = n.toString();
      if (s.length > 16) s = parseFloat(n.toPrecision(12)).toString();
      return s;
    };
    const equals = () => {
      if (operator === null || previous === null) return;
      const result = compute(previous, current, operator);
      current = formatResult(result);
      previous = null;
      operator = null;
      resetNext = true;
      render();
    };

    root.querySelectorAll('.calc-btn[data-num]').forEach(btn => {
      btn.addEventListener('click', () => inputDigit(btn.dataset.num));
    });
    root.querySelectorAll('.calc-btn[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        switch (action) {
          case 'clear': current = '0'; previous = null; operator = null; resetNext = false; render(); break;
          case 'ce': current = '0'; render(); break;
          case 'backspace': current = current.length > 1 ? current.slice(0, -1) : '0'; render(); break;
          case 'sign': current = (parseFloat(current) * -1).toString(); render(); break;
          case 'decimal': inputDecimal(); break;
          case 'equals': equals(); break;
          case 'add': case 'subtract': case 'multiply': case 'divide': setOperator(action); break;
        }
      });
    });

    root.addEventListener('keydown', (e) => {
      if (/[0-9]/.test(e.key)) inputDigit(e.key);
      else if (e.key === '.') inputDecimal();
      else if (e.key === '+') setOperator('add');
      else if (e.key === '-') setOperator('subtract');
      else if (e.key === '*') setOperator('multiply');
      else if (e.key === '/') setOperator('divide');
      else if (e.key === 'Enter' || e.key === '=') equals();
      else if (e.key === 'Backspace') { current = current.length > 1 ? current.slice(0, -1) : '0'; render(); }
      else if (e.key === 'Escape') { current = '0'; previous = null; operator = null; render(); }
    });
    root.setAttribute('tabindex', '0');
    render();
  }

  _initPaint(root) {
    const canvas = root.querySelector('.paint-canvas');
    const ctx = canvas.getContext('2d');
    const palette = root.querySelector('#paint-palette');
    const sizeSlider = root.querySelector('#paint-size-slider');
    const clearBtn = root.querySelector('#paint-clear');
    const tools = root.querySelectorAll('.paint-tool');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const colors = ['#000000', '#ffffff', '#7f7f7f', '#c3c3c3', '#880015', '#ed1c24', '#ff7f27', '#fff200',
      '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#b97a57', '#ffaec9', '#99d9ea', '#c8bfe7'];
    let currentColor = '#000000';
    colors.forEach((c, i) => {
      const sw = document.createElement('div');
      sw.className = 'paint-swatch' + (i === 0 ? ' active' : '');
      sw.style.background = c;
      sw.addEventListener('click', () => {
        currentColor = c;
        palette.querySelectorAll('.paint-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
      });
      palette.appendChild(sw);
    });

    let currentTool = 'pencil';
    tools.forEach(tool => {
      tool.addEventListener('click', () => {
        currentTool = tool.dataset.tool;
        tools.forEach(t => t.classList.remove('active'));
        tool.classList.add('active');
      });
    });

    clearBtn.addEventListener('click', () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    let drawing = false;
    let startX = 0, startY = 0;
    let snapshot = null;

    const getPos = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
    };

    const floodFill = (x, y, fillColor) => {
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const w = canvas.width, h = canvas.height;
      const idx = (Math.floor(y) * w + Math.floor(x)) * 4;
      const targetColor = [data[idx], data[idx + 1], data[idx + 2], data[idx + 3]];
      const fillRGB = hexToRgba(fillColor);
      if (colorsMatch(targetColor, fillRGB)) return;
      const stack = [[Math.floor(x), Math.floor(y)]];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
        const i = (cy * w + cx) * 4;
        const cColor = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (!colorsMatch(cColor, targetColor)) continue;
        data[i] = fillRGB[0]; data[i + 1] = fillRGB[1]; data[i + 2] = fillRGB[2]; data[i + 3] = 255;
        stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      ctx.putImageData(imgData, 0, 0);
    };
    const hexToRgba = (hex) => {
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return [r, g, b, 255];
    };
    const colorsMatch = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];

    canvas.addEventListener('mousedown', (e) => {
      const pos = getPos(e);
      drawing = true;
      startX = pos.x; startY = pos.y;
      ctx.lineWidth = sizeSlider.value;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = currentTool === 'eraser' ? '#ffffff' : currentColor;
      ctx.fillStyle = currentColor;

      if (currentTool === 'pencil' || currentTool === 'eraser') {
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
      } else if (currentTool === 'fill') {
        floodFill(pos.x, pos.y, currentColor);
        drawing = false;
      } else if (['line', 'rect', 'circle'].includes(currentTool)) {
        snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
      }
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!drawing) return;
      const pos = getPos(e);
      if (currentTool === 'pencil' || currentTool === 'eraser') {
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (currentTool === 'line') {
        ctx.putImageData(snapshot, 0, 0);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      } else if (currentTool === 'rect') {
        ctx.putImageData(snapshot, 0, 0);
        ctx.strokeRect(startX, startY, pos.x - startX, pos.y - startY);
      } else if (currentTool === 'circle') {
        ctx.putImageData(snapshot, 0, 0);
        const r = Math.hypot(pos.x - startX, pos.y - startY);
        ctx.beginPath();
        ctx.arc(startX, startY, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    const stopDrawing = () => { drawing = false; };
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);
  }

  _initIE(winData, root) {
    const tabs = root.querySelectorAll('.ie-tab');
    const pages = root.querySelectorAll('.ie-page');
    const addressInput = root.querySelector('.ie-address-input');
    const goBtn = root.querySelector('.ie-go-btn');
    const history = ['home'];
    let historyIdx = 0;

    const showPage = (key, pushHistory) => {
      pages.forEach(p => p.style.display = p.dataset.page === key ? 'block' : 'none');
      tabs.forEach(t => t.classList.toggle('active', t.dataset.page === key));
      addressInput.value = key + '.html';
      if (pushHistory) {
        history.splice(historyIdx + 1);
        history.push(key);
        historyIdx = history.length - 1;
      }
      const titles = { home: 'Dildows Internet Explorer', portfolio: 'Portfolio', blog: 'Blog' };
      winData.el.querySelector('.title-bar-text').textContent = titles[key] || titles.home;
      this.windowManager.taskbarManager.updateTitle(winData.id, titles[key] || titles.home);
    };

    tabs.forEach(tab => tab.addEventListener('click', () => showPage(tab.dataset.page, true)));

    goBtn.addEventListener('click', () => navigate());
    addressInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigate(); });
    function navigate() {
      const val = addressInput.value.replace('.html', '').trim().toLowerCase();
      const known = ['home', 'portfolio', 'blog'];
      if (known.includes(val)) showPage(val, true);
      else DialogManager.error('Internet Explorer cannot display the webpage', `"${addressInput.value}" could not be found. This demo browser only knows: home, portfolio, blog.`);
    }

    root.querySelector('[data-nav="back"]').addEventListener('click', () => {
      if (historyIdx > 0) { historyIdx--; showPage(history[historyIdx], false); }
    });
    root.querySelector('[data-nav="forward"]').addEventListener('click', () => {
      if (historyIdx < history.length - 1) { historyIdx++; showPage(history[historyIdx], false); }
    });
    root.querySelector('[data-nav="refresh"]').addEventListener('click', () => showPage(history[historyIdx], false));
    root.querySelector('[data-nav="home"]').addEventListener('click', () => showPage('home', true));
  }

  _initMediaPlayer(root) {
    const playBtn = root.querySelector('.mp-play');
    const progressSlider = root.querySelector('#mp-progress-slider');
    const volumeSlider = root.querySelector('#mp-volume-slider');
    const currentTimeEl = root.querySelector('.mp-time-current');
    const totalTimeEl = root.querySelector('.mp-time-total');
    const titleEl = root.querySelector('.mp-track-title');
    const playlistItems = root.querySelectorAll('.mp-playlist-item');
    const tracks = [
      { title: 'Synthwave Sunset', duration: 204 },
      { title: 'Night Drive', duration: 187 },
      { title: 'Chiptune Dreams', duration: 156 },
      { title: 'Retro Boot', duration: 98 },
    ];
    let trackIdx = 0;
    let playing = false;
    let elapsed = 0;
    let interval = null;

    const fmt = (s) => `${Math.floor(s / 60)}:${(Math.floor(s) % 60).toString().padStart(2, '0')}`;

    const loadTrack = (idx) => {
      trackIdx = ((idx % tracks.length) + tracks.length) % tracks.length;
      elapsed = 0;
      titleEl.textContent = tracks[trackIdx].title;
      totalTimeEl.textContent = fmt(tracks[trackIdx].duration);
      currentTimeEl.textContent = '0:00';
      progressSlider.value = 0;
      playlistItems.forEach((item, i) => item.classList.toggle('active', i === trackIdx));
    };

    const tick = () => {
      elapsed += 1;
      if (elapsed >= tracks[trackIdx].duration) {
        loadTrack(trackIdx + 1);
        return;
      }
      currentTimeEl.textContent = fmt(elapsed);
      progressSlider.value = (elapsed / tracks[trackIdx].duration) * 100;
    };

    const setPlaying = (val) => {
      playing = val;
      playBtn.textContent = playing ? '⏸' : '▶';
      if (playing) interval = setInterval(tick, 1000);
      else clearInterval(interval);
    };

    playBtn.addEventListener('click', () => setPlaying(!playing));
    root.querySelector('[data-action="prev"]').addEventListener('click', () => loadTrack(trackIdx - 1));
    root.querySelector('[data-action="next"]').addEventListener('click', () => loadTrack(trackIdx + 1));
    playlistItems.forEach((item, i) => item.addEventListener('dblclick', () => { loadTrack(i); setPlaying(true); }));
    progressSlider.addEventListener('input', () => {
      elapsed = (progressSlider.value / 100) * tracks[trackIdx].duration;
      currentTimeEl.textContent = fmt(elapsed);
    });
    volumeSlider.addEventListener('input', () => {});

    loadTrack(0);
  }

  _initControlPanel(root) {
    root.querySelectorAll('.cp-item').forEach(item => {
      item.addEventListener('click', () => {
        const label = item.querySelector('span').textContent;
        DialogManager.info(label, `${label} settings are illustrative only in this demo.`);
      });
    });
  }

  shutdown(restart) {
    const screen = document.getElementById('shutdown-screen');
    screen.querySelector('.shutdown-text').textContent = restart ? 'Restarting...' : 'Shutting down...';
    screen.classList.add('active');
    setTimeout(() => {
      if (restart) {
        screen.classList.remove('active');
        document.getElementById('boot-screen').classList.remove('hidden');
        setTimeout(() => {
          document.getElementById('boot-screen').classList.add('hidden');
        }, 1800);
      }
    }, 1500);
  }
}

/* ── Solitaire (Klondike) ────────────────────────────────── *
 * Full Klondike Solitaire: standard 52-card deck, 7 tableau columns,
 * 4 foundation piles, stock/waste cycling, drag-and-drop, auto-move on
 * double-click, score tracking, and a countdown timer. */
AppManager.prototype._initSolitaire = function (root) {
  const SUITS = [
    { key: 'spades', symbol: '♠', color: 'black' },
    { key: 'hearts', symbol: '♥', color: 'red' },
    { key: 'clubs', symbol: '♣', color: 'black' },
    { key: 'diamonds', symbol: '♦', color: 'red' },
  ];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  const stockPile = root.querySelector('#stock-pile');
  const wastePile = root.querySelector('#waste-pile');
  const foundationsEl = root.querySelector('#foundations');
  const tableauEl = root.querySelector('#tableau');
  const scoreEl = root.querySelector('#solitaire-score');
  const timerEl = root.querySelector('#solitaire-timer');
  const winMsg = root.querySelector('#solitaire-win-message');
  const newGameBtn = root.querySelector('#solitaire-new-game');
  const playAgainBtn = root.querySelector('#solitaire-play-again');

  let deck = [];
  let waste = [];
  let foundations = { spades: [], hearts: [], clubs: [], diamonds: [] };
  let tableau = [[], [], [], [], [], [], []];
  let score = 0;
  let seconds = 0;
  let timerInterval = null;
  let dragState = null;

  function buildDeck() {
    const cards = [];
    SUITS.forEach(suit => {
      RANKS.forEach((rank, i) => {
        cards.push({ suit: suit.key, symbol: suit.symbol, color: suit.color, rank, value: i + 1, faceUp: false, id: suit.key + rank });
      });
    });
    return cards;
  }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function newGame() {
    deck = shuffle(buildDeck());
    waste = [];
    foundations = { spades: [], hearts: [], clubs: [], diamonds: [] };
    tableau = [[], [], [], [], [], [], []];
    score = 0;
    seconds = 0;
    scoreEl.textContent = '0';
    timerEl.textContent = '0:00';
    winMsg.style.display = 'none';
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      seconds++;
      const m = Math.floor(seconds / 60), s = seconds % 60;
      timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);

    for (let col = 0; col < 7; col++) {
      for (let row = 0; row <= col; row++) {
        const card = deck.pop();
        card.faceUp = row === col;
        tableau[col].push(card);
      }
    }
    render();
  }

  function addScore(n) { score = Math.max(0, score + n); scoreEl.textContent = score; }

  function canStackTableau(card, targetCard) {
    if (!targetCard) return card.rank === 'K';
    const altColor = card.color !== targetCard.color;
    return altColor && card.value === targetCard.value - 1;
  }
  function canStackFoundation(card, pileKey) {
    const pile = foundations[pileKey];
    if (card.suit !== pileKey) return false;
    if (pile.length === 0) return card.rank === 'A';
    return card.value === pile[pile.length - 1].value + 1;
  }

  function flipStock() {
    if (deck.length === 0) {
      if (waste.length === 0) return;
      deck = waste.reverse().map(c => ({ ...c, faceUp: false }));
      waste = [];
      addScore(0);
    } else {
      const card = deck.pop();
      card.faceUp = true;
      waste.push(card);
      addScore(0);
    }
    render();
  }

  function tryAutoMoveToFoundation(card, fromCol) {
    for (const suit of SUITS) {
      if (canStackFoundation(card, suit.key)) {
        foundations[suit.key].push(card);
        if (fromCol === 'waste') waste.pop();
        else if (typeof fromCol === 'number') {
          tableau[fromCol].pop();
          if (tableau[fromCol].length) tableau[fromCol][tableau[fromCol].length - 1].faceUp = true;
        }
        addScore(10);
        return true;
      }
    }
    return false;
  }

  function checkWin() {
    const total = Object.values(foundations).reduce((a, p) => a + p.length, 0);
    if (total === 52) {
      winMsg.style.display = 'flex';
      clearInterval(timerInterval);
    }
  }

  function makeCardEl(card, faceDown) {
    const el = document.createElement('div');
    el.className = 'playing-card ' + (faceDown ? 'face-down' : card.color);
    if (!faceDown) {
      el.innerHTML = `
        <div class="card-corner top">${card.rank}<span>${card.symbol}</span></div>
        <div class="card-center">${card.symbol}</div>
        <div class="card-corner bottom">${card.rank}<span>${card.symbol}</span></div>`;
    }
    el.dataset.cardId = card.id;
    return el;
  }

  function render() {
    stockPile.innerHTML = '';
    if (deck.length > 0) {
      const el = makeCardEl(deck[deck.length - 1], true);
      el.style.position = 'static';
      stockPile.appendChild(el);
    } else {
      stockPile.innerHTML = '<div style="position:absolute;inset:6px;border:2px dashed rgba(255,255,255,0.3);border-radius:4px;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,0.5);font-size:20px;">↻</div>';
    }
    stockPile.onclick = flipStock;

    wastePile.innerHTML = '';
    if (waste.length > 0) {
      const card = waste[waste.length - 1];
      const el = makeCardEl(card, false);
      el.style.position = 'static';
      el.classList.add('draggable');
      bindCardDrag(el, card, 'waste', 0);
      el.addEventListener('dblclick', () => {
        if (tryAutoMoveToFoundation(card, 'waste')) { render(); checkWin(); }
      });
      wastePile.appendChild(el);
    }

    foundationsEl.innerHTML = '';
    SUITS.forEach(suit => {
      const pile = document.createElement('div');
      pile.className = 'foundation-pile';
      pile.dataset.pile = 'foundation';
      pile.dataset.suit = suit.key;
      const stack = foundations[suit.key];
      if (stack.length > 0) {
        const el = makeCardEl(stack[stack.length - 1], false);
        el.style.position = 'static';
        pile.appendChild(el);
      } else {
        const label = document.createElement('div');
        label.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:24px;color:rgba(255,255,255,0.25);';
        label.textContent = suit.symbol;
        pile.appendChild(label);
      }
      bindDropTarget(pile, { type: 'foundation', suit: suit.key });
      foundationsEl.appendChild(pile);
    });

    tableauEl.innerHTML = '';
    tableau.forEach((col, colIdx) => {
      const colEl = document.createElement('div');
      colEl.className = 'tableau-column';
      colEl.style.height = Math.max(100, 24 * col.length + 100) + 'px';
      bindDropTarget(colEl, { type: 'tableau', col: colIdx });
      col.forEach((card, cardIdx) => {
        const el = makeCardEl(card, !card.faceUp);
        el.style.top = (cardIdx * 24) + 'px';
        el.style.left = '0px';
        el.style.zIndex = cardIdx;
        if (card.faceUp) {
          el.classList.add('draggable');
          bindCardDrag(el, card, colIdx, col.length - 1 - cardIdx);
          if (cardIdx === col.length - 1) {
            el.addEventListener('dblclick', () => {
              if (tryAutoMoveToFoundation(card, colIdx)) { render(); checkWin(); }
            });
          }
        } else {
          el.addEventListener('click', () => {
            if (cardIdx === col.length - 1) { card.faceUp = true; render(); }
          });
        }
        colEl.appendChild(el);
      });
      tableauEl.appendChild(colEl);
    });
  }

  function bindDropTarget(el, target) {
    el.addEventListener('mouseup', () => {
      if (!dragState) return;
      attemptDrop(target);
    });
  }

  function attemptDrop(target) {
    const { cards, source } = dragState;
    const movingCard = cards[0];
    let success = false;

    if (target.type === 'foundation') {
      if (cards.length === 1 && canStackFoundation(movingCard, target.suit)) {
        foundations[target.suit].push(movingCard);
        success = true;
      }
    } else if (target.type === 'tableau') {
      const destCol = tableau[target.col];
      const topCard = destCol[destCol.length - 1];
      if (canStackTableau(movingCard, topCard)) {
        destCol.push(...cards);
        success = true;
      }
    }

    if (success) {
      removeFromSource(source, cards.length);
      addScore(target.type === 'foundation' ? 10 : 5);
      render();
      checkWin();
    } else {
      render();
    }
    dragState = null;
  }

  function removeFromSource(source, count) {
    if (source.type === 'waste') {
      waste.pop();
    } else if (source.type === 'tableau') {
      const col = tableau[source.col];
      col.splice(col.length - count, count);
      if (col.length > 0) col[col.length - 1].faceUp = true;
    } else if (source.type === 'foundation') {
      foundations[source.suit].pop();
    }
  }

  function bindCardDrag(el, card, colOrWaste, depthFromTop) {
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      let cards, source;
      if (colOrWaste === 'waste') {
        cards = [card];
        source = { type: 'waste' };
      } else {
        const col = tableau[colOrWaste];
        const idx = col.findIndex(c => c.id === card.id);
        const subStack = col.slice(idx);
        if (!subStack.every(c => c.faceUp)) return;
        cards = subStack;
        source = { type: 'tableau', col: colOrWaste };
      }
      dragState = { cards, source };

      const startX = e.clientX, startY = e.clientY;
      const clones = cards.map((c, i) => {
        const clone = makeCardEl(c, false);
        clone.style.position = 'fixed';
        clone.style.zIndex = 9999 + i;
        clone.classList.add('drag-active');
        const rect = el.getBoundingClientRect();
        clone.style.left = rect.left + 'px';
        clone.style.top = (rect.top + i * 24) + 'px';
        clone.style.width = rect.width + 'px';
        clone.style.height = rect.height + 'px';
        document.body.appendChild(clone);
        return clone;
      });
      el.style.visibility = 'hidden';

      const moveHandler = (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        clones.forEach((clone, i) => {
          const rect = el.getBoundingClientRect();
          clone.style.transform = `translate(${dx}px, ${dy}px)`;
        });
      };
      const upHandler = (ev) => {
        clones.forEach(c => c.remove());
        document.removeEventListener('mousemove', moveHandler);
        document.removeEventListener('mouseup', upHandler);
        const elemBelow = document.elementFromPoint(ev.clientX, ev.clientY);
        const pileEl = elemBelow ? elemBelow.closest('.tableau-column, .foundation-pile') : null;
        if (pileEl) {
          if (pileEl.classList.contains('foundation-pile')) {
            attemptDrop({ type: 'foundation', suit: pileEl.dataset.suit });
          } else {
            const colIdx = Array.from(tableauEl.children).indexOf(pileEl);
            attemptDrop({ type: 'tableau', col: colIdx });
          }
        } else {
          dragState = null;
          render();
        }
      };
      document.addEventListener('mousemove', moveHandler);
      document.addEventListener('mouseup', upHandler);
    });
  }

  newGameBtn.addEventListener('click', newGame);
  playAgainBtn.addEventListener('click', newGame);
  newGame();
};

/* ── Minesweeper ─────────────────────────────────────────── *
 * Classic Minesweeper with Beginner / Intermediate / Expert difficulties.
 * Mines are placed after the first click (safe-first-click guarantee),
 * flood-fill reveals empty regions, and chord-reveal fires on double-click. */
AppManager.prototype._initMinesweeper = function (root) {
  const gridEl = root.querySelector('#minesweeper-grid');
  const mineCountEl = root.querySelector('#ms-mine-count');
  const timerEl = root.querySelector('#ms-timer');
  const faceBtn = root.querySelector('#ms-face');
  const diffBtns = root.querySelectorAll('.ms-difficulty button');

  const DIFFICULTIES = {
    beginner: { rows: 9, cols: 9, mines: 10 },
    intermediate: { rows: 12, cols: 12, mines: 24 },
    expert: { rows: 14, cols: 16, mines: 40 },
  };

  let rows, cols, mineCount;
  let board = [];
  let revealedCount = 0;
  let flagCount = 0;
  let gameOver = false;
  let firstClick = true;
  let timer = 0;
  let timerInterval = null;

  function buildBoard(diff) {
    const cfg = DIFFICULTIES[diff];

    rows = cfg.rows;
    cols = cfg.cols;
    mineCount = cfg.mines;

    board = [];
    for (let r = 0; r < rows; r++) {
      board[r] = [];
      for (let c = 0; c < cols; c++) {
        board[r][c] = {
          mine: false,
          revealed: false,
          flagged: false,
          adjacent: 0
        };
      }
    }

    revealedCount = 0;
    flagCount = 0;
    gameOver = false;
    firstClick = true;

    clearInterval(timerInterval);
    timer = 0;
    timerEl.textContent = "000";

    faceBtn.innerHTML = '<img src="assets/icons/ui/ms-face.png" alt=":)" style="width:20px;height:20px;">';
    updateMineCount();

    const cellSize = 24;
    const gridWidth = cols * cellSize;
    const gridHeight = rows * cellSize;

    gridEl.style.width = gridWidth + "px";
    gridEl.style.height = gridHeight + "px";
    gridEl.style.gridTemplateColumns = `repeat(${cols}, ${cellSize}px)`;
    gridEl.style.gridTemplateRows = `repeat(${rows}, ${cellSize}px)`;

    const winEl = root.closest(".window");
    if (winEl) {
      const newWidth = gridWidth + 50;
      const newHeight = gridHeight + 170;
      winEl.style.width = newWidth + "px";
      winEl.style.height = newHeight + "px";
      winEl.dataset.width = newWidth;
      winEl.dataset.height = newHeight;
    }

    renderGrid();
  }

  function placeMines(excludeR, excludeC) {
    let placed = 0;
    const positions = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (Math.abs(r - excludeR) <= 1 && Math.abs(c - excludeC) <= 1) continue;
        positions.push([r, c]);
      }
    }
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    for (let i = 0; i < Math.min(mineCount, positions.length); i++) {
      const [r, c] = positions[i];
      board[r][c].mine = true;
    }
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].mine) continue;
        let count = 0;
        const minR = Math.max(0, r - 1);
        const maxR = Math.min(rows - 1, r + 1);
        const minC = Math.max(0, c - 1);
        const maxC = Math.min(cols - 1, c + 1);
        for (let nr = minR; nr <= maxR; nr++) {
          for (let nc = minC; nc <= maxC; nc++) {
            if (nr === r && nc === c) continue;
            if (board[nr][nc].mine) count++;
          }
        }
        board[r][c].adjacent = count;
      }
    }
  }

  function updateMineCount() {
    const remaining = Math.max(0, mineCount - flagCount);
    mineCountEl.textContent = remaining.toString().padStart(3, '0');
  }

  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      timer = Math.min(999, timer + 1);
      timerEl.textContent = timer.toString().padStart(3, '0');
    }, 1000);
  }

  function reveal(r, c) {
    if (gameOver) return;
    const cell = board[r][c];
    if (cell.revealed || cell.flagged) return;

    if (firstClick) {
      placeMines(r, c);
      firstClick = false;
      startTimer();
    }

    cell.revealed = true;
    revealedCount++;

    if (cell.mine) {
      gameOver = true;
      clearInterval(timerInterval);
      faceBtn.innerHTML = '<img src="assets/icons/ui/ms-face-dead.png" alt="X_X" style="width:20px;height:20px;">';
      revealAllMines();
      renderGrid();
      return;
    }

    if (cell.adjacent === 0) {
      const stack = [[r, c]];
      while (stack.length > 0) {
        const [cr, cc] = stack.pop();
        const minR = Math.max(0, cr - 1);
        const maxR = Math.min(rows - 1, cr + 1);
        const minC = Math.max(0, cc - 1);
        const maxC = Math.min(cols - 1, cc + 1);
        for (let nr = minR; nr <= maxR; nr++) {
          for (let nc = minC; nc <= maxC; nc++) {
            if (nr === cr && nc === cc) continue;
            const neighbor = board[nr][nc];
            if (!neighbor.revealed && !neighbor.flagged && !neighbor.mine) {
              neighbor.revealed = true;
              revealedCount++;
              if (neighbor.adjacent === 0) {
                stack.push([nr, nc]);
              }
            }
          }
        }
      }
    }

    checkWin();
    renderGrid();
  }

  function revealAllMines() {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].mine) board[r][c].revealed = true;
      }
    }
  }

  function checkWin() {
    const totalSafe = rows * cols - mineCount;
    if (revealedCount === totalSafe && !gameOver) {
      gameOver = true;
      clearInterval(timerInterval);
      faceBtn.innerHTML = '<img src="assets/icons/ui/ms-face-win.png" alt=":D" style="width:20px;height:20px;">';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (board[r][c].mine) board[r][c].flagged = true;
        }
      }
      flagCount = mineCount;
      updateMineCount();
      renderGrid();
    }
  }

  function toggleFlag(r, c) {
    if (gameOver) return;
    const cell = board[r][c];
    if (cell.revealed) return;
    cell.flagged = !cell.flagged;
    flagCount += cell.flagged ? 1 : -1;
    updateMineCount();
    renderGrid();
  }

  function chordReveal(r, c) {
    const cell = board[r][c];
    if (!cell.revealed || cell.adjacent === 0) return;
    let flagged = 0;
    const minR = Math.max(0, r - 1);
    const maxR = Math.min(rows - 1, r + 1);
    const minC = Math.max(0, c - 1);
    const maxC = Math.min(cols - 1, c + 1);
    for (let nr = minR; nr <= maxR; nr++) {
      for (let nc = minC; nc <= maxC; nc++) {
        if (nr === r && nc === c) continue;
        if (board[nr][nc].flagged) flagged++;
      }
    }
    if (flagged === cell.adjacent) {
      for (let nr = minR; nr <= maxR; nr++) {
        for (let nc = minC; nc <= maxC; nc++) {
          if (nr === r && nc === c) continue;
          reveal(nr, nc);
        }
      }
      renderGrid();
    }
  }

  function renderGrid() {
    const cellSize = 24;
    gridEl.innerHTML = '';
    const numberSymbols = ['', '1', '2', '3', '4', '5', '6', '7', '8'];
    
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board[r][c];
        const el = document.createElement('div');
        el.className = 'ms-cell';
        el.style.width = cellSize + 'px';
        el.style.height = cellSize + 'px';
        
        if (cell.revealed) {
          el.classList.add('revealed');
          if (cell.mine) {
            el.classList.add('mine');
            el.innerHTML = '<img src="assets/icons/ui/ms-bomb.png" alt="*" style="width:14px;height:14px;">';
          } else if (cell.adjacent > 0) {
            el.textContent = numberSymbols[cell.adjacent];
            el.dataset.num = cell.adjacent;
          }
        } else if (cell.flagged) {
          el.classList.add('flag');
          el.innerHTML = '<img src="assets/icons/ui/ms-flag.png" alt="F" style="width:14px;height:14px;">';
        }
        
        el.addEventListener('click', () => reveal(r, c));
        el.addEventListener('dblclick', () => chordReveal(r, c));
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); toggleFlag(r, c); });
        gridEl.appendChild(el);
      }
    }
  }

  faceBtn.addEventListener('click', () => {
    const activeDiff = root.querySelector('.ms-difficulty button.active').dataset.diff;
    buildBoard(activeDiff);
  });

  diffBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      diffBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildBoard(btn.dataset.diff);
    });
  });

  buildBoard('beginner');
};

/* ── Chess Titans ────────────────────────────────────────── *
 * Two-player chess with full legal-move validation (including check),
 * checkmate/stalemate detection, pawn promotion to queen, and
 * highlighted legal-move squares on piece selection. */
AppManager.prototype._initChess = function (root) {
  const boardEl = root.querySelector('#chess-board');
  const statusEl = root.querySelector('#chess-status');
  const resetBtn = root.querySelector('#chess-reset');

  const PIECES = {
    wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
    bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
  };

  let board, turn, selected, legalMoves, gameOver;

  function initialBoard() {
    const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    const b = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let c = 0; c < 8; c++) {
      b[0][c] = 'b' + back[c];
      b[1][c] = 'bP';
      b[6][c] = 'wP';
      b[7][c] = 'w' + back[c];
    }
    return b;
  }

  function newGame() {
    board = initialBoard();
    turn = 'w';
    selected = null;
    legalMoves = [];
    gameOver = false;
    statusEl.textContent = 'White to move';
    render();
  }

  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  function pieceColor(p) { return p ? p[0] : null; }
  function pieceType(p) { return p ? p[1] : null; }

  function rawMoves(r, c, b) {
    const p = b[r][c];
    if (!p) return [];
    const color = pieceColor(p), type = pieceType(p);
    const moves = [];
    const addIfValid = (nr, nc, captureOnly, noCaptureOnly) => {
      if (!inBounds(nr, nc)) return false;
      const target = b[nr][nc];
      if (target && pieceColor(target) === color) return false;
      if (captureOnly && !target) return false;
      if (noCaptureOnly && target) return false;
      moves.push([nr, nc]);
      return !target;
    };

    if (type === 'P') {
      const dir = color === 'w' ? -1 : 1;
      const startRow = color === 'w' ? 6 : 1;
      if (inBounds(r + dir, c) && !b[r + dir][c]) {
        moves.push([r + dir, c]);
        if (r === startRow && !b[r + 2 * dir][c]) moves.push([r + 2 * dir, c]);
      }
      [c - 1, c + 1].forEach(nc => {
        if (inBounds(r + dir, nc) && b[r + dir][nc] && pieceColor(b[r + dir][nc]) !== color) {
          moves.push([r + dir, nc]);
        }
      });
    } else if (type === 'N') {
      const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      deltas.forEach(([dr, dc]) => addIfValid(r + dr, c + dc));
    } else if (type === 'K') {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        addIfValid(r + dr, c + dc);
      }
    } else {
      let dirs = [];
      if (type === 'R' || type === 'Q') dirs.push([-1,0],[1,0],[0,-1],[0,1]);
      if (type === 'B' || type === 'Q') dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      dirs.forEach(([dr, dc]) => {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const target = b[nr][nc];
          if (target && pieceColor(target) === color) break;
          moves.push([nr, nc]);
          if (target) break;
          nr += dr; nc += dc;
        }
      });
    }
    return moves;
  }

  function findKing(color, b) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      if (b[r][c] === color + 'K') return [r, c];
    }
    return null;
  }

  function isSquareAttacked(r, c, byColor, b) {
    for (let rr = 0; rr < 8; rr++) for (let cc = 0; cc < 8; cc++) {
      const p = b[rr][cc];
      if (p && pieceColor(p) === byColor) {
        const moves = rawMoves(rr, cc, b);
        if (moves.some(([mr, mc]) => mr === r && mc === c)) return true;
      }
    }
    return false;
  }

  function isInCheck(color, b) {
    const king = findKing(color, b);
    if (!king) return false;
    const enemy = color === 'w' ? 'b' : 'w';
    return isSquareAttacked(king[0], king[1], enemy, b);
  }

  function legalMovesFor(r, c) {
    const p = board[r][c];
    if (!p) return [];
    const color = pieceColor(p);
    const raw = rawMoves(r, c, board);
    return raw.filter(([nr, nc]) => {
      const cloned = board.map(row => row.slice());
      cloned[nr][nc] = cloned[r][c];
      cloned[r][c] = null;
      return !isInCheck(color, cloned);
    });
  }

  function hasAnyLegalMove(color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && pieceColor(p) === color) {
        if (legalMovesFor(r, c).length > 0) return true;
      }
    }
    return false;
  }

  function move(r1, c1, r2, c2) {
    const movingPiece = board[r1][c1];
    board[r2][c2] = movingPiece;
    board[r1][c1] = null;
    if (pieceType(movingPiece) === 'P' && (r2 === 0 || r2 === 7)) {
      board[r2][c2] = pieceColor(movingPiece) + 'Q';
    }
    turn = turn === 'w' ? 'b' : 'w';
    updateStatus();
  }

  function updateStatus() {
    const colorName = turn === 'w' ? 'White' : 'Black';
    const inCheck = isInCheck(turn, board);
    const hasMoves = hasAnyLegalMove(turn);
    if (!hasMoves && inCheck) {
      statusEl.textContent = `Checkmate — ${turn === 'w' ? 'Black' : 'White'} wins!`;
      gameOver = true;
    } else if (!hasMoves) {
      statusEl.textContent = 'Stalemate — Draw';
      gameOver = true;
    } else if (inCheck) {
      statusEl.textContent = `${colorName} to move — Check!`;
    } else {
      statusEl.textContent = `${colorName} to move`;
    }
  }

  function render() {
    boardEl.innerHTML = '';
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const cell = document.createElement('div');
        cell.className = 'chess-cell ' + ((r + c) % 2 === 0 ? 'light' : 'dark');
        const p = board[r][c];
        if (p) cell.textContent = PIECES[p];

        if (selected && selected[0] === r && selected[1] === c) cell.classList.add('selected');
        if (legalMoves.some(([mr, mc]) => mr === r && mc === c)) {
          cell.classList.add(board[r][c] ? 'legal-capture' : 'legal-move');
        }

        cell.addEventListener('click', () => handleCellClick(r, c));
        boardEl.appendChild(cell);
      }
    }
  }

  function handleCellClick(r, c) {
    if (gameOver) return;
    const p = board[r][c];

    if (selected) {
      const isLegal = legalMoves.some(([mr, mc]) => mr === r && mc === c);
      if (isLegal) {
        move(selected[0], selected[1], r, c);
        selected = null;
        legalMoves = [];
        render();
        return;
      }
      if (p && pieceColor(p) === turn) {
        selected = [r, c];
        legalMoves = legalMovesFor(r, c);
        render();
        return;
      }
      selected = null;
      legalMoves = [];
      render();
      return;
    }

    if (p && pieceColor(p) === turn) {
      selected = [r, c];
      legalMoves = legalMovesFor(r, c);
      render();
    }
  }

  resetBtn.addEventListener('click', newGame);
  newGame();
};

/* ── DOOM (js-dos v7 integration) ───────────────────────── *
 * Launches DOOM via the js-dos v7 Dos() API.
 * Registers a cleanup function on the window so that closing the window
 * properly tears down the AudioContext, canvases, and the DOS instance. */
AppManager.prototype._initDoom = function (root) {
    const container = root.querySelector('#doom-canvas-wrap');
    container.innerHTML = '';

    const div = document.createElement('div');
    div.style.width = "100%";
    div.style.height = "100%";
    container.appendChild(div);

    const winData = this.windowManager.getWindowByApp('doom');
    let dosInstance = null;
    let audioContext = null;
    let isCleanedUp = false;

    const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;
        
        
        
        try {
            if (audioContext) {
                try {
                    audioContext.close();
                } catch (e) {
                    console.warn('AudioContext close error:', e);
                }
                audioContext = null;
            }
            
            const audios = container.querySelectorAll('audio');
            audios.forEach(audio => {
                try {
                    audio.pause();
                    audio.src = '';
                    audio.load();
                } catch (e) {}
                audio.remove();
            });
            
            const videos = container.querySelectorAll('video');
            videos.forEach(video => {
                try {
                    video.pause();
                    video.src = '';
                    video.load();
                } catch (e) {}
                video.remove();
            });
            
            const canvases = container.querySelectorAll('canvas');
            canvases.forEach(canvas => {
                try {
                    const ctx = canvas.getContext('2d');
                    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
                    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
                    if (gl) {
                        gl.getExtension('WEBGL_lose_context')?.loseContext();
                    }
                } catch (e) {}
                canvas.remove();
            });
            
            if (dosInstance && typeof dosInstance.exit === 'function') {
                try {
                    dosInstance.exit();
                } catch (e) {
                    console.warn('DOS exit error:', e);
                }
                dosInstance = null;
            }
            
            while (container.firstChild) {
                try {
                    container.removeChild(container.firstChild);
                } catch (e) {
                    break;
                }
            }
            
            container.innerHTML = '';
            
        } catch (e) {
            console.warn('DOOM cleanup error:', e);
        }
    };

    if (winData) {
        if (winData._cleanupDoom) {
            delete winData._cleanupDoom;
        }
        
        winData._cleanupDoom = cleanup;
        winData._cleanupFunctions = winData._cleanupFunctions || [];
        winData._cleanupFunctions.push(cleanup);
    }

    Dos(div, {
        url: "assets/games/doom/DOOM.jsdos",
        wdosboxUrl: "assets/jsdos/wdosbox.js",
        kiosk: true,
        audioWorklet: true,
        noCloud: true,
        autoStart: true,
        noNetworking: true,
        onEvent: (e, ci) => {
            if (e === "ci-ready") {
                dosInstance = ci;
                
                try {
                    audioContext = ci.getAudioContext?.();
                } catch (e) {}
                
                ci.setFullScreen?.(true);
                
                const unlock = () => {
                    try {
                        const ctx = ci.getAudioContext?.();
                        if (ctx && ctx.state === 'suspended') {
                            ctx.resume();
                        }
                    } catch (e) {}
                };
                
                const unlockHandler = () => {
                    unlock();
                    document.removeEventListener('click', unlockHandler);
                    document.removeEventListener('keydown', unlockHandler);
                    document.removeEventListener('mousedown', unlockHandler);
                };
                
                document.addEventListener('click', unlockHandler, { once: true });
                document.addEventListener('keydown', unlockHandler, { once: true });
                document.addEventListener('mousedown', unlockHandler, { once: true });
            }
        }
    });
};



/* ── Bootstrap ───────────────────────────────────────────── *
 * Entry point: instantiates all managers, wires their dependencies,
 * registers global keyboard shortcuts, plays the startup sound,
 * fades out the boot screen, and auto-launches the About Me app. */
document.addEventListener('DOMContentLoaded', () => {
  const appManager = new AppManager();
  const taskbarManager = new TaskbarManager();
  const windowManager = new WindowManager(taskbarManager);
  taskbarManager.setWindowManager(windowManager);
  appManager.setWindowManager(windowManager);
  windowManager.taskbarManager = taskbarManager;

  const desktopManager = new DesktopManager(appManager);
  const startMenuManager = new StartMenuManager(appManager);

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'F4') {
      e.preventDefault();
      if (windowManager.activeId) windowManager.close(windowManager.activeId);
    }
  });

  Sound.startup();
  setTimeout(() => {
    document.getElementById('boot-screen').classList.add('hidden');
  }, 1400);

  setTimeout(() => {
    appManager.launch('aboutme');
  }, 1700);

  window.__win7 = { appManager, windowManager, taskbarManager, desktopManager, startMenuManager };
});