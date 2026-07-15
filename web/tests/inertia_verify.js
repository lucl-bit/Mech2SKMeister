'use strict';
/**
 * Unabhängiger Korrektheitsprüfer für den Inertia-Lab-Modus.
 *
 * Strategie: Für jede Aufgabe (Fixture + Generator-Fälle) werden alle
 * InertiaMath-Ergebnisse gegen eine *unabhängige* geometrie-basierte
 * Referenz geprüft, die die echten Polygon-Momente verwendet.
 *
 * Ausführen: node web/tests/inertia_verify.js
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');

// ────────────────────────────────────────────────────────────────
//  JS-Dateien in Node laden (window-Shim notwendig)
// ────────────────────────────────────────────────────────────────

const window = {};
const context = vm.createContext({ window, Math, console });

const staticDir = path.join(__dirname, '..', 'static');
for (const file of ['inertia_fixtures.js', 'inertia_lab.js']) {
  const code = fs.readFileSync(path.join(staticDir, file), 'utf8');
  try {
    vm.runInContext(code, context);
  } catch (e) {
    console.error(`Fehler beim Laden von ${file}: ${e.message}`);
    process.exit(1);
  }
}

const { InertiaFixtures, InertiaMath, generateInertiaChallenge } = context.window;

if (!InertiaMath || !InertiaFixtures || !generateInertiaChallenge) {
  console.error('Fehlende Exports — prüfe ob inertia_fixtures.js window.InertiaMath etc. setzt');
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────
//  Unabhängige Referenzgeometrie (Polygon-Momenten-Formel)
// ────────────────────────────────────────────────────────────────

/**
 * Gibt die Polygon-Eckpunkte [[y,z],...] exakt so zurück, wie drawPartPath
 * in inertia_lab.js die Teile zeichnet (identische Logik, kopiert damit Test
 * die *echte* Zeichengeometrie abbildet und nicht eine abweichende).
 */
function getPartVertices(p) {
  if (p.type === 'rect') {
    const y0 = p.cy - p.b / 2, y1 = p.cy + p.b / 2;
    const z0 = p.cz - p.h / 2, z1 = p.cz + p.h / 2;
    return [[y0, z0], [y1, z0], [y1, z1], [y0, z1]];
  }
  if (p.type === 'triangle') {
    const o = p.orient || 'up';
    if (o === 'up') {
      const baseZ = p.cz - p.h / 3;
      const apexZ = p.cz + 2 * p.h / 3;
      return [[p.cy - p.b / 2, baseZ], [p.cy + p.b / 2, baseZ], [p.cy, apexZ]];
    } else if (o === 'down') {
      const baseZ = p.cz + p.h / 3;
      const apexZ = p.cz - 2 * p.h / 3;
      return [[p.cy - p.b / 2, baseZ], [p.cy + p.b / 2, baseZ], [p.cy, apexZ]];
    } else if (o === 'right') {
      const baseY = p.cy - p.b / 3;
      const apexY = p.cy + 2 * p.b / 3;
      return [[baseY, p.cz - p.h / 2], [baseY, p.cz + p.h / 2], [apexY, p.cz]];
    } else { // left
      const baseY = p.cy + p.b / 3;
      const apexY = p.cy - 2 * p.b / 3;
      return [[baseY, p.cz - p.h / 2], [baseY, p.cz + p.h / 2], [apexY, p.cz]];
    }
  }
  return []; // Kreis: separat behandelt
}

/** Vorzeichenbehaftete Fläche (negativ = CW-Orientierung). */
function polySignedArea(verts) {
  let s = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const [y0, z0] = verts[i];
    const [y1, z1] = verts[(i + 1) % n];
    s += y0 * z1 - y1 * z0;
  }
  return s / 2;
}

/**
 * Rohes (vorzeichenbehaftetes) zweites Flächenmoment um z=0
 * nach der Polygon-Formel: I_y_roh = (1/12) Σ (y_i z_{i+1} − y_{i+1} z_i)(z_i²+z_i z_{i+1}+z_{i+1}²)
 * Positiv für CCW-Polygone, negativ für CW. Dividiert durch den Vorzeichen-Faktor
 * der signed area erhält man das geometrische (stets positive) I_y um z=0.
 */
function polyRawIy(verts) {
  let s = 0;
  const n = verts.length;
  for (let i = 0; i < n; i++) {
    const [y0, z0] = verts[i];
    const [y1, z1] = verts[(i + 1) % n];
    s += (y0 * z1 - y1 * z0) * (z0 * z0 + z0 * z1 + z1 * z1);
  }
  return s / 12;
}

/**
 * Tatsächliches I_y um z=0 für ein Einzelteil (sign-unabhängig, immer ≥0).
 * Für Kreise: exakte Formel πr⁴/4 + πr²·cz².
 */
function refPartIyAboutZ0(p) {
  if (p.type === 'circle') {
    const Iown = Math.PI * Math.pow(p.r, 4) / 4;
    const A = Math.PI * p.r * p.r;
    return Iown + p.cz * p.cz * A;
  }
  const verts = getPartVertices(p);
  const raw = polyRawIy(verts);
  const sa = polySignedArea(verts);
  // Polygon-Rohwert hat dasselbe Vorzeichen wie signed area → dividieren ergibt pos. Wert
  return (sa !== 0) ? raw / Math.sign(sa) : 0;
}

