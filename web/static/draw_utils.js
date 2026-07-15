'use strict';

// Gemeinsame Zeichen-/Geometrie-Helfer für Builder und Zeichnen-Modus.
// Lädt nach theme.js, vor den Modul-Skripten.
//
// Physik-Prinzip der Lagersymbole: Die Orientierung zeigt die
// Reaktionsrichtung des Solvers, nicht die "freie Seite" der Struktur.
//   - pin/roller: Solver fixiert y (roller) bzw. x+y (pin) → Symbol steht
//     nur auf dem Boden oder hängt an der Decke, nie seitlich.
//   - fixed: Einspannung nimmt alles auf → Wand rechtwinklig zum
//     austretenden Stab (exakt bei einem Stab, sonst Mittelrichtung).
window.DrawUtils = {

  // Mittlere Einheitsrichtung von "Knoten → Struktur weg" aus den Positionen
  // der Nachbarknoten. null, wenn keine Nachbarn oder Richtungen sich aufheben.
  awayVec(x, y, neighbors) {
    let sx = 0, sy = 0;
    for (const [ox, oy] of neighbors) {
      const dx = ox - x, dy = oy - y, len = Math.hypot(dx, dy);
      if (len > 1e-9) { sx += dx / len; sy += dy / len; }
    }
    const len = Math.hypot(sx, sy);
    if (len < 1e-6) return null;
    return [-sx / len, -sy / len];
  },

  // Boden (+1, Symbol unter dem Knoten) oder Decke (−1, Symbol darüber).
  // Decke nur, wenn die Struktur klar nach unten weiterläuft.
  supportSide(x, y, neighbors) {
    const away = this.awayVec(x, y, neighbors);
    return (away && away[1] < -0.3) ? -1 : 1;
  },

  // Festlager: Dreieck + Grundstrich, Boden- oder Deckenlage.
  drawPin(ctx, x, y, side, opts = {}) {
    const c = window.THEME;
    const stroke = opts.stroke || c.beam, fill = opts.fill || '#F0F4FA';
    const s = opts.scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, side);
    ctx.strokeStyle = stroke; ctx.fillStyle = fill; ctx.lineWidth = opts.lineWidth || 2;
    ctx.beginPath();
    ctx.moveTo(0, 8 * s); ctx.lineTo(-15 * s, 34 * s); ctx.lineTo(15 * s, 34 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-22 * s, 37 * s); ctx.lineTo(22 * s, 37 * s); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let i = -18; i <= 18; i += 6) {
      ctx.beginPath();
      ctx.moveTo(i * s, 37 * s); ctx.lineTo((i - 4) * s, 44 * s);
      ctx.stroke();
    }
    ctx.restore();
  },

  // Loslager: wie Festlager, aber Rollen zwischen Dreieck und Grundstrich.
  drawRoller(ctx, x, y, side, opts = {}) {
    const c = window.THEME;
    const stroke = opts.stroke || c.beam, fill = opts.fill || '#F0F4FA';
    const s = opts.scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, side);
    ctx.strokeStyle = stroke; ctx.fillStyle = fill; ctx.lineWidth = opts.lineWidth || 2;
    ctx.beginPath();
    ctx.moveTo(0, 8 * s); ctx.lineTo(-15 * s, 30 * s); ctx.lineTo(15 * s, 30 * s);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(-8 * s, 35 * s, 4 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(8 * s, 35 * s, 4 * s, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.beginPath(); ctx.moveTo(-22 * s, 40 * s); ctx.lineTo(22 * s, 40 * s); ctx.stroke();
    ctx.restore();
  },

  // Einspannung: Wand rechtwinklig zum austretenden Stab.
  // `angle` = Richtung, in die der Stab den Knoten verlässt (Radiant).
  drawFixed(ctx, x, y, angle, opts = {}) {
    const c = window.THEME;
    const stroke = opts.stroke || c.beam;
    const s = opts.scale || 1;
    ctx.save();
    ctx.translate(x, y);
    // Kanonisch: Stab tritt nach +x aus, Wand vertikal links vom Knoten.
    ctx.rotate(angle);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = opts.lineWidth || 4;
    ctx.beginPath(); ctx.moveTo(-16 * s, -38 * s); ctx.lineTo(-16 * s, 38 * s); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-16 * s, 0); ctx.lineTo(8 * s, 0); ctx.stroke();
    ctx.lineWidth = 1.5;
    for (let off = -36; off <= 40; off += 10) {
      ctx.beginPath();
      ctx.moveTo(-30 * s, (off + 8) * s); ctx.lineTo(-16 * s, off * s);
      ctx.stroke();
    }
    ctx.restore();
  },

  // Austrittswinkel des Stabwerks für die Einspannung: exakt bei genau einem
  // Nachbarn, sonst gerasterte (90°) Mittelrichtung. Default: Stab nach oben
  // (Wand unten, klassischer Kragarm-Fuß).
  fixedAngle(x, y, neighbors) {
    if (neighbors.length === 1) {
      const [ox, oy] = neighbors[0];
      return Math.atan2(oy - y, ox - x);
    }
    const away = this.awayVec(x, y, neighbors);
    if (!away) return -Math.PI / 2;
    const toward = Math.atan2(-away[1], -away[0]);
    return Math.round(toward / (Math.PI / 2)) * (Math.PI / 2);
  },

  // Label-Platzierung auf der stabfreien Seite; bei Lagern senkrecht
  // ausweichen, damit das Symbol nicht überdeckt wird.
  labelOffset(x, y, neighbors, isSupported, dist = 17) {
    let away = this.awayVec(x, y, neighbors) || [0, -1];
    if (isSupported) away = [-away[1], away[0]];
    return [away[0] * dist, away[1] * dist + 3];
  },
};
