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


if __name__ == "__main__":
    unittest.main()
