'use strict';

// Statik-Assistent „Ritter" — regelbasierter Tutor für den Fachwerk-Profi-
// Modus. Keine externe API: alle Tipps und der Lösungsweg werden lokal aus
// Fixture-Geometrie + Solver-Lösung generiert.
(function () {

const HINT_COST = 10; // Punkte pro Tipp ab Stufe 2
const IDLE_HELP_DELAY = 45000;

class StatikTutor {
  constructor(fc) {
    this.fc = fc;           // FrameChallenge-Instanz
    this.hintLevel = 0;
    this.walkStep = 0;
    this.walkSteps = [];
    this.panel = null;
    this.idleTimer = null;
    this.idlePrompted = false;
    this._activityHandler = () => this.noteActivity();
  }

  // ===== Panel-Lebenszyklus =====

  attach() {
    const wrap = document.getElementById('game-canvas-wrap');
    if (!wrap || this.panel) return;
    const panel = document.createElement('div');
    panel.className = 'tutor-panel collapsed';
    panel.innerHTML = `
      <button class="tutor-fab" type="button" title="Statik-Assistent">📐</button>
      <div class="tutor-body">
        <div class="tutor-head">
          <strong>📐 Ritter — Statik-Assistent</strong>
          <button class="tutor-close" type="button">✕</button>
        </div>
        <div class="tutor-messages"></div>
        <div class="tutor-actions">
          <button class="btn-back tutor-hint" type="button">Tipp (−${HINT_COST} P ab Stufe 2)</button>
          <button class="btn-back tutor-why" type="button">Warum?</button>
          <button class="btn-back tutor-reactions" type="button">Lagerkräfte einzeichnen</button>
          <button class="btn-back tutor-show" type="button">Im Bild zeigen</button>
        </div>
      </div>
      <div class="tutor-nudge" role="status" aria-live="polite">
        <strong>Brauchst du Hilfe?</strong>
        <span>Ich kann dir den nächsten Ansatz direkt im System markieren.</span>
        <div>
          <button class="btn-accent tutor-nudge-yes" type="button">Ja, zeig mal</button>
          <button class="btn-back tutor-nudge-no" type="button">Gerade nicht</button>
        </div>
      </div>`;
    wrap.appendChild(panel);
    this.panel = panel;
    panel.querySelector('.tutor-fab').onclick = () => this._toggle(true);
    panel.querySelector('.tutor-close').onclick = () => this._toggle(false);
    panel.querySelector('.tutor-hint').onclick = () => this.nextHint();
    panel.querySelector('.tutor-why').onclick = () => this.why();
    panel.querySelector('.tutor-reactions').onclick = () => this.toggleReactions();
    panel.querySelector('.tutor-show').onclick = () => this.showOnCanvas();
    panel.querySelector('.tutor-nudge-yes').onclick = () => {
      panel.classList.remove('nudging');
      this.showOnCanvas();
    };
    panel.querySelector('.tutor-nudge-no').onclick = () => panel.classList.remove('nudging');
    window.addEventListener('pointerdown', this._activityHandler, true);
    window.addEventListener('keydown', this._activityHandler, true);
    this._scheduleIdle();
  }

  detach() {
    clearTimeout(this.idleTimer);
    window.removeEventListener('pointerdown', this._activityHandler, true);
    window.removeEventListener('keydown', this._activityHandler, true);
    if (this.panel) { this.panel.remove(); this.panel = null; }
    const ov = document.getElementById('walkthrough-overlay');
    if (ov) ov.style.display = 'none';
  }

  _toggle(open) {
    if (!this.panel) return;
    this.panel.classList.toggle('collapsed', !open);
    this.panel.classList.remove('nudging');
    this.panel.querySelector('.tutor-fab').classList.remove('tutor-pulse');
  }

  noteActivity() {
    if (!this.panel) return;
    if (this.panel.classList.contains('nudging')) this.panel.classList.remove('nudging');
    this._scheduleIdle();
  }

  _scheduleIdle() {
    clearTimeout(this.idleTimer);
    if (this.idlePrompted) return;
    this.idleTimer = setTimeout(() => this._offerIdleHelp(), IDLE_HELP_DELAY);
  }

  _offerIdleHelp() {
    if (!this.panel || document.hidden) { this._scheduleIdle(); return; }
    this.idlePrompted = true;
    if (this.panel.classList.contains('collapsed')) {
      this.panel.classList.add('nudging');
      this.panel.querySelector('.tutor-fab').classList.add('tutor-pulse');
    } else {
      this._say('Brauchst du Hilfe? Ich kann Lagerkräfte einzeichnen oder den nächsten sinnvollen Schritt im System markieren.', 'tutor-info');
    }
  }

  _say(text, cls = '') {
    if (!this.panel) return;
    const box = this.panel.querySelector('.tutor-messages');
    const div = document.createElement('div');
    div.className = 'tutor-msg ' + cls;
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    if (this.panel.classList.contains('collapsed')) {
      this.panel.querySelector('.tutor-fab').classList.add('tutor-pulse');
    }
  }

  _clear() {
    if (this.panel) this.panel.querySelector('.tutor-messages').textContent = '';
    const old = this.panel && this.panel.querySelector('.tutor-result');
    if (old) old.remove();
  }

  newTask() {
    this.hintLevel = 0;
    this.idlePrompted = false;
    this.fc.showReactions = false;
    this.fc.tutorHighlight = null;
    this._clear();
    this._say('Neue Aufgabe! Frag mich nach einem Tipp, wenn du hängst — der erste ist gratis.', 'tutor-info');
    this._syncReactionButton();
    this._scheduleIdle();
  }

  toggleReactions() {
    this._toggle(true);
    this.fc.showReactions = !this.fc.showReactions;
    this.fc.tutorHighlight = this.fc.showReactions
      ? { nodes: Object.keys(this.fc.fixture.supports || {}), label: 'Auflagerreaktionen' }
      : null;
    this._syncReactionButton();
    this._say(this.fc.showReactions
      ? 'Die Auflagerkräfte sind jetzt am System eingezeichnet. Pfeilrichtung und Betrag kommen direkt aus dem Gleichgewicht des Gesamtsystems.'
      : 'Auflagerkräfte wieder ausgeblendet.', 'tutor-info');
    this.fc.draw();
  }

  _syncReactionButton() {
    const btn = this.panel && this.panel.querySelector('.tutor-reactions');
    if (!btn) return;
    btn.textContent = this.fc.showReactions ? 'Lagerkräfte ausblenden' : 'Lagerkräfte einzeichnen';
    btn.classList.toggle('tutor-action-active', this.fc.showReactions);
  }

  showOnCanvas() {
    this._toggle(true);
    const target = this._wrongOrEmptyBar();
    if (target) {
      this.fc.tutorHighlight = { bars: [target], label: `Nächster Schritt: Stab ${target}` };
      this._say(`Ich habe Stab ${target} markiert. ${this._concreteHint()}`, 'tutor-hint1');
    } else {
      const supports = Object.keys(this.fc.fixture.supports || {});
      this.fc.showReactions = true;
      this.fc.tutorHighlight = { nodes: supports, label: 'Hier mit dem Gesamtsystem starten' };
      this._syncReactionButton();
      this._say('Starte hier: Gesamtsystem freischneiden und mit ΣFx = 0, ΣFy = 0 und ΣM = 0 die Auflagerreaktionen bestimmen.', 'tutor-hint1');
    }
    this.fc.draw();
  }

  // ===== Tipp-Engine (gestufte Hints) =====

  nextHint() {
    this._toggle(true);
    this.hintLevel++;
    if (this.hintLevel >= 2) {
      this.fc.points -= HINT_COST;
      this.fc._updatePoints && this.fc._updatePoints();
      const el = document.getElementById('game-points');
      if (el) el.textContent = (this.fc.points >= 0 ? '+' : '') + this.fc.points + ' Punkte';
    }
    if (this.hintLevel === 1) this._say(this._methodHint(), 'tutor-hint1');
    else if (this.hintLevel === 2) this._say(this._concreteHint(), 'tutor-hint2');
    else this._say(this._revealHint(), 'tutor-hint3');
  }

  _methodHint() {
    const fc = this.fc;
    if (fc.kind === 'N') {
      const zero = this._findZeroForceRule();
      if (zero) return zero;
      return 'Starte mit den Auflagerreaktionen (ΣFx = 0, ΣFy = 0, ΣM = 0). Danach Knotenpunktverfahren: nimm einen Knoten mit höchstens 2 unbekannten Stäben.';
    }
    if (fc.kind === 'M') {
      return 'M ist an Gelenken, gelenkigen Lagern und freien Enden null. Zwischen Punktlasten verläuft M linear, unter Streckenlast parabolisch. Starte dort, wo M bekannt null ist.';
    }
    return 'Q springt an jeder Einzelkraft um deren Betrag und ist zwischen den Lasten konstant (bei Streckenlast linear). Bestimme zuerst die Auflagerreaktionen.';
  }

  // Nullstab-Regeln konkret am Fixture prüfen und den Knoten benennen.
  _findZeroForceRule() {
    const fix = this.fc.fixture;
    const loadedNodes = new Set((fix.loads || []).filter(l => l.kind === 'point' || l.kind === 'z').map(l => l.node));
    const supported = new Set(Object.keys(fix.supports || {}));
    const barsAt = {};
    for (const b of fix.bars) {
      (barsAt[b.from] = barsAt[b.from] || []).push(b);
      (barsAt[b.to] = barsAt[b.to] || []).push(b);
    }
    const dirOf = (b, node) => {
      const o = b.from === node ? b.to : b.from;
      const n1 = fix.nodes[node], n2 = fix.nodes[o];
      const dx = n2.x - n1.x, dy = n2.y - n1.y, l = Math.hypot(dx, dy) || 1;
      return [dx / l, dy / l];
    };
    const collinear = (u, v) => Math.abs(u[0] * v[1] - u[1] * v[0]) < 1e-6;
    for (const [node, bars] of Object.entries(barsAt)) {
      if (loadedNodes.has(node) || supported.has(node)) continue;
      if (bars.length === 2 && !collinear(dirOf(bars[0], node), dirOf(bars[1], node))) {
        return `Schau dir Knoten ${node} an: unbelastet, nur 2 nicht-kollineare Stäbe (${bars[0].id}, ${bars[1].id}) → beide sind Nullstäbe.`;
      }
      if (bars.length === 3) {
        for (let i = 0; i < 3; i++) {
          const others = bars.filter((_, k) => k !== i);
          if (collinear(dirOf(others[0], node), dirOf(others[1], node))) {
            return `Schau dir Knoten ${node} an: 2 der 3 Stäbe fluchten → der dritte (${bars[i].id}) ist ein Nullstab.`;
          }
        }
      }
    }
    return null;
  }

  _concreteHint() {
    const fc = this.fc;
    const wrong = this._wrongOrEmptyBar();
    if (!wrong) return 'Sieht schon gut aus — prüf deine Antwort!';
    const role = this._barRole(wrong);
    if (fc.kind === 'N') {
      return `Nimm dir Stab ${wrong} vor (${role}). Faustregel bei Last nach unten: Obergurt gedrückt, Untergurt gezogen — Diagonalen entscheidet das Knotengleichgewicht. Schneide den Knoten frei und bilanziere die Vertikalkräfte.`;
    }
    return `Nimm dir Stab ${wrong} vor. Schneide an einer Stelle im Stab und bilanziere alles links vom Schnitt — nutze dafür auch das ✂-Schnitt-Tool unten.`;
  }

  _revealHint() {
    const fc = this.fc;
    const wrong = this._wrongOrEmptyBar();
    if (!wrong) return 'Alles gesetzt — jetzt nur noch prüfen!';
    const sol = (fc._solutionsOf() || {})[fc.kind];
    if (!sol || !sol[wrong]) return 'Ich kenne die Lösung hier selbst noch nicht — drück kurz „Lösung zeigen".';
    const [s, e] = sol[wrong].split(',').map(Number);
    const word = v => v > 0 ? 'positiv' : v < 0 ? 'negativ' : 'null';
    if (fc.kind === 'N') {
      const n = Number(s);
      return `Stab ${wrong}: N ist ${word(n)}${n !== 0 ? (n > 0 ? ' (Zug)' : ' (Druck)') : ' (Nullstab)'}.`;
    }
    return `Stab ${wrong}: ${fc.kind} beginnt ${word(s)} und endet ${word(e)}.`;
  }

  _wrongOrEmptyBar() {
    const fc = this.fc;
    const sol = (fc._solutionsOf() || {})[fc.kind];
    if (!sol) return null;
    const sgn = v => v > 0 ? '1' : v < 0 ? '-1' : '0';
    for (const bar of fc.fixture.bars) {
      const a = fc.answers[bar.id];
      if (!a || !sol[bar.id]) continue;
      const [s, e] = sol[bar.id].split(',');
      if (sgn(a.start) !== s || sgn(a.end) !== e) return bar.id;
    }
    return null;
  }

  _barRole(barId) {
    const fix = this.fc.fixture;
    const b = fix.bars.find(x => x.id === barId);
    if (!b) return 'Stab';
    const n1 = fix.nodes[b.from], n2 = fix.nodes[b.to];
    const dx = Math.abs(n2.x - n1.x), dy = Math.abs(n2.y - n1.y);
    const ys = Object.values(fix.nodes).map(n => n.y);
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (dy < 1e-6) return (n1.y < midY ? 'Obergurt' : 'Untergurt');
    if (dx < 1e-6) return 'Pfosten';
    return 'Diagonale';
  }

  // ===== „Warum?" — Konvention erklären =====

  why() {
    this._toggle(true);
    const k = this.fc.kind;
    const texts = {
      N: 'N ist positiv bei Zug: die Schnittufer werden auseinandergezogen. Im idealen Fachwerk tragen Stäbe nur N — Vorzeichen also direkt Zug (+) oder Druck (−).',
      Q: 'Q ist positiv, wenn die Kraft am linken Schnittufer nach oben zeigt (Konvention x→, y↓). Q springt an jeder Einzelkraft.',
      M: 'M ist das Moment um die +z-Achse (z zeigt in die Ebene). Ein durchhängender Balken (Zugseite unten) hat damit negatives M — positives M heisst Zug oben.',
    };
    this._say(texts[k] || texts.N, 'tutor-info');
  }

  // ===== Nach der Abgabe =====

  afterCheck(correct, total) {
    if (!this.panel) return;
    this._toggle(true);
    const old = this.panel.querySelector('.tutor-result');
    if (old) old.remove();
    this._say(correct === total
      ? `Alle ${total} Stäbe richtig — sauber!`
      : `${correct}/${total} richtig. Willst du den Lösungsweg Schritt für Schritt sehen?`,
      correct === total ? 'tutor-ok' : 'tutor-info');
    const row = document.createElement('div');
    row.className = 'tutor-result';
    const btnWalk = document.createElement('button');
    btnWalk.className = 'btn-accent'; btnWalk.type = 'button';
    btnWalk.textContent = 'Lösungsweg anzeigen';
    btnWalk.onclick = () => this.showWalkthrough();
    const btnNext = document.createElement('button');
    btnNext.className = 'btn-back'; btnNext.type = 'button';
    btnNext.textContent = 'Weiter →';
    btnNext.onclick = () => this.fc.nextChallenge();
    row.appendChild(btnWalk); row.appendChild(btnNext);
    this.panel.querySelector('.tutor-body').appendChild(row);
  }

  // ===== Lösungsweg (Schritt-für-Schritt-Overlay) =====

  showWalkthrough() {
    this.walkSteps = this._buildSteps();
    this.walkStep = 0;
    const ov = document.getElementById('walkthrough-overlay');
    if (!ov || !this.walkSteps.length) return;
    ov.style.display = 'flex';
    document.getElementById('walk-prev').onclick = () => this._walkGo(-1);
    document.getElementById('walk-next').onclick = () => this._walkGo(1);
    document.getElementById('walk-close').onclick = () => { ov.style.display = 'none'; };
    this._renderStep();
  }

  _walkGo(d) {
    this.walkStep = Math.max(0, Math.min(this.walkSteps.length - 1, this.walkStep + d));
    this._renderStep();
  }

  _renderStep() {
    const step = this.walkSteps[this.walkStep];
    document.getElementById('walk-title').textContent =
      `Schritt ${this.walkStep + 1}/${this.walkSteps.length}: ${step.title}`;
    document.getElementById('walk-text').textContent = step.text;
    document.getElementById('walk-prev').disabled = this.walkStep === 0;
    document.getElementById('walk-next').disabled = this.walkStep === this.walkSteps.length - 1;
    this._drawStepSketch(step);
  }

  _buildSteps() {
    const fc = this.fc;
    const fix = fc.fixture;
    const steps = [];

    // 1. Auflagerreaktionen
    const reactParts = [];
    for (const [key, val] of Object.entries(fc._reactions || {})) {
      const [axis, node] = key.split(':');
      if (Math.abs(val) < 1e-6) continue;
      const glyph = axis === 'rx' ? (val > 0 ? '→' : '←') : axis === 'ry' ? (val > 0 ? '↓' : '↑') : '↻';
      const name = axis === 'rx' ? 'H' : axis === 'ry' ? 'V' : 'M';
      reactParts.push(`${name}(${node}) = ${Math.abs(val).toFixed(2)} ${axis === 'mz' ? 'kN·m' : 'kN ' + glyph}`);
    }
    steps.push({
      title: 'Auflagerreaktionen',
      text: 'Gleichgewicht am Gesamtsystem: ΣFx = 0, ΣFy = 0, ΣM = 0. Ergebnis: '
        + (reactParts.length ? reactParts.join(';  ') : 'siehe Lager — alle Reaktionen folgen aus den drei Gleichungen.'),
      highlight: Object.keys(fix.supports || {}),
    });

    const isTruss = !(fix.welds || []).length && !(fix.loads || []).some(l => l.kind === 'distributed');
    if (isTruss && fc._forces) {
      // 2..n Knotenpunktverfahren in lösbarer Reihenfolge
      const known = new Set();
      const supported = new Set(Object.keys(fix.supports || {}));
      const barsAt = {};
      for (const b of fix.bars) {
        (barsAt[b.from] = barsAt[b.from] || []).push(b);
        (barsAt[b.to] = barsAt[b.to] || []).push(b);
      }
      const remaining = new Set(fix.bars.map(b => b.id));
      // Startknoten: Lager (dort sind Reaktionen bekannt), dann fortschreiten
      let guard = 0;
      const nodeQueue = Object.keys(fix.nodes);
      while (remaining.size && guard++ < 60) {
        let progress = false;
        for (const node of nodeQueue) {
          const unknown = (barsAt[node] || []).filter(b => remaining.has(b.id));
          if (!unknown.length || unknown.length > 2) continue;
          const parts = unknown.map(b => {
            const f = fc._forces[b.id];
            const N = f ? f.N_start : 0;
            const kind = Math.abs(N) < 1e-6 ? 'Nullstab' : N > 0 ? `Zug, N = +${N.toFixed(2)}` : `Druck, N = ${N.toFixed(2)}`;
            remaining.delete(b.id);
            return `${b.id}: ${kind}`;
          });
          const knownBars = (barsAt[node] || []).filter(b => !unknown.includes(b) && known.has(b.id));
          steps.push({
            title: `Knoten ${node} freischneiden`,
            text: `Am Knoten ${node} sind höchstens 2 Stabkräfte unbekannt → ΣFx = 0 und ΣFy = 0 reichen. `
              + (supported.has(node) ? `Die Auflagerreaktion bei ${node} geht mit ein. ` : '')
              + (knownBars.length ? `Bereits bekannt: ${knownBars.map(b => b.id).join(', ')}. ` : '')
              + `Ergebnis: ${parts.join(';  ')}.`,
            highlight: [node],
            bars: unknown.map(b => b.id),
          });
          unknown.forEach(b => known.add(b.id));
          progress = true;
        }
        if (!progress) break;
      }
      if (remaining.size) {
        steps.push({
          title: 'Restliche Stäbe (Ritter-Schnitt)',
          text: `Für ${[...remaining].join(', ')} bietet sich ein Ritter-Schnitt an (✂-Tool!): `
            + [...remaining].map(id => {
              const f = fc._forces[id];
              const N = f ? f.N_start : 0;
              return `${id}: N = ${N > 0 ? '+' : ''}${N.toFixed(2)}`;
            }).join(';  '),
          bars: [...remaining],
        });
      }
    } else if (fc._forces) {
      // Rahmen: pro Stab eine Karte mit N/Q/M in Kurs-Konvention
      for (const b of fix.bars) {
        const f = fc._forces[b.id];
        if (!f) continue;
        const Ms = -f.M_start, Me = -f.M_end;
        const qDesc = Math.abs(f.Q_start - f.Q_end) < 1e-6 ? 'Q konstant' : 'Q veränderlich';
        const mDesc = Math.abs(Ms - Me) < 1e-6 ? 'M konstant' : 'M linear/parabolisch';
        steps.push({
          title: `Stab ${b.id} freischneiden`,
          text: `N = ${f.N_start.toFixed(2)} kN;  Q: ${f.Q_start.toFixed(2)} → ${f.Q_end.toFixed(2)} kN (${qDesc});  `
            + `M: ${Ms.toFixed(2)} → ${Me.toFixed(2)} kN·m (${mDesc}, Kurs-Konvention M um +z).`,
          highlight: [b.from, b.to],
          bars: [b.id],
        });
      }
    }
    return steps;
  }

  _drawStepSketch(step) {
    const cvs = document.getElementById('walk-canvas');
    if (!cvs) return;
    const fc = this.fc, fix = fc.fixture;
    const dpr = window.devicePixelRatio || 1;
    const rect = cvs.getBoundingClientRect();
    const w = Math.max(rect.width, 300), h = Math.max(rect.height, 180);
    cvs.width = Math.round(w * dpr); cvs.height = Math.round(h * dpr);
    const ctx = cvs.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const c = window.THEME;
    ctx.fillStyle = c.paper; ctx.fillRect(0, 0, w, h);

    // Fixture klein layouten
    const bb = fix.bbox;
    const m = 34;
    const s = Math.min((w - 2 * m) / bb.w, (h - 2 * m) / bb.h);
    const ox = (w - bb.w * s) / 2, oy = (h - bb.h * s) / 2;
    const P = id => [ox + fix.nodes[id].x * s, oy + fix.nodes[id].y * s];

    const hiBars = new Set(step.bars || []);
    for (const b of fix.bars) {
      const p1 = P(b.from), p2 = P(b.to);
      ctx.strokeStyle = hiBars.has(b.id) ? c.purple : c.beam;
      ctx.lineWidth = hiBars.has(b.id) ? 5 : 2.5;
      ctx.globalAlpha = hiBars.size && !hiBars.has(b.id) ? 0.35 : 1;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    const hiNodes = new Set(step.highlight || []);
    for (const id of Object.keys(fix.nodes)) {
      const [px, py] = P(id);
      const hot = hiNodes.has(id);
      ctx.fillStyle = hot ? c.purple : c.paper;
      ctx.strokeStyle = hot ? c.purple : c.beam;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, hot ? 8 : 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = c.text; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(id, px, py - 12); ctx.textAlign = 'left';
    }
  }
}

window.StatikTutor = StatikTutor;

})();
