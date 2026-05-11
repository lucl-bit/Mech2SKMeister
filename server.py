from __future__ import annotations

import json
import sys
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory

sys.path.insert(0, str(Path(__file__).parent))

from schnittkraft_trainer.game.console_game import load_convention
from schnittkraft_trainer.game.diagram_challenges import (
    DiagramChallenge,
    FrameVisual,
    TrussVisual,
    generate_game_challenge,
)
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
