from __future__ import annotations

import json
from pathlib import Path

from schnittkraft_trainer.game.feedback import build_feedback
from schnittkraft_trainer.game.scoring import check_answers
from schnittkraft_trainer.game.tasks import BeamTask, load_tasks_from_folder
from schnittkraft_trainer.mechanics.internal_forces import internal_forces_at
from schnittkraft_trainer.mechanics.sign_convention import SignConvention
from schnittkraft_trainer.mechanics.solver import solve_support_reactions


def load_convention(path: Path) -> SignConvention:
    with path.open("r", encoding="utf-8") as file:
        data = json.load(file)
    return SignConvention.from_dict(data)


def save_convention(convention: SignConvention, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(convention.to_dict(), file, indent=2)
        file.write("\n")


def expected_answers(task: BeamTask, convention: SignConvention) -> dict[str, float]:
    reactions = solve_support_reactions(task.beam)
    forces = internal_forces_at(
        task.beam,
        x=task.section_x,
        convention=convention,
        reactions=reactions,
    )
    return {
        "Ay": reactions.ay,
        "By": reactions.by,
        "Q": forces.shear_force,
        "M": forces.bending_moment,
    }


def run_console_game(tasks_folder: Path, convention_path: Path) -> None:
    tasks = load_tasks_from_folder(tasks_folder)
    convention = load_convention(convention_path)

    if not tasks:
        print("Keine Aufgaben gefunden.")
        return

    print("\nSchnittkraft Trainer - Konsolenmodus")
    print("------------------------------------")
    print(f"Aktive Konvention: {convention.name}")
    print("Einheiten: kN und kNm. Beende mit Ctrl+C.\n")

    total_points = 0
    max_points = 0
    completed_tasks: list[dict[str, object]] = []

    for task in tasks:
        print(f"Level {task.level}: {task.title}")
        print(task.description)
        print(f"Ziel: {task.goal}")
        print(f"Schnittstelle: x = {task.section_x:g} m")
        print("")

        actual = {
            "Ay": _ask_float("Ay [kN] = "),
            "By": _ask_float("By [kN] = "),
            "Q": _ask_float("Q/V [kN] = "),
            "M": _ask_float("M [kNm] = "),
        }

        expected = expected_answers(task, convention)
        result = check_answers(expected, actual, max_points=task.points)

        print("")
        for message in build_feedback(result):
            print(f"- {message}")

        print(f"Punkte: {result.earned_points}/{result.max_points}")
        print("")

        total_points += result.earned_points
        max_points += result.max_points
        completed_tasks.append(
            {
                "task_id": task.task_id,
                "level": task.level,
                "earned_points": result.earned_points,
                "max_points": result.max_points,
                "perfect": result.is_perfect,
            }
        )

    print("------------------------------------")
    print(f"Runde beendet: {total_points}/{max_points} Punkte")

    progress_path = tasks_folder.parent / "progress" / "console_progress.json"
    _save_progress(progress_path, completed_tasks, total_points, max_points)
    print(f"Fortschritt gespeichert: {progress_path}")


def _ask_float(prompt: str) -> float:
    while True:
        raw_value = input(prompt).strip().replace(",", ".")
        try:
            return float(raw_value)
        except ValueError:
            print("Bitte eine Zahl eingeben, z. B. 5 oder -2.5.")


def _save_progress(
    path: Path,
    completed_tasks: list[dict[str, object]],
    total_points: int,
    max_points: int,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    progress = {
        "total_points": total_points,
        "max_points": max_points,
        "tasks": completed_tasks,
    }
    with path.open("w", encoding="utf-8") as file:
        json.dump(progress, file, indent=2)
        file.write("\n")
