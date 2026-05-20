'use strict';

const TB = {
  paper: '#FBFDFF', text: '#172033', muted: '#617089', border: '#D8E0EA',
  gridMinor: '#DDECF8', gridMajor: '#C7DFF0',
  blue: '#2F6FED', green: '#2E9D62', purple: '#7C5CE0',
  red: '#D9534F', orange: '#D98634', beam: '#263447', load: '#D9534F',
  hoverHalo: 'rgba(47,111,237,0.18)',
};

class TrussBuilder {
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = wrap;
    this.SNAP = 24;

    this.nodes = [];
    this.members = [];
    this.supports = {};
    this.freeEnds = new Set();
    this.welds = new Set();        // node_ids that are rigidly welded
    this.loads = {};
    this.loadsZ = {};
    this.distributedLoads = {};  // bar_id → { bar_id, q }
    this.manualSolution = {};   // bar_id → {N:{start,end}, Q:{start,end}, M:{start,end}}
    this.editMode = false;
    this.editDragging = null;   // {bar_id, which: 'start'|'end'}
    this.memberForces = {};
    this.beamResults = {};
    this.reactions = {};
    this.nextNodeId = 1;
    this.activeMemberStart = null;
    this.activeLoadNodeId = null;
    this.previewLoadEnd = null;
    this.tool = 'node';
    this.mode = 'N';
    this.hoverNode = null;
    this.hoverPos = null;

    this.undoStack = [];
    this.redoStack = [];

    this._buildToolbar();
    this._buildHistoryControls();
    this._resize();
    this.redraw();

