'use strict';

const FC = {
  paper: '#FBFDFF', text: '#172033', muted: '#617089', border: '#D8E0EA',
  gridMinor: '#DDECF8', gridMajor: '#C7DFF0',
  blue: '#2F6FED', green: '#2E9D62', purple: '#7C5CE0',
  red: '#D9534F', orange: '#D98634', beam: '#263447', load: '#D9534F',
};

const LEVEL_STEP = 22;   // pixels per "level" of value
const MAX_LEVEL = 2;     // values snap to {-2,-1,0,1,2}
const HANDLE_RADIUS = 9;

class FrameChallenge {
  constructor(canvas, wrap, mode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = wrap;
    this.mode = mode;
    this.fixture = null;
    this.kind = 'M';
    this.scale = 1;
    this.origin = [0, 0];
    this.pixelNodes = {};
    this.answers = {};        // barId -> {start: level, end: level}
    this.results = null;      // barId -> bool (after check)
    this.points = 0;
    this.streak = 0;
    this.challengeNumber = 1;
    this.dragging = null;     // {barId, which: 'start'|'end'}
    this.hovering = null;
    this.showSolution = false;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onResize = this._onResize.bind(this);
    canvas.addEventListener('mousedown', this._onDown);
    canvas.addEventListener('mousemove', this._onMove);
    canvas.addEventListener('mouseup', this._onUp);
    canvas.addEventListener('mouseleave', this._onUp);
    window.addEventListener('resize', this._onResize);
    canvas.style.cursor = 'pointer';
  }

  destroy() {
    this.canvas.removeEventListener('mousedown', this._onDown);
    this.canvas.removeEventListener('mousemove', this._onMove);
    this.canvas.removeEventListener('mouseup', this._onUp);
    this.canvas.removeEventListener('mouseleave', this._onUp);
    window.removeEventListener('resize', this._onResize);
    const bar = document.getElementById('game-kind-filter');
    if (bar) bar.style.display = 'none';
  }

  start() {
    document.getElementById('game-mode-title').textContent = 'Fachwerk Profi — Zeichnen';
    document.getElementById('game-timer').style.display = 'none';
    this.kindFilter = 'mix';
    this._setupActions();
    this._setupKindFilter();
    this._resize();
    this.loadChallenge();
  }

