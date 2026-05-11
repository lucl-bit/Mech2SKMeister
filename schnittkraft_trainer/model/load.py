from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PointLoad:
    """Vertical point load on a beam.

    The internal calculation convention is:
    - positive force_y acts upward
    - negative force_y acts downward

    Example: a 10 kN downward load is represented as force_y=-10.0.
    """

    x: float
    force_y: float
    label: str = "P"
    force_x: float = 0.0

    def __post_init__(self) -> None:
        if self.x < 0:
            raise ValueError("Point load position x must not be negative.")

    def to_dict(self) -> dict[str, object]:
        return {
            "type": "point_load",
            "x": self.x,
            "force_y": self.force_y,
            "force_x": self.force_x,
            "label": self.label,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "PointLoad":
        return cls(
            x=float(data["x"]),
            force_y=float(data["force_y"]),
            force_x=float(data.get("force_x", 0.0)),
            label=str(data.get("label", "P")),
        )
