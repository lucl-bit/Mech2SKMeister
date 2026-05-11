from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class AxialPositive(str, Enum):
    TENSION = "tension"
    COMPRESSION = "compression"


class ShearPositiveOnLeftCut(str, Enum):
    UP = "up"
    DOWN = "down"


class MomentPositive(str, Enum):
    SAGGING = "sagging"
    HOGGING = "hogging"


@dataclass(frozen=True)
class SignConvention:
    """User-facing sign convention for internal forces.

    The solver returns values in one internal base convention:
    - N: tension positive
    - V/Q on the left cut face: upward positive
    - M: sagging positive

    This class converts those base results into the selected convention.
    """

    name: str
    axial_positive: AxialPositive = AxialPositive.TENSION
    shear_positive_on_left_cut: ShearPositiveOnLeftCut = ShearPositiveOnLeftCut.UP
    moment_positive: MomentPositive = MomentPositive.SAGGING

    def convert_axial(self, value: float) -> float:
        if self.axial_positive is AxialPositive.TENSION:
            return value
        return -value

    def convert_shear(self, value: float) -> float:
        if self.shear_positive_on_left_cut is ShearPositiveOnLeftCut.UP:
            return value
        return -value

    def convert_moment(self, value: float) -> float:
        if self.moment_positive is MomentPositive.SAGGING:
            return value
        return -value

    def to_dict(self) -> dict[str, str]:
        return {
            "name": self.name,
            "axial_positive": self.axial_positive.value,
            "shear_positive_on_left_cut": self.shear_positive_on_left_cut.value,
            "moment_positive": self.moment_positive.value,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "SignConvention":
        return cls(
            name=str(data["name"]),
            axial_positive=AxialPositive(str(data.get("axial_positive", "tension"))),
            shear_positive_on_left_cut=ShearPositiveOnLeftCut(
                str(data.get("shear_positive_on_left_cut", "up"))
            ),
            moment_positive=MomentPositive(str(data.get("moment_positive", "sagging"))),
        )


DEFAULT_CONVENTION = SignConvention(name="Default: tension/up/sagging")
