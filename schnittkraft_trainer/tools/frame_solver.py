"""
2D Direct Stiffness Frame Solver.
Computes N, Q, M sign patterns for each bar in a frame structure.
Used to generate solutions for frame_fixtures.js.

Coordinate system: math (x right, y up).
"""

import numpy as np
import json
import math
import sys

# ── Element stiffness ──────────────────────────────────────────────────────────

def element_stiffness(L, EA, EI):
    """6×6 local stiffness matrix for 2D Euler-Bernoulli beam element.
    DOF order: [u1, v1, t1, u2, v2, t2] (u=axial, v=transverse, t=rotation)
    """
    k = np.zeros((6, 6))
    k[0, 0] =  EA / L;  k[0, 3] = -EA / L
    k[3, 0] = -EA / L;  k[3, 3] =  EA / L

    k[1, 1] =  12*EI/L**3;  k[1, 2] =  6*EI/L**2;  k[1, 4] = -12*EI/L**3;  k[1, 5] =  6*EI/L**2
    k[2, 1] =   6*EI/L**2;  k[2, 2] =   4*EI/L;    k[2, 4] =  -6*EI/L**2;  k[2, 5] =  2*EI/L
    k[4, 1] = -12*EI/L**3;  k[4, 2] = -6*EI/L**2;  k[4, 4] =  12*EI/L**3;  k[4, 5] = -6*EI/L**2
    k[5, 1] =   6*EI/L**2;  k[5, 2] =   2*EI/L;    k[5, 4] =  -6*EI/L**2;  k[5, 5] =  4*EI/L
    return k


def transform_matrix(dx, dy, L):
    """6×6 global→local transformation matrix for bar at angle atan2(dy,dx)."""
    c, s = dx / L, dy / L
    T = np.array([
        [ c,  s, 0,  0,  0, 0],
        [-s,  c, 0,  0,  0, 0],
        [ 0,  0, 1,  0,  0, 0],
        [ 0,  0, 0,  c,  s, 0],
        [ 0,  0, 0, -s,  c, 0],
        [ 0,  0, 0,  0,  0, 1],
    ])
    return T


def element_global_stiffness(x1, y1, x2, y2, EA, EI):
    dx, dy = x2 - x1, y2 - y1
    L = math.hypot(dx, dy)
    k_loc = element_stiffness(L, EA, EI)
    T = transform_matrix(dx, dy, L)
    k_glob = T.T @ k_loc @ T
    return k_glob, T, k_loc, L


# ── Assembly & solve ───────────────────────────────────────────────────────────

