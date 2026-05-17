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


@dataclass(frozen=True)
class DistributedLoad:
    """Constant vertical distributed load q over [x_start, x_end].

    Sign convention matches PointLoad.force_y: positive q acts upward,
    negative q acts downward. A 10 kN/m downward load is q = -10.0.
    """

    x_start: float
    x_end: float
    q: float
    label: str = "q"

    def __post_init__(self) -> None:
        if self.x_start < 0 or self.x_end < 0:
            raise ValueError("Distributed load coordinates must not be negative.")
        if self.x_end <= self.x_start:
            raise ValueError("Distributed load x_end must exceed x_start.")

    @property
    def length(self) -> float:
        return self.x_end - self.x_start

    @property
    def resultant(self) -> float:
        return self.q * self.length

    @property
    def centroid(self) -> float:
        return 0.5 * (self.x_start + self.x_end)

    def to_dict(self) -> dict[str, object]:
        return {
            "type": "distributed_load",
            "x_start": self.x_start,
            "x_end": self.x_end,
            "q": self.q,
            "label": self.label,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "DistributedLoad":
        return cls(
            x_start=float(data["x_start"]),
            x_end=float(data["x_end"]),
            q=float(data["q"]),
            label=str(data.get("label", "q")),
        )
