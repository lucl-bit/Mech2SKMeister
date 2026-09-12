"""Baut die statischen Daten fuer den GitHub-Pages-Betrieb.

Erzeugt:
  web/data/challenges.json   vorgenerierte Aufgaben (ersetzt /api/challenge)
  web/data/fixtures.json     Kopie des Fixture-Stores (ersetzt GET /api/fixtures)
  web/data/trusses.json      vorgenerierte Fachwerke (ersetzt /api/generate-truss)
  tests_static/golden.json   Referenzwerte der Python-Loeser fuer die JS-Portierung

Aufruf:  python3 tools/build_static.py [--seeds N]

Der Aufgabengenerator bleibt damit in Python: er laeuft hier einmal beim Bauen,
nicht mehr zur Laufzeit auf einem Server.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from schnittkraft_trainer.game.console_game import load_convention
from schnittkraft_trainer.game.truss_generator import generate_truss_fixture
from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)
from server import _challenge_to_dict, _solve_frame_builder, generate_game_challenge

DATA_DIR = ROOT / "schnittkraft_trainer" / "data"
WEB_DATA = ROOT / "web" / "data"
TESTS = ROOT / "tests_static"

CHALLENGE_NUMBERS = range(1, 21)  # 1-10 Balken, 11-20 Fachwerk (siehe diagram_game.js)


def build_challenges(seeds: int) -> None:
    convention = load_convention(DATA_DIR / "sign_conventions" / "uni.json")
    out: dict[str, list] = {}
    for number in CHALLENGE_NUMBERS:
        variants = []
        for index in range(seeds):
            seed = number * 100_000 + index
            challenge = generate_game_challenge(convention, number, seed=seed)
            variants.append(_challenge_to_dict(challenge))
        out[str(number)] = variants
    _write(WEB_DATA / "challenges.json", out)
    print(f"challenges.json: {len(out)} Nummern x {seeds} Varianten")


def build_trusses(seeds: int) -> None:
    fixtures = []
    for index in range(seeds):
        try:
            fixtures.append(generate_truss_fixture(index))
        except (RuntimeError, ValueError):
            continue  # Generator findet nicht fuer jeden Seed ein gueltiges System
    _write(WEB_DATA / "trusses.json", fixtures)
    print(f"trusses.json: {len(fixtures)} von {seeds} Seeds gueltig")


def copy_fixtures() -> None:
    source = DATA_DIR / "exam_fixtures.json"
    fixtures = json.loads(source.read_text(encoding="utf-8"))
    _write(WEB_DATA / "fixtures.json", fixtures)
    print(f"fixtures.json: {len(fixtures)} Pruefungsaufgaben")


def fixture_to_payload(fix: dict) -> tuple[str, dict]:
    """Baut denselben Loeser-Aufruf, den frame_challenge.js schickt.

    Rueckgabe: ("truss"|"frame", payload). IDs bleiben Strings wie im Frontend.
    """
    is_frame = bool(fix.get("welds")) or "fixed" in (fix.get("supports") or {}).values()
    dist_loads = [ld for ld in fix.get("loads", []) if ld.get("kind") == "distributed"]

    joints = [
        {"joint_id": jid, "x": float(node["x"]), "y": float(node["y"])}
        for jid, node in fix["nodes"].items()
    ]
    bars = [{"bar_id": b["id"], "start_id": b["from"], "end_id": b["to"]} for b in fix["bars"]]
    supports = [
        {"joint_id": jid, "support_type": stype}
        for jid, stype in (fix.get("supports") or {}).items()
    ]

    loads: list[dict] = []
    distributed: list[dict] = []
    for ld in fix.get("loads", []):
        kind = ld.get("kind")
        if kind == "point":
            loads.append({"joint_id": ld["node"], "fx": float(ld.get("fx") or 0), "fy": float(ld.get("fy") or 0)})
        elif kind == "moment":
            loads.append({"joint_id": ld["node"], "fx": 0.0, "fy": 0.0, "mz": float(ld.get("mz") or 0)})
        elif kind == "z":
            sign = 1 if ld.get("direction") == "into" else -1
            loads.append({"joint_id": ld["node"], "fx": 0.0, "fy": sign * float(ld.get("fz") or 1)})
        elif kind == "distributed":
            distributed.append({"bar_id": ld["bar"], "q": float(ld.get("q") or 1)})

    if not is_frame and not dist_loads:
        return "truss", {"joints": joints, "bars": bars, "loads": loads, "supports": supports}
    return "frame", {
        "joints": joints,
        "bars": bars,
        "supports": supports,
        "loads": loads,
        "welds": list(fix.get("welds") or []),
        "distributed_loads": distributed,
    }


def solve_with_python(kind: str, payload: dict) -> dict | None:
    """Rechnet einen Fall mit den Python-Loesern. None = Fall ist nicht loesbar."""
    try:
        if kind == "truss":
            model = TrussModel(
                joints=[TrussJoint(j["joint_id"], j["x"], j["y"]) for j in payload["joints"]],
                bars=[TrussBar(b["bar_id"], b["start_id"], b["end_id"]) for b in payload["bars"]],
                loads=[JointLoad(lv["joint_id"], lv["fx"], lv["fy"]) for lv in payload["loads"]],
                supports=[JointSupport(s["joint_id"], s["support_type"]) for s in payload["supports"]],
            )
            result = solve_truss(model)
            return {"bar_forces": {str(k): v for k, v in result.bar_forces.items()},
                    "reactions": result.reactions}
        bar_forces, reactions = _solve_frame_builder(
            payload["joints"], payload["bars"], payload["supports"],
            payload["loads"], set(payload["welds"]), payload["distributed_loads"],
        )
        return {"bar_forces": {str(k): v for k, v in bar_forces.items()}, "reactions": reactions}
    except Exception:  # noqa: BLE001 - unloesbare Faelle gehoeren nicht in die Golden-Datei
        return None


def build_golden(seeds: int) -> None:
    cases = []
    skipped = 0

    exam = json.loads((DATA_DIR / "exam_fixtures.json").read_text(encoding="utf-8"))
    for fix in exam:
        kind, payload = fixture_to_payload(fix)
        expected = solve_with_python(kind, payload)
        if expected is None:
            skipped += 1
            continue
        cases.append({"name": f"exam:{fix['id']}", "kind": kind, "payload": payload, "expected": expected})

    for index in range(seeds):
        try:
            fix = generate_truss_fixture(index)
        except (RuntimeError, ValueError):
            continue
        kind, payload = fixture_to_payload(fix)
        expected = solve_with_python(kind, payload)
        if expected is None:
            skipped += 1
            continue
        cases.append({"name": f"gen:{index}", "kind": kind, "payload": payload, "expected": expected})

    cases.extend(_numeric_id_cases())

    _write(TESTS / "golden.json", {"cases": cases})
    kinds = {k: sum(1 for c in cases if c["kind"] == k) for k in ("truss", "frame")}
    print(f"golden.json: {len(cases)} Faelle ({kinds['truss']} truss, {kinds['frame']} frame), {skipped} uebersprungen")


def _numeric_id_cases() -> list[dict]:
    """Faelle mit numerischen IDs - so schickt truss_builder.js seine Aufrufe.

    Python sortiert Zahlen numerisch, Strings lexikografisch; beide Wege muessen
    in JS dasselbe ergeben.
    """
    cases = []
    # Symmetrisches Dreieck, Last am Spitzenknoten
    triangle = {
        "joints": [{"joint_id": 1, "x": 0.0, "y": 0.0}, {"joint_id": 2, "x": 4.0, "y": 0.0},
                   {"joint_id": 3, "x": 2.0, "y": 2.0}],
        "bars": [{"bar_id": 1, "start_id": 1, "end_id": 2}, {"bar_id": 2, "start_id": 1, "end_id": 3},
                 {"bar_id": 3, "start_id": 2, "end_id": 3}],
        "loads": [{"joint_id": 3, "fx": 0.0, "fy": -10.0}],
        "supports": [{"joint_id": 1, "support_type": "pin"}, {"joint_id": 2, "support_type": "roller"}],
    }
    # Zweifeldriges Fachwerk, 10+ Knoten-IDs pruefen die Sortierung (2 vs 10)
    wide = {
        "joints": [{"joint_id": i, "x": float(i - 1), "y": 0.0} for i in range(1, 7)]
                  + [{"joint_id": i, "x": float(i - 7) + 0.5, "y": -1.0} for i in range(7, 12)],
        "bars": [{"bar_id": i, "start_id": i, "end_id": i + 1} for i in range(1, 6)]
                + [{"bar_id": 10 + i, "start_id": 6 + i, "end_id": 7 + i} for i in range(1, 5)]
                + [{"bar_id": 20 + i, "start_id": i, "end_id": 6 + i} for i in range(1, 6)]
                + [{"bar_id": 30 + i, "start_id": i + 1, "end_id": 6 + i} for i in range(1, 6)],
        "loads": [{"joint_id": 9, "fx": 0.0, "fy": 8.0}],
        "supports": [{"joint_id": 1, "support_type": "pin"}, {"joint_id": 6, "support_type": "roller"}],
    }
    for name, payload in (("numeric:triangle", triangle), ("numeric:wide", wide)):
        expected = solve_with_python("truss", payload)
        if expected is not None:
            cases.append({"name": name, "kind": "truss", "payload": payload, "expected": expected})

    # Kragarm mit Streckenlast und eingespanntem Ende -> Frame-Loeser
    cantilever = {
        "joints": [{"joint_id": 1, "x": 0.0, "y": 0.0}, {"joint_id": 2, "x": 3.0, "y": 0.0}],
        "bars": [{"bar_id": 1, "start_id": 1, "end_id": 2}],
        "supports": [{"joint_id": 1, "support_type": "fixed"}],
        "loads": [],
        "welds": [1, 2],
        "distributed_loads": [{"bar_id": 1, "q": 2.0}],
    }
    expected = solve_with_python("frame", cantilever)
    if expected is not None:
        cases.append({"name": "numeric:cantilever-udl", "kind": "frame", "payload": cantilever, "expected": expected})
    return cases


def _write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seeds", type=int, default=40, help="Varianten pro Aufgabennummer (Default 40)")
    args = parser.parse_args()

    copy_fixtures()
    build_challenges(args.seeds)
    build_trusses(60)
    build_golden(60)
    print("fertig")


if __name__ == "__main__":
    main()
