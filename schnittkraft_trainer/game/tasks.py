from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

from schnittkraft_trainer.model.structure import Beam


@dataclass(frozen=True)
class BeamTask:
    """A playable beam exercise.

    The task owns learning metadata and the beam definition. It does not know
    anything about terminal input, scoring screens, or a future GUI.
    """

    task_id: str
    title: str
    description: str
    goal: str
    level: int
    points: int
    section_x: float
    beam: Beam

    def to_dict(self) -> dict[str, object]:
        return {
            "task_id": self.task_id,
            "title": self.title,
            "description": self.description,
            "goal": self.goal,
            "level": self.level,
            "points": self.points,
            "section_x": self.section_x,
            "beam": self.beam.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> "BeamTask":
        beam_data = data["beam"]
        if not isinstance(beam_data, dict):
            raise ValueError("Task beam must be an object.")

        return cls(
            task_id=str(data["task_id"]),
            title=str(data["title"]),
            description=str(data.get("description", "")),
            goal=str(data.get("goal", "")),
            level=int(data.get("level", 1)),
            points=int(data.get("points", 10)),
            section_x=float(data["section_x"]),
            beam=Beam.from_dict(beam_data),
        )


def load_task(path: Path) -> BeamTask:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return BeamTask.from_dict(data)


def save_task(task: BeamTask, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(task.to_dict(), file, indent=2)
        file.write("\n")


def load_tasks_from_folder(folder: Path) -> list[BeamTask]:
    tasks = [load_task(path) for path in sorted(folder.glob("*.json"))]
    return sorted(tasks, key=lambda task: (task.level, task.task_id))