def solve_frame(nodes, members, supports, point_loads, distributed_loads,
                EA=1000.0, EI=1.0):
    """
    nodes: dict {id: (x, y)}
    members: list of (id, start_node_id, end_node_id)
    supports: dict {node_id: type}  type ∈ {'fixed','pin','roller_y','roller_x'}
    point_loads: list of (node_id, fx, fy)   (moment not supported here)
    distributed_loads: list of (member_id, q_local)  q positive = upward in local y

    Returns: dict {member_id: {N_start, Q_start, M_start, N_end, Q_end, M_end}}
    """
    node_ids = list(nodes.keys())
    n_nodes = len(node_ids)
    nid = {nid: i for i, nid in enumerate(node_ids)}  # node_id → index

    n_dof = 3 * n_nodes
    K = np.zeros((n_dof, n_dof))
    F = np.zeros(n_dof)

    # ── Assemble global K ──────────────────────────────────────────────────────
    elem_data = {}  # member_id → (T, k_loc, L, i, j)
    for (mid, n_start, n_end) in members:
        x1, y1 = nodes[n_start]
        x2, y2 = nodes[n_end]
        k_glob, T, k_loc, L = element_global_stiffness(x1, y1, x2, y2, EA, EI)
        i, j = nid[n_start], nid[n_end]
        dofs = [3*i, 3*i+1, 3*i+2, 3*j, 3*j+1, 3*j+2]
        for a, da in enumerate(dofs):
            for b, db in enumerate(dofs):
                K[da, db] += k_glob[a, b]
        elem_data[mid] = (T, k_loc, L, i, j)

    # ── Fixed-end forces from distributed loads ────────────────────────────────
    for (mid, q) in distributed_loads:
        T, k_loc, L, i, j = elem_data[mid]
        # Local fixed-end forces for UDL q (per unit length, positive = upward local y)
        # [0, qL/2, qL²/12, 0, qL/2, -qL²/12]
        fef_loc = np.array([0, q*L/2, q*L**2/12, 0, q*L/2, -q*L**2/12])
        fef_glob = T.T @ fef_loc
        dofs = [3*i, 3*i+1, 3*i+2, 3*j, 3*j+1, 3*j+2]
        for a, da in enumerate(dofs):
            F[da] += fef_glob[a]

    # ── Point loads ────────────────────────────────────────────────────────────
    for (nid_str, fx, fy) in point_loads:
        idx = nid[nid_str]
        F[3*idx]   += fx
        F[3*idx+1] += fy

    # ── Boundary conditions (penalty / elimination) ────────────────────────────
    fixed_dofs = set()
    for (nid_str, stype) in supports.items():
        idx = nid[nid_str]
        if stype == 'fixed':
            fixed_dofs.update([3*idx, 3*idx+1, 3*idx+2])
        elif stype == 'pin':
            fixed_dofs.update([3*idx, 3*idx+1])
        elif stype == 'roller_y':
            fixed_dofs.add(3*idx+1)
        elif stype == 'roller_x':
            fixed_dofs.add(3*idx)

    free_dofs = [d for d in range(n_dof) if d not in fixed_dofs]
    K_ff = K[np.ix_(free_dofs, free_dofs)]
    F_f  = F[free_dofs]

    try:
        d_free = np.linalg.solve(K_ff, F_f)
    except np.linalg.LinAlgError:
        # Singular — might be mechanism
        d_free = np.linalg.lstsq(K_ff, F_f, rcond=None)[0]

    d = np.zeros(n_dof)
    for k, dof in enumerate(free_dofs):
        d[dof] = d_free[k]

    # ── Recover member end forces (in LOCAL coordinates) ──────────────────────
    results = {}
    for (mid, n_start, n_end) in members:
        T, k_loc, L, i, j = elem_data[mid]
        dofs = [3*i, 3*i+1, 3*i+2, 3*j, 3*j+1, 3*j+2]
        d_glob = d[dofs]
        d_loc = T @ d_glob
        # Element end forces in local frame (include fixed-end force contribution)
        f_loc = k_loc @ d_loc

        # Subtract fixed-end forces for distributed loads to get TRUE internal forces
        fef_loc = np.zeros(6)
        for (dm_id, q) in distributed_loads:
            if dm_id == mid:
                fef_loc += np.array([0, q*L/2, q*L**2/12, 0, q*L/2, -q*L**2/12])
        f_loc_int = f_loc - fef_loc

        # Internal forces at start node (node 1 of element):
        # In standard beam convention: the element end forces at node 1
        # represent what the element exerts on the node. Internal forces
        # at the section just to the right of node 1 (inside the element):
        #   N_start = f_loc_int[0]   (+ = tension, element pulls node 1 toward node 2)
        #   Q_start = -f_loc_int[1]  (sign flip: reaction is upward at support, shear is downward)
        #   M_start = -f_loc_int[2]  (reaction at node vs. internal convention)
        # At end node (node 2), section just to the left of node 2:
        #   N_end = -f_loc_int[3]
        #   Q_end = f_loc_int[4]
        #   M_end = f_loc_int[5]

        # Internal forces at section just inside each end node.
        # f_loc_int[0..2] = forces that the REST OF STRUCTURE applies to the
        # ELEMENT at the start node (via the joint). To get internal forces
        # looking FROM start TOWARD end (beam convention):
        #   N positive = tension (start-side pulls element toward end)
        #   Q positive = force in +local_y on the left face of the section
        #   M positive = CCW moment on left face
        N_s = -f_loc_int[0]
        Q_s = -f_loc_int[1]
        M_s =  f_loc_int[2]
        # At the END node, the rest-of-structure force f_loc_int[3..5] acts on
        # the element from the right side. Internal forces looking FROM end
        # TOWARD start (i.e. "right face" convention, same sign as N_s for
        # uniform compression/tension):
        N_e =  f_loc_int[3]
        Q_e =  f_loc_int[4]
        M_e = -f_loc_int[5]

        results[mid] = {
            'N_start': N_s, 'Q_start': Q_s, 'M_start': M_s,
            'N_end':   N_e, 'Q_end':   Q_e, 'M_end':   M_e,
        }

    return results, d


