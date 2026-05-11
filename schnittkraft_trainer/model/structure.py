from __future__ import annotations

from dataclasses import dataclass, field

from schnittkraft_trainer.model.load import PointLoad
from schnittkraft_trainer.model.support import Support


@dataclass
class Beam:
    """Simple beam with two vertical supports and vertical point loads."""

    length: float
    supports: list[Support] = field(default_factory=list)
    point_loads: list[PointLoad] = field(default_factory=list)
    title: str = "Simple beam"

    def __post_init__(self) -> None:
        if self.length <= 0:
            raise ValueError("Beam length must be positive.")
        self.validate()

    def validate(self) -> None:
        if len(self.supports) > 2:
            raise ValueError("Phase 1 supports exactly two vertical supports.")

        for support in self.supports:
            if support.x > self.length:
                raise ValueError(f"Support {support.label} lies outside the beam.")

        for load in self.point_loads:
            if load.x > self.length:
                raise ValueError(f"Point load {load.label} lies outside the beam.")

        if len(self.supports) == 2:
            first, second = self.supports
            if first.x == second.x:
                raise ValueError("The two supports must not have the same x-position.")

    @property
    def support_a(self) -> Support:
        return self._support_by_index(0)

    @property
    def support_b(self) -> Support:
        return self._support_by_index(1)

    def _support_by_index(self, index: int) -> Support:
        if len(self.supports) != 2:
            raise ValueError("Beam needs exactly two supports for solving.")
        return sorted(self.supports, key=lambda support: support.x)[index]

    def to_dict(self) -> dict[str, object]:
        return {
            "type": "beam",
            "title": self.title,
            "length": self.length,
            "supports": [support.to_dict() for support in self.supports],
            "point_loads": [load.to_dict() for load in self.point_loads],
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "Beam":
        supports_data = data.get("supports", [])
        loads_data = data.get("point_loads", [])

        if not isinstance(supports_data, list):
            raise ValueError("Beam supports must be a list.")
        if not isinstance(loads_data, list):
            raise ValueError("Beam point_loads must be a list.")

        return cls(
            length=float(data["length"]),
            supports=[Support.from_dict(item) for item in supports_data],
            point_loads=[PointLoad.from_dict(item) for item in loads_data],
            title=str(data.get("title", "Simple beam")),
        )
