"""Tests für den Fachwerk-Generator: 100 Seeds → 100 gültige, lösbare Fixtures."""

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
            self.assertGreaterEqual(len(fixture["nodes"]), 4)
            self.assertEqual(len(fixture["supports"]), 2)
            self.assertGreaterEqual(len(fixture["loads"]), 1)
            # Statisch bestimmt: m + r = 2j
            r = sum(2 if t == "pin" else 1 for t in fixture["supports"].values())
            self.assertEqual(len(fixture["bars"]) + r, 2 * len(fixture["nodes"]),
                             f"Seed {seed}: nicht statisch bestimmt")
            # Lösbar mit plausiblen Kräften
            result = _solve_fixture(fixture)
            forces = list(result.bar_forces.values())
            max_force = max(abs(f) for f in forces)
            self.assertGreater(max_force, 1e-6, f"Seed {seed}: alle Stäbe kraftlos")
            self.assertLess(max_force, 200, f"Seed {seed}: Ausreißerkräfte")

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


if __name__ == "__main__":
    unittest.main()
