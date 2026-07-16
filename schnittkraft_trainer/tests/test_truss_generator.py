"""Eigenschaftstests für gültige, lösbare und realistische Fachwerk-Fixtures."""

import unittest

from schnittkraft_trainer.game.truss_generator import generate_truss_fixture
from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)


def _solve_fixture(fixture: dict):
    name_to_id = {name: i + 1 for i, name in enumerate(fixture["nodes"])}
    model = TrussModel(
        joints=[TrussJoint(name_to_id[n], v["x"], v["y"])
                for n, v in fixture["nodes"].items()],
        bars=[TrussBar(i + 1, name_to_id[b["from"]], name_to_id[b["to"]])
              for i, b in enumerate(fixture["bars"])],
        loads=[JointLoad(name_to_id[ld["node"]], ld["fx"], ld["fy"])
               for ld in fixture["loads"]],
        supports=[JointSupport(name_to_id[n], t)
                  for n, t in fixture["supports"].items()],
    )
    return solve_truss(model)


class TestTrussGenerator(unittest.TestCase):
    def test_hundred_seeds_produce_valid_solvable_fixtures(self) -> None:
        for seed in range(100):
            fixture = generate_truss_fixture(seed)
            # Pflichtfelder für den Zeichnen-Modus (frame_fixtures-Format)
            for key in ("id", "title", "bbox", "nodes", "bars", "supports", "loads"):
                self.assertIn(key, fixture, f"Seed {seed}: {key} fehlt")
            self.assertGreaterEqual(len(fixture["nodes"]), 3)
            self.assertLessEqual(len(fixture["nodes"]), 10)
            self.assertGreaterEqual(len(fixture["bars"]), 3)
            self.assertLessEqual(len(fixture["bars"]), 17)
            self.assertEqual(len(fixture["supports"]), 2)
            self.assertIn(len(fixture["loads"]), (1, 2))
            # Statisch bestimmt: m + r = 2j
            r = sum(2 if t in {"pin", "pin_wall", "fixed"} else 1
                    for t in fixture["supports"].values())
            self.assertEqual(len(fixture["bars"]) + r, 2 * len(fixture["nodes"]),
                             f"Seed {seed}: nicht statisch bestimmt")
            # Lösbar mit plausiblen Kräften
            result = _solve_fixture(fixture)
            forces = list(result.bar_forces.values())
            max_force = max(abs(f) for f in forces)
            total_load = sum(abs(load["fx"]) + abs(load["fy"])
                             for load in fixture["loads"])
            self.assertGreater(max_force, 1e-6, f"Seed {seed}: alle Stäbe kraftlos")
            self.assertLessEqual(max_force, 6 * total_load + 1e-6,
                                 f"Seed {seed}: Ausreißerkräfte")

    def test_reproducible(self) -> None:
        self.assertEqual(generate_truss_fixture(42), generate_truss_fixture(42))

    def test_bars_reference_existing_nodes(self) -> None:
        for seed in (0, 7, 99):
            fixture = generate_truss_fixture(seed)
            names = set(fixture["nodes"])
            for bar in fixture["bars"]:
                self.assertIn(bar["from"], names)
                self.assertIn(bar["to"], names)
            for name in fixture["supports"]:
                self.assertIn(name, names)
            for load in fixture["loads"]:
                self.assertIn(load["node"], names)

    def test_procedural_variety_complexity_and_force_mix(self) -> None:
        signatures = set()
        titles = set()
        sizes = set()
        wall_supports_seen = False
        for seed in range(1000):
            fixture = generate_truss_fixture(seed)
            titles.add(fixture["title"])
            sizes.add((len(fixture["nodes"]), len(fixture["bars"])))
            signatures.add((
                fixture["title"],
                tuple((round(node["x"], 2), round(node["y"], 2))
                      for node in fixture["nodes"].values()),
                tuple((bar["from"], bar["to"]) for bar in fixture["bars"]),
            ))
            if fixture["title"] == "Wand-Ausleger":
                wall_supports_seen = True
                self.assertEqual(set(fixture["supports"].values()),
                                 {"pin_wall", "roller_x"})
            for load in fixture["loads"]:
                self.assertIn(load["fy"], (5.0, 10.0, 15.0, 20.0))
                self.assertEqual(load["fx"], 0.0)
                self.assertIn("kN", load["label"])
                self.assertNotIn(load["node"], fixture["supports"])

            forces = list(_solve_fixture(fixture).bar_forces.values())
            scale = max(abs(force) for force in forces)
            eps = 0.02 * scale
            has_zero = any(abs(force) < eps for force in forces)
            has_tension = any(force > eps for force in forces)
            has_compression = any(force < -eps for force in forces)
            self.assertTrue(has_zero or (has_tension and has_compression))

        self.assertEqual(titles, {
            "Kompaktfachwerk", "Warren-Brücke", "Pratt-Brücke",
            "Howe-Brücke", "Dachfächer", "Wand-Ausleger",
        })
        self.assertTrue(wall_supports_seen)
        self.assertGreaterEqual(len(sizes), 8)
        self.assertGreater(len(signatures), 900)


if __name__ == "__main__":
    unittest.main()
