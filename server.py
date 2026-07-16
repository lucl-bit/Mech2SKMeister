from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

from flask import Flask, jsonify, request, send_from_directory

sys.path.insert(0, str(Path(__file__).parent))

from schnittkraft_trainer.game.console_game import load_convention
from schnittkraft_trainer.game.diagram_challenges import (
    DiagramChallenge,
    FrameVisual,
    TrussVisual,
    generate_game_challenge,
)
from schnittkraft_trainer.game.truss_generator import generate_truss_fixture
from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)
from schnittkraft_trainer.model.structure import Beam

PACKAGE_ROOT = Path(__file__).parent / "schnittkraft_trainer"
WEB_ROOT = Path(__file__).parent / "web"
FIXTURES_PATH = PACKAGE_ROOT / "data" / "exam_fixtures.json"
SETTINGS_PASSWORD = "lucas1234"

app = Flask(
    __name__,
    static_folder=str(WEB_ROOT / "static"),
    static_url_path="/static",
)


@app.route("/")
def index():
    return send_from_directory(str(WEB_ROOT), "index.html")


@app.route("/api/conventions")
def get_conventions():
    folder = PACKAGE_ROOT / "data" / "sign_conventions"
    result = []
    for path in sorted(folder.glob("*.json")):
        conv = load_convention(path)
        result.append({"id": path.stem, "name": conv.name})
    return jsonify(result)


@app.route("/api/challenge", methods=["POST"])
def get_challenge():
    data = request.get_json()
    convention_id = data.get("convention_id", "default")
    challenge_number = int(data.get("challenge_number", 1))
    seed = data.get("seed")

    folder = PACKAGE_ROOT / "data" / "sign_conventions"
    conv_path = folder / f"{convention_id}.json"
    if not conv_path.exists():
        conv_path = folder / "default.json"

    convention = load_convention(conv_path)
    challenge = generate_game_challenge(convention, challenge_number, seed=seed)
    return jsonify(_challenge_to_dict(challenge))


@app.route("/api/generate-truss", methods=["POST"])
def generate_truss_route():
    data = request.get_json(silent=True) or {}
    seed = data.get("seed")
    try:
        fixture = generate_truss_fixture(int(seed) if seed is not None else None)
        return jsonify({"ok": True, "fixture": fixture})
    except (RuntimeError, ValueError) as exc:
        return jsonify({"ok": False, "error": str(exc)})


@app.route("/api/solve-truss", methods=["POST"])
def solve_truss_route():
    data = request.get_json()
    joints = [TrussJoint(j["joint_id"], float(j["x"]), float(j["y"])) for j in data["joints"]]
    bars = [TrussBar(b["bar_id"], b["start_id"], b["end_id"]) for b in data["bars"]]
    loads = [JointLoad(lv["joint_id"], float(lv["fx"]), float(lv["fy"])) for lv in data["loads"]]
    supports = [JointSupport(s["joint_id"], s["support_type"]) for s in data["supports"]]
    model = TrussModel(joints=joints, bars=bars, loads=loads, supports=supports)

    try:
        result = solve_truss(model)
        return jsonify({
            "ok": True,
            "bar_forces": {str(k): v for k, v in result.bar_forces.items()},
            "reactions": result.reactions,
        })
    except ValueError as exc:
        return jsonify({"ok": False, "error": str(exc)})