/** Tatsächliche Fläche eines Teils (sign-unabhängig). */
function refPartArea(p) {
  if (p.type === 'circle') return Math.PI * p.r * p.r;
  const verts = getPartVertices(p);
  return Math.abs(polySignedArea(verts));
}

/** Gesamtes I_y der Aufgabe (inklusive Vorzeichen der Teile = Aussparungen). */
function refTotalIy(parts) {
  let total = 0;
  for (const p of parts) total += p.sign * refPartIyAboutZ0(p);
  return total;
}

/**
 * Schwerpunkt z_s der Aufgabe. Muss ≈ 0 sein, da alle Aufgaben den
 * Schwerpunkt als Bezugsachse verwenden.
 */
function refCentroidZ(parts) {
  let wA = 0, A = 0;
  for (const p of parts) {
    const a = p.sign * refPartArea(p);
    wA += a * p.cz;
    A += a;
  }
  return A !== 0 ? wA / A : 0;
}

// ────────────────────────────────────────────────────────────────
//  Prüf-Funktionen
// ────────────────────────────────────────────────────────────────

const EPS = 1e-6;
function near(a, b) { return Math.abs(a - b) < EPS; }
function nearish(a, b) { return Math.abs(a - b) < Math.max(EPS, Math.abs(b) * 1e-6); }

let failures = 0;
let checks = 0;

function fail(id, msg, got, expected) {
  failures++;
  console.error(`  FAIL [${id}] ${msg}`);
  console.error(`       erwartet: ${expected}, erhalten: ${got}`);
}

function checkChallenge(ch) {
  const id = ch.id;
  const parts = ch.parts;

  // ── 1. Schwerpunkt-Invariante: z_s ≈ 0 ──────────────────────
  checks++;
  const zc = refCentroidZ(parts);
  if (Math.abs(zc) > 1e-9) {
    fail(id, 'Schwerpunkt ≠ 0', zc.toFixed(6), '0');
  }

  // ── 2. Gesamt-I_y: InertiaMath vs. Geometrie ─────────────────
  checks++;
  const calcIy = InertiaMath.totalIy(parts);
  const refIy  = refTotalIy(parts);
  if (!nearish(calcIy, refIy)) {
    fail(id, `totalIy falsch`, calcIy.toFixed(6), refIy.toFixed(6));
  }

  // ── 3. Pro-Teil: partArea, partIyOwn, Steiner ─────────────────
  parts.forEach((p, i) => {
    const partId = `${id}/Teil${i + 1}`;

    checks++;
    const calcA = InertiaMath.partArea(p);
    const refA  = refPartArea(p);
    if (!nearish(calcA, refA)) {
      fail(partId, 'partArea falsch', calcA.toFixed(6), refA.toFixed(6));
    }

    // I_eigen (Eigenträgheitsmoment um Schwerpunktachse des Teils):
    // Referenz = I_y_about_z=0 − cz² * A (Steiner rückwärts)
    checks++;
    const calcIe = InertiaMath.partIyOwn(p);
    const refIe  = refPartIyAboutZ0(p) - p.cz * p.cz * refA;
    if (!nearish(calcIe, refIe)) {
      fail(partId, `partIyOwn falsch (orient=${p.orient || '-'})`, calcIe.toFixed(6), refIe.toFixed(6));
    }

    // Steiner-Term d²·A
    checks++;
    const calcD = p.cz * p.cz * calcA;
    const refD  = p.cz * p.cz * refA;
    if (!nearish(calcD, refD)) {
      fail(partId, 'd²·A falsch', calcD.toFixed(6), refD.toFixed(6));
    }
  });
}

// ────────────────────────────────────────────────────────────────
//  Alle Fixtures prüfen
// ────────────────────────────────────────────────────────────────

console.log(`\nPrüfe ${InertiaFixtures.length} statische Fixtures …`);
for (const ch of InertiaFixtures) {
  checkChallenge(ch);
}
const failsAfterFixtures = failures;
console.log(`  → ${InertiaFixtures.length} Fixtures, ${failsAfterFixtures} Fehler`);

// ────────────────────────────────────────────────────────────────
//  Generator-Fälle prüfen (2000 pro Level)
// ────────────────────────────────────────────────────────────────

const GEN_PER_LEVEL = 2000;
const levels = ['easy', 'mid', 'hard'];
let genTotal = 0;
let genFails = 0;

console.log(`\nPrüfe ${GEN_PER_LEVEL * levels.length} generierte Aufgaben …`);
for (const level of levels) {
  for (let i = 0; i < GEN_PER_LEVEL; i++) {
    const ch = generateInertiaChallenge(level);
    const beforeFails = failures;
    checkChallenge(ch);
    if (failures > beforeFails) genFails++;
    genTotal++;
  }
}
console.log(`  → ${genTotal} generierte Aufgaben, ${failures - failsAfterFixtures} Fehler`);

// ────────────────────────────────────────────────────────────────
//  Ergebnis
// ────────────────────────────────────────────────────────────────

console.log(`\n──────────────────────────────────────────`);
console.log(`Gesamt-Checks: ${checks}`);
if (failures === 0) {
  console.log(`Ergebnis: ✓ Alle Checks bestanden.`);
  process.exit(0);
} else {
  console.log(`Ergebnis: ✗ ${failures} Fehler gefunden.`);
  process.exit(1);
}
