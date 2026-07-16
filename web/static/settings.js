'use strict';

// Einstellungen-Tab: passwortgeschützte Verwaltung der Fachwerk-Datenbank
// (Server-Store /api/fixtures). Passwort gilt pro Browser-Session.
const Settings = {
  _fixtures: [],

  _pw() { return sessionStorage.getItem('mech2.settingsPw') || ''; },

  open() {
    const gate = document.getElementById('settings-gate');
    const content = document.getElementById('settings-content');
    if (this._pw()) {
      gate.style.display = 'none';
      content.style.display = '';
      this.renderList();
    } else {
      gate.style.display = '';
      content.style.display = 'none';
      document.getElementById('settings-gate-error').textContent = '';
      const input = document.getElementById('settings-password');
      input.value = '';
      setTimeout(() => input.focus(), 50);
    }
  },

  async login() {
    const input = document.getElementById('settings-password');
    const err = document.getElementById('settings-gate-error');
    const pw = input.value;
    try {
      const resp = await fetch('/api/fixtures/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const data = await resp.json();
      if (!data.ok) { err.textContent = 'Falsches Passwort.'; input.select(); return; }
      sessionStorage.setItem('mech2.settingsPw', pw);
      this.open();
    } catch (e) {
      err.textContent = 'Server nicht erreichbar.';
    }
  },

  logout() {
    sessionStorage.removeItem('mech2.settingsPw');
    this.open();
  },

  async renderList() {
    const list = document.getElementById('settings-list');
    const info = document.getElementById('settings-info');
    list.innerHTML = '';
    info.textContent = 'Lade Fachwerke…';
    let fixtures = null;
    try {
      const data = await (await fetch('/api/fixtures')).json();
      if (data.ok && Array.isArray(data.fixtures)) fixtures = data.fixtures;
    } catch (e) { /* Server-Store fehlt */ }
    if (!fixtures) {
      fixtures = window.FRAME_FIXTURES || [];
      info.textContent = 'Server-Datenbank fehlt — zeige eingebaute Fixtures. Speichern legt die Datenbank an.';
    } else {
      info.textContent = `${fixtures.length} Fachwerke in der Datenbank.`;
    }
    this._fixtures = fixtures;

    for (const fix of fixtures) {
      const card = document.createElement('div');
      card.className = 'fixture-card';

      const canvas = document.createElement('canvas');
      canvas.className = 'fixture-preview';
      card.appendChild(canvas);
      // Zeichnen erst nach dem Layout — dann stimmt clientWidth (scharf, unverzerrt)
      requestAnimationFrame(() => this.drawPreview(canvas, fix));

      const body = document.createElement('div');
      body.className = 'fixture-card-body';
      const title = document.createElement('div');
      title.className = 'fixture-card-title';
      title.textContent = fix.title || fix.id;
      const meta = document.createElement('div');
      meta.className = 'fixture-card-meta';
      meta.textContent = fix.source || fix.id;
      body.appendChild(title);
      body.appendChild(meta);
      card.appendChild(body);

      const actions = document.createElement('div');
      actions.className = 'fixture-card-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn-tool';
      editBtn.textContent = '✏ Bearbeiten';
      editBtn.onclick = () => this.edit(fix.id);
      const delBtn = document.createElement('button');
      delBtn.className = 'btn-tool fixture-delete';
      delBtn.textContent = '🗑 Löschen';
      delBtn.onclick = () => this.remove(fix.id);
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(actions);

      list.appendChild(card);
    }
  },

  // Kompakte, eigenständige Vorschau (y-down wie die Fixture-Konvention).
  drawPreview(canvas, fix) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 220, H = canvas.clientHeight || 130, pad = 26;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);
    const labels = Object.keys(fix.nodes || {});
    if (!labels.length) return;
    const xs = labels.map(l => fix.nodes[l].x), ys = labels.map(l => fix.nodes[l].y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 0.5), spanY = Math.max(maxY - minY, 0.5);
    const s = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2;
    const px = l => ox + (fix.nodes[l].x - minX) * s;
    const py = l => oy + (fix.nodes[l].y - minY) * s;

    // Stäbe
    ctx.strokeStyle = '#263447'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    for (const b of (fix.bars || [])) {
      ctx.beginPath(); ctx.moveTo(px(b.from), py(b.from)); ctx.lineTo(px(b.to), py(b.to)); ctx.stroke();
    }
    // Streckenlasten: kleine Pfeilreihe über dem Stab
    ctx.strokeStyle = '#D9534F'; ctx.fillStyle = '#D9534F'; ctx.lineWidth = 1.2;
    for (const l of (fix.loads || [])) {
      if (l.kind !== 'distributed') continue;
      const b = (fix.bars || []).find(bb => bb.id === l.bar);
      if (!b) continue;
      const x1 = px(b.from), y1 = py(b.from), x2 = px(b.to), y2 = py(b.to);
      const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      const nx = dy / len, ny = -dx / len; // Normale (oberhalb)
      for (let t = 0.15; t <= 0.85; t += 0.235) {
        const bx = x1 + dx * t, by = y1 + dy * t;
        ctx.beginPath();
        ctx.moveTo(bx + nx * 12, by + ny * 12);
        ctx.lineTo(bx + nx * 3, by + ny * 3);
        ctx.stroke();
      }
    }
    // Lager
    for (const [label, type] of Object.entries(fix.supports || {})) {
      const x = px(label), y = py(label);
      ctx.strokeStyle = '#2F6FED'; ctx.fillStyle = '#E8F0FF'; ctx.lineWidth = 1.6;
      if (type === 'fixed') {
        ctx.beginPath(); ctx.moveTo(x - 8, y + 2); ctx.lineTo(x + 8, y + 2); ctx.stroke();
        for (let i = -6; i <= 6; i += 4) {
          ctx.beginPath(); ctx.moveTo(x + i, y + 2); ctx.lineTo(x + i - 3, y + 7); ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 9); ctx.lineTo(x + 6, y + 9);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        if (type.startsWith('roller')) {
          ctx.beginPath(); ctx.moveTo(x - 7, y + 12); ctx.lineTo(x + 7, y + 12); ctx.stroke();
        }
      }
    }
    // Punktlasten als Pfeile
    ctx.strokeStyle = '#D9534F'; ctx.fillStyle = '#D9534F'; ctx.lineWidth = 2;
    for (const l of (fix.loads || [])) {
      if (l.kind !== 'point' || !fix.nodes[l.node]) continue;
      const x = px(l.node), y = py(l.node);
      const mag = Math.hypot(l.fx || 0, l.fy || 0) || 1;
      const ux = (l.fx || 0) / mag, uy = (l.fy || 0) / mag, L = 18;
      const x2 = x + ux * L, y2 = y + uy * L;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - ux * 6 + uy * 3.5, y2 - uy * 6 - ux * 3.5);
      ctx.lineTo(x2 - ux * 6 - uy * 3.5, y2 - uy * 6 + ux * 3.5);
      ctx.closePath(); ctx.fill();
    }
    // Knoten
    for (const l of labels) {
      ctx.fillStyle = '#FBFDFF'; ctx.strokeStyle = '#2F6FED'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(px(l), py(l), 3.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  },

  edit(id) {
    const fix = this._fixtures.find(f => f.id === id);
    if (!fix) return;
    App.showTrussBuilder(fix, { fromSettings: true });
  },

  addNew() {
    App.showTrussBuilder(null, { fromSettings: true });
  },

  async remove(id) {
    const fix = this._fixtures.find(f => f.id === id);
    if (!confirm(`"${(fix && fix.title) || id}" wirklich aus der Datenbank löschen?`)) return;
    try {
      const resp = await fetch(`/api/fixtures/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Settings-Password': this._pw() },
      });
      const data = await resp.json();
      if (!data.ok) {
        document.getElementById('settings-info').textContent = `Löschen fehlgeschlagen: ${data.error || resp.status}`;
        return;
      }
      window.__remoteFixtures = null; // Spiel-Cache invalidieren
      this.renderList();
    } catch (e) {
      document.getElementById('settings-info').textContent = 'Löschen fehlgeschlagen: Server nicht erreichbar.';
    }
  },
};

window.Settings = Settings;
