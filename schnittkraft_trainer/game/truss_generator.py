"""Generator für zufällige, statisch bestimmte Fachwerke.

Erzeugt Fixtures im Format von web/static/frame_fixtures.js (Koordinaten in
Grid-Einheiten, y positiv nach unten, fy > 0 = Last nach unten, Kräfte in kN).
Die Lösung wird vom Frontend live über /api/solve-truss berechnet — der
Generator muss nur eine gültige, lösbare, "interessante" Geometrie liefern.

Die Geometrie entsteht aus einer kleinen Tragwerks-Grammatik: Kompaktfachwerk,
Warren- und Pratt/Howe-Brücke, Dachfächer oder wandverankerter Ausleger. Die
Anzahl der Felder, Proportionen, Diagonalen, Lagerseiten und Lastknoten variieren.
Jedes Fachwerk durchläuft eine Validierung:
  - statisch bestimmt (m + r = 2j, vom Solver erzwungen)
  - Gleichungssystem nicht singulär, keine Ausreißerkräfte
  - didaktisch interessant: Nullstab vorhanden ODER Zug/Druck gemischt

Seed-basiert und damit reproduzierbar.
"""

from __future__ import annotations

import random
import string
import math

from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)

LOAD_MAGNITUDES = (5.0, 10.0, 15.0, 20.0)


