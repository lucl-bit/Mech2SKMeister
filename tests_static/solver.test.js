/* Vergleicht die JS-Loeser gegen die Ergebnisse der Python-Loeser.
 *
 * tests_static/golden.json wird von tools/build_static.py erzeugt: sie enthaelt
 * Eingabe und Python-Ergebnis fuer jeden Fall. Damit ist die Python-Seite die
 * Referenz - die JS-Portierung muss sie treffen, nicht umgekehrt.
 *
 * Aufruf:  node --test tests_static/
 * Bewusst ohne npm-Pakete (das Projekt liegt in der iCloud-Synchronisation).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const STATIC_DIR = path.join(__dirname, '..', 'web', 'static');
const { solveTruss } = require(path.join(STATIC_DIR, 'solver_truss.js'));
const { solveFrame } = require(path.join(STATIC_DIR, 'solver_frame.js'));

const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden.json'), 'utf8'));

const TOL = 1e-9;

function assertClose(actual, expected, label) {
  assert.strictEqual(typeof actual, 'number', `${label}: kein Zahlenwert (${actual})`);
  const diff = Math.abs(actual - expected);
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(
    diff / scale <= TOL,
    `${label}: JS ${actual} vs Python ${expected} (Abweichung ${diff.toExponential(3)})`,
  );
}

function compareFlat(actual, expected, prefix) {
  assert.deepStrictEqual(
    Object.keys(actual).sort(), Object.keys(expected).sort(),
    `${prefix}: andere Schluessel`,
  );
  for (const key of Object.keys(expected)) {
    assertClose(actual[key], expected[key], `${prefix}.${key}`);
  }
}

function compareNested(actual, expected, prefix) {
  assert.deepStrictEqual(
    Object.keys(actual).sort(), Object.keys(expected).sort(),
    `${prefix}: andere Schluessel`,
  );
  for (const key of Object.keys(expected)) {
    compareFlat(actual[key], expected[key], `${prefix}.${key}`);
  }
}

test(`golden.json enthaelt Faelle`, () => {
  assert.ok(golden.cases.length > 50, `nur ${golden.cases.length} Faelle`);
});

for (const testCase of golden.cases) {
  test(`${testCase.kind}: ${testCase.name}`, () => {
    const p = testCase.payload;
    let result;
    if (testCase.kind === 'truss') {
      result = solveTruss({ joints: p.joints, bars: p.bars, loads: p.loads, supports: p.supports });
      compareFlat(result.bar_forces, testCase.expected.bar_forces, 'bar_forces');
    } else {
      result = solveFrame(p.joints, p.bars, p.supports, p.loads, new Set(p.welds), p.distributed_loads);
      compareNested(result.bar_forces, testCase.expected.bar_forces, 'bar_forces');
    }
    compareFlat(result.reactions, testCase.expected.reactions, 'reactions');
  });
}
