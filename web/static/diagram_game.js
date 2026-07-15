'use strict';

const C = window.THEME; // zentrale Palette (theme.js)

const MODE_CONFIG = {
  basics:    { title: 'The Basics',     range: [1, 10],   timer: null, color: '#2F6FED' },
  fachwerk:  { title: 'Fachwerk Profi', range: [11, 20],  timer: null, color: '#7C5CE0' },
  speedrun:  { title: 'Speed Run',      range: [1, 20],   timer: 30,   color: '#D98634' },
};

class DiagramGame {
  constructor(canvas, wrap, mode) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = wrap;
    this.mode = mode || 'basics';
    this.cfg = MODE_CONFIG[this.mode] || MODE_CONFIG.basics;
    this.challenge = null;
    this.optionBoxes = {};
    this.selectedId = null;
    this.checkedId = null;
    this.points = 0;
    this.streak = 0;
    this.challengeNumber = 1;
    this.timerSeconds = 0;
    this.timerInterval = null;
    this.gameOver = false;
    this._onClick = this._onClick.bind(this);
    this._onResize = this._onResize.bind(this);
    canvas.addEventListener('pointerup', this._onClick);
    window.addEventListener('resize', this._onResize);
  }

  destroy() {
    this._clearTimer();
    this.canvas.removeEventListener('pointerup', this._onClick);
    window.removeEventListener('resize', this._onResize);
  }

  start() {
    document.getElementById('game-mode-title').textContent = this.cfg.title;
    const timerEl = document.getElementById('game-timer');
    timerEl.style.display = this.cfg.timer ? '' : 'none';
    this._hideExplanation();
    this._hideGameover();
    this._resize();
    this.loadChallenge();
  }

  restart() {
    this.points = 0;
    this.streak = 0;
    this.challengeNumber = 1;
    this.gameOver = false;
    this._hideGameover();
    this._hideExplanation();
    this.loadChallenge();
  }

  _pickChallengeNumber() {
    const [lo, hi] = this.cfg.range;
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  async loadChallenge() {
    this._clearTimer();
    this._setFeedback(this.mode === 'speedrun' ? 'Schnell! Klicke den richtigen Verlauf.' : 'Klicke den richtigen Verlauf an.', C.muted);
    const chNum = this._pickChallengeNumber();
    const resp = await fetch('/api/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        convention_id: 'uni',
        challenge_number: chNum,
        seed: Math.floor(Math.random() * 1e9),
      }),
    });
    this.challenge = await resp.json();
    this.selectedId = null;
    this.checkedId = null;
    this.optionBoxes = {};
    this._updateStatus();
    this.draw();
    if (this.cfg.timer) this._startTimer(this.cfg.timer);
  }

  nextChallenge() {
    if (this.gameOver) return;
    this.challengeNumber++;
    this.loadChallenge();
  }

  _startTimer(seconds) {
    this.timerSeconds = seconds;
    this._updateTimerDisplay();
    this.timerInterval = setInterval(() => {
      this.timerSeconds -= 0.1;
      if (this.timerSeconds <= 0) {
        this.timerSeconds = 0;
        this._updateTimerDisplay();
        this._clearTimer();
        this._triggerGameover('Zeit abgelaufen!');
        return;
      }
      this._updateTimerDisplay();
    }, 100);
  }

  _clearTimer() {
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
  }

  _updateTimerDisplay() {
    const el = document.getElementById('game-timer');
    el.textContent = this.timerSeconds.toFixed(1) + 's';
    el.classList.toggle('warn', this.timerSeconds < 8);
  }

  _onClick(e) {
    if (!this.challenge || this.checkedId !== null || this.gameOver) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    for (const [id, b] of Object.entries(this.optionBoxes)) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        this._checkOption(id);
        return;
      }
    }
  }

  _checkOption(optionId) {
    this.selectedId = optionId;
    this.checkedId = optionId;
    const isCorrect = optionId === this.challenge.correct_option_id;
    this._clearTimer();
    if (isCorrect) {
      this.points += 100;
      this.streak++;
      this._setFeedback('✓ Richtig! ' + this.challenge.explanation, C.green);
      this._saveProgress(true);
      this.draw();
      if (this.mode === 'speedrun') {
        setTimeout(() => this.nextChallenge(), 900);
      } else {
        setTimeout(() => this.nextChallenge(), 1600);
      }
    } else {
      this.points -= 100;
      this._setFeedback('✗ Falsch.', C.red);
      this._saveProgress(false);
      this.draw();
      if (this.mode === 'speedrun') {
        this._triggerGameover('Falsche Antwort!');
      } else {
        setTimeout(() => this._showExplanation(), 350);
      }
    }
    this._updateStatus();
  }

  _triggerGameover(reason) {
    this.gameOver = true;
    this._clearTimer();
    document.getElementById('gameover-reason').textContent = reason;
    document.getElementById('gameover-score').textContent = this.points + ' Punkte';
    document.getElementById('gameover-streak').textContent =
      'Du hast ' + this.streak + ' Aufgabe' + (this.streak === 1 ? '' : 'n') + ' in Folge richtig gelöst.';
    document.getElementById('gameover-overlay').style.display = 'flex';
  }

  _hideGameover() { document.getElementById('gameover-overlay').style.display = 'none'; }

  // ===== EXPLANATION OVERLAY =====
  _showExplanation() {
    const ch = this.challenge;
    document.getElementById('explanation-title').textContent =
      'Warum ist das die richtige Antwort? (' + ch.diagram_kind + '-Verlauf)';
    document.getElementById('explanation-text').textContent =
      this._enhanceExplanation(ch.explanation);
    document.getElementById('explanation-overlay').style.display = 'flex';
    this._drawExplanationCanvas();
  }

  _enhanceExplanation(base) {
    const ch = this.challenge;
    if (!ch || !ch.beam || ch.challenge_type !== 'beam') return base;
    const load = ch.beam.point_loads[0];
    const kind = ch.diagram_kind;
    const fx = load && load.force_x || 0;
    const fy = load && load.force_y || 0;
    const sys = ch.system_type === 'cantilever_left' ? 'Kragträger' : 'Einfeldträger';
    if (kind === 'N') {
      if (Math.abs(fx) < 1e-6) return base + ' Da keine horizontale Kraft wirkt, ist N überall null.';
      return base + ' Die horizontale Kraft F_x = ' + fx + ' kN greift an der Lasteinleitung an. Links davon nimmt das Auflager die Reaktion auf → dort ist N ≠ 0. Rechts der Last gibt es keine horizontale Kraft mehr → N = 0.';
    }
    if (kind === 'Q') {
      return base + ' Q springt an der Lasteinleitung um den Betrag der Last (' + Math.abs(fy) + ' kN). ' + sys + ': beachte das Vorzeichen entsprechend der Auflagerreaktionen.';
    }
    if (kind === 'M') {
      return base + ' Das Biegemoment ist an gelenkigen Auflagern null und hat sein Maximum/Extremum unter der Lasteinleitung. Im ' + sys + ' steigt M linear bis zur Last.';
    }
    return base;
  }

  dismissExplanation() {
    this._hideExplanation();
    this.nextChallenge();
  }

  _hideExplanation() {
    document.getElementById('explanation-overlay').style.display = 'none';
  }

  _drawExplanationCanvas() {
    const cvs = document.getElementById('explanation-canvas');
    const dpr = window.devicePixelRatio || 1;
    const rect = cvs.getBoundingClientRect();
    const w = Math.max(rect.width || 640, 320);
    const h = Math.max(rect.height || 220, 160);
    cvs.width = Math.round(w * dpr);
    cvs.height = Math.round(h * dpr);
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);

    const ch = this.challenge;
    if (!ch) return;
    const color = this._diagramColor();

    if (ch.challenge_type !== 'beam' || !ch.beam) {
      ctx.fillStyle = C.text; ctx.font = 'bold 16px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText('Richtige Antwort markiert ✓', w / 2, h / 2);
      return;
    }

    const beam = ch.beam;
    const start = 60, end = w - 60;
    const beamY = 70;
    const scale = (end - start) / beam.length;
    const sx = xv => start + xv * scale;

    // Title
    ctx.fillStyle = color; ctx.font = 'bold 22px Helvetica'; ctx.textAlign = 'left';
    ctx.fillText(ch.diagram_kind, 14, 30);
    ctx.fillStyle = C.text; ctx.font = 'bold 13px Helvetica';
    ctx.fillText('-Verlauf am ' + (ch.system_type === 'cantilever_left' ? 'Kragträger' : 'Einfeldträger'), 36, 30);

    // Beam
    ctx.strokeStyle = C.beam; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(start, beamY); ctx.lineTo(end, beamY); ctx.stroke();

    // Supports
    for (const sup of beam.supports) {
      this._drawMiniSupport(ctx, sx(sup.x), beamY, sup.support_type);
    }

    // Loads
    for (const load of beam.point_loads) {
      const lx = sx(load.x);
      if (Math.abs(load.force_y) > 1e-6) {
        ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 2.5;
        this._miniArrow(ctx, lx, beamY - 50, lx, beamY - 8);
        ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'left';
        ctx.fillText(Math.abs(load.force_y) + ' kN', lx + 6, beamY - 42);
      }
      if (Math.abs(load.force_x) > 1e-6) {
        ctx.strokeStyle = C.orange; ctx.fillStyle = C.orange; ctx.lineWidth = 2.5;
        const dir = load.force_x > 0 ? 1 : -1;
        this._miniArrow(ctx, lx - dir * 42, beamY, lx - dir * 6, beamY);
        ctx.font = 'bold 11px Helvetica';
        ctx.fillText(Math.abs(load.force_x) + ' kN', lx + (dir > 0 ? -68 : 10), beamY - 5);
      }
    }

    // Correct diagram below beam
    const correctOpt = ch.options.find(o => o.is_correct);
    if (correctOpt) {
      const dY = 130, dH = 90;
      ctx.fillStyle = color + '18';
      ctx.fillRect(start - 6, dY - 6, end - start + 12, dH + 12);
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.strokeRect(start - 6, dY - 6, end - start + 12, dH + 12);
      ctx.setLineDash([]);
      ctx.fillStyle = color; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'left';
      ctx.fillText('Korrekter ' + ch.diagram_kind + '-Verlauf:', start, dY - 12);

      const left = start, right = end;
      const top = dY + 8, bottom = dY + dH - 8, center = dY + dH / 2;
      const loadAt = sx(beam.point_loads[0] ? beam.point_loads[0].x : beam.length / 2);
      const halfAt = (left + right) / 2;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
      this._drawShapeOn(ctx, correctOpt.shape, left, right, top, bottom, center, loadAt, halfAt, color);

      // Center reference line
      ctx.strokeStyle = C.muted; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(left, center); ctx.lineTo(right, center); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  _drawShapeOn(ctx, shape, left, right, top, bottom, center, loadAt, halfAt, color) {
    const line = (...pts) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        if (i === 0) ctx.moveTo(pts[i], pts[i+1]);
        else ctx.lineTo(pts[i], pts[i+1]);
      }
      ctx.stroke();
    };
    const badge = (x, y, t) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.fillStyle = C.paper; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = color; ctx.font = 'bold 12px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(t, x, y + 4); ctx.restore();
    };
    switch (shape) {
      case 'zero': line(left, center, right, center); break;
      case 'constant_positive': line(left, center, left, top, right, top, right, center); badge(halfAt, top + 14, '+'); break;
      case 'constant_negative': line(left, center, left, bottom, right, bottom, right, center); badge(halfAt, bottom - 14, '−'); break;
      case 'n_left_positive': line(left, center, left, top, loadAt, top, loadAt, center, right, center); badge((left+loadAt)/2, top + 14, '+'); break;
      case 'n_left_negative': line(left, center, left, bottom, loadAt, bottom, loadAt, center, right, center); badge((left+loadAt)/2, bottom - 14, '−'); break;
      case 'shear_positive_then_negative': line(left, top, loadAt, top); line(loadAt, top, loadAt, bottom); line(loadAt, bottom, right, bottom); badge((left+loadAt)/2, top+14, '+'); badge((loadAt+right)/2, bottom-14, '−'); break;
      case 'shear_negative_then_positive': line(left, bottom, loadAt, bottom); line(loadAt, bottom, loadAt, top); line(loadAt, top, right, top); badge((left+loadAt)/2, bottom-14, '−'); badge((loadAt+right)/2, top+14, '+'); break;
      case 'shear_positive_then_zero': line(left, top, loadAt, top); line(loadAt, top, loadAt, center); line(loadAt, center, right, center); badge((left+loadAt)/2, top+14, '+'); break;
      case 'shear_negative_then_zero': line(left, bottom, loadAt, bottom); line(loadAt, bottom, loadAt, center); line(loadAt, center, right, center); badge((left+loadAt)/2, bottom-14, '−'); break;
      case 'moment_triangle_positive': line(left, center, halfAt, top, right, center); badge(halfAt, top+14, '+'); break;
      case 'moment_triangle_negative': line(left, center, halfAt, bottom, right, center); badge(halfAt, bottom-14, '−'); break;
      case 'moment_peak_left_positive':
      case 'moment_peak_right_positive': line(left, center, loadAt, top, right, center); badge(loadAt, top+14, '+'); break;
      case 'moment_peak_left_negative':
      case 'moment_peak_right_negative': line(left, center, loadAt, bottom, right, center); badge(loadAt, bottom-14, '−'); break;
      case 'moment_cantilever_positive': line(left, top, loadAt, center, right, center); badge((left+loadAt)/2, top+14, '+'); break;
      case 'moment_cantilever_negative': line(left, bottom, loadAt, center, right, center); badge((left+loadAt)/2, bottom-14, '−'); break;
      case 'shear_linear_pos_to_neg': line(left, top, right, bottom); badge(left + (right-left)*0.25, top+14, '+'); badge(left + (right-left)*0.75, bottom-14, '−'); break;
      case 'shear_linear_neg_to_pos': line(left, bottom, right, top); badge(left + (right-left)*0.25, bottom-14, '−'); badge(left + (right-left)*0.75, top+14, '+'); break;
      case 'moment_parabola_positive': this._drawParabola(ctx, left, right, center, top); badge(halfAt, top+14, '+'); break;
      case 'moment_parabola_negative': this._drawParabola(ctx, left, right, center, bottom); badge(halfAt, bottom-14, '−'); break;
    }
  }

  _drawMiniSupport(ctx, x, y, type) {
    if (type === 'fixed') {
      const wx = x - 12;
      ctx.strokeStyle = C.beam; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(wx, y - 26); ctx.lineTo(wx, y + 26); ctx.stroke();
      ctx.lineWidth = 1.5;
      for (let off = -22; off <= 26; off += 8) {
        ctx.beginPath(); ctx.moveTo(wx - 10, y + off + 6); ctx.lineTo(wx, y + off); ctx.stroke();
      }
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(x + 10, y); ctx.stroke();
      return;
    }
    ctx.strokeStyle = C.beam; ctx.fillStyle = '#F8FAFE'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 5); ctx.lineTo(x - 10, y + 24); ctx.lineTo(x + 10, y + 24);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (type === 'roller') {
      ctx.beginPath(); ctx.arc(x - 6, y + 30, 3, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 6, y + 30, 3, 0, Math.PI*2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x - 14, y + 28); ctx.lineTo(x + 14, y + 28); ctx.stroke();
    }
  }

  _miniArrow(ctx, x1, y1, x2, y2) {
    const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx/len, uy = dy/len, nx = -uy, ny = ux;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux*10 + nx*4, y2 - uy*10 + ny*4);
    ctx.lineTo(x2 - ux*10 - nx*4, y2 - uy*10 - ny*4);
    ctx.closePath(); ctx.fill();
  }

  _updateStatus() {
    const label = this.mode === 'speedrun'
      ? `Aufgabe ${this.challengeNumber} • Streak ${this.streak}`
      : `Aufgabe ${this.challengeNumber}`;
    document.getElementById('game-status').textContent = label;
    const el = document.getElementById('game-points');
    el.textContent = (this.points >= 0 ? '+' : '') + this.points + ' Punkte';
    el.style.color = this.points >= 0 ? this.cfg.color : '#D9534F';
  }

  _setFeedback(msg, color) {
    const el = document.getElementById('game-feedback');
    el.textContent = msg;
    el.style.color = color;
  }

  async _saveProgress(wasCorrect) {
    try {
      await fetch('/api/save-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'diagram_choice', points: this.points,
          last_answer_correct: wasCorrect, active_convention: 'uni',
        }),
      });
    } catch (e) { /* ignore offline */ }
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

  // ===== MAIN DRAWING (unchanged from original) =====

  draw() {
    const w = this._cssW || this.canvas.width, h = this._cssH || this.canvas.height;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    this._drawGrid(w, h);
    this._drawCoordSystem(44, h - 130);
    if (!this.challenge) return;
    this._drawHeader(w);
    if (this.challenge.challenge_type === 'beam') this._drawBeam(w, 118);
    else if (this.challenge.challenge_type === 'truss') this._drawTrussSystem(w, 122);
    else if (this.challenge.challenge_type === 'frame') this._drawFrameSystem(w, 122);
    this._drawOptions(w, h);
  }

  _drawGrid(w, h) {
    const ctx = this.ctx, minor = 24, major = 96;
    ctx.lineWidth = 1;
    for (let x = 0; x <= w + minor; x += minor) {
      ctx.strokeStyle = (x % major === 0) ? C.gridMajor : C.gridMinor;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y <= h + minor; y += minor) {
      ctx.strokeStyle = (y % major === 0) ? C.gridMajor : C.gridMinor;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  _drawCoordSystem(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = C.text; ctx.fillStyle = C.text; ctx.lineWidth = 3;
    this._arrowLine(x, y, x + 72, y);
    this._arrowLine(x, y, x, y + 72);
    ctx.font = 'bold 13px Helvetica';
    ctx.fillText('x', x + 80, y + 5);
    ctx.fillText('y', x - 5, y + 86);
  }

  _drawHeader(w) {
    if (!this.challenge) return;
    const ctx = this.ctx;
    const color = this._diagramColor();
    ctx.fillStyle = color; ctx.font = 'bold 44px Helvetica';
    ctx.textAlign = 'left';
    ctx.fillText(this.challenge.diagram_kind, 42, 55);
    ctx.fillStyle = C.text; ctx.font = 'bold 18px Helvetica';
    ctx.fillText(this.challenge.title, 108, 50);
    ctx.fillStyle = C.muted; ctx.font = 'bold 12px Helvetica';
    ctx.textAlign = 'right';
    ctx.fillText('Wähle A, B oder C', w - 42, 50);
    ctx.textAlign = 'left';
  }

  _drawBeam(w, y) {
    const ch = this.challenge, beam = ch.beam;
    if (!beam) return;
    const ctx = this.ctx;
    const start = 150, end = w - 190;
    const scale = (end - start) / beam.length;
    const sx = xv => start + xv * scale;

    ctx.strokeStyle = C.beam; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(start, y); ctx.lineTo(end, y); ctx.stroke();
    ctx.strokeStyle = C.muted; ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(start, y - 9); ctx.lineTo(end, y - 9); ctx.stroke();
    ctx.setLineDash([]);

    for (const sup of beam.supports) this._drawBeamSupport(sx(sup.x), y, sup.support_type, sup.label);

    if (ch.system_type === 'cantilever_left') {
      ctx.fillStyle = C.muted; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'right';
      ctx.fillText('freies Ende', end + 50, y + 38); ctx.textAlign = 'left';
    }

    const distributed = beam.distributed_loads || [];
    for (const q of distributed) {
      this._drawBeamDistributedLoad(sx(q.x_start), sx(q.x_end), y, q.q);
    }

    for (const load of beam.point_loads) {
      const lx = sx(load.x);
      const fy = load.force_y, fx = load.force_x || 0;
      if (Math.abs(fy) > 1e-6) {
        ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 3;
        this._arrowLine(lx, y - 72, lx, y - 14);
        ctx.font = 'bold 12px Helvetica';
        ctx.fillText(`${Math.abs(fy)} kN`, lx + 10, y - 62);
      }
      if (Math.abs(fx) > 1e-6) {
        ctx.strokeStyle = C.orange; ctx.fillStyle = C.orange; ctx.lineWidth = 3;
        const dir = fx > 0 ? 1 : -1;
        this._arrowLine(lx - dir * 60, y, lx - dir * 10, y);
        ctx.font = 'bold 12px Helvetica';
        ctx.fillText(`${Math.abs(fx)} kN`, lx + (dir > 0 ? -80 : 14), y - 10);
      }
    }
  }

  _drawBeamDistributedLoad(x1, x2, y, qValue) {
    const ctx = this.ctx;
    const top = y - 56;
    ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1, top); ctx.lineTo(x2, top); ctx.stroke();
    const span = x2 - x1;
    const n = Math.max(4, Math.min(10, Math.round(span / 36)));
    for (let i = 0; i <= n; i++) {
      const x = x1 + (span * i) / n;
      this._arrowLine(x, top, x, y - 8);
    }
    ctx.font = 'bold 12px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText('q = ' + Math.abs(qValue) + ' kN/m', (x1 + x2) / 2, top - 6);
    ctx.textAlign = 'left';
  }

  _drawBeamSupport(x, y, type, label) {
    const ctx = this.ctx;
    if (type === 'fixed') {
      const wx = x - 18;
      ctx.strokeStyle = C.beam; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(wx, y - 46); ctx.lineTo(wx, y + 46); ctx.stroke();
      ctx.lineWidth = 2;
      for (let off = -42; off <= 47; off += 12) {
        ctx.beginPath(); ctx.moveTo(wx - 18, y + off + 10); ctx.lineTo(wx, y + off); ctx.stroke();
      }
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(wx, y); ctx.lineTo(x + 18, y); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(label, wx - 8, y + 68); ctx.textAlign = 'left';
      return;
    }
    ctx.strokeStyle = C.beam; ctx.fillStyle = '#F8FAFE'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 8); ctx.lineTo(x - 16, y + 36); ctx.lineTo(x + 16, y + 36);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    if (type === 'roller') {
      ctx.beginPath(); ctx.arc(x - 10, y + 44, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(x + 10, y + 44, 5, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 24, y + 52); ctx.lineTo(x + 24, y + 52); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x - 22, y + 39); ctx.lineTo(x + 22, y + 39); ctx.stroke();
    }
    ctx.fillStyle = C.muted; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText(label, x, y + 62); ctx.textAlign = 'left';
  }

  _drawTrussSystem(w, y) {
    const truss = this.challenge.truss;
    if (!truss) return;
    const pts = this._visualPoints(truss, 150, y, w - 190, y + 92);
    const ctx = this.ctx;
    ctx.strokeStyle = C.beam; ctx.lineWidth = 5;
    for (const bar of truss.bars) {
      const s = pts[bar.start_id], e = pts[bar.end_id];
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    for (const sup of truss.supports) {
      const [px, py] = pts[sup.joint_id];
      if (sup.support_type === 'roller') this._drawSimpleRoller(px, py);
      else this._drawSimplePin(px, py);
    }
    for (const load of truss.loads) {
      const [px, py] = pts[load.joint_id];
      ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 3;
      this._arrowLine(px, py, px + load.fx * 4, py + load.fy * 4);
      ctx.font = 'bold 12px Helvetica';
      ctx.fillText(`${Math.abs(load.fy)} kN`, px + load.fx * 4 + 10, py + load.fy * 4 - 8);
    }
    for (const joint of truss.joints) {
      const [px, py] = pts[joint.joint_id];
      ctx.strokeStyle = C.blue; ctx.fillStyle = C.paper; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  _drawFrameSystem(w, y) {
    const frame = this.challenge.frame;
    if (!frame) return;
    const pts = this._visualPoints(frame, 150, y, w - 190, y + 105);
    const ctx = this.ctx;
    ctx.strokeStyle = C.beam; ctx.lineWidth = 6;
    for (const bar of frame.bars) {
      const s = pts[bar.start_id], e = pts[bar.end_id];
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    for (const sup of frame.supports) {
      const [px, py] = pts[sup.joint_id];
      if (sup.support_type === 'fixed') this._drawSmallFixed(px, py);
      else if (sup.support_type === 'roller') this._drawSimpleRoller(px, py);
      else this._drawSimplePin(px, py);
    }
    for (const bar of frame.bars) {
      if (frame.distributed_bars.includes(bar.bar_id)) {
        const s = pts[bar.start_id], e = pts[bar.end_id];
        this._drawDistribLoad(s, e);
      }
    }
    for (const load of frame.loads) {
      const [px, py] = pts[load.joint_id];
      ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 3;
      this._arrowLine(px, py - 54, px, py - 10);
      ctx.font = 'bold 12px Helvetica';
      ctx.fillText('F', px + 10, py - 48);
    }
    for (const joint of frame.joints) {
      const [px, py] = pts[joint.joint_id];
      ctx.strokeStyle = C.beam; ctx.fillStyle = C.paper; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  _drawSimplePin(x, y) {
    const ctx = this.ctx;
    ctx.strokeStyle = C.beam; ctx.fillStyle = '#F8FAFE'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 10); ctx.lineTo(x - 16, y + 38); ctx.lineTo(x + 16, y + 38);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 23, y + 41); ctx.lineTo(x + 23, y + 41); ctx.stroke();
  }

  _drawSimpleRoller(x, y) {
    this._drawSimplePin(x, y);
    const ctx = this.ctx;
    ctx.beginPath(); ctx.arc(x - 9, y + 48, 5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(x + 9, y + 48, 5, 0, Math.PI * 2); ctx.stroke();
  }

  _drawSmallFixed(x, y) {
    const ctx = this.ctx;
    const wx = x - 16;
    ctx.strokeStyle = C.beam; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(wx, y - 35); ctx.lineTo(wx, y + 35); ctx.stroke();
    ctx.lineWidth = 2;
    for (let off = -30; off <= 36; off += 12) {
      ctx.beginPath(); ctx.moveTo(wx - 13, y + off + 8); ctx.lineTo(wx, y + off); ctx.stroke();
    }
  }

  _drawDistribLoad(s, e) {
    const ctx = this.ctx;
    ctx.strokeStyle = C.load; ctx.fillStyle = C.load; ctx.lineWidth = 2;
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const x = s[0] + (e[0] - s[0]) * t, y = s[1] + (e[1] - s[1]) * t;
      this._arrowLine(x, y - 40, x, y - 8);
    }
    ctx.font = 'bold 13px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText('q', (s[0] + e[0]) / 2, s[1] - 48); ctx.textAlign = 'left';
  }

  _drawOptions(w, h) {
    if (!this.challenge) return;
    const boxW = Math.min(480, w * 0.52);
    const boxH = 78;
    const x0 = (w - boxW) / 2;
    const startY = Math.max(240, h * 0.36);
    const gap = 64;
    this.challenge.options.forEach((opt, idx) => {
      this._drawOption(opt, x0, startY + idx * (boxH + gap), boxW, boxH);
    });
  }

  _drawOption(opt, x, y, w, h) {
    const ctx = this.ctx;
    const selected = opt.option_id === this.selectedId;
    const checked = this.checkedId !== null;
    let outline = C.border, lw = 2;
    if (checked && opt.is_correct) { outline = C.green; lw = 5; }
    else if (checked && selected && !opt.is_correct) { outline = C.red; lw = 5; }
    else if (selected) { outline = C.blue; lw = 4; }

    this.optionBoxes[opt.option_id] = { x, y, w, h };

    ctx.strokeStyle = outline; ctx.lineWidth = lw;
    ctx.fillStyle = C.paper;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.stroke();

    ctx.fillStyle = C.text; ctx.font = 'bold 20px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText(opt.label, x - 34, y + h / 2 + 7); ctx.textAlign = 'left';

    const midY = y + h / 2;
    ctx.strokeStyle = C.muted; ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(x + 10, midY); ctx.lineTo(x + w - 10, midY); ctx.stroke();
    ctx.setLineDash([]);

    this._drawShape(opt.shape, x, y, w, h);
  }

  _drawShape(shape, x, y, w, h) {
    const ctx = this.ctx;
    const left = x + 12, right = x + w - 12;
    const center = y + h / 2, top = y + 10, bottom = y + h - 10;
    const color = this._diagramColor();
    const loadRatio = this._loadRatio();
    const loadAt = left + (right - left) * loadRatio;
    const halfAt = (left + right) / 2;

    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;

    if (shape.startsWith('truss:')) { this._drawLineSystemOption(shape, x, y, w, h, 'truss'); return; }
    if (shape.startsWith('frame:')) { this._drawLineSystemOption(shape, x, y, w, h, 'frame'); return; }

    const line = (...pts) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i += 2) {
        if (i === 0) ctx.moveTo(pts[i], pts[i+1]);
        else ctx.lineTo(pts[i], pts[i+1]);
      }
      ctx.stroke();
    };

    switch (shape) {
      case 'zero':
        line(left, center, right, center); break;

      case 'constant_positive':
        line(left, center, left, top, right, top, right, center);
        this._signBadge(halfAt, top + 16, '+', color); break;

      case 'constant_negative':
        line(left, center, left, bottom, right, bottom, right, center);
        this._signBadge(halfAt, bottom - 16, '-', color); break;

      case 'n_left_positive':
        line(left, center, left, top, loadAt, top, loadAt, center, right, center);
        this._signBadge((left + loadAt) / 2, top + 16, '+', color); break;

      case 'n_left_negative':
        line(left, center, left, bottom, loadAt, bottom, loadAt, center, right, center);
        this._signBadge((left + loadAt) / 2, bottom - 16, '-', color); break;

      case 'shear_positive_then_negative':
        line(left, top, loadAt, top); line(loadAt, top, loadAt, bottom); line(loadAt, bottom, right, bottom);
        this._signBadge((left + loadAt) / 2, top + 16, '+', color);
        this._signBadge((loadAt + right) / 2, bottom - 16, '-', color); break;

      case 'shear_negative_then_positive':
        line(left, bottom, loadAt, bottom); line(loadAt, bottom, loadAt, top); line(loadAt, top, right, top);
        this._signBadge((left + loadAt) / 2, bottom - 16, '-', color);
        this._signBadge((loadAt + right) / 2, top + 16, '+', color); break;

      case 'shear_positive_then_zero':
        line(left, top, loadAt, top); line(loadAt, top, loadAt, center); line(loadAt, center, right, center);
        this._signBadge((left + loadAt) / 2, top + 16, '+', color); break;

      case 'shear_negative_then_zero':
        line(left, bottom, loadAt, bottom); line(loadAt, bottom, loadAt, center); line(loadAt, center, right, center);
        this._signBadge((left + loadAt) / 2, bottom - 16, '-', color); break;

      case 'moment_triangle_positive':
        line(left, center, halfAt, top, right, center);
        this._signBadge(halfAt, top + 16, '+', color); break;

      case 'moment_triangle_negative':
        line(left, center, halfAt, bottom, right, center);
        this._signBadge(halfAt, bottom - 16, '-', color); break;

      case 'moment_peak_left_positive':
      case 'moment_peak_right_positive':
        line(left, center, loadAt, top, right, center);
        this._signBadge(loadAt, top + 16, '+', color); break;

      case 'moment_peak_left_negative':
      case 'moment_peak_right_negative':
        line(left, center, loadAt, bottom, right, center);
        this._signBadge(loadAt, bottom - 16, '-', color); break;

      case 'moment_cantilever_positive':
        line(left, top, loadAt, center, right, center);
        this._signBadge((left + loadAt) / 2, top + 16, '+', color); break;

      case 'moment_cantilever_negative':
        line(left, bottom, loadAt, center, right, center);
        this._signBadge((left + loadAt) / 2, bottom - 16, '-', color); break;

      case 'triangle_positive':
        line(left, center, right, top, right, center);
        this._signBadge((left + right) / 2, top + 16, '+', color); break;

      case 'shear_linear_pos_to_neg':
        line(left, top, right, bottom);
        this._signBadge(left + (right - left) * 0.25, top + 16, '+', color);
        this._signBadge(left + (right - left) * 0.75, bottom - 16, '-', color); break;

      case 'shear_linear_neg_to_pos':
        line(left, bottom, right, top);
        this._signBadge(left + (right - left) * 0.25, bottom - 16, '-', color);
        this._signBadge(left + (right - left) * 0.75, top + 16, '+', color); break;

      case 'moment_parabola_positive':
        this._drawParabola(ctx, left, right, center, top);
        this._signBadge(halfAt, top + 16, '+', color); break;

      case 'moment_parabola_negative':
        this._drawParabola(ctx, left, right, center, bottom);
        this._signBadge(halfAt, bottom - 16, '-', color); break;
    }
  }

  _drawParabola(ctx, left, right, center, peakY) {
    const steps = 24;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;            // 0..1
      const x = left + (right - left) * t;
      // Parabolic shape: y = peak * 4 t (1 - t); zero at ends, max at midspan.
      const peakOffset = peakY - center;
      const y = center + 4 * t * (1 - t) * peakOffset;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  _drawLineSystemOption(shape, x, y, w, h, system) {
    const visual = system === 'truss' ? this.challenge.truss : this.challenge.frame;
    if (!visual) return;
    const encoded = shape.split(':')[1];
    const signs = encoded.split('').map(c => c === 'p' ? 1 : c === 'm' ? -1 : 0);
    const pts = this._visualPoints(visual, x + 34, y + 14, x + w - 34, y + h - 14);
    const ctx = this.ctx;
    ctx.strokeStyle = C.beam; ctx.lineWidth = system === 'frame' ? 4 : 3;
    for (const bar of visual.bars) {
      const s = pts[bar.start_id], e = pts[bar.end_id];
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
    }
    visual.bars.forEach((bar, idx) => {
      this._drawMemberArea(pts[bar.start_id], pts[bar.end_id], idx < signs.length ? signs[idx] : 0);
    });
    for (const joint of visual.joints) {
      const [px, py] = pts[joint.joint_id];
      ctx.strokeStyle = C.blue; ctx.fillStyle = C.paper; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }

  _drawMemberArea(s, e, sign) {
    if (sign === 0) {
      const ctx = this.ctx;
      ctx.strokeStyle = C.green; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.stroke();
      ctx.setLineDash([]); return;
    }
    const dx = e[0]-s[0], dy = e[1]-s[1], len = Math.hypot(dx, dy);
    if (len < 1e-9) return;
    const nx = -dy/len, ny = dx/len, off = sign * 13;
    const sx = s[0]+nx*off, sy = s[1]+ny*off, ex = e[0]+nx*off, ey = e[1]+ny*off;
    const color = sign > 0 ? C.green : C.orange;
    const ctx = this.ctx;
    ctx.fillStyle = sign > 0 ? '#E4F4EA' : '#FFF0DF'; ctx.strokeStyle = color; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s[0], s[1]); ctx.lineTo(e[0], e[1]); ctx.lineTo(ex, ey); ctx.lineTo(sx, sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    this._signBadge((s[0]+e[0]+sx+ex)/4, (s[1]+e[1]+sy+ey)/4, sign > 0 ? '+' : '-', color);
  }

  _visualPoints(visual, left, top, right, bottom) {
    const xs = visual.joints.map(j => j.x), ys = visual.joints.map(j => j.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX-minX, 1), spanY = Math.max(maxY-minY, 1);
    const pts = {};
    for (const j of visual.joints) {
      pts[j.joint_id] = [
        left + (j.x-minX)/spanX*(right-left),
        top  + (j.y-minY)/spanY*(bottom-top),
      ];
    }
    return pts;
  }

  _signBadge(x, y, text, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color; ctx.fillStyle = C.paper; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 10px Helvetica'; ctx.textAlign = 'center';
    ctx.fillText(text, x, y + 4); ctx.textAlign = 'left';
  }

  _arrowLine(x1, y1, x2, y2) {
    const ctx = this.ctx;
    const dx = x2-x1, dy = y2-y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx/len, uy = dy/len, nx = -uy, ny = ux;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux*14 + nx*6, y2 - uy*14 + ny*6);
    ctx.lineTo(x2 - ux*14 - nx*6, y2 - uy*14 - ny*6);
    ctx.closePath(); ctx.fill();
  }

  _diagramColor() {
    if (!this.challenge) return C.text;
    if (this.challenge.diagram_kind === 'N') return C.green;
    if (this.challenge.diagram_kind === 'Q') return C.purple;
    return C.red;
  }

  _loadRatio() {
    const ch = this.challenge;
    if (!ch || !ch.beam || !ch.beam.point_loads.length) return 0.5;
    return ch.beam.point_loads[0].x / ch.beam.length;
  }
}