def _solve_frame_builder(joints, bars, supports_list, loads, welds_set, distributed_loads=None):
    """
    Solves a 2D frame (beam-column elements) with support for internal hinges
    via per-element rotation DOFs at non-welded nodes.

    joints: list of {joint_id, x, y}
    bars:   list of {bar_id, start_id, end_id}
    supports_list: list of {joint_id, support_type}; roller/roller_y constrains
    global y, roller_x constrains global x.
    loads:  list of {joint_id, fx, fy}
    welds_set: set of joint_ids that are rigidly welded (shared rotation)

    Returns (bar_forces_dict, reactions_dict)
      bar_forces_dict: {bar_id: {N_start, Q_start, M_start, N_end, Q_end, M_end}}
      reactions_dict:  {rx:<id>|ry:<id>|mz:<id>: value}
    """
    EA, EI = 1000.0, 1.0

    jmap   = {j["joint_id"]: j for j in joints}
    jids   = [j["joint_id"] for j in joints]
    jidx   = {jid: i for i, jid in enumerate(jids)}
    n_j    = len(jids)

    # Count bars per joint to detect internal hinges
    bars_at = defaultdict(list)
    for b in bars:
        bars_at[b["start_id"]].append(b["bar_id"])
        bars_at[b["end_id"]].append(b["bar_id"])

    # Translation DOFs: 2 per joint
    ux_dof = {jid: 2 * i     for i, jid in enumerate(jids)}
    uy_dof = {jid: 2 * i + 1 for i, jid in enumerate(jids)}
    next_dof = 2 * n_j

    # Rotation DOFs:
    #   welded joint or single-bar joint → one shared rotation DOF per joint
    #   hinge joint (not welded, 2+ bars) → one independent rotation DOF per (bar, end)
    jrot_dof      = {}   # joint_id → dof  (welded/single-bar joints)
    brot_start    = {}   # bar_id   → dof  (hinge at start end)
    brot_end      = {}   # bar_id   → dof  (hinge at end   end)

    for jid in jids:
        if jid in welds_set or len(bars_at[jid]) <= 1:
            jrot_dof[jid] = next_dof
            next_dof += 1

    for b in bars:
        bid = b["bar_id"]
        if b["start_id"] not in jrot_dof:
            brot_start[bid] = next_dof; next_dof += 1
        if b["end_id"]   not in jrot_dof:
            brot_end[bid]   = next_dof; next_dof += 1

    n_dof = next_dof
    K = np.zeros((n_dof, n_dof))
    F = np.zeros(n_dof)

    elem_data = {}
    for b in bars:
        bid = b["bar_id"]
        j1  = jmap[b["start_id"]]
        j2  = jmap[b["end_id"]]
        x1, y1, x2, y2 = float(j1["x"]), float(j1["y"]), float(j2["x"]), float(j2["y"])
        dx, dy = x2 - x1, y2 - y1
        L = (dx**2 + dy**2) ** 0.5
        if L < 1e-9:
            raise ValueError(f"bar {bid} has zero length")
        cx, cy = dx / L, dy / L

        T = np.array([
            [ cx,  cy, 0,   0,   0,  0],
            [-cy,  cx, 0,   0,   0,  0],
            [  0,   0, 1,   0,   0,  0],
            [  0,   0, 0,  cx,  cy,  0],
            [  0,   0, 0, -cy,  cx,  0],
            [  0,   0, 0,   0,   0,  1],
        ])
        k_loc = np.array([
            [ EA/L,           0,           0, -EA/L,           0,           0],
            [    0,  12*EI/L**3,  6*EI/L**2,     0, -12*EI/L**3,  6*EI/L**2],
            [    0,   6*EI/L**2,    4*EI/L,      0,  -6*EI/L**2,    2*EI/L ],
            [-EA/L,           0,           0,  EA/L,           0,           0],
            [    0, -12*EI/L**3, -6*EI/L**2,     0,  12*EI/L**3, -6*EI/L**2],
            [    0,   6*EI/L**2,    2*EI/L,      0,  -6*EI/L**2,    4*EI/L ],
        ])
        k_glob = T.T @ k_loc @ T

        sid, eid = b["start_id"], b["end_id"]
        th1 = jrot_dof.get(sid, brot_start.get(bid))
        th2 = jrot_dof.get(eid, brot_end.get(bid))
        dofs = [ux_dof[sid], uy_dof[sid], th1, ux_dof[eid], uy_dof[eid], th2]

        for a, da in enumerate(dofs):
            for bb, db in enumerate(dofs):
                K[da, db] += k_glob[a, bb]

        elem_data[bid] = (T, k_loc, L, dofs)

    # Fixed-end forces for distributed loads (UDL, q positive = +local_y)
    if distributed_loads:
        for dl in distributed_loads:
            bid = dl["bar_id"]
            q = float(dl["q"])
            T, k_loc, L, dofs = elem_data[bid]
            fef_loc = np.array([0, q*L/2, q*L**2/12, 0, q*L/2, -q*L**2/12])
            fef_glob = T.T @ fef_loc
            for a, da in enumerate(dofs):
                F[da] += fef_glob[a]

    # Point loads
    for ld in loads:
        jid = ld["joint_id"]
        F[ux_dof[jid]] += float(ld["fx"])
        F[uy_dof[jid]] += float(ld["fy"])
        mz = float(ld.get("mz", 0.0))
        if abs(mz) > 0:
            rotation_dof = jrot_dof.get(jid)
            if rotation_dof is None:
                raise ValueError(f"Knotenmoment an Gelenk {jid} ist nicht eindeutig zuordenbar")
            F[rotation_dof] += mz

    # Boundary conditions
    sup_map     = {s["joint_id"]: s["support_type"] for s in supports_list}
    fixed_dofs  = set()
    for jid, stype in sup_map.items():
        if stype in ("pin", "fixed", "roller_x"):
            fixed_dofs.add(ux_dof[jid])
        if stype in ("pin", "fixed", "roller", "roller_y"):
            fixed_dofs.add(uy_dof[jid])
        if stype == "fixed" and jid in jrot_dof:
            fixed_dofs.add(jrot_dof[jid])

    free_dofs = [d for d in range(n_dof) if d not in fixed_dofs]
    K_ff = K[np.ix_(free_dofs, free_dofs)]
    F_f  = F[free_dofs]

    try:
        d_free = np.linalg.solve(K_ff, F_f)
    except np.linalg.LinAlgError:
        d_free = np.linalg.lstsq(K_ff, F_f, rcond=None)[0]

    d = np.zeros(n_dof)
    for k_i, dof in enumerate(free_dofs):
        d[dof] = d_free[k_i]

    # Recover internal forces (local frame)
    bar_forces = {}
    for b in bars:
        bid = b["bar_id"]
        T, k_loc, L, dofs = elem_data[bid]
        d_loc = T @ d[dofs]
        f_loc = k_loc @ d_loc

        fef_loc = np.zeros(6)
        if distributed_loads:
            for dl in distributed_loads:
                if dl["bar_id"] == bid:
                    q = float(dl["q"])
                    fef_loc += np.array([0, q*L/2, q*L**2/12, 0, q*L/2, -q*L**2/12])
        f_int = f_loc - fef_loc

        N_s = -f_int[0]; Q_s = -f_int[1]; M_s =  f_int[2]
        N_e =  f_int[3]; Q_e =  f_int[4]; M_e = -f_int[5]

        bar_forces[bid] = {
            "N_start": round(float(N_s), 4), "Q_start": round(float(Q_s), 4), "M_start": round(float(M_s), 4),
            "N_end":   round(float(N_e), 4), "Q_end":   round(float(Q_e), 4), "M_end":   round(float(M_e), 4),
        }

    # Reactions at constrained DOFs: R = (K @ d)[fixed_dof]  (F is zero at support nodes)
    Kd = K @ d
    reactions = {}
    for jid, stype in sup_map.items():
        if ux_dof[jid] in fixed_dofs:
            reactions[f"rx:{jid}"] = round(float(Kd[ux_dof[jid]] - F[ux_dof[jid]]), 4)
        if uy_dof[jid] in fixed_dofs:
            reactions[f"ry:{jid}"] = round(float(Kd[uy_dof[jid]] - F[uy_dof[jid]]), 4)
        if stype == "fixed" and jid in jrot_dof and jrot_dof[jid] in fixed_dofs:
            th = jrot_dof[jid]
            reactions[f"mz:{jid}"] = round(float(Kd[th] - F[th]), 4)

    return bar_forces, reactions


