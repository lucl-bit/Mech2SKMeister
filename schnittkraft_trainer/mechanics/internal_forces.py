from __future__ import annotations

from dataclasses import dataclass

from schnittkraft_trainer.mechanics.sign_convention import (
    DEFAULT_CONVENTION,
    SignConvention,
)
from schnittkraft_trainer.mechanics.solver import (
    SupportReactions,
    solve_support_reactions,
)
from schnittkraft_trainer.model.structure import Beam


@dataclass(frozen=True)
class InternalForces:
    """Internal forces at a beam section in the selected sign convention."""

    x: float
    normal_force: float
    shear_force: float
    bending_moment: float
    convention_name: str


def internal_forces_at(
    beam: Beam,
    x: float,
    convention: SignConvention = DEFAULT_CONVENTION,
    reactions: SupportReactions | None = None,
) -> InternalForces:
    """Calculate N, V/Q, and M at a beam section.

    Phase-1 simplification:
    - only vertical point loads are supported
    - no horizontal loads, so N is always 0
    - the section is evaluated from the left part of the beam

    Base convention before conversion:
    - N tension positive
    - V/Q upward on the left cut face positive
    - M sagging positive
    """

    if x < 0 or x > beam.length:
        raise ValueError("Section x must lie on the beam.")

    reactions = reactions or solve_support_reactions(beam)
    support_a = beam.support_a
    support_b = beam.support_b

    vertical_forces_left = 0.0
    moment_about_section_left = 0.0

    if support_a.x <= x:
        vertical_forces_left += reactions.ay
        moment_about_section_left += reactions.ay * (x - support_a.x)

    if support_b.x <= x:
        vertical_forces_left += reactions.by
        moment_about_section_left += reactions.by * (x - support_b.x)

    for load in beam.point_loads:
        if load.x <= x:
            vertical_forces_left += load.force_y
            moment_about_section_left += load.force_y * (x - load.x)

    normal_base = 0.0
    shear_base = vertical_forces_left
    moment_base = moment_about_section_left

    return InternalForces(
        x=x,
        normal_force=convention.convert_axial(normal_base),
        shear_force=convention.convert_shear(shear_base),
        bending_moment=convention.convert_moment(moment_base),
        convention_name=convention.name,
    )
