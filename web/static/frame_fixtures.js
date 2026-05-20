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

  // ============================================================
  // FS 2023 – Frage B1: Deformierbares Tragwerk mit Balkenelementen
  // ============================================================
  {
    id: 'fs2023_frageb1',
    title: 'Deformierbares Tragwerk mit Balkenelementen',
    description: 'Geschweisstes Tragwerk mit Balkenelementen unter Vertikalkraft an Stelle A.',
    source: 'FS 2023 – Frage B1',
    bbox: { w: 5.0, h: 4.0 },
    nodes: { A: { x: 1.0, y: 3.0 }, B: { x: 2.0, y: 2.0 }, C: { x: 3.0, y: 2.0 }, D: { x: 4.0, y: 2.0 }, E: { x: 3.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'CE', from: 'C', to: 'E' } ],
    supports: { D: 'pin', E: 'pin' },
    welds: ['B', 'C'],
    freeEnds: ['A'],
    loads: [ { kind: 'point', node: 'A', fx: 0, fy: 1, label: 'F' } ],
    solutions: {
      N: { AB: '-1,-1', BC: '0,0', CD: '1,1', CE: '-1,-1' },
      Q: { AB: '-1,-1', BC: '-1,-1', CD: '1,1', CE: '1,1' },
      M: { AB: '0,-1', BC: '-1,-1', CD: '-1,0', CE: '-1,0' },
    },
  },

  // ============================================================
  // FS 2020 – Frage C1: Statisch bestimmtes System II unter Streckenlast q
  // ============================================================
  {
    id: 'fs2020_fragec1',
    title: 'Einfeldträger unter Streckenlast',
    description: 'Einfach gelagerter Balken C-D unter gleichmässiger Streckenlast q.',
    source: 'FS 2020 – Frage C1',
    bbox: { w: 4.0, h: 3.0 },
    nodes: { C: { x: 1.0, y: 2.0 }, D: { x: 3.0, y: 2.0 } },
    bars: [ { id: 'CD', from: 'C', to: 'D', distributed: true } ],
    supports: { C: 'pin', D: 'roller' },
    loads: [ { kind: 'distributed', bar: 'CD', q: 1, label: 'q' } ],
    solutions: {
      N: { CD: '0,0' },
      Q: { CD: '1,-1' },
      M: { CD: '0,0' },
    },
    parabolicBars: { M: ['CD'] },
  },

  // ============================================================
  // FS 2020 – Frage D1: Statisch bestimmtes Tragwerk mit kombinierter Beanspruchung
  // ============================================================
  {
    id: 'fs2020_fraged1',
    title: 'Vierfach abgewinkelter Träger mit Einspannung',
    description: 'Durchgehender, vierfach abgewinkelter Träger mit kombinierter Beanspruchung, Einspannung bei G.',
    source: 'FS 2020 – Frage D1',
    bbox: { w: 4.0, h: 5.0 },
    nodes: { A: { x: 3.0, y: 4.0 }, B: { x: 1.0, y: 4.0 }, C: { x: 1.0, y: 3.0 }, D: { x: 1.0, y: 1.0 }, E: { x: 3.0, y: 1.0 }, F: { x: 3.0, y: 3.0 }, G: { x: 3.0, y: 2.0 } },
    bars: [ { id: 'BA', from: 'B', to: 'A' }, { id: 'AF', from: 'A', to: 'F' }, { id: 'FE', from: 'F', to: 'E' }, { id: 'ED', from: 'E', to: 'D' }, { id: 'DC', from: 'D', to: 'C' }, { id: 'CB', from: 'C', to: 'B' } ],
    supports: { G: 'fixed' },
    welds: ['B', 'A', 'F', 'E', 'D', 'C'],
    loads: [ { kind: 'point', node: 'A', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { BA: '0,0', AF: '-1,-1', FE: '0,0', ED: '0,0', DC: '0,0', CB: '0,0' },
      Q: { BA: '-1,-1', AF: '0,0', FE: '1,1', ED: '-1,-1', DC: '1,1', CB: '1,1' },
      M: { BA: '1,-1', AF: '-1,0', FE: '-1,1', ED: '1,-1', DC: '-1,1', CB: '0,1' },
    },
  },

  // ============================================================
  // HS 2020 – Frage B1: Rahmentragwerk mit Biegung und Normalkraft
  // ============================================================
  {
    id: 'hs2020_frageb1',
    title: 'Rahmentragwerk mit Streckenlast',
    description: 'Einspannung A, Streckenlast q auf Riegel B-C, Loslager D (vertikal).',
    source: 'HS 2020 – Frage B1',
    bbox: { w: 4.0, h: 3.5 },
    nodes: { A: { x: 1.0, y: 2.5 }, B: { x: 2.0, y: 2.5 }, C: { x: 3.0, y: 2.5 }, D: { x: 3.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C', distributed: true }, { id: 'CD', from: 'C', to: 'D' } ],
    supports: { A: 'fixed', D: 'roller' },
    welds: ['B', 'C'],
    loads: [ { kind: 'distributed', bar: 'BC', q: 1, label: 'q' } ],
    solutions: {
      N: { AB: '0,0', BC: '0,0', CD: '-1,-1' },
      Q: { AB: '1,1', BC: '1,-1', CD: '0,0' },
      M: { AB: '-1,1', BC: '1,0', CD: '0,0' },
    },
    parabolicBars: { M: ['BC'] },
  },

  // ============================================================
  // FS 2021 – Frage B1: Rahmen mit Kragarm und Gleichstreckenlast
  // ============================================================
  {
    id: 'fs2021_frageb1',
    title: 'Rahmen mit Kragarm und Gleichstreckenlast',
    description: 'Festlager A, Kraft F am Kragarmende C, Streckenlast q auf Kragarm D-E, Loslager E.',
    source: 'FS 2021 – Frage B1',
    bbox: { w: 4.0, h: 4.0 },
    nodes: { A: { x: 1.0, y: 1.0 }, B: { x: 2.0, y: 2.0 }, C: { x: 2.0, y: 3.0 }, D: { x: 2.5, y: 2.0 }, E: { x: 3.0, y: 2.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'BD', from: 'B', to: 'D' }, { id: 'DE', from: 'D', to: 'E', distributed: true } ],
    supports: { A: 'pin', E: 'roller' },
    welds: ['B', 'D'],
    freeEnds: ['C'],
    loads: [ { kind: 'point', node: 'C', fx: 0, fy: 1, label: 'F' }, { kind: 'distributed', bar: 'DE', q: 1, label: 'q' } ],
    solutions: {
      N: { AB: '-1,-1', BC: '-1,-1', BD: '0,0', DE: '0,0' },
      Q: { AB: '1,1', BC: '0,0', BD: '-1,-1', DE: '-1,-1' },
      M: { AB: '0,1', BC: '0,0', BD: '1,1', DE: '1,0' },
    },
    parabolicBars: { M: ['DE'] },
  },

  // ============================================================
  // FS 2021 – Frage D1: Zweifach abgewinkelter Träger A-B-C-D
  // ============================================================
  {
    id: 'fs2021_fraged1',
    title: 'Zweifach abgewinkelter Träger mit Einspannung',
    description: 'Einspannung D, Kraft P bei A, abgewinkelter Träger B-A-C-D.',
    source: 'FS 2021 – Frage D1',
    bbox: { w: 4.0, h: 4.0 },
    nodes: { A: { x: 2.0, y: 3.0 }, B: { x: 1.0, y: 3.0 }, C: { x: 1.0, y: 1.0 }, D: { x: 3.0, y: 1.0 } },
    bars: [ { id: 'BA', from: 'B', to: 'A' }, { id: 'AC', from: 'A', to: 'C' }, { id: 'CD', from: 'C', to: 'D' } ],
    supports: { D: 'fixed' },
    welds: ['A', 'C'],
    freeEnds: ['B'],
    loads: [ { kind: 'point', node: 'A', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { BA: '0,0', AC: '-1,-1', CD: '0,0' },
      Q: { BA: '0,0', AC: '1,1', CD: '-1,-1' },
      M: { BA: '0,0', AC: '0,1', CD: '1,-1' },
    },
  },

  // ============================================================
  // HS 2021 – Frage B1: Tragwerk mit vier Balken und Gleichstreckenlast
  // ============================================================
  {
    id: 'hs2021_frageb1',
    title: 'Tragwerk mit vier Balken und Streckenlast',
    description: 'Einspannung A, Streckenlast q auf Balken A-B, Loslager E.',
    source: 'HS 2021 – Frage B1',
    bbox: { w: 6.0, h: 3.0 },
    nodes: { A: { x: 1.0, y: 2.0 }, B: { x: 2.0, y: 2.0 }, C: { x: 3.0, y: 1.0 }, D: { x: 4.0, y: 2.0 }, E: { x: 5.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B', distributed: true }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' } ],
    supports: { A: 'fixed', E: 'roller' },
    welds: ['B', 'C', 'D'],
    loads: [ { kind: 'distributed', bar: 'AB', q: 1, label: 'q' } ],
    solutions: {
      N: { AB: '0,0', BC: '-1,-1', CD: '1,1', DE: '-1,-1' },
      Q: { AB: '1,0', BC: '-1,-1', CD: '-1,-1', DE: '-1,-1' },
      M: { AB: '-1,1', BC: '1,1', CD: '1,1', DE: '1,0' },
    },
    parabolicBars: { M: ['AB'] },
  },

  // ============================================================
  // HS 2021 – Frage D1: Träger A-B-C-D-E mit Biegung und Torsion
  // ============================================================
  {
    id: 'hs2021_fraged1',
    title: 'Abgewinkelter Träger A-B-C-D-E',
    description: 'Einspannung A, abgewinkelter Träger mit Kraft P am freien Ende E.',
    source: 'HS 2021 – Frage D1',
    bbox: { w: 5.0, h: 3.0 },
    nodes: { A: { x: 1.0, y: 2.0 }, B: { x: 2.0, y: 2.0 }, C: { x: 3.0, y: 2.0 }, D: { x: 3.0, y: 1.0 }, E: { x: 4.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' } ],
    supports: { A: 'fixed' },
    welds: ['B', 'C', 'D'],
    freeEnds: ['E'],
    loads: [ { kind: 'point', node: 'E', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { AB: '0,0', BC: '0,0', CD: '1,1', DE: '0,0' },
      Q: { AB: '1,1', BC: '1,1', CD: '0,0', DE: '1,1' },
      M: { AB: '-1,-1', BC: '-1,-1', CD: '-1,-1', DE: '-1,0' },
    },
  },

  // ============================================================
  // FS 2022 – Frage B1: Tragwerk A-B-C-D mit Vertikallast an C
  // ============================================================
  {
    id: 'fs2022_frageb1',
    title: 'M-förmiger Träger mit Einspannung',
    description: 'Einspannung A, Loslager D, Vertikalkraft √2F bei Tiefpunkt C.',
    source: 'FS 2022 – Frage B1',
    bbox: { w: 5.0, h: 3.0 },
    nodes: { A: { x: 1.0, y: 2.0 }, B: { x: 2.0, y: 1.0 }, C: { x: 3.0, y: 2.0 }, D: { x: 4.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' } ],
    supports: { A: 'fixed', D: 'roller' },
    welds: ['B', 'C'],
    loads: [ { kind: 'point', node: 'C', fx: 0, fy: 1, label: '√2F' } ],
    solutions: {
      N: { AB: '1,1', BC: '-1,-1', CD: '-1,-1' },
      Q: { AB: '1,1', BC: '1,1', CD: '-1,-1' },
      M: { AB: '-1,1', BC: '1,1', CD: '1,0' },
    },
  },

  // ============================================================
  // FS 2022 – Frage D1: Träger B-A-C-D mit Kraft bei D
  // ============================================================
  {
    id: 'fs2022_fraged1',
    title: 'Abgewinkelter Träger mit Festlager',
    description: 'Festlager A, Kraft P am freien Ende D, Träger B-A-C-D.',
    source: 'FS 2022 – Frage D1',
    bbox: { w: 4.0, h: 3.0 },
    nodes: { A: { x: 3.0, y: 2.0 }, B: { x: 1.0, y: 2.0 }, C: { x: 1.0, y: 1.0 }, D: { x: 2.0, y: 1.0 } },
    bars: [ { id: 'BA', from: 'B', to: 'A' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' } ],
    supports: { A: 'pin' },
    welds: ['B', 'C'],
    freeEnds: ['D'],
    loads: [ { kind: 'point', node: 'D', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { BA: '1,1', BC: '1,1', CD: '0,0' },
      Q: { BA: '-1,-1', BC: '1,1', CD: '1,1' },
      M: { BA: '1,0', BC: '-1,-1', CD: '-1,0' },
    },
  },

  // ============================================================
  // HS 2022 – Frage B1: Tragwerk A-B-C-D-E mit Horizontallast
  // ============================================================
  {
    id: 'hs2022_frageb1',
    title: 'Tragwerk A-B-C-D-E mit Horizontallast',
    description: 'Festlager A und E, horizontale Kraft F (nach links) bei Knoten C.',
    source: 'HS 2022 – Frage B1',
    bbox: { w: 4.0, h: 4.0 },
    nodes: { A: { x: 1.0, y: 1.0 }, B: { x: 2.0, y: 2.0 }, C: { x: 3.0, y: 3.0 }, D: { x: 3.0, y: 1.0 }, E: { x: 2.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' } ],
    supports: { A: 'pin', E: 'pin' },
    welds: ['B', 'C', 'D'],
    loads: [ { kind: 'point', node: 'C', fx: -1, fy: 0, label: 'F' } ],
    solutions: {
      N: { AB: '-1,-1', BC: '-1,-1', CD: '0,0', DE: '-1,-1' },
      Q: { AB: '1,1', BC: '1,1', CD: '-1,-1', DE: '0,0' },
      M: { AB: '0,1', BC: '1,1', CD: '1,0', DE: '0,0' },
    },
  },

  // ============================================================
  // HS 2022 – Frage D1: Rahmen A-B-C-D-E mit Kraft bei E
  // ============================================================
  {
    id: 'hs2022_fraged1',
    title: 'Abgewinkelter Rahmen A-B-C-D-E',
    description: 'Einspannung A, Kraft P am freien Ende E.',
    source: 'HS 2022 – Frage D1',
    bbox: { w: 3.5, h: 3.0 },
    nodes: { A: { x: 1.0, y: 2.0 }, B: { x: 1.0, y: 1.0 }, C: { x: 2.0, y: 1.0 }, D: { x: 2.0, y: 2.0 }, E: { x: 2.5, y: 2.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' } ],
    supports: { A: 'fixed' },
    welds: ['B', 'C', 'D'],
    freeEnds: ['E'],
    loads: [ { kind: 'point', node: 'E', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { AB: '1,1', BC: '0,0', CD: '-1,-1', DE: '0,0' },
      Q: { AB: '0,0', BC: '1,1', CD: '0,0', DE: '1,1' },
      M: { AB: '-1,-1', BC: '-1,-1', CD: '-1,-1', DE: '-1,0' },
    },
  },

  // ============================================================
  // FS 2023 – Frage D1: Dreifach abgewinkelter Träger A-B-C-D-E
  // ============================================================
  {
    id: 'fs2023_fraged1',
    title: 'Dreifach abgewinkelter Kragträger',
    description: 'Einspannung A, Kraft P am freien Ende E, mehrfach abgewinkelter Träger.',
    source: 'FS 2023 – Frage D1',
    bbox: { w: 6.0, h: 4.0 },
    nodes: { A: { x: 1.0, y: 2.0 }, B: { x: 2.0, y: 1.0 }, C: { x: 3.0, y: 1.0 }, D: { x: 4.0, y: 2.0 }, E: { x: 5.0, y: 3.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' } ],
    supports: { A: 'fixed' },
    welds: ['B', 'C', 'D'],
    freeEnds: ['E'],
    loads: [ { kind: 'point', node: 'E', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { AB: '1,1', BC: '0,0', CD: '-1,-1', DE: '-1,-1' },
      Q: { AB: '1,1', BC: '1,1', CD: '1,1', DE: '1,1' },
      M: { AB: '-1,-1', BC: '-1,-1', CD: '-1,-1', DE: '-1,0' },
    },
  },

  // ============================================================
  // HS 2023 – Frage B1: Tragwerk mit fünf Balken unter geneigter Kraft
  // ============================================================
  {
    id: 'hs2023_frageb1',
    title: 'Tragwerk mit fünf Balken unter geneigter Kraft',
    description: 'Festlager A und C, Loslager F, Horizontalkraft √(2P) bei F.',
    source: 'HS 2023 – Frage B1',
    bbox: { w: 4.0, h: 5.0 },
    nodes: { A: { x: 1.0, y: 4.0 }, B: { x: 1.0, y: 3.0 }, C: { x: 1.0, y: 2.0 }, D: { x: 2.0, y: 3.0 }, E: { x: 3.0, y: 3.0 }, F: { x: 3.0, y: 1.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'BD', from: 'B', to: 'D' }, { id: 'DE', from: 'D', to: 'E' }, { id: 'EF', from: 'E', to: 'F' } ],
    supports: { A: 'pin', C: 'fixed', F: 'roller' },
    welds: ['B', 'D', 'E'],
    loads: [ { kind: 'point', node: 'F', fx: 1, fy: 0, label: '√(2P)' } ],
    solutions: {
      N: { AB: '1,1', BC: '-1,-1', BD: '1,1', DE: '1,1', EF: '1,1' },
      Q: { AB: '-1,-1', BC: '1,1', BD: '1,1', DE: '1,1', EF: '-1,-1' },
      M: { AB: '0,-1', BC: '1,1', BD: '-1,1', DE: '1,1', EF: '1,0' },
    },
  },

  // ============================================================
  // HS 2023 – Frage D1: Tragwerk mit Biegung und Torsion
  // ============================================================
  {
    id: 'hs2023_fraged1',
    title: 'Komplexes Tragwerk A-B-C-D-E-F-G',
    description: 'Einspannung A, Kraft P bei Knoten G, verzweigtes Tragwerk.',
    source: 'HS 2023 – Frage D1',
    bbox: { w: 5.0, h: 4.0 },
    nodes: { A: { x: 3.0, y: 3.0 }, B: { x: 1.0, y: 3.0 }, C: { x: 1.0, y: 1.0 }, D: { x: 3.0, y: 1.0 }, E: { x: 4.0, y: 1.0 }, F: { x: 4.0, y: 3.0 }, G: { x: 2.0, y: 2.0 } },
    bars: [ { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' }, { id: 'EF', from: 'E', to: 'F' }, { id: 'DG', from: 'D', to: 'G' }, { id: 'GF', from: 'G', to: 'F' } ],
    supports: { A: 'fixed' },
    welds: ['B', 'C', 'D', 'E', 'F', 'G'],
    loads: [ { kind: 'point', node: 'G', fx: 0, fy: 1, label: 'P' } ],
    solutions: {
      N: { AB: '0,0', BC: '1,1', CD: '0,0', DE: '-1,-1', EF: '1,1', DG: '-1,-1', GF: '1,1' },
      Q: { AB: '-1,-1', BC: '0,0', CD: '1,1', DE: '-1,-1', EF: '-1,-1', DG: '-1,-1', GF: '1,1' },
      M: { AB: '1,-1', BC: '-1,-1', CD: '-1,1', DE: '1,1', EF: '1,-1', DG: '1,-1', GF: '-1,1' },
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
