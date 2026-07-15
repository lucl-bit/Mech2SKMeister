'use strict';

// Scoreboard — Highscores pro Modus.
//
// Storage-Interface: `Scoreboard.store` kapselt die Persistenz. Aktuell
// localStorage (nur dieser Browser); für ein echtes globales Board nach dem
// Deploy dieselben vier Methoden gegen ein Server-Backend austauschen.
(function () {

const MAX_ENTRIES = 10;

const localStore = {
  list(mode) {
    try {
      return JSON.parse(localStorage.getItem('mech2.scores.' + mode)) || [];
    } catch (e) { return []; }
  },
  save(mode, entries) {
    localStorage.setItem('mech2.scores.' + mode, JSON.stringify(entries));
  },
  playerName() { return localStorage.getItem('mech2.playerName') || ''; },
  setPlayerName(name) { localStorage.setItem('mech2.playerName', name); },
};

const MODES = [
  { id: 'basics',   label: 'The Basics',    color: () => window.THEME.blue },
  { id: 'fachwerk', label: 'Fachwerk Profi', color: () => window.THEME.purple },
  { id: 'speedrun', label: 'Speed Run',     color: () => window.THEME.orange },
  { id: 'inertia',  label: 'Inertia Lab',   color: () => window.THEME.teal },
];

const Scoreboard = {
  store: localStore,

  list(mode) { return this.store.list(mode); },

  playerName() { return this.store.playerName(); },
  setPlayerName(name) { this.store.setPlayerName((name || '').trim().slice(0, 24)); },

  // Platz (1-basiert), den `score` einnehmen würde — oder null, wenn zu niedrig.
  placement(mode, score) {
    if (!(score > 0)) return null;
    const entries = this.list(mode);
    let rank = entries.filter(e => e.score >= score).length + 1;
    return rank <= MAX_ENTRIES ? rank : null;
  },

  submit(mode, name, score, extra = {}) {
    const rank = this.placement(mode, score);
    if (rank === null) return null;
    const entries = this.list(mode);
    entries.push({
      name: (name || 'Anonym').trim().slice(0, 24) || 'Anonym',
      score: Math.round(score),
      streak: extra.streak || 0,
      date: new Date().toISOString().slice(0, 10),
    });
    entries.sort((a, b) => b.score - a.score);
    this.store.save(mode, entries.slice(0, MAX_ENTRIES));
    return rank;
  },

  // Stiller Abschluss einer Session (Basics/Fachwerk/Inertia beim Verlassen):
  // trägt unter dem gemerkten Namen ein, fragt nicht nach.
  submitQuiet(mode, score, extra = {}) {
    if (this.placement(mode, score) === null) return null;
    return this.submit(mode, this.playerName() || 'Anonym', score, extra);
  },

  // ===== Overlay =====
  open(activeMode) {
    const overlay = document.getElementById('scoreboard-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    this._render(activeMode || 'speedrun');
  },

  close() {
    const overlay = document.getElementById('scoreboard-overlay');
    if (overlay) overlay.style.display = 'none';
  },

  _render(activeMode) {
    const tabs = document.getElementById('scoreboard-tabs');
    const body = document.getElementById('scoreboard-body');
    const nameInput = document.getElementById('scoreboard-name');
    if (!tabs || !body) return;

    tabs.innerHTML = '';
    for (const m of MODES) {
      const btn = document.createElement('button');
      btn.textContent = m.label;
      btn.className = m.id === activeMode ? 'active' : '';
      btn.onclick = () => this._render(m.id);
      tabs.appendChild(btn);
    }

    const entries = this.list(activeMode);
    if (!entries.length) {
      body.innerHTML = '<p class="scoreboard-empty">Noch keine Einträge — spiel eine Runde und knack die Liste.</p>';
    } else {
      const rows = entries.map((e, i) => `
        <tr>
          <td class="rank">${i + 1}</td>
          <td class="name">${this._esc(e.name)}</td>
          <td class="score">${e.score}</td>
          <td class="date">${e.date || ''}</td>
        </tr>`).join('');
      body.innerHTML = `
        <table class="scoreboard-table">
          <thead><tr><th>#</th><th>Name</th><th>Punkte</th><th>Datum</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`;
    }

    if (nameInput) {
      nameInput.value = this.playerName();
      nameInput.onchange = () => this.setPlayerName(nameInput.value);
    }
  },

  _esc(s) {
    return String(s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
};

window.Scoreboard = Scoreboard;

})();
