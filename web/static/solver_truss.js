/* Fachwerk-Loeser im Browser.
 *
 * Portierung von schnittkraft_trainer/mechanics/truss_solver.py (solve_truss).
 * Vorzeichen und Konvention unveraendert:
 *   x nach rechts, y nach unten positiv
 *   Stabkraft positiv = Zug, negativ = Druck
 * Die Python-Datei bleibt die Referenz - tests_static/solver.test.js vergleicht
 * diese Portierung gegen deren Ergebnisse (tests_static/golden.json).
 */
(function (root, factory) {
  const linalg = root.SKLinalg || (typeof require !== 'undefined' ? require('./solver_linalg.js') : null);
  if (!linalg) throw new Error('solver_truss.js braucht solver_linalg.js');
  const api = factory(linalg);
  root.SKTruss = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (L) {
  'use strict';

  const PIN_TYPES = new Set(['pin', 'pin_wall', 'fixed']);
  const ROLLER_Y_TYPES = new Set(['roller', 'roller_y']);

  function validateModel(model) {
    const jointIds = new Set(model.joints.map((j) => j.joint_id));
    if (jointIds.size !== model.joints.length) throw new Error('Knoten-IDs müssen eindeutig sein.');
    if (model.joints.length === 0) throw new Error('Fachwerk braucht mindestens einen Knoten.');

    for (const bar of model.bars) {
      if (!jointIds.has(bar.start_id) || !jointIds.has(bar.end_id)) {
        throw new Error(`Stab ${bar.bar_id} referenziert unbekannte Knoten.`);
      }
      if (bar.start_id === bar.end_id) {
        throw new Error(`Stab ${bar.bar_id} verbindet einen Knoten mit sich selbst.`);
      }
    }
    for (const support of model.supports) {
      if (!jointIds.has(support.joint_id)) throw new Error('Lager referenziert unbekannten Knoten.');
    }
    for (const load of model.loads) {
      if (!jointIds.has(load.joint_id)) throw new Error('Last referenziert unbekannten Knoten.');
    }
  }

  function sumLoadsByJoint(loads) {
    const result = new Map();
    for (const load of loads) {
      const prev = result.get(load.joint_id) || [0, 0];
      result.set(load.joint_id, [prev[0] + Number(load.fx || 0), prev[1] + Number(load.fy || 0)]);
    }
    return result;
  }

  function solveTruss(model) {
    validateModel(model);

    const joints = model.joints.slice().sort((a, b) => L.comparePythonLike(a.joint_id, b.joint_id));
    const jointIndex = new Map(joints.map((joint, index) => [joint.joint_id, index]));
    const loadsByJoint = sumLoadsByJoint(model.loads);

    const unknownNames = [];
    for (const bar of model.bars) unknownNames.push(`bar:${bar.bar_id}`);
    for (const support of model.supports) {
      const type = support.support_type;
      if (PIN_TYPES.has(type)) {
        unknownNames.push(`rx:${support.joint_id}`);
        unknownNames.push(`ry:${support.joint_id}`);
      } else if (ROLLER_Y_TYPES.has(type)) {
        unknownNames.push(`ry:${support.joint_id}`);
      } else if (type === 'roller_x') {
        unknownNames.push(`rx:${support.joint_id}`);
      } else {
        throw new Error(`Unsupported support type: ${type}`);
      }
    }

    const equationCount = 2 * joints.length;
    if (unknownNames.length !== equationCount) {
      throw new Error(
        'Fachwerk ist nicht statisch bestimmt nach m + r = 2j '
        + `(${unknownNames.length} Unbekannte, ${equationCount} Gleichungen).`,
      );
    }

    const matrix = L.zeros(equationCount, unknownNames.length);
    const rhs = new Float64Array(equationCount);
    const unknownIndex = new Map(unknownNames.map((name, index) => [name, index]));

    for (const joint of joints) {
      const rowX = 2 * jointIndex.get(joint.joint_id);
      const load = loadsByJoint.get(joint.joint_id) || [0, 0];
      rhs[rowX] = -load[0];
      rhs[rowX + 1] = -load[1];
    }

    const jointsById = new Map(joints.map((joint) => [joint.joint_id, joint]));
    for (const bar of model.bars) {
      const start = jointsById.get(bar.start_id);
      const end = jointsById.get(bar.end_id);
      const dx = Number(end.x) - Number(start.x);
      const dy = Number(end.y) - Number(start.y);
      const length = Math.hypot(dx, dy);
      if (length <= 1e-9) throw new Error(`Stab ${bar.bar_id} hat Länge 0.`);

      const ux = dx / length;
      const uy = dy / length;
      const col = unknownIndex.get(`bar:${bar.bar_id}`);

      const startRowX = 2 * jointIndex.get(start.joint_id);
      const endRowX = 2 * jointIndex.get(end.joint_id);

      matrix[startRowX][col] += ux;
      matrix[startRowX + 1][col] += uy;
      matrix[endRowX][col] -= ux;
      matrix[endRowX + 1][col] -= uy;
    }

    for (const support of model.supports) {
      const rowX = 2 * jointIndex.get(support.joint_id);
      const type = support.support_type;
      if (PIN_TYPES.has(type)) {
        matrix[rowX][unknownIndex.get(`rx:${support.joint_id}`)] = 1.0;
        matrix[rowX + 1][unknownIndex.get(`ry:${support.joint_id}`)] = 1.0;
      } else if (ROLLER_Y_TYPES.has(type)) {
        matrix[rowX + 1][unknownIndex.get(`ry:${support.joint_id}`)] = 1.0;
      } else if (type === 'roller_x') {
        matrix[rowX][unknownIndex.get(`rx:${support.joint_id}`)] = 1.0;
      }
    }

    const solution = L.solveLinearSystem(matrix, rhs);

    const barForces = {};
    for (const bar of model.bars) {
      barForces[String(bar.bar_id)] = solution[unknownIndex.get(`bar:${bar.bar_id}`)];
    }
    const reactions = {};
    unknownNames.forEach((name, index) => {
      if (name.startsWith('rx:') || name.startsWith('ry:')) reactions[name] = solution[index];
    });

    return { bar_forces: barForces, reactions };
  }

  return { solveTruss };
});
