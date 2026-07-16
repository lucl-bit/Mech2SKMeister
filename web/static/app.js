'use strict';

const App = {
  diagramGame: null,
  trussBuilder: null,
  inertiaLab: null,

  init() {},

  _showView(id) {
    for (const vid of ['menu-view', 'game-view', 'builder-view', 'inertia-view', 'settings-view']) {
      const el = document.getElementById(vid);
      if (!el) continue;
      el.style.display = vid === id ? (vid === 'menu-view' ? '' : 'flex') : 'none';
    }
  },

  _destroyAll() {
    if (this.diagramGame)  { this.diagramGame.destroy();  this.diagramGame  = null; }
    if (this.trussBuilder) { this.trussBuilder.destroy(); this.trussBuilder = null; }
    if (this.inertiaLab)   { this.inertiaLab.destroy();   this.inertiaLab   = null; }
  },

  showMenu() {
    this._showView('menu-view');
    this._destroyAll();
  },

  showDiagramGame(mode) {
    mode = mode || 'basics';
    this._showView('game-view');
    this._destroyAll();
    const canvas = document.getElementById('game-canvas');
    const wrap   = document.getElementById('game-canvas-wrap');
    if (mode === 'fachwerk' && window.FrameChallenge) {
      this.diagramGame = new window.FrameChallenge(canvas, wrap, mode);
    } else {
      this.diagramGame = new DiagramGame(canvas, wrap, mode);
    }
    this.diagramGame.start();
  },

  // fixture/opts optional: aus dem Einstellungen-Tab wird ein bestehendes
  // Fixture zum Bearbeiten geladen und der Speichern-Button eingeblendet.
  showTrussBuilder(fixture, opts) {
    this._showView('builder-view');
    this._destroyAll();
    const canvas = document.getElementById('builder-canvas');
    const wrap   = document.getElementById('builder-canvas-wrap');
    this.trussBuilder = new TrussBuilder(canvas, wrap);
    const fromSettings = !!(opts && opts.fromSettings);
    const saveBtn = document.getElementById('btn-save-fixture');
    if (saveBtn) saveBtn.style.display = fromSettings ? '' : 'none';
    if (fixture) {
      this.trussBuilder.editContext = {
        fixtureId: fixture.id,
        title: fixture.title || '',
        source: fixture.source || '',
        description: fixture.description || '',
      };
      this.trussBuilder.loadFixture(fixture);
    } else {
      this.trussBuilder.editContext = null;
    }
  },

  showInertiaLab(level) {
    const view = document.getElementById('inertia-view');
    if (!view || !window.InertiaLab) return;
    this._showView('inertia-view');
    this._destroyAll();
    const canvas = document.getElementById('inertia-canvas');
    const wrap   = document.getElementById('inertia-canvas-wrap');
    this.inertiaLab = new window.InertiaLab(canvas, wrap, level || 'mid');
    // Resize warten, bis Layout steht
    requestAnimationFrame(() => this.inertiaLab.start());
  },

  showSettings() {
    this._showView('settings-view');
    this._destroyAll();
    if (window.Settings) Settings.open();
  },
};

window.App = App;
window.addEventListener('DOMContentLoaded', () => App.init());
