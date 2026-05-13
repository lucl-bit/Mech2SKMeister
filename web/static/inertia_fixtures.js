'use strict';

// Inertia-Lab Aufgaben.
//
// Jede Aufgabe ist eine doppelt-symmetrische Zerlegung um die globale y- und
// z-Achse (Bezugsachse = Gesamtschwerpunkt). Teile sind eines von:
//   { type:'rect',     b, h, cy, cz, sign:+1|-1 }   // b = Breite in y, h = Höhe in z
//   { type:'triangle', b, h, cy, cz, sign, orient } // orient: 'up'|'down'|'left'|'right' (Spitze zeigt wohin)
//   { type:'circle',   r,    cy, cz, sign }
//
// b, h, r, cy, cz sind Vielfache der Einheitenlänge `a`. Eigenträgheitsmomente
// werden aus den Formeln des Mech2-Formelblatts berechnet:
//   Rechteck:   I_y = h*b^3/12 , I_z = b*h^3/12
//   Dreieck:    I_y = h*b^3/36 , I_z = b*h^3/36
//   Kreis:      I_y = I_z = pi*r^4/4
// Bezugsachse y ist horizontal, z ist vertikal (wie in der Mech2-Konvention).
// Wir berechnen hier I_y, gefragt: "Trägheitsmoment um die y-Achse" =
//   I_y = sum sign_i * ( I_y_eigen_i + cz_i^2 * A_i ).

const InertiaMath = (function () {
  function partArea(p) {
    if (p.type === 'rect') return p.b * p.h;
    if (p.type === 'triangle') return 0.5 * p.b * p.h;
    if (p.type === 'circle') return Math.PI * p.r * p.r;
    return 0;
  }
  // Eigenträgheitsmoment um horizontale Achse (Steiner-frei) durch eigenen Schwerpunkt.
  function partIyOwn(p) {
    if (p.type === 'rect') return (p.b * Math.pow(p.h, 3)) / 12;
    if (p.type === 'triangle') return (p.b * Math.pow(p.h, 3)) / 36;
    if (p.type === 'circle') return (Math.PI * Math.pow(p.r, 4)) / 4;
    return 0;
  }
  function partContribIy(p) {
    const A = partArea(p);
    const Iown = partIyOwn(p);
    const steiner = p.cz * p.cz * A;
    return p.sign * (Iown + steiner);
  }
  function totalIy(parts) {
    let s = 0;
    for (const p of parts) s += partContribIy(p);
    return s;
  }
  // formatiert "x/y a⁴" mit Bruch-Reduktion bei kleinen Nennern.
  function formatIaPow4(value) {
    // suche Bruchapproximation mit Nenner <= 36
    const eps = 1e-3;
    for (let den = 1; den <= 36; den++) {
      const num = Math.round(value * den);
      if (Math.abs(num / den - value) < eps) {
        if (num === 0) return '0';
        const g = gcd(Math.abs(num), den);
        const n = num / g, d = den / g;
        if (d === 1) return n + ' a⁴';
        return n + '/' + d + ' a⁴';
      }
    }
    return value.toFixed(3) + ' a⁴';
  }
  function gcd(a, b) { while (b) { [a, b] = [b, a % b]; } return a; }
  return { partArea, partIyOwn, partContribIy, totalIy, formatIaPow4 };
})();

// ---------- Statische Aufgaben (aus den Altprüfungen + handgemachte) ----------

