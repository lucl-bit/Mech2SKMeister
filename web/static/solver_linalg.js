/* Lineare Algebra fuer die Loeser im Browser.
 *
 * Portiert aus schnittkraft_trainer/mechanics/truss_solver.py (_solve_linear_system)
 * und ersetzt die numpy-Aufrufe des frueheren Flask-Backends. Absichtlich ohne
 * Fremdpakete: laeuft unveraendert im Browser und unter `node --test`.
 */
(function (root, factory) {
  const api = factory();
  root.SKLinalg = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function zeros(rows, cols) {
    const out = new Array(rows);
    for (let i = 0; i < rows; i += 1) out[i] = new Float64Array(cols);
    return out;
  }

  /* Gauss-Jordan mit Spaltenpivotierung. Identisch zur Python-Vorlage,
   * inklusive der Schwellen 1e-10 (singulaer) und 1e-12 (Faktor ueberspringen). */
  function solveLinearSystem(matrix, rhs) {
    const size = rhs.length;
    if (matrix.length !== size) {
      throw new Error(`Matrix hat ${matrix.length} Zeilen, erwartet ${size}.`);
    }
    const aug = new Array(size);
    for (let i = 0; i < size; i += 1) {
      const row = new Float64Array(size + 1);
      for (let j = 0; j < size; j += 1) row[j] = matrix[i][j];
      row[size] = rhs[i];
      aug[i] = row;
    }

    for (let p = 0; p < size; p += 1) {
      let pivotRow = p;
      let best = Math.abs(aug[p][p]);
      for (let r = p + 1; r < size; r += 1) {
        const value = Math.abs(aug[r][p]);
        if (value > best) { best = value; pivotRow = r; }
      }
      if (best <= 1e-10) {
        throw new Error('Gleichungssystem ist singulär. Prüfe Geometrie und Lagerung.');
      }

      const tmp = aug[p]; aug[p] = aug[pivotRow]; aug[pivotRow] = tmp;
      const pivot = aug[p][p];
      for (let c = p; c <= size; c += 1) aug[p][c] /= pivot;

      for (let r = 0; r < size; r += 1) {
        if (r === p) continue;
        const factor = aug[r][p];
        if (Math.abs(factor) <= 1e-12) continue;
        for (let c = p; c <= size; c += 1) aug[r][c] -= factor * aug[p][c];
      }
    }

    const out = new Array(size);
    for (let i = 0; i < size; i += 1) out[i] = aug[i][size];
    return out;
  }

  function matMul(a, b) {
    const n = a.length;
    const m = b[0].length;
    const inner = b.length;
    const out = zeros(n, m);
    for (let i = 0; i < n; i += 1) {
      for (let k = 0; k < inner; k += 1) {
        const aik = a[i][k];
        if (aik === 0) continue;
        for (let j = 0; j < m; j += 1) out[i][j] += aik * b[k][j];
      }
    }
    return out;
  }

  function matVec(a, v) {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i += 1) {
      let sum = 0;
      for (let j = 0; j < v.length; j += 1) sum += a[i][j] * v[j];
      out[i] = sum;
    }
    return out;
  }

  function transpose(a) {
    const out = zeros(a[0].length, a.length);
    for (let i = 0; i < a.length; i += 1) {
      for (let j = 0; j < a[0].length; j += 1) out[j][i] = a[i][j];
    }
    return out;
  }

  /* Untermatrix ueber eine Indexliste - ersetzt numpys K[np.ix_(idx, idx)]. */
  function submatrix(a, indices) {
    const out = zeros(indices.length, indices.length);
    for (let i = 0; i < indices.length; i += 1) {
      for (let j = 0; j < indices.length; j += 1) out[i][j] = a[indices[i]][indices[j]];
    }
    return out;
  }

  /* Sortierung wie Pythons sorted(): Zahlen numerisch, Strings lexikografisch.
   * truss_builder.js schickt numerische IDs, frame_challenge.js Buchstaben -
   * beide Faelle muessen dieselbe Reihenfolge ergeben wie im Backend. */
  function comparePythonLike(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    const sa = String(a);
    const sb = String(b);
    if (sa < sb) return -1;
    if (sa > sb) return 1;
    return 0;
  }

  return { zeros, solveLinearSystem, matMul, matVec, transpose, submatrix, comparePythonLike };
});
