/* Rahmen-Loeser im Browser (Balken-Stab-Elemente, 2D).
 *
 * Portierung von _solve_frame_builder aus server.py. Die numpy-Aufrufe
 * (np.zeros, np.array, @, np.ix_, np.linalg.solve) sind durch SKLinalg ersetzt;
 * Aufbau, DOF-Nummerierung und Vorzeichen sind unveraendert uebernommen.
 *
 * Innere Gelenke entstehen wie im Original ueber eigene Rotations-DOFs je
 * (Stab, Ende) an nicht verschweissten Knoten mit mehr als einem Stab.
 */
(function (root, factory) {
  const linalg = root.SKLinalg || (typeof require !== 'undefined' ? require('./solver_linalg.js') : null);
  if (!linalg) throw new Error('solver_frame.js braucht solver_linalg.js');
  const api = factory(linalg);
  root.SKFrame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {
  'use strict';

  const EA = 1000.0;
  const EI = 1.0;

  /* Pythons round() rundet zur naechsten geraden Ziffer (banker's rounding),
   * Math.round nicht. Das Backend rundet Ergebnisse auf 4 Stellen - hier
   * dieselbe Regel, damit die Werte exakt gleich herauskommen. */
  function round4(value) {
    const scaled = value * 1e4;
    const floor = Math.floor(scaled);
    const diff = scaled - floor;
    let rounded;
    if (Math.abs(diff - 0.5) < Number.EPSILON * Math.abs(scaled)) {
      rounded = floor % 2 === 0 ? floor : floor + 1;
    } else {
      rounded = Math.round(scaled);
    }
    const out = rounded / 1e4;
    return out === 0 ? 0 : out;
  }

  function solveFrame(joints, bars, supportsList, loads, weldsSet, distributedLoads) {
    const welds = weldsSet instanceof Set ? weldsSet : new Set(weldsSet || []);
    const dists = distributedLoads || [];

    const jmap = new Map(joints.map((j) => [j.joint_id, j]));
    const jids = joints.map((j) => j.joint_id);
    const jidx = new Map(jids.map((jid, i) => [jid, i]));
    const nJ = jids.length;

    const barsAt = new Map();
    const pushBarAt = (jid, bid) => {
      if (!barsAt.has(jid)) barsAt.set(jid, []);
      barsAt.get(jid).push(bid);
    };
    for (const b of bars) {
      pushBarAt(b.start_id, b.bar_id);
      pushBarAt(b.end_id, b.bar_id);
    }

    const uxDof = new Map(jids.map((jid, i) => [jid, 2 * i]));
    const uyDof = new Map(jids.map((jid, i) => [jid, 2 * i + 1]));
    let nextDof = 2 * nJ;

    const jrotDof = new Map();
    const brotStart = new Map();
    const brotEnd = new Map();

    for (const jid of jids) {
      const attached = barsAt.get(jid) || [];
      if (welds.has(jid) || attached.length <= 1) {
        jrotDof.set(jid, nextDof);
        nextDof += 1;
      }
    }
    for (const b of bars) {
      if (!jrotDof.has(b.start_id)) { brotStart.set(b.bar_id, nextDof); nextDof += 1; }
      if (!jrotDof.has(b.end_id)) { brotEnd.set(b.bar_id, nextDof); nextDof += 1; }
    }

    const nDof = nextDof;
    const K = L.zeros(nDof, nDof);
    const F = new Float64Array(nDof);
    const elemData = new Map();

    for (const b of bars) {
      const bid = b.bar_id;
      const j1 = jmap.get(b.start_id);
      const j2 = jmap.get(b.end_id);
      const x1 = Number(j1.x); const y1 = Number(j1.y);
      const x2 = Number(j2.x); const y2 = Number(j2.y);
      const dx = x2 - x1; const dy = y2 - y1;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 1e-9) throw new Error(`bar ${bid} has zero length`);
      const cx = dx / len; const cy = dy / len;

      const T = [
        [cx, cy, 0, 0, 0, 0],
        [-cy, cx, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0],
        [0, 0, 0, cx, cy, 0],
        [0, 0, 0, -cy, cx, 0],
        [0, 0, 0, 0, 0, 1],
      ];
      const L2 = len * len;
      const L3 = L2 * len;
      const kLoc = [
        [EA / len, 0, 0, -EA / len, 0, 0],
        [0, 12 * EI / L3, 6 * EI / L2, 0, -12 * EI / L3, 6 * EI / L2],
        [0, 6 * EI / L2, 4 * EI / len, 0, -6 * EI / L2, 2 * EI / len],
        [-EA / len, 0, 0, EA / len, 0, 0],
        [0, -12 * EI / L3, -6 * EI / L2, 0, 12 * EI / L3, -6 * EI / L2],
        [0, 6 * EI / L2, 2 * EI / len, 0, -6 * EI / L2, 4 * EI / len],
      ];
      const Tt = L.transpose(T);
      const kGlob = L.matMul(L.matMul(Tt, kLoc), T);

      const th1 = jrotDof.has(b.start_id) ? jrotDof.get(b.start_id) : brotStart.get(bid);
      const th2 = jrotDof.has(b.end_id) ? jrotDof.get(b.end_id) : brotEnd.get(bid);
      const dofs = [uxDof.get(b.start_id), uyDof.get(b.start_id), th1,
        uxDof.get(b.end_id), uyDof.get(b.end_id), th2];

      for (let a = 0; a < 6; a += 1) {
        for (let bb = 0; bb < 6; bb += 1) K[dofs[a]][dofs[bb]] += kGlob[a][bb];
      }
      elemData.set(bid, { T, Tt, kLoc, len, dofs });
    }

    // Streckenlasten als Knotenersatzlasten (UDL, q positiv = +lokales y)
    for (const dl of dists) {
      const elem = elemData.get(dl.bar_id);
      if (!elem) throw new Error(`unbekannter Stab in Streckenlast: ${dl.bar_id}`);
      const q = Number(dl.q);
      const len = elem.len;
      const fefLoc = [0, q * len / 2, q * len * len / 12, 0, q * len / 2, -q * len * len / 12];
      const fefGlob = L.matVec(elem.Tt, fefLoc);
      for (let a = 0; a < 6; a += 1) F[elem.dofs[a]] += fefGlob[a];
    }

    // Einzellasten
    for (const ld of (loads || [])) {
      const jid = ld.joint_id;
      F[uxDof.get(jid)] += Number(ld.fx || 0);
      F[uyDof.get(jid)] += Number(ld.fy || 0);
      const mz = Number(ld.mz || 0);
      if (Math.abs(mz) > 0) {
        if (!jrotDof.has(jid)) {
          throw new Error(`Knotenmoment an Gelenk ${jid} ist nicht eindeutig zuordenbar`);
        }
        F[jrotDof.get(jid)] += mz;
      }
    }

    // Randbedingungen
    const supMap = new Map((supportsList || []).map((s) => [s.joint_id, s.support_type]));
    const fixedDofs = new Set();
    for (const [jid, stype] of supMap) {
      if (stype === 'pin' || stype === 'fixed' || stype === 'roller_x') fixedDofs.add(uxDof.get(jid));
      if (stype === 'pin' || stype === 'fixed' || stype === 'roller' || stype === 'roller_y') {
        fixedDofs.add(uyDof.get(jid));
      }
      if (stype === 'fixed' && jrotDof.has(jid)) fixedDofs.add(jrotDof.get(jid));
    }

    const freeDofs = [];
    for (let d = 0; d < nDof; d += 1) if (!fixedDofs.has(d)) freeDofs.push(d);

    const Kff = L.submatrix(K, freeDofs);
    const Ff = freeDofs.map((d) => F[d]);
    const dFree = solveOrLeastSquares(Kff, Ff);

    const d = new Float64Array(nDof);
    freeDofs.forEach((dof, i) => { d[dof] = dFree[i]; });

    // Schnittgroessen im lokalen System
    const barForces = {};
    for (const b of bars) {
      const bid = b.bar_id;
      const elem = elemData.get(bid);
      const dElem = elem.dofs.map((dof) => d[dof]);
      const dLoc = L.matVec(elem.T, dElem);
      const fLoc = L.matVec(elem.kLoc, dLoc);

      const fefLoc = new Float64Array(6);
      for (const dl of dists) {
        if (dl.bar_id === bid) {
          const q = Number(dl.q);
          const len = elem.len;
          fefLoc[1] += q * len / 2;
          fefLoc[2] += q * len * len / 12;
          fefLoc[4] += q * len / 2;
          fefLoc[5] += -q * len * len / 12;
        }
      }
      const fInt = new Float64Array(6);
      for (let i = 0; i < 6; i += 1) fInt[i] = fLoc[i] - fefLoc[i];

      barForces[String(bid)] = {
        N_start: round4(-fInt[0]), Q_start: round4(-fInt[1]), M_start: round4(fInt[2]),
        N_end: round4(fInt[3]), Q_end: round4(fInt[4]), M_end: round4(-fInt[5]),
      };
    }

    // Auflagerreaktionen an gesperrten Freiheitsgraden
    const Kd = L.matVec(K, d);
    const reactions = {};
    for (const [jid, stype] of supMap) {
      if (fixedDofs.has(uxDof.get(jid))) {
        reactions[`rx:${jid}`] = round4(Kd[uxDof.get(jid)] - F[uxDof.get(jid)]);
      }
      if (fixedDofs.has(uyDof.get(jid))) {
        reactions[`ry:${jid}`] = round4(Kd[uyDof.get(jid)] - F[uyDof.get(jid)]);
      }
      if (stype === 'fixed' && jrotDof.has(jid) && fixedDofs.has(jrotDof.get(jid))) {
        const th = jrotDof.get(jid);
        reactions[`mz:${jid}`] = round4(Kd[th] - F[th]);
      }
    }

    return { bar_forces: barForces, reactions };
  }

  /* Entspricht np.linalg.solve mit lstsq-Rueckfall. Der Rueckfall loest hier die
   * regularisierten Normalengleichungen statt per SVD - er greift nur bei
   * singulaerer Systemmatrix (kinematisch unbestimmtes System) und kann dort
   * minimal von numpy abweichen. Alle Faelle in tests_static/golden.json
   * laufen ueber den direkten Weg. */
  function solveOrLeastSquares(A, b) {
    try {
      return L.solveLinearSystem(A, b);
    } catch (err) {
      const At = L.transpose(A);
      const AtA = L.matMul(At, A);
      const Atb = L.matVec(At, b);
      for (let i = 0; i < AtA.length; i += 1) AtA[i][i] += 1e-12;
      return L.solveLinearSystem(AtA, Array.from(Atb));
    }
  }

  return { solveFrame, round4 };
});
