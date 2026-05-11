'use strict';

// Shape labels — describe (value_at_start, value_at_end) on a per-bar basis
// using level units: -2..+2 (snapped). Sign convention: positive M is drawn
// on the "outer" side of the bar (perpendicular offset in +n direction).
// 0 = zero, +1/-1 = small, +2/-2 = large. We compare by sign pattern only.
const SHAPE_FROM_VALUES = (vStart, vEnd) => {
  const sgn = v => v > 0.3 ? 1 : (v < -0.3 ? -1 : 0);
  return [sgn(vStart), sgn(vEnd)].join(',');
};

// Each "shape" is encoded as "<signStart>,<signEnd>"
// e.g. "0,0" = zero everywhere
//      "1,1" = constant positive
//      "-1,-1" = constant negative
//      "0,1" = linear zero → positive
//      "1,0" = linear positive → zero
//      "-1,1" = linear negative → positive (crosses zero)
// For distributed-load bars, we also accept "1,1+bulge" style — handled via `bulge`.

// Frame fixtures. All coordinates are in GRID UNITS (1 unit = l).
// Canvas y is positive DOWN (matches drawing). loads.fy>0 means downward force.
const FRAME_FIXTURES = [

  // ============================================================
  // 1. L-Kragträger — Einspannung links unten, freies Ende rechts oben
  //    Last F nach unten am freien Ende
  //    Inspiriert von einfachem BP-Tragwerk
  // ============================================================
  {
    id: 'L-cantilever',
    title: 'L-Kragträger',
    description: 'Vertikale Kraft F am freien Ende C, Einspannung in A, biegesteife Ecke B.',
    bbox: { w: 5, h: 5 },
    nodes: {
      A: { x: 1, y: 4 },
      B: { x: 1, y: 1 },
      C: { x: 4, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' },
      { id: 'BC', from: 'B', to: 'C' },
    ],
    supports: { A: 'fixed' },
    welds: ['B'],
    freeEnds: ['C'],
    loads: [{ kind: 'point', node: 'C', fx: 0, fy: 1, label: 'F' }],
    solutions: {
      // Reactions at A: V_A = F (up), H_A = 0, M_A = F·L_BC = 3F
      // Bar BC (horizontal, B left → C right, load F↓ at C):
      //   N = 0, Q = +F (const), M = lin from -3F at B to 0 at C
      // Bar AB (vertical, A bottom → B top):
      //   N = -F (compression, const), Q = 0, M = -3F constant (passed through)
      N: { AB: '-1,-1', BC: '0,0' },
      Q: { AB: '0,0',  BC: '1,1' },
      M: { AB: '-1,-1', BC: '-1,0' },
    },
  },

  // ============================================================
  // 2. Z-Rahmen — wie BP 2021W Teil B
  //    Einspannung links unten (A), Diagonale A-B, horizontaler Balken B-C
  //    mit Streckenlast q, vertikaler Stab C-D mit Loslager D
  // ============================================================
  {
    id: 'Z-frame-q',
    title: 'Z-Rahmen mit Streckenlast',
    description: 'Einspannung A, diagonaler Stab A-B, Streckenlast q auf B-C, Loslager D.',
    bbox: { w: 6, h: 5 },
    nodes: {
      A: { x: 1, y: 4 },
      B: { x: 2, y: 2 },
      C: { x: 4, y: 2 },
      D: { x: 5, y: 4 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' },
      { id: 'BC', from: 'B', to: 'C', distributed: true },
      { id: 'CD', from: 'C', to: 'D' },
    ],
    supports: { A: 'fixed', D: 'roller' },
    welds: ['B', 'C'],
    loads: [{ kind: 'distributed', bar: 'BC', q: 1, label: 'q' }],
    solutions: {
      // Approximate qualitative shapes; sign convention: M+ on tension side
      N: { AB: '-1,-1', BC: '-1,-1', CD: '0,0' },
      Q: { AB: '1,1',   BC: '1,-1',  CD: '0,0' },
      M: { AB: '0,-1',  BC: '-1,-1', CD: '-1,0' }, // BC has parabolic sag in middle
    },
    parabolicBars: { M: ['BC'] }, // marks bars where the M-shape is parabolic between endpoints
  },

  // ============================================================
  // 3. M-Form (W) — wie BP 2022S Teil B
  //    Festlager A oben, Knick B unten, Knick C oben (Last √2F), Loslager D
  // ============================================================
  {
    id: 'M-shape-frame',
    title: 'M-förmiger Träger',
    description: 'Geschweisstes Tragwerk A-B-C-D, Vertikalkraft F bei C, Festlager A, Loslager D.',
    bbox: { w: 7, h: 4 },
    nodes: {
      A: { x: 1, y: 1 },
      B: { x: 2.5, y: 2.5 },
      C: { x: 4,   y: 1 },
      D: { x: 5.5, y: 2.5 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' },
      { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' },
    ],
    supports: { A: 'pin', D: 'roller' },
    welds: ['B', 'C'],
    loads: [{ kind: 'point', node: 'C', fx: 0, fy: 1, label: '√2F' }],
    solutions: {
      // Reactions: V_A and V_D upward, H_A = 0 (pin), H_D = 0 (roller vertical).
      // Punktlast bei C -> M linear in jedem Stab, |M| maximal unter der Last in C.
      // Daher BC und CD an C tiefer (Level -2), an Auflagern null -> Zelt-Form.
      N: { AB: '-1,-1', BC: '-1,-1', CD: '-1,-1' },
      Q: { AB: '1,1',   BC: '1,1',   CD: '-1,-1' },
      M: { AB: '0,-1',  BC: '-1,-2', CD: '-2,0' },
    },
  },

  // ============================================================
  // 4. T-Kragträger mit ⊗ Last (out-of-plane)
  //    Einspannung A unten, vertikaler Stab A-B, horizontaler Stab B-C,
  //    Last P senkrecht zur Zeichenebene am freien Ende C (Biegung + Torsion)
  // ============================================================
  {
    id: 'T-out-of-plane',
    title: 'Kragträger mit Last in z-Richtung',
    description: 'Einspannung A, Verschweissung B, Last P ⊗ in die Zeichenebene am Ende C. Biegung + Torsion.',
    bbox: { w: 5, h: 5 },
    nodes: {
      A: { x: 1, y: 4 },
      B: { x: 1, y: 1.5 },
      C: { x: 4, y: 1.5 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' },
      { id: 'BC', from: 'B', to: 'C' },
    ],
    supports: { A: 'fixed' },
    welds: ['B'],
    freeEnds: ['C'],
    loads: [{ kind: 'z', node: 'C', fz: 1, label: 'P', direction: 'into' }],
    solutions: {
      // Out-of-plane load: BC sees bending (M_y) + Q_z; AB sees torsion + bending
      // We compress this into N, Q, M (in-plane projection) for the game:
      N: { AB: '0,0',  BC: '0,0' },
      Q: { AB: '0,0',  BC: '1,1' },   // shear along BC = P
      M: { AB: '-1,-1', BC: '-1,0' }, // M_y in BC linear, transferred constant in AB
    },
  },

  // ============================================================
  // 5. Portal-Rahmen mit horizontaler Kraft — inspiriert von BP 2023W
  // ============================================================
  {
    id: 'Portal-H-load',
    title: 'Portal mit Horizontallast',
    description: 'Portalrahmen, Festlager A, Loslager D, horizontale Kraft F links oben bei C.',
    bbox: { w: 5, h: 5 },
    nodes: {
      A: { x: 1, y: 4 },
      B: { x: 1, y: 1 },
      C: { x: 4, y: 1 },
      D: { x: 4, y: 4 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' },
      { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' },
    ],
    supports: { A: 'pin', D: 'roller' },
    welds: ['B', 'C'],
    loads: [{ kind: 'point', node: 'B', fx: 1, fy: 0, label: 'F' }],
    solutions: {
      // Horizontal load F at B (top-left corner)
      // Approximate qualitative answers
      // A=(0,0) pin, B=(0,h), C=(L,h), D=(L,0) roller; horizontale Kraft F nach rechts an B.
      // Auflagerreaktionen (h=L=3): Ax=-F, Ay=-F, Dy=+F.
      // Stiel CD trägt keine Horizontallast -> Q=0, M=0 konstant.
      N: { AB: '-1,-1', BC: '0,0',  CD: '-1,-1' },
      Q: { AB: '-1,-1', BC: '1,1',  CD: '0,0'   },
      M: { AB: '0,-1',  BC: '-1,0', CD: '0,0'   },
    },
  },

];

// Shape label dictionary for explanation display
const SHAPE_NAMES = {
  '0,0':   'Null (kein Verlauf)',
  '1,1':   'Konstant positiv',
  '-1,-1': 'Konstant negativ',
  '0,1':   'Linear, 0 → positiv',
  '1,0':   'Linear, positiv → 0',
  '0,-1':  'Linear, 0 → negativ',
  '-1,0':  'Linear, negativ → 0',
  '1,-1':  'Linear, positiv → negativ',
  '-1,1':  'Linear, negativ → positiv',
};

window.FRAME_FIXTURES = FRAME_FIXTURES;
window.SHAPE_FROM_VALUES = SHAPE_FROM_VALUES;
window.SHAPE_NAMES = SHAPE_NAMES;