def _node_name(index: int) -> str:
    letters = string.ascii_uppercase
    if index < len(letters):
        return letters[index]
    return letters[index // len(letters) - 1] + letters[index % len(letters)]


def _compact_geometry(rng: random.Random) -> tuple[dict, dict]:
    """Kleines asymmetrisches Drei- oder Vierknoten-System."""
    span = rng.uniform(3.8, 6.0)
    height = span * rng.uniform(0.30, 0.58)
    if rng.random() < 0.45:
        apex_x = span * rng.uniform(0.25, 0.75)
        nodes = [(0.0, 0.0), (span, 0.0), (apex_x, -height)]
        bars = [(0, 1), (0, 2), (2, 1)]
        loads = [2]
    else:
        middle_x = span * rng.uniform(0.28, 0.72)
        apex_x = min(span * 0.80, max(span * 0.20,
                                     middle_x + span * rng.uniform(-0.16, 0.16)))
        nodes = [(0.0, 0.0), (middle_x, 0.0), (span, 0.0), (apex_x, -height)]
        bars = [(0, 1), (1, 2), (0, 3), (3, 2), (1, 3)]
        loads = [3]
    return (
        {"nodes": nodes, "bars": bars, "supports": [0, 1 if len(nodes) == 3 else 2],
         "load_candidates": loads},
        {"family": "Kompaktfachwerk", "fields": 1},
    )


def _warren_geometry(rng: random.Random) -> tuple[dict, dict]:
    """Warren-Brücke mit zwei bis vier Feldern und leicht unregelmäßigem Obergurt."""
    panels = rng.randint(2, 4)
    width = rng.uniform(1.25, 1.85)
    height = width * rng.uniform(0.72, 1.18)
    bottom = [(i * width, 0.0) for i in range(panels + 1)]
    top = [((i + 0.5) * width + rng.uniform(-0.10, 0.10) * width,
            -height * rng.uniform(0.90, 1.10)) for i in range(panels)]
    nodes = bottom + top
    n_bottom = len(bottom)
    bars = [(i, i + 1) for i in range(panels)]
    bars += [(n_bottom + i, n_bottom + i + 1) for i in range(panels - 1)]
    for i in range(panels):
        bars += [(i, n_bottom + i), (n_bottom + i, i + 1)]
    return (
        {"nodes": nodes, "bars": bars, "supports": [0, panels],
         "load_candidates": list(range(n_bottom, n_bottom + panels))},
        {"family": "Warren-Brücke", "fields": panels},
    )


def _parallel_geometry(rng: random.Random) -> tuple[dict, dict]:
    """Pratt-/Howe-artiger Parallelgurt mit zufälliger Diagonalrichtung."""
    panels = rng.randint(2, 4)
    width = rng.uniform(1.2, 1.75)
    height = width * rng.uniform(0.75, 1.15)
    bottom = [(i * width, 0.0) for i in range(panels + 1)]
    top = [(i * width, -height * rng.uniform(0.94, 1.06)) for i in range(panels + 1)]
    nodes = bottom + top
    n_bottom = len(bottom)
    bars = [(i, i + 1) for i in range(panels)]
    bars += [(n_bottom + i, n_bottom + i + 1) for i in range(panels)]
    bars += [(i, n_bottom + i) for i in range(panels + 1)]
    howe = rng.random() < 0.5
    for i in range(panels):
        bars.append((i, n_bottom + i + 1) if howe else (n_bottom + i, i + 1))
    return (
        {"nodes": nodes, "bars": bars, "supports": [0, panels],
         "load_candidates": list(range(n_bottom + 1, n_bottom + panels)) or [n_bottom]},
        {"family": "Howe-Brücke" if howe else "Pratt-Brücke", "fields": panels},
    )


def _roof_geometry(rng: random.Random) -> tuple[dict, dict]:
    """Dachfächer: ein variabler First verbindet drei bis sechs Untergurtknoten."""
    panels = rng.randint(2, 5)
    width = rng.uniform(1.1, 1.65)
    span = panels * width
    bottom = [(i * width, 0.0) for i in range(panels + 1)]
    apex = (span * rng.uniform(0.36, 0.64), -span * rng.uniform(0.25, 0.43))
    nodes = bottom + [apex]
    apex_id = len(bottom)
    bars = [(i, i + 1) for i in range(panels)]
    bars += [(i, apex_id) for i in range(panels + 1)]
    return (
        {"nodes": nodes, "bars": bars, "supports": [0, panels],
         "load_candidates": [apex_id]},
        {"family": "Dachfächer", "fields": panels},
    )


def _cantilever_geometry(rng: random.Random) -> tuple[dict, dict]:
    """Tapernder Fachwerk-Ausleger mit echter Wandverankerung.

    Ein Wandgelenk nimmt x/y auf, ein horizontal geführtes Rollenlager die
    zweite x-Reaktion. Deren Abstand bildet das für den Ausleger nötige Moment.
    """
    panels = rng.randint(2, 4)
    width = rng.uniform(1.15, 1.65)
    height = width * rng.uniform(1.0, 1.45)
    bottom = []
    top = []
    for i in range(panels + 1):
        ratio = i / panels
        bottom.append((i * width, -height * 0.08 * ratio))
        top.append((i * width, -height * (1.0 - 0.42 * ratio)))
    nodes = bottom + top
    n_bottom = len(bottom)
    bars = [(i, i + 1) for i in range(panels)]
    bars += [(n_bottom + i, n_bottom + i + 1) for i in range(panels)]
    bars += [(i, n_bottom + i) for i in range(panels + 1)]
    rising = rng.random() < 0.5
    for i in range(panels):
        bars.append((i, n_bottom + i + 1) if rising else (n_bottom + i, i + 1))
    return (
        {"nodes": nodes, "bars": bars, "supports": [0, n_bottom],
         "support_types": ["pin_wall", "roller_x"],
         "load_candidates": [panels, n_bottom + panels]},
        {"family": "Wand-Ausleger", "fields": panels},
    )


def _procedural_geometry(rng: random.Random) -> tuple[dict, dict]:
    """Wählt eine Tragwerks-Grammatik; Parameter und Feldzahl bleiben zufällig."""
    family = rng.choice((
        "compact", "warren", "warren", "parallel", "parallel",
        "roof", "roof", "cantilever", "cantilever",
    ))
    return {
        "compact": _compact_geometry,
        "warren": _warren_geometry,
        "parallel": _parallel_geometry,
        "roof": _roof_geometry,
        "cantilever": _cantilever_geometry,
    }[family](rng)


def _build_fixture(rng: random.Random, seed: int) -> dict:
    geo, meta = _procedural_geometry(rng)

    nodes = geo["nodes"]

    # Standardlager dürfen die Seite tauschen; Wandlager sind geometrisch fest.
    first, second = geo["supports"]
    if "support_types" in geo:
        supports = dict(zip((first, second), geo["support_types"]))
    else:
        supports = ({first: "pin", second: "roller"} if rng.random() < 0.7
                    else {first: "roller", second: "pin"})

    candidates = [node for node in geo["load_candidates"] if node not in supports]
    count = 2 if len(candidates) >= 2 and rng.random() < 0.28 else 1
    loads = []
    for index, node in enumerate(rng.sample(candidates, count)):
        fy = rng.choice(LOAD_MAGNITUDES)
        name = "F" if count == 1 else f"F{index + 1}"
        loads.append({"node": node, "fx": 0.0, "fy": fy,
                      "label": f"{name} = {fy:g} kN"})

    # In Fixture-Koordinaten verschieben (Rand 1 Einheit, y nach unten positiv)
    min_x = min(x for x, _ in nodes)
    min_y = min(y for _, y in nodes)
    shifted = [(x - min_x + 1.0, y - min_y + 1.0) for x, y in nodes]
    max_x = max(x for x, _ in shifted)
    max_y = max(y for _, y in shifted)

    node_names = {i: _node_name(i) for i in range(len(shifted))}
    return {
        "id": f"gen-{seed}",
        "title": meta["family"],
        "description": (f"Prozedural generiert (Seed {seed}) — {meta['fields']} Felder, "
                        f"{len(nodes)} Knoten / {len(geo['bars'])} Stäbe."),
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


def _properly_cross(a: tuple[float, float], b: tuple[float, float],
                    c: tuple[float, float], d: tuple[float, float]) -> bool:
    """True nur für echte Stabkreuzungen abseits gemeinsamer Endpunkte."""
    def orient(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])

    o1, o2 = orient(a, b, c), orient(a, b, d)
    o3, o4 = orient(c, d, a), orient(c, d, b)
    eps = 1e-8
    return o1 * o2 < -eps and o3 * o4 < -eps


def _geometry_is_well_conditioned(fixture: dict) -> bool:
    """Verwirft optisch/technisch schlechte Zufallsgeometrien vor dem Solver."""
    points = {name: (value["x"], value["y"])
              for name, value in fixture["nodes"].items()}
    lengths: list[float] = []
    degree = {name: 0 for name in points}
    for bar in fixture["bars"]:
        a, b = points[bar["from"]], points[bar["to"]]
        lengths.append(math.hypot(b[0] - a[0], b[1] - a[1]))
        degree[bar["from"]] += 1
        degree[bar["to"]] += 1
    if min(lengths) < 0.65 or max(lengths) / min(lengths) > 4.5:
        return False
    if any(value < 2 for value in degree.values()):
        return False

    # Keine Stäbe dürfen sich kreuzen, wenn dort kein Knoten liegt.
    bars = fixture["bars"]
    for i, first in enumerate(bars):
        ends_first = {first["from"], first["to"]}
        for second in bars[i + 1:]:
            if ends_first & {second["from"], second["to"]}:
                continue
            if _properly_cross(points[first["from"]], points[first["to"]],
                               points[second["from"]], points[second["to"]]):
                return False

    # Fast parallele, gleichgerichtete Stäbe an einem Knoten sind unleserlich
    # und numerisch empfindlich. Gegenläufige Untergurtstäbe bleiben erlaubt.
    min_angle_cos = math.cos(math.radians(12.0))
    for name, point in points.items():
        vectors = []
        for bar in bars:
            other = None
            if bar["from"] == name:
                other = bar["to"]
            elif bar["to"] == name:
                other = bar["from"]
            if other:
                target = points[other]
                vectors.append((target[0] - point[0], target[1] - point[1]))
        for i, first in enumerate(vectors):
            for second in vectors[i + 1:]:
                cosine = ((first[0] * second[0] + first[1] * second[1]) /
                          (math.hypot(*first) * math.hypot(*second)))
                if cosine > min_angle_cos:
                    return False
    return True


def _validate(fixture: dict) -> bool:
    if not _geometry_is_well_conditioned(fixture):
        return False
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
    if max_force < 1e-6 or max_force > 6 * max(total_load, 1e-9):
        return False  # kraftlos oder degenerierte Geometrie
    # Didaktisch interessant: Nullstab ODER Zug und Druck gemischt
    eps = 0.02 * max_force
    has_zero = any(abs(f) < eps for f in forces)
    has_tension = any(f > eps for f in forces)
    has_compression = any(f < -eps for f in forces)
    if not (has_zero or (has_tension and has_compression)):
        return False
    significant = sum(1 for f in forces if abs(f) > 0.05 * max_force)
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
