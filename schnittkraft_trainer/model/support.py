from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class SupportType(str, Enum):
    """Supported bearing types for the phase-1 beam solver."""

    PIN = "pin"
    ROLLER = "roller"
    FIXED = "fixed"


@dataclass(frozen=True)
class Support:
    """Vertical support for a simple statically determinate beam."""

    x: float
    support_type: SupportType
    label: str

    def __post_init__(self) -> None:
        if self.x < 0:
            raise ValueError("Support position x must not be negative.")

    def to_dict(self) -> dict[str, object]:
        return {
            "x": self.x,
            "support_type": self.support_type.value,
            "label": self.label,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "Support":
        return cls(
            x=float(data["x"]),
            support_type=SupportType(str(data["support_type"])),
            label=str(data["label"]),
        )
