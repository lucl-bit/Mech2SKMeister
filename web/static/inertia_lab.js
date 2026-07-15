'use strict';

// Inertia Lab — Trainer für Flächenträgheitsmomente (I_y).
// Phasen pro Aufgabe:
//   1. Tabelle ausfüllen: pro Teilstück A, I_eigen und d²·A eintragen.
//   2. Multiple Choice: 8 Optionen, Wahl der richtigen Summe I_y.
//
// Der Modus ist clientseitig — keine Server-Calls. Aufgaben kommen aus
// `InertiaFixtures` plus dem Generator `generateInertiaChallenge`.

(function () {

const COLORS = {
  paper: window.THEME.paper, axis: window.THEME.text, dim: window.THEME.muted,
  partFills: window.THEME.partFills,
};

const TOL = 1e-3; // numerische Toleranz pro Zelle (Werte in Einheiten von a)

class InertiaLab {
  constructor(canvas, wrap, level) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wrap = wrap;
    this.level = level || 'mid';
    this.points = 0;
    this.streak = 0;
    this.challengeNumber = 0;
    this.phase = 'fill'; // 'fill' | 'choice' | 'done'
    this.challenge = null;
    this.options = [];
    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
  }

  start() {
    this._resize();
    this._hideExplanation();
    this.nextChallenge();
  }

  destroy() {
    window.removeEventListener('resize', this._onResize);
    const ov = document.getElementById('inertia-explanation-overlay');
    if (ov) ov.style.display = 'none';
    // Session-Ende: Punktestand still in die Bestenliste übernehmen
    if (window.Scoreboard) Scoreboard.submitQuiet('inertia', this.points);
  }

  _onResize() { this._resize(); this._draw(); }

  _resize() {
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._cw = w; this._ch = h;
  }

  // ===== Aufgaben-Laden =====
  nextChallenge() {
    this.challengeNumber++;
    // Mix: erste paar Aufgaben aus Fixtures, danach gemischt.
    const fix = window.InertiaFixtures || [];
    const useFixture = (this.challengeNumber <= fix.length) || Math.random() < 0.35;
    if (useFixture && fix.length > 0) {
      this.challenge = fix[(this.challengeNumber - 1) % fix.length];
    } else {
      this.challenge = window.generateInertiaChallenge(this.level);
    }
    this.phase = 'fill';
    this.userRows = this.challenge.parts.map(() => ({ A: '', Ieigen: '', dsqA: '', okA: null, okI: null, okD: null }));
    this.userSum = '';
    this.options = this._buildOptions();
    this._render();
  }

  // ===== Rendering =====
  _render() {
    this._drawCanvas();
    this._renderPanel();
    this._updateHeader();
  }

  _updateHeader() {
    const t = document.getElementById('inertia-title');
    if (t) t.textContent = this.challenge.title + ' — Aufgabe ' + this.challengeNumber;
    const p = document.getElementById('inertia-points');
    if (p) p.textContent = this.points + ' Punkte';
    const st = document.getElementById('inertia-status');
    if (st) st.textContent = this.phase === 'fill'
      ? 'Schritt 1/2: Trage A, I_eigen und d²·A für jedes Teil ein. Werte in Einheiten von a (a=1).'
      : this.phase === 'choice'
        ? 'Schritt 2/2: Wähle das korrekte Gesamt-I_y.'
        : 'Aufgelöst — neue Aufgabe oder Erklärung.';
  }

  _draw() { this._drawCanvas(); }

  _drawCanvas() {
    const ctx = this.ctx;
    const W = this._cw, H = this._ch;
    ctx.fillStyle = COLORS.paper;
    ctx.fillRect(0, 0, W, H);

    // Bounding box der Teile in Welt-Koordinaten bestimmen
    let minY = 0, maxY = 0, minZ = 0, maxZ = 0;
    for (const p of this.challenge.parts) {
      const ext = partExtents(p);
      minY = Math.min(minY, p.cy + ext.minY);
      maxY = Math.max(maxY, p.cy + ext.maxY);
      minZ = Math.min(minZ, p.cz + ext.minZ);
      maxZ = Math.max(maxZ, p.cz + ext.maxZ);
    }
    const pad = 0.5;
    const wy = (maxY - minY) + 2 * pad;
    const hz = (maxZ - minZ) + 2 * pad;
    const cx = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const scale = Math.min((W * 0.7) / wy, (H * 0.8) / hz);

    // Welt -> Bildschirm: y nach rechts, z nach oben.
    const toX = (y) => W / 2 + (y - cx) * scale;
    const toY = (z) => H / 2 - (z - cz) * scale;

    // Achsen
    ctx.strokeStyle = COLORS.dim;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(0, toY(0)); ctx.lineTo(W, toY(0));
    ctx.moveTo(toX(0), 0); ctx.lineTo(toX(0), H);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = COLORS.dim;
    ctx.font = '12px Helvetica, Arial, sans-serif';
    ctx.fillText('y', W - 14, toY(0) - 6);
    ctx.fillText('z', toX(0) + 6, 14);

    // Teile zeichnen
    this.challenge.parts.forEach((p, i) => {
      const color = COLORS.partFills[i % COLORS.partFills.length];
      ctx.save();
      ctx.fillStyle = p.sign > 0 ? color + '55' : '#ffffff';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      if (p.sign < 0) ctx.setLineDash([6, 4]);
      drawPartPath(ctx, p, toX, toY);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // Label
      ctx.fillStyle = color;
      ctx.font = 'bold 13px Helvetica, Arial, sans-serif';
      ctx.fillText((p.sign > 0 ? '+' : '−') + (i + 1), toX(p.cy) + 4, toY(p.cz) - 4);
    });

    // Schwerpunkt
    ctx.fillStyle = '#172033';
    ctx.beginPath(); ctx.arc(toX(0), toY(0), 3, 0, 2 * Math.PI); ctx.fill();
  }

  _renderPanel() {
    const host = document.getElementById('inertia-panel');
    if (!host) return;
    if (this.phase === 'fill') {
      host.innerHTML = this._renderTable();
      this._wireTableInputs();
    } else if (this.phase === 'choice') {
      host.innerHTML = this._renderChoices();
      this._wireChoices();
    } else {
      host.innerHTML = this._renderDone();
      this._wireDone();
    }
  }

  _renderTable() {
    const rows = this.challenge.parts.map((p, i) => {
      const r = this.userRows[i];
      const label = partLabel(p);
      const sign = p.sign > 0 ? '+' : '−';
      const dz = p.cz;
      return `
        <tr data-i="${i}">
          <td><span class="part-chip" style="background:${COLORS.partFills[i % COLORS.partFills.length]}22; color:${COLORS.partFills[i % COLORS.partFills.length]}">${sign}${i + 1}</span> ${label}</td>
          <td>${formatNum(dz)} a</td>
          <td><input data-k="A" class="inertia-input ${cls(r.okA)}" value="${r.A}" placeholder="…"> a²</td>
          <td><input data-k="Ieigen" class="inertia-input ${cls(r.okI)}" value="${r.Ieigen}" placeholder="…"> a⁴</td>
          <td><input data-k="dsqA" class="inertia-input ${cls(r.okD)}" value="${r.dsqA}" placeholder="…"> a⁴</td>
        </tr>`;
    }).join('');
    return `
      <table class="inertia-table">
        <thead>
          <tr>
            <th>Teil</th>
            <th>d (= z<sub>s</sub>)</th>
            <th>A</th>
            <th>I<sub>eigen</sub></th>
            <th>d²·A</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="inertia-actions">
        <button class="btn-accent" id="inertia-check">Tabelle prüfen</button>
        <button class="btn-back" id="inertia-skip">Direkt zu Antwortwahl →</button>
      </div>
      <div class="inertia-hint">Tipp: Rechteck I<sub>eigen</sub> = b·h³/12 · (bei Bezug auf y-Achse) · für Steiner Anteil: d² · A. Aussparungen mit negativen Beiträgen.</div>
    `;
  }

  _wireTableInputs() {
    const tbody = document.querySelector('#inertia-panel tbody');
    if (!tbody) return;
    tbody.querySelectorAll('tr').forEach((tr) => {
      const i = +tr.dataset.i;
      tr.querySelectorAll('input').forEach((inp) => {
        inp.addEventListener('input', () => {
          this.userRows[i][inp.dataset.k] = inp.value;
        });
      });
    });
    document.getElementById('inertia-check').addEventListener('click', () => this._checkTable());
    document.getElementById('inertia-skip').addEventListener('click', () => { this.phase = 'choice'; this._render(); });
  }

  _checkTable() {
    let allOk = true;
    this.challenge.parts.forEach((p, i) => {
      const r = this.userRows[i];
      const A = window.InertiaMath.partArea(p);
      const Ie = window.InertiaMath.partIyOwn(p);
      const Dq = p.cz * p.cz * A;
      r.okA = approxEqual(parseExpr(r.A), A);
      r.okI = approxEqual(parseExpr(r.Ieigen), Ie);
      r.okD = approxEqual(parseExpr(r.dsqA), Dq);
      if (!r.okA || !r.okI || !r.okD) allOk = false;
    });
    this._render();
    if (allOk) {
      this.points += 2;
      const status = document.getElementById('inertia-status');
      if (status) status.textContent = '✓ Tabelle korrekt! Jetzt: korrekte Antwort wählen.';
      setTimeout(() => { this.phase = 'choice'; this._render(); }, 700);
    } else {
      const status = document.getElementById('inertia-status');
      if (status) status.textContent = '✗ Es gibt noch fehlerhafte Zellen (rot markiert). Erneut prüfen oder direkt zur Antwortwahl.';
    }
  }

  _buildOptions() {
    const truth = window.InertiaMath.totalIy(this.challenge.parts);
    // generiere 7 plausible Distraktoren durch Skalierung/Verschiebung
    const candidates = new Set();
    candidates.add(round(truth));
    const factors = [0.5, 2/3, 4/3, 1.5, 2, 0.25, 3];
    for (const f of factors) candidates.add(round(truth * f));
    while (candidates.size < 8) candidates.add(round(truth + (Math.random() - 0.5) * truth));
    const list = Array.from(candidates).slice(0, 8);
    // Mischen
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list.map((v) => ({ value: v, label: window.InertiaMath.formatIaPow4(v), correct: Math.abs(v - truth) < 1e-3 }));
  }

  _renderChoices() {
    const tiles = this.options.map((o, i) => `
      <button class="inertia-choice" data-i="${i}">
        <span class="choice-letter">${String.fromCharCode(65 + i)}</span>
        <span class="choice-label">I<sub>y</sub> = ${o.label}</span>
      </button>`).join('');
    return `
      <div class="inertia-choices">${tiles}</div>
      <div class="inertia-actions">
        <button class="btn-back" id="inertia-back-to-table">← Zurück zur Tabelle</button>
      </div>`;
  }

  _wireChoices() {
    document.querySelectorAll('.inertia-choice').forEach((btn) => {
      btn.addEventListener('click', () => this._pickChoice(+btn.dataset.i));
    });
    document.getElementById('inertia-back-to-table').addEventListener('click', () => { this.phase = 'fill'; this._render(); });
  }

  _pickChoice(i) {
    const o = this.options[i];
    const btns = document.querySelectorAll('.inertia-choice');
    btns.forEach((b, k) => {
      if (this.options[k].correct) b.classList.add('correct');
      else if (k === i && !o.correct) b.classList.add('wrong');
      b.disabled = true;
    });
    if (o.correct) {
      this.points += 3;
      this.streak++;
      const st = document.getElementById('inertia-status');
      if (st) st.textContent = '✓ Richtig! +3 Punkte. Streak: ' + this.streak;
    } else {
      this.points = Math.max(0, this.points - 1);
      this.streak = 0;
      this._showExplanation();
    }
    this.phase = 'done';
    this._updateHeader();
    setTimeout(() => {
      const host = document.getElementById('inertia-panel');
      if (host) {
        const ad = document.createElement('div');
        ad.className = 'inertia-actions';
        ad.innerHTML = '<button class="btn-accent" id="inertia-next">Neue Aufgabe →</button>';
        host.appendChild(ad);
        document.getElementById('inertia-next').addEventListener('click', () => this.nextChallenge());
      }
    }, 200);
  }

  _showExplanation() {
    const ov = document.getElementById('inertia-explanation-overlay');
    if (!ov) return;
    const truth = window.InertiaMath.totalIy(this.challenge.parts);
    const lines = this.challenge.parts.map((p, i) => {
      const A = window.InertiaMath.partArea(p);
      const Ie = window.InertiaMath.partIyOwn(p);
      const Dq = p.cz * p.cz * A;
      const sign = p.sign > 0 ? '+' : '−';
      return `${sign} Teil ${i + 1} (${partLabel(p)}): A = ${fmt(A)} a², I_eigen = ${fmt(Ie)} a⁴, d = ${fmt(p.cz)} a → d²·A = ${fmt(Dq)} a⁴ → Beitrag = ${fmt(p.sign * (Ie + Dq))} a⁴`;
    }).join('\n');
    document.getElementById('inertia-explanation-text').textContent =
      'Zerlegung & Steiner pro Teil:\n\n' + lines + '\n\nSumme: I_y = ' + window.InertiaMath.formatIaPow4(truth) + '.';
    ov.style.display = 'flex';
  }
  _hideExplanation() {
    const ov = document.getElementById('inertia-explanation-overlay');
    if (ov) ov.style.display = 'none';
  }

  _renderDone() { return ''; }
  _wireDone() {}
}

// ----- Hilfen -----
function partLabel(p) {
  if (p.type === 'rect') return `Rechteck ${formatNum(p.b)}×${formatNum(p.h)}`;
  if (p.type === 'triangle') return `Dreieck b=${formatNum(p.b)}, h=${formatNum(p.h)}`;
  if (p.type === 'circle') return `Kreis r=${formatNum(p.r)}`;
  return '?';
}
function partExtents(p) {
  if (p.type === 'rect') return { minY: -p.b / 2, maxY: p.b / 2, minZ: -p.h / 2, maxZ: p.h / 2 };
  if (p.type === 'triangle') {
    // grob konservativ als Bounding-Box des umfassenden Rechtecks
    return { minY: -p.b / 2, maxY: p.b / 2, minZ: -p.h / 2, maxZ: p.h / 2 };
  }
  if (p.type === 'circle') return { minY: -p.r, maxY: p.r, minZ: -p.r, maxZ: p.r };
  return { minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
}
function drawPartPath(ctx, p, toX, toY) {
  ctx.beginPath();
  if (p.type === 'rect') {
    const y0 = p.cy - p.b / 2, y1 = p.cy + p.b / 2;
    const z0 = p.cz - p.h / 2, z1 = p.cz + p.h / 2;
    ctx.moveTo(toX(y0), toY(z0));
    ctx.lineTo(toX(y1), toY(z0));
    ctx.lineTo(toX(y1), toY(z1));
    ctx.lineTo(toX(y0), toY(z1));
    ctx.closePath();
  } else if (p.type === 'triangle') {
    // orient bestimmt Spitze; Centroid ist 1/3-Höhe von der Basis aus
    const o = p.orient || 'up';
    let apex, b1, b2;
    if (o === 'up') {
      const baseZ = p.cz - p.h / 3;        // Basis 1/3 unterhalb Schwerpunkt
      const apexZ = p.cz + 2 * p.h / 3;
      b1 = [p.cy - p.b / 2, baseZ]; b2 = [p.cy + p.b / 2, baseZ]; apex = [p.cy, apexZ];
    } else if (o === 'down') {
      const baseZ = p.cz + p.h / 3;
      const apexZ = p.cz - 2 * p.h / 3;
      b1 = [p.cy - p.b / 2, baseZ]; b2 = [p.cy + p.b / 2, baseZ]; apex = [p.cy, apexZ];
    } else if (o === 'right') {
      const baseY = p.cy - p.b / 3;
      const apexY = p.cy + 2 * p.b / 3;
      b1 = [baseY, p.cz - p.h / 2]; b2 = [baseY, p.cz + p.h / 2]; apex = [apexY, p.cz];
    } else { // left
      const baseY = p.cy + p.b / 3;
      const apexY = p.cy - 2 * p.b / 3;
      b1 = [baseY, p.cz - p.h / 2]; b2 = [baseY, p.cz + p.h / 2]; apex = [apexY, p.cz];
    }
    ctx.moveTo(toX(b1[0]), toY(b1[1]));
    ctx.lineTo(toX(b2[0]), toY(b2[1]));
    ctx.lineTo(toX(apex[0]), toY(apex[1]));
    ctx.closePath();
  } else if (p.type === 'circle') {
    const cxp = toX(p.cy), cyp = toY(p.cz);
    const rp = Math.abs(toX(p.cy + p.r) - cxp);
    ctx.arc(cxp, cyp, rp, 0, 2 * Math.PI);
  }
}

function parseExpr(s) {
  if (s == null) return NaN;
  s = String(s).trim();
  if (!s) return NaN;
  // erlaube Brüche "a/b"
  if (/^-?\d+(\.\d+)?\s*\/\s*-?\d+(\.\d+)?$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    return a / b;
  }
  const v = Number(s.replace(',', '.'));
  return isFinite(v) ? v : NaN;
}
function approxEqual(a, b) {
  if (!isFinite(a)) return false;
  return Math.abs(a - b) <= Math.max(TOL, Math.abs(b) * 1e-3);
}
function cls(ok) {
  if (ok === true) return 'ok';
  if (ok === false) return 'bad';
  return '';
}
function formatNum(x) {
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
  // versuche Bruch
  for (let d = 2; d <= 6; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-3) return n + '/' + d;
  }
  return x.toFixed(2);
}
function fmt(x) { return formatNum(x); }
function round(x) { return Math.round(x * 1000) / 1000; }

window.InertiaLab = InertiaLab;
})();