    this._onPress = this._onPress.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onRelease = this._onRelease.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onKey = this._onKey.bind(this);
    canvas.addEventListener('pointerdown', this._onPress);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onRelease);
    canvas.addEventListener('pointercancel', this._onRelease);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('keydown', this._onKey);
    canvas.style.cursor = 'crosshair';
  }

  destroy() {
    this.canvas.removeEventListener('pointerdown', this._onPress);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onRelease);
    this.canvas.removeEventListener('pointercancel', this._onRelease);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
  }

  _buildToolbar() {
    const container = document.getElementById('tool-buttons');
    container.innerHTML = '';
    const tools = [
      ['node',   'Knoten',        'Klicke auf das Raster, um einen Knoten zu setzen.'],
      ['member', 'Stab',          'Zwei Knoten nacheinander anklicken.'],
      ['pin',    'Festlager',     'Auf einen Knoten klicken (▲ + Strich, blockiert x und y).'],
      ['roller', 'Loslager',      'Auf einen Knoten klicken (▲ auf Rollen, nur y blockiert).'],
      ['fixed',  'Einspannung',   'Auf einen Knoten klicken (Wand, blockiert alles inkl. Moment).'],
      ['weld',   'Verschweissung','Markiert einen Knoten als biegesteif (überträgt M). Default ist Gelenk.'],
      ['free',   'Freies Ende',   'Markiert einen Knoten ausdrücklich als frei.'],
      ['load',   'Last ziehen',   'Vom Knoten ausgehend in Lastrichtung ziehen.'],
      ['loadz',    'Z-Last ⊗/⊙',    'Klick auf einen Knoten: ⊗ (hinein) → ⊙ (heraus) → entfernen.'],
      ['distload', 'Streckenlast',  'Klick auf einen Stab: Streckenlast ↓↓↓ ein-/ausschalten.'],
      ['delete',   'Löschen',       'Klick auf einen Knoten löscht ihn + alle anhängenden Stäbe.'],
    ];
    tools.forEach(([value, label, tip]) => {
      const div = document.createElement('label');
      div.className = 'radio-tool' + (value === this.tool ? ' active' : '');
      div.title = tip;
      div.innerHTML = `<input type="radio" name="tool" value="${value}" ${value === this.tool ? 'checked' : ''}> <span>${label}</span>`;
      div.querySelector('input').addEventListener('change', () => {
        this.setTool(value);
        document.querySelectorAll('.radio-tool').forEach(el => el.classList.remove('active'));
        div.classList.add('active');
      });
      container.appendChild(div);
    });
  }

  _buildHistoryControls() {
    const container = document.getElementById('tool-buttons');
    const wrap = document.createElement('div');
    wrap.className = 'history-row';
    wrap.innerHTML = `
      <button type="button" class="btn-icon" id="btn-undo" title="Rückgängig (⌘Z)">↶</button>
      <button type="button" class="btn-icon" id="btn-redo" title="Wiederherstellen (⌘⇧Z)">↷</button>
    `;
    container.parentNode.insertBefore(wrap, container);
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());
    this._updateHistoryButtons();
  }

  _updateHistoryButtons() {
    const u = document.getElementById('btn-undo');
    const r = document.getElementById('btn-redo');
    if (u) u.disabled = this.undoStack.length === 0;
    if (r) r.disabled = this.redoStack.length === 0;
  }

  // ===== HISTORY =====
  _snapshot() {
    return JSON.stringify({
      nodes: this.nodes,
      members: this.members,
      supports: this.supports,
      freeEnds: [...this.freeEnds],
      welds: [...this.welds],
      loads: this.loads,
      loadsZ: this.loadsZ,
      distributedLoads: this.distributedLoads,
      nextNodeId: this.nextNodeId,
    });
  }
  _restore(s) {
    const o = JSON.parse(s);
    this.nodes = o.nodes;
    this.members = o.members;
    this.supports = o.supports;
    this.freeEnds = new Set(o.freeEnds);
    this.welds = new Set(o.welds);
    this.loads = o.loads;
    this.loadsZ = o.loadsZ || {};
    this.distributedLoads = o.distributedLoads || {};
    this.nextNodeId = o.nextNodeId;
    this.activeMemberStart = null;
    this.activeLoadNodeId = null;
    this.previewLoadEnd = null;
    this._clearResults();
  }
  _pushUndo() {
    this.undoStack.push(this._snapshot());
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this._updateHistoryButtons();
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this._snapshot());
    this._restore(this.undoStack.pop());
    this._setStatus('Rückgängig.');
    this._updateHistoryButtons();
    this.redraw();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this._snapshot());
    this._restore(this.redoStack.pop());
    this._setStatus('Wiederhergestellt.');
    this._updateHistoryButtons();
    this.redraw();
  }
  _onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
    else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); this.redo(); }
  }

  setTool(t) {
    this.tool = t;
    this.activeMemberStart = null;
    const hints = {
      node: 'Raster anklicken, um einen Knoten zu setzen.',
      member: 'Stab: erst Startknoten, dann Endknoten anklicken.',
      pin: 'Festlager: Knoten anklicken.',
      roller: 'Loslager: Knoten anklicken.',
      fixed: 'Einspannung: Knoten anklicken.',
      weld: 'Verschweissung: Knoten anklicken — toggelt zwischen Gelenk und biegesteifem Anschluss.',
      free: 'Freies Ende: Knoten anklicken.',
      load: 'Last: Vom Knoten in Lastrichtung ziehen.',
      distload: 'Streckenlast: Stab anklicken — Streckenlast ein-/ausschalten.',
      delete: 'Löschen: Knoten anklicken.',
    };
    this._setStatus(hints[t] || ('Werkzeug aktiv: ' + t));
  }

  setMode(m) {
    this.mode = m;
    document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('btn-mode-active'));
    document.getElementById('mode-' + m).classList.add('btn-mode-active');
    if (m === 'N') this._setStatus('N-Modus: Normalkraft. Positive N = Zug.');
    else this._setStatus(`${m}-Modus: Beanspruchungsverlauf anzeigen.`);
    this.redraw();
  }

  _setStatus(msg) { document.getElementById('builder-status').textContent = msg; }

  _snap(v) { return Math.round(v / this.SNAP) * this.SNAP; }

  _onResize() { this._resize(); this.redraw(); }
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cssW = w; this._cssH = h;
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _onPress(e) {
    if (e.pointerId !== undefined) this.canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
    const [mx, my] = this._pos(e);
    if (this.editMode) {
      const hit = this._editHitTest(mx, my);
      if (hit) { this.editDragging = hit; this.canvas.style.cursor = 'grabbing'; }
      return;
    }
    const x = this._snap(mx), y = this._snap(my);
    if (this.tool === 'node')        { this._pushUndo(); this._addNode(x, y); }
    else if (this.tool === 'member') { this._handleMemberTool(mx, my); }
    else if (['pin','roller','fixed'].includes(this.tool)) { this._pushUndo(); this._setSupport(mx, my, this.tool); }
    else if (this.tool === 'weld')   { this._pushUndo(); this._toggleWeld(mx, my); }
    else if (this.tool === 'free')   { this._pushUndo(); this._setFree(mx, my); }
    else if (this.tool === 'load')   { this._pushUndo(); this._startLoad(mx, my); }
    else if (this.tool === 'loadz')    { this._pushUndo(); this._toggleZLoad(mx, my); }
    else if (this.tool === 'distload') { this._pushUndo(); this._toggleDistLoad(mx, my); }
    else if (this.tool === 'delete')   { this._pushUndo(); this._deleteNearest(mx, my); }
    if (this.tool !== 'load') this.redraw();
  }

  _onMove(e) {
    const [mx, my] = this._pos(e);
    if (this.editMode) {
      if (this.editDragging) {
        const { bar_id, which } = this.editDragging;
        const { nx, ny, s, e: en } = this._editBarAxes(bar_id);
        const base = which === 'start' ? s : en;
        const proj = (mx - base[0]) * nx + (my - base[1]) * ny;
        const level = Math.max(-2, Math.min(2, Math.round(proj / 22)));
        this.manualSolution[bar_id][this.mode][which] = level;
      } else {
        this.canvas.style.cursor = this._editHitTest(mx, my) ? 'grab' : 'default';
      }
      this.redraw(); return;
    }
    this.hoverPos = [mx, my];
    this.hoverNode = this._nearestNode(mx, my, 22);
    if (this.tool === 'load' && this.activeLoadNodeId !== null) {
      this.previewLoadEnd = [this._snap(mx), this._snap(my)];
    }
    this.redraw();
  }

  _onRelease(e) {
    if (this.editMode) {
      if (this.editDragging) { this.editDragging = null; this.canvas.style.cursor = 'grab'; this.redraw(); }
      return;
    }
    if (this.tool !== 'load' || this.activeLoadNodeId === null) return;
    const [mx, my] = this._pos(e);
    this._finishLoad(mx, my);
    this.activeLoadNodeId = null;
    this.previewLoadEnd = null;
    this.redraw();
  }

  _addNode(x, y) {
    if (this._nearestNode(x, y, 18)) { this._setStatus('Hier liegt schon ein Knoten.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    this.nodes.push({ node_id: this.nextNodeId, x, y });
    this._clearResults();
    this._setStatus(`Knoten ${this.nextNodeId} gesetzt.`);
    this.nextNodeId++;
  }

  _handleMemberTool(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Für einen Stab zuerst einen Knoten anklicken.'); return; }
    if (this.activeMemberStart === null) {
      this.activeMemberStart = node.node_id;
      this._setStatus(`Startknoten ${node.node_id} gewählt. Zweiten Knoten anklicken.`);
      this.redraw(); return;
    }
    if (this.activeMemberStart === node.node_id) { this._setStatus('Start und Ende dürfen nicht derselbe Knoten sein.'); return; }
    const ids = new Set([this.activeMemberStart, node.node_id]);
    const exists = this.members.some(m => new Set([m.start_id, m.end_id]).size === ids.size &&
      [...ids].every(id => m.start_id === id || m.end_id === id));
    if (exists) { this._setStatus('Dieser Stab existiert schon.'); }
    else {
      this._pushUndo();
      const idx = this.members.length + 1;
      this.members.push({ bar_id: idx, start_id: this.activeMemberStart, end_id: node.node_id });
      this._clearResults();
      this._setStatus(`Stab ${this.activeMemberStart}-${node.node_id} gesetzt.`);
    }
    this.activeMemberStart = null;
  }

  _setSupport(mx, my, type) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Lager muss auf einen Knoten gesetzt werden.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    this.supports[node.node_id] = type;
    this.freeEnds.delete(node.node_id);
    this._clearResults();
    const labels = { pin: 'Festlager', roller: 'Loslager', fixed: 'Einspannung' };
    this._setStatus(`${labels[type]} an Knoten ${node.node_id} gesetzt.`);
  }

  _toggleWeld(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Verschweissung muss auf einen Knoten gesetzt werden.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    if (this.welds.has(node.node_id)) {
      this.welds.delete(node.node_id);
      this._setStatus(`Knoten ${node.node_id} ist jetzt ein Gelenk (überträgt kein Moment).`);
    } else {
      this.welds.add(node.node_id);
      this._setStatus(`Knoten ${node.node_id} ist jetzt verschweisst (biegesteif, überträgt Moment).`);
    }
    this._clearResults();
  }

  _setFree(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Freies Ende muss auf einen vorhandenen Knoten gesetzt werden.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    delete this.supports[node.node_id];
    this.freeEnds.add(node.node_id);
    this._clearResults();
    this._setStatus(`Knoten ${node.node_id} ist jetzt ein freies Ende.`);
  }

  _startLoad(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Last muss an einem vorhandenen Knoten starten.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    this.activeLoadNodeId = node.node_id;
    this.previewLoadEnd = [node.x, node.y + 48];
    this._setStatus('Ziehe vom Knoten in Richtung der Last.');
  }

  _finishLoad(mx, my) {
    if (this.activeLoadNodeId === null) return;
    const node = this._nodeById(this.activeLoadNodeId);
    const ex = this._snap(mx), ey = this._snap(my);
    let dx = ex - node.x, dy = ey - node.y;
    if (Math.hypot(dx, dy) < this.SNAP) { dx = 0; dy = 2 * this.SNAP; }
    const scale = 5.0 / this.SNAP;
    const fx = Math.round(dx * scale * 100) / 100;
    const fy = Math.round(dy * scale * 100) / 100;
    this.loads[node.node_id] = { node_id: node.node_id, fx, fy };
    this._clearResults();
    this._setStatus(`Last an Knoten ${node.node_id}: Fx=${fx} kN, Fy=${fy} kN.`);
  }

  _toggleZLoad(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Z-Last muss an einem vorhandenen Knoten gesetzt werden.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    const id = node.node_id;
    const existing = this.loadsZ[id];
    if (!existing) {
      this.loadsZ[id] = { node_id: id, fz: 1, direction: 'into' };
      this._setStatus(`Z-Last ⊗ (hinein) an Knoten ${id}.`);
    } else if (existing.direction === 'into') {
      this.loadsZ[id] = { node_id: id, fz: 1, direction: 'out' };
      this._setStatus(`Z-Last ⊙ (heraus) an Knoten ${id}.`);
    } else {
      delete this.loadsZ[id];
      this._setStatus(`Z-Last an Knoten ${id} entfernt.`);
    }
    this._clearResults();
  }

  _deleteNearest(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Kein Knoten in der Nähe.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    const id = node.node_id;
    this.nodes = this.nodes.filter(n => n.node_id !== id);
    for (const m of this.members) {
      if (m.start_id === id || m.end_id === id) delete this.distributedLoads[m.bar_id];
    }
    this.members = this.members.filter(m => m.start_id !== id && m.end_id !== id);
    delete this.supports[id];
    this.freeEnds.delete(id);
    this.welds.delete(id);
    delete this.loads[id];
    delete this.loadsZ[id];
    if (this.activeMemberStart === id) this.activeMemberStart = null;
    this._clearResults();
    this._setStatus(`Knoten ${id} gelöscht.`);
  }

  _nearestNode(x, y, maxDist = 20) {
    let best = null, bestD = maxDist;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= bestD) { best = n; bestD = d; }
    }
    return best;
  }

  _nodeById(id) { return this.nodes.find(n => n.node_id === id); }

  _barHitTest(mx, my, threshold = 14) {
    let best = null, bestD = threshold;
    for (const m of this.members) {
      const s = this._nodeById(m.start_id), e = this._nodeById(m.end_id);
      if (!s || !e) continue;
      const dx = e.x - s.x, dy = e.y - s.y, L2 = dx * dx + dy * dy;
      if (L2 < 1e-9) continue;
      const t = Math.max(0, Math.min(1, ((mx - s.x) * dx + (my - s.y) * dy) / L2));
      const d = Math.hypot(mx - (s.x + t * dx), my - (s.y + t * dy));
      if (d < bestD) { best = m; bestD = d; }
    }
    return best;
  }

  _toggleDistLoad(mx, my) {
    const bar = this._barHitTest(mx, my);
    if (!bar) { this._setStatus('Streckenlast: Näher an einen Stab klicken.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    if (this.distributedLoads[bar.bar_id]) {
      delete this.distributedLoads[bar.bar_id];
      this._setStatus(`Streckenlast von Stab ${bar.bar_id} entfernt.`);
    } else {
      this.distributedLoads[bar.bar_id] = { bar_id: bar.bar_id, q: 1 };
      this._setStatus(`Streckenlast (q ↓) an Stab ${bar.bar_id} gesetzt.`);
    }
    this._clearResults();
  }

  _clearResults() { this.memberForces = {}; this.beamResults = {}; this.reactions = {}; }

  clear() {
    this._pushUndo();
    this.nodes = []; this.members = []; this.supports = {};
    this.freeEnds = new Set(); this.welds = new Set(); this.loads = {}; this.loadsZ = {}; this.distributedLoads = {};
    this.memberForces = {}; this.beamResults = {}; this.reactions = {};
    this.nextNodeId = 1; this.activeMemberStart = null;
    this.activeLoadNodeId = null; this.previewLoadEnd = null;
    this._setStatus('Leere Zeichenfläche.'); this.redraw();
  }

  loadExample() {
    this._pushUndo();
    const w = this._cssW || this.canvas.width, h = this._cssH || this.canvas.height;
    const baseY = this._snap(h * 0.62);
    const left = this._snap(w * 0.27), mid = this._snap(w * 0.5), right = this._snap(w * 0.73);
    const topY = this._snap(h * 0.35);
    this.nodes = [
      { node_id: 1, x: left, y: baseY },
      { node_id: 2, x: mid,  y: topY  },
      { node_id: 3, x: right, y: baseY },
    ];
    this.members = [
      { bar_id: 1, start_id: 1, end_id: 2 },
      { bar_id: 2, start_id: 2, end_id: 3 },
      { bar_id: 3, start_id: 1, end_id: 3 },
    ];
    this.supports = { 1: 'pin', 3: 'roller' };
    this.freeEnds = new Set(); this.welds = new Set();
    this.loads = { 2: { node_id: 2, fx: 0, fy: 10 } };
    this.nextNodeId = 4;
    this.memberForces = {}; this.beamResults = {}; this.reactions = {};
    this._setStatus('Beispiel geladen. Klicke Berechnen für Stabkräfte.');
    this.redraw();
  }

  _isFrame() { return this.welds.size > 0; }

  validate() {
    const j = this.nodes.length, m = this.members.length;
    if (this._cantileverCase()) { this._setStatus('Kragträger erkannt: Berechnen ist möglich.'); return; }

    if (this._isFrame()) {
      // Frame formula: 3m + r = 3j + g
      // r: fixed=3, pin=2, roller=1
      // g: internal hinges — non-welded nodes connecting ≥2 members contribute (k−1) each
      const r = Object.values(this.supports).reduce((s, t) =>
        s + (t === 'fixed' ? 3 : t === 'pin' ? 2 : 1), 0);
      const barsAtNode = {};
      this.members.forEach(mb => {
        barsAtNode[mb.start_id] = (barsAtNode[mb.start_id] || 0) + 1;
        barsAtNode[mb.end_id]   = (barsAtNode[mb.end_id]   || 0) + 1;
      });
      let g = 0;
      for (const [nid, cnt] of Object.entries(barsAtNode)) {
        if (!this.welds.has(Number(nid)) && cnt >= 2) g += cnt - 1;
      }
      const left = 3 * m + r, right = 3 * j + g;
      if (j < 2) this._setStatus('Noch zu wenige Knoten.');
      else if (m === 0) this._setStatus('Noch keine Stäbe gesetzt.');
      else if (r < 3) this._setStatus('Noch nicht ausreichend gelagert.');
      else if (left === right) this._setStatus(`Rahmen: 3m+r = 3j+g = ${right} ✓ Berechnen möglich.`);
      else if (left < right) this._setStatus(`Rahmen: 3m+r=${left} < 3j+g=${right} → unterbestimmt.`);
      else this._setStatus(`Rahmen: 3m+r=${left} > 3j+g=${right} → überbestimmt.`);
    } else {
      // Truss formula: m + r = 2j
      const r = Object.values(this.supports).reduce((s, t) => s + (t === 'pin' || t === 'fixed' ? 2 : 1), 0);
      const left = m + r, right = 2 * j;
      if (j < 2) this._setStatus('Noch zu wenige Knoten.');
      else if (m === 0) this._setStatus('Noch keine Stäbe gesetzt.');
      else if (r < 3) this._setStatus('Noch nicht ausreichend gelagert.');
      else if (left === right) this._setStatus(`Fachwerk: m+r = 2j = ${right} ✓ Berechnen möglich.`);
      else if (left < right) this._setStatus('System wirkt unterbestimmt.');
      else this._setStatus('System wirkt überbestimmt.');
    }
  }

  async solve() {
    const cantilever = this._cantileverCase();
    if (cantilever) { this._solveCantilever(cantilever); return; }

    if (this._isFrame() || Object.keys(this.distributedLoads).length > 0) {
      await this._solveFrame();
    } else {
      await this._solveTruss();
    }
  }

  // Merges in-plane loads and z-loads (fz treated as fy — same sign pattern for planar structures)
  _allLoads() {
    const map = {};
    for (const l of Object.values(this.loads))
      map[l.node_id] = { joint_id: l.node_id, fx: l.fx, fy: l.fy };
    for (const lz of Object.values(this.loadsZ)) {
      const sign = lz.direction === 'into' ? 1 : -1;
      if (map[lz.node_id]) map[lz.node_id].fy += sign * lz.fz;
      else map[lz.node_id] = { joint_id: lz.node_id, fx: 0, fy: sign * lz.fz };
    }
    return Object.values(map);
  }

  async _solveTruss() {
    const body = {
      joints: this.nodes.map(n => ({ joint_id: n.node_id, x: n.x, y: n.y })),
      bars: this.members.map(m => ({ bar_id: m.bar_id, start_id: m.start_id, end_id: m.end_id })),
      loads: this._allLoads(),
      supports: Object.entries(this.supports).map(([id, t]) => ({ joint_id: Number(id), support_type: t })),
    };
    const resp = await fetch('/api/solve-truss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await resp.json();
    if (!result.ok) { this._setStatus('Nicht lösbar: ' + result.error); this._clearResults(); this.redraw(); return; }

    this.memberForces = {};
    for (const [k, v] of Object.entries(result.bar_forces)) this.memberForces[Number(k)] = v;
    this.reactions = result.reactions;
    this.beamResults = {};

    const tension     = Object.values(this.memberForces).filter(v => v >  1e-6).length;
    const compression = Object.values(this.memberForces).filter(v => v < -1e-6).length;
    this._setStatus(`Berechnet: ${tension} Zugstäbe, ${compression} Druckstäbe. Wähle N, Q oder M.`);
    this.redraw();
  }

  async _solveFrame() {
    const body = {
      joints:   this.nodes.map(n => ({ joint_id: n.node_id, x: n.x, y: n.y })),
      bars:     this.members.map(m => ({ bar_id: m.bar_id, start_id: m.start_id, end_id: m.end_id })),
      loads:    this._allLoads(),
      supports: Object.entries(this.supports).map(([id, t]) => ({ joint_id: Number(id), support_type: t })),
      welds:    [...this.welds],
      distributed_loads: Object.values(this.distributedLoads),
    };
    const resp = await fetch('/api/solve-frame', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await resp.json();
    if (!result.ok) { this._setStatus('Nicht lösbar: ' + result.error); this._clearResults(); this.redraw(); return; }

    this.memberForces = {};
    this.beamResults  = {};
    for (const [k, v] of Object.entries(result.bar_forces)) {
      const bid = Number(k);
      const bar = this.members.find(m => m.bar_id === bid);
      this.beamResults[bid] = { ...v, start_id: bar.start_id, end_id: bar.end_id };
    }
    this.reactions = result.reactions;
    this._setStatus('Rahmen berechnet. Wähle N, Q oder M.');
    this.redraw();
  }

  _cantileverCase() {
    if (this.members.length !== 1) return null;
    const mem = this.members[0];
    const start = this._nodeById(mem.start_id), end = this._nodeById(mem.end_id);
    const sFixed = this.supports[start.node_id] === 'fixed', eFree = this.freeEnds.has(end.node_id);
    const eFixed = this.supports[end.node_id] === 'fixed', sFree = this.freeEnds.has(start.node_id);
    let fixed, free;
    if (sFixed && eFree) { fixed = start; free = end; }
    else if (eFixed && sFree) { fixed = end; free = start; }
    else return null;
    if (!this.loads[free.node_id] || Object.keys(this.loads).length !== 1) return null;
    return { mem, fixed, free, load: this.loads[free.node_id] };
  }

  _solveCantilever({ mem, fixed, free, load }) {
    const dx = free.x - fixed.x, dy = free.y - fixed.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) { this._setStatus('Nicht lösbar: Länge 0.'); return; }
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    const normal = load.fx * ux + load.fy * uy;
    const shear  = load.fx * nx + load.fy * ny;
    // Auflagermoment (Reaktion gegen die Last) -- positives Vorzeichen entspricht
    // CCW-Reaktion am Einspannknoten.
    const reactionMz = shear * len / this.SNAP;
    // Inneres Biegemoment M an der Einspannung hat das umgekehrte Vorzeichen
    // (Konvention: M+ = Zug auf der "unteren" Faser bzw. +n-Seite des Stabes).
    // Beim Kragträger mit Last am freien Ende ist die Zugfaser auf der Lastseite
    // gegenüber -> M ist negativ.
    const moment = -reactionMz;
    this.memberForces = {};
    this.beamResults = { [mem.bar_id]: { fixed_id: fixed.node_id, free_id: free.node_id, normal, shear, moment } };
    this.reactions = {
      [`rx:${fixed.node_id}`]: -load.fx,
      [`ry:${fixed.node_id}`]: -load.fy,
      [`mz:${fixed.node_id}`]: reactionMz,
    };
    this._setStatus('Kragträger berechnet: N/Q/M sind jetzt verfügbar.');
    this.redraw();
  }

  // ===== DRAWING =====

  redraw() {
    const w = this._cssW || this.canvas.width, h = this._cssH || this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this._drawGrid(w, h);
    this._drawCoordSystem(44, h - 130);

    // Hover halo on nearest node
    if (this.hoverNode && this.tool !== 'node') {
      ctx.fillStyle = TB.hoverHalo;
      ctx.beginPath(); ctx.arc(this.hoverNode.x, this.hoverNode.y, 18, 0, Math.PI * 2); ctx.fill();
    }
    // Ghost preview for placing nodes
    if (this.tool === 'node' && this.hoverPos) {
      const gx = this._snap(this.hoverPos[0]), gy = this._snap(this.hoverPos[1]);
      ctx.strokeStyle = 'rgba(47,111,237,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(gx, gy, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
    // Preview line for member tool
    if (this.tool === 'member' && this.activeMemberStart !== null && this.hoverPos) {
      const s = this._nodeById(this.activeMemberStart);
      ctx.strokeStyle = TB.blue; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(this.hoverPos[0], this.hoverPos[1]); ctx.stroke();
      ctx.setLineDash([]);
    }

    for (let i = 0; i < this.members.length; i++) {
      const mem = this.members[i];
      const s = this._nodeById(mem.start_id), e = this._nodeById(mem.end_id);
      ctx.strokeStyle = TB.beam; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      const br = this.beamResults[mem.bar_id];
      const nf = this.memberForces[mem.bar_id];
      if (br) this._drawBeamResponse(s, e, br);
      else if (nf !== undefined) this._drawMemberResponse(s, e, nf);
    }

    for (const [id, type] of Object.entries(this.supports)) {
      const n = this._nodeById(Number(id));
      if (n) this._drawSupport(n.x, n.y, type);
    }
    for (const id of this.freeEnds) {
      const n = this._nodeById(id);
      if (n) this._drawFreeEnd(n.x, n.y);
    }
    for (const load of Object.values(this.loads)) {
      const n = this._nodeById(load.node_id);
      if (n) this._drawLoad(n.x, n.y, load.fx, load.fy);
    }
    for (const lz of Object.values(this.loadsZ)) {
      const n = this._nodeById(lz.node_id);
      if (n) this._drawZLoad(n.x, n.y, lz.direction);
    }
    for (const dl of Object.values(this.distributedLoads)) {
      const bar = this.members.find(m => m.bar_id === dl.bar_id);
      if (!bar) continue;
      const s = this._nodeById(bar.start_id), e = this._nodeById(bar.end_id);
      if (s && e) this._drawDistributedLoad(s.x, s.y, e.x, e.y);
    }
    this._drawReactions();
    this._drawEditOverlay();

    if (this.activeLoadNodeId !== null && this.previewLoadEnd) {
      const n = this._nodeById(this.activeLoadNodeId);
      ctx.strokeStyle = TB.orange; ctx.fillStyle = TB.orange; ctx.lineWidth = 3;
      this._arrow(n.x, n.y, this.previewLoadEnd[0], this.previewLoadEnd[1]);
    }

    for (const n of this.nodes) {
      const isWeld = this.welds.has(n.node_id);
      const isActive = n.node_id === this.activeMemberStart;
      if (isWeld) {
        ctx.fillStyle = isActive ? TB.blue : TB.beam;
        ctx.strokeStyle = TB.beam; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.rect(n.x - 7, n.y - 7, 14, 14); ctx.fill(); ctx.stroke();
      } else {
        const fill = isActive ? TB.blue : TB.paper;
        ctx.strokeStyle = TB.blue; ctx.fillStyle = fill; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(n.x, n.y, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = TB.muted; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(String(n.node_id), n.x, n.y - 16); ctx.textAlign = 'left';
    }
  }

  _drawGrid(w, h) {
    const ctx = this.ctx, minor = this.SNAP, major = minor * 4;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w + minor; x += minor) {
      ctx.strokeStyle = (x % major === 0) ? TB.gridMajor : TB.gridMinor;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h + minor; y += minor) {
      ctx.strokeStyle = (y % major === 0) ? TB.gridMajor : TB.gridMinor;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  _drawCoordSystem(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = TB.text; ctx.fillStyle = TB.text; ctx.lineWidth = 3;
    this._arrow(x, y, x + 72, y);
    this._arrow(x, y, x, y + 72);
    ctx.font = 'bold 13px Helvetica';
    ctx.fillText('x', x + 80, y + 5);
    ctx.fillText('y', x - 5, y + 90);
  }

  _drawSupport(x, y, type) {
    const ctx = this.ctx;
    if (type === 'fixed') {
      const wx = x - 20;
      ctx.strokeStyle = TB.blue; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(wx, y - 44); ctx.lineTo(wx, y + 44); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(x + 12, y); ctx.stroke();
      ctx.lineWidth = 2;
      for (let off = -42; off <= 48; off += 12) {
        ctx.beginPath(); ctx.moveTo(wx - 18, y + off + 10); ctx.lineTo(wx, y + off); ctx.stroke();
      }
      return;
    }
    const pts = [x, y + 10, x - 17, y + 40, x + 17, y + 40];
    ctx.strokeStyle = TB.blue; ctx.fillStyle = '#E8F0FF'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (type === 'roller') {
      ctx.beginPath(); ctx.arc(x - 9, y + 47, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 9, y + 47, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 24, y + 55); ctx.lineTo(x + 24, y + 55); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x - 23, y + 43); ctx.lineTo(x + 23, y + 43); ctx.stroke();
    }
  }

  _drawFreeEnd(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = TB.muted; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 12, y - 16); ctx.lineTo(x + 12, y - 16); ctx.stroke();
    ctx.fillStyle = TB.muted; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText('frei', x, y - 28); ctx.textAlign = 'left';
  }

  _drawLoad(x, y, fx, fy) {
    const ctx = this.ctx;
    const scale = this.SNAP / 5.0;
    const ex = x + fx * scale, ey = y + fy * scale;
    ctx.strokeStyle = TB.load; ctx.fillStyle = TB.load; ctx.lineWidth = 3;
    this._arrow(x, y, ex, ey);
    ctx.font = 'bold 11px Helvetica';
    ctx.fillText(`(${fx}, ${fy}) kN`, (x + ex) / 2 + 10, (y + ey) / 2 - 10);
  }

  _drawZLoad(x, y, direction) {
    const ctx = this.ctx;
    const r = 13, cx = x + 20, cy = y - 20;
    ctx.strokeStyle = TB.load; ctx.fillStyle = TB.paper; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2.5;
    if (direction === 'into') {
      ctx.strokeStyle = TB.load;
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r * 0.6); ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
      ctx.moveTo(cx + r * 0.6, cy - r * 0.6); ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
      ctx.stroke();
    } else {
      ctx.fillStyle = TB.load;
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = TB.load; ctx.font = 'bold 10px Helvetica';
    ctx.fillText(direction === 'into' ? '⊗ Z' : '⊙ Z', cx + r + 4, cy + 4);
    ctx.strokeStyle = TB.load; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx - r * 0.7, cy + r * 0.7); ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawDistributedLoad(x1, y1, x2, y2) {
    const ctx = this.ctx;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = -dy / len, ny = dx / len;  // CCW 90° normal
    const off = 28;
    // offset line (on the -normal side = "above" for horizontal bars going right)
    const ax = nx * (-off), ay = ny * (-off);
    ctx.strokeStyle = TB.load; ctx.fillStyle = TB.load; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1 + ax, y1 + ay); ctx.lineTo(x2 + ax, y2 + ay); ctx.stroke();
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const px = x1 + (x2 - x1) * t + ax, py = y1 + (y2 - y1) * t + ay;
      const qx = x1 + (x2 - x1) * t,      qy = y1 + (y2 - y1) * t;
      this._arrow(px, py, qx - nx * 4, qy - ny * 4);
    }
    ctx.fillStyle = TB.load; ctx.font = 'bold 11px Helvetica';
    ctx.fillText('q', (x1 + x2) / 2 + nx * (-off - 12), (y1 + y2) / 2 + ny * (-off - 12));
  }

  _drawReactions() {
    for (const [name, value] of Object.entries(this.reactions)) {
      const [axis, rawId] = name.split(':');
      const n = this._nodeById(Number(rawId));
      if (!n) continue;
      if (axis === 'mz') { this._drawMomentReaction(n.x, n.y, value); continue; }
      const fx = axis === 'rx' ? value : 0;
      const fy = axis === 'ry' ? value : 0;
      if (Math.abs(fx) < 1e-6 && Math.abs(fy) < 1e-6) continue;
      const scale = this.SNAP / 5.0;
      const ex = n.x + fx * scale, ey = n.y + fy * scale;
      const ctx = this.ctx;
      ctx.strokeStyle = TB.blue; ctx.fillStyle = TB.blue; ctx.lineWidth = 3;
      this._arrow(n.x, n.y, ex, ey);
      ctx.font = 'bold 10px Helvetica';
      ctx.fillText(`${axis.toUpperCase()}=${value >= 0 ? '+' : ''}${value.toFixed(2)}`, ex + 8, ey);
    }
  }

  _drawMomentReaction(x, y, value) {
    const ctx = this.ctx;
    ctx.strokeStyle = TB.red; ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 42, 0.44, value >= 0 ? 4.80 : -0.80, value < 0);
    ctx.stroke();
    ctx.fillStyle = TB.red; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText(`MZ=${value >= 0 ? '+' : ''}${value.toFixed(2)}`, x, y - 54); ctx.textAlign = 'left';
  }

  _drawMemberResponse(s, e, force) {
    if (this.mode === 'M' || this.mode === 'Q') { this._drawZeroResponse(s, e, this.mode); return; }
    if (Math.abs(force) < 1e-6) { this._drawZeroResponse(s, e, 'N'); return; }
    const dx = e.x - s.x, dy = e.y - s.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = -dy / len, ny = dx / len;
    const sign = force > 0 ? 1 : -1;
    const off = sign * Math.min(62, 18 + Math.abs(force) * 3);
    const sx = s.x + nx * off, sy = s.y + ny * off;
    const ex = e.x + nx * off, ey = e.y + ny * off;
    const fill = force > 0 ? '#E4F4EA' : '#FFF0DF';
    const outline = force > 0 ? TB.green : TB.orange;
    const ctx = this.ctx;
    ctx.fillStyle = fill; ctx.strokeStyle = outline; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    this._responseLabel((s.x + e.x + sx + ex) / 4, (s.y + e.y + sy + ey) / 4, force > 0 ? '+' : '-', outline);
    this._valueLabel((sx + ex) / 2, (sy + ey) / 2, `N=${force >= 0 ? '+' : ''}${force.toFixed(2)}`, outline);
  }

  _drawBeamResponse(s, e, br) {
    if ('N_start' in br) {
      // General frame result with start/end values
      if (this.mode === 'N') this._drawLinearResponse(s, e, br.N_start, br.N_end, 'N');
      else if (this.mode === 'Q') this._drawLinearResponse(s, e, br.Q_start, br.Q_end, 'Q');
      else this._drawLinearResponse(s, e, br.M_start, br.M_end, 'M');
    } else {
      // Cantilever fallback
      if (this.mode === 'N') this._drawConstantBeamResponse(s, e, br.normal, 'N');
      else if (this.mode === 'Q') this._drawConstantBeamResponse(s, e, br.shear, 'Q');
      else this._drawMomentBeamResponse(s, e, br.moment);
    }
  }

  _drawLinearResponse(s, e, v_start, v_end, mode) {
    const colors = { N: TB.green, Q: TB.purple, M: TB.red };
    const fills  = { N: { pos: '#E4F4EA', neg: '#FFF0DF' }, Q: { pos: '#F0EAFE', neg: '#F0EAFE' }, M: { pos: '#FDECEC', neg: '#FDECEC' } };
    const color  = colors[mode];

    if (Math.abs(v_start) < 1e-6 && Math.abs(v_end) < 1e-6) { this._drawZeroResponse(s, e, mode); return; }

    const dx = e.x - s.x, dy = e.y - s.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = -dy / len, ny = dx / len;

    const maxAbs = Math.max(Math.abs(v_start), Math.abs(v_end));
    const scale  = Math.min(68, 20 + maxAbs * 2.5) / maxAbs;
    const sx = s.x + nx * v_start * scale, sy = s.y + ny * v_start * scale;
    const ex = e.x + nx * v_end   * scale, ey = e.y + ny * v_end   * scale;

    const dominant = Math.abs(v_start) >= Math.abs(v_end) ? v_start : v_end;
    const fill = mode === 'M' ? fills.M.pos : (dominant >= 0 ? fills[mode].pos : fills[mode].neg);

    const ctx = this.ctx;
    ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();

    const mid = (v_start + v_end) / 2;
    this._responseLabel((s.x + e.x + sx + ex) / 4, (s.y + e.y + sy + ey) / 4, mid >= 0 ? '+' : '-', color);
    this._valueLabel(sx, sy, `${mode}=${v_start >= 0 ? '+' : ''}${v_start.toFixed(2)}`, color);
    if (Math.abs(v_end - v_start) > 0.05) {
      this._valueLabel(ex, ey, `${mode}=${v_end >= 0 ? '+' : ''}${v_end.toFixed(2)}`, color);
    }
  }

  _drawConstantBeamResponse(s, e, value, mode) {
    if (Math.abs(value) < 1e-6) { this._drawZeroResponse(s, e, mode); return; }
    const colors = { N: TB.green, Q: TB.purple };
    let color = colors[mode], fill = mode === 'N' ? '#E4F4EA' : '#F0EAFE';
    if (mode === 'N' && value < 0) { fill = '#FFF0DF'; color = TB.orange; }
    const [sx, sy, ex, ey] = this._offsetLine(s, e, value);
    const ctx = this.ctx;
    ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    this._responseLabel((s.x + e.x + sx + ex) / 4, (s.y + e.y + sy + ey) / 4, value > 0 ? '+' : '-', color);
    this._valueLabel((sx + ex) / 2, (sy + ey) / 2, `${mode}=${value >= 0 ? '+' : ''}${value.toFixed(2)}`, color);
  }

  _drawMomentBeamResponse(s, e, value) {
    if (Math.abs(value) < 1e-6) { this._drawZeroResponse(s, e, 'M'); return; }
    const [sx, sy] = this._offsetLine(s, e, value);
    const ctx = this.ctx;
    ctx.fillStyle = '#FDECEC'; ctx.strokeStyle = TB.red; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.lineTo(sx, sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(e.x, e.y); ctx.stroke();
    this._responseLabel((s.x + e.x + sx) / 3, (s.y + e.y + sy) / 3, value > 0 ? '+' : '-', TB.red);
    this._valueLabel(sx, sy, `M=${value >= 0 ? '+' : ''}${value.toFixed(2)}`, TB.red);
  }

  _offsetLine(s, e, value) {
    const dx = e.x - s.x, dy = e.y - s.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return [s.x, s.y, e.x, e.y];
    const nx = -dy / len, ny = dx / len;
    const sign = value > 0 ? 1 : -1;
    const off = sign * Math.min(72, 22 + Math.abs(value) * 2.6);
    return [s.x + nx * off, s.y + ny * off, e.x + nx * off, e.y + ny * off];
  }

  _drawZeroResponse(s, e, mode) {
    const colors = { M: TB.red, Q: TB.purple, N: TB.green };
    const ctx = this.ctx;
    ctx.strokeStyle = colors[mode]; ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(e.x, e.y); ctx.stroke();
    ctx.setLineDash([]);
    this._valueLabel((s.x + e.x) / 2, (s.y + e.y) / 2 - 20, `${mode}=0`, colors[mode]);
  }

  _responseLabel(x, y, text, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.fillStyle = TB.paper; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 15px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 6); ctx.textAlign = 'left';
  }

  _valueLabel(x, y, text, color) {
    const ctx = this.ctx;
    ctx.fillStyle = TB.paper; ctx.strokeStyle = TB.border; ctx.lineWidth = 1;
    ctx.fillRect(x - 44, y - 13, 88, 26);
    ctx.strokeRect(x - 44, y - 13, 88, 26);
    ctx.fillStyle = color; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4); ctx.textAlign = 'left';
  }

  _arrow(x1, y1, x2, y2) {
    const ctx = this.ctx;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * 14 + nx * 6, y2 - uy * 14 + ny * 6);
    ctx.lineTo(x2 - ux * 14 - nx * 6, y2 - uy * 14 - ny * 6);
    ctx.closePath(); ctx.fill();
  }

  // ===== MANUAL SOLUTION EDIT =====

  toggleEditMode() {
    if (!this.members.length) { this._setStatus('Erst Struktur bauen.'); return; }
    this.editMode = !this.editMode;
    if (this.editMode) {
      // Init manualSolution for every bar that has no entry yet
      for (const m of this.members) {
        if (!this.manualSolution[m.bar_id]) {
          this.manualSolution[m.bar_id] = {
            N: { start: 0, end: 0 },
            Q: { start: 0, end: 0 },
            M: { start: 0, end: 0 },
          };
        }
      }
      this.canvas.style.cursor = 'grab';
      this._setStatus('Beanspruchung bearbeiten: Handles ziehen. N/Q/M wechseln mit den Buttons.');
    } else {
      this.canvas.style.cursor = 'crosshair';
      this._setStatus('Bearbeitungsmodus verlassen.');
    }
    document.getElementById('btn-edit-solution').classList.toggle('btn-mode-active', this.editMode);
    this.redraw();
  }

  _editBarAxes(bar_id) {
    const m = this.members.find(mb => mb.bar_id === bar_id);
    const s = this._nodeById(m.start_id), e = this._nodeById(m.end_id);
    const dx = e.x - s.x, dy = e.y - s.y;
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;
    return { s: [s.x, s.y], e: [e.x, e.y], nx, ny, len };
  }

  _editHandlePos(bar_id, which) {
    const { s, e, nx, ny } = this._editBarAxes(bar_id);
    const val = this.manualSolution[bar_id][this.mode][which];
    const base = which === 'start' ? s : e;
    return [base[0] + nx * val * 22, base[1] + ny * val * 22];
  }

  _editHitTest(mx, my) {
    if (!this.editMode) return null;
    for (const m of this.members) {
      for (const which of ['start', 'end']) {
        const [px, py] = this._editHandlePos(m.bar_id, which);
        if (Math.hypot(px - mx, py - my) < 15) return { bar_id: m.bar_id, which };
      }
    }
    return null;
  }

  _drawEditOverlay() {
    if (!this.editMode) return;
    const colors = { N: TB.green, Q: TB.purple, M: TB.red };
    const color = colors[this.mode];
    const ctx = this.ctx;

    for (const m of this.members) {
      const ms = this.manualSolution[m.bar_id];
      if (!ms) continue;
      const { s, e, nx, ny } = this._editBarAxes(m.bar_id);
      const vs = ms[this.mode].start, ve = ms[this.mode].end;
      const STEP = 22;
      const sx = s[0] + nx * vs * STEP, sy = s[1] + ny * vs * STEP;
      const ex = e[0] + nx * ve * STEP, ey = e[1] + ny * ve * STEP;

      ctx.fillStyle = color + '28'; ctx.strokeStyle = color; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();

      // Handles
      for (const which of ['start', 'end']) {
        const [px, py] = this._editHandlePos(m.bar_id, which);
        const val = ms[this.mode][which];
        const fill = val === 0 ? TB.paper : (val > 0 ? TB.green : TB.orange);
        ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (val !== 0) {
          ctx.fillStyle = '#fff'; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
          ctx.fillText(val > 0 ? '+' : '−', px, py + 4); ctx.textAlign = 'left';
        }
      }
    }

    // Banner
    ctx.fillStyle = 'rgba(47,111,237,0.10)';
    ctx.fillRect(0, 0, this._cssW, 28);
    ctx.fillStyle = TB.blue; ctx.font = 'bold 12px Helvetica';
    ctx.fillText(`✏ Beanspruchung bearbeiten — ${this.mode}  (Handles ziehen, ±2 Stufen)`, 12, 18);
  }

  // ===== EXPORT TO COLLECTION =====

  _fixtureSignStr(v) {
    return Math.abs(v) < 0.001 ? '0' : v > 0 ? '1' : '-1';
  }

  _triggerDownload(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  exportToCollection() {
    const hasTruss  = Object.keys(this.memberForces).length > 0;
    const hasBeam   = Object.keys(this.beamResults).length > 0;
    const hasManual = Object.keys(this.manualSolution).length > 0;
    if (!hasTruss && !hasBeam && !hasManual) {
      alert('Bitte erst "Berechnen" klicken oder Beanspruchung manuell einzeichnen!');
      return;
    }

    const SNAP = this.SNAP;
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

    // Knoten sortiert nach node_id → Labels A, B, C, ...
    const sortedNodes = [...this.nodes].sort((a, b) => a.node_id - b.node_id);
    const nodeLabels = {};
    sortedNodes.forEach((n, i) => { nodeLabels[n.node_id] = letters[i] || `N${i}`; });

    // Koordinaten in Grid-Einheiten, y-Achse flippen
    const canvasYs = sortedNodes.map(n => n.y);
    const maxCanvasY = Math.max(...canvasYs);
    const rawCoords = {};
    sortedNodes.forEach(n => {
      rawCoords[n.node_id] = { x: n.x / SNAP, y: (maxCanvasY - n.y) / SNAP };
    });
    const minX = Math.min(...Object.values(rawCoords).map(c => c.x));
    const minY = Math.min(...Object.values(rawCoords).map(c => c.y));

    const nodes = {};
    sortedNodes.forEach(n => {
      const label = nodeLabels[n.node_id];
      nodes[label] = {
        x: Math.round((rawCoords[n.node_id].x - minX) * 100) / 100,
        y: Math.round((rawCoords[n.node_id].y - minY) * 100) / 100,
      };
    });

    // Bars
    const bars = this.members.map(m => ({
      id: nodeLabels[m.start_id] + nodeLabels[m.end_id],
      from: nodeLabels[m.start_id],
      to: nodeLabels[m.end_id],
    }));

    // Supports
    const supports = {};
    for (const [nid, type] of Object.entries(this.supports)) {
      supports[nodeLabels[Number(nid)]] = type;
    }

    // Welds + freeEnds
    const welds = [...this.welds].map(nid => nodeLabels[nid]).filter(Boolean);
    const freeEnds = [...this.freeEnds].map(nid => nodeLabels[nid]).filter(Boolean);

    // Loads
    const loads = Object.values(this.loads).map(l => ({
      kind: 'point',
      node: nodeLabels[l.node_id],
      fx: Math.round(l.fx * 1000) / 1000,
      fy: Math.round(l.fy * 1000) / 1000,
      label: 'F',
    }));
    for (const lz of Object.values(this.loadsZ)) {
      loads.push({
        kind: 'z',
        node: nodeLabels[lz.node_id],
        fz: lz.fz,
        direction: lz.direction,
        label: 'P',
      });
    }

    // Solutions
    const ss = this._fixtureSignStr.bind(this);
    const N_sol = {}, Q_sol = {}, M_sol = {};

    for (const bar of bars) {
      const m = this.members.find(mb =>
        nodeLabels[mb.start_id] + nodeLabels[mb.end_id] === bar.id);

      const ms = this.manualSolution[m.bar_id];
      if (ms) {
        // Manual solution takes priority
        const sgn = v => v > 0 ? '1' : v < 0 ? '-1' : '0';
        N_sol[bar.id] = `${sgn(ms.N.start)},${sgn(ms.N.end)}`;
        Q_sol[bar.id] = `${sgn(ms.Q.start)},${sgn(ms.Q.end)}`;
        M_sol[bar.id] = `${sgn(ms.M.start)},${sgn(ms.M.end)}`;
      } else if (hasTruss) {
        const f = this.memberForces[m.bar_id] ?? 0;
        const s = ss(f);
        N_sol[bar.id] = `${s},${s}`; Q_sol[bar.id] = '0,0'; M_sol[bar.id] = '0,0';
      } else {
        const br = this.beamResults[m.bar_id];
        if (!br) { N_sol[bar.id] = '0,0'; Q_sol[bar.id] = '0,0'; M_sol[bar.id] = '0,0'; continue; }
        if ('N_start' in br) {
          N_sol[bar.id] = `${ss(br.N_start)},${ss(br.N_end)}`;
          Q_sol[bar.id] = `${ss(br.Q_start)},${ss(br.Q_end)}`;
          M_sol[bar.id] = `${ss(br.M_start)},${ss(br.M_end)}`;
        } else {
          const nS = ss(br.normal); N_sol[bar.id] = `${nS},${nS}`;
          const qS = ss(br.shear);  Q_sol[bar.id] = `${qS},${qS}`;
          const fromIsFixed = m.start_id === br.fixed_id;
          const mFixed = ss(br.moment);
          M_sol[bar.id] = fromIsFixed ? `${mFixed},0` : `0,${mFixed}`;
        }
      }
    }

    // BBox
    const xs = Object.values(nodes).map(n => n.x);
    const ys = Object.values(nodes).map(n => n.y);
    const bbox = {
      w: Math.max(...xs) + 2,
      h: Math.max(...ys) + 2,
    };

    const title = prompt('Titel der Aufgabe (z.B. "Dachfachwerk HS 2022"):') ?? '';
    if (title === null) return; // Abbrechen
    const source = prompt('Quelle (z.B. "Prüfung HS 2022, Aufgabe 3"):') ?? '';

    const fixture = {
      id: `custom_${Date.now()}`,
      title: title || 'Eigenes Fachwerk',
      source: source || undefined,
      bbox,
      nodes,
      bars,
      supports,
      ...(welds.length > 0 ? { welds } : {}),
      ...(freeEnds.length > 0 ? { freeEnds } : {}),
      loads,
      solutions: { N: N_sol, Q: Q_sol, M: M_sol },
    };

    const col = JSON.parse(localStorage.getItem('examCollection') || '[]');
    col.push(fixture);
    localStorage.setItem('examCollection', JSON.stringify(col));

    this._triggerDownload(fixture, `fixture_${fixture.id}.json`);
    this._setStatus(`"${fixture.title}" zur Sammlung hinzugefügt (${col.length} total).`);
  }

  downloadCollection() {
    const col = JSON.parse(localStorage.getItem('examCollection') || '[]');
    if (!col.length) { alert('Sammlung ist leer – erst "Zur Sammlung hinzufügen" klicken.'); return; }
    this._triggerDownload(col, 'exam_collection.json');
    this._setStatus(`${col.length} Fixture(s) heruntergeladen.`);
  }
}
