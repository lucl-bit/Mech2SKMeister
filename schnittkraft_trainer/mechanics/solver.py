from __future__ import annotations

from dataclasses import dataclass

from schnittkraft_trainer.model.structure import Beam


@dataclass(frozen=True)
class SupportReactions:
    """Vertical reactions at the two beam supports."""

    ay: float
    by: float
    support_a_label: str = "A"
    support_b_label: str = "B"


def solve_support_reactions(beam: Beam) -> SupportReactions:
    """Solve vertical reactions for a simply supported determinate beam.

    Internal convention:
    - upward reactions are positive
    - upward point loads are positive
    - downward point loads are negative

    Equilibrium:
    sum(Fy) = 0
    sum(M around A) = 0
    """

    beam.validate()
    support_a = beam.support_a
    support_b = beam.support_b
    span = support_b.x - support_a.x

    if span == 0:
        raise ValueError("Support distance must not be zero.")

    load_force_sum = sum(load.force_y for load in beam.point_loads)
    load_moment_about_a = sum(
        load.force_y * (load.x - support_a.x) for load in beam.point_loads
    )

    by = -load_moment_about_a / span
    ay = -load_force_sum - by

    return SupportReactions(
        ay=ay,
        by=by,
        support_a_label=support_a.label,
        support_b_label=support_b.label,
    )
