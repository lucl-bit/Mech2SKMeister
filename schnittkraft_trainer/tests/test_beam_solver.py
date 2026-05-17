import unittest

from schnittkraft_trainer.mechanics.internal_forces import internal_forces_at
from schnittkraft_trainer.mechanics.sign_convention import (
    MomentPositive,
    ShearPositiveOnLeftCut,
    SignConvention,
)
from schnittkraft_trainer.mechanics.solver import solve_support_reactions
from schnittkraft_trainer.model.load import DistributedLoad, PointLoad
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


def make_udl_beam(length: float = 6.0, q: float = -10.0) -> Beam:
    return Beam(
        length=length,
        supports=[
            Support(x=0.0, support_type=SupportType.PIN, label="A"),
            Support(x=length, support_type=SupportType.ROLLER, label="B"),
        ],
        point_loads=[],
        distributed_loads=[DistributedLoad(x_start=0.0, x_end=length, q=q, label="q")],
        title="Einfeldträger mit Streckenlast",
    )


class TestDistributedLoad(unittest.TestCase):
    def test_udl_reactions_are_half_total_load(self) -> None:
        beam = make_udl_beam(length=6.0, q=-10.0)  # 60 kN total downward
        r = solve_support_reactions(beam)
        # Each support carries qL/2 = 30 kN upward.
        self.assertAlmostEqual(r.ay, 30.0)
        self.assertAlmostEqual(r.by, 30.0)

    def test_udl_shear_is_linear(self) -> None:
        beam = make_udl_beam(length=6.0, q=-10.0)
        q_abs = 10.0
        length = 6.0
        # Q(0) = qL/2; Q(L/2) = 0; Q(L) = -qL/2 (base convention, before sign flip).
        f0 = internal_forces_at(beam, x=0.0)
        fmid = internal_forces_at(beam, x=length / 2)
        # Just-inside-the-right-support; at x == L the right reaction is included
        # and Q sums to zero outside the beam, which is correct but not the test target.
        fend = internal_forces_at(beam, x=length - 1e-6)
        self.assertAlmostEqual(f0.shear_force, q_abs * length / 2)
        self.assertAlmostEqual(fmid.shear_force, 0.0)
        self.assertAlmostEqual(fend.shear_force, -q_abs * length / 2, places=4)

    def test_udl_moment_max_at_midspan(self) -> None:
        beam = make_udl_beam(length=6.0, q=-10.0)
        q_abs = 10.0
        length = 6.0
        forces = internal_forces_at(beam, x=length / 2)
        # M_max = q L^2 / 8 = 45 kNm
        self.assertAlmostEqual(forces.bending_moment, q_abs * length ** 2 / 8)
        # M(0) = M(L) = 0
        self.assertAlmostEqual(internal_forces_at(beam, x=0.0).bending_moment, 0.0)
        self.assertAlmostEqual(internal_forces_at(beam, x=length).bending_moment, 0.0)


if __name__ == "__main__":
    unittest.main()
