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
      ['delete', 'Löschen',       'Klick auf einen Knoten löscht ihn + alle anhängenden Stäbe.'],
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
    const x = this._snap(mx), y = this._snap(my);
    if (this.tool === 'node')        { this._pushUndo(); this._addNode(x, y); }
    else if (this.tool === 'member') { this._handleMemberTool(mx, my); }
    else if (['pin','roller','fixed'].includes(this.tool)) { this._pushUndo(); this._setSupport(mx, my, this.tool); }
    else if (this.tool === 'weld')   { this._pushUndo(); this._toggleWeld(mx, my); }
    else if (this.tool === 'free')   { this._pushUndo(); this._setFree(mx, my); }
    else if (this.tool === 'load')   { this._pushUndo(); this._startLoad(mx, my); }
    else if (this.tool === 'delete') { this._pushUndo(); this._deleteNearest(mx, my); }
    if (this.tool !== 'load') this.redraw();
  }

  _onMove(e) {
    const [mx, my] = this._pos(e);
    this.hoverPos = [mx, my];
    this.hoverNode = this._nearestNode(mx, my, 22);
    if (this.tool === 'load' && this.activeLoadNodeId !== null) {
      this.previewLoadEnd = [this._snap(mx), this._snap(my)];
    }
    this.redraw();
  }

  _onRelease(e) {
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

  _deleteNearest(mx, my) {
    const node = this._nearestNode(mx, my);
    if (!node) { this._setStatus('Kein Knoten in der Nähe.'); this.undoStack.pop(); this._updateHistoryButtons(); return; }
    const id = node.node_id;
    this.nodes = this.nodes.filter(n => n.node_id !== id);
    this.members = this.members.filter(m => m.start_id !== id && m.end_id !== id);
    delete this.supports[id];
    this.freeEnds.delete(id);
    this.welds.delete(id);
    delete this.loads[id];
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

  _clearResults() { this.memberForces = {}; this.beamResults = {}; this.reactions = {}; }

  clear() {
    this._pushUndo();
    this.nodes = []; this.members = []; this.supports = {};
    this.freeEnds = new Set(); this.welds = new Set(); this.loads = {};
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

  validate() {
    const j = this.nodes.length, m = this.members.length;
    if (this._cantileverCase()) { this._setStatus('Kragträger erkannt: Berechnen ist möglich.'); return; }
    const r = Object.values(this.supports).reduce((s, t) => s + (t === 'pin' || t === 'fixed' ? 2 : 1), 0);
    const left = m + r, right = 2 * j;
    if (j < 2) this._setStatus('Noch zu wenige Knoten.');
    else if (m === 0) this._setStatus('Noch keine Stäbe gesetzt.');
    else if (r < 3) this._setStatus('Noch nicht ausreichend gelagert.');
    else if (left === right) this._setStatus('Zählkriterium erfüllt: m + r = 2j.');
    else if (left < right) this._setStatus('System wirkt unterbestimmt.');
    else this._setStatus('System wirkt überbestimmt.');
  }

  async solve() {
    const cantilever = this._cantileverCase();
    if (cantilever) { this._solveCantilever(cantilever); return; }

    const body = {
      joints: this.nodes.map(n => ({ joint_id: n.node_id, x: n.x, y: n.y })),
      bars: this.members.map(m => ({ bar_id: m.bar_id, start_id: m.start_id, end_id: m.end_id })),
      loads: Object.values(this.loads).map(l => ({ joint_id: l.node_id, fx: l.fx, fy: l.fy })),
      supports: Object.entries(this.supports).map(([id, t]) => ({ joint_id: Number(id), support_type: t })),
    };

    const resp = await fetch('/api/solve-truss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await resp.json();
    if (!result.ok) { this._setStatus('Nicht lösbar: ' + result.error); this._clearResults(); this.redraw(); return; }

    this.memberForces = {};
    for (const [k, v] of Object.entries(result.bar_forces)) this.memberForces[Number(k)] = v;
    this.reactions = result.reactions;
    this.beamResults = {};

    const tension = Object.values(this.memberForces).filter(v => v > 1e-6).length;
    const compression = Object.values(this.memberForces).filter(v => v < -1e-6).length;
    this._setStatus(`Berechnet: ${tension} Zugstäbe, ${compression} Druckstäbe. Wähle N, Q oder M.`);
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
    this._drawReactions();

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
    if (this.mode === 'N') this._drawConstantBeamResponse(s, e, br.normal, 'N');
    else if (this.mode === 'Q') this._drawConstantBeamResponse(s, e, br.shear, 'Q');
    else this._drawMomentBeamResponse(s, e, br.moment);
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
}