@app.route("/api/solve-frame", methods=["POST"])
def solve_frame_route():
    data     = request.get_json()
    joints   = data["joints"]
    bars     = data["bars"]
    supports = data["supports"]
    loads    = data.get("loads", [])
    welds    = set(data.get("welds", []))
    distributed_loads = data.get("distributed_loads", [])

    try:
        bar_forces, reactions = _solve_frame_builder(joints, bars, supports, loads, welds, distributed_loads)
        return jsonify({"ok": True, "bar_forces": {str(k): v for k, v in bar_forces.items()}, "reactions": reactions})
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)})


def _load_fixtures():
    try:
        with FIXTURES_PATH.open("r", encoding="utf-8") as fh:
            data = json.load(fh)
        return data if isinstance(data, list) else None
    except (OSError, json.JSONDecodeError):
        return None


def _save_fixtures(fixtures):
    FIXTURES_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = FIXTURES_PATH.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(fixtures, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    os.replace(tmp, FIXTURES_PATH)


def _check_password(req) -> bool:
    return req.headers.get("X-Settings-Password", "") == SETTINGS_PASSWORD


@app.route("/api/fixtures", methods=["GET"])
def list_fixtures():
    fixtures = _load_fixtures()
    if fixtures is None:
        return jsonify({"ok": False, "error": "no store"})
    return jsonify({"ok": True, "fixtures": fixtures})


@app.route("/api/fixtures/auth", methods=["POST"])
def fixtures_auth():
    data = request.get_json(silent=True) or {}
    return jsonify({"ok": data.get("password", "") == SETTINGS_PASSWORD})


@app.route("/api/fixtures", methods=["POST"])
def upsert_fixture():
    if not _check_password(request):
        return jsonify({"ok": False, "error": "wrong password"}), 403
    data = request.get_json(silent=True) or {}
    fixture = data.get("fixture")
    if (
        not isinstance(fixture, dict)
        or not isinstance(fixture.get("id"), str)
        or not fixture["id"]
        or not isinstance(fixture.get("nodes"), dict)
        or not isinstance(fixture.get("bars"), list)
        or not isinstance(fixture.get("supports"), dict)
        or not isinstance(fixture.get("loads"), list)
    ):
        return jsonify({"ok": False, "error": "invalid fixture"}), 400
    fixtures = _load_fixtures() or []
    for i, existing in enumerate(fixtures):
        if existing.get("id") == fixture["id"]:
            fixtures[i] = fixture
            break
    else:
        fixtures.append(fixture)
    _save_fixtures(fixtures)
    return jsonify({"ok": True, "count": len(fixtures)})


@app.route("/api/fixtures/<fid>", methods=["DELETE"])
def delete_fixture(fid):
    if not _check_password(request):
        return jsonify({"ok": False, "error": "wrong password"}), 403
    fixtures = _load_fixtures() or []
    remaining = [f for f in fixtures if f.get("id") != fid]
    if len(remaining) == len(fixtures):
        return jsonify({"ok": False, "error": "not found"}), 404
    _save_fixtures(remaining)
    return jsonify({"ok": True, "count": len(remaining)})


@app.route("/api/save-progress", methods=["POST"])
def save_progress():
    data = request.get_json()
    path = PACKAGE_ROOT / "data" / "progress" / "gui_progress.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2)
        fh.write("\n")
    return jsonify({"ok": True})


def _challenge_to_dict(c: DiagramChallenge) -> dict:
    return {
        "title": c.title,
        "level": c.level,
        "challenge_type": c.challenge_type,
        "diagram_kind": c.diagram_kind.value,
        "system_type": c.system_type,
        "options": [
            {"option_id": o.option_id, "label": o.label, "shape": o.shape, "is_correct": o.is_correct}
            for o in c.options
        ],
        "correct_option_id": c.correct_option_id,
        "explanation": c.explanation,
        "beam": _beam_to_dict(c.beam) if c.beam else None,
        "truss": _truss_to_dict(c.truss) if c.truss else None,
        "frame": _frame_to_dict(c.frame) if c.frame else None,
    }


def _beam_to_dict(b: Beam) -> dict:
    return {
        "length": b.length,
        "title": b.title,
        "supports": [{"x": s.x, "support_type": s.support_type.value, "label": s.label} for s in b.supports],
        "point_loads": [{"x": lv.x, "force_y": lv.force_y, "force_x": getattr(lv, "force_x", 0.0), "label": lv.label} for lv in b.point_loads],
        "distributed_loads": [
            {"x_start": q.x_start, "x_end": q.x_end, "q": q.q, "label": q.label}
            for q in b.distributed_loads
        ],
    }


def _truss_to_dict(t: TrussVisual) -> dict:
    return {
        "joints": [{"joint_id": j.joint_id, "x": j.x, "y": j.y} for j in t.joints],
        "bars": [{"bar_id": b.bar_id, "start_id": b.start_id, "end_id": b.end_id} for b in t.bars],
        "loads": [{"joint_id": lv.joint_id, "fx": lv.fx, "fy": lv.fy} for lv in t.loads],
        "supports": [{"joint_id": s.joint_id, "support_type": s.support_type} for s in t.supports],
    }


def _frame_to_dict(f: FrameVisual) -> dict:
    return {
        "joints": [{"joint_id": j.joint_id, "x": j.x, "y": j.y} for j in f.joints],
        "bars": [{"bar_id": b.bar_id, "start_id": b.start_id, "end_id": b.end_id} for b in f.bars],
        "loads": [{"joint_id": lv.joint_id, "fx": lv.fx, "fy": lv.fy} for lv in f.loads],
        "supports": [{"joint_id": s.joint_id, "support_type": s.support_type} for s in f.supports],
        "distributed_bars": list(f.distributed_bars),
    }


if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5001))
    print(f"Schnittkraft Trainer läuft auf http://localhost:{port}")
    app.run(debug=True, host="0.0.0.0", port=port)