const InertiaFixtures = [
  // Einfaches Rechteck — Einstieg
  {
    id: 'rect-2x2',
    title: 'Rechteck 2a × 2a',
    level: 'easy',
    parts: [
      { type: 'rect', b: 2, h: 2, cy: 0, cz: 0, sign: +1 },
    ],
    outline: rectOutline(2, 2, 0, 0),
  },
  // Zwei gestapelte Rechtecke — Steiner-Drill
  {
    id: 'two-rects',
    title: 'Zwei Rechtecke übereinander',
    level: 'easy',
    parts: [
      { type: 'rect', b: 2, h: 1, cy: 0, cz: +1, sign: +1 },
      { type: 'rect', b: 2, h: 1, cy: 0, cz: -1, sign: +1 },
    ],
    outline: rectOutline(2, 2, 0, 0),
  },
  // T-Profil
  {
    id: 'T-profile',
    title: 'T-Profil',
    level: 'mid',
    parts: [
      { type: 'rect', b: 3, h: 1, cy: 0, cz: +1.0, sign: +1 }, // Flansch
      { type: 'rect', b: 1, h: 2, cy: 0, cz: -0.5, sign: +1 }, // Steg
    ],
    outline: tProfileOutline(3, 1, 1, 2),
  },
  // I-Profil (Doppel-T)
  {
    id: 'I-profile',
    title: 'Doppel-T',
    level: 'mid',
    parts: [
      { type: 'rect', b: 3, h: 1, cy: 0, cz: +1.5, sign: +1 },
      { type: 'rect', b: 1, h: 2, cy: 0, cz: 0,    sign: +1 },
      { type: 'rect', b: 3, h: 1, cy: 0, cz: -1.5, sign: +1 },
    ],
    outline: iProfileOutline(3, 1, 1, 2),
  },
  // Kreuz / Plus-Profil
  {
    id: 'plus-cross',
    title: 'Kreuzquerschnitt',
    level: 'mid',
    parts: [
      { type: 'rect', b: 3, h: 1, cy: 0, cz: 0, sign: +1 },
      { type: 'rect', b: 1, h: 3, cy: 0, cz: 0, sign: +1 },
      // Überlappung 1*1 abziehen
      { type: 'rect', b: 1, h: 1, cy: 0, cz: 0, sign: -1 },
    ],
    outline: plusOutline(3, 1),
  },
  // Sechseck-artig (aus A5)
  {
    id: 'hex-like',
    title: 'Rechteck mit zwei Spitzen (analog A5)',
    level: 'hard',
    parts: [
      { type: 'rect',     b: 4, h: 1,   cy: 0,    cz: 0, sign: +1 },
      { type: 'triangle', b: 1, h: 0.5, cy: 0,    cz: +0.5 + 1/6, sign: +1, orient: 'up'   },
      { type: 'triangle', b: 1, h: 0.5, cy: 0,    cz: -0.5 - 1/6, sign: +1, orient: 'down' },
    ],
    outline: hexLikeOutline(),
  },
  // Sanduhr aus A3 (vereinfacht)
  {
    id: 'hourglass',
    title: 'Sanduhr-Querschnitt (analog A3)',
    level: 'hard',
    parts: [
      // Volles Rechteck 2a × 2a
      { type: 'rect', b: 2, h: 2, cy: 0, cz: 0, sign: +1 },
      // Zwei Dreiecke aus der linken und rechten Seite herausgeschnitten
      // Jedes Dreieck: vertikale Basis 2a (in z), Höhe a/2 (in y).
      // Schwerpunkt eines solchen Dreiecks liegt bei 1/3 der Höhe von der Basis aus.
      { type: 'triangle', b: 0.5, h: 2, cy: -1 + (0.5 / 3), cz: 0, sign: -1, orient: 'right' },
      { type: 'triangle', b: 0.5, h: 2, cy: +1 - (0.5 / 3), cz: 0, sign: -1, orient: 'left'  },
    ],
    outline: hourglassOutline(),
  },
];

// ---------- Outline-Hilfsfunktionen (für Canvas-Rendering) ----------

function rectOutline(b, h, cy, cz) {
  return [
    [cy - b / 2, cz - h / 2],
    [cy + b / 2, cz - h / 2],
    [cy + b / 2, cz + h / 2],
    [cy - b / 2, cz + h / 2],
  ];
}
function tProfileOutline(bf, hf, bw, hw) {
  // Flansch oben Mitte z = +hw/2 ... +hw/2 + hf; Steg z = -hw/2 ... +hw/2.
  // Wir nehmen Schwerpunkt-System: globaler Schwerpunkt liegt nicht bei 0,
  // aber für reines Outline-Zeichnen ist das ok — wir nutzen die Part-cz Angaben
  // konsistent oben.  Hier zeichnen wir einfach um (0,0) als Bezugsachse.
  const top = +1.5, midTop = +1.0, midBot = -1.0;
  return [
    [-bf/2, top], [bf/2, top], [bf/2, midTop],
    [bw/2, midTop], [bw/2, midBot], [-bw/2, midBot],
    [-bw/2, midTop], [-bf/2, midTop],
  ];
}
function iProfileOutline(bf, hf, bw, hw) {
  // Oben/unten Flansch (3×1), Mitte Steg (1×2), Gesamthöhe = 4.
  return [
    [-1.5, +2.0], [+1.5, +2.0], [+1.5, +1.0],
    [+0.5, +1.0], [+0.5, -1.0],
    [+1.5, -1.0], [+1.5, -2.0], [-1.5, -2.0],
    [-1.5, -1.0], [-0.5, -1.0], [-0.5, +1.0], [-1.5, +1.0],
  ];
}
function plusOutline(longSide, thickness) {
  const L = longSide / 2, t = thickness / 2;
  return [
    [-L, -t], [-t, -t], [-t, -L], [+t, -L], [+t, -t],
    [+L, -t], [+L, +t], [+t, +t], [+t, +L], [-t, +L],
    [-t, +t], [-L, +t],
  ];
}
function hexLikeOutline() {
  // Rechteck 4×1 plus zwei Dreiecke je Basis 1, Höhe 0.5 oben/unten Mitte.
  return [
    [-2, -0.5], [+2, -0.5], [+2, +0.5],
    [+0.5, +0.5], [0, +1.0], [-0.5, +0.5],
    [-2, +0.5], [-2, -0.5],
    // Dreieck unten ergänzen
    [-0.5, -0.5], [0, -1.0], [+0.5, -0.5], [+2, -0.5],
  ];
}
function hourglassOutline() {
  // 2a × 2a Rechteck minus zwei Seiten-Dreiecke (links und rechts, Spitze bei y=0).
  // Konturlauf:
  return [
    [-1, -1], [+1, -1], [+0.5, 0], [+1, +1], [-1, +1], [-0.5, 0], [-1, -1],
  ];
}

