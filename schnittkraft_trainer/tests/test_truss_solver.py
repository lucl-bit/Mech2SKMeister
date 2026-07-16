import unittest

from schnittkraft_trainer.mechanics.truss_solver import (
    JointLoad,
    JointSupport,
    TrussBar,
    TrussJoint,
    TrussModel,
    solve_truss,
)


class TestTrussSolver(unittest.TestCase):
    def test_simple_triangle_truss_with_downward_top_load(self) -> None:
        model = TrussModel(
            joints=[
                TrussJoint(1, 0.0, 0.0),
                TrussJoint(2, 1.0, -1.0),
                TrussJoint(3, 2.0, 0.0),
            ],
            bars=[
                TrussBar(1, 1, 2),
                TrussBar(2, 2, 3),
                TrussBar(3, 1, 3),
            ],
            supports=[
                JointSupport(1, "pin"),
                JointSupport(3, "roller"),
            ],
            loads=[JointLoad(2, 0.0, 10.0)],
        )

        result = solve_truss(model)

        self.assertAlmostEqual(result.reactions["ry:1"], -5.0)
        self.assertAlmostEqual(result.reactions["ry:3"], -5.0)
        self.assertAlmostEqual(result.bar_forces[1], -7.0710678118654755)
        self.assertAlmostEqual(result.bar_forces[2], -7.0710678118654755)
        self.assertAlmostEqual(result.bar_forces[3], 5.0)

    def test_rejects_non_determinate_truss(self) -> None:
        model = TrussModel(
            joints=[TrussJoint(1, 0.0, 0.0), TrussJoint(2, 1.0, 0.0)],
            bars=[TrussBar(1, 1, 2)],
            supports=[JointSupport(1, "pin")],
            loads=[],
        )

        with self.assertRaises(ValueError):
            solve_truss(model)

    def test_fixed_support_is_translational_in_truss_model(self) -> None:
        model = TrussModel(
            joints=[TrussJoint(1, 0.0, 0.0), TrussJoint(2, 1.0, 0.0)],
            bars=[TrussBar(1, 1, 2)],
            supports=[
                JointSupport(1, "fixed"),
                JointSupport(2, "roller"),
            ],
            loads=[JointLoad(1, 0.0, 15.0)],
        )

        result = solve_truss(model)

        self.assertAlmostEqual(result.bar_forces[1], 0.0)
        self.assertAlmostEqual(result.reactions["ry:1"], -15.0)

    def test_horizontal_roller_creates_horizontal_reaction(self) -> None:
        model = TrussModel(
            joints=[
                TrussJoint(1, 0.0, 0.0),
                TrussJoint(2, 1.0, 0.0),
                TrussJoint(3, 2.0, 1.0),
            ],
            bars=[
                TrussBar(1, 1, 2),
                TrussBar(2, 2, 3),
                TrussBar(3, 1, 3),
            ],
            supports=[
                JointSupport(1, "roller_x"),
                JointSupport(3, "pin"),
            ],
            loads=[JointLoad(2, 4.0, 0.0)],
        )

        result = solve_truss(model)

        self.assertIn("rx:1", result.reactions)
        self.assertNotIn("ry:1", result.reactions)
        self.assertAlmostEqual(
            result.reactions["rx:1"] + result.reactions["rx:3"],
            -4.0,
        )

    def test_wall_pin_and_horizontal_roller_support_a_cantilever(self) -> None:
        model = TrussModel(
            joints=[
                TrussJoint(1, 0.0, 0.0),
                TrussJoint(2, 0.0, -1.0),
                TrussJoint(3, 2.0, -0.5),
            ],
            bars=[
                TrussBar(1, 1, 2),
                TrussBar(2, 1, 3),
                TrussBar(3, 2, 3),
            ],
            supports=[
                JointSupport(1, "pin_wall"),
                JointSupport(2, "roller_x"),
            ],
            loads=[JointLoad(3, 0.0, 10.0)],
        )

        result = solve_truss(model)

        self.assertIn("rx:1", result.reactions)
        self.assertIn("ry:1", result.reactions)
        self.assertIn("rx:2", result.reactions)
        self.assertNotIn("ry:2", result.reactions)
        self.assertAlmostEqual(result.reactions["ry:1"], -10.0)


if __name__ == "__main__":
    unittest.main()