  _setupKindFilter() {
    const bar = document.getElementById('game-kind-filter');
    if (!bar) return;
    bar.style.display = '';
    bar.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.k === this.kindFilter);
      b.onclick = () => {
        this.kindFilter = b.dataset.k;
        bar.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        this.loadChallenge();
      };
    });
  }

  _setupActions() {
    const bb = document.querySelector('#game-view .bottombar');
    bb.innerHTML = `
      <button class="btn-back" id="fc-solution">Lösung zeigen</button>
      <button class="btn-back" id="fc-clear">Zurücksetzen</button>
      <button class="btn-accent" id="fc-check" style="background:#7C5CE0">Prüfen</button>
      <button class="btn-accent" id="fc-next">Neue Aufgabe</button>
    `;
    document.getElementById('fc-check').onclick = () => this.checkAll();
    document.getElementById('fc-clear').onclick = () => this.clearAnswers();
    document.getElementById('fc-solution').onclick = () => { this.showSolution = !this.showSolution; this.draw(); };
    document.getElementById('fc-next').onclick = () => this.nextChallenge();
  }

  loadChallenge() {
    const fixes = window.FRAME_FIXTURES;
    this.fixture = fixes[Math.floor(Math.random() * fixes.length)];
    if (this.kindFilter && this.kindFilter !== 'mix') {
      this.kind = this.kindFilter;
    } else {
      const kinds = ['N', 'Q', 'M'];
      this.kind = kinds[Math.floor(Math.random() * 3)];
    }
    this.answers = {};
    for (const bar of this.fixture.bars) this.answers[bar.id] = { start: 0, end: 0 };
    this.results = null;
    this.showSolution = false;
    this._updateStatus(`Aufgabe ${this.challengeNumber}: Zeichne den ${this.kind}-Verlauf. Ziehe die Endpunkte ◯ senkrecht zur Stabachse.`);
    this.draw();
  }

  nextChallenge() {
    this.challengeNumber++;
    this.loadChallenge();
  }

  clearAnswers() {
    for (const bar of this.fixture.bars) this.answers[bar.id] = { start: 0, end: 0 };
    this.results = null;
    this.draw();
  }

  checkAll() {
    const sol = this.fixture.solutions[this.kind];
    this.results = {};
    let correct = 0;
    for (const bar of this.fixture.bars) {
      const a = this.answers[bar.id];
      const userShape = window.SHAPE_FROM_VALUES(a.start, a.end);
      const ok = userShape === sol[bar.id];
      this.results[bar.id] = ok;
      if (ok) correct++;
    }
    const total = this.fixture.bars.length;
    const pts = correct * 50 - (total - correct) * 30;
    this.points += pts;
    if (correct === total) {
      this.streak++;
      this._updateStatus(`✓ Alle ${total} Stäbe korrekt! +${pts} Punkte. Streak: ${this.streak}.`);
    } else {
      this.streak = 0;
      // Auto-show solution to clarify what's wrong
      this.showSolution = true;
      const wrongList = this.fixture.bars
        .filter(b => !this.results[b.id])
        .map(b => b.id).join(', ');
      this._updateStatus(`${correct}/${total} richtig. Falsche Stäbe: ${wrongList}. Grüne gestrichelte Linie = richtige Lösung. (${pts} Punkte)`);
    }
    document.getElementById('game-points').textContent =
      (this.points >= 0 ? '+' : '') + this.points + ' Punkte';
    document.getElementById('game-points').style.color = this.points >= 0 ? FC.blue : FC.red;
    this.draw();
  }

  _updateStatus(msg) {
    document.getElementById('game-status').textContent = msg;
    document.getElementById('game-feedback').textContent = '';
  }

  _onResize() { this._resize(); this.draw(); }
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

  _layout() {
    const w = this._cssW, h = this._cssH;
    const bb = this.fixture.bbox;
    const marginL = 100, marginR = 60, marginT = 80, marginB = 80;
    const availW = w - marginL - marginR;
    const availH = h - marginT - marginB;
    const sx = availW / bb.w, sy = availH / bb.h;
    this.scale = Math.min(sx, sy);
    const drawW = bb.w * this.scale, drawH = bb.h * this.scale;
    this.origin = [marginL + (availW - drawW) / 2, marginT + (availH - drawH) / 2];
    this.pixelNodes = {};
    for (const [id, n] of Object.entries(this.fixture.nodes)) {
      this.pixelNodes[id] = [this.origin[0] + n.x * this.scale, this.origin[1] + n.y * this.scale];
    }
  }

  // ===== Handle position helpers =====
  _barAxes(barId) {
    const bar = this.fixture.bars.find(b => b.id === barId);
    const s = this.pixelNodes[bar.from], e = this.pixelNodes[bar.to];
    const dx = e[0] - s[0], dy = e[1] - s[1];
    const len = Math.hypot(dx, dy);
    const ux = dx / len, uy = dy / len;
    const nx = -uy, ny = ux;   // CCW 90° normal
    return { s, e, ux, uy, nx, ny, len };
  }

  _handlePos(barId, which) {
    const { s, e, nx, ny } = this._barAxes(barId);
    const a = this.answers[barId];
    const val = which === 'start' ? a.start : a.end;
    const base = which === 'start' ? s : e;
    return [base[0] + nx * val * LEVEL_STEP, base[1] + ny * val * LEVEL_STEP];
  }

  _hitTestHandles(mx, my) {
    for (const bar of this.fixture.bars) {
      for (const which of ['start', 'end']) {
        const [px, py] = this._handlePos(bar.id, which);
        if (Math.hypot(px - mx, py - my) < HANDLE_RADIUS + 6) return { barId: bar.id, which };
      }
    }
    return null;
  }

  _onDown(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const hit = this._hitTestHandles(mx, my);
    if (hit) {
      this.dragging = hit;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  _onMove(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (this.dragging) {
      const { barId, which } = this.dragging;
      const { s, e: end, nx, ny } = this._barAxes(barId);
      const base = which === 'start' ? s : end;
      // Project (mouse - base) onto normal axis
      const proj = (mx - base[0]) * nx + (my - base[1]) * ny;
      const level = Math.max(-MAX_LEVEL, Math.min(MAX_LEVEL, Math.round(proj / LEVEL_STEP)));
      this.answers[barId][which] = level;
      this.results = null;
      this.draw();
    } else {
      const hit = this._hitTestHandles(mx, my);
      this.canvas.style.cursor = hit ? 'grab' : 'pointer';
    }
  }

  _onUp() {
    if (this.dragging) {
      this.dragging = null;
      this.canvas.style.cursor = 'pointer';
      this.draw();
    }
  }

  // ===== Drawing =====

  draw() {
    if (!this.fixture) return;
    this._layout();
    const w = this._cssW, h = this._cssH;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this._drawGrid(w, h);
    this._drawHeader(w);
    this._drawCoordSystem(44, h - 110);
    this._drawSupports();
    this._drawBars();
    this._drawJoints();
    this._drawLoads();
    this._drawAnswers();
    if (this.showSolution) this._drawSolutionGhost();
    this._drawHandles();
  }

  _drawGrid(w, h) {
    const ctx = this.ctx, minor = 24, major = 96;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w + minor; x += minor) {
      ctx.strokeStyle = (x % major === 0) ? FC.gridMajor : FC.gridMinor;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h + minor; y += minor) {
      ctx.strokeStyle = (y % major === 0) ? FC.gridMajor : FC.gridMinor;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  _drawHeader(w) {
    const ctx = this.ctx;
    const color = this._diagramColor();
    ctx.fillStyle = color; ctx.font = 'bold 40px Helvetica'; ctx.textAlign = 'left';
    ctx.fillText(this.kind, 42, 50);
    ctx.fillStyle = FC.text; ctx.font = 'bold 16px Helvetica';
    ctx.fillText(`-Verlauf zeichnen — ${this.fixture.title}`, 92, 45);
    ctx.fillStyle = FC.muted; ctx.font = '12px Helvetica';
    ctx.fillText(this.fixture.description, 92, 64);
    ctx.fillStyle = FC.muted; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'right';
    ctx.fillText('Ziehe die Endpunkte der Verläufe ◯ senkrecht zur Stabachse.', w - 42, 50);
    ctx.textAlign = 'left';
  }

  _drawCoordSystem(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = FC.text; ctx.fillStyle = FC.text; ctx.lineWidth = 3;
    this._arrow(x, y, x + 60, y);
    this._arrow(x, y, x, y + 60);
    ctx.font = 'bold 13px Helvetica';
    ctx.fillText('x', x + 68, y + 5);
    ctx.fillText('y', x - 5, y + 75);
  }

  _drawBars() {
    const ctx = this.ctx;
    for (const bar of this.fixture.bars) {
      const s = this.pixelNodes[bar.from], e = this.pixelNodes[bar.to];
      ctx.strokeStyle = FC.beam; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      const mx = (s[0] + e[0]) / 2, my = (s[1] + e[1]) / 2;
      ctx.fillStyle = FC.paper; ctx.strokeStyle = FC.muted; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(mx, my, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = FC.muted; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(bar.id, mx, my + 4); ctx.textAlign = 'left';
    }
  }

  _drawJoints() {
    const ctx = this.ctx;
    const welds = new Set(this.fixture.welds || []);
    const supported = new Set(Object.keys(this.fixture.supports || {}));
    for (const [id, [px, py]] of Object.entries(this.pixelNodes)) {
      // Skip joint marker on supported nodes: the support symbol IS the connection
      if (!supported.has(id)) {
        if (welds.has(id)) {
          ctx.fillStyle = FC.beam; ctx.strokeStyle = FC.beam; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.rect(px - 6, py - 6, 12, 12); ctx.fill(); ctx.stroke();
        } else {
          ctx.fillStyle = FC.paper; ctx.strokeStyle = FC.beam; ctx.lineWidth = 2.5;
          ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      // Position label so it doesn't overlap supports below
      const lo = supported.has(id) ? -18 : -16;
      ctx.fillStyle = FC.text; ctx.font = 'bold 12px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(id, px, py + lo); ctx.textAlign = 'left';
    }
  }

  _drawSupports() {
    for (const [id, type] of Object.entries(this.fixture.supports || {})) {
      const [x, y] = this.pixelNodes[id];
      if (type === 'fixed') this._drawFixedSupport(x, y);
      else if (type === 'pin') this._drawPin(x, y);
      else if (type === 'roller') this._drawRoller(x, y);
    }
  }

  _drawFixedSupport(x, y) {
    const ctx = this.ctx;
    const wx = x - 18;
    ctx.strokeStyle = FC.beam; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(wx, y - 36); ctx.lineTo(wx, y + 36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(x + 4, y); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let off = -34; off <= 38; off += 10) {
      ctx.beginPath(); ctx.moveTo(wx - 14, y + off + 8); ctx.lineTo(wx, y + off); ctx.stroke();
    }
  }

  _drawPin(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = FC.beam; ctx.fillStyle = '#F0F4FA'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 6); ctx.lineTo(x - 13, y + 28); ctx.lineTo(x + 13, y + 28);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 20, y + 31); ctx.lineTo(x + 20, y + 31); ctx.stroke();
    for (let i = -16; i <= 16; i += 6) {
      ctx.beginPath(); ctx.moveTo(x + i, y + 31); ctx.lineTo(x + i - 4, y + 38); ctx.stroke();
    }
  }

  _drawRoller(x, y) {
    this._drawPin(x, y);
    const ctx = this.ctx;
    ctx.strokeStyle = FC.beam; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x - 7, y + 35, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 7, y + 35, 3, 0, Math.PI * 2); ctx.stroke();
  }

  _drawLoads() {
    const ctx = this.ctx;
    for (const load of this.fixture.loads) {
      if (load.kind === 'point') {
        const [x, y] = this.pixelNodes[load.node];
        const dx = load.fx || 0, dy = load.fy || 0;
        const len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len;
        const sx = x - ux * 56, sy = y - uy * 56;
        ctx.strokeStyle = FC.load; ctx.fillStyle = FC.load; ctx.lineWidth = 3;
        this._arrow(sx, sy, x - ux * 10, y - uy * 10);
        ctx.font = 'bold 13px Helvetica';
        ctx.fillText(load.label || 'F', sx + (ux > 0 ? -36 : 8), sy + (uy > 0 ? -8 : 14));
      } else if (load.kind === 'z') {
        const [x, y] = this.pixelNodes[load.node];
        this._drawOutOfPlaneLoad(x, y, load.label, load.direction);
      } else if (load.kind === 'distributed') {
        const bar = this.fixture.bars.find(b => b.id === load.bar);
        const s = this.pixelNodes[bar.from], e = this.pixelNodes[bar.to];
        this._drawDistributedLoad(s, e, load.label);
      }
    }
  }

  _drawOutOfPlaneLoad(x, y, label, direction) {
    const ctx = this.ctx;
    const r = 14;
    const cx = x + 22, cy = y - 22;
    ctx.strokeStyle = FC.load; ctx.fillStyle = FC.paper; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2.5;
    if (direction === 'into') {
      // ⊗ X mark
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r * 0.6); ctx.lineTo(cx + r * 0.6, cy + r * 0.6);
      ctx.moveTo(cx + r * 0.6, cy - r * 0.6); ctx.lineTo(cx - r * 0.6, cy + r * 0.6);
      ctx.stroke();
    } else {
      // ⊙ dot
      ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = FC.load; ctx.font = 'bold 13px Helvetica';
    ctx.fillText(label || 'P', cx + r + 4, cy + 4);
    // small line connecting load symbol to the node
    ctx.strokeStyle = FC.load; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx - r * 0.7, cy + r * 0.7); ctx.stroke();
    ctx.setLineDash([]);
  }

  _drawDistributedLoad(s, e, label) {
    const ctx = this.ctx;
    const dx = e[0] - s[0], dy = e[1] - s[1], len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const off = 30;
    const ax = nx * (-off), ay = ny * (-off);
    ctx.strokeStyle = FC.load; ctx.fillStyle = FC.load; ctx.lineWidth = 2;
    // top line
    ctx.beginPath(); ctx.moveTo(s[0] + ax, s[1] + ay); ctx.lineTo(e[0] + ax, e[1] + ay); ctx.stroke();
    // arrows
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const px = s[0] + (e[0] - s[0]) * t + ax;
      const py = s[1] + (e[1] - s[1]) * t + ay;
      const qx = s[0] + (e[0] - s[0]) * t;
      const qy = s[1] + (e[1] - s[1]) * t;
      this._arrow(px, py, qx - (nx * 4), qy - (ny * 4));
    }
    ctx.fillStyle = FC.load; ctx.font = 'bold 13px Helvetica';
    ctx.fillText(label || 'q', (s[0] + e[0]) / 2 + nx * (-off - 14), (s[1] + e[1]) / 2 + ny * (-off - 14));
  }

  _drawAnswers() {
    const defaultColor = this._diagramColor();
    for (const bar of this.fixture.bars) {
      const a = this.answers[bar.id];
      const { s, e, nx, ny } = this._barAxes(bar.id);
      const sx = s[0] + nx * a.start * LEVEL_STEP;
      const sy = s[1] + ny * a.start * LEVEL_STEP;
      const ex = e[0] + nx * a.end * LEVEL_STEP;
      const ey = e[1] + ny * a.end * LEVEL_STEP;
      const ctx = this.ctx;

      let color = defaultColor, fillAlpha = '22';
      if (this.results && this.results[bar.id] !== undefined) {
        if (this.results[bar.id]) { color = FC.green; fillAlpha = '38'; }
        else { color = FC.red; fillAlpha = '38'; }
      }
      ctx.fillStyle = color + fillAlpha;
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = color + '88'; ctx.lineWidth = 1;
      const segs = 5;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const bx = s[0] + (e[0] - s[0]) * t, by = s[1] + (e[1] - s[1]) * t;
        const cx = sx + (ex - sx) * t, cy = sy + (ey - sy) * t;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx, cy); ctx.stroke();
      }

      // After check: badge + status text on bar midpoint, OUTSIDE the diagram
      if (this.results && this.results[bar.id] !== undefined) {
        const ok = this.results[bar.id];
        const mb = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
        const off = -28; // opposite side of the diagram
        const sign = a.start + a.end >= 0 ? -1 : 1;
        const bx = mb[0] + nx * off * sign;
        const by = mb[1] + ny * off * sign;
        ctx.fillStyle = ok ? FC.green : FC.red;
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#FFF'; ctx.font = 'bold 16px Helvetica'; ctx.textAlign = 'center';
        ctx.fillText(ok ? '✓' : '✗', bx, by + 6); ctx.textAlign = 'left';
      }
    }
  }

  _drawSolutionGhost() {
    const sol = this.fixture.solutions[this.kind];
    const ctx = this.ctx;
    for (const bar of this.fixture.bars) {
      const shape = sol[bar.id];
      const [vs, ve] = shape.split(',').map(Number);
      const { s, e, nx, ny } = this._barAxes(bar.id);
      // Use a smaller perpendicular offset (don't multiply) so the ghost overlays the actual answer area cleanly
      const ghostScale = 1.0;
      const sx = s[0] + nx * vs * ghostScale * LEVEL_STEP * 1.6;
      const sy = s[1] + ny * vs * ghostScale * LEVEL_STEP * 1.6;
      const ex = e[0] + nx * ve * ghostScale * LEVEL_STEP * 1.6;
      const ey = e[1] + ny * ve * ghostScale * LEVEL_STEP * 1.6;
      // Filled "correct answer" band with strong outline + label
      ctx.fillStyle = '#2E9D6233';
      ctx.beginPath();
      ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = FC.green; ctx.lineWidth = 3; ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = FC.green;
      ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(ex, ey, 5, 0, Math.PI * 2); ctx.fill();
      // Endpoint signs
      const tag = (px, py, v) => {
        const txt = v > 0 ? '+' : (v < 0 ? '−' : '0');
        ctx.fillStyle = FC.paper; ctx.strokeStyle = FC.green; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = FC.green; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
        ctx.fillText(txt, px, py + 4); ctx.textAlign = 'left';
      };
      tag(sx, sy, vs); tag(ex, ey, ve);
    }
  }

  _drawHandles() {
    const color = this._diagramColor();
    for (const bar of this.fixture.bars) {
      for (const which of ['start', 'end']) {
        const [px, py] = this._handlePos(bar.id, which);
        const val = this.answers[bar.id][which];
        const fill = val === 0 ? FC.paper : (val > 0 ? FC.green : FC.orange);
        const ctx = this.ctx;
        ctx.fillStyle = fill; ctx.strokeStyle = color; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(px, py, HANDLE_RADIUS, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (val !== 0) {
          ctx.fillStyle = '#FFF'; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
          ctx.fillText(val > 0 ? '+' : '−', px, py + 3); ctx.textAlign = 'left';
        }
      }
    }
  }

  _arrow(x1, y1, x2, y2) {
    const ctx = this.ctx;
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * 12 + nx * 5, y2 - uy * 12 + ny * 5);
    ctx.lineTo(x2 - ux * 12 - nx * 5, y2 - uy * 12 - ny * 5);
    ctx.closePath(); ctx.fill();
  }

  _diagramColor() {
    if (this.kind === 'N') return FC.green;
    if (this.kind === 'Q') return FC.purple;
    return FC.red;
  }
}

window.FrameChallenge = FrameChallenge;
