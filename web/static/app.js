'use strict';

const App = {
  diagramGame: null,
  trussBuilder: null,

  init() {},

  showMenu() {
    document.getElementById('menu-view').style.display = '';
    document.getElementById('game-view').style.display = 'none';
    document.getElementById('builder-view').style.display = 'none';
    if (this.diagramGame)  { this.diagramGame.destroy();  this.diagramGame  = null; }
    if (this.trussBuilder) { this.trussBuilder.destroy(); this.trussBuilder = null; }
  },

  showDiagramGame(mode) {
    mode = mode || 'basics';
    document.getElementById('menu-view').style.display = 'none';
    document.getElementById('game-view').style.display = 'flex';
    document.getElementById('builder-view').style.display = 'none';
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
    const canvas = document.getElementById('builder-canvas');
    const wrap   = document.getElementById('builder-canvas-wrap');
    this.trussBuilder = new TrussBuilder(canvas, wrap);
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
