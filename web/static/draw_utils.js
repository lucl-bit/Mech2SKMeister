'use strict';

// Gemeinsame Zeichen-/Geometrie-Helfer für Builder und Zeichnen-Modus.
// Lädt nach theme.js, vor den Modul-Skripten.
//
// Physik-Prinzip der Lagersymbole: Die Orientierung zeigt die
// Reaktionsrichtung des Solvers, nicht die "freie Seite" der Struktur.
//   - pin: Solver fixiert x+y; roller_y fixiert y (Boden/Decke), roller_x
//     fixiert x (seitliche Wand).
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
    ctx.rotate(opts.angle || 0);
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
    ctx.rotate(opts.angle || 0);
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

  // Kurs-Konvention (FS 2025, D3): lokale Stabachsen folgen den globalen
  // Achsen. Ein Stab ist "kanonisch", wenn seine lokale x-Achse eine positive
  // globale x-Komponente hat (vertikale Stäbe: +y, also nach unten).
  // Ohne Kanonisierung flippen Q-Vorzeichen mit der Zeichenreihenfolge.
  isCanonicalDir(dx, dy) {
    if (dx > 1e-9) return true;
    if (dx < -1e-9) return false;
    return dy >= 0;
  },

  // Label-Platzierung auf der stabfreien Seite; bei Lagern senkrecht
  // ausweichen, damit das Symbol nicht überdeckt wird.
  labelOffset(x, y, neighbors, isSupported, dist = 17) {
    let away = this.awayVec(x, y, neighbors) || [0, -1];
    if (isSupported) away = [-away[1], away[0]];
    return [away[0] * dist, away[1] * dist + 3];
  },

  _arrowOn(ctx, x1, y1, x2, y2, head = 9) {
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - ux * head + nx * head * 0.45, y2 - uy * head + ny * head * 0.45);
    ctx.lineTo(x2 - ux * head - nx * head * 0.45, y2 - uy * head - ny * head * 0.45);
    ctx.closePath(); ctx.fill();
  },

  // Momentenbogen mit Pfeilspitze. cw=true: Uhrzeigersinn (= +z bei x→,y↓).
  _momentArc(ctx, x, y, r, cw) {
    const a0 = cw ? -2.2 : -0.9, a1 = cw ? -0.9 : -2.2;
    ctx.beginPath(); ctx.arc(x, y, r, a0, a1, !cw); ctx.stroke();
    const ex = x + r * Math.cos(a1), ey = y + r * Math.sin(a1);
    // Tangente am Bogenende in Laufrichtung
    const t = cw ? 1 : -1;
    const tx = -Math.sin(a1) * t, ty = Math.cos(a1) * t;
    ctx.beginPath();
    ctx.moveTo(ex + tx * 8, ey + ty * 8);
    ctx.lineTo(ex - tx * 2 + Math.cos(a1) * 5, ey - ty * 2 + Math.sin(a1) * 5);
    ctx.lineTo(ex - tx * 2 - Math.cos(a1) * 5, ey - ty * 2 - Math.sin(a1) * 5);
    ctx.closePath(); ctx.fill();
  },

  // Schnittufer-Grafik: zwei freigeschnittene Balkenstummel mit der
  // Schnittgröße `kind` in Kurs-Konvention (x→, y↓, z⊗):
  //   positives Ufer (rechtes Ende des linken Teils): N→+x, Q→+y, M um +z (cw)
  //   negatives Ufer: jeweils entgegengesetzt (actio = reactio).
  // `value`: tatsächlicher Wert in Kurs-Konvention. Gezeichnet wird die
  // tatsächliche Wirkrichtung farbig; bei value≈0 nur graue Definition.
  drawCutFaces(ctx, cx, y, halfLen, kind, value, color, opts = {}) {
    const c = window.THEME;
    const gap = opts.gap || 26;
    const lx = cx - gap / 2, rx = cx + gap / 2;
    // Balkenstummel
    ctx.strokeStyle = c.beam; ctx.lineWidth = 5; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(lx - halfLen, y); ctx.lineTo(lx, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, y); ctx.lineTo(rx + halfLen, y); ctx.stroke();
    // Schnittufer-Markierung
    ctx.strokeStyle = c.muted; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(lx, y - 16); ctx.lineTo(lx, y + 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(rx, y - 16); ctx.lineTo(rx, y + 16); ctx.stroke();
    ctx.setLineDash([]);

    const sign = Math.abs(value) < 1e-9 ? 0 : (value > 0 ? 1 : -1);
    const drawPair = (col, s, withLabel) => {
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 2.5;
      const a = 34; // Pfeillänge
      if (kind === 'N') {
        this._arrowOn(ctx, lx + 4, y, lx + 4 + s * a, y);
        this._arrowOn(ctx, rx - 4, y, rx - 4 - s * a, y);
      } else if (kind === 'Q') {
        this._arrowOn(ctx, lx - 8, y - s * 4, lx - 8, y + s * a);
        this._arrowOn(ctx, rx + 8, y + s * 4, rx + 8, y - s * a);
      } else {
        this._momentArc(ctx, lx - 12, y, 15, s > 0);
        this._momentArc(ctx, rx + 12, y, 15, s < 0);
      }
      if (withLabel) {
        ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
        const unit = kind === 'M' ? ' kN·m' : ' kN';
        const txt = opts.label !== undefined ? opts.label
          : `${kind} = ${value > 0 ? '+' : ''}${(+value.toFixed(2))}${unit}`;
        ctx.fillText(txt, cx, y + (kind === 'Q' ? a + 18 : 34));
        ctx.textAlign = 'left';
      }
    };

    if (sign === 0) {
      drawPair(c.muted, 1, false);
      ctx.fillStyle = c.muted; ctx.font = 'bold 11px Helvetica'; ctx.textAlign = 'center';
      ctx.fillText(`${kind} = 0`, cx, y + 34); ctx.textAlign = 'left';
    } else {
      drawPair(color, sign, true);
    }
    // kleine "+"-Referenz: positive Definitionsrichtung in grau daneben
    if (opts.showReference !== false && sign < 0) {
      ctx.save(); ctx.globalAlpha = 0.35;
      drawPair(c.muted, 1, false);
      ctx.restore();
    }
  },
};
