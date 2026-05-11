import unittest

from schnittkraft_trainer.mechanics.internal_forces import internal_forces_at
from schnittkraft_trainer.mechanics.sign_convention import (
    MomentPositive,
    ShearPositiveOnLeftCut,
    SignConvention,
)
from schnittkraft_trainer.mechanics.solver import solve_support_reactions
from schnittkraft_trainer.model.load import PointLoad
from schnittkraft_trainer.model.structure import Beam
from schnittkraft_trainer.model.support import Support, SupportType


def make_midspan_point_load_beam() -> Beam:
    return Beam(
        length=4.0,
        supports=[
            Support(x=0.0, support_type=SupportType.PIN, label="A"),
            Support(x=4.0, support_type=SupportType.ROLLER, label="B"),
        ],
        point_loads=[PointLoad(x=2.0, force_y=-10.0, label="P")],
        title="Einfeldtraeger mit Mittellast",
    )


class TestBeamSolver(unittest.TestCase):
    def test_support_reactions_for_center_point_load(self) -> None:
        beam = make_midspan_point_load_beam()

        reactions = solve_support_reactions(beam)

        self.assertEqual(reactions.ay, 5.0)
        self.assertEqual(reactions.by, 5.0)

    def test_internal_forces_left_of_point_load(self) -> None:
        beam = make_midspan_point_load_beam()

        forces = internal_forces_at(beam, x=1.0)

        self.assertEqual(forces.normal_force, 0.0)
        self.assertEqual(forces.shear_force, 5.0)
        self.assertEqual(forces.bending_moment, 5.0)

    def test_internal_forces_right_of_point_load(self) -> None:
        beam = make_midspan_point_load_beam()

        forces = internal_forces_at(beam, x=3.0)

        self.assertEqual(forces.normal_force, 0.0)
        self.assertEqual(forces.shear_force, -5.0)
        self.assertEqual(forces.bending_moment, 5.0)

    def test_changed_sign_convention_flips_shear_and_moment(self) -> None:
        beam = make_midspan_point_load_beam()
        convention = SignConvention(
            name="Test convention",
            shear_positive_on_left_cut=ShearPositiveOnLeftCut.DOWN,
            moment_positive=MomentPositive.HOGGING,
        )

        forces = internal_forces_at(beam, x=1.0, convention=convention)

        self.assertEqual(forces.shear_force, -5.0)
        self.assertEqual(forces.bending_moment, -5.0)


if __name__ == "__main__":
    unittest.main()
