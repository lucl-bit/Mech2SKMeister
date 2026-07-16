'use strict';

const FC = window.THEME; // zentrale Palette (theme.js)

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
    this._computedSolution = null;

    this.cutMode = false;
    this.cut = null;
    this.cutLine = null;
    this.cutDragging = false;
    this._forces = null;
    this.showReactions = false;
    this.tutorHighlight = null;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onKey = this._onKey.bind(this);
    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
    window.addEventListener('resize', this._onResize);
    window.addEventListener('keydown', this._onKey);
    canvas.style.cursor = 'pointer';
  }

  destroy() {
    if (this.tutor) { this.tutor.detach(); this.tutor = null; }
    // Session-Ende: Punktestand still in die Bestenliste übernehmen
    if (window.Scoreboard) Scoreboard.submitQuiet('fachwerk', this.points, { streak: this.streak });
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    window.removeEventListener('resize', this._onResize);
    window.removeEventListener('keydown', this._onKey);
    for (const barId of ['game-kind-filter', 'game-source-filter']) {
      const bar = document.getElementById(barId);
      if (bar) {
        bar.style.display = 'none';
        bar.querySelectorAll('button').forEach(b => { b.onclick = null; });
      }
    }
    // Restore bottombar so DiagramGame's original "Neue Aufgabe" button works
    // again. Without this, FC's stale buttons stay in the DOM and their onclick
    // closures (referencing this destroyed FC instance) hijack the shared canvas
    // when the user switches into The Basics / Speed Run mode.
    const bb = document.querySelector('#game-view .bottombar');
    if (bb && this._origBottombarHTML !== undefined) {
      bb.innerHTML = this._origBottombarHTML;
    }
  }

  start() {
    document.getElementById('game-mode-title').textContent = 'Fachwerk Profi — Zeichnen';
    document.getElementById('game-timer').style.display = 'none';
    this.kindFilter = 'mix';
    this.sourceFilter = 'mix';
    this._setupActions();
    this._setupKindFilter();
    this._setupSourceFilter();
    if (window.StatikTutor) {
      this.tutor = new StatikTutor(this);
      this.tutor.attach();
    }
    this._resize();
    this.loadChallenge();
  }

  _setupSourceFilter() {
    const bar = document.getElementById('game-source-filter');
    if (!bar) return;
    bar.style.display = '';
    bar.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.s === this.sourceFilter);
      b.onclick = () => {
        this.sourceFilter = b.dataset.s;
        bar.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
        this.loadChallenge();
      };
    });
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
    if (this._origBottombarHTML === undefined) this._origBottombarHTML = bb.innerHTML;
    bb.innerHTML = `
      <button class="btn-back" id="fc-cut">✂ Schnitt</button>
      <button class="btn-back" id="fc-solution">Lösung zeigen</button>
      <button class="btn-back" id="fc-clear">Zurücksetzen</button>
      <button class="btn-accent" id="fc-check" style="background:#7C5CE0">Prüfen</button>
      <button class="btn-accent" id="fc-next">Neue Aufgabe</button>
    `;
    document.getElementById('fc-check').onclick = () => this.checkAll();
    document.getElementById('fc-clear').onclick = () => this.clearAnswers();
    document.getElementById('fc-solution').onclick = () => { this.showSolution = !this.showSolution; this.draw(); };
    document.getElementById('fc-next').onclick = () => this.nextChallenge();
    document.getElementById('fc-cut').onclick = () => this.toggleCutMode();
  }

  // ===== Schnitt-Tool (Ritter-Schnitt) =====

  toggleCutMode() {
    this.cutMode = !this.cutMode;
    this.cutLine = null;
    this.cutDragging = false;
    const btn = document.getElementById('fc-cut');
    if (btn) btn.classList.toggle('fc-cut-active', this.cutMode);
    this.canvas.style.cursor = this.cutMode ? 'crosshair' : 'pointer';
    this._updateStatus(this.cutMode
      ? 'Schnitt-Modus: Ziehe eine Linie durch die Stäbe, die du freischneiden willst (ESC beendet).'
      : `Aufgabe ${this.challengeNumber}: Zeichne den ${this.kind}-Verlauf.`);
    this.draw();
  }

  // Geschnittene Stäbe + Seitenzuordnung der Knoten zur Schnittlinie.
  _computeCut(line) {
    const { x1, y1, x2, y2 } = line;
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 20) return null;
    const sideOf = (px, py) => Math.sign((px - x1) * dy - (py - y1) * dx) || 1;
    const nodeSide = {};
    for (const [id, [px, py]] of Object.entries(this.pixelNodes)) nodeSide[id] = sideOf(px, py);
    const cutBars = [];
    for (const bar of this.fixture.bars) {
      const s = this.pixelNodes[bar.from], e = this.pixelNodes[bar.to];
      if (nodeSide[bar.from] === nodeSide[bar.to]) continue;
      // Schnittpunkt Parameter t entlang des Stabes (Linie als unendlich)
      const denom = (e[0] - s[0]) * dy - (e[1] - s[1]) * dx;
      if (Math.abs(denom) < 1e-9) continue;
      const t = ((x1 - s[0]) * dy - (y1 - s[1]) * dx) / denom;
      if (t <= 0.02 || t >= 0.98) continue;
      cutBars.push({ id: bar.id, from: bar.from, to: bar.to, t });
    }
    if (!cutBars.length) return null;
    // Verschiebung: senkrecht zur Schnittlinie. sideOf(p) = sign((p-p1)×d);
    // Punkte mit side +1 liegen auf der Seite von (dy, -dx) — die Normale
    // muss dorthin zeigen, sonst wandern die Hälften aufeinander zu.
    const nx = dy / len, ny = -dx / len;
    return { line, cutBars, nodeSide, nx, ny };
  }

  _drawCutOverlay() {
    const ctx = this.ctx;
    const cut = this.cut;
    const line = this.cutDragging ? this.cutLine : (cut && cut.line);
    const drawCutLine = () => {
      if (!line) return;
      ctx.save();
      ctx.strokeStyle = 'rgba(217,83,79,.18)'; ctx.lineWidth = 12; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2); ctx.stroke();
      ctx.strokeStyle = FC.red; ctx.lineWidth = 2.5; ctx.setLineDash([9, 6]);
      ctx.beginPath(); ctx.moveTo(line.x1, line.y1); ctx.lineTo(line.x2, line.y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '19px Helvetica'; ctx.fillStyle = FC.red;
      ctx.fillText('✂', line.x1 - 10, line.y1 - 9);
      ctx.restore();
    };
    if (!cut) { drawCutLine(); return; }

    // Grosse Schnittfuge, damit die Gegenkräfte an beiden Ufern frei sichtbar
    // sind — nur so weit reduziert, dass kein Knoten aus dem Canvas wandert.
    let OFF = 70;
    const margin = 14;
    for (const [id, [px, py]] of Object.entries(this.pixelNodes)) {
      const s = cut.nodeSide[id];
      const ox = cut.nx * s, oy = cut.ny * s;
      if (ox > 1e-6) OFF = Math.min(OFF, (this._cssW - margin - px) / ox);
      else if (ox < -1e-6) OFF = Math.min(OFF, (margin - px) / ox);
      if (oy > 1e-6) OFF = Math.min(OFF, (this._cssH - margin - py) / oy);
      else if (oy < -1e-6) OFF = Math.min(OFF, (margin - py) / oy);
    }
    OFF = Math.max(30, OFF);
    const shift = id => {
      const s = cut.nodeSide[id];
      return [cut.nx * OFF * s, cut.ny * OFF * s];
    };
    const P = id => {
      const [px, py] = this.pixelNodes[id];
      const [ox, oy] = shift(id);
      return [px + ox, py + oy];
    };
    const shiftedNodes = {};
    for (const id of Object.keys(this.pixelNodes)) shiftedNodes[id] = P(id);
    const cutIds = new Set(cut.cutBars.map(b => b.id));

    // Schnittufer je Hälfte: Original-Schnittpunkt starr mitverschoben
    // (nicht auf der gestreckten Verbindung interpoliert) — so ist die Fuge
    // wirklich 2·OFF breit und die Gegenkräfte liegen frei.
    const faces = {};
    for (const cb of cut.cutBars) {
      const s0 = this.pixelNodes[cb.from], e0 = this.pixelNodes[cb.to];
      const bdx = e0[0] - s0[0], bdy = e0[1] - s0[1], bL = Math.hypot(bdx, bdy) || 1;
      const ux = bdx / bL, uy = bdy / bL;
      const pcx = s0[0] + bdx * cb.t, pcy = s0[1] + bdy * cb.t;
      const shA = shift(cb.from), shB = shift(cb.to);
      faces[cb.id] = {
        ux, uy,
        faceA: [pcx + shA[0] - ux * 6, pcy + shA[1] - uy * 6],
        faceB: [pcx + shB[0] + ux * 6, pcy + shB[1] + uy * 6],
      };
    }

    // Die Eingabe-Verläufe treten zurück; System, Lager und Lasten werden danach
    // vollständig und kontrastreich als zwei echte Freikörper neu gezeichnet.
    ctx.save();
    ctx.fillStyle = 'rgba(251,253,255,0.91)';
    ctx.fillRect(0, 0, this._cssW, this._cssH);
    ctx.restore();

    ctx.strokeStyle = FC.beam; ctx.lineWidth = 5;
    for (const bar of this.fixture.bars) {
      if (cutIds.has(bar.id)) continue;
      const s = P(bar.from), e = P(bar.to);
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    this._drawSupports(shiftedNodes);
    this._drawJoints(shiftedNodes);
    this._drawMarkers(shiftedNodes);
    // Streckenlasten auf geschnittenen Stäben an der Fuge teilen — sonst
    // überbrücken ihre Pfeile den Spalt zwischen den beiden Freikörpern.
    const cutT = {};
    for (const cb of cut.cutBars) cutT[cb.id] = cb.t;
    const savedLoads = this.fixture.loads;
    this.fixture.loads = (savedLoads || []).filter(
      l => !(l.kind === 'distributed' && cutT[l.bar] !== undefined));
    this._drawLoads(shiftedNodes);
    this.fixture.loads = savedLoads;
    for (const ld of savedLoads || []) {
      if (ld.kind !== 'distributed' || cutT[ld.bar] === undefined) continue;
      const bar = this.fixture.bars.find(b => b.id === ld.bar);
      const sN = shiftedNodes[bar.from], eN = shiftedNodes[bar.to];
      const t = cutT[ld.bar];
      const { faceA, faceB } = faces[ld.bar];
      this._drawDistributedLoad(sN, faceA, ld.label, t >= 0.5);
      this._drawDistributedLoad(faceB, eN, ld.label, t < 0.5);
    }

    const isFrameFix = (this.fixture.welds || []).length > 0 ||
      (this.fixture.loads || []).some(l => l.kind === 'distributed');
    const infoRows = [];
    for (const cb of cut.cutBars) {
      const sN = P(cb.from), eN = P(cb.to);
      const f = (this._forces || {})[cb.id];
      const t = cb.t;
      const { faceA, faceB, ux, uy } = faces[cb.id];
      ctx.strokeStyle = FC.beam; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(sN[0], sN[1]); ctx.lineTo(faceA[0], faceA[1]); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(eN[0], eN[1]); ctx.lineTo(faceB[0], faceB[1]); ctx.stroke();
      // Rote Stirnlinien machen die beiden Schnittufer auch ohne Kraftwert klar.
      ctx.strokeStyle = FC.red; ctx.lineWidth = 4;
      for (const face of [faceA, faceB]) {
        ctx.beginPath();
        ctx.moveTo(face[0] - uy * 10, face[1] + ux * 10);
        ctx.lineTo(face[0] + uy * 10, face[1] - ux * 10);
        ctx.stroke();
      }

      if (!f) {
        infoRows.push({ id: cb.id, text: 'Kraftwerte werden berechnet …', color: FC.muted });
        continue;
      }
      const Nval = f.N_start + (f.N_end - f.N_start) * t;
      const sgn = Math.abs(Nval) < 1e-6 ? 0 : Math.sign(Nval);
      const color = sgn > 0 ? FC.green : sgn < 0 ? FC.orange : FC.muted;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(255,255,255,.95)'; ctx.shadowBlur = 4;
      const alen = 34;
      if (sgn !== 0) {
        DrawUtils._arrowOn(ctx, faceA[0], faceA[1], faceA[0] + ux * alen * sgn, faceA[1] + uy * alen * sgn);
        DrawUtils._arrowOn(ctx, faceB[0], faceB[1], faceB[0] - ux * alen * sgn, faceB[1] - uy * alen * sgn);
      }
      ctx.shadowBlur = 0;

      let text = sgn === 0 ? 'N = 0.00 kN · Nullstab' :
        `N = ${Nval > 0 ? '+' : ''}${Nval.toFixed(2)} kN · ${sgn > 0 ? 'Zug' : 'Druck'}`;

      if (isFrameFix) {
        const Qval = f.Q_start + (f.Q_end - f.Q_start) * t;
        const Mval = -(f.M_start + (f.M_end - f.M_start) * t);
        text += `   Q = ${Qval.toFixed(2)}   M ≈ ${Mval.toFixed(2)}`;
      }
      infoRows.push({ id: cb.id, text, color });
    }

    if (this.showReactions) this._drawReactionForces(shiftedNodes);
    if (this.tutorHighlight) this._drawTutorHighlight(shiftedNodes);
    drawCutLine();
    if (line) {
      // Ans Linienende, nicht in die Spaltmitte — dort liegen die Gegenkräfte.
      this._drawCanvasPill('SCHNITT A–A', line.x1, line.y1 - 26, FC.red, 'center');
    }

    // Lesbare Ergebnis-Karte statt kleiner, frei schwebender Texte im System.
    const cardW = Math.min(360, this._cssW - 48);
    const cardX = this._cssW >= 820 ? this._cssW - cardW - 28 : 24;
    const cardY = 88;
    const rowH = 27;
    const cardH = 64 + Math.max(1, infoRows.length) * rowH + 30;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,.97)'; ctx.strokeStyle = FC.red; ctx.lineWidth = 1.8;
    ctx.shadowColor = 'rgba(22,34,47,.16)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 9); else ctx.rect(cardX, cardY, cardW, cardH);
    ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = FC.red; ctx.font = 'bold 12px Helvetica';
    ctx.fillText(`✂ FREIKÖRPER · ${cut.cutBars.length} ST${cut.cutBars.length === 1 ? 'AB' : 'ÄBE'} GESCHNITTEN`, cardX + 14, cardY + 22);
    ctx.fillStyle = FC.muted; ctx.font = '11px Helvetica';
    ctx.fillText(cut.cutBars.length <= 3 ? 'Gegenkräfte an beiden Schnittufern' : 'Hinweis: Ritter-Schnitt idealerweise durch max. 3 Stäbe', cardX + 14, cardY + 42);
    const rows = infoRows.length ? infoRows : [{ id: '–', text: 'Noch keinen Kraftwert verfügbar', color: FC.muted }];
    rows.forEach((row, i) => {
      const y = cardY + 66 + i * rowH;
      ctx.fillStyle = row.color; ctx.beginPath(); ctx.arc(cardX + 18, y - 4, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = FC.text; ctx.font = 'bold 11px Helvetica'; ctx.fillText(`Stab ${row.id}`, cardX + 30, y);
      ctx.fillStyle = row.color; ctx.font = '11px Helvetica'; ctx.fillText(row.text, cardX + 85, y);
    });
    ctx.fillStyle = FC.muted; ctx.font = '10px Helvetica';
    ctx.fillText('actio = reactio · gleiche Kraft, entgegengesetzte Richtung', cardX + 14, cardY + cardH - 13);
    ctx.restore();
  }

  async loadChallenge() {
    // Generierte Fachwerke sind ideale Fachwerke (nur N sinnvoll) — bei
    // Q-/M-Filter bleiben wir bei den Prüfungsaufgaben.
    const genAllowed = this.kindFilter === 'mix' || this.kindFilter === 'N';
    const useGenerator = genAllowed && (
      this.sourceFilter === 'random' ||
      (this.sourceFilter === 'mix' && Math.random() < 0.4)
    );
    this.fixture = null;
    if (useGenerator) {
      try {
        const resp = await fetch('/api/generate-truss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const data = await resp.json();
        if (data.ok) this.fixture = data.fixture;
      } catch (e) { /* Fallback auf Prüfungsaufgaben */ }
    }
    if (!this.fixture) {
      const fixes = await this._getFixtures();
      if (!this._queue || this._queue.length === 0) {
        this._queue = [...fixes].sort(() => Math.random() - 0.5);
      }
      this.fixture = this._queue.pop();
    }
    this.fixture = this._canonicalizeFixture(this.fixture);
    if (this.fixture.generated) {
      this.kind = 'N';
    } else if (this.kindFilter && this.kindFilter !== 'mix') {
      this.kind = this.kindFilter;
    } else {
      const kinds = ['N', 'Q', 'M'];
      this.kind = kinds[Math.floor(Math.random() * 3)];
    }
    this.answers = {};
    const paraM = this.fixture.parabolicBars?.M || [];
    const paraQ = this.fixture.parabolicBars?.Q || [];
    for (const bar of this.fixture.bars) {
      const ans = { start: 0, end: 0 };
      if (paraM.includes(bar.id) || paraQ.includes(bar.id)) ans.mid = 0;
      this.answers[bar.id] = ans;
    }
    this.results = null;
    this.showSolution = false;
    this._computedSolution = null;
    this._forces = null;
    this.showReactions = false;
    this.tutorHighlight = null;
    if (this.cutMode) this.toggleCutMode();
    this.cut = null;
    const paraHint = (this.fixture.parabolicBars?.[this.kind] || []).length
      ? ` Stäbe mit Streckenlast haben 3 Handles (Anfang/Mitte/Ende) — q bestimmt die Krümmung der Parabel.`
      : '';
    this._updateStatus(`Aufgabe ${this.challengeNumber}: Zeichne den ${this.kind}-Verlauf. Ziehe die Endpunkte ◯ senkrecht zur Stabachse.${paraHint}`);
    if (this.tutor) this.tutor.newTask();
    this.draw();
    await this._computeSolution();
    this.draw();
  }

  // Fixtures vom Server (editierbare Datenbank); Fallback auf die statische
  // frame_fixtures.js. Cache in window.__remoteFixtures — das Settings-Tab
  // setzt ihn nach Speichern/Löschen auf null.
  async _getFixtures() {
    if (!window.__remoteFixtures) {
      try {
        const data = await (await fetch('/api/fixtures')).json();
        if (data.ok && Array.isArray(data.fixtures) && data.fixtures.length) {
          window.__remoteFixtures = data.fixtures;
        }
      } catch (e) { /* Server-Store fehlt — statischer Fallback */ }
      if (!window.__remoteFixtures) window.__remoteFixtures = window.FRAME_FIXTURES;
    }
    return window.__remoteFixtures;
  }

  // Stäbe kanonisch orientieren (lokal-x mit +globaler x-Komponente, vertikal
  // nach unten) — sonst hängen Q-Vorzeichen von der Zeichenreihenfolge der
  // Fixture ab (Kurs-Konvention: lokale Achsen = globale Achsen).
  _canonicalizeFixture(fix) {
    const flipped = new Set();
    const bars = fix.bars.map(b => {
      const n1 = fix.nodes[b.from], n2 = fix.nodes[b.to];
      if (DrawUtils.isCanonicalDir(n2.x - n1.x, n2.y - n1.y)) return b;
      flipped.add(b.id);
      return { ...b, from: b.to, to: b.from };
    });
    if (!flipped.size) return fix;
    // Handgeschriebene Fallback-Lösungen mitspiegeln: "s,e" → "e,s";
    // Q flippt zusätzlich das Vorzeichen (lokale y-Achse dreht mit).
    const solutions = {};
    for (const [kind, perBar] of Object.entries(fix.solutions || {})) {
      solutions[kind] = {};
      for (const [barId, str] of Object.entries(perBar)) {
        if (!flipped.has(barId) || typeof str !== 'string' || !str.includes(',')) {
          solutions[kind][barId] = str;
          continue;
        }
        const [s, e] = str.split(',').map(Number);
        solutions[kind][barId] = kind === 'Q' ? `${-e || 0},${-s || 0}` : `${e},${s}`;
      }
    }
    return { ...fix, bars, solutions: fix.solutions ? solutions : fix.solutions };
  }

  async _computeSolution() {
    const fix = this.fixture;
    // A fixed end transfers moments even if every internal connection is a
    // hinge.  Such systems must use the frame solver, not the ideal-truss
    // solver (BP 2018S / 2021W are examples).
    const isFrame = (fix.welds && fix.welds.length > 0) ||
      Object.values(fix.supports || {}).includes('fixed');
    const distLoads = (fix.loads || []).filter(l => l.kind === 'distributed');
    const hasDistributed = distLoads.length > 0;

    const joints = Object.entries(fix.nodes).map(([id, n]) => ({
      joint_id: id, x: Number(n.x), y: Number(n.y),
    }));
    const bars = fix.bars.map(b => ({ bar_id: b.id, start_id: b.from, end_id: b.to }));
    const supports = Object.entries(fix.supports).map(([id, type]) => ({
      joint_id: id, support_type: type,
    }));
    const loads = [];
    const distributed_loads = [];
    for (const ld of (fix.loads || [])) {
      if (ld.kind === 'point') {
        loads.push({ joint_id: ld.node, fx: Number(ld.fx) || 0, fy: Number(ld.fy) || 0 });
      } else if (ld.kind === 'moment') {
        loads.push({ joint_id: ld.node, fx: 0, fy: 0, mz: Number(ld.mz) || 0 });
      } else if (ld.kind === 'z') {
        const sign = ld.direction === 'into' ? 1 : -1;
        loads.push({ joint_id: ld.node, fx: 0, fy: sign * (Number(ld.fz) || 1) });
      } else if (ld.kind === 'distributed') {
        // Fixture y-down: q=1 means downward (positive local-y for horizontal bar) — pass as-is
        distributed_loads.push({ bar_id: ld.bar, q: Number(ld.q) || 1 });
      }
    }

    try {
      let result;
      // Use truss solver only for pure trusses (no distributed loads, no welds)
      if (!isFrame && !hasDistributed) {
        const resp = await fetch('/api/solve-truss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ joints, bars, loads, supports }),
        });
        result = await resp.json();
        if (!result.ok) return;

        // Rohwerte fürs Schnitt-Tool/Tutor aufbewahren (N konstant je Stab)
        this._forces = {};
        for (const b of fix.bars) {
          const f = result.bar_forces[b.id] || 0;
          this._forces[b.id] = { N_start: f, N_end: f, Q_start: 0, Q_end: 0, M_start: 0, M_end: 0 };
        }
        this._reactions = result.reactions || {};

        const allN = fix.bars.map(b => Math.abs(result.bar_forces[b.id] || 0));
        const thrN = 0.05 * Math.max(...allN, 1e-6);
        const sgn = (v, thr) => Math.abs(v) < thr ? '0' : v > 0 ? '1' : '-1';
        const sol = { N: {}, Q: {}, M: {} };
        for (const b of fix.bars) {
          const f = result.bar_forces[b.id] || 0;
          sol.N[b.id] = `${sgn(f, thrN)},${sgn(f, thrN)}`;
          sol.Q[b.id] = '0,0';
          sol.M[b.id] = '0,0';
        }
        this._computedSolution = sol;
      } else {
        // Frame solver handles beams with distributed loads, welds, or both
        const resp = await fetch('/api/solve-frame', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ joints, bars, supports, loads, welds: fix.welds || [], distributed_loads }),
        });
        result = await resp.json();
        if (!result.ok) return;

        const bf = result.bar_forces;
        // Rohwerte fürs Schnitt-Tool/Tutor aufbewahren (M hier noch FEM-
        // Konvention; Kurs-Umrechnung bei der Anzeige: M_kurs = −M_fem)
        this._forces = {};
        for (const b of fix.bars) { if (bf[b.id]) this._forces[b.id] = { ...bf[b.id] }; }
        this._reactions = result.reactions || {};

        const pick = (key) => fix.bars.flatMap(b => bf[b.id] ? [Math.abs(bf[b.id][key])] : []);
        const thr = (vals) => 0.05 * Math.max(...vals, 1e-6);
        const thrN = thr(pick('N_start').concat(pick('N_end')));
        const thrQ = thr(pick('Q_start').concat(pick('Q_end')));
        const thrM = thr(pick('M_start').concat(pick('M_end')));
        const sgn = (v, t) => Math.abs(v) < t ? '0' : v > 0 ? '1' : '-1';
        const sol = { N: {}, Q: {}, M: {} };
        for (const b of fix.bars) {
          const f = bf[b.id];
          if (!f) continue;
          sol.N[b.id] = `${sgn(f.N_start, thrN)},${sgn(f.N_end, thrN)}`;
          sol.Q[b.id] = `${sgn(f.Q_start, thrQ)},${sgn(f.Q_end, thrQ)}`;
          // FEM-M (sagging+) → Kurs-Konvention M_z (ETH Mech II, y↓/z⊗): Vorzeichen flippen
          sol.M[b.id] = `${sgn(-f.M_start, thrM)},${sgn(-f.M_end, thrM)}`;
        }

        // Compute midpoint M for parabolic bars: M(L/2) = M_start + Q_start*(L/2) - q*(L/2)²/2
        const parabolicM = fix.parabolicBars?.M || [];
        if (parabolicM.length) {
          sol.M_mid = {};
          for (const b of fix.bars) {
            if (!parabolicM.includes(b.id)) continue;
            const f = bf[b.id]; if (!f) continue;
            const dl = distLoads.find(l => l.bar === b.id);
            const q = dl ? Number(dl.q) : 0;
            const n1 = fix.nodes[b.from], n2 = fix.nodes[b.to];
            const L = Math.hypot(n2.x - n1.x, n2.y - n1.y);
            // FEM-intern berechnen, dann in Kurs-Konvention (M_z = −M_fem) umrechnen
            const M_mid = -(f.M_start + f.Q_start * (L / 2) - q * (L / 2) ** 2 / 2);
            const thrMid = 0.05 * Math.max(Math.abs(M_mid), 1e-6);
            sol.M_mid[b.id] = Math.abs(M_mid) < thrMid ? '0' : M_mid > 0 ? '1' : '-1';
          }
        }
        this._computedSolution = sol;
      }
    } catch (e) {
      console.warn('_computeSolution failed:', e);
    }
  }

  nextChallenge() {
    this.challengeNumber++;
    this.loadChallenge();
  }

  clearAnswers() {
    const paraM = this.fixture.parabolicBars?.M || [];
    const paraQ = this.fixture.parabolicBars?.Q || [];
    for (const bar of this.fixture.bars) {
      const ans = { start: 0, end: 0 };
      if (paraM.includes(bar.id) || paraQ.includes(bar.id)) ans.mid = 0;
      this.answers[bar.id] = ans;
    }
    this.results = null;
    this.draw();
  }

  // Lösungs-Signaturen in Kurs-Konvention. Primär vom Solver (_computeSolution,
  // dort bereits konvertiert); Fallback sind die handgeschriebenen Fixture-
  // Lösungen, die in der alten Element-Konvention (M sagging+) notiert sind
  // und deshalb beim M-Verlauf geflippt werden müssen.
  _solutionsOf() {
    if (this._computedSolution) return this._computedSolution;
    const raw = this.fixture.solutions;
    if (!raw) return null;
    const flip = str => str.split(',').map(v => String(-Number(v) || 0)).join(',');
    const M = {};
    for (const [barId, str] of Object.entries(raw.M || {})) M[barId] = flip(str);
    return { ...raw, M };
  }

  // Erwartete Krümmungsrichtung der M-Parabel im Wertraum (Levels):
  // M_kurs'' = +q  ⇒  sign(S+E−2M) muss sign(q) entsprechen.
  _expectedCurvature(barId) {
    if (this.kind !== 'M') return 0;
    const dl = (this.fixture.loads || []).find(l => l.kind === 'distributed' && l.bar === barId);
    if (!dl) return 0;
    const q = Number(dl.q) || 0;
    return q > 0 ? 1 : q < 0 ? -1 : 0;
  }

  checkAll() {
    this._curvatureWrong = null;
    const fullSol = this._solutionsOf();
    const sol = fullSol[this.kind];
    const solMid = fullSol[this.kind + '_mid'];  // e.g. M_mid, Q_mid
    const paraForKind = this.fixture.parabolicBars?.[this.kind] || [];
    this.results = {};
    let correct = 0;
    for (const bar of this.fixture.bars) {
      const a = this.answers[bar.id];
      const isPara = paraForKind.includes(bar.id) && solMid?.[bar.id];
      let ok;
      if (isPara) {
        // Parabel-Stäbe: Vorzeichen-Tripel (Start, Mitte, Ende) plus
        // Krümmungsrichtung (durch q vorgegeben) prüfen.
        const sgnOf = v => (v > 0 ? '1' : v < 0 ? '-1' : '0');
        const [solVs, solVe] = sol[bar.id].split(',');
        const tripleOk = sgnOf(a.start) === solVs && sgnOf(a.mid) === solMid[bar.id] && sgnOf(a.end) === solVe;
        const userCurv = a.start + a.end - 2 * a.mid;
        const expCurv = this._expectedCurvature(bar.id);
        const curvOk = expCurv === 0 || userCurv === 0 || Math.sign(userCurv) === expCurv;
        ok = tripleOk && curvOk;
        if (tripleOk && !curvOk) this._curvatureWrong = bar.id;
      } else {
        const userShape = window.SHAPE_FROM_VALUES(a.start, a.end);
        const [solVs, solVe] = sol[bar.id].split(',').map(Number);
        const solShape = window.SHAPE_FROM_VALUES(solVs, solVe);
        ok = userShape === solShape;
      }
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
      const curvHint = this._curvatureWrong
        ? ` Stab ${this._curvatureWrong}: Vorzeichen ok, aber die Parabel krümmt in die falsche Richtung (q bestimmt die Krümmung).`
        : '';
      this._updateStatus(`${correct}/${total} richtig. Falsche Stäbe: ${wrongList}.${curvHint} Grüne gestrichelte Linie = richtige Lösung. (${pts} Punkte)`);
    }
    document.getElementById('game-points').textContent =
      (this.points >= 0 ? '+' : '') + this.points + ' Punkte';
    document.getElementById('game-points').style.color = this.points >= 0 ? FC.blue : FC.red;
    if (this.tutor) this.tutor.afterCheck(correct, total);
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
    // Keep the structure clear of the two-line header.  Point-load arrows
    // extend about 60 px beyond a node and support symbols about 45 px; the
    // old 80 px top margin clipped loads on the upper nodes of exam figures.
    const marginL = 105, marginR = 75, marginT = 140, marginB = 95;
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
    // Positive Verlaufswerte liegen auf der −lokal-y-Seite des Stabes —
    // das ist die Ordinatenrichtung der Prüfungsdiagramme (ETH Mech II, y↓).
    const nx = uy, ny = -ux;
    return { s, e, ux, uy, nx, ny, len };
  }

  _handlePos(barId, which) {
    const { s, e, nx, ny } = this._barAxes(barId);
    const a = this.answers[barId];
    if (which === 'mid') {
      const mid = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
      const val = a.mid || 0;
      return [mid[0] + nx * val * LEVEL_STEP, mid[1] + ny * val * LEVEL_STEP];
    }
    const val = which === 'start' ? a.start : a.end;
    const base = which === 'start' ? s : e;
    return [base[0] + nx * val * LEVEL_STEP, base[1] + ny * val * LEVEL_STEP];
  }

  _hitTestHandles(mx, my) {
    const paraM = this.fixture.parabolicBars?.M || [];
    const paraQ = this.fixture.parabolicBars?.Q || [];
    for (const bar of this.fixture.bars) {
      const hasMid = (paraM.includes(bar.id) && this.kind === 'M') ||
                     (paraQ.includes(bar.id) && this.kind === 'Q');
      const whichList = hasMid ? ['start', 'mid', 'end'] : ['start', 'end'];
      for (const which of whichList) {
        const [px, py] = this._handlePos(bar.id, which);
        if (Math.hypot(px - mx, py - my) < HANDLE_RADIUS + 6) return { barId: bar.id, which };
      }
    }
    return null;
  }

  _onDown(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (this.cutMode) {
      this.cutDragging = true;
      this.cut = null;
      this.cutLine = { x1: mx, y1: my, x2: mx, y2: my };
      if (e.pointerId !== undefined) this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    const hit = this._hitTestHandles(mx, my);
    if (hit) {
      this.dragging = hit;
      this.canvas.style.cursor = 'grabbing';
      if (e.pointerId !== undefined) this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  _onMove(e) {
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (this.cutDragging) {
      this.cutLine.x2 = mx; this.cutLine.y2 = my;
      this.draw();
      return;
    }
    if (this.dragging) {
      const { barId, which } = this.dragging;
      const { s, e: end, nx, ny } = this._barAxes(barId);
      let base;
      if (which === 'mid') base = [(s[0] + end[0]) / 2, (s[1] + end[1]) / 2];
      else base = which === 'start' ? s : end;
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
    if (this.cutDragging) {
      this.cutDragging = false;
      this.cut = this._computeCut(this.cutLine);
      if (!this.cut) {
        this._updateStatus('Kein Stab getroffen — Linie quer durch die Struktur ziehen.');
      } else {
        const n = this.cut.cutBars.length;
        this._updateStatus(n <= 3
          ? `Schnitt durch ${n} St${n === 1 ? 'ab' : 'äbe'} — klassischer Ritter-Schnitt.`
          : `Schnitt durch ${n} Stäbe — für einen Ritter-Schnitt maximal 3 schneiden.`);
      }
      this.draw();
      return;
    }
    if (this.dragging) {
      this.dragging = null;
      this.canvas.style.cursor = 'pointer';
      this.draw();
    }
  }

  _onKey(e) {
    if (e.key === 'Escape' && this.cutMode) this.toggleCutMode();
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
    this._drawMarkers();
    this._drawAnswers();
    if (this.showSolution) this._drawSolutionGhost();
    this._drawHandles();
    // Lasten zuletzt: Kraftpfeile dürfen nie hinter Stäben oder Verläufen verschwinden.
    this._drawLoads();
    if (!(this.cutMode && this.cut)) {
      if (this.showReactions) this._drawReactionForces();
      if (this.tutorHighlight) this._drawTutorHighlight();
    }
    if (this.cutMode) this._drawCutOverlay();
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
    const desc = this.fixture.source
      ? `${this.fixture.description}  [${this.fixture.source}]`
      : this.fixture.description;
    ctx.fillText(desc, 92, 64);
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

  // Nachbarknoten-Pixelpositionen für Orientierungslogik (DrawUtils).
  _neighborsOf(id, nodes = this.pixelNodes) {
    const out = [];
    for (const bar of this.fixture.bars || []) {
      let other = null;
      if (bar.from === id) other = bar.to;
      else if (bar.to === id) other = bar.from;
      if (other && nodes[other]) out.push(nodes[other]);
    }
    return out;
  }

  _drawJoints(nodes = this.pixelNodes) {
    const ctx = this.ctx;
    const welds = new Set(this.fixture.welds || []);
    const supported = new Set(Object.keys(this.fixture.supports || {}));
    for (const [id, [px, py]] of Object.entries(nodes)) {
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
      // Label auf der stabfreien Seite, damit kein Stab es überdeckt
      const [ox, oy] = DrawUtils.labelOffset(px, py, this._neighborsOf(id, nodes), supported.has(id), 18);
      ctx.fillStyle = FC.text; ctx.font = 'bold 12px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(id, px + ox, py + oy); ctx.textAlign = 'left';
    }
  }

  // Lagersymbole physikalisch korrekt (Logik in DrawUtils):
  // pin/roller nur Boden/Decke, Einspannung rechtwinklig zum Stab.
  _drawSupports(nodes = this.pixelNodes) {
    const ctx = this.ctx;
    for (const [id, type] of Object.entries(this.fixture.supports || {})) {
      const [x, y] = nodes[id];
      const nb = this._neighborsOf(id, nodes);
      if (type === 'fixed') {
        DrawUtils.drawFixed(ctx, x, y, DrawUtils.fixedAngle(x, y, nb),
          { stroke: FC.beam, lineWidth: 4, scale: 0.95 });
      } else {
        const opts = { stroke: FC.beam, fill: '#F0F4FA', scale: 0.9 };
        if (type === 'pin_wall' || type === 'roller_x') {
          // Horizontal reaction: rollers bear against a vertical wall.  Put
          // the wall on the side opposite the connected structure.
          const away = DrawUtils.awayVec(x, y, nb) || [-1, 0];
          opts.angle = away[0] < 0 ? Math.PI / 2 : -Math.PI / 2;
          if (type === 'pin_wall') DrawUtils.drawPin(ctx, x, y, 1, opts);
          else DrawUtils.drawRoller(ctx, x, y, 1, opts);
        } else {
          const side = DrawUtils.supportSide(x, y, nb);
          if (type === 'roller' || type === 'roller_y') DrawUtils.drawRoller(ctx, x, y, side, opts);
          else DrawUtils.drawPin(ctx, x, y, side, opts);
        }
      }
    }
  }

  // Named reference points that lie inside a continuous member (for example
  // point E at midspan in BP 2021W).  They are labels, not artificial joints.
  _drawMarkers(nodes = this.pixelNodes) {
    const ctx = this.ctx;
    for (const marker of (this.fixture.markers || [])) {
      const bar = this.fixture.bars.find(item => item.id === marker.bar);
      if (!bar) continue;
      const s = nodes[bar.from], e = nodes[bar.to];
      const t = Number(marker.t ?? 0.5);
      const x = s[0] + (e[0] - s[0]) * t, y = s[1] + (e[1] - s[1]) * t;
      const dx = e[0] - s[0], dy = e[1] - s[1], len = Math.hypot(dx, dy) || 1;
      const side = Number(marker.side || 1);
      const nx = -dy / len * side, ny = dx / len * side;
      ctx.fillStyle = FC.text; ctx.font = 'bold 12px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(marker.id, x + nx * 19, y + ny * 19 + 4);
      ctx.textAlign = 'left';
    }
  }

  _drawLoads(nodes = this.pixelNodes) {
    const ctx = this.ctx;
    for (const load of this.fixture.loads) {
      if (load.kind === 'point') {
        const [x, y] = nodes[load.node];
        const dx = load.fx || 0, dy = load.fy || 0;
        const len = Math.hypot(dx, dy);
        const ux = dx / len, uy = dy / len;
        const sx = x - ux * 56, sy = y - uy * 56;
        // Heller Halo trennt den Pfeil auch dann vom System, wenn beides kollinear ist.
        ctx.strokeStyle = FC.paper; ctx.fillStyle = FC.paper; ctx.lineWidth = 7;
        this._arrow(sx, sy, x - ux * 10, y - uy * 10);
        ctx.strokeStyle = FC.load; ctx.fillStyle = FC.load; ctx.lineWidth = 3.5;
        this._arrow(sx, sy, x - ux * 10, y - uy * 10);
        ctx.font = 'bold 13px Helvetica';
        ctx.fillText(load.label || 'F', sx + (ux > 0 ? -36 : 8), sy + (uy > 0 ? -8 : 14));
      } else if (load.kind === 'moment') {
        const [x, y] = nodes[load.node];
        const clockwise = Number(load.mz) > 0;
        ctx.strokeStyle = FC.load; ctx.fillStyle = FC.load; ctx.lineWidth = 3;
        DrawUtils._momentArc(ctx, x, y, 30, clockwise);
        ctx.font = 'bold 13px Helvetica';
        ctx.fillText(load.label || 'M', x - 43, y - 31);
      } else if (load.kind === 'z') {
        const [x, y] = nodes[load.node];
        this._drawOutOfPlaneLoad(x, y, load.label, load.direction);
      } else if (load.kind === 'distributed') {
        const bar = this.fixture.bars.find(b => b.id === load.bar);
        const s = nodes[bar.from], e = nodes[bar.to];
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

  _drawDistributedLoad(s, e, label, showLabel = true) {
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
    if (showLabel) {
      ctx.fillStyle = FC.load; ctx.font = 'bold 13px Helvetica';
      ctx.fillText(label || 'q', (s[0] + e[0]) / 2 + nx * (-off - 14), (s[1] + e[1]) / 2 + ny * (-off - 14));
    }
  }

  _drawAnswers() {
    const defaultColor = this._diagramColor();
    const paraForKind = this.fixture.parabolicBars?.[this.kind] || [];
    for (const bar of this.fixture.bars) {
      const a = this.answers[bar.id];
      const { s, e, nx, ny } = this._barAxes(bar.id);
      const isPara = paraForKind.includes(bar.id) && a.mid !== undefined;

      let color = defaultColor, fillAlpha = '22';
      if (this.results && this.results[bar.id] !== undefined) {
        color = this.results[bar.id] ? FC.green : FC.red;
        fillAlpha = '38';
      }
      const ctx = this.ctx;

      if (isPara) {
        // Parabel exakt durch alle drei Handle-Punkte (Start, Mitte, Ende):
        // Kontrollpunkt cp = 2·PM − (P0+P2)/2 lässt die Bezier durch PM laufen.
        const p0x = s[0] + nx * a.start * LEVEL_STEP, p0y = s[1] + ny * a.start * LEVEL_STEP;
        const p2x = e[0] + nx * a.end * LEVEL_STEP,   p2y = e[1] + ny * a.end * LEVEL_STEP;
        const pmx = (s[0] + e[0]) / 2 + nx * a.mid * LEVEL_STEP;
        const pmy = (s[1] + e[1]) / 2 + ny * a.mid * LEVEL_STEP;
        const cpX = 2 * pmx - (p0x + p2x) / 2, cpY = 2 * pmy - (p0y + p2y) / 2;
        ctx.fillStyle = color + fillAlpha;
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]); ctx.lineTo(p0x, p0y);
        ctx.quadraticCurveTo(cpX, cpY, p2x, p2y);
        ctx.lineTo(e[0], e[1]); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.quadraticCurveTo(cpX, cpY, p2x, p2y); ctx.stroke();
      } else {
        const sx = s[0] + nx * a.start * LEVEL_STEP, sy = s[1] + ny * a.start * LEVEL_STEP;
        const ex = e[0] + nx * a.end * LEVEL_STEP,   ey = e[1] + ny * a.end * LEVEL_STEP;
        ctx.fillStyle = color + fillAlpha;
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = color; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
        ctx.strokeStyle = color + '88'; ctx.lineWidth = 1;
        for (let i = 0; i <= 5; i++) {
          const t = i / 5;
          const bx = s[0] + (e[0] - s[0]) * t, by = s[1] + (e[1] - s[1]) * t;
          const cx2 = sx + (ex - sx) * t, cy2 = sy + (ey - sy) * t;
          ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cx2, cy2); ctx.stroke();
        }
      }

      // After check: badge on bar midpoint
      if (this.results && this.results[bar.id] !== undefined) {
        const ok = this.results[bar.id];
        const mb = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
        const sign = (isPara ? a.mid : a.start + a.end) >= 0 ? -1 : 1;
        const bx = mb[0] + nx * (-28) * sign, by = mb[1] + ny * (-28) * sign;
        ctx.fillStyle = ok ? FC.green : FC.red;
        ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(bx, by, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#FFF'; ctx.font = 'bold 16px Helvetica'; ctx.textAlign = 'center';
        ctx.fillText(ok ? '✓' : '✗', bx, by + 6); ctx.textAlign = 'left';
      }
    }
  }

  _drawSolutionGhost() {
    const fullSol = this._solutionsOf();
    const sol = fullSol[this.kind];
    const solMid = fullSol[this.kind + '_mid'];
    const paraForKind = this.fixture.parabolicBars?.[this.kind] || [];
    const ctx = this.ctx;
    const GS = LEVEL_STEP * 1.6;  // ghost scale

    const tag = (px, py, v) => {
      const txt = v > 0 ? '+' : (v < 0 ? '−' : '0');
      ctx.fillStyle = FC.paper; ctx.strokeStyle = FC.green; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(px, py, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = FC.green; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(txt, px, py + 4); ctx.textAlign = 'left';
    };

    for (const bar of this.fixture.bars) {
      const shape = sol[bar.id];
      const { s, e, nx, ny } = this._barAxes(bar.id);
      const isPara = paraForKind.includes(bar.id) && solMid?.[bar.id];

      if (isPara) {
        // Ghost-Parabel durch alle drei Lösungspunkte (Start, Mitte, Ende)
        const [gvs, gve] = shape.split(',').map(Number);
        const vm = Number(solMid[bar.id]);  // -1, 0, or 1
        const p0x = s[0] + nx * gvs * GS, p0y = s[1] + ny * gvs * GS;
        const p2x = e[0] + nx * gve * GS, p2y = e[1] + ny * gve * GS;
        const pmx = (s[0] + e[0]) / 2 + nx * vm * GS;
        const pmy = (s[1] + e[1]) / 2 + ny * vm * GS;
        const cpX = 2 * pmx - (p0x + p2x) / 2, cpY = 2 * pmy - (p0y + p2y) / 2;
        ctx.fillStyle = '#2E9D6233';
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]); ctx.lineTo(p0x, p0y);
        ctx.quadraticCurveTo(cpX, cpY, p2x, p2y);
        ctx.lineTo(e[0], e[1]); ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = FC.green; ctx.lineWidth = 3; ctx.setLineDash([7, 4]);
        ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.quadraticCurveTo(cpX, cpY, p2x, p2y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = FC.green;
        ctx.beginPath(); ctx.arc(pmx, pmy, 6, 0, Math.PI * 2); ctx.fill();
        tag(p0x, p0y, gvs); tag(pmx, pmy, vm); tag(p2x, p2y, gve);
      } else {
        const [vs, ve] = shape.split(',').map(Number);
        const sx = s[0] + nx * vs * GS, sy = s[1] + ny * vs * GS;
        const ex = e[0] + nx * ve * GS, ey = e[1] + ny * ve * GS;
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
        tag(sx, sy, vs); tag(ex, ey, ve);
      }
    }
  }

  _drawHandles() {
    const color = this._diagramColor();
    const paraForKind = this.fixture.parabolicBars?.[this.kind] || [];
    for (const bar of this.fixture.bars) {
      const hasMid = paraForKind.includes(bar.id) && this.answers[bar.id].mid !== undefined;
      const whichList = hasMid ? ['start', 'mid', 'end'] : ['start', 'end'];
      for (const which of whichList) {
        const [px, py] = this._handlePos(bar.id, which);
        const val = this.answers[bar.id][which];
        const isMid = which === 'mid';
        const fill = val === 0 ? FC.paper : (val > 0 ? FC.green : FC.orange);
        const ctx = this.ctx;
        const r = isMid ? HANDLE_RADIUS + 2 : HANDLE_RADIUS;
        ctx.fillStyle = fill; ctx.strokeStyle = isMid ? FC.red : color; ctx.lineWidth = isMid ? 3 : 2.5;
        ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (val !== 0) {
          ctx.fillStyle = '#FFF'; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
          ctx.fillText(val > 0 ? '+' : '−', px, py + 3); ctx.textAlign = 'left';
        } else if (isMid) {
          ctx.fillStyle = FC.red; ctx.font = 'bold 9px Helvetica'; ctx.textAlign = 'center';
          ctx.fillText('mid', px, py + 3); ctx.textAlign = 'left';
        }
      }
    }
  }

  _drawReactionForces(nodes = this.pixelNodes) {
    const reactions = this._reactions || {};
    const entries = Object.entries(reactions).filter(([, value]) => Math.abs(Number(value) || 0) > 1e-6);
    if (!entries.length) return;
    const ctx = this.ctx;
    const color = FC.blue;
    for (const [key, raw] of entries) {
      const [axis, id] = key.split(':');
      const p = nodes[id];
      if (!p) continue;
      const value = Number(raw) || 0;
      if (axis === 'mz') {
        const glyph = value > 0 ? '↻' : '↺';
        ctx.fillStyle = FC.paper; ctx.strokeStyle = FC.paper; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(p[0], p[1], 31, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = color; ctx.font = 'bold 27px Helvetica'; ctx.textAlign = 'center';
        ctx.fillText(glyph, p[0] + 34, p[1] - 17);
        this._drawCanvasPill(`M${id} = ${Math.abs(value).toFixed(2)} kN·m`, p[0] + 47, p[1] - 51, color);
        ctx.textAlign = 'left';
        continue;
      }
      const ux = axis === 'rx' ? Math.sign(value) : 0;
      const uy = axis === 'ry' ? Math.sign(value) : 0;
      const start = [p[0] + ux * 12, p[1] + uy * 12];
      const end = [p[0] + ux * 58, p[1] + uy * 58];
      ctx.strokeStyle = FC.paper; ctx.fillStyle = FC.paper; ctx.lineWidth = 8;
      this._arrow(start[0], start[1], end[0], end[1]);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3.5;
      this._arrow(start[0], start[1], end[0], end[1]);
      const name = axis === 'rx' ? `H${id}` : `V${id}`;
      const lx = end[0] + (ux < 0 ? -8 : ux > 0 ? 8 : 10);
      const ly = end[1] + (uy < 0 ? -15 : uy > 0 ? 22 : -9);
      this._drawCanvasPill(`${name} = ${Math.abs(value).toFixed(2)} kN`, lx, ly, color, ux < 0 ? 'right' : 'left');
    }
    this._drawCanvasPill('AUFLAGERKRÄFTE', this._cssW - 34, 92, color, 'right');
  }

  _drawTutorHighlight(nodes = this.pixelNodes) {
    const hi = this.tutorHighlight;
    if (!hi) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = FC.purple;
    ctx.shadowColor = 'rgba(124,92,224,.45)';
    ctx.shadowBlur = 12;
    for (const barId of (hi.bars || [])) {
      const bar = this.fixture.bars.find(b => b.id === barId);
      if (!bar || !nodes[bar.from] || !nodes[bar.to]) continue;
      const s = nodes[bar.from], e = nodes[bar.to];
      ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    for (const id of (hi.nodes || [])) {
      const p = nodes[id];
      if (!p) continue;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(p[0], p[1], 22, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
    if (hi.label) this._drawCanvasPill(hi.label, this._cssW - 34, 122, FC.purple, 'right');
  }

  _drawCanvasPill(text, x, y, color, align = 'left') {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = 'bold 11px Helvetica';
    const padX = 8, h = 22, w = ctx.measureText(text).width + padX * 2;
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = FC.paper;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(left, y - h + 5, w, h, 5);
    else ctx.rect(left, y - h + 5, w, h);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.textAlign = 'left';
    ctx.fillText(text, left + padX, y - 2);
    ctx.restore();
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
