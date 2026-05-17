'use strict';

const App = {
  diagramGame: null,
  trussBuilder: null,
  inertiaLab: null,

  init() {},

  showMenu() {
    document.getElementById('menu-view').style.display = '';
    document.getElementById('game-view').style.display = 'none';
    document.getElementById('builder-view').style.display = 'none';
    const inertiaView = document.getElementById('inertia-view');
    if (inertiaView) inertiaView.style.display = 'none';
    if (this.diagramGame)  { this.diagramGame.destroy();  this.diagramGame  = null; }
    if (this.trussBuilder) { this.trussBuilder.destroy(); this.trussBuilder = null; }
    if (this.inertiaLab)   { this.inertiaLab.destroy();   this.inertiaLab   = null; }
  },

  showDiagramGame(mode) {
    mode = mode || 'basics';
    document.getElementById('menu-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'flex';
    document.getElementById('builder-view').style.display = 'none';
    const inertiaView = document.getElementById('inertia-view');
    if (inertiaView) inertiaView.style.display = 'none';
    if (this.diagramGame)  { this.diagramGame.destroy();  this.diagramGame  = null; }
    if (this.trussBuilder) { this.trussBuilder.destroy(); this.trussBuilder = null; }
    if (this.inertiaLab)   { this.inertiaLab.destroy();   this.inertiaLab   = null; }
    const canvas = document.getElementById('game-canvas');
    const wrap   = document.getElementById('game-canvas-wrap');
    if (mode === 'fachwerk' && window.FrameChallenge) {
      this.diagramGame = new window.FrameChallenge(canvas, wrap, mode);
    } else {
      this.diagramGame = new DiagramGame(canvas, wrap, mode);
    }
    this.diagramGame.start();
  },

  showTrussBuilder() {
    document.getElementById('menu-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'none';
    document.getElementById('builder-view').style.display = 'flex';
    const inertiaView = document.getElementById('inertia-view');
    if (inertiaView) inertiaView.style.display = 'none';
    const canvas = document.getElementById('builder-canvas');
    const wrap   = document.getElementById('builder-canvas-wrap');
    this.trussBuilder = new TrussBuilder(canvas, wrap);
  },

  showInertiaLab(level) {
    document.getElementById('menu-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'none';
    document.getElementById('builder-view').style.display = 'none';
    const view = document.getElementById('inertia-view');
    if (!view || !window.InertiaLab) return;
    view.style.display = 'flex';
    const canvas = document.getElementById('inertia-canvas');
    const wrap   = document.getElementById('inertia-canvas-wrap');
    this.inertiaLab = new window.InertiaLab(canvas, wrap, level || 'mid');
    // Resize warten, bis Layout steht
    requestAnimationFrame(() => this.inertiaLab.start());
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
