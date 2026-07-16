'use strict';

// Signatures used by the drawing game.  The actual answers are calculated by
// the local frame solver; this file deliberately contains only the task data.
const SHAPE_FROM_VALUES = (vStart, vEnd) => {
  const sgn = value => value > 0.3 ? 1 : (value < -0.3 ? -1 : 0);
  return [sgn(vStart), sgn(vEnd)].join(',');
};

// Exact redraws of Part B from the *Aufgabenblätter* in /Basisprüfungen.
// Coordinate convention: x right, y down.  One coordinate unit is l unless
// the description explicitly states otherwise.  No solution PDF was used.
const FRAME_FIXTURES = [
  {
    id: 'bp-2017s-b',
    title: 'Geschweisstes T-Tragwerk',
    description: 'AB = BC = CE = l, CD = 2l; Horizontalkraft F bei A.',
    source: 'Basisprüfung FS 2017 · Teil B · Aufgabenseite 5',
    bbox: { w: 4, h: 3 },
    nodes: {
      A: { x: 0, y: 0 }, B: { x: 0, y: 1 }, C: { x: 1, y: 1 },
      D: { x: 3, y: 1 }, E: { x: 1, y: 2 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'CE', from: 'C', to: 'E' },
    ],
    supports: { D: 'pin', E: 'roller_y' },
    welds: ['B', 'C'],
    freeEnds: ['A'],
    loads: [{ kind: 'point', node: 'A', fx: -1, fy: 0, label: 'F' }],
  },
  {
    id: 'bp-2018s-b',
    title: 'Vier gelenkig verbundene Balken',
    description: 'AB = BC = CD = l, Diagonale BD; Kräfte √2F bei B und F bei C.',
    source: 'Basisprüfung FS 2018 · Teil B · Aufgabenseite 6',
    bbox: { w: 3, h: 2 },
    nodes: {
      A: { x: 0, y: 0 }, B: { x: 1, y: 0 }, C: { x: 1, y: 1 }, D: { x: 2, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'BD', from: 'B', to: 'D' },
    ],
    supports: { A: 'fixed', D: 'roller_y' },
    welds: [],
    loads: [
      { kind: 'point', node: 'B', fx: -1, fy: 1, label: '√2F' },
      { kind: 'point', node: 'C', fx: 0, fy: 1, label: 'F' },
    ],
  },
  {
    id: 'bp-2019s-b',
    title: 'Rahmen mit gelenkigem Dreieck',
    description: 'Breite und Geschosshöhen je l; Lastfall LF0 mit √2F bei D.',
    source: 'Basisprüfung FS 2019 · Teil B · Aufgabenseite 6',
    bbox: { w: 2, h: 3 },
    nodes: {
      A: { x: 0, y: 2 }, B: { x: 0, y: 1 }, C: { x: 1, y: 1 },
      D: { x: 1, y: 0 }, E: { x: 0, y: 0 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' },
      { id: 'EC', from: 'E', to: 'C' },
    ],
    supports: { A: 'fixed', E: 'roller_x' },
    welds: ['B'],
    loads: [{ kind: 'point', node: 'D', fx: 1, fy: -1, label: '√2F' }],
  },
  {
    id: 'bp-2019w-b',
    title: 'Geschweisstes Tragwerk mit kurzem Kragarm',
    description: 'BA = l/4, BC = CD = DG = DH = l; Vertikalkraft F bei A.',
    source: 'Basisprüfung HS 2019 · Teil B · Aufgabenseite 5',
    bbox: { w: 3, h: 3 },
    nodes: {
      B: { x: 0, y: 0 }, A: { x: 0.25, y: 0 }, C: { x: 0, y: 1 },
      D: { x: 1, y: 1 }, G: { x: 2, y: 1 }, H: { x: 1, y: 2 },
    },
    bars: [
      { id: 'BA', from: 'B', to: 'A' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'DG', from: 'D', to: 'G' },
      { id: 'DH', from: 'D', to: 'H' },
    ],
    supports: { G: 'pin', H: 'roller_y' },
    welds: ['B', 'C', 'D'],
    freeEnds: ['A'],
    loads: [{ kind: 'point', node: 'A', fx: 0, fy: 1, label: 'F' }],
  },
  {
    id: 'bp-2020s-b',
    title: 'Rahmen mit gelenkigem Diagonalverband',
    description: 'Drei Felder und Höhe je l; Lastfall LF0 mit Vertikalkraft F bei B.',
    source: 'Basisprüfung FS 2020 · Teil B · Aufgabenseite 6',
    bbox: { w: 4, h: 2 },
    nodes: {
      A: { x: 0, y: 1 }, B: { x: 1, y: 0 }, C: { x: 2, y: 0 },
      D: { x: 2, y: 1 }, E: { x: 3, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'AD', from: 'A', to: 'D' },
      { id: 'DE', from: 'D', to: 'E' },
    ],
    supports: { A: 'roller_y', E: 'fixed' },
    welds: ['C'],
    loads: [{ kind: 'point', node: 'B', fx: 0, fy: 1, label: 'F' }],
  },
  {
    id: 'bp-2021s-b',
    title: 'Drei in B verschweisste Balken',
    description: 'AB = BC = BE = l; F bei C, q = 2F/l nur im Bereich D–E (l/2).',
    source: 'Basisprüfung FS 2021 · Teil B · Aufgabenseite 7',
    bbox: { w: 3, h: 3 },
    nodes: {
      A: { x: 1, y: 2 }, B: { x: 1, y: 1 }, C: { x: 0, y: 0 },
      D: { x: 1.5, y: 1 }, E: { x: 2, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'BD', from: 'B', to: 'D' }, { id: 'DE', from: 'D', to: 'E', distributed: true },
    ],
    supports: { A: 'pin', E: 'roller_x' },
    welds: ['B', 'D'],
    loads: [
      { kind: 'point', node: 'C', fx: 0, fy: 1, label: 'F' },
      { kind: 'distributed', bar: 'DE', q: 2, label: 'q = 2F/l' },
    ],
    parabolicBars: { M: ['DE'] },
  },
  {
    id: 'bp-2021w-b',
    title: 'Drei gelenkig verbundene Balken',
    description: 'Höhe und horizontale Projektion von AB je l, BC = l; Gleichstreckenlast q auf B–C.',
    source: 'Basisprüfung HS 2021 · Teil B · Aufgabenseite 6',
    bbox: { w: 3, h: 2 },
    nodes: {
      A: { x: 0, y: 1 }, B: { x: 1, y: 0 }, C: { x: 2, y: 0 }, D: { x: 2, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' },
      { id: 'BC', from: 'B', to: 'C', distributed: true },
      { id: 'CD', from: 'C', to: 'D' },
    ],
    supports: { A: 'fixed', D: 'pin' },
    welds: [],
    markers: [{ id: 'E', bar: 'BC', t: 0.5, side: 1 }],
    loads: [{ kind: 'distributed', bar: 'BC', q: 1, label: 'q' }],
    parabolicBars: { M: ['BC'] },
  },
  {
    id: 'bp-2022s-b',
    title: 'Geschweisster Zickzackträger A–B–C–D',
    description: 'Drei horizontale Projektionen und Höhe je l; Vertikalkraft √2F bei C.',
    source: 'Basisprüfung FS 2022 · Teil B · Aufgabenseite 6',
    bbox: { w: 4, h: 2 },
    nodes: {
      A: { x: 0, y: 0 }, B: { x: 1, y: 1 }, C: { x: 2, y: 0 }, D: { x: 3, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' },
    ],
    supports: { A: 'roller_x', D: 'pin' },
    welds: ['B', 'C'],
    loads: [{ kind: 'point', node: 'C', fx: 0, fy: 1, label: '√2F' }],
  },
  {
    id: 'bp-2022w-b',
    title: 'Viergliedriger Zickzackträger',
    description: 'Vier horizontale Projektionen und Höhe je l; q = F/l senkrecht auf A–B.',
    source: 'Basisprüfung HS 2022 · Teil B · Aufgabenseite 6',
    bbox: { w: 5, h: 2 },
    nodes: {
      A: { x: 0, y: 1 }, B: { x: 1, y: 0 }, C: { x: 2, y: 1 },
      D: { x: 3, y: 0 }, E: { x: 4, y: 1 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B', distributed: true },
      { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' },
      { id: 'DE', from: 'D', to: 'E' },
    ],
    supports: { A: 'roller_y', E: 'fixed' },
    welds: ['B', 'C'],
    loads: [{ kind: 'distributed', bar: 'AB', q: 1, label: 'q = F/l' }],
    parabolicBars: { M: ['AB'] },
  },
  {
    id: 'bp-2023s-b',
    title: 'Geschweisstes Tragwerk mit T-Abzweig',
    description: 'Horizontale Projektionen und Höhe je l; Vertikalkraft F bei A.',
    source: 'Basisprüfung FS 2023 · Teil B · Aufgabenseite 6',
    bbox: { w: 4, h: 3 },
    nodes: {
      A: { x: 0, y: 0 }, B: { x: 1, y: 1 }, C: { x: 2, y: 1 },
      D: { x: 3, y: 1 }, E: { x: 2, y: 2 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'CE', from: 'C', to: 'E' },
    ],
    supports: { D: 'pin', E: 'roller_y' },
    welds: ['B', 'C'],
    freeEnds: ['A'],
    loads: [{ kind: 'point', node: 'A', fx: 0, fy: 1, label: 'F' }],
  },
  {
    id: 'bp-2023w-b',
    title: 'Geschweisstes Fünfeck-Tragwerk',
    description: 'Breite und beide Höhen je l; Horizontalkraft F nach links bei C.',
    source: 'Basisprüfung HS 2023 · Teil B · Aufgabenseite 6',
    bbox: { w: 3, h: 3 },
    nodes: {
      A: { x: 1, y: 2 }, B: { x: 0, y: 1 }, C: { x: 1, y: 0 },
      D: { x: 2, y: 1 }, E: { x: 2, y: 2 },
    },
    bars: [
      { id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' },
      { id: 'CD', from: 'C', to: 'D' }, { id: 'DE', from: 'D', to: 'E' },
    ],
    supports: { A: 'pin', E: 'roller_y' },
    welds: ['B', 'C', 'D'],
    loads: [{ kind: 'point', node: 'C', fx: -1, fy: 0, label: 'F' }],
  },
];

const PART_C_FIXTURES = [
  {
    id: 'bp-2017s-c-system-i', title: 'Eingespannter Balken unter Streckenlast',
    description: 'Wirkliches System: BC = l, Einspannung B, Loslager C, q auf ganz BC.',
    source: 'Basisprüfung FS 2017 · Teil C · Aufgabenseite 8', bbox: { w: 3, h: 1 },
    nodes: { B: { x: 0, y: 0 }, C: { x: 2, y: 0 } },
    bars: [{ id: 'BC', from: 'B', to: 'C', distributed: true }],
    supports: { B: 'fixed', C: 'roller_y' }, welds: [],
    loads: [{ kind: 'distributed', bar: 'BC', q: 1, label: 'q' }], parabolicBars: { M: ['BC'] },
  },
  {
    id: 'bp-2019s-c-system-ii', title: 'Zweifach abgewinkelter Kragträger',
    description: 'System II: AB = BC = CD = l, Einspannung D, äusseres Moment M₀ bei A.',
    source: 'Basisprüfung FS 2019 · Teil C · Aufgabenseite 9', bbox: { w: 3, h: 2 },
    nodes: { A: { x: 0, y: 0 }, B: { x: 1, y: 0 }, C: { x: 1, y: 1 }, D: { x: 2, y: 1 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }],
    supports: { D: 'fixed' }, welds: ['B', 'C'], freeEnds: ['A'],
    loads: [{ kind: 'moment', node: 'A', mz: -1, label: 'M₀' }],
  },
  {
    id: 'bp-2019w-c-system-ii', title: 'Dreigliedriger Gelenkrahmen',
    description: 'System II: AB = BC = CD = l, Gelenke B/C, q auf AB, Festlager A, Einspannung D.',
    source: 'Basisprüfung HS 2019 · Teil C · Aufgabenseite 8', bbox: { w: 3, h: 2 },
    nodes: { A: { x: 0, y: 1 }, B: { x: 1, y: 1 }, C: { x: 1, y: 0 }, D: { x: 0, y: 0 } },
    bars: [{ id: 'AB', from: 'A', to: 'B', distributed: true }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }],
    supports: { A: 'pin', D: 'fixed' }, welds: [],
    loads: [{ kind: 'distributed', bar: 'AB', q: 1, label: 'q' }], parabolicBars: { M: ['AB'] },
  },
  {
    id: 'bp-2020s-c-system-i', title: 'Durchlaufträger mit Pendelstütze',
    description: 'System I: AB = BC = CD = l, q nur auf B–C; Gelenke A/B/D und Loslager C.',
    source: 'Basisprüfung FS 2020 · Teil C · Aufgabenseite 9', bbox: { w: 4, h: 2 },
    nodes: { A: { x: 0, y: 0 }, B: { x: 0, y: 1 }, C: { x: 1, y: 1 }, D: { x: 2, y: 1 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C', distributed: true }, { id: 'CD', from: 'C', to: 'D' }],
    supports: { A: 'pin', C: 'roller_y', D: 'pin' }, welds: ['C'],
    loads: [{ kind: 'distributed', bar: 'BC', q: 1, label: 'q' }], parabolicBars: { M: ['BC'] },
  },
  {
    id: 'bp-2021s-c-system-i', title: 'Geschweisster Dachrahmen',
    description: 'System I: horizontale Projektionen und Höhe je l; Einspannung A, Loslager C, F bei B.',
    source: 'Basisprüfung FS 2021 · Teil C · Aufgabenseite 10', bbox: { w: 3, h: 2 },
    nodes: { A: { x: 0, y: 1 }, B: { x: 1, y: 0 }, C: { x: 2, y: 1 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }],
    supports: { A: 'fixed', C: 'roller_y' }, welds: ['B'],
    loads: [{ kind: 'point', node: 'B', fx: 1, fy: 0, label: 'F' }],
  },
  {
    id: 'bp-2021w-c-system-i', title: 'U-Rahmen mit geneigter Kraft',
    description: 'System I: AE = EB = BC = CD = l; Einspannung A, Loslager D, √2F bei B.',
    source: 'Basisprüfung HS 2021 · Teil C · Aufgabenseite 9', bbox: { w: 3, h: 2 },
    nodes: { A: { x: 0, y: 1 }, B: { x: 2, y: 1 }, C: { x: 2, y: 0 }, D: { x: 1, y: 0 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }],
    markers: [{ id: 'E', bar: 'AB', t: 0.5, side: 1 }],
    supports: { A: 'fixed', D: 'roller_y' }, welds: ['B', 'C'],
    loads: [{ kind: 'point', node: 'B', fx: 1, fy: 1, label: '√2F' }],
  },
  {
    id: 'bp-2022s-c-system-i', title: 'Abgewinkelter Träger A–B–C',
    description: 'System I: AB = 2l, BC = l; Einspannung A, Loslager B, Horizontalkraft F bei C.',
    source: 'Basisprüfung FS 2022 · Teil C · Aufgabenseite 9', bbox: { w: 4, h: 2 },
    nodes: { A: { x: 0, y: 1 }, B: { x: 2, y: 1 }, C: { x: 2, y: 0 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }],
    supports: { A: 'fixed', B: 'roller_y' }, welds: ['B'],
    loads: [{ kind: 'point', node: 'C', fx: -1, fy: 0, label: 'F' }],
  },
  {
    id: 'bp-2022w-c-system-i', title: 'Geschweisster Rechteckrahmen mit Kragarmen',
    description: 'System I: vier Balken der Länge l; Einspannung A, Loslager E, Vertikalkraft F bei D.',
    source: 'Basisprüfung HS 2022 · Teil C · Aufgabenseite 9', bbox: { w: 3, h: 2 },
    nodes: { A: { x: 0, y: 1 }, B: { x: 1, y: 1 }, C: { x: 1, y: 0 }, D: { x: 0, y: 0 }, E: { x: 2, y: 0 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }, { id: 'CE', from: 'C', to: 'E' }],
    supports: { A: 'fixed', E: 'roller_y' }, welds: ['B', 'C'], freeEnds: ['D'],
    loads: [{ kind: 'point', node: 'D', fx: 0, fy: 1, label: 'F' }],
  },
  {
    id: 'bp-2023w-c-system-ii', title: 'Dreifach abgewinkelter Kragträger',
    description: 'System II: AB = BC = l, Projektion CD = l; Einspannung A, Vertikalkraft F bei C.',
    source: 'Basisprüfung HS 2023 · Teil C · Aufgabenseite 9', bbox: { w: 3, h: 2 },
    nodes: { A: { x: 0, y: 1 }, B: { x: 1, y: 1 }, C: { x: 1, y: 0 }, D: { x: 2, y: 1 } },
    bars: [{ id: 'AB', from: 'A', to: 'B' }, { id: 'BC', from: 'B', to: 'C' }, { id: 'CD', from: 'C', to: 'D' }],
    supports: { A: 'fixed' }, welds: ['B', 'C'], freeEnds: ['D'],
    loads: [{ kind: 'point', node: 'C', fx: 0, fy: 1, label: 'F' }],
  },
];

const SELECTED_PART_B_IDS = new Set(['bp-2017s-b', 'bp-2019s-b', 'bp-2021s-b', 'bp-2022w-b', 'bp-2023w-b']);
const EXAM_FIXTURES = [...PART_C_FIXTURES, ...FRAME_FIXTURES.filter(f => SELECTED_PART_B_IDS.has(f.id))];

const SHAPE_NAMES = {
  '0,0': 'Null (kein Verlauf)',
  '1,1': 'Konstant positiv',
  '-1,-1': 'Konstant negativ',
  '0,1': 'Linear, 0 → positiv',
  '1,0': 'Linear, positiv → 0',
  '0,-1': 'Linear, 0 → negativ',
  '-1,0': 'Linear, negativ → 0',
  '1,-1': 'Linear, positiv → negativ',
  '-1,1': 'Linear, negativ → positiv',
};

window.FRAME_FIXTURES = EXAM_FIXTURES;
window.SHAPE_FROM_VALUES = SHAPE_FROM_VALUES;
window.SHAPE_NAMES = SHAPE_NAMES;