# ── Sign extraction ────────────────────────────────────────────────────────────

def sign_pattern(v_start, v_end, threshold_frac=0.05):
    """Convert numeric values to sign pattern string like '-1,0' or '1,1'."""
    mx = max(abs(v_start), abs(v_end), 1e-6)
    thr = threshold_frac * mx
    def sgn(v):
        if v >  thr: return  1
        if v < -thr: return -1
        return 0
    return f"{sgn(v_start)},{sgn(v_end)}"


# ── Parse JSON task into solver inputs ─────────────────────────────────────────

def parse_task(task, ea=1000.0, ei=1.0):
    """Return (nodes, members, supports, point_loads, dist_loads) for solve_frame."""
    nodes = {n['node_id']: (n['x'], n['y']) for n in task['nodes']}

    members = []
    for m in task['members']:
        members.append((m['member_id'], m['start_node'], m['end_node']))

    supports = {}
    for s in task['supports']:
        supports[s['node_id']] = s['support_type']

    point_loads = []
    dist_loads  = []

    for load in task['loads']:
        ltype = load.get('type')
        if ltype == 'point_force':
            fx_raw = load.get('fx', 0)
            fy_raw = load.get('fy', 0)
            fx = float(fx_raw) if not isinstance(fx_raw, str) else (
                -1.0 if fx_raw.startswith('-') else 1.0)
            fy = float(fy_raw) if not isinstance(fy_raw, str) else (
                -1.0 if fy_raw.startswith('-') else 1.0)
            point_loads.append((load['node_id'], fx, fy))
        elif ltype == 'distributed':
            mid = load['member_id']
            direction = load.get('direction', 'global_y')
            q_val = -1.0  # downward by default (negative local y for horizontal bars)
            if direction in ('global_y', 'perpendicular'):
                # In canvas (y-down), downward load = +local_y for most bars.
                # Use +1.0 (downward) as the canonical direction.
                q_val = 1.0
            dist_loads.append((mid, q_val))

    return nodes, members, supports, point_loads, dist_loads


# ── Main: process all tasks ────────────────────────────────────────────────────

def compute_all(tasks_path):
    with open(tasks_path) as f:
        tasks = json.load(f)

    skip_ids = {'hs2020_fragec1', 'hs2020_fraged1', 'hs2022_frageb3'}

    results_all = {}
    for task in tasks:
        tid = task['task_id']
        if tid in skip_ids:
            print(f"SKIP {tid}")
            continue

        nodes, members, supports, point_loads, dist_loads = parse_task(task)

        try:
            res, _ = solve_frame(nodes, members, supports, point_loads, dist_loads)
        except Exception as e:
            print(f"ERROR {tid}: {e}")
            results_all[tid] = None
            continue

        solutions = {'N': {}, 'Q': {}, 'M': {}}
        for (mid, n_start, n_end) in [(m['member_id'], m['start_node'], m['end_node'])
                                       for m in task['members']]:
            bar_id = f"{n_start}{n_end}"
            r = res[mid]
            solutions['N'][bar_id] = sign_pattern(r['N_start'], r['N_end'])
            solutions['Q'][bar_id] = sign_pattern(r['Q_start'], r['Q_end'])
            solutions['M'][bar_id] = sign_pattern(r['M_start'], r['M_end'])

        results_all[tid] = solutions
        print(f"OK  {tid}")
        for k in ['N', 'Q', 'M']:
            print(f"    {k}: {solutions[k]}")

    return results_all


if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else \
        '/Users/lucaskoll/Documents/New project/schnittkraft_trainer/data/tasks/tragwerke_from_exams.json'
    compute_all(path)