// ---------- Prozeduraler Generator ----------
//
// Strategie: doppelt symmetrische Komposition (um y- und z-Achse).
// Basis: zentriertes Rechteck. Optional:
//   - oben/unten je 1 Dreieck (Sechseck-artig)  ODER
//   - links/rechts je 1 Rechteck-Flansch        ODER
//   - rechteckige Aussparung in der Mitte (bleibt zusammenhängend, weil Material rundherum)
// Damit ist Zusammenhang konstruktiv garantiert: alle Anbauten teilen mindestens
// eine Kante mit der Basis; eine zentrale Aussparung kann den Restquerschnitt
// nur dann trennen, wenn sie bis zum Rand reicht — wir limitieren sie strikt
// auf < volle Breite und < volle Höhe.

function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randomInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

function generateInertiaChallenge(level) {
  level = level || 'mid';
  const variants = level === 'easy'
    ? ['plain']
    : level === 'mid'
      ? ['plain', 'flange', 'topbot']
      : ['flange', 'topbot', 'cutout', 'triple'];

  const v = randomChoice(variants);

  // Basis-Rechteck
  const bw = randomChoice([2, 3, 4]);
  const bh = randomChoice([1, 2, 3]);

  const parts = [{ type: 'rect', b: bw, h: bh, cy: 0, cz: 0, sign: +1 }];

  if (v === 'flange') {
    // links/rechts Rechteck-Flansch (Höhe < bh, gemeinsam mit Basis)
    const fw = 1;
    const fh = randomChoice([Math.max(1, bh - 1), bh]);
    parts.push({ type: 'rect', b: fw, h: fh, cy: +(bw / 2 + fw / 2), cz: 0, sign: +1 });
    parts.push({ type: 'rect', b: fw, h: fh, cy: -(bw / 2 + fw / 2), cz: 0, sign: +1 });
  } else if (v === 'topbot') {
    // oben/unten Dreieck
    const tb = randomChoice([1, 2]);
    const th = randomChoice([0.5, 1]);
    parts.push({ type: 'triangle', b: tb, h: th, cy: 0, cz: +(bh / 2 + th / 3), sign: +1, orient: 'up' });
    parts.push({ type: 'triangle', b: tb, h: th, cy: 0, cz: -(bh / 2 + th / 3), sign: +1, orient: 'down' });
  } else if (v === 'cutout') {
    // mittige Rechteck-Aussparung
    const cw = Math.min(bw - 1, 1);
    const ch = Math.min(bh - 0.5, 0.5);
    if (cw > 0 && ch > 0) {
      parts.push({ type: 'rect', b: cw, h: ch, cy: 0, cz: 0, sign: -1 });
    }
  } else if (v === 'triple') {
    // Doppel-T-artig: drei horizontale Rechtecke
    const fb = bw + 1;
    parts.length = 0;
    parts.push({ type: 'rect', b: fb, h: 1, cy: 0, cz: +(bh / 2 + 0.5), sign: +1 });
    parts.push({ type: 'rect', b: 1,  h: bh, cy: 0, cz: 0,               sign: +1 });
    parts.push({ type: 'rect', b: fb, h: 1, cy: 0, cz: -(bh / 2 + 0.5), sign: +1 });
  }

  // Outline = approximative Bounding-Box-Vereinigung (für Render reicht Polygon-Union der Außenteile;
  // hier rendern wir die Teile einzeln, also outline=null erlaubt).
  return {
    id: 'gen-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: 'Zufallsquerschnitt',
    level: level,
    parts: parts,
    outline: null, // Renderer zeichnet die Teile direkt
  };
}

window.InertiaFixtures = InertiaFixtures;
window.InertiaMath = InertiaMath;
window.generateInertiaChallenge = generateInertiaChallenge;
