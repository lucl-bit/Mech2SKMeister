"""Generator für zufällige, statisch bestimmte Fachwerke.

Erzeugt Fixtures im Format von web/static/frame_fixtures.js (Koordinaten in
Grid-Einheiten, y positiv nach unten, fy > 0 = Last nach unten). Die Lösung
wird vom Frontend live über /api/solve-truss berechnet — der Generator muss
nur eine gültige, lösbare Geometrie liefern.

Jedes generierte Fachwerk durchläuft eine Validierung:
  - statisch bestimmt (m + r = 2j, vom Solver erzwungen)
  - Gleichungssystem nicht singulär
  - Stabkräfte in sinnvollem Bereich (kein numerischer Ausreißer)
  - mindestens zwei nennenswert beanspruchte Stäbe

Seed-basiert und damit reproduzierbar.
"""

from __future__ import annotations

import random
import string

from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)

_FAMILIES = ("warren", "pratt", "howe")


def _node_name(index: int) -> str:
    letters = string.ascii_uppercase
    if index < len(letters):
        return letters[index]
    return letters[index // len(letters) - 1] + letters[index % len(letters)]


def _warren(rng: random.Random) -> tuple[dict, dict, list]:
    """Warren-Träger: Untergurt + versetzter Obergurt, Zickzack-Diagonalen."""
    panels = rng.choice([2, 3, 4])
    height = rng.choice([1.0, 1.5, 2.0])
    width = rng.choice([1.5, 2.0])
    bottom = [(i * width, 0.0) for i in range(panels + 1)]
    top = [(i * width + width / 2, -height) for i in range(panels)]
    nodes = bottom + top
    n_b = len(bottom)
    bars: list[tuple[int, int]] = []
    bars += [(i, i + 1) for i in range(n_b - 1)]                     # Untergurt
    bars += [(n_b + i, n_b + i + 1) for i in range(len(top) - 1)]    # Obergurt
    for i in range(panels):                                          # Diagonalen
        bars += [(i, n_b + i), (n_b + i, i + 1)]
    load_candidates = list(range(n_b, n_b + len(top)))               # Obergurtknoten
    return (
        {"nodes": nodes, "bars": bars, "bottom": list(range(n_b))},
        {"family": "Warren", "panels": panels},
        load_candidates,
    )


def _parallel_chord(rng: random.Random, diagonals_up: bool) -> tuple[dict, dict, list]:
    """Parallelgurt-Träger (Pratt/Howe): Gurten + Pfosten + gerichtete Diagonalen."""
    panels = rng.choice([2, 3])
    height = rng.choice([1.0, 1.5])
    width = rng.choice([1.5, 2.0])
    bottom = [(i * width, 0.0) for i in range(panels + 1)]
    top = [(i * width, -height) for i in range(panels + 1)]
    nodes = bottom + top
    n_b = len(bottom)
    bars: list[tuple[int, int]] = []
    bars += [(i, i + 1) for i in range(n_b - 1)]                       # Untergurt
    bars += [(n_b + i, n_b + i + 1) for i in range(n_b - 1)]           # Obergurt
    bars += [(i, n_b + i) for i in range(n_b)]                         # Pfosten
    for i in range(panels):                                            # Diagonalen
        if diagonals_up:
            bars.append((i, n_b + i + 1))      # Howe-artig steigend
        else:
            bars.append((n_b + i, i + 1))      # Pratt-artig fallend
    load_candidates = list(range(n_b, 2 * n_b))                        # Obergurt
    name = "Howe" if diagonals_up else "Pratt"
    return (
        {"nodes": nodes, "bars": bars, "bottom": list(range(n_b))},
        {"family": name, "panels": panels},
        load_candidates,
    )


def _build_fixture(rng: random.Random, seed: int) -> dict:
    family = rng.choice(_FAMILIES)
    if family == "warren":
        geo, meta, load_candidates = _warren(rng)
    elif family == "pratt":
        geo, meta, load_candidates = _parallel_chord(rng, diagonals_up=False)
    else:
        geo, meta, load_candidates = _parallel_chord(rng, diagonals_up=True)

    nodes = geo["nodes"]
    bottom = geo["bottom"]

    # Lager: Festlager links unten, Loslager rechts unten (gelegentlich getauscht)
    left, right = bottom[0], bottom[-1]
    if rng.random() < 0.3:
        left, right = right, left
    supports = {left: "pin", right: "roller"}

    # Lasten: 1–2 Knoten, nicht auf Lagern; meist vertikal nach unten,
    # gelegentlich mit horizontaler Komponente.
    candidates = [i for i in load_candidates if i not in supports]
    if not candidates:
        candidates = [i for i in range(len(nodes)) if i not in supports]
    count = 1 if len(candidates) < 2 or rng.random() < 0.6 else 2
    load_nodes = rng.sample(candidates, count)
    loads = []
    for idx, node in enumerate(load_nodes):
        fx = rng.choice([-1.0, 0.0, 0.0, 0.0, 1.0])
        fy = rng.choice([1.0, 1.0, 2.0])
        loads.append({"node": node, "fx": fx, "fy": fy,
                      "label": "F" if count == 1 else f"F{idx + 1}"})

    # In Fixture-Koordinaten verschieben (Rand 1 Einheit, y nach unten positiv)
    min_x = min(x for x, _ in nodes)
    min_y = min(y for _, y in nodes)
    shifted = [(x - min_x + 1.0, y - min_y + 1.0) for x, y in nodes]
    max_x = max(x for x, _ in shifted)
    max_y = max(y for _, y in shifted)

    node_names = {i: _node_name(i) for i in range(len(shifted))}
    fixture = {
        "id": f"gen-{seed}",
        "title": f"{meta['family']}-Fachwerk",
        "description": f"Zufällig generiert (Seed {seed}) — {meta['panels']} Felder.",
        "source": "Generator",
        "generated": True,
        "bbox": {"w": max_x + 1.0, "h": max_y + 1.0},
        "nodes": {node_names[i]: {"x": round(x, 3), "y": round(y, 3)}
                  for i, (x, y) in enumerate(shifted)},
        "bars": [{"id": f"{node_names[a]}{node_names[b]}",
                  "from": node_names[a], "to": node_names[b]}
                 for a, b in geo["bars"]],
        "supports": {node_names[i]: t for i, t in supports.items()},
        "loads": [{"kind": "point", "node": node_names[ld["node"]],
                   "fx": ld["fx"], "fy": ld["fy"], "label": ld["label"]}
                  for ld in loads],
        "welds": [],
    }
    return fixture


def _validate(fixture: dict) -> bool:
    name_to_id = {name: i + 1 for i, name in enumerate(fixture["nodes"])}
    joints = [TrussJoint(name_to_id[n], v["x"], v["y"])
              for n, v in fixture["nodes"].items()]
    bars = [TrussBar(i + 1, name_to_id[b["from"]], name_to_id[b["to"]])
            for i, b in enumerate(fixture["bars"])]
    loads = [JointLoad(name_to_id[ld["node"]], ld["fx"], ld["fy"])
             for ld in fixture["loads"]]
    supports = [JointSupport(name_to_id[n], t)
                for n, t in fixture["supports"].items()]
    model = TrussModel(joints=joints, bars=bars, loads=loads, supports=supports)
    try:
        result = solve_truss(model)
    except ValueError:
        return False
    forces = list(result.bar_forces.values())
    max_force = max(abs(f) for f in forces)
    total_load = sum(abs(ld["fx"]) + abs(ld["fy"]) for ld in fixture["loads"])
    if max_force > 60 * max(total_load, 1e-9):   # numerisch grenzwertige Geometrie
        return False
    significant = sum(1 for f in forces if abs(f) > 0.05 * max(max_force, 1e-9))
    return significant >= 2


def generate_truss_fixture(seed: int | None = None) -> dict:
    """Erzeugt ein validiertes Fachwerk-Fixture. Wirft nach 50 Fehlversuchen."""
    base = random.Random().randrange(1_000_000_000) if seed is None else seed
    for attempt in range(50):
        current = base + attempt * 1_000_003
        fixture = _build_fixture(random.Random(current), current)
        if _validate(fixture):
            return fixture
    raise RuntimeError("Kein gültiges Fachwerk generierbar (50 Versuche).")
